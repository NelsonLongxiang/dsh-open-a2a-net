// @vitest-environment node
/** docs/design/superagent-router-owner-asks.md: member profiles, dispatch by the router, changes the owner agrees to. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { guiOwnerProven, touchesRules } from '../../src/superagent/host/owner-proof.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/superagent/host/policy.ts'

const canvasOf = (ids: string[]) => (name: string) => name === 'team' ? { local: ids, remote: [] } : undefined
const person = (id: string, atMs: number, text = '就这样') => ({ id, atMs, text })

async function team(ids = ['session-r', 'session-a', 'session-b'], settings: Record<string, unknown> = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  let said: { id: string; atMs: number; text: string } | undefined
  const pool = { ids }
  const clock = { now: Date.parse('2026-11-09T10:00:00Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => canvasOf(pool.ids)(name), home: mkdtempSync(join(tmpdir(), 'sa-rules-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {},
    memberTurn: () => ({ quiet: true, text: '' }), personMessage: () => said, sessionName: (id: string) => `名字-${id.slice(8)}`, now: () => new Date(clock.now).toISOString(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...settings }, () => true)).toMatchObject({ ok: true })
  h.start()
  const accept = async (text: string, extra: Record<string, unknown>) => {
    const asked = h.request(text) as { triggerId: string }
    h.pass()
    return routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: text, scope: 's', reason: 'r', ...extra }) as Record<string, any>
  }
  const assigned = (member: string): string[] => sent.filter(([id, t]) => id === member && t.startsWith('[superagent assignment]')).map(([, t]) => t)
  return { h, sent, accept, assigned, pool, clock, say: (p: typeof said) => { said = p } }
}

const roles = { profiles: { 'session-a': { role: '写文档', rules: [{ name: 'docs', text: '文档类工单' }] }, 'session-b': { role: '写代码', rules: [] } } }

describe('settings: member profiles and dispatch rules', () => {
  const current = { ...DEFAULT_SETTINGS, members: ['m'] }
  it('takes a role, rules and dispatch text, and refuses what it should', () => {
    expect(parseSettings({ profiles: { m: { role: ' 文档 ', rules: [{ name: 'a', text: 'x' }] } }, dispatch: ' 看角色 ' }, current)).toMatchObject({ ok: true, settings: { profiles: { m: { role: '文档', rules: [{ name: 'a', text: 'x', enabled: true }] } }, dispatch: '看角色' } })
    expect(parseSettings({ profiles: { other: { rules: [] } } }, current)).toMatchObject({ ok: false, error: expect.stringContaining('not a member') })
    expect(parseSettings({ profiles: { m: { role: 'x'.repeat(201), rules: [] } } }, current)).toMatchObject({ ok: false })
    expect(parseSettings({ profiles: { m: { rules: [{ name: 'BAD', text: 'x' }] } } }, current)).toMatchObject({ ok: false })
    expect(parseSettings({ dispatch: 'x'.repeat(4001) }, current)).toMatchObject({ ok: false })
  })
  it('an empty profile is no profile, and a member who left loses theirs on the next write', () => {
    expect(parseSettings({ profiles: { m: { role: ' ', rules: [] } } }, current)).toMatchObject({ ok: true, settings: { profiles: {} } })
    const had = { ...current, members: [], profiles: { m: { rules: [] } } }
    expect(parseSettings({}, had)).toMatchObject({ ok: true, settings: { profiles: {} } })
  })
})

describe('a ticket the owner asked for in the router session', () => {
  const NOTE = 'tell them here in plain words'
  async function ticketFrom(chat: boolean) {
    const m = await team()
    let trigger: string
    if (chat) { m.say(person('msg-1', 1, '帮我补文档')); trigger = (m.h.requestForPerson(person('msg-1', 1, '帮我补文档')) as { trigger_id: string }).trigger_id }
    else trigger = (m.h.request('帮我补文档') as { triggerId: string }).triggerId
    m.h.pass()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const ticket = (routeItem(m.h, { trigger_id: trigger, kind: 'accept', title: 't', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a') ?? m.h.executor.bindingOf('session-b')).toBeDefined() })
    const member = m.h.executor.bindingOf('session-a') !== undefined ? 'session-a' : 'session-b'
    const reports = () => m.sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent report]')).map(([, t]) => t)
    return { ...m, ticket, member, reports }
  }
  it('asks the router to say the result in its own session', async () => {
    const m = await ticketFrom(true)
    m.h.report(m.member, { state: 'ready', summary: '做完了' }, m.ticket)
    expect(m.reports().at(-1)).toContain(NOTE)
    await m.h.stop()
  })
  it('leaves progress in the router\'s own notes', async () => {
    const m = await ticketFrom(true)
    m.h.report(m.member, { state: 'progress', summary: '做到一半' }, m.ticket)
    expect(m.reports().at(-1)).not.toContain(NOTE)
    await m.h.stop()
  })
  it('asks nothing of the kind for a request from the team page', async () => {
    const m = await ticketFrom(false)
    m.h.report(m.member, { state: 'ready', summary: '做完了' }, m.ticket)
    expect(m.reports().at(-1)).not.toContain(NOTE)
    await m.h.stop()
  })
})

describe('dispatch', () => {
  it('a named member gets the ticket while another is free', async () => {
    const m = await team(undefined, roles)
    expect(await m.accept('写段代码', { member: '名字-b' })).toMatchObject({ ok: true })
    await vi.waitFor(() => { expect(m.assigned('session-b')).toHaveLength(1) })
    expect(m.assigned('session-a')).toHaveLength(0)
    await m.h.stop()
  })

  it('with profiles an accept must name a member; an unknown one is refused with the list', async () => {
    const m = await team(undefined, roles)
    expect(await m.accept('甲', {})).toMatchObject({ ok: false, code: 'member', error: expect.stringContaining('名字-a') })
    expect(await m.accept('乙', { member: 'nobody' })).toMatchObject({ ok: false, code: 'member', error: expect.stringContaining('no such member') })
    await m.h.stop()
  })

  it('without profiles nothing changes: the first free member takes it', async () => {
    const m = await team()
    expect(await m.accept('甲', {})).toMatchObject({ ok: true })
    await vi.waitFor(() => { expect(m.assigned('session-a')).toHaveLength(1) })
    await m.h.stop()
  })

  it('a busy named member keeps its ticket; another is not given it', async () => {
    const m = await team(undefined, roles)
    await m.accept('一', { member: '名字-a' })
    await vi.waitFor(() => { expect(m.assigned('session-a')).toHaveLength(1) })
    await m.accept('二', { member: '名字-a' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(m.assigned('session-a')).toHaveLength(1)
    expect(m.assigned('session-b')).toHaveLength(0)
    await m.h.stop()
  })

  it('the router sees members, roles and dispatch rules; the member sees its own rules', async () => {
    const m = await team(undefined, { ...roles, dispatch: '文档给 a' })
    const asked = m.h.request('写文档') as { triggerId: string }
    m.h.pass()
    await vi.waitFor(() => { expect(m.sent.some(([id, t]) => id === 'session-r' && t.includes('[superagent candidate]'))).toBe(true) })
    const card = m.sent.find(([id, t]) => id === 'session-r' && t.includes('[superagent candidate]'))![1]
    expect(card).toContain('名字-a'); expect(card).toContain('role: 写文档'); expect(card).toContain('takes (docs): 文档类工单'); expect(card).toContain('文档给 a')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    routeItem(m.h, { trigger_id: asked.triggerId, kind: 'accept', title: 't', scope: 's', reason: 'r', member: 'a' })
    await vi.waitFor(() => { expect(m.assigned('session-a')).toHaveLength(1) })
    expect(m.assigned('session-a')[0]).toContain('your role: 写文档')
    expect(m.assigned('session-a')[0]).toContain('your rule docs: 文档类工单')
    await m.h.stop()
  })

  it('a named member who leaves sends the router to choose again, and superagent_assign does', async () => {
    const m = await team(undefined, roles)
    await m.accept('一', { member: '名字-b' })
    await vi.waitFor(() => { expect(m.assigned('session-b')).toHaveLength(1) })
    await m.accept('占着 a', { member: '名字-a' })
    await m.accept('等 a', { member: '名字-a' })
    await vi.waitFor(() => { expect(m.assigned('session-a')).toHaveLength(1) })
    const waiting = m.h.store.tickets.list().find(t => t.title === '等 a')!
    m.pool.ids = ['session-r', 'session-b']
    m.h.poolChanged()
    expect(m.sent.some(([id, t]) => id === 'session-r' && t.includes('has left the team') && t.includes(waiting.id))).toBe(true)
    expect(m.h.assignTicket(waiting.id, 'nobody')).toMatchObject({ ok: false, code: 'member' })
    await m.h.stop()
  })
})

describe('changing rules', () => {
  const rules = [{ name: 'docs', text: '核对文档' }]

  it('a proposal changes nothing, and applies only after the person speaks', async () => {
    const m = await team()
    expect(m.h.proposeRules('team', 'session-r', rules, '想加规则')).toMatchObject({ ok: true })
    expect(m.h.settings.rules).toEqual([])
    const filed = Date.parse(m.h.ruleChanges.pending('team')!.at)
    expect(m.h.applyRules('team', 'session-r', undefined)).toMatchObject({ ok: false, code: 'not-the-owner' })
    expect(m.h.applyRules('team', 'session-r', person('m0', filed - 1000))).toMatchObject({ ok: false, code: 'not-yet' })
    expect(m.h.settings.rules).toEqual([])
    expect(m.h.applyRules('team', 'session-r', person('m1', filed + 1000, '同意'))).toMatchObject({ ok: true, revision: 1 })
    expect(m.h.settings.rules).toMatchObject(rules)
    expect(m.h.ruleChanges.view().last.team).toMatchObject({ by: 'session-r', message: '同意', reason: '想加规则' })
    expect(m.h.ruleChanges.pending('team')).toBeUndefined()
    await m.h.stop()
  })

  it('a bad proposal is refused at once; a page edit makes a pending one stale', async () => {
    const m = await team()
    expect(m.h.proposeRules('team', 'session-r', [{ name: 'BAD', text: 'x' }], 'r')).toMatchObject({ ok: false, code: 'invalid' })
    m.h.proposeRules('team', 'session-r', rules, 'r')
    expect(m.h.saveSettings({ rules: [{ name: 'other', text: 'y' }] }, () => true)).toMatchObject({ ok: true })
    const filed = Date.parse(m.h.ruleChanges.pending('team')!.at)
    expect(m.h.applyRules('team', 'session-r', person('m', filed + 1000))).toMatchObject({ ok: false, code: 'stale' })
    expect(m.h.settings.rules).toMatchObject([{ name: 'other' }])
    expect(m.h.ruleChanges.view().last.team).toMatchObject({ by: 'owner' })
    await m.h.stop()
  })

  it('a member changes only its own, and one member cannot apply another\'s proposal', async () => {
    const m = await team()
    const value = { role: '写文档', rules }
    expect(m.h.proposeRules('member:session-a', 'session-a', value, 'r')).toMatchObject({ ok: true })
    const filed = Date.parse(m.h.ruleChanges.pending('member:session-a')!.at)
    expect(m.h.applyRules('member:session-a', 'session-b', person('m', filed + 1000))).toMatchObject({ ok: false, code: 'no-proposal' })
    expect(m.h.applyRules('member:session-a', 'session-a', person('m', filed + 1000))).toMatchObject({ ok: true })
    expect(m.h.settings.profiles['session-a']).toMatchObject({ role: '写文档' })
    expect(m.h.settings.profiles['session-b']).toBeUndefined()
    await m.h.stop()
  })

  it('dispatch rules go the same way', async () => {
    const m = await team()
    m.h.proposeRules('dispatch', 'session-r', '看角色', 'r')
    const filed = Date.parse(m.h.ruleChanges.pending('dispatch')!.at)
    expect(m.h.applyRules('dispatch', 'session-r', person('m', filed + 1000))).toMatchObject({ ok: true })
    expect(m.h.settings.dispatch).toBe('看角色')
    await m.h.stop()
  })
})

describe('the owner asks in the session', () => {
  it('files the person\'s words verbatim, once per message', async () => {
    const m = await team()
    const first = m.h.requestForPerson(person('msg-1', 1, '帮我开个工单，修登录'))
    expect(first).toMatchObject({ ok: true })
    expect(m.h.requestForPerson(person('msg-1', 1, '帮我开个工单，修登录'))).toMatchObject({ ok: true, reused: true, trigger_id: first.trigger_id })
    const trigger = m.h.store.triggers.get(String(first.trigger_id))!
    expect(trigger).toMatchObject({ text: '帮我开个工单，修登录', human: true, actor: { id: 'owner' } })
    await m.h.stop()
  })
})

describe('the owner\'s proof for a page edit', () => {
  const host = (auth: boolean) => vi.fn(async (_url: string, init: RequestInit) => ({ status: !auth ? 404 : new Headers(init.headers).has('cookie') ? 404 : 401 }))
  it('needs a cookie the host accepts and a host that refuses without one', async () => {
    expect(await guiOwnerProven('http://h', 'c=1', host(true))).toBe(true)
    expect(await guiOwnerProven('http://h', undefined, host(true))).toBe(false)
    expect(await guiOwnerProven('http://h', 'c=1', vi.fn(async () => ({ status: 401 })))).toBe(false)
    expect(await guiOwnerProven('http://h', 'c=1', host(false))).toBe(false)
    expect(await guiOwnerProven(undefined, 'c=1', host(true))).toBe(false)
  })
  it('asks only for writes that touch a rule', () => {
    for (const settings of [{ rules: [] }, { dispatch: '' }, { profiles: {} }]) expect(touchesRules(settings)).toBe(true)
    expect(touchesRules({ acceptMode: 'auto', bots: { a2a: [] } })).toBe(false)
  })
})

describe('a staffing write moves a rule set\'s revision once (#671)', () => {
  it('the executor\'s own history line is the only record; a page edit still counts as the owner\'s', async () => {
    const m = await team()
    const start = m.h.ruleChanges.revision('team')
    // What the staffing adapter does for team.rules.set: save as 'staffing', then record the blueprint's line.
    expect(m.h.saveSettings({ rules: [{ name: 'bp', text: '蓝图写的' }] }, () => true, undefined, 'staffing')).toMatchObject({ ok: true })
    expect(m.h.ruleChanges.revision('team')).toBe(start)
    m.h.ruleChanges.applied('team', { at: new Date().toISOString(), by: 'builder', reason: '由组队顾问蓝图 bp-1 起草' })
    expect(m.h.ruleChanges.revision('team')).toBe(start + 1)
    expect(m.h.ruleChanges.view().last.team).toMatchObject({ by: 'builder' })
    expect(m.h.saveSettings({ rules: [{ name: 'page', text: '页面改的' }] }, () => true)).toMatchObject({ ok: true })
    expect(m.h.ruleChanges.revision('team')).toBe(start + 2)
    expect(m.h.ruleChanges.view().last.team).toMatchObject({ by: 'owner' })
    await m.h.stop()
  })
})
