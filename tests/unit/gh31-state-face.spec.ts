// @vitest-environment node
/**
 * gh#31: the state face carries what the chat drawer had to guess —
 *   ① dead rows keep `direction` (the ledger stores it via trackInbound;
 *      the state projection used to drop it, so a reload lost which side
 *      said what);
 *   ② per-task outcomes for rows that left the ledger (`archived`,
 *      bounded to the archive, newest first) — the "已离开台账：已结算、
 *      放弃或撤回之一" ambiguity dies at the source.
 */
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'

describe('gh#31 state-face projection inputs', () => {
  it('① an inbound row keeps its direction after dead-lettering', () => {
    // Injected clock: start at t0, sweep sees t0+25h (past the 24h TTL).
    let t = 1_700_000_000_000
    const ledger = new TaskLedger('', { now: () => t })
    ledger.trackInbound('direct-in1', 'dsh/aaaaaaaa', 'peer-host:1', undefined, true, 'inbound brief')
    t += 25 * 60 * 60 * 1000
    const dead = ledger.list().find(r => r.taskId === 'direct-in1')
    expect(dead?.status).toBe('dead')
    expect(dead?.direction).toBe('inbound')
  })

  it('② the archive exposes per-task outcomes the drawer can look up', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-ok1', 'dsh/aaaaaaaa', 'peer-host:1', undefined, 'settles well')
    ledger.track('direct-ab1', 'dsh/aaaaaaaa', 'peer-host:1', undefined, 'gets abandoned')
    ledger.resolveFromMessage('[A2A receipt] task direct-ok1 completed nicely\n{"outcome":"completed"}')
    ledger.abandon('direct-ab1')
    const archived = ledger.archive().map(row => ({ taskId: row.taskId, outcome: row.outcome ?? 'unclassified' }))
    expect(archived).toContainEqual({ taskId: 'direct-ok1', outcome: 'completed' })
    expect(archived).toContainEqual({ taskId: 'direct-ab1', outcome: 'abandoned' })
  })
})
