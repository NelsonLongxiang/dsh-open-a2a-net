/**
 * superagent a2a Source (plan nodes p2a-source-code and p3-source-explicit; designs: docs/design/superagent-a2a-p2-source-design.md,
 * docs/design/superagent-a2a-watch.md).
 *
 * Reads one dedicated a2a-net CLI identity's mailbox through `a2a-net inbox --after` and turns each message into a superagent
 * Trigger. `observe` (the default) never replies; `reply` answers the caller that sent the message: one formal receipt per
 * task, later messages as new tasks in the same context, each after the home host rechecks the caller's link. It is a
 * standalone export (`./a2a-watch`) that nothing in this plugin loads; superagent loads it only where an operator enables it.
 *
 * Trust comes from structured mailbox fields only (`proof`, `receipt_for`, `dup`, `task_id`); the message text and
 * every meta field are data, never parsed for decisions.
 */
import { health, key, threadKey } from './source-types.ts'
import type { Commands, ContextPart, FieldSpec, Health, OutboundMessage, SchemaLike, SourceContext, SourceHost, SourceKind, TicketView, Trigger } from './source-types.ts'

export const KIND = 'a2a'
/** The program superagent's Commands runs; the deployment puts the a2a-net CLI on PATH with this identity's home. */
export const PROGRAM = 'a2a-net'
/**
 * D4 as revised by S36: a host-verified origin, this host's own process, or a CLI identity deposited on this host makes an
 * actor — and only together with a link (LINK_RULES below).
 */
export const TRUSTED_PROOFS: ReadonlySet<string> = new Set(['origin-claim', 'in-process', 'cli-identity'])
/**
 * The host admission rules that are an operator's link (S36; p3 design Q1): a canvas both share, a pinned remote ref, or a
 * CLI identity deposited through this host's control route. roster-shared is not one — members join a roster themselves.
 */
export const LINK_RULES: ReadonlySet<string> = new Set(['canvas-shared', 'remote-ref-samezone', 'remote-ref-foreign', 'remote-ref-cli', 'cli-deposit'])
/** S27 L1: task ids this Source sends start with this; a row carrying one is never taken in (filtered as loop). */
export const LOOP_PREFIX = 'a2a-'
export const HEALTH = { read: 'a2a', deposit: 'a2a-deposit', reply: 'a2a-reply' } as const
/** Source-scoped KV records (superagent keys are plain strings). */
export const KV = {
  cursor: 'a2a-cursor', renewedAt: 'a2a-renewed-at', rows: 'a2a-rows', pages: 'a2a-pages', healthLog: 'a2a-health-log',
  heartbeat: 'a2a-heartbeat', answered: 'a2a-answered', sendFailed: 'a2a-send-failed',
} as const
/**
 * Records kept for the shadow acceptance (D1, D2): the newest ROW_RECORD_CAP row outcomes, PAGE_RECORD_CAP page headers
 * (one per read) and HEALTH_RECORD_CAP health errors. Older ones roll off; none ever holds message text.
 */
export const ROW_RECORD_CAP = 1000
export const PAGE_RECORD_CAP = 1000
export const HEALTH_RECORD_CAP = 200
/** Plan P (v5.1 A15): one heartbeat page per hour at most, carrying the rounds and the row records since the previous one. */
export const HEARTBEAT_MS = 3_600_000
/** P3-8: the reply bookkeeping is bounded; both maps drop entries older than KV_TTL_DAYS and keep the newest CAP. */
export const ANSWERED_RECORD_CAP = 2000
export const SEND_FAILED_RECORD_CAP = 1000
export const KV_TTL_DAYS = 7
/** S25 O5: a message still unsent this long after its first failure is gone. */
export const GONE_AFTER_MS = 24 * 3_600_000
/** The host's admission vocabulary (src/cli-deposit.ts MAIL_ADMISSIONS): a row record keeps an admission only from this set. */
export const ADMISSION_VALUES: ReadonlySet<string> = new Set(['scope-off', 'host-face', 'local-exempt', 'roster-shared', 'canvas-shared', 'remote-ref-samezone', 'remote-ref-foreign', 'remote-ref-cli', 'peer-org', 'node-fact', 'cli-deposit'])
/** The host's proof vocabulary (src/task-auth.ts AuthProof): a row record keeps a proof only from this closed set. */
const PROOF_VALUES: ReadonlySet<string> = new Set(['origin-claim', 'claim-mismatch', 'legacy-window', 'unbound', 'cli-identity', 'in-process', 'none'])
/** The structured health values a health record may keep; free text (such as a CLI error) stays in the live report only. */
const LOG_VALUE_KEYS: ReadonlySet<string> = new Set(['count', 'lost', 'after', 'epochChanged', 'task'])
/** The mailbox's duplicate markers a row record may keep. */
const DUP_VALUES: ReadonlySet<string> = new Set(['sync-answered'])

/** Where one mailbox row went, as the shadow acceptance reads it (A5). */
export type RowOutcome = 'stored' | 'duplicate' | 'filtered:unverified' | 'filtered:unlinked' | 'filtered:loop' | 'filtered:receipt' | 'duplicateCopy' | 'unreadable'
/**
 * One row's record: the row's identifying metadata and its outcome, never the text. proof, receipt_for and dup are the
 * mailbox's own fields, so the acceptance can take the rows as the whole set and reconcile the Triggers against them.
 */
