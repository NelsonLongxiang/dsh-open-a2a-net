// @vitest-environment node
/** T5-B (workbench-market 18, the session idle sweep): problems from the wrap-up self-check log; off by default. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'
import { problemText } from '../../src/superagent/host/health-reminders.ts'
import { holdsOpenTicket, readSelfChecks } from '../../src/superagent/host/self-check-read.ts'

type Row = { kind: string; conclusion: string | null; deadline: string | null; at: string }
const T0 = Date.parse('2026-11-20T08:00:00Z')
/** A time after the ticket's Assignment began, and one before it. */
const AFTER = (min = 1) => new Date(T0 + min * 60_000).toISOString(), BEFORE = '2026-11-20T07:30:00Z'

async function team(o: { idleSweep?: boolean; rows?: () => Row[] | undefined; noReader?: boolean } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const clock = { ms: T0 }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-sweep-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, sessionLoaded: () => true, bootSettled: () => true,
    now: () => new Date(clock.ms).toISOString(),
    ...(o.noReader === true ? {} : { selfChecksOf: () => (o.rows === undefined ? [] : o.rows()) }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...(o.idleSweep === true ? { idleSweep: true } : {}) }, () => true)).toMatchObject({ ok: true })
  h.start()
  const asked = h.request('做事') as { triggerId: string }
  h.pass()
  const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
  const sweep = () => h.health(clock.ms).filter(p => p.code.startsWith('session-'))
  return { h, clock, ticket, sweep }
}

