/**
 * #713 stage A1: the ledger's own reserve and its read-only capacity view share one retention rule and one clock sample.
 * A full window refuses with a typed error that carries the view; the view never sweeps, prunes or persists; damaged or
 * unpersisted state reads unavailable, never a healthy empty window.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { TaskLedger } from '../../src/task-ledger.ts'
import { TASK_DELIVERY_CAP as CAP, TASK_DELIVERY_RETENTION_MS as TTL, type TaskDelivery } from '../../src/task-delivery.ts'
import { DeliveryCapacityError, parseDeliveryCapacitySnapshot } from '../../src/task-delivery-capacity.ts'
import { deliveryCapacityLine } from '../../src/tools/info.ts'

const fault = vi.hoisted(() => ({ fail: false }))
vi.mock('node:fs', async original => { const fs = await original<typeof import('node:fs')>(); return { ...fs, renameSync: (...args: Parameters<typeof fs.renameSync>) => { if (fault.fail) throw Object.assign(Error('disk full'), { code: 'ENOSPC' }); return fs.renameSync(...args) } } })
afterEach(() => { fault.fail = false })

const T0 = 1_800_000_000_000
const row = (n: number, at: number): TaskDelivery => ({ version: 1, taskId: 'task-' + String(n), sessionId: 'session-aaaaaaaa11112222', messageId: 'message-' + String(n), fingerprint: 'a'.repeat(64), createdAt: at, state: 'reserved' })
function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'delivery-capacity-')), 'tasks.json')
  const clock = { now: T0 }
  const open = () => new TaskLedger(file, { now: () => clock.now, warn: () => {} })
  const box = { file, clock, ledger: open(), reopen: () => { box.ledger = open(); return box.ledger } }
  return box
}
/** n cancelled correspondence rows created at `at`: a few through the real reserve path, the rest seeded into the same snapshot shape. */
function fill(f: ReturnType<typeof setup>, at: number, n = CAP): TaskLedger {
  const real = Math.min(n, 3)
  for (let i = 0; i < real; i++) { f.ledger.reserveDelivery(row(i, at)); f.ledger.updateDelivery('task-' + String(i), 'cancelled') }
  if (n === real) return f.ledger
  const snap = JSON.parse(readFileSync(f.file, 'utf8')) as { taskDeliveries: TaskDelivery[] }
  snap.taskDeliveries = Array.from({ length: n }, (_, i) => ({ ...row(i, at), state: 'cancelled' as const }))
  writeFileSync(f.file, JSON.stringify(snap))
  return f.reopen()
}

