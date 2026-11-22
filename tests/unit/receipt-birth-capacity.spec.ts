/** Settled delivery identities must not become pending births after the bounded archive moves on. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FollowupDelivery } from '../../src/followup-delivery.ts'
import { deliveryFingerprint, parseTaskDelivery, TASK_DELIVERY_CAP, TASK_DELIVERY_RETENTION_MS } from '../../src/task-delivery.ts'
const fault = vi.hoisted(() => ({ fail: false }))
vi.mock('node:fs', async original => { const fs = await original<typeof import('node:fs')>(); return { ...fs, renameSync: (...args: Parameters<typeof fs.renameSync>) => { if (fault.fail) throw Object.assign(Error('disk full'), { code: 'ENOSPC' }); return fs.renameSync(...args) } } })
afterEach(() => { fault.fail = false })
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from '../temp-dirs.ts'
import { TaskLedger, TASK_CAP, ARCHIVE_CAP } from '../../src/task-ledger.ts'

const now = 1_000_000
const file = () => join(mkdtempSync(join(tmpdir(), 'birth-capacity-')), 'tasks.json')
function birth(ledger: TaskLedger, taskId: string) {
  ledger.reserveDelivery({ version: 1, taskId, messageId: 'msg-' + taskId, sessionId: 'session-worker', fingerprint: deliveryFingerprint('session-worker', 'work-' + taskId), taskExpected: true, createdAt: now, state: 'claimed' })
  ledger.trackInbound(taskId, 'alpha/aaaaaaaa', 'beta/bbbbbbbb')
}
function finish(ledger: TaskLedger, id: string) { expect(ledger.resolveFromMessage('[A2A receipt] task ' + id + ' completed')).toBeDefined() }

describe('receipt birth capacity after archive rotation', () => {
  it.each(['cancel', 'abandon'] as const)('%s preserves terminal evidence without deleting the occurrence', action => {
    const path = file(), ledger = new TaskLedger(path, { now: () => now, archiveCap: 1 })
    birth(ledger, 'ended'); ledger[action]('ended')
    ledger.track('rotate', 'remote/bbbbbbbb', 'https://peer.invalid'); finish(ledger, 'rotate')
    const restored = new TaskLedger(path, { now: () => now, archiveCap: 1 })
    expect(restored.deliveryFor('ended')).toMatchObject({ messageId: 'msg-ended', state: 'claimed', terminalRecorded: true })
    expect(restored.orphanDelivery('ended')).toBe(false)
  })

  it('retains the original 512/24h replay window and still refuses the 513th occurrence', () => {
    let clock = now
    const ledger = new TaskLedger('', { now: () => clock })
    for (let i = 0; i < TASK_DELIVERY_CAP; i++) { const id = 'full-' + i; birth(ledger, id); finish(ledger, id) }
    expect(ledger.receiptCapacityAvailable()).toBe(true)
    expect(ledger.deliveryCapacityState()).toMatchObject({ capacity: TASK_DELIVERY_CAP, retained: TASK_DELIVERY_CAP })
    clock = now + TASK_DELIVERY_RETENTION_MS
    expect(() => birth(ledger, 'too-soon')).toThrow('correspondence capacity')
    expect(ledger.deliveryFor('full-0')?.messageId).toBe('msg-full-0')
    clock += 1
    expect(() => birth(ledger, 'after-ttl')).not.toThrow()
    expect(ledger.deliveryFor('after-ttl')).toBeDefined()
  })

  it('rolls back terminal proof with a failed settlement commit', () => {
    const path = file(), ledger = new TaskLedger(path, { now: () => now })
    birth(ledger, 'write-failure'); const bytes = readFileSync(path)
    fault.fail = true
    expect(() => finish(ledger, 'write-failure')).toThrow('disk full')
    expect(readFileSync(path)).toEqual(bytes)
    expect(ledger.find('write-failure')).toBeDefined()
    expect(ledger.deliveryFor('write-failure')?.terminalRecorded).toBeUndefined()
    fault.fail = false; finish(ledger, 'write-failure')
    expect(new TaskLedger(path, { now: () => now }).deliveryFor('write-failure')?.terminalRecorded).toBe(true)
  })

  it('migrates only legacy identities whose actual terminal archive evidence survives, without writing on restore', () => {
    const path = file(), ledger = new TaskLedger(path, { now: () => now, archiveCap: 1 })
    birth(ledger, 'old-lost'); finish(ledger, 'old-lost')
    birth(ledger, 'still-visible'); finish(ledger, 'still-visible')
    const legacy = JSON.parse(readFileSync(path, 'utf8'))
    for (const row of legacy.taskDeliveries) delete row.terminalRecorded
    writeFileSync(path, JSON.stringify(legacy)); const bytes = readFileSync(path)
    const restored = new TaskLedger(path, { now: () => now, archiveCap: 1 })
    expect(restored.orphanDelivery('still-visible')).toBe(false)
    expect(restored.orphanDelivery('old-lost')).toBe(true)
    expect(restored.deliveryFor('old-lost')?.terminalRecorded).toBeUndefined()
    expect(readFileSync(path)).toEqual(bytes)
  })

  it('never treats cap eviction as terminal result evidence', () => {
    const ledger = new TaskLedger('', { now: () => now, archiveCap: 1 })
    birth(ledger, 'owed')
    for (let i = 0; i < TASK_CAP + 2; i++) ledger.track('other-' + i, 'alpha/aaaaaaaa', 'local')
    expect(ledger.deliveryFor('owed')?.terminalRecorded).toBeUndefined()
    expect(ledger.orphanDelivery('owed')).toBe(true)
  })

  it('rejects forged terminal flags at new admission and malformed persisted proofs', () => {
    const ledger = new TaskLedger('', { now: () => now })
    const row = { version: 1 as const, taskId: 'forged', messageId: 'm', sessionId: 's', fingerprint: 'a'.repeat(64), createdAt: now, state: 'claimed' as const, taskExpected: true as const, terminalRecorded: true as const }
    expect(() => ledger.reserveDelivery(row)).toThrow('invalid')
    expect(parseTaskDelivery({ ...row, terminalRecorded: false })).toBeUndefined()
    expect(parseTaskDelivery({ ...row, taskExpected: undefined })).toBeUndefined()
  })

  it('accepts sequential settled work beyond both 64-entry windows while retaining every occurrence identity', () => {
    const ledger = new TaskLedger('', { now: () => now })
    for (let i = 0; i < TASK_CAP + ARCHIVE_CAP + 3; i++) { const id = 'settled-' + i; birth(ledger, id); finish(ledger, id) }
    expect(ledger.receiptCapacityAvailable()).toBe(true)
    expect(ledger.orphanDelivery('settled-0')).toBe(false)
    expect(ledger.deliveryFor('settled-0')).toMatchObject({ messageId: 'msg-settled-0', state: 'claimed' })
    expect(ledger.deliveryBookkeepingState().orphaned).toBe(0)
    expect(ledger.conservation().conserved).toBe(true)
  })

  it('keeps a settled identity non-orphan after archive eviction and restart', () => {
    const path = file(), ledger = new TaskLedger(path, { now: () => now, archiveCap: 1 })
    birth(ledger, 'first'); finish(ledger, 'first')
    ledger.track('next', 'remote/bbbbbbbb', 'https://peer.invalid'); finish(ledger, 'next')
    const restored = new TaskLedger(path, { now: () => now, archiveCap: 1 })
    expect(restored.orphanDelivery('first')).toBe(false)
    expect(restored.deliveryFor('first')).toMatchObject({ messageId: 'msg-first', state: 'claimed' })
    expect(restored.receiptCapacityAvailable()).toBe(true)
    restored.trackInbound('first', 'alpha/aaaaaaaa', 'beta/bbbbbbbb')
    restored.track('first', 'alpha/aaaaaaaa', 'local')
    restored.trackReceiptless('first', 'alpha/aaaaaaaa', 'local')
    expect(restored.list()).toEqual([])
    const followup = vi.fn(), dispatcher = new FollowupDelivery({ ledger: restored, taint: vi.fn(), warn: vi.fn() })
    const identity = restored.deliveryFor('first')!
    // Identity match is checked first; a matching replay still cannot enter the inbox.
    expect(() => dispatcher.deliver({ id: identity.sessionId, followup } as never, 'different', undefined, undefined, 'first', undefined, true)).toThrow('identity conflict')
    expect(() => dispatcher.deliver({ id: identity.sessionId, followup } as never, 'work-first', undefined, undefined, 'first', undefined, true)).toThrow('terminal; no replay')
    expect(followup).not.toHaveBeenCalled()
  })

  it('still refuses 64 genuine task births with no committed task or terminal evidence', () => {
    const path = file(), ledger = new TaskLedger(path, { now: () => now })
    for (let i = 0; i < TASK_CAP; i++) ledger.reserveDelivery({ version: 1, taskId: 'orphan-' + i, messageId: 'msg-' + i, sessionId: 'session-worker', fingerprint: 'a'.repeat(64), taskExpected: true, createdAt: now, state: 'claimed' })
    const restored = new TaskLedger(path, { now: () => now })
    expect(restored.receiptCapacityAvailable()).toBe(false)
    expect(restored.deliveryBookkeepingState().orphaned).toBe(TASK_CAP)
    expect(() => restored.reserveDispatch('new-work', 'b'.repeat(64))).toThrow('receipt-protected')
  })
})