export interface RowRecord {
  epoch: string; seq: number | null; task_id: string | null; from: string | null; outcome: RowOutcome; at: string
  proof: string | null; receipt_for: string | null; dup: string | null; admission: string | null
}
/**
 * One read's page header as the host printed it (A7 checks the Source against it). Plan P: a read is recorded when it
 * brought rows or its header reports a loss, and once an hour as a heartbeat that counts the rounds and the row records
 * since the previous heartbeat (v5.1 A15), so an idle Source no longer fills the record with empty reads.
 */
export interface PageRecord {
  at: string; after: string; next: string; epoch: string; lost: number | null; epochChanged: boolean; cursorAhead: boolean
  heartbeat?: true; rounds?: number; rows?: number
}
/** The heartbeat's running counts since the last heartbeat page. */
interface HeartbeatState { last: string | null; rounds: number; rows: number }
/** One health error's record: the entry and its state/code/values, never the free-text detail. */
export interface HealthRecord { at: string; entry: string; state: Health['state']; code?: string; values?: Record<string, string> }

/**
 * Append rows by their stable key epoch:seq (a replay records nothing twice), keeping the newest ROW_RECORD_CAP. Every
 * appended record also counts toward the next heartbeat, in the same write, so an interrupted round leaves the counts true.
 */
export function recordRows(ctx: SourceContext, rows: readonly RowRecord[]): number {
  if (rows.length === 0) return 0
  let appended = 0
  const kept = ctx.state.get<RowRecord[]>(KV.rows) ?? []
  const seen = new Set(kept.map(r => `${r.epoch}:${String(r.seq)}`))
  for (const row of rows) {
    const key = `${row.epoch}:${String(row.seq)}`
    if (row.seq !== null && seen.has(key)) continue
    seen.add(key)
    kept.push(row)
    appended += 1
  }
  ctx.state.set(KV.rows, kept.slice(-ROW_RECORD_CAP))
  if (appended > 0) {
    const hb = heartbeatState(ctx)
    ctx.state.set(KV.heartbeat, { ...hb, rows: hb.rows + appended })
  }
  return appended
}

function heartbeatState(ctx: SourceContext): HeartbeatState {
  const hb = ctx.state.get<HeartbeatState>(KV.heartbeat)
  return hb !== undefined && typeof hb.rounds === 'number' && typeof hb.rows === 'number' ? hb : { last: null, rounds: 0, rows: 0 }
}

/**
 * Count one finished round and write the heartbeat page when one is due: `force` (the first round after a start), no
 * heartbeat yet, or HEARTBEAT_MS since the last one. The page carries the counts since the previous heartbeat, this round included.
 */
export function noteRound(ctx: SourceContext, page: Omit<PageRecord, 'heartbeat' | 'rounds' | 'rows'>, force: boolean): boolean {
  const hb = heartbeatState(ctx)
  const rounds = hb.rounds + 1
  const due = force || hb.last === null || Date.parse(page.at) - Date.parse(hb.last) >= HEARTBEAT_MS
  if (!due) { ctx.state.set(KV.heartbeat, { ...hb, rounds }); return false }
  recordPage(ctx, { ...page, heartbeat: true, rounds, rows: hb.rows })
  ctx.state.set(KV.heartbeat, { last: page.at, rounds: 0, rows: 0 })
  return true
}

/** Keep one read's page header, newest PAGE_RECORD_CAP. */
export function recordPage(ctx: SourceContext, page: PageRecord): void {
  const kept = ctx.state.get<PageRecord[]>(KV.pages) ?? []
  kept.push(page)
  ctx.state.set(KV.pages, kept.slice(-PAGE_RECORD_CAP))
}

/** Report a health error and keep its record (A7: every loss round leaves a record, whatever the current value says). */
export function reportError(ctx: SourceContext, entry: string, h: Health, now: () => Date = () => new Date()): void {
  const log = ctx.state.get<HealthRecord[]>(KV.healthLog) ?? []
  const values = h.values === undefined ? undefined : Object.fromEntries(Object.entries(h.values).filter(([name]) => LOG_VALUE_KEYS.has(name)))
  log.push({ at: h.at ?? now().toISOString(), entry, state: h.state, ...(h.code !== undefined ? { code: h.code } : {}), ...(values !== undefined ? { values } : {}) })
  ctx.state.set(KV.healthLog, log.slice(-HEALTH_RECORD_CAP))
  ctx.report(entry, h)
}

export interface A2aConfig extends Record<string, unknown> {
  /** observe records and never replies (the shadow run); reply answers callers (p3). Anything else is refused. */
  mode: 'observe' | 'reply'
  pollSeconds: number
  renewMinutes: number
}
const DEFAULTS: A2aConfig = { mode: 'observe', pollSeconds: 30, renewMinutes: 60 }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const intIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** A strict schema without zod (superagent only calls parse / safeParse on it): unknown keys and unknown modes fail closed. */
function strictSchema<T>(check: (value: Record<string, unknown>) => T | undefined): SchemaLike<T> {
  const safeParse = (value: unknown): { success: true; data: T } | { success: false } => {
    const data = isRecord(value) ? check(value) : undefined
    return data === undefined ? { success: false } : { success: true, data }
  }
  return {
    safeParse,
    parse(value) {
      const result = safeParse(value)
      if (!result.success) throw new Error('a2a Source: invalid configuration')
      return result.data
    },
  }
}

