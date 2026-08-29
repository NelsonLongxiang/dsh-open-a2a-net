/**
 * a2a plugin `apply` tests: announce/card lifecycle, decentralized routing
 * and zone naming over real web servers, the session-node join surface and
 * its control-route authorization, and the direct-route dispatch contract —
 * all against a fake agents service. Client wire behavior is covered by
 * client.spec.ts against src/a2a-client.ts seams.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { signCard } from '../src/card.ts'
import { WIRE_ERROR_PAYLOAD_TOO_LARGE } from '../src/transport-caps.ts'
import { apply, Config as ConfigSchema, type A2aSchedule, type Config } from '../src/index.ts'

/** Fake agents registry: one recoverable root agent or none. */
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

/** Fake loader service: tree settlement the test resolves or rejects by hand. */
class FakeLoaderService extends Service {
  private readonly resolvers: Array<() => void> = []
  private readonly rejecters: Array<(reason?: unknown) => void> = []

  constructor(ctx: Context) {
    super(ctx, 'loader')
  }

  await(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolvers.push(resolve)
      this.rejecters.push(reject)
    })
  }

  /** Settle the tree successfully: every awaited promise resolves. */
  settle(): void {
    for (const resolve of this.resolvers.splice(0)) resolve()
  }

  /** Fail the tree: every awaited promise rejects. */
  fail(): void {
    for (const reject of this.rejecters.splice(0)) reject(new Error('tree failed'))
  }
}

/** A minimal live agent: id, event log, steer recorder. */
function makeAgent(): Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } } {
  return {
    id: SessionId('agent-1'),
    session: { events: [] },
    steer: vi.fn(),
  } as unknown as Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } }
}

/** A main-session agent whose steer answers with an assistant message and idle. */
function replyingAgent(ctx: Context): ReturnType<typeof makeAgent> {
  const agent = makeAgent()
  agent.steer = vi.fn(() => {
    ;(agent.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'peer node replied' }] } } })
    ctx.emit('agent/status', { agent, status: 'idle' })
  })
  return agent
}

/** One outbound-only config row with per-test overrides. */
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

/** Per-test DSH home so announce keygen never touches the developer's home. */
function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-a2a-key-'))
}

function runContext(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

/**
 * Node B: real web server + real direct endpoint; its fake agent answers
 * by pushing an assistant message and going idle on steer.
 */
async function mountPeerNode(
  overrides: Partial<Config> = {},
  withAgent = true,
): Promise<{ baseUrl: string; dispose: () => Promise<void>; steer: ReturnType<typeof vi.fn> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = await ctx.plugin(FakeAgentsService)
  const registry = ctx.get('agents') as unknown as FakeAgentsService
  void agents
  const liveAgent = { ...makeAgent() } as ReturnType<typeof makeAgent>
  const steer = vi.fn(() => {
    ;(liveAgent.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'peer node replied' }] } } })
    ctx.emit('agent/status', { agent: liveAgent, status: 'idle' })
  })
  liveAgent.steer = steer
  if (withAgent) registry.agent = liveAgent
  // Distinct session label: two nodes sharing one label would look like a
  // self-referral to the discovery guard (the signed session is the node
  // identity), and the tests must model two DIFFERENT hosts.
  apply(ctx, makeConfig({ announce: true, session: 'peer-node', dshHome: tmpHome(), ...overrides }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
    steer,
  }
}

/** Boot a plugin tree with a web server and the session-node routes live. */
async function mountJoinHarness(overrides: Partial<Config> = {}): Promise<{ ctx: Context; agents: FakeAgentsService; port: number }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  apply(ctx, makeConfig({ sessionNodes: true, dshHome: tmpHome(), ...overrides }))
  return { ctx, agents, port: (ctx as unknown as { webServer: WebServer }).webServer.port }
}

/** POST one JSON body to a session-node control route. */
const postJson = (port: number, path: string, body: unknown): Promise<Response> =>
  globalThis.fetch(`http://127.0.0.1:${String(port)}${path}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a2a plugin announce (peer discovery)', () => {
  it('publishes a signed agent card, re-signs at TTL/4, and persists the key across restarts', async () => {
    const home = tmpHome()
    const ctx = new Context()
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    apply(ctx, makeConfig({ announce: true, agentName: 'peer-a', dshHome: home, cardTtlMs: 200 }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const url = `http://127.0.0.1:${String(port)}/.well-known/agent-card.json`
    const response = await globalThis.fetch(url)
    expect(response.status).toBe(200)
    const card = await response.json() as {
      name: string
      team: string
      session: string
      capabilities: { relay: boolean }
      expiresAt: number
      publicKey: string
      signature: string
    }
    expect(card).toMatchObject({ name: 'peer-a', team: 'dsh', session: 'sess-1' })
    expect(typeof card.publicKey).toBe('string')
    expect(typeof card.signature).toBe('string')
    expect(card.expiresAt).toBeGreaterThan(Date.now())
    // TTL/4 = 50ms: after two cadences the served expiry rolls forward while
    // the identity (public key) stays stable.
    await new Promise(resolve => setTimeout(resolve, 120))
    const refreshed = await (await globalThis.fetch(url)).json() as { expiresAt: number; publicKey: string }
    expect(refreshed.expiresAt).toBeGreaterThan(card.expiresAt)
    expect(refreshed.publicKey).toBe(card.publicKey)
    // A second process on the same home reuses the persisted key.
    const second = new Context()
    await second.plugin(TimerService)
    await second.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await second.plugin(SystemPrompt)
    await second.plugin(ToolRuntime)
    apply(second, makeConfig({ announce: true, agentName: 'peer-a', dshHome: home }))
    const port2 = (second as unknown as { webServer: WebServer }).webServer.port
    const reread = await (await globalThis.fetch(`http://127.0.0.1:${String(port2)}/.well-known/agent-card.json`)).json() as { publicKey: string }
    expect(reread.publicKey).toBe(card.publicKey)
    await second.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('publishes with the default DSH home when dshHome is empty', async () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = tmpHome()
    const ctx = new Context()
    try {
      await ctx.plugin(TimerService)
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      apply(ctx, makeConfig({ announce: true }))
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      expect((await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).status).toBe(200)
      await ctx.fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })

  it('derives a stable unique default session from the per-home node id', async () => {
    const home = tmpHome()
    const mount = async (): Promise<{ ctx: Context; port: number }> => {
      const ctx = new Context()
      await ctx.plugin(TimerService)
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      apply(ctx, makeConfig({ announce: true, session: '', dshHome: home }))
      return { ctx, port: (ctx as unknown as { webServer: WebServer }).webServer.port }
    }
    const first = await mount()
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(first.port)}/.well-known/agent-card.json`)).json() as { session: string }
    expect(card.session).toMatch(/^dsh-host-[0-9a-f]{8}$/)
    await first.ctx.fiber.dispose()
    const second = await mount()
    const again = await (await globalThis.fetch(`http://127.0.0.1:${String(second.port)}/.well-known/agent-card.json`)).json() as { session: string }
    expect(again.session).toBe(card.session)
    await second.ctx.fiber.dispose()
  })

  it('defers web-server registration until the loader tree settles', async () => {
    const ctx = new Context()
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeLoaderService)
    const loader = ctx.get('loader') as unknown as FakeLoaderService
    apply(ctx, makeConfig({ announce: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const url = `http://127.0.0.1:${String(port)}/.well-known/agent-card.json`
    // Before settlement the sibling web-server row is not assumed ready.
    expect((await globalThis.fetch(url)).status).toBe(404)
    loader.settle()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await globalThis.fetch(url)).status).toBe(200)
    await ctx.fiber.dispose()
  })

  it('stays quiet when the loader tree fails to settle', async () => {
    const ctx = new Context()
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeLoaderService)
    const loader = ctx.get('loader') as unknown as FakeLoaderService
    apply(ctx, makeConfig({ announce: true, dshHome: tmpHome() }))
    loader.fail()
    await new Promise(resolve => setTimeout(resolve, 0))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    expect((await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).status).toBe(404)
    await ctx.fiber.dispose()
  })

  it('skips the deferred registration when the fiber is disposed before the tree settles', async () => {
    const ctx = new Context()
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeLoaderService)
    const loader = ctx.get('loader') as unknown as FakeLoaderService
    apply(ctx, makeConfig({ announce: true, dshHome: tmpHome() }))
    await ctx.fiber.dispose()
    // Settlement after teardown must not resurrect registration on the dead fiber.
    loader.settle()
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('warns (not fails) when announce is on but no web server is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ announce: true }))
    expect(ctx.tools.get('a2a_teams')).toBeDefined()
    expect(ctx.tools.get('a2a_route')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('lists teams from a peer card that carries no referral list', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard({ name: 'bare', session: 'sess-9', team: 'solo', capabilities: {}, expiresAt: Date.now() + 60_000 }, privateKey)
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (url === 'http://bare-peer/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      return Promise.reject(new Error('peer unreachable'))
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: ['http://bare-peer'], dshHome: tmpHome() }))
    const listed = await ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string; local?: boolean; origin?: string }[] }
    expect(listed.ok).toBe(true)
    // The host's own process team leads with its origin tag; the peer card's
    // team follows with the publisher session as its origin (the natural
    // grouping dimension for fleet rows).
    expect(listed.teams[0]?.team).toBe('dsh')
    expect(listed.teams[0]?.local).toBe(true)
    expect(listed.teams[0]?.origin).toContain('this host')
    expect(listed.teams[1]?.team).toBe('solo')
    expect(listed.teams[1]?.origin).toBe('sess-9')
    await ctx.fiber.dispose()
  })
})

