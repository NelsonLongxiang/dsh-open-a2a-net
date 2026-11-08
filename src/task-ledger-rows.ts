/** Stateless ledger row types, classifiers and restore projections; moved verbatim for #258. */
import { parseAuthorization, type AuthProof, type ChainRole, type SettlementReason, type SettlementVerdict, type TaskAuthorization } from './task-auth.ts'
import type { ReceiptDisposition, ReceiptOutcomeV2 } from './receipt.ts'
import type { ConservationSnapshot } from './ledger-conservation.ts'

/**
 * Caller-ended summaries (abandon / cancel) share one isolation law: late
 * receipts never rewrite the verdict — they only stamp lateReceiptAt, and
 * the projected outcome collapses to 'abandoned'.
 */
export const CALLER_ENDED_PREFIX = /^caller-(abandoned|cancelled)/

/** Hard cap on the owed book (pending + dead-lettered rows, most recent first). */
export const TASK_CAP = 64

/** Hard cap on the settled archive (most recent kept). */
export const ARCHIVE_CAP = 64

/** Longest receipt summary kept on a record (multi-line outcomes collapse). */
export const SUMMARY_CAP = 200

/**
 * Longest dispatch brief kept per row. A ledger row without its payload is
 * unreadable to supervision — "direct-8f3a1c2b → dsh/ec4ce7f8, 3h old" says
 * nothing about whether to nudge, abandon, or read the receipt. The brief is
 * the first non-empty line of the message, capped; the full body never enters
 * the ledger (it can be arbitrarily large and may quote another session's log).
 */
export const BRIEF_CAP = 120

/** Reduce a dispatch body to one readable line: first non-empty line, collapsed, capped. */
export function briefOf(message: string | undefined): string | undefined {
  if (message === undefined) return undefined
  for (const raw of message.split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (line !== '') return line.length <= BRIEF_CAP ? line : `${line.slice(0, BRIEF_CAP - 1)}…`
  }
  return undefined
}

/**
 * Age at which an unsettled task auto-dead-letters. A dead row exits the
 * owed view, disarms its async-nudge retry (a cold session cannot consume a
 * re-steer anyway), and still accepts a late receipt from a revived target.
 * Injectable per instance so tests can use short windows; sweeping stays
 * lazy — every read/write entry point sweeps first.
 */
export const TASK_STALE_TTL_MS = 24 * 60 * 60_000
/** How long a row its target acknowledged stays owed past its acknowledgement before it dead-letters (7 days). */
export const TASK_ACKNOWLEDGED_TTL_MS = 7 * 24 * 60 * 60_000

/**
 * The receipt correlation template now lives in `receipt.ts` (shared codec
 * for header + v2 envelope line). This ledger consumes `parseReceipt` so
 * human summaries and machine projections can never drift apart again.
 */

/** Lifecycle of a tracked outbound task inside the owed book. */
export type TaskStatus = 'pending' | 'dead'

/** F5 layer-3: why a dead row aged out (stamped by the sweep at flip time). */
export type DeadReason = 'fire-forget' | 'unconsumed'

/** gh#31: which archive path ended a row — a receipt, a content echo, or the caller. */
export type ArchiveEnd = 'receipt' | 'echo' | 'abandoned' | 'cancelled' | 'evicted'

export const ARCHIVE_ENDS: readonly string[] = ['receipt', 'echo', 'abandoned', 'cancelled', 'evicted']

/** Summary marker {@link TaskLedger.resolveEcho} writes on echo-settled rows. */
export const ECHO_SUMMARY = '(settled by content echo)'

/**
 * #114 S3: who really sent one outbound task — the routing session, the
 * agent-less host face, or a native-teams bridge submitter. Before this
 * field every outbound row was attributable only to the host ("home"), so
 * same-host seats could not be told apart.
 */