export const configSchema = strictSchema<A2aConfig>(value => {
  if (Object.keys(value).some(name => !(name in DEFAULTS))) return undefined
  const mode = value.mode ?? DEFAULTS.mode
  const pollSeconds = value.pollSeconds ?? DEFAULTS.pollSeconds
  // The deposit lives 4h on its home host; renewing at least every 230 minutes keeps it live.
  const renewMinutes = value.renewMinutes ?? DEFAULTS.renewMinutes
  if ((mode !== 'observe' && mode !== 'reply') || !intIn(pollSeconds, 10, 3600) || !intIn(renewMinutes, 10, 230)) return undefined
  return { mode, pollSeconds, renewMinutes }
})

type Allowed = { id: string; name?: string }[]
function senderRows(value: unknown): Allowed | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: Allowed = []
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id === '' || Object.keys(row).some(name => name !== 'id' && name !== 'name')) return undefined
    if (row.name !== undefined && typeof row.name !== 'string') return undefined
    rows.push({ id: row.id, ...(row.name !== undefined ? { name: row.name } : {}) })
  }
  return rows
}
/**
 * The a2a Policy part. A2A callers are agents (D7), so superagent admits them only through the Source's bot list
 * (policy.ts machineGate): `bots` is the owner's list of callers whose requests may become inferred candidates — on top of
 * the host link the scope already requires (p3 design v1.2). `allowed` stays for the form; a2a never sends human Triggers.
 */
export const policySchema = strictSchema<Record<string, unknown> & { allowed: Allowed; bots: Allowed }>(value => {
  if (Object.keys(value).some(name => name !== 'allowed' && name !== 'bots')) return undefined
  const allowed = senderRows(value.allowed ?? [])
  const bots = senderRows(value.bots ?? [])
  if (allowed === undefined || bots === undefined) return undefined
  return { allowed, bots }
})

/** One row of `a2a-net inbox --after`, as far as the Source reads it. */
interface MailRow {
  at: number
  from: string
  text: string
  seq: number
  task_id?: string
  context_id?: string
  proof?: string
  receipt_for?: string
  dup?: string
  admission?: string
}

/** Where one mailbox row went: a Trigger (whose scope then decides), a duplicate copy, or unreadable. */
export type Translation =
  | { kind: 'trigger'; trigger: Trigger }
  | { kind: 'duplicateCopy' }
  | { kind: 'unreadable' }

/**
 * Translate one mailbox row. The id is key('a2a', from, task_id): a task id is unique only inside the host's idempotency
 * window, so the caller is part of it. Rows without a task id (an older host) are unreadable, never guessed; a
 * `dup: 'sync-answered'` row is a copy of a reply the caller already got and makes no second Trigger.
 */
export function translate(row: unknown, epoch: string): Translation {
  if (!isRecord(row)) return { kind: 'unreadable' }
  const mail = row as Partial<MailRow>
  if (typeof mail.from !== 'string' || mail.from === '' || typeof mail.text !== 'string' || typeof mail.at !== 'number' || !Number.isInteger(mail.seq)) return { kind: 'unreadable' }
  if (typeof mail.task_id !== 'string' || mail.task_id === '') return { kind: 'unreadable' }
  if (mail.dup === 'sync-answered') return { kind: 'duplicateCopy' }
  const thread = typeof mail.context_id === 'string' && mail.context_id !== '' ? mail.context_id : mail.task_id
  const proof = typeof mail.proof === 'string' ? mail.proof : undefined
  const receiptFor = typeof mail.receipt_for === 'string' && mail.receipt_for !== '' ? mail.receipt_for : undefined
  const admission = typeof mail.admission === 'string' && ADMISSION_VALUES.has(mail.admission) ? mail.admission : undefined
  // A reply rechecks the caller on the face it came in by: this host's own sessions on the local face, the rest on the wire.
  const ingress: Record<string, string> = proof === 'in-process' ? { ingress: 'local' } : {}
  return {
    kind: 'trigger',
    trigger: {
      id: key(KIND, mail.from, mail.task_id),
      source: KIND,
      threads: [{ source: KIND, id: thread }],
      actor: { source: KIND, id: mail.from },
      // D7 (global review of PR #385): an A2A caller is an agent, so a bot by fact; p3 settles S13 ② against this.
      human: false,
      addressed: 'direct',
      at: new Date(mail.at).toISOString(),
      text: mail.text,
      channel: { source: KIND, thread: `${KIND}:${thread}`, address: { caller: mail.from, task: mail.task_id, ...(thread !== mail.task_id ? { context: thread } : {}), ...ingress } },
      meta: {
        taskId: mail.task_id,
        ...(thread !== mail.task_id ? { contextId: thread } : {}),
        seq: mail.seq,
        epoch,
        ...(proof !== undefined ? { proof } : {}),
        ...(receiptFor !== undefined ? { receiptFor } : {}),
        ...(admission !== undefined ? { admission } : {}),
        // Observation only: what S13 ② would have given a verified caller. S21 replaced it with the rule-based inferred
        // path; it rides along for the audit and nothing reads it for a decision.
        ...(proof !== undefined && TRUSTED_PROOFS.has(proof) ? { s13Strength: 'explicit-if-allowed' } : {}),
      },
    },
  }
}

