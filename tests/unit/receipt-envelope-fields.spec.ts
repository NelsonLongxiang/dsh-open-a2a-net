/**
 * market N1c/N1d/N2c (docs/design/receipt-envelope-fields.md): a receipt's added fields — who took the work up (`by`),
 * what it produced (`artifacts`), and an attention's structured question — and the question that marks the caller's row
 * instead of settling it, so the result receipt still follows.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'
import { formatReceipt, holdsRow, parseReceipt, receiptExtras, receiptTaskId } from '../../src/receipt.ts'

const flags = (values: Record<string, string>) => (name: string) => values[name]
const ledger = () => { let t = 1_000_000; return new TaskLedger(join(mkdtempSync(join(tmpdir(), 'dsh-a2a-fields-')), 'a2a', 'tasks.json'), { now: () => t++ }) }

describe('the added envelope fields', () => {
  it('round-trip through the codec after the existing keys, and older readers keep the rest', () => {
    const text = formatReceipt('t1', '完成', { outcome: 'completed', idempotencyKey: 't1', disposition: 'result', by: { seat: 'dsh/aaaa1111', name: '后端' }, artifacts: [{ kind: 'table', id: 'tb-9' }, { kind: 'file', id: 'f-2' }] })
    expect(text.split('\n')[1]).toBe('{"outcome":"completed","idempotencyKey":"t1","disposition":"result","by":{"seat":"dsh/aaaa1111","name":"后端"},"artifacts":[{"kind":"table","id":"tb-9"},{"kind":"file","id":"f-2"}]}')
    expect(parseReceipt(text)?.envelope).toEqual({ outcome: 'completed', idempotencyKey: 't1', disposition: 'result', by: { seat: 'dsh/aaaa1111', name: '后端' }, artifacts: [{ kind: 'table', id: 'tb-9' }, { kind: 'file', id: 'f-2' }] })
  })

  it('drop what is malformed: a by without a seat, artifact items without kind or id, a question off an attention', () => {
    const line = (o: unknown) => parseReceipt(`[A2A receipt] task t1 x\n${JSON.stringify(o)}`)?.envelope
    expect(line({ idempotencyKey: 't1', by: { name: 'n' } })).toEqual({ idempotencyKey: 't1' })
    expect(line({ idempotencyKey: 't1', artifacts: [{ kind: 'file' }, 'x', { kind: 'file', id: 'f1' }] })).toEqual({ idempotencyKey: 't1', artifacts: [{ kind: 'file', id: 'f1' }] })
    expect(line({ idempotencyKey: 't1', disposition: 'result', question: { id: 'q1', text: '?' } })).toEqual({ idempotencyKey: 't1', disposition: 'result' })
    expect(line({ idempotencyKey: 't1', disposition: 'attention', question: { id: 'bad id', text: '?' } })).toEqual({ idempotencyKey: 't1', disposition: 'attention' })
    expect(line({ idempotencyKey: 't1', disposition: 'attention', question: { id: 'q1', text: '哪个分支？', options: ['main', 'next', 3], default: 'main' } }))
      .toEqual({ idempotencyKey: 't1', disposition: 'attention', question: { id: 'q1', text: '哪个分支？', options: ['main', 'next'], default: 'main' } })
  })

  it('the switches build the fields or name what is wrong', () => {
    expect(receiptExtras(flags({ '--by': 'dsh/aaaa1111', '--by-name': '后端', '--artifacts': 'table:tb-9, sop-run:r1' }), false, 'x'))
      .toEqual({ fields: { by: { seat: 'dsh/aaaa1111', name: '后端' }, artifacts: [{ kind: 'table', id: 'tb-9' }, { kind: 'sop-run', id: 'r1' }] } })
    expect(receiptExtras(flags({ '--question-id': 'q1', '--options': 'main|next', '--default': 'main' }), true, '哪个分支？'))
      .toEqual({ fields: { question: { id: 'q1', text: '哪个分支？', options: ['main', 'next'], default: 'main' } } })
    for (const bad of [{ '--question-id': 'q1' }, { '--by-name': 'n' }, { '--artifacts': 'nocolon' }, { '--options': 'a|b' }]) {
      expect(receiptExtras(flags(bad), false, 'x'), JSON.stringify(bad)).toHaveProperty('error')
    }
    expect(receiptExtras(flags({ '--question-id': 'has space' }), true, 'x')).toHaveProperty('error')
  })

  it('a question rides its own task id; an acknowledgement and a result keep theirs', () => {
    expect(receiptTaskId('t1', 'attention', { id: 'q1', text: '?' })).toBe('attention-t1-q1')
    expect(receiptTaskId('t1', 'attention')).toBe('receipt-t1')
    expect(receiptTaskId('t1', 'acknowledged')).toBe('ack-t1')
    expect(receiptTaskId('t1', 'result')).toBe('receipt-t1')
  })
})

describe('an attention receipt with a question (N2c)', () => {
  const question = (task: string, id: string) => formatReceipt(task, '哪个分支？', { idempotencyKey: task, disposition: 'attention', question: { id, text: '哪个分支？' } })
  const result = (task: string) => formatReceipt(task, '已合并', { outcome: 'completed', idempotencyKey: task, disposition: 'result' })

  it('marks the owed row and settles nothing; more questions may follow; the result settles it with a machine outcome', () => {
    const l = ledger()
    l.track('t1', 'ops/canvas/build', 'peer')
    expect(holdsRow(parseReceipt(question('t1', 'q1'))?.envelope)).toBe(true)
    expect(l.resolveFromMessage(question('t1', 'q1'))).toMatchObject({ taskId: 't1', acknowledged: true, disposition: 'attention' })
    expect(l.find('t1')).toMatchObject({ status: 'pending' })
    expect(l.resolveFromMessage(question('t1', 'q2'))).toMatchObject({ acknowledged: true })
    expect(l.find('t1')).toMatchObject({ status: 'pending' })
    expect(l.resolveFromMessage(result('t1'))).toMatchObject({ taskId: 't1', outcome: 'completed', disposition: 'result' })
    expect(l.find('t1')).toBeUndefined()
  })

  it('an attention without a question still settles the task, as before', () => {
    const l = ledger()
    l.track('t2', 'ops/canvas/build', 'peer')
    const old = formatReceipt('t2', '哪个分支？', { idempotencyKey: 't2', disposition: 'attention' })
    expect(holdsRow(parseReceipt(old)?.envelope)).toBe(false)
    expect(l.resolveFromMessage(old)).toMatchObject({ taskId: 't2', disposition: 'attention' })
    expect(l.find('t2')).toBeUndefined()
  })
})
