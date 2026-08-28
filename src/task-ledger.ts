/**
 * Persisted async-task ledger (`<dsh-home>/a2a/tasks.json`). The receipt
 * contract makes the target answer a fire-and-forget route with a message
 * starting `[A2A receipt] task <task_id> <outcome summary>`, but the caller
 * had no book to reconcile against — pending tasks were unqueryable and a
 * restart forgot them all. The ledger keeps one record per routed task that
 * is still owed a reply, correlates the receipt by its task id, and persists
 * so a node restart does not orphan the reconciliation.
 *
 * Three-tier book (v0.5.29): the owed book holds only unsettled rows —
 * `pending`, or `dead` once a row sits past {@link TASK_STALE_TTL_MS} (swept
 * lazily on every entry point, never timer-driven — this host restarts too
 * often for in-memory timers). Dead rows exit the owed view and disarm the
 * async nudge via {@link TaskLedger.isPending}, yet still settle on a late
 * receipt. Every settled row leaves the owed book for the bounded archive,
 * so resolution history stops being silently evicted by the {@link TASK_CAP}
 * slice (the evidence-loss defect behind the "the ledger keeps growing"
 * illusion: settlements vanished while debts piled up).
 * @module @nelsonlongxiang/dsh-open-a2a-net/task-ledger
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseReceipt, RECEIPT_OUTCOMES, type ReceiptOutcomeV2 } from './receipt.ts'

/**
 * Caller-ended summaries (abandon / cancel) share one isolation law: late
 * receipts never rewrite the verdict — they only stamp lateReceiptAt, and
 * the projected outcome collapses to 'abandoned'.
 */
const CALLER_ENDED_PREFIX = /^caller-(abandoned|cancelled)/

/** Hard cap on the owed book (pending + dead-lettered rows, most recent first). */
export const TASK_CAP = 64

/** Hard cap on the settled archive (most recent kept). */
export const ARCHIVE_CAP = 64

/** Longest receipt summary kept on a record (multi-line outcomes collapse). */
export const SUMMARY_CAP = 200

/**
 * Age at which an unsettled task auto-dead-letters. A dead row exits the
 * owed view, disarms its async-nudge retry (a cold session cannot consume a
 * re-steer anyway), and still accepts a late receipt from a revived target.
 * Injectable per instance so tests can use short windows; sweeping stays
 * lazy — every read/write entry point sweeps first.
 */
export const TASK_STALE_TTL_MS = 24 * 60 * 60_000

/**
 * The receipt correlation template now lives in `receipt.ts` (shared codec
 * for header + v2 envelope line). This ledger consumes `parseReceipt` so
 * human summaries and machine projections can never drift apart again.
 */

/** Lifecycle of a tracked outbound task inside the owed book. */
export type TaskStatus = 'pending' | 'dead'

/** One tracked outbound task still in the owed book (unsettled). */
export interface TaskRecord {
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  /** The conversation the delivery steered, for follow-up routes. */
  readonly contextId?: string
  status: TaskStatus
  /** When the row was swept to dead-letter (absent while pending). */
  deadAt?: number
}

/** One settled task kept for audit, with its receipt-correlated outcome. */
export interface ArchivedRecord {
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  readonly contextId?: string
  readonly resolvedAt: number
  readonly summary?: string
  /** Controlled vocabulary verdict when the settling receipt carried a v2 envelope; forced 'abandoned' for caller-abandoned rows. */
  readonly outcome?: ReceiptOutcomeV2 | 'abandoned'
  /** Remote-turn wall-clock cost, when the settling envelope carried it. */
  readonly elapsedMs?: number
  /**
   * When a receipt arrived for an explicitly abandoned row ({@link TaskLedger.abandon}).
   * Orphan isolation: the abandonment outcome stays verbatim; the late answer is
   * recorded as metadata only, never promoted to resolution.
   */
  readonly lateReceiptAt?: number
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
  /** Stale-TTL override (tests inject short windows); defaults to {@link TASK_STALE_TTL_MS}. */
  staleTtlMs?: number
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
 * arrivals (P2: native-teams settles its outstanding async submissions from
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
  /** One-line outcome summary, when the receipt carried one. */
  readonly summary?: string
  /** True when the receipt answered a dead-lettered or abandoned row. */
  readonly late?: boolean
}

/** The persisted ledger document: the owed book plus its settled archive. */
export interface TaskLedgerSnapshot {
  readonly tasks: readonly TaskRecord[]
  readonly archived?: readonly ArchivedRecord[]
}

/**
 * Bounded outbound-task ledger with whole-file persistence. Pure of any
 * routing knowledge: callers {@link track} a task when a route leaves it
 * owed a receipt and feed every inbound/relayed message through
 * {@link resolveFromMessage} for correlation.
 */
export class TaskLedger {
  /** Owed-book rows, most recently tracked first; settled rows leave here. */
  private tasks: TaskRecord[] = []
  /** Settled rows, most recently resolved first; bounded by the archive cap. */
  private archived: ArchivedRecord[] = []
  private readonly staleTtlMs: number
  private readonly archiveCap: number
  /** Injectable clock (option `now`). */
  private readonly now: () => number

