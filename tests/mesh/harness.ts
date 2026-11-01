/**
 * Cross-machine mesh harness: N REAL plugin nodes over REAL HTTP, each with
 * its own DSH home (own Ed25519 node key, own peers.json), plus ghost-node
 * primitives for wire-level fault injection. A loopback mesh is faithful to
 * the cross-machine protocol path — separate homes, separate keys, real
 * signed cards, real sockets — which is exactly the depth the wire layer
 * (one node + fake or stubbed peers) cannot see. Layer contract:
 * docs/testing-layers.md.
 */
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import * as net from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { signCard, encodePublicKey } from '../../src/card.ts'
import type { A2aPeerCard } from '../../src/types.ts'
import { apply, type Config } from '../../src/index.ts'

/** Fake agents registry: one recoverable root agent or none. */
export class FakeAgentsService extends Service {
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

export type ReplyFn = (message: string, caller: string) => string

export interface MeshNodeOptions extends Partial<Config> {
  /** Card name and default home/session/team label base. */
  name: string
  /** Distinct signed session label: two nodes sharing one label look like one identity to gossip. */
  session: string
  /** The process team this node publishes on its card. */
  team: string
  /** Seed peer base URLs (config-time; use reserved ports for mutual links). */
  peers?: string[]
  /** Listen host; use '0.0.0.0' when a test reaches this node under several loopback spellings. */
  host?: string
  /** Fixed listen port (pair with {@link reservePort} for mutual seeds). */
  port?: number
  /** Reuse a home directory (key + peers.json survive restarts). */
  home?: string
  /** This node's agent reply behavior; defaults to `ok from <name>: <message>`. */
  reply?: ReplyFn
  /** The fake agent's session id (default session-0123456789abcdef): two hosts need distinct ones to tell their sessions apart. */
  agentId?: string
}

export interface MeshNode {
  name: string
  session: string
  team: string
  baseUrl: string
  port: number
  home: string
  ctx: Context
  agents: FakeAgentsService
  /** Swap the live agent's reply behavior after boot. */
  setReply(reply: ReplyFn): void
  /** Every steered payload this node's agent has received, in order. */
  steered: unknown[]
  dispose(): Promise<void>
}

/** Fresh per-node DSH home so keygen and peers.json never touch the developer's home. */
export function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-a2a-mesh-'))
}

/**
 * Pre-create a node's Ed25519 key at the exact path announce reads, so a
 * test can know the node's public key BEFORE the delegating node boots
 * (zone delegation binds the delegate's key inside its own config).
 */
export function preseedNodeKey(home: string): string {
  const pemPath = join(home, 'a2a', 'node-key.pem')
  if (!existsSync(pemPath)) {
    const { privateKey } = generateKeyPairSync('ed25519')
    mkdirSync(dirname(pemPath), { recursive: true })
    writeFileSync(pemPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  }
  const privateKey = createPrivateKey(readFileSync(pemPath, 'utf8'))
  return encodePublicKey(createPublicKey(privateKey))
}

/** A tool-run context with an abort signal; pass the node's live agent when
 * the test exercises the caller-label/receipt contract (a route from a real
 * initiating session resolves a routable callback address). */
export function runContext(agent?: Agent): ToolRunContext {
  return { signal: new AbortController().signal, ...(agent !== undefined ? { agent } : {}) } as unknown as ToolRunContext
}

/** Reserve one ephemeral port by binding and releasing it (tiny race, retried by listen failures). */
export async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as net.AddressInfo
      probe.close(() => resolve(address.port))
    })
  })
}

/** Extract comparable text from a steer payload (string or structured object). */
export function steerText(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload)
}

/** Mesh-wide timing defaults: fast card-cache churn so fault and recovery windows stay short. */
const MESH_TIMING: Partial<Config> = {
  cardCacheTtlMs: 60,
  cardCacheNegativeTtlMs: 40,
  remoteRowsTtlMs: 100,
  routeTimeoutMs: 4_000,
  flushTimeoutMs: 4_000,
}

/**
 * Full parsed-config defaults (apply receives post-schema config; a plain
 * object must carry every defaulted field, mirroring wire/apply.spec.ts's
 * makeConfig) plus the mesh timing knobs.
 */