/**
 * Receiving scope from the stored meta alone (p3 design P3-3), first failure wins and everything fails closed: an untrusted
 * proof (unverified), no operator link (unlinked — a row from a host before p1-mail-admission has no admission and lands
 * here), one of this Source's own task ids (loop, S27 L1), a receipt. Only then the mailbox row.
 */
export function scope(input: { meta: Record<string, unknown> }): { listened: true; observed: boolean; row?: string } | { listened: false; reason: string } {
  const proof = input.meta.proof
  if (typeof proof !== 'string' || !TRUSTED_PROOFS.has(proof)) return { listened: false, reason: 'unverified' }
  const admission = input.meta.admission
  if (typeof admission !== 'string' || !LINK_RULES.has(admission)) return { listened: false, reason: 'unlinked' }
  if (typeof input.meta.taskId === 'string' && input.meta.taskId.startsWith(LOOP_PREFIX)) return { listened: false, reason: 'loop' }
  if (typeof input.meta.receiptFor === 'string') return { listened: false, reason: 'receipt' }
  return { listened: true, observed: false, row: 'mailbox' }
}

/** The page `a2a-net inbox --after` prints. */
interface MailPage { epoch: string; next: string; mail: unknown[]; lost: number | null; epochChanged: boolean; cursorAhead?: true }

function parsePage(output: string): MailPage {
  const page = JSON.parse(output) as unknown
  if (!isRecord(page) || typeof page.epoch !== 'string' || typeof page.next !== 'string' || !Array.isArray(page.mail) ||
    !(page.lost === null || (typeof page.lost === 'number' && Number.isInteger(page.lost))) || typeof page.epochChanged !== 'boolean') {
    throw new Error('a2a-net inbox --after printed an unexpected page')
  }
  return page as unknown as MailPage
}

/** A loss the read must surface (S2): never hidden, always with its numbers. */
export function lossHealth(page: Pick<MailPage, 'lost' | 'epochChanged' | 'cursorAhead'>, after: string, at: string): Health | undefined {
  const values = { lost: String(page.lost), after, epochChanged: String(page.epochChanged) }
  if (page.epochChanged || page.lost === null) {
    return { state: 'error', at, values, detail: `The home host's mailbox store restarted (new epoch); mail during the restart may be lost (lost=${String(page.lost)}, epochChanged=${String(page.epochChanged)}, cursor ${after})` }
  }
  if (page.cursorAhead === true) return { state: 'error', at, values, detail: `The stored cursor ${after} is ahead of the home host; it was not issued there (lost unknown)` }
  if (page.lost > 0) return { state: 'error', at, values, detail: `${String(page.lost)} message(s) were pushed out of the mailbox before this read; they cannot be recovered` }
  return undefined
}

/** One read. `loss` is the health error this round reported, so the loop does not cover it with a ready in the same round. */
export interface RoundSummary { read: number; triggers: number; duplicateCopies: number; unreadable: number; next: string; loss?: Health }

/**
 * Read the mailbox after the stored cursor, take in each row, then move the cursor. An interrupted round leaves the cursor
 * where it was; the stable Trigger ids make the replay a duplicate, never a second Trigger.
 */
export async function pollMailbox(ctx: SourceContext, signal: AbortSignal, now: () => Date = () => new Date(), firstRound = false): Promise<RoundSummary> {
  const after = ctx.state.get<string>(KV.cursor) ?? 'start'
  const page = parsePage(await ctx.commands.withSignal(signal).run(PROGRAM, ['inbox', '--after', after]))
  const at = now().toISOString()
  const header = { at, after, next: page.next, epoch: page.epoch, lost: page.lost, epochChanged: page.epochChanged, cursorAhead: page.cursorAhead === true }
  const loss = lossHealth(page, after, at)
  // Plan P: a read with rows or a reported loss is recorded, before any row is judged, so a missed loss still shows.
  if (page.mail.length > 0 || loss !== undefined) recordPage(ctx, header)
  if (loss !== undefined) reportError(ctx, HEALTH.read, loss, now)
  const summary: RoundSummary = { read: page.mail.length, triggers: 0, duplicateCopies: 0, unreadable: 0, next: page.next, ...(loss !== undefined ? { loss } : {}) }
  // Each row's record is written as soon as the row is through, so an interrupted round keeps what it did; the cursor
  // moves only after every row of the round has its record (D1).
  for (const row of page.mail) {
    if (signal.aborted) throw new Error('The a2a Source stopped during the read')
    const result = translate(row, page.epoch)
    const raw = isRecord(row) ? row : {}
    const base = { epoch: page.epoch, seq: Number.isInteger(raw.seq) ? raw.seq as number : null,
      task_id: typeof raw.task_id === 'string' && raw.task_id !== '' ? raw.task_id : null, from: typeof raw.from === 'string' && raw.from !== '' ? raw.from : null, at,
      proof: typeof raw.proof === 'string' && PROOF_VALUES.has(raw.proof) ? raw.proof : null,
      receipt_for: typeof raw.receipt_for === 'string' && raw.receipt_for !== '' ? raw.receipt_for : null,
      dup: typeof raw.dup === 'string' && DUP_VALUES.has(raw.dup) ? raw.dup : null,
      admission: typeof raw.admission === 'string' && ADMISSION_VALUES.has(raw.admission) ? raw.admission : null }
    if (result.kind === 'duplicateCopy') { summary.duplicateCopies += 1; recordRows(ctx, [{ ...base, outcome: 'duplicateCopy' }]); continue }
    if (result.kind === 'unreadable') { summary.unreadable += 1; recordRows(ctx, [{ ...base, outcome: 'unreadable' }]); continue }
    const received = await ctx.receive(result.trigger)
    summary.triggers += 1
    // The Engine says whether it filtered the Trigger; this kind's own scope says why.
    const verdict = scope(result.trigger)
    const outcome: RowOutcome = received !== 'filtered' ? received : filteredOutcome(verdict)
    recordRows(ctx, [{ ...base, outcome }])
    ctx.threads.describe(threadKey(result.trigger.threads[0]!), { label: `A2A ${result.trigger.actor.id}` })
  }
  ctx.state.set(KV.cursor, page.next)
  noteRound(ctx, header, firstRound)
  return summary
}

