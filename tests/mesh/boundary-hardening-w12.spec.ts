// @vitest-environment node
/**
 * Boundary-hardening wave (0.6.25) — W1/W2 regression pins (local mount
 * with a two-root agents service, so two joined sessions coexist).
 * W1: the local in-process dispatch candidate carries the SAME shared-team
 *     admission the inbound faces apply.
 * W2: canvas membership is a first-class link record — admission basis is
 *     roster ∪ canvas.
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

class TwoRootAgentsService extends Service {
  agentsMap = new Map<string, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return [...this.agentsMap.values()]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agentsMap.get(String(id))
  }
}

interface TestAgent extends Agent {
  steerCalls: unknown[]
  host?: Context
}

function makeAgent(id: string, name: string): TestAgent {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title: name },
    steerCalls: [] as unknown[],
    steer(payload: unknown): void {
      agent.steerCalls.push(payload)
      // The harness reply pattern: a steered session answers and goes
      // idle — the round settles on that event.
      const message = typeof payload === 'object' && payload !== null && 'message' in (payload as Record<string, unknown>)
        ? String((payload as { message?: unknown }).message)
        : String(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `answered ${name}: ${message.slice(0, 40)}` }] } } })
      agent.host?.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as TestAgent
  return agent
}

function makeConfig(home: string, overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'host-sess',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'w-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    ...overrides,
  } as Config
}

interface Mounted { ctx: Context; agents: TwoRootAgentsService; port: number; a: TestAgent; b: TestAgent; dispose: () => Promise<void> }

async function mountTwoSessions(overrides: Partial<Config> = {}): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-w12-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(TwoRootAgentsService)
  const agents = ctx.get('agents') as unknown as TwoRootAgentsService
  const a = makeAgent('session-aaaaaaaa11111111', 'sess-a')
  const b = makeAgent('session-bbbbbbbb22222222', 'sess-b')
  agents.agentsMap.set(String(a.id), a)
  agents.agentsMap.set(String(b.id), b)
  apply(ctx, makeConfig(home, overrides))
  a.host = ctx
  b.host = ctx
  ctx.emit('agent/created', { agent: a as unknown as Agent })
  ctx.emit('agent/created', { agent: b as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  return {
    ctx, agents, port, a, b,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

async function postJson(port: number, path: string, body: unknown): Promise<Response> {
  return await globalThis.fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

const execAs = (agent: Agent) => ({ signal: new AbortController().signal, agent }) as never

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('W1: joined-face admission rides the local dispatch candidate too', () => {
  it('a teamless joined session routing to another session team is refused; the roster-shared path still passes', async () => {
    const m = await mountTwoSessions({ teamJoinAllowlist: ['dsh/ops', 'dsh/shared'] })
    try {
      expect((await postJson(m.port, '/__dsh_a2a/join', { id: String(m.a.id) })).status).toBe(200)
      expect((await postJson(m.port, '/__dsh_a2a/join', { id: String(m.b.id) })).status).toBe(200)
      // b declares a roster team; a stays TEAMLESS.
      await m.ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/ops', id: String(m.b.id) }, execAs(m.b))
      // W1: the teamless session's a2a_route to the other session team —
      // the LOCAL in-process candidate — refuses with the same shared-team
      // admission the wire face applies.
      const refused = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: '借道本机' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(refused?.ok).toBe(false)
      expect(refused?.error).toContain('declares no team membership')
      expect(m.b.steerCalls).toHaveLength(0)
      // Paired pin: once both declare a shared team, the same route passes.
      await m.ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/shared', id: String(m.a.id) }, execAs(m.a))
      await m.ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/shared', id: String(m.b.id) }, execAs(m.b))
      const passed = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: '同队借道' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(passed?.ok).toBe(true)
      expect(m.b.steerCalls).toHaveLength(1)
    } finally {
      await m.dispose()
    }
  }, 20_000)
})

describe('W2: canvas membership is a first-class admission basis', () => {
  it('same-host canvas teammates pass without a roster line', async () => {
    const m = await mountTwoSessions({ teamJoinAllowlist: ['dsh/ops'] })
    try {
      expect((await postJson(m.port, '/__dsh_a2a/join', { id: String(m.a.id) })).status).toBe(200)
      expect((await postJson(m.port, '/__dsh_a2a/join', { id: String(m.b.id) })).status).toBe(200)
      await m.ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/ops', id: String(m.b.id) }, execAs(m.b))
      // No roster line for a — but BOTH sessions sit in one canvas team:
      // membership is a link record (W2②). Composition rides the
      // workbench's own seam (the add-member control action).
      for (const id of [String(m.a.id), String(m.b.id)]) {
        const saved = await postJson(m.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'pair', id })
        expect(saved.status).toBe(200)
        expect((await saved.json() as { ok?: boolean }).ok).toBe(true)
      }
      const routed = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: 'canvas 同队' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(routed?.ok).toBe(true)
      expect(m.b.steerCalls).toHaveLength(1)
    } finally {
      await m.dispose()
    }
  }, 20_000)
})
