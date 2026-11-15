import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import {
  CAPABILITIES, declares, formatDispatch, formatReceipt, holdsRow, parseDispatch, parseReceipt, parseRoster,
  receiptTaskId, taskHoldsRow, taskKind,
} from '../../src/sdk/wire.ts'

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'))

describe('sdk/wire: the dispatch line', () => {
  it('round-trips formatDispatch through parseDispatch', () => {
    const sent = formatDispatch({ for: 'seat-11112222' }, '做一个对账表')
    expect(sent).toBe('[A2A dispatch] {"for":"seat-11112222"}\n做一个对账表')
    expect(parseDispatch(sent)).toEqual({ line: { for: 'seat-11112222' }, body: '做一个对账表' })
    const rework = formatDispatch({ rework: { of: 'wbe-304f27617fe74277.d26.a1' } }, '')
    expect(parseDispatch(rework)).toEqual({ line: { rework: { of: 'wbe-304f27617fe74277.d26.a1' } }, body: '' })
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
    const receipt = formatReceipt('direct-000000000001', 'done', { outcome: 'completed', disposition: 'result', by: { seat: 'dsh/11112222', seatId: 'seat-9999aaaa', role: 'member' } })
    const parsed = parseReceipt(receipt)
    expect(parsed?.taskId).toBe('direct-000000000001')
    expect(parsed?.envelope?.outcome).toBe('completed')
    expect(parsed?.envelope?.by?.seatId).toBe('seat-9999aaaa')
  })
  it('classifies each documented task-id form, real ids with dashes included', () => {
    expect(taskKind('ack-direct-000000000001')).toEqual({ kind: 'ack', task: 'direct-000000000001' })
    expect(taskKind('receipt-wbe-304f27617fe74277.d26.a1')).toEqual({ kind: 'receipt', task: 'wbe-304f27617fe74277.d26.a1' })
    expect(taskKind('progress-direct-000000000001-3')).toEqual({ kind: 'progress', task: 'direct-000000000001', n: 3 })
    expect(taskKind('attention-direct-000000000001-q1a2b3')).toEqual({ kind: 'attention', task: 'direct-000000000001', questionId: 'q1a2b3' })
    expect(taskKind('roster-ab12cd34-1770000000000')).toEqual({ kind: 'roster', host: 'ab12cd34' })
    expect(taskKind('plain')).toEqual({ kind: 'other' })
    expect(taskKind('progress-direct-000000000001-x')).toEqual({ kind: 'other' })
  })
  it('receiptTaskId is the receipt module\'s own builder for each disposition', () => {
    expect(receiptTaskId('direct-000000000001', 'result')).toBe('receipt-direct-000000000001')
    expect(receiptTaskId('direct-000000000001', 'acknowledged')).toBe('ack-direct-000000000001')
    expect(receiptTaskId('direct-000000000001', 'progress', undefined, { n: 3, state: 'working', at: '2026-11-12T00:00:00.000Z' })).toBe('progress-direct-000000000001-3')
  })
  it('taskHoldsRow: ack, attention and progress hold the row; the result settles it', () => {
    expect(taskHoldsRow('ack-direct-000000000001')).toBe(true)
    expect(taskHoldsRow('attention-direct-000000000001-q1a2b3')).toBe(true)
    expect(taskHoldsRow('progress-direct-000000000001-2')).toBe(true)
    expect(taskHoldsRow('receipt-direct-000000000001')).toBe(false)
    expect(taskHoldsRow('roster-ab12cd34-1')).toBe(false)
  })
  it('holdsRow reads an envelope, the receipt module\'s own signature', () => {
    expect(holdsRow({ disposition: 'acknowledged' })).toBe(true)
    expect(holdsRow({ disposition: 'attention', question: { id: 'q1', text: 'q' } })).toBe(true)
    expect(holdsRow({ disposition: 'result', outcome: 'completed' })).toBe(false)
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
  it('drops a seatId that fails the seat-id pattern, keeping the seat', () => {
    const bad = '[A2A roster] ab12cd34 t\n' + JSON.stringify({ host: 'ab12cd34deadbeef', at: 't', seats: [{ seat: 'dsh/11112222', seatId: 'seat/坏', role: 'member', online: true, active: 0, queued: 0 }] })
    expect(parseRoster(bad)?.seats[0]).not.toHaveProperty('seatId')
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
  it("the built module's imports are relative and reach no plugin runtime or node module", () => {
    const built = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../lib/sdk/wire.js'), 'utf8')
    expect(built).not.toMatch(/cordis|dsh-superagent|node:fs|node:crypto|node:http|node:path/)
    for (const match of built.matchAll(/from "([^"]+)"/g)) expect(match[1].startsWith('./') || match[1].startsWith('../')).toBe(true)
  })
  it('the source import graph of sdk/wire reaches only src/dispatch.ts and src/receipt.ts', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const read = (p: string): string => readFileSync(join(root, p), 'utf8')
    const sources = ['src/sdk/wire.ts', 'src/dispatch.ts', 'src/receipt.ts'].map(read)
    for (const source of sources) {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(m => m[1])
      for (const spec of imports) {
        expect(spec.startsWith('./') || spec.startsWith('../')).toBe(true)
        expect(spec.endsWith('dispatch.ts') || spec.endsWith('receipt.ts')).toBe(true)
      }
      expect(source).not.toMatch(/@deepseek-ai|cordis|node:/)
    }
  })
})
