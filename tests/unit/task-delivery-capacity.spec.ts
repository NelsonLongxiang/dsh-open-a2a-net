import { describe, it, expect } from 'vitest'
import { TASK_DELIVERY_CAP as CAP, TASK_DELIVERY_RETENTION_MS as TTL, type TaskDelivery } from '../../src/task-delivery.ts'
import { deliveryRetainedByRule, deliveryCapacitySnapshot, parseDeliveryCapacitySnapshot, type DeliveryCapacitySnapshot, type DeliveryCapacityInput } from '../../src/task-delivery-capacity.ts'

const NOW = TTL * 2
const healthy = { ledgerDamaged: false, deliveryRestoreError: false, persistenceOK: true }
const row = (n = 0, createdAt = NOW, state: TaskDelivery['state'] = 'cancelled'): TaskDelivery => ({
  version: 1, taskId: 'private-task-' + n, sessionId: 'private-session', messageId: 'private-message-' + n,
  fingerprint: 'a'.repeat(64), createdAt, state,
})
const input = (deliveries: readonly TaskDelivery[] = [], taskIds: ReadonlySet<string> = new Set(), now = NOW): DeliveryCapacityInput => ({ deliveries, taskIds, now, health: { ...healthy } })
const observe = (i = input()) => {
  const result = deliveryCapacitySnapshot(i)
  expect(result.status).toBe('observed')
  if (result.status !== 'observed') throw Error('Unexpected unavailable capacity observation')
  return result
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

describe('#713 pure correspondence-capacity observation (not admission)', () => {
  it('observes empty input without promising admission or safe retry', () => {
    expect(observe()).toEqual({ status: 'observed', observedAt: NOW, capacity: CAP, retentionMs: TTL,
      stored: 0, retained: 0, expiredUntracked: 0, taskBound: 0, saturated: false,
      retainedByState: { reserved: 0, enqueued: 0, claimed: 0, cancelled: 0, failed: 0 }, earliestPossibleExpiryAt: null })
    expect(JSON.stringify(observe())).not.toMatch(/retryAt|availableAt|safeToRetry|freeSlots/)
  })

  it.each([511, 512])('counts %i retained mappings including receipt-only/sync mappings', count => {
    const rows = Array.from({ length: count }, (_, n) => ({ ...row(n), ...(n % 2 ? { taskExpected: true as const } : {}) }))
    const result = observe(input(rows))
    expect(result.stored).toBe(count); expect(result.retained).toBe(count)
    expect(result.taskBound).toBe(0); expect(result.saturated).toBe(count === CAP)
    expect(result.retainedByState.cancelled).toBe(count)
  })

  it.each(['reserved', 'enqueued', 'claimed', 'cancelled', 'failed'] as const)('retains %s at exact TTL, only expires untracked at TTL+1', state => {
    const rows = [row(0, NOW - TTL, state)]
    const exact = observe(input(rows))
    expect(exact.retained).toBe(1); expect(exact.expiredUntracked).toBe(0)
    expect(exact.earliestPossibleExpiryAt).toBe(NOW + 1)
    expect(exact.retainedByState[state]).toBe(1)
    const later = observe(input(rows, new Set(), NOW + 1))
    expect(later.stored).toBe(1); expect(later.retained).toBe(0); expect(later.expiredUntracked).toBe(1)
    expect(later.earliestPossibleExpiryAt).toBeNull()
  })

  it('keeps both pending- and dead-task-bound mappings independently of age or delivery state', () => {
    const rows = [row(0, 0, 'claimed'), row(1, 0, 'failed'), row(2, 0, 'cancelled')]
    const result = observe(input(rows, new Set([rows[0]!.taskId, rows[1]!.taskId])))
    expect(result.taskBound).toBe(2); expect(result.retained).toBe(2); expect(result.expiredUntracked).toBe(1)
    expect(result.earliestPossibleExpiryAt).toBeNull()
    expect(Object.values(result.retainedByState).reduce((a, b) => a + b, 0)).toBe(result.retained)
  })

  it('retains future timestamps on clock rollback without a negative expiry or immediate retry promise', () => {
    const result = observe(input([row(0, NOW + TTL)], new Set(), NOW - 1))
    expect(result.retained).toBe(1); expect(result.earliestPossibleExpiryAt).toBe(NOW + TTL * 2 + 1)
  })

  it('uses the earliest representable unbound expiry, not array order or an old bound entry', () => {
    const rows = [row(0, NOW + 30), row(1, NOW + 10), row(2, 0), row(3, NOW - TTL - 1)]
    const result = observe(input(rows, new Set([rows[2]!.taskId])))
    expect(result.stored).toBe(4); expect(result.retained).toBe(3); expect(result.expiredUntracked).toBe(1)
    expect(result.earliestPossibleExpiryAt).toBe(NOW + 10 + TTL + 1)
  })

  it('reports an overflowing integer expiry as unknown/null without treating the record as expired', () => {
    const result = observe(input([row(0, Number.MAX_SAFE_INTEGER)], new Set(), Number.MAX_SAFE_INTEGER))
    expect(result.retained).toBe(1); expect(result.earliestPossibleExpiryAt).toBeNull()
    expect(parseDeliveryCapacitySnapshot(result)).toEqual(result)
  })

  it.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid observed clock %s instead of healthy zero', now => {
    expect(deliveryCapacitySnapshot(input([], new Set(), now))).toEqual({ status: 'unavailable', reason: 'invalid-clock' })
  })

  it.each([
    ['ledgerDamaged', 'ledger-damaged'], ['deliveryRestoreError', 'correspondence-damaged'], ['persistenceOK', 'persistence-failed'],
  ] as const)('preserves %s unavailability and never advertises a free/healthy table', (key, reason) => {
    const value = input(Array.from({ length: CAP }, (_, n) => row(n)))
    value.health[key] = key === 'persistenceOK' ? false : true
    expect(deliveryCapacitySnapshot(value)).toEqual({ status: 'unavailable', reason })
  })

  it('does not default missing health signals to healthy zero', () => {
    const value = input(); value.health = {} as DeliveryCapacityInput['health']
    expect(deliveryCapacitySnapshot(value)).toEqual({ status: 'unavailable', reason: 'health-unavailable' })
  })

  it('matches the installed retention predicate for every state and task-binding combination', () => {
    for (const state of ['reserved', 'enqueued', 'claimed', 'cancelled', 'failed'] as const) {
      for (const age of [-TTL, 0, TTL - 1, TTL, TTL + 1, NOW]) for (const bound of [false, true]) {
        const r = row(0, NOW - age, state), tasks = new Set(bound ? [r.taskId] : [])
        expect(deliveryRetainedByRule(r, tasks, NOW)).toBe(tasks.has(r.taskId) || NOW - r.createdAt <= TTL)
      }
    }
  })

  it('does not prune, sort, mutate or retain references to its source or returned snapshots', () => {
    const rows = [row(0, 0), row(1, NOW + 1, 'reserved'), row(2, NOW, 'enqueued')]
    rows.forEach(Object.freeze); Object.freeze(rows)
    const value = input(rows), original = JSON.stringify(rows), result = observe(value), expected = clone(result)
    result.retainedByState.enqueued = 99; result.stored = 0
    expect(observe(value)).toEqual(expected); expect(JSON.stringify(rows)).toBe(original)
    expect(rows).toHaveLength(3); expect(rows[0]!.createdAt).toBe(0)
  })

  it('shows possible eligibility is lost when another request takes a slot or an old task becomes bound', () => {
    const rows = Array.from({ length: CAP }, (_, n) => row(n, NOW - TTL))
    expect(observe(input(rows, new Set(), NOW + 1)).retained).toBe(0)
    const rebound = observe(input(rows, new Set(rows.map(r => r.taskId)), NOW + 1))
    expect(rebound.retained).toBe(CAP); expect(rebound.saturated).toBe(true); expect(rebound.earliestPossibleExpiryAt).toBeNull()
    const replaced = Array.from({ length: CAP }, (_, n) => row(n + CAP, NOW + 1))
    expect(observe(input(replaced, new Set(), NOW + 1)).saturated).toBe(true)
  })

  it.each(['duplicate-task', 'duplicate-message', 'bad-state', 'bad-time', 'bad-key', 'oversized'] as const)('refuses invalid entries: %s', fault => {
    let rows: TaskDelivery[] = [row(), row(1)]
    if (fault === 'duplicate-task') rows[1]!.taskId = rows[0]!.taskId
    if (fault === 'duplicate-message') rows[1]!.messageId = rows[0]!.messageId
    if (fault === 'bad-state') rows[1]!.state = 'unknown' as TaskDelivery['state']
    if (fault === 'bad-time') rows[1]!.createdAt = -1
    if (fault === 'bad-key') rows[1]!.fingerprint = 'bad'
    if (fault === 'oversized') rows = Array.from({ length: CAP + 1 }, (_, n) => row(n))
    expect(deliveryCapacitySnapshot(input(rows))).toEqual({ status: 'unavailable', reason: 'invalid-entries' })
  })

  it('never includes private occurrence identities, raw error details or task content', () => {
    const result = observe(input([Object.assign(row(), { callerKey: 'private-caller', text: 'private-business' })]))
    const rendered = JSON.stringify(result)
    expect(rendered).not.toMatch(/private-|fingerprint|sessionId|messageId|callerKey|taskId/)
  })
})

