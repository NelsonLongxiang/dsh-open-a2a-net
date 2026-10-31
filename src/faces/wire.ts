/**
 * The /a2a/* wire faces (gh#77 batch B2; slice 2 adds log + query).
 *
 * Moved verbatim out of apply() in src/index.ts: the routes register when
 * the web server settles, exactly as before. What used to be closure
 * captures arrives through WireDeps and is destructured once below, so the
 * route bodies read as they did in index.ts (the B1 admin.ts pattern). The
 * one accessor deviation: the log face's `legacyInboundCount += 1` (a let in
 * index.ts) goes through `d.bumpLegacyInbound()`, the same mutable-binding
 * treatment admin.ts gives its six lets. direct stays inline for slice 3.
 * @module src/faces/wire
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { A2aPeerCard } from '../types.ts'
import { CanvasStore, isRemoteMemberRef, validRemoteMemberRef } from '../canvas-store.ts'
import type { CliDepositStore } from '../cli-deposit.ts'
import type { IdempotencyStore } from '../idempotency-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import { TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_LIMIT } from '../session-transcript.ts'
import { refuseIfBudgetExhausted } from '../recursion-guard.ts'
import { peerPayloadFingerprint, WIRE_ERROR_IDEMPOTENCY_CONFLICT, WIRE_ERROR_REPLAY_REJECTED } from '../idempotency-store.ts'
import { briefOf, type TaskLedger } from '../task-ledger.ts'
import { buildAuthorization, claimCovers, refusalOf, type Admission } from '../task-auth.ts'
import type { Config } from '../index.ts'
import { WIRE_ERROR_PAYLOAD_TOO_LARGE, withinRouteBodyCap } from '../transport-caps.ts'

/** The origin of a card URL for the authorization record; the raw text, bounded, when it does not parse. */
const originOf = (url: string): string => {
  try { return new URL(url).origin } catch { return url.slice(0, 256) }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** The cold-wake answer (mirrors index.ts's local ColdWake). */
export type ColdWake =
  | { readonly kind: 'flight'; readonly flight: Promise<Agent> }
  | { readonly kind: 'no-face' }
  | { readonly kind: 'archived' }
  | { readonly kind: 'no-match' }

/** routeIntoAgent's settled answer (mirrors index.ts's local union). */
export type RouteOutcome = { ok: true; reply: string; status?: string; bridge?: 'native-teams'; placeholder?: boolean } | { ok: false; error: string }

interface BridgeTeamsRegistryMirror {
  listTeams(): Array<{ name: string; description: string }>
  describeTarget(handle: string): Promise<{ plane: 'local' | 'a2a'; ambiguous?: boolean; localLabel?: string }>
  startRound(args: { team?: string; message: string }, parent: { id: string; session: { events?: readonly unknown[] } }, signal: AbortSignal): Promise<string>
}

/** nativeTeamsPrepare's answer (mirrors index.ts's local union). */
export type NativePrepared =
  | { readonly ok: true; readonly teams: BridgeTeamsRegistryMirror; readonly parent: { id: string; session: { events?: readonly unknown[] } } }
  | { readonly ok: false; readonly reason: 'not-claimed' }
  | { readonly ok: false; readonly reason: 'error'; readonly error: string }

/** nativeTeamsRound's settled answer (mirrors index.ts's local union). */
export type NativeRoundOutcome =
  | { readonly ok: true; readonly reply: string; readonly settled: boolean }
  | { readonly ok: false; readonly error: string; readonly phase?: 'pre-dispatch'; readonly aborted?: boolean }

/** What verifyOriginClaim answers (see index.ts; reason widens to string here — the faces only interpolate it). */
export type OriginClaimResult = { ok: true; caller: string; callerUrl: string; card: A2aPeerCard; cli?: true } | { ok: false; reason: string }

/** Same scheme/host/port; false when either side is empty or malformed. */
function sameOrigin(a: string, b: string): boolean {
  try { return a !== '' && b !== '' && new URL(a).origin === new URL(b).origin } catch { return false }
}

/** The closure captures the wire faces read (grows with each extracted face). */
export interface WireDeps {
  readonly ctx: Context
  readonly logger: ReturnType<Context['logger']>
  readonly config: Config
  readonly cliDeposits: CliDepositStore
  readonly canvasStore: CanvasStore
  readonly sessionNodes: Map<string, Agent>
  readonly joinedSessions: JoinedSessions
  readonly idempotencyStore: IdempotencyStore
  readonly verifyOriginClaim: (req: IncomingMessage, options?: { readonly cli?: boolean }) => Promise<OriginClaimResult>
  readonly callerLinkedToThisHost: (caller: string, callerUrl: string, callerCard: A2aPeerCard | undefined) => boolean
  /** This host's own card URL (read when a request lands; set once the web server settles). */
  readonly ownCardUrl: string
  readonly recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void
  readonly bumpLegacyInbound: () => void
  readonly secretEqual: (a: string, b: string) => boolean
  readonly a2aCallerRefusal: (caller: string, targetTeam?: string) => string | undefined
  /** #114 S2: the same decision with the rule and basis that admitted the caller. */
  readonly a2aCallerAdmission: (caller: string, targetTeam?: string) => Admission
  /** #114 S2: this host's allowlist version right now (design §2.3). */
  readonly allowlistVersionNow: () => string
  readonly scanSessionLogList: () => Array<{ id: string; mtimeMs: number; sizeBytes: number }>
  readonly readSessionLogTail: (id: string, limit: number) => { ok: true; id: string; messages: Array<{ role: string; text: string; time?: number }> } | { ok: false; error: string }
  readonly taskLedger: TaskLedger
  readonly refuseIfFlooded: (caller: string, message: string, team: string, taskId: string, res: ServerResponse) => boolean
  readonly settleAndAnnounce: (message: string) => void
  readonly touchWakeDemand: () => void
  readonly session: string
  readonly resolveAgentForTeam: (team: string) => Agent | undefined
  readonly parseCanvasTeamName: (team: string) => string | undefined
  readonly canvasLiveAgent: (name: string | undefined, skipId?: string) => Agent | undefined
  readonly wakeColdTeam: (team: string, skipId?: string) => ColdWake
  readonly probeConsumption: (agent: Agent, taskId: string) => boolean
  readonly steerRelay: (agent: Agent, text: string, sender?: string) => void
  readonly fromClause: (from: string) => string
  readonly armReceiptAutosend: (target: Agent, taskId: string, callerTeam: string | undefined, deliveredText: string) => void
  readonly receiptExpectationOf: (receiptTarget: string) => 'receivable' | 'process-label'
  readonly armAsyncNudge: (agent: Agent, team: string, taskId: string, delayMs: number) => void
  readonly liveAgent: () => Agent | undefined
  readonly callerIsAgent: (agent: Agent, caller: string) => boolean
  readonly selfRouteText: (team: string) => string
  readonly noWakeFaceText: (team: string) => string
  readonly archivedColdMatchText: (team: string) => string
  readonly noColdMatchText: (team: string) => string
  readonly nativeTeamsPrepare: (team: string) => Promise<NativePrepared>
  readonly nativeTeamsRound: (prepared: Extract<NativePrepared, { ok: true }>, team: string, caller: string, message: string, taskId: string | undefined) => Promise<NativeRoundOutcome>
  readonly routeIntoAgent: (team: string, message: string, caller: string, taskId?: string) => Promise<RouteOutcome>
}

/**
 * Register the small wire faces on a settled web server.
 * @param webServer - the settled host web server.
 * @param d - the captures listed on {@link WireDeps}.
 */
export function registerWireFaces(webServer: WebServer, d: WireDeps): void {
  const {
    ctx,
    logger,
    config,
    cliDeposits,
    canvasStore,
    sessionNodes,
    joinedSessions,
    idempotencyStore,
    verifyOriginClaim,
    callerLinkedToThisHost,
    recordActivity,
    secretEqual,
    a2aCallerRefusal,
    a2aCallerAdmission,
    allowlistVersionNow,
    scanSessionLogList,
    readSessionLogTail,
    taskLedger,
    refuseIfFlooded,
    settleAndAnnounce,
    session,
    resolveAgentForTeam,
    parseCanvasTeamName,
    canvasLiveAgent,
    wakeColdTeam,
    probeConsumption,
    steerRelay,
    fromClause,
    armReceiptAutosend,
    receiptExpectationOf,
    armAsyncNudge,
    liveAgent,
    callerIsAgent,
    selfRouteText,
    noWakeFaceText,
    archivedColdMatchText,
    noColdMatchText,
    nativeTeamsPrepare,
    nativeTeamsRound,
    routeIntoAgent,
  } = d
  // gh#45 CLI 户口卡面 (peer face, unsigned card serve): the deposited
  // CLI's SIGNED card is served verbatim under its own base URL — an
  // OriginClaim verification of a CLI envelope fetches exactly here
  // (callerUrl + /.well-known/agent-card.json). Expired or unknown
  // handles 404 (auto-deregistered — the identity is dead until
  // re-publish).
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/a2a/cli',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const MOUNT = '/a2a/cli'
      const rest = (req.url ?? '').slice(MOUNT.length)
      const m = /^\/([^/]+)\/\.well-known\/agent-card\.json$/.exec(rest)
      if (req.method !== 'GET' || m === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end()
        return
      }
      const handle = decodeURIComponent(m[1]!)
      const row = cliDeposits.get(handle)
      if (row === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(row.cardJson)
    },
  }), 'a2a: cli deposit card face')

  // gh#41 fleet planning, peer-write face: a LINKED peer may regulate this
  // host's canvas teams (create / add-member / remove-member / remove) with a
  // VERIFIED OriginClaim envelope. The owner's ruling: any peer composes
  // and regulates the whole fleet — the bilateral/operator link IS the
  // authorization, the envelope proves the key, and every op lands in the
  // activity ring + host log for audit. Unlinked or unsigned callers get
  // a refusal, never a mutation.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/canvas-op',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const send = (status: number, payload: string): void => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }
      if (req.method !== 'POST') { send(200, JSON.stringify({ ok: false, error: 'POST required' })); return }
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16 * 1024) { chunks.length = 0; return } chunks.push(chunk) })
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { op?: unknown; name?: unknown; id?: unknown }
            const claim = await verifyOriginClaim(req)
            if (!claim.ok) {
              logger.warn(`a2a: canvas-op claim failed (${claim.reason}) — caller=${String(req.headers['x-a2a-caller'] ?? '')} url=${String(req.headers['x-a2a-caller-url'] ?? '')} ts=${String(req.headers['x-a2a-caller-ts'] ?? '')}`)
              send(200, JSON.stringify({ ok: false, error: `untrusted-origin: OriginClaim verification failed (${claim.reason}) — canvas regulation requires a signed envelope`, code: -32000 }))
              return
            }
            // This host edits its own canvas through the local control, never
            // through this peer face. A claim naming OUR origin is an envelope
            // we stamped on some outbound request (a card fetch to any tracked
            // peer, linked or not) being replayed at us: the claim is stateless
            // and binds no target, so the same-host basis must not admit it here.
            if (sameOrigin(claim.callerUrl, d.ownCardUrl)) {
              recordActivity('in', 'fleet-canvas', claim.caller, false)
              send(200, JSON.stringify({ ok: false, error: 'a host does not regulate its own canvas through the peer face (replayed self envelope refused)' }))
              return
            }
            if (!callerLinkedToThisHost(claim.caller, claim.callerUrl, claim.card)) {
              recordActivity('in', 'fleet-canvas', claim.caller, false)
              send(200, JSON.stringify({ ok: false, error: `caller "${claim.caller}" is not linked to this host — canvas regulation requires the operator link (bilateral seed, canvas ref, or same-host membership)` }))
              return
            }
            const op = body.op
            const name = typeof body.name === 'string' ? body.name : ''
            const id = typeof body.id === 'string' ? body.id : ''
            let payload: { ok: boolean; members?: readonly string[]; removed?: boolean; error?: string }
            if (op === 'create') {
              const stored = canvasStore.create(name)
              payload = stored === undefined ? { ok: false, error: 'invalid name or team cap reached' } : { ok: true, members: canvasStore.membersOf(stored) }
            } else if (op === 'add-member') {
              const memberValid = isRemoteMemberRef(id) ? validRemoteMemberRef(id) : id !== '' && (sessionNodes.has(id) || joinedSessions.has(id))
              payload = name === '' || !memberValid
                ? { ok: false, error: 'name and a member (joined session id, or a zone-qualified remote team handle) are required' }
                : (canvasStore.create(name), { ok: canvasStore.addMember(name, id), members: canvasStore.membersOf(name) })
            } else if (op === 'remove-member') {
              payload = { ok: name !== '' && canvasStore.removeMember(name, id), members: name !== '' ? canvasStore.membersOf(name) : undefined }
            } else if (op === 'remove') {
              // Dissolve. Idempotent: a team that is not here (another peer got
              // there first) is the outcome the caller asked for — `removed`
              // says which it was.
              payload = name === '' ? { ok: false, error: 'name is required' } : { ok: true, removed: canvasStore.remove(name) }
            } else {
              payload = { ok: false, error: 'op must be create | add-member | remove-member | remove' }
            }
            recordActivity('in', 'fleet-canvas', `${claim.caller}:${String(op)}`, payload.ok)
            logger.info(`a2a: fleet canvas op from ${claim.caller} (${String(op)} ${name}${id !== '' ? ` ${id}` : ''}) -> ${payload.ok ? 'applied' : `refused: ${payload.error ?? '?'}`}`)
            send(200, JSON.stringify(payload))
          } catch (error) {
            send(200, JSON.stringify({ ok: false, error: `canvas-op failed: ${error instanceof Error ? error.message : String(error)}` }))
          }
        })()
      })
    },
  }), 'a2a: fleet canvas-op peer route')

  // 0.6.15: the read-only peer log face — a peer asks for THIS node's
  // session transcript tail (or, without id, the readable-session
  // listing) so a remote workbench can show "what has this node been
  // talking about". Admission is a2aCallerRefusal — exactly the rule
  // /a2a/direct applies to message delivery: caller_session required,
  // zone/id8 callers judged on shared teams. Read semantics are the
  // local /__dsh_a2a/session-log face verbatim (artifact existence is
  // the only gate; archived and never-joined sessions stay readable;
  // caps mirror session-transcript.ts). Nothing here steers a session,
  // claims a task, or writes state — the only side effects are the
  // activity-ring record and the admission path's background
  // directory learn.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/log',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const send = (status: number, body: Record<string, JsonValue>): void => {
        const payload = JSON.stringify(body)
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }
      if (req.method !== 'GET') {
        send(405, { ok: false, error: 'GET is the only method on this face' })
        return
      }
      // V2 (gh#7, S1): the read-only log face rides the same apiKey gate
      // as delivery — a configured key must be presented here too.
      if (config.apiKey !== '') {
        const presented = String(req.headers['x-api-key'] ?? '')
        if (!secretEqual(presented, config.apiKey)) {
          send(401, { ok: false, error: 'unauthorized: X-API-Key required (apiKey is configured)', code: -32000 })
          return
        }
      }
      const url = new URL(req.url ?? '/', 'http://x')
      const caller = url.searchParams.get('caller_session') ?? ''
      const id = url.searchParams.get('id') ?? ''
      const limitArg = Number(url.searchParams.get('limit') ?? TRANSCRIPT_DEFAULT_LIMIT)
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(TRANSCRIPT_MAX_LIMIT, Math.floor(limitArg))) : TRANSCRIPT_DEFAULT_LIMIT
      const refusal = a2aCallerRefusal(caller)
      if (refusal !== undefined) {
        recordActivity('in', 'log', caller === '' ? 'anonymous' : caller, false)
        send(200, { ok: false, error: refusal, code: -32000 })
        return
      }
      // gh#9+gh#10: the log face reuses the exact OriginClaim
      // verification (§8.3) — same window semantics as delivery.
      const logClaim = await verifyOriginClaim(req)
      if (!logClaim.ok) {
        if (logClaim.reason !== 'absent' || config.originClaimWindow === false) {
          recordActivity('in', 'log', caller, false)
          send(200, { ok: false, error: `untrusted-origin: OriginClaim verification failed (${logClaim.reason}) — present a signed envelope or upgrade your node`, code: -32000 })
          return
        }
        d.bumpLegacyInbound()
      }
      recordActivity('in', 'log', caller, true)
      if (id.includes('/') || id.includes('\\') || id.includes('..')) {
        send(200, { ok: false, error: 'id is required' })
        return
      }
      if (id === '') {
        try {
          const rows = scanSessionLogList()
          send(200, { ok: true, count: rows.length, sessions: rows.slice(0, 50) })
        } catch (error) {
          send(200, { ok: false, error: `transcript list failed: ${error instanceof Error ? error.message : String(error)}` })
        }
        return
      }
      try {
        const tail = readSessionLogTail(id, limit)
        if (!tail.ok) send(200, { ok: false, error: tail.error })
        else send(200, { ok: true, id: tail.id, count: tail.messages.length, messages: tail.messages })
      } catch (error) {
        send(200, { ok: false, error: `transcript failed: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
  }), 'a2a: peer log face endpoint')

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

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/a2a/direct',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
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
        req.on('end', async () => {
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
          // V2 (gh#7, S1): the delivery face honors the apiKey gate exactly
          // like the control face — a configured key without this header
          // used to let anyone reachable steer sessions while the control
          // routes demanded the key, making it decorative for delivery.
          // Empty-key deployments keep the documented open posture.
          if (config.apiKey !== '') {
            const presented = String(req.headers['x-api-key'] ?? '')
            if (!secretEqual(presented, config.apiKey)) {
              const payload = JSON.stringify({ error: 'unauthorized: X-API-Key required on the delivery face (apiKey is configured)', code: -32000 })
              res.writeHead(401, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
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
          // Phase-3 admission (owner ruling 2026-09-01, decision-seat
          // filed): an inbound direct delivery must show a SHARED team.
          // Local-zone callers are judged synchronously and exactly — the
          // declaration lives in this host's own roster store, so the
          // Anonymous-delivery refusal (S3 phase-3b, test-seat finding
          // direct-001649ab): a delivery with NO caller_session field
          // skips the admission gate entirely (nothing to judge) — that
          // anonymous hole let any local process or reachable peer inject
          // into a live session. The protocol contract is caller_session;
          // its absence is now refused instead of silently waved through.
          // (0.6.15: the rule now lives in a2aCallerRefusal so the
          // read-only /a2a/log face admits callers by exactly the same
          // standard as message delivery.)
          const admission = a2aCallerAdmission(caller, team)
          const callerRefusal = refusalOf(admission)
          if (callerRefusal !== undefined || !admission.ok) {
            recordActivity('in', team, caller === '' ? 'anonymous' : caller, false)
            const payload = JSON.stringify({ error: callerRefusal, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // #114 S2: the version is read at admission time, beside the decision it explains.
          const admittedAt = { version: allowlistVersionNow(), at: Date.now() }
          // gh#9+gh#10 OriginClaim on the delivery face (M1): an envelope
          // that is present but unverifiable rejects untrusted-origin; an
          // ABSENT envelope during the window walks on with a counted
          // legacyInbound warn (the operator watches the tail drain), and
          // after the window closes it rejects like a failed signature —
          // N3 proves a NAME's linkability, never key possession.
          // gh#133: the delivery face is where a deposited CLI identity signs its routes.
          const claim = await verifyOriginClaim(req, { cli: true })
          if (!claim.ok) {
            if (claim.reason !== 'absent' || config.originClaimWindow === false) {
              recordActivity('in', team, caller, false)
              const payload = JSON.stringify({ error: `untrusted-origin: OriginClaim verification failed (${claim.reason}) — present a signed envelope (X-A2A-Caller/-Url/-Ts/-Sig with your card key) or upgrade your node`, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
            d.bumpLegacyInbound()
          }
          if (refuseIfBudgetExhausted(req, res, team, caller, taskId, taskLedger)) return
          // Server-side idempotency (P3/B3): one key, one execution inside
          // the window. Same key + same payload ⇒ replay; different payload
          // ⇒ hard conflict (both 409). A replay must never re-enter the
          // target session, no matter how it settles.
          const idemFingerprint = peerPayloadFingerprint({ caller, message, noWait, team })
          const idemVerdict = idempotencyStore.claim(taskId, idemFingerprint)
          if (idemVerdict !== 'fresh') {
            const replay = idemVerdict === 'replay'
            // Conflicts warn (caller key reuse bugs); harmless replays stay silent.
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
          if (refuseIfFlooded(caller, message, team, taskId, res)) return
          // The caller-side receipt correlation: a message shaped as a
          // receipt resolves the task it echoes, whichever wait semantics
          // carried it here. Correlation is bookkeeping only — the message
          // steers on exactly as before.
          settleAndAnnounce(message)
          // gh#45 CLI mailbox (wire face): a delivery targeting a DEPOSITED
          // CLI handle never resolves a session and never wakes — it lands
          // in the deposit's mailbox and answers delivered. Placement here
          // keeps the idempotency claim (above) exactly as for sessions.
          const cliRow = cliDeposits.get(team)
          if (cliRow !== undefined) {
            cliDeposits.mail(team, caller, message)
            recordActivity('in', team, caller, true)
            logger.info(`a2a: cli mailbox delivery for ${team} (from ${caller})`)
            const note = `delivered to the mailbox of ${team} — the CLI polls while online`
            // gh#112 review: a mailbox delivery is final from this host's
            // side, so a resend of this id reads `completed`. A receipt the
            // CLI routes back later still reaches its caller, but does not
            // replace this outcome (recordOutcome is first-writer-wins).
            idempotencyStore.recordOutcome(taskId, { status: 'completed', reply: note })
            const payload = JSON.stringify({ routed: true, delivered: true, receipt: 'mailbox', team, task_id: taskId, task_status: 'TASK_STATE_COMPLETED', note })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // Inbound routing is foreground demand: boot prewarm yields for a
          // quiet window around it.
          d.touchWakeDemand()
          // wait:false delivers without the final-reply hold: steer resolves
          // synchronously inside routeIntoAgentFor, so by the time the agent
          // lookup settles the message is already in — answer delivered and
          // let the receipt contract carry the reply.
          if (noWait) {
            // gh#112 review P1: a no-wait refusal AFTER the idempotency
            // claim records its failed outcome — otherwise a resend of the
            // same id reads `pending` from /a2a/query forever and the
            // caller is told an undelivered message already landed.
            const refuseNoWait = (error: string, activity = true): void => {
              if (activity) recordActivity('in', team, caller, false)
              idempotencyStore.recordOutcome(taskId, { status: 'failed', error })
              const payload = JSON.stringify({ error, code: -32000, team, task_id: taskId, task_status: 'TASK_STATE_FAILED' })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
            }
            // Issue #41 companion fix: the no-wait inbound branch resolved
            // only bare session teams — a canvas team delivery (wait:false)
            // fell through to the cold tier and answered a bogus
            // no-match although a live member existed. Same resolution as
            // the waiting face (routeIntoAgent), and likewise NO initiator
            // skip: the wire face delivers faithfully to the first live
            // member, whoever the caller is.
            const agent = resolveAgentForTeam(team) ?? canvasLiveAgent(parseCanvasTeamName(team))
            const wake = agent !== undefined ? undefined : wakeColdTeam(team)
            const deliver = (target: Agent): void => {
              const from = caller === '' ? 'an unknown node' : caller
              // The receipt target: the caller's callback address when it
              // supplied one (a session node team — wake-on-route covers a
              // cold one), else the caller label as before.
              const receiptTarget = callback !== '' ? callback : from
              // gh#112 review: only a failed steer is a refusal. Once the
              // message is in the session, a failure in the bookkeeping that
              // follows must not record `failed` (a resend would read
              // "already ran and failed" and invite a second execution).
              let steered = false
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
                steerRelay(target, `[A2A direct] (task ${taskId}) ${fromClause(from)} (routed to ${team}) sent:\n\n${message}\n\n(When done, route your outcome back with one call — a2a_route { team: "${receiptTarget}", message: "[A2A receipt] task ${taskId} <one-line outcome>" }.)`, from === 'an unknown node' ? undefined : from)
                steered = true
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
                // F2' (receipt-settlement): the delivery is born into the
                // ledger — an inbound row owes a receipt only this node can
                // produce, and before this row existed the nudge's isPending
                // gate no-op'd for exactly the deliveries that stall (08-30:
                // zero ledger records for latched activations). Arming is
                // unconditional now; settlement evidence disarms in the
                // callback.
                const consumedProbe = runningBeforeSteer ? false : probeConsumption(target, taskId)
                // F5 (settlement integrity): the debt gate — a process-label
                // caller cannot receive receipts, so this delivery is born
                // fire-and-forget (receiptExpected:false, answered as
                // receipt:"none") instead of manufacturing a debt nobody can
                // settle. The row itself stays: stall visibility and the
                // nudge still apply to the TARGET side.
                const receiptExpectation = receiptExpectationOf(receiptTarget)
                // #114 S2: the row is born with its immutable authorization record.
                const auth = buildAuthorization(admission, {
                  caller,
                  // A verified claim proves the caller only when its signed zone covers it (review of PR #134 P1),
                  // and the host face only when it was signed from this very host (round 2: a zone name is not an origin).
                  proof: !claim.ok ? 'legacy-window'
                    : claimCovers(caller, claim.caller) && (admission.rule !== 'host-face' || originOf(claim.callerUrl) === originOf(d.ownCardUrl))
                      ? 'origin-claim' : 'claim-mismatch',
                  ...(claim.ok ? { claim: { caller: claim.caller, origin: originOf(claim.callerUrl) } } : {}),
                  ingress: 'wire',
                  allowlistVersion: admittedAt.version,
                  target: team,
                  receiptTarget,
                  receivedAt: admittedAt.at,
                  // Audit only: a cold session's activation window also reads as running.
                  targetBusy: runningBeforeSteer,
                })
                taskLedger.trackInbound(taskId, team, receiptTarget, contextId === '' ? undefined : contextId, receiptExpectation !== 'process-label', briefOf(message), auth)
                armAsyncNudge(target, team, taskId, config.asyncNudgeDelayMs)
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
                  receipt: receiptExpectation === 'process-label' ? 'none' : 'routed',
                })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                res.end(payload)
              } catch (error) {
                if (!steered) { refuseNoWait(`The DSH session rejected the message: ${String(error)}`); return }
                logger.warn(`a2a: task ${taskId.slice(0, 80)} was delivered to ${team}, but its bookkeeping failed: ${String(error)}`)
                if (!res.headersSent) {
                  const payload = JSON.stringify({ routed: true, delivered: true, team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_DELIVERED', artifacts: [], consumed: false, receipt: 'routed' })
                  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                  res.end(payload)
                }
              }
            }
            if (agent !== undefined) { deliver(agent); return }
            if (wake?.kind === 'flight') {
              void wake.flight.then(deliver, (error: unknown) => {
                refuseNoWait(`waking the session for team "${team}" failed: ${String(error)}`)
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
                  if (live !== undefined) {
                    // Self-route refusal (mirrors the sync face): a caller
                    // naming the very agent the fallback resolves to must
                    // get an honest failure, never its own dispatch echoed
                    // home plus an auto-receipt for work nobody did.
                    if (callerIsAgent(live, caller)) {
                      refuseNoWait(selfRouteText(team))
                      return
                    }
                    deliver(live); return
                  }
                }
                refuseNoWait(wake?.kind === 'no-face' ? noWakeFaceText(team) : wake?.kind === 'archived' ? archivedColdMatchText(team) : noColdMatchText(team), false)
              }
              const prepared = await nativeTeamsPrepare(team)
              if (!prepared.ok) {
                if (prepared.reason === 'error') {
                  refuseNoWait(prepared.error)
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
}