describe('a2a plugin decentralized routing (peers)', () => {
  it('serves a direct route with no agents service composed at all', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    apply(ctx, makeConfig())
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh', message: 'q' }),
    })
    await expect(response.json()).resolves.toMatchObject({ error: 'No live DSH agent is available to accept this message.' })
    await ctx.fiber.dispose()
  })

  it('answers direct-route edge conditions over the real endpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const direct = `http://127.0.0.1:${String(port)}/a2a/direct`
    apply(ctx, makeConfig())
    const post = async (body: string): Promise<{ status: number; json: unknown }> => {
      const response = await globalThis.fetch(direct, { method: 'POST', body })
      return { status: response.status, json: await response.json() as unknown }
    }

    // No live agent registered.
    const noAgent = await post(JSON.stringify({ team: 'dsh', message: 'q' }))
    expect(noAgent.json).toMatchObject({ error: 'No live DSH agent is available to accept this message.' })

    // Missing or non-string required fields.
    const fields = await post(JSON.stringify({ team: '', message: 'q' }))
    expect(fields.json).toMatchObject({ error: 'team and message are required' })
    const numericTeam = await post(JSON.stringify({ team: 7, message: 'q' }))
    expect(numericTeam.json).toMatchObject({ error: 'team and message are required' })

    // Malformed body.
    const malformed = await post('not json')
    expect(malformed.status).toBe(400)
    await ctx.fiber.dispose()
  })

  it('answers wait:false immediately with the delivered shape (peer async)', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        body: JSON.stringify({ team: 'dsh/agent-1', message: 'long cross-host task', caller_session: 'peer-caller', wait: false }),
      })
      const json = await response.json() as { routed?: boolean; delivered?: boolean; task_status?: string; result?: unknown }
      // Delivery answers at once: no result member, the delivered flag and
      // status carry the receipt contract.
      expect(json.routed).toBe(true)
      expect(json.delivered).toBe(true)
      expect(json.task_status).toBe('TASK_STATE_DELIVERED')
      expect(json.result).toBeUndefined()
      // The steer already happened.
      expect(session.steer).toHaveBeenCalledTimes(1)
      const steered = (session.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
      expect(steered?.text).toContain('from "peer-caller" (routed to dsh/agent-1)')
      // v0.5.24 (join-gate): the joined session's tool face passes the gate —
      // a2a_teams answers ok with no refusal, while an unjoined agent id
      // gets the plain-language ban and the join pointer.
      type ExecCtor = Parameters<NonNullable<ReturnType<typeof ctx.tools.get>>['execute']>[1]
      const joinedFace = await ctx.tools.get('a2a_teams')!.execute({}, { signal: new AbortController().signal, agent: session } as unknown as ExecCtor) as { ok: boolean; error?: string }
      expect(joinedFace.ok).toBe(true)
      expect(joinedFace.error).toBeUndefined()
      await expect(ctx.tools.get('a2a_teams')!.execute({}, { signal: new AbortController().signal, agent: { id: SessionId('session-outside000000000000000000') } } as unknown as ExecCtor))
        .rejects.toThrow('你被禁止使用 a2a 网络')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('drops an unreachable peer during team discovery while keeping the good one', async () => {
    const peer = await mountPeerNode()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    const realFetch = globalThis.fetch.bind(globalThis)
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (url.startsWith(peer.baseUrl)) {
        return realFetch(url, init)
      }
      return Promise.reject(new Error('peer unreachable'))
    })
    apply(ctx, makeConfig({ peers: ['http://127.0.0.1:1', peer.baseUrl], dshHome: tmpHome() }))
    try {
      const teams = ctx.tools.get('a2a_teams')
      await expect(teams?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        // The unreachable seed contributes nothing; the host's own row and
        // the good peer's row remain.
        teams: [{ team: 'dsh', local: true }, { team: 'dsh', session: 'peer-node' }],
      })
    } finally {
      vi.unstubAllGlobals()
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })

  it('never lists itself: a self-referral card is dropped, not tracked', async () => {
    // The peer card is signed with the SAME session label as the caller
    // node — the shape a peer produces when it learned this node URL and
    // lists it back. Fetching it must neither track the peer nor surface
    // its teams (they are this host own teams).
    // Force the collision: the peer card carries the caller's own session
    // label (the self-referral shape), so the guard must drop it again.
    const peer = await mountPeerNode({ session: 'sess-1' })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    apply(ctx, makeConfig({ peers: [peer.baseUrl], sessionNodes: true, dshHome: tmpHome() }))
    try {
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      const readState = async (): Promise<{ remote: { team: string; session?: string }[]; peers: { url: string }[] }> =>
        await (await globalThis.fetch('http://127.0.0.1:' + String(port) + '/__dsh_a2a/state')).json() as { remote: { team: string; session?: string }[]; peers: { url: string }[] }
      await readState()
      for (let i = 0; i < 20; i++) {
        const state = await readState()
        if (state.peers.some(p => p.url === peer.baseUrl)) {
          // The peer was contacted; if its card carries our session label
          // the guard must have dropped it again by now.
          await new Promise(resolve => setImmediate(resolve))
          continue
        }
        await new Promise(resolve => setImmediate(resolve))
      }
      // Final check after the sweep settled: the self-labeled card is gone
      // from the store and no remote row carries its teams.
      const state = await readState()
      expect(state.remote).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })
  it('the state route lists peer-side teams as remote rows for the panel', async () => {
    const peer = await mountPeerNode()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    apply(ctx, makeConfig({ peers: [peer.baseUrl], sessionNodes: true, dshHome: tmpHome() }))
    try {
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      const readState = async (): Promise<{ remote: { team: string; name: string; origin?: string }[] }> => {
        const response = await globalThis.fetch('http://127.0.0.1:' + String(port) + '/__dsh_a2a/state')
        const text = await response.text()
        if (text === '') throw new Error('empty state body, status ' + String(response.status))
        return JSON.parse(text) as { remote: { team: string; name: string; origin?: string }[] }
      }
      // The first read kicks the background sweep and may answer empty; the
      // next picks the fresh rows up (the panel polls).
      await readState()
      for (let i = 0; i < 20; i++) {
        const state = await readState()
        // The peer row carries its origin (session label + LAN IP) so the
        // panel can group remote teams by publishing host.
        if (state.remote.some(row => row.team === "dsh" && row.origin !== undefined)) return
        await new Promise(resolve => setImmediate(resolve))
      }
      throw new Error('remote rows never appeared')
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })
  it('a2a_route connects directly to a peer node and returns its reply', async () => {
    const peer = await mountPeerNode()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: [peer.baseUrl], dshHome: tmpHome() }))
    try {
      const teams = ctx.tools.get('a2a_teams')
      const listed = await teams?.execute({}, runContext())
      expect(listed).toMatchObject({ ok: true, teams: [{ team: 'dsh', local: true }, { team: 'dsh', session: 'peer-node' }] })

      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'dsh', message: 'hello peer' }, runContext())
      expect(result).toMatchObject({ ok: true, team: 'dsh', reply: 'peer node replied' })
      expect(peer.steer).toHaveBeenCalledTimes(1)
      const steered = (peer.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
      expect(steered?.text).toContain('from "sess-1" (routed to dsh) sent:')
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })

  it('a2a_route reaches a same-host session team over the loopback candidate', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'dsh/agent-1', message: 'same-host hello' }, runContext())
      // The in-process local candidate answers with the canonical route shape.
      expect(result).toMatchObject({ ok: true, team: 'dsh/agent-1', reply: 'peer node replied' })
      expect(session.steer).toHaveBeenCalledTimes(1)
      // The steered header carries the node label when the route has no
      // calling session (runContext carries no agent); a joined caller
      // stamps its routable session team instead.
      const steered = (session.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
      expect(steered?.text).toContain('from "sess-1" (routed to dsh/agent-1) sent:')
      // The task id rides the header (receipt correlation key).
      expect(steered?.text).toMatch(/\(task direct-[0-9a-f]+\) /)
      // The status tool surfaces the completed route in the activity ring.
      const status = await ctx.tools.get('a2a_status')?.execute({}, runContext()) as { ok: boolean; activity: { dir: string; team: string; ok: boolean }[] }
      expect(status.ok).toBe(true)
      expect(status.activity.some(entry => entry.dir === 'out' && entry.team === 'dsh/agent-1' && entry.ok)).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a2a_route async delivers immediately and returns the receipt contract', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'dsh/agent-1', message: 'long task', async: true }, runContext()) as { ok: boolean; reply: string; task_status: string }
      // Delivery is the success: the delivered shape names the receipt
      // contract and never waits for the target's reply.
      expect(result.ok).toBe(true)
      expect(result.task_status).toBe('TASK_STATE_DELIVERED')
      expect(result.reply).toContain('[A2A receipt] task')
      // The steer already happened (fire-and-forget still delivers).
      expect(session.steer).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a2a_tasks registers beside the routing tools and lists an empty ledger', async () => {
    const { ctx } = await mountJoinHarness()
    try {
      const tasks = ctx.tools.get('a2a_tasks')
      expect(tasks).toBeDefined()
      await expect(tasks?.execute({}, runContext())).resolves.toMatchObject({ ok: true, tasks: [] })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a2a_route async tracks the owed task and an inbound receipt resolves it', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      const delivered = await route?.execute({ team: 'dsh/agent-1', message: 'long task', async: true }, runContext()) as { ok: boolean; task_id: string }
      expect(delivered.ok).toBe(true)
      // The owed task is queryable while the target works, keeping the
      // follow-up context id the delivered reply promised.
      const tasks = ctx.tools.get('a2a_tasks')
      await expect(tasks?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        tasks: [{ taskId: delivered.task_id, team: 'dsh/agent-1', peer: 'local', status: 'pending', contextId: expect.any(String) }],
      })
      // The target's receipt arrives as an ordinary inbound route to this
      // node's team and correlates by task id.
      const receipt = await postJson(port, '/a2a/direct', { team: 'dsh', message: `[A2A receipt] task ${String(delivered.task_id)} tests green on 0.6.0` })
      expect(receipt.status).toBe(200)
      await expect(tasks?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        // Settled rows leave the owed book for the archive — the outcome
        // stays queryable instead of being evicted by later debts.
        archive: [{ taskId: delivered.task_id, summary: 'tests green on 0.6.0' }],
        archivedTotal: 1,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a receipt relayed through the in-process candidate resolves its task', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      const delivered = await route?.execute({ team: 'dsh/agent-1', message: 'long task', async: true }, runContext()) as { ok: boolean; task_id: string }
      expect(delivered.ok).toBe(true)
      // The answered session routes its receipt back over the same-host
      // candidate: the relay correlates it before steering.
      const receipt = await route?.execute({ team: 'dsh/agent-1', message: `[A2A receipt] task ${String(delivered.task_id)} second opinion agrees` }, runContext()) as { ok: boolean }
      expect(receipt.ok).toBe(true)
      await expect(ctx.tools.get('a2a_tasks')?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        archive: [{ taskId: delivered.task_id, summary: 'second opinion agrees' }],
        archivedTotal: 1,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('the panel state route lists tasks owed a receipt until they correlate', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      const delivered = await route?.execute({ team: 'dsh/agent-1', message: 'long task', async: true }, runContext()) as { ok: boolean; task_id: string }
      expect(delivered.ok).toBe(true)
      // The panel polls the state route: the owed task rides it as a
      // pending row with its routing facts.
      const owing = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { tasks: { taskId: string; team: string; peer: string; status: string }[] }
      expect(owing.tasks).toEqual([{ taskId: delivered.task_id, team: 'dsh/agent-1', peer: 'local', status: 'pending', startedAt: expect.any(Number) }])
      // Correlation clears the pending row within one poll.
      await postJson(port, '/a2a/direct', { team: 'dsh', message: `[A2A receipt] task ${String(delivered.task_id)} tests green` })
      const settled = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { tasks: unknown[] }
      expect(settled.tasks).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a2a_probe measures reachability and latency across the tracked peers', async () => {
    const peer = await mountPeerNode()
    const { ctx } = await mountJoinHarness({ peers: [peer.baseUrl, 'http://127.0.0.1:1'] })
    try {
      const result = await ctx.tools.get('a2a_probe')?.execute({}, runContext()) as { ok: boolean; results: { url: string; reachable: boolean; ms?: number; team?: string; error?: string }[] }
      expect(result.ok).toBe(true)
      const reachable = result.results.find(entry => entry.url === peer.baseUrl)
      expect(reachable?.reachable).toBe(true)
      expect(typeof reachable?.ms).toBe('number')
      expect(reachable?.team).toBe('dsh')
      const dead = result.results.find(entry => entry.url === 'http://127.0.0.1:1')
      expect(dead?.reachable).toBe(false)
      expect(dead?.error).toContain('unreachable')
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })

  it('a2a_probe narrows to one url when given', async () => {
    const peer = await mountPeerNode()
    const { ctx } = await mountJoinHarness({ peers: [peer.baseUrl] })
    try {
      const result = await ctx.tools.get('a2a_probe')?.execute({ url: peer.baseUrl }, runContext()) as { ok: boolean; results: { url: string }[] }
      expect(result.results).toHaveLength(1)
      expect(result.results[0]?.url).toBe(peer.baseUrl)
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })

  it('a2a_probe answers an empty fleet with ok and no results', async () => {
    const { ctx } = await mountJoinHarness()
    try {
      await expect(ctx.tools.get('a2a_probe')?.execute({}, runContext())).resolves.toMatchObject({ ok: true, results: [] })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a cross-host async route owes its receipt with the peer candidate recorded', async () => {
    // A distinct team keeps the route off this host's own candidate (both
    // nodes default to 'dsh', which would answer locally and never dial).
    const peer = await mountPeerNode({ team: 'peer-team' })
    const { ctx, agents, port } = await mountJoinHarness({ peers: [peer.baseUrl] })
    try {
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      const route = ctx.tools.get('a2a_route')
      const delivered = await route?.execute({ team: 'peer-team', message: 'cross-host long task', async: true }, runContext()) as { ok: boolean; task_id: string; task_status: string }
      expect(delivered.ok).toBe(true)
      expect(delivered.task_status).toBe('TASK_STATE_DELIVERED')
      // The ledger row names the dialed peer URL — the wait:false path owes
      // its receipt exactly like the local one, with the candidate for
      // diagnosis.
      await expect(ctx.tools.get('a2a_tasks')?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        tasks: [{ taskId: delivered.task_id, team: 'peer-team', peer: peer.baseUrl, status: 'pending' }],
      })
      // The peer's receipt arrives over HTTP and correlates by task id.
      const receipt = await postJson(port, '/a2a/direct', { team: 'dsh', message: `[A2A receipt] task ${String(delivered.task_id)} cross-host green` })
      expect(receipt.status).toBe(200)
      await expect(ctx.tools.get('a2a_tasks')?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        archive: [{ taskId: delivered.task_id, summary: 'cross-host green' }],
        archivedTotal: 1,
      })
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
    }
  })
  it('a2a_route unblocks the caller when the target never replies (reply-wait deadline)', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    try {
      // A silent agent: steer delivers but never answers, so the reply wait
      // would park the caller's turn forever without the deadline.
      const silent = makeAgent()
      agents.agent = silent
      ctx.emit('agent/created', { agent: silent })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      const route = ctx.tools.get('a2a_route')
      vi.useFakeTimers()
      let result: unknown
      try {
        const pending = route?.execute({ team: 'dsh/agent-1', message: 'slow target' }, runContext()) as Promise<unknown>
        await vi.advanceTimersByTimeAsync(180_000)
        result = await pending
      } finally {
        vi.useRealTimers()
      }
      const delivered = result as { ok: boolean; team: string; reply: string; task_status: string }
      // Delivery stands on its own; the deadline releases the turn with the
      // receipt contract as the follow-up path.
      expect(delivered.ok).toBe(true)
      expect(delivered.team).toBe('dsh/agent-1')
      expect(delivered.task_status).toBe('TASK_STATE_DELIVERED')
      expect(delivered.reply).toContain('no reply arrived within 180s')
      expect(delivered.reply).toContain('[A2A receipt] task')
      expect(silent.steer).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a2a_route fails over to the next peer publishing the team when the first candidate fails', async () => {
    // Both peers publish `shared`; the first has no live agent, so its direct
    // route answers an error and the caller must fall through to the second.
    const dead = await mountPeerNode({ team: 'shared' }, false)
    const alivePeer = await mountPeerNode({ team: 'shared' })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: [dead.baseUrl, alivePeer.baseUrl], dshHome: tmpHome() }))
    try {
      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'shared', message: 'failover' }, runContext()) as { ok: boolean; reply?: string }
      expect(result.ok).toBe(true)
      expect(result.reply).toBe('peer node replied')
      expect(alivePeer.steer).toHaveBeenCalledTimes(1)
      expect(dead.steer).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      await dead.dispose()
      await alivePeer.dispose()
    }
  })

  it('a2a_route aggregates per-candidate reasons when every route fails', async () => {
    const dead = await mountPeerNode({ team: 'shared' }, false)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: [dead.baseUrl], dshHome: tmpHome() }))
    try {
      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'shared', message: 'q' }, runContext()) as { ok: boolean; code?: number; error?: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe(-32004)
      expect(result.error).toContain('failed on every candidate')
      expect(result.error).toContain('No live DSH agent')
    } finally {
      await ctx.fiber.dispose()
      await dead.dispose()
    }
  })

  it('a2a_route answers -32004 when no peer publishes the team', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    // An unreachable peer URL leaves discovery empty without throwing.
    apply(ctx, makeConfig({ peers: ['http://127.0.0.1:1'], dshHome: tmpHome() }))
    const route = ctx.tools.get('a2a_route')
    await expect(route?.execute({ team: 'ghost', message: 'q' }, runContext())).resolves.toMatchObject({
      ok: false,
      code: -32004,
    })
    await ctx.fiber.dispose()
  })

  it('discovers a second node through a seed card\'s referrals', async () => {
    const nodeB = await mountPeerNode({ team: 'analysis' })
    // Node A's store seeds B, so A's served card carries B's URL as a referral.
    const nodeA = await mountPeerNode({ team: 'team-a', peers: [nodeB.baseUrl] })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: [nodeA.baseUrl], dshHome: tmpHome() }))
    try {
      const teams = ctx.tools.get('a2a_teams')
      // The first call knows only the seed; B joins the store through A's card.
      await expect(teams?.execute({}, runContext())).resolves.toMatchObject({ ok: true, teams: [{ team: 'dsh', local: true }, { team: 'team-a' }] })
      // The referral is tracked now, so the next call fetches B too.
      await expect(teams?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        teams: [{ team: 'dsh', local: true }, { team: 'team-a' }, { team: 'analysis' }],
      })
    } finally {
      await ctx.fiber.dispose()
      await nodeA.dispose()
      await nodeB.dispose()
    }
  })

  it('keeps discovered peers across a restart through peers.json', async () => {
    const nodeB = await mountPeerNode({ team: 'analysis' })
    const nodeA = await mountPeerNode({ team: 'team-a', peers: [nodeB.baseUrl] })
    const home = tmpHome()
    const mountClient = async (): Promise<Context> => {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(TimerService)
      apply(ctx, makeConfig({ peers: [nodeA.baseUrl], dshHome: home }))
      return ctx
    }
    try {
      // One run discovers B through A's referral.
      const first = await mountClient()
      await first.tools.get('a2a_teams')?.execute({}, runContext())
      await first.fiber.dispose()
      // The restarted store restores B from disk: the first call lists both.
      const second = await mountClient()
      await expect(second.tools.get('a2a_teams')?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        teams: [{ team: 'dsh', local: true }, { team: 'team-a' }, { team: 'analysis' }],
      })
      await second.fiber.dispose()
    } finally {
      await nodeA.dispose()
      await nodeB.dispose()
    }
  })

  it('a2a_route skips a reachable peer that publishes another team', async () => {
    const nodeB = await mountPeerNode()
    const nodeA = await mountPeerNode({ team: 'team-a', peers: [nodeB.baseUrl] })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: [nodeA.baseUrl], dshHome: tmpHome() }))
    try {
      // Discover B first; the route then walks A (wrong team) before B.
      await ctx.tools.get('a2a_teams')?.execute({}, runContext())
      const result = await ctx.tools.get('a2a_route')?.execute({ team: 'dsh', message: 'hello' }, runContext())
      expect(result).toMatchObject({ ok: true, team: 'dsh', reply: 'peer node replied' })
      expect(nodeB.steer).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
      await nodeA.dispose()
      await nodeB.dispose()
    }
  })
})