describe('#713 bounded capacity DTO decoder (not a wired transport yet)', () => {
  it('round-trips detached observed and unavailable snapshots', () => {
    for (const v of [observe(input([row()])), { status: 'unavailable', reason: 'ledger-damaged' } as const]) {
      const r = parseDeliveryCapacitySnapshot(v)
      expect(r).toEqual(v); expect(r).not.toBe(v)
      if (r?.status === 'observed' && v.status === 'observed') { r.retainedByState.cancelled = 0; expect(v.retainedByState.cancelled).toBe(1) }
    }
  })

  it.each([undefined, null, [], 0, '', { status: 'unavailable', reason: 'legacy-guess' }, { status: 'unavailable', reason: 'ledger-damaged', taskId: 'private' }])('keeps legacy/malformed output unknown: %j', raw => {
    expect(parseDeliveryCapacitySnapshot(raw)).toBeUndefined()
  })

  it.each([
    ['capacity', 513], ['retentionMs', 1], ['observedAt', NaN], ['observedAt', -1], ['stored', -1], ['stored', 513],
    ['retained', 2], ['expiredUntracked', 1], ['taskBound', 2], ['saturated', true], ['status', 'available'],
    ['earliestPossibleExpiryAt', NOW], ['earliestPossibleExpiryAt', Infinity], ['earliestPossibleExpiryAt', Number.MAX_SAFE_INTEGER + 1],
  ])('refuses inconsistent field %s=%s', (key, bad) => {
    const value = clone(observe(input([row()]))); (value as unknown as Record<string, unknown>)[key as string] = bad
    expect(parseDeliveryCapacitySnapshot(value)).toBeUndefined()
  })

  it('rejects state-count mismatch, unknown keys and identity-bearing fields', () => {
    const original = observe(input([row()]))
    for (const altered of [
      { ...original, retainedByState: { ...original.retainedByState, cancelled: 0 } },
      { ...original, retainedByState: { ...original.retainedByState, failed: -1 } },
      { ...original, retainedByState: { ...original.retainedByState, unknown: 0 } },
      { ...original, taskId: 'private' },
    ]) expect(parseDeliveryCapacitySnapshot(altered)).toBeUndefined()
  })

  it('rejects an advertised expiry when every retained mapping is task-bound', () => {
    const result = observe(input([row()], new Set([row().taskId])))
    expect(result.earliestPossibleExpiryAt).toBeNull()
    expect(parseDeliveryCapacitySnapshot({ ...result, earliestPossibleExpiryAt: NOW + TTL + 1 })).toBeUndefined()
  })
})
