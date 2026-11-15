/**
 * Inbound task bodies (market request 2026-11-14): kept for the session a task was delivered to, read back with
 * a2a_task_read by that session only, and redelivered once by the idle reconciliation pass when the delivery was
 * never consumed.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { clipUtf8, redeliverable, redeliverLost, TASK_BODIES_MAX, TASK_BODY_MAX, TASK_BODY_TTL_MS, TaskBodies } from '../../src/task-bodies.ts'
import { FollowupDelivery } from '../../src/followup-delivery.ts'
import { writeFileSync } from 'node:fs'
import { registerTaskRead } from '../../src/tools/task-read.ts'
import { TaskLedger, type TaskRecord } from '../../src/task-ledger.ts'
import { ReconciliationReminders } from '../../src/reconciliation-reminders.ts'
import { peerContentOf } from '../../src/node-self.ts'

describe('TaskBodies', () => {
  it('keeps a delivery\'s text for its receiver only, survives a restart, and expires', () => {
    let now = 1_000
    const path = join(mkdtempSync(join(tmpdir(), 'tb-')), 'task-bodies.json')
    const store = new TaskBodies(path, () => now)
    store.keep('direct-1', 'session-a', 'dsh/446ce672', '把镜像分块传给运维')
    expect(store.read('direct-1', 'session-a')).toMatchObject({ text: '把镜像分块传给运维', from: 'dsh/446ce672', truncated: false })
    // Adversarial: another session gets what a missing task gets.
    expect(store.read('direct-1', 'session-b')).toBeUndefined()
    expect(store.read('direct-x', 'session-a')).toBeUndefined()
    expect(new TaskBodies(path, () => now).read('direct-1', 'session-a')?.text).toBe('把镜像分块传给运维')
    now += TASK_BODY_TTL_MS
    expect(store.read('direct-1', 'session-a')).toBeUndefined()
  })

  it('is bounded: a long text is clipped and says so; the oldest bodies go first', () => {
    const store = new TaskBodies('')
    store.keep('long', 'session-a', 'x', 'y'.repeat(TASK_BODY_MAX + 10))
    expect(store.read('long', 'session-a')).toMatchObject({ truncated: true })
    expect(store.read('long', 'session-a')!.text).toHaveLength(TASK_BODY_MAX)
    for (let i = 0; i < TASK_BODIES_MAX; i++) store.keep(`t-${String(i)}`, 'session-a', 'x', 'z')
    expect(store.read('long', 'session-a')).toBeUndefined()
    expect(store.read(`t-${String(TASK_BODIES_MAX - 1)}`, 'session-a')).toBeDefined()
  })

  it('caps bodies in UTF-8 bytes on a character boundary (65536 CJK characters are 196608 bytes)', () => {
    const store = new TaskBodies('')
    store.keep('cjk', 'session-a', 'x', '汉'.repeat(65_536))
    const body = store.read('cjk', 'session-a')!
    expect(body.truncated).toBe(true)
    expect(Buffer.byteLength(body.text, 'utf8')).toBeLessThanOrEqual(TASK_BODY_MAX)
    expect(body.text).toBe('汉'.repeat(Math.floor(TASK_BODY_MAX / 3)))
    expect(clipUtf8('a汉b', 2)).toEqual({ text: 'a', truncated: true })
  })

  it('re-applies size, lifetime and count limits to what is read back from disk', () => {
    const now = 10_000
    const path = join(mkdtempSync(join(tmpdir(), 'tb-restore-')), 'task-bodies.json')
    const bodies = [
      { taskId: 'big', receiver: 'session-a', from: 'x', text: 'y'.repeat(TASK_BODY_MAX + 5), truncated: false, at: now, expiresAt: now + 10 * TASK_BODY_TTL_MS },
      { taskId: 'old', receiver: 'session-a', from: 'x', text: 'z', truncated: false, at: now - 2 * TASK_BODY_TTL_MS, expiresAt: now + TASK_BODY_TTL_MS },
      ...Array.from({ length: TASK_BODIES_MAX }, (_, i) => ({ taskId: `t-${String(i)}`, receiver: 'session-a', from: 'x', text: 't', truncated: false, at: now, expiresAt: now + TASK_BODY_TTL_MS })),
    ]
    writeFileSync(path, JSON.stringify({ bodies }))
    const store = new TaskBodies(path, () => now)
    expect(store.read('old', 'session-a')).toBeUndefined()
    expect(store.read('big', 'session-a')).toBeUndefined()
    expect(store.read(`t-${String(TASK_BODIES_MAX - 1)}`, 'session-a')).toBeDefined()
    writeFileSync(path, JSON.stringify({ bodies: [bodies[0]] }))
    const one = new TaskBodies(path, () => now).read('big', 'session-a')!
    expect(one).toMatchObject({ truncated: true, expiresAt: now + TASK_BODY_TTL_MS })
    expect(Buffer.byteLength(one.text)).toBe(TASK_BODY_MAX)
  })

  it('only a delivery the ledger never tracked is redeliverable; any correspondence is reconciled instead', () => {
    expect(redeliverable(undefined)).toBe(true)
    for (const state of ['reserved', 'enqueued', 'claimed', 'cancelled', 'failed']) expect(redeliverable({ state })).toBe(false)
  })
})

describe('redelivery of a lost steer is a queued delivery of the original task (#693 review F1/F2)', () => {
  function setup(followup?: (message: unknown) => void) {
    const ledger = new TaskLedger(join(mkdtempSync(join(tmpdir(), 'tb-redeliver-')), 'tasks.json'))
    ledger.trackInbound('direct-lost', 'dsh/aaaaaaaa', 'cli/0123456789abcdef', undefined, true, 'brief', undefined, undefined, 'session-a', false)
    const bodies = new TaskBodies('')
    bodies.keep('direct-lost', 'session-a', 'cli/0123456789abcdef', '完整正文')
    const sent: Array<{ id: string; source: Record<string, unknown>; text: string }> = []
    const agent = { id: 'session-a', session: { id: 'session-a', events: [] as unknown[] }, inbox: { nextTurn: [] as unknown[] }, ...(followup === null ? {} : { followup: followup ?? ((m: { id: string; source: Record<string, unknown>; content: Array<{ text: string }> }) => { sent.push({ id: m.id, source: m.source, text: m.content[0]!.text }) }) }) }
    const delivery = new FollowupDelivery({ ledger, taint: vi.fn(), warn: vi.fn() })
    const run = () => redeliverLost({ deliveryFor: id => ledger.deliveryFor(id), bodies, relay: (text, from, taskId) => { delivery.deliver(agent as never, text, from, undefined, taskId, undefined, true) }, warn: vi.fn() }, 'session-a', 'direct-lost')
    return { ledger, bodies, sent, agent, delivery, run }
  }

  it('goes out once, carrying the original task id; the queue\'s claim marks the original task consumed', () => {
    const f = setup()
    expect(f.run()).toBe(true)
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0]!.source).toMatchObject({ taskId: 'direct-lost', senderSessionId: 'cli/0123456789abcdef' })
    expect(f.sent[0]!.text).toContain('完整正文')
    expect(f.ledger.deliveryFor('direct-lost')).toMatchObject({ state: 'enqueued' })
    // Never twice: the correspondence now stands for it.
    expect(f.run()).toBe(false)
    expect(f.sent).toHaveLength(1)
    f.delivery.claimed(f.agent as never, f.sent[0]!.id)
    expect(f.ledger.find('direct-lost')?.consumed).toBe(true)
  })

  it('a withdrawal finds the redelivered item through the original task id', async () => {
    const f = setup()
    f.run()
    const removed: unknown[] = []
    expect(await f.delivery.withdraw('direct-lost', { updateQueue: async request => { removed.push(request) } }, () => undefined)).toBe('removed')
    expect(removed).toHaveLength(1)
    expect(f.ledger.deliveryFor('direct-lost')).toMatchObject({ state: 'cancelled' })
  })

  it('an unknown outcome keeps its reservation and is never redelivered blindly; a session without followup gets nothing and no record', () => {
    const unknown = setup(() => { throw new Error('host failed after insert?') })
    expect(unknown.run()).toBe(true)
    expect(unknown.ledger.deliveryFor('direct-lost')).toMatchObject({ state: 'reserved' })
    expect(unknown.run()).toBe(false)
    const none = setup(null as never)
    expect(none.run()).toBe(false)
    expect(none.ledger.deliveryFor('direct-lost')).toBeUndefined()
  })
})

describe('a2a_task_read', () => {
  function harness() {
    const defs = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }>()
    const store = new TaskBodies('')
    const consumed: string[] = []
    registerTaskRead({ ctx: { tools: { register: (d: { name: string; execute: never }) => { defs.set(d.name, d); return () => {} } } } as never, taskBodies: store, markConsumed: id => { consumed.push(id) } })
    const as = (id: string) => (args: unknown) => defs.get('a2a_task_read')!.execute(args, { agent: { id } })
    return { store, consumed, a: as('session-a'), b: as('session-b') }
  }

  it('the receiving session reads the original text; reading consumes the delivery; the result is peer content', async () => {
    const h = harness()
    h.store.keep('direct-2792c9b5c793', 'session-a', 'cli/0123456789abcdef', '正文：请把第 3 段镜像重新上传')
    const out = await h.a({ task_id: 'direct-2792c9b5c793' })
    expect(out).toMatchObject({ ok: true, task_id: 'direct-2792c9b5c793', from: 'cli/0123456789abcdef', text: '正文：请把第 3 段镜像重新上传' })
    expect(h.consumed).toEqual(['direct-2792c9b5c793'])
    expect(peerContentOf('a2a_task_read', out)).toBe(true)
  })

  it('adversarial: another session cannot read it — answered as a missing task, and nothing is consumed', async () => {
    const h = harness()
    h.store.keep('direct-1', 'session-a', 'x', 'secret')
    const theirs = await h.b({ task_id: 'direct-1' })
    const missing = await h.b({ task_id: 'direct-none' })
    expect(theirs).toEqual(missing)
    expect(theirs).toMatchObject({ ok: false, code: 'not-found' })
    expect(JSON.stringify(theirs)).not.toContain('secret')
    expect(h.consumed).toEqual([])
    expect(peerContentOf('a2a_task_read', theirs)).toBe(false)
  })
})

describe('idle redelivery of an unconsumed delivery', () => {
  function fixture(consumed: boolean | undefined) {
    let now = 1_000_000
    const ledger = new TaskLedger(join(mkdtempSync(join(tmpdir(), 'tb-ledger-')), 'tasks.json'), { now: () => now, staleTtlMs: 10 * 86_400_000 })
    const target = { id: 'session-a', status: 'idle' }
    ledger.trackInbound('direct-1', 'dsh/aaaaaaaa', 'cli/0123456789abcdef', undefined, true, '镜像传输', undefined, undefined, 'session-a', consumed)
    const bodies = new TaskBodies('', () => now)
    bodies.keep('direct-1', 'session-a', 'cli/0123456789abcdef', '完整正文')
    const followup = vi.fn(), redelivered: string[] = [], tracked = new Map<string, { state: string }>()
    const reminders = new ReconciliationReminders({
      ledger, agents: () => [target], resolve: () => target, sender: () => undefined, followup, now: () => now, warn: vi.fn(),
      redeliver: (_agent, row: TaskRecord) => redeliverLost({ deliveryFor: () => tracked.get(row.taskId), bodies, relay: (text, _from, taskId) => { redelivered.push(text.slice(text.lastIndexOf('\n') + 1)); tracked.set(taskId, { state: 'enqueued' }) }, warn: vi.fn() }, 'session-a', row.taskId),
    })
    return { reminders, followup, redelivered, target, advance: (ms: number) => { now += ms } }
  }

  it('an unconsumed delivery gets its text back once when the session is idle; the reminder follows in a later window', () => {
    const f = fixture(false)
    f.reminders.scan()
    expect(f.redelivered).toEqual(['完整正文'])
    expect(f.followup).not.toHaveBeenCalled()
    f.advance(24 * 3_600_000)
    f.reminders.scan()
    expect(f.redelivered).toEqual(['完整正文'])
    expect(f.followup).toHaveBeenCalledTimes(1)
  })

  it('a busy session gets nothing; a consumed delivery is never redelivered', () => {
    const busy = fixture(false)
    busy.target.status = 'running'
    busy.reminders.scan()
    expect(busy.redelivered).toEqual([])
    const consumed = fixture(true)
    consumed.reminders.scan()
    expect(consumed.redelivered).toEqual([])
  })
})