  /**
   * @param path - persistence file (`<dsh-home>/a2a/tasks.json`); empty = no persistence.
   * @param options - TTL/capacity overrides; defaults come from the exported constants.
   */
  constructor(private readonly path: string, options?: TaskLedgerOptions) {
    this.staleTtlMs = options?.staleTtlMs ?? TASK_STALE_TTL_MS
    this.archiveCap = options?.archiveCap ?? ARCHIVE_CAP
    this.now = options?.now ?? (() => Date.now())
    this.restore()
  }

  /**
   * Every unsettled task (pending + dead-lettered), most recently tracked first.
   * Sweeping runs first, so an overdue pending row reports as dead here.
   * @returns the owed-book records.
   */
  list(): readonly TaskRecord[] {
    this.sweep(this.now())
    return [...this.tasks]
  }

  /**
   * The settled archive, most recently resolved first. Rows land here the
   * moment their receipt correlates and stay until the archive cap evicts
   * the oldest — receipts keep correlating against them, so a repeat or a
   * delayed duplicate refreshes instead of resolving nothing.
   * @returns the archived records.
   */
  archive(): readonly ArchivedRecord[] {
    return [...this.archived]
  }

  /**
   * Remember one outbound task owed a receipt, most-recent first, bounded by
   * {@link TASK_CAP} over the owed book only (settled rows live in the
   * archive, never silently evicted). A task id is caller-born and
   * single-use: a known id in either tier keeps its first record verbatim.
   * @param taskId - the correlation key the receipt echoes.
   * @param team - the team the route addressed.
   * @param peer - the candidate that accepted the delivery ('local' or URL).
   * @param contextId - the delivery's conversation id, kept for follow-up routes (empty omits it).
   */
  track(taskId: string, team: string, peer: string, contextId?: string): void {
    if (taskId === '') return
    this.sweep(this.now())
    if (this.tasks.some(entry => entry.taskId === taskId)) return
    if (this.archived.some(entry => entry.taskId === taskId)) return
    this.tasks = [{
      taskId,
      team,
      peer,
      startedAt: this.now(),
      ...(contextId !== undefined && contextId !== '' ? { contextId } : {}),
      status: 'pending' as const,
    }, ...this.tasks].slice(0, TASK_CAP)
    this.persist()
  }

  /**
   * v0.5.23 (async-stall): whether a tracked task still owes its receipt.
   * The async nudge consults this — a resolved or dead-lettered task
   * disarms its retry (re-steering a session that could not start a turn
   * past its own stale window is noise, not recovery).
   * @param taskId - the correlation key the receipt echoes.
   * @returns true when the task is tracked pending inside its TTL.
   */
  isPending(taskId: string): boolean {
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record === undefined || record.status !== 'pending') return false
    return this.now() - record.startedAt <= this.staleTtlMs
  }

