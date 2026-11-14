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
import {FollowupAcceptanceUnknown,ACCEPTANCE_UNKNOWN_NOTE,ACCEPTANCE_INSERTED_NOTE} from '../followup-admission.ts'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { A2aPeerCard, A2aRouteResult } from '../types.ts'
import type { ForwardRequest } from '../direct-forward.ts'
import { CanvasStore, isRemoteMemberRef, validRemoteMemberRef } from '../canvas-store.ts'
import { splitCanvasOwner } from '../canvas-id.ts'
import { CLI_HANDLE_RE, type CliDepositStore } from '../cli-deposit.ts'
import type { IdempotencyStore } from '../idempotency-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import { TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_LIMIT } from '../session-transcript.ts'
import { refuseIfBudgetExhausted } from '../recursion-guard.ts'
import { peerPayloadFingerprint, WIRE_ERROR_IDEMPOTENCY_CONFLICT, WIRE_ERROR_REPLAY_REJECTED } from '../idempotency-store.ts'
import { briefOf, type TaskLedger } from '../task-ledger.ts'
import { parseReceipt, taskIdRefusal } from '../receipt.ts'
import { buildAuthorization, claimCovers, nextOf, refusalOf, type Admission, type AuthProof, type RemoteCliProof, type SettlementRefusal, type Settler } from '../task-auth.ts'
import { AdmittedBookkeepingError, ADMITTED_BOOKKEEPING_NOTE } from '../admitted-bookkeeping.ts'
import { isRootOriginUrl, type OriginClaimVerdict } from '../origin-claim.ts'
import { hasOriginClaimFields, completeInboundVerification, verifiedInboundAdmission, WIRE_ERROR_INBOUND_VERIFICATION } from '../inbound-verification.ts'
import type { Config } from '../index.ts'
import { withResponseFields } from '../response-fields.ts'
import { WIRE_ERROR_PAYLOAD_TOO_LARGE, withinRouteBodyCap } from '../transport-caps.ts'

/**
 * #139 (design §4.4): add `settlement: {status:'refused', reason, task_id}`
 * to whatever JSON object this response ends with. The delivery face has
 * many exits (mailbox, no-wait, waiting, refusals); deferring the head until
 * the body is known keeps one rule for all of them. A non-JSON or non-object
 * body is sent unchanged.
 */
export function withSettlementField(res: ServerResponse, settlement: SettlementRefusal): void {
  withResponseFields(res, { settlement })
}

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
export type RouteOutcome = { ok: true; reply: string; acceptance?:'inserted'; receiverBookkeeping?:'failed'; status?: string; placeholder?: boolean; ownTurn?: true } | { ok: false; error: string; acceptance?:'unknown'; localMiss?: true }

/** What verifyOriginClaim answers (see index.ts; reason widens to string here — the faces only interpolate it). */
export type OriginClaimResult = OriginClaimVerdict

/** Same scheme/host/port; false when either side is empty or malformed. */
function sameOrigin(a: string, b: string): boolean {
  try { return a !== '' && b !== '' && new URL(a).origin === new URL(b).origin } catch { return false }
}

