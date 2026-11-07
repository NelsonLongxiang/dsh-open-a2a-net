/**
 * superagent v4, requester acknowledgement: an `acknowledged` receipt marks the caller's owed row instead of settling it.
 * The row stays owed until the result receipt, leaves the queue count, and expires 7 days after the acknowledgement
 * instead of 24 hours after dispatch.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'
import { parseReceipt } from '../../src/receipt.ts'
import { queuedFor } from '../../src/queue-guard.ts'

const HOUR = 3_600_000, DAY = 24 * HOUR
const path = () => join(mkdtempSync(join(tmpdir(), 'dsh-a2a-ack-')), 'a2a', 'tasks.json')
const ack = (task: string, line = '已接下') => `[A2A receipt] task ${task} ${line}\n${JSON.stringify({ idempotencyKey: task, disposition: 'acknowledged' })}`
const result = (task: string, line = '完成') => `[A2A receipt] task ${task} ${line}\n${JSON.stringify({ outcome: 'completed', idempotencyKey: task, disposition: 'result' })}`

function clocked() {
  let t = 1_000_000
  const file = path()
  const ledger = new TaskLedger(file, { now: () => t })
  return { ledger, file, advance: (ms: number) => { t += ms }, now: () => t }
}

describe('acknowledged receipts', () => {
  it('the codec keeps the disposition', () => {
    expect(parseReceipt(ack('t1'))?.envelope?.disposition).toBe('acknowledged')
  })

  it('mark the owed row and settle nothing; the result settles it', () => {
    const { ledger } = clocked()
    ledger.track('t1', 'superagent-team/0123456789abcdef', 'local')
    const marked = ledger.resolveFromMessage(ack('t1'))
    expect(marked).toMatchObject({ taskId: 't1', acknowledged: true, disposition: 'acknowledged' })
    expect(ledger.find('t1')).toMatchObject({ status: 'pending', acknowledgedAt: expect.any(Number) })
    expect(ledger.archive().some(r => r.taskId === 't1')).toBe(false)
    expect(ledger.resolveFromMessage(result('t1'))).toMatchObject({ taskId: 't1', outcome: 'completed' })
    expect(ledger.find('t1')).toBeUndefined()
    expect(ledger.archive().find(r => r.taskId === 't1')).toMatchObject({ summary: '完成', acknowledgedAt: expect.any(Number) })
  })

  it('an acknowledged row outlives the 24-hour TTL and expires 7 days after the acknowledgement', () => {
    const { ledger: raw, advance } = clocked()
    // The sweep is lazy: list() runs it, find() does not.
    const ledger = { ...raw, track: raw.track.bind(raw), resolveFromMessage: raw.resolveFromMessage.bind(raw), find: (id: string) => { raw.list(); return raw.find(id) } }
    ledger.track('t1', 'team', 'local')
    ledger.track('t2', 'team', 'local')
    advance(HOUR)
    ledger.resolveFromMessage(ack('t1'))
    advance(DAY)
    expect(ledger.find('t2')?.status).toBe('dead')
    expect(ledger.find('t1')?.status).toBe('pending')
    advance(6 * DAY - HOUR)
    expect(ledger.find('t1')?.status).toBe('pending')
    advance(2 * HOUR)
    expect(ledger.find('t1')).toMatchObject({ status: 'dead', reason: 'unconsumed' })
  })

  it('an acknowledgement revives a row that already dead-lettered; a late result still settles it', () => {
    const { ledger: raw, advance } = clocked()
    // The sweep is lazy: list() runs it, find() does not.
    const ledger = { ...raw, track: raw.track.bind(raw), resolveFromMessage: raw.resolveFromMessage.bind(raw), find: (id: string) => { raw.list(); return raw.find(id) } }
    ledger.track('t1', 'team', 'local')
    advance(DAY + HOUR)
    expect(ledger.find('t1')?.status).toBe('dead')
    expect(ledger.resolveFromMessage(ack('t1'))).toMatchObject({ acknowledged: true, late: true })
    expect(ledger.find('t1')).toMatchObject({ status: 'pending' })
    expect(ledger.find('t1')?.deadAt).toBeUndefined()
    expect(ledger.resolveFromMessage(result('t1'))).toMatchObject({ taskId: 't1' })
  })

  it('never touches a settled row or an unknown id', () => {
    const { ledger } = clocked()
    ledger.track('t1', 'team', 'local')
    ledger.resolveFromMessage(result('t1', '结果'))
    expect(ledger.resolveFromMessage(ack('t1', '迟到的确认'))).toBeUndefined()
    expect(ledger.archive().find(r => r.taskId === 't1')?.summary).toBe('结果')
    expect(ledger.resolveFromMessage(ack('nope'))).toBeUndefined()
  })

  it('an acknowledged row no longer counts against the target\'s queue', () => {
    const { ledger } = clocked()
    for (const id of ['q1', 'q2', 'q3']) ledger.track(id, 'superagent-team/0123456789abcdef', 'local')
    expect(queuedFor(ledger.list(), 'superagent-team/0123456789abcdef')).toBe(3)
    ledger.resolveFromMessage(ack('q2'))
    expect(queuedFor(ledger.list(), 'superagent-team/0123456789abcdef')).toBe(2)
  })

  it('survives a restart', () => {
    const { ledger, file } = clocked()
    ledger.track('t1', 'team', 'local')
    ledger.resolveFromMessage(ack('t1'))
    expect(new TaskLedger(file).find('t1')?.acknowledgedAt).toEqual(ledger.find('t1')?.acknowledgedAt)
  })

  it('a refused settler cannot acknowledge under enforce', () => {
    const { ledger } = clocked()
    ledger.track('t1', 'team', 'local')
    const judge = { enforce: true, settler: { caller: 'someone-else' }, check: () => ({ ok: false as const, reason: 'off-chain' }) }
    expect(ledger.resolveFromMessage(ack('t1'), judge as never)).toBeUndefined()
    expect(ledger.find('t1')?.acknowledgedAt).toBeUndefined()
  })
})
