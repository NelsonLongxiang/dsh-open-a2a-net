/**
 * Inbound task bodies (market request 2026-11-14): kept for the session a task was delivered to, read back with
 * a2a_task_read by that session only, and redelivered once by the idle reconciliation pass when the delivery was
 * never consumed.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { redeliverable, TASK_BODIES_MAX, TASK_BODY_MAX, TASK_BODY_TTL_MS, TaskBodies } from '../../src/task-bodies.ts'
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

  it('only a delivery the queue does not hold is redeliverable: a lost steer (untracked) or a failed one', () => {
    expect(redeliverable(undefined)).toBe(true)
    expect(redeliverable({ state: 'failed' })).toBe(true)
    for (const state of ['reserved', 'enqueued', 'claimed', 'cancelled']) expect(redeliverable({ state })).toBe(false)
  })

  it('is redelivered once', () => {
    const store = new TaskBodies('')
    store.keep('direct-1', 'session-a', 'x', 'text')
    expect(store.forRedelivery('direct-1', 'session-b')).toBeUndefined()
    expect(store.forRedelivery('direct-1', 'session-a')).toBeDefined()
    store.markRedelivered('direct-1')
    expect(store.forRedelivery('direct-1', 'session-a')).toBeUndefined()
    // a2a_task_read still returns it.
    expect(store.read('direct-1', 'session-a')).toBeDefined()
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
    const followup = vi.fn(), redelivered: string[] = []
    const reminders = new ReconciliationReminders({
      ledger, agents: () => [target], resolve: () => target, sender: () => undefined, followup, now: () => now, warn: vi.fn(),
      redeliver: (_agent, row: TaskRecord) => { const b = bodies.forRedelivery(row.taskId, 'session-a'); if (!b) return false; bodies.markRedelivered(row.taskId); redelivered.push(b.text); return true },
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
