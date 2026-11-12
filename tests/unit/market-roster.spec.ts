/**
 * superagent-market-progress-roster P3: the roster report — the team's seats with their load, to every canvas remote
 * member whose card declares teamRoster; every 5 minutes, 30 seconds after a change, and never to anyone else.
 */
import { describe, expect, it } from 'vitest'
import { RosterReports, rosterSeats, rosterText, ROSTER_EVERY_MS, ROSTER_SETTLE_MS } from '../../src/superagent/host/roster.ts'

const T0 = Date.parse('2026-11-11T14:00:00.000Z')

function roster(options: { declares?: (ref: string) => boolean; fail?: boolean; warm?: () => void } = {}) {
  let now = T0
  const team = { canvas: 'ops', router: 'session-r', members: ['session-m1', 'session-m2'], observers: ['session-o'] }
  const load: Record<string, { active: number; queued: number; since?: string }> = { 'session-m1': { active: 1, queued: 2, since: '2026-11-11T13:50:00.000Z' }, 'session-m2': { active: 0, queued: 0 } }
  const online = new Set(['session-r', 'session-m1', 'session-o'])
  const sent: Array<{ ref: string; text: string; taskId: string }> = []
  const r = new RosterReports({
    team: () => team, remotes: () => ['market/aaaa1111@0123abcd', 'peer/bbbb2222@89abcdef'],
    declares: (ref, capability) => capability === 'teamRoster' && (options.declares ?? (ref => ref.startsWith('market/')))(ref),
    send: async (ref, text, taskId) => { if (options.fail) throw new Error('unreachable'); sent.push({ ref, text, taskId }) },
    handleOf: id => `dsh/${id.slice(8, 16).padEnd(8, '0')}`, nameOf: id => ({ 'session-m1': '后端' } as Record<string, string>)[id], online: id => online.has(id),
    loadOf: id => load[id] ?? { active: 0, queued: 0 }, hostFingerprint: () => '0123456789abcdef', nowMs: () => now, logger: { info: () => {}, warn: () => {} },
    ...(options.warm !== undefined ? { warm: options.warm } : {}),
  })
  return { r, sent, load, online, team, advance: (ms: number) => { now += ms } }
}

describe('the roster report', () => {
  it('lists the router, the members with their load, and the observers, as the team\'s canvas address', () => {
    const { r: _r, ...h } = roster()
    const seats = rosterSeats({ team: () => h.team, handleOf: id => `dsh/${id}`, nameOf: () => undefined, online: id => h.online.has(id), loadOf: id => h.load[id] ?? { active: 0, queued: 0 } })
    expect(seats).toEqual([
      { seat: 'dsh/session-r', team: 'dsh/canvas/ops', role: 'router', online: true, active: 0, queued: 0 },
      { seat: 'dsh/session-m1', team: 'dsh/canvas/ops', role: 'member', online: true, active: 1, queued: 2, lastActiveAt: '2026-11-11T13:50:00.000Z' },
      { seat: 'dsh/session-m2', team: 'dsh/canvas/ops', role: 'member', online: false, active: 0, queued: 0 },
      { seat: 'dsh/session-o', team: 'dsh/canvas/ops', role: 'observer', online: true, active: 0, queued: 0 },
    ])
  })

  it('goes at once to the remote members that declare teamRoster only, as an [A2A roster] line and one JSON line', async () => {
    const h = roster()
    await h.r.tick()
    expect(h.sent.map(s => s.ref)).toEqual(['market/aaaa1111@0123abcd'])
    const [head, body] = h.sent[0]!.text.split('\n')
    expect(head).toBe('[A2A roster] 01234567 2026-11-11T14:00:00.000Z')
    expect(JSON.parse(body!)).toMatchObject({ host: '0123456789abcdef', at: '2026-11-11T14:00:00.000Z', seats: expect.arrayContaining([expect.objectContaining({ role: 'member', name: '后端', active: 1, queued: 2 })]) })
    expect(h.sent[0]!.taskId).toBe(`roster-01234567-${String(T0)}`)
    expect(rosterText('0123456789abcdef', 'x', [])).toBe('[A2A roster] 01234567 x\n{"host":"0123456789abcdef","at":"x","seats":[]}')
  })

  it('nothing changed: again only after 5 minutes; a change: 30 seconds after it', async () => {
    const h = roster()
    await h.r.tick()
    h.advance(ROSTER_EVERY_MS - 1_000); await h.r.tick()
    expect(h.sent).toHaveLength(1)
    h.advance(1_000); await h.r.tick()
    expect(h.sent).toHaveLength(2)
    h.online.delete('session-m1')
    h.advance(1_000); await h.r.tick()
    expect(h.sent).toHaveLength(2)
    h.advance(ROSTER_SETTLE_MS); await h.r.tick()
    expect(h.sent).toHaveLength(3)
    expect(JSON.parse(h.sent[2]!.text.split('\n')[1]!).seats.find((s: { role: string; online: boolean; queued: number }) => s.queued === 2).online).toBe(false)
  })

  it('refreshes the peers\' cards on every look, so a restart\'s empty card cache does not stop the roster (market trial)', async () => {
    // After a restart the host knows no card until something fetches it: the market is neither confirmed nor declaring.
    let cached = false, warmed = 0
    const h = roster({ declares: ref => cached && ref.startsWith('market/'), warm: () => { warmed++; queueMicrotask(() => { cached = true }) } })
    await h.r.tick()
    expect(h.sent).toEqual([])
    h.advance(10_000); await h.r.tick()
    expect(h.sent.map(x => x.ref)).toEqual(['market/aaaa1111@0123abcd'])
    expect(warmed).toBe(2)
    // A refresh that throws is logged, and the look goes on.
    const t = roster({ warm: () => { throw new Error('peer store busy') } })
    await t.r.tick()
    expect(t.sent).toHaveLength(1)
  })

  it('no declaring member, no canvas, or no host key: nothing is sent; a failed send is retried on the next due tick', async () => {
    const none = roster({ declares: () => false })
    await none.r.tick()
    expect(none.sent).toEqual([])
    let fail = true
    let tries = 0
    const failing = roster({ declares: ref => { if (ref.startsWith('market/')) tries++; return ref.startsWith('market/') } })
    const send = (failing.r as unknown as { d: { send: (ref: string, text: string, taskId: string) => Promise<void> } }).d
    const real = send.send
    send.send = async (...args) => { if (fail) throw new Error('unreachable'); await real(...args) }
    await failing.r.tick()
    expect(failing.sent).toEqual([])
    fail = false
    failing.advance(10_000); await failing.r.tick()
    expect(failing.sent).toHaveLength(1)
    expect(tries).toBe(2)
  })
})
