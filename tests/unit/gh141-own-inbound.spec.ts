/**
 * gh#141: resolveFromMessage's row test — a receipt this node SENT settles
 * only the inbound row owed to the team it reached, and never refreshes an
 * archived row or another row of the same id.
 */
import { describe, expect, it } from 'vitest'
import { TaskLedger, type TaskRecord } from '../../src/task-ledger.ts'

const owedTo = (creditor: string) => (row: TaskRecord): boolean => row.direction === 'inbound' && row.peer === `local:${creditor}`

describe('gh#141 own-inbound settlement filter', () => {
  it('settles the inbound row owed to the receipt target, and only that one', () => {
    const ledger = new TaskLedger('', { now: () => 1_000 })
    ledger.trackInbound('direct-in1', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa', undefined, true, 'job')
    // Delivered to another team: the debt is to dsh/aaaaaaaa, so nothing settles.
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-in1 done', undefined, owedTo('dsh/cccccccc'))).toBeUndefined()
    expect(ledger.list().map(r => r.taskId)).toEqual(['direct-in1'])
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-in1 done', undefined, owedTo('dsh/aaaaaaaa'))).toMatchObject({ taskId: 'direct-in1', summary: 'done' })
    expect(ledger.list()).toEqual([])
    expect(ledger.archive()[0]).toMatchObject({ taskId: 'direct-in1', direction: 'inbound', endedBy: 'receipt' })
  })

  it('never touches an outbound row of the same id, nor refreshes an archived one', () => {
    const ledger = new TaskLedger('', { now: () => 1_000 })
    ledger.track('direct-out1', 'dsh/aaaaaaaa', 'http://peer:1')
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-out1 done', undefined, owedTo('dsh/aaaaaaaa'))).toBeUndefined()
    expect(ledger.list().map(r => r.taskId)).toEqual(['direct-out1'])
    ledger.trackInbound('direct-in2', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa', undefined, true, 'job')
    ledger.resolveFromMessage('[A2A receipt] task direct-in2 first', undefined, owedTo('dsh/aaaaaaaa'))
    // Without the test the late receipt would rewrite the archived summary; with it, nothing moves.
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-in2 second', undefined, owedTo('dsh/aaaaaaaa'))).toBeUndefined()
    expect(ledger.archive().find(r => r.taskId === 'direct-in2')?.summary).toBe('first')
  })
})
