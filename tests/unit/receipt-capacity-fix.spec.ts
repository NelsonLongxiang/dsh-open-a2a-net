// @vitest-environment node
/**
 * #eb6d20df root cause and remedy. The archive keeps ARCHIVE_CAP (64) settled rows while a task delivery is kept 24 h;
 * before the fix, a settled task pushed out of the archive left its delivery counted as an orphan, so 128 settled tasks
 * in a day refused all new work with nothing in flight. Genuine orphans can be voided by the owner, with an audit record.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'
import { deliveryFingerprint } from '../../src/task-delivery.ts'
import { registerReceiptCapacityFace } from '../../src/faces/receipt-capacity.ts'

const SESSION = 'session-aaaaaaaa11112222'
const file = () => join(mkdtempSync(join(tmpdir(), 'receipt-fix-')), 'tasks.json')
function deliver(ledger: TaskLedger, taskId: string, at: number) {
  ledger.reserveDelivery({ version: 1, taskId, messageId: 'm-' + taskId, sessionId: SESSION, fingerprint: deliveryFingerprint(SESSION, taskId), taskExpected: true, createdAt: at, state: 'reserved' })
  ledger.updateDelivery(taskId, 'enqueued'); ledger.updateDelivery(taskId, 'claimed')
}
function settle(ledger: TaskLedger, taskId: string, at: number) {
  deliver(ledger, taskId, at)
  ledger.trackInbound(taskId, 'alpha/aaaaaaaa', 'beta/bbbbbbbb', undefined, true, 'w', undefined, undefined, SESSION)
  ledger.abandon(taskId, 'done')
}

describe('#eb6d20df: settled tasks pushed out of the archive no longer hold the gate', () => {
  it('150 settled tasks in a day (past the 128 that used to refuse everything): no refusal, no orphans, the gate stays open', { timeout: 30_000 }, () => {
    let now = Date.parse('2026-11-22T00:00:00.000Z')
    const ledger = new TaskLedger(file(), { now: () => now })
    for (let i = 0; i < 150; i++) { settle(ledger, 'work-' + i, now); now += 60_000 }
    expect(ledger.archive()).toHaveLength(64)
    expect(ledger.deliveryBookkeepingState().orphaned).toBe(0)
    expect(ledger.receiptCapacityState(0)).toMatchObject({ owed: 0, retained: 0, available: true })
    // The mappings stay for de-duplication: a replay of the same task id is still known.
    expect(ledger.deliveryFor('work-0')).toMatchObject({ state: 'claimed' })
  })

  it('the archive trimmed on restore releases those deliveries too', () => {
    let now = Date.parse('2026-11-22T00:00:00.000Z')
    const f = file()
    const first = new TaskLedger(f, { now: () => now })
    for (let i = 0; i < 5; i++) { settle(first, 'work-' + i, now); now += 60_000 }
    const restored = new TaskLedger(f, { now: () => now, archiveCap: 2 })
    expect(restored.archive()).toHaveLength(2)
    expect(restored.deliveryBookkeepingState().orphaned).toBe(0)
    expect(restored.receiptCapacityState(0).retained).toBe(0)
  })
})

describe('#eb6d20df: the owner voids genuine orphans, audited', () => {
  function orphans() {
    const now = Date.parse('2026-11-22T19:00:00.000Z'), f = file()
    const ledger = new TaskLedger(f, { now: () => now })
    for (const id of ['orphan-a', 'orphan-b', 'orphan-c']) deliver(ledger, id, now)
    deliver(ledger, 'live', now)
    ledger.trackInbound('live', 'alpha/aaaaaaaa', 'beta/bbbbbbbb', undefined, true, 'w', undefined, undefined, SESSION)
    return { ledger, f, now }
  }

  it('voids only what is an orphan now; the rest is refused and left as it is; the audit survives a restart', () => {
    const { ledger, f, now } = orphans()
    expect(ledger.receiptCapacityState(0).retained).toBe(3)
    const out = ledger.voidOrphanDeliveries(['orphan-a', 'orphan-b', 'live', 'nope'], '13080 cleanup after review')
    expect(out.voided).toEqual(['orphan-a', 'orphan-b'])
    expect(out.refused.map(r => r.taskId)).toEqual(['live', 'nope'])
    expect(ledger.deliveryFor('orphan-a')).toMatchObject({ state: 'failed' })
    expect(ledger.deliveryFor('live')).toMatchObject({ state: 'claimed' })
    expect(ledger.receiptCapacityState(0)).toMatchObject({ retained: 1, voids: [{ taskId: 'orphan-a', sessionId: SESSION, at: now, reason: '13080 cleanup after review', by: 'owner-browser' }, { taskId: 'orphan-b' }] })
    const restored = new TaskLedger(f, { now: () => now })
    expect(restored.receiptCapacityState(0)).toMatchObject({ retained: 1, voids: [{ taskId: 'orphan-a' }, { taskId: 'orphan-b' }] })
    expect(restored.voidOrphanDeliveries(['orphan-a'], 'again').refused[0]?.taskId).toBe('orphan-a')
  })

  function route(connection: unknown, ledger: TaskLedger) {
    let handler: ((req: unknown, res: unknown) => void) | undefined
    registerReceiptCapacityFace({ register: (r: { handler: typeof handler }) => { handler = r.handler; return () => {} } } as never, {
      ctx: { effect: (fn: () => unknown) => fn(), get: () => connection } as never,
      controlRoute: fn => fn, readJsonBody: (_req, _res, use) => use((_req as { body: Record<string, unknown> }).body), ledger, logger: { info: () => {} },
    })
    return (body: Record<string, unknown>, method = 'POST') => {
      const sent: { status?: number; body?: Record<string, unknown> } = {}
      handler!({ method, headers: {}, body }, { writeHead: (s: number) => { sent.status = s }, end: (b: string) => { sent.body = JSON.parse(b) } })
      return sent
    }
  }
  const owner = { browserPeer: { id: 'peer-owner' }, admit: () => ({ peer: { id: 'peer-owner' } }) }
  const api = { browserPeer: { id: 'peer-owner' }, admit: () => ({ peer: { id: 'peer-api' } }) }

  it('the route needs the owner browser, checks its input, and voids through the ledger', () => {
    const { ledger } = orphans()
    expect(route(undefined, ledger)({ task_ids: ['orphan-a'], reason: 'x' }).status).toBe(503)
    expect(route(api, ledger)({ task_ids: ['orphan-a'], reason: 'x' }).status).toBe(403)
    expect(ledger.deliveryFor('orphan-a')).toMatchObject({ state: 'claimed' })
    const call = route(owner, ledger)
    expect(call({ task_ids: ['orphan-a'], reason: 'x' }, 'GET').status).toBe(405)
    expect(call({ task_ids: [], reason: 'x' }).status).toBe(400)
    expect(call({ task_ids: ['orphan-a'], reason: '' }).status).toBe(400)
    expect(call({ task_ids: ['orphan-a'], reason: 'x', all: true }).status).toBe(400)
    const ok = call({ task_ids: ['orphan-a', 'live'], reason: 'owner card approved' })
    expect(ok).toMatchObject({ status: 200, body: { ok: true, voided: ['orphan-a'], refused: [{ taskId: 'live' }], receiptCapacity: { retained: 2 } } })
  })
})