function meshConfig(options: MeshNodeOptions): Config {
  return {
    apiKey: '',
    session: options.session,
    team: options.team,
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: options.name,
    peers: options.peers ?? [],
    delegates: options.delegates ?? [],
    peerAllowlist: options.peerAllowlist ?? [],
    referralLearning: options.referralLearning ?? true,
    sessionNodes: options.sessionNodes ?? false,
    wakeJoinedOnBoot: options.wakeJoinedOnBoot ?? false,
    wakePrewarmDelayMs: options.wakePrewarmDelayMs ?? 0,
    wakePrewarmQuietMs: options.wakePrewarmQuietMs ?? 0,
    wakeBootStaggerMs: options.wakeBootStaggerMs ?? 3_000,
    stateColdRowsTtlMs: options.stateColdRowsTtlMs ?? 5_000,
    cardCacheTtlMs: 60,
    cardCacheNegativeTtlMs: 40,
    remoteRowsTtlMs: 100,
    dshHome: options.home ?? tmpHome(),
    cardTtlMs: options.cardTtlMs ?? 172_800_000,
    ...MESH_TIMING,
    ...options,
  } as Config
}

/** Boot ONE real plugin node: full fiber, real web server, real announce key. */
export async function bootNode(options: MeshNodeOptions): Promise<MeshNode> {
  const home = options.home ?? tmpHome()
  const reply: ReplyFn = options.reply ?? ((message) => `ok from ${options.name}: ${message}`)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: options.host ?? '127.0.0.1', port: options.port ?? 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const agent = {
    // A real-shaped session id: id8() strips the `session-` prefix and
    // slices 8 hex chars, so the published session team is `<team>/01234567`
    // — and `01234567` satisfies the routable-caller regex a bare word
    // like `agent-1` does not.
    id: SessionId(options.agentId ?? 'session-0123456789abcdef'),
    session: { events: [] as unknown[] },
    steer: (payload: unknown) => {
      const out = reply(steerText(payload), options.name)
      agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: out }] } } })
      ctx.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as Agent & { session: { events: unknown[] } }
  agents.agent = agent
  // The agent is live from boot (the session-node face tracks live roots via
  // this event); unjoined sessions stay network-invisible by design.
  ctx.emit('agent/created', { agent: agent as unknown as Agent })
  const steerCalls: unknown[] = []
  const originalSteer = agent.steer.bind(agent)
  ;(agent as unknown as { steer: (payload: unknown) => void }).steer = (payload: unknown) => {
    steerCalls.push(payload)
    originalSteer(payload)
  }
  const { agentId: _agentId, ...configOptions } = options
  void _agentId
  apply(ctx, meshConfig({ ...configOptions, home }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    name: options.name,
    session: options.session,
    team: options.team,
    baseUrl: `http://127.0.0.1:${String(port)}`,
    port,
    home,
    ctx,
    agents,
    setReply(next: ReplyFn) {
      ;(agent as unknown as { steer: (payload: unknown) => void }).steer = (payload: unknown) => {
        steerCalls.push(payload)
        const out = next(steerText(payload), options.name)
        agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: out }] } } })
        ctx.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
      }
    },
    steered: steerCalls,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

/** POST one JSON body to a node's route. */
export const postJson = (url: string, path: string, body: unknown): Promise<Response> =>
  globalThis.fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) })

/**
 * Ghost node: a raw HTTP server publishing one hand-crafted card at the
 * well-known URL. No fiber, no plugin — the wire-level fault injector for
 * cards that are genuinely signed but expired on the verifier's clock
 * (clock-skew surrogate), or signed-then-tampered (bad-signature path).
 */
export interface GhostNode {
  baseUrl: string
  port: number
  close(): Promise<void>
}

export async function ghostNode(card: A2aPeerCard): Promise<GhostNode> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/agent-card.json') {
      const body = JSON.stringify(card)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    res.writeHead(404)
    res.end()
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo
      resolve(address.port)
    })
  })
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    port,
    close: () => new Promise((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error)))),
  }
}

/** Craft a fully signed ghost card with caller-chosen core fields. */
export function craftCard(core: {
  name: string
  session: string
  team: string
  capabilities?: Record<string, boolean>
  expiresAt: number
}): { card: A2aPeerCard; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ed25519')
  const card = signCard(
    {
      name: core.name,
      session: core.session,
      team: core.team,
      capabilities: core.capabilities ?? { route: true, async: true },
      expiresAt: core.expiresAt,
    },
    privateKey,
  )
  return { card, publicKey: card.publicKey }
}