  /**
   * Caller-side give-up (work-order P1a): clears one owed row into the
   * archive under a `caller-abandoned` outcome so waiters stop occupying the
   * remote budget and the three-tier book stays honest about who ended it.
   * NOT cooperative cancellation — the remote may still be working. A late
   * receipt against an abandoned row lands as orphan metadata
   * ({@link ArchivedRecord.lateReceiptAt}) without rewriting the decision.
   * Idempotent and total per the consumer contract: repeat calls and unknown
   * ids return stable structured outcomes, never throw.
   * @param taskId - the correlation key to abandon.
   * @param reason - optional short cause, folded into the archived summary.
   * @returns `{outcome:'cleared'}` when a pending/dead row was settled now,
   * `'already-terminal'` when the archive already held the task's end,
   * `'unknown'` when neither tier ever saw the id.
   */
  abandon(taskId: string, reason?: string): AbandonResult {
    if (taskId === '') return { outcome: 'unknown', taskId }
    this.sweep(this.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record !== undefined) {
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      const resolvedAt = this.now()
      const cause = reason === undefined || reason === '' ? '' : `: ${reason.slice(0, SUMMARY_CAP - 'caller-abandoned:'.length)}`
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        resolvedAt,
        summary: `caller-abandoned${cause}`,
        outcome: 'abandoned',
      })
      this.persist()
      return { outcome: 'cleared', taskId, archivedAt: resolvedAt }
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return { outcome: 'unknown', taskId }
    return { outcome: 'already-terminal', taskId, archivedAt: settled.resolvedAt }
  }

  /**
   * Cooperative cancellation (work-order P1b): ends one owed row like
   * {@link abandon} but marks it `caller-cancelled` so downstream tooling
   * tells "stopped waiting" from "ordered a stop". Implemented standalone
   * (not via a shared endTask core) deliberately: abandon() is already
   * reviewed semantics on this stack — touching it would ripple re-review;
   * the ~20 duplicated lines buy a frozen reviewed surface.
   * Cross-node targets degrade honestly: no reachable lane ⇒ no notify —
   * the route layer reads team/contextId from here for its best-effort
   * steer, which is the documented boundary until origin-auth lands.
   */
  cancel(taskId: string, reason?: string): CancelledResult {
    if (taskId === '') return { outcome: 'unknown', taskId }
    this.sweep(this.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record !== undefined) {
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      const resolvedAt = this.now()
      const cause = reason === undefined || reason === '' ? '' : `: ${reason.slice(0, SUMMARY_CAP - 'caller-cancelled:'.length)}`
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        resolvedAt,
        summary: `caller-cancelled${cause}`,
        outcome: 'abandoned',
      })
      this.persist()
      return {
        outcome: 'cleared',
        taskId,
        archivedAt: resolvedAt,
        team: record.team,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
      }
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return { outcome: 'unknown', taskId }
    return { outcome: 'already-terminal', taskId, archivedAt: settled.resolvedAt }
  }

  /**
   * Correlate one message against the ledger: a receipt (message starting
   * `[A2A receipt] task <id> …`) settles its task into the archive, keeping
   * the outcome summary; a repeat or late receipt refreshes that archived
   * record with the latest outcome. A dead-lettered row revives through this
   * same path when a revived target finally answers.
   * @param message - the inbound or relayed message text.
   * @returns what the receipt settled, or `undefined` when the message
   *   correlated nothing.
   */
  resolveFromMessage(message: string): ReceiptResolvedInfo | undefined {
    const parsed = parseReceipt(message)
    if (parsed === null) return undefined
    const taskId = parsed.taskId
    const summary = parsed.summary.trim().slice(0, SUMMARY_CAP)
    // Controlled vocabulary only: a foreign outcome string never lands here.
    const envelopeOutcome =
      parsed.envelope?.outcome !== undefined ? (parsed.envelope.outcome as ReceiptOutcomeV2) : undefined
    const elapsedMs = parsed.envelope?.elapsedMs
    this.sweep(this.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record !== undefined) {
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        resolvedAt: this.now(),
        ...(summary !== '' ? { summary } : {}),
        ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      })
      this.persist()
      return {
        taskId,
        team: record.team,
        peer: record.peer,
        // A dead row still lives in the tasks array (the sweep only flips
        // status): its receipt is a revival — the late marker's first form.
        ...(record.status === 'dead' ? { late: true } : {}),
        ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
        ...(summary !== '' ? { summary } : {}),
      }
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return undefined
    // Orphan isolation: a receipt for an explicitly abandoned row must not
    // rewrite the abandonment outcome — the caller stopped waiting by choice.
    // Record that the target did answer later; keep the decision verbatim and
    // pin the projected verdict to 'abandoned'.
    const callerEnded = CALLER_ENDED_PREFIX.test(settled.summary ?? '')
    this.archived = [
      {
        ...settled,
        ...(callerEnded
          ? { lateReceiptAt: this.now(), outcome: 'abandoned' as const }
          : {
              resolvedAt: this.now(),
              ...(summary !== '' ? { summary } : {}),
              ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
            }),
      },
      ...this.archived.filter(entry => entry.taskId !== taskId),
    ]
    this.persist()
    return {
      taskId,
      team: settled.team,
      peer: settled.peer,
      ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
      ...(summary !== '' ? { summary } : {}),
      // The late marker's second form: the caller had already moved on
      // (abandonment recorded verbatim). A HEALTHY row's duplicate refresh
      // is neither dead-lettered nor abandoned — it carries no marker.
      ...(callerEnded ? { late: true } : {}),
    }
  }

  /** Move one settled record to the archive head, trimming at the cap. */
  private archiveSettled(record: ArchivedRecord): void {
    this.archived = [record, ...this.archived].slice(0, this.archiveCap)
  }

  /** Lazy dead-letter sweep: overdue pending rows flip status, at most once. */
  private sweep(now: number): void {
    let changed = false
    for (const entry of this.tasks) {
      if (entry.status === 'pending' && now - entry.startedAt > this.staleTtlMs) {
        entry.status = 'dead'
        entry.deadAt = now
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** Load a persisted snapshot on construction, if present. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TaskLedgerSnapshot> | null
      const entries = snapshot?.tasks
      const restored: TaskRecord[] = []
      if (Array.isArray(entries)) {
        for (const raw of entries) {
          // Unparsed on purpose: the legacy shape carries a 'resolved' status
          // and inline outcome fields that TaskRecord no longer declares.
          const entry = raw as Record<string, unknown> | null
          if (typeof entry?.taskId !== 'string' || entry.taskId === '') continue
          // Legacy two-state files carried resolved rows inline; they migrate
          // into the archive so pre-upgrade outcomes survive the upgrade.
          if (entry.status === 'resolved') {
            this.archived.push({
              taskId: entry.taskId,
              team: typeof entry.team === 'string' ? entry.team : '',
              peer: typeof entry.peer === 'string' ? entry.peer : '',
              startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : this.now(),
              ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
              resolvedAt: typeof entry.resolvedAt === 'number' && Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : this.now(),
              ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
              ...(typeof entry.outcome === 'string' && (RECEIPT_OUTCOMES as readonly string[]).includes(entry.outcome) ? { outcome: entry.outcome as ReceiptOutcomeV2 } : {}),
              ...(typeof entry.lateReceiptAt === 'number' && Number.isFinite(entry.lateReceiptAt) ? { lateReceiptAt: entry.lateReceiptAt } : {}),
            })
            continue
          }
          restored.push({
            taskId: entry.taskId,
            team: typeof entry.team === 'string' ? entry.team : '',
            peer: typeof entry.peer === 'string' ? entry.peer : '',
            startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : this.now(),
            ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
            status: entry.status === 'dead' ? 'dead' : 'pending',
            ...(entry.status === 'dead'
              ? { deadAt: typeof entry.deadAt === 'number' && Number.isFinite(entry.deadAt) ? entry.deadAt : this.now() }
              : {}),
          })
        }
      }
      const legacyArchive = snapshot?.archived
      if (Array.isArray(legacyArchive)) {
        for (const raw of legacyArchive) {
          const entry = raw as Partial<ArchivedRecord> | null
          if (typeof entry?.taskId !== 'string' || entry.taskId === '') continue
          if (this.archived.some(existing => existing.taskId === entry.taskId)) continue
          this.archived.push({
            taskId: entry.taskId,
            team: typeof entry.team === 'string' ? entry.team : '',
            peer: typeof entry.peer === 'string' ? entry.peer : '',
            startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : this.now(),
            ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
            resolvedAt: typeof entry.resolvedAt === 'number' && Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : this.now(),
            ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
            ...(typeof entry.outcome === 'string' && (RECEIPT_OUTCOMES as readonly string[]).includes(entry.outcome) ? { outcome: entry.outcome as ReceiptOutcomeV2 } : {}),
            ...(typeof entry.lateReceiptAt === 'number' && Number.isFinite(entry.lateReceiptAt) ? { lateReceiptAt: entry.lateReceiptAt } : {}),
          })
        }
      }
      this.tasks = restored.slice(0, TASK_CAP)
      this.archived = this.archived.slice(0, this.archiveCap)
    } catch {
      // A corrupt ledger is not fatal: routing never depends on it; the
      // reconciliation simply starts fresh.
    }
  }

  /** Persist the ledger (no-op when no path was configured). */
  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const snapshot: TaskLedgerSnapshot = {
        tasks: this.tasks.map(task => ({ ...task })),
        ...(this.archived.length > 0 ? { archived: this.archived.map(entry => ({ ...entry })) } : {}),
      }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break routing; the ledger degrades to
      // memory-only.
    }
  }
}