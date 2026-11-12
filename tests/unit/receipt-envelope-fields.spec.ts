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
import { formatReceipt, holdsRow, parseBy, parseReceipt, receiptExtras, receiptTaskId } from '../../src/receipt.ts'

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

  it('by carries the seat\'s role; an unknown role is dropped, a bad --by-role is refused', () => {
    const text = formatReceipt('t1', 'x', { idempotencyKey: 't1', disposition: 'acknowledged', by: { seat: 'dsh/aaaa1111', role: 'router' } })
    expect(parseReceipt(text)?.envelope?.by).toEqual({ seat: 'dsh/aaaa1111', role: 'router' })
    expect(parseReceipt(`[A2A receipt] task t1 x\n${JSON.stringify({ idempotencyKey: 't1', by: { seat: 's', role: 'boss' } })}`)?.envelope?.by).toEqual({ seat: 's' })
    expect(receiptExtras(flags({ '--by': 'dsh/aaaa1111', '--by-role': 'member' }), false, 'x')).toEqual({ fields: { by: { seat: 'dsh/aaaa1111', role: 'member' } } })
    expect(receiptExtras(flags({ '--by': 'dsh/aaaa1111', '--by-role': 'boss' }), false, 'x')).toHaveProperty('error')
    expect(receiptExtras(flags({ '--by-role': 'member' }), false, 'x')).toHaveProperty('error')
  })

  it('by carries the seat\'s stable seatId; a bad one is refused, and it goes with --by', () => {
    expect(receiptExtras(flags({ '--by': 'dsh/aaaa1111', '--by-seat-id': 'seat-1a2b3c4d', '--by-role': 'member' }), false, 'x')).toEqual({ fields: { by: { seat: 'dsh/aaaa1111', seatId: 'seat-1a2b3c4d', role: 'member' } } })
    expect(receiptExtras(flags({ '--by': 'dsh/aaaa1111', '--by-seat-id': 'seat/中文' }), false, 'x')).toHaveProperty('error')
    expect(receiptExtras(flags({ '--by-seat-id': 'seat-1a2b3c4d' }), false, 'x')).toHaveProperty('error')
    expect(parseBy({ seat: 'dsh/aaaa1111', seatId: 'has space' })).toEqual({ seat: 'dsh/aaaa1111' })
  })

  it('an artifact may carry a title for people; an over-long or non-text one is dropped, the item kept', () => {
    const text = formatReceipt('t1', 'x', { outcome: 'completed', idempotencyKey: 't1', disposition: 'result', artifacts: [{ kind: 'file', id: 'f1', title: '结论.txt, 179 字节' }, { kind: 'table', id: 'tb2' }] })
    expect(parseReceipt(text)?.envelope?.artifacts).toEqual([{ kind: 'file', id: 'f1', title: '结论.txt, 179 字节' }, { kind: 'table', id: 'tb2' }])
    expect(parseReceipt(`[A2A receipt] task t1 x\n${JSON.stringify({ idempotencyKey: 't1', artifacts: [{ kind: 'file', id: 'f1', title: 'x'.repeat(201) }, { kind: 'file', id: 'f2', title: 7 }] })}`)?.envelope?.artifacts)
      .toEqual([{ kind: 'file', id: 'f1' }, { kind: 'file', id: 'f2' }])
    expect(receiptExtras(flags({ '--artifacts': '[{"kind":"file","id":"f1","title":"a, b: c"},{"kind":"table","id":"t2"}]' }), false, 'x'))
      .toEqual({ fields: { artifacts: [{ kind: 'file', id: 'f1', title: 'a, b: c' }, { kind: 'table', id: 't2' }] } })
    for (const bad of ['[{"kind":"file"}]', '[not json', '[]']) expect(receiptExtras(flags({ '--artifacts': bad }), false, 'x'), bad).toHaveProperty('error')
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
