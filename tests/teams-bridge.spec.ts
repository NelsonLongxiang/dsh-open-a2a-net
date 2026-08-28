/**
 * Native-teams bridge (P1): the outbound transport face mounted under the
 * frozen `nativeTeamsA2a` service key (resolve via the peer directory, sync/
 * async submit over the direct-route dispatcher, owed-ledger tracking), and
 * the opt-in inbound bridge (a registry-claimed local team dispatches
 * through the sibling's authoritative routing seam; off by default; the
 * bridge declines ambiguous claims; wait:false fires detached).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'
import { signCard } from '../src/card.ts'
import { NATIVE_TEAMS_A2A_FACE_KEY } from '../src/teams-bridge.ts'

/** Registry whose initiator requirement resolves to the first agent. */
class FakeInitiatorAgents extends Service {
  readonly agents: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent {
    const first = this.agents[0]
    if (first === undefined) throw new Error('no initiator in this fiber')
    return first
  }
  roots(): Agent[] { return [...this.agents] }
  get(id: Agent['id']): Agent | undefined { return this.agents.find(a => a.id === id) }
}

/** Structural fake of the sibling TeamsRegistry surface the bridge probes. */
class FakeTeamsRegistry extends Service {
  /** team name → descriptor fragment; names outside the map classify remote. */
  readonly claims = new Map<string, { plane: 'local' | 'a2a'; ambiguous?: boolean; localLabel?: string }>()
  readonly rounds: Array<{ args: { team?: string; message: string }; parentId: string }> = []
  answer = 'round done'
  fail = false
  hang = false
  constructor(ctx: Context) { super(ctx, 'teams') }
  listTeams(): Array<{ name: string; description: string }> {
    return [...this.claims.keys()].map(name => ({ name, description: `team ${name}` }))
  }
  async describeTarget(handle: string): Promise<{ plane: 'local' | 'a2a'; handle: string; pinned: boolean; ambiguous?: boolean; localLabel?: string }> {
    const claim = this.claims.get(handle)
    if (claim === undefined) return { plane: 'a2a', handle, pinned: false }
    return { handle, pinned: false, ...claim }
  }
  async startRound(args: { team?: string; message: string }, parent: { id: string; session: { events: readonly unknown[] } }): Promise<string> {
    this.rounds.push({ args, parentId: String(parent.id) })
    if (this.hang) return new Promise<string>(() => {})
    if (this.fail) throw new Error('the round failed')
    return this.answer
  }
}

function makeAgent(id: string): Agent {
  return { id: SessionId(id), session: { events: [] }, steer: vi.fn() } as unknown as Agent
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'a2a-teams-bridge-'))
}