/** The row outcome for a Trigger the Engine filtered: this kind's scope says why (unverified when it gives no reason it knows). */
function filteredOutcome(verdict: ReturnType<typeof scope>): RowOutcome {
  const reason = verdict.listened ? undefined : verdict.reason
  return reason === 'unlinked' ? 'filtered:unlinked' : reason === 'loop' ? 'filtered:loop' : reason === 'receipt' ? 'filtered:receipt' : 'filtered:unverified'
}

/** Re-publish the deposit when `renewMinutes` passed since the last success; returns whether it published. */
export async function renewDeposit(ctx: SourceContext, config: A2aConfig, signal: AbortSignal, now: () => number = Date.now): Promise<boolean> {
  const last = ctx.state.get<number>(KV.renewedAt)
  if (typeof last === 'number' && now() - last < config.renewMinutes * 60_000) return false
  // P3-9 (S33): in reply mode the deposit declares that its mailbox owes receipts; observe withdraws it on the next renewal.
  await ctx.commands.withSignal(signal).run(PROGRAM, config.mode === 'reply' ? ['publish', '--owes'] : ['publish'])
  ctx.state.set(KV.renewedAt, now())
  return true
}

/** The receipt outcome a sender may claim (a2a-net SENDER_OUTCOMES). */
export type ReceiptOutcome = 'completed' | 'failed' | 'rejected' | 'abandoned'
/**
 * P3-6 (S26; Q2: closed is abandoned): how the ticket behind a message ended, as the receipt says it. A ticket that has not
 * ended yet (a result sent on a ready report) is completed — the delivery is what the caller's receipt answers.
 */
export function receiptOutcome(ticket: TicketView | undefined): ReceiptOutcome {
  const ended = ticket?.ended
  if (ended === undefined) return 'completed'
  switch (ended.outcome) {
    case 'completed': case 'merged': return 'completed'
    case 'dropped': return 'rejected'
    case 'closed': return 'abandoned'
    case 'stopped': return ended.by === 'human' ? 'abandoned' : 'failed'
  }
}

/** --exit-class codes (P3-7): 4 the class is gone, 5 the task already carries a different receipt. */
export const EXIT_GONE = 4
export const EXIT_RECEIPT_CONFLICT = 5
const exitCodeOf = (error: unknown): number | undefined => isRecord(error) && typeof error.exitCode === 'number' ? error.exitCode : undefined
/** The task ids the CLI takes (cli/a2a.mjs taskFlag and receipt): a receipt rides receipt-<id>, at most 80 characters. */
const RECEIPT_TASK = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const receiptable = (task: string): boolean => RECEIPT_TASK.test(task) && `receipt-${task}`.length <= 80

type Stamps = Record<string, string>
/** A bounded id → ISO-time map: entries older than KV_TTL_DAYS go, then the oldest beyond `cap`. */
function pruneStamps(stamps: Stamps, cap: number, nowMs: number): Stamps {
  const live = Object.entries(stamps).filter(([, at]) => nowMs - Date.parse(at) <= KV_TTL_DAYS * 86_400_000)
  live.sort((a, b) => a[1].localeCompare(b[1]))
  return Object.fromEntries(live.slice(-cap))
}
function stamps(ctx: SourceContext, record: string): Stamps {
  const value = ctx.state.get<Stamps>(record)
  return isRecord(value) ? value as Stamps : {}
}
function setStamp(ctx: SourceContext, record: string, id: string, at: string | undefined, cap: number, nowMs: number): void {
  const next = { ...stamps(ctx, record) }
  if (at === undefined) delete next[id]
  else next[id] = at
  ctx.state.set(record, pruneStamps(next, cap, nowMs))
}

/** The reply channel accepts an address that names a real caller and its task (not the in-process "unknown"). */
export function replyAllowed(address: Record<string, string>, config: Pick<A2aConfig, 'mode'>): boolean {
  return config.mode === 'reply' && typeof address.caller === 'string' && address.caller !== '' && address.caller !== 'unknown' &&
    typeof address.task === 'string' && address.task !== ''
}

