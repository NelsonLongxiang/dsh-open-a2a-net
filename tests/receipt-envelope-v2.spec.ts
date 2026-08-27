/**
 * Receipt envelope v2 codec (receipt-envelope-v2.md): one machine line after
 * the immutable header, known-key discriminator, controlled outcome enum,
 * atomic no-truncation formatting — and the ledger outcomes that fall out of
 * parsing them, including the abandoned-row isolation pin.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatReceipt, parseReceipt } from '../src/receipt.ts'
import { TaskLedger } from '../src/task-ledger.ts'

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
