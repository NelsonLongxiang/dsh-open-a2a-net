/**
 * Canvas team routing integration: multi-member teams route to the first
 * live member, fail over to the next member, wake the first cold joined
 * member through the sessionController wake face, list as local rows in a2a_teams,
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
import { apply, type Config } from '../../src/index.ts'

/** Registry holding several named fake agents (canvas needs >= 2 members). */
class FakeMultiAgents extends Service {
  readonly agents: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.agents] }
  get(id: Agent['id']): Agent | undefined { return this.agents.find(a => a.id === id) }
}

/** Fake wake face: records resolution ids, resolves the cold agent. */
class FakeSessionController extends Service {
  materialized: string[] = []
  private readonly resolve: (id: string) => Agent
  constructor(ctx: Context, resolve: (id: string) => Agent) {
    super(ctx, 'sessionController')
    this.resolve = resolve
  }
  resolveAgent(id: SessionId): Promise<{ agent: Agent }> {
    this.materialized.push(String(id))
    return Promise.resolve({ agent: this.resolve(String(id)) })
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

async function mount(seeds: { joined?: string[]; canvas?: Array<{ name: string; members: string[] }> } = {}, overrides: Partial<Config> = {}): Promise<Mounted> {
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
    ...overrides,
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

  it('a joined session routing through the local candidate is recorded as its own seat (#121)', async () => {
    const m = await mount({ joined: ['session-aaaa1111', 'session-bbbb2222'], canvas: [{ name: 'alpha', members: ['session-aaaa1111', 'session-bbbb2222'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaaa1111', [])
    const b = makeAgent('session-bbbb2222', [])
    answering(m.ctx, a)
    answering(m.ctx, b)
    goLive(m, a, b)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaaa1111' })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-bbbb2222' })
    // A routes async to its own canvas team: the live tier skips the
    // initiating member (issue #41) and steers B in-process.
    const result = await m.ctx.tools.get('a2a_route')!.execute(
      { team: 'dsh/canvas/alpha', message: 'local seat check', async: true },
      { signal: new AbortController().signal, agent: a } as unknown as ToolRunContext,
    ) as { ok: boolean; task_id?: string; task_status?: string }
    expect(result.ok).toBe(true)
    expect(result.task_status).toBe('TASK_STATE_DELIVERED')
    expect(b.steer).toHaveBeenCalledTimes(1)
    expect(a.steer).not.toHaveBeenCalled()
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { tasks: Array<{ taskId: string; peer: string; sender?: unknown }> }
    const row = state.tasks.find(task => task.taskId === result.task_id)
    expect(row?.peer).toBe('local')
    expect(row?.sender).toEqual({ kind: 'session', id: 'dsh/aaaa1111' })
  })

  it('a local auto-receipt from a row without auth names onBehalfOf and omits authRef (#123)', async () => {
    const m = await mount({ joined: ['session-aaaa1111', 'session-bbbb2222'], canvas: [{ name: 'alpha', members: ['session-aaaa1111', 'session-bbbb2222'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaaa1111', [])
    const b = makeAgent('session-bbbb2222', [])
    // B plays a real turn: the session log records the steer it consumed,
    // then the turn answers and goes idle.
    // The turn runs after the steer call returns, as a real driver's does.
    ;(b as unknown as { steer: unknown }).steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      setTimeout(() => {
        b.session.events.push({ type: 'user/message', data: { content: message.content } })
        b.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'local work done' }] } } })
        m.ctx.emit('agent/status', { agent: b, status: 'idle' })
      }, 10)
    })
    goLive(m, a, b)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaaa1111' })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-bbbb2222' })
    const result = await m.ctx.tools.get('a2a_route')!.execute(
      { team: 'dsh/canvas/alpha', message: 'local receipt check', async: true },
      { signal: new AbortController().signal, agent: a } as unknown as ToolRunContext,
    ) as { ok: boolean; task_id?: string }
    expect(result.ok).toBe(true)
    // The receipt rides the in-process candidate back to A's node team,
    // framed by the local steer header like any delivery.
    const header = `[A2A receipt] task ${String(result.task_id)} `
    const receiptText = (): string | undefined => {
      const framed = a.steer.mock.calls
        .map(call => ((call[0] as { content: Array<{ text?: string }> }).content[0]?.text ?? ''))
        .find(text => text.includes(header))
      return framed === undefined ? undefined : framed.slice(framed.indexOf(header))
    }
    for (let i = 0; i < 25 && receiptText() === undefined; i++) await new Promise(resolve => { setTimeout(resolve, 20) })
    const text = receiptText()
    expect(text).toContain('local work done (auto)')
    // The local path births no inbound authorization record: no authRef.
    const envelope = JSON.parse(String(text).split('\n')[1] ?? '{}') as Record<string, unknown>
    expect(envelope).toEqual({ outcome: 'completed', idempotencyKey: result.task_id, onBehalfOf: 'dsh/bbbb2222' })
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
    const proxy = new FakeSessionController(m.ctx, (id: string) => {
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

  it('a file-seeded unjoined member never wakes or steers — direct canvas.json edits cannot mint routable membership', async () => {
    // External tamper: canvas.json names a session that never joined. The
    // join-gate consent invariant must hold by construction: no live node,
    // no remembered intent, no wake face call, no steer.
    const m = await mount({ canvas: [{ name: 'alpha', members: ['session-never-joined'] }] })
    mounted.push(m.dispose)
    const coldEvents: unknown[] = []
    const ghost = makeAgent('session-never-joined', coldEvents)
    answering(m.ctx, ghost)
    const proxy = new FakeSessionController(m.ctx, () => ghost)
    void proxy
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/alpha', message: 'bypass attempt' }, noAgent()) as { ok: boolean }
    expect(result.ok).toBe(false)
    expect(proxy.materialized).toEqual([])
    expect(ghost.steer).not.toHaveBeenCalled()
  })

  it('the state poll prunes canvas members without a live node or join intent', async () => {
    // canvas.json carries ids whose join state is gone (intent removed,
    // file edited between restarts). The poll sweep drops them.
    const m = await mount({ joined: ['session-aaa'], canvas: [{ name: 'alpha', members: ['session-aaa', 'session-stale1'] }] })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaa', [])
    answering(m.ctx, a)
    goLive(m, a)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    await postJson(m.port, '/__dsh_a2a/leave', { id: 'session-aaa' })
    // session-aaa left (intent gone); session-stale1 never had one.
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { canvas: { teams: Array<{ name: string; members: string[] }> } }
    const alpha = state.canvas.teams.find(t => t.name === 'alpha')
    expect(alpha?.members).toEqual([])
  })
})

/**
 * #124 (#114 S6): an allowlist change re-judges unsettled inbound tasks and
 * records the affected ones — observe only. Removing the caller from the
 * shared canvas leaves its in-flight task `would-revoke`, while no ledger row
 * changes and nothing is cancelled, nudged or blocked.
 */
describe('#114 S6 affected tasks on a canvas change', () => {
  type StateView = {
    tasks: Array<Record<string, unknown>>
    tasksDead: Array<Record<string, unknown>>
    archived: Array<Record<string, unknown>>
    authorization: {
      version: string
      history: Array<{ version: string; cause: string }>
      affected: Array<{ from_version: string | null; to_version: string; cause: string; tasks: Array<{ taskId: string; direction: string; caller: string; target: string; verdict: string; reason: string }> }>
    }
  }
  const state = async (port: number): Promise<StateView> => (await (await fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json()) as StateView

  async function seated(): Promise<{ m: Mounted; a: ReturnType<typeof makeAgent>; b: ReturnType<typeof makeAgent>; taskId: string }> {
    // Team-scoped admission on, as the production default: the record must
    // name a real rule for a change to be able to revoke it.
    const m = await mount({ joined: ['session-aaaa1111', 'session-bbbb2222'], canvas: [{ name: 'ops', members: ['session-aaaa1111', 'session-bbbb2222'] }] }, { teamScopeRouting: true })
    mounted.push(m.dispose)
    const a = makeAgent('session-aaaa1111', [])
    const b = makeAgent('session-bbbb2222', [])
    goLive(m, a, b)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaaa1111' })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-bbbb2222' })
    // A delivers to B through the wire face: admitted as a canvas member.
    const res = await postJson(m.port, '/a2a/direct', { team: 'dsh/bbbb2222', message: 'please review', caller_session: 'dsh/aaaa1111', wait: false })
    const body = await res.json() as { delivered?: boolean; task_id?: string; error?: string }
    expect(body.error).toBeUndefined()
    expect(body.delivered).toBe(true)
    const born = (await state(m.port)).tasks.find(task => task.taskId === body.task_id) as { auth?: { via?: string; basis?: string[] } } | undefined
    expect(born?.auth).toMatchObject({ via: 'canvas-member', basis: ['dsh/canvas/ops'] })
    return { m, a, b, taskId: String(body.task_id) }
  }

  it('removing the caller from the canvas records a would-revoke entry, and no row changes', async () => {
    const { m, b, taskId } = await seated()
    const before = await state(m.port)
    const row = before.tasks.find(task => task.taskId === taskId)
    expect(row?.direction).toBe('inbound')
    expect(before.authorization.affected).toEqual([])
    const steersBefore = b.steer.mock.calls.length

    const removed = await postJson(m.port, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: 'session-aaaa1111' })
    expect((await removed.json() as { ok?: boolean }).ok).toBe(true)

    const after = await state(m.port)
    expect(after.authorization.version).not.toBe(before.authorization.version)
    expect(after.authorization.history[0]?.cause).toBe('canvas')
    const entry = after.authorization.affected[0]
    expect(entry).toMatchObject({ from_version: before.authorization.version, to_version: after.authorization.version, cause: 'canvas' })
    expect(entry?.tasks).toEqual([{
      taskId, direction: 'inbound', caller: 'dsh/aaaa1111', target: 'dsh/bbbb2222', verdict: 'would-revoke',
      reason: expect.stringContaining('caller "dsh/aaaa1111"') as unknown as string,
    }])
    // Observe only: every ledger row is exactly as it was, nothing archived,
    // nothing dead-lettered, and the target was not steered again.
    expect(after.tasks).toEqual(before.tasks)
    expect(after.tasksDead).toEqual(before.tasksDead)
    expect(after.archived).toEqual(before.archived)
    expect(b.steer.mock.calls.length).toBe(steersBefore)
  })

  it('an unchanged allowlist produces no entries however often it is read', async () => {
    const { m } = await seated()
    const first = await state(m.port)
    for (let i = 0; i < 3; i++) {
      const again = await state(m.port)
      expect(again.authorization.version).toBe(first.authorization.version)
      expect(again.authorization.affected).toEqual([])
      expect(again.authorization.history).toEqual(first.authorization.history)
    }
    // A write that changes nothing the admission reads (a duplicate add) moves nothing either.
    await postJson(m.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'session-bbbb2222' })
    expect((await state(m.port)).authorization.affected).toEqual([])
  })

  it('a change that keeps the caller admitted on the same canvas lists nothing', async () => {
    const { m } = await seated()
    // A third member joins the canvas: the version moves, but A and B still share ops.
    const c = makeAgent('session-cccc3333', [])
    goLive(m, c)
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-cccc3333' })
    await postJson(m.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'session-cccc3333' })
    const view = await state(m.port)
    expect(view.authorization.history.length).toBeGreaterThan(1)
    expect(view.authorization.affected).toEqual([])
  })
  it('#138 R3: one /leave gesture (three store writes) lists the task once', async () => {
    const { m, taskId } = await seated()
    await postJson(m.port, '/__dsh_a2a/leave', { id: 'session-aaaa1111' })
    const after = await state(m.port)
    expect(after.authorization.history.length).toBeGreaterThan(2)
    expect(after.authorization.affected.filter(entry => entry.tasks.some(task => task.taskId === taskId))).toHaveLength(1)
  })

  it('#138 R3: an unrelated later change does not list an already-reported task again', async () => {
    const { m, taskId } = await seated()
    await postJson(m.port, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: 'session-aaaa1111' })
    expect((await state(m.port)).authorization.affected).toHaveLength(1)
    const before = (await state(m.port)).authorization.version
    await postJson(m.port, '/__dsh_a2a/canvas', { action: 'create', name: 'unrelated' })
    const after = await state(m.port)
    expect(after.authorization.version).not.toBe(before)
    expect(after.authorization.affected.filter(entry => entry.tasks.some(task => task.taskId === taskId))).toHaveLength(1)
  })
})