export interface Sender {
  readonly kind: 'session' | 'host' | 'bridge' | 'cli'
  /**
   * A session's `<zone>/<id8>` node team, the host process label, or the
   * bridge submitter. Group senders by `kind:id`, never by `id` alone: a host
   * label set by hand may look like a session handle.
   */
  readonly id: string
  /**
   * Host senders only: the label the call borrowed on the wire when it
   * differs from {@link id} (quick dispatch rides a live joined session's
   * team). Display context, never a bucket key.
   */
  readonly face?: string
}

const SENDER_KINDS: readonly string[] = ['session', 'host', 'bridge', 'cli']

/** Longest sender id kept; anything longer is malformed, not truncated. */
export const SENDER_ID_CAP = 256

/**
 * Restore-side allowlist for one persisted sender: a well-formed value comes
 * back as a fresh object holding only kind, id and (when present) face; anything else is dropped whole (the row
 * itself survives — a bad sender never costs the debt record).
 * @param raw - the persisted value.
 * @returns the sender, or undefined when absent or malformed.
 */
export function parseSender(raw: unknown): Sender | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { kind, id, face } = raw as Record<string, unknown>
  if (typeof kind !== 'string' || !SENDER_KINDS.includes(kind)) return undefined
  if (typeof id !== 'string' || id === '' || id.length > SENDER_ID_CAP) return undefined
  if (face !== undefined && (typeof face !== 'string' || face === '' || face.length > SENDER_ID_CAP)) return undefined
  // `face` belongs to host senders only; on any other kind it is dropped, the sender kept.
  return { kind: kind as Sender['kind'], id, ...(face !== undefined && kind === 'host' ? { face } : {}) }
}

/**
 * Spread helper for restore: `{ sender }` when the persisted value parses and
 * the row is not inbound (an inbound row's originator is its caller, never a
 * sender this host recorded), else nothing.
 */
export function withSender(raw: unknown, direction: unknown): { sender?: Sender } {
  if (direction === 'inbound') return {}
  const sender = parseSender(raw)
  return sender === undefined ? {} : { sender }
}

/**
 * #114 S2: `{ auth }` when a persisted INBOUND row carries a record that
 * parses whole (parseAuthorization) and belongs to THIS row — its target is
 * the row's team and its receipt target the row's peer — else nothing: the
 * row survives as a pre-S2 row, never with a partially adopted or borrowed
 * record.
 */
export function withAuth(raw: unknown, entry: { direction?: unknown; team?: unknown; peer?: unknown; forwarded?: unknown; sender?: unknown }, now: number): { auth?: TaskAuthorization } {
  if (entry.direction !== 'inbound' && entry.direction !== 'outbound') return {}
  const auth = parseAuthorization(raw, now)
  if (auth === undefined || auth.target !== entry.team) return {}
  if (entry.direction === 'inbound') return auth.ingress === 'wire' && `local:${auth.receipt_target}` === entry.peer ? { auth } : {}
  // Forwarded births retain the verified local CLI wire admission for audit, never borrowed remote authority.
  if (entry.forwarded === true && typeof entry.peer === 'string' && !entry.peer.startsWith('local')) {
    const sender = parseSender(entry.sender)
    return auth.ingress === 'wire' && auth.proof === 'cli-identity' && sender?.kind === 'cli' && sender.id === auth.caller && auth.receipt_target === auth.caller ? { auth } : {}
  }
  return auth.ingress === 'local' && entry.peer === 'local' ? { auth } : {}
}

/** Routing and answer facts copied unchanged between a row and its archive entry. */
export function routingOf(row: Pick<TaskRecord, 'peerKey' | 'peerHost' | 'deliveredTo' | 'forwarded' | 'answeredAt' | 'receiverMembers' | 'acknowledgedAt'>): Pick<TaskRecord, 'peerKey' | 'peerHost' | 'deliveredTo' | 'forwarded' | 'answeredAt' | 'receiverMembers' | 'acknowledgedAt'> {
  return {
    ...(row.acknowledgedAt !== undefined ? { acknowledgedAt: row.acknowledgedAt } : {}),
    ...(row.receiverMembers !== undefined ? { receiverMembers: [...row.receiverMembers] } : {}),
    ...(row.answeredAt !== undefined ? { answeredAt: row.answeredAt } : {}),
    ...(row.forwarded === true ? { forwarded: true as const } : {}),
    ...(row.peerKey !== undefined ? { peerKey: row.peerKey } : {}),
    ...(row.peerHost !== undefined ? { peerHost: row.peerHost } : {}),
    ...(row.deliveredTo !== undefined ? { deliveredTo: row.deliveredTo } : {}),
  }
}