/** How the host wants one message sent. */
export interface SendOptions {
  /** Never take the task's formal receipt with this message: send it as a follow-up, and leave the receipt for later. */
  readonly holdReceipt?: boolean
  /** The outcome the receipt states, when the host knows it better than a ticket can (a request the team did not take). */
  readonly outcome?: ReceiptOutcome
  /** market N1c: the seat that took the work up, carried on the formal receipt as `--by`. */
  readonly by?: ReceiptSeat
}

/** market N1c: who took the work up (a seat id, its name), as a receipt's `by`. */
export interface ReceiptSeat { readonly seat: string; readonly name?: string }

/** The receipt switches that carry a seat. */
export const seatArgs = (by: ReceiptSeat | undefined): string[] => by === undefined ? [] : ['--by', by.seat, ...(by.name !== undefined && by.name !== by.seat ? ['--by-name', by.name] : [])]

/**
 * market N2c: the question id an attention receipt rides (`attention-<task>-<id>`), cut from the ticket's attention id;
 * undefined when the task id leaves no room under the 80-character task id, and then the question goes the older way.
 */
export function questionIdFor(task: string, attentionId: string): string | undefined {
  const id = attentionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return id !== '' && `attention-${task}-${id}`.length <= 80 ? id : undefined
}

/**
 * Send one outbound message (p3 design P3-5 to P3-8). Before anything leaves, the home host rechecks the caller against its
 * current links (O1): no link, no message. The task's first message is its one formal receipt; later ones are new tasks
 * in the same context with an a2a- task id (O2, L1). A class of gone, a vanished link, or 24 hours of failures since the
 * first one end the message as gone with a health record; any other failure throws so the Outbox retries.
 */
export async function sendReply(ctx: SourceContext, commands: Commands, message: OutboundMessage, now: () => Date = () => new Date(), options: SendOptions = {}): Promise<'sent' | 'gone'> {
  const at = now()
  const nowMs = at.getTime()
  const { caller, task, context, ingress } = message.channel.address
  const gone = (detail: string): 'gone' => {
    setStamp(ctx, KV.sendFailed, message.id, undefined, SEND_FAILED_RECORD_CAP, nowMs)
    reportError(ctx, HEALTH.reply, { state: 'error', detail, at: at.toISOString(), values: { task: String(task ?? '') } }, now)
    return 'gone'
  }
  if (caller === undefined || task === undefined || !replyAllowed(message.channel.address, { mode: 'reply' })) return gone('The reply has no caller to go to')
  try {
    if (ctx.config<A2aConfig>(KIND)?.mode !== 'reply') throw new Error('The a2a Source is not in reply mode')
    const check = JSON.parse(await commands.run(PROGRAM, ['admission', caller, ...(ingress === 'local' ? ['--local'] : []), '--json'])) as unknown
    const rule = isRecord(check) && check.admitted === true && typeof check.rule === 'string' ? check.rule : undefined
    if (rule === undefined || !LINK_RULES.has(rule)) return gone(`${caller} is no longer linked to this identity; the reply was not sent`)
    // A held receipt (the host's call: an acknowledged request whose ticket has no result yet) leaves the task's one
    // formal receipt for the result; this message goes out as a follow-up in the same context.
    const text = message.text.trim() === '' ? '(no text)' : message.text
    // The engine's reply to a ticket's question carries the id key('attention-reply', <attention id>) — hashed, so
    // it is recognised by recomputing that id from the ticket's open question, never by a prefix.
    const ticket = message.ticketId !== undefined ? ctx.tickets.get(message.ticketId) : undefined
    const attention = ticket?.attention !== undefined && message.id === key('attention-reply', ticket.attention.id)
    // market N2c: a ticket's question goes out as an attention receipt with a structured question on its own task id
    // (attention-<task>-<id>). It marks the requester's row and settles nothing, so the task's one formal receipt stays
    // for the result. Not when a formal receipt already went out (the question then follows it as a follow-up).
    const questionId = attention && receiptable(task) && stamps(ctx, KV.answered)[task] === undefined ? questionIdFor(task, ticket!.attention!.id) : undefined
    const first = questionId === undefined && options.holdReceipt !== true && stamps(ctx, KV.answered)[task] === undefined
    if (first && !receiptable(task)) return gone(`Task ${task} cannot carry a receipt (its id is not a CLI task id); the reply was not sent`)
    const args = questionId !== undefined
      ? ['receipt', task, '--to', caller, '--attention', '--question-id', questionId, ...seatArgs(options.by), '--json', '--exit-class', '--', text.replace(/\s+/g, ' ').trim().slice(0, 2000)]
      : first
      ? ['receipt', task, '--to', caller, ...(attention ? ['--attention'] : ['--outcome', options.outcome ?? receiptOutcome(ticket)]), ...seatArgs(options.by), '--json', '--exit-class', '--', text]
      : ['route', caller, '--task', `${LOOP_PREFIX}${key(message.id)}`, '--context', context ?? task, '--json', '--exit-class', '--', text]
    try {
      await commands.run(PROGRAM, args)
    } catch (error) {
      const code = exitCodeOf(error)
      if (code === EXIT_GONE) return gone(`The host says ${caller} can no longer receive task ${task}'s reply`)
      // The receipt is already there (a crash after the CLI succeeded, before the record): it counts as sent.
      if (!((first || questionId !== undefined) && code === EXIT_RECEIPT_CONFLICT)) throw error
    }
    if (first) setStamp(ctx, KV.answered, task, at.toISOString(), ANSWERED_RECORD_CAP, nowMs)
    setStamp(ctx, KV.sendFailed, message.id, undefined, SEND_FAILED_RECORD_CAP, nowMs)
    return 'sent'
  } catch (error) {
    const firstFailure = stamps(ctx, KV.sendFailed)[message.id]
    if (firstFailure !== undefined && nowMs - Date.parse(firstFailure) >= GONE_AFTER_MS) return gone(`Task ${task}'s reply stayed unsent for 24 hours; last: ${String(error)}`)
    if (firstFailure === undefined) setStamp(ctx, KV.sendFailed, message.id, at.toISOString(), SEND_FAILED_RECORD_CAP, nowMs)
    throw error
  }
}

