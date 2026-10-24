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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskLedger, archivedEndedBy } from '../../src/task-ledger.ts'

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-gh31-')), 'a2a', 'tasks.json')
}

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

describe('gh#31 follow-up: how a row ended, and its direction, on the record', () => {
  it('③ records which path ended each row and its direction, newest first', () => {
    const ledger = new TaskLedger('')
    ledger.track('t-receipt', 'dsh/target', 'http://peer')
    ledger.track('t-echo', 'dsh/target', 'http://peer')
    ledger.track('t-abandon', 'dsh/target', 'http://peer')
    ledger.trackInbound('t-cancel', 'dsh/self', 'cargo/22222222')
    ledger.resolveFromMessage('[A2A receipt] task t-receipt done')
    ledger.resolveEcho('about task t-echo: here is the answer')
    ledger.abandon('t-abandon', 'budget')
    ledger.cancel('t-cancel', 'stop')
    const byId = new Map(ledger.archive().map(row => [row.taskId, row]))
    expect(byId.get('t-receipt')).toMatchObject({ endedBy: 'receipt', direction: 'outbound' })
    expect(byId.get('t-echo')?.endedBy).toBe('echo')
    expect(byId.get('t-abandon')?.endedBy).toBe('abandoned')
    expect(byId.get('t-cancel')).toMatchObject({ endedBy: 'cancelled', direction: 'inbound' })
    expect(ledger.archive().map(row => row.taskId)).toEqual(['t-cancel', 't-abandon', 't-echo', 't-receipt'])
  })

  it('④ a peer receipt that reports abandoned stays a receipt (only the caller ends a row as abandoned)', () => {
    const ledger = new TaskLedger('')
    ledger.track('t-1', 'dsh/target', 'http://peer')
    ledger.resolveFromMessage('[A2A receipt] task t-1 out of scope\n{"outcome":"abandoned"}')
    expect(ledger.archive()[0]).toMatchObject({ outcome: 'abandoned', endedBy: 'receipt' })
  })

  it('⑤ endedBy and direction survive a restart, owed rows keep outbound too', () => {
    const path = ledgerPath()
    const first = new TaskLedger(path)
    first.trackInbound('t-in', 'dsh/self', 'cargo/22222222')
    first.abandon('t-in')
    first.track('t-out', 'cargo/22222222', 'http://peer')
    const reloaded = new TaskLedger(path)
    expect(reloaded.archive()[0]).toMatchObject({ taskId: 't-in', endedBy: 'abandoned', direction: 'inbound' })
    expect(reloaded.list().find(row => row.taskId === 't-out')?.direction).toBe('outbound')
  })

  it('⑥ a legacy archive row derives its end from the ledger-written summary markers', () => {
    const path = ledgerPath()
    mkdirSync(join(path, '..'), { recursive: true })
    const base = { team: 'dsh/target', peer: 'http://peer', startedAt: 1, resolvedAt: 2 }
    writeFileSync(path, JSON.stringify({ tasks: [], archived: [
      { taskId: 'l-cancel', ...base, summary: 'caller-cancelled: stop' },
      { taskId: 'l-abandon', ...base, summary: 'caller-abandoned', outcome: 'abandoned' },
      { taskId: 'l-echo', ...base, summary: '(settled by content echo)' },
      { taskId: 'l-receipt', ...base, summary: 'shipped' },
    ] }))
    const ledger = new TaskLedger(path)
    expect(ledger.archive().map(row => [row.taskId, archivedEndedBy(row)])).toEqual([
      ['l-cancel', 'cancelled'], ['l-abandon', 'abandoned'], ['l-echo', 'echo'], ['l-receipt', 'receipt'],
    ])
  })

  it('⑦ a duplicate receipt does not turn a receipt-settled row into abandoned because of its summary text', () => {
    const ledger = new TaskLedger('')
    ledger.track('t-1', 'dsh/target', 'http://peer')
    ledger.resolveFromMessage('[A2A receipt] task t-1 caller-abandoned the old plan, shipped the new one')
    ledger.resolveFromMessage('[A2A receipt] task t-1 caller-abandoned the old plan, shipped the new one')
    const [row] = ledger.archive()
    expect(row?.endedBy).toBe('receipt')
    expect(row?.outcome).toBeUndefined()
    expect(row?.lateReceiptAt).toBeUndefined()
  })
})