/** #139: what an outbound row is born with besides its sender. */
export interface OutboundBirth {
  readonly consumed?: boolean
  /** Exact receiver selected at local delivery, never inferred from a later canvas roster. */
  readonly receiverSessionId?: string
  readonly forwarded?: true
  /** Local-candidate admission, or a forwarded online CLI's verified wire admission. */
  readonly auth?: TaskAuthorization
  readonly peerKey?: string
  readonly peerHost?: string
  readonly deliveredTo?: string
  /** Verified selected peer canvas membership at dispatch; actual deliveredTo remains stricter when available. */
  readonly receiverMembers?: readonly string[]
}

/** The facts of one outbound birth that fit the row (see {@link withRouting} for the same shape on restore). */
export function birthFacts(peer: string, birth: OutboundBirth | undefined, team = '', sender?: Sender, now = Date.now(), warn: (message: string) => void = console.warn): Pick<TaskRecord, 'auth' | 'peerKey' | 'peerHost' | 'deliveredTo' | 'forwarded' | 'receiverMembers' | 'receiverSessionId' | 'consumed'> {
  if (birth === undefined) return {}
  const fact = (v: string | undefined): v is string => v !== undefined && v !== '' && v.length <= ROUTING_FACT_CAP
  const remote = peer !== 'local' && !peer.startsWith('local:')
  const receiverMembers = remote && birth.forwarded === true && fact(birth.peerKey) ? parseReceiverMembers(birth.receiverMembers, warn) : undefined
  return {
    ...withAuth(birth.auth, { direction: 'outbound', team, peer, sender, forwarded: birth.forwarded }, now),
    ...(typeof birth.consumed==='boolean'?{consumed:birth.consumed}:{}),
    ...(peer === 'local' && fact(birth.receiverSessionId) ? { receiverSessionId: birth.receiverSessionId } : {}),
    ...(receiverMembers !== undefined ? { receiverMembers } : {}),
    ...(remote && birth.forwarded === true ? { forwarded: true as const } : {}),
    ...(remote && fact(birth.peerKey) ? { peerKey: birth.peerKey } : {}),
    ...(remote && fact(birth.peerHost) ? { peerHost: birth.peerHost } : {}),
    ...(fact(birth.deliveredTo) ? { deliveredTo: birth.deliveredTo } : {}),
  }
}

/** Bound on a persisted routing fact; anything longer (or empty, or not a string) is dropped on restore. */
export const ROUTING_FACT_CAP = 256
export function parseReceiverMembers(value: unknown, warn: (message: string) => void = console.warn): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) { warn('a2a: receiverMembers is not an array; ignored'); return undefined }
  const members = new Set<string>()
  if (value.length > 256) warn('a2a: receiverMembers exceeds 256 entries; tail ignored')
  for (const [index, member] of value.slice(0, 256).entries()) {
    if (typeof member !== 'string' || !new RegExp('^[a-z0-9-]+/[0-9a-f]{8}(?:[0-9a-f]{8})?$', 'i').test(member)) { warn('a2a: invalid receiverMembers entry at index ' + index + '; ignored'); continue }
    members.add(member)
  }
  return members.size === 0 ? undefined : Object.freeze([...members])
}

/**
 * #139: restore-side allowlist for the routing facts. Each is kept only in
 * its shape — a non-empty string within the cap — and the peer facts only on
 * a remote outbound row; anything else is dropped (the row survives as one
 * born before the fields, judged by current membership and origin).
 */
