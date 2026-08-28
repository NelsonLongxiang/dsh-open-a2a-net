/**
 * Native-teams bridge (P1): the outbound transport face mounted under the
 * frozen `nativeTeamsA2a` service key (resolve via the peer directory, sync/
 * async submit over the direct-route dispatcher, owed-ledger tracking), and
 * the opt-in inbound bridge (a registry-claimed local team dispatches
 * through the sibling's authoritative routing seam; off by default; the
 * bridge declines ambiguous claims; wait:false fires detached).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
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
async function startPeer(options: { session?: string; asyncCap?: boolean } = {}): Promise<{ url: string; seen: Array<Record<string, unknown>>; close: () => Promise<void> }> {
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
        const payload = body.wait === false
          ? JSON.stringify({ routed: true, delivered: true, team: body.team, session, task_id: body.task_id, context_id: 'ctx-peer', task_status: 'TASK_STATE_DELIVERED' })
          : JSON.stringify({ routed: true, team: body.team, session, result: { text: 'peer says hi' }, task_id: body.task_id, context_id: 'ctx-peer', task_status: 'TASK_STATE_COMPLETED' })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
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

async function mount(options: { peers?: string[]; nativeTeamsInbound?: boolean } = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeInitiatorAgents(ctx)
  const registry = new FakeTeamsRegistry(ctx)
  const home = tmpHome()
  apply(ctx, {
    apiKey: '',
    session: 'bridge-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
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
})
