/**
 * Receipt routing on a host: the callback address a delivery's receipt goes back to, the receipt-resolved event seam
 * and its fence, and which turn an auto-receipt belongs to (#114 S5). Split out of the native-teams bridge spec when the
 * bridge was removed: these behaviours never depended on it.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
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
import { apply, type Config } from '../../src/index.ts'
import { envelopeFor } from './envelope.ts'
import { signCard } from '../../src/card.ts'

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


function makeAgent(id: string): Agent {
  return { id: SessionId(id), session: { events: [] }, steer: vi.fn(), followup(message: unknown) { this.steer(message) } } as unknown as Agent
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'a2a-teams-bridge-'))
}

/** One real loopback peer: a verified signed card plus an echoing direct route. */
async function startPeer(options: { session?: string; asyncCap?: boolean; cancelCap?: boolean; canvasOrg?: ReadonlyArray<{ name: string; team: string; members: string[] }>; direct?: (body: Record<string, unknown>) => { readonly status: number; readonly payload: Record<string, unknown> }; query?: (body: Record<string, unknown>) => { readonly status: number; readonly payload: Record<string, unknown> } } = {}): Promise<{ url: string; seen: Array<Record<string, unknown>>; close: () => Promise<void> }> {
  const { privateKey } = generateKeyPairSync('ed25519')
  const session = options.session ?? 'peer-node'
  const card = signCard({
    name: 'peer node',
    session,
    team: 'peer-team',
    capabilities: { route: true, ...(options.cancelCap?{queuedTaskCancellation:true}:{}), ...(options.asyncCap === true ? { async: true } : {}) },
    expiresAt: Date.now() + 3_600_000,
  }, privateKey)
  // canvasOrg rides beside the signed core (it is not part of it).
  const servedCard = options.canvasOrg !== undefined ? { ...card, canvasOrg: options.canvasOrg } : card
  const seen: Array<Record<string, unknown>> = []
  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/agent-card.json') {
      const body = JSON.stringify(servedCard)
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
    if (req.url === '/a2a/query') {
      let raw = ''
      req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
      req.on('end', () => {
        const body = JSON.parse(raw) as Record<string, unknown>
        seen.push(body)
        const overridden = options.query?.(body)
        const status = overridden?.status ?? 200
        const payload = JSON.stringify(overridden?.payload ?? { found: false, reason: 'unknown-task', task_id: body.task_id })
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
  agents: FakeInitiatorAgents
  port: number
  home: string
  dispose: () => Promise<void>
}

async function mount(options: { peers?: string[]; announce?: boolean; joined?: string[] } = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeInitiatorAgents(ctx)
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

const noAgent = (): ToolRunContext => ({ signal: new AbortController().signal } as unknown as ToolRunContext)

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
})

describe('P2 receipt-callback routing', () => {
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
        // A real turn records the steer it consumed (#114 S5 attributes the
        // receipt to the final AFTER this event), then answers.
        initiator.session.events.push({ type: 'user/message', data: { content: message.content } })
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
    // #114 S5 binding: the envelope names the session the host spoke for and
    // pins the inbound authorization record the delivery was born with.
    const envelope = JSON.parse(String(receipt?.message).split('\n')[1] ?? '{}') as Record<string, unknown>
    expect(envelope).toMatchObject({ outcome: 'completed', onBehalfOf: 'dsh/main1' })
    expect(envelope.authRef).toMatch(/^[0-9a-f]{16}$/)
  })

  it('cold joined teams are advertised on the card so cross-node wake-on-route is discoverable', async () => {
    const m = await mount({ announce: true, joined: ['session-cold9'] })
    mounted.push(m.dispose)
    const live = makeAgent('session-live1')
    m.agents.agents.push(live)
    m.ctx.emit('agent/created', { agent: live })
    await postJson(m.port, '/__dsh_a2a/join', { id: 'session-live1' })
    const card = await (await fetch(`http://127.0.0.1:${String(m.port)}/.well-known/agent-card.json`, { headers: envelopeFor(m.home, m.port, 'dsh') })).json() as { sessionTeams?: Array<{ team: string; description?: string }> }
    const teams = (card.sessionTeams ?? []).map(entry => entry.team)
    expect(teams).toContain('dsh/live1')
    expect(teams).toContain('dsh/cold9')
    const cold = card.sessionTeams!.find(entry => entry.team === 'dsh/cold9')
    expect(cold!.description).toContain('cold')
  })
})