describe('a2a session nodes (opt-in join)', () => {
  it('lists live sessions in the state route but mounts nothing until joined', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    const session = replyingAgent(ctx)
    ;(session.session.events as unknown[]).push({ type: 'user/message', data: { content: [{ type: 'text', text: 'help me port the parser' }], source: { kind: 'user' } } })
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await new Promise(resolve => setImmediate(resolve))
    // A child agent never shows up; the live root does, unjoined.
    ctx.emit('agent/created', { agent: { ...makeAgent(), id: SessionId('agent-2') } })
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as {
      version?: string
      sessions: { id: string; label: string; team: string; name: string; description: string; joined: boolean }[]
    }
    // The state route carries the package version (the panel's version badge).
    expect(state.version).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]).toMatchObject({
      id: 'agent-1',
      label: 'sess-1-agent-1',
      team: 'dsh/agent-1',
      name: 'sess-1-agent-1',
      description: 'help me port the parser',
      joined: false,
    })
    // Nothing joined: the announced card carries no session teams.
    const cardHome = tmpHome()
    const cardCtx = new Context()
    await cardCtx.plugin(TimerService)
    await cardCtx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await cardCtx.plugin(SystemPrompt)
    await cardCtx.plugin(ToolRuntime)
    apply(cardCtx, makeConfig({ sessionNodes: true, announce: true, dshHome: cardHome }))
    const cardPort = (cardCtx as unknown as { webServer: WebServer }).webServer.port
    expect((await (await globalThis.fetch(`http://127.0.0.1:${String(cardPort)}/.well-known/agent-card.json`)).text())).not.toContain('sessionTeams')
    await cardCtx.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('joins through the route: the card lists the session team with live facts, and direct dispatch reaches it', async () => {
    const home = tmpHome()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, announce: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    ;(session.session.events as unknown[]).push({ type: 'user/message', data: { content: [{ type: 'text', text: 'help me port the parser' }], source: { kind: 'user' } } })
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    // The card carries the joined session team with its title fallback and
    // the activity excerpt, served fresh at read time.
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as {
      sessionTeams: { team: string; name: string; description: string }[]
    }
    expect(card.sessionTeams).toEqual([{ team: 'dsh/agent-1', name: 'sess-1-agent-1', description: 'help me port the parser' }])
    // The session team dispatches direct routes to that session.
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/agent-1', message: 'direct to session' }),
    })
    await expect(response.json()).resolves.toMatchObject({ routed: true, result: { text: 'peer node replied' } })
    expect(session.steer).toHaveBeenCalledTimes(1)
    // The excerpt follows the session: a newer message is served on the
    // next card read without any re-join.
    ;(session.session.events as unknown[]).push({ type: 'user/message', data: { content: [{ type: 'text', text: 'now porting the serializer' }], source: { kind: 'user' } } })
    const refreshed = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as {
      sessionTeams: { description: string }[]
    }
    expect(refreshed.sessionTeams[0]?.description).toBe('now porting the serializer')
    // Leaving removes the team from the card and stops dispatch.
    await postJson(port, '/__dsh_a2a/leave', { id: 'agent-1' })
    const left = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()
    expect(left).not.toContain('sessionTeams')
    await ctx.fiber.dispose()
  })

  it('unregisters a joined node when its session goes away', async () => {
    const { ctx, agents, port } = await mountJoinHarness({ announce: true })
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    ctx.emit('agent/disposed', { agent: session })
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: unknown[] }
    expect(state.sessions).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('lists cold joined sessions (intent persisted, agent not back) until woken or left', async () => {
    const home = tmpHome()
    const headers: Array<{ id: ReturnType<typeof SessionId> }> = [{ id: SessionId('agent-1') }]
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    ctx.provide('sessionPersistence', {
      list: async () => [...headers],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home, stateColdRowsTtlMs: 10 }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const readState = async (): Promise<{ sessions: { id: string; joined: boolean; live?: boolean }[] }> =>
      await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: { id: string; joined: boolean; live?: boolean }[] }
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    // The host "restarts": the Agent is gone, the intent stays, and the
    // state route keeps the session visible as a cold joined row.
    ctx.emit('agent/disposed', { agent: session })
    await expect(readState()).resolves.toMatchObject({ nodes: true, sessions: [{ id: 'agent-1', label: 'sess-1-agent-1', team: 'dsh/agent-1', joined: true, live: false }] })
    // A deleted session (intent whose persistence header is gone) never lists.
    // The cold-row id set serves stale-while-revalidate: the read past the
    // 10ms TTL serves the old snapshot and kicks a background refresh, so
    // the deletion lands on a poll after the refresh settles.
    headers.length = 0
    await new Promise(resolve => setTimeout(resolve, 30))
    await vi.waitFor(async () => {
      await expect(readState()).resolves.toMatchObject({ sessions: [] })
    })
    // Leave on the cold id drops the intent without any runtime node.
    headers.push({ id: SessionId('agent-1') })
    await postJson(port, '/__dsh_a2a/leave', { id: 'agent-1' })
    await expect(readState()).resolves.toMatchObject({ sessions: [] })
    await ctx.fiber.dispose()
  })

  it('remounts the persisted intent when the session comes back (wake flow)', async () => {
    const home = tmpHome()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    apply(ctx, makeConfig({ sessionNodes: true, announce: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const first = replyingAgent(ctx)
    agents.agent = first
    ctx.emit('agent/created', { agent: first })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    ctx.emit('agent/disposed', { agent: first })
    // Waking = the session reopens: a fresh Agent for the same id remounts
    // the node with no join call, and the card serves it again.
    const second = replyingAgent(ctx)
    agents.agent = second
    ctx.emit('agent/created', { agent: second })
    await new Promise(resolve => setImmediate(resolve))
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: { id: string; joined: boolean; live?: boolean }[] }
    expect(state.sessions[0]).toMatchObject({ id: 'agent-1', joined: true, live: true })
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()
    expect(card).toContain('dsh/agent-1')
    await ctx.fiber.dispose()
  })

  it('wakes cold joined sessions on boot when wakeJoinedOnBoot is on', async () => {
    const home = tmpHome()
    const first = await (async () => {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(TimerService)
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin(FakeAgentsService)
      const agents = ctx.get('agents') as unknown as FakeAgentsService
      apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      await ctx.fiber.dispose()
      return undefined
    })()
    void first
    // The restarted host mounts with the wake face and the flag on; the
    // woken agent publishes, and the remount joins it with no join call.
    const woken = replyingAgent(new Context())
    const wokenPromise = Promise.resolve(woken)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    const materialize = vi.fn(async () => {
      ;(ctx.get('agents') as unknown as FakeAgentsService).agent = woken
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, announce: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith('agent-1') })
    await new Promise(resolve => setImmediate(resolve))
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: { id: string; joined: boolean; live?: boolean }[] }
    expect(state.sessions[0]).toMatchObject({ id: 'agent-1', joined: true, live: true })
    await ctx.fiber.dispose()
    void wokenPromise
  })

  it('wakes cold joined sessions on boot after the loader tree settles even when the api gateway mounts late (P3: apply-time snapshot)', async () => {
    const home = tmpHome()
    // First host: join one session, then die with the persisted intent.
    {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(TimerService)
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin(FakeAgentsService)
      const agents = ctx.get('agents') as unknown as FakeAgentsService
      apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      const session = replyingAgent(ctx)
      agents.agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      await ctx.fiber.dispose()
    }
    // Restarted host: a loader tree holds the wake back, and the api gateway
    // only mounts after this row applied — the pre-fix apply-time apiProxy
    // snapshot skipped the wake entirely.
    const woken = replyingAgent(new Context())
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    await ctx.plugin(FakeLoaderService)
    const loader = ctx.get('loader') as unknown as FakeLoaderService
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, dshHome: home }))
    const materialize = vi.fn(async () => woken)
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    loader.settle()
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith('agent-1') })
    await ctx.fiber.dispose()
  })

  it('runs boot wakes serially with the configured pause between them', async () => {
    const home = tmpHome()
    {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(TimerService)
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin(FakeAgentsService)
      apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      const session = replyingAgent(ctx)
      ;(ctx.get('agents') as unknown as FakeAgentsService).agent = session
      ctx.emit('agent/created', { agent: session })
      await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
      await ctx.fiber.dispose()
    }
    // Two cold joined ids: joins must persist both intents.
    const homeJoin = home
    mkdirSync(join(homeJoin, 'a2a'), { recursive: true })
    const joinedPath = join(homeJoin, 'a2a', 'joined.json')
    writeFileSync(joinedPath, JSON.stringify({ sessions: ['agent-1', 'session-2-0000-0000-0000-000000000000'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }, { id: SessionId('session-2-0000-0000-0000-000000000000') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    const events: string[] = []
    let resolveFirst: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => { resolveFirst = resolve })
    const materialize = vi.fn(async (id: string) => {
      events.push('start:' + String(id))
      if (String(id) === 'agent-1') await firstGate
      events.push('end:' + String(id))
      return makeAgent()
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, wakeBootStaggerMs: 30, dshHome: home }))
    // The first wake starts at once; the second must not start before the
    // first settles (serial) nor before the pause elapses (stagger).
    await vi.waitFor(() => { expect(events).toContain('start:agent-1') })
    expect(events.filter(e => e.startsWith('start:'))).toEqual(['start:agent-1'])
    resolveFirst?.()
    await vi.waitFor(() => { expect(events.slice(0, 3)).toEqual(['start:agent-1', 'end:agent-1', 'start:session-2-0000-0000-0000-000000000000']) })
    await ctx.fiber.dispose()
  })

  it('route wake never waits on the boot queue, and the parked boot wake skips it', async () => {
    const home = tmpHome()
    const slowId = 'session-2-0000-0000-0000-000000000000'
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: [slowId, 'agent-1'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId(slowId) }, { id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    let releaseSlow: (() => void) | undefined
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve })
    const materialize = vi.fn(async (id: string) => {
      if (String(id) === slowId) {
        await slowGate
        const slow = replyingAgent(ctx)
        ;(ctx.get('agents') as unknown as FakeAgentsService).agent = slow
        ctx.emit('agent/created', { agent: slow })
        return slow
      }
      const woken = replyingAgent(ctx)
      ;(ctx.get('agents') as unknown as FakeAgentsService).agent = woken
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    // The boot queue's first wake (slowId) is in flight and the long stagger
    // parks agent-1's boot wake — but a route addressed to agent-1 wakes it
    // at once, and when the parked boot wake finally runs it skips the id
    // the route already materialized.
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, wakeBootStaggerMs: 5_000, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith(slowId) })
    const routeResponse = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/agent-1', message: 'route wake during the stagger window', wait: false }),
    })
    const routed = await routeResponse.json() as { delivered?: boolean }
    expect(routed.delivered).toBe(true)
    expect(materialize).toHaveBeenCalledWith('agent-1')
    releaseSlow?.()
    await new Promise(resolve => setTimeout(resolve, 30))
    // agent-1 was materialized exactly once — by the route, not the queue.
    const calls = materialize.mock.calls.map(call => String(call[0]))
    expect(calls.filter(id => id === 'agent-1')).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('shares one materialization between concurrent route wakes (single-flight)', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const materialize = vi.fn(async () => {
      await gate
      const woken = replyingAgent(ctx)
      ;(ctx.get('agents') as unknown as FakeAgentsService).agent = woken
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const route = (team: string): Promise<Response> => globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team, message: 'concurrent wake', wait: false }),
    })
    // Both requests enter the handler while the wake is gated; neither
    // response can settle before the shared wake releases.
    const a = route('dsh/agent-1')
    const b = route('dsh/agent-1')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(materialize).toHaveBeenCalledTimes(1)
    release?.()
    await expect(a.then(response => response.json())).resolves.toMatchObject({ delivered: true })
    await expect(b.then(response => response.json())).resolves.toMatchObject({ delivered: true })
    expect(materialize).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('a route wake joins a boot prewarm already in flight instead of stacking a second replay', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const materialize = vi.fn(async () => {
      await gate
      const woken = replyingAgent(ctx)
      ;(ctx.get('agents') as unknown as FakeAgentsService).agent = woken
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    // The prewarm is mid-replay (gated) when the route arrives.
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledTimes(1) })
    const routed = globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/agent-1', message: 'route during prewarm', wait: false }),
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(materialize).toHaveBeenCalledTimes(1)
    release?.()
    await expect(routed.then(response => response.json())).resolves.toMatchObject({ delivered: true })
    expect(materialize).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('defers the first boot prewarm wake until wakePrewarmDelayMs elapses', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    const materialize = vi.fn(async () => makeAgent())
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, wakePrewarmDelayMs: 120, dshHome: home }))
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(materialize).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith('agent-1') })
    await ctx.fiber.dispose()
  })

  it('boot prewarm yields to a recent route demand, then resumes after the quiet window', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1', 'agent-2'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }, { id: SessionId('agent-2') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    const materialize = vi.fn(async (id: string) => {
      const woken = replyingAgent(ctx)
      ;(ctx.get('agents') as unknown as FakeAgentsService).agent = woken
      woken.id = SessionId(String(id))
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({
      sessionNodes: true,
      wakeJoinedOnBoot: true,
      wakePrewarmDelayMs: 0,
      wakePrewarmQuietMs: 400,
      wakeBootStaggerMs: 200,
      dshHome: home,
    }))
    // The first prewarm wake (agent-1) is itself the demand clock's start:
    // waking it does not count, but the route that follows does.
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith('agent-1') })
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    // agent-1 now live: a route to its team records foreground demand.
    await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/agent-1', message: 'foreground demand', wait: false }),
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    // Inside the quiet window: agent-2 stays asleep (the stagger has long
    // elapsed; only the demand yield holds it back).
    expect(materialize.mock.calls.map(call => String(call[0]))).toEqual(['agent-1'])
    // Past the window (demand 400ms old): the queue resumes. The yield
    // retry cadence is 1s, so the wait budget must exceed it.
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith('agent-2') }, { timeout: 4_000 })
    await ctx.fiber.dispose()
  })

  it('disposing the fiber mid-queue stops further boot prewarm wakes', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1', 'agent-2'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }, { id: SessionId('agent-2') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    const materialize = vi.fn(async () => makeAgent())
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    apply(ctx, makeConfig({ sessionNodes: true, wakeJoinedOnBoot: true, wakePrewarmDelayMs: 0, wakeBootStaggerMs: 200, dshHome: home }))
    await vi.waitFor(() => { expect(materialize).toHaveBeenCalledWith('agent-1') })
    await ctx.fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(materialize.mock.calls.map(call => String(call[0]))).toEqual(['agent-1'])
  })

  it('serves cold rows stale-while-revalidate: a hung enumeration never blocks the poll', async () => {
    const home = tmpHome()
    const headers: Array<{ id: ReturnType<typeof SessionId> }> = [{ id: SessionId('agent-1') }]
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    let hang = false
    let pendingRelease: (() => void) | undefined
    const list = vi.fn(async () => {
      if (!hang) return [...headers]
      await new Promise<void>(resolve => { pendingRelease = resolve })
      return [...headers]
    })
    ctx.provide('sessionPersistence', { list } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home, stateColdRowsTtlMs: 10 }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    ctx.emit('agent/disposed', { agent: session })
    const readState = async (): Promise<{ sessions: { id: string; live?: boolean }[] }> =>
      await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: { id: string; live?: boolean }[] }
    // First read seeds the snapshot (awaits the enumeration).
    await expect(readState()).resolves.toMatchObject({ sessions: [{ id: 'agent-1', live: false }] })
    // Past the TTL with the enumeration hung: the poll serves the stale
    // snapshot immediately instead of blocking on the persistence layer.
    hang = true
    headers.length = 0
    await new Promise(resolve => setTimeout(resolve, 30))
    const served = await readState()
    expect(served.sessions).toMatchObject([{ id: 'agent-1', live: false }])
    // The background refresh lands; the next read reflects the deletion.
    pendingRelease?.()
    await vi.waitFor(async () => {
      const fresh = await readState()
      expect(fresh.sessions).toEqual([])
    })
    await ctx.fiber.dispose()
  })

  it('bounds one directory sweep at six concurrent card fetches', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    const seeds = Array.from({ length: 10 }, (_unused, index) => `http://127.0.0.1:${String(9000 + index)}`)
    let inFlight = 0
    let maxInFlight = 0
    const countingFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 20))
      inFlight -= 1
      throw new Error('unreachable seed')
    })
    vi.stubGlobal('fetch', countingFetch)
    try {
      apply(ctx, makeConfig({ peers: seeds, dshHome: tmpHome() }))
      const listed = await ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string }[] }
      expect(listed.ok).toBe(true)
      expect(maxInFlight).toBeLessThanOrEqual(6)
      expect(countingFetch).toHaveBeenCalledTimes(10)
    } finally {
      vi.unstubAllGlobals()
    }
    await ctx.fiber.dispose()
  })

  it('wakes a cold joined team on route (wake-on-route), then steers the woken agent', async () => {
    const home = tmpHome()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    ctx.emit('agent/disposed', { agent: session })
    // Disposal leaves the registry: no live agent answers the team.
    agents.agent = undefined
    // The team now names a cold joined session; a route wakes it through
    // the api gateway's materialization and steers the woken agent.
    const woken = replyingAgent(ctx)
    const materialize = vi.fn(async () => {
      agents.agent = woken
      ctx.emit('agent/created', { agent: woken })
      return woken
    })
    ctx.provide('apiProxy', { materializeSession: materialize } as never)
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/agent-1', message: 'route to the cold team' }),
    })
    await expect(response.json()).resolves.toMatchObject({ routed: true, result: { text: 'peer node replied' } })
    expect(materialize).toHaveBeenCalledWith('agent-1')
    expect(woken.steer).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('does not fall a missing session team back to the live initiator (P0: silent misroute)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    // A live initiator exists, so the pre-fix code silently routed any
    // unjoined session-shaped team to it (the reported misdelivery shape).
    const initiator = replyingAgent(ctx)
    agents.agent = initiator
    ctx.emit('agent/created', { agent: initiator })
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/00000000', message: 'route to nobody' }),
    })
    await expect(response.json()).resolves.toMatchObject({
      error: 'No live DSH session node accepts team "dsh/00000000" and no cold joined session matches it.',
    })
    expect(initiator.steer).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('distinguishes imported sessions whose bare 8-char ids would collide (P2: import- id8)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    // Two imported sessions whose ids only differ past the 8th character:
    // a bare slice(0, 8) would give both the team dsh/import-5.
    const first = replyingAgent(ctx)
    const second = replyingAgent(ctx)
    const firstId = 'import-5630a8ab-1111-1111-1111-111111111111'
    const secondId = 'import-5630a8ac-2222-2222-2222-222222222222'
    Object.assign(first, { id: firstId })
    Object.assign(second, { id: secondId })
    agents.roots = vi.fn(() => [first, second])
    agents.get = vi.fn((id: unknown) => [first, second].find(a => String(a.id) === String(id))) as unknown as typeof agents.get
    ctx.emit('agent/created', { agent: first })
    ctx.emit('agent/created', { agent: second })
    const join = async (id: string): Promise<void> => {
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
      expect(response.status).toBe(200)
    }
    await join(firstId)
    await join(secondId)
    const direct = `http://127.0.0.1:${String(port)}/a2a/direct`
    const hit = async (team: string): Promise<string> => {
      const response = await globalThis.fetch(direct, {
        method: 'POST',
        body: JSON.stringify({ team, message: 'q' }),
      })
      const json = await response.json() as { routed?: boolean; result?: { text?: string } }
      return json.routed === true && json.result ? json.result.text ?? '' : ''
    }
    // Each imported session keeps its own uuid-derived team and answers it.
    expect(await hit('dsh/import-5630a8ab')).toContain('peer node replied')
    expect(await hit('dsh/import-5630a8ac')).toContain('peer node replied')
    await ctx.fiber.dispose()
  })

  it('mounts sessions that are live before the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    agents.agent = makeAgent()
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: unknown[] }
    expect(state.sessions).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('stamps the calling session label on outbound direct routes', async () => {
    const peer = await mountPeerNode()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(FakeAgentsService)
    // v0.5.24 (join-gate): the outbound caller must be a joined session node
    // (user gesture) — pre-seed the join intent, mount the caller, then route.
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    const caller = makeAgent()
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: [String(caller.id)] }), 'utf8')
    apply(ctx, makeConfig({ peers: [peer.baseUrl], dshHome: home, sessionNodes: true }))
    ;(ctx.get('agents') as unknown as FakeAgentsService).agent = caller
    ctx.emit('agent/created', { agent: caller })
    const route = ctx.tools.get('a2a_route')
    await route?.execute({ team: 'dsh', message: 'hello peer' }, { signal: new AbortController().signal, agent: caller } as unknown as ToolRunContext)
    const steered = (peer.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
    // A joined caller presents its routable team (dsh/<id8>) — not the
    // bare display label — so the receiver can answer with one a2a_route.
    expect(steered?.text).toContain('from "dsh/agent-1"')
    await ctx.fiber.dispose()
    await peer.dispose()
  })
})

