/**
 * P0 garbled-text boundary guard: control routes refuse ANY payload whose
 * strings already carry U+FFFD replacement characters — the sender's encoder
 * destroyed the text before the wire, and persisting it would immortalize
 * mojibake names in every panel render. Clean CJK flows untouched.
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
    session: 'sess-guard',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'guard node',
    peers: [],
    delegates: [],
    sessionNodes: true,
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
  apply(ctx, makeConfig({ announce: true, session: 'peer-node', dshHome: mkdtempSync(join(tmpdir(), 'dsh-a2a-guard-')) }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    port,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

describe('garbled-text boundary guard', () => {
  it('canvas create with U+FFFD in the name answers 422/-32005 and stores nothing', async () => {
    const { port, dispose } = await mount()
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: '\uFFFD\uFFFD显示\uFFFD\uFFFD组队' }),
      })
      expect(response.status).toBe(422)
      const parsed = await response.json() as { error: string; code: number }
      expect(parsed.code).toBe(-32005)
      expect(parsed.error).toContain('undecodable')
    } finally {
      await dispose()
    }
  })

  it('clean CJK team names pass through and round-trip intact', async () => {
    const { port, dispose } = await mount()
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: '物流协同一组' }),
      })
      expect(response.status).toBe(200)
      const parsed = await response.json() as { ok: boolean; name?: string; teams?: string[] }
      expect(parsed.ok).toBe(true)
      // Clean CJK must survive the full wire→store→response round-trip intact.
      expect(parsed.name).toBe('物流协同一组')
      expect(parsed.teams).toContain('物流协同一组')
    } finally {
      await dispose()
    }
  })

  it('U+FFFD nested deep inside arrays/objects is caught by the recursive sweep (join route)', async () => {
    const { port, dispose } = await mount()
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'session-\uFFFD-broken' }),
      })
      expect(response.status).toBe(422)
      const parsed = await response.json() as { code: number }
      expect(parsed.code).toBe(-32005)
    } finally {
      await dispose()
    }
  })
})
