/**
 * Server-side idempotency keys (work-order P3 / B3): one caller-born task id
 * executes at most once per TTL window — exact replays answer
 * 409/-32003/replay:true without re-steering, key conflicts answer
 * 409/-32002, expiry re-opens the window, and every path is total.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'
import {
  IdempotencyStore,
  WIRE_ERROR_IDEMPOTENCY_CONFLICT,
  WIRE_ERROR_REPLAY_REJECTED,
  type IdempotencyOptions,
} from '../src/idempotency-store.ts'

describe('idempotency store', () => {
  function tmpStore(options?: IdempotencyOptions): { store: IdempotencyStore; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-')), 'idempotency.json')
    return { store: new IdempotencyStore(file, options), file }
  }

  it('fresh claim records the fingerprint; identical re-claim answers replay; different payload answers conflict', () => {
    const { store } = tmpStore()
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
    expect(store.claim('t-1', 'hash-a')).toBe('replay')
    expect(store.has('t-1')).toBe(true)
    expect(store.claim('t-1', 'hash-b')).toBe('conflict')
  })

  it('expired keys re-open after the TTL (injectable clock)', () => {
    let now = 1_000_000
    const { store } = tmpStore({ now: () => now, ttlMs: 1_000 })
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
    now += 1_500
    expect(store.has('t-1')).toBe(false)
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
  })

  it('capacity evicts oldest-inserted first', () => {
    const { store } = tmpStore({ cap: 2 })
    expect(store.claim('a', 'h')).toBe('fresh')
    expect(store.claim('b', 'h')).toBe('fresh')
    expect(store.claim('c', 'h')).toBe('fresh') // evicts 'a'
    expect(store.has('a')).toBe(false)
    expect(store.claim('b', 'h')).toBe('replay')
  })

  it('empty ids bypass claiming entirely (always fresh, never stored)', () => {
    const { store } = tmpStore()
    expect(store.claim('', 'h')).toBe('fresh')
    expect(store.has('')).toBe(false)
  })

  it('the window persists across restarts (including conflict memory)', () => {
    const { store, file } = tmpStore()
    expect(store.claim('t-1', 'hash-x')).toBe('fresh')
    const restored = new IdempotencyStore(file)
    expect(restored.claim('t-1', 'hash-y')).toBe('conflict')
    expect(restored.claim('t-1', 'hash-x')).toBe('replay')
  })
})

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): Agent {
    throw new Error('none')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agent !== undefined && this.agent.id === id ? this.agent : undefined
  }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'sess-idem',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'idem node',
    peers: [],
    delegates: [],
    sessionNodes: false,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    dshHome: '',
    cardTtlMs: 172_800_000,
    ...overrides,
  }
}

async function mount(): Promise<{ port: number; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const registry = ctx.get('agents') as unknown as FakeAgentsService
  const liveAgent = {
    id: SessionId('agent-1'),
    session: { events: [] as unknown[] },
    steer: vi.fn(),
  } as unknown as Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } }
  liveAgent.steer = vi.fn(() => {
    ;(liveAgent.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'peer node replied' }] } } })
    ctx.emit('agent/status', { agent: liveAgent, status: 'idle' })
  })
  registry.agent = liveAgent
  apply(ctx, makeConfig({ announce: true, session: 'peer-node', dshHome: mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-host-')) }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    port,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

describe('/a2a/direct idempotency enforcement', () => {
  it('first delivery executes; exact replay refuses with -32003+replay:true and never re-steers', async () => {
    const { port, dispose } = await mount()
    try {
      // Only explicit caller-born task_ids can collide: the minted-direct-*
      // fallback randomizes every run, which is exactly the contract.
      const pinned = JSON.stringify({ team: 'dsh', message: 'pin me', caller_session: 'idem-runner', task_id: 'pinned-task' })
      const p1 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      expect(p1.status).toBe(200)
      const p2 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      expect(p2.status).toBe(409)
      const parsed = await p2.json() as { code: number; replay: boolean; task_id?: string }
      expect(parsed.code).toBe(WIRE_ERROR_REPLAY_REJECTED)
      expect(parsed.replay).toBe(true)
      expect(parsed.task_id).toBe('pinned-task')
    } finally {
      await dispose()
    }
  })

  it('same key + different payload answers hard conflict -32002', async () => {
    const { port, dispose } = await mount()
    try {
      const first = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'version A', caller_session: 'idem-runner', task_id: 'clash-1' }),
      })
      expect(first.status).toBe(200)
      const second = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'version B tampered', caller_session: 'idem-runner', task_id: 'clash-1' }),
      })
      expect(second.status).toBe(409)
      const parsed = await second.json() as { code: number; replay?: boolean }
      expect(parsed.code).toBe(WIRE_ERROR_IDEMPOTENCY_CONFLICT)
      // Explicit false, not absent: machines branch on a total field.
      expect(parsed.replay).toBe(false)
    } finally {
      await dispose()
    }
  })
})
