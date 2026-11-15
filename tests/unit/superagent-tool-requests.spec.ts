// @vitest-environment node
/** docs/design/superagent-tool-requests.md: a tool outside a role's list is asked for on a P0 card, and granted per team. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RoleTools, grantableTool, roleToolRefusal } from '../../src/superagent/host/role-tools.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/superagent/host/policy.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

async function team(now = () => '2026-11-10T12:00:00.000Z') {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const rolesChanged = vi.fn()
  const presets: Record<string, string> = { 'session-o': 'superagent-observer' }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-tools-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    onRolesChanged: rolesChanged, now: () => now(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  return { h, rolesChanged }
}

describe('what may be asked for (T2)', () => {
  it('a community shell may; crossing the team, its protocol tools, subagents and the narrowed ygl tools may not', () => {
    expect(grantableTool('member', 'gitbash')).toBe(true)
    expect(grantableTool('observer', 'gitbash')).toBe(true)
    for (const name of ['a2a_route', 'a2a_file_send', 'a2a_team_join', 'superagent_route', 'a2a_ticket_request', 'subagent_spawn', 'session_create', 'mcp__ygl__write', 'bash', 'schedule_create']) expect(grantableTool('member', name)).toBe(false)
    expect(grantableTool('router', 'mcp__ygl__write')).toBe(false)
    expect(grantableTool('router', 'a2a_ticket_report')).toBe(false)
  })
  it('a granted tool passes the guard; an ungrantable one stays refused even if listed', () => {
    // T6: grants matter for the router; a member has every tool but the boundary without one.
    expect(roleToolRefusal('router', 'gitbash')).toContain('gitbash')
    expect(roleToolRefusal('router', 'gitbash', {}, ['gitbash'])).toBeUndefined()
    expect(roleToolRefusal('router', 'a2a_route', {}, ['a2a_route'])).toContain('a2a_route')
    expect(roleToolRefusal('member', 'gitbash')).toBeUndefined()
    expect(roleToolRefusal('member', 'a2a_route', {}, ['a2a_route'])).toContain('a2a_route')
  })
})

describe('the guard asks (T3)', () => {
  it('a refused grantable tool adds what the host said; an ungrantable one asks nothing', () => {
    const onRefused = vi.fn(() => 'A P0 decision card asks the owner.')
    const tools = new RoleTools({ roleOf: id => id === 'r' ? 'router' : id === 'm' ? 'member' : undefined, agentOf: () => undefined, logger: { warn: () => {} }, grantedOf: () => [], onRefused } as never)
    expect(tools.guard('gitbash', { id: 'r' } as never)).toMatch(/gitbash.*A P0 decision card asks the owner\./)
    expect(onRefused).toHaveBeenCalledWith('r', 'router', 'gitbash')
    expect(tools.guard('a2a_route', { id: 'r' } as never)).not.toContain('P0')
    // A member is not asked about: it already has gitbash, and its boundary is not something a card grants.
    expect(tools.guard('gitbash', { id: 'm' } as never)).toBeUndefined()
    expect(tools.guard('a2a_route', { id: 'm' } as never)).not.toContain('P0')
    expect(onRefused).toHaveBeenCalledTimes(1)
    const granted = new RoleTools({ roleOf: () => 'router', agentOf: () => undefined, logger: { warn: () => {} }, grantedOf: () => ['gitbash'] } as never)
    expect(granted.guard('gitbash', { id: 'r' } as never)).toBeUndefined()
  })
})

describe('the P0 card (T3, T4)', () => {
  it('one card per role and tool, P0 with no one click; approving grants the members and observers and recomputes their tools', async () => {
    const m = await team()
    expect(m.h.requestTool('session-o', 'observer', 'gitbash')).toContain('P0 decision card')
    expect(m.h.requestTool('session-m', 'member', 'gitbash')).toContain('already waiting')
    const cards = m.h.decisionCards().filter(c => c.source === 'tool')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ level: 'P0', recommended: '拒绝', by: 'member:gitbash' })
    expect(m.h.decide(cards[0]!.id, 'approve')).toMatchObject({ ok: false, code: 'needs-choice' })
    expect(m.h.decide(cards[0]!.id, 'choose', cards[0]!.options[0])).toMatchObject({ ok: true, granted: true })
    expect(m.h.settings.extraTools).toEqual({ member: ['gitbash'] })
    expect(m.h.grantedTools('session-o')).toEqual(['gitbash'])
    expect(m.h.grantedTools('session-m')).toEqual(['gitbash'])
    expect(m.h.grantedTools('session-r')).toEqual([])
    expect(m.rolesChanged).toHaveBeenCalled()
    expect(m.h.store.tickets.list()).toHaveLength(0)
    await m.h.stop()
  })
  it('declining grants nothing, and the tool is not asked about again within a day', async () => {
    let clock = Date.parse('2026-11-10T12:00:00.000Z')
    const m = await team(() => new Date(clock).toISOString())
    m.h.requestTool('session-m', 'member', 'gitbash')
    const [card] = m.h.decisionCards().filter(c => c.source === 'tool')
    expect(m.h.decide(card!.id, 'choose', '拒绝')).toMatchObject({ ok: true, granted: false })
    expect(m.h.settings.extraTools).toBeUndefined()
    clock += 3_600_000
    expect(m.h.requestTool('session-m', 'member', 'gitbash')).toContain('declined')
    expect(m.h.decisionCards().filter(c => c.source === 'tool')).toHaveLength(0)
    clock += 24 * 3_600_000
    expect(m.h.requestTool('session-m', 'member', 'gitbash')).toContain('P0 decision card')
    await m.h.stop()
  })
})

describe('the setting (T1, T5)', () => {
  it('validates names, keeps an unnamed role, and needs the owner', () => {
    const one = parseSettings({ extraTools: { member: ['gitbash'] } }, DEFAULT_SETTINGS)
    expect(one).toMatchObject({ ok: true, settings: { extraTools: { member: ['gitbash'] } } })
    const both = parseSettings({ extraTools: { router: ['webcam'] } }, (one as { settings: typeof DEFAULT_SETTINGS }).settings)
    expect(both).toMatchObject({ ok: true, settings: { extraTools: { router: ['webcam'], member: ['gitbash'] } } })
    expect(parseSettings({ extraTools: { member: ['bad name'] } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ extraTools: { member: [] } }, (one as { settings: typeof DEFAULT_SETTINGS }).settings)).toMatchObject({ ok: true, settings: { } })
    expect(touchesRules({ extraTools: { member: [] } })).toBe(true)
  })
})

describe('asking by name (T3)', () => {
  it('a team session asks for a tool its list hides; a tool that leaves the team is refused outright; a session outside the team cannot ask', async () => {
    const m = await team()
    const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
    const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
    registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (m.h.roleOf(id) !== undefined ? m.h : undefined))
    const ask = async (as: string, args: Record<string, unknown>) => await registered.get('a2a_tool_request')!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
    // T6: a member already has a2a_teams; the router, which keeps its list, still asks on a card.
    expect(await ask('session-m', { name: 'a2a_teams', why: '想看有哪些团队' })).toMatchObject({ ok: true, granted: true })
    expect(await ask('session-r', { name: 'a2a_teams', why: '想看有哪些团队' })).toMatchObject({ ok: true, requested: true })
    const [card] = m.h.decisionCards().filter(c => c.source === 'tool')
    expect(card).toMatchObject({ level: 'P0', by: 'router:a2a_teams' })
    expect(card!.reason).toContain('想看有哪些团队')
    expect(await ask('session-m', { name: 'a2a_route', why: 'x' })).toMatchObject({ ok: false, code: 'not-grantable' })
    expect(await ask('session-m', { name: 'bash', why: 'x' })).toMatchObject({ ok: true, granted: true })
    expect(await ask('session-x', { name: 'a2a_teams', why: 'x' })).toMatchObject({ ok: false, code: 'not-team' })
    await m.h.stop()
  })
})

describe('blocked tools (T6)', () => {
  it('the owner\'s block list is saved and validated, and keeps a tool from members', async () => {
    const m = await team()
    expect(m.h.saveSettings({ blockedTools: ['gitbash', 'mcp__market__publish'] }, () => true)).toMatchObject({ ok: true })
    expect(m.h.settings.blockedTools).toEqual(['gitbash', 'mcp__market__publish'])
    expect(m.h.saveSettings({ blockedTools: ['bad/name'] }, () => true)).toMatchObject({ ok: false })
    expect(roleToolRefusal('member', 'gitbash', {}, [], m.h.settings.blockedTools)).toContain('blocked')
    expect(roleToolRefusal('member', 'mcp__market__read', {}, [], m.h.settings.blockedTools)).toBeUndefined()
    expect(m.h.saveSettings({ blockedTools: [] }, () => true)).toMatchObject({ ok: true })
    expect(m.h.settings.blockedTools).toBeUndefined()
    await m.h.stop()
  })
})

