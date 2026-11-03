/** gh#224 per-target queue cap (owner 2026-11-03: "at most 3 queued"). The flood guard (gh#91)
 * bounds a sender's RATE; a slow, steady sender can still pile a dozen unanswered tasks onto one
 * busy session. This counts what the target already owes and refuses a NEW delivery once the
 * count reaches the cap, visibly and before anything is steered or booked.
 *
 * Counted ("queued for T"): rows this host's ledger still holds pending for T that expect a
 * receipt — inbound rows born at /a2a/direct (addressed to T, or delivered to T), and same-host
 * routes (peer 'local') to T. Never refused: a receipt for a task this host's ledger holds
 * (terminal; refusing one strands that row — a genuine receipt always returns to the host that
 * booked its task, so a '[A2A receipt]' header naming an unknown id is ordinary traffic and is
 * counted), and deliveries into a CLI mailbox (its own 64-mail bound applies). A canvas team is
 * one target: a full queue refuses the team as addressed, remote members included.
 */
import type { ServerResponse } from 'node:http'
import type { IdempotencyStore } from './idempotency-store.ts'
import { parseReceipt } from './receipt.ts'

export const WIRE_ERROR_QUEUE_FULL = -32009
export const DEFAULT_TARGET_QUEUE_CAP = 3

/** The ledger fields the count reads. */
export interface QueueRow {
  readonly team: string
  readonly peer: string
  readonly status: string
  readonly direction?: string
  readonly receiptExpected?: boolean
  readonly deliveredTo?: string
}

/** How many receipt-owing tasks this host holds pending for `team`. */
export function queuedFor(rows: readonly QueueRow[], team: string): number {
  return rows.filter(row => row.status === 'pending' && row.receiptExpected !== false &&
    (row.direction === 'inbound' || row.peer === 'local') &&
    (row.team === team || row.deliveredTo === team)).length
}

/** The refusal text when `team`'s queue is full, else undefined. `cap <= 0` disables the guard. */
export function queueFullRefusal(rows: readonly QueueRow[], team: string, message: string, cap: number, mailbox: boolean, ownTask: (taskId: string) => boolean): string | undefined {
  // A config without the key (old patch layer, test harness) gets the shipped default, not "no cap".
  const limit = typeof cap === 'number' && Number.isFinite(cap) ? cap : DEFAULT_TARGET_QUEUE_CAP
  if (limit <= 0 || mailbox) return undefined
  const receipt = parseReceipt(message)
  if (receipt !== null && receipt.taskId !== '' && ownTask(receipt.taskId)) return undefined
  const queued = queuedFor(rows, team)
  if (queued < limit) return undefined
  return `target-queue-full (gh#224): "${team}" already has ${String(queued)} task(s) waiting for a receipt (cap ${String(limit)}) — nothing was delivered. Wait for a receipt from it (a2a inbox / a2a_tasks), or send again later with a NEW task id (this one is recorded as failed); do not resend in a loop. A task that never gets a receipt turns dead after taskStaleTtlMs and stops counting.`
}

/** Wire-face adapter in the flood guard's shape: a refused fresh key is FAILED, not stranded pending. */
export function createQueueGuard(
  rows: () => readonly QueueRow[],
  cap: () => number,
  ownTask: (taskId: string) => boolean,
  outcomes: Pick<IdempotencyStore, 'recordOutcome'>,
  recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void,
): (caller: string, message: string, team: string, taskId: string, mailbox: boolean, res: ServerResponse) => boolean {
  return (caller, message, team, taskId, mailbox, res) => {
    const error = queueFullRefusal(rows(), team, message, cap(), mailbox, ownTask)
    if (error === undefined) return false
    outcomes.recordOutcome(taskId, { status: 'failed', error })
    recordActivity('in', team, caller, false)
    const payload = JSON.stringify({ error, reason: 'target-queue-full', code: WIRE_ERROR_QUEUE_FULL, task_id: taskId, team, delivered: false, task_status: 'TASK_STATE_FAILED' })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
    return true
  }
}
