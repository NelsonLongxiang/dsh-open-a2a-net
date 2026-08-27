/**
 * Cooperative cancellation (work-order P1b): cancel() marks rows
 * `caller-cancelled` and echoes team/contextId for the route layer's live
 * notify half; late receipts against caller-ended rows collapse to outcome
 * 'abandoned' with lateReceiptAt isolation — across both prefixes.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatReceipt } from '../src/receipt.ts'
import { TaskLedger } from '../src/task-ledger.ts'

function tmpLedger(): { ledger: TaskLedger; file: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-cancel-')), 'tasks.json')
  return { ledger: new TaskLedger(file), file }
}

describe('task-ledger cancel', () => {
  it('clears a pending row as caller-cancelled and echoes the routing facts', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-1', 'dsh/target', 'http://peer', 'ctx-9')
    const result = ledger.cancel('t-1', 'turn superseded')
    expect(result).toMatchObject({
      outcome: 'cleared',
      taskId: 't-1',
      team: 'dsh/target',
      contextId: 'ctx-9',
    })
    expect(result.archivedAt).toBeTypeOf('number')
    const row = ledger.archive()[0]
    expect(row?.summary).toBe('caller-cancelled: turn superseded')
    expect(row?.outcome).toBe('abandoned')
    expect(ledger.list()).toHaveLength(0)
  })

  it('is idempotent: repeat cancels answer already-terminal with the original settle time', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-2', 'dsh/target', 'http://peer')
    const first = ledger.cancel('t-2')
    const second = ledger.cancel('t-2')
    expect(first.outcome).toBe('cleared')
    expect(second.outcome).toBe('already-terminal')
    expect(second.archivedAt).toEqual(first.archivedAt)
  })

  it('unknown / empty ids are total unknowns', () => {
    const { ledger } = tmpLedger()
    expect(ledger.cancel('ghost')).toMatchObject({ outcome: 'unknown' })
    expect(ledger.cancel('')).toMatchObject({ outcome: 'unknown' })
  })

  it('late receipts against a cancelled row isolate AND project to abandoned (both prefixes)', () => {
    const { ledger, file } = tmpLedger()
    ledger.track('c-1', 'dsh/x', 'http://p')
    ledger.track('a-1', 'dsh/x', 'http://p')
    ledger.cancel('c-1')
    ledger.abandon('a-1')
    ledger.resolveFromMessage(formatReceipt('c-1', 'target finished anyway', { outcome: 'completed' }))
    ledger.resolveFromMessage(formatReceipt('a-1', 'same for the abandoned twin'))
    for (const id of ['c-1', 'a-1']) {
      const row = ledger.archive().find(entry => entry.taskId === id)
      expect(row?.outcome).toBe('abandoned')
      expect(row?.lateReceiptAt).toBeTypeOf('number')
    }
    // Isolation survives restarts.
    const restored = new TaskLedger(file)
    expect(restored.archive().filter(entry => entry.lateReceiptAt !== undefined)).toHaveLength(2)
  })

  it('ordinary receipts remain untouched by the prefix widening', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-ok', 'dsh/x', 'local')
    ledger.resolveFromMessage('[A2A receipt] task t-ok clean finish')
    const row = ledger.archive()[0]
    expect(row?.summary).toBe('clean finish')
    expect(row?.outcome).toBeUndefined()
    expect(row?.lateReceiptAt).toBeUndefined()
  })
})
