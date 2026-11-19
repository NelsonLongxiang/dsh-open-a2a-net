/**
 * #713 stage A2: the typed capacity refusal as it travels. Built only from DeliveryCapacityError, decoded strictly from a
 * peer (no extra keys, unknown view stays unknown), outranked by an unknown acceptance, never claimed for a whole route
 * with other failures, and the in-process admission seam (FollowupDelivery) refuses before any followup call.
 */
import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from '../temp-dirs.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { A2aClient, type A2aFetch } from '../../src/a2a-client.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { FollowupDelivery } from '../../src/followup-delivery.ts'
import { TASK_DELIVERY_CAP as CAP, TASK_DELIVERY_RETENTION_MS as TTL, type TaskDelivery } from '../../src/task-delivery.ts'
import { DeliveryCapacityError, capacityRefusalOf, parseCapacityRefusal, capacityRefusalFields, capacityRefusalNote, type CapacityRefusal, type DeliveryCapacitySnapshot } from '../../src/task-delivery-capacity.ts'

const T0 = 1_800_000_000_000
const view: DeliveryCapacitySnapshot = { status: 'observed', observedAt: T0, capacity: CAP, retentionMs: TTL, stored: CAP, retained: CAP, expiredUntracked: 0, taskBound: 0, saturated: true, retainedByState: { reserved: 0, enqueued: 0, claimed: 0, cancelled: CAP, failed: 0 }, earliestPossibleExpiryAt: T0 + TTL + 1 }
const refusal: CapacityRefusal = { code: 'correspondence-capacity', notSent: true, capacity: view }

describe('#713 A2 typed capacity refusal', () => {
  it('only a DeliveryCapacityError becomes a refusal', () => {
    expect(capacityRefusalOf(new DeliveryCapacityError(view))).toEqual(refusal)
    expect(capacityRefusalOf(Error('task delivery correspondence capacity reached; refusing untracked delivery'))).toBeUndefined()
    expect(capacityRefusalOf('correspondence-capacity')).toBeUndefined()
  })

  it('decodes strictly: exact keys, exact code, notSent true; a bad view stays unknown', () => {
    expect(parseCapacityRefusal(JSON.parse(JSON.stringify(refusal)))).toEqual(refusal)
    expect(parseCapacityRefusal({ ...refusal, taskId: 'leak' })).toBeUndefined()
    expect(parseCapacityRefusal({ ...refusal, code: 'queue-full' })).toBeUndefined()
    expect(parseCapacityRefusal({ ...refusal, notSent: false })).toBeUndefined()
    expect(parseCapacityRefusal({ code: 'correspondence-capacity', notSent: true, capacity: { ...view, retained: -1 } })).toEqual({ ...refusal, capacity: 'unknown' })
    expect(parseCapacityRefusal({ code: 'correspondence-capacity', notSent: true, capacity: 'unknown' })).toEqual({ ...refusal, capacity: 'unknown' })
    expect(parseCapacityRefusal(null)).toBeUndefined()
    expect(parseCapacityRefusal([refusal])).toBeUndefined()
  })

  it('a route with other failures carries only the count, never one refusal for the whole route', () => {
    expect(capacityRefusalFields([], 2)).toEqual({})
    expect(capacityRefusalFields([refusal], 1)).toEqual({ refusal, capacityRefusals: 1 })
    expect(capacityRefusalFields([refusal], 2)).toEqual({ capacityRefusals: 1 })
    expect(capacityRefusalFields([refusal, refusal], 2)).toEqual({ capacityRefusals: 2 })
  })

  it('the note names the host-wide window, says nothing was sent, and gives an expiry only from an observed view', () => {
    const note = capacityRefusalNote(refusal)
    expect(note).toContain('host-wide')
    expect(note).toContain('nothing was sent')
    expect(note).toContain(new Date(T0 + TTL + 1).toISOString())
    expect(note).toContain('not a promise of a free slot')
    expect(capacityRefusalNote({ ...refusal, capacity: 'unknown' })).not.toContain('expire')
    // #746 R1 applies here too: a far-future expiry past what a Date holds is text, never a throw.
    const far = { ...view, earliestPossibleExpiryAt: 8_640_000_000_000_000 + TTL + 1 }
    expect(() => capacityRefusalNote({ ...refusal, capacity: far })).not.toThrow()
    expect(capacityRefusalNote({ ...refusal, capacity: far })).toContain('ms since the epoch')
  })

  describe('client decode', () => {
    const answering = (status: number, body: unknown): A2aFetch => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
    const route = (fetch: A2aFetch) => new A2aClient({ apiKey: '', sessionId: 'cap', fetch, schedule: () => () => undefined }).routeDirect('http://peer.example', 'beta/01234567', 'work', undefined, undefined, undefined, true)

    it('rebuilds the refusal from a 200 failure body; its text is local', async () => {
      const result = await route(answering(200, { error: 'peer text', code: -32000, task_status: 'TASK_STATE_FAILED', refusal }))
      expect(result).toMatchObject({ ok: false, refusal, error: capacityRefusalNote(refusal) })
    })

    it('an unknown acceptance outranks a capacity claim', async () => {
      const result = await route(answering(200, { error: 'x', acceptance: 'unknown', task_id: 't1', refusal })) as any
      expect(result.acceptance).toBe('unknown')
      expect(result.refusal).toBeUndefined()
    })

    it('a hostile or old peer field is dropped, not trusted', async () => {
      const result = await route(answering(200, { error: 'x', refusal: { ...refusal, extra: 1 } })) as any
      expect(result.refusal).toBeUndefined()
      expect(result.error).toBe('x')
    })

    it('rebuilds the refusal from a non-2xx body too', async () => {
      const result = await route(answering(503, { error: 'peer text', code: -32000, refusal })) as any
      expect(result.refusal).toEqual(refusal)
      expect(result.error).toBe(capacityRefusalNote(refusal))
    })
  })

  it('in-process admission: a full window refuses before any followup call and leaves the ledger as it was', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'capacity-refusal-')), 'tasks.json')
    const row = (i: number): TaskDelivery => ({ version: 1, taskId: 'seed-' + String(i), sessionId: 'session-ffffffff00001111', messageId: 'm-' + String(i), fingerprint: 'c'.repeat(64), createdAt: Date.now(), state: 'cancelled' })
    new TaskLedger(file, { warn: () => {} }).reserveDelivery(row(0))
    const snap = JSON.parse(readFileSync(file, 'utf8'))
    snap.taskDeliveries = Array.from({ length: CAP }, (_, i) => row(i))
    writeFileSync(file, JSON.stringify(snap))
    const ledger = new TaskLedger(file, { warn: () => {} })
    const bytes = readFileSync(file, 'utf8')
    const followup = vi.fn(), taint = vi.fn()
    const agent = { id: SessionId('session-aaaaaaaa11112222'), followup } as unknown as Agent
    const delivery = new FollowupDelivery({ ledger, taint, warn: () => {} })
    let error: unknown
    try { delivery.deliver(agent, 'work', 'alpha/01234567', undefined, 'new-task', undefined, true) } catch (e) { error = e }
    expect(capacityRefusalOf(error)).toMatchObject({ code: 'correspondence-capacity', notSent: true })
    expect(followup).not.toHaveBeenCalled()
    expect(taint).not.toHaveBeenCalled()
    expect(ledger.deliveryFor('new-task')).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(bytes)
  })
})
