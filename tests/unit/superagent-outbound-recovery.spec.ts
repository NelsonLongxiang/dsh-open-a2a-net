// @vitest-environment node
/** Approved outbound recovery: persisted attempts, exact approval and fail-closed reconciliation. */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { OutboundRequests, type OutboundDeps } from '../../src/superagent/host/outbound.ts'
const address = 'dsh/aaaaaaaa'
const now = () => '2026-11-14T15:00:00.000Z'
const message = '[来自 superagent 团队 finance 的请求 · 工单「cost」]\noriginal approved text'
const approved = { ok: true as const, at: now(), team: 'finance', message }
function fixture() {
 const path = join(mkdtempSync(join(tmpdir(), 'sa-out-recovery-')), 'outbound.json')
 const ask = vi.fn(async (_address: string, _text: string, task?: string) => task)
 const approval = vi.fn(() => approved)
 const query = vi.fn(async (_record: unknown, _attempt: unknown): Promise<{ delivery: 'unknown' | 'not-sent' | 'accepted' }> => ({ delivery: 'not-sent' }))
 const deps: OutboundDeps = { path, ask, note: vi.fn(), logger: { warn() {} }, now, sender: async () => 'superagent-team/0123456789abcdef', approval, query }
 const out = new OutboundRequests(deps)
 out.waiting('card', 'ticket', address, 'original approved text', 'member')
 return { out, ask, approval, query, deps, path }
}
const noSend = (task?: string) => Object.assign(new Error('local sender scope refused'), { task, delivery: 'not-sent' })
describe('approved outbound recovery', () => {
 it('identity initialization failure is checkpointed before transport and reconciliation does not create identity', async () => {
  const f = fixture()
  const sender = vi.fn(async (create?: boolean) => { if (create) throw Error('init unavailable'); return '' })
  const out = new OutboundRequests({ ...f.deps, sender })
  await out.decided('card', true, 'finance', () => 'cost')
  const record = out.list()[0]!
  expect(record).toMatchObject({ state: 'failed', approval: { at: approved.at, team: approved.team, message: approved.message }, attempts: [{ phase: 'preparing', delivery: 'not-sent', sender: '' }] })
  expect(f.ask).not.toHaveBeenCalled()
  sender.mockClear()
  expect(await out.recover('card', record.task!, false)).toMatchObject({ ok: true, state: 'failed' })
  expect(sender).toHaveBeenCalledExactlyOnceWith(false)
  expect(f.query).not.toHaveBeenCalled()
  const restored = new OutboundRequests({ ...f.deps, sender: async () => 'superagent-team/0123456789abcdef' })
  expect(await restored.recover('card', record.task!, true)).toMatchObject({ ok: true, state: 'sent' })
  expect(f.ask).toHaveBeenCalledTimes(1)
  expect(restored.list()[0]!.attempts).toHaveLength(2)
 })
 it('revocation while preparing identity never dispatches and preserves the prepared attempt', async () => {
  const f = fixture()
  const out = new OutboundRequests({ ...f.deps, sender: async () => {
   f.approval.mockReturnValue({ ok: false, code: 'a2a-off', error: 'source revoked' } as never)
   return 'superagent-team/0123456789abcdef'
  } })
  await out.decided('card', true, 'finance', () => 'cost')
  expect(f.ask).not.toHaveBeenCalled()
  expect(out.list()[0]).toMatchObject({ state: 'failed', attempts: [{ phase: 'preparing', delivery: 'not-sent' }] })
 })
 it('a receipt after a not-sent reconciliation vetoes a later retry', async () => {
  const f = fixture()
  f.ask.mockImplementationOnce(async (_a, _m, task) => { throw noSend(task) })
  await f.out.decided('card', true, 'finance', () => 'cost')
  const task = f.out.list()[0]!.task!
  f.out.received({ meta: { receiptFor: task, proof: 'origin-claim', settlement: 'settled' }, text: 'late original receipt', at: now() } as never)
  expect(f.out.list()[0]!.state).toBe('answered')
  expect(await f.out.recover('card', task, true)).toMatchObject({ ok: false, code: 'outbound-state' })
  expect(f.ask).toHaveBeenCalledTimes(1)
 })

 it('persists the task before sending and restores only the same approved text under temporary exact-target scope', async () => {
  const f = fixture()
  f.ask.mockImplementationOnce(async (_a, _m, task) => {
   expect(JSON.parse(readFileSync(f.path, 'utf8')).card).toMatchObject({ state: 'sending', task })
   expect(f.out.authorizes(address)).toBe(true)
   throw noSend(task)
  })
  await f.out.decided('card', true, 'finance', () => 'cost')
  const first = f.out.list()[0]!
  expect(first).toMatchObject({ state: 'failed', attempts: [{ delivery: 'not-sent', sender: 'superagent-team/0123456789abcdef' }] })
  const oldTask = first.task!
  const r = await f.out.recover('card', oldTask, true)
  expect(r).toMatchObject({ ok: true, state: 'sent' })
  const last = f.out.list()[0]!
  expect(last.task).not.toBe(oldTask)
  expect(last.attempts).toHaveLength(2)
  expect(last.attempts![0]).toMatchObject({ task: oldTask, delivery: 'not-sent' })
  expect(f.ask).toHaveBeenNthCalledWith(2, address, message, last.task, 'superagent-team/0123456789abcdef')
  expect(f.out.authorizes(address)).toBe(false)
  expect(f.approval).toHaveBeenCalled()
  expect(await f.out.recover('card', oldTask, true)).toMatchObject({ ok: false, code: 'outbound-changed' })
  expect(f.ask).toHaveBeenCalledTimes(2)
 })
 it('unknown send, pending and a missing/expired query never authorize a new attempt', async () => {
  const f = fixture()
  f.ask.mockRejectedValueOnce(new Error('HTTP timeout: acceptance unknown'))
  f.query.mockResolvedValue({ delivery: 'unknown' })
  await f.out.decided('card', true, 'finance', () => 'cost')
  const task = f.out.list()[0]!.task!
  expect(f.out.list()[0]).toMatchObject({ state: 'unknown' })
  expect(await f.out.recover('card', task, true)).toMatchObject({ ok: false, code: 'outbound-unknown' })
  expect(f.ask).toHaveBeenCalledTimes(1)
 })
 it('a trusted not-sent outcome can reconcile an unknown attempt, but reconcile does not send', async () => {
  const f = fixture()
  f.ask.mockRejectedValueOnce(new Error('response lost'))
  await f.out.decided('card', true, 'finance', () => 'cost')
  f.query.mockResolvedValue({ delivery: 'not-sent' } as never)
  const task = f.out.list()[0]!.task!
  expect(await f.out.recover('card', task, false)).toMatchObject({ ok: true, state: 'failed' })
  expect(f.ask).toHaveBeenCalledTimes(1)
  expect(await f.out.recover('card', task, true)).toMatchObject({ ok: true, state: 'sent' })
  expect(f.ask).toHaveBeenCalledTimes(2)
 })
 it('accepted outcome reconciles without resend and keeps the original task for its receipt', async () => {
  const f = fixture()
  f.ask.mockRejectedValueOnce(new Error('response lost'))
  await f.out.decided('card', true, 'finance', () => 'cost')
  f.query.mockResolvedValue({ delivery: 'accepted' } as never)
  const task = f.out.list()[0]!.task!
  expect(await f.out.recover('card', task, true)).toMatchObject({ ok: true, state: 'sent' })
  expect(f.out.list()[0]!.task).toBe(task)
  expect(f.ask).toHaveBeenCalledTimes(1)
 })
 it('serializes concurrent clicks before awaiting query/identity; stale replay cannot create a third attempt', async () => {
  const f = fixture()
  f.ask.mockImplementationOnce(async (_a, _m, task) => { throw noSend(task) })
  await f.out.decided('card', true, 'finance', () => 'cost')
  const old = f.out.list()[0]!.task!
  let release!: () => void
  f.query.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r }); return { delivery: 'not-sent' } })
  const first = f.out.recover('card', old, true)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect(await f.out.recover('card', old, true)).toMatchObject({ ok: false, code: 'outbound-busy' })
  release(); await first
  expect(f.ask).toHaveBeenCalledTimes(2)
  expect(await f.out.recover('card', old, true)).toMatchObject({ ok: false, code: 'outbound-changed' })
 })
 it('restart of an in-flight attempt reconciles only; no automatic send and unknown outcome stays blocked', async () => {
  const f = fixture()
  let finish!: () => void
  f.ask.mockImplementationOnce(async (_a, _m, task) => { await new Promise<void>(r => { finish = r }); return task })
  const sending = f.out.decided('card', true, 'finance', () => 'cost')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const restored = new OutboundRequests(f.deps)
  f.query.mockResolvedValue({ delivery: 'unknown' })
  const task = restored.list()[0]!.task!
  expect(await restored.recover('card', task, true)).toMatchObject({ ok: false, code: 'outbound-unknown' })
  expect(f.ask).toHaveBeenCalledTimes(1)
  finish(); await sending
 })
 it('rejects revoked approval, ended/source-disabled contexts, changed approval payload and changed sender identity', async () => {
  const f = fixture()
  f.ask.mockImplementationOnce(async (_a, _m, task) => { throw noSend(task) })
  await f.out.decided('card', true, 'finance', () => 'cost')
  const task = f.out.list()[0]!.task!
  f.approval.mockReturnValueOnce({ ok: false, code: 'ticket', error: 'ended' } as never)
  expect(await f.out.recover('card', task, true)).toMatchObject({ ok: false, code: 'ticket' })
  f.approval.mockReturnValueOnce({ ...approved, message: 'changed text' })
  expect(await f.out.recover('card', task, true)).toMatchObject({ ok: false, code: 'outbound-approval' })
  const changed = new OutboundRequests({ ...f.deps, sender: async () => 'superagent-team/fedcba9876543210' })
  expect(await changed.recover('card', task, true)).toMatchObject({ ok: false, code: 'outbound-identity' })
  expect(f.ask).toHaveBeenCalledTimes(1)
 })
 it('legacy failure text is not a recovery proof; no new task on missing evidence', async () => {
  const f = fixture()
  writeFileSync(f.path, JSON.stringify({ card: { card: 'card', ticketId: 'ticket', address, text: 'original approved text', by: 'member', at: now(), state: 'failed', task: 'old-failed', error: 'not forwarded: target is outside sender scope' } }))
  const restored = new OutboundRequests(f.deps)
  expect(await restored.recover('card', 'old-failed', true)).toMatchObject({ ok: false, code: 'outbound-unknown' })
  expect(f.ask).not.toHaveBeenCalled()
  expect(restored.list()[0]!.task).toBe('old-failed')
 })
 it('a retained not-sent marker cannot override a current missing/expired/unknown outcome', async () => {
  const f = fixture()
  f.ask.mockImplementationOnce(async (_a, _m, task) => { throw noSend(task) })
  await f.out.decided('card', true, 'finance', () => 'cost')
  f.query.mockResolvedValue({ delivery: 'unknown' })
  const before = f.out.list()[0]!
  expect(before.attempts![0]!.delivery).toBe('not-sent')
  expect(await f.out.recover('card', before.task!, true)).toMatchObject({ ok: false, code: 'outbound-unknown' })
  expect(f.ask).toHaveBeenCalledTimes(1)
 })
 it('a trustworthy receipt arriving during reconciliation wins over the query snapshot and prevents resend', async () => {
  const f = fixture()
  f.ask.mockRejectedValueOnce(new Error('response lost'))
  await f.out.decided('card', true, 'finance', () => 'cost')
  const task = f.out.list()[0]!.task!
  let release!: () => void
  f.query.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r }); return { delivery: 'not-sent' } })
  const recovering = f.out.recover('card', task, true)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.out.received({ meta: { receiptFor: task, proof: 'origin-claim', settlement: 'settled' }, text: 'delivered receipt', at: now() } as never)
  release()
  expect(await recovering).toMatchObject({ ok: true, state: 'answered', task })
  expect(f.ask).toHaveBeenCalledTimes(1)
  expect(f.out.list()[0]!.answer!.text).toBe('delivered receipt')
 })
 it('independent instances racing the same failed task can reserve only one new attempt on disk', async () => {
  const f = fixture()
  f.ask.mockImplementationOnce(async (_a, _m, task) => { throw noSend(task) })
  await f.out.decided('card', true, 'finance', () => 'cost')
  const task = f.out.list()[0]!.task!
  const other = new OutboundRequests(f.deps)
  const releases: Array<() => void> = []
  f.query.mockImplementation(async () => { await new Promise<void>(r => releases.push(r)); return { delivery: 'not-sent' } })
  const attempts = [f.out.recover('card', task, true), other.recover('card', task, true)]
  await vi.waitFor(() => expect(releases).toHaveLength(2))
  releases.forEach(r => r())
  const results = await Promise.allSettled(attempts)
  expect(results.filter(r => r.status === 'fulfilled' && r.value.ok)).toHaveLength(1)
  expect(f.ask).toHaveBeenCalledTimes(2)
  const saved = JSON.parse(readFileSync(f.path, 'utf8')).card
  expect(saved.state).toBe('sent')
  expect(saved.attempts).toHaveLength(2)
  expect(saved.attempts[0].task).toBe(task)
 })
 it('a not-sent error for a different task is unknown, and external list mutations cannot alter persisted authority', async () => {
  const f = fixture()
  f.ask.mockRejectedValueOnce(noSend('different-task'))
  await f.out.decided('card', true, 'finance', () => 'cost')
  expect(f.out.list()[0]!.state).toBe('unknown')
  const view = f.out.list()[0]!
  view.state = 'failed'
  view.attempts![0]!.delivery = 'not-sent'
  expect(f.out.list()[0]!.state).toBe('unknown')
  expect(f.out.list()[0]!.attempts![0]!.delivery).toBe('unknown')
 })
 it('write failure before send cannot leak scope or dispatch', () => {
  const f = fixture()
  const broken = new OutboundRequests({ ...f.deps, path: join(f.path, 'cannot-write.json') })
  expect(() => broken.waiting('x', 't', address, 'text', 'm')).toThrow()
  expect(broken.list()).toHaveLength(0)
  expect(f.ask).not.toHaveBeenCalled()
  expect(broken.authorizes(address)).toBe(false)
 })
 it('post-send write failure leaves the persisted sending checkpoint for reconciliation and never auto-resends', async () => {
  const f = fixture()
  const checkpoint = f.path + '.checkpoint'
  f.ask.mockImplementationOnce(async (_a, _m, task) => {
   expect(JSON.parse(readFileSync(f.path, 'utf8')).card.task).toBe(task)
   renameSync(f.path, checkpoint)
   mkdirSync(f.path)
   return task
  })
  try {
   await expect(f.out.decided('card', true, 'finance', () => 'cost')).rejects.toThrow()
   expect(f.out.authorizes(address)).toBe(false)
   expect(JSON.parse(readFileSync(checkpoint, 'utf8')).card.state).toBe('sending')
   expect(f.ask).toHaveBeenCalledTimes(1)
  } finally { rmSync(f.path, { recursive: true }); renameSync(checkpoint, f.path) }
  const restored = new OutboundRequests(f.deps)
  f.query.mockResolvedValue({ delivery: 'unknown' })
  expect(await restored.recover('card', restored.list()[0]!.task!, true)).toMatchObject({ ok: false, code: 'outbound-unknown' })
  expect(f.ask).toHaveBeenCalledTimes(1)
 })
})
