// @vitest-environment node
/**
 * #eb6d20df: the receipt-protected gate (owed receipts + retained deliveries vs TASK_CAP 64) is its own limit, apart
 * from deliveryCapacity (512). The state route lists what holds each slot, and a refusal names the gate and its numbers.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'
import { deliveryFingerprint, TASK_DELIVERY_RETENTION_MS } from '../../src/task-delivery.ts'
import { createQueueGuard } from '../../src/queue-guard.ts'

const SESSION = 'session-aaaaaaaa11112222'
function full(n = 64) {
  const clock = { now: Date.parse('2026-11-22T19:00:00.000Z') }
  const ledger = new TaskLedger(join(mkdtempSync(join(tmpdir(), 'receipt-cap-')), 'tasks.json'), { now: () => clock.now })
  for (let i = 0; i < n; i++) {
    const taskId = 'orphan-' + String(i).padStart(2, '0')
    ledger.reserveDelivery({ version: 1, taskId, messageId: 'msg-' + i, sessionId: SESSION, fingerprint: deliveryFingerprint(SESSION, 'work ' + i), taskExpected: true, createdAt: clock.now + i, state: 'reserved' })
    ledger.updateDelivery(taskId, 'enqueued'); ledger.updateDelivery(taskId, 'claimed')
  }
  return { ledger, clock }
}

describe('#eb6d20df the receipt-protected gate on its own', () => {
  it('64 claimed deliveries with no ledger row fill it, while deliveryCapacity is nowhere near full', () => {
    const { ledger } = full()
    expect(ledger.deliveryBookkeepingState().orphaned).toBe(64)
    expect(ledger.deliveryCapacityState()).toMatchObject({ saturated: false })
    const s = ledger.receiptCapacityState()
    expect(s).toMatchObject({ cap: 64, owed: 0, retained: 64, available: false, truncated: 0 })
    expect(s.holders).toHaveLength(64)
    expect(s.holders[0]).toEqual({ taskId: 'orphan-00', kind: 'delivery', sessionId: SESSION, state: 'claimed', createdAt: Date.parse('2026-11-22T19:00:00.000Z'), releasesAt: Date.parse('2026-11-22T19:00:00.000Z') + TASK_DELIVERY_RETENTION_MS, orphaned: true })
    expect(ledger.receiptCapacityState(10)).toMatchObject({ truncated: 54 })
    expect(JSON.stringify(s)).not.toContain('work 0')
  })

  it('the refusal names this gate and its numbers, and says it is not deliveryCapacity', () => {
    const { ledger } = full()
    expect(() => ledger.trackInbound('new-work', 'alpha/aaaaaaaa', 'beta/bbbbbbbb')).toThrow(/^receipt-protected capacity is full \(owed receipts 0 \+ retained deliveries 64 >= TASK_CAP 64; this is not deliveryCapacity/)
  })

  it('the slots free when the retention ends', () => {
    const { ledger, clock } = full()
    clock.now += TASK_DELIVERY_RETENTION_MS + 64
    expect(ledger.receiptCapacityState()).toMatchObject({ retained: 0, available: true, holders: [] })
  })

  it('the queue guard sends the ledger\'s refusal text', () => {
    let sent = ''
    const guard = createQueueGuard(() => [], () => 8, () => false, { recordOutcome: () => {} } as never, () => {}, () => ({}), () => false, () => 'receipt-protected capacity is full (owed receipts 1 + retained deliveries 63 >= TASK_CAP 64; this is not deliveryCapacity); x')
    const res = { writeHead: () => res, end: (body: string) => { sent = body } }
    expect(guard('alpha/aaaaaaaa', 'work', 'beta/bbbbbbbb', 't-1', false, res as never)).toBe(true)
    expect(JSON.parse(sent).error).toContain('retained deliveries 63 >= TASK_CAP 64')
  })
})