/** One real loopback peer: a verified signed card plus an echoing direct route. */
async function startPeer(options: { session?: string; asyncCap?: boolean; direct?: (body: Record<string, unknown>) => { readonly status: number; readonly payload: Record<string, unknown> } } = {}): Promise<{ url: string; seen: Array<Record<string, unknown>>; close: () => Promise<void> }> {
  const { privateKey } = generateKeyPairSync('ed25519')
  const session = options.session ?? 'peer-node'
  const card = signCard({
    name: 'peer node',
    session,
    team: 'peer-team',
    capabilities: { route: true, ...(options.asyncCap === true ? { async: true } : {}) },
    expiresAt: Date.now() + 3_600_000,
  }, privateKey)
  const seen: Array<Record<string, unknown>> = []
  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/agent-card.json') {
      const body = JSON.stringify(card)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (req.url === '/a2a/direct') {
      let raw = ''
      req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
      req.on('end', () => {
        const body = JSON.parse(raw) as Record<string, unknown>
        seen.push(body)
        let status = 200
        let payload: string
        if (options.direct !== undefined) {
          const overridden = options.direct(body)
          status = overridden.status
          payload = JSON.stringify(overridden.payload)
        } else if (body.wait === false) {
          payload = JSON.stringify({ routed: true, delivered: true, team: body.team, session, task_id: body.task_id, context_id: 'ctx-peer', task_status: 'TASK_STATE_DELIVERED' })
        } else {
          payload = JSON.stringify({ routed: true, team: body.team, session, result: { text: 'peer says hi' }, task_id: body.task_id, context_id: 'ctx-peer', task_status: 'TASK_STATE_COMPLETED' })
        }
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const port = String((server.address() as AddressInfo).port)
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: async () => { await new Promise<void>((resolve, reject) => { server.close(() => resolve()); server.on('error', reject) }) },
  }
}

type Mounted = {
  ctx: Context
  registry: FakeTeamsRegistry
  agents: FakeInitiatorAgents
  port: number
  home: string
  face: () => unknown
  dispose: () => Promise<void>
}

async function mount(options: { peers?: string[]; nativeTeamsInbound?: boolean; nativeRoundWaitMs?: number; announce?: boolean; joined?: string[] } = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeInitiatorAgents(ctx)
  const registry = new FakeTeamsRegistry(ctx)
  const home = tmpHome()
  if ((options.joined?.length ?? 0) > 0) {
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: options.joined }), 'utf8')
  }
  apply(ctx, {
    apiKey: '',
    session: 'bridge-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: options.announce === true,
    agentName: 'bridge node',
    peers: options.peers ?? [],
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
    nativeTeamsInbound: options.nativeTeamsInbound,
    nativeRoundWaitMs: options.nativeRoundWaitMs,
  } satisfies Config)
  return {
    ctx,
    registry,
    agents,
    port: (ctx as unknown as { webServer: WebServer }).webServer.port,
    home,
    face: () => (ctx as unknown as { get(name: string): unknown }).get(NATIVE_TEAMS_A2A_FACE_KEY),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const postJson = (port: number, path: string, body: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${String(port)}${path}`, { method: 'POST', body: JSON.stringify(body) })

const noAgent = (): ToolRunContext => ({ signal: new AbortController().signal } as unknown as ToolRunContext)

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
})

describe('outbound nativeTeamsA2a face', () => {
  it('mounts under the frozen service key and resolves a tracked peer team', async () => {
    const peer = await startPeer()
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { resolve: (handle: string) => Promise<{ kind: string; hops: number; url?: string } | undefined> }
    expect(face).toBeDefined()
    const info = await face.resolve('peer-team')
    expect(info).toMatchObject({ kind: 'node', hops: 1, url: peer.url })
    expect(await face.resolve('never-published')).toBeUndefined()
  })

  it('submit sync maps the peer final reply to the completed shape', async () => {
    const peer = await startPeer()
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    const outcome = await face.submit({ handle: 'peer-team', message: 'hello peer', delivery: 'sync', idempotencyKey: 'wb-1' })
    expect(outcome).toMatchObject({ kind: 'completed', text: 'peer says hi', taskId: 'wb-1', contextId: 'ctx-peer' })
    expect(peer.seen[0]).toMatchObject({ team: 'peer-team', task_id: 'wb-1' })
  })

  it('submit async against an async-capable peer returns accepted and tracks the owed task', async () => {
    const peer = await startPeer({ asyncCap: true })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    const outcome = await face.submit({ handle: 'peer-team', message: 'long job', delivery: 'async', idempotencyKey: 'wb-2' })
    expect(outcome).toMatchObject({ kind: 'accepted', taskId: 'wb-2', contextId: 'ctx-peer' })
    expect(peer.seen[0]).toMatchObject({ wait: false })
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { tasks: Array<{ taskId: string }> }
    expect(state.tasks.map(task => task.taskId)).toContain('wb-2')
  })

  it('submit async without a declared async capability waits sync instead of silently degrading', async () => {
    const peer = await startPeer({ asyncCap: false })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    const outcome = await face.submit({ handle: 'peer-team', message: 'careful job', delivery: 'async', idempotencyKey: 'wb-3' })
    expect(peer.seen[0]).toMatchObject({ team: 'peer-team' })
    expect(peer.seen[0]).not.toHaveProperty('wait')
    expect(outcome.kind).toBe('completed')
  })

  it('submit throws the honest exhaustion error when no peer publishes the handle', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    await expect(face.submit({ handle: 'nowhere-team', message: 'x', delivery: 'sync' })).rejects.toThrow('nowhere-team')
  })
})

describe('inbound native-teams bridge', () => {
  it('a registry-claimed local team dispatches through the sibling seam, parented by the initiator', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const res = await postJson(m.port, '/a2a/direct', { team: 'freight-team', message: 'ship it', caller_session: 'peer-x' })
    const body = await res.json() as { result?: { text?: string }; error?: string }
    expect(body.result?.text).toBe('round done')
    expect(m.registry.rounds).toHaveLength(1)
    const round = m.registry.rounds[0]!
    expect(round.args.team).toBe('freight-team')
    expect(round.args.message).toContain('[A2A direct]')
    expect(round.args.message).toContain('from "peer-x"')
    expect(round.args.message).toContain('ship it')
    expect(round.parentId).toBe('session-main1')
  })

  it('the bridge is off by default: the same route falls through to the standard miss', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const res = await postJson(m.port, '/a2a/direct', { team: 'freight-team', message: 'ship it', caller_session: 'peer-x' })
    const body = await res.json() as { error?: string }
    expect(body.error).toContain('No live DSH session node accepts team "freight-team"')
    expect(m.registry.rounds).toHaveLength(0)
  })

  it('an ambiguous local claim declines the bridge (B4 hard-reject stays with native-teams)', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('contested', { plane: 'local', ambiguous: true, localLabel: 'team' })
    const res = await postJson(m.port, '/a2a/direct', { team: 'contested', message: 'x', caller_session: 'peer-x' })
    const body = await res.json() as { error?: string }
    expect(body.error).toContain('No live DSH session node accepts team "contested"')
    expect(m.registry.rounds).toHaveLength(0)
  })

  it('a failed round surfaces the sibling error honestly', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    m.registry.fail = true
    const res = await postJson(m.port, '/a2a/direct', { team: 'freight-team', message: 'x', caller_session: 'peer-x' })
    const body = await res.json() as { error?: string }
    expect(body.error).toContain('the native-teams round for "freight-team" failed')
  })

  it('a claimed bare team name bridges on the async path too — claim beats the initiator redirect regardless of wait semantics', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steers: string[] = []
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      steers.push(message.content.find(block => block.type === 'text')?.text ?? '')
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    m.registry.claims.set('dsh', { plane: 'local', localLabel: 'team' })
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh', message: 'bare claimed', async: true }, noAgent()) as { ok: boolean; bridge?: string }
    expect(result.ok).toBe(true)
    expect(result.bridge).toBe('native-teams')
    expect(m.registry.rounds).toHaveLength(1)
    expect(m.registry.rounds[0]!.args.team).toBe('dsh')
    expect(steers).toHaveLength(0)
  })

  it('wait:false to a native team fires the round detached and answers delivered', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const res = await postJson(m.port, '/a2a/direct', { team: 'freight-team', message: 'async ship', caller_session: 'peer-x', wait: false })
    const body = await res.json() as { delivered?: boolean; bridge?: string; task_status?: string }
    expect(body.delivered).toBe(true)
    expect(body.bridge).toBe('native-teams')
    expect(body.task_status).toBe('TASK_STATE_DELIVERED')
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(m.registry.rounds).toHaveLength(1)
    expect(m.registry.rounds[0]!.args.message).toContain('async ship')
  })

  it('a2a_teams lists registry rows only when the bridge is on', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const teams = m.ctx.tools.get('a2a_teams')
    const on = await teams!.execute({}, noAgent()) as { teams: Array<{ team: string; local?: boolean }> }
    expect(on.teams.find(row => row.team === 'freight-team')).toMatchObject({ local: true })
    await m.dispose()
    mounted.pop()
    const off = await mount({})
    mounted.push(off.dispose)
    off.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const result = await off.ctx.tools.get('a2a_teams')!.execute({}, noAgent()) as { teams: Array<{ team: string }> }
    expect(result.teams.find(row => row.team === 'freight-team')).toBeUndefined()
  })

  it('a registry claim never shadows a live session team (documented chain order)', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const events: unknown[] = []
    const node = makeAgent('session-aaa')
    ;(node.session as { events: unknown[] }).events = events
    const steer = vi.fn(() => {
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'session node answered' }] } } })
      m.ctx.emit('agent/status', { agent: node, status: 'idle' })
    })
    ;(node as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(node)
    m.ctx.emit('agent/created', { agent: node })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    m.registry.claims.set('dsh/aaa', { plane: 'local', localLabel: 'team' })
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/aaa', message: 'who is this' }, noAgent()) as { ok: boolean; reply?: string }
    expect(result.ok).toBe(true)
    expect(result.reply).toBe('session node answered')
    expect(steer).toHaveBeenCalledTimes(1)
    expect(m.registry.rounds).toHaveLength(0)
  })

  it('wait:false with no live initiator fails honestly instead of answering phantom delivered', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const res = await postJson(m.port, '/a2a/direct', { team: 'freight-team', message: 'x', caller_session: 'peer-x', wait: false })
    const body = await res.json() as { delivered?: boolean; error?: string }
    expect(body.delivered).toBeUndefined()
    expect(body.error).toContain('No live DSH initiator')
    expect(m.registry.rounds).toHaveLength(0)
  })

  it('a wait-mode round past the reply window answers the honest unsettled shape (no false completion)', async () => {
    const m = await mount({ nativeTeamsInbound: true, nativeRoundWaitMs: 150 })
    mounted.push(async () => { await m.dispose() })
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    m.registry.hang = true
    const res = await postJson(m.port, '/a2a/direct', { team: 'freight-team', message: 'slow round', caller_session: 'peer-x' })
    const body = await res.json() as { task_status?: string; result?: { text?: string }; bridge?: string }
    expect(body.task_status).toBe('TASK_STATE_DELIVERED')
    expect(body.result?.text).toContain('still running past the reply window')
    // The unsettled bridge marker rides the wire so the remote caller's
    // ledger does not book an unpayable owed row.
    expect(body.bridge).toBe('native-teams')
    expect(m.registry.rounds).toHaveLength(1)
  }, 15_000)

  it('an async local native round is NOT booked as receipt-owed (rounds emit no receipts)', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    m.agents.agents.push(initiator)
    m.registry.claims.set('freight-team', { plane: 'local', localLabel: 'team' })
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'freight-team', message: 'async job', async: true }, noAgent()) as { ok: boolean; task_id?: string; bridge?: string }
    expect(result.ok).toBe(true)
    expect(result.bridge).toBe('native-teams')
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { tasks: Array<{ taskId: string }> }
    expect(state.tasks.map(task => task.taskId)).not.toContain(result.task_id)
  })
})

describe('outbound face: idempotency verdicts and cancel', () => {
  it('a peer 409 replay is terminal accepted — never a failover duplicate dispatch', async () => {
    const peer = await startPeer({
      direct: () => ({ status: 409, payload: { error: 'duplicate task id within the idempotency window', code: -32003, replay: true } }),
    })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    const outcome = await face.submit({ handle: 'peer-team', message: 'retry of an unacknowledged submit', delivery: 'sync', idempotencyKey: 'wb-r' })
    expect(outcome).toMatchObject({ kind: 'accepted', taskId: 'wb-r' })
    expect(peer.seen).toHaveLength(1)
  })

  it('a peer 409 conflict (same key, different payload) fails instead of redirecting', async () => {
    const peer = await startPeer({
      direct: () => ({ status: 409, payload: { error: 'task id reused with a different payload', code: -32002 } }),
    })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    await expect(face.submit({ handle: 'peer-team', message: 'conflicting payload', delivery: 'sync', idempotencyKey: 'wb-c' }))
      .rejects.toThrow("conflicts at the peer's idempotency ledger")
    expect(peer.seen).toHaveLength(1)
  })

  it('cancel of a remote submission drives the wire stop-notice to the team and clears the row', async () => {
    const peer = await startPeer({ asyncCap: true })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>>; cancel: (ref: { taskId?: string }, reason?: string) => Promise<boolean> }
    await face.submit({ handle: 'peer-team', message: 'long job', delivery: 'async', idempotencyKey: 'wb-z' })
    const cleared = await face.cancel({ taskId: 'wb-z' }, 'changed mind')
    expect(cleared).toBe(true)
    const notice = peer.seen.find(entry => String(entry.message ?? '').includes('[A2A cancel]'))
    expect(notice).toBeDefined()
    expect(String(notice?.message)).toContain('task wb-z')
    expect(String(notice?.message)).toContain('changed mind')
    // The notice deliberately carries NO task_id: the original id is already
    // claimed at the peer's idempotency ledger with a different payload, so
    // reusing it would 409-conflict before any steer happens.
    expect(notice?.task_id).toBeUndefined()
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { tasks: Array<{ taskId: string }> }
    expect(state.tasks.map(task => task.taskId)).not.toContain('wb-z')
  })

  it('cancel of a local steered task steers the cooperative stop-notice at the live target', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const events: unknown[] = []
    const node = makeAgent('session-aaa')
    ;(node.session as { events: unknown[] }).events = events
    const steers: string[] = []
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      const text = message.content.find(block => block.type === 'text')?.text ?? ''
      steers.push(text)
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'node acknowledged' }] } } })
      m.ctx.emit('agent/status', { agent: node, status: 'idle' })
    })
    ;(node as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(node)
    m.ctx.emit('agent/created', { agent: node })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaa' })
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/aaa', message: 'long local job', async: true }, noAgent()) as { ok: boolean; task_id?: string }
    expect(result.ok).toBe(true)
    expect(result.task_id).toBeDefined()
    const face = m.face() as { cancel: (ref: { taskId?: string }, reason?: string) => Promise<boolean> }
    const cleared = await face.cancel({ taskId: result.task_id }, 'review seat fix check')
    expect(cleared).toBe(true)
    expect(steers.some(text => text.includes('[A2A cancel]') && text.includes(String(result.task_id)))).toBe(true)
  })
})

describe('P2 receipt-callback routing', () => {
  it('face.submit maps a joined callbackTarget parent to its node team on the wire', async () => {
    const peer = await startPeer({ asyncCap: true })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const node = makeAgent('session-aaaa')
    m.agents.agents.push(node)
    m.ctx.emit('agent/created', { agent: node })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-aaaa' })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    await face.submit({
      handle: 'peer-team',
      message: 'round with a home',
      delivery: 'async',
      idempotencyKey: 'p2-1',
      callbackTarget: { label: 'team', parentSessionId: 'session-aaaa' },
    })
    expect(peer.seen[0]).toMatchObject({ callback: 'dsh/aaaa' })
  })

  it('an unjoined callbackTarget parent rides NO callback — a bare-team address would be intercepted local-first by a same-named peer', async () => {
    const peer = await startPeer({ asyncCap: true })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const face = m.face() as { submit: (request: Record<string, unknown>) => Promise<Record<string, unknown>> }
    await face.submit({
      handle: 'peer-team',
      message: 'parent never joined',
      delivery: 'async',
      idempotencyKey: 'p2-2',
      callbackTarget: { label: 'team', parentSessionId: 'session-ghost' },
    })
    // Omitting the callback restores the P1 behavior: the receipt hint uses
    // the node label, which structurally cannot resolve on the peer — lost
    // honestly, never misdelivered to the peer's own initiator.
    expect(peer.seen[0]?.callback).toBeUndefined()
    // A null callbackTarget must not crash the submission either.
    await face.submit({
      handle: 'peer-team',
      message: 'null target tolerated',
      delivery: 'async',
      idempotencyKey: 'p2-3',
      callbackTarget: null,
    })
    expect(peer.seen[1]?.callback).toBeUndefined()
  })

  it('an inbound noWait route honors the callback address in its receipt hint', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steered: string[] = []
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      steered.push(message.content.find(block => block.type === 'text')?.text ?? '')
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    const res = await postJson(m.port, '/a2a/direct', { team: 'dsh', message: 'job', caller_session: 'someone', callback: 'dsh/cb9', wait: false })
    const body = await res.json() as { delivered?: boolean }
    expect(body.delivered).toBe(true)
    expect(steered[0]).toContain('a2a_route { team: "dsh/cb9"')
  })

  it('an oversized callback is treated as absent (the caller label plays its role)', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steered: string[] = []
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      steered.push(message.content.find(block => block.type === 'text')?.text ?? '')
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    const longCallback = 'dsh/' + 'x'.repeat(200)
    const res = await postJson(m.port, '/a2a/direct', { team: 'dsh', message: 'job', caller_session: 'caller-x', callback: longCallback, wait: false })
    const body = await res.json() as { delivered?: boolean }
    expect(body.delivered).toBe(true)
    expect(steered[0]).not.toContain(longCallback)
    expect(steered[0]).toContain('team: "caller-x"')
  })

  it('the receipt autosend delivers cross-node through the directory walk', async () => {
    const peer = await startPeer({ asyncCap: true })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    // The bare-team target answers, which arms the receipt autosend at the
    // caller's callback address — a REMOTE team only resolvable through the
    // peer directory. The autosend must walk it, not silently no-op. The
    // answer is deferred 30ms so the waiter registration (which follows the
    // steer synchronously) lands first, like a real turn.
    const initiator = makeAgent('session-main1')
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      setTimeout(() => {
        initiator.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'all done' }] } } })
        m.ctx.emit('agent/status', { agent: initiator, status: 'idle' })
      }, 30)
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    const res = await postJson(m.port, '/a2a/direct', { team: 'dsh', message: 'job', caller_session: 'caller-x', callback: 'peer-team', wait: false })
    const body = await res.json() as { delivered?: boolean }
    expect(body.delivered).toBe(true)
    for (let i = 0; i < 50 && !peer.seen.some(entry => String(entry.message ?? '').startsWith('[A2A receipt]')); i++) {
      await new Promise(resolve => { setTimeout(resolve, 20) })
    }
    const receipt = peer.seen.find(entry => String(entry.message ?? '').startsWith('[A2A receipt]'))
    expect(receipt).toBeDefined()
    expect(String(receipt?.message)).toContain('all done')
  })

  it('cold joined teams are advertised on the card so cross-node wake-on-route is discoverable', async () => {
    const m = await mount({ announce: true, joined: ['session-cold9'] })
    mounted.push(m.dispose)
    const live = makeAgent('session-live1')
    m.agents.agents.push(live)
    m.ctx.emit('agent/created', { agent: live })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-live1' })
    const card = await (await fetch(`http://127.0.0.1:${String(m.port)}/.well-known/agent-card.json`)).json() as { sessionTeams?: Array<{ team: string; description?: string }> }
    const teams = (card.sessionTeams ?? []).map(entry => entry.team)
    expect(teams).toContain('dsh/live1')
    expect(teams).toContain('dsh/cold9')
    const cold = card.sessionTeams!.find(entry => entry.team === 'dsh/cold9')
    expect(cold!.description).toContain('cold')
  })
})

