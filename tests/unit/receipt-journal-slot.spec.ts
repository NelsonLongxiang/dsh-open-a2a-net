/** #708 review R2 (capacity): a session receipt holds a recovery-journal slot from before insertion until it is journaled. */
import { it, expect } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { CliDepositStore } from '../../src/cli-deposit.ts'
import { RECEIPT_MAILBOX_CAP, receiptMailboxHash } from '../../src/receipt-mailbox.ts'

const commit = (i: number) => {
  const record = { version: 1 as const, transportId: 't-' + String(i), fingerprint: 'f-' + String(i), handle: 'alpha/01234567', targetKey: 'session:s-' + String(i), from: 'beta/01234567', message: '[A2A receipt] task o-' + String(i) + ' done', settler: { caller: 'beta/01234567', proof: 'origin-claim' as const, ingress: 'wire' as const }, at: Date.now(), phase: 'pending' as const }
  return { ...record, hash: receiptMailboxHash(record) }
}
const store = () => new CliDepositStore(join(mkdtempSync(join(tmpdir(), 'journal-slot-')), 'cli-deposits.json'))

it('slots count against the cap with pending records; a full journal hands out none', () => {
  const s = store()
  for (let i = 0; i < RECEIPT_MAILBOX_CAP - 2; i++) s.journalSessionReceipt(commit(i))
  const one = s.reserveSessionReceiptSlot(), two = s.reserveSessionReceiptSlot()
  expect(one).toBeTypeOf('function'); expect(two).toBeTypeOf('function')
  expect(s.reserveSessionReceiptSlot()).toBeUndefined()
  one!(); one!()
  const three = s.reserveSessionReceiptSlot()
  expect(three).toBeTypeOf('function')
  expect(s.reserveSessionReceiptSlot()).toBeUndefined()
  two!(); three!()
})

it('a held slot is not taken by a journal write without one; the holder still fits', () => {
  const s = store()
  for (let i = 0; i < RECEIPT_MAILBOX_CAP - 1; i++) s.journalSessionReceipt(commit(i))
  const slot = s.reserveSessionReceiptSlot()!
  expect(() => s.journalSessionReceipt(commit(900))).toThrow('capacity full')
  s.journalSessionReceipt(commit(901), slot)
  expect(s.pendingReceiptCommits()).toHaveLength(RECEIPT_MAILBOX_CAP)
  expect(s.reserveSessionReceiptSlot()).toBeUndefined()
})
