import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import {
  CAPABILITIES, declares, formatDispatch, formatReceipt, holdsRow, parseDispatch, parseReceipt, parseRoster,
  receiptTaskId, taskKind,
} from '../../src/sdk/wire.ts'

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'))

describe('sdk/wire: the dispatch line', () => {
  it('round-trips formatDispatch through parseDispatch', () => {
    const sent = formatDispatch({ for: 'seat-11112222' }, '做一个对账表')
    expect(sent).toBe('[A2A dispatch] {"for":"seat-11112222"}\n做一个对账表')
    expect(parseDispatch(sent)).toEqual({ line: { for: 'seat-11112222' }, body: '做一个对账表' })
    const rework = formatDispatch({ rework: { of: 'wbe-1.d26.q7.a1' } }, '')
    expect(parseDispatch(rework)).toEqual({ line: { rework: { of: 'wbe-1.d26.q7.a1' } }, body: '' })
  })
  it('refuses an empty line, an over-long for, and an over-long rework.of', () => {
    expect(formatDispatch({}, 'x')).toBeUndefined()
    expect(formatDispatch({ for: '' }, 'x')).toBeUndefined()
    expect(formatDispatch({ for: 'a'.repeat(129) }, 'x')).toBeUndefined()
    expect(formatDispatch({ rework: { of: 'a'.repeat(129) } }, 'x')).toBeUndefined()
  })
  it('reads the line under the network delivery header', () => {
    const delivered = '[A2A direct] (task t1) 未验证（cli-identity） from "market/fd417315" (routed to team) sent:\n\n' + (formatDispatch({ for: 'seat-1' }, 'hi') ?? '')
    expect(parseDispatch(delivered)).toEqual({ line: { for: 'seat-1' }, body: 'hi' })
  })
})

describe('sdk/wire: receipts', () => {
  it('round-trips formatReceipt through parseReceipt with the v2 fields', () => {
    const receipt = formatReceipt('T-9', 'done', { outcome: 'completed', disposition: 'result', by: { seat: 'dsh/11112222', seatId: 'seat-9999aaaa', role: 'member' } })
    const parsed = parseReceipt(receipt)
    expect(parsed?.taskId).toBe('T-9')
    expect(parsed?.envelope?.outcome).toBe('completed')
    expect(parsed?.envelope?.by?.seatId).toBe('seat-9999aaaa')
  })
  it('classifies each documented task-id form', () => {
    expect(taskKind('ack-T1')).toEqual({ kind: 'ack', task: 'T1' })
    expect(taskKind('progress-T1-3')).toEqual({ kind: 'progress', task: 'T1', n: 3 })
    expect(taskKind('attention-T1-q7')).toEqual({ kind: 'attention', task: 'T1', questionId: 'q7' })
    expect(taskKind('receipt-T1')).toEqual({ kind: 'receipt', task: 'T1' })
    expect(taskKind('roster-ab12cd34-1770000000000')).toEqual({ kind: 'roster', host: 'ab12cd34' })
    expect(taskKind('plain')).toEqual({ kind: 'other' })
    expect(taskKind('progress-T1-x')).toEqual({ kind: 'other' })
  })
  it('receiptTaskId names the formal result task', () => {
    expect(receiptTaskId('T1')).toBe('receipt-T1')
  })
  it('holdsRow: ack, attention and progress hold the row; the result settles it', () => {
    expect(holdsRow('ack-T1')).toBe(true)
    expect(holdsRow('attention-T1-q7')).toBe(true)
    expect(holdsRow('progress-T1-2')).toBe(true)
    expect(holdsRow('receipt-T1')).toBe(false)
    expect(holdsRow('roster-ab12cd34-1')).toBe(false)
  })
})

describe('sdk/wire: the roster line', () => {
  const roster = '[A2A roster] ab12cd34 2026-11-12T05:00:00.000Z\n' + JSON.stringify({ host: 'ab12cd34deadbeef', at: '2026-11-12T05:00:00.000Z', seats: [
    { seat: 'dsh/11112222', seatId: 'seat-11112222', name: '成员二', role: 'member', online: true, active: 1, queued: 2, lastActiveAt: '2026-11-12T04:00:00.000Z' },
    { seat: 'dsh/33334444', role: 'router', online: false, active: 0, queued: 0 },
  ] })
  it('parses the head and the body, seats and all', () => {
    expect(parseRoster(roster)).toEqual({ host: 'ab12cd34deadbeef', at: '2026-11-12T05:00:00.000Z', seats: [
      { seat: 'dsh/11112222', seatId: 'seat-11112222', name: '成员二', role: 'member', online: true, active: 1, queued: 2, lastActiveAt: '2026-11-12T04:00:00.000Z' },
      { seat: 'dsh/33334444', role: 'router', online: false, active: 0, queued: 0 },
    ] })
  })
  it('rejects a body whose host does not match the head fp8, and other text', () => {
    expect(parseRoster('[A2A roster] ab12cd34 t\n' + JSON.stringify({ host: 'ff990011', at: 't', seats: [] }))).toBeUndefined()
    expect(parseRoster('anything else')).toBeUndefined()
    expect(parseRoster('[A2A roster] ab12cd34 t\nnot json')).toBeUndefined()
  })
})

describe('sdk/wire: capabilities', () => {
  it('declares is true only for exactly true', () => {
    expect(declares({ capabilities: { teamRoster: true } }, CAPABILITIES.teamRoster)).toBe(true)
    expect(declares({ capabilities: { teamRoster: 'true' } }, CAPABILITIES.teamRoster)).toBe(false)
    expect(declares({ capabilities: {} }, CAPABILITIES.directedSeats)).toBe(false)
    expect(declares({}, CAPABILITIES.progressReceipts)).toBe(false)
    expect(declares(undefined, CAPABILITIES.reworkReturns)).toBe(false)
  })
  it('names the four documented capabilities', () => {
    expect(CAPABILITIES).toEqual({ progressReceipts: 'progressReceipts', teamRoster: 'teamRoster', directedSeats: 'directedSeats', reworkReturns: 'reworkReturns' })
  })
})

describe('sdk/wire: packaging', () => {
  it('package.json exports ./sdk/wire to the built file', () => {
    expect(pkg.exports['./sdk/wire']).toEqual({ types: './lib/types/sdk/wire.d.ts', default: './lib/sdk/wire.js' })
  })
  it('the built module imports nothing from the plugin runtime or node', () => {
    const built = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../lib/sdk/wire.js'), 'utf8')
    expect(built).not.toMatch(/cordis|dsh-superagent|node:fs|node:crypto|node:http|node:path/)
    for (const match of built.matchAll(/from "([^"]+)"/g)) expect(match[1].startsWith('./') || match[1].startsWith('../')).toBe(true)
  })
})