describe('a2a control-route authorization', () => {
  /** A fake HTTP request pair the captured exact-route handlers accept. */
  interface FakeReq {
    method: string
    url?: string
    headers: Record<string, string>
    socket: { remoteAddress: string }
  }
  interface FakeRes {
    writeHead(status: number, headers?: Record<string, string>): FakeRes
    end(body?: string): FakeRes
    state: { status: number; body: string }
  }
  function fakeResponse(): FakeRes {
    const state = { status: 0, body: '' }
    const res = {
      writeHead(status: number) {
        state.status = status
        return res
      },
      end(body = '') {
        state.body = body
        return res
      },
      state,
    }
    return res
  }

  /** Mount the plugin against a fake web server and return its control routes. */
  async function mountControlRoutes(overrides: Partial<Config> = {}): Promise<{
    ctx: Context
    state: (req: FakeReq) => FakeRes
  }> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    const routes: { path: string; handler: (req: FakeReq, res: FakeRes) => void }[] = []
    ctx.provide('webServer', {
      register: (route: { path: string; handler: (req: FakeReq, res: FakeRes) => void }) => {
        routes.push(route)
        return () => {}
      },
    } as never)
    apply(ctx, makeConfig({ sessionNodes: true, ...overrides }))
    const stateRoute = routes.find(route => route.path === '/__dsh_a2a/state')
    if (stateRoute === undefined) throw new Error('state route not registered')
    return {
      ctx,
      state: (req: FakeReq) => {
        const res = fakeResponse()
        stateRoute.handler(req, res)
        return res
      },
    }
  }

  const request = (headers: Record<string, string>, remote = '10.9.8.7'): FakeReq => ({
    method: 'GET',
    headers,
    socket: { remoteAddress: remote },
  })

  it('trusts a user-initiated navigational request (sec-fetch-site: none)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    const routes: { path: string; handler: (req: unknown, res: unknown) => void }[] = []
    ctx.provide('webServer', {
      register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => {
        routes.push(route)
        return () => {}
      },
    } as never)
    apply(ctx, makeConfig({ sessionNodes: true }))
    const stateRoute = routes.find(route => route.path === '/__dsh_a2a/state')
    if (stateRoute === undefined) throw new Error('state route missing')
    const res = {
      status: 0,
      writeHead(code: number) { this.status = code; return this },
      end() { return this },
    }
    stateRoute.handler({ method: 'GET', headers: { 'sec-fetch-site': 'none' }, socket: { remoteAddress: '10.0.0.9' } }, res)
    expect(res.status).toBe(200)
    await ctx.fiber.dispose()
  })

  it('answers 413 to an oversized control body (never connection-killed)', async () => {
    const { ctx, port } = await mountJoinHarness()
    const oversized = 'x'.repeat(11_000)
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST',
      body: oversized,
    })
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
    await ctx.fiber.dispose()
  })

  it('answers 400 to a malformed control body', async () => {
    const { ctx, port } = await mountJoinHarness()
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST',
      body: 'not json',
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'malformed body' })
    await ctx.fiber.dispose()
  })

  it('trusts a request whose Origin matches the Host over real HTTP', async () => {
    const { ctx, port } = await mountJoinHarness()
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`, {
      headers: { Origin: `http://127.0.0.1:${String(port)}`, Host: `127.0.0.1:${String(port)}` },
    })
    expect(response.status).toBe(200)
    await ctx.fiber.dispose()
  })

  it('rejects a cross-site caller without a key and accepts same-origin', async () => {
    const { ctx, state } = await mountControlRoutes()
    const denied = state(request({ 'sec-fetch-site': 'cross-site' }))
    expect(denied.state.status).toBe(403)
    expect(denied.state.body).toContain('untrusted origin')
    const allowed = state(request({ 'sec-fetch-site': 'same-origin' }))
    expect(allowed.state.status).toBe(200)
    await ctx.fiber.dispose()
  })

  it('accepts a loopback caller without browser headers', async () => {
    const { ctx, state } = await mountControlRoutes()
    const allowed = state(request({}, '127.0.0.1'))
    expect(allowed.state.status).toBe(200)
    const v6 = state(request({}, '::1'))
    expect(v6.state.status).toBe(200)
    await ctx.fiber.dispose()
  })

  it('requires the API key once configured: header or query, constant-time compared', async () => {
    const { ctx, state } = await mountControlRoutes({ apiKey: 'sekrit' })
    const noKey = state(request({ 'sec-fetch-site': 'same-origin' }))
    expect(noKey.state.status).toBe(401)
    const wrongKey = state(request({ 'x-api-key': 'nope' }))
    expect(wrongKey.state.status).toBe(401)
    const viaHeader = state(request({ 'x-api-key': 'sekrit' }))
    expect(viaHeader.state.status).toBe(200)
    const stateRoute = request({ 'sec-fetch-site': 'same-origin' })
    stateRoute.url = '/__dsh_a2a/state?api_key=sekrit'
    const viaQuery = state(stateRoute)
    expect(viaQuery.state.status).toBe(200)
    // The key outranks loopback: a local caller still needs it.
    const loopbackNoKey = state(request({}, '127.0.0.1'))
    expect(loopbackNoKey.state.status).toBe(401)
    await ctx.fiber.dispose()
  })

  it('guards join and leave with the same rule over real HTTP', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, apiKey: 'sekrit', dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    const denied = await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    expect(denied.status).toBe(401)
    const allowed = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST',
      headers: { 'X-API-Key': 'sekrit' },
      body: JSON.stringify({ id: 'agent-1' }),
    })
    await expect(allowed.json()).resolves.toMatchObject({ id: 'agent-1' })
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`, { headers: { 'X-API-Key': 'sekrit' } })).json() as { sessions: { joined: boolean }[] }
    expect(state.sessions[0]?.joined).toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('a2a plugin module surface', () => {
  it('materializes every default', () => {
    const resolved = ConfigSchema({} as never)
    expect(resolved).toEqual({
      apiKey: '',
      session: '',
      asyncNudgeDelayMs: 120_000,
      team: 'dsh',
      announce: false,
      agentName: 'DeepSeek Harness A2A node',
      peers: [],
      delegates: [],
      sessionNodes: true,
      wakeJoinedOnBoot: false,
      wakePrewarmDelayMs: 10_000,
      wakePrewarmQuietMs: 5_000,
      wakeBootStaggerMs: 3_000,
      stateColdRowsTtlMs: 5_000,
      cardCacheTtlMs: 60_000,
      cardCacheNegativeTtlMs: 30_000,
      remoteRowsTtlMs: 15_000,
      dshHome: '',
      cardTtlMs: 172_800_000,
      flushTimeoutMs: 300_000,
      routeTimeoutMs: 1_800_000,
      nativeTeamsInbound: false,
      nativeRoundWaitMs: 180_000,
    })
  })
})

describe('a2a plugin outbound tools', () => {
  it('executes a2a_route with the configured budget and renders both outcomes', async () => {
    const peer = await mountPeerNode()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: [peer.baseUrl], dshHome: tmpHome() }))
    const route: ToolDefinition | undefined = ctx.tools.get('a2a_route')
    expect(route?.timeoutMs).toBe(60_000)
    await expect(route?.execute({ team: 'dsh', message: 'q' }, runContext())).resolves.toMatchObject({
      ok: true,
      team: 'dsh',
      reply: 'peer node replied',
    })
    const okRender = route?.output.render({}, {
      ok: true, team: 'research', reply: 'reply body', task_id: 'task-1', context_id: 'ctx-1', task_status: 'TASK_STATE_COMPLETED',
    }) ?? []
    expect(okRender).toEqual([{
      type: 'text',
      text: 'Team research replied (task task-1, status TASK_STATE_COMPLETED, context ctx-1):\nreply body',
    }])
    const errorRender = route?.output.render({}, { ok: false, error: 'peer down', code: -32000 }) ?? []
    expect(errorRender).toEqual([{ type: 'text', text: 'A2A route failed (code -32000): peer down' }])
    const codelessRender = route?.output.render({}, { ok: false, error: 'boom' }) ?? []
    expect(codelessRender).toEqual([{ type: 'text', text: 'A2A route failed: boom' }])
    expect(route?.presentCall?.({ team: 'research', message: 'm' })).toEqual({ card: 'generic', title: 'A2A route → research', kind: 'other', rawInput: { team: 'research', message: 'm' } })
    await ctx.fiber.dispose()
    await peer.dispose()
  })

  it('renders the a2a_teams listing with activity excerpts', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig())
    const teams = ctx.tools.get('a2a_teams')
    const empty = teams?.output.render({}, { ok: true, teams: [] }) ?? []
    expect(empty).toEqual([{ type: 'text', text: 'No A2A teams are currently reachable.' }])
    const listed = teams?.output.render({}, {
      ok: true,
      teams: [
        { team: 'dsh', session: 'this-host', name: 'Home', description: '', local: true },
        { team: 'dsh', session: 'peer-a', name: 'Peer A', description: '' },
        { team: 'dsh/abcd1234', session: 'peer-a', name: 'Porting', description: 'porting the parser' },
      ],
    }) ?? []
    expect(listed).toEqual([{
      type: 'text',
      text: '- dsh [this host] (Home)\n- dsh (Peer A)\n- dsh/abcd1234 (Porting) — porting the parser',
    }])
    await ctx.fiber.dispose()
  })

  it('renders the a2a_probe report with a health summary and per-peer rows', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig())
    const probe = ctx.tools.get('a2a_probe')
    const empty = probe?.output.render({}, { ok: true, results: [] }) ?? []
    expect(empty).toEqual([{ type: 'text', text: 'No peers are tracked; add seeds or let referrals arrive.' }])
    const mixed = probe?.output.render({}, {
      ok: true,
      results: [
        { url: 'http://peer:1', reachable: true, ms: 42, team: 'dsh' },
        { url: 'http://gone:1', reachable: false, ms: 3, error: 'unreachable: ECONNREFUSED' },
      ],
    }) ?? []
    expect(mixed).toEqual([{
      type: 'text',
      text: [
        'Fleet probe (2): 1 reachable, 1 down',
        '  ✓ http://peer:1 (team dsh, 42ms)',
        '  ✗ http://gone:1 (unreachable: ECONNREFUSED)',
      ].join('\n'),
    }])
    await ctx.fiber.dispose()
  })

  it('renders the a2a_tasks ledger in tiers: owed ages, follow-up contexts, dead-letters, archive', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig())
    const tasks = ctx.tools.get('a2a_tasks')
    const empty = tasks?.output.render({}, { ok: true, tasks: [], archive: [], archivedTotal: 0 }) ?? []
    expect(empty).toEqual([{ type: 'text', text: 'No routed tasks are owed a receipt.' }])
    const now = Date.now()
    const listed = tasks?.output.render({}, {
      ok: true,
      tasks: [
        { taskId: 'direct-aa', team: 'research', peer: 'http://peer:1', startedAt: now - 2 * 60_000, contextId: 'ctx-1', status: 'pending' },
        { taskId: 'direct-cc', team: 'research', peer: 'http://peer:2', startedAt: now - 2 * 60 * 60_000, contextId: 'ctx-2', status: 'pending' },
        { taskId: 'direct-dd', team: 'dsh', peer: 'local', startedAt: now - 25 * 60 * 60_000, status: 'dead', deadAt: now - 60_000 },
      ],
      archive: [
        { taskId: 'direct-bb', team: 'dsh', startedAt: now - 4 * 60_000, resolvedAt: now - 60_000, summary: 'tests green' },
      ],
      archivedTotal: 7,
    }) ?? []
    expect(listed).toEqual([{
      type: 'text',
      text: [
        'Owed receipts:',
        '  - direct-aa → research (via http://peer:1), waiting 2m, follow-up context ctx-1',
        '  - direct-cc → research (via http://peer:2), waiting 2h, follow-up context ctx-2, still no receipt — the target may be gone; probe it or follow up with the context id',
        'Dead-lettered (auto-flagged past the stale TTL; a revived target can still settle with a late receipt):',
        '  - direct-dd → dsh (via this host), dispatched 25h ago',
        'Archived (7), most recent first:',
        '  - direct-bb → dsh: after 3m, tests green',
        '  (+6 older not shown)',
      ].join('\n'),
    }])
    await ctx.fiber.dispose()
  })

})

describe('a2a persisted join intent', () => {
  it('remounts a joined session team when its agent is recreated', async () => {
    const home = tmpHome()
    const { ctx, agents, port } = await mountJoinHarness({ announce: true, dshHome: home })
    const first = replyingAgent(ctx)
    agents.agent = first
    ctx.emit('agent/created', { agent: first })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    // Disposal unmounts the runtime node but keeps the intent: the team is
    // still advertised — as COLD (its routes are wake-on-route's to honor),
    // which is what keeps it discoverable cross-node while asleep.
    ctx.emit('agent/disposed', { agent: first })
    const afterDispose = JSON.parse(await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()) as {
      sessionTeams: { team: string; description: string }[]
    }
    expect(afterDispose.sessionTeams).toEqual([{ team: 'dsh/agent-1', name: 'sess-1-agent-1', description: 'cold — not loaded; routing here wakes the session' }])
    // The agent comes back: the intent remounts the node and its card team
    // goes live again.
    const second = replyingAgent(ctx)
    agents.agent = second
    ctx.emit('agent/created', { agent: second })
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as {
      sessionTeams: { team: string }[]
    }
    expect(card.sessionTeams).toEqual([{ team: 'dsh/agent-1', name: 'sess-1-agent-1', description: 'no activity yet' }])
    // The recreated session dispatches direct routes on its team.
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh/agent-1', message: 'remounted?' }),
    })
    await expect(response.json()).resolves.toMatchObject({ routed: true, result: { text: 'peer node replied' } })
    expect(second.steer).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('leave removes the intent — no remount on agent recreation', async () => {
    const { ctx, agents, port } = await mountJoinHarness({ announce: true })
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    await postJson(port, '/__dsh_a2a/leave', { id: 'agent-1' })
    ctx.emit('agent/disposed', { agent: session })
    const second = replyingAgent(ctx)
    agents.agent = second
    ctx.emit('agent/created', { agent: second })
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()
    expect(card).not.toContain('sessionTeams')
    await ctx.fiber.dispose()
  })
})

describe('a2a schedule seam', () => {
  it('fails closed when the timer service is gone during teardown', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.fiber.dispose()
    // After disposal the timer service rejects arming: the seam returns a
    // no-op disposer instead of throwing into the teardown path.
    const schedule: A2aSchedule = (callback, delayMs) => {
      try {
        return ctx.timer.timeout(callback, delayMs)
      } catch {
        return () => {}
      }
    }
    let fired = false
    schedule(() => { fired = true }, 1)()
    expect(fired).toBe(false)
  })
})

describe('a2a loader-settled card route', () => {
  it('defers the direct endpoint until the loader tree settles', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    await ctx.plugin(FakeLoaderService)
    const loader = ctx.get('loader') as unknown as FakeLoaderService
    apply(ctx, makeConfig({ dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const probe = globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh', message: 'q' }),
    })
    loader.settle()
    const response = await probe
    await expect(response.json()).resolves.toMatchObject({ error: 'No live DSH agent is available to accept this message.' })
    await ctx.fiber.dispose()
  })
})

describe('a2a removal-regression edges', () => {
  it('joins an unknown id with 404 and a non-string leave id with a quiet 200', async () => {
    const { ctx, port } = await mountJoinHarness()
    const unknown = await postJson(port, '/__dsh_a2a/join', { id: 'ghost' })
    expect(unknown.status).toBe(404)
    const badLeave = await postJson(port, '/__dsh_a2a/leave', { id: 7 })
    await expect(badLeave.json()).resolves.toMatchObject({ id: '' })
    await ctx.fiber.dispose()
  })

  it('answers 404 to a join body whose id is not a string', async () => {
    const { ctx, port } = await mountJoinHarness()
    const badId = await postJson(port, '/__dsh_a2a/join', { id: 7 })
    expect(badId.status).toBe(404)
    await ctx.fiber.dispose()
  })

  it('serves signed delegate records on the announced card', async () => {
    const { ctx, agents, port } = await mountJoinHarness({ announce: true, delegates: [{ name: 'solo', url: 'http://10.0.0.2:1', publicKey: '' }] })
    agents.agent = makeAgent()
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as {
      records: { type: string; name: string }[]
    }
    expect(card.records).toEqual([{ type: 'delegate', name: 'solo', url: 'http://10.0.0.2:1' }])
    await ctx.fiber.dispose()
  })

  it('remounts on plugin remount over a persisted intent', async () => {
    const home = tmpHome()
    const first = await mountJoinHarness({ dshHome: home })
    const session = replyingAgent(first.ctx)
    first.agents.agent = session
    first.ctx.emit('agent/created', { agent: session })
    await postJson(first.port, '/__dsh_a2a/join', { id: 'agent-1' })
    await first.ctx.fiber.dispose()
    // A fresh plugin over the same home and a pre-live session remounts.
    const second = await mountJoinHarness({ dshHome: home })
    const revived = replyingAgent(second.ctx)
    second.agents.agent = revived
    second.ctx.emit('agent/created', { agent: revived })
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(second.port)}/__dsh_a2a/state`)).json() as { sessions: { joined: boolean }[] }
    expect(state.sessions[0]?.joined).toBe(true)
    await second.ctx.fiber.dispose()
  })

  it('derives the description from the newest text, filtering holes and non-text blocks', async () => {
    const { ctx, agents, port } = await mountJoinHarness({ announce: true })
    const session = replyingAgent(ctx)
    ;(session.session.events as unknown[]).push(
      { type: 'user/message', data: { content: [{ type: 'tool-call', id: 't', name: 'n', arguments: '' } as never], source: { kind: 'user' } } },
      undefined,
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '  ported   the parser   already  ' }] } } },
      { type: 'turn/start', data: {} },
    )
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as {
      sessionTeams: { description: string }[]
    }
    expect(card.sessionTeams[0]?.description).toBe('ported the parser already')
    await ctx.fiber.dispose()
  })

  it('bounds the recent-activity scan for textless huge logs (memoized, no full walk)', async () => {
    const { ctx, agents, port } = await mountJoinHarness({ announce: true })
    const session = replyingAgent(ctx)
    // 5000 non-text events: the backward scan must stop at its limit and
    // answer the placeholder, then the memo serves repeats.
    const filler = { type: 'turn/start', data: {} }
    ;(session.session.events as unknown[]).push(...Array.from({ length: 5_000 }, () => filler))
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    const readCard = async (): Promise<string> => (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()
    await expect(readCard()).resolves.toContain('no activity yet')
    // A text landing in the tail window invalidates the memo on the next serve.
    ;(session.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'fresh tail text' }] } } })
    await expect(readCard()).resolves.toContain('fresh tail text')
    await ctx.fiber.dispose()
  })

  it('serves the memoized description when the log has not grown', async () => {
    const { ctx, agents, port } = await mountJoinHarness({ announce: true })
    const session = replyingAgent(ctx)
    ;(session.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'stable line' }] } } })
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    const readCard = async (): Promise<{ sessionTeams: { description: string }[] }> =>
      await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as { sessionTeams: { description: string }[] }
    const first = await readCard()
    expect(first.sessionTeams[0]?.description).toBe('stable line')
    const second = await readCard()
    expect(second.sessionTeams[0]?.description).toBe('stable line')
    await ctx.fiber.dispose()
  })

  it('answers a steer rejection from the direct endpoint with the failure text', async () => {
    const { ctx, agents, port } = await mountJoinHarness()
    const session = makeAgent()
    session.steer = vi.fn(() => { throw new Error('inbox closed') })
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team: 'dsh', message: 'q' }),
    })
    await expect(response.json()).resolves.toMatchObject({ error: 'The DSH session rejected the message: Error: inbox closed' })
    await ctx.fiber.dispose()
  })
})