describe('T5-B: the idle sweep', () => {
  it('is off by default, and turning it on is a rule change that needs the owner', async () => {
    const m = await team({ rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }] })
    expect(m.sweep()).toEqual([])
    expect(touchesRules({ idleSweep: true })).toBe(true)
    expect(m.h.saveSettings({ idleSweep: 'on' } as never, () => true)).toMatchObject({ ok: false })
    await m.h.stop()
  })
  it('an orphan stop as the latest word is a problem for that member\'s ticket', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'injected', conclusion: null, deadline: null, at: AFTER() }, { kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER(2) }] })
    expect(m.sweep()).toEqual([{ code: 'session-orphan-stop', session: 'session-m', ticketId: m.ticket, title: '做事' }])
    expect(problemText(m.sweep()[0] as never)).toContain('孤儿停')
    await m.h.stop()
  })
  it('a registered wait past its deadline is overdue; a deadline that is not a time says nothing', async () => {
    let rows: Row[] = [{ kind: 'concluded', conclusion: 'waiting', deadline: '2026-11-20T07:00:00Z', at: AFTER() }]
    const m = await team({ idleSweep: true, rows: () => rows })
    expect(m.sweep()).toMatchObject([{ code: 'session-wait-overdue', session: 'session-m', minutes: 60, detail: '2026-11-20T07:00:00Z' }])
    rows = [{ kind: 'concluded', conclusion: 'waiting', deadline: '今天下班前', at: AFTER() }]
    expect(m.sweep()).toEqual([])
    rows = [{ kind: 'concluded', conclusion: 'waiting', deadline: '2026-11-20T09:00:00Z', at: AFTER() }]
    expect(m.sweep()).toEqual([])
    await m.h.stop()
  })
  it('no self-check record at all: a problem only after the member has held the ticket for the quiet hour', async () => {
    const m = await team({ idleSweep: true, rows: () => [] })
    expect(m.sweep()).toEqual([])
    m.clock.ms += 61 * 60_000
    expect(m.sweep()).toMatchObject([{ code: 'session-no-selfcheck', session: 'session-m', ticketId: m.ticket }])
    await m.h.stop()
  })
  it('without a readable self-check log (no plugin, or its self-check off) the sweep says nothing', async () => {
    const m = await team({ idleSweep: true, noReader: true })
    m.clock.ms += 61 * 60_000
    expect(m.sweep()).toEqual([])
    const off = await team({ idleSweep: true, rows: () => undefined as never })
    off.clock.ms += 61 * 60_000
    expect(off.sweep()).toEqual([])
    await m.h.stop(); await off.h.stop()
  })

  // #765 review X1–X4: only this Assignment's rows count, and only orphan / concluded rows are the latest word.
  it('X1: an orphan stop from before this Assignment is not this ticket\'s problem', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: BEFORE }] })
    m.clock.ms += 20 * 60_000
    expect(m.sweep()).toEqual([])
    await m.h.stop()
  })
  it('X2: an overdue wait from before this Assignment is not this ticket\'s problem', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'concluded', conclusion: 'waiting', deadline: '2026-11-20T07:45:00Z', at: BEFORE }] })
    m.clock.ms += 20 * 60_000
    expect(m.sweep()).toEqual([])
    await m.h.stop()
  })
  it('X3: with only earlier rows, holding the ticket for the quiet hour is still session-no-selfcheck', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'concluded', conclusion: 'done', deadline: null, at: BEFORE }] })
    expect(m.sweep()).toEqual([])
    m.clock.ms += 61 * 60_000
    expect(m.sweep()).toMatchObject([{ code: 'session-no-selfcheck', session: 'session-m', ticketId: m.ticket, minutes: 61 }])
    await m.h.stop()
  })
  it('X4: written, hint, no-template and injected rows after an orphan stop do not hide it', async () => {
    for (const kind of ['written', 'hint', 'no-template', 'injected']) {
      const m = await team({ idleSweep: true, rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }, { kind, conclusion: null, deadline: null, at: AFTER(2) }] })
      expect(m.sweep(), kind).toMatchObject([{ code: 'session-orphan-stop', session: 'session-m' }])
      await m.h.stop()
    }
  })
  it('X4: a later concluded row replaces an earlier orphan stop, and a concluded orphan is an orphan stop too', async () => {
    let rows: Row[] = [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }, { kind: 'concluded', conclusion: 'done', deadline: null, at: AFTER(2) }]
    const m = await team({ idleSweep: true, rows: () => rows })
    expect(m.sweep()).toEqual([])
    rows = [{ kind: 'concluded', conclusion: 'orphan', deadline: null, at: AFTER() }]
    expect(m.sweep()).toMatchObject([{ code: 'session-orphan-stop', session: 'session-m' }])
    await m.h.stop()
  })
  it('#765 follow-up: a row written in the same millisecond the Assignment began counts', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER(0) }] })
    expect(m.sweep()).toMatchObject([{ code: 'session-orphan-stop', session: 'session-m' }])
    await m.h.stop()
  })
  // Mutants the review saw survive (M5, M8, plus a read that throws).
  it('M5: an ended ticket is never swept', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }] })
    expect(m.sweep()).toHaveLength(1)
    const store = (m.h as unknown as { store: { tickets: { get: (id: string) => unknown } } }).store
    const get = store.tickets.get.bind(store.tickets)
    vi.spyOn(store.tickets, 'get').mockImplementation((id: string) => { const t = get(id) as object | undefined; return t === undefined ? t : { ...t, ended: { at: AFTER(3), how: 'done' } } })
    expect(m.sweep()).toEqual([])
    await m.h.stop()
  })
  it('M8: a remote member is never swept, and its log is never read', async () => {
    const read = vi.fn(() => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }])
    const m = await team({ idleSweep: true, rows: read })
    const binding = m.h.executor.bindingOf('session-m')!
    vi.spyOn(m.h.executor, 'list').mockReturnValue([{ ...binding, member: 'session-x@other-host' }] as never)
    read.mockClear()
    expect(m.sweep()).toEqual([])
    expect(read).not.toHaveBeenCalled()
    await m.h.stop()
  })
  it('a member whose log read throws is skipped; the others are still swept', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }] })
    const binding = m.h.executor.bindingOf('session-m')!
    vi.spyOn(m.h.executor, 'list').mockReturnValue([{ ...binding, member: 'session-broken' }, binding] as never)
    const d = (m.h as unknown as { d: { selfChecksOf: (id: string) => unknown } }).d
    const real = d.selfChecksOf
    d.selfChecksOf = (id: string) => { if (id === 'session-broken') throw new Error('boom'); return real(id) }
    expect(m.sweep()).toMatchObject([{ code: 'session-orphan-stop', session: 'session-m' }])
    await m.h.stop()
  })
})

describe('T5-B: the two reads between the plugins (M6, M7)', () => {
  it('M6: the log is read only while the prompt-templates self-check is on', () => {
    const rows = [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: AFTER() }]
    const selfChecks = vi.fn(() => rows)
    expect(readSelfChecks({ selfChecks, selfCheckEnabled: () => true }, 's')).toBe(rows)
    expect(selfChecks).toHaveBeenCalledWith('s')
    selfChecks.mockClear()
    expect(readSelfChecks({ selfChecks, selfCheckEnabled: () => false }, 's')).toBeUndefined()
    expect(readSelfChecks({ selfChecks }, 's')).toBeUndefined()
    expect(readSelfChecks(undefined, 's')).toBeUndefined()
    expect(selfChecks).not.toHaveBeenCalled()
  })
  it('M7: hasOpenTicket is true for a member holding a ticket, false otherwise, undefined with no team', async () => {
    const m = await team()
    expect(holdsOpenTicket([m.h], 'session-m')).toBe(true)
    expect(holdsOpenTicket([m.h], 'session-nobody')).toBe(false)
    expect(holdsOpenTicket([], 'session-m')).toBe(false)
    expect(holdsOpenTicket(undefined, 'session-m')).toBeUndefined()
    await m.h.stop()
  })
})