describe('P2 receipt-resolved event seam', () => {
  it('emits a2a/receipt-resolved when an inbound receipt settles a tracked task', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      setTimeout(() => {
        initiator.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'work finished' }] } } })
        m.ctx.emit('agent/status', { agent: initiator, status: 'idle' })
      }, 30)
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    const resolved: Array<{ taskId: string; late?: boolean }> = []
    m.ctx.on('a2a/receipt-resolved', info => { resolved.push(info) })
    // Book a tracked owed row: an async local steer route (no bridge marker).
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh', message: 'async job', async: true }, noAgent()) as { ok: boolean; task_id?: string }
    expect(result.ok).toBe(true)
    expect(resolved).toHaveLength(0)
    // The receipt arrives over the direct endpoint and settles the row.
    const res = await postJson(m.port, '/a2a/direct', { team: 'dsh', message: `[A2A receipt] task ${String(result.task_id)} tests green`, caller_session: 'someone' })
    const body = await res.json() as { result?: { text?: string } }
    expect(body.result?.text).toBe('work finished')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ taskId: result.task_id, team: 'dsh' })
  })

  it('a receipt that correlates nothing emits no event', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const resolved: Array<{ taskId: string }> = []
    m.ctx.on('a2a/receipt-resolved', info => { resolved.push(info) })
    await postJson(m.port, '/a2a/direct', { team: 'dsh', message: '[A2A receipt] task direct-unknown nonsense', caller_session: 'someone' })
    expect(resolved).toHaveLength(0)
  })
})

