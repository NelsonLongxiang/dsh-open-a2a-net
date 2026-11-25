// @vitest-environment node
/**
 * #881 v2 B2: a receipt's mailbox row carries the network ledger's verdict. It is stored as pending, the verdict lands in
 * the same write that finishes the receipt journal (or, for a receipt returned before it settles, right after), it
 * survives a restart, and a restored row never keeps a verdict outside the set.
 */
import { it, expect } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from '../temp-dirs.ts'
import { CliDepositStore, MAIL_SETTLEMENTS, markReturnedReceipt } from '../../src/cli-deposit.ts'
import { SETTLEMENT_VALUES } from '../../src/superagent/a2a-watch.ts'
import { receiptMailboxHash } from '../../src/receipt-mailbox.ts'
import { archivedBySameReceipt } from '../../src/task-ledger-rows.ts'
import { signCard } from '../../src/card.ts'

function fixture() {
  const now = Date.now()
  const file = join(mkdtempSync(join(tmpdir(), 'receipt-verdict-')), 'mail.json'), store = new CliDepositStore(file, { now: () => now })
  const handle = 'receipt-test/0123456789abcdef', key = generateKeyPairSync('ed25519').privateKey
  expect(store.deposit(JSON.stringify(signCard({ name: 'test', session: 'test', team: handle, capabilities: { route: true, async: true }, expiresAt: now + 86_400_000 }, key))).ok).toBe(true)
  const thread = { taskId: 'transport-1', receiptFor: 'original-work', proof: 'cli-identity' as const }
  const message = '[A2A receipt] task original-work done'
  const record = { version: 1 as const, transportId: 'transport-1', fingerprint: 'fp-1', handle, targetKey: store.heldKey(handle)!, from: 'beta/aaaaaaaa', message, settler: { caller: 'beta/aaaaaaaa', proof: 'cli-identity' as const, ingress: 'wire' as const }, at: now, phase: 'pending' as const }
  const commit = { ...record, hash: receiptMailboxHash(record) }
  return { file, store, handle, thread, message, commit }
}
const rowOf = (store: CliDepositStore, handle: string) => store.readMail(handle).find(m => m.task_id === 'transport-1')

it('a receipt row is stored pending; finishing the journal writes its verdict in the same file write, and a reload keeps it', () => {
  const f = fixture()
  f.store.mailReceipt(f.handle, 'beta/aaaaaaaa', f.message, f.thread, undefined, f.commit)
  expect(rowOf(f.store, f.handle)).toMatchObject({ receipt_for: 'original-work', settlement: 'pending' })
  f.store.completeReceiptCommit('transport-1', 'refused', { settlement: 'refused', reason: 'settler-off-chain' })
  const disk = JSON.parse(readFileSync(f.file, 'utf8')) as { mailbox: Record<string, Array<Record<string, unknown>>>; receiptCommits: Array<{ phase: string }> }
  expect(disk.receiptCommits[0]!.phase).toBe('refused')
  expect(disk.mailbox[f.handle]!.find(m => m.task_id === 'transport-1')).toMatchObject({ settlement: 'refused', settlement_reason: 'settler-off-chain' })
  expect(rowOf(new CliDepositStore(f.file), f.handle)).toMatchObject({ settlement: 'refused', settlement_reason: 'settler-off-chain' })
})

it('a positive verdict replaces pending and clears an earlier reason; without a verdict the row is left as it is', () => {
  const f = fixture()
  f.store.mailReceipt(f.handle, 'beta/aaaaaaaa', f.message, { ...f.thread, settlementReason: 'stale' }, undefined, f.commit)
  f.store.completeReceiptCommit('transport-1', 'delivered')
  expect(rowOf(f.store, f.handle)).toMatchObject({ settlement: 'pending' })
  expect(f.store.settleRow(f.handle, 'transport-1', { settlement: 'settled' })).toBe(true)
  const row = rowOf(f.store, f.handle)!
  expect(row.settlement).toBe('settled')
  expect(row.settlement_reason).toBeUndefined()
  expect(f.store.settleRow(f.handle, 'no-such-transport', { settlement: 'settled' })).toBe(false)
  expect(rowOf(new CliDepositStore(f.file), f.handle)!.settlement).toBe('settled')
})

