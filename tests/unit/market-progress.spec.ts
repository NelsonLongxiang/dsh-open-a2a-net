/**
 * superagent-market-progress-roster P1/N2b: the `progress` receipt (codec, ledger, switches), the capability a caller
 * must declare for it, and superagent's progress sender (state, rate, who, the tickets a request became).
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'
import { formatReceipt, holdsRow, parseReceipt, receiptExtras, receiptTaskId } from '../../src/receipt.ts'
import { pinnedCallerDeclares } from '../../src/canvas-member.ts'
import { ProgressReceipts, progressState, PROGRESS_MIN_MS, PROGRESS_SUMMARY_MS } from '../../src/superagent/host/progress.ts'

const flags = (values: Record<string, string>) => (name: string) => values[name]
const AT = '2026-11-11T13:00:00.000Z'

describe('the progress receipt', () => {
  const step = (task: string, n: number) => formatReceipt(task, '在做', { idempotencyKey: task, disposition: 'progress', progress: { n, state: 'working', summary: '在做', at: AT }, tickets: [{ id: 'tk1', title: 't', seat: 'dsh/aaaa1111', state: 'working' }] })

  it('round-trips, rides progress-<task>-<n>, and drops a progress field off a progress receipt', () => {
    expect(parseReceipt(step('t1', 2))?.envelope).toEqual({ idempotencyKey: 't1', disposition: 'progress', progress: { n: 2, state: 'working', summary: '在做', at: AT }, tickets: [{ id: 'tk1', title: 't', seat: 'dsh/aaaa1111', state: 'working' }] })
    expect(receiptTaskId('t1', 'progress', undefined, { n: 2, state: 'working', at: AT })).toBe('progress-t1-2')
    const off = parseReceipt(`[A2A receipt] task t1 x\n${JSON.stringify({ idempotencyKey: 't1', disposition: 'result', progress: { n: 1, state: 'working', at: AT }, tickets: [{ id: 'a', state: 'nope' }] })}`)?.envelope
    expect(off).toEqual({ idempotencyKey: 't1', disposition: 'result' })
  })

  it('marks the owed row, restarts its acknowledged clock, and settles nothing; the result settles it', () => {
    let t = 1_000_000
    const l = new TaskLedger(join(mkdtempSync(join(tmpdir(), 'dsh-a2a-progress-')), 'a2a', 'tasks.json'), { now: () => t })
    l.track('t1', 'ops/canvas/build', 'peer')
    expect(holdsRow(parseReceipt(step('t1', 1))?.envelope)).toBe(true)
    expect(l.resolveFromMessage(step('t1', 1))).toMatchObject({ acknowledged: true, disposition: 'progress' })
    const first = l.find('t1')!.acknowledgedAt
    t += 60_000
    l.resolveFromMessage(step('t1', 2))
    expect(l.find('t1')).toMatchObject({ status: 'pending' })
    expect(l.find('t1')!.acknowledgedAt).toBeGreaterThan(first!)
    expect(l.resolveFromMessage(formatReceipt('t1', 'done', { outcome: 'completed', idempotencyKey: 't1', disposition: 'result' }))).toMatchObject({ outcome: 'completed' })
    expect(l.find('t1')).toBeUndefined()
  })

  it('the switches build it, or name what is wrong', () => {
    expect(receiptExtras(flags({ '--progress': '3', '--state': 'queued', '--ahead': '2', '--tickets': '[{"id":"tk1","state":"queued"}]' }), false, '排队中', () => AT))
      .toEqual({ fields: { progress: { n: 3, state: 'queued', summary: '排队中', at: AT, ahead: 2 }, tickets: [{ id: 'tk1', state: 'queued' }] } })
    for (const bad of [{ '--progress': '0', '--state': 'working' }, { '--progress': '1', '--state': 'done' }, { '--state': 'working' }, { '--progress': '1', '--state': 'queued', '--ahead': '-1' }, { '--tickets': 'nope' }]) {
      expect(receiptExtras(flags(bad), false, 'x'), JSON.stringify(bad)).toHaveProperty('error')
    }
    expect(receiptExtras(flags({ '--progress': '1', '--state': 'working' }), true, 'x')).toHaveProperty('error')
  })
})

describe('a caller declares a capability only through its pinned key and verified card', () => {
  const members = ['market/aaaa1111@0123abcd', 'dsh/bbbb2222@89abcdef']
  const keys: Record<string, string> = { 'market/aaaa1111@0123abcd': 'KEY-M', 'dsh/bbbb2222@89abcdef': 'KEY-B' }
  it('a pinned member whose card declares it; not a card under another key, an undeclared one, an unpinned or CLI caller', () => {
    const cards = [{ publicKey: 'KEY-M', capabilities: { progressReceipts: true } }, { publicKey: 'KEY-X', capabilities: { progressReceipts: true } }, undefined]
    expect(pinnedCallerDeclares('market/aaaa1111', 'progressReceipts', members, ref => keys[ref], cards)).toBe(true)
    expect(pinnedCallerDeclares('market/aaaa1111', 'teamRoster', members, ref => keys[ref], cards)).toBe(false)
    expect(pinnedCallerDeclares('dsh/bbbb2222', 'progressReceipts', members, ref => keys[ref], cards)).toBe(false)
    expect(pinnedCallerDeclares('market/0123456789abcdef', 'progressReceipts', members, ref => keys[ref], cards)).toBe(false)
    expect(pinnedCallerDeclares('market/aaaa1111', 'progressReceipts', [...members, 'market/aaaa1111@ffffffff'], ref => keys[ref] ?? 'KEY-OTHER', cards)).toBe(false)
  })
})

/** A ticket as the engine stores it, in the stage named. */
function ticket(id: string, triggerId: string, stage: 'queued' | 'working' | 'waiting' | 'ready' | 'blocked' | 'ended', summary?: string): any {
  const report = stage === 'working' ? (summary ? { state: 'progress', summary, at: AT } : undefined) : stage === 'waiting' ? { state: 'waiting', summary: summary ?? '等 PR', at: AT } : stage === 'ready' ? { state: 'ready', summary: 'done', at: AT } : stage === 'blocked' ? { state: 'blocked', summary: summary ?? '卡住', at: AT } : undefined
  const assignment = stage === 'queued' ? { id: 'a', state: 'pending', createdAt: AT } : { id: 'a', state: stage === 'ended' ? 'ended' : 'running', createdAt: AT, ...(report ? { report } : {}) }
  return { id, title: `title ${id}`, decisionId: 'd', mandate: {}, channels: [], assignments: [assignment], inputs: [], undelivered: [], createdAt: AT, updatedAt: AT, origin: { triggerId, triggerIds: [triggerId] },
    ...(stage === 'ended' ? { ended: { at: AT, by: 'executor', outcome: 'completed' } } : {}), ...(stage === 'blocked' ? { answers: [] } : {}) }
}