describe('settle fence coverage', () => {
  it('a synchronously throwing receipt listener degrades to a warning — the routing path survives', async () => {
    const m = await mount({ nativeTeamsInbound: true })
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      setTimeout(() => {
        initiator.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'work finished' }] } } })
        m.ctx.emit('agent/status', { agent: initiator, status: 'idle' })
      }, 30)
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh', message: 'async job', async: true }, noAgent()) as { ok: boolean; task_id?: string }
    expect(result.ok).toBe(true)
    m.ctx.on('a2a/receipt-resolved', () => { throw new Error('consumer exploded') })
    const res = await postJson(m.port, '/a2a/direct', { team: 'dsh', message: `[A2A receipt] task ${String(result.task_id)} done`, caller_session: 'someone' })
    const body = await res.json() as { result?: { text?: string } }
    expect(body.result?.text).toBe('work finished')
    // The fence let the settlement complete before the consumer threw: the
    // owed row is archived even though the listener exploded.
    const state = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/state`)).json() as { tasks: Array<{ taskId: string }>; archivedCount: number }
    expect(state.tasks.map(task => task.taskId)).not.toContain(result.task_id)
    expect(state.archivedCount).toBeGreaterThan(0)
    // The routing path answers normally afterwards (the fence is per-emit).
    const second = await postJson(m.port, '/a2a/direct', { team: 'dsh', message: 'plain follow-up', caller_session: 'someone' })
    await expect(second.json()).resolves.toMatchObject({ result: { text: 'work finished' } })
  })
})