it('a plain delivery carries the verdict given with it, and none when none is given; a long reason is cut', () => {
  const f = fixture()
  f.store.mail(f.handle, 'beta/aaaaaaaa', f.message, undefined, { taskId: 'local-1', receiptFor: 'original-work', proof: 'in-process', settlement: 'none', settlementReason: 'x'.repeat(200) })
  f.store.mail(f.handle, 'beta/aaaaaaaa', 'plain work', undefined, { taskId: 'local-2', proof: 'in-process' })
  const rows = f.store.readMail(f.handle)
  expect(rows.find(m => m.task_id === 'local-1')).toMatchObject({ settlement: 'none', settlement_reason: 'x'.repeat(64) })
  expect(rows.find(m => m.task_id === 'local-2')).not.toHaveProperty('settlement')
})

it('a restored row keeps only a verdict from the set, and the watch reads exactly that set', () => {
  const f = fixture()
  f.store.mailReceipt(f.handle, 'beta/aaaaaaaa', f.message, f.thread, undefined, f.commit)
  const disk = JSON.parse(readFileSync(f.file, 'utf8')) as { mailbox: Record<string, Array<Record<string, unknown>>> }
  disk.mailbox[f.handle]![0]!.settlement = 'approved'
  writeFileSync(f.file, JSON.stringify(disk))
  expect(rowOf(new CliDepositStore(f.file), f.handle)).not.toHaveProperty('settlement')
  expect([...SETTLEMENT_VALUES].sort()).toEqual([...MAIL_SETTLEMENTS].sort())
})

it('an archived row endorses a receipt only when the same on-chain settler sent the same summary', () => {
  const row = { endedBy: 'receipt', summary: 'done', settledBy: { caller: 'beta/aaaaaaaa', chain_role: 'target' } }
  expect(archivedBySameReceipt(row, 'beta/aaaaaaaa', '  done  ')).toBe(true)
  expect(archivedBySameReceipt(row, 'evil/bbbbbbbb', 'done')).toBe(false)
  expect(archivedBySameReceipt(row, 'beta/aaaaaaaa', 'other')).toBe(false)
  expect(archivedBySameReceipt({ ...row, settledBy: { caller: 'beta/aaaaaaaa', chain_role: 'off-chain' } }, 'beta/aaaaaaaa', 'done')).toBe(false)
  expect(archivedBySameReceipt({ endedBy: 'receipt', summary: 'done' }, 'beta/aaaaaaaa', 'done')).toBe(false)
  expect(archivedBySameReceipt({ ...row, endedBy: 'cancelled' }, 'beta/aaaaaaaa', 'done')).toBe(false)
})

it('a receipt returned into a local CLI mailbox gets its verdict once it settles; other lanes and failed settlements leave rows alone', () => {
  const f = fixture()
  f.store.mailReceipt(f.handle, 'beta/aaaaaaaa', f.message, { ...f.thread, proof: 'in-process' })
  expect(rowOf(f.store, f.handle)!.settlement).toBe('pending')
  const warns: string[] = []
  const record = (kind: string) => ({ lane: { kind }, target: f.handle, transportId: 'transport-1' })
  expect(markReturnedReceipt(f.store, record('local-cli'), { ok: false, settlement: { settlement: 'none', reason: 'not-resolved' } }, w => { warns.push(w) })).toBe(false)
  expect(rowOf(f.store, f.handle)!.settlement).toBe('pending')
  expect(markReturnedReceipt(f.store, record('peer'), { ok: true, settlement: { settlement: 'settled' } }, w => { warns.push(w) })).toBe(true)
  expect(rowOf(f.store, f.handle)!.settlement).toBe('pending')
  expect(markReturnedReceipt(f.store, record('local-cli'), { ok: true, settlement: { settlement: 'held' } }, w => { warns.push(w) })).toBe(true)
  expect(rowOf(f.store, f.handle)!.settlement).toBe('held')
  const broken = { settleRow: () => { throw Error('disk') } }
  expect(markReturnedReceipt(broken, record('local-cli'), { ok: true, settlement: { settlement: 'settled' } }, w => { warns.push(w) })).toBe(true)
  expect(warns).toEqual(['a2a: receipt row verdict not stored; the row stays pending'])
})