describe('#713 A1 ledger correspondence capacity', () => {
  it('a full window refuses a new record with a typed error carrying the view; the message is unchanged', () => {
    const f = setup(), { clock } = f
    const ledger = fill(f, T0)
    let error: unknown
    try { ledger.reserveDelivery(row(CAP, clock.now)) } catch (e) { error = e }
    expect(error).toBeInstanceOf(DeliveryCapacityError)
    expect((error as DeliveryCapacityError).code).toBe('correspondence-capacity')
    expect((error as Error).message).toBe('task delivery correspondence capacity reached; refusing untracked delivery')
    expect((error as DeliveryCapacityError).capacity).toMatchObject({ status: 'observed', retained: CAP, saturated: true, earliestPossibleExpiryAt: T0 + TTL + 1 })
    expect(parseDeliveryCapacitySnapshot(JSON.parse(JSON.stringify((error as DeliveryCapacityError).capacity)))).toEqual((error as DeliveryCapacityError).capacity)
    expect(ledger.deliveryFor('task-' + String(CAP))).toBeUndefined()
  })

  it('the same task at the cap replays its existing record instead of refusing', () => {
    const ledger = fill(setup(), T0)
    expect(ledger.reserveDelivery(row(7, T0))).toMatchObject({ taskId: 'task-7', state: 'cancelled' })
  })

  it('exactly at the horizon the window is still full; one millisecond later reserve prunes and accepts', () => {
    const f = setup(), { clock } = f
    const ledger = fill(f, T0)
    clock.now = T0 + TTL
    expect(() => ledger.reserveDelivery(row(CAP, clock.now))).toThrow(DeliveryCapacityError)
    clock.now = T0 + TTL + 1
    expect(ledger.reserveDelivery(row(CAP, clock.now))).toMatchObject({ taskId: 'task-' + String(CAP) })
    expect(ledger.deliveryCapacityState()).toMatchObject({ status: 'observed', stored: 1, retained: 1 })
  })

  it('the view is read-only: no prune, no persist, detached; the next reserve still prunes by the rule', () => {
    const f = setup(), { clock, file } = f
    const ledger = fill(f, T0, 3)
    const bytes = readFileSync(file, 'utf8'), mtime = statSync(file).mtimeMs
    clock.now = T0 + TTL + 1
    const view = ledger.deliveryCapacityState()
    expect(view).toMatchObject({ status: 'observed', stored: 3, retained: 0, expiredUntracked: 3, saturated: false })
    if (view.status === 'observed') view.retainedByState.cancelled = 99
    expect(ledger.deliveryCapacityState()).toMatchObject({ retainedByState: { cancelled: 0 } })
    expect(readFileSync(file, 'utf8')).toBe(bytes)
    expect(statSync(file).mtimeMs).toBe(mtime)
    ledger.reserveDelivery(row(10, clock.now))
    expect(ledger.deliveryCapacityState()).toMatchObject({ stored: 1, retained: 1 })
  })

  it('a task still in the ledger keeps its correspondence bound past the horizon and never offers an expiry', () => {
    const { ledger, clock } = setup()
    ledger.trackInbound('task-0', 'alpha/aaaaaaaa', 'beta/bbbbbbbb')
    ledger.reserveDelivery(row(0, T0))
    clock.now = T0 + TTL + 5
    expect(ledger.deliveryCapacityState()).toMatchObject({ status: 'observed', retained: 1, taskBound: 1, earliestPossibleExpiryAt: null })
  })

  it('damaged correspondence or ledger reads unavailable, never a healthy empty window', () => {
    const f = setup(), { file } = f
    fill(f, T0, 2)
    const snap = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ ...snap, taskDeliveries: [{ bad: true }] }))
    expect(new TaskLedger(file, { warn: () => {} }).deliveryCapacityState()).toEqual({ status: 'unavailable', reason: 'correspondence-damaged' })
    writeFileSync(file, '{not json')
    expect(new TaskLedger(file, { warn: () => {} }).deliveryCapacityState()).toEqual({ status: 'unavailable', reason: 'ledger-damaged' })
  })

  it('a failed write reads persistence-failed, not a capacity count', () => {
    const { ledger, clock } = setup()
    fault.fail = true
    expect(() => ledger.reserveDelivery(row(0, clock.now))).toThrow()
    fault.fail = false
    expect(ledger.deliveryCapacityState()).toEqual({ status: 'unavailable', reason: 'persistence-failed' })
  })

  it('the status line names a full window and never claims a free slot', () => {
    const ledger = fill(setup(), T0)
    const line = deliveryCapacityLine(parseDeliveryCapacitySnapshot(JSON.parse(JSON.stringify(ledger.deliveryCapacityState()))))
    expect(line).toContain(`retained=${String(CAP)}/${String(CAP)}`)
    expect(line).toContain('FULL')
    expect(line).toContain('earliest possible expiry=' + new Date(T0 + TTL + 1).toISOString())
    expect(deliveryCapacityLine({ status: 'unavailable', reason: 'ledger-damaged' })).toBe('Delivery correspondence: unavailable (ledger-damaged)')
    expect(deliveryCapacityLine(parseDeliveryCapacitySnapshot({ status: 'observed', capacity: -1 }))).toBe('Delivery correspondence: unknown')
    expect(line).not.toMatch(/task-\d|session-a|message-\d/)
  })
})
