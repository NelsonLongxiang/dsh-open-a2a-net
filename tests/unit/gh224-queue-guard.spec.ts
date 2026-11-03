/**
 * gh#224: the per-target queue cap — what counts as queued for a target, and when a new delivery
 * is refused (receipts and CLI mailboxes never are; cap 0 is off; a config without the key gets 3).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_TARGET_QUEUE_CAP, queueFullRefusal, queuedFor, type QueueRow } from '../../src/queue-guard.ts'

const T = 'dsh/ec4ce7f8'
const inbound = (extra: Partial<QueueRow> = {}): QueueRow => ({ team: T, peer: 'local:supervisor-seat/f1f4623c55e14e1c', status: 'pending', direction: 'inbound', ...extra })

describe('gh#224 queuedFor', () => {
  it('counts pending receipt-owing rows for the target: inbound by team or deliveredTo, and same-host routes', () => {
    const rows: QueueRow[] = [
      inbound(),
      inbound({ team: 'dsh/canvas/ops', deliveredTo: T }),
      { team: T, peer: 'local', status: 'pending', direction: 'outbound' },
    ]
    expect(queuedFor(rows, T)).toBe(3)
  })
  it('does not count settled or dead rows, fire-and-forget rows, other targets, or routes to a peer host', () => {
    const rows: QueueRow[] = [
      inbound({ status: 'archived' }),
      inbound({ status: 'dead' }),
      inbound({ receiptExpected: false }),
      inbound({ team: 'dsh/aaaa1111' }),
      { team: T, peer: 'http://10.0.0.9:3080', status: 'pending', direction: 'outbound' },
    ]
    expect(queuedFor(rows, T)).toBe(0)
  })
})

describe('gh#224 queueFullRefusal', () => {
  const three = [inbound(), inbound(), inbound()]
  it('admits below the cap and refuses at it, naming the count and the cap', () => {
    expect(queueFullRefusal(three.slice(0, 2), T, 'work', 3, false)).toBeUndefined()
    const refusal = queueFullRefusal(three, T, 'work', 3, false)
    expect(refusal).toContain('target-queue-full')
    expect(refusal).toContain('already has 3 task(s)')
    expect(refusal).toContain('cap 3')
  })
  it('never refuses a receipt or a CLI mailbox delivery; cap 0 is off', () => {
    expect(queueFullRefusal(three, T, '[A2A receipt] task direct-1 completed (done)', 3, false)).toBeUndefined()
    expect(queueFullRefusal(three, T, 'work', 3, true)).toBeUndefined()
    expect(queueFullRefusal(three, T, 'work', 0, false)).toBeUndefined()
  })
  it('a config without the key gets the shipped default, not "no cap"', () => {
    expect(DEFAULT_TARGET_QUEUE_CAP).toBe(3)
    expect(queueFullRefusal(three, T, 'work', undefined as unknown as number, false)).toContain('cap 3')
  })
})
