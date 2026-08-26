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
 * Matches the receipt contract: a message starting with the literal receipt
 * header followed by the task id and the outcome summary. The header is the
 * network's fixed template (case-sensitive), so anything else is an ordinary
 * routed message.
 */
const RECEIPT_PATTERN = /^\[A2A receipt\] task (\S+)\s*([\s\S]*)$/

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
}

/** Per-instance knobs; defaults come from the exported constants. */
export interface TaskLedgerOptions {
  /** Stale-TTL override (tests inject short windows); defaults to {@link TASK_STALE_TTL_MS}. */
  staleTtlMs?: number
  /** Archive capacity override; defaults to {@link ARCHIVE_CAP}. */
  archiveCap?: number
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

  /**
   * @param path - persistence file (`<dsh-home>/a2a/tasks.json`); empty = no persistence.
   * @param options - TTL/capacity overrides; defaults come from the exported constants.
   */
  constructor(private readonly path: string, options?: TaskLedgerOptions) {
    this.staleTtlMs = options?.staleTtlMs ?? TASK_STALE_TTL_MS
    this.archiveCap = options?.archiveCap ?? ARCHIVE_CAP
    this.restore()
  }

  /**
   * Every unsettled task (pending + dead-lettered), most recently tracked first.
   * Sweeping runs first, so an overdue pending row reports as dead here.
   * @returns the owed-book records.
   */
  list(): readonly TaskRecord[] {
    this.sweep(Date.now())
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
    this.sweep(Date.now())
    if (this.tasks.some(entry => entry.taskId === taskId)) return
    if (this.archived.some(entry => entry.taskId === taskId)) return
    this.tasks = [{
      taskId,
      team,
      peer,
      startedAt: Date.now(),
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
    return Date.now() - record.startedAt <= this.staleTtlMs
  }

  /**
   * Correlate one message against the ledger: a receipt (message starting
   * `[A2A receipt] task <id> …`) settles its task into the archive, keeping
   * the outcome summary; a repeat or late receipt refreshes that archived
   * record with the latest outcome. A dead-lettered row revives through this
   * same path when a revived target finally answers.
   * @param message - the inbound or relayed message text.
   * @returns whether the message correlated a tracked task.
   */
  resolveFromMessage(message: string): boolean {
    const match = RECEIPT_PATTERN.exec(message)
    if (match === null) return false
    const taskId = match[1] ?? ''
    const summary = (match[2] ?? '').trim().slice(0, SUMMARY_CAP)
    this.sweep(Date.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record !== undefined) {
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        resolvedAt: Date.now(),
        ...(summary !== '' ? { summary } : {}),
      })
      this.persist()
      return true
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return false
    this.archived = [
      { ...settled, resolvedAt: Date.now(), ...(summary !== '' ? { summary } : {}) },
      ...this.archived.filter(entry => entry.taskId !== taskId),
    ]
    this.persist()
    return true
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
              startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now(),
              ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
              resolvedAt: typeof entry.resolvedAt === 'number' && Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : Date.now(),
              ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
            })
            continue
          }
          restored.push({
            taskId: entry.taskId,
            team: typeof entry.team === 'string' ? entry.team : '',
            peer: typeof entry.peer === 'string' ? entry.peer : '',
            startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now(),
            ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
            status: entry.status === 'dead' ? 'dead' : 'pending',
            ...(entry.status === 'dead'
              ? { deadAt: typeof entry.deadAt === 'number' && Number.isFinite(entry.deadAt) ? entry.deadAt : Date.now() }
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
            startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now(),
            ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
            resolvedAt: typeof entry.resolvedAt === 'number' && Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : Date.now(),
            ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
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
