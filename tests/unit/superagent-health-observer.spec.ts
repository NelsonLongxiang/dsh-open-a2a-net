// @vitest-environment node
/** docs/design/superagent-reliability.md R7a (workbench-market 18 §八): a health problem reaches the team's observer first. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HealthReminders, OBSERVER_SILENCE_MS, HOLD_OTHER_MS, healthToken, problemKey, type HealthProblem } from '../../src/superagent/host/health-reminders.ts'

const T0 = Date.parse('2026-11-20T00:00:00Z')
function reminders(observer: { id?: string; tell?: boolean }) {
  const raised: Array<{ question: string; key: string }> = [], told: Array<[string, string]> = []
  let next = 0
  const r = new HealthReminders((question, key) => { raised.push({ question, key }); return `card-${String(++next)}` }, () => {}, () => [], () => new Date(T0).toISOString(),
    { pick: problem => observer.id !== undefined && observer.id !== problem.session ? observer.id : undefined, tell: (id, text) => { told.push([id, text]); return observer.tell ?? true } })
  return { r, raised, told }
}
const quiet: HealthProblem = { code: 'ticket-quiet', ticketId: 'tk-1', title: '做事', minutes: 70 }

describe('R7a: the observer sees a health problem first', () => {
  it('a team without an observer: the owner gets the card at once, as R7', () => {
    const m = reminders({})
    m.r.tick([quiet], T0)
    expect(m.told).toEqual([])
    expect(m.raised).toHaveLength(1)
    expect(m.raised[0]!.question).not.toContain('观察者')
  })
  it('with an observer: it is told with the token, the owner gets nothing within the hour', () => {
    const m = reminders({ id: 'session-o' })
    m.r.tick([quiet], T0)
    expect(m.told).toHaveLength(1)
    expect(m.told[0]![0]).toBe('session-o')
    expect(m.told[0]![1]).toContain(healthToken(problemKey(quiet)))
    m.r.tick([quiet], T0 + 45 * 60_000)
    expect(m.raised).toEqual([])
    expect(m.told).toHaveLength(1)
  })
  it('an hour without action: the owner gets the card, saying the observer did not act', () => {
    const m = reminders({ id: 'session-o' })
    m.r.tick([quiet], T0)
    m.r.tick([quiet], T0 + OBSERVER_SILENCE_MS)
    expect(m.raised).toHaveLength(1)
    expect(m.raised[0]!.question).toContain('观察者一小时内没有处理')
  })
  it('a request or card carrying the token handles it: no owner card, told again after the hold if it lasts', () => {
    const m = reminders({ id: 'session-o' })
    m.r.tick([quiet], T0)
    m.r.observerActed('session-o', `催一下这张单 ${healthToken(problemKey(quiet))}`, T0 + 10 * 60_000)
    expect(m.r.observerHolds()).toEqual([])
    m.r.tick([quiet], T0 + OBSERVER_SILENCE_MS + 5 * 60_000)
    expect(m.raised).toEqual([])
    m.r.tick([quiet], T0 + 10 * 60_000 + HOLD_OTHER_MS)
    expect(m.told).toHaveLength(2)
    expect(m.raised).toEqual([])
  })
  it('text without the token, or from another session, does not count', () => {
    const m = reminders({ id: 'session-o' })
    m.r.tick([quiet], T0)
    m.r.observerActed('session-o', '看过了，没事', T0 + 60_000)
    m.r.observerActed('session-x', healthToken(problemKey(quiet)), T0 + 60_000)
    m.r.tick([quiet], T0 + OBSERVER_SILENCE_MS)
    expect(m.raised).toHaveLength(1)
  })
  it('the observer unloaded meanwhile: the owner gets it at the next look', () => {
    const observer: { id?: string } = { id: 'session-o' }
    const m = reminders(observer)
    m.r.tick([quiet], T0)
    observer.id = undefined
    m.r.tick([quiet], T0 + 15 * 60_000)
    expect(m.raised).toHaveLength(1)
    expect(m.raised[0]!.question).toContain('观察者会话没有加载')
  })
  it('a problem about the observer itself, or a notice that cannot be delivered, goes to the owner', () => {
    const self = reminders({ id: 'session-o' })
    self.r.tick([{ code: 'member-not-loaded', session: 'session-o' }], T0)
    expect(self.told).toEqual([])
    expect(self.raised).toHaveLength(1)
    const lost = reminders({ id: 'session-o', tell: false })
    lost.r.tick([quiet], T0)
    expect(lost.raised).toHaveLength(1)
  })
  it('a problem that goes away while the observer holds it is dropped', () => {
    const m = reminders({ id: 'session-o' })
    m.r.tick([quiet], T0)
    m.r.tick([], T0 + 15 * 60_000)
    expect(m.r.observerHolds()).toEqual([])
    m.r.tick([], T0 + 2 * OBSERVER_SILENCE_MS)
    expect(m.raised).toEqual([])
  })
})

describe('R7a on the host', () => {
  it('the observer is told, files a request with the token, and no health card reaches the owner', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const sent: Array<[string, string]> = []
    const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-a': 'superagent-member', 'session-o': 'superagent-observer' }
    const loaded = new Set(['session-a', 'session-o'])
    const h = new SuperagentHost({
      canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-health-obs-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
      sessionLoaded: (id: string) => loaded.has(id), bootSettled: () => true, presetOf: (id: string) => presets[id], now: () => new Date(T0).toISOString(),
    } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, id => presets[id])).toMatchObject({ ok: true })
    h.start()
    const problems = h.health() as HealthProblem[]
    const routerDown = problems.find(p => p.code === 'router-not-loaded')
    expect(routerDown).toBeDefined()
    ;(h as unknown as { healthReminders: HealthReminders }).healthReminders.tick(problems, T0)
    const notice = sent.find(([id, text]) => id === 'session-o' && text.startsWith('[superagent health]'))
    expect(notice).toBeDefined()
    expect(h.decisionCards().filter(card => card.source === 'health')).toEqual([])
    const filed = h.requestForObserver('session-o', `总工会话没加载，请属主打开 ${healthToken(problemKey(routerDown!))}`) as { ok: boolean }
    expect(filed.ok).toBe(true)
    ;(h as unknown as { healthReminders: HealthReminders }).healthReminders.tick(problems, T0 + OBSERVER_SILENCE_MS)
    expect(h.decisionCards().filter(card => card.source === 'health' && card.reason === problemKey(routerDown!))).toEqual([])
    await h.stop()
  })
})