export function withRouting(entry: Record<string, unknown>, warn: (message: string) => void = console.warn): Pick<TaskRecord, 'peerKey' | 'peerHost' | 'deliveredTo' | 'forwarded' | 'answeredAt' | 'receiverMembers' | 'receiptDelivery' | 'acknowledgedAt'> {
  const fact = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= ROUTING_FACT_CAP
  const remoteOutbound = entry.direction === 'outbound' && typeof entry.peer === 'string' && entry.peer !== 'local' && !entry.peer.startsWith('local:')
  const receiverMembers = remoteOutbound && entry.forwarded === true && fact(entry.peerKey) ? parseReceiverMembers(entry.receiverMembers, warn) : undefined
  return {
    ...(typeof entry.answeredAt === 'number' && Number.isFinite(entry.answeredAt) && entry.answeredAt >= 0 ? { answeredAt: entry.answeredAt } : {}),
    ...(typeof entry.acknowledgedAt === 'number' && Number.isFinite(entry.acknowledgedAt) && entry.acknowledgedAt >= 0 ? { acknowledgedAt: entry.acknowledgedAt } : {}),
    ...(entry.receiptDelivery==='receipt-undelivered'?{receiptDelivery:'receipt-undelivered' as const}:{}),
    ...(receiverMembers !== undefined ? { receiverMembers } : {}),
    ...(remoteOutbound && entry.forwarded === true ? { forwarded: true as const } : {}),
    ...(remoteOutbound && fact(entry.peerKey) ? { peerKey: entry.peerKey } : {}),
    ...(remoteOutbound && fact(entry.peerHost) ? { peerHost: entry.peerHost } : {}),
    ...(fact(entry.deliveredTo) ? { deliveredTo: entry.deliveredTo } : {}),
  }
}

/** One tracked outbound task still in the owed book (unsettled). */
export interface TaskRecord {
  /** Local work answered, but successful receipt delivery is not confirmed; never a settlement. */
  receiptDelivery?: 'receipt-undelivered'
  /** Observation from exact inbox claim or peer response, never an acknowledgement. */
  consumed?: boolean
  readonly receiverSessionId?: string
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  /**
   * Which side of the wire this row serves: 'outbound' (this node sent and
   * awaits a receipt) or 'inbound' (this node received and owes one).
   * Absent on rows persisted before F2' — those are outbound by birth.
   */
  readonly direction?: 'inbound' | 'outbound'
  /**
   * F5: whether a receipt is actually owed. Absent ⇒ true (back-compat).
   * `false` marks fire-and-forget deliveries — the caller's label could not
   * receive a receipt at dispatch (process-form label), so no debt was born
   * and supervision must not chase this row.
   */
  readonly receiptExpected?: boolean
  /** The conversation the delivery steered, for follow-up routes. */
  readonly contextId?: string
  /**
   * Head of the dispatched message (first non-empty line, {@link BRIEF_CAP}).
   * What the row is ABOUT — the fact that makes the ledger readable without
   * replaying the conversation. Absent on rows persisted before this field.
   */
  readonly brief?: string
  /** #114 S3: the real sender of an outbound row (absent on inbound rows and rows persisted before the field). */
  readonly sender?: Sender
  /** Home host forwarded an online CLI request to a peer. */
  readonly forwarded?: true
  /**
   * #114 S2: the immutable authorization the row was born with — an inbound
   * row's wire admission, or (#139) an outbound row's local-candidate
   * admission (`ingress: 'local'`). Absent on remote outbound and older rows.
   */
  readonly auth?: TaskAuthorization
  /** #139: the public key of the peer card a remote outbound row was dispatched to. */
  readonly peerKey?: string
  /** #139: that card's session label (the peer host's process label). */
  readonly peerHost?: string
  /** #139: the member that actually received the task (canvas / bare-zone deliveries). */
  readonly deliveredTo?: string
  /** Verified selected peer canvas membership at dispatch; actual deliveredTo remains stricter when available. */
  readonly receiverMembers?: readonly string[]
  /** Local target has produced an answer; still owed until receipt delivery/settlement, but no longer queued. */
  answeredAt?: number
  /** Its target acknowledged it (an `acknowledged` receipt): owed until the result, outside the queue count and the 24h TTL. */
  acknowledgedAt?: number
  status: TaskStatus
  /** When the row was swept to dead-letter (absent while pending). */
  deadAt?: number
  /**
   * F5 layer-3: why the row aged out. 'fire-forget' — a receiptExpected:false
   * row expiring is expected bookkeeping, not a failure; 'unconsumed' — a
   * receipt-owed row never settled, the actionable stale shape. Absent on
   * dead rows persisted before this field (rendered as 'unspecified').
   */
  reason?: DeadReason
}