describe('a2a node facts title source', () => {
  /** Fake session-title service: a fixed snapshot for any session, counting calls. */
  class FakeSessionTitleService extends Service {
    calls = 0

    constructor(ctx: Context) {
      super(ctx, 'sessionTitle')
    }

    get(): { title: string } {
      this.calls += 1
      return { title: 'Parser porting session' }
    }
  }

  it('uses the session title as the node fact name when the title service is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    await ctx.plugin(FakeSessionTitleService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, announce: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as {
      sessionTeams: { name: string }[]
    }
    expect(card.sessionTeams[0]?.name).toBe('Parser porting session')
    await ctx.fiber.dispose()
  })

  it('memoizes the title per agent: the title service is derived once per log state', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    await ctx.plugin(FakeSessionTitleService)
    const title = ctx.get('sessionTitle') as unknown as FakeSessionTitleService
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, announce: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    const readCard = async (): Promise<{ sessionTeams: { name: string }[] }> =>
      await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as { sessionTeams: { name: string }[] }
    await readCard()
    await readCard()
    // Two serves over an unchanged log: one derivation.
    expect(title.calls).toBe(1)
    // The log grows: the next serve re-derives the title.
    ;(session.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'new turn' }] } } })
    await readCard()
    expect(title.calls).toBe(2)
    await ctx.fiber.dispose()
  })

  it('does not pin a transient undefined title: the service is retried on the next serve', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    // The title service answers undefined once (cold wake), then the real title.
    let answer: string | undefined = undefined
    class FlakyTitleService extends Service {
      calls = 0
      constructor(ctx2: Context) { super(ctx2, 'sessionTitle') }
      get(): { title?: string } {
        this.calls += 1
        const t = answer
        return t === undefined ? {} : { title: t }
      }
    }
    await ctx.plugin(FlakyTitleService)
    const flaky = ctx.get('sessionTitle') as unknown as FlakyTitleService
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    apply(ctx, makeConfig({ sessionNodes: true, announce: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const session = replyingAgent(ctx)
    agents.agent = session
    ctx.emit('agent/created', { agent: session })
    await postJson(port, '/__dsh_a2a/join', { id: 'agent-1' })
    const readCard = async (): Promise<{ sessionTeams: { name: string }[] }> =>
      await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).json() as { sessionTeams: { name: string }[] }
    await readCard()
    expect(flaky.calls).toBe(1)
    // The service recovers: the unchanged log still re-reads (undefined is
    // never pinned), so the next serve carries the real title.
    answer = 'Recovered title'
    const second = await readCard()
    expect(second.sessionTeams[0]?.name).toBe('Recovered title')
    expect(flaky.calls).toBe(2)
    await ctx.fiber.dispose()
  })
})