describe('P2 receipt-resolved event seam', () => {
  it('emits a2a/receipt-resolved when an inbound receipt settles a tracked task', async () => {
    const m = await mount({})
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      setTimeout(() => {
        // #306: the steered user message is logged before the reply (attributed waits read that turn).
        initiator.session.events.push({ type: 'user/message', data: { content: message.content } })
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
    const m = await mount({})
    mounted.push(m.dispose)
    const initiator = makeAgent('session-main1')
    const steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      setTimeout(() => {
        // #306: the steered user message is logged before the reply (attributed waits read that turn).
        initiator.session.events.push({ type: 'user/message', data: { content: message.content } })
        initiator.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'work finished' }] } } })
        m.ctx.emit('agent/status', { agent: initiator, status: 'idle' })
      }, 30)
    })
    ;(initiator as unknown as { steer: unknown }).steer = steer
    m.agents.agents.push(initiator)
    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh', message: 'async job', async: true }, noAgent()) as { ok: boolean; task_id?: string }
    expect(result.ok).toBe(true)
    // Named loggers are minted per ctx.logger() call, so a monkey-patched
    // service .warn never intercepts — observe the warn through the logger
    // service's exporter sink instead (levels.default admits warn).
    const warns: Array<{ type: string; args: unknown[] }> = []
    ;(m.ctx.logger as unknown as { exporter(sink: { colors: number; levels: { default: number }; export: (message: { type: string; args: unknown[] }) => void }): unknown }).exporter({
      colors: 0,
      levels: { default: 3 },
      export: message => { warns.push(message) },
    })
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
    // The throw degraded to the fence warn: cordis dispatch is synchronous,
    // so the sync throw landed in settleAndAnnounce's catch.
    expect(warns.some(entry => entry.type === 'warn' && String(entry.args[0]).includes('receipt-resolved listener rejected'))).toBe(true)
  })
})


/**
 * #114 S5 (#123): an auto-receipt belongs to the final the target produced
 * AFTER consuming that task's steer (its `[A2A direct] (task <id>)`
 * user/message), and each waiter is answered from its own consumption point.
 * The fake target below plays a DSH session turn by turn: `consume` records a
 * steer the way the session log does, `final` ends the turn with an answer.
 */