interface ThreadEntry { dir: 'in' | 'out'; at: number; seq?: number; task_id?: string; from?: string; text: string }

const fields: FieldSpec[] = [
  { key: 'mode', type: 'select', label: { zh: '模式', en: 'Mode' }, options: [
    { value: 'observe', label: { zh: '影子（只登记，不回发）', en: 'Shadow (records only, never replies)' } },
    { value: 'reply', label: { zh: '回发（回执与后续消息只回原调用方）', en: 'Reply (receipts and follow-ups go to the original caller only)' } }] },
  { key: 'pollSeconds', type: 'number', advanced: true, min: 10, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
  { key: 'renewMinutes', type: 'number', advanced: true, min: 10, max: 230, label: { zh: '户口续期间隔 / 分钟', en: 'Deposit renewal / minutes' } },
]

/**
 * The kind. Its Channel needs the kind's own SourceContext (KV records, tickets), which superagent hands out only for a
 * registered kind, so the plugin entry builds it with a getter it fills right after registering (P3-6).
 */
export function createA2aKind(context: () => SourceContext | undefined, now: () => Date = () => new Date()): SourceKind<A2aConfig> {
  return {
  kind: KIND,
  title: { zh: 'A2A 信箱', en: 'A2A mailbox' },
  description: { zh: '接收一个专用 a2a-net CLI 身份信箱里的消息；影子模式只登记，回发模式只回原调用方。', en: "Receives the messages in a dedicated a2a-net CLI identity's mailbox; shadow mode only records, reply mode answers the original caller only." },
  schema: configSchema,
  fields,
  health: [HEALTH.read, HEALTH.deposit, HEALTH.reply],
  scope: (input, _config) => scope(input),
  channel: {
    // Observe mode: no address may receive a reply, whatever the Engine produces; Outbox keeps such messages as ignored.
    allowed: (address, config) => replyAllowed(address, config),
    send(host, message: OutboundMessage): Promise<'sent' | 'gone'> {
      const ctx = context()
      if (ctx === undefined) return Promise.reject(new Error('The a2a Source is not running yet; the reply waits'))
      return sendReply(ctx, host.commands, message, now)
    },
    link: address => ({ url: '', label: { zh: `A2A 调用方 ${address.caller ?? ''}`, en: `A2A caller ${address.caller ?? ''}` } }),
  },
  threadContext: {
    messageId: trigger => String(trigger.meta.taskId ?? ''),
    // An A2A exchange is flat: the thread, its root and the parent all read the same pages of `a2a-net thread`.
    async read(commands, trigger, _part, cursor): Promise<ContextPart> {
      const context = typeof trigger.meta.contextId === 'string' ? trigger.meta.contextId : typeof trigger.meta.taskId === 'string' ? trigger.meta.taskId : ''
      if (context === '') return { messages: [], body: { messages: [] } }
      const page = JSON.parse(await commands.run(PROGRAM, ['thread', context, '--limit', '20', ...(cursor !== undefined ? ['--before', cursor] : [])])) as { handle?: string; entries?: ThreadEntry[]; next_before?: string | null }
      const messages = (page.entries ?? []).map(entry => ({
        id: entry.task_id ?? `${entry.dir}:${String(entry.seq ?? entry.at)}`,
        from: entry.dir === 'in' ? entry.from ?? '' : page.handle ?? '',
        at: new Date(entry.at).toISOString(),
        text: entry.text,
        bot: true as const,
      }))
      return { messages, ...(typeof page.next_before === 'string' ? { next: page.next_before } : {}), body: { messages } }
    },
  },
  policy: {
    schema: policySchema,
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的调用方（A2A 调用方都是 agent，此栏不生效）', en: 'Callers who may originate work (A2A callers are agents; unused)' }, columns: [
        { key: 'id', type: 'text', label: { zh: '调用方句柄', en: 'Caller handle' } },
        { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
      { key: 'bots', type: 'rows', label: { zh: '可接单的 A2A 调用方（还须在宿主链接集内）', en: 'A2A callers whose requests may be taken (they must also be linked on the host)' }, columns: [
        { key: 'id', type: 'text', label: { zh: '调用方句柄', en: 'Caller handle' } },
        { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] }],
    explicit: { zh: '名单里的调用方经宿主校验后路由到本身份。', en: 'A listed caller, verified by the host, routes to this identity.' },
    // One receiving scope, every cell closed: an A2A caller is a bot (D7), admitted only through the bots list.
    rows: () => [{ id: 'mailbox', label: 'mailbox', note: { zh: 'A2A 信箱', en: 'A2A mailbox' }, cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: false } }],
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_A2A_CALLER', description: { zh: '发起工单的 A2A 调用方句柄；工单不是从本来源来的时为空', en: 'The A2A caller that started the ticket; empty when it did not start on this Source' } },
      { key: 'DSH_SUPERAGENT_A2A_CONTEXT', description: { zh: '该工单的 A2A context id；工单不是从本来源来的时为空', en: "The ticket's A2A context id; empty when it did not start on this Source" } },
    ],
    values: ({ trigger }) => ({
      DSH_SUPERAGENT_A2A_CALLER: trigger?.source === KIND ? trigger.actor.id : '',
      DSH_SUPERAGENT_A2A_CONTEXT: trigger?.source === KIND ? String(trigger.meta.contextId ?? trigger.meta.taskId ?? '') : '',
    }),
  },
  }
}

