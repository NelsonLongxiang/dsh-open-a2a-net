/**
 * Canvas team routing integration: multi-member teams route to the first
 * live member, fail over to the next member, wake the first cold joined
 * member through the apiProxy wake face, list as local rows in a2a_teams,
 * surface in the state route, and keep join-gate semantics (membership
 * requires join; leave drops membership).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'

/** Registry holding several named fake agents (canvas needs >= 2 members). */
class FakeMultiAgents extends Service {
  readonly agents: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.agents] }
  get(id: Agent['id']): Agent | undefined { return this.agents.find(a => a.id === id) }
}

/** Fake wake face: records materialization ids, resolves the cold agent. */
class FakeApiProxy extends Service {
  materialized: string[] = []
  private readonly resolve: (agent: Agent) => void
  constructor(ctx: Context, resolve: (agent: Agent) => void) {
    super(ctx, 'apiProxy')
    this.resolve = resolve
  }
  materializeSession(id: SessionId): Promise<Agent> {
    this.materialized.push(String(id))
    return Promise.resolve(this.resolve(String(id)))
  }
}

function makeAgent(id: string, events: unknown[]): Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } } {
  return {
    id: SessionId(id),
    session: { events },
    steer: vi.fn(),
  } as unknown as Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } }
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'a2a-canvas-route-'))
}

type Mounted = {
  ctx: Context
  agents: FakeMultiAgents
  port: number
  home: string
  dispose: () => Promise<void>
}