/** The closure captures the wire faces read (grows with each extracted face). */
export interface WireDeps {
  /** superagent design v4: the refusal when `team` is the superagent router (it takes no A2A work), else undefined. */
  readonly superagentInbound: (team: string) => string | undefined
  /** superagent design v4: whether `team` is the team's A2A address (its requests take no target queue slot). */
  readonly superagentIntake: (team: string) => boolean
  /** A receipt for a request a person sent from the team tab as `team`: kept for the tab, never steered into the session. */
  readonly sidebarReceipt?: (team: string, message: string, caller: string, settled: boolean) => boolean
  /** Design v5 (D2): the team mailbox a route to the bound team canvas lands in; undefined for any other target. */
  readonly teamMailboxOf?: (team: string) => string | undefined
  /** Design v5 (D2): why a route straight to the team identity's handle is refused, if it is. */
  readonly teamAddressRefusal?: (team: string, message: string) => string | undefined
  readonly ctx: Context
  readonly logger: ReturnType<Context['logger']>
  readonly config: Config
  readonly cliDeposits: CliDepositStore
  readonly canvasStore: CanvasStore
  readonly canvasMemberForWrite: (ref: string, peer?: unknown, editorCard?: A2aPeerCard) => Promise<{ ok: true; member: string; ownerKey?: string } | { ok: false; error: string }>
  /** Design v5 R3/R4: why the superagent team refuses this member on this canvas, if it does (absent: no team). */
  readonly teamCanvasRefusal?: (canvas: string, member: string) => string | undefined
  /** The canvas a superagent team is bound to here: only this host's owner changes it (a canvas change is a pool change). */
  readonly teamCanvasBound?: (canvas: string) => boolean
  readonly canvasNameReserved: (name: string) => boolean
  readonly sessionNodes: Map<string, Agent>
  readonly joinedSessions: JoinedSessions
  readonly idempotencyStore: IdempotencyStore
  readonly verifyOriginClaim: (req: IncomingMessage, options?: { readonly cli?: boolean; readonly rawBody?: Uint8Array }) => Promise<OriginClaimResult>
  readonly forwardDirect: (request: ForwardRequest) => Promise<A2aRouteResult>
  /** #282 S2: this host's canvas owner fingerprint. */
  readonly ownCanvasFingerprint: string
  readonly diagnoseCanvas: (team: string, reason: string, caller?: string) => Promise<string>
  readonly remoteCliProof: (handle: string, claim: Extract<OriginClaimResult, { ok: true }>) => Promise<RemoteCliProof | undefined>
  /** #282 S3: the basis for a receipt to a local CLI from a member frozen on this host's own forward, else undefined. */
  readonly forwardReceiptBasis: (taskId: string, caller: string, cliHandle: string, claim: Extract<OriginClaimResult, { ok: true }>) => string | undefined
  /** Design v5 (v5-B2): the basis on which a superagent team's host-face receipt to one of this host's own requests lands. */
  readonly teamReceiptBasis?: (taskId: string, caller: string, target: string, onBehalfOf: string | undefined, claim: Extract<OriginClaimResult, { ok: true }>) => string | undefined
  readonly receiptReplayAllowed:(message:string,caller:string,team:string,claim:Extract<OriginClaimResult,{ok:true}>)=>boolean
  readonly callerLinkedToThisHost: (caller: string, callerUrl: string, callerCard: A2aPeerCard | undefined) => boolean
  /** This host's own card URL (read when a request lands; set once the web server settles). */
  readonly ownCardUrl: string
  readonly recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void
  readonly bumpLegacyInbound: () => void
  /** #317: the peer-face key gate — this host's apiKey, or a link key from the verified peer it belongs to. */
  readonly peerKeyAdmits: (req: IncomingMessage, rawBody?: Uint8Array) => Promise<boolean>
  readonly a2aCallerRefusal: (caller: string, targetTeam?: string) => string | undefined
  /** #114 S2: the same decision with the rule and basis that admitted the caller. */
  readonly a2aCallerAdmission: (caller: string, targetTeam?: string, cliProof?: RemoteCliProof, signerKey?: string) => Admission
  /** #114 S2: this host's allowlist version right now (design §2.3). */
  readonly allowlistVersionNow: () => string
  /** #114 S6: record the version if it moved and re-judge affected tasks (observe only). */
  readonly observeAuthorization: (cause: string) => void
  readonly scanSessionLogList: () => Array<{ id: string; mtimeMs: number; sizeBytes: number }>
  readonly readSessionLogTail: (id: string, limit: number) => { ok: true; id: string; messages: Array<{ role: string; text: string; time?: number }> } | { ok: false; error: string }
  readonly taskLedger: TaskLedger
  /**
   * Superagent intake (owner ruling 2026-11-14, option B): the canvas team a request from a session on a linked host may
   * reach, or undefined. Only a superagent team's canvas address, only a bound claim from a linked peer's root card whose
   * zone covers the caller, never this host's own key; the team owner's sender card decides the rest (M12).
   */
  readonly superagentIntakeBasis?: (team: string, caller: string, claim: Extract<OriginClaimResult, { ok: true }>) => Promise<string | undefined>
  /** Keep an admitted session delivery's text for its receiver (src/task-bodies.ts; receipts are skipped there). */
  readonly keepTaskBody?: (taskId: string, target: Agent, from: string, message: string) => void
  readonly refuseIfFlooded: (caller: string, message: string, team: string, taskId: string, res: ServerResponse) => boolean
  /** gh#224: refuses a new delivery once the target already owes `targetQueueCap` receipts. */
  readonly refuseIfQueueFull: (caller: string, message: string, team: string, taskId: string, mailbox: boolean, res: ServerResponse) => boolean
  /** Settles a receipt; returns the enforce refusal of the row its header names (#139), if any. */
  readonly waitForForwardBirth: (message: string) => Promise<void>
  readonly settleAndAnnounce: (message: string, settler?: Settler) => SettlementRefusal | undefined
  readonly touchWakeDemand: () => void
  readonly session: string
  readonly resolveAgentForTeam: (team: string) => Agent | undefined
  readonly parseCanvasTeamName: (team: string) => string | undefined
  readonly canvasLiveAgent: (name: string | undefined, skipId?: string) => Agent | undefined
  readonly wakeColdTeam: (team: string, skipId?: string) => ColdWake
  readonly probeConsumption: (agent: Agent, taskId: string) => boolean
  /** A session's own node team (`<zone>/<id8>`), the handle a member is known by. */
  readonly sessionTeamOf: (agent: Agent) => string
  /** gh#131: the local session one of this host's own `<zone>/<id8>` handles names, if exactly one. */
  readonly localSessionOfHandle: (ref: string) => string | undefined
  readonly cancelQueuedTask: (taskId:string, message:string, sender:string, original?: import('../task-ledger.ts').TaskRecord) => Promise<{removed:boolean;steered:boolean}>
  readonly followupRelay: (agent: Agent, text: string, sender?: string, localFrom?: string, taskId?: string, callerKey?: string, taskExpected?:boolean) => 'inserted'|void
  readonly steerRelay: (agent: Agent, text: string, sender?: string) => void
  readonly fromClause: (from: string) => string
  readonly sanitizeFromClause: (from: string) => string
  readonly armReceiptAutosend: (target: Agent, taskId: string, callerTeam: string | undefined, deliveredText: string, steerFloor: number) => void
  /** #114 S5: the target's session-log length, read just before a steer. */
  readonly eventCountOf: (agent: Agent) => number
  readonly receiptExpectationOf: (receiptTarget: string) => 'receivable' | 'process-label'
  readonly armAsyncNudge: (agent: Agent, team: string, taskId: string, delayMs: number) => void
  readonly liveAgent: () => Agent | undefined
  readonly callerIsAgent: (agent: Agent, caller: string) => boolean
  readonly selfRouteText: (team: string) => string
  readonly noWakeFaceText: (team: string) => string
  readonly archivedColdMatchText: (team: string) => string
  readonly noColdMatchText: (team: string) => string
  readonly routeIntoAgent: (team: string, message: string, caller: string, taskId?: string, proofClause?: string, directHeader?: (from: string) => string, localFrom?: string, onSteered?: (target: Agent, floor: number,acceptance?:'inserted'|void) => void, callerKey?: string) => Promise<RouteOutcome>
}

/**
 * #187: what a verified claim may vouch for at settlement. The signing key always (the card was
 * fetched and its key verified); the ORIGIN only when the claim URL is that origin's root — a card
 * fetched from a path under an origin proves the path's publisher, not the origin's host.
 */
export function settlerClaimFields(claim: { ok: boolean; cli?: true; callerUrl?: string; card?: { publicKey: string } }, originOf: (url: string) => string): { claimOrigin?: string; claimKey?: string } {
  if (!claim.ok || claim.cli === true || claim.card === undefined || claim.callerUrl === undefined) return {}
  return { ...(isRootOriginUrl(claim.callerUrl) ? { claimOrigin: originOf(claim.callerUrl) } : {}), claimKey: claim.card.publicKey }
}

/**
 * Register the small wire faces on a settled web server.
 * @param webServer - the settled host web server.
 * @param d - the captures listed on {@link WireDeps}.
 */
/** #298: how long, and how many, sync-answered forwards are remembered for marking their duplicate receipt. */
export const SYNC_ANSWERED_TTL_MS = 3_600_000
export const SYNC_ANSWERED_CAP = 256

