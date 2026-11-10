/** Health reminders (reliability R7): one card per problem, taken back when it goes away, held off by a decision. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperagentHost, type SuperagentHostDeps } from '../../src/superagent/host/index.ts'

const yes = (): boolean => true
const homes: string[] = []
afterEach(() => { for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function team(loaded: (id: string) => boolean, settled = () => true): { h: SuperagentHost; tick: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sa-health-'))
  homes.push(dir)
  const timers: Array<() => void> = []
  const deps = {
    canvasTeam: () => ({ local: ['session-r', 'session-a'], remote: [] }),
    home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: vi.fn(() => false), sessionLabel: () => 'x',
    now: () => new Date(clock.ms).toISOString(), interval: (fn: () => void, ms: number) => { if (ms === 15 * 60_000) timers.push(fn); return () => undefined },
    sessionLoaded: loaded, bootSettled: settled,
  } as unknown as SuperagentHostDeps
  const clock = { ms: Date.parse('2026-11-10T09:00:00.000Z') }
  const h = new SuperagentHost(deps)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, yes)).toMatchObject({ ok: true })
  h.start()
  return { h, tick: () => { clock.ms += 15 * 60_000; for (const fn of timers) fn() } }
}

describe('health reminders', () => {
  it('a problem that appears raises one card; the same problem again raises nothing more', async () => {
    const m = await team(() => false)
    const first = m.h.decisionCards().filter(card => card.source === 'health')
    expect(first).toHaveLength(0)
    m.tick()
    const cards = m.h.decisionCards().filter(card => card.source === 'health')
    // one card per problem: the router and the member are both not loaded
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ level: 'P2', options: ['去处理', '先忽略 24 小时'], recommended: '去处理' })
    expect(cards.some(card => card.question.includes('总工会话'))).toBe(true)
    expect(cards.some(card => card.question.includes('成员会话'))).toBe(true)
    m.tick()
    expect(m.h.decisionCards().filter(card => card.source === 'health')).toHaveLength(2)
    await m.h.stop()
  })
  it('a problem that goes away takes its undecided card back', async () => {
    const m = await team(() => false)
    m.tick()
    expect(m.h.decisionCards().some(card => card.source === 'health')).toBe(true)
    const m2 = m
    // the sessions come back: the next tick takes the card back
    const fresh = { ...m2 } as typeof m2
    ;(m2.h as unknown as { d: { sessionLoaded: (id: string) => boolean } }).d.sessionLoaded = () => true
    fresh.tick()
    expect(m2.h.decisionCards().some(card => card.source === 'health')).toBe(false)
    await m2.h.stop()
  })
  it('the boot grace period raises nothing', async () => {
    let settled = false
    const m = await team(() => false, () => settled)
    m.tick()
    expect(m.h.decisionCards().filter(card => card.source === 'health')).toHaveLength(0)
    settled = true
    m.tick()
    expect(m.h.decisionCards().filter(card => card.source === 'health')).toHaveLength(2)
    await m.h.stop()
  })
  it('a decided reminder holds its problem off: a day for 忽略, an hour otherwise', async () => {
    const m = await team(() => false)
    m.tick()
    for (const card of m.h.decisionCards().filter(row => row.source === 'health')) expect(m.h.decide(card.id, 'choose', '先忽略 24 小时')).toMatchObject({ ok: true })
    m.tick()
    expect(m.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(0)
    // 24 hours later the problem is still there: the cards come back
    for (let i = 0; i < 96; i++) m.tick()
    expect(m.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(2)
    for (const again of m.h.decisionCards().filter(row => row.source === 'health')) expect(m.h.decide(again.id, 'approve')).toMatchObject({ ok: true })
    m.tick()
    expect(m.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(0)
    await m.h.stop()
  })
  it('a restart takes back a card whose problem went away while the host was down', async () => {
    const m = await team(() => false)
    m.tick()
    expect(m.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(2)
    await m.h.stop()
    // a restart over the same state: the sessions are loaded now, the open health card loses its problem
    const again = await team(() => true)
    again.tick()
    expect(again.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(0)
    await again.h.stop()
  })
  it('a card says what the banner says, not an internal code', async () => {
    const m = await team(id => id !== 'session-r')
    m.tick()
    const card = m.h.decisionCards().find(row => row.source === 'health' && row.question.includes('总工会话'))!
    expect(card).toBeDefined()
    expect(card!.question).not.toMatch(/[a-z]+-not-loaded/)
    await m.h.stop()
  })
  it('each team keeps its own reminders', async () => {
    const a = await team(() => false)
    const b = await team(() => true)
    a.tick(); b.tick()
    expect(a.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(2)
    expect(b.h.decisionCards().filter(row => row.source === 'health')).toHaveLength(0)
    await Promise.all([a.h.stop(), b.h.stop()])
  })
})
