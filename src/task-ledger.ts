/**
 * Persisted async-task ledger (`<dsh-home>/a2a/tasks.json`). The receipt
 * contract makes the target answer a fire-and-forget route with a message
 * starting `[A2A receipt] task <task_id> <outcome summary>`, but the caller
 * had no book to reconcile against — pending tasks were unqueryable and a
 * restart forgot them all. The ledger keeps one record per routed task that
 * is still owed a reply, correlates the receipt by its task id, and persists
 * so a node restart does not orphan the reconciliation.
 * @module @nelsonlongxiang/dsh-open-a2a-net/task-ledger
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Hard cap on remembered tasks. A resolved record stays until the cap evicts
 * it (most recent first, peer-store's bound rationale); the cap bounds the
 * file and the tool output.
 */
export const TASK_CAP = 64

/** Longest receipt summary kept on a record (multi-line outcomes collapse). */
export const SUMMARY_CAP = 200

/**
 * Matches the receipt contract: a message starting with the literal receipt
 * header followed by the task id and the outcome summary. The header is the
 * network's fixed template (case-sensitive), so anything else is an ordinary
 * routed message.
 */
const RECEIPT_PATTERN = /^\[A2A receipt\] task (\S+)\s*([\s\S]*)$/

/** One tracked outbound task awaiting its receipt. */
export interface TaskRecord {
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  /** The conversation the delivery steered, for follow-up routes. */
  readonly contextId?: string
  status: 'pending' | 'resolved'
  resolvedAt?: number
  summary?: string
}

/** The persisted ledger document (whole-file read/write, small by design). */
export interface TaskLedgerSnapshot {
  readonly tasks: readonly TaskRecord[]
}

/**
 * Bounded outbound-task ledger with whole-file persistence. Pure of any
 * routing knowledge: callers {@link track} a task when a route leaves it
 * owed a receipt and feed every inbound/relayed message through
 * {@link resolveFromMessage} for correlation.
 */
export class TaskLedger {
  /** Tasks, most recently tracked first. */
  private tasks: TaskRecord[] = []

  /**
   * @param path - persistence file (`<dsh-home>/a2a/tasks.json`); empty = no persistence.
   */
  constructor(private readonly path: string) {
    this.restore()
  }

  /**
   * Every tracked task, most recently tracked first.
   * @returns the task records.
   */
  list(): readonly TaskRecord[] {
    return [...this.tasks]
  }

  /**
   * Remember one outbound task owed a receipt, most-recent first, bounded by
   * {@link TASK_CAP} (the oldest task beyond the cap is forgotten). A task id
   * is caller-born and single-use; re-tracking a known id keeps the first
   * record verbatim.
   * @param taskId - the correlation key the receipt echoes.
   * @param team - the team the route addressed.
   * @param peer - the candidate that accepted the delivery ('local' or URL).
   * @param contextId - the delivery's conversation id, kept for follow-up routes (empty omits it).
   */
  track(taskId: string, team: string, peer: string, contextId?: string): void {
    if (taskId === '' || this.tasks.some(entry => entry.taskId === taskId)) return
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
   * The async nudge consults this — a resolved task disarms its retry.
   * @param taskId - the correlation key the receipt echoes.
   * @returns true when the task is tracked and still pending.
   */
  isPending(taskId: string): boolean {
    const record = this.tasks.find(entry => entry.taskId === taskId)
    return record !== undefined && record.status === 'pending'
  }

  /**
   * Correlate one message against the ledger: a receipt (message starting
   * `[A2A receipt] task <id> …`) resolves its task, keeping the outcome
   * summary; a repeat receipt refreshes the record with the latest outcome.
   * @param message - the inbound or relayed message text.
   * @returns whether the message resolved a tracked task.
   */
  resolveFromMessage(message: string): boolean {
    const match = RECEIPT_PATTERN.exec(message)
    if (match === null) return false
    const taskId = match[1] ?? ''
    const summary = (match[2] ?? '').trim().slice(0, SUMMARY_CAP)
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record === undefined) return false
    record.status = 'resolved'
    record.resolvedAt = Date.now()
    record.summary = summary
    this.persist()
    return true
  }

  /** Load a persisted snapshot on construction, if present. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as TaskLedgerSnapshot | null
      const tasks = snapshot?.tasks
      if (!Array.isArray(tasks)) return
      const restored: TaskRecord[] = []
      for (const entry of tasks) {
        const task = entry as Partial<TaskRecord> | null
        if (typeof task?.taskId !== 'string' || task.taskId === '') continue
        restored.push({
          taskId: task.taskId,
          team: typeof task.team === 'string' ? task.team : '',
          peer: typeof task.peer === 'string' ? task.peer : '',
          startedAt: typeof task.startedAt === 'number' && Number.isFinite(task.startedAt) ? task.startedAt : Date.now(),
          ...(typeof task.contextId === 'string' && task.contextId !== '' ? { contextId: task.contextId } : {}),
          status: task.status === 'resolved' ? 'resolved' : 'pending',
          ...(typeof task.resolvedAt === 'number' && Number.isFinite(task.resolvedAt) ? { resolvedAt: task.resolvedAt } : {}),
          ...(typeof task.summary === 'string' ? { summary: task.summary } : {}),
        })
      }
      this.tasks = restored.slice(0, TASK_CAP)
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
      const snapshot: TaskLedgerSnapshot = { tasks: this.tasks.map(task => ({ ...task })) }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break routing; the ledger degrades to
      // memory-only.
    }
  }
}