describe('a2a plugin archive pruning (archived sessions leave the network)', () => {
  const archivedId = 'session-archiv01-0000-0000-0000-000000000000'
  const writeJoined = (home: string, ids: string[]): void => {
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ids }))
  }
  const readJoined = (home: string): string[] =>
    JSON.parse(readFileSync(join(home, 'a2a', 'joined.json'), 'utf8')).sessions

  it('prunes the join intent at boot when the registry reports the session archived', async () => {
    const home = tmpHome()
    writeJoined(home, [archivedId])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId(archivedId) }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    ctx.provide('workspaceRegistry', { archivedSessionIds: [archivedId] })
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    // Boot settlement pruned the intent: no cold row, and the durable
    // joined.json lost the id with it.
    const state = await (await globalThis.fetch('http://127.0.0.1:' + String(port) + '/__dsh_a2a/state')).json() as { sessions: unknown[] }
    expect(state.sessions).toEqual([])
    expect(readJoined(home)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('prunes on state reads when the archive happens mid-session', async () => {
    const home = tmpHome()
    writeJoined(home, [archivedId])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId(archivedId) }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    const archived: string[] = []
    ctx.provide('workspaceRegistry', { get archivedSessionIds(): readonly string[] { return archived } })
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const readState = async (): Promise<{ sessions: { id: string; live?: boolean }[] }> =>
      await (await globalThis.fetch('http://127.0.0.1:' + String(port) + '/__dsh_a2a/state')).json() as { sessions: { id: string; live?: boolean }[] }
    // Before the archive the cold joined row is listed as usual.
    await expect(readState()).resolves.toMatchObject({ sessions: [{ id: archivedId, joined: true, live: false }] })
    // The registry flips mid-session; the next panel poll prunes the row
    // and the durable intent together.
    archived.push(archivedId)
    await expect(readState()).resolves.toMatchObject({ sessions: [] })
    expect(readJoined(home)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('never lists an archived live session as a join-surface row, joined or not', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const session = replyingAgent(ctx)
    agents.agent = session
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: tmpHome() }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    ctx.emit('agent/created', { agent: session })
    const readState = async (): Promise<{ sessions: { id: string }[] }> =>
      await (await globalThis.fetch('http://127.0.0.1:' + String(port) + '/__dsh_a2a/state')).json() as { sessions: { id: string }[] }
    // A live, never-joined root lists as the join surface normally.
    await expect(readState()).resolves.toMatchObject({ sessions: [{ id: 'agent-1', live: true, joined: false }] })
    // The registry reports it archived mid-session: archive is closure, so
    // the panel must stop listing it within one poll — no join was ever
    // involved, only the listing filter stands.
    ctx.provide('workspaceRegistry', { archivedSessionIds: ['agent-1'] })
    await expect(readState()).resolves.toMatchObject({ sessions: [] })
    await ctx.fiber.dispose()
  })
  it('never wakes an archived cold target: the async route fails without materializing', async () => {
    const home = tmpHome()
    writeJoined(home, [archivedId])
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
    // The registry mounts after apply: boot pruning saw no registry and
    // kept the intent, so only the route-time guard stands between the
    // archived id and a wake.
    ctx.provide('workspaceRegistry', { archivedSessionIds: [archivedId] })
    const materializeSession = vi.fn(() => new Promise<ReturnType<typeof makeAgent>>(() => {}))
    ctx.provide('apiProxy', { materializeSession })
    const route = ctx.tools.get('a2a_route')
    const result = await route?.execute({ team: 'dsh/archiv01', message: 'hello', async: true }, runContext()) as { ok: boolean; error?: string }
    // Archive is closure: the route answers the honest no-acceptor error
    // and the api gateway is never asked to materialize the session.
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No live DSH session node accepts team')
    expect(materializeSession).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('idempotency window observability (0.5.36)', () => {
  it('the state route exposes the idempotency aggregate; counters move on real traffic', async () => {
    const { ctx, port } = await mountJoinHarness()
    try {
      const fetchState = async () => (await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as {
        idempotency?: { window: number; cap: number; pending: number; settled: number; claimsFresh: number; replays: number; conflicts: number }
      }).idempotency
      // Fresh boot: empty window, zeroed cumulative counters.
      await expect(fetchState()).resolves.toMatchObject({
        window: 0, cap: 256, pending: 0, settled: 0, claimsFresh: 0, replays: 0, conflicts: 0,
      })
      const pinned = JSON.stringify({ team: 'dsh/agent-1', message: 'pin me', caller_session: 'sess-1', task_id: 'obs-task' })
      const p1 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      expect(p1.status).toBe(200)
      const p2 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      expect(p2.status).toBe(409)
      // Tampered payload on the same key: the conflict verdict counts too.
      const p3 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh/agent-1', message: 'tampered payload', caller_session: 'sess-1', task_id: 'obs-task' }),
      })
      expect(p3.status).toBe(409)
      await expect(fetchState()).resolves.toMatchObject({
        window: 1, cap: 256, claimsFresh: 1, replays: 1, conflicts: 1,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a2a_status carries the idempotency segment', async () => {
    const { ctx } = await mountJoinHarness()
    try {
      const status = await ctx.tools.get('a2a_status')?.execute({}, runContext()) as {
        ok: boolean
        idempotency?: { window: number; cap: number; pending: number; settled: number; claimsFresh: number; replays: number; conflicts: number }
      }
      expect(status.ok).toBe(true)
      expect(status.idempotency).toMatchObject({ window: 0, cap: 256, pending: 0, settled: 0, claimsFresh: 0, replays: 0, conflicts: 0 })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