export const WITHDRAWAL_RESULTS = ['removed','claimed-steered','withdraw-failed-steered','no-agent'] as const
export type WithdrawalResult = typeof WITHDRAWAL_RESULTS[number]
export function isWithdrawalResult(value:unknown): value is WithdrawalResult { return typeof value==='string'&&(WITHDRAWAL_RESULTS as readonly string[]).includes(value) }

/** One settled task kept for audit, with its receipt-correlated outcome. */
export interface ArchivedRecord {
  /** Cancellation notification observation; independent of the terminal task outcome. */
  readonly withdrawalResult?: WithdrawalResult
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  readonly contextId?: string
  readonly resolvedAt: number
  readonly summary?: string
  /** Head of the dispatched message that this row settled (see {@link TaskRecord.brief}). */
  readonly brief?: string
  /** Controlled vocabulary verdict when the settling receipt carried a v2 envelope; forced 'abandoned' for caller-abandoned rows. */
  readonly outcome?: ReceiptOutcomeV2 | 'abandoned'
  /**
   * p1-receipt-cmd (S14): result or attention, when the settling envelope said.
   * An attention row carries no outcome — it settled the task but did not complete it.
   */
  readonly disposition?: ReceiptDisposition
  /** Remote-turn wall-clock cost, when the settling envelope carried it. */
  readonly elapsedMs?: number
  /**
   * When a receipt arrived for an explicitly abandoned row ({@link TaskLedger.abandon}).
   * Orphan isolation: the abandonment outcome stays verbatim; the late answer is
   * recorded as metadata only, never promoted to resolution.
   */
  readonly lateReceiptAt?: number
  /**
   * gh#31: which archive path ended the row, recorded at archive time. Absent
   * on rows archived before the field — {@link archivedEndedBy} derives it.
   */
  readonly endedBy?: ArchiveEnd
  /** gh#31: which side of the wire the row served, copied from the owed row (absent on rows archived before the field). */
  readonly direction?: 'inbound' | 'outbound'
  /**
   * gh#68: copied from the owed row when it awaited no receipt, so a tidied
   * fire-forget expiry is not read as a send we gave up on. Only `false` is
   * ever stored; absent means a receipt was owed (or the row predates the field).
   */
  readonly receiptExpected?: false
  /** #114 S3: copied from the owed row (absent on inbound rows and rows archived before the field). */
  readonly sender?: Sender
  /** Home host forwarded an online CLI request to a peer. */
  readonly forwarded?: true
  /** #114 S2: carried over from the live row unchanged. */
  readonly auth?: TaskAuthorization
  /** #139: carried over from the live row unchanged (a late receipt is judged against them). */
  readonly peerKey?: string
  readonly peerHost?: string
  readonly deliveredTo?: string
  /** Verified selected peer canvas membership at dispatch; actual deliveredTo remains stricter when available. */
  readonly receiverMembers?: readonly string[]
  /** Local answer time retained as audit metadata, independent of resolution time. */
  readonly answeredAt?: number
  /** When its target acknowledged it before the result settled it. */
  readonly acknowledgedAt?: number
  /** #114 S4: who settled the row (receipt and echo ends), and their chain role. */
  readonly settledBy?: SettledBy
}

/**
 * How one archived row ended (gh#31). The recorded field wins; legacy rows
 * fall back to the summary markers this ledger writes itself. The fallback
 * reads a receipt-settled row's summary, which is the peer's text, so it is
 * only as exact as the legacy data allows.
 * @param row - the archived record.
 * @returns the archive path that ended it.
 */
