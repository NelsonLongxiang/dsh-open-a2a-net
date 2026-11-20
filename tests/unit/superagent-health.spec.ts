// @vitest-environment node
/** docs/design/superagent-reliability.md R6: what keeps a team from working. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QUIET_MINUTES } from '../../src/superagent/host/index.ts'

async function team(loaded: Set<string>, settled = () => true, deliver: (id: string, text: string) => boolean = () => true) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const clock = { ms: Date.parse('2026-11-10T00:00:00Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-health-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: deliver, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    sessionLoaded: (id: string) => loaded.has(id), bootSettled: settled, now: () => new Date(clock.ms).toISOString(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const open = (): string => { const a = h.request('做事') as { triggerId: string }; h.pass(); return (routeItem(h, { trigger_id: a.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id }
  return { h, clock, open }
}

describe('the health check', () => {
  it('is empty when the router and members are loaded and nothing is stuck', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    expect(m.h.health()).toEqual([])
    await m.h.stop()
  })
  it('names a router or member session that is not loaded', async () => {
    const m = await team(new Set(['session-a']))
    expect(m.h.health()).toEqual([{ code: 'router-not-loaded', session: 'session-r' }])
    const n = await team(new Set(['session-r']))
    expect(n.h.health()).toEqual([{ code: 'member-not-loaded', session: 'session-a' }])
    await m.h.stop(); await n.h.stop()
  })
  it('says nothing of sessions not loaded while the host is still waking them after a start', async () => {
    let settled = false
    const m = await team(new Set(), () => settled)
    expect(m.h.health()).toEqual([])
    settled = true
    expect(m.h.health().map(p => p.code)).toEqual(['router-not-loaded', 'member-not-loaded'])
    await m.h.stop()
  })
  it('names a router whose turn failed (a used-up model quota), with why, until the router decides again', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const quota = Object.assign(new Error('GoUsageLimitError: usage limit reached for this period'), { status: 429 })
    m.h.memberFailed('session-r', quota)
    m.clock.ms += 12 * 60_000
    expect(m.h.health(m.clock.ms)).toEqual([{ code: 'router-turn-failed', session: 'session-r', minutes: 12, detail: expect.stringContaining('usage limit') }])
    const { problemText } = await import('../../src/superagent/host/health-reminders.ts')
    expect(problemText(m.h.health(m.clock.ms)[0]!)).toContain('模型额度')
    m.open()
    expect(m.h.health(m.clock.ms)).toEqual([])
    await m.h.stop()
  })
  it('names a working ticket with no change for an hour, and the state carries it', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const ticket = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(ticket) })
    expect(m.h.health(m.clock.ms + (QUIET_MINUTES - 1) * 60_000)).toEqual([])
    expect(m.h.health(m.clock.ms + (QUIET_MINUTES + 5) * 60_000)).toEqual([expect.objectContaining({ code: 'ticket-quiet', ticketId: ticket, title: '做事' })])
    expect(m.h.state()).toHaveProperty('health')
    await m.h.stop()
  })
  it('without an explicit time it reads the host\'s clock, as the stamps it compares (#722)', async () => {
    // The fixture's clock sits in 2026-11; the real clock is days or years away. Neither the timer's call nor state() passes a time.
    const m = await team(new Set(['session-r', 'session-a']))
    const ticket = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(ticket) })
    expect(m.h.health()).toEqual([])
    expect(m.h.state().health).toEqual([])
    m.clock.ms += (QUIET_MINUTES + 5) * 60_000
    expect(m.h.health()).toEqual([expect.objectContaining({ code: 'ticket-quiet', ticketId: ticket, minutes: QUIET_MINUTES + 5 })])
    await m.h.stop()
  })
})

describe('queued tickets (field report 2026-11-19: eleven queued for days beside idle members, health empty)', () => {
  const later = (m: { clock: { ms: number } }, minutes: number): number => m.clock.ms + minutes * 60_000

  it('names tickets queued past the quiet time behind busy members, as one problem with the count and the oldest', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const first = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(first) })
    const second = m.open()
    m.clock.ms += 60_000
    const third = m.open()
    expect(m.h.executor.queued().map(q => [q.ticketId, q.reason])).toEqual([[second, 'all-busy'], [third, 'all-busy']])
    expect(m.h.health(later(m, QUIET_MINUTES - 2)).filter(p => p.code === 'tickets-queued')).toEqual([])
    const [queued] = m.h.health(later(m, QUIET_MINUTES + 1)).filter(p => p.code === 'tickets-queued')
    expect(queued).toEqual({ code: 'tickets-queued', reason: 'all-busy', count: 2, ticketId: second, title: '做事', minutes: QUIET_MINUTES + 2 })
    await m.h.stop()
  })

  it('says which member a ticket is kept for, busy or gone, and which repository nobody works in', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const first = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(first) })
    const busy = m.open(), gone = m.open(), repo = m.open()
    m.h.executor.setMember(busy, 'session-a')
    m.h.executor.setMember(gone, 'session-gone')
    m.h.executor.setRepo(repo, 'acme/widgets')
    expect(Object.fromEntries(m.h.executor.queued().map(q => [q.ticketId, [q.reason, q.member ?? q.repo]]))).toEqual({
      [busy]: ['member-busy', 'session-a'], [gone]: ['member-absent', 'session-gone'], [repo]: ['no-repo-member', 'acme/widgets'],
    })
    const problems = m.h.health(later(m, QUIET_MINUTES + 1)).filter(p => p.code === 'tickets-queued')
    expect(problems.map(p => [p.reason, p.session ?? p.repo, p.count])).toEqual([['member-busy', 'session-a', 1], ['member-absent', 'session-gone', 1], ['no-repo-member', 'acme/widgets', 1]])
    const { problemKey, problemText } = await import('../../src/superagent/host/health-reminders.ts')
    expect(problems.map(problemKey)).toEqual(['tickets-queued:member-busy:session-a', 'tickets-queued:member-absent:session-gone', 'tickets-queued:no-repo-member:acme/widgets'])
    expect(problemText(problems[0]!)).toContain('superagent_assign')
    expect(problemText(problems[2]!)).toContain('acme/widgets')
    await m.h.stop()
  })

  it('shows the router, observers and the state what a queued ticket waits for; a pending ticket can be reassigned to anyone', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const first = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(first) })
    const second = m.open()
    m.h.executor.setMember(second, 'session-a')
    expect(m.h.queueOf(second)).toEqual({ reason: 'member-busy', member: 'session-a', since: expect.any(String) })
    expect(m.h.queueOf(first)).toBeUndefined()
    expect((m.h.state().executor as { queued: unknown[] }).queued).toEqual([expect.objectContaining({ ticketId: second, reason: 'member-busy', member: 'session-a', since: expect.any(String) })])
    const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
    const registered = new Map<string, { description: string; execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
    registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (m.h.roleOf(id) !== undefined ? m.h : undefined))
    const asRouter = { agent: { id: 'session-r' }, signal: new AbortController().signal }
    const one = await registered.get('superagent_read')!.execute({ kind: 'ticket', ticket_id: second }, asRouter)
    expect(one.queue).toEqual({ reason: 'member-busy', member: 'session-a', since: expect.any(String) })
    const all = await registered.get('superagent_read')!.execute({ kind: 'tickets' }, asRouter)
    expect(all.tickets.find((t: { id: string }) => t.id === second).queue).toMatchObject({ reason: 'member-busy' })
    expect(all.tickets.find((t: { id: string }) => t.id === first).queue).toBeNull()
    // The tool says what the host does: a ticket not started yet moves at any time.
    expect(registered.get('superagent_assign')!.description).toContain('has not started yet')
    expect(m.h.assignTicket(second, 'session-a')).toMatchObject({ ok: true })
    await m.h.stop()
  })
})

describe('queued tickets beside a free member (#744 review R1)', () => {
  it('names a ticket whose delivery to a free member keeps being refused, with the member', async () => {
    let attempts = 0
    const m = await team(new Set(['session-r', 'session-a']), () => true, (id, text) => { if (id === 'session-a' && text.startsWith('[superagent assignment]')) { attempts++; return false } return true })
    const ticket = m.open()
    await vi.waitFor(() => { expect(attempts).toBeGreaterThan(0) })
    m.h.executor.launch()
    // A tentative hold exists while the answer is in flight; assert the unchanged refusal postcondition after it settles.
    await vi.waitFor(() => {
      expect(attempts).toBeGreaterThan(1)
      expect(m.h.executor.list()).toEqual([])
      expect(m.h.executor.queued()).toEqual([expect.objectContaining({ ticketId: ticket, reason: 'delivery-refused', member: 'session-a', refusedAt: expect.any(String) })])
    })
    m.clock.ms += (QUIET_MINUTES + 5) * 60_000
    expect(m.h.health().filter(p => p.code === 'tickets-queued')).toEqual([expect.objectContaining({ reason: 'delivery-refused', session: 'session-a', count: 1, ticketId: ticket })])
    expect(m.h.queueOf(ticket)).toMatchObject({ reason: 'delivery-refused', member: 'session-a' })
    const { problemText } = await import('../../src/superagent/host/health-reminders.ts')
    expect(problemText(m.h.health().find(p => p.code === 'tickets-queued')!)).toContain('被拒绝')
    await m.h.stop()
  })

  it('names a launch that has not happened within the quiet time as stalled, and stays quiet before it', async () => {
    const { queuedProblems, queueReason } = await import('../../src/superagent/host/index.ts')
    const t0 = Date.parse('2026-11-19T00:00:00Z')
    const q = [{ ticketId: 't1', assignmentId: 'a1', reason: 'launching' as const }, { ticketId: 't2', assignmentId: 'a2', reason: 'paused' as const }]
    const since = (): string => new Date(t0).toISOString()
    expect(queuedProblems(q, since, id => id, t0 + (QUIET_MINUTES - 1) * 60_000)).toEqual([])
    expect(queuedProblems(q, since, id => id, t0 + (QUIET_MINUTES + 1) * 60_000)).toEqual([{ code: 'tickets-queued', reason: 'launch-stalled', count: 1, ticketId: 't1', title: 't1', minutes: QUIET_MINUTES + 1 }])
    expect(queueReason('launching', 5)).toBe('launching')
    expect(queueReason('launching', QUIET_MINUTES)).toBe('launch-stalled')
    const { problemText } = await import('../../src/superagent/host/health-reminders.ts')
    expect(problemText({ code: 'tickets-queued', reason: 'launch-stalled', count: 1, minutes: 61, title: 't1' })).toContain('原因不明')
  })

  it('a paused team reports its queue as paused, not as a stall', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const first = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(first) })
    const second = m.open()
    expect(m.h.saveSettings({ paused: true }, () => true)).toMatchObject({ ok: true })
    expect(m.h.executor.queued()).toEqual([expect.objectContaining({ ticketId: second, reason: 'paused' })])
    expect(m.h.health(m.clock.ms + (QUIET_MINUTES + 5) * 60_000).filter(p => p.code === 'tickets-queued')).toEqual([])
    await m.h.stop()
  })
})