/** The kind without a running context (its Channel can only make the Outbox retry); the plugin entry builds its own. */
export const a2aKind: SourceKind<A2aConfig> = createA2aKind(() => undefined)

const delay = (ms: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
  if (signal.aborted) { resolve(); return }
  const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve() }, ms)
  const done = () => { clearTimeout(timer); resolve() }
  signal.addEventListener('abort', done, { once: true })
})

/** The polling loop: waits for setup (observe mode reads while setup is pending), follows the switch, renews the deposit, reads, and reports health. */
export async function watch(ctx: SourceContext, signal: AbortSignal, now: () => Date = () => new Date()): Promise<void> {
  await ctx.ready
  let readFailures = 0
  let depositFailures = 0
  // The first finished round after a start writes a heartbeat at once (v5.1 A15).
  let firstRound = true
  while (!signal.aborted) {
    const config = ctx.config<A2aConfig>(KIND)
    // Setup restarts dsh-superagent once it resolves the accounts (superagent docs/008-cookbook.md, step 9), so a Source
    // that is not configured yet normally reads nothing and returns. Observe mode deliberately reads anyway: while setup is
    // pending superagent still records what Sources receive and only holds evaluation, dispatch and sending (runtime.ts
    // paused(): "sources still record incoming triggers"; passes.ts pump()), which is exactly a shadow run. Any other mode
    // keeps waiting for setup.
    if (!ctx.configured() && config?.mode !== 'observe') { ctx.report(HEALTH.read, health('paused', 'setupPending')); return }
    if (config === undefined) ctx.report(HEALTH.read, health('paused', 'sourceOff'))
    else {
      try {
        if (await renewDeposit(ctx, config, signal, () => now().getTime())) ctx.report(HEALTH.deposit, { state: 'ready', detail: 'deposit renewed', at: now().toISOString() })
        depositFailures = 0
      } catch (error) {
        depositFailures += 1
        if (!signal.aborted && depositFailures >= 3) reportError(ctx, HEALTH.deposit, { state: 'error', detail: `${String(depositFailures)} consecutive failed deposit renewals; last: ${String(error)}`, at: now().toISOString(), values: { count: String(depositFailures) } }, now)
      }
      try {
        const round = await pollMailbox(ctx, signal, now, firstRound)
        firstRound = false
        readFailures = 0
        // A round that lost mail ends on its error (S2: never hidden). The next clean round reports ready again: the
        // loss stays visible for at least one poll interval, and the round summary in each ready says what was read.
        if (round.loss === undefined) ctx.report(HEALTH.read, { state: 'ready', detail: `${String(round.read)} read, ${String(round.triggers)} taken in, ${String(round.duplicateCopies)} duplicate copies, ${String(round.unreadable)} unreadable`, at: now().toISOString() })
      } catch (error) {
        readFailures += 1
        if (!signal.aborted && readFailures >= 3) reportError(ctx, HEALTH.read, { ...health('error', 'pollFailures', { count: String(readFailures), error: String(error) }), at: now().toISOString() }, now)
      }
    }
    await delay((config?.pollSeconds ?? DEFAULTS.pollSeconds) * 1000, signal)
  }
}

/** The cordis surface the plugin entry uses (superagent injects its host as `orchestrator`). */
export interface PluginContext {
  effect(run: () => (() => void) | (() => Promise<void>), label?: string): void
  readonly orchestrator: SourceHost
}

export const name = 'dsh-superagent-a2a'
export const inject = ['orchestrator']
export function apply(ctx: PluginContext): void {
  let running: SourceContext | undefined
  const kind = createA2aKind(() => running)
  ctx.effect(() => ctx.orchestrator.sources.register(kind), 'a2a: source kind')
  ctx.effect(() => {
    const source = ctx.orchestrator.context(kind)
    running = source
    const controller = new AbortController()
    // A failure that escapes the loop becomes the Source's health instead of an unhandled rejection.
    const loop = watch(source, controller.signal).catch((error: unknown) => { reportError(source, HEALTH.read, { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await loop; running = undefined }
  }, 'a2a: mailbox loop')
}