async function mount(seeds: { joined?: string[]; canvas?: Array<{ name: string; members: string[] }> } = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeMultiAgents(ctx)
  const home = tmpHome()
  if ((seeds.joined?.length ?? 0) > 0 || (seeds.canvas?.length ?? 0) > 0) {
    mkdirSync(join(home, 'a2a'), { recursive: true })
    if ((seeds.joined?.length ?? 0) > 0) writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: seeds.joined }), 'utf8')
    if ((seeds.canvas?.length ?? 0) > 0) writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: seeds.canvas }), 'utf8')
  }
  apply(ctx, {
    apiKey: '',
    session: 'canvas-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'canvas node',
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
    dshHome: home,
    cardTtlMs: 172_800_000,
  } satisfies Config)
  return {
    ctx,
    agents,
    port: (ctx as unknown as { webServer: WebServer }).webServer.port,
    home,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const postJson = (port: number, path: string, body: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${String(port)}${path}`, { method: 'POST', body: JSON.stringify(body) })

/** A steer that answers: pushes an assistant event and goes idle. */
function answering(ctx: Context, agent: Agent & { session: { events: unknown[] } }): ReturnType<typeof vi.fn> {
  const steer = vi.fn(() => {
    ;(agent.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'canvas member replied' }] } } })
    ctx.emit('agent/status', { agent, status: 'idle' })
  })
  ;(agent as unknown as { steer: unknown }).steer = steer
  return steer
}

const noAgent = (): ToolRunContext => ({ signal: new AbortController().signal } as unknown as ToolRunContext)

/** Register an agent with the harness the way the host would: roots entry
 * plus the agent/created event that feeds the plugin's liveRoots map. */
function goLive(m: { ctx: Context; agents: FakeMultiAgents }, ...agents: Agent[]): void {
  for (const agent of agents) {
    m.agents.agents.push(agent)
    m.ctx.emit('agent/created', { agent })
  }
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
})

describe('canvas team routing', () => {
  it('routes to the first live member; member order is the priority', async () => {
    const m = await mount({ joined: ['session-aaa', 'session-bbb'], canvas: [{ name: 'alpha', members: ['session-aaa', 'session-bbb'] }] })
    mounted.push(m.dispose)
    const eventsA: unknown[] = []
    const eventsB: unknown[] = []
    const a = makeAgent('session-aaa', eventsA)
    const b = makeAgent('session-bbb', eventsB)
    answering(m.ctx, a)
    answering(m.ctx, b)
    goLive(m, a, b)
    // Both join live: the join route mounts session nodes for both ids.
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-bbb' })
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/alpha', message: 'to the canvas' }, noAgent()) as { ok: boolean; reply?: string }
    expect(result.ok).toBe(true)
    expect(a.steer).toHaveBeenCalledTimes(1)
    expect(b.steer).not.toHaveBeenCalled()
    const steered = (a.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
    expect(steered?.text).toContain('routed to dsh/canvas/alpha')
  })

  it('fails over to the next member after remove-member', async () => {
    const m = await mount({ joined: ['session-aaa', 'session-bbb'], canvas: [{ name: 'alpha', members: ['session-aaa', 'session-bbb'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaa', [])
    const b = makeAgent('session-bbb', [])
    answering(m.ctx, a)
    answering(m.ctx, b)
    goLive(m, a, b)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-bbb' })
    await postJson(m.port, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'alpha', id: 'session-aaa' })
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/alpha', message: 'failover' }, noAgent()) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(b.steer).toHaveBeenCalledTimes(1)
    expect(a.steer).not.toHaveBeenCalled()
  })

  it('wakes the first cold joined member through the wake face', async () => {
    const m = await mount({ joined: ['session-cold1', 'session-cold2'], canvas: [{ name: 'beta', members: ['session-cold1', 'session-cold2'] }] })
    mounted.push(m.dispose)
    const coldEvents: unknown[] = []
    const cold1 = makeAgent('session-cold1', coldEvents)
    answering(m.ctx, cold1)
    // The wake face resolves whichever id it is asked for; only cold1 is a
    // member candidate that materializes into a live root.
    const proxy = new FakeApiProxy(m.ctx, (id: string) => {
      if (id === 'session-cold1') return cold1
      throw new Error('unexpected wake target')
    })
    void proxy
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/beta', message: 'cold wake' }, noAgent()) as { ok: boolean; reply?: string }
    expect(result.ok).toBe(true)
    expect(proxy.materialized).toEqual(['session-cold1'])
    expect(cold1.steer).toHaveBeenCalledTimes(1)
  })

  it('lists canvas teams as local rows with member counts', async () => {
    const m = await mount({ joined: ['session-aaa'], canvas: [{ name: 'alpha', members: ['session-aaa'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaa', [])
    answering(m.ctx, a)
    goLive(m, a)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    const teams = m.ctx.tools.get('a2a_teams')
    const result = await teams!.execute({}, noAgent()) as { ok: boolean; teams: Array<{ team: string; description: string; local?: boolean }> }
    const row = result.teams.find(t => t.team === 'dsh/canvas/alpha')
    expect(row).toBeDefined()
    expect(row!.local).toBe(true)
    expect(row!.description).toContain('1 member')
    expect(row!.description).toContain('1 live')
  })

  it('add-member rejects an unjoined session id', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const res = await postJson(m.port, '/__dsh_a2a/canvas', { action: 'create', name: 'gamma' })
    expect(await res.json()).toMatchObject({ ok: true, name: 'gamma' })
    const bad = await postJson(m.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'gamma', id: 'session-never-joined' })
    expect(await bad.json()).toMatchObject({ ok: false })
  })

  it('leave drops canvas membership everywhere', async () => {
    const m = await mount({ joined: ['session-aaa'], canvas: [{ name: 'alpha', members: ['session-aaa'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaa', [])
    answering(m.ctx, a)
    goLive(m, a)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    await postJson(m.port, '/__dsh_a2a/leave', { id: 'session-aaa' })
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { canvas: { teams: Array<{ name: string; members: string[] }> } }
    const alpha = state.canvas.teams.find(t => t.name === 'alpha')
    expect(alpha?.members).toEqual([])
  })

  it('the state route serves canvas teams with per-member joined/live flags', async () => {
    const m = await mount({ joined: ['session-aaa', 'session-cold1'], canvas: [{ name: 'alpha', members: ['session-aaa', 'session-cold1'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaa', [])
    answering(m.ctx, a)
    goLive(m, a)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { canvas: { teams: Array<{ name: string; members: Array<{ id: string; joined: boolean; live: boolean }> }> } }
    const alpha = state.canvas.teams.find(t => t.name === 'alpha')
    expect(alpha).toBeDefined()
    expect(alpha!.members).toEqual([
      { id: 'session-aaa', team: 'dsh/aaa', joined: true, live: true },
      { id: 'session-cold1', team: 'dsh/cold1', joined: true, live: false },
    ])
  })

  it('a route to a canvas team with no member at all fails honestly', async () => {
    const m = await mount({ canvas: [{ name: 'empty', members: [] }] })
    mounted.push(m.dispose)
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/empty', message: 'nobody home' }, noAgent()) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
  })
})