/**
 * #298: forwards whose final sync answer — the member's own reply, not a delivered/mailbox placeholder — was
 * fully written back to the CLI that sent them. That member's receipt for the same task, landing in that CLI's
 * mailbox unrefused, is marked a duplicate — never dropped. In memory only: after a restart the receipt arrives
 * unmarked, which is today's behaviour.
 */
export class SyncAnswered {
  private readonly rows = new Map<string, { handle: string; answeredBy: string; at: number }>()
  constructor(private readonly now: () => number = Date.now) {}
  note(taskId: string, handle: string, answeredBy: string): void {
    this.sweep()
    this.rows.delete(taskId)
    this.rows.set(taskId, { handle, answeredBy, at: this.now() })
    while (this.rows.size > SYNC_ANSWERED_CAP) this.rows.delete(this.rows.keys().next().value!)
  }
  /** True once for a task answered to exactly this handle by exactly this sender; the row is consumed. */
  take(taskId: string, handle: string, sender: string): boolean {
    this.sweep()
    const row = this.rows.get(taskId)
    if (row === undefined || row.handle !== handle || row.answeredBy !== sender) return false
    this.rows.delete(taskId)
    return true
  }
  private sweep(): void {
    const cutoff = this.now() - SYNC_ANSWERED_TTL_MS
    for (const [taskId, row] of this.rows) if (row.at <= cutoff) this.rows.delete(taskId)
  }
}