export function archivedEndedBy(row: ArchivedRecord): ArchiveEnd {
  if (row.endedBy !== undefined) return row.endedBy
  const summary = row.summary ?? ''
  if (summary.startsWith('caller-cancelled')) return 'cancelled'
  if (summary.startsWith('caller-abandoned')) return 'abandoned'
  if (summary === ECHO_SUMMARY) return 'echo'
  return 'receipt'
}

/** Result of an explicit caller-side abandon. Total and never-thrown. */
export type AbandonOutcome = 'cleared' | 'already-terminal' | 'unknown'

/** Structured verdict for one {@link TaskLedger.abandon} call (consumer contract: idempotent). */
export interface AbandonResult {
  readonly outcome: AbandonOutcome
  readonly taskId: string
  /** Settle time: fresh abandonment's clock tick, or the already-settled row's original resolvedAt. */
  readonly archivedAt?: number
}

/** Result of a cooperative {@link TaskLedger.cancel}; adds routing facts for the notify half. */
export interface CancelledResult extends AbandonResult {
  /** Team the ended row addressed — the route layer reaches a live local target through it. */
  readonly team?: string
  readonly contextId?: string
}

/** Per-instance knobs; defaults come from the exported constants. */
export interface TaskLedgerOptions {
  /** Invalid persisted member entries are dropped individually and reported without their content. */
  warn?: (message: string) => void
  /** Stale-TTL override (tests inject short windows); defaults to {@link TASK_STALE_TTL_MS}. */
  staleTtlMs?: number
  /** TTL after an acknowledgement; defaults to {@link TASK_ACKNOWLEDGED_TTL_MS}. */
  acknowledgedTtlMs?: number
  /** Archive capacity override; defaults to {@link ARCHIVE_CAP}. */
  archiveCap?: number
  /**
   * Clock injection for tests: every sweep/TTL decision reads the time from
   * here. Defaults to Date.now. Injecting a steppable clock makes the stale
   * transition deterministic - no real sleeps to race under load.
   */
  now?: () => number
}

/**
 * What one correlated receipt settled — the payload of the
 * `a2a/receipt-resolved` event, emitted for consumers that react to receipt
 * arrivals (P2: a plugin can settle its outstanding async submissions from
 * this seam). `outcome` carries the v2 envelope's controlled-vocabulary
 * verdict when the receipt rode one; `late` marks a receipt answering a
 * dead-lettered row (revival) or an abandoned row (arrival recorded) — a
 * healthy row's duplicate receipt refreshes the archive with NO marker.
 */
export interface ReceiptResolvedInfo {
  readonly taskId: string
  /** The team the task was routed to (as the dispatcher recorded it). */
  readonly team: string
  /** The peer (or `'local'`) the task was dispatched through. */
  readonly peer: string
  /** v2 envelope outcome, when the receipt rode one. */
  readonly outcome?: string
  /** p1-receipt-cmd: the envelope's disposition, when it carried one. */
  readonly disposition?: string
  /** One-line outcome summary, when the receipt carried one. */
  readonly summary?: string
  /** True when the receipt answered a dead-lettered or abandoned row. */
  readonly late?: boolean
  /** An `acknowledged` receipt: the row was marked, not settled. */
  readonly acknowledged?: true
}

/** The persisted ledger document: the owed book plus its settled archive. */
export interface TaskLedgerSnapshot {
  readonly taskDeliveryRestoreError?: true
  readonly taskDeliveries?: readonly import('./task-delivery.ts').TaskDelivery[]
  readonly reconciliationSessions?: Record<string, number>
  readonly reconciliationReminders?: Record<string, import('./reconciliation-state.ts').ReminderState>
  readonly tasks: readonly TaskRecord[]
  readonly archived?: readonly ArchivedRecord[]
  /** #114 S4: the bounded ring of refused / would-be-refused settlements. */
  readonly settlementRefusals?: readonly SettlementRefusalRecord[]
  /** #114 S4: monotonic count of every refusal noted. */
  readonly settlementRefusalsTotal?: number
  /** gh#154: lifetime conservation counters (persisted; absent = pre-#154 legacy) — the module contract, shared by classifier, counters, and this schema (review P3). */
  readonly conservation?: ConservationSnapshot
}

