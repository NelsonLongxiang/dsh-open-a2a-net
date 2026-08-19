/**
 * A2A node extension (decentralized topology): registers the `a2a_teams` and
 * `a2a_route` model tools over verified peer agent cards and direct peer
 * routes, publishes this node's card and joined session teams, and dispatches
 * inbound direct routes into live agent sessions.
 * @module @nelsonlongxiang/dsh-open-a2a-net
 */

import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// The package own version, read from package.json at load time so the
// panel never drifts from the manifest the installer actually resolved.
const PLUGIN_VERSION: string = String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
import { signCard, type CardCore } from './card.ts'
import { GroupStore } from './group-store.ts'
import { JoinedSessions } from './joined-store.ts'
import { PeerStore } from './peer-store.ts'
import { TaskLedger } from './task-ledger.ts'
import { resolveZone, type ZoneCardFetch } from './zone.ts'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the vendored timer plugin's declaration merging is what puts
// `ctx.timer` on Context; the runtime service is mounted by app compositions.
import type { } from '@deepseek-ai/cordis-plugin-timer'
// Type-only: the vendored loader plugin's declaration merging is what puts
// `ctx.loader` on Context; the loader is mounted by app compositions.
import type { } from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the web server package's declaration merging puts `ctx.webServer`
// on Context; the listener is mounted by the composition.
import type WebServer from '@deepseek-ai/dsh-host-webserver'
// Type-only: the session-title service's declaration merging puts
// `ctx.sessionTitle` on Context; the service is mounted by app compositions.
import type { } from '@deepseek-ai/dsh-session-title'
// Type-only: the session-persistence service's declaration merging puts
// `ctx.sessionPersistence` on Context; the provider is mounted by app
// compositions and stays optional here (cold listing degrades without it).
import type { } from '@deepseek-ai/dsh-session-persistence'
// Type-only: the api gateway's declaration merging puts `ctx.apiProxy` on
// Context; the service is mounted by app compositions and stays optional
// here (boot wake and wake-on-route degrade without it).
import type { } from '@deepseek-ai/dsh-host-apiproxy'
import type { IncomingMessage, ServerResponse } from 'node:http'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { A2aClient, type A2aFetch, type A2aSchedule, type CardFetchOutcome } from './a2a-client.ts'
import type { A2aPeerCard, A2aRouteResult, ZoneRecord } from './types.ts'

export type * from './types.ts'
export { A2aClient } from './a2a-client.ts'
export type { A2aClientOptions, A2aFetch, A2aSchedule } from './a2a-client.ts'

export const name = 'a2a'

export const inject = ['tools', 'timer']

/** One signed zone delegation published on this node's agent card. */
export interface DelegateConfig {
  /** The delegated name; resolves zone-relatively at route time. */
  readonly name: string
  /** Base URL of the zone the name resolves in. */
  readonly url: string
  /** Base64 SPKI DER binding to the target zone's card key; `''` leaves the delegation unbound. */
  readonly publicKey: string
}

/** Deployment-varying A2A node facts; every field has a declared default. */
export interface Config {
  /** `X-API-Key` value sent on peer requests and required by the control routes; empty disables the header. */
  readonly apiKey: string
  /**
   * This node's caller label. `''` (the default) derives `dsh-host-<8 hex>`
   * from a per-home node id created on first use, so two deployments mounting
   * defaults do not collide while a persisted home keeps the label stable
   * across restarts.
   */
  readonly session: string
  /** Team name this node exposes for direct routing. */
  readonly team: string
  /**
   * Publish this node's `/.well-known/agent-card.json` on the shared web
   * server (peer discovery). Requires the web server in the composition;
   * the card carries this node's team, capabilities, referral list, and
   * joined session teams so peers find it without a central directory.
   */
  readonly announce: boolean
  /** Human-facing name published on the agent card. */
  readonly agentName: string
  /**
   * Base URLs of seed peer nodes. `a2a_teams` lists teams discovered from
   * the peers' agent cards and `a2a_route` connects to the owning peer's
   * `/a2a/direct` endpoint. The list is a seed set: referral URLs learned
   * from fetched cards join a bounded, quality-scored peer store persisted
   * at `<dsh-home>/a2a/peers.json`.
   */
  readonly peers: string[]
  /**
   * Zone delegation records published (signed) on this node's agent card:
   * each entry publishes `name` as resolvable in the zone at `url`, so a
   * route for `name` walks the delegation chain (at most 5 hops, cycles
   * fail closed).
   */
  readonly delegates: DelegateConfig[]
  /**
   * Harness home slice for the node keypair and peer store; `''` (the
   * default) uses the process DSH home. The Ed25519 key lives at
   * `<home>/a2a/node-key.pem` and is generated on first announce; a
   * persisted key keeps the node's card identity stable across restarts.
   */
  readonly dshHome: string
  /**
   * Agent-card validity. Announce re-signs at TTL/4 so three lost refreshes
   * still leave a live card; a node silent for one TTL disappears from every
   * peer's discovery without manual eviction.
   */
  readonly cardTtlMs: number
  /**
   * Enable per-session A2A nodes: each live top-level session can join the
   * network explicitly — label `<session>-<agentId8>`, team
   * `<team>/<agentId8>`, node facts carrying the session title and a
   * recent-activity excerpt. Joining is opt-in through the sidebar control's
   * host routes; joined teams ride this node's card and dispatch through
   * its `/a2a/direct` endpoint.
   */
  readonly sessionNodes: boolean
  /**
   * Wake every cold joined session's agent when the plugin mounts (dev boxes
   * and always-on collaboration hosts that restart often: the network state
   * returns without opening each session). Each wake materializes a full
   * agent — log replay plus composed preset world — so the default stays
   * off for deployments that would rather pay on demand (wake-on-route and
   * the sidebar's wake button remain available).
   */
  readonly wakeJoinedOnBoot: boolean
  /**
   * Pause between consecutive boot wakes. Each wake replays a full session
   * log — the zstd decode yields the event loop only every 500ms — so
   * unbounded concurrent wakes of several huge logs starve every request
   * for tens of seconds after a restart. The serial queue with this pause
   * keeps the preheat while capping decode saturation: the first wake
   * starts immediately, and wake-on-route never waits on this queue.
   */
  readonly wakeBootStaggerMs: number
  /**
   * How long the state route serves the cold-row id set from cache before
   * re-enumerating the persistence layer. The panel polls every 2s; the
   * default keeps one full enumeration per 5s instead of one per poll.
   */
  readonly stateColdRowsTtlMs: number
  /**
   * Serve window for a verified peer card from the shared cache. Cards are
   * signed for days and re-signed at TTL/4, so 60s is semantically safe; a
   * peer that restarts with a fresh card is picked up on the next window.
   */
  readonly cardCacheTtlMs: number
  /** Shorter window for unreachable/invalid cards, so a revived peer reappears quickly. */
  readonly cardCacheNegativeTtlMs: number
  /**
   * Serve window for the panel\x27s remote rows. The refresh itself rides the
   * shared card cache, so this is pure sweep cadence: how often real
   * network activity happens while the panel polls every 2s.
   */
  readonly remoteRowsTtlMs: number
  /**
   * `final` reply budget: how long an inbound direct route waits for the
   * session's next assistant message before answering with a timeout
   * notice. Without it a session that never idles (or never produces text)
   * leaves the caller hanging until `routeTimeoutMs` expires.
   */
  readonly flushTimeoutMs: number
  /**
   * `a2a_route` execution budget: how long a call may plausibly wait for a
   * remote session's reply (default 30 minutes).
   */
  readonly routeTimeoutMs: number
}

/** Schemastery configuration for the A2A client plugin row. */
export const Config: s<Config> = s.object({
  apiKey: s.string().default(''),
  session: s.string().default(''),
  team: s.string().default('dsh'),
  announce: s.boolean().default(false),
  agentName: s.string().default('DeepSeek Harness A2A node'),
  peers: s.array(s.string()).default([]),
  delegates: s.array(s.object({ name: s.string(), url: s.string(), publicKey: s.string().default('') })).default([]),
  dshHome: s.string().default(''),
  sessionNodes: s.boolean().default(true),
  wakeJoinedOnBoot: s.boolean().default(false),
  wakeBootStaggerMs: s.number().default(3_000),
  stateColdRowsTtlMs: s.number().default(5_000),
  cardCacheTtlMs: s.number().default(60_000),
  cardCacheNegativeTtlMs: s.number().default(30_000),
  remoteRowsTtlMs: s.number().default(15_000),
  cardTtlMs: s.number().default(172_800_000),
  flushTimeoutMs: s.number().default(300_000),
  routeTimeoutMs: s.number().default(1_800_000),
})

/** Model-facing text for one route result. */
function renderRoute(_args: unknown, value: Record<string, JsonValue>): { type: 'text'; text: string }[] {
  const result = value as unknown as A2aRouteResult
  const text = result.ok
    ? [
      `Team ${result.team} replied (task ${result.task_id}, status ${result.task_status}, context ${result.context_id}):`,
      result.reply,
    ].join('\n')
    : `A2A route failed${result.code === undefined ? '' : ` (code ${String(result.code)})`}: ${result.error}`
  return [{ type: 'text', text }]
}

