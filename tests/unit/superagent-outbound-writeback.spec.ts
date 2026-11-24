// @vitest-environment node
/**
 * superagent-outbound-requests.md O5 (ticket c9205cf6): an ordinary outbound request is answered only by a final receipt,
 * its answer is stored before its note, and the note is written exactly once — after a restart, after a failed write, or
 * when it was already written before the checkpoint. An answer for an ended ticket is marked, never reopened or resent.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { rmSync, statSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OutboundRequests, writeTicketNoteOnce, type NoteResult } from '../../src/superagent/host/outbound.ts'
import { formatReceipt, holdsRow, parseReceipt } from '../../src/receipt.ts'

const quiet = { warn: () => {} }
const now = () => '2026-11-24T06:00:00.000Z'
const TASK = 'direct-out000001', ADDR = 'dsh/canvas/other'
type Ticket = { ended?: string; inputs: Array<{ kind: string; text?: string }> }

/** A ticket store with an idempotent note writer that can be made to fail the next n writes. */
function host() {
  const tickets = new Map<string, Ticket>([['t1', { inputs: [] }]])
  const writes: string[] = []
  let fail = 0
  const noteOnce = (id: string, text: string): NoteResult => writeTicketNoteOnce(tickets.get(id), text, t => {
    if (fail > 0) { fail -= 1; throw Error('ticket store busy') }
    writes.push(t); tickets.get(id)!.inputs.push({ kind: 'note', text: t })
  })
  return { tickets, writes, noteOnce, failNext: (n: number) => { fail = n } }
}
const fresh = () => join(mkdtempSync(join(tmpdir(), 'sa-outwb-')), 'outbound.json')
const open = (path: string, h: ReturnType<typeof host>, ask = vi.fn(async () => TASK as string | undefined)) =>
  ({ out: new OutboundRequests({ path, ask, note: vi.fn(), noteOnce: h.noteOnce, logger: quiet, now }), ask })
async function sent(path: string, h: ReturnType<typeof host>) {
  const m = open(path, h)
  m.out.waiting('c1', 't1', ADDR, '原文', 'session-m')
  expect(await m.out.decided('c1', true, 'team', () => '调研')).toBe(TASK)
  return m
}
const trigger = (id: string, text: string, proof = 'cli-identity') => ({ id, source: 'a2a', threads: [], actor: { source: 'a2a', id: ADDR }, human: false, at: now(), text, meta: { receiptFor: TASK, proof } }) as never
const ACK = formatReceipt(TASK, '已收到，处理中', { disposition: 'acknowledged' })
const ASKING = formatReceipt(TASK, '需要确认版本', { disposition: 'attention', question: { id: 'q1', text: '用哪个版本？' } })
const RESULT = formatReceipt(TASK, '数据在附件里', { outcome: 'completed' })
const answerNotes = (h: ReturnType<typeof host>) => h.writes.filter(w => w.includes('的回执：'))

describe('O5: interim receipts keep the request open; only a final receipt answers it', () => {
  it('the fixtures are what they say: ACK and attention-with-question hold the row, the result does not', () => {
    expect(holdsRow(parseReceipt(ACK)?.envelope)).toBe(true)
    expect(holdsRow(parseReceipt(ASKING)?.envelope)).toBe(true)
    expect(holdsRow(parseReceipt(RESULT)?.envelope)).toBe(false)
  })

  it('ACK, then an attention, then the result: the result still matches and is noted once', async () => {
    const h = host(), { out } = await sent(fresh(), h)
    out.received(trigger('r1', ACK))
    expect(out.list()[0]).toMatchObject({ state: 'sent' })
    expect(out.list()[0]!.answer).toBeUndefined()
    out.received(trigger('r2', ASKING))
    expect(out.list()[0]).toMatchObject({ state: 'sent' })
    expect(h.writes.filter(w => w.includes('进展（尚未结束）'))).toHaveLength(2)
    out.received(trigger('r3', RESULT))
    expect(out.list()[0]).toMatchObject({ state: 'answered', noted: true, answer: { key: 'r3' } })
    expect(answerNotes(h)).toHaveLength(1)
    expect(answerNotes(h)[0]).toContain('数据在附件里')
    out.received(trigger('r4', RESULT))
    expect(answerNotes(h)).toHaveLength(1)
  })
})

