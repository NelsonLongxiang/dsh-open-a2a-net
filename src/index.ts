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
import { CanvasStore } from './canvas-store.ts'
import { LayoutStore } from './layout-store.ts'
import { fileURLToPath } from 'node:url'
import { JoinedSessions } from './joined-store.ts'
import { PeerStore } from './peer-store.ts'
import { SelfReferralFilter } from './self-suppress.ts'
import { resolveStageMount } from './stage-mount.ts'
import { TaskLedger, SUMMARY_CAP, type ReceiptResolvedInfo } from './task-ledger.ts'
import { formatReceipt, parseReceipt } from './receipt.ts'
import { runReceiptLadder } from './receipt-ladder.ts'
import { IdempotencyStore, WIRE_ERROR_IDEMPOTENCY_CONFLICT, WIRE_ERROR_REPLAY_REJECTED, peerPayloadFingerprint, type IdempotencyStats } from './idempotency-store.ts'
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
import { MAX_LAYOUT_BODY_BYTES, WIRE_ERROR_PAYLOAD_TOO_LARGE, withinRouteBodyCap } from './transport-caps.ts'
import type { A2aPeerCard, A2aRouteResult, ZoneRecord } from './types.ts'
import { NATIVE_TEAMS_A2A_FACE_KEY, type NativeTeamsBridgeFace } from './teams-bridge.ts'

export type * from './types.ts'
export { A2aClient } from './a2a-client.ts'
export type { A2aClientOptions, A2aFetch, A2aSchedule } from './a2a-client.ts'
export { NATIVE_TEAMS_A2A_FACE_KEY } from './teams-bridge.ts'
export type { NativeTeamsBridgeFace, TeamsBridgeResolveInfo, TeamsBridgeSubmitOutcome, TeamsBridgeSubmitRequest } from './teams-bridge.ts'
export type { ReceiptResolvedInfo } from './task-ledger.ts'

// P2 seam: every correlated receipt is announced on this event for peer
// plugins that track async submissions natively (native-teams settles its
// outstanding `startRoundAsync` rounds from it). Payload vocabulary lives in
// ReceiptResolvedInfo; emission is fire-and-forget at both receipt arrival
// points (the direct endpoint and the local dispatch relay).
declare module '@deepseek-ai/cordis' {
  interface Events {
    'a2a/receipt-resolved'(payload: ReceiptResolvedInfo): void
  }
}

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
   * Prewarm every cold joined session's agent after the plugin mounts (dev
   * boxes and always-on collaboration hosts that restart often: the network
   * state returns without opening each session). Each wake materializes a
   * full agent — a main-thread log replay — so the prewarm is deferred,
   * foreground-yielding, and cancellable (see `wakePrewarmDelayMs` /
   * `wakePrewarmQuietMs`); the default stays off for deployments that would
   * rather pay on demand (wake-on-route and the sidebar's wake button remain
   * available either way).
   */
  readonly wakeJoinedOnBoot: boolean
  /**
   * Idle delay between loader settlement and the first boot prewarm wake:
   * boot traffic gets a clear window before any log replay starts. `0`
   * restores the old fire-at-settle behavior.
   */
  readonly wakePrewarmDelayMs: number
  /**
   * Foreground quiet window: a wake/route demand inside this window (or any
   * outbound route still in flight) postpones the next prewarm step. Panel
   * polls never count. `0` disables the yield.
   */
  readonly wakePrewarmQuietMs: number
  /**
   * Pause between consecutive boot prewarm wakes. Each wake replays a full
   * session log — the zstd decode yields the event loop only every 500ms —
   * so unbounded concurrent wakes of several huge logs starve every request
   * for tens of seconds after a restart. The serial queue with this pause
   * keeps the preheat while capping decode saturation, and wake-on-route
   * never waits on this queue.
   */
  readonly wakeBootStaggerMs: number

  /**
   * v0.5.23 (async-stall): see the schema comment on asyncNudgeDelayMs.
   */
  readonly asyncNudgeDelayMs: number
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
  /**
   * Opt-in native-teams inbound bridge: when composed with
   * `@nelsonlongxiang/dsh-native-teams`, a routed team name that its
   * registry classifies as an unambiguous local claim dispatches through
   * its authoritative routing seam (`/a2a/direct`, the outbound A2A tools,
   * and the directory listing). Off by default — exposing every registered
   * team to the network is an operator decision (exposure-grants
   * governance: grants are deliberate, never ambient). Dispatcher-level
   * only: inbound callers address the team, never its individual members
   * (members stay visible-not-addressable).
   */
  readonly nativeTeamsInbound?: boolean
  /**
   * Reply-wait budget for one native-teams round (the bridge's answer
   * deadline, mirroring the steer path's 180s deadline). A round still
   * running past it answers the honest delivered-unsettled shape instead
   * of parking the caller; the round itself keeps going.
   */
  readonly nativeRoundWaitMs?: number
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
  wakePrewarmDelayMs: s.number().default(10_000),
  wakePrewarmQuietMs: s.number().default(5_000),
  wakeBootStaggerMs: s.number().default(3_000),

  /**
   * v0.5.23 (async-stall): delay before a delivered-but-unconsumed async
   * route re-wakes its target with a one-line nudge (defect
   * t-mt6nd0sq-hxuhj6). 0 disables the nudge entirely.
   */
  asyncNudgeDelayMs: s.number().default(120_000),
  stateColdRowsTtlMs: s.number().default(5_000),
  cardCacheTtlMs: s.number().default(60_000),
  cardCacheNegativeTtlMs: s.number().default(30_000),
  remoteRowsTtlMs: s.number().default(15_000),
  cardTtlMs: s.number().default(172_800_000),
  flushTimeoutMs: s.number().default(300_000),
  routeTimeoutMs: s.number().default(1_800_000),
  nativeTeamsInbound: s.boolean().default(false),
  nativeRoundWaitMs: s.number().default(180_000),
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
/**
 * Exposure audit for unauthenticated direct deliveries (defect card F4, the
 * zero-risk slice). `/a2a/direct` carries no per-call caller identity yet
 * (docs/protocol/delivery-origin-auth.md stays best-effort until the
 * OriginClaim envelope lands), so with an empty `apiKey` every process that
 * can reach this host's ports can steer every joined session. A node that
 * only talks to loopback peers (same-host collaboration) is not exposed;
 * one seeded with non-loopback peers is, and the operator should either set
 * `apiKey` or accept the exposure deliberately.
 * @param peers - the configured seed peer URLs.
 * @param apiKey - the configured API key ('' disables header auth).
 * @returns the non-loopback seed peers and, when they coincide with an
 *   empty key, the boot warning to log.
 */
