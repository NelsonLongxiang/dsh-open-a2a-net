// @vitest-environment node
/**
 * #881 v2 B2: the team's receivers take a receipt only on the network ledger's positive verdict. An outbound request is
 * answered (or told of progress) only by a settled (or held) receipt, a review verdict only by a settled one; a refused,
 * pending, absent or wrong-kind verdict is kept, bounded, for the health view and never reaches the ticket. #882's
 * contract (interim keeps the request open, the answer note is written once) is unchanged for positive receipts.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OutboundRequests, writeTicketNoteOnce, type NoteResult } from '../../src/superagent/host/outbound.ts'
import { ReviewRequests } from '../../src/superagent/host/review-requests.ts'
import { keepUnsettled, receiptStanding, UNSETTLED_KEEP } from '../../src/superagent/host/receipt-settlement.ts'
import { formatReceipt } from '../../src/receipt.ts'

const quiet = { warn: () => {} }
const now = () => '2026-11-24T06:00:00.000Z'
const TASK = 'direct-out000001', ADDR = 'dsh/canvas/other'
const RESULT = formatReceipt(TASK, '数据在附件里', { outcome: 'completed' })
const ACK = formatReceipt(TASK, '已收到', { disposition: 'acknowledged' })
const trigger = (id: string, text: string, settlement?: string, reason?: string) => ({ id, source: 'a2a', threads: [], actor: { source: 'a2a', id: ADDR }, human: false, at: now(), text,
  meta: { receiptFor: TASK, proof: 'cli-identity', ...(settlement !== undefined ? { settlement } : {}), ...(reason !== undefined ? { settlementReason: reason } : {}) } }) as never

async function outbound() {
  const inputs: Array<{ kind: string; text?: string }> = [], writes: string[] = []
  const noteOnce = (_id: string, text: string): NoteResult => writeTicketNoteOnce({ inputs }, text, t => { writes.push(t); inputs.push({ kind: 'note', text: t }) })
  const path = join(mkdtempSync(join(tmpdir(), 'sa-verdict-')), 'outbound.json')
  const out = new OutboundRequests({ path, ask: vi.fn(async () => TASK as string | undefined), note: vi.fn(), noteOnce, logger: quiet, now })
  out.waiting('c1', 't1', ADDR, '原文', 'session-m')
  expect(await out.decided('c1', true, 'team', () => '调研')).toBe(TASK)
  return { out, writes, path }
}

describe('#881 v2 B2: an outbound request takes only a receipt the ledger settled', () => {
  it('a refused receipt (settler-off-chain) answers nothing and writes nothing; it is kept and shown', async () => {
    const o = await outbound()
    o.out.received(trigger('r1', RESULT, 'refused', 'settler-off-chain'))
    expect(o.out.list()[0]).toMatchObject({ state: 'sent' })
    expect(o.out.list()[0]!.answer).toBeUndefined()
    expect(o.writes).toEqual([])
    expect(o.out.unsettledProblems()).toMatchObject([{ ticketId: 't1', task: TASK, last: { key: 'r1', settlement: 'refused', reason: 'settler-off-chain' } }])
    // A later settled result still answers, and the request no longer shows as unsettled.
    o.out.received(trigger('r2', RESULT, 'settled'))
    expect(o.out.list()[0]).toMatchObject({ state: 'answered', noted: true, answer: { key: 'r2' } })
    expect(o.writes.filter(w => w.includes('的回执：'))).toHaveLength(1)
    expect(o.out.unsettledProblems()).toEqual([])
  })

  it('a pending, absent, none or unknown verdict is not an answer either', async () => {
    for (const [settlement, reason] of [['pending', undefined], [undefined, undefined], ['none', 'already-settled'], ['none', 'not-payer']] as const) {
      const o = await outbound()
      o.out.received(trigger('r1', RESULT, settlement, reason))
      expect(o.out.list()[0]!.answer, String(settlement)).toBeUndefined()
      expect(o.writes).toEqual([])
      expect(o.out.unsettledProblems()[0]!.last).toMatchObject({ settlement: settlement ?? 'absent' })
    }
  })

  it('an interim receipt needs the held verdict: held writes progress, settled or none on an interim writes nothing', async () => {
    const o = await outbound()
    o.out.received(trigger('a1', ACK, 'settled'))
    o.out.received(trigger('a2', ACK, 'none', 'not-owed'))
    expect(o.writes).toEqual([])
    expect(o.out.unsettledProblems()[0]!.last).toMatchObject({ key: 'a2', settlement: 'none' })
    o.out.received(trigger('a3', ACK, 'held'))
    expect(o.writes.filter(w => w.includes('进展（尚未结束）'))).toHaveLength(1)
    expect(o.out.list()[0]).toMatchObject({ state: 'sent' })
  })

  it('kept anomalies are bounded and a replayed Trigger adds nothing (the outbound file does not grow with them)', async () => {
    const o = await outbound()
    for (let i = 0; i < 10; i += 1) o.out.received(trigger(`r${String(i)}`, RESULT, 'refused', 'settler-off-chain'))
    expect(o.out.list()[0]!.unsettled!.map(u => u.key)).toEqual(['r7', 'r8', 'r9'])
    const { statSync } = await import('node:fs')
    const size = statSync(o.path).size
    o.out.received(trigger('r9', RESULT, 'refused', 'settler-off-chain'))
    expect(statSync(o.path).size).toBe(size)
    expect(UNSETTLED_KEEP).toBe(3)
    expect(keepUnsettled([{ key: 'a', at: 'x', settlement: 'none' }], { key: 'a', at: 'y', settlement: 'refused' })).toEqual([{ key: 'a', at: 'y', settlement: 'refused' }])
  })

  it('the standing reads the field only: a final needs settled, an interim needs held', () => {
    const t = (settlement: unknown) => ({ id: 'x', at: 'y', meta: { settlement } }) as never
    expect(receiptStanding(t('settled'), false)).toEqual({ ok: true })
    expect(receiptStanding(t('held'), true)).toEqual({ ok: true })
    expect(receiptStanding(t('held'), false)).toMatchObject({ ok: false })
    expect(receiptStanding(t('settled'), true)).toMatchObject({ ok: false })
    expect(receiptStanding(t(7), false)).toMatchObject({ ok: false, unsettled: { settlement: 'absent' } })
  })
})

describe('#881 v2 B2: a review verdict needs a receipt the ledger settled', () => {
  const reviewer = 'dsh/f49961b0', head = 'abcdef1234567890'
  const pass = `评审意见……\nverdict: PASS head: ${head}`
  async function review() {
    const notes: Array<[string, string]> = []
    const r = new ReviewRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-review-verdict-')), 'r.json'), reviewer: () => reviewer, logger: quiet, note: (t, x) => { notes.push([t, x]) }, ask: async () => 'direct-1' })
    await r.opened('o/net#7', head, 'https://github.com/o/net/pull/7', 't1')
    return { r, notes, receipt: (id: string, text: string, settlement?: string, reason?: string) => ({ id, actor: { source: 'a2a', id: reviewer }, text, at: '2026-11-09T00:00:00Z',
      meta: { receiptFor: 'direct-1', proof: 'origin-claim', ...(settlement !== undefined ? { settlement } : {}), ...(reason !== undefined ? { settlementReason: reason } : {}) } }) as never }
  }

  it('a refused PASS is no verdict and no note; it is shown; a settled PASS then counts', async () => {
    const m = await review()
    const before = m.notes.length
    m.r.received(m.receipt('v1', pass, 'refused', 'settler-off-chain'))
    expect(m.r.list()[0]!.verdict).toBeUndefined()
    expect(m.notes.length).toBe(before)
    expect(m.r.unsettledProblems()).toMatchObject([{ ticketId: 't1', task: 'direct-1', last: { settlement: 'refused', reason: 'settler-off-chain' } }])
    m.r.received(m.receipt('v2', pass, 'settled'))
    expect(m.r.list()[0]!.verdict).toMatchObject({ pass: true, checked: 'verified' })
    expect(m.r.unsettledProblems()).toEqual([])
  })

  it('an acknowledgement from the reviewer, held by the ledger, is not a verdict', async () => {
    const m = await review()
    m.r.received(m.receipt('k1', formatReceipt('direct-1', '收到，评审中', { disposition: 'acknowledged' }), 'held'))
    expect(m.r.list()[0]!.verdict).toBeUndefined()
    expect(m.r.unsettledProblems()).toEqual([])
  })

  it('a PASS with no verdict at all (an older host) is kept, not counted', async () => {
    const m = await review()
    m.r.received(m.receipt('v1', pass))
    expect(m.r.list()[0]!.verdict).toBeUndefined()
    expect(m.r.unsettledProblems()[0]!.last.settlement).toBe('absent')
  })
})