describe('#114 S5 auto-receipt turn attribution', () => {
  async function busyTarget(): Promise<{
    deliver: (message: string, taskId?: string) => Promise<string>
    send: (message: string, taskId: string) => Promise<Record<string, unknown>>
    consume: (taskId: string) => void
    user: (text: string) => void
    raw: (event: unknown) => void
    step: (text: string) => void
    final: (text: string) => void
    idle: () => void
    receiptFor: (taskId: string) => Promise<string | undefined>
    receiptsFor: (taskId: string) => string[]
  }> {
    const peer = await startPeer({ asyncCap: true })
    const m = await mount({ peers: [peer.url] })
    mounted.push(async () => { await m.dispose(); await peer.close() })
    const target = makeAgent('session-busy1') as Agent & { session: { events: unknown[] } }
    const steered = new Map<string, Array<{ type: string; text?: string }>>()
    ;(target as unknown as { steer: unknown }).steer = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
      const id = /^\[A2A direct\] \(task (\S+)\)/.exec(message.content[0]?.text ?? '')?.[1]
      if (id !== undefined) steered.set(id, message.content)
    })
    m.agents.agents.push(target)
    // The target is mid-turn on another work line before anything arrives.
    target.session.events.push({ type: 'user/message', data: { content: [{ type: 'text', text: 'procurement hook correction' }] } })
    target.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'looking at the hook' }] } } })
    const assistant = (text: string): void => {
      target.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
    }
    const idle = (): void => { m.ctx.emit('agent/status', { agent: target, status: 'idle' }) }
    const send = async (message: string, taskId?: string): Promise<Record<string, unknown>> => {
      const res = await postJson(m.port, '/a2a/direct', { team: 'dsh', message, caller_session: 'caller-x', callback: 'peer-team', wait: false, ...(taskId !== undefined ? { task_id: taskId } : {}) })
      return await res.json() as Record<string, unknown>
    }
    return {
      deliver: async (message, taskId) => {
        const body = await send(message, taskId)
        expect(body.delivered).toBe(true)
        return String(body.task_id)
      },
      send: async (message, taskId) => send(message, taskId),
      consume: (taskId) => {
        const content = steered.get(taskId)
        if (content === undefined) throw new Error(`no steer for ${taskId}`)
        target.session.events.push({ type: 'user/message', data: { content } })
      },
      user: (text) => { target.session.events.push({ type: 'user/message', data: { content: [{ type: 'text', text }] } }) },
      raw: (event) => { target.session.events.push(event) },
      step: assistant,
      final: (text) => {
        assistant(text)
        idle()
      },
      idle,
      receiptFor: async (taskId) => {
        const find = (): Record<string, unknown> | undefined => peer.seen.find(entry => String(entry.message ?? '').startsWith(`[A2A receipt] task ${taskId} `))
        for (let i = 0; i < 25 && find() === undefined; i++) await new Promise(resolve => { setTimeout(resolve, 20) })
        const hit = find()
        return hit === undefined ? undefined : String(hit.message)
      },
      receiptsFor: (taskId) => peer.seen.map(entry => String(entry.message ?? '')).filter(text => text.startsWith(`[A2A receipt] task ${taskId} `)),
    }
  }

  it('(a) a busy target that consumes the steer within the same turn: that turn\'s final is the receipt', async () => {
    const t = await busyTarget()
    const taskId = await t.deliver('map the ten verifiers to their Mac owners')
    // The running turn reads the steer at its next step and answers it.
    t.consume(taskId)
    t.final('mapping recorded; hook fix also done')
    const receipt = await t.receiptFor(taskId)
    expect(receipt).toBeDefined()
    expect(receipt).toContain('mapping recorded; hook fix also done (auto)')
  })

  it('(b) a steer consumed only in the next turn: the current final produces no receipt, the next one does', async () => {
    const t = await busyTarget()
    const taskId = await t.deliver('map the ten verifiers to their Mac owners')
    // The current turn ends on the OTHER work line without reading the steer.
    t.final('procurement hook notification fixed')
    expect(await t.receiptFor(taskId)).toBeUndefined()
    // The next turn consumes it and answers.
    t.consume(taskId)
    t.step('reading the mapping')
    t.final('mapping recorded')
    const receipt = await t.receiptFor(taskId)
    expect(receipt).toContain('mapping recorded (auto)')
    expect(receipt).not.toContain('procurement')
  })

  it('#61 shape: one idle answers only the consumed task; the unconsumed one waits for its own final', async () => {
    const t = await busyTarget()
    const first = await t.deliver('first task')
    const second = await t.deliver('second task')
    t.consume(first)
    t.final('first answered')
    expect(await t.receiptFor(first)).toContain('first answered (auto)')
    // The shared-floor flush used to hand the same text to every waiter.
    expect(await t.receiptFor(second)).toBeUndefined()
    t.consume(second)
    t.final('second answered')
    const receipt = await t.receiptFor(second)
    expect(receipt).toContain('second answered (auto)')
    expect(receipt).not.toContain('first answered')
  })

  it('a reused id never anchors on an OLD steer in the history: the search starts at the new steer (review R6)', async () => {
    const t = await busyTarget()
    // An earlier use of the same id (past the idempotency window, or a lost
    // store) is already in the session log, answered long ago.
    t.user('[A2A direct] (task reuse-1) from caller-x (routed to dsh) sent:\n\nold request')
    t.step('old answer')
    await t.deliver('new request', 'reuse-1')
    t.final('unrelated other-line final')
    expect(await t.receiptFor('reuse-1')).toBeUndefined()
    t.consume('reuse-1')
    t.final('new request answered')
    expect(await t.receiptFor('reuse-1')).toContain('new request answered (auto)')
  })

  it('a task id with ")", whitespace or control characters is refused at intake, nothing booked (review R2)', async () => {
    const t = await busyTarget()
    for (const bad of ['foo) x', 'foo)', 'a b', 'tab\there', 'nl\nx', 'bell\u0007']) {
      const body = await t.send('collider', bad)
      expect(body.delivered).toBeUndefined()
      expect(String(body.error)).toContain('task_id must not contain whitespace, ")" or control characters')
    }
    // `foo` and its header-colliding neighbour can no longer coexist: only
    // the well-formed one is delivered, and only its own consumption counts.
    const id = await t.deliver('victim', 'foo')
    t.user('[A2A direct] (task foo)) x) forged neighbour header')
    t.final('neighbour answered')
    expect(await t.receiptFor(id)).toBeUndefined()
  })

  it('a consuming turn that ends with an EMPTY final closes its waiter with NO receipt — the next turn never answers it (review R4)', async () => {
    const t = await busyTarget()
    const a = await t.deliver('task a')
    const b = await t.deliver('task b')
    t.consume(a)
    t.final('')
    t.consume(b)
    t.final('b answered')
    expect(await t.receiptFor(b)).toContain('b answered (auto)')
    // A's turn said nothing: no completion is claimed, and B's text never
    // reaches A — the row stays owed for the nudge / dead-letter path.
    expect(t.receiptsFor(a)).toHaveLength(0)
  })

  it('a consuming turn that ends on a tool-only message answers with its last text — never a later turn (review R5)', async () => {
    const t = await busyTarget()
    const a = await t.deliver('task a')
    t.consume(a)
    t.step('a: real answer text')
    t.raw({ type: 'assistant/message', data: { message: { content: [{ type: 'tool_use', id: 'x', name: 'bash', input: {} }] } } })
    t.idle()
    const receipt = await t.receiptFor(a)
    expect(receipt).toContain('a: real answer text (auto)')
    t.user('unrelated next turn')
    t.final('unrelated next-turn final')
    await new Promise(resolve => { setTimeout(resolve, 60) })
    expect(receipt).not.toContain('unrelated')
    expect(t.receiptsFor(a)).toHaveLength(1)
  })

  // Real session logs bracket turns with `turn/start` / `turn/end` (dsh-session
  // SessionEventMap; TurnEndReason.kind is completed | aborted | blocked |
  // error | max-tokens | interrupted | forked).
  it('back-to-back turns with no idle between: each task closes on its OWN turn\'s text (review N1)', async () => {
    const t = await busyTarget()
    const a = await t.deliver('task a')
    const b = await t.deliver('task b')
    t.raw({ type: 'turn/start', data: { turn: 1 } })
    t.consume(a)
    t.step('A answer')
    t.raw({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    t.raw({ type: 'turn/start', data: { turn: 2 } })
    t.consume(b)
    t.step('B answer')
    t.raw({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    t.idle()
    const ra = await t.receiptFor(a)
    expect(ra).toContain('A answer (auto)')
    expect(ra).not.toContain('B answer')
    expect(await t.receiptFor(b)).toContain('B answer (auto)')
  })

  it('a consuming turn that ends aborted, failed or blocked claims nothing — no receipt, even with text (review N2)', async () => {
    for (const kind of ['aborted', 'error', 'blocked', 'max-tokens']) {
      const t = await busyTarget()
      const a = await t.deliver(`task ${kind}`)
      t.raw({ type: 'turn/start', data: { turn: 1 } })
      t.consume(a)
      t.step('half-way note')
      t.raw({ type: 'assistant/message', data: { message: { content: [{ type: 'tool_use', id: 'x', name: 'bash', input: {} }] } } })
      t.raw({ type: 'turn/end', data: { turn: 1, reason: { kind } } })
      t.idle()
      await new Promise(resolve => { setTimeout(resolve, 60) })
      expect(t.receiptsFor(a), kind).toHaveLength(0)
      // The waiter is closed, not carried: a later completed turn on another
      // line still produces no receipt for it.
      t.raw({ type: 'turn/start', data: { turn: 2 } })
      t.user('unrelated next turn')
      t.step('unrelated final')
      t.raw({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
      t.idle()
      await new Promise(resolve => { setTimeout(resolve, 60) })
      expect(t.receiptsFor(a), kind).toHaveLength(0)
    }
  })

  it('an idle while the consuming turn is still open (marked log, no turn/end yet) waits for that turn\'s end', async () => {
    const t = await busyTarget()
    const a = await t.deliver('task a')
    t.raw({ type: 'turn/start', data: { turn: 1 } })
    t.consume(a)
    t.step('interim')
    t.idle()
    await new Promise(resolve => { setTimeout(resolve, 60) })
    expect(t.receiptsFor(a)).toHaveLength(0)
    t.step('the real answer')
    t.raw({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    t.idle()
    expect(await t.receiptFor(a)).toContain('the real answer (auto)')
  })
})