/** #114 S4: who settled an archived row, and how they stood on its authorization chain. */
export interface SettledBy {
  readonly caller: string
  readonly chain_role: ChainRole | 'off-chain'
}

/** #114 S4: one settlement the judgement refused (enforce) or would have refused (observe). */
export interface SettlementRefusalRecord {
  readonly taskId: string
  readonly at: number
  readonly settler: { readonly caller: string; readonly proof: AuthProof; readonly ingress: 'wire' | 'local' }
  readonly reason: SettlementReason
  /** The receipt's first line, bounded. */
  readonly head: string
  /** true: the settlement was refused (enforce); false: recorded only (observe). */
  readonly enforced: boolean
  /** Repeats of the same (task, settler, reason) folded into this entry, so a flood cannot push older evidence out (review of PR #140 P2-4). */
  readonly count: number
}

/** Bound on ids and callers kept in settlement records; longer values are cut on write and refused on restore. */
export const SETTLEMENT_ID_CAP = 256

/** Bound of the refusal ring (design §4.4). */
export const SETTLEMENT_REFUSAL_CAP = 64

/**
 * #114 S4: how the ledger asks whether a settler may settle a row. `check`
 * is the pure judgement (task-auth.ts judgeSettlement) bound to this
 * receipt's facts; `enforce` decides whether an off-chain verdict blocks
 * the settlement or is only recorded.
 */
export interface SettlementJudge {
  readonly enforce: boolean
  readonly settler: SettlementRefusalRecord['settler']
  check(row: Pick<TaskRecord, 'team' | 'peer' | 'direction' | 'auth' | 'peerKey' | 'peerHost' | 'deliveredTo' | 'forwarded' | 'receiverMembers'>, echo: boolean): SettlementVerdict
}

const SETTLEMENT_REASONS: readonly string[] = ['settler-off-chain', 'settler-unverified', 'on-behalf-mismatch', 'echo-off-chain']
const CHAIN_ROLES: readonly string[] = ['target', 'target-member', 'host-face', 'compat', 'legacy', 'off-chain']
const PROOF_VALUES: readonly string[] = ['origin-claim', 'claim-mismatch', 'legacy-window', 'unbound', 'cli-identity', 'in-process', 'none']

/** Restore-side allowlist for settledBy: whole or nothing. */
export function withSettledBy(raw: unknown): { settledBy?: SettledBy } {
  if (raw === null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  if (typeof r.caller !== 'string' || r.caller.length > SETTLEMENT_ID_CAP || typeof r.chain_role !== 'string' || !CHAIN_ROLES.includes(r.chain_role)) return {}
  return { settledBy: { caller: r.caller, chain_role: r.chain_role as SettledBy['chain_role'] } }
}

/** Restore-side allowlist for one refusal record: whole or nothing. */
export function parseRefusal(raw: unknown): SettlementRefusalRecord | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const st = r.settler as Record<string, unknown> | null | undefined
  if (typeof r.taskId !== 'string' || r.taskId === '' || r.taskId.length > SETTLEMENT_ID_CAP || typeof r.at !== 'number' || !Number.isFinite(r.at)) return undefined
  if (typeof r.reason !== 'string' || !SETTLEMENT_REASONS.includes(r.reason) || typeof r.head !== 'string' || typeof r.enforced !== 'boolean') return undefined
  if (st === null || typeof st !== 'object' || typeof st.caller !== 'string' || st.caller.length > SETTLEMENT_ID_CAP || typeof st.proof !== 'string' || !PROOF_VALUES.includes(st.proof) || (st.ingress !== 'wire' && st.ingress !== 'local')) return undefined
  const count = r.count === undefined ? 1 : r.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return undefined
  return { taskId: r.taskId, at: r.at, settler: { caller: st.caller, proof: st.proof as AuthProof, ingress: st.ingress }, reason: r.reason as SettlementReason, head: r.head.slice(0, SUMMARY_CAP), enforced: r.enforced, count }
}