/**
 * Register the outbound peer tools, the direct-route endpoint, and (when
 * composed) the announced card and session-node control surface.
 * @param ctx - registrant context carrying the tool registry and timer.
 * @param config - deployment's A2A node facts.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('a2a')
  // The production seams: Node's globals. Tests inject their own A2aClient
  // seams through src/a2a-client.ts directly. During fiber teardown the timer
  // service is already gone; a timer armed then belongs to nobody, so the
  // arming fails closed (callback never fires).
  const schedule: A2aSchedule = (callback, delayMs) => {
    try {
      return ctx.timer.timeout(callback, delayMs)
    } catch {
      /* v8 ignore next 2 -- reachable only when the timer service is disposed
         mid-flight; the client owns no teardown-time arming site anymore, so
         no test can drive this without re-adding a teardown unregister. */
      return () => {}
    }
  }
  const fetchImpl: A2aFetch = (url, init) => globalThis.fetch(url, init)

  /** Constant-time secret comparison: hash both sides to equal-length digests. */
  function secretEqual(a: string, b: string): boolean {
    const digestA = createHash('sha256').update(a).digest()
    const digestB = createHash('sha256').update(b).digest()
    return timingSafeEqual(digestA, digestB)
  }

  /**
   * Same-origin / loopback trust for the control routes when no API key is
   * configured (the sidebar's browser fetches carry no secret): a
   * same-origin or user-initiated navigational request passes, an Origin
   * matching the Host passes, and any loopback caller passes. A cross-site
   * page is rejected even when it reaches a loopback bind (the web-app
   * restart-control trust rule).
   * @param req - the inbound control request.
   * @returns whether the caller is trusted without a key.
   */
  function controlTrustedWithoutKey(req: IncomingMessage): boolean {
    const site = req.headers['sec-fetch-site']
    if (site === 'same-origin' || site === 'none') return true
    const origin = req.headers.origin
    const host = req.headers.host
    if (typeof origin === 'string' && typeof host === 'string' && origin === `http://${host}`) return true
    const remote = req.socket.remoteAddress
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  }

  /**
   * Control-route authorization. With `apiKey` set, the `X-API-Key` header
   * (or `api_key` query, for non-browser clients) must match in constant
   * time. With no key, the same-origin/loopback trust applies — the explicit
   * exposure assumption: an empty-key deployment accepts control from its
   * own page and from loopback, and from nothing else.
   * @param req - the inbound control request.
   * @returns whether the request may drive the control routes.
   */
  function controlAuthorized(req: IncomingMessage): boolean {
    if (config.apiKey !== '') {
      const presented = String(req.headers['x-api-key'] ?? new URL(req.url ?? '/', 'http://x').searchParams.get('api_key') ?? '')
      return secretEqual(presented, config.apiKey)
    }
    return controlTrustedWithoutKey(req)
  }

  /**
   * Answer an unauthorized control request: 401 names the missing key,
   * 403 names the untrusted origin.
   * @param req - the inbound request.
   * @param res - the response.
   */
  function rejectControl(req: IncomingMessage, res: ServerResponse): void {
    void req
    const code = config.apiKey !== '' ? 401 : 403
    const payload = JSON.stringify({ error: config.apiKey !== '' ? 'unauthorized: X-API-Key required' : 'forbidden: untrusted origin' })
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  }

  /**
   * Wrap one control handler with the authorization guard.
   * @param handler - the route's inner handler.
   * @returns the guarded handler.
   */
  function controlRoute(handler: (req: IncomingMessage, res: ServerResponse) => void): (req: IncomingMessage, res: ServerResponse) => void {
    return (req: IncomingMessage, res: ServerResponse): void => {
      if (!controlAuthorized(req)) {
        rejectControl(req, res)
        return
      }
      handler(req, res)
    }
  }

  /**
   * Read one JSON object body and hand it to the handler; malformed input
   * answers 400. Bounded like the direct endpoint's reader.
   * @param req - the inbound request.
   * @param res - the response for the malformed-body rejection.
   * @param use - receives the parsed body.
   */
  function readJsonBody(req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void): void {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 10_000) {
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      let body: { readonly id?: unknown }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
      } catch {
        const payload = JSON.stringify({ error: 'malformed body' })
        res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }
      use(body)
    })
  }

  /**
   * The web server is a sibling row, not a declared injection, so in a Loader
   * tree it can activate after this row: the optional read waits for the tree
   * to settle (immediate in a hand-built context with no Loader). The
   * callback runs at most once and never after this fiber's teardown.
   * @param use - receives the webServer service when the settled tree has one.
   * @param onAbsent - runs when the settled tree has no webServer.
   */
  function whenWebServerSettled(use: (webServer: WebServer) => void, onAbsent?: () => void): void {
    const read = (): void => {
      const webServer = ctx.get('webServer')
      if (webServer !== undefined) use(webServer)
      else onAbsent?.()
    }
    const settled = ctx.get('loader')?.await()
    if (settled === undefined) read()
    else void settled.then(() => {
      if (ctx.fiber.uid !== null) read()
    }, () => {
      // A failed boot never mounts the web server row; the absent path stays
      // silent so a dying tree logs its own failure once.
    })
  }

  // Slice 2: the configured peer list is a seed set; referral URLs learned
  // from fetched cards join a bounded, quality-scored store persisted under
  // the same home as the node key.
  const home = config.dshHome === '' ? resolveDshHome() : resolveDshHome(config.dshHome)
  const peerStore = new PeerStore(config.peers, join(home, 'a2a', 'peers.json'))
  // Graceful disposal lands the debounced peer state on disk before a
  // restart reads it back (fiber teardown awaits effect disposers).
  ctx.effect(() => () => peerStore.flush())
  // Slice 3: an unset session derives from a per-home node id, and the
  // configured delegations become signed zone records on every card.
  const session = config.session === '' ? deriveSession(home) : config.session
  const records: ZoneRecord[] = config.delegates.map(delegate => ({
    type: 'delegate' as const,
    name: delegate.name,
    url: delegate.url,
    ...(delegate.publicKey !== '' ? { publicKey: delegate.publicKey } : {}),
  }))

  const client = new A2aClient({
    apiKey: config.apiKey,
    sessionId: session,
    schedule,
    fetch: fetchImpl,
  })

  // Persisted join intent: a join is a user gesture over a durable session,
  // but the node it mounts dies with the session's Agent — page reloads and
  // host restarts silently dropped every join. The store remounts the node
  // whenever the Agent comes back, until the user leaves.
  const joinedSessions = new JoinedSessions(join(home, 'a2a', 'joined.json'))

  /**
   * Recent routing activity for the network panel: a bounded ring of the
   * latest inbound and outbound route outcomes, newest last. The state route
   * serves a copy; the panel derives unread badges from new entries.
   */
  interface RouteActivityEntry {
    readonly ts: number
    readonly dir: 'in' | 'out'
    readonly team: string
    readonly peer: string
    readonly ok: boolean
  }
  const ACTIVITY_CAP = 20
  const recentActivity: RouteActivityEntry[] = []
  /**
   * In-flight outbound routes: a route registers on dial and unregisters on
   * settlement, so the panel can show collaboration in progress ("who is
   * waiting on whom") — the state route serves a snapshot.
   */
  interface InFlightRoute {
    readonly id: number
    readonly team: string
    readonly peer: string
    readonly startedAt: number
  }
  const inFlightRoutes = new Map<number, InFlightRoute>()
  let inFlightSeq = 0
  const beginRoute = (team: string, peer: string): number => {
    const id = ++inFlightSeq
    inFlightRoutes.set(id, { id, team, peer, startedAt: Date.now() })
    return id
  }
  const endRoute = (id: number): void => { inFlightRoutes.delete(id) }
  const recordActivity = (dir: 'in' | 'out', team: string, peer: string, ok: boolean): void => {
    recentActivity.push({ ts: Date.now(), dir, team, peer, ok })
    if (recentActivity.length > ACTIVITY_CAP) recentActivity.splice(0, recentActivity.length - ACTIVITY_CAP)
  }

  /**
   * This host's primary LAN IPv4 (first non-internal address), computed once:
   * a node fact the card and state route publish so peers and operators can
   * tell machines apart in a same-team fleet. Empty when no external address
   * exists (loopback-only deployments).
   */
  const lanIp = (() => {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) return entry.address
      }
    }
    return ''
  })()

  // Session groups: user-named buckets for the panel's session listing,
  // persisted beside the join intents so they survive restarts.
  const groupStore = new GroupStore(join(home, 'a2a', 'groups.json'))

  // The async-task ledger: every route that leaves a task owed a receipt is
  // queryable here, and the correlating `[A2A receipt] task <id>` message
  // resolves it — the caller-side half of the receipt contract, persisted so
  // a restart does not orphan the reconciliation.
  const taskLedger = new TaskLedger(join(home, 'a2a', 'tasks.json'))

  // Session nodes: every joined top-level session is its own addressable
  // team (label `<session>-<agentId8>`, team `<team>/<agentId8>`). Joining
  // is a local fact: the entry dispatches `/a2a/direct` routes and rides
  // the announced card's unsigned sessionTeams listing.
  const sessionNodes = new Map<string, Agent>()
  // Live top-level agents: the join surface's candidates and the cold-row
  // complement (apply scope — the direct-route wake below reads it too).
  const liveRoots = new Map<string, Agent>()

  /**
   * The api gateway's wake face, when composed: materializing a persisted
   * session's agent (log replay plus composed preset world) is web-app
   * knowledge, so both wake paths ride the one service that owns it.
   */
  const materialize = (id: string): Promise<Agent> | undefined => {
    const apiProxy = ctx.get('apiProxy') as { materializeSession?: (sessionId: SessionId) => Promise<Agent> } | undefined
    if (apiProxy?.materializeSession === undefined) return undefined
    return apiProxy.materializeSession(SessionId(id))
  }

  /**
   * Wake one cold joined session on demand — the route-triggered half:
   * the join consented to network reachability, so a route addressed to
   * its team pays the wake rather than failing.
   * @param team - the routed team name.
   * @returns a promise resolving with the woken agent, or undefined when
   * the team names no cold joined session or no wake face is composed.
   */
  const wakeColdTeam = (team: string): Promise<Agent> | undefined => {
    const id = joinedSessions.list().find(entry => !liveRoots.has(entry) && `${config.team}/${id8(entry)}` === team)
    if (id === undefined) return undefined
    // An archived session never wakes: archive is closure, not sleep.
    if (archivedSessionFilter()?.(id) === true) return undefined
    return materialize(id)
  }

  /**
   * The workspace registry's archived set, when composed. Archiving is a
   * registry state — the session store stays — so this list is the one
   * authoritative archive signal. Read structurally: the registry is an
   * optional neighbor, not a dependency.
   */
  function archivedSessionFilter(): ((id: string) => boolean) | undefined {
    const registry = (ctx as unknown as { get(name: string): unknown }).get('workspaceRegistry') as { archivedSessionIds?: readonly unknown[] } | undefined
    if (registry === undefined || !Array.isArray(registry.archivedSessionIds)) return undefined
    const archived = new Set(registry.archivedSessionIds.map(String))
    return (id: string): boolean => archived.has(id)
  }

  /**
   * Archived sessions leave the node network: archive is closure, so the
   * persisted join intent goes, a mounted live node unmounts, and the next
   * listing stops advertising the team. Runs at boot settlement and on every
   * state read — the panel's poll makes a mid-session archive disappear
   * within one poll interval.
   */
  const pruneArchivedJoins = (): void => {
    const isArchived = archivedSessionFilter()
    if (isArchived === undefined) return
    for (const id of joinedSessions.list()) {
      if (!isArchived(id)) continue
      sessionNodes.delete(id)
      joinedSessions.remove(id)
      logger.info(`a2a: archived session ${id8(id)} left the node network`)
    }
  }

  /**
   * The short id suffix session-node labels and teams key on. Web agents
   * carry `SessionId`-branded ids whose first 8 characters are the literal
   * `session-` prefix — every node would share one team — so the brand
   * strips before the slice. Imported sessions (`import-<uuid>`) keep the
   * `import-` prefix plus the uuid's first 8 hex chars: a bare 8-char slice
   * would collapse the whole import family into 16 possible ids (the uuid's
   * 8th char), which collides as soon as several sessions are imported.
   */
  function id8(id: string): string {
    const bare = id.replace(/^session-/, '')
    const imported = bare.match(/^import-([0-9a-fA-F]+)/)
    if (imported !== null) return `import-${imported[1]!.slice(0, 8)}`
    return bare.slice(0, 8)
  }

  /** The 8-char suffix of one agent's id. */
  function agentId8(agent: Agent): string {
    return id8(String(agent.id))
  }

  /** The session node's wire label. */
  function sessionLabelOf(agent: Agent): string {
    return `${session}-${agentId8(agent)}`
  }

  /** The session node's team name. */
  function sessionTeamOf(agent: Agent): string {
    return `${config.team}/${agentId8(agent)}`
  }

  /**
   * Resolve the live agent a session-node team names, when that node exists.
   * @param team - the routed team name.
   * @returns the node's agent, or undefined for any other team.
   */
  function resolveAgentForTeam(team: string): Agent | undefined {
    const prefix = `${config.team}/`
    if (!team.startsWith(prefix)) return undefined
    const suffix = team.slice(prefix.length)
    return [...sessionNodes.values()].find(agent => agentId8(agent) === suffix)
  }

  /**
   * Human-facing node facts for one session: the session title (fallback:
   * the node label), a one-line recent-activity excerpt, and the session's
   * working directory (from the durable session header — a storage fact
   * read fresh, never baked into any prompt).
   * @param agent - the session the facts describe.
   * @returns the name/description/workspace triple the card and state route serve.
   */
  // The title service derives its answer from the session log, so calling
  // it per agent per panel poll re-derives 24 titles every 2s on a busy
  // host. Memoize per agent with the same fingerprint the excerpt cache
  // uses (event count + tail identity): a title only changes when the log
  // grows or its tail event object changes.
  const titleCache = new WeakMap<Agent, { length: number; tail: unknown; title: string | undefined }>()

  function sessionTitleOf(agent: Agent): string | undefined {
    const events = agent.session.events
    const length = events.length
    const tail = length > 0 ? events[length - 1] : undefined
    const cached = titleCache.get(agent)
    if (cached !== undefined && cached.length === length && cached.tail === tail) return cached.title
    const title = ctx.get('sessionTitle')?.get(agent.session)?.title
    titleCache.set(agent, { length, tail, title })
    return title
  }

  function nodeMetadataOf(agent: Agent): { name: string; description: string; workspace?: string } {
    const title = sessionTitleOf(agent)
    const cwd = (agent.session as { header?: { cwd?: string } }).header?.cwd
    return {
      name: title !== undefined && title !== '' ? title : sessionLabelOf(agent),
      description: recentActivityOf(agent),
      ...(cwd !== undefined && cwd !== '' ? { workspace: cwd } : {}),
    }
  }

  /**
   * One line of recent activity: the newest user or assistant text,
   * whitespace-collapsed and truncated.
   * @param agent - the session whose event log is scanned.
   * @returns the excerpt, or a placeholder for a fresh session.
   */
  // Memoized per agent: quiet sessions with no text events would otherwise
  // rescan their whole (multi-MB) event arrays on every panel poll. The
  // cache invalidates when the log grows or its tail event object changes;
  // the backward scan itself stops after RECENT_ACTIVITY_SCAN_LIMIT events
  // so a textless log costs one bounded pass, not a full walk.
  const recentActivityCache = new WeakMap<Agent, { length: number; tail: unknown; value: string }>()
  const RECENT_ACTIVITY_SCAN_LIMIT = 500

  function recentActivityOf(agent: Agent): string {
    const events = agent.session.events
    const length = events.length
    const tail = length > 0 ? events[length - 1] : undefined
    const cached = recentActivityCache.get(agent)
    if (cached !== undefined && cached.length === length && cached.tail === tail) return cached.value
    const value = scanRecentActivity(events)
    recentActivityCache.set(agent, { length, tail, value })
    return value
  }

  function scanRecentActivity(events: readonly ({ type?: string } | undefined)[]): string {
    const floor = Math.max(0, events.length - RECENT_ACTIVITY_SCAN_LIMIT)
    for (let index = events.length - 1; index >= floor; index -= 1) {
      const event = events[index]
      if (event === undefined) continue
      const blocks = event.type === 'user/message'
        ? (event as { data: { content: Array<{ type: string; text?: string }> } }).data.content
        : event.type === 'assistant/message'
          ? (event as { data: { message: { content: Array<{ type: string; text?: string }> } } }).data.message.content
          : undefined
      const text = blocks
        ?.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text !== undefined && text !== '') return text.slice(0, 160)
    }
    return 'no activity yet'
  }

  /**
   * Join one live top-level session: its team dispatches direct routes and
   * rides the announced card from this moment.
   * @param agent - the session to join.
   */
  function mountSessionNode(agent: Agent): void {
    sessionNodes.set(String(agent.id), agent)
  }

  if (config.sessionNodes) {
    // Track live top-level sessions for the join surface; joining is
    // explicit (the sidebar control), never automatic. A throwing
    // agent/created listener vetoes publication, so tracking is strictly
    // side-effect-only.
    ctx.on('agent/created', ({ agent }) => {
      const agents = ctx.get('agents')
      if (agents === undefined || !agents.roots().some(root => root.id === agent.id)) return
      liveRoots.set(String(agent.id), agent)
      if (joinedSessions.has(String(agent.id))) mountSessionNode(agent)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      liveRoots.delete(String(agent.id))
      // Disposal unmounts the runtime node; the persisted intent stays for
      // the remount above (leave is the only intent remover).
      sessionNodes.delete(String(agent.id))
    })
    for (const agent of ctx.get('agents')?.roots() ?? []) {
      liveRoots.set(String(agent.id), agent)
      if (joinedSessions.has(String(agent.id))) mountSessionNode(agent)
    }

    {
      // Archive pruning and boot wake both ride the loader tree's
      // settlement: the workspace registry and the api gateway may activate
      // after this row in the same tree, and an apply-time snapshot would
      // see neither. Archived intents prune first — an archived session
      // must never wake — and pruning runs even with the wake off.
      const pruneThenWake = (): void => {
        pruneArchivedJoins()
        if (!config.wakeJoinedOnBoot) return
        if (ctx.get('apiProxy') === undefined) {
          logger.warn('wakeJoinedOnBoot is on but no api gateway is composed; cold joined sessions stay asleep')
          return
        }
        // Serial with a configurable pause: one full log replay at a time
        // keeps the decode from saturating the event loop (concurrent wakes
        // of several huge logs stalled every request for tens of seconds).
        // The first wake starts immediately; the re-check drops ids another
        // path (wake-on-route, a manual open) already materialized.
        let bootWakeChain: Promise<void> = Promise.resolve()
        let firstBootWake = true
        for (const id of joinedSessions.list()) {
          if (liveRoots.has(id)) continue
          // The remount listener joins the node the moment the woken agent
          // publishes; a failed wake keeps the cold row and its intent.
          const pauseMs = firstBootWake ? 0 : config.wakeBootStaggerMs
          firstBootWake = false
          bootWakeChain = bootWakeChain.then(async () => {
            if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs))
            if (liveRoots.has(id)) return
            try {
              await materialize(id)
            } catch (error: unknown) {
              logger.warn(`boot wake of ${id} failed: ${String(error)}`)
            }
          })
        }
      }
      const settled = ctx.get('loader')?.await()
      if (settled === undefined) pruneThenWake()
      else void settled.then(() => {
        if (ctx.fiber.uid !== null) pruneThenWake()
      }, () => {
        // A failed boot never wakes anything; the dying tree logs its own
        // failure once.
      })
    }

    // Cold-row ids are the expensive half of the state read: enumerating
    // the persistence layer walks every stored session's metadata, and the
    // panel polls this route every 2s. A 5s TTL keeps the poll cheap while
    // staying fresher than the panel's own cadence; live rows come from
    // liveRoots and never touch this cache.
    let coldRowsCache: { at: number; ids: Set<string> } | undefined
    const coldJoinedIds = async (): Promise<Set<string>> => {
      const now = Date.now()
      if (coldRowsCache !== undefined && now - coldRowsCache.at < config.stateColdRowsTtlMs) return coldRowsCache.ids
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) return new Set()
      const ids = new Set((await persistence.list()).map(header => String(header.id)))
      coldRowsCache = { at: now, ids }
      return ids
    }

    // Peer-side rows for the panel, grouped there by origin: the sweep is
    // real network work, so a shared window serves the 2s panel poll without
    // hammering peers. The state read answers synchronously from the cache
    // (never awaiting inside the handler) and kicks a background refresh when
    // stale — the next poll picks the fresh rows up. With the shared card
    // cache serving the sweep\x27s fetches, the window length is pure cadence:
    // remoteRowsTtlMs (default 15s) spaces the real network activity while
    // staying well inside a peer restart\x27s noticeability. Single-flight: a
    // refresh already in flight serves every poll that arrives before it
    // settles — no stacked sweeps.
    let remoteRowsCache: { at: number; rows: { team: string; name: string; origin?: string; workspace?: string }[] } | undefined
    let remoteRowsInFlight: Promise<void> | undefined
    const refreshRemoteRows = (): void => {
      const now = Date.now()
      if (remoteRowsCache !== undefined && now - remoteRowsCache.at < config.remoteRowsTtlMs) return
      if (remoteRowsInFlight !== undefined) return
      remoteRowsInFlight = listDirectoryTeams(false)
        .then(all => {
          remoteRowsCache = {
            at: now,
            rows: all
              .filter(row => row.local !== true)
              .map(row => ({ team: row.team, name: row.name, ...(row.origin !== undefined ? { origin: row.origin } : {}), ...(row.workspace !== undefined ? { workspace: row.workspace } : {}) })),
          }
        })
        .catch(() => {})
        .finally(() => {
          remoteRowsInFlight = undefined
        })
    }
    whenWebServerSettled((webServer) => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/__dsh_a2a/state',
        handler: controlRoute((_req: IncomingMessage, res: ServerResponse) => {
          void (async () => {
            // The panel polls this route: pruning here makes a mid-session
            // archive leave the network within one poll interval, no restart
            // required.
            pruneArchivedJoins()
            const assignments = groupStore.all()
            const groupOf = (id: string): string | undefined => {
              const name = assignments[id]
              return name === undefined ? undefined : name
            }
            // Archived sessions are closed: the GUI hides them everywhere, so
            // the panel must not re-list them as join surface rows — joined
            // or not. (The prune above already took their join intents; this
            // covers never-joined live roots and any intent a restart left.)
            const isArchived = archivedSessionFilter()
            const sessions: Array<Record<string, unknown>> = [...liveRoots.values()]
              .filter(agent => isArchived?.(String(agent.id)) !== true)
              .map(agent => ({
                id: String(agent.id),
                label: sessionLabelOf(agent),
                team: sessionTeamOf(agent),
                ...nodeMetadataOf(agent),
                joined: sessionNodes.has(String(agent.id)),
                live: true,
                ...(groupOf(String(agent.id)) !== undefined ? { group: groupOf(String(agent.id)) } : {}),
              }))
            // Cold joined sessions: a remembered intent whose Agent is not
            // back yet (host restarted, session not opened). The row carries
            // no facts — the Web client merges the session title from its
            // own list — and wakes through the normal session-open path,
            // after which the remount above joins it automatically.
            // Cold rows only exist when a joined intent lacks a live agent;
            // with all intents live (or none) the persistence layer is never
            // asked and the handler stays synchronous to its response.
            const coldCandidates = joinedSessions.list().filter(id => !liveRoots.has(id))
            const persistence = ctx.get('sessionPersistence')
            const persisted = persistence !== undefined && coldCandidates.length > 0 ? await coldJoinedIds() : new Set<string>()
            for (const id of coldCandidates) {
              if (!persisted.has(id)) continue
              sessions.push({
                id,
                label: `${session}-${id8(id)}`,
                team: `${config.team}/${id8(id)}`,
                joined: true,
                live: false,
                ...(groupOf(id) !== undefined ? { group: groupOf(id) } : {}),
              })
            }
            const body = JSON.stringify({
              nodes: true,
              version: PLUGIN_VERSION,
              sessions,
              groups: groupStore.list(),
              host: lanIp === '' ? {} : { lanIp },
              peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),
              remote: (refreshRemoteRows(), remoteRowsCache?.rows ?? []),
              activity: recentActivity.slice(),
              inFlight: [...inFlightRoutes.values()].map(route => ({
                team: route.team,
                peer: route.peer,
                startedAt: route.startedAt,
              })),
              // Owed receipts: the cross-turn waits the in-flight ring cannot
              // show (an async dispatch rides no wait). Resolved tasks stay
              // off the panel — the inbound activity row is their receipt.
              tasks: taskLedger.list()
                .filter(task => task.status === 'pending')
                .map(task => ({ taskId: task.taskId, team: task.team, peer: task.peer, startedAt: task.startedAt, status: task.status })),
            })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
            res.end(body)
          })()
        }),
      }), 'a2a: session-node state route')
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/__dsh_a2a/join',
        handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
          readJsonBody(req, res, (body) => {
            const agent = typeof body.id === 'string' ? liveRoots.get(body.id) : undefined
            if (agent === undefined) {
              const payload = JSON.stringify({ error: 'no live session with that id' })
              res.writeHead(404, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
            mountSessionNode(agent)
            joinedSessions.add(String(agent.id))
            const payload = JSON.stringify({ id: body.id, label: sessionLabelOf(agent), team: sessionTeamOf(agent) })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
        }),
      }), 'a2a: session-node join route')
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/__dsh_a2a/leave',
        handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
          readJsonBody(req, res, (body) => {
            const id = typeof body.id === 'string' ? body.id : ''
            if (id !== '') sessionNodes.delete(id)
            joinedSessions.remove(id)
            const payload = JSON.stringify({ id })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
        }),
      }), 'a2a: session-node leave route')
      // Groups control: create/remove named groups and assign sessions to
      // them (an empty name unassigns). Same guard as join/leave — the
      // group taxonomy enumerates session ids, so it stays behind the key.
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/__dsh_a2a/groups',
        handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
          readJsonBody(req, res, (body) => {
            const action = body.action
            let payload: string
            if (action === 'create') {
              const name = typeof body.name === 'string' ? body.name : ''
              const stored = groupStore.create(name)
              payload = JSON.stringify(stored === undefined ? { ok: false, error: 'invalid name or group cap reached' } : { ok: true, name: stored, groups: groupStore.list() })
            } else if (action === 'remove') {
              const name = typeof body.name === 'string' ? body.name : ''
              payload = JSON.stringify({ ok: groupStore.remove(name), groups: groupStore.list() })
            } else if (action === 'assign') {
              const id = typeof body.id === 'string' ? body.id : ''
              const name = typeof body.name === 'string' ? body.name : undefined
              if (id === '' || name === undefined) {
                payload = JSON.stringify({ ok: false, error: 'id and name are required' })
              } else {
                payload = JSON.stringify({ ok: groupStore.assign(id, name), groups: groupStore.list() })
              }
            } else {
              payload = JSON.stringify({ ok: false, error: 'unknown action' })
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
        }),
      }), 'a2a: session-group route')
    })
  }

  if (config.announce) {
    whenWebServerSettled((webServer) => {
      const privateKey = loadOrCreateNodeKey(join(home, 'a2a', 'node-key.pem'))
      const cardCore = (): CardCore => ({
        name: config.agentName,
        session,
        team: config.team,
        // async: wait:false is honored (steer + delivered, no final hold);
        // the signed capability turns async dialing into a deterministic
        // check instead of a timeout race against pre-0.5.2 peers.
        capabilities: { route: true, async: true },
        expiresAt: Date.now() + config.cardTtlMs,
        ...(records.length > 0 ? { records: [...records] } : {}),
      })
      let currentCard = signCard(cardCore(), privateKey)
      // Re-sign at TTL/4: four publication opportunities per validity window
      // tolerate three lost refreshes (GNUnet zonemaster cadence).
      const refresh = ctx.timer.interval(() => {
        currentCard = signCard(cardCore(), privateKey)
      }, Math.max(1, Math.floor(config.cardTtlMs / 4)))
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/.well-known/agent-card.json',
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          // The unsigned peers and sessionTeams fields carry this node's
          // current peer set and joined sessions at serve time (between
          // re-signs), so each card read spreads the publisher's latest
          // view of the network.
          const sessionTeams = [...sessionNodes.values()].map(agent => ({ team: sessionTeamOf(agent), ...nodeMetadataOf(agent) }))
          const body = JSON.stringify({ ...currentCard, peers: peerStore.list(), ...(sessionTeams.length > 0 ? { sessionTeams } : {}), ...(lanIp !== '' ? { lanIp } : {}), description: `A2A node exposing team ${config.team}` })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
          res.end(body)
        },
      }), 'a2a: agent card route')
      ctx.effect(() => refresh, 'a2a: card refresh timer')
    }, () => {
      logger.warn('announce is on but no web server is composed; the agent card is not published')
    })
  }
  /**
   * Resolve the live agent for inbound steering: the initiator when
   * recoverable, else the first root.
   * @returns the agent, or undefined when no agent is live.
   */
  function liveAgent(): Agent | undefined {
    const agents = ctx.get('agents')
    if (agents === undefined) return undefined
    try {
      return agents.requireInitiator()
    } catch {
      const roots = agents.roots()
      return roots.length > 0 ? roots[0] : undefined
    }
  }

  /**
   * Steer one relay-form user message into the agent; the caller owns
   * rejection handling.
   * @param agent - the steering target.
   * @param text - the fully formatted relay message.
   */
  function steerRelay(agent: Agent, text: string): void {
    agent.steer({
      id: MessageId(`a2a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'a2a', form: 'relay' },
    })
  }

  /**
   * Register one final-reply waiter for the agent and arm its flush timeout.
   * @param agent - the agent whose next assistant message answers the waiter.
   * @param answer - how the waiter's reply is delivered.
   * @returns the registered waiter (for callers that may retract it).
   */
  function registerFinalWaiter(agent: Agent, answer: (text: string) => void): FinalWaiter {
    const key = String(agent.id)
    const waiter: FinalWaiter = { answer, sinceEvents: agent.session.events.length }
    waiter.timeoutDisposer = armFlushTimeout(key, waiter)
    pendingFinals.set(key, [...(pendingFinals.get(key) ?? []), waiter])
    return waiter
  }

  /**
   * Steer one direct route request into a live agent and resolve with its
   * final reply (final semantics always: the HTTP caller has no other
   * channel to learn the reply).
   * @param taskId - the correlation key the steered receipt header carries.
   */
  function routeIntoAgent(team: string, message: string, caller: string, taskId?: string): Promise<
    { ok: true; reply: string } | { ok: false; error: string }
  > {
    const agent = resolveAgentForTeam(team)
    if (agent !== undefined) {
      return routeIntoAgentFor(agent, team, message, caller, taskId)
    }
    // Wake-on-route: a cold joined team materializes on demand, then steers.
    const woken = wakeColdTeam(team)
    if (woken !== undefined) {
      return woken.then(
        agent => routeIntoAgentFor(agent, team, message, caller, taskId),
        (error: unknown) => ({ ok: false, error: `waking the session for team "${team}" failed: ${String(error)}` }) as const,
      )
    }
    // Only the bare process team falls back to the live (initiator) agent.
    // A session-node-shaped team that misses is an error, never a silent
    // redirect: a mistyped or stale short id must not reach another session
    // through the initiator fallback.
    if (team === config.team) {
      const live = liveAgent()
      if (live !== undefined) return routeIntoAgentFor(live, team, message, caller, taskId)
      return Promise.resolve({ ok: false, error: 'No live DSH agent is available to accept this message.' })
    }
    return Promise.resolve({ ok: false, error: `No live DSH session node accepts team "${team}" and no cold joined session matches it.` })
  }

  /**
   * Steer one direct route request into one named agent and resolve with its
   * final reply.
   * @param agent - the session-node agent the request addresses.
   * @param team - team name the caller routed to (diagnostics).
   * @param message - request text.
   * @param caller - caller label for the steered prefix.
   * @returns the agent's final reply, or the explicit failure.
   */
  function routeIntoAgentFor(agent: Agent, team: string, message: string, caller: string, taskId?: string): Promise<
    { ok: true; reply: string } | { ok: false; error: string }
  > {
    return new Promise((resolve) => {
      const waiter = registerFinalWaiter(agent, (text) => {
        resolve({ ok: true, reply: text })
      })
      // The header names the sender first: `caller` is the routing node's
      // own label (the session that issued the route), while `team` is this
      // request's target — showing the target as "remote team" hid the
      // actual origin behind the receiver's own team name. The task id, when
      // the caller supplied one, rides the header so an "[A2A receipt] task
      // <id>" answer correlates with the caller's own route result.
      const from = caller === '' ? 'an unknown node' : caller
      const taskPrefix = taskId === undefined ? '' : `(task ${taskId}) `
      const text = `[A2A direct] ${taskPrefix}from "${from}" (routed to ${team}) sent:

${message}`
      try {
        steerRelay(agent, text)
      } catch (error) {
        // The waiter was registered above, so the key always holds it; the
        // map-of-arrays stays a plain read.
        const key = String(agent.id)
        const entries = pendingFinals.get(key) as FinalWaiter[]
        const kept = entries.filter(entry => entry !== waiter)
        if (kept.length === 0) pendingFinals.delete(key)
        else pendingFinals.set(key, kept)
        waiter.timeoutDisposer?.()
        resolve({ ok: false, error: `The DSH session rejected the message: ${String(error)}` })
      }
    })
  }

  whenWebServerSettled((webServer) => {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/a2a/direct',
      handler: (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 1_000_000) {
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        /* v8 ignore next 6 -- client aborts surface as 'close' via the shared
           webServer's per-request guard; a raw req 'error' needs a malformed
           HTTP stream the webServer rejects before this handler exists */
        req.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(400)
            res.end()
          }
        })
        req.on('end', () => {
          let body: {
            readonly team?: unknown
            readonly message?: unknown
            readonly context_id?: unknown
            readonly caller_session?: unknown
            readonly wait?: unknown
            readonly task_id?: unknown
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
          } catch {
            const payload = JSON.stringify({ error: 'malformed body', code: -32000 })
            res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          const team = typeof body.team === 'string' ? body.team : ''
          const message = typeof body.message === 'string' ? body.message : ''
          const caller = typeof body.caller_session === 'string' ? body.caller_session : ''
          const noWait = body.wait === false
          const contextId = typeof body.context_id === 'string' && body.context_id !== '' ? body.context_id : `ctx-${Math.random().toString(16).slice(2, 10)}`
          // The caller-born task id (idempotency key): echo it when present
          // so the receipt header correlates with the caller's own result;
          // pre-0.5.3 callers carry none and this node mints one.
          const taskId = typeof body.task_id === 'string' && body.task_id !== '' ? body.task_id : `direct-${Math.random().toString(16).slice(2, 10)}`
          if (team === '' || message === '') {
            const payload = JSON.stringify({ error: 'team and message are required', code: -32000 })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // The caller-side receipt correlation: a message shaped as a
          // receipt resolves the task it echoes, whichever wait semantics
          // carried it here. Correlation is bookkeeping only — the message
          // steers on exactly as before.
          taskLedger.resolveFromMessage(message)
          // wait:false delivers without the final-reply hold: steer resolves
          // synchronously inside routeIntoAgentFor, so by the time the agent
          // lookup settles the message is already in — answer delivered and
          // let the receipt contract carry the reply.
          if (noWait) {
            const agent = resolveAgentForTeam(team)
            const woken = agent !== undefined ? undefined : wakeColdTeam(team)
            const deliver = (target: Agent): void => {
              const from = caller === '' ? 'an unknown node' : caller
              try {
                // The receipt header carries the task id: the target echoes
                // it verbatim in "[A2A receipt] task <id> ...", closing the
                // correlation loop with the caller's own route result.
                steerRelay(target, `[A2A direct] (task ${taskId}) from "${from}" (routed to ${team}) sent:\n\n${message}`)
                recordActivity('in', team, caller, true)
                const payload = JSON.stringify({
                  routed: true,
                  delivered: true,
                  team,
                  session,
                  task_id: taskId,
                  context_id: contextId,
                  task_status: 'TASK_STATE_DELIVERED',
                  artifacts: [],
                })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                res.end(payload)
              } catch (error) {
                recordActivity('in', team, caller, false)
                const payload = JSON.stringify({ error: `The DSH session rejected the message: ${String(error)}`, code: -32000, team, task_id: taskId, task_status: 'TASK_STATE_FAILED' })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                res.end(payload)
              }
            }
            if (agent !== undefined) { deliver(agent); return }
            if (woken !== undefined) {
              void woken.then(deliver, (error: unknown) => {
                recordActivity('in', team, caller, false)
                const payload = JSON.stringify({ error: `waking the session for team "${team}" failed: ${String(error)}`, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                res.end(payload)
              })
              return
            }
            if (team === config.team) {
              const live = liveAgent()
              if (live !== undefined) { deliver(live); return }
            }
            const payload = JSON.stringify({ error: `No live DSH session node accepts team "${team}" and no cold joined session matches it.`, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          void routeIntoAgent(team, message, caller, taskId).then((outcome) => {
            recordActivity('in', team, caller, outcome.ok)
            const payload = outcome.ok
              ? JSON.stringify({
                routed: true,
                team,
                session,
                result: { text: outcome.reply },
                task_id: taskId,
                context_id: contextId,
                task_status: 'TASK_STATE_COMPLETED',
                artifacts: [],
              })
              : JSON.stringify({ error: outcome.error, code: -32000, team, task_id: taskId, task_status: 'TASK_STATE_FAILED' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
        })
      },
    }), 'a2a: direct route endpoint')
  })

  /**
   * Settle one card-fetch outcome into the peer store and the plain card:
   * the fetch is itself the reachability check — a miss degrades the peer, a
   * verified card raises it and offers its referral list to the store. A
   * peer offered mid-iteration is fetched on a later tool call, so gossip
   * converges across calls.
   * @param peer - base URL of the peer the outcome belongs to.
   * @param outcome - the detailed fetch outcome (probe and discovery share it).
   * @returns the verified card, or undefined when the peer is unreachable, rejected, or a self-referral.
   */
  function settlePeerCard(peer: string, outcome: CardFetchOutcome): A2aPeerCard | undefined {
    if (!outcome.ok) {
      peerStore.noteFailure(peer)
      return undefined
    }
    // A self-referral learned from a peer's card (the peer lists this node's
    // URL back at it) must not track the node as its own peer: the node would
    // list its own teams as remote rows and offer its own URL onward. The
    // signed card session is the identity check — no URL guessing.
    if (outcome.card.session === session) {
      peerStore.drop(peer)
      return undefined
    }
    peerStore.noteSuccess(peer)
    for (const referral of outcome.card.peers ?? []) peerStore.offer(referral)
    return outcome.card
  }

  /**
   * Fetch one peer's card and settle it into the store (discovery path).
   * @param peer - base URL of the peer to visit.
   * @returns the verified card, or undefined when the peer is unreachable or serves an invalid card.
   */
  async function fetchPeerCard(peer: string): Promise<A2aPeerCard | undefined> {
    return settlePeerCard(peer, await client.fetchCardDetail(peer))
  }

  /**
   * Apply-scope shared card cache: every caller (teams listing, route
   * candidate walks, panel sweeps) shares one TTL window per URL, so a
   * poll-happy consumer cannot re-fetch a peer's card — or re-punish a dead
   * one — more than once per window. Cards live for days and re-sign at
   * TTL/4, so a 60s serve window is semantically safe. Negative results
   * (unreachable/invalid) cache for a shorter window so a restarting peer
   * reappears quickly. Scoring stays with the real network fetch only: a
   * cache hit never re-scores, which is what keeps the debounced peer-store
   * writes rare. Concurrent callers for one URL join a single in-flight
   * fetch (single-flight) instead of racing N requests.
   */
  interface CardCacheEntry { at: number; card: A2aPeerCard | undefined }
  const cardCache = new Map<string, CardCacheEntry>()
  const cardCacheInFlight = new Map<string, Promise<A2aPeerCard | undefined>>()

  function cachedCardFetch(url: string): Promise<A2aPeerCard | undefined> {
    const hit = cardCache.get(url)
    const now = Date.now()
    if (hit !== undefined && now - hit.at < (hit.card !== undefined ? config.cardCacheTtlMs : config.cardCacheNegativeTtlMs)) {
      return Promise.resolve(hit.card)
    }
    const inFlight = cardCacheInFlight.get(url)
    if (inFlight !== undefined) return inFlight
    const fetch = fetchPeerCard(url)
      .then(card => {
        cardCache.set(url, { at: Date.now(), card })
        return card
      })
      .finally(() => {
        cardCacheInFlight.delete(url)
      })
    cardCacheInFlight.set(url, fetch)
    return fetch
  }

  /**
   * Kept for the per-call semantics the route tool documents (one fetch per
   * zone per call): it now reads through the shared cache, so a second call
   * within the window is free but the first always reflects live state.
   */
  function memoizedCardFetch(): ZoneCardFetch {
    const seen = new Set<string>()
    return async (url: string) => {
      if (seen.has(url)) return cardCache.get(url)?.card
      seen.add(url)
      return cachedCardFetch(url)
    }
  }

  ctx.tools.register(defineTool({
    name: 'a2a_teams',
    description:
      'List or search reachable A2A teams: this host\'s own process team and joined session nodes first (marked [this host], '
      + 'routable over loopback — same-host collaboration needs no peers), then teams across the tracked peer network '
      + 'with owner label, a recent-activity excerpt, the publishing host (origin: node label + LAN IP — the natural '
      + 'grouping when a fleet spans machines), and the session\'s working directory when shared. Pass query to filter '
      + 'by keyword (case-insensitive substring over team name, title, excerpt, origin, or workspace) — searching '
      + 'discovers one extra referral hop within the call. Call this before a2a_route to pick a target team.',
    parameters: {
      query: { type: 'string', description: 'Optional keyword filter (case-insensitive substring over team/name/description).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          query: { type: 'string', description: 'The filter applied, empty when unfiltered.' },
          teams: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                team: { type: 'string', required: true },
                session: { type: 'string', required: true },
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                local: { type: 'boolean', description: 'true when the team is served by this host (loopback candidate).' },
                origin: { type: 'string', description: 'The publishing host (node session label, LAN IP when known) — the natural grouping for fleet rows.' },
                workspace: { type: 'string', description: 'The session\'s working directory, when shared.' },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.teams.length === 0
          ? `No A2A teams${(value.query ?? '') === '' ? '' : ` matching "${String(args.query)}"`} are currently reachable.`
          : value.teams.map(team => `- ${team.team}${team.local === true ? ' [this host]' : ''}${team.name === '' ? '' : ` (${team.name})`}${team.description === '' ? '' : ` — ${team.description}`}${typeof team.origin === 'string' && team.origin !== '' && team.local !== true ? ` @ ${team.origin}` : ''}${typeof team.workspace === 'string' && team.workspace !== '' ? ` [${team.workspace}]` : ''}`).join('\n'),
      }],
    },
    presentCall: args => ({ card: 'generic', title: args.query === undefined || args.query === '' ? 'List reachable A2A teams' : `Search A2A teams: ${args.query}`, kind: 'other', rawInput: args }),
    execute: async (args: { query?: string }): Promise<{ ok: boolean; query: string; teams: DirectoryTeamRow[] }> => {
      const query = args.query?.trim().toLowerCase() ?? ''
      const teams = await listDirectoryTeams(query !== '')
      if (query === '') return { ok: true, query: '', teams }
      const matches = (team: DirectoryTeamRow): boolean =>
        team.team.toLowerCase().includes(query) || team.name.toLowerCase().includes(query) || team.description.toLowerCase().includes(query)
        || (team.origin ?? '').toLowerCase().includes(query) || (team.workspace ?? '').toLowerCase().includes(query)
      return { ok: true, query, teams: teams.filter(matches) }
    },
  }))

  /**
   * The directory's listing: this host's own teams lead (the loopback
   * candidates a2a_route dials first) — the process team, then every joined
   * live session node with its title and activity facts; then every tracked
   * peer card's own team plus its joined session teams. Delegated names are
   * not listed — only names a tracked zone publishes directly appear;
   * delegations resolve at route time (a resolvable delegation always
   * aliases a listed team, so rows for them would repeat).
   *
   * Discovery is gossip: each fetch offers the card's referrals to the
   * store, and mid-iteration offers are normally fetched on the next call.
   * A search pass chases one extra hop within the call — after the first
   * sweep, peers that were newly offered get their own card fetched — so a
   * keyword hunt reaches sessions the previous call had not yet gossiped,
   * while staying bounded (one extra sweep, still under the store cap).
   * @param expand - chase one referral hop beyond the current store walk.
   */
  type DirectoryTeamRow = { team: string; session: string; name: string; description: string; local?: boolean; origin?: string; workspace?: string }
  async function listDirectoryTeams(expand: boolean): Promise<DirectoryTeamRow[]> {
    const localOrigin = lanIp === '' ? `${session} [this host]` : `${session} [this host, ${lanIp}]`
    const teams: DirectoryTeamRow[] = [
      { team: config.team, session, name: config.agentName, description: '', local: true, origin: localOrigin },
      ...[...sessionNodes.values()].map(agent => ({
        team: sessionTeamOf(agent),
        session,
        ...nodeMetadataOf(agent),
        local: true,
        origin: localOrigin,
      })),
    ]
    const fetch = memoizedCardFetch()
    // Collect per peer in store order (concurrent fetches, ordered merge):
    // the listing's row order follows the peer store's preference order,
    // independent of fetch completion timing.
    const collectPeer = async (peer: string): Promise<DirectoryTeamRow[]> => {
      const card = await fetch(peer)
      if (card === undefined) return []
      // The origin fields (publisher session label + LAN IP) are natural
      // grouping dimensions: a fleet's rows cluster by the host that owns
      // them, no manual grouping required.
      const origin = card.lanIp !== undefined ? `${card.session} (${card.lanIp})` : card.session
      const rows: DirectoryTeamRow[] = [
        { team: card.team, session: card.session, name: card.name, description: '', origin },
      ]
      for (const entry of card.sessionTeams ?? []) {
        rows.push({ team: entry.team, session: card.session, name: entry.name, description: entry.description, origin, ...(entry.workspace !== undefined ? { workspace: entry.workspace } : {}) })
      }
      return rows
    }
    const sweep = async (peers: readonly string[]): Promise<void> => {
      const collected = await Promise.all(peers.map(collectPeer))
      for (const rows of collected) teams.push(...rows)
    }
    const before = peerStore.list()
    await sweep(before)
    if (expand) {
      // One extra hop: only peers the first sweep's referrals newly offered,
      // collected once each — the memo keeps already-fetched URLs free.
      const fresh = peerStore.list().filter(peer => !before.includes(peer))
      if (fresh.length > 0) await sweep(fresh)
    }
    return teams
  }

  /**
   * Track one routed task in the ledger when its result leaves it owed a
   * receipt: delivered-but-unanswered tasks (an async dispatch, the
   * reply-wait deadline's release, or an aborted wait) reconcile later when
   * the `[A2A receipt] task <id>` message arrives, while a synchronous
   * completion already carries its answer and owes nothing.
   */
  const trackOwedTask = (taskId: string, team: string, peer: string, result: A2aRouteResult): void => {
    if (!result.ok) return
    if (result.task_status !== 'TASK_STATE_DELIVERED' && result.task_status !== 'TASK_STATE_ABORTED_WAIT') return
    taskLedger.track(taskId, team, peer, result.context_id === '' ? undefined : result.context_id)
  }

  ctx.tools.register(defineTool({
    name: 'a2a_route',
    description:
      'Route a message to a remote A2A team on the peer network and await its reply. '
      + 'Pick the team with a2a_teams first. Team names also resolve through peers\' signed zone '
      + 'delegation records (zone-relative, at most 5 hops). Reuse context_id from a previous reply '
      + 'to continue that conversation. The call blocks until the remote team responds, which may take minutes — '
      + 'pass async for long-running tasks: delivery returns immediately and the target routes a receipt '
      + '(message starting "[A2A receipt] task <task_id> <outcome summary>") back to your team.',
    parameters: {
      team: { type: 'string', required: true, description: 'Target team name, from a2a_teams.' },
      message: { type: 'string', required: true, description: 'The request text to send.' },
      context_id: { type: 'string', description: 'Context id from a previous a2a_route reply, to continue that conversation.' },
      async: { type: 'boolean', description: 'Fire-and-forget: deliver and return immediately (delivered:true + task_id) without waiting for the target\'s reply. The target answers by routing a receipt — a message starting "[A2A receipt] task <task_id> <outcome summary>" — back to your team (visible in a2a_status activity), or follow up with the context_id. Prefer async for long-running tasks (minutes to hours).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
      render: renderRoute,
    },
    timeoutMs: config.routeTimeoutMs,
    presentCall: args => ({ card: 'generic', title: `A2A route → ${args.team}`, kind: 'other', rawInput: args }),
    execute: async (args: { team: string; message: string; context_id?: string; async?: boolean }, exec): Promise<Record<string, JsonValue>> => {
      // The caller identity travels as a routable team (the calling session's
      // node team when it has joined, else the node label), so the receiver
      // can answer with one a2a_route instead of an unroutable display label.
      const callerSession = exec.agent === undefined ? undefined
        : sessionNodes.has(String(exec.agent.id)) ? sessionTeamOf(exec.agent) : sessionLabelOf(exec.agent)
      const fetch = memoizedCardFetch()
      // The task id is born at the caller (idempotency key semantics): both
      // dispatchers carry the one id, the peer request echoes it, and the
      // steered receipt header names it — so "[A2A receipt] task <id>" from
      // the target correlates with the route's own result verbatim.
      const taskId = `direct-${Math.random().toString(16).slice(2, 10)}`
      // Candidate order: this host's own teams first (an in-process steer —
      // cheapest possible and immune to nested-signal aborts), then direct
      // publishers, then zone delegations, deduplicated by URL.
      const failures: string[] = []
      const outcome = await dispatchLocalCandidate(args.team, args.message, callerSession, args.context_id, exec.signal, args.async === true, taskId)
      if (outcome !== undefined) {
        if (outcome.ok) {
          trackOwedTask(taskId, args.team, 'local', outcome)
          return outcome as unknown as Record<string, JsonValue>
        }
        failures.push(`local: ${outcome.error}`)
      }
      const candidates = await directoryPeerCandidates(fetch, args.team, failures)
      // Failover: try every candidate in order — an offline path falls back
      // to the next alternate without a caller-visible error; only
      // exhaustion surfaces, with each candidate's reason.
      for (const candidate of candidates) {
        // Capability gate: wait:false only dials peers whose signed card
        // declares async — against a pre-0.5.2 peer the flag would silently
        // degrade into a minutes-long blocking hold (an async intent must
        // never turn into a surprise wait). The memo keeps the card fetch
        // free after the directory walk.
        let peerAsync = false
        if (args.async === true) {
          const card = await fetch(candidate)
          const caps = card?.capabilities as { async?: unknown } | undefined
          peerAsync = card !== undefined && caps?.async === true
        }
        const result = await dispatchPeerCandidate(candidate, args.team, args.message, args.context_id, exec.signal, callerSession, peerAsync, taskId)
        if (result.ok || exec.signal.aborted) {
          if (result.ok) trackOwedTask(taskId, args.team, candidate, result)
          if (args.async === true && !peerAsync && result.ok) {
            return { ...result, reply: `${result.reply}\n(Note: the peer does not advertise async; the call waited synchronously.)` } as unknown as Record<string, JsonValue>
          }
          return result as unknown as Record<string, JsonValue>
        }
        failures.push(`${candidate}: ${result.error}`)
      }
      if (failures.length > 0) logger.warn(`route to team "${args.team}" exhausted its candidates: ${failures.join('; ')}`)
      return {
        ok: false,
        error: candidates.length === 0
          ? `team "${args.team}" is not published by any configured peer${failures.length === 0 ? '' : ` (unresolved delegations: ${failures.join('; ')})`}`
          : `team "${args.team}" failed on every candidate: ${failures.join('; ')}`,
        code: -32004,
      }
    },
  }))

  /**
   * The route dispatcher's local half: same-host candidates dial in-process,
   * not over loopback HTTP — a loopback fetch nests the final wait inside the
   * caller's own tool signal, and when that turn budget aborts, the abort
   * surfaces as the peer's failure even though delivery succeeded. The turn
   * signal still races the wait; on abort the honest result reports delivery
   * without a reply. Results use the canonical A2aRouteOk shape — the wire
   * route shape renders as "failed: undefined" through the tool renderer.
   * @param asyncMode - deliver without waiting: the steer fires, the
   * registered waiter still flushes (harmlessly) into the settled promise,
   * and the caller gets the delivered shape with the receipt contract.
   * @returns the canonical result, or undefined when the team is not local.
   */
  async function dispatchLocalCandidate(team: string, message: string, callerSession: string | undefined, contextId: string | undefined, signal: AbortSignal, asyncMode = false, taskIdFromCaller?: string): Promise<A2aRouteResult | undefined> {
    const webServer = ctx.get('webServer')
    const teamIsLocal = team === config.team
      || resolveAgentForTeam(team) !== undefined
      || joinedSessions.list().some(id => `${config.team}/${id8(id)}` === team)
    if (!teamIsLocal || webServer === undefined) return undefined
    // A receipt relayed between same-host sessions (the answering session
    // routing its `[A2A receipt]` back over the in-process candidate)
    // correlates here too — same contract, no HTTP on the path.
    taskLedger.resolveFromMessage(message)
    const taskId = taskIdFromCaller ?? `direct-${Math.random().toString(16).slice(2, 10)}`
    const flight = beginRoute(team, 'local')
    if (asyncMode) {
      // Delivery means the message is IN, not merely enqueued: a cold team
      // materializes first (the wake settles, or fails honestly), then the
      // steer fires, then delivered answers. The receipt header carries the
      // task id so the target can echo it back verbatim.
      const agent = resolveAgentForTeam(team) ?? (team === config.team ? liveAgent() : undefined)
      const woken = agent !== undefined ? Promise.resolve(agent) : wakeColdTeam(team)
      if (woken === undefined) {
        endRoute(flight)
        return { ok: false, error: `No live DSH session node accepts team "${team}" and no cold joined session matches it.`, code: -32000 }
      }
      try {
        const target = await woken
        steerRelay(target, `[A2A direct] (task ${taskId}) from "${callerSession ?? session}" (routed to ${team}) sent:\n\n${message}`)
        endRoute(flight)
        recordActivity('out', team, 'local', true)
        return {
          ok: true,
          team,
          reply: `Delivered to ${team} (async). The target routes a receipt — a message starting "[A2A receipt] task ${taskId} <outcome summary>" — back to your team when done; watch a2a_status activity or follow up with the context id.`,
          task_id: taskId,
          context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
          task_status: 'TASK_STATE_DELIVERED',
        }
      } catch (error) {
        endRoute(flight)
        recordActivity('out', team, 'local', false)
        return { ok: false, error: `waking or steering the session for team "${team}" failed: ${String(error)}`, code: -32000 }
      }
    }
    const wait = routeIntoAgent(team, message, callerSession ?? session, taskId)
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
    // A reply wait without a deadline parks the caller's whole turn forever
    // when the target session answers on its own (slow or never) cadence. The
    // deadline turns that into the same honest delivered shape the abort path
    // returns: the receipt contract carries the follow-up, the caller keeps
    // moving.
    const REPLY_WAIT_MS = 180_000
    const expired = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => { reject(new Error('reply-wait-timeout')) }, REPLY_WAIT_MS)
      timer.unref?.()
      const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
      const onAbort = (): void => done()
      signal.addEventListener('abort', onAbort, { once: true })
      wait.then(done, done)
    })
    let outcome: Awaited<ReturnType<typeof routeIntoAgent>>
    try {
      outcome = await Promise.race([wait, aborted, expired])
    } catch (error) {
      if (String(error).includes('reply-wait-timeout')) {
        endRoute(flight)
        recordActivity('out', team, 'local', true)
        return {
          ok: true,
          team,
          reply: `The message was delivered to ${team}, but no reply arrived within ${Math.round(REPLY_WAIT_MS / 1000)}s (the target session answers on its own cadence). It routes a receipt, a message starting "[A2A receipt] task ${taskId}", back to your team when done; check a2a_status activity or follow up with the context id.`,
          task_id: taskId,
          context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
          task_status: 'TASK_STATE_DELIVERED',
        }
      }
      endRoute(flight)
      recordActivity('out', team, 'local', true)
      return {
        ok: true,
        team,
        reply: `The message was delivered to ${team}, but the wait for its reply was aborted (the target session answers on its own cadence; route again with the context id).`,
        task_id: taskId,
        context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
        task_status: 'TASK_STATE_ABORTED_WAIT',
      }
    }
    endRoute(flight)
    recordActivity('out', team, 'local', outcome.ok)
    if (outcome.ok) {
      return {
        ok: true,
        team,
        reply: outcome.reply,
        task_id: taskId,
        context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
        task_status: 'TASK_STATE_COMPLETED',
      }
    }
    return { ok: false, error: outcome.error, code: -32000 }
  }

  /**
   * The route dispatcher's peer half: one candidate dial with the in-flight
   * registration and activity-ring record the panel reads. Async mode sends
   * wait:false — the peer steers and answers delivered immediately (its
   * 0.5.2+ handler), so cross-host long tasks ride the receipt contract
   * exactly like same-host ones; older peers that ignore the flag simply
   * keep the blocking wait (graceful degradation).
   */
  async function dispatchPeerCandidate(url: string, team: string, message: string, contextId: string | undefined, signal: AbortSignal, callerSession: string | undefined, asyncMode = false, taskIdFromCaller?: string): Promise<A2aRouteResult> {
    const flight = beginRoute(team, url)
    const result = await client.routeDirect(url, team, message, contextId, signal, callerSession, asyncMode, taskIdFromCaller)
    endRoute(flight)
    recordActivity('out', team, url, result.ok)
    return result
  }

  /**
   * The directory's candidate walk for one team: direct publishers first,
   * then every tracked zone's delegation resolutions (cycle/depth/key-binding
   * failures are configuration bugs: closed, logged, and surfaced into
   * {@link failures}), deduplicated by URL.
   */
  async function directoryPeerCandidates(fetch: (url: string) => Promise<A2aPeerCard | undefined>, team: string, failures: string[]): Promise<string[]> {
    const candidates: string[] = []
    for (const peer of peerStore.list()) {
      const card = await fetch(peer)
      if (card === undefined) continue
      if (card.team === team || (card.sessionTeams ?? []).some(entry => entry.team === team)) candidates.push(peer)
    }
    for (const peer of peerStore.list()) {
      const outcome = await resolveZone(fetch, peer, team)
      if (outcome.ok) {
        if (!candidates.includes(outcome.url)) candidates.push(outcome.url)
        continue
      }
      if (outcome.reason === 'not-found' || outcome.reason === 'unreachable') continue
      failures.push(`${peer} ${outcome.reason}: ${outcome.detail}`)
    }
    return candidates
  }

  ctx.tools.register(defineTool({
    name: 'a2a_status',
    description:
      'Read-only A2A network health: the tracked peer fleet with quality scores, routes currently in flight '
      + '(who is waiting on whom), and the recent routing activity ring (inbound and outbound outcomes). '
      + 'Use it to observe an ongoing collaboration or diagnose delivery instead of re-routing.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          peers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                score: { type: 'number' },
              },
            },
          },
          inFlight: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                team: { type: 'string', required: true },
                peer: { type: 'string', required: true },
                startedAt: { type: 'number', required: true },
              },
            },
          },
          activity: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ts: { type: 'number', required: true },
                dir: { type: 'string', required: true },
                team: { type: 'string', required: true },
                peer: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          ...(value.inFlight.length === 0 ? [] : ['In flight:']),
          ...value.inFlight.map((route: { team: string; peer: string }) => `  → ${route.team} via ${route.peer === 'local' ? 'this host' : route.peer}`),
          `Peers (${String(value.peers.length)}):`,
          ...value.peers.map((peer: { url: string; score?: number }) => `  ${peer.url}${typeof peer.score === 'number' ? ` (score ${String(Math.round(peer.score))})` : ''}`),
          ...(value.activity.length === 0 ? [] : ['Recent routes:']),
          ...[...value.activity].reverse().slice(0, 10).map((entry: { dir: string; team: string; ok: boolean }) => `  ${entry.dir === 'in' ? '←' : '→'} ${entry.team} ${entry.ok ? 'ok' : 'failed'}`),
        ].join('\n'),
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'A2A network status', kind: 'other', rawInput: null }),
    execute: async (): Promise<{
      ok: boolean
      peers: { url: string; score?: number }[]
      inFlight: { team: string; peer: string; startedAt: number }[]
      activity: RouteActivityEntry[]
    }> => {
      return {
        ok: true,
        peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),
        inFlight: [...inFlightRoutes.values()].map(route => ({ team: route.team, peer: route.peer, startedAt: route.startedAt })),
        activity: recentActivity.slice(),
      }
    },
  }))

  /** Human duration for a ledger row: how long a task has been owed or took. */
  const describeAge = (ms: number): string => {
    const minutes = Math.floor(ms / 60_000)
    if (minutes < 1) return 'under a minute'
    if (minutes < 60) return `${String(minutes)}m`
    return `${String(Math.floor(minutes / 60))}h${minutes % 60 === 0 ? '' : `${String(minutes % 60)}m`}`
  }

  ctx.tools.register(defineTool({
    name: 'a2a_tasks',
    description:
      'Read-only ledger of routed A2A tasks that are owed a receipt: every async delivery or released wait '
      + 'stays queryable until its `[A2A receipt] task <task_id>` message correlates (then it shows the outcome '
      + 'summary). Use it to reconcile dispatched async work instead of re-routing to ask for progress.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                taskId: { type: 'string', required: true },
                team: { type: 'string', required: true },
                peer: { type: 'string', required: true },
                startedAt: { type: 'number', required: true },
                contextId: { type: 'string' },
                status: { type: 'string', required: true },
                resolvedAt: { type: 'number' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.length === 0
          ? 'No routed tasks are owed a receipt.'
          : [
            ...(value.tasks.some((task: { status: string }) => task.status === 'pending') ? ['Owed receipts:'] : []),
            ...value.tasks.filter((task: { status: string }) => task.status === 'pending').map((task: { taskId: string; team: string; peer: string; startedAt: number; contextId?: string }) => {
              // Beyond an hour the receipt is more likely lost than late
              // (the target died before routing it): name the two ways out.
              const overdue = Date.now() - task.startedAt > 60 * 60_000
                ? ', still no receipt — the target may be gone; probe it or follow up with the context id'
                : ''
              const context = task.contextId === undefined || task.contextId === '' ? '' : `, follow-up context ${task.contextId}`
              return `  - ${task.taskId} → ${task.team} (via ${task.peer === 'local' ? 'this host' : task.peer}), waiting ${describeAge(Date.now() - task.startedAt)}${context}${overdue}`
            }),
            ...(value.tasks.some((task: { status: string }) => task.status === 'resolved') ? ['Resolved:'] : []),
            ...value.tasks.filter((task: { status: string }) => task.status === 'resolved').map((task: { taskId: string; team: string; peer: string; startedAt: number; resolvedAt?: number; summary?: string }) => `  - ${task.taskId} → ${task.team} (via ${task.peer === 'local' ? 'this host' : task.peer})${typeof task.resolvedAt === 'number' ? ` after ${describeAge(task.resolvedAt - task.startedAt)}` : ''}: ${task.summary === undefined || task.summary === '' ? 'resolved' : task.summary}`),
          ].join('\n'),
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'A2A task ledger', kind: 'other', rawInput: null }),
    execute: async (): Promise<{ ok: boolean; tasks: { taskId: string; team: string; peer: string; startedAt: number; contextId?: string; status: 'pending' | 'resolved'; resolvedAt?: number; summary?: string }[] }> => {
      return { ok: true, tasks: taskLedger.list().map(task => ({ ...task })) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_probe',
    description:
      'Probe the tracked peer fleet for reachability and round-trip latency: one verified-card fetch per peer '
      + '(the same fetch discovery uses), reporting reachable peers with their team and latency and unreachable '
      + 'ones with the failure reason. Pass url to probe one target instead of the whole fleet. Use it before '
      + 'dispatching verification work or when routes fail over, instead of guessing which node is down.',
    parameters: {
      url: { type: 'string', description: 'Optional single peer base URL to probe; empty probes every tracked peer.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                reachable: { type: 'boolean', required: true },
                ms: { type: 'number', description: 'Round-trip of the card fetch, reachable or not.' },
                team: { type: 'string', description: 'The team the peer publishes, when reachable.' },
                error: { type: 'string', description: 'Why the peer is unreachable.' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Fleet probe (${String(value.results.length)}):`,
          ...value.results.map((row: { url: string; reachable: boolean; ms?: number; team?: string; error?: string }) =>
            `  ${row.reachable ? '✓' : '✗'} ${row.url}${row.reachable ? ` (team ${String(row.team)}, ${String(row.ms)}ms)` : ` (${String(row.error)})`}`),
        ].join('\n'),
      }],
    },
    presentCall: args => ({ card: 'generic', title: args.url === undefined || args.url === '' ? 'Probe the A2A fleet' : `Probe A2A peer: ${args.url}`, kind: 'other', rawInput: args }),
    execute: async (args: { url?: string }): Promise<{ ok: boolean; results: { url: string; reachable: boolean; ms: number; team?: string; error?: string }[] }> => {
      const targets = args.url !== undefined && args.url !== '' ? [args.url] : peerStore.list()
      const probeOne = async (url: string): Promise<{ url: string; reachable: boolean; ms: number; team?: string; error?: string }> => {
        const startedAt = Date.now()
        const outcome = await client.fetchCardDetail(url)
        const ms = Date.now() - startedAt
        // The fetch is the probe: settling it moves the peer's quality score
        // and learns its referrals, exactly like a discovery sweep would,
        // while the outcome's stage names the failure for the report.
        const card = settlePeerCard(url, outcome)
        if (card !== undefined) return { url, reachable: true, ms, team: card.team }
        if (outcome.ok) return { url, reachable: false, ms, error: 'dropped: the card lists this node back as its own referral' }
        return outcome.stage === 'unreachable'
          ? { url, reachable: false, ms, error: `unreachable: ${outcome.detail}` }
          : { url, reachable: false, ms, error: `rejected: ${outcome.reason} card` }
      }
      // Promise.all keeps the report in the store's preference order.
      return { ok: true, results: await Promise.all(targets.map(probeOne)) }
    },
  }))

  /**
   * Steering targets awaiting a final reply, keyed by agent session id. Each
   * entry remembers the request id to answer and the log length when the
   * message was steered, so the flush reads only fresh assistant output.
   */
  interface FinalWaiter {
    readonly answer: (text: string) => void
    readonly sinceEvents: number
    timeoutDisposer?: () => void
  }
  const pendingFinals = new Map<string, FinalWaiter[]>()
  const armFlushTimeout = (agentId: string, waiter: FinalWaiter): (() => void) => {
    return ctx.timer.timeout(() => {
      const entries = pendingFinals.get(agentId)
      if (entries === undefined) return
      const kept = entries.filter(entry => entry !== waiter)
      if (kept.length === 0) pendingFinals.delete(agentId)
      else pendingFinals.set(agentId, kept)
      waiter.answer('The DSH session produced no final reply within the configured window.')
    }, config.flushTimeoutMs)
  }

  function flushFinals(agentId: string): void {
    const entries = pendingFinals.get(agentId)
    if (entries === undefined || entries.length === 0) return
    const agent = ctx.get('agents')?.get(SessionId(agentId))
    if (agent === undefined) {
      for (const entry of entries) {
        entry.timeoutDisposer?.()
        entry.answer('The target DSH session is no longer live.')
      }
      pendingFinals.delete(agentId)
      return
    }
    const events = agent.session.events
    const floor = Math.min(...entries.map(entry => entry.sinceEvents))
    let reply = ''
    for (let index = events.length - 1; index >= floor; index--) {
      const event = events[index]
      if (event === undefined || event.type !== 'assistant/message') continue
      reply = event.data.message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n')
      break
    }
    if (reply !== '') {
      for (const entry of entries) entry.answer(reply)
      pendingFinals.delete(agentId)
    }
  }

  // Every inbound route is a direct route (final semantics), so the idle
  // flush listens unconditionally — an empty pendingFinals map makes it a
  // no-op. Node facts need no refresh here: the card serves them fresh at
  // read time.
  ctx.on('agent/status', (payload) => {
    if (payload.status === 'idle') flushFinals(String(payload.agent.id))
  })
}

/**
 * Load the node's Ed25519 private key, generating and persisting it on first
 * use. The key IS the node's card identity: a persisted key keeps signatures
 * verifiable across restarts, which is why storage lands with the announce
 * config surface rather than after it.
 * @param path - absolute PEM path (`<dsh-home>/a2a/node-key.pem`).
 * @returns the private key used to sign every published card.
 */
function loadOrCreateNodeKey(path: string): ReturnType<typeof generateKeyPairSync>['privateKey'] {
  if (existsSync(path)) {
    return createPrivateKey(readFileSync(path, 'utf8'))
  }
  const { privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  return privateKey
}

/**
 * Derive the default wire session label from a per-home node id: eight hex
 * characters generated once, so two deployments mounting defaults do not
 * collide while a persisted home keeps the label stable across restarts.
 * @param home - resolved harness home.
 * @returns the derived session label (`dsh-host-<8 hex>`).
 */
function deriveSession(home: string): string {
  const path = join(home, 'a2a', 'node-id')
  if (existsSync(path)) return `dsh-host-${readFileSync(path, 'utf8').trim()}`
  const id = randomBytes(4).toString('hex')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${id}\n`, { mode: 0o600 })
  return `dsh-host-${id}`
}