export function registerWireFaces(webServer: WebServer, d: WireDeps): void {
  const {
    ctx,
    logger,
    config,
    cliDeposits,
    canvasStore,
    canvasNameReserved,
    sessionNodes,
    joinedSessions,
    idempotencyStore,
    verifyOriginClaim,
    remoteCliProof,
    callerLinkedToThisHost,
    recordActivity,
    peerKeyAdmits,
    a2aCallerRefusal,
    a2aCallerAdmission,
    allowlistVersionNow,
    observeAuthorization,
    scanSessionLogList,
    readSessionLogTail,
    taskLedger,
    refuseIfFlooded,
    refuseIfQueueFull,
    settleAndAnnounce, waitForForwardBirth,
    session,
    resolveAgentForTeam,
    parseCanvasTeamName,
    canvasLiveAgent,
    wakeColdTeam,
    probeConsumption,
    sessionTeamOf,
    localSessionOfHandle,
    steerRelay, followupRelay, cancelQueuedTask,
    fromClause,
    sanitizeFromClause,
    armReceiptAutosend,
    eventCountOf,
    receiptExpectationOf,
    armAsyncNudge,
    liveAgent,
    callerIsAgent,
    selfRouteText,
    noWakeFaceText,
    archivedColdMatchText,
    noColdMatchText,
    routeIntoAgent,
  } = d
  const syncAnswered = new SyncAnswered()
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
            if (size > 16 * 1024) { send(413, JSON.stringify({ ok: false, error: 'payload too large' })); return }
            const rawBody = Buffer.concat(chunks)
            const body = JSON.parse(rawBody.toString('utf8')) as { op?: unknown; name?: unknown; id?: unknown; home?: unknown }
            const claim = await verifyOriginClaim(req, { rawBody })
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
            const rawId = typeof body.id === 'string' ? body.id : ''
            if (d.teamCanvasBound?.(name) === true) {
              recordActivity('in', 'fleet-canvas', claim.caller, false)
              send(200, JSON.stringify({ ok: false, error: '[superagent-team-canvas] a superagent team is changed only by its own host\'s owner' }))
              return
            }
            // gh#131: a peer names our sessions by handle — the session it names, for removal.
            // A bare handle may still infer for routing, never for deleting another stored slot.
            const provenOwn = rawId.endsWith('@' + d.ownCanvasFingerprint)
            const id = (provenOwn ? localSessionOfHandle(rawId) : undefined) ?? rawId
            let payload: { ok: boolean; members?: readonly string[]; removed?: boolean; error?: string }
            if (op === 'create') {
              const stored = canvasNameReserved(name) ? undefined : canvasStore.create(name)
              payload = stored === undefined ? { ok: false, error: 'invalid, roster-reserved name or team cap reached' } : { ok: true, members: canvasStore.membersOf(stored) }
            } else if (op === 'add-member') {
              // gh#131: a handle is stored as sent, even one of this host's own — the
              // local tiers read it as the session it names at route time.
              const memberValid = isRemoteMemberRef(rawId) ? validRemoteMemberRef(rawId) : rawId !== '' && (sessionNodes.has(rawId) || joinedSessions.has(rawId))
              if (!canvasStore.hasTeam(name) && canvasNameReserved(name)) payload = { ok: false, error: 'roster reserves this canvas name' }
              else if (name === '' || !memberValid) payload = { ok: false, error: 'name and a member (joined session id, or a zone-qualified remote team handle) are required' }
              else {
                // A peer may compose references, never decide this operator's CLI home pin.
                if (body.home !== undefined) payload = { ok: false, error: 'CLI home pins may only be set by this host local control route' }
                else {
                  const proof = await d.canvasMemberForWrite(rawId, undefined, claim.card)
                  const teamRefusal = proof.ok ? d.teamCanvasRefusal?.(name, proof.member) : undefined
                  if (!proof.ok) payload = proof
                  else if (teamRefusal !== undefined) payload = { ok: false, error: teamRefusal }
                  else { canvasStore.create(name); payload = { ok: canvasStore.addMember(name, proof.member, undefined, { ownerKey: proof.ownerKey }), members: canvasStore.membersOf(name) } }
                }
              }
            } else if (op === 'remove-member') {
              // Either shape may be stored (an older edit kept the handle): remove both (review of PR #151 P2-1).
              const removed = name !== '' && [...new Set([id, rawId])].map(each => canvasStore.removeMember(name, each)).some(Boolean)
              payload = { ok: removed, members: name !== '' ? canvasStore.membersOf(name) : undefined }
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
      // as delivery — a configured key (or #317 link key) must be presented here too.
      if (!await peerKeyAdmits(req)) {
        send(401, { ok: false, error: 'unauthorized: X-API-Key required (apiKey is configured)', code: -32000 })
        return
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
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body; if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('query body must be a JSON object') // #168: `null` read body.task_id in this 'end' callback → uncaught → host exit, no auth needed
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
        req.on('end', () => {
          void (async () => {
          if (overflowed) {
            if (!res.writableEnded && !res.headersSent) {
              const payload = JSON.stringify({ error: 'payload too large', code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
              res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
            }
            return
          }
          const rawBody = Buffer.concat(chunks)
          let body: {
            readonly team?: unknown
            readonly message?: unknown
            readonly context_id?: unknown
            readonly caller_session?: unknown
            readonly callback?: unknown
            readonly wait?: unknown
            readonly task_id?: unknown
            readonly cancel_task_id?: unknown
          }
          try {
            body = JSON.parse(rawBody.toString('utf8')) as typeof body; if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('direct body must be a JSON object') // #168: `null` read body.team in this async 'end' callback → unhandled rejection → host exit
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
          // #317: a link key admits only its own verified, body-bound peer.
          if (!await peerKeyAdmits(req, rawBody)) {
            const payload = JSON.stringify({ error: 'unauthorized: X-API-Key required on the delivery face (apiKey is configured)', code: -32000 })
            res.writeHead(401, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // #282 S2: our own `<canvas>@<fp8>` is our canvas; a foreign suffix stays for the forward walk.
          const ownerQualified = splitCanvasOwner(typeof body.team === 'string' ? body.team : '')
          const team = ownerQualified.owner !== undefined && ownerQualified.owner === d.ownCanvasFingerprint ? ownerQualified.team : typeof body.team === 'string' ? body.team : ''
          const message = typeof body.message === 'string' ? body.message : ''
          // Design v5 (D2): a route to the bound team canvas is admitted and mailed as one to the team's address; the
          // requester's own spelling is what the team answers on behalf of (review R1).
          const mailTeam = d.teamMailboxOf?.(team) ?? team
          const addressed = mailTeam !== team && typeof body.team === 'string' ? body.team : team
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
          // #114 S5: a caller-born id must be header-safe — refused before
          // admission, claim or steer, so nothing is booked under it.
          const idRefusal = taskIdRefusal(taskId)
          if (idRefusal !== undefined) {
            const payload = JSON.stringify({ error: idRefusal, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
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
          // Complete present-envelope validation before evaluating request admission.
          // The fully absent-envelope migration policy remains independent.
          const foreignCli = config.teamScopeRouting && CLI_HANDLE_RE.test(caller) && cliDeposits.get(caller) === undefined
          const envelopePresent=hasOriginClaimFields(req)
          const earlyClaim: OriginClaimResult = envelopePresent ? await completeInboundVerification(()=>verifyOriginClaim(req, { cli: true, rawBody })) : {ok:false,reason:'absent'}
          const memberClaim=/^[^/\s]+\/[0-9a-f]{8}(?:@[0-9a-f]{8})?$/.test(caller)||caller===config.team||caller.startsWith(config.team+'/')||canvasStore.list().some(name=>canvasStore.rawMembersOf(name).some(ref=>ref===caller||ref.startsWith(caller+'@')))||String(req.headers['x-a2a-caller']??'')===config.team
          const gate=verifiedInboundAdmission(earlyClaim,envelopePresent,memberClaim,key=>a2aCallerAdmission(caller,mailTeam,undefined,key))
          if(!gate.ok) {
            recordActivity('in',team,caller,false)
            const payload=JSON.stringify({error:'untrusted-origin: OriginClaim verification failed ('+gate.reason+')',code:WIRE_ERROR_INBOUND_VERIFICATION,reason:gate.reason,team,task_status:'TASK_STATE_FAILED',delivered:false})
            res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
          }
          const priorFingerprint=peerPayloadFingerprint({caller,message,noWait,team})
          const priorTransport=idempotencyStore.query(taskId,priorFingerprint)
          if(earlyClaim.ok&&priorTransport.found&&priorTransport.status==='completed'&&d.receiptReplayAllowed(message,caller,team,earlyClaim)) {
            const payload=JSON.stringify({routed:true,delivered:true,receipt:'none',team,task_id:taskId,task_status:'TASK_STATE_COMPLETED',note:'receipt delivery already confirmed'})
            res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
          }
          const cliProof = foreignCli && earlyClaim?.ok ? await remoteCliProof(caller, earlyClaim).catch(() => undefined) : undefined
          let admission = foreignCli ? a2aCallerAdmission(caller, mailTeam, cliProof, earlyClaim?.ok ? earlyClaim.card.publicKey : undefined) : gate.admission
          // #282 S3 (same team authorizes): a receipt for this host's own forward, to the CLI that sent it, from a
          // receiver frozen at birth on the selected peer's key — the owner's signed canvas is the return path.
          const echoed = !admission.ok && cliDeposits.get(team) !== undefined ? parseReceipt(message) : null
          if (echoed !== null) {
            // Verify first, so an unsigned or Sig2-only caller cannot hold the connection on an in-flight forward (#287 review P3);
            // then a body-bound receipt may beat the dispatch's HTTP answer: wait for this forward's row to be born (#287 P2).
            const receiptClaim = earlyClaim
            if (receiptClaim.ok && receiptClaim.bodyBound === true) await waitForForwardBirth(message)
            const basis = receiptClaim.ok ? d.forwardReceiptBasis(echoed.taskId, caller, team, receiptClaim) : undefined
            if (basis !== undefined) admission = { ok: true, via: 'peer-org', rule: 'peer-org', basis: [basis] }
          }
          // Design v5 (v5-B2): a superagent team answers this host's own request from its process face, on its canvas's
          // behalf — admitted for that request's receipt alone (teamReceiptBasis), whatever the target session's links.
          const teamAnswer = !admission.ok && echoed === null && earlyClaim.ok ? parseReceipt(message) : null
          if (teamAnswer !== null && earlyClaim.ok) {
            const basis = d.teamReceiptBasis?.(teamAnswer.taskId, caller, team, teamAnswer.envelope?.onBehalfOf, earlyClaim)
            if (basis !== undefined) admission = { ok: true, via: 'peer-org', rule: 'peer-org', basis: [basis] }
          }
          // Owner ruling 2026-11-14 (option B): a request (never a receipt) from a session on a linked host to a superagent
          // team's canvas address passes the host gate; whether the team takes it is the team owner's decision (M12 card).
          if (!admission.ok && echoed === null && teamAnswer === null && earlyClaim.ok && parseReceipt(message) === null) {
            // The canvas address the caller named (a superagent team's mailbox is its own handle: `mailTeam` is not it).
            const basis = await d.superagentIntakeBasis?.(team, caller, earlyClaim).catch(() => undefined)
            if (basis !== undefined) admission = { ok: true, via: 'peer-org', rule: 'superagent-intake', basis: [basis] }
          }
          const callerRefusal = refusalOf(admission)
          if (callerRefusal !== undefined || !admission.ok) {
            recordActivity('in', team, caller === '' ? 'anonymous' : caller, false)
            const next = nextOf(admission)
            const payload = JSON.stringify({ error: callerRefusal, code: -32000, team, task_status: 'TASK_STATE_FAILED', ...(next !== undefined ? { next } : {}) })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          const routerRefusal = d.superagentInbound(team) ?? d.teamAddressRefusal?.(team, message)
          if (routerRefusal !== undefined) {
            recordActivity('in', team, caller, false)
            const payload = JSON.stringify({ error: routerRefusal, code: -32000, team, task_status: 'TASK_STATE_FAILED' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // #114 S6: a version an inbound record is born under is always in the history.
          observeAuthorization('lazy')
          // #114 S2: the version is read at admission time, beside the decision it explains.
          const admittedAt = { version: allowlistVersionNow(), at: Date.now() }
          // gh#9+gh#10 OriginClaim on the delivery face (M1): an envelope
          // that is present but unverifiable rejects untrusted-origin; an
          // ABSENT envelope during the window walks on with a counted
          // legacyInbound warn (the operator watches the tail drain), and
          // after the window closes it rejects like a failed signature —
          // N3 proves a NAME's linkability, never key possession.
          // gh#133: the delivery face is where a deposited CLI identity signs its routes.
          const claim = earlyClaim
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
          // A verified claim proves the caller only when its signed zone covers it (review of PR #134 P1),
          // and the host face only when it was signed from this very host (round 2: a zone name is not an origin).
          const callerProof: AuthProof = !claim.ok ? 'legacy-window'
            : admission.rule === 'remote-ref-cli' ? 'origin-claim'
              : claim.cli === true ? (claimCovers(caller, claim.caller) ? 'cli-identity' : 'claim-mismatch')
              : claim.bound !== true ? 'unbound'
                : !isRootOriginUrl(claim.callerUrl) ? 'claim-mismatch'
                  : admission.rule === 'host-face' && originOf(claim.callerUrl) !== originOf(d.ownCardUrl) ? 'claim-mismatch'
                    : claimCovers(caller, claim.caller) ? 'origin-claim' : 'claim-mismatch'
          const proofClause = callerProof === 'origin-claim' && claim.ok ? `已验证来源 ${originOf(claim.callerUrl)}`
            : callerProof === 'cli-identity' ? '未验证（cli-identity）' : `未验证（${callerProof}）`
          const directHeader = (from: string): string => `[A2A direct] (task ${taskId}) ${proofClause} ${sanitizeFromClause(from)} (routed to ${team}) sent:`
          if (refuseIfBudgetExhausted(req, res, team, caller, taskId, taskLedger)) return
          // Server-side idempotency (P3/B3): one key, one execution inside
          // the window. Same key + same payload ⇒ replay; different payload
          // ⇒ hard conflict (both 409). A replay must never re-enter the
          // target session, no matter how it settles.
          const idemFingerprint = peerPayloadFingerprint({ caller, message, noWait, team })
          const priorDelivery=taskLedger.deliveryFor(taskId)
          if(taskLedger.orphanDelivery(taskId)&&priorDelivery?.callerKey===(claim.ok?claim.card.publicKey:undefined)&&idempotencyStore.query(taskId,idemFingerprint).found){
            const payload=JSON.stringify({routed:true,delivered:true,team,task_id:taskId,context_id:contextId,task_status:'TASK_STATE_DELIVERED',receipt:'routed',receiverBookkeeping:'failed',note:ADMITTED_BOOKKEEPING_NOTE})
            res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
          }
          if(priorDelivery?.state==='reserved'&&priorDelivery.callerKey===(claim.ok?claim.card.publicKey:undefined)&&idempotencyStore.query(taskId,idemFingerprint).found){
            const payload=JSON.stringify({error:ACCEPTANCE_UNKNOWN_NOTE,acceptance:'unknown',task_id:taskId,task_status:'TASK_STATE_FAILED',code:-32000})
            res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
          }
          const idemVerdict = idempotencyStore.claim(taskId, idemFingerprint)
          if (idemVerdict !== 'fresh') {
            const replay = idemVerdict === 'replay'
            // p1-mailbox-owes (S33, b): the original caller's same-payload resend of a task an owing deposit still owes
            // reads as the first answer did — delivered, with the mailbox marker — so a caller whose first answer was lost
            // books the debt now. Nothing is written again: no second mailbox row, no second inbound row, no second slot.
            // Anyone else gets the ordinary 409 (the fingerprint binds the caller too; this check holds should that change).
            const stillOwed = replay && cliDeposits.owes(mailTeam) ? taskLedger.find(taskId) : undefined
            if (stillOwed !== undefined && stillOwed.direction === 'inbound' && stillOwed.status === 'pending' && stillOwed.team === addressed && stillOwed.peer === `local:${caller}`) {
              const payload = JSON.stringify({ routed: true, delivered: true, receipt: 'mailbox', team, task_id: taskId, context_id: stillOwed.contextId ?? contextId, task_status: 'TASK_STATE_DELIVERED', note: `delivered to the mailbox of ${team} — it owes a receipt` })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
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
          if (body.cancel_task_id !== undefined) {
            const cancelledId=typeof body.cancel_task_id==='string'?body.cancel_task_id:''
            const original=taskLedger.find(cancelledId),originalClaim=original?.auth?.claim
            const allowed=claim.ok&&claim.bodyBound===true&&callerProof==='origin-claim'&&original?.direction==='inbound'&&original.auth?.caller===caller&&originalClaim?.caller===claim.caller&&originalClaim.origin===originOf(claim.callerUrl)&&taskLedger.deliveryFor(cancelledId)?.callerKey===claim.card.publicKey
            if(!allowed) {res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'cancellation does not match the original authenticated caller',task_status:'TASK_STATE_FAILED'}));return}
            taskLedger.cancel(cancelledId,'authenticated caller stop notice')
            let removed=false,steered=false
            try {const notification=await cancelQueuedTask(cancelledId,message,caller,original);removed=notification.removed;steered=notification.steered}catch(error){logger.warn('a2a: cancellation committed; stop notice was best-effort: %s',String(error))}
            const payload=JSON.stringify({routed:true,delivered:true,removed,steered,receipt:'none',team,task_id:taskId,task_status:'TASK_STATE_COMPLETED',result:{text:'cancellation admitted for original task'}})
            res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
          }
          if (refuseIfFlooded(caller, message, team, taskId, res)) return
          // p1-mailbox-owes (S33): a deposit whose card declares it owes receipts is under the per-target cap like a session.
          if (refuseIfQueueFull(caller, message, team, taskId, (cliDeposits.get(mailTeam) !== undefined && !cliDeposits.owes(mailTeam)) || d.superagentIntake(mailTeam), res)) return
          // The caller-side receipt correlation: a message shaped as a
          // receipt resolves the task it echoes, whichever wait semantics
          // carried it here. Correlation is bookkeeping only — the message
          // steers on exactly as before.
          // #114 S4: the settler is this delivery's caller, as proven here. A CLI identity's claim URL
          // is not a host's origin (its origin is unconstrained), so it never vouches for one (review of PR #140 P1-2).
          // #139: the claim's card key names the host whatever address spelling it signed with.
          // The response can race a fast peer receipt. Wait for this exact forwarding birth before judging or acknowledging it.
          await waitForForwardBirth(message)
          let refusedSettlement: SettlementRefusal | undefined
          try {
            refusedSettlement = settleAndAnnounce(message, { caller, proof: callerProof, ...settlerClaimFields(claim, originOf), ingress: 'wire' })
          } catch {
            // A failed receipt settlement did not deliver: keep its fixed transport identity retryable.
            if(parseReceipt(message)!==null)idempotencyStore.releaseUncompleted(taskId,idemFingerprint)
            // Body end runs outside the webServer guard; a failed commit must not escape or steer.
            const payload = JSON.stringify({ error: 'task ledger write failed; settlement was not committed', code: -32000, task_id: taskId, task_status: 'TASK_STATE_FAILED', delivered: false })
            res.writeHead(503, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // #139 (design §4.4): every answer this delivery gets carries the refusal.
          if (refusedSettlement !== undefined) withSettlementField(res, refusedSettlement)
          // A request sent from the team tab is the person's: its receipt settles above and goes to the tab, not to the
          // session it went out as (owner ruling 2026-11-13: a sidebar send must not turn into a new message that wakes it).
          if (d.sidebarReceipt?.(mailTeam, message, caller, refusedSettlement === undefined) === true) {
            recordActivity('in', team, caller, true)
            const note = `received for the team tab of ${team}`
            idempotencyStore.recordOutcome(taskId, { status: 'completed', reply: note })
            const payload = JSON.stringify({ routed: true, delivered: true, receipt: 'sidebar', team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_COMPLETED', note })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // gh#45 CLI mailbox (wire face): a delivery targeting a DEPOSITED
          // CLI handle never resolves a session and never wakes — it lands
          // in the deposit's mailbox and answers delivered. Placement here
          // keeps the idempotency claim (above) exactly as for sessions.
          const cliRow = cliDeposits.get(mailTeam)
          if (cliRow !== undefined) {
            const answered = parseReceipt(message)
            // #298: only the answering member's own, unrefused receipt is the duplicate of a sync answer.
            const duplicate = answered !== null && refusedSettlement === undefined && syncAnswered.take(answered.taskId, mailTeam, caller)
            const evicted = cliDeposits.mail(mailTeam, caller, `${directHeader(caller)}\n\n${message}`, duplicate ? 'sync-answered' : undefined, { taskId, contextId, proof: callerProof, ...(answered !== null ? { receiptFor: answered.taskId } : {}), ...(answered?.envelope?.disposition !== undefined ? { disposition: answered.envelope.disposition } : {}),
              // p1-mail-admission: the rule this host matched when it took the delivery, as it already computed it.
              ...(admission.ok ? { admission: admission.rule } : {}) })
            // p1-mailbox-owes (D-5): a row the cap pushed out takes its owed inbound row with it (slot freed, counted as evicted).
            for (const gone of evicted) if (gone.task_id !== undefined) taskLedger.evictInbound(gone.task_id, taskLedger.find(gone.task_id)?.team ?? mailTeam)
            recordActivity('in', team, caller, true)
            logger.info(`a2a: cli mailbox delivery for ${mailTeam} (from ${caller}${mailTeam !== team ? `, addressed to ${addressed}` : ''})`)
            if (answered === null && cliDeposits.owes(mailTeam)) {
              // p1-mailbox-owes (S33, D-2): delivered, not final — the caller books a debt, this host keeps the owed
              // inbound row (the per-target cap counts it) and records no outcome, so a resend reads pending.
              taskLedger.trackInbound(taskId, addressed, caller, contextId === '' ? undefined : contextId, true, briefOf(message))
              // Design v5 (R5): a sync route to the team answers at once — the team works asynchronously.
              if (mailTeam !== team) {
                const teamPayload = JSON.stringify({ routed: true, delivered: true, receipt: 'mailbox', team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_DELIVERED', note: `delivered to the superagent team ${addressed} — it works asynchronously; its result arrives as this task's receipt` })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(teamPayload) })
                res.end(teamPayload)
                return
              }
              const payload = JSON.stringify({ routed: true, delivered: true, receipt: 'mailbox', team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_DELIVERED', note: `delivered to the mailbox of ${team} — it owes a receipt` })
              res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
              res.end(payload)
              return
            }
            const note = `delivered to the mailbox of ${team} — the CLI polls while online`
            // gh#112 review: a mailbox delivery is final from this host's
            // side, so a resend of this id reads `completed`. A receipt the
            // CLI routes back later still reaches its caller, but does not
            // replace this outcome (recordOutcome is first-writer-wins).
            idempotencyStore.recordOutcome(taskId, { status: 'completed', reply: note })
            // p1-context-read: name the conversation the row was mailed under, as every other taken reply does.
            const payload = JSON.stringify({ routed: true, delivered: true, receipt: 'mailbox', team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_COMPLETED', note })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
            return
          }
          // Inbound routing is foreground demand: boot prewarm yields for a
          // quiet window around it.
          d.touchWakeDemand()
          const forwardMiss = async (original: string): Promise<void> => {
            // #282 S2 review P1: forward with the id the caller sent — our own `@fp8` must find no other owner.
            const result = await d.forwardDirect({ team: typeof body.team === 'string' && ownerQualified.owner !== undefined ? body.team : team, message, caller, taskId, contextId, noWait,
              auth: buildAuthorization(admission, { caller, proof: callerProof, ...(claim.ok ? { claim: { caller: claim.caller, origin: originOf(claim.callerUrl) } } : {}), ingress: 'wire', allowlistVersion: admittedAt.version, target: team, receiptTarget: caller, receivedAt: admittedAt.at }),
              localCliProof: claim.ok && claim.cli === true && claim.bound && claim.caller === caller, guarded: req.headers['x-a2a-guard'] !== undefined }).catch((error: unknown): A2aRouteResult => ({ ok: false, error: `forwarding unavailable: ${String(error)}`, code: -32000, task_id: taskId }))
            const failure = result.ok ? '' : result.acceptance==='unknown'?ACCEPTANCE_UNKNOWN_NOTE:await d.diagnoseCanvas(team, original + ' — ' + result.error, claim.ok && claim.cli === true && claim.bound && claim.caller === caller ? caller : undefined)
            if (!result.ok && result.code !== -32005 && result.acceptance!=='unknown') idempotencyStore.recordOutcome(taskId, { status: 'failed', error: failure })
            else if (result.ok && result.task_status === 'TASK_STATE_COMPLETED') idempotencyStore.recordOutcome(taskId, { status: 'completed', reply: result.reply })
            const payload = JSON.stringify(result.ok ? { routed: true, ...(result.task_status === 'TASK_STATE_DELIVERED' ? { delivered: true } : { result: { text: result.reply } }), team, task_id: taskId, context_id: contextId, task_status: result.task_status, acceptance:result.acceptance,consumed: result.consumed, bridge: result.bridge, receipt: result.receipt, ...(result.receiverBookkeeping==='failed'?{receiverBookkeeping:'failed',note:ADMITTED_BOOKKEEPING_NOTE}:{}), forwarded: true } : { acceptance:result.acceptance,error: failure, code: result.code ?? -32000, receipt: result.receipt, task_id: taskId, team, task_status: result.code === -32005 ? 'TASK_STATE_DELIVERED' : 'TASK_STATE_FAILED', ...(result.next !== undefined ? { next: result.next } : {}) })
            // #298: only a reply the peer itself declares final (`reply_final`; never a host placeholder, review of
            // #305 F3), handed to the CLI in full, marks that member's later receipt a duplicate — never a delivered,
            // mailbox or bridge shape (F1), and never when the CLI gave up and closed the socket ('finish' does not fire).
            const answeredBy = result.ok ? result.deliveredTo : undefined
            if (!noWait && result.ok && result.replyFinal === true && result.task_status === 'TASK_STATE_COMPLETED' && result.receipt === undefined && result.bridge === undefined && answeredBy !== undefined
              && claim.ok && claim.cli === true && claim.bound && claim.caller === caller && cliDeposits.get(caller) !== undefined) res.once('finish', () => syncAnswered.note(taskId, caller, answeredBy))
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload)
          }
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
                // #114 S5: the receipt's consumption search starts here, so an
                // older steer of a reused id in the history never anchors it.
                const steerFloor = eventCountOf(target)
                const deliveredReceipt = parseReceipt(message) !== null
                // gh#141: a receipt is answered by nobody — its steer asks for no receipt back.
                const receiptRequest = deliveredReceipt ? '' : `\n\n(When done, route your outcome back with one call — a2a_route { team: "${receiptTarget}", message: "[A2A receipt] task ${taskId} <one-line outcome>" }.)`
                d.keepTaskBody?.(taskId, target, from, message)
                const acceptance=followupRelay(target, `${directHeader(from)}\n\n${message}${receiptRequest}`, from === 'an unknown node' ? undefined : from, undefined, taskId, claim.ok?claim.card.publicKey:undefined, !deliveredReceipt)
                steered = true
                if(deliveredReceipt&&refusedSettlement===undefined)idempotencyStore.recordOutcome(taskId,{status:'completed',reply:'receipt delivered'})
                recordActivity('in', team, caller, true)
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
                const consumedProbe = acceptance==='inserted'?false:taskLedger.deliveryFor(taskId)?.state === 'claimed'
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
                  proof: callerProof,
                  ...(claim.ok ? { claim: { caller: claim.caller, origin: originOf(claim.callerUrl) } } : {}),
                  ...(admission.rule === 'remote-ref-cli' && claim.ok ? { carrierUrl: originOf(claim.callerUrl) } : {}),
                  ingress: 'wire',
                  allowlistVersion: admittedAt.version,
                  target: team,
                  receiptTarget,
                  receivedAt: admittedAt.at,
                  // Audit only: a cold session's activation window also reads as running.
                  targetBusy: runningBeforeSteer,
                })
                // #139: the member that actually received it answers for a canvas or bare-zone team.
                const deliveredTo = sessionTeamOf(target)
                // gh#141: a receipt owes no receipt — it is settlement traffic,
                // recorded on the row it settled. Booking it would leave a debt
                // nothing can pay, and a nudge chasing an answer nobody owes.
                if (!deliveredReceipt) {
                  taskLedger.trackInbound(taskId, team, receiptTarget, contextId === '' ? undefined : contextId, receiptExpectation !== 'process-label', briefOf(message), auth, deliveredTo === team ? undefined : deliveredTo, String(target.id), consumedProbe)
                  if(acceptance!=='inserted')armReceiptAutosend(target, taskId, receiptTarget, message, steerFloor)
                  if(acceptance!=='inserted')armAsyncNudge(target, team, taskId, config.asyncNudgeDelayMs)
                }
                const payload = JSON.stringify({
                  routed: true,
                  delivered: true,
                  team,
                  session,
                  task_id: taskId,
                  context_id: contextId,
                  task_status: 'TASK_STATE_DELIVERED',
                  artifacts: [],
                  ...(acceptance==='inserted'?{acceptance,note:ACCEPTANCE_INSERTED_NOTE}:{}),
                  consumed: consumedProbe,
                  ...(req.headers['x-a2a-guard'] !== undefined ? { delivered_to: deliveredTo } : {}),
                  receipt: receiptExpectation === 'process-label' || deliveredReceipt ? 'none' : 'routed',
                })
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
                res.end(payload)
              } catch (error) {
                if(error instanceof FollowupAcceptanceUnknown){
                  const payload=JSON.stringify({error:ACCEPTANCE_UNKNOWN_NOTE,acceptance:'unknown',task_id:taskId,team,task_status:'TASK_STATE_FAILED',code:-32000})
                  res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
                }
                if(error instanceof AdmittedBookkeepingError)steered=true
                if (!steered) { refuseNoWait(`The DSH session rejected the message: ${String(error)}`); return }
                if(!(error instanceof AdmittedBookkeepingError))taskLedger.noteAdmittedBookkeepingFailure(error)
                logger.warn('a2a: admitted task bookkeeping failed; reconcile original delivery')
                if (!res.headersSent) {
                  const payload = JSON.stringify({ routed: true, delivered: true, team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_DELIVERED', artifacts: [], consumed: false, receipt: 'routed',receiverBookkeeping:'failed',note:ADMITTED_BOOKKEEPING_NOTE })
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
            {
              const standardMiss = async (): Promise<void> => {
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
                if (wake?.kind === 'no-match') { await forwardMiss(noColdMatchText(team)); return }
                refuseNoWait(wake?.kind === 'no-face' ? noWakeFaceText(team) : wake?.kind === 'archived' ? archivedColdMatchText(team) : noColdMatchText(team), false)
              }
              await standardMiss()
            }
            return
          }
          let syncTarget: string | undefined
          // A forwarded synchronous delivery still owes its automatic receipt after the HTTP waiter expires.
          const syncSteered = req.headers['x-a2a-guard'] === undefined || parseReceipt(message) !== null ? undefined : (target: Agent, floor: number,acceptance?:'inserted'|void): void => {
            syncTarget = sessionTeamOf(target)
            const receiptTarget = callback !== '' ? callback : caller
            const auth = buildAuthorization(admission, { caller, proof: callerProof, ...(claim.ok ? { claim: { caller: claim.caller, origin: originOf(claim.callerUrl) } } : {}), ...(admission.rule === 'remote-ref-cli' && claim.ok ? { carrierUrl: originOf(claim.callerUrl) } : {}), ingress: 'wire', allowlistVersion: admittedAt.version, target: team, receiptTarget, receivedAt: admittedAt.at })
            try{taskLedger.trackInbound(taskId, team, receiptTarget, contextId, receiptExpectationOf(receiptTarget) !== 'process-label', briefOf(message), auth, syncTarget === team ? undefined : syncTarget, String(target.id), acceptance==='inserted'?false:taskLedger.deliveryFor(taskId)?.state==='claimed')}catch(error){taskLedger.noteAdmittedBookkeepingFailure(error);throw new AdmittedBookkeepingError(error)}
            if(acceptance!=='inserted')armReceiptAutosend(target, taskId, receiptTarget, message, floor)
          }
          await routeIntoAgent(team, message, caller, taskId, proofClause, directHeader, undefined, syncSteered, claim.ok?claim.card.publicKey:undefined).then(async (outcome) => {
            if(outcome.ok&&outcome.receiverBookkeeping==='failed'){
              const payload=JSON.stringify({routed:true,delivered:true,team,task_id:taskId,context_id:contextId,task_status:'TASK_STATE_DELIVERED',receipt:'routed',receiverBookkeeping:'failed',note:ADMITTED_BOOKKEEPING_NOTE})
              res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);return
            }
            if (!outcome.ok && outcome.localMiss) { await forwardMiss(outcome.error); return }
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
              if (!outcome.ok&&outcome.acceptance!=='unknown') {
                idempotencyStore.recordOutcome(taskId, { status: 'failed', error: outcome.error })
              } else if (!outcome.ok||outcome.placeholder === true) {
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
                ...(outcome.acceptance==='inserted'?{acceptance:'inserted',delivered:true,note:ACCEPTANCE_INSERTED_NOTE,consumed:false}:{}),
                result: { text: outcome.reply },
                ...(syncTarget !== undefined ? { delivered_to: syncTarget } : {}),
                // #298: a positive, cross-host statement that this text is the member's own final reply — the turn
                // that read this task's steer (`ownTurn`), never a placeholder or another turn (#305 F3/F4).
                ...(outcome.ownTurn === true && outcome.placeholder !== true && (outcome.status ?? 'TASK_STATE_COMPLETED') === 'TASK_STATE_COMPLETED' ? { reply_final: true } : {}),
                task_id: taskId,
                context_id: contextId,
                task_status: outcome.placeholder===true||(outcome.ownTurn!==true&&outcome.status===undefined)?'TASK_STATE_DELIVERED':outcome.status??'TASK_STATE_COMPLETED',
                ...(outcome.placeholder===true||outcome.ownTurn!==true?{receipt:syncTarget===undefined?'none':'routed'}:{}),
                artifacts: [],
              })
              : JSON.stringify({ ...(outcome.acceptance==='unknown'?{acceptance:'unknown'}:{}),error: outcome.error, code: -32000, team, task_id: taskId, task_status: 'TASK_STATE_FAILED' })
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          })
          })().catch(error => {
            // EventEmitter ignores promises returned from body-end callbacks. Own this boundary.
            logger.warn('a2a: direct request callback failed: %s', String(error))
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'direct request failed before confirmation', code: -32000, task_status: 'TASK_STATE_FAILED' }))
            } else if (!res.writableEnded) res.end()
          })
        })
      },
    }), 'a2a: direct route endpoint')
}