describe('O5: the final/interim line is the task ledger\'s (#881 review B3)', () => {
  it('an attention without a question and an outcome of unknown are final answers, as the ledger settles them', async () => {
    const ATTENTION = formatReceipt(TASK, '请注意这个结果', { disposition: 'attention' })
    const UNKNOWN = formatReceipt(TASK, '结果不确定', { outcome: 'unknown' })
    expect(holdsRow(parseReceipt(ATTENTION)?.envelope)).toBe(false)
    expect(holdsRow(parseReceipt(UNKNOWN)?.envelope)).toBe(false)
    for (const [text, says] of [[ATTENTION, '请注意这个结果'], [UNKNOWN, '结果不确定']] as const) {
      const h = host(), { out } = await sent(fresh(), h)
      out.received(trigger('r1', text))
      expect(out.list()[0]).toMatchObject({ state: 'answered', noted: true })
      expect(answerNotes(h)[0]).toContain(says)
    }
  })

  it('interim receipts are not stored: fifty of them leave the outbound file as it was after the first (4 MiB recovery bound)', async () => {
    const path = fresh(), h = host(), { out } = await sent(path, h)
    out.received(trigger('a0', ACK))
    const size = statSync(path).size
    for (let i = 1; i <= 50; i += 1) out.received(trigger(`a${String(i)}`, ACK))
    expect(statSync(path).size).toBe(size)
    expect(out.list()[0]).toMatchObject({ state: 'sent' })
  })
})

describe('O5: the answer is stored before its note, and the note is written exactly once', () => {
  it('a restart after the answer was stored but before its note: the next instance writes it', async () => {
    const path = fresh(), h = host(), { out } = await sent(path, h)
    h.failNext(1)
    out.received(trigger('r1', RESULT))
    expect(out.list()[0]).toMatchObject({ state: 'answered' })
    expect(out.list()[0]!.noted).toBeUndefined()
    expect(out.noteProblems()).toMatchObject([{ kind: 'pending', ticketId: 't1', task: TASK }])
    const again = open(path, h).out
    again.flushOutboundNotes()
    expect(answerNotes(h)).toHaveLength(1)
    expect(again.list()[0]).toMatchObject({ noted: true })
    expect(again.noteProblems()).toEqual([])
    expect(open(path, h).out.list()[0]).toMatchObject({ noted: true })
  })

  it('a failed note stays owed and is retried until it is written, once', async () => {
    const h = host(), { out } = await sent(fresh(), h)
    h.failNext(2)
    out.received(trigger('r1', RESULT))
    out.flushOutboundNotes()
    expect(answerNotes(h)).toHaveLength(0)
    expect(out.noteProblems()).toHaveLength(1)
    out.flushOutboundNotes()
    out.flushOutboundNotes()
    expect(answerNotes(h)).toHaveLength(1)
    expect(out.noteProblems()).toEqual([])
  })

  it('a note already in the ticket (written before the checkpoint was stored) is not written again', async () => {
    const h = host(), { out } = await sent(fresh(), h)
    h.failNext(1)
    out.received(trigger('r1', RESULT))
    const owed = out.list()[0]!
    h.tickets.get('t1')!.inputs.push({ kind: 'note', text: `对外请求（${ADDR}，task ${TASK}）的回执：${owed.answer!.text}` })
    const before = h.writes.length
    out.flushOutboundNotes()
    expect(h.writes.length).toBe(before)
    expect(h.tickets.get('t1')!.inputs.filter(i => i.kind === 'note' && i.text?.includes('的回执：'))).toHaveLength(1)
    expect(out.list()[0]).toMatchObject({ noted: true })
  })
})

