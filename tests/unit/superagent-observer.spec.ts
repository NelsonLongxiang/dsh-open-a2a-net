// @vitest-environment node
/** docs/design/superagent-router-owner-asks.md D15–D17: an observer is a member who may also open tickets. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'
import { DEFAULT_SETTINGS, OBSERVER_OPEN_MAX, observerActor, parseSettings, parseStoredSettings, policyEffects, policyVersion, teamPolicy } from '../../src/superagent/host/policy.ts'
import { MEMBER_TOOLS, OBSERVER_TOOLS, TEAM_TOOLS, roleToolRefusal } from '../../src/superagent/host/role-tools.ts'

async function team(settings: Record<string, unknown> = { observers: ['session-o'] }) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const pool = { ids: ['session-r', 'session-a', 'session-o'] }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: pool.ids, remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-observer-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {},
    memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...settings }, () => true)).toMatchObject({ ok: true })
  h.start()
  const file = (text: string, who = 'session-o') => h.requestForObserver(who, text) as Record<string, any>
  const route = (item: Record<string, unknown>) => routeItem(h, item as never) as Record<string, any>
  return { h, sent, pool, file, route, cards: () => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t) }
}

describe('settings', () => {
  const current = { ...DEFAULT_SETTINGS, members: ['m'], remoteMembers: [{ ref: 'dsh/aaaaaaaa@bbbbbbbb', key: 'k', url: 'http://x' }] }
  it('names local members only, and drops one who left', () => {
    expect(parseSettings({ observers: ['m', 'm'] }, current)).toMatchObject({ ok: true, settings: { observers: ['m'] } })
    expect(parseSettings({ observers: ['dsh/aaaaaaaa@bbbbbbbb'] }, current)).toMatchObject({ ok: false, error: expect.stringContaining('not a local member') })
    expect(parseSettings({}, { ...DEFAULT_SETTINGS, members: [], observers: ['m'] })).toMatchObject({ ok: true, settings: { observers: [] } })
  })
  it('survives a reload, needs the owner, and moves the policy version', () => {
    expect(parseStoredSettings({ observers: ['m'] })).toMatchObject({ ok: true, settings: { observers: ['m'] } })
    expect(touchesRules({ observers: [] })).toBe(true)
    expect(policyVersion({ ...DEFAULT_SETTINGS, observers: ['m'] })).not.toBe(policyVersion(DEFAULT_SETTINGS))
  })
})

describe('the tool list', () => {
  it('is a member\'s and one more; a plain member and a sessionless caller have not got it', () => {
    expect(OBSERVER_TOOLS).toEqual([...MEMBER_TOOLS, 'a2a_ticket_request'])
    expect(TEAM_TOOLS).toContain('a2a_ticket_request')
    expect(roleToolRefusal('observer', 'a2a_ticket_request')).toBeUndefined()
    expect(roleToolRefusal('member', 'a2a_ticket_request')).toContain('a2a_ticket_request')
    expect(roleToolRefusal('router', 'a2a_ticket_request')).toContain('a2a_ticket_request')
  })
  it('follows the setting, and only while the session is still a member', async () => {
    const m = await team()
    expect(m.h.toolRoleOf('session-o')).toBe('observer')
    expect(m.h.roleOf('session-o')).toBe('member')
    expect(m.h.toolRoleOf('session-a')).toBe('member')
    m.pool.ids = ['session-r', 'session-a']
    expect(m.h.toolRoleOf('session-o')).toBeUndefined()
    expect(m.file('还要做')).toMatchObject({ ok: false, code: 'not-observer' })
    await m.h.stop()
  })
})

describe('filing', () => {
  it('reaches the router as an explicit candidate marked as an agent\'s, and becomes a ticket a member gets', async () => {
    const m = await team()
    const filed = m.file('  依赖过期了，需要升级  ')
    expect(filed).toMatchObject({ ok: true })
    m.h.pass()
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(1) })
    expect(m.cards()[0]).toContain('strength explicit')
    expect(m.cards()[0]).toContain("team's observer")
    const trigger = m.h.store.triggers.get(filed.trigger_id)!
    expect(trigger).toMatchObject({ human: false, text: '依赖过期了，需要升级', actor: { source: 'workbench', id: observerActor('session-o') } })
    const accepted = m.route({ trigger_id: filed.trigger_id, kind: 'accept', title: '升级依赖', scope: 's', reason: 'r' })
    expect(accepted).toMatchObject({ ok: true, decision: 'accept' })
    expect(m.h.store.tickets.get(accepted.ticket_id)?.mandate).toMatchObject({ strength: 'explicit', basis: { via: 'listed', authority: 'observer' } })
    await vi.waitFor(() => { expect(m.sent.some(([id, t]) => id !== 'session-r' && t.startsWith('[superagent assignment]'))).toBe(true) })
    await m.h.stop()
  })

  it('is open to the observer only', async () => {
    const m = await team()
    expect(m.file('甲', 'session-a')).toMatchObject({ ok: false, code: 'not-observer' })
    expect(m.file('甲', 'session-r')).toMatchObject({ ok: false, code: 'not-observer' })
    expect(m.file('   ')).toMatchObject({ ok: false, code: 'refused' })
    await m.h.stop()
  })

  it('cannot stop a ticket', async () => {
    const m = await team()
    const owner = m.h.request('owner work') as { triggerId: string }
    m.h.pass()
    const ticket = m.route({ trigger_id: owner.triggerId, kind: 'accept', title: 't', scope: 's', reason: 'r' }).ticket_id as string
    const filed = m.file('把那张单停了')
    m.h.pass()
    expect(m.route({ trigger_id: filed.trigger_id, kind: 'stop', ticket_id: ticket, reason: 'r' })).toMatchObject({ ok: false, code: 'observer-stop' })
    expect(m.h.store.tickets.get(ticket)?.ended).toBeUndefined()
    await m.h.stop()
  })

  it('returns the same request for a repeat, and holds at the cap until one ends', async () => {
    const m = await team()
    const first = m.file('单 0')
    expect(m.file('单 0')).toMatchObject({ ok: true, reused: true, trigger_id: first.trigger_id })
    for (let i = 1; i < OBSERVER_OPEN_MAX; i++) expect(m.file(`单 ${String(i)}`)).toMatchObject({ ok: true })
    expect(m.file('再来一张')).toMatchObject({ ok: false, code: 'too-many-open' })
    m.h.pass()
    expect(m.route({ trigger_id: first.trigger_id, kind: 'ignore', reason: '不需要' })).toMatchObject({ ok: true })
    expect(m.file('再来一张')).toMatchObject({ ok: true })
    await m.h.stop()
  })
})

describe('the gate', () => {
  const observer = { id: 't', source: 'workbench', threads: [], actor: { source: 'workbench', id: observerActor('m') }, human: false, addressed: 'direct', at: '', text: 'x', meta: {} } as never
  const thread = { subscriptions: [] } as never
  it('admits a named observer in any accept mode, and nobody else with its actor shape', () => {
    for (const acceptMode of ['off', 'observe', 'auto'] as const) expect(teamPolicy({ ...DEFAULT_SETTINGS, acceptMode, observers: ['m'] }).gate(observer, thread, [])).toMatchObject({ admissible: true, strength: 'explicit' })
    expect(teamPolicy(DEFAULT_SETTINGS).gate(observer, thread, [])).toMatchObject({ admissible: false })
    const forged = { ...(observer as object), source: 'a2a', actor: { source: 'a2a', id: observerActor('m') } } as never
    expect(teamPolicy({ ...DEFAULT_SETTINGS, observers: ['m'] }).gate(forged, thread, [])).toMatchObject({ admissible: false })
  })
  it('a removed observer no longer revalidates, and its open tickets are told', () => {
    const actor = { source: 'workbench', id: observerActor('m') }
    const mandate = { strength: 'explicit', policyVersion: 'v', actor, scope: 's', basis: { via: 'listed', addressed: 'direct', sender: actor.id, authority: 'observer' } } as never
    expect(teamPolicy({ ...DEFAULT_SETTINGS, observers: ['m'] }).revalidate(mandate)).toBe(true)
    expect(teamPolicy(DEFAULT_SETTINGS).revalidate(mandate)).toBe(false)
    const effects = policyEffects({ ...DEFAULT_SETTINGS, observers: ['m'] }, DEFAULT_SETTINGS, [{ id: 'ticket', mandate } as never])
    expect(effects.get('ticket')).toMatchObject({ requesterAllowed: false })
  })
})
