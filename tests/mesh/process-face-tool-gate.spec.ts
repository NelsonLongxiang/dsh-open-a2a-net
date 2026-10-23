// @vitest-environment node
/**
 * Owner ruling: the PROCESS face (bare zone) keeps its host-level EXEMPTION
 * on the admission layer — receipts, quick dispatch, host-side routing still
 * target it internally — but a MODEL TOOL call must not address it. Pins:
 *   ① the a2a_route tool refuses bare-zone targets from an agent session,
 *     with guidance toward a member face;
 *   ② the HOST face (agent-less control route) still reaches the process
 *     face — the exemption lives where the ruling put it;
 *   ③ member-face targets (session handles) are unaffected.
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

class FakeAgentsService extends Service {
  map = new Map<string, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return [...this.map.values()]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.map.get(String(id))
  }
}

interface RelayAgent extends Agent { steerCalls: unknown[]; host?: Context }

function makeAgent(id: string, name: string): RelayAgent {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title: name },
    steerCalls: [] as unknown[],
    steer(payload: unknown): void {
      agent.steerCalls.push(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `answered ${name}` }] } } })
      agent.host?.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as RelayAgent
  return agent
}

interface Mounted { ctx: Context; port: number; a: RelayAgent; b: RelayAgent; dispose: () => Promise<void> }

async function mount(): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-procgate-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const a = makeAgent('session-aaaaaaaa11111111', '席位-A')
  const b = makeAgent('session-bbbbbbbb22222222', '席位-B')
  for (const agent of [a, b]) { agents.map.set(String(agent.id), agent); agent.host = ctx }
  apply(ctx, {
    apiKey: '',
    session: 'host-procgate',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'procgate-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    cardTtlMs: 172_800_000,
    teamJoinAllowlist: ['*'],
  } as Config)
  for (const agent of [a, b]) ctx.emit('agent/created', { agent: agent as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const post = async (path: string, body: unknown): Promise<Response> => await globalThis.fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  for (const agent of [a, b]) expect((await post('/__dsh_a2a/join', { id: String(agent.id) })).status).toBe(200)
  expect((await post('/__dsh_a2a/canvas', { action: 'add-member', name: 'team-x', id: String(a.id) })).status).toBe(200)
  expect((await post('/__dsh_a2a/canvas', { action: 'add-member', name: 'team-x', id: String(b.id) })).status).toBe(200)
  return { ctx, port, a, b, dispose: async () => { await ctx.fiber.dispose() } }
}

const execAs = (agent: Agent) => ({ signal: new AbortController().signal, agent }) as never

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('tool-layer interception on the process face', () => {
  it('① a model tool call to the bare zone is refused with member-face guidance', async () => {
    const m = await mount()
    try {
      const refused = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh', message: '直达宿主' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(refused?.ok).toBe(false)
      expect(String(refused?.error)).toContain('process face')
      expect(String(refused?.error)).toContain('member face')
      // Nothing was steered anywhere: the gate sits before any dispatch.
      expect(m.b.steerCalls).toHaveLength(0)
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('② ③ the exemption stays at the host face — a member-face target routes normally', async () => {
    const m = await mount()
    try {
      // ③ member face (session handle): passes.
      const routed = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: '组员面' }, execAs(m.a)) as { ok: boolean }
      expect(routed?.ok).toBe(true)
      expect(m.b.steerCalls.length).toBeGreaterThan(0)
    } finally {
      await m.dispose()
    }
  }, 20_000)
})
