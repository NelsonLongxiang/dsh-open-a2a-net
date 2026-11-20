// @vitest-environment node
/** T5-B (workbench-market 18, the session idle sweep): problems from the wrap-up self-check log; off by default. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'
import { problemText } from '../../src/superagent/host/health-reminders.ts'

type Row = { kind: string; conclusion: string | null; deadline: string | null; at: string }
const T0 = Date.parse('2026-11-20T08:00:00Z')

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
    const m = await team({ rows: () => [{ kind: 'orphan', conclusion: 'orphan', deadline: null, at: 'x' }] })
    expect(m.sweep()).toEqual([])
    expect(touchesRules({ idleSweep: true })).toBe(true)
    expect(m.h.saveSettings({ idleSweep: 'on' } as never, () => true)).toMatchObject({ ok: false })
    await m.h.stop()
  })
  it('an orphan stop as the latest word is a problem for that member\'s ticket', async () => {
    const m = await team({ idleSweep: true, rows: () => [{ kind: 'injected', conclusion: null, deadline: null, at: 'a' }, { kind: 'orphan', conclusion: 'orphan', deadline: null, at: 'b' }] })
    expect(m.sweep()).toEqual([{ code: 'session-orphan-stop', session: 'session-m', ticketId: m.ticket, title: '做事' }])
    expect(problemText(m.sweep()[0] as never)).toContain('孤儿停')
    await m.h.stop()
  })
  it('a registered wait past its deadline is overdue; a deadline that is not a time says nothing', async () => {
    let rows: Row[] = [{ kind: 'concluded', conclusion: 'waiting', deadline: '2026-11-20T07:00:00Z', at: 'a' }]
    const m = await team({ idleSweep: true, rows: () => rows })
    expect(m.sweep()).toMatchObject([{ code: 'session-wait-overdue', session: 'session-m', minutes: 60, detail: '2026-11-20T07:00:00Z' }])
    rows = [{ kind: 'concluded', conclusion: 'waiting', deadline: '今天下班前', at: 'a' }]
    expect(m.sweep()).toEqual([])
    rows = [{ kind: 'concluded', conclusion: 'waiting', deadline: '2026-11-20T09:00:00Z', at: 'a' }]
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
})
