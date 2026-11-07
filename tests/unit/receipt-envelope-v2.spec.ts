/**
 * Receipt envelope v2 codec (receipt-envelope-v2.md): one machine line after
 * the immutable header, known-key discriminator, controlled outcome enum,
 * atomic no-truncation formatting — and the ledger outcomes that fall out of
 * parsing them, including the abandoned-row isolation pin.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatReceipt, parseReceipt, taskIdRefusal } from '../../src/receipt.ts'
import { parseReceipt as parsePreS5 } from './fixtures/receipt-pre-s5.ts'
import { TaskLedger } from '../../src/task-ledger.ts'

describe('receipt codec', () => {
  it('v1 receipts parse byte-compatibly: multi-line summaries stay whole, envelope absent', () => {
    const message = '[A2A receipt] task t-1 first line\nsecond line\nthird'
    const parsed = parseReceipt(message)
    expect(parsed?.taskId).toBe('t-1')
    expect(parsed?.summary).toBe('first line\nsecond line\nthird')
    expect(parsed?.envelope).toBeUndefined()
  })

  it('non-receipts return null', () => {
    expect(parseReceipt('hello world')).toBeNull()
    expect(parseReceipt('[A2A nudge] task t-1')).toBeNull()
  })

  it('a second complete JSON line with a known key parses as the envelope', () => {
    const text = formatReceipt('t-2', 'work done (auto)', { outcome: 'completed', idempotencyKey: 't-2', elapsedMs: 1234 })
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('[A2A receipt] task t-2 work done (auto)')
    const parsed = parseReceipt(text)
    expect(parsed?.summary).toBe('work done (auto)')
    expect(parsed?.envelope).toMatchObject({ outcome: 'completed', idempotencyKey: 't-2', elapsedMs: 1234 })
  })

  it('unknown keys ride through ignored; foreign outcome values are dropped, not stored', () => {
    const text = '[A2A receipt] task t-3 fine\n{"outcome":"weird-value","customField":"kept-by-consumers-if-they-care"}'
    const parsed = parseReceipt(text)
    // Known-key discriminator fires on customField? No: only the five known
    // keys qualify — 'customField' alone must NOT demote this into an envelope.
    expect(parsed?.envelope).toBeUndefined()
    expect(parsed?.summary).toContain('"outcome"')
  })

  it('#114 S5: onBehalfOf and authRef round-trip, ordered after the v2 keys', () => {
    const text = formatReceipt('t-5', 'done (auto)', { outcome: 'completed', idempotencyKey: 't-5', onBehalfOf: 'dsh/414d2b90', authRef: '6b8957a6f02206de' })
    expect(text.split('\n')[1]).toBe('{"outcome":"completed","idempotencyKey":"t-5","onBehalfOf":"dsh/414d2b90","authRef":"6b8957a6f02206de"}')
    expect(parseReceipt(text)?.envelope).toEqual({ outcome: 'completed', idempotencyKey: 't-5', onBehalfOf: 'dsh/414d2b90', authRef: '6b8957a6f02206de' })
  })

  it('#114 S5: malformed onBehalfOf/authRef values are dropped; a valid one qualifies the line like any known key', () => {
    const parsed = parseReceipt('[A2A receipt] task t-6 ok\n{"outcome":"completed","onBehalfOf":"","authRef":"NOT-HEX"}')
    expect(parsed?.envelope).toEqual({ outcome: 'completed' })
    // Only garbage values for the new keys: the line stays human prose.
    expect(parseReceipt('[A2A receipt] task t-7 ok\n{"authRef":12,"onBehalfOf":""}')?.envelope).toBeUndefined()
    // A valid value alone qualifies, exactly as sessionKey alone always has.
    expect(parseReceipt('[A2A receipt] task t-8 ok\n{"onBehalfOf":"dsh/x"}')?.envelope).toEqual({ onBehalfOf: 'dsh/x' })
  })

  it('#114 S5: taskIdRefusal rejects ")", whitespace and control characters, nothing else', () => {
    for (const ok of ['direct-bb27ec94', 'wb-1', 'reuse-1', 'a(b', 'ids.with_dots:and/slashes']) expect(taskIdRefusal(ok)).toBeUndefined()
    for (const bad of ['foo) x', 'foo)', 'a b', 'tab\tx', 'nl\nx', 'nul\u0000', 'del\u007f']) expect(taskIdRefusal(bad)).toContain('task_id must not contain')
  })

  it('#114 S5: the pre-S5 codec (master c9e3a89, verbatim fixture) reads a new receipt unchanged', () => {
    const text = formatReceipt('direct-bb27ec94', 'mapping recorded (auto)', { outcome: 'completed', idempotencyKey: 'direct-bb27ec94', onBehalfOf: 'dsh/414d2b90', authRef: '6b8957a6f02206de' })
    // The old parser keeps its four keys and ignores the two new ones.
    expect(parsePreS5(text)).toEqual({ taskId: 'direct-bb27ec94', summary: 'mapping recorded (auto)', envelope: { outcome: 'completed', idempotencyKey: 'direct-bb27ec94' } })
    // The header line — what every legacy correlator matches — is byte-identical.
    expect(text.split('\n')[0]).toBe('[A2A receipt] task direct-bb27ec94 mapping recorded (auto)')
    // And the ledger settles it exactly as before.
    const ledger = new TaskLedger('')
    ledger.track('direct-bb27ec94', 'dsh/414d2b90', 'local')
    expect(ledger.resolveFromMessage(text)?.outcome).toBe('completed')
  })

  it('malformed JSON on the second line degrades to a plain v1 summary', () => {
    const text = '[A2A receipt] task t-4 note\n{broken json here}'
    const parsed = parseReceipt(text)
    expect(parsed?.envelope).toBeUndefined()
    expect(parsed?.summary).toBe('note\n{broken json here}')
  })
})

function tmpLedger(): { ledger: TaskLedger; file: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-env-')), 'tasks.json')
  return { ledger: new TaskLedger(file), file }
}

describe('ledger × envelope integration', () => {
  it('a v2 receipt lands its controlled outcome and elapsedMs in the archive', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-9', 'dsh/target', 'http://peer')
    ledger.resolveFromMessage(formatReceipt('t-9', 'shipped clean', { outcome: 'completed', elapsedMs: 4321 }))
    const row = ledger.archive()[0]
    expect(row?.outcome).toBe('completed')
    expect(row?.elapsedMs).toBe(4321)
    expect(row?.summary).toBe('shipped clean')
  })

  it('AC-3: a late receipt against an abandoned row pins outcome to abandoned, keeps lateReceiptAt', () => {
    const { ledger, file } = tmpLedger()
    ledger.track('t-7', 'dsh/target', 'http://peer')
    ledger.abandon('t-7', 'gave up')
    ledger.resolveFromMessage(
      formatReceipt('t-7', 'target says finished anyway', { outcome: 'completed' }),
    )
    const row = ledger.archive()[0]
    expect(row?.outcome).toBe('abandoned')
    expect(row?.lateReceiptAt).toBeTypeOf('number')
    expect(row?.summary).toBe('caller-abandoned: gave up')
    // Outcome survives the restart path too.
    const restored = new TaskLedger(file)
    expect(restored.archive()[0]?.outcome).toBe('abandoned')
  })

  it('formatReceipt without any field returns a pure v1 single line', () => {
    const text = formatReceipt('t-8', 'plain')
    expect(text.split('\n')).toHaveLength(1)
    expect(parseReceipt(text)?.envelope).toBeUndefined()
  })
})

describe('superagent p1-receipt-cmd: disposition (S14)', () => {
  it('is a closed set: result and attention parse, anything else is dropped', () => {
    expect(parseReceipt('[A2A receipt] task t-1 ok\n{"outcome":"completed","disposition":"result"}')?.envelope).toEqual({ outcome: 'completed', disposition: 'result' })
    expect(parseReceipt('[A2A receipt] task t-1 why?\n{"idempotencyKey":"t-1","disposition":"attention"}')?.envelope).toEqual({ idempotencyKey: 't-1', disposition: 'attention' })
    expect(parseReceipt('[A2A receipt] task t-1 ok\n{"outcome":"completed","disposition":"done"}')?.envelope).toEqual({ outcome: 'completed' })
    // disposition alone is a recognized envelope (a known key extracted), so the summary is the header line only.
    const alone = parseReceipt('[A2A receipt] task t-1 which branch?\n{"disposition":"attention"}\nmore prose')
    expect(alone).toEqual({ taskId: 't-1', summary: 'which branch?', envelope: { disposition: 'attention' } })
    // A bogus value alone is no envelope at all: the legacy remainder flows through untouched.
    expect(parseReceipt('[A2A receipt] task t-1 x\n{"disposition":"maybe"}')?.envelope).toBeUndefined()
  })

  it('formats after the existing keys, so earlier envelopes keep their exact bytes', () => {
    expect(formatReceipt('t-1', 'why?', { idempotencyKey: 't-1', disposition: 'attention' })).toBe('[A2A receipt] task t-1 why?\n{"idempotencyKey":"t-1","disposition":"attention"}')
    expect(formatReceipt('t-1', 'ok', { disposition: 'result', outcome: 'completed', authRef: '0123456789abcdef' })).toBe('[A2A receipt] task t-1 ok\n{"outcome":"completed","authRef":"0123456789abcdef","disposition":"result"}')
    expect(formatReceipt('t-1', 'ok', { outcome: 'completed' })).toBe('[A2A receipt] task t-1 ok\n{"outcome":"completed"}')
  })

  it('an attention receipt settles its row with no outcome; a result one with both; both survive a restart', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'disp-ledger-')), 'tasks.json')
    const ledger = new TaskLedger(path)
    ledger.track('q-1', 'dsh/aaaaaaaa', 'peer', 'ctx-q')
    ledger.track('r-1', 'dsh/aaaaaaaa', 'peer', 'ctx-r')
    expect(ledger.resolveFromMessage('[A2A receipt] task q-1 which branch?\n{"idempotencyKey":"q-1","disposition":"attention"}')).toEqual({ taskId: 'q-1', team: 'dsh/aaaaaaaa', peer: 'peer', disposition: 'attention', summary: 'which branch?' })
    ledger.resolveFromMessage('[A2A receipt] task r-1 done\n{"outcome":"completed","idempotencyKey":"r-1","disposition":"result"}')
    const rows = (l: TaskLedger) => new Map(l.archive().map(r => [r.taskId, r]))
    for (const l of [ledger, new TaskLedger(path)]) {
      const q = rows(l).get('q-1')!
      expect(q).toMatchObject({ disposition: 'attention', endedBy: 'receipt', summary: 'which branch?' })
      expect(q.outcome).toBeUndefined()
      expect(rows(l).get('r-1')).toMatchObject({ outcome: 'completed', disposition: 'result' })
      expect(l.list().map(r => r.taskId)).toEqual([])
    }
  })

  it('a late receipt refreshes the disposition as it refreshes the outcome; a stored bogus value is dropped on restore', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'disp-late-')), 'tasks.json')
    const ledger = new TaskLedger(path)
    ledger.track('t-2', 'dsh/aaaaaaaa', 'peer')
    ledger.resolveFromMessage('[A2A receipt] task t-2 first\n{"outcome":"completed","disposition":"result"}')
    expect(ledger.resolveFromMessage('[A2A receipt] task t-2 again\n{"idempotencyKey":"t-2","disposition":"attention"}')).toMatchObject({ disposition: 'attention' })
    expect(ledger.archive().find(r => r.taskId === 't-2')).toMatchObject({ disposition: 'attention', summary: 'again' })
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { archived: Array<Record<string, unknown>> }
    doc.archived[0]!.disposition = 'maybe'
    writeFileSync(path, JSON.stringify(doc))
    expect(new TaskLedger(path).archive().find(r => r.taskId === 't-2')?.disposition).toBeUndefined()
  })
})
