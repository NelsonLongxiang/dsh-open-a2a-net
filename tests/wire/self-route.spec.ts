import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, type Config } from '../../src/index.ts'

/**
 * Self-route refusal: a joined session routing to the BARE process team is
 * the shape that used to fake delivery. The live (initiator) fallback
 * resolves to the routing session itself, so the dispatch echoed home and
 * the receipt autosend synthesized a `[A2A receipt] ... (auto)` for work
 * nobody did — the ledger settled on a hallucination (live incident
 * direct-5d9511fc on the monitor session). These tests pin the refusal on
 * every dispatch face and the control that keeps honest traffic flowing.
 */

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): Agent {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agent !== undefined && this.agent.id === id ? this.agent : undefined
  }
}

function makeAgent(id: string): Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } } {
  return {
    id: SessionId(id),
    session: { events: [] },
    steer: vi.fn(),
  } as unknown as Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } }
}

/** A live agent that answers a steer with one final reply, then goes idle. */
function replyingAgent(ctx: Context, id: string): Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } } {
  const agent = makeAgent(id)
  agent.steer = vi.fn(() => {
    ;(agent.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'peer node replied' }] } } })
    ctx.emit('agent/status', { agent, status: 'idle' })
  }) as typeof agent.steer
  return agent
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'sess-1',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'test node',
    peers: [],
    delegates: [],
    peerAllowlist: [],
    referralLearning: true,
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

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-a2a-key-'))
}

function runContext(agent?: Agent): ToolRunContext {
  return { signal: new AbortController().signal, ...(agent !== undefined ? { agent } : {}) } as unknown as ToolRunContext
}

async function mountHarness(): Promise<{ ctx: Context; agents: FakeAgentsService; port: number }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  apply(ctx, makeConfig({ sessionNodes: true, dshHome: tmpHome() }))
  return { ctx, agents, port: (ctx as unknown as { webServer: WebServer }).webServer.port }
}

const postJson = (port: number, path: string, body: unknown): Promise<Response> =>
  globalThis.fetch(`http://127.0.0.1:${String(port)}${path}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a2a self-route refusal (bare team resolves to the routing session itself)', () => {
  it('a joined session routing to the bare team is refused, not echoed home', async () => {
    const { ctx, agents, port } = await mountHarness()
    try {
      const session = replyingAgent(ctx, 'agent-1')
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      // The caller IS agent-1 (joined, live, initiator fallback target).
      const result = await route?.execute({ team: 'dsh', message: 'route to the process team myself' }, runContext(session)) as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      // Owner ruling (tool-layer interception): the bare process face is
      // refused at the TOOL seam before the self-route guard runs — the
      // guarantee under test (refused, no echo) is unchanged; the deeper
      // self-route guard keeps covering the host/inner dispatch paths.
      expect(String(result.error)).toMatch(/process face|Self-route refused/)
      // No echo: nothing was steered anywhere.
      expect(session.steer).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a caller the live agent does not name still delivers through the bare-team fallback', async () => {
    const { ctx, agents, port } = await mountHarness()
    try {
      const session = replyingAgent(ctx, 'agent-1')
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      // No agent in the run context: the caller label is the session label
      // ('sess-1'), which does not name the live agent — honest traffic.
      const result = await route?.execute({ team: 'dsh', message: 'host-face hello' }, runContext()) as { ok: boolean; reply?: string }
      expect(result).toMatchObject({ ok: true, reply: 'peer node replied' })
      expect(session.steer).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('async dispatch refuses the self-route shape and owes no receipt', async () => {
    const { ctx, agents, port } = await mountHarness()
    try {
      const session = replyingAgent(ctx, 'agent-1')
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'dsh', message: 'async dispatch to myself', async: true }, runContext(session)) as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      expect(String(result.error)).toMatch(/process face|Self-route refused/)
      expect(session.steer).not.toHaveBeenCalled()
      // The ledger owes nothing: a refused dispatch must not register a
      // pending row that could later dead-letter as a ghost debt.
      const tasks = await ctx.tools.get('a2a_tasks')?.execute({}, runContext()) as { ok: boolean; pending?: unknown[] }
      expect(tasks.ok).toBe(true)
      expect((tasks.pending ?? []).length).toBe(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
