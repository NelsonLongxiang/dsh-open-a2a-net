// @vitest-environment node
/**
 * M1 window pins (0.6.23 OriginClaim ruling, deferred to the 0.6.25
 * close-out): the envelope-absent delivery path splits on
 * originClaimWindow —
 *   · open (default): the delivery walks on with a counted legacyInbound
 *     warn (the operator watches the tail drain);
 *   · closed (explicit false): rejected untrusted-origin, the same code
 *     as a failed signature.
 * A present-but-invalid envelope rejects in BOTH states (no dual-track).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../../src/index.ts'

interface Mounted { ctx: Context; port: number; home: string; dispose: () => Promise<void> }

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agent !== undefined && this.agent.id === id ? this.agent : undefined
  }
}

async function mount(overrides: Partial<Config> = {}): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-m1win-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  // A live joined session so the free-form caller label clears N3 and the
  // delivery has somewhere to steer.
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const session = {
    id: SessionId('session-0123456789abcdef'),
    session: { events: [] as unknown[] },
    steer(): void {
      ;(session as { session: { events: unknown[] } }).session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'steered ok' }] } } })
      ctx.emit('agent/status', { agent: session as unknown as Agent, status: 'idle' })
    },
  } as unknown as Agent
  agents.agent = session
  apply(ctx, {
    apiKey: '',
    session: 'host-sess',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'm1-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    ...overrides,
  } as Config)
  ctx.emit('agent/created', { agent: session })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(session.id) }),
  })).json()
  return { ctx, port, home, dispose: async () => { await ctx.fiber.dispose() } }
}

interface DirectReply { routed?: boolean; result?: { text?: string }; error?: string }

async function postDirect(port: number, headers: Record<string, string> = {}): Promise<DirectReply> {
  return await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ team: 'dsh/01234567', message: 'm1 window probe', caller_session: 'session-0123456789abcdef', task_id: `direct-m1-${Math.random().toString(16).slice(2, 8)}` }),
  })).json() as DirectReply
}

async function stateLegacy(port: number): Promise<number> {
  const body = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { legacyInbound?: number }
  return body.legacyInbound ?? -1
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('M1 originClaimWindow pins', () => {
  it('window OPEN (default): an envelope-absent delivery walks on and the legacyInbound counter ticks on the state face', async () => {
    const m = await mount()
    try {
      expect(await stateLegacy(m.port)).toBe(0)
      const reply = await postDirect(m.port)
      expect(reply.routed).toBe(true)
      expect(await stateLegacy(m.port)).toBe(1)
      // A second envelope-less delivery ticks again — the drain gauge.
      const second = await postDirect(m.port)
      expect(second.routed).toBe(true)
      expect(await stateLegacy(m.port)).toBe(2)
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('window CLOSED (originClaimWindow: false): an envelope-absent delivery rejects untrusted-origin — the same code as a failed signature', async () => {
    const m = await mount({ originClaimWindow: false })
    try {
      const reply = await postDirect(m.port)
      expect(reply.routed).not.toBe(true)
      expect(String(reply.error)).toContain('untrusted-origin')
      // The counter never moves in the closed state: there is no legacy
      // traffic to watch drain.
      expect(await stateLegacy(m.port)).toBe(0)
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('a PRESENT-but-invalid envelope rejects in BOTH window states (no dual-track: shape never substitutes for signature)', async () => {
    const open = await mount()
    try {
      const badHeaders = { 'X-A2A-Caller': 'dsh', 'X-A2A-Caller-Url': 'http://127.0.0.1:9', 'X-A2A-Caller-Ts': String(Date.now()), 'X-A2A-CALLER-SIG': Buffer.from('forged').toString('base64') }
      const refusedOpen = await postDirect(open.port, badHeaders)
      expect(refusedOpen.routed).not.toBe(true)
      expect(String(refusedOpen.error)).toContain('untrusted-origin')
      expect(await stateLegacy(open.port)).toBe(0)
    } finally {
      await open.dispose()
    }
    const closed = await mount({ originClaimWindow: false })
    try {
      const badHeaders = { 'X-A2A-Caller': 'dsh', 'X-A2A-Caller-Url': 'http://127.0.0.1:9', 'X-A2A-Caller-Ts': String(Date.now() - 7 * 60_000), 'X-A2A-Caller-Sig': Buffer.from('stale').toString('base64') }
      const refusedClosed = await postDirect(closed.port, badHeaders)
      expect(refusedClosed.routed).not.toBe(true)
      expect(String(refusedClosed.error)).toContain('untrusted-origin')
    } finally {
      await closed.dispose()
    }
  }, 30_000)
})