describe('O5: an answer for an ended ticket', () => {
  it('is marked as an anomaly: the ticket is not written to or reopened, and the request is not sent again', async () => {
    const h = host(), { out, ask } = await sent(fresh(), h)
    h.tickets.get('t1')!.ended = '2026-11-24T05:00:00.000Z'
    out.received(trigger('r1', RESULT))
    expect(out.list()[0]).toMatchObject({ state: 'answered', noteBlocked: 'ticket-ended' })
    expect(out.list()[0]!.noted).toBeUndefined()
    expect(answerNotes(h)).toHaveLength(0)
    expect(out.noteProblems()).toMatchObject([{ kind: 'ticket-ended', ticketId: 't1' }])
    out.flushOutboundNotes()
    expect(answerNotes(h)).toHaveLength(0)
    expect(h.tickets.get('t1')!.ended).toBe('2026-11-24T05:00:00.000Z')
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe('#882 review: one failing checkpoint, and a receipt line for another task', () => {
  it('a checkpoint that cannot be saved stays owed and does not stop the other owed notes in the same pass', async () => {
    const path = fresh(), h = host()
    h.tickets.set('t2', { inputs: [] })
    const { out } = await sent(path, h)
    out.waiting('c2', 't2', ADDR, '原文二', 'session-m')
    const second = vi.fn(async () => 'direct-out000002' as string | undefined)
    const two = new OutboundRequests({ path, ask: second, note: vi.fn(), noteOnce: h.noteOnce, logger: quiet, now })
    await two.decided('c2', true, 'team', () => '调研')
    // r1's note fails on its answer and again on r2's pass; r2's own note fails once: both stay owed.
    h.failNext(3)
    two.received(trigger('r1', RESULT))
    two.received({ ...(trigger('r2', formatReceipt('direct-out000002', '第二份结果', { outcome: 'completed' })) as object), meta: { receiptFor: 'direct-out000002', proof: 'cli-identity' } } as never)
    expect(two.noteProblems()).toHaveLength(2)
    writeFileSync(path + '.lock', 'held')
    two.flushOutboundNotes()
    expect(answerNotes(h)).toHaveLength(2)
    expect(two.noteProblems()).toHaveLength(2)
    rmSync(path + '.lock')
    two.flushOutboundNotes()
    expect(answerNotes(h)).toHaveLength(2)
    expect(two.noteProblems()).toEqual([])
  })

  it('a receipt whose receipt line names another task does not touch this request', async () => {
    const h = host(), { out } = await sent(fresh(), h)
    out.received(trigger('r1', formatReceipt('direct-out999999', '别的任务的结果', { outcome: 'completed' })))
    expect(out.list()[0]).toMatchObject({ state: 'sent' })
    expect(out.list()[0]!.answer).toBeUndefined()
    expect(h.writes).toHaveLength(0)
  })
})

describe('writeTicketNoteOnce', () => {
  it('missing ticket fails; ended is ended; the same note already there counts as written; a throw fails', () => {
    const write = vi.fn()
    expect(writeTicketNoteOnce(undefined, 'x', write)).toBe('failed')
    expect(writeTicketNoteOnce({ ended: 'now', inputs: [] }, 'x', write)).toBe('ended')
    expect(writeTicketNoteOnce({ inputs: [{ kind: 'note', text: 'x' }] }, 'x', write)).toBe('written')
    expect(write).not.toHaveBeenCalled()
    expect(writeTicketNoteOnce({ inputs: [] }, 'x', () => { throw Error('busy') })).toBe('failed')
    expect(writeTicketNoteOnce({ inputs: [] }, 'x', write)).toBe('written')
    expect(write).toHaveBeenCalledWith('x')
  })
})