function sender(tickets: any[], options: { gone?: boolean; answered?: string[] } = {}) {
  let now = Date.parse(AT)
  const sent: Array<{ task: string; step: any }> = []
  let saved: Record<string, any> | undefined
  const triggers: Record<string, any> = { tr1: { id: 'tr1', source: 'a2a', human: false, channel: { address: { caller: 'market/aaaa1111', task: 'direct-1' } } } }
  const p = new ProgressReceipts({
    store: { tickets: { list: () => tickets }, triggers: { get: (id: string) => triggers[id] } } as never,
    a2a: { progress: async (address: Record<string, string>, step: unknown) => { if (options.gone) return 'gone'; sent.push({ task: address.task!, step }); return 'sent' } } as never,
    on: () => true, nowMs: () => now, seatOf: id => ({ seat: `dsh/${id}` }), queueAhead: () => 2, answered: task => options.answered?.includes(task) ?? false,
    load: () => undefined, save: value => { saved = value }, logger: { info: () => {}, warn: () => {} },
  })
  const tick = async () => { p.tick(); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 1)) }
  return { p, sent, tick, advance: (ms: number) => { now += ms }, saved: () => saved }
}

describe('superagent sends progress', () => {
  it('maps a ticket\'s stage: queued, working, waiting, blocked; nothing once its result is due or it ended', () => {
    expect(progressState(ticket('a', 't', 'queued'))).toBe('queued')
    expect(progressState(ticket('a', 't', 'working'))).toBe('working')
    expect(progressState(ticket('a', 't', 'waiting'))).toBe('waiting')
    expect(progressState(ticket('a', 't', 'ready'))).toBeUndefined()
    expect(progressState(ticket('a', 't', 'ended'))).toBeUndefined()
  })

  it('a step when the view changes, numbered from 1, with who holds it, how many are ahead, and the tickets the request became', async () => {
    const tickets = [ticket('tk1', 'tr1', 'queued')]
    const s = sender(tickets)
    await s.tick()
    expect(s.sent).toEqual([{ task: 'direct-1', step: { n: 1, state: 'queued', summary: 'title tk1', ahead: 2, tickets: [{ id: 'tk1', title: 'title tk1', seat: 'dsh/tk1', state: 'queued' }], by: { seat: 'dsh/tk1' } } }])
    // Nothing new: nothing sent.
    s.advance(PROGRESS_MIN_MS); await s.tick()
    expect(s.sent).toHaveLength(1)
    // Working: a new step, but not within a minute of the last.
    tickets[0] = ticket('tk1', 'tr1', 'working', '改依赖')
    s.advance(-PROGRESS_MIN_MS + 1_000); await s.tick()
    expect(s.sent).toHaveLength(1)
    s.advance(PROGRESS_MIN_MS); await s.tick()
    expect(s.sent.at(-1)!.step).toMatchObject({ n: 2, state: 'working', summary: '改依赖' })
    // A summary change alone waits ten minutes.
    tickets[0] = ticket('tk1', 'tr1', 'working', '跑测试')
    s.advance(PROGRESS_MIN_MS); await s.tick()
    expect(s.sent).toHaveLength(2)
    s.advance(PROGRESS_SUMMARY_MS); await s.tick()
    expect(s.sent.at(-1)!.step).toMatchObject({ n: 3, summary: '跑测试' })
    // Blocked goes out at once.
    tickets[0] = ticket('tk1', 'tr1', 'blocked', '缺权限')
    s.advance(1_000); await s.tick()
    expect(s.sent.at(-1)!.step).toMatchObject({ n: 4, state: 'blocked' })
    expect(s.saved()).toMatchObject({ 'direct-1': { n: 4, state: 'blocked' } })
  })

  it('a caller that takes no progress is not tried again; a request already answered gets none', async () => {
    const gone = sender([ticket('tk1', 'tr1', 'working')], { gone: true })
    await gone.tick(); gone.advance(PROGRESS_SUMMARY_MS * 2); await gone.tick()
    expect(gone.sent).toEqual([])
    const answered = sender([ticket('tk1', 'tr1', 'working')], { answered: ['direct-1'] })
    await answered.tick()
    expect(answered.sent).toEqual([])
  })
})