export function directDeliveryExposure(
  peers: readonly string[],
  apiKey: string,
): { nonLoopbackPeers: string[]; warning: string | undefined } {
  const nonLoopbackPeers = peers.filter((peer) => {
    try {
      const { hostname } = new URL(peer)
      const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
      return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host))
    } catch {
      return false // a malformed seed URL says nothing about exposure
    }
  })
  const warning =
    nonLoopbackPeers.length > 0 && apiKey === ''
      ? 'a2a: unauthenticated direct deliveries are accepted from any host that can reach this node (non-loopback peers configured, apiKey empty) — any local process or reachable peer can steer every joined session; set apiKey to require the X-API-Key header, or see docs/protocol/delivery-origin-auth.md for the enforcement plan'
      : undefined
  return { nonLoopbackPeers, warning }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('a2a')
  // F4 slice: say the quiet part at boot instead of leaving the exposure to
  // be discovered from a ledger full of unexplained steering.
  const exposure = directDeliveryExposure(config.peers, config.apiKey)
  if (exposure.warning !== undefined) logger.warn(exposure.warning)
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
  // Wire code for boundary-refused corrupted text. -32004 is intentionally
  // left as a reservation gap for the client-abort telemetry family seen in
  // the wild; this lands at -32005 (cluster-C error-code registry).
  const WIRE_ERROR_TEXT_CORRUPTED = -32005

  /**
   * Boundary guard for undecodable text (consumed by the readJsonBody
   * guard): U+FFFD is produced by a lossy decoder upstream of us — the bytes
   * arrived already destroyed, so storing them would only immortalize
   * garbage names and excerpts.
   */
  function anyReplacementChar(value: unknown): boolean {
    if (typeof value === 'string') return value.includes('\uFFFD')
    if (Array.isArray(value)) return value.some(entry => anyReplacementChar(entry))
    if (value !== null && typeof value === 'object') {
      return Object.values(value).some(entry => anyReplacementChar(entry))
    }
    return false
  }

  function readJsonBody(req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void, maxBytes = 10_000): void {
    const chunks: Buffer[] = []
    let size = 0
    // Same contract as the direct endpoint's reader (B5 enforcement): an
    // oversized body is rejected, never truncated and never connection-
    // killed mid-read — buffering stops at the crossing chunk, the stream
    // drains to `end`, and the client receives one structured 413 (the old
    // behavior tore the socket down with no diagnosis at all). The default
    // keeps the historical 10 KiB control cap; the layout save route passes
    // MAX_LAYOUT_BODY_BYTES because a full-fleet document legitimately
    // exceeds it (LayoutStore still clamps every value server-side).
    let overflowed = false
    const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
    if (Number.isFinite(declared) && declared > maxBytes) overflowed = true
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return
      const next = size + chunk.length
      if (next > maxBytes) {
        overflowed = true
        chunks.length = 0
        return
      }
      size = next
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (overflowed) {
        if (!res.writableEnded && !res.headersSent) {
          const payload = JSON.stringify({ error: 'payload too large', code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
          res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        }
        return
      }
      let body: { readonly id?: unknown }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
      } catch {
        const payload = JSON.stringify({ error: 'malformed body' })
        res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }
      // P0 garbled-text guard (panel mojibake report): U+FFFD means the
      // sender's encoder destroyed the text BEFORE the wire. Persisting it
      // immortalizes the loss and re-displays garbage forever — refuse at
      // the boundary so corruption never reaches any store.
      if (anyReplacementChar(body)) {
        const payload = JSON.stringify({
          error: 'text contains undecodable characters (U+FFFD) — fix the sender encoding and retry',
          code: WIRE_ERROR_TEXT_CORRUPTED,
        })
        res.writeHead(422, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
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
  // Canvas teams: user-composed multi-member routing groups. A session node
  // may sit in many teams; routing to <team>/canvas/<name> resolves the
  // first live member or wakes the first cold one (member order = priority).
  const canvasStore = new CanvasStore(join(home, 'a2a', 'canvas.json'))
  // Spatial presentation state for the full-page stage (contract v2).
  const layoutStore = new LayoutStore(join(home, 'a2a', 'canvas-layout.json'))

  // The async-task ledger: every route that leaves a task owed a receipt is
  // queryable here, and the correlating `[A2A receipt] task <id>` message
  // resolves it — the caller-side half of the receipt contract, persisted so
  // a restart does not orphan the reconciliation.
  const taskLedger = new TaskLedger(join(home, 'a2a', 'tasks.json'))

  /**
   * Settle one message through the ledger and announce what it correlated
   * on `a2a/receipt-resolved` — the seam peer plugins (native-teams)
   * consume to settle their outstanding async submissions. Fence honesty:
   * the try/catch contains SYNCHRONOUS listener throws (cordis dispatch is
   * synchronous, so a throw lands here and the routing path survives); an
   * ASYNC listener that rejects escapes as an unhandled rejection and is
   * the consumer's own discipline — keep seam listeners synchronous.
   * @param message - the inbound or relayed message text.
   */
  function settleAndAnnounce(message: string): void {
    // W7 slice-2 hook 3: a receipt that correlates an id THIS node's
    // idempotency ledger claimed records the receipt's human line as that
    // key's outcome. Parsed DIRECTLY off the receipt codec — a claimed key
    // usually is NOT in the owed book (the claim lives on the receiving
    // side, the owed book on the dispatcher side), so the ledger's own
    // correlation would never reach it. `summary` is the one-line text;
    // the envelope's controlled-vocabulary outcome is never a product and
    // must not be recorded as one. First-write wins inside the store, so a
    // late receipt never overwrites a precise sync-hook record.
    const parsed = parseReceipt(message)
    if (parsed !== null && parsed.taskId !== '') {
      const line = parsed.summary.trim()
      if (line !== '') {
        idempotencyStore.recordOutcome(parsed.taskId, { status: 'completed', reply: line.slice(0, SUMMARY_CAP) })
      }
    }
    const resolved = taskLedger.resolveFromMessage(message)
    if (resolved === undefined) return
    try {
      ctx.emit('a2a/receipt-resolved', resolved)
    } catch (error) {
      logger.warn(`a2a: receipt-resolved listener rejected: ${String(error)}`)
    }
  }

  // Server-side idempotency keys (work-order P3): a caller-born task id
  // executes at most once inside the 24h window — same-key replays answer
  // refused-but-idempotent, same-key different-payload answers conflict.
  const idempotencyStore = new IdempotencyStore(join(home, 'a2a', 'idempotency.json'))

  // Self-referral suppression: gossip mirrors peer lists back and forth, so
  // a URL whose fetch just proved it serves this node keeps coming home as
  // an inbound referral; see src/self-suppress.ts for the shape of the fix.
  const selfReferrals = new SelfReferralFilter()

  // Session nodes: every joined top-level session is its own addressable
  // team (label `<session>-<agentId8>`, team `<team>/<agentId8>`). Joining
  // is a local fact: the entry dispatches `/a2a/direct` routes and rides
  // the announced card's unsigned sessionTeams listing.
  const sessionNodes = new Map<string, Agent>()
  // Live top-level agents: the join surface's candidates and the cold-row
  // complement (apply scope — the direct-route wake below reads it too).
  const liveRoots = new Map<string, Agent>()
  // Last foreground wake/route demand (epoch ms): boot prewarm steps yield
  // while demand keeps arriving inside the quiet window. Panel polls never
  // touch this — they are constant and would starve warming forever.
  let lastWakeDemandAt = 0

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

  // Per-id single-flight: a materialization is a full log replay (seconds of
  // main-thread decode for a large session), so two wake paths converging on
  // one cold id — a route arriving while boot prewarm is already replaying it —
  // must join the in-flight replay, not stack a second one. Rejections
  // propagate to every waiter (each caller keeps its own error policy); the
  // map entry clears in `finally` so a later wake can retry after a failure.
  const materializeInFlight = new Map<string, Promise<Agent>>()
  const materializeOnce = (id: string): Promise<Agent> | undefined => {
    const inFlight = materializeInFlight.get(id)
    if (inFlight !== undefined) return inFlight
    const started = materialize(id)
    if (started === undefined) return undefined
    const flight = started.finally(() => {
      if (materializeInFlight.get(id) === flight) materializeInFlight.delete(id)
    })
    materializeInFlight.set(id, flight)
    return flight
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
    const aliasId = joinedSessions.list().find(entry => !liveRoots.has(entry) && `${config.team}/${id8(entry)}` === team)
    // Canvas teams wake their first cold joined member (member order is
    // the routing priority; an archived member never wakes).
    const id = aliasId ?? canvasColdMemberId(parseCanvasTeamName(team))
    if (id === undefined) return undefined
    // An archived session never wakes: archive is closure, not sleep.
    if (archivedSessionFilter()?.(id) === true) return undefined
    // Route demand is foreground: boot prewarm yields to it for a quiet window.
    lastWakeDemandAt = Date.now()
    return materializeOnce(id)
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
      canvasStore.dropMember(id)
      logger.info(`a2a: archived session ${id8(id)} left the node network`)
    }
  }

  /**
   * Lifecycle revalidation for canvas membership: a member is legitimate
   * only while it is live on the network (a mounted session node) or while
   * a join intent is remembered. The control route enforces this at write
   * time, but canvas.json is a plain file — an external edit (or a join
   * intent that vanished between restarts) can leave a stale id behind.
   * Routing is already safe by construction (live resolution needs a
   * mounted node; cold wake needs the remembered intent), so this sweep is
   * hygiene, not a security backstop: it drops dead ids at the same seams
   * the archive prune runs (boot settlement and the state poll).
   */
  const pruneCanvasMemberships = (): void => {
    for (const name of canvasStore.list()) {
      for (const id of canvasStore.membersOf(name)) {
        if (sessionNodes.has(id) || joinedSessions.has(id)) continue
        canvasStore.removeMember(name, id)
        logger.info(`a2a: canvas team "${name}" dropped stale member ${id8(id)} (no live node, no join intent)`)
      }
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
   * The canvas team's wire name: `<team>/canvas/<name>`. The extra path
   * segment can never collide with a node alias (`<team>/<id8>`), so the
   * two namespaces coexist without reservation tables.
   */
  const canvasTeamOf = (name: string): string => `${config.team}/canvas/${name}`

  /** The canvas team name a routed team string names, when it exists. */
  const parseCanvasTeamName = (team: string): string | undefined => {
    const prefix = `${config.team}/canvas/`
    if (!team.startsWith(prefix)) return undefined
    const name = team.slice(prefix.length)
    return canvasStore.hasTeam(name) ? name : undefined
  }

  /** The canvas team's first live member agent (member order = priority). */
  function canvasLiveAgent(name: string | undefined): Agent | undefined {
    if (name === undefined) return undefined
    for (const id of canvasStore.membersOf(name)) {
      const agent = sessionNodes.get(id)
      if (agent !== undefined) return agent
    }
    return undefined
  }

  /**
   * The canvas team's first cold joined member id — the wake candidate.
   * Cold means: joined intent remembered, no live root, not archived.
   */
  function canvasColdMemberId(name: string | undefined): string | undefined {
    if (name === undefined) return undefined
    const isArchived = archivedSessionFilter()
    return canvasStore.membersOf(name).find(id =>
      joinedSessions.has(id) && !liveRoots.has(id) && isArchived?.(id) !== true)
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
    // An undefined answer is transient (service not yet ready on a cold
    // wake) - caching it would pin the miss until the log grows again.
    // Read-through instead: the title service is cheap, and the next poll
    // picks up the real title as soon as the service can produce one.
    if (title !== undefined) titleCache.set(agent, { length, tail, title })
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
      // Prewarm lifecycle: cancelled at fiber teardown so a mid-queue reload
      // or dispose never lets the old instance's queue keep waking sessions.
      let prewarmCancelled = false
      /** Retry cadence while foreground demand holds the prewarm back. */
      const PREWARM_YIELD_RETRY_MS = 1_000
      const pruneThenWake = (): void => {
        pruneArchivedJoins()
        pruneCanvasMemberships()
        if (!config.wakeJoinedOnBoot) return
        if (ctx.get('apiProxy') === undefined) {
          logger.warn('wakeJoinedOnBoot is on but no api gateway is composed; cold joined sessions stay asleep')
          return
        }
        // Low-priority prewarm instead of an eager serial chain: each wake
        // is a full main-thread log replay (the decode yields the loop only
        // every ~500ms), so waking every cold join at settlement starved
        // web requests for minutes on hosts with many large joined logs.
        // Three properties make the prewarm safe:
        //   deferred — nothing replays until wakePrewarmDelayMs after the
        //     tree settles, giving boot traffic a clear window;
        //   yielding — a foreground demand (a wake/route inside
        //     wakePrewarmQuietMs, or any outbound route in flight)
        //     postpones the next step; panel polls never count (they are
        //     constant and would starve warming forever);
        //   cancellable — disposal (reload, teardown) stops the queue; the
        //     timer seam itself fails closed after the timer service is gone.
        // Per-tick rechecks skip ids another path already woke, archived,
        // or left since queuing; the remount listener joins each node the
        // moment its woken agent publishes, and a failed wake keeps the cold
        // row and its intent. Wake-on-route and manual opens never queue.
        prewarmCancelled = false
        const ids = joinedSessions.list()
        let index = 0
        const step = (): void => {
          if (prewarmCancelled || ctx.fiber.uid === null) return
          while (index < ids.length
            && (liveRoots.has(ids[index]!) || !joinedSessions.has(ids[index]!) || archivedSessionFilter()?.(ids[index]!) === true)) index += 1
          if (index >= ids.length) return
          const foregroundBusy = Date.now() - lastWakeDemandAt < config.wakePrewarmQuietMs || inFlightRoutes.size > 0
          if (foregroundBusy) {
            schedule(step, PREWARM_YIELD_RETRY_MS)
            return
          }
          const id = ids[index++]!
          const startedAt = Date.now()
          const flight = materializeOnce(id)
          if (flight === undefined) return
          void flight
            .catch(error => {
              logger.warn(`boot wake of ${id} failed: ${String(error)}`)
            })
            .then(() => {
              logger.info(`a2a: boot prewarm ${id8(id)} settled in ${String(Date.now() - startedAt)}ms (${String(ids.length - index)} left)`)
              if (!prewarmCancelled && ctx.fiber.uid !== null) schedule(step, config.wakeBootStaggerMs)
            })
        }
        schedule(step, config.wakePrewarmDelayMs)
      }
      ctx.effect(() => () => {
        prewarmCancelled = true
      })
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
    // panel polls this route every 2s. Stale-while-revalidate: the first
    // read after boot pays one enumeration to seed the snapshot; every later
    // read serves the snapshot synchronously (fresh within the TTL, stale
    // past it while a single-flight background refresh runs) — the polled
    // handler never blocks on the persistence layer again. A rejecting list
    // degrades to the previous snapshot instead of an unhandled rejection.
    let coldRowsCache: { at: number; ids: Set<string> } | undefined
    let coldRowsRefresh: Promise<void> | undefined
    const refreshColdIds = (): Promise<void> => {
      if (coldRowsRefresh !== undefined) return coldRowsRefresh
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) return Promise.resolve()
      coldRowsRefresh = persistence.list()
        .then(headers => {
          coldRowsCache = { at: Date.now(), ids: new Set(headers.map(header => String(header.id))) }
        })
        .catch(() => {
          // Keep serving the last snapshot; the next expiry retries.
        })
        .finally(() => {
          coldRowsRefresh = undefined
        })
      return coldRowsRefresh
    }
    const coldJoinedIds = async (): Promise<Set<string>> => {
      if (coldRowsCache === undefined) {
        await refreshColdIds()
        // The refresh assigns inside a closure, so the outer narrowing does
        // not follow it — re-read through an explicitly typed view.
        return (coldRowsCache as { ids: Set<string> } | undefined)?.ids ?? new Set<string>()
      }
      if (Date.now() - coldRowsCache.at >= config.stateColdRowsTtlMs) void refreshColdIds()
      return coldRowsCache.ids
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
              .map(row => ({ team: row.team, name: row.name, ...(row.origin !== undefined ? { origin: row.origin } : {}), ...(row.via !== undefined ? { via: row.via } : {}), ...(row.workspace !== undefined ? { workspace: row.workspace } : {}) })),
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
            const t0 = Date.now()
            // The panel polls this route: pruning here makes a mid-session
            // archive leave the network within one poll interval, no restart
            // required.
            pruneArchivedJoins()
            pruneCanvasMemberships()
            const tPrune = Date.now()
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
            const tFacts0 = Date.now()
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
            const tFacts1 = Date.now()
            const coldCandidates = joinedSessions.list().filter(id => !liveRoots.has(id))
            const persistence = ctx.get('sessionPersistence')
            const persisted = persistence !== undefined && coldCandidates.length > 0 ? await coldJoinedIds() : new Set<string>()
            const tCold = Date.now()
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
              canvas: {
                teams: canvasStore.list().map(name => ({
                  name,
                  team: canvasTeamOf(name),
                  members: canvasStore.membersOf(name).map(id => ({
                    id,
                    team: `${config.team}/${id8(id)}`,
                    joined: sessionNodes.has(id) || joinedSessions.has(id),
                    live: sessionNodes.has(id),
                  })),
                })),
              },
              host: lanIp === '' ? {} : { lanIp },
              peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),
              remote: (refreshRemoteRows(), remoteRowsCache?.rows ?? []),
              activity: recentActivity.slice(),
              inFlight: [...inFlightRoutes.values()].map(route => ({
                team: route.team,
                peer: route.peer,
                startedAt: route.startedAt,
              })),
              // Owed receipts: pending rows only — the cross-turn waits the
              // in-flight ring cannot show. Dead-lettered rows ride their own
              // list and settled ones just a count, all additive so the panel
              // keeps rendering plain owed rows until it learns the tiers.
              tasks: taskLedger.list()
                .filter(task => task.status === 'pending')
                .map(task => ({ taskId: task.taskId, team: task.team, peer: task.peer, startedAt: task.startedAt, status: task.status })),
              tasksDead: taskLedger.list()
                .filter(task => task.status === 'dead')
                .map(task => ({ taskId: task.taskId, team: task.team, peer: task.peer, startedAt: task.startedAt, deadAt: task.deadAt ?? task.startedAt })),
              archivedCount: taskLedger.archive().length,
              // 0.5.36 observability: the idempotency window aggregate —
              // window occupancy, outcome split, and cumulative claim-verdict
              // counters (the data the UNIQUE-ization decision waits on).
              // Read-only; no fingerprints cross here (they are /a2a/query's
              // only auth material).
              idempotency: idempotencyStore.stats(),
            })
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              // Phase timing (ms since request start): prune / live-row facts /
              // cold-rows enumeration. Diagnostic for the poll-latency question.
              'X-A2A-Timing': `prune=${tPrune - t0};facts=${tFacts1 - tFacts0};cold=${tCold - tFacts1};total=${Date.now() - t0}`,
            })
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
            // Leaving the network leaves every canvas team too: membership
            // without join consent would be a routing backdoor.
            canvasStore.dropMember(id)
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
      // Canvas control: create/remove named multi-member teams and manage
      // membership. Same key guard as join/leave — membership enumerates
      // session ids. A member must be a joined session (live node or
      // remembered intent): canvas routing only reaches sessions the user
      // put on the network by gesture — no routing backdoor over unjoined
      // sessions.
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/__dsh_a2a/canvas',
        handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
          readJsonBody(req, res, (body) => {
            const action = body.action
            let payload: string
            if (action === 'create') {
              const name = typeof body.name === 'string' ? body.name : ''
              const stored = canvasStore.create(name)
              payload = JSON.stringify(stored === undefined ? { ok: false, error: 'invalid name or team cap reached' } : { ok: true, name: stored, teams: canvasStore.list() })
            } else if (action === 'remove') {
              const name = typeof body.name === 'string' ? body.name : ''
              payload = JSON.stringify({ ok: canvasStore.remove(name), teams: canvasStore.list() })
            } else if (action === 'add-member') {
              const name = typeof body.name === 'string' ? body.name : ''
              const id = typeof body.id === 'string' ? body.id : ''
              const memberJoined = id !== '' && (sessionNodes.has(id) || joinedSessions.has(id))
              if (name === '' || !memberJoined) {
                payload = JSON.stringify({ ok: false, error: 'name and a joined session id are required' })
              } else {
                canvasStore.create(name)
                payload = JSON.stringify({ ok: canvasStore.addMember(name, id), teams: canvasStore.list(), members: canvasStore.membersOf(name) })
              }
            } else if (action === 'remove-member') {
              const name = typeof body.name === 'string' ? body.name : ''
              const id = typeof body.id === 'string' ? body.id : ''
              if (name === '' || id === '') {
                payload = JSON.stringify({ ok: false, error: 'name and id are required' })
              } else {
                payload = JSON.stringify({ ok: canvasStore.removeMember(name, id), teams: canvasStore.list(), members: canvasStore.membersOf(name) })
              }
            } else {
              payload = JSON.stringify({ ok: false, error: 'unknown action' })
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
        }),
      }), 'a2a: session-canvas route')
      // Layout face (contract v2): whole-document GET + save/reset for the
      // stage's spatial presentation state. Validated/clamped server-side by
      // LayoutStore so a buggy client cannot poison persisted geometry.
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/__dsh_a2a/canvas-layout',
        handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
          if (req.method === 'GET') {
            const payload = JSON.stringify({ ok: true, layout: layoutStore.get() })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          readJsonBody(req, res, (body) => {
            const action = (body as { action?: unknown }).action
            if (action === 'reset') {
              layoutStore.reset()
              const payload = JSON.stringify({ ok: true, layout: null })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
            if (action === 'save') {
              const accepted = layoutStore.save((body as { layout?: unknown }).layout)
              const payload = JSON.stringify(accepted ? { ok: true, layout: layoutStore.get() } : { ok: false, error: 'payload is not a version-1 layout document' })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
            const payload = JSON.stringify({ ok: false, error: 'unknown action' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          }, MAX_LAYOUT_BODY_BYTES)
        }),
      }), 'a2a: canvas-layout route')
      // The dsh-a2a-munder-difflin floor stage: a same-origin full-page
      // surface adapted from the Munder Difflin office renderer (stage/,
      // NOTICE). Serves the built Vite tree with a traversal-guarded map.
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/__dsh_a2a_canvas',
        handler: (req: IncomingMessage, res: ServerResponse) => {
          const rootDir = fileURLToPath(new URL('../assets/stageDist', import.meta.url))
          // Directory-classic resolution: the bare mount 301s onto itself
          // with a slash, so the shell's `./assets` references resolve
          // inside this tree instead of 404ing against the web root.
          const MOUNT = '/__dsh_a2a_canvas'
          const resolved = resolveStageMount(req.url ?? '/', MOUNT)
          if (resolved.redirectTo !== undefined) {
            res.writeHead(301, { Location: resolved.redirectTo, 'Cache-Control': 'no-store', 'X-A2A-Stage': 'redirect' })
            res.end()
            return
          }
          const rel = decodeURIComponent(resolved.rel).replace(/\\/g, '/')
          if (rel.includes('..')) {
            res.writeHead(403, { 'Content-Type': 'text/plain', 'X-A2A-Stage': 'traversal' })
            res.end()
            return
          }
          try {
            const file = readFileSync(join(rootDir, rel))
            const ext = rel.slice(rel.lastIndexOf('.') + 1)
            const types: Record<string, string> = {
              html: 'text/html; charset=utf-8',
              js: 'text/javascript; charset=utf-8',
              mjs: 'text/javascript; charset=utf-8',
              css: 'text/css; charset=utf-8',
              png: 'image/png',
              json: 'application/json; charset=utf-8',
              svg: 'image/svg+xml',
            }
            res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-A2A-Stage': 'ok:' + ext })
            res.end(file)
          } catch (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain', 'X-A2A-Stage': 'miss' })
            res.end('stage-miss rel=' + rel + ' rootDir=' + rootDir + ' err=' + String(err))
          }
        },
      }), 'a2a: canvas-stage page')
      // The dsh-a2a-nexus stage: Three.js infinite-canvas topology viewer.
      // Serves the built Vite tree from assets/nexusDist with a traversal-
      // guarded file map (same discipline as canvas-stage).
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/__dsh_a2a_nexus',
        handler: (req: IncomingMessage, res: ServerResponse) => {
          const rootDirNexus = fileURLToPath(new URL('../assets/nexusDist', import.meta.url))
          // Same directory-classic resolution as the canvas mount: the bare
          // `/__dsh_a2a_nexus` form used to serve the shell verbatim, whose
          // `./assets` then 404'd at the web root — a silent black viewer.
          const MOUNT = '/__dsh_a2a_nexus'
          const resolved = resolveStageMount(req.url ?? '/', MOUNT)
          if (resolved.redirectTo !== undefined) {
            res.writeHead(301, { Location: resolved.redirectTo, 'Cache-Control': 'no-store' })
            res.end()
            return
          }
          const rel = decodeURIComponent(resolved.rel).replace(/\\/g, '/')
          if (rel.includes('..')) {
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            res.end()
            return
          }
          try {
            const file = readFileSync(join(rootDirNexus, rel))
            const ext = rel.slice(rel.lastIndexOf('.') + 1)
            const types: Record<string, string> = {
              html: 'text/html; charset=utf-8',
              js: 'text/javascript; charset=utf-8',
              mjs: 'text/javascript; charset=utf-8',
              css: 'text/css; charset=utf-8',
              png: 'image/png',
              json: 'application/json; charset=utf-8',
              svg: 'image/svg+xml',
            }
            res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
            res.end(file)
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end()
          }
        },
      }), 'a2a: nexus-stage page')
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
          // view of the network. `version` and `lanIp` are likewise
          // unsigned served-fresh facts: fleet auditability without SSH.
          // Cold joined teams (intent remembered, agent not loaded) are
          // advertised too: their routes are wake-on-route's to honor, and
          // without the listing a cross-node caller has no candidate and
          // the wake never fires.
          const isArchived = archivedSessionFilter()
          const sessionTeams = [
            ...[...sessionNodes.values()].map(agent => ({ team: sessionTeamOf(agent), ...nodeMetadataOf(agent) })),
            ...joinedSessions.list()
              .filter(id => !liveRoots.has(id) && isArchived?.(id) !== true)
              .map(id => ({ team: `${config.team}/${id8(id)}`, name: `${session}-${id8(id)}`, description: 'cold — not loaded; routing here wakes the session' })),
          ]
          const body = JSON.stringify({ ...currentCard, peers: peerStore.list(), ...(sessionTeams.length > 0 ? { sessionTeams } : {}), ...(lanIp !== '' ? { lanIp } : {}), ...(PLUGIN_VERSION !== '' ? { version: PLUGIN_VERSION } : {}), description: `A2A node exposing team ${config.team}` })
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

  /** The cooperative stop-notice text, shared by the tasks/cancel control
   * route and the transport face's cancel half (one contract, one wording). */
  function cancelNoticeText(taskId: string, reason?: string): string {
    return `[A2A cancel] (task ${taskId}) the caller cancelled this task${reason !== undefined && reason !== '' ? `: ${reason}` : ''}. Stop any work tied to it and acknowledge via [A2A receipt] task ${taskId} cancelled.`
  }

  /**
   * v0.5.23 (async-stall): whether the steered agent actually left idle. A
   * steer on an idle driver flips status to running within the same tick
   * (wakeDriver sets the phase synchronously before kick); still-idle after
   * the steer means the wake was latched (maintenance/abort window) or the
   * driver never claimed it — the delivered-but-stalled shape the defect
   * ticket documented. The probe reads status once, immediately: a message
   * already consumed back to idle reads false-negative-conservative, which
   * only arms the harmless nudge below.
   * @param agent - the steered target.
   * @returns true when the driver shows running (or already errored past the
   * claim, which consumption also implies); false when it stayed idle.
   */
  function probeConsumption(agent: Agent, taskId: string): boolean {
    void taskId
    try {
      return agent.status === 'running'
    } catch {
      return false
    }
  }

  /**
   * v0.5.23 (async-stall): one delayed nudge per session while a task stays
   * unconsumed. The steer above parked the message; a latched wake replays
   * only at convergence, and a dropped one never does — the nudge re-steers
   * a one-line prompt after the delay, which productizes the manual
   * recovery this defect needed (a synchronous probe re-woke the session).
   * Per-session single-flight plus a global cap keep a fleet of stalled
   * targets from stacking retries; a consumed task disarms itself.
   */
  const nudgeInFlight = new Set<string>()
  function armAsyncNudge(agent: Agent, team: string, taskId: string, delayMs: number): void {
    const key = String(agent.id)
    if (nudgeInFlight.has(key)) return
    nudgeInFlight.add(key)
    const timer = setTimeout(() => {
      nudgeInFlight.delete(key)
      if (!taskLedger.isPending(taskId)) return
      if (agent.status !== 'idle') return
      // Re-resolve rather than reusing the delivered agent: a session-node
      // entry captured at delivery may have been disposed since (a stale
      // reference steers a dead object — no error, no log growth, exactly
      // the stall this nudge exists to recover). The registry lookup returns
      // the current live node, or the wake path materializes the session
      // afresh.
      const fresh = resolveAgentForTeam(team) ?? agent
      logger.info(`a2a: async nudge re-waking ${team} (task ${taskId} delivered but not consumed)`)
      steerRelay(fresh, `[A2A nudge] (task ${taskId}) your earlier routed message was delivered while this session could not start a turn — please consume the inbox backlog now.`)
    }, delayMs)
    ctx.effect(() => () => clearTimeout(timer), `a2a: async nudge ${taskId}`)
  }

  /**
   * Receipt auto-synthesis (backlog root fix): an async delivery used to rely
   * on the target model choosing to route a "[A2A receipt] task <id>" message
   * back — a pure convention the models almost never honored, so the owed
   * book filled to TASK_CAP with receipts that would never come. The host
   * already owns the machinery to know when the steered turn produced a final
   * reply (the same final-waiter the sync wait uses), so the receipt is now
   * synthesized host-side: on the target's next final text, one loopback async
   * dispatch returns the receipt to the caller's routable team. Idempotent via
   * isPending (settled/archived/superseded tasks never double-send), and
   * receipts themselves are never tracked as new debts.
   */
  const receiptWarnAt = new Map<string, number>()

  function armReceiptAutosend(target: Agent, taskId: string, callerTeam: string | undefined, deliveredText: string): void {
    if (!callerTeam || callerTeam === '') return
    // Never synthesize a receipt for a receipt: answering an envelope by mail
    // would ping-pong both ledgers.
    if (deliveredText.startsWith('[A2A receipt] task ')) return
    registerFinalWaiter(target, (finalText, placeholder) => {
      // W7 slice-2: a host-authored placeholder (flush timeout, dead
      // session) must not synthesize a COMPLETION receipt — a wedged
      // session has no product, and hook 3 would otherwise ledger the
      // placeholder as one on the same-node loop-back.
      if (placeholder === true) return
      // Idempotency: a row THIS ledger tracks must still be pending
      // (settled/dead rows never re-send). A foreign task id (an inbound
      // route the caller tracks on ITS node) has no local row — the final
      // waiter itself fires at most once per armed task, which is the dedup.
      const row = taskLedger.list().find(entry => entry.taskId === taskId)
      if (row !== undefined && row.status !== 'pending') return
      const summary = `${finalText.trim().replace(/\s+/g, ' ').slice(0, SUMMARY_CAP) || 'done'} (auto)`
      // v2 envelope projection: header stays byte-compatible for every
      // legacy correlator; the machine JSON rides exactly one following line.
      const receipt = formatReceipt(taskId, summary, { outcome: 'completed', idempotencyKey: taskId })
      // Three-tier hard order (work-order P2): caller lane first; on failure
      // escalate ONCE to the owner mailbox — the outcome never evaporates
      // just because the original waiter died. Archive holds truth regardless.
      // The deliver closure is a FULL dispatch (local first, then the
      // directory walk with failover, throwing when nothing delivers): the
      // callback address may be another node's team, and a local-only
      // closure would silently no-op there — runReceiptLadder reads a
      // settled undefined as tier-1 success, so the receipt would vanish
      // without a log.
      void runReceiptLadder(
        {
          deliver: (team) => dispatchAnywhere(team, receipt, session, undefined, new AbortController().signal, true) as Promise<void>,
          ownerTeam: config.team,
          log: (stage, error) => {
            // N2 (observability): throttled per task to avoid ping-pong noise.
            const key = `receipt:${taskId}`
            if ((receiptWarnAt.get(key) ?? 0) + 60_000 > Date.now()) return
            receiptWarnAt.set(key, Date.now())
            logger.warn(`a2a: receipt autosend ${stage} for task ${taskId} failed: ${String(error).slice(0, 120)}`)
          },
        },
        callerTeam,
      ).catch(() => {
        // Ladder exhausted: the throttled breadcrumbs above already said why.
      })
    })
  }

  /**
   * Register one final-reply waiter for the agent and arm its flush timeout.
   * @param agent - the agent whose next assistant message answers the waiter.
   * @param answer - how the waiter's reply is delivered.
   * @returns the registered waiter (for callers that may retract it).
   */
  function registerFinalWaiter(agent: Agent, answer: (text: string, placeholder?: boolean) => void): FinalWaiter {
    const key = String(agent.id)
    const waiter: FinalWaiter = { answer, sinceEvents: agent.session.events.length }
    waiter.timeoutDisposer = armFlushTimeout(key, waiter)
    pendingFinals.set(key, [...(pendingFinals.get(key) ?? []), waiter])
    return waiter
  }

  /**
   * Steer one direct route request into a live agent and resolve with its
   * final reply (final semantics always: the HTTP caller has no other
   * channel to learn the reply). A bridge round that outlived the reply
   * window answers with `status: TASK_STATE_DELIVERED` + the `bridge`
   * marker instead of a (false) completion.
   * @param taskId - the correlation key the steered receipt header carries.
   */
  async function routeIntoAgent(team: string, message: string, caller: string, taskId?: string): Promise<
    { ok: true; reply: string; status?: string; bridge?: 'native-teams'; placeholder?: boolean } | { ok: false; error: string }
  > {
    const agent = resolveAgentForTeam(team) ?? canvasLiveAgent(parseCanvasTeamName(team))
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
    // Native-teams inbound bridge (opt-in): a registry team claims the
    // handle and dispatches through its authoritative seam. Checked before
    // the bare-team fallback — a team named exactly like this node's team
    // resolves to the registry's claim, not the initiator redirect.
    if (config.nativeTeamsInbound === true) {
      const prepared = await nativeTeamsPrepare(team)
      if (prepared.ok) {
        const bridged = await nativeTeamsRound(prepared, team, caller, message, taskId)
        if (bridged.ok) {
          if (bridged.settled) return { ok: true, reply: bridged.reply }
          return { ok: true, reply: bridged.reply, status: 'TASK_STATE_DELIVERED', bridge: 'native-teams' }
        }
        return { ok: false, error: bridged.error }
      }
    }
    // Only the bare process team falls back to the live (initiator) agent.
    // A session-node-shaped team that misses is an error, never a silent
    // redirect: a mistyped or stale short id must not reach another session
    // through the initiator fallback.
    if (team === config.team) {
      const live = liveAgent()
      if (live !== undefined) return routeIntoAgentFor(live, team, message, caller, taskId)
      return { ok: false, error: 'No live DSH agent is available to accept this message.' }
    }
    return { ok: false, error: `No live DSH session node accepts team "${team}" and no cold joined session matches it.` }
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
    { ok: true; reply: string; placeholder?: boolean } | { ok: false; error: string }
  > {
    return new Promise((resolve) => {
      const waiter = registerFinalWaiter(agent, (text, placeholder) => {
        resolve({ ok: true, reply: text, ...(placeholder === true ? { placeholder: true } : {}) })
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

  // ── Native-teams inbound bridge (opt-in: config.nativeTeamsInbound) ──
  //
  // Structural probe of the sibling registry (plugins never value-import
  // each other): when @nelsonlongxiang/dsh-native-teams is composed, its
  // `teams` service can classify a team name across planes (describeTarget)
  // and start a routed round through the same authoritative chain the
  // interactive route tools use (startRound). Absent registry, unmounted
  // seam, or an ambiguous / remote-plane answer all decline the bridge —
  // the standard resolution chain keeps its verdict. Dispatch is
  // dispatcher-level only: inbound callers address the team, never its
  // individual members (members stay visible-not-addressable).
  //
  // Precedence on every path (local tools and HTTP inbound alike): session
  // node → canvas team → cold joined wake → native-teams claim → bare team
  // fallback. Rounds are bounded like the steer path: a 180s reply-wait
  // deadline releases the caller while the round keeps running, and the
  // caller's abort (where one exists) cancels the round through its own
  // signal. Rounds emit no A2A receipt in this slice, so their results
  // carry the `bridge` marker and callers must not book them as
  // receipt-owed.
  interface BridgeTeamsDescriptor {
    readonly plane: 'local' | 'a2a'
    readonly ambiguous?: boolean
    readonly localLabel?: string
  }
  interface BridgeTeamsRegistry {
    listTeams(): Array<{ name: string; description: string }>
    describeTarget(handle: string): Promise<BridgeTeamsDescriptor>
    startRound(args: { team?: string; message: string }, parent: { id: string; session: { events: readonly unknown[] } }, signal: AbortSignal): Promise<string>
  }

  function teamsRegistry(): BridgeTeamsRegistry | undefined {
    const candidate = (ctx as unknown as { get(name: string): unknown }).get('teams') as Partial<BridgeTeamsRegistry> | undefined
    if (candidate === undefined || candidate === null) return undefined
    if (typeof candidate.describeTarget !== 'function' || typeof candidate.startRound !== 'function' || typeof candidate.listTeams !== 'function') return undefined
    return candidate as BridgeTeamsRegistry
  }

  /** Reply-wait parity with the steer path's 180s deadline: native-teams
   * rounds settle on their own cadence, but a wedged seam must not park a
   * caller past a bounded window (config.nativeRoundWaitMs). */
  /** The claim table changes at registry-edit cadence: a short memo dedupes
   * the double probe (callers pre-check, the round re-verifies) without
   * pretending the answer is permanent. */
  const BRIDGE_CLAIM_TTL_MS = 5_000
  const bridgeClaimCache = new Map<string, { at: number; claimed: boolean }>()
  const bridgeTimers = new Set<ReturnType<typeof setTimeout>>()
  ctx.effect(() => () => {
    for (const timer of bridgeTimers) clearTimeout(timer)
  })

  /**
   * Whether the native-teams registry claims `team` as an unambiguous local
   * target, memoized for {@link BRIDGE_CLAIM_TTL_MS}. Ordinary misses never
   * throw (the D2 query contract); anything that does throw is treated as a
   * miss — the bridge is a guest here. The memo is skipped entirely while
   * the bridge is off, so the flag gates the probe itself.
   */
  async function nativeTeamsClaims(team: string): Promise<boolean> {
    if (config.nativeTeamsInbound !== true) return false
    const cached = bridgeClaimCache.get(team)
    if (cached !== undefined && Date.now() - cached.at < BRIDGE_CLAIM_TTL_MS) return cached.claimed
    const teams = teamsRegistry()
    let claimed = false
    if (teams !== undefined) {
      try {
        const descriptor = await teams.describeTarget(team)
        claimed = descriptor.plane === 'local' && descriptor.ambiguous !== true && descriptor.localLabel !== undefined
      } catch {
        claimed = false
      }
    }
    bridgeClaimCache.set(team, { at: Date.now(), claimed })
    // Bounded memo: probe-miss names accumulate one tiny row each; past a
    // generous cap, drop the whole table (a cold re-probe costs one local
    // describeTarget call).
    if (bridgeClaimCache.size > 512) bridgeClaimCache.clear()
    return claimed
  }

  type NativeTeamsPrepared =
    | { readonly ok: true; readonly teams: BridgeTeamsRegistry; readonly parent: { id: string; session: { events: readonly unknown[] } } }
    | { readonly ok: false; readonly reason: 'not-claimed' }
    | { readonly ok: false; readonly reason: 'error'; readonly error: string }

  /**
   * Resolve everything the round needs BEFORE any caller is told the
   * dispatch happened: the claim, the seam, and a parent initiator. The
   * `error` variant is the only fast-failure shape — `not-claimed` simply
   * hands the address back to the standard resolution chain.
   */
  async function nativeTeamsPrepare(team: string): Promise<NativeTeamsPrepared> {
    if (!await nativeTeamsClaims(team)) return { ok: false, reason: 'not-claimed' }
    const teams = teamsRegistry()
    if (teams === undefined) return { ok: false, reason: 'not-claimed' }
    const parent = liveAgent()
    if (parent === undefined) return { ok: false, reason: 'error', error: 'No live DSH initiator is available to parent the native-teams round.' }
    return { ok: true, teams, parent }
  }

  /** The A2A envelope rides the round message so the dispatcher sees the network origin. */
  function bridgeEnvelope(team: string, caller: string, message: string, taskId: string | undefined): string {
    const from = caller === '' ? 'an unknown node' : caller
    const taskPrefix = taskId === undefined ? '' : `(task ${taskId}) `
    return `[A2A direct] ${taskPrefix}from "${from}" (routed to ${team}) sent:\n\n${message}`
  }

  type NativeTeamsRoundOutcome =
    | { readonly ok: true; readonly reply: string; readonly settled: boolean }
    | { readonly ok: false; readonly error: string; readonly phase?: 'pre-dispatch'; readonly aborted?: boolean }

  /** The projection for a round that outlived the reply window: unlike the
   * steer deadline's text, this must NOT promise a receipt — native-teams
   * rounds route none in this slice. */
  function bridgeUnsettledReply(team: string): string {
    return `The native-teams round for "${team}" is still running past the reply window; it was delivered and keeps going. Native-teams rounds route no A2A receipt in this slice — reconcile with a follow-up route (continuity rides the team's own durable round chain).`
  }

  /**
   * Fire the round and wait, bounded. The caller's signal (when it has one)
   * cancels the round itself; the deadline releases the caller with the
   * unsettled projection while the round keeps running detached.
   * @param prepared - a ready dispatch (claim, seam, parent) from {@link nativeTeamsPrepare}.
   */
  async function nativeTeamsRound(prepared: Extract<NativeTeamsPrepared, { ok: true }>, team: string, caller: string, message: string, taskId: string | undefined, external?: AbortSignal): Promise<NativeTeamsRoundOutcome> {
    const controller = new AbortController()
    // One listener, always removed after the race: an external abort cancels
    // the round through its own controller.
    const onExternalAbort = (): void => { controller.abort() }
    if (external !== undefined) {
      if (external.aborted) controller.abort()
      else external.addEventListener('abort', onExternalAbort)
    }
    if (controller.signal.aborted) return { ok: false, error: 'aborted before the native-teams round was dispatched', phase: 'pre-dispatch' }
    let roundError: unknown
    type Verdict = { readonly kind: 'settled'; readonly reply: string } | { readonly kind: 'failed' } | { readonly kind: 'deadline' } | { readonly kind: 'aborted' }
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<Verdict>(resolve => {
      deadlineTimer = setTimeout(() => {
        if (deadlineTimer !== undefined) bridgeTimers.delete(deadlineTimer)
        resolve({ kind: 'deadline' })
      }, config.nativeRoundWaitMs ?? 180_000)
      deadlineTimer.unref?.()
      bridgeTimers.add(deadlineTimer)
    })
    const verdict = await Promise.race([
      prepared.teams.startRound({ team, message: bridgeEnvelope(team, caller, message, taskId) }, prepared.parent, controller.signal).then(
        (reply): Verdict => ({ kind: 'settled', reply }),
        (error: unknown): Verdict => { roundError = error; return { kind: 'failed' } },
      ),
      deadline,
      new Promise<Verdict>(resolve => {
        if (controller.signal.aborted) resolve({ kind: 'aborted' })
        else controller.signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true })
      }),
    ])
    // Hygiene: the losing deadline timer stops here (not 180s later), and
    // the external-signal listener does not outlive the round.
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer)
      bridgeTimers.delete(deadlineTimer)
    }
    if (external !== undefined) external.removeEventListener('abort', onExternalAbort)
    if (verdict.kind === 'settled') return { ok: true, reply: verdict.reply, settled: true }
    if (verdict.kind === 'deadline') return { ok: true, reply: bridgeUnsettledReply(team), settled: false }
    if (verdict.kind === 'aborted') return { ok: false, error: `the wait for the native-teams round "${team}" was aborted (the round was cancelled with it)`, aborted: true }
    return { ok: false, error: `the native-teams round for "${team}" failed: ${String(roundError)}` }
  }

  whenWebServerSettled((webServer) => {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/a2a/direct',
      handler: (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = []
        let size = 0
        // B5 enforcement: 512 KiB hard cap. An oversized body is rejected,
        // never truncated and never connection-killed mid-read — buffering
        // stops at the crossing chunk, the stream drains to `end`, and the
        // peer receives one structured 413 with a wire error code (the old
        // behavior tore the socket down with no diagnosis at all).
        let overflowed = false
        const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
        if (Number.isFinite(declared) && !withinRouteBodyCap(declared)) overflowed = true
        req.on('data', (chunk: Buffer) => {
          if (overflowed) return
          const next = size + chunk.length
          if (!withinRouteBodyCap(next)) {
            overflowed = true
            chunks.length = 0
            return
          }
          size = next
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
          if (overflowed) {
            if (!res.writableEnded && !res.headersSent) {
              const payload = JSON.stringify({ error: 'payload too large', code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
              res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
            }
            return
          }
          let body: {
            readonly team?: unknown
            readonly message?: unknown
            readonly context_id?: unknown
            readonly caller_session?: unknown
            readonly callback?: unknown
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
          // P2 receipt-callback: where THIS node's receipt should route on
          // the caller's side — the caller knows its routable address best
          // (a joined session's node team, e.g. via the transport face's
          // callbackTarget mapping). Bounded; absent → the caller label
          // plays its usual role.
          const callback = typeof body.callback === 'string' && body.callback !== '' && body.callback.length <= 128 ? body.callback : ''
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
          // Server-side idempotency (P3/B3): one key, one execution inside
          // the window. Same key + same payload fingerprint ⇒ replay (409,
          // -32003, replay:true — the prior attempt stays authoritative);
          // same key + different payload ⇒ hard conflict (409, -32002).
          // Checked BEFORE any steering or ledger correlation: a replay must
          // never re-enter the target session, no matter how it settles.
          const idemFingerprint = peerPayloadFingerprint({ caller, message, noWait, team })
          const idemVerdict = idempotencyStore.claim(taskId, idemFingerprint)
          if (idemVerdict !== 'fresh') {
            const replay = idemVerdict === 'replay'
            // 0.5.36 observability: conflict = caller bug (graph-loop prompt
            // minting / key management) — warn loudly so it is never misread
            // as the normal-depth-defense zero-traffic shape. Replays stay
            // silent by design.
            if (!replay) logger.warn(`a2a: idempotency CONFLICT on task ${taskId.slice(0, 80)} — same key reused with a different payload (caller bug; never auto-retry)`)
            const payload = JSON.stringify({
              error: replay ? 'duplicate task id within the idempotency window' : 'task id reused with a different payload',
              code: replay ? WIRE_ERROR_REPLAY_REJECTED : WIRE_ERROR_IDEMPOTENCY_CONFLICT,
              task_id: taskId,
              replay,
            })
            res.writeHead(409, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // The caller-side receipt correlation: a message shaped as a
          // receipt resolves the task it echoes, whichever wait semantics
          // carried it here. Correlation is bookkeeping only — the message
          // steers on exactly as before.
          settleAndAnnounce(message)
          // Inbound routing is foreground demand: boot prewarm yields for a
          // quiet window around it.
          lastWakeDemandAt = Date.now()
          // wait:false delivers without the final-reply hold: steer resolves
          // synchronously inside routeIntoAgentFor, so by the time the agent
          // lookup settles the message is already in — answer delivered and
          // let the receipt contract carry the reply.
          if (noWait) {
            const agent = resolveAgentForTeam(team)
            const woken = agent !== undefined ? undefined : wakeColdTeam(team)
            const deliver = (target: Agent): void => {
              const from = caller === '' ? 'an unknown node' : caller
              // The receipt target: the caller's callback address when it
              // supplied one (a session node team — wake-on-route covers a
              // cold one), else the caller label as before.
              const receiptTarget = callback !== '' ? callback : from
              try {
                // The receipt header carries the task id: the target echoes
                // it verbatim in "[A2A receipt] task <id> ...", closing the
                // correlation loop with the caller's own route result.
                // F1' (consumed-probe prior-running): capture the pre-steer
                // status first — a target that was already running (its own
                // turn / a brand-new session's activation window) reads
                // `running` after the steer whether or not our wake was
                // latched, so the post-steer read alone would answer a false
                // consumed:true and strand the message.
                const runningBeforeSteer = probeConsumption(target, taskId)
                steerRelay(target, `[A2A direct] (task ${taskId}) from "${from}" (routed to ${team}) sent:\n\n${message}\n\n(When done, route your outcome back with one call — a2a_route { team: "${receiptTarget}", message: "[A2A receipt] task ${taskId} <one-line outcome>" }.)`)
                recordActivity('in', team, caller, true)
                armReceiptAutosend(target, taskId, receiptTarget, message)
                // v0.5.23 (async-stall): "delivered" only proves the steer call
                // returned — not that a turn started. An idle-phase steer wakes
                // the driver, but a maintenance/abort window latches the wake for
                // replay that may never fire (defect t-mt6nd0sq-hxuhj6: seven
                // delivered:true routes with zero log growth). Probe the driver
                // shortly after: running means the message is being consumed;
                // still-idle means the wake was latched or dropped — surface that
                // honestly and arm a delayed nudge retry below.
                // F1': a prior-running target never trusts the single
                // post-steer read — answer consumed:false conservatively and
                // arm the nudge (a false negative costs one harmless nudge; a
                // false positive strands the delivered message).
                const consumedProbe = runningBeforeSteer ? false : probeConsumption(target, taskId)
                if (!consumedProbe) armAsyncNudge(target, team, taskId, config.asyncNudgeDelayMs)
                const payload = JSON.stringify({
                  routed: true,
                  delivered: true,
                  team,
                  session,
                  task_id: taskId,
                  context_id: contextId,
                  task_status: 'TASK_STATE_DELIVERED',
                  artifacts: [],
                  consumed: consumedProbe,
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
            // Remaining candidates need one async classification (the
            // native-teams bridge), so the tail answers inside an IIFE.
            void (async () => {
              // Native-teams inbound bridge (opt-in): prepare BEFORE answering
              // delivered — claim, seam, and parent initiator are everything
              // that can fail fast, and a phantom dispatch must never answer
              // success. Past prepare, the round fires detached (noWait means
              // delivery, not settlement); its late outcome corrects the
              // activity ring and the log.
              const standardMiss = (): void => {
                if (team === config.team) {
                  const live = liveAgent()
                  if (live !== undefined) { deliver(live); return }
                }
                const payload = JSON.stringify({ error: `No live DSH session node accepts team "${team}" and no cold joined session matches it.`, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                res.end(payload)
              }
              const prepared = await nativeTeamsPrepare(team)
              if (!prepared.ok) {
                if (prepared.reason === 'error') {
                  recordActivity('in', team, caller, false)
                  const payload = JSON.stringify({ error: prepared.error, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
                  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                  res.end(payload)
                  return
                }
                standardMiss()
                return
              }
              recordActivity('in', team, caller, true)
              void nativeTeamsRound(prepared, team, caller, message, taskId)
                .then(outcome => {
                  if (!outcome.ok) {
                    recordActivity('in', team, caller, false)
                    logger.warn(`a2a: detached native-teams round for "${team}" failed: ${outcome.error}`)
                  }
                  // W7 slice-2 hook 2: only a genuinely settled detached round
                  // records an outcome. The deadline's settled:false
                  // projection is a placeholder, not a product — the same
                  // ruling as hook 1's DELIVERED skip; placeholder prose never
                  // enters the ledger a replay could adopt from.
                  if (taskId !== '') {
                    if (!outcome.ok) idempotencyStore.recordOutcome(taskId, { status: 'failed', error: outcome.error })
                    else if (outcome.settled) idempotencyStore.recordOutcome(taskId, { status: 'completed', reply: outcome.reply })
                  }
                })
              const payload = JSON.stringify({ routed: true, delivered: true, team, session, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_DELIVERED', artifacts: [], consumed: false, bridge: 'native-teams' })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
            })()
            return
          }
          void routeIntoAgent(team, message, caller, taskId).then((outcome) => {
            recordActivity('in', team, caller, outcome.ok)
            // W7 slice-2 hook 1: record the settled outcome on the claim row.
            // Ruling: a non-COMPLETED status (TASK_STATE_DELIVERED — the
            // bridge-round deadline placeholder, ABORTED_WAIT likewise) is
            // NOT a settled outcome, and neither is a host-authored
            // placeholder on the reply channel (flush timeout, dead session)
            // — the row stays pending, because an adopted replay must never
            // settle a node on placeholder text (the exact hazard W7 gap B
            // closed, barred from resurrecting through the outcome ledger).
            if (taskId !== '') {
              if (!outcome.ok) {
                idempotencyStore.recordOutcome(taskId, { status: 'failed', error: outcome.error })
              } else if (outcome.placeholder === true) {
                // placeholder prose never enters the ledger
              } else if (outcome.status === undefined || outcome.status === 'TASK_STATE_COMPLETED') {
                idempotencyStore.recordOutcome(taskId, { status: 'completed', reply: outcome.reply })
              }
            }
            const payload = outcome.ok
              ? JSON.stringify({
                routed: true,
                team,
                session,
                result: { text: outcome.reply },
                task_id: taskId,
                context_id: contextId,
                task_status: outcome.status ?? 'TASK_STATE_COMPLETED',
                artifacts: [],
                // The bridge marker rides the wire so the caller's
                // trackOwedTask skips a receipt-less native round — without
                // it, a cross-node unsettled round books an unpayable owed
                // row and re-creates the TASK_CAP backlog.
                ...(outcome.bridge !== undefined ? { bridge: outcome.bridge } : {}),
              })
              : JSON.stringify({ error: outcome.error, code: -32000, team, task_id: taskId, task_status: 'TASK_STATE_FAILED' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
        })
      },
    }), 'a2a: direct route endpoint')
  })

  whenWebServerSettled((webServer) => {
    // W7 slice 2: the S1 outcome-retrieval surface — a READ-ONLY lookup of
    // one claimed task's settled outcome. The body carries ONLY the task id
    // and the submit payload's fingerprint (peerPayloadFingerprint, the
    // gate's own shared implementation): the fingerprint match is the
    // authorization, and the fan-out probe never leaks the original message
    // to peers that never saw it. Constant-200 semantics — a query NEVER
    // produces a wire error code (the frozen -32002/-32003 vocabulary stays
    // submit-only), never claims, never steers, never enters a session: the
    // gate's "verdict before steer" has its mirror in "a query executes
    // nothing". Malformed fields degrade to unknown-task rather than
    // guessing; an unparseable body answers 400 like /a2a/direct.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/a2a/query',
      handler: (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = []
        let size = 0
        let overflowed = false
        req.on('data', (chunk: Buffer) => {
          if (overflowed) return
          const next = size + chunk.length
          if (next > 65_536) {
            overflowed = true
            chunks.length = 0
            return
          }
          size = next
          chunks.push(chunk)
        })
        req.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(400)
            res.end()
          }
        })
        req.on('end', () => {
          if (overflowed) {
            if (!res.writableEnded && !res.headersSent) {
              const payload = JSON.stringify({ error: 'payload too large', code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
              res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
            }
            return
          }
          let body: {
            readonly task_id?: unknown
            readonly fingerprint?: unknown
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
          } catch {
            const payload = JSON.stringify({ error: 'malformed body', code: -32000 })
            res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          const taskId = typeof body.task_id === 'string' ? body.task_id : ''
          const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : ''
          const verdict = taskId === '' || fingerprint === ''
            ? { found: false as const, reason: 'unknown-task' as const }
            : idempotencyStore.query(taskId, fingerprint)
          const payload = JSON.stringify(
            verdict.found
              ? verdict.status === 'pending'
                ? { found: true, status: 'pending', task_id: taskId }
                : verdict.status === 'completed'
                  ? {
                    found: true,
                    status: 'completed',
                    reply: verdict.reply,
                    settled_at: new Date(verdict.settledAt).toISOString(),
                    task_id: taskId,
                    ...(verdict.truncated === true ? { truncated: true } : {}),
                  }
                  : {
                    found: true,
                    status: 'failed',
                    error: verdict.error,
                    settled_at: new Date(verdict.settledAt).toISOString(),
                    task_id: taskId,
                    ...(verdict.truncated === true ? { truncated: true } : {}),
                  }
              : { found: false, reason: verdict.reason, task_id: taskId },
          )
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        })
      },
    }), 'a2a: query endpoint')
  })

  whenWebServerSettled((webServer) => {
    // Task-ledger control: explicit caller-side abandonment of one owed
    // async task — the orchestrator's give-up path (work-order P1a).
    // Deliberately OUTSIDE the sessionNodes gate: every async route tracks
    // its task whether or not this node exposes joinable sessions. Rides the
    // standard control guard; structured outcome vocabulary
    // {cleared|already-terminal|unknown}; idempotent; never throws.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/tasks/abandon',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        readJsonBody(req, res, (body) => {
          const fields = body as Record<string, unknown>
          const taskId = typeof fields.task_id === 'string' ? fields.task_id : ''
          const reason = typeof fields.reason === 'string' ? fields.reason : undefined
          const result = taskLedger.abandon(taskId, reason)
          const payload = JSON.stringify(result)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        })
      }),
    }), 'a2a: task abandon route')
  })

  whenWebServerSettled((webServer) => {
    // Cooperative cancellation (work-order P1b): end the owed row AND, when
    // it pointed at a live local target, steer a stop notice so a running
    // turn wraps up instead of burning budget on an orphaned task. Standard
    // control guard; total outcome vocabulary like the abandon sibling.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/tasks/cancel',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        readJsonBody(req, res, (body) => {
          const fields = body as Record<string, unknown>
          const taskId = typeof fields.task_id === 'string' ? fields.task_id : ''
          const reason = typeof fields.reason === 'string' ? fields.reason : undefined
          const result = taskLedger.cancel(taskId, reason)
          let steered = false
          if (result.outcome === 'cleared' && result.team !== undefined) {
            const live = resolveAgentForTeam(result.team)
              ?? canvasLiveAgent(parseCanvasTeamName(result.team))
              ?? (result.team === config.team ? liveAgent() : undefined)
            if (live !== undefined) {
              try {
                steerRelay(live, cancelNoticeText(taskId, reason))
                steered = true
              } catch {
                // Bookkeeping already settled; steering is best-effort only.
              }
            }
          }
          const payload = JSON.stringify({ ...result, steered })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        })
      }),
    }), 'a2a: task cancel route')
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
      // Remember the alias so mirrored referral lists stop re-offering it
      // between fetches (the drop alone flickers in and out of the store).
      selfReferrals.remember(peer)
      peerStore.drop(peer)
      return undefined
    }
    peerStore.noteSuccess(peer)
    for (const referral of outcome.card.peers ?? []) if (selfReferrals.shouldOffer(referral)) peerStore.offer(referral)
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

  /**
   * v0.5.24 (join-gate): a session that has not joined the A2A network may
   * not use its outbound tools. Joining is a user gesture (the sidebar
   * control) — never automatic, never proxied — so an unjoined session's
   * model must be told plainly instead of silently failing routes. The gate
   * only applies to in-session calls (an agent context exists); host-side
   * service invocations without an agent (e.g. the taskboard marquee's
   * joined-caller identity) pass through untouched, and a joined session
   * (sessionNodes carries its id) is exempt. appliesToA2aTools returns the
   * refusal error object, or undefined when the call may proceed.
   */
  const a2aJoinGateRefusal = (exec: { agent?: { id: unknown } } | undefined): void => {
    const agent = exec?.agent
    if (agent === undefined) return
    if (sessionNodes.has(String(agent.id))) return
    // The process's own initiator session IS the node (its team is this
    // node's team): routing out from the operator face needs no join. Every
    // other top-level session is a guest that must join by user gesture.
    const agents = ctx.get('agents')
    try {
      if (agents !== undefined && agents.requireInitiator() === agent) return
    } catch { /* no initiator in this fiber — a guest stays gated */ }
    // A thrown tool error renders as the model-visible failure surface —
    // loud, structured, and schema-free (no success shape is produced).
    throw new Error('你被禁止使用 a2a 网络：本会话未加入 A2A 网络（join 是用户手势）。Join via the sidebar control to enable, then retry.')
  }

  ctx.tools.register(defineTool({
    name: 'a2a_teams',
    description:
      'List or search reachable A2A teams: this host\'s own process team and joined session nodes first (marked [this host], '
      + 'routable over loopback — same-host collaboration needs no peers), then teams across the tracked peer network '
      + 'with owner label, a recent-activity excerpt, the publishing host (origin: node label + LAN IP — the natural '
      + 'grouping when a fleet spans machines), and the session\'s working directory when shared. Pass query to filter '
      + 'by keyword (case-insensitive substring over team name, title, excerpt, origin, or workspace) — searching '
      + 'discovers one extra referral hop within the call. Canvas teams (<team>/canvas/<name>, user-composed multi-member groups) '
      + 'list as local rows; routing to one resolves the first live member or wakes the first cold one. '
      + 'Call this before a2a_route to pick a target team.',
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
                via: { type: 'string', description: 'The peer URL this row was discovered through (host:port), when it came from a peer card.' },
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
    execute: async (args: { query?: string }, exec): Promise<{ ok: boolean; query: string; teams: DirectoryTeamRow[] }> => {
      a2aJoinGateRefusal(exec)
      const query = args.query?.trim().toLowerCase() ?? ''
      const teams = await listDirectoryTeams(query !== '')
      if (query === '') return { ok: true, query: '', teams }
      const matches = (team: DirectoryTeamRow): boolean =>
        team.team.toLowerCase().includes(query) || team.name.toLowerCase().includes(query) || team.description.toLowerCase().includes(query)
        || team.session.toLowerCase().includes(query)
        || (team.origin ?? '').toLowerCase().includes(query) || (team.workspace ?? '').toLowerCase().includes(query) || (team.via ?? '').toLowerCase().includes(query)
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
  type DirectoryTeamRow = { team: string; session: string; name: string; description: string; local?: boolean; origin?: string; workspace?: string; via?: string }
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
      // Canvas teams: user-composed multi-member rows. Member count and live
      // count are the facts a caller needs before routing — resolution picks
      // the first live member at route time.
      ...canvasStore.list().map(name => {
        const members = canvasStore.membersOf(name)
        const live = members.filter(id => sessionNodes.has(id)).length
        return {
          team: canvasTeamOf(name),
          session,
          name,
          description: `canvas team — ${members.length} member${members.length === 1 ? '' : 's'}, ${live} live`,
          local: true,
          origin: localOrigin,
        }
      }),
      // Native-teams registry rows (opt-in bridge): local teams this node
      // can dispatch inbound. They list only when the operator opted in —
      // registry presence alone is never network exposure.
      ...(config.nativeTeamsInbound === true
        ? (teamsRegistry()?.listTeams() ?? []).map(entry => ({
          team: entry.name,
          session,
          name: entry.name,
          description: entry.description,
          local: true,
          origin: localOrigin,
        }))
        : []),
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
      // via = the peer URL the card was fetched from: the panel shows which
      // host:port each remote row came from, so an unknown node is traceable
      // to its publishing endpoint at a glance.
      const rows: DirectoryTeamRow[] = [
        { team: card.team, session: card.session, name: card.name, description: '', origin, via: peer },
      ]
      for (const entry of card.sessionTeams ?? []) {
        rows.push({ team: entry.team, session: card.session, name: entry.name, description: entry.description, origin, via: peer, ...(entry.workspace !== undefined ? { workspace: entry.workspace } : {}) })
      }
      return rows
    }
    // Bounded-concurrency sweep (mapBounded keeps row order by index, so the
    // listing still follows the peer store's preference order): a cold cache
    // must not open up to PEER_CAP simultaneous card fetches at once.
    const sweep = async (peers: readonly string[]): Promise<void> => {
      const collected = await mapBounded(peers, SWEEP_CONCURRENCY, collectPeer)
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
   * Whether one caller label can receive network traffic back. Composite
   * `<zone>/<id>` shapes route anywhere (N1); bare zone names resolve to a
   * live initiator per host, so cross-host they would steer whichever node
   * shares the name — treated as unroutable everywhere.
   */
  function routableCallerLabel(callerSession: string | undefined): boolean {
    return callerSession !== undefined &&
      (/[a-z0-9-]+\/[0-9a-f]{8}$/i.test(callerSession) || /[a-z0-9-]+\/[a-z0-9]{4,}$/i.test(callerSession))
  }

  /**
   * Why an async route from such a caller cannot expect its receipt: the
   * autosend arm skips it and the steered hint is omitted, so the debt has
   * no paying path — say so at dispatch time instead of silently stranding
   * a pending row.
   */
  function unroutableCallerNote(label: string): string {
    return `\n(Note: caller label "${label}" is not network-routable, so the target cannot auto-send a receipt back to you — reconcile via context_id follow-ups instead.)`
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
    // Native-teams bridge rounds emit no A2A receipt in this slice: booking
    // them as receipt-owed would fill the owed book with rows no receipt can
    // ever settle (evicting genuinely receivable peer rows past TASK_CAP).
    if (result.bridge !== undefined) return
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
      a2aJoinGateRefusal(exec)
      const callerSession = exec.agent === undefined ? undefined
        : sessionNodes.has(String(exec.agent.id)) ? sessionTeamOf(exec.agent) : sessionLabelOf(exec.agent)
      // P2 receipt-callback: the caller's routable address rides the wire so
      // a peer routes its receipt to THIS session's node team (not to
      // wherever its caller-label heuristics land).
      const callbackAddress = routableCallerLabel(callerSession) ? callerSession : undefined
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
      const outcome = await dispatchLocalCandidate(args.team, args.message, callerSession, args.context_id, exec.signal, args.async === true, taskId, callbackAddress)
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
        const result = await dispatchPeerCandidate(candidate, args.team, args.message, args.context_id, exec.signal, callerSession, peerAsync, taskId, callbackAddress)
        if (result.ok || exec.signal.aborted) {
          if (result.ok) trackOwedTask(taskId, args.team, candidate, result)
          const notes: string[] = []
          if (result.ok && args.async === true && result.task_status === 'TASK_STATE_DELIVERED' && !routableCallerLabel(callerSession)) {
            notes.push(unroutableCallerNote(String(callerSession ?? session)))
          }
          if (result.ok && args.async === true && !peerAsync) {
            notes.push('\n(Note: the peer does not advertise async; the call waited synchronously.)')
          }
          if (result.ok && notes.length > 0) {
            return { ...result, reply: `${result.reply}${notes.join('')}` } as unknown as Record<string, JsonValue>
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
  async function dispatchLocalCandidate(team: string, message: string, callerSession: string | undefined, contextId: string | undefined, signal: AbortSignal, asyncMode = false, taskIdFromCaller?: string, callbackAddress?: string): Promise<A2aRouteResult | undefined> {
    const webServer = ctx.get('webServer')
    const canvasName = parseCanvasTeamName(team)
    let teamIsLocal = team === config.team
      || resolveAgentForTeam(team) !== undefined
      || joinedSessions.list().some(id => `${config.team}/${id8(id)}` === team)
      || (canvasName !== undefined && (canvasLiveAgent(canvasName) !== undefined || canvasColdMemberId(canvasName) !== undefined))
    // The native-teams claim probe is an await: pay it only when the four
    // cheap synchronous locality checks missed (a registry team is a local
    // candidate even though no session node backs it).
    if (!teamIsLocal && team !== config.team) teamIsLocal = await nativeTeamsClaims(team)
    if (!teamIsLocal || webServer === undefined) return undefined
    // A receipt relayed between same-host sessions (the answering session
    // routing its `[A2A receipt]` back over the in-process candidate)
    // correlates here too — same contract, no HTTP on the path.
    settleAndAnnounce(message)
    const taskId = taskIdFromCaller ?? `direct-${Math.random().toString(16).slice(2, 10)}`
    const flight = beginRoute(team, 'local')
    if (asyncMode) {
      // Delivery means the message is IN, not merely enqueued: a cold team
      // materializes first (the wake settles, or fails honestly), then the
      // steer fires, then delivered answers. The receipt header carries the
      // task id so the target can echo it back verbatim.
      const agent = resolveAgentForTeam(team) ?? canvasLiveAgent(canvasName)
      let woken = agent !== undefined ? Promise.resolve(agent) : wakeColdTeam(team)
      if (woken === undefined) {
        // Bridge BEFORE the bare-team fallback — claim beats the initiator
        // redirect, the same rule routeIntoAgent follows (a bare team name
        // claimed by the registry must not fork its destination by wait
        // semantics). Prepare-first: claim, seam, and parent initiator are
        // everything that can fail fast, so a phantom delivery never answers
        // success. The fire is truly detached (no caller signal — the turn
        // ending must not silently retract an already-announced delivery);
        // rounds emit no receipt in this slice (the `bridge` marker keeps
        // the caller's ledger honest).
        const prepared = await nativeTeamsPrepare(team)
        if (prepared.ok) {
          endRoute(flight)
          recordActivity('out', team, 'local', true)
          void nativeTeamsRound(prepared, team, callerSession ?? session, message, taskId)
            .then(outcome => {
              if (!outcome.ok) {
                recordActivity('out', team, 'local', false)
                logger.warn(`a2a: detached native-teams round for "${team}" failed: ${outcome.error}`)
              }
            })
          return {
            ok: true,
            team,
            reply: `Delivered to ${team} (async native-teams round dispatched). The round settles through the team's own routing chain; it routes no A2A receipt in this slice — reconcile via context_id follow-ups.`,
            task_id: taskId,
            context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
            task_status: 'TASK_STATE_DELIVERED',
            bridge: 'native-teams',
          }
        }
        if (prepared.reason === 'error') {
          endRoute(flight)
          recordActivity('out', team, 'local', false)
          return { ok: false, error: prepared.error, code: -32000 }
        }
        // Claim declined: the bare process team still steers the live initiator.
        const live = team === config.team ? liveAgent() : undefined
        if (live === undefined) {
          endRoute(flight)
          return { ok: false, error: `No live DSH session node accepts team "${team}" and no cold joined session matches it.`, code: -32000 }
        }
        woken = Promise.resolve(live)
      }
      try {
        const target = await woken
        // N1 (review seat 7e4cf94a): dashed composite labels are NOT routable;
        // accept only <zone>/<short-id> shapes so envelopes stop bouncing -32004.
        // An explicit callback address (P2) wins over the caller-label
        // derivation: it is the submitting session's own node team.
        const routable = routableCallerLabel(callerSession)
        const callerTeam = callbackAddress !== undefined && callbackAddress !== ''
          ? callbackAddress
          : routable ? callerSession : undefined
        const receiptHint = callerTeam === undefined ? '' : `\n\n(When done, route your outcome back with one call — a2a_route { team: "${callerTeam}", message: "[A2A receipt] task ${taskId} <one-line outcome>" }.)`
        steerRelay(target, `[A2A direct] (task ${taskId}) from "${callerSession ?? session}" (routed to ${team}) sent:\n\n${message}${receiptHint}`)
        armReceiptAutosend(target, taskId, callerTeam, message)
        endRoute(flight)
        recordActivity('out', team, 'local', true)
        return {
          ok: true,
          team,
          reply: `Delivered to ${team} (async). The target routes a receipt — a message starting "[A2A receipt] task ${taskId} <outcome summary>" — back to your team when done; watch a2a_status activity or follow up with the context id.${routable ? '' : unroutableCallerNote(String(callerSession ?? session))}`,
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
    if (!asyncMode) {
      // Bridge only on a steer-path miss, matching the documented chain
      // (session node → canvas → cold wake → native-teams claim → bare): a
      // registry claim must never shadow a live local session team. The
      // caller's abort cancels the round through its own signal; the 180s
      // deadline restores the bound the steer machinery observes.
      const steerable = resolveAgentForTeam(team) !== undefined
        || canvasLiveAgent(canvasName) !== undefined
        || joinedSessions.list().some(id => `${config.team}/${id8(id)}` === team)
        || wakeColdTeam(team) !== undefined
      if (!steerable && team !== config.team) {
        const prepared = await nativeTeamsPrepare(team)
        if (prepared.ok) {
          const outcome = await nativeTeamsRound(prepared, team, callerSession ?? session, message, taskId, signal)
          endRoute(flight)
          if (!outcome.ok) {
            // The aborted-wait shape is earned only by an actual round
            // cancellation (the caller's abort reached the seam). A
            // pre-dispatch abort means the message never left the node, and
            // a failed round means it never answered — both answer the
            // honest error instead of claiming a delivery.
            if (outcome.aborted === true) {
              recordActivity('out', team, 'local', true)
              return {
                ok: true,
                team,
                reply: `The message was delivered to ${team} (native-teams round), but the wait was aborted (the round was cancelled with it).`,
                task_id: taskId,
                context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
                task_status: 'TASK_STATE_ABORTED_WAIT',
                bridge: 'native-teams',
              }
            }
            recordActivity('out', team, 'local', false)
            return { ok: false, error: outcome.error, code: -32000 }
          }
          recordActivity('out', team, 'local', true)
          return {
            ok: true,
            team,
            reply: outcome.reply,
            task_id: taskId,
            context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
            task_status: outcome.settled ? 'TASK_STATE_COMPLETED' : 'TASK_STATE_DELIVERED',
            ...(outcome.settled ? {} : { bridge: 'native-teams' as const }),
          }
        }
        if (prepared.reason === 'error') {
          endRoute(flight)
          recordActivity('out', team, 'local', false)
          return { ok: false, error: prepared.error, code: -32000 }
        }
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
        task_status: outcome.status ?? 'TASK_STATE_COMPLETED',
        ...(outcome.bridge !== undefined ? { bridge: outcome.bridge } : {}),
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
  async function dispatchPeerCandidate(url: string, team: string, message: string, contextId: string | undefined, signal: AbortSignal, callerSession: string | undefined, asyncMode = false, taskIdFromCaller?: string, callbackAddress?: string): Promise<A2aRouteResult> {
    const flight = beginRoute(team, url)
    const result = await client.routeDirect(url, team, message, contextId, signal, callerSession, asyncMode, taskIdFromCaller, callbackAddress)
    endRoute(flight)
    recordActivity('out', team, url, result.ok)
    return result
  }

  /**
   * Full dispatch for background senders (the receipt autosend): local
   * first, then the directory walk with per-candidate failover. Unlike
   * {@link dispatchLocalCandidate}, a team that is not ours is NOT treated
   * as a silent non-route — the walk either delivers or THROWS, so the
   * receipt ladder can distinguish "delivered" from "no route" and its
   * owner escalation actually fires for cross-node callback addresses.
   */
  async function dispatchAnywhere(team: string, message: string, callerSession: string | undefined, contextId: string | undefined, signal: AbortSignal, asyncMode: boolean, taskId?: string): Promise<void> {
    const local = await dispatchLocalCandidate(team, message, callerSession, contextId, signal, asyncMode, taskId)
    if (local !== undefined) {
      if (!local.ok) throw new Error(local.error)
      return
    }
    const failures: string[] = []
    const candidates = await directoryPeerCandidates(memoizedCardFetch(), team, failures)
    if (candidates.length === 0) {
      throw new Error(`no route to "${team}": not a local team and not published by any tracked peer`)
    }
    let lastError = 'no candidate delivered'
    for (const candidate of candidates) {
      const result = await dispatchPeerCandidate(candidate, team, message, contextId, signal, callerSession, asyncMode, taskId)
      if (result.ok) return
      lastError = result.error
      if (signal.aborted) break
    }
    throw new Error(`delivery to "${team}" failed on every candidate: ${lastError}`)
  }

  /**
   * The directory's candidate walk for one team: direct publishers first,
   * then every tracked zone's delegation resolutions (cycle/depth/key-binding
   * failures are configuration bugs: closed, logged, and surfaced into
   * {@link failures}), deduplicated by URL. Both passes run their per-peer
   * fetches concurrently under a small cap: a serial walk of a store full of
   * cold-cache dead peers pays their HTTP timeouts one after another (worst
   * case cap × 15s), while a bounded concurrent walk pays one timeout window.
   */
  const CANDIDATE_CONCURRENCY = 6
  /** Concurrent card fetches in one directory sweep (cold-cache burst bound). */
  const SWEEP_CONCURRENCY = 6
  async function mapBounded<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await task(items[index] as T)
      }
    })
    await Promise.all(workers)
    return results
  }

  async function directoryPeerCandidates(fetch: (url: string) => Promise<A2aPeerCard | undefined>, team: string, failures: string[]): Promise<string[]> {
    const peers = peerStore.list()
    const candidates: string[] = []
    const cards = await mapBounded(peers, CANDIDATE_CONCURRENCY, async peer => ({ peer, card: await fetch(peer) }))
    for (const entry of cards) {
      if (entry.card === undefined) continue
      if (entry.card.team === team || (entry.card.sessionTeams ?? []).some(item => item.team === team)) candidates.push(entry.peer)
    }
    const resolutions = await mapBounded(peers, CANDIDATE_CONCURRENCY, async peer => ({ peer, outcome: await resolveZone(fetch, peer, team) }))
    for (const { peer, outcome } of resolutions) {
      if (outcome.ok) {
        if (!candidates.includes(outcome.url)) candidates.push(outcome.url)
        continue
      }
      if (outcome.reason === 'not-found' || outcome.reason === 'unreachable') continue
      failures.push(`${peer} ${outcome.reason}: ${outcome.detail}`)
    }
    return candidates
  }

  // ── Outbound transport face: the `nativeTeamsA2a` bridge ─────────────
  //
  // Contract: @nelsonlongxiang/dsh-native-teams/src/a2a-face.ts (0.14.0,
  // structural mirror in src/teams-bridge.ts). This plugin mounts the
  // implementation under the face's frozen service key — protocol
  // primitives live on the protocol face (three-party consensus), and
  // native-teams probes it presence-guarded (unmounted ⇒ local-only
  // routing, never a crash). The face ships only what this plugin already
  // does for a2a_route: resolve via the ONE directory walk (same matcher
  // submit uses — no drift-prone double implementation), submit via the
  // direct-route dispatcher (per-candidate async gate, failover included),
  // cancel via the cooperative stop-notice. It exposes nothing new — only
  // teams the tracked peer network already publishes resolve here.
  const bridgeFace: NativeTeamsBridgeFace = {
    resolve: async (handle) => {
      const failures: string[] = []
      const candidates = await directoryPeerCandidates(memoizedCardFetch(), handle, failures)
      if (candidates.length === 0) return undefined
      return { kind: 'node', hops: 1, url: candidates[0] }
    },
    submit: async (request, signal) => {
      const abort = signal ?? new AbortController().signal
      const failures: string[] = []
      const fetch = memoizedCardFetch()
      const candidates = await directoryPeerCandidates(fetch, request.handle, failures)
      if (candidates.length === 0) {
        throw new Error(`team "${request.handle}" is not published by any tracked peer${failures.length === 0 ? '' : ` (unresolved delegations: ${failures.join('; ')})`}`)
      }
      // The caller-born task id (B3): the orchestrator's dedup key IS the
      // wire task id, so the peer's echo correlates with the caller's ledger.
      const taskId = request.idempotencyKey !== undefined && request.idempotencyKey !== ''
        ? request.idempotencyKey
        : `direct-${Math.random().toString(16).slice(2, 10)}`
      // P2 receipt-callback: the receipt routes back to the submitting
      // session's own node team, but ONLY when that session is a joined
      // node. Without a joined parent there is no routable address that
      // means "this session" on the peer — omitting the callback keeps the
      // P1 behavior (the caller label cannot resolve on the peer, so the
      // receipt is lost honestly); falling back to `config.team` would be
      // actively harmful: a same-named peer resolves it LOCAL-first and the
      // receipt steers the peer's own initiator, never leaving that host.
      let callbackAddress: string | undefined
      if (request.callbackTarget) {
        const parent = request.callbackTarget.parentSessionId
        if (sessionNodes.has(parent) || joinedSessions.has(parent)) callbackAddress = `${config.team}/${id8(parent)}`
      }
      for (const candidate of candidates) {
        // Capability gate per candidate, like a2a_route's loop: a
        // delivery:async submit never dials a peer whose signed card does
        // not declare async — failover must not silently degrade into the
        // minutes-long blocking wait the gate exists to prevent.
        let peerAsync = false
        if (request.delivery === 'async') {
          const card = await fetch(candidate)
          peerAsync = (card?.capabilities as { async?: unknown } | undefined)?.async === true
        }
        const result = await dispatchPeerCandidate(candidate, request.handle, request.message, request.contextId, abort, session, request.delivery === 'async' && peerAsync, taskId, callbackAddress)
        if (!result.ok) {
          // Idempotency verdicts (B3) are terminal, not failover: a replay
          // says the prior attempt at THIS peer stays authoritative —
          // re-dispatching the same dedup key at another peer would execute
          // the task twice; a conflict is a caller bug (same key, different
          // payload) and must surface as a failure, not a redirect.
          if (result.code === WIRE_ERROR_REPLAY_REJECTED) {
            // async: acceptance IS the honest outcome — the submission is
            // fire-and-forget and the prior attempt settles via the receipt
            // contract.
            if (request.delivery === 'async') {
              return { kind: 'accepted', taskId, acceptedAt: new Date().toISOString(), contextId: request.contextId ?? '' }
            }
            // sync (W7 recovery table, S1): a sync caller cannot consume an
            // acceptance — its verdict contract needs round text, and the
            // handle-ack prose would settle a null verdict as a normal node.
            // Throw instead, and the frozen -32003 literal MUST ride the
            // message: structured codes have no survival channel through the
            // downstream submitFailedError wrap (message-only), so the
            // graph-loop classifier's probeText match on the code value is
            // the only programmatic channel (adjudicated exception to
            // "message 禁止下游解析").
            throw new Error(`A2A submit for "${request.handle}" replayed at the peer's idempotency ledger (task ${taskId} duplicate within the idempotency window, -32003: the prior attempt stays authoritative — fail-closed; outcome retrieval needs a query face)`)
          }
          if (result.code === WIRE_ERROR_IDEMPOTENCY_CONFLICT) {
            // -32002 literal on the message: same classification channel as the sync replay above.
            throw new Error(`A2A submit for "${request.handle}" conflicts at the peer's idempotency ledger (task ${taskId} reused with a different payload, -32002)`)
          }
          if (abort.aborted) break
          continue
        }
        trackOwedTask(taskId, request.handle, candidate, result)
        const contextId = request.contextId ?? (result.context_id !== '' ? result.context_id : `ctx-${Math.random().toString(16).slice(2, 10)}`)
        if (result.task_status === 'TASK_STATE_COMPLETED') {
          return { kind: 'completed', text: result.reply, taskId, contextId }
        }
        // DELIVERED / ABORTED_WAIT: the message is in and the receipt
        // contract carries the outcome — the face maps both to the
        // accepted shape (the submission stays visible in a2a_tasks).
        return { kind: 'accepted', taskId, acceptedAt: new Date().toISOString(), contextId }
      }
      throw new Error(`A2A submit for "${request.handle}" failed on every candidate`)
    },
    queryOutcome: async (request, signal) => {
      const abort = signal ?? new AbortController().signal
      if (request.taskId === '') return undefined
      const failures: string[] = []
      const fetch = memoizedCardFetch()
      const candidates = await directoryPeerCandidates(fetch, request.handle, failures)
      // No candidate to ask: no increment of information — undefined, never
      // a synthetic verdict.
      if (candidates.length === 0) return undefined
      let mismatch = false
      let answeredUnknown = false
      for (const candidate of candidates) {
        // A caller cancel mid-fan-out ends the probe: answers collected
        // before the abort must not aggregate into a verdict the caller
        // already walked away from.
        if (abort.aborted) return undefined
        // Recompute the fingerprint EXACTLY as the submit pass computed it:
        // the same shared implementation, and the same per-candidate async
        // gate (delivery async × that peer's declared capability). Sync
        // delivery — every graph-loop dispatch — is noWait:false throughout.
        let peerAsync = false
        if (request.delivery === 'async') {
          const card = await fetch(candidate)
          peerAsync = (card?.capabilities as { async?: unknown } | undefined)?.async === true
        }
        const fingerprint = peerPayloadFingerprint({ caller: session, message: request.message, noWait: request.delivery === 'async' && peerAsync, team: request.handle })
        const answer = await client.queryOutcome(candidate, request.taskId, fingerprint, abort)
        if (answer === undefined) continue // transport miss — probe the next candidate (read-only fan-out)
        if (!answer.found) {
          if (answer.reason === 'payload-mismatch') mismatch = true
          else answeredUnknown = true
          continue
        }
        return answer
      }
      // A mismatch anywhere wins the aggregation: the key exists at a peer
      // with a different payload — the most diagnostic negative there is.
      if (mismatch) return { found: false, reason: 'payload-mismatch' }
      if (answeredUnknown) return { found: false, reason: 'unknown-task' }
      return undefined
    },
    cancel: async (ref, reason) => {
      const taskId = ref.taskId
      if (taskId === undefined || taskId === '') return false
      const row = taskLedger.list().find(entry => entry.taskId === taskId)
      if (row === undefined) return false
      const notice = cancelNoticeText(taskId, reason)
      if (row.peer === 'local') {
        // Mirror the tasks/cancel control route: the cooperative stop-notice
        // steers the live local target, not just the ledger row. The target
        // resolution spans every kind the dispatcher can book — session
        // node, canvas team, bare process team — a row's team is whatever
        // the dispatch accepted, so the cancel must accept the same set.
        const live = resolveAgentForTeam(row.team)
          ?? canvasLiveAgent(parseCanvasTeamName(row.team))
          ?? (row.team === config.team ? liveAgent() : undefined)
        if (live !== undefined) {
          try {
            steerRelay(live, notice)
          } catch {
            // Bookkeeping below settles regardless; steering is best-effort.
          }
        }
      } else {
        // Peers do NOT track inbound task ids (the owed ledger's writer runs
        // on the dispatcher side), so the peer's ledger-cancel route would
        // deterministically answer 'unknown'. Drive the stop-notice through
        // the wire to the team itself instead. The notice deliberately
        // carries NO task_id: the original id is already claimed at the
        // peer's idempotency ledger with a different payload, so reusing it
        // would 409-conflict before any steer happens (a bodyless key is
        // always fresh there). The original id rides the notice text.
        const result = await client.routeDirect(row.peer, row.team, notice, undefined, undefined, session, true)
        if (!result.ok) {
          logger.warn(`a2a: cancel stop-notice for task ${taskId} failed to deliver to ${row.team}: ${result.error}`)
        }
      }
      return taskLedger.cancel(taskId, reason).outcome === 'cleared'
    },
  }
  ctx.reflect.provide(NATIVE_TEAMS_A2A_FACE_KEY, bridgeFace)

  ctx.tools.register(defineTool({
    name: 'a2a_status',
    description:
      'Read-only A2A network health: the tracked peer fleet with quality scores, routes currently in flight '
      + '(who is waiting on whom), and the recent routing activity ring (inbound and outbound outcomes). '
      + 'Includes the idempotency window occupancy (claims, replays, conflicts) behind the UNIQUE-ization '
      + 'traffic watch. '
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
          idempotency: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              window: { type: 'number', required: true },
              cap: { type: 'number', required: true },
              pending: { type: 'number', required: true },
              settled: { type: 'number', required: true },
              claimsFresh: { type: 'number', required: true },
              replays: { type: 'number', required: true },
              conflicts: { type: 'number', required: true },
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
          `Idempotency window: ${String(value.idempotency.window)}/${String(value.idempotency.cap)} (pending ${String(value.idempotency.pending)}, settled ${String(value.idempotency.settled)}) — claims ${String(value.idempotency.claimsFresh)}, replays ${String(value.idempotency.replays)}, conflicts ${String(value.idempotency.conflicts)}`,
          ...(value.activity.length === 0 ? [] : ['Recent routes:']),
          ...[...value.activity].reverse().slice(0, 10).map((entry: { dir: string; team: string; ok: boolean }) => `  ${entry.dir === 'in' ? '←' : '→'} ${entry.team} ${entry.ok ? 'ok' : 'failed'}`),
        ].join('\n'),
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'A2A network status', kind: 'other', rawInput: null }),
    execute: async (_args, exec): Promise<{
      ok: boolean
      peers: { url: string; score?: number }[]
      inFlight: { team: string; peer: string; startedAt: number }[]
      activity: RouteActivityEntry[]
      idempotency: IdempotencyStats
    }> => {
      a2aJoinGateRefusal(exec)
      return {
        ok: true,
        peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),
        inFlight: [...inFlightRoutes.values()].map(route => ({ team: route.team, peer: route.peer, startedAt: route.startedAt })),
        activity: recentActivity.slice(),
        idempotency: idempotencyStore.stats(),
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
      'Read-only three-tier ledger of routed A2A tasks: pending rows still owed a receipt, rows '
      + 'auto-dead-lettered past the stale TTL, and the bounded archive of correlated '
      + '`[A2A receipt] task <task_id>` outcomes. Use it to reconcile dispatched async work instead of '
      + 're-routing to ask for progress.',
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
                deadAt: { type: 'number' },
              },
            },
          },
          archive: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                taskId: { type: 'string', required: true },
                team: { type: 'string', required: true },
                startedAt: { type: 'number', required: true },
                resolvedAt: { type: 'number', required: true },
                summary: { type: 'string' },
              },
            },
          },
          archivedTotal: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.length === 0 && value.archivedTotal === 0
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
            ...(value.tasks.some((task: { status: string }) => task.status === 'dead') ? ['Dead-lettered (auto-flagged past the stale TTL; a revived target can still settle with a late receipt):'] : []),
            ...value.tasks.filter((task: { status: string }) => task.status === 'dead').map((task: { taskId: string; team: string; peer: string; startedAt: number; contextId?: string }) => {
              const context = task.contextId === undefined || task.contextId === '' ? '' : `, follow-up context ${task.contextId}`
              return `  - ${task.taskId} → ${task.team} (via ${task.peer === 'local' ? 'this host' : task.peer}), dispatched ${describeAge(Date.now() - task.startedAt)} ago${context}`
            }),
            ...(value.archivedTotal > 0 ? [`Archived (${String(value.archivedTotal)}), most recent first:`] : []),
            ...value.archive.map((entry: { taskId: string; team: string; startedAt: number; resolvedAt: number; summary?: string }) => `  - ${entry.taskId} → ${entry.team}: after ${describeAge(entry.resolvedAt - entry.startedAt)}, ${entry.summary === undefined || entry.summary === '' ? 'resolved' : entry.summary}`),
            ...(value.archivedTotal > value.archive.length ? [`  (+${String(value.archivedTotal - value.archive.length)} older not shown)`] : []),
          ].join('\n'),
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'A2A task ledger', kind: 'other', rawInput: null }),
    execute: async (_args, exec): Promise<{ ok: boolean; tasks: { taskId: string; team: string; peer: string; startedAt: number; contextId?: string; status: 'pending' | 'dead'; deadAt?: number }[]; archive: { taskId: string; team: string; startedAt: number; resolvedAt: number; summary?: string }[]; archivedTotal: number }> => {
      a2aJoinGateRefusal(exec)
      const archiveAll = taskLedger.archive()
      return {
        ok: true,
        tasks: taskLedger.list().map(task => ({ ...task })),
        archive: archiveAll.slice(0, 5).map(({ taskId, team, startedAt, resolvedAt, summary }) => ({ taskId, team, startedAt, resolvedAt, ...(summary !== undefined && summary !== '' ? { summary } : {}) })),
        archivedTotal: archiveAll.length,
      }
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
        text: value.results.length === 0
          ? 'No peers are tracked; add seeds or let referrals arrive.'
          : [
            `Fleet probe (${String(value.results.length)}): ${String(value.results.filter((row: { reachable: boolean }) => row.reachable).length)} reachable, ${String(value.results.filter((row: { reachable: boolean }) => !row.reachable).length)} down`,
            ...value.results.map((row: { url: string; reachable: boolean; ms?: number; team?: string; error?: string }) =>
              `  ${row.reachable ? '✓' : '✗'} ${row.url}${row.reachable ? ` (team ${String(row.team)}, ${String(row.ms)}ms)` : ` (${String(row.error)})`}`),
          ].join('\n'),
      }],
    },
    presentCall: args => ({ card: 'generic', title: args.url === undefined || args.url === '' ? 'Probe the A2A fleet' : `Probe A2A peer: ${args.url}`, kind: 'other', rawInput: args }),
    execute: async (args: { url?: string }, exec): Promise<{ ok: boolean; results: { url: string; reachable: boolean; ms: number; team?: string; error?: string }[] }> => {
      a2aJoinGateRefusal(exec)
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
    /** @param placeholder - true when the text is a host-authored
     * stand-in (flush timeout, dead session), NOT the session's product. */
    readonly answer: (text: string, placeholder?: boolean) => void
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
      waiter.answer('The DSH session produced no final reply within the configured window.', true)
    }, config.flushTimeoutMs)
  }

  function flushFinals(agentId: string): void {
    const entries = pendingFinals.get(agentId)
    if (entries === undefined || entries.length === 0) return
    const agent = ctx.get('agents')?.get(SessionId(agentId))
    if (agent === undefined) {
      for (const entry of entries) {
        entry.timeoutDisposer?.()
        entry.answer('The target DSH session is no longer live.', true)
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
