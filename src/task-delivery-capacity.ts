/** #713: pure, detached observations, not delivery admission or retry authority.
 * The caller must provide its actual ledger health; this module never reads or mutates a ledger.
 * Runtime/schema/CLI integration is a separate slice with its own effect-boundary tests.
 */
import { parseTaskDelivery, TASK_DELIVERY_CAP, TASK_DELIVERY_RETENTION_MS, type TaskDelivery } from './task-delivery.ts'

const STATES = ['reserved', 'enqueued', 'claimed', 'cancelled', 'failed'] as const
const UNAVAILABLE_REASONS = ['health-unavailable', 'ledger-damaged', 'correspondence-damaged', 'persistence-failed', 'invalid-clock', 'invalid-entries'] as const
export type DeliveryCapacityUnavailableReason = typeof UNAVAILABLE_REASONS[number]
export type DeliveryCapacitySnapshot =
  | { status: 'unavailable'; reason: DeliveryCapacityUnavailableReason }
  | {
      status: 'observed'
      observedAt: number
      capacity: number
      retentionMs: number
      stored: number
      retained: number
      expiredUntracked: number
      taskBound: number
      saturated: boolean
      /** Denominator: retained, not stored or receipt-owing tasks. */
      retainedByState: Record<TaskDelivery['state'], number>
      /** Possible expiry under the current rule, never a promise of a free slot or safe retry. */
      earliestPossibleExpiryAt: number | null
    }

export interface DeliveryCapacityInput {
  deliveries: readonly TaskDelivery[]
  /** All still-stored tasks, including dead rows, not just unanswered receipt debt. */
  taskIds: ReadonlySet<string>
  now: number
  health: { ledgerDamaged: boolean; deliveryRestoreError: boolean; persistenceOK: boolean }
}

/** Exact existing retention predicate; no state-based early eviction. Wire this into reserve only in the integration slice. */
export function deliveryRetainedByRule(row: Pick<TaskDelivery, 'taskId' | 'createdAt'>, taskIds: ReadonlySet<string>, now: number): boolean {
  return taskIds.has(row.taskId) || now - row.createdAt <= TASK_DELIVERY_RETENTION_MS
}

const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const unavailable = (reason: DeliveryCapacityUnavailableReason): DeliveryCapacitySnapshot => ({ status: 'unavailable', reason })

export function deliveryCapacitySnapshot(input: DeliveryCapacityInput): DeliveryCapacitySnapshot {
  const { health, now, deliveries, taskIds } = input
  if (!health || typeof health.ledgerDamaged !== 'boolean' || typeof health.deliveryRestoreError !== 'boolean' || typeof health.persistenceOK !== 'boolean') return unavailable('health-unavailable')
  if (health.ledgerDamaged) return unavailable('ledger-damaged')
  if (health.deliveryRestoreError) return unavailable('correspondence-damaged')
  if (!health.persistenceOK) return unavailable('persistence-failed')
  if (!integer(now)) return unavailable('invalid-clock')
  if (!Array.isArray(deliveries) || deliveries.length > TASK_DELIVERY_CAP) return unavailable('invalid-entries')

  const retainedByState = { reserved: 0, enqueued: 0, claimed: 0, cancelled: 0, failed: 0 }
  const taskKeys = new Set<string>(), messageKeys = new Set<string>()
  let retained = 0, taskBound = 0, earliestPossibleExpiryAt: number | null = null
  for (const raw of deliveries) {
    const row = parseTaskDelivery(raw)
    if (!row) return unavailable('invalid-entries')
    const messageKey = JSON.stringify([row.sessionId, row.messageId])
    if (taskKeys.has(row.taskId) || messageKeys.has(messageKey)) return unavailable('invalid-entries')
    taskKeys.add(row.taskId); messageKeys.add(messageKey)
    const bound = taskIds.has(row.taskId)
    if (bound) taskBound++
    if (!deliveryRetainedByRule(row, taskIds, now)) continue
    retained++
    retainedByState[row.state]++
    // The inclusive horizon expires one integer millisecond later. Do not round unsafe additions.
    if (!bound && row.createdAt <= Number.MAX_SAFE_INTEGER - TASK_DELIVERY_RETENTION_MS - 1) {
      const expires = row.createdAt + TASK_DELIVERY_RETENTION_MS + 1
      if (earliestPossibleExpiryAt === null || expires < earliestPossibleExpiryAt) earliestPossibleExpiryAt = expires
    }
  }
  return {
    status: 'observed', observedAt: now, capacity: TASK_DELIVERY_CAP, retentionMs: TASK_DELIVERY_RETENTION_MS,
    stored: deliveries.length, retained, expiredUntracked: deliveries.length - retained, taskBound,
    saturated: retained >= TASK_DELIVERY_CAP, retainedByState, earliestPossibleExpiryAt,
  }
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))

/** A bounded wire DTO, not an Error spread. Missing legacy fields remain unknown, never healthy zero. */
export function parseDeliveryCapacitySnapshot(raw: unknown): DeliveryCapacitySnapshot | undefined {
  if (!object(raw)) return undefined
  if (raw.status === 'unavailable') {
    if (!exactKeys(raw, ['status', 'reason']) || !UNAVAILABLE_REASONS.some(reason => reason === raw.reason)) return undefined
    return { status: 'unavailable', reason: raw.reason as DeliveryCapacityUnavailableReason }
  }
  if (raw.status !== 'observed' || !exactKeys(raw, ['status', 'observedAt', 'capacity', 'retentionMs', 'stored', 'retained', 'expiredUntracked', 'taskBound', 'saturated', 'retainedByState', 'earliestPossibleExpiryAt'])) return undefined
  const { observedAt, stored, retained, expiredUntracked, taskBound, retainedByState: counts, earliestPossibleExpiryAt: expiry } = raw
  if (!integer(observedAt) || raw.capacity !== TASK_DELIVERY_CAP || raw.retentionMs !== TASK_DELIVERY_RETENTION_MS) return undefined
  if (!integer(stored) || stored > TASK_DELIVERY_CAP || !integer(retained) || retained > stored || !integer(expiredUntracked) || expiredUntracked !== stored - retained || !integer(taskBound) || taskBound > retained) return undefined
  if (raw.saturated !== (retained >= TASK_DELIVERY_CAP) || !object(counts) || !exactKeys(counts, STATES)) return undefined
  let sum = 0
  for (const state of STATES) { const n = counts[state]; if (!integer(n) || n > retained) return undefined; sum += n }
  if (sum !== retained || (expiry !== null && (!integer(expiry) || expiry < TASK_DELIVERY_RETENTION_MS + 1 || expiry <= observedAt || retained === taskBound))) return undefined
  return {
    status: 'observed', observedAt, capacity: TASK_DELIVERY_CAP, retentionMs: TASK_DELIVERY_RETENTION_MS,
    stored, retained, expiredUntracked, taskBound, saturated: raw.saturated as boolean,
    retainedByState: { reserved: counts.reserved as number, enqueued: counts.enqueued as number, claimed: counts.claimed as number, cancelled: counts.cancelled as number, failed: counts.failed as number },
    earliestPossibleExpiryAt: expiry as number | null,
  }
}
