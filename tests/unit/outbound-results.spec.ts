// @vitest-environment node
/**
 * #881 v2 first slice: the verified outbound result store and its body projection (status only; bodies not served yet).
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { formatReceipt } from '../../src/receipt.ts'
import { OutboundResults, RESULT_BODY_MAX_BYTES, RESULT_BODY_TTL_MS, RESULT_INDEX_TTL_MS, projectResultBody, receiptSource, type ResultCredential } from '../../src/superagent/host/outbound-results.ts'

const TASK = 'direct-out000001'
const quiet = { warn: () => {} }
const wire = (receipt: string) => `[A2A direct] (task t-in) verified caller dsh/aaaaaaaa (routed to dsh/canvas/x) sent:\n\n${receipt}`
function store(now = { t: 1_000_000 }) {
  const dir = mkdtempSync(join(tmpdir(), 'sa-results-'))
  const paths = { indexPath: join(dir, 'outbound-results.json'), bodyPath: join(dir, 'outbound-bodies.json') }
  return { s: new OutboundResults({ ...paths, now: () => now.t, logger: quiet }), paths, now, reopen: () => new OutboundResults({ ...paths, now: () => now.t, logger: quiet }) }
}
const cred = (text: string, over: Partial<ResultCredential> = {}): ResultCredential => ({ ticketId: 't1', card: 'c1', task: TASK, sender: 'superagent-team/0123456789abcdef', replier: 'dsh/other', transportId: 'r1', proof: 'cli-identity', approvedAt: 'x', text, completeness: 'complete', ...over })

describe('receiptSource and projectResultBody', () => {
  it('local text is the receipt; wire strips only the one outer direct header; anything else is not a source', () => {
    const r = formatReceipt(TASK, 'done', { outcome: 'completed' })
    expect(receiptSource(r)).toMatchObject({ kind: 'local' })
    expect(receiptSource(wire(r))).toEqual({ kind: 'wire', receipt: r })
    expect(receiptSource(`note\n\n${r}`)).toBeUndefined()
    expect(receiptSource(`[A2A direct] (task x) a\nb sent:\n\n${r}`)).toBeUndefined()
    expect(receiptSource(`junk\n[A2A direct] (task x) a sent:\n\n${r}`)).toBeUndefined()
  })
  it('the body is the summary plus the lines after the envelope; CRLF becomes LF; blank lines kept', () => {
    const r = formatReceipt(TASK, 'summary line', { outcome: 'completed' }) + '\r\nfirst\r\n\r\nthird'
    const src = receiptSource(r)!
    expect(projectResultBody(src.receipt, TASK)).toMatchObject({ normalized: 'summary line\nfirst\n\nthird', outcome: 'completed', terminalNoBody: false })
  })
  it('unknown is a final outcome with a body; no envelope or no outcome is final with no body; another task is not a result', () => {
    expect(projectResultBody(formatReceipt(TASK, 's', { outcome: 'unknown' }), TASK)).toMatchObject({ outcome: 'unknown', terminalNoBody: false })
    expect(projectResultBody(`[A2A receipt] task ${TASK} legacy`, TASK)).toMatchObject({ terminalNoBody: true })
    expect(projectResultBody(formatReceipt(TASK, 's', { disposition: 'attention' }), TASK)).toMatchObject({ terminalNoBody: true })
    expect(projectResultBody(formatReceipt('other', 's', { outcome: 'completed' }), TASK)).toBeUndefined()
  })
})

describe('OutboundResults', () => {
  it('stores a complete body in 0o600 files and reads it back as ready after a restart', () => {
    const t = store()
    expect(t.s.register(cred(wire(formatReceipt(TASK, 'ok', { outcome: 'completed' }))))).toBe('stored')
    for (const p of [t.paths.indexPath, t.paths.bodyPath]) expect(statSync(p).mode & 0o777).toBe(0o600)
    expect(t.reopen().view('t1', TASK)).toMatchObject({ status: 'ready', hasBody: true, outcome: 'completed', sourceCompleteness: 'complete' })
    expect(t.s.view('t1', 'other')).toBeUndefined()
    expect(t.s.view('t2', TASK)).toBeUndefined()
  })
  it('the same result again is a duplicate; a different one freezes the record as a conflict', () => {
    const t = store()
    const r = formatReceipt(TASK, 'ok', { outcome: 'completed' })
    expect(t.s.register(cred(r))).toBe('stored')
    expect(t.s.register(cred(r, { transportId: 'r2' }))).toBe('duplicate')
    expect(t.s.register(cred(formatReceipt(TASK, 'other', { outcome: 'completed' })))).toBe('conflict')
    expect(t.s.view('t1', TASK)).toMatchObject({ status: 'unavailable', reason: 'conflict' })
  })
  it('a body over 8 KiB is cut at a character boundary and reads as truncated', () => {
    const t = store()
    expect(t.s.register(cred(formatReceipt(TASK, 's', { outcome: 'completed' }) + '\n' + '汉'.repeat(RESULT_BODY_MAX_BYTES)))).toBe('stored')
    expect(t.s.view('t1', TASK)).toMatchObject({ status: 'truncated', truncated: true, hasBody: true })
  })
  it('an incomplete or unproven source keeps no body and says why', () => {
    const t = store()
    const r = formatReceipt(TASK, 'ok', { outcome: 'completed' })
    expect(t.s.register(cred(r, { completeness: 'source-truncated' }))).toBe('indexed')
    expect(t.s.view('t1', TASK)).toMatchObject({ status: 'unavailable', reason: 'source-truncated', hasBody: false })
    expect(t.s.register(cred(r, { ticketId: 't2', completeness: 'unproven' }))).toBe('indexed')
    expect(t.s.view('t2', TASK)).toMatchObject({ status: 'unavailable', reason: 'source-unproven' })
  })
  it('a final result with no body is terminal_no_body; a non-receipt is not recorded', () => {
    const t = store()
    expect(t.s.register(cred(`[A2A receipt] task ${TASK} legacy`))).toBe('indexed')
    expect(t.s.view('t1', TASK)).toMatchObject({ status: 'terminal_no_body', hasBody: false })
    expect(t.s.register(cred('plain text', { ticketId: 't3' }))).toBe('not-a-result')
  })
  it('the body expires after 7 days, the index after 30', () => {
    const t = store()
    t.s.register(cred(formatReceipt(TASK, 'ok', { outcome: 'completed' })))
    t.now.t += RESULT_BODY_TTL_MS
    expect(t.s.view('t1', TASK)).toMatchObject({ status: 'expired', hasBody: false })
    t.now.t += RESULT_INDEX_TTL_MS
    expect(t.s.view('t1', TASK)).toBeUndefined()
  })
  it('a damaged store fails closed: every read is unavailable and nothing new is kept', () => {
    const t = store()
    writeFileSync(t.paths.indexPath, '{broken')
    const s = t.reopen()
    expect(s.view('t1', TASK)).toEqual({ status: 'unavailable', reason: 'storage' })
    expect(s.register(cred(formatReceipt(TASK, 'ok', { outcome: 'completed' })))).toBe('failed')
  })
  it('a body whose index row was never committed is an orphan and is not read', () => {
    const t = store()
    t.s.register(cred(formatReceipt(TASK, 'ok', { outcome: 'completed' })))
    writeFileSync(t.paths.indexPath, JSON.stringify({ version: 1, rows: [] }))
    expect(t.reopen().view('t1', TASK)).toBeUndefined()
  })
  it('an orphan body is not carried into the next write', () => {
    const t = store()
    t.s.register(cred(formatReceipt(TASK, 'orphaned', { outcome: 'completed' })))
    writeFileSync(t.paths.indexPath, JSON.stringify({ version: 1, rows: [] }))
    const s = t.reopen()
    expect(s.register(cred(formatReceipt(TASK, 'fresh', { outcome: 'completed' }), { ticketId: 't2' }))).toBe('stored')
    const rows = (JSON.parse(readFileSync(t.paths.bodyPath, 'utf8')) as { rows: Array<{ text: string }> }).rows
    expect(rows.map(r => r.text)).toEqual(['fresh'])
  })
})
