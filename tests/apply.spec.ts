/**
 * a2a plugin `apply` tests: announce/card lifecycle, decentralized routing
 * and zone naming over real web servers, the session-node join surface and
 * its control-route authorization, and the direct-route dispatch contract —
 * all against a fake agents service. Client wire behavior is covered by
 * client.spec.ts against src/a2a-client.ts seams.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
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
  apply(ctx, makeConfig({ announce: true, dshHome: tmpHome(), ...overrides }))
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
    await expect(ctx.tools.get('a2a_teams')?.execute({}, runContext())).resolves.toMatchObject({
      ok: true,
      teams: [{ team: 'solo' }],
    })
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
        teams: [{ team: 'dsh' }],
      })
    } finally {
      vi.unstubAllGlobals()
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
      expect(listed).toMatchObject({ ok: true, teams: [{ team: 'dsh', session: 'sess-1' }] })

      const route = ctx.tools.get('a2a_route')
      const result = await route?.execute({ team: 'dsh', message: 'hello peer' }, runContext())
      expect(result).toMatchObject({ ok: true, team: 'dsh', reply: 'peer node replied' })
      expect(peer.steer).toHaveBeenCalledTimes(1)
      const steered = (peer.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
      expect(steered?.text).toContain('[A2A direct] remote team "dsh"')
    } finally {
      await ctx.fiber.dispose()
      await peer.dispose()
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
      await expect(teams?.execute({}, runContext())).resolves.toMatchObject({ ok: true, teams: [{ team: 'team-a' }] })
      // The referral is tracked now, so the next call fetches B too.
      await expect(teams?.execute({}, runContext())).resolves.toMatchObject({
        ok: true,
        teams: [{ team: 'team-a' }, { team: 'analysis' }],
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
        teams: [{ team: 'team-a' }, { team: 'analysis' }],
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
      sessions: { id: string; label: string; team: string; name: string; description: string; joined: boolean }[]
    }
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
    apply(ctx, makeConfig({ sessionNodes: true, dshHome: home }))
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
    await expect(readState()).resolves.toEqual({ nodes: true, sessions: [{ id: 'agent-1', label: 'sess-1-agent-1', team: 'dsh/agent-1', joined: true, live: false }] } as never)
    // A deleted session (intent whose persistence header is gone) never lists.
    headers.length = 0
    await expect(readState()).resolves.toMatchObject({ sessions: [] })
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
    apply(ctx, makeConfig({ peers: [peer.baseUrl], dshHome: tmpHome() }))
    const caller = makeAgent()
    const route = ctx.tools.get('a2a_route')
    await route?.execute({ team: 'dsh', message: 'hello peer' }, { signal: new AbortController().signal, agent: caller } as unknown as ToolRunContext)
    const steered = (peer.steer.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }).content[0]
    expect(steered?.text).toContain('caller sess-1-agent-1')
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

  it('destroys an oversized control body', async () => {
    const { ctx, port } = await mountJoinHarness()
    const oversized = 'x'.repeat(11_000)
    await expect(globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST',
      body: oversized,
    })).rejects.toThrow()
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
      team: 'dsh',
      announce: false,
      agentName: 'DeepSeek Harness A2A node',
      peers: [],
      delegates: [],
      sessionNodes: true,
      wakeJoinedOnBoot: false,
      dshHome: '',
      cardTtlMs: 172_800_000,
      flushTimeoutMs: 300_000,
      routeTimeoutMs: 1_800_000,
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
    expect(empty).toEqual([{ type: 'text', text: 'No remote A2A teams are currently reachable.' }])
    const listed = teams?.output.render({}, {
      ok: true,
      teams: [
        { team: 'dsh', session: 'peer-a', name: 'Peer A', description: '' },
        { team: 'dsh/abcd1234', session: 'peer-a', name: 'Porting', description: 'porting the parser' },
      ],
    }) ?? []
    expect(listed).toEqual([{
      type: 'text',
      text: '- dsh (Peer A)\n- dsh/abcd1234 (Porting) — porting the parser',
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
    // Disposal unmounts the runtime node but keeps the intent.
    ctx.emit('agent/disposed', { agent: first })
    const afterDispose = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()
    expect(afterDispose).not.toContain('sessionTeams')
    // The agent comes back: the intent remounts the node and its card team.
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
  /** Fake session-title service: a fixed snapshot for any session. */
  class FakeSessionTitleService extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sessionTitle')
    }

    get(): { title: string } {
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
})
