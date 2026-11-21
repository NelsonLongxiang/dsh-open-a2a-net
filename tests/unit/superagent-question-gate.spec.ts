// @vitest-environment node
/** docs/design/superagent-reliability.md R7b (workbench-market 18, #880): a member's question goes to the observer first. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QuestionGate, QUESTION_SILENCE_MS, questionToken } from '../../src/superagent/host/question-gate.ts'

const T0 = Date.parse('2026-11-20T00:00:00Z')

function gate(o: { observer?: string; loaded?: Set<string>; tell?: boolean; store?: { kept?: unknown } } = {}) {
  const told: Array<[string, string]> = []
  const loaded = o.loaded ?? new Set([o.observer ?? ''])
  const store = o.store
  const g = new QuestionGate({
    pick: reporter => o.observer !== undefined && o.observer !== reporter && loaded.has(o.observer) ? o.observer : undefined,
    loaded: id => loaded.has(id),
    tell: (id, text) => { told.push([id, text]); return o.tell ?? true },
    ...(store !== undefined ? { persist: { load: () => store.kept, save: kept => { store.kept = JSON.parse(JSON.stringify(kept)) } } } : {}),
  })
  return { g, told, loaded }
}

describe('R7b: the gate', () => {
  it('no observer: the question goes to the person at once and the clock starts', () => {
    const { g, told } = gate()
    expect(g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)).toBe('person')
    expect(told).toEqual([])
    expect(g.held('tk-1')).toBe(false)
    expect(g.reachedAt('tk-1')).toBe(T0)
  })
  it('with an observer: it is told with the token and holds the question; a note, request or card with the token settles it', () => {
    const { g, told } = gate({ observer: 'session-o' })
    expect(g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)).toBe('observer')
    expect(told[0]![0]).toBe('session-o')
    expect(told[0]![1]).toContain(questionToken('tk-1'))
    expect(g.held('tk-1')).toBe(true)
    g.acted('session-o', '看过了', T0 + 60_000)
    expect(g.holds()).toEqual({ pending: ['tk-1'], handled: [] })
    g.acted('session-x', questionToken('tk-1'), T0 + 60_000)
    expect(g.holds()).toEqual({ pending: ['tk-1'], handled: [] })
    g.acted('session-o', `数据在 CI 配置里 ${questionToken('tk-1')}`, T0 + 60_000)
    expect(g.holds()).toEqual({ pending: [], handled: ['tk-1'] })
    expect(g.held('tk-1')).toBe(true)
  })
  it('an hour of silence, or an unloaded observer, passes the question on and starts the clock then', () => {
    const silent = gate({ observer: 'session-o' })
    silent.g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)
    expect(silent.g.tick(() => true, T0 + 45 * 60_000)).toEqual([])
    expect(silent.g.tick(() => true, T0 + QUESTION_SILENCE_MS)).toEqual([{ ticketId: 'tk-1', why: 'silent' }])
    expect(silent.g.held('tk-1')).toBe(false)
    expect(silent.g.reachedAt('tk-1')).toBe(T0 + QUESTION_SILENCE_MS)
    const gone = gate({ observer: 'session-o' })
    gone.g.ask('tk-2', 'session-m', '做事', '用哪个？', T0)
    gone.loaded.delete('session-o')
    expect(gone.g.tick(() => true, T0 + 15 * 60_000)).toEqual([{ ticketId: 'tk-2', why: 'unloaded' }])
  })
  it('backstop: still waiting an hour after the observer handled it, the question goes to the person', () => {
    const { g } = gate({ observer: 'session-o' })
    g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)
    g.acted('session-o', questionToken('tk-1'), T0 + 10 * 60_000)
    expect(g.tick(() => true, T0 + 60 * 60_000)).toEqual([])
    expect(g.tick(() => true, T0 + 70 * 60_000)).toEqual([{ ticketId: 'tk-1', why: 'still-waiting' }])
    expect(g.reachedAt('tk-1')).toBe(T0 + 70 * 60_000)
  })
  it('a question no longer waiting is dropped', () => {
    const { g } = gate({ observer: 'session-o' })
    g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)
    expect(g.tick(() => false, T0 + 2 * QUESTION_SILENCE_MS)).toEqual([])
    expect(g.held('tk-1')).toBe(false)
  })
  it('no loop: a new question within the hour after the observer\'s note skips the observer', () => {
    const { g, told } = gate({ observer: 'session-o' })
    g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)
    g.notedOn('tk-1', T0 + 5 * 60_000)
    g.acted('session-o', questionToken('tk-1'), T0 + 5 * 60_000)
    expect(g.ask('tk-1', 'session-m', '做事', '还是不懂', T0 + 20 * 60_000)).toBe('person')
    expect(told).toHaveLength(1)
    expect(g.ask('tk-1', 'session-m', '做事', '新问题', T0 + 2 * QUESTION_SILENCE_MS)).toBe('observer')
  })
  it('the observer does not get its own question, and a notice that cannot be delivered goes to the person', () => {
    expect(gate({ observer: 'session-o' }).g.ask('tk-1', 'session-o', '做事', '?', T0)).toBe('person')
    expect(gate({ observer: 'session-o', tell: false }).g.ask('tk-1', 'session-m', '做事', '?', T0)).toBe('person')
  })
  it('#761 review 1: a member asking again within the hour does not restart it; the question still reaches the person', () => {
    const { g, told } = gate({ observer: 'session-o' })
    expect(g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)).toBe('observer')
    // Every 50 minutes for five hours: the first hour still ends at T0 + 1 h.
    let moved: Array<{ ticketId: string; why: string }> = []
    for (let k = 1; k <= 6 && moved.length === 0; k++) {
      const at = T0 + k * 50 * 60_000
      moved = g.tick(() => true, at)
      if (moved.length === 0) expect(g.ask('tk-1', 'session-m', '做事', `第 ${String(k)} 次`, at)).toBe('observer')
    }
    expect(moved).toEqual([{ ticketId: 'tk-1', why: 'silent' }])
    expect(g.held('tk-1')).toBe(false)
    expect(told.length).toBeGreaterThan(1)
    // Once the observer settled it, the member still asking within the hour goes to the person at once.
    const h = gate({ observer: 'session-o' })
    h.g.ask('tk-2', 'session-m', '做事', '?', T0)
    h.g.acted('session-o', questionToken('tk-2'), T0 + 10 * 60_000)
    expect(h.g.ask('tk-2', 'session-m', '做事', '还是不行', T0 + 40 * 60_000)).toBe('person')
    expect(h.g.held('tk-2')).toBe(false)
    expect(h.g.reachedAt('tk-2')).toBe(T0 + 40 * 60_000)
  })
  it('#761 review 2: settling with a request or a card opens the no-loop window too', () => {
    for (const how of ['request', 'card']) {
      const { g, told } = gate({ observer: 'session-o' })
      g.ask('tk-1', 'session-m', '做事', '?', T0)
      g.acted('session-o', `${how} ${questionToken('tk-1')}`, T0 + 5 * 60_000)
      // The handled question ends (the member's answer arrived), then the member asks anew within the hour.
      expect(g.tick(() => false, T0 + 10 * 60_000)).toEqual([])
      expect(g.ask('tk-1', 'session-m', '做事', '新的问题', T0 + 20 * 60_000)).toBe('person')
      expect(told).toHaveLength(1)
    }
  })
  it('survives a restart: the hour is not reset and the observer is not told again', () => {
    const store: { kept?: unknown } = {}
    const a = gate({ observer: 'session-o', store })
    a.g.ask('tk-1', 'session-m', '做事', '用哪个？', T0)
    const b = gate({ observer: 'session-o', store })
    expect(b.g.held('tk-1')).toBe(true)
    expect(b.g.tick(() => true, T0 + 40 * 60_000)).toEqual([])
    expect(b.told).toEqual([])
    const c = gate({ observer: 'session-o', store })
    expect(c.g.tick(() => true, T0 + QUESTION_SILENCE_MS + 1)).toEqual([{ ticketId: 'tk-1', why: 'silent' }])
  })
})

describe('R7b on the host', () => {
  async function team(withObserver: boolean) {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const sent: Array<[string, string]> = []
    const clock = { ms: T0 }
    const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
    const local = withObserver ? ['session-r', 'session-m', 'session-o'] : ['session-r', 'session-m']
    const h = new SuperagentHost({
      canvasTeam: (name: string) => name === 'team' ? { local, remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-question-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
      presetOf: (id: string) => presets[id], sessionLoaded: () => true, bootSettled: () => true, now: () => new Date(clock.ms).toISOString(),
    } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, id => presets[id])).toMatchObject({ ok: true })
    h.start()
    const asked = h.request('做事') as { triggerId: string }
    h.pass()
    const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
    const tick = () => (h as unknown as { questionTick: () => void }).questionTick()
    return { h, sent, clock, ticket, tick }
  }
  const toRouter = (sent: Array<[string, string]>) => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent report]')).map(([, t]) => t)

  it('without an observer the question reaches the person as before', async () => {
    const m = await team(false)
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '用哪个？' }, m.ticket)
    expect(toRouter(m.sent).at(-1)).toContain('question for the person')
    expect(m.h.decisionCards().filter(card => card.ticketId === m.ticket)).toHaveLength(1)
    await m.h.stop()
  })

  it('with an observer: it is told, the person path waits, a note with the token settles it, and the backstop passes it on', async () => {
    const m = await team(true)
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '用哪个？' }, m.ticket)
    const notice = m.sent.find(([id, t]) => id === 'session-o' && t.startsWith('[superagent question]'))
    expect(notice?.[1]).toContain(questionToken(m.ticket))
    expect(toRouter(m.sent).at(-1)).not.toContain('question for the person')
    expect(toRouter(m.sent).at(-1)).toContain(questionToken(m.ticket))
    expect(m.h.decisionCards().filter(card => card.ticketId === m.ticket)).toEqual([])
    // The observer answers on the ticket; the member gets it as a note.
    expect(m.h.observerNote('session-m', m.ticket, 'x')).toMatchObject({ ok: false, code: 'not-observer' })
    expect(m.h.observerNote('session-o', m.ticket, `配置在 CI 里 ${questionToken(m.ticket)}`)).toMatchObject({ ok: true })
    expect(m.h.store.tickets.get(m.ticket)?.inputs.some(input => input.kind === 'note' && input.text.startsWith('[观察者留言]'))).toBe(true)
    expect(m.h.observerQuestions()).toEqual({ pending: [], handled: [m.ticket] })
    // An hour later the ticket still waits on its question: it goes to the person, and the clock starts then.
    m.clock.ms = T0 + QUESTION_SILENCE_MS + 60_000
    m.tick()
    expect(toRouter(m.sent).at(-1)).toContain('question for the person')
    const cards = m.h.decisionCards().filter(card => card.ticketId === m.ticket)
    expect(cards).toHaveLength(1)
    expect(cards[0]!.at).toBe(new Date(m.clock.ms).toISOString())
    await m.h.stop()
  })

  it('the observer can only note an open ticket of this team, and only note it', async () => {
    const m = await team(true)
    expect(m.h.observerNote('session-o', 'tk-nope', 'x')).toMatchObject({ ok: false, code: 'ticket' })
    expect(m.h.observerNote('session-o', m.ticket, '')).toMatchObject({ ok: false, code: 'text' })
    const before = m.h.store.tickets.get(m.ticket)
    m.h.observerNote('session-o', m.ticket, '一句背景')
    const after = m.h.store.tickets.get(m.ticket)
    expect(after?.ended).toBe(before?.ended)
    expect(m.h.executor.bindingOf('session-m')?.ticketId).toBe(m.ticket)
    await m.h.stop()
  })
})
