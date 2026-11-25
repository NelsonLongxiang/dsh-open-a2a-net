/**
 * superagent design v4, PR-D: the role tool lists (pinned) and how the host applies them.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, cleanupBeforeTempDirs } from '../temp-dirs.ts'
import { Config } from '../../src/config.ts'
import { MEMBER_DENY, MEMBER_TOOLS, ROUTER_TOOLS, RoleTools, TEAM_TOOLS, memberBoundary, roleToolRefusal, type Role, type RoleAgent } from '../../src/superagent/host/role-tools.ts'

/** The session's own lesson and self-check tools (dsh-prompt-templates LESSON_SELF_TOOLS), written out so the list can only move with this test. */
const REFLECT = ['lesson_write', 'lesson_none', 'lesson_keep', 'lesson_timeline', 'lesson_type_propose', 'selfcheck_write', 'selfcheck_conclude']

describe('role tool lists', () => {
  it('the team\'s own tools are the router\'s, the member\'s ticket tools and the builder\'s inventory', () => {
    expect(TEAM_TOOLS).toEqual([...ROUTER_TOOLS.filter(name => !name.startsWith('schedule_') && name !== 'a2a_whoami' && !REFLECT.includes(name) && !name.startsWith('mcp__ygl__') && !['read', 'glob', 'grep', 'skill'].includes(name)), 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_ticket_request', 'a2a_decision_propose', 'a2a_ticket_note', 'a2a_card_cast', 'a2a_card_queue', 'a2a_decision_decide', 'superagent_org_read', 'superagent_rule_templates', 'superagent_blueprint_propose', 'superagent_blueprint_apply', 'superagent_blueprint_withdraw', 'superagent_issue_propose', 'superagent_issue_file'])
    for (const name of ['a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback']) expect(MEMBER_TOOLS).toContain(name)
  })

  it('pins what the router and a member may call', () => {
    expect(ROUTER_TOOLS).toEqual(['schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view', 'schedule_update', 'schedule_delete', 'a2a_whoami', 'lesson_write', 'lesson_none', 'lesson_keep', 'lesson_timeline', 'lesson_type_propose', 'selfcheck_write', 'selfcheck_conclude', 'mcp__ygl__read', 'mcp__ygl__trees', 'read', 'glob', 'grep', 'skill', 'a2a_tool_request', 'a2a_outbound_request', 'superagent_route', 'superagent_split', 'superagent_read', 'superagent_reply', 'superagent_status', 'superagent_note', 'superagent_request', 'superagent_assign', 'superagent_rules_propose', 'superagent_rules_apply', 'superagent_decision_propose'])
    expect(MEMBER_TOOLS).toEqual(['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill',
      'web_search', 'web_fetch', 'skill', 'todo_write', 'schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view', 'schedule_update', 'schedule_delete', 'a2a_whoami', 'mcp__ygl__read', 'mcp__ygl__trees', 'mcp__ygl__write', 'mcp__ygl__verify', 'mcp__ygl__doctor', 'a2a_outbound_request', 'a2a_decision_decide', 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_ticket_request', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_file_fetch'])
  })

  it('no role may open or reach sessions, or route or report over A2A', () => {
    const sideChannels = ['subagent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent', 'a2a_route', 'a2a_report', 'a2a_teams',
      'a2a_tasks', 'a2a_file_send', 'a2a_team_join', 'a2a_exposure', 'ask_user', 'schedule']
    for (const name of sideChannels) expect(roleToolRefusal('router', name), `router ${name}`).toContain('[superagent-role-tools]')
    // T6: a member keeps every tool but the boundary; read-only network views and the host's other tools are its own.
    for (const role of ['member', 'observer'] as const) {
      for (const name of ['subagent', 'subagent_fork', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent', 'workflow', 'plugin_manager', 'ask_user_question', 'a2a_route', 'a2a_report', 'a2a_file_send', 'a2a_team_join', 'a2a_team_leave', 'a2a_exposure', 'superagent_route', 'session_new', 'task'])
        expect(roleToolRefusal(role, name), `${role} ${name}`).toContain('[superagent-role-tools]')
      for (const name of ['a2a_teams', 'a2a_tasks', 'gitbash', 'mcp__workbench-market__publish', 'create_goal', 'present'])
        expect(roleToolRefusal(role, name), `${role} ${name}`).toBeUndefined()
      expect(roleToolRefusal(role, 'gitbash', {}, [], ['gitbash'])).toContain('blocked')
    }
    expect(roleToolRefusal('router', 'bash')).toBeDefined()
    // Owner 2026-11-18: the router reads files and loads skills, and still writes nothing.
    for (const name of ['read', 'glob', 'grep', 'skill']) expect(roleToolRefusal('router', name), `router ${name}`).toBeUndefined()
    for (const name of ['write', 'edit', 'pwsh', 'job_output']) expect(roleToolRefusal('router', name), `router ${name}`).toBeDefined()
    // Tool requests are the router's alone (redundancy review 2026-11-18).
    expect(roleToolRefusal('router', 'a2a_tool_request')).toBeUndefined()
    expect(roleToolRefusal('member', 'a2a_tool_request')).toBeDefined()
    expect(roleToolRefusal('router', 'a2a_ticket_report')).toBeDefined()
    expect(roleToolRefusal('member', 'superagent_route')).toBeDefined()
    // The runtime's transport is not a capability: each call it makes is guarded on its own.
    expect(roleToolRefusal('router', 'run_code')).toBeUndefined()
    expect(roleToolRefusal('member', 'run_code')).toBeUndefined()
  })

  it('ticket d7de946a: the router and the builder close their own lesson and self-check rounds, and gain nothing else', () => {
    for (const role of ['router', 'builder'] as const) {
      for (const name of REFLECT) expect(roleToolRefusal(role, name), `${role} ${name}`).toBeUndefined()
      // Still refused: other sessions, subagents, shell, writes, A2A sending, and look-alike names.
      for (const name of ['send_message', 'list_agents', 'interrupt_agent', 'subagent', 'session_new', 'bash', 'pwsh', 'write', 'edit', 'a2a_route', 'a2a_report', 'a2a_file_send', 'lesson_delete', 'selfcheck_read_others', 'lesson_write_for'])
        expect(roleToolRefusal(role, name), `${role} ${name}`).toContain('[superagent-role-tools]')
    }
    // Members and observers already have them (deny-list, not allow-list); their lists do not change.
    for (const role of ['member', 'observer'] as const) for (const name of REFLECT) {
      expect(roleToolRefusal(role, name), `${role} ${name}`).toBeUndefined()
      expect(memberBoundary(role, name)).toBe(false)
    }
    for (const name of REFLECT) expect(MEMBER_TOOLS).not.toContain(name)
    // Not team tools: a session outside a team keeps them.
    for (const name of REFLECT) expect(TEAM_TOOLS).not.toContain(name)
  })
})

describe('the plugin config', () => {
  it('runs the team engine unless told not to', () => {
    expect(Config({}).superagent).toBe(true)
    expect(Config({ superagent: false }).superagent).toBe(false)
  })
})

describe('RoleTools', () => {
  const setup = (roles: Record<string, Role>) => {
    const agents = new Map<string, RoleAgent>()
    const log: string[] = []
    const scoped = (id: string, known: string[]): RoleAgent => ({
      id,
      // The agent's scope key, under dsh-scope's symbol description, as on a host.
      ctx: { [Symbol('dsh.scope')]: {}, tools: { get: name => (known.includes(name) ? {} : undefined), restrict: f => { log.push(`${id} ${f.allow !== undefined ? `restrict ${f.allow.join(',')}` : `deny ${f.deny!.join(',')}`}`); return () => { log.push(`${id} lift`) } } } },
    })
    const tools = new RoleTools({ roleOf: id => roles[id], agentOf: id => agents.get(id), logger: { warn: () => {} } })
    return { agents, log, scoped, tools }
  }

  it('a subagent acts in its nearest role parent\'s role; an unrelated agent has none', () => {
    const { agents, tools } = setup({ m: 'member' })
    agents.set('m', { id: 'm' })
    agents.set('s1', { id: 's1', session: { header: { parentSession: 'm' } } })
    const s2: RoleAgent = { id: 's2', session: { header: { parentSession: 's1' } } }
    expect(tools.guard('a2a_route', s2)).toContain('[superagent-role-tools]')
    expect(tools.guard('bash', s2)).toBeUndefined()
    expect(tools.guard('a2a_route', { id: 'o' })).toBeUndefined()
    expect(tools.guard('a2a_route', undefined)).toBeUndefined()
  })

  it('restricts a role session to the tools its scope has, re-applies on a role change, lifts when the role goes', () => {
    const roles: Record<string, Role> = { r: 'router' }
    const { log, scoped, tools } = setup(roles)
    // The plugin registers every team tool, so a real scope has them all; the work tools come from the preset.
    const team = TEAM_TOOLS
    const r = scoped('r', [...team, 'bash', 'a2a_route'])
    const routerAllow = ROUTER_TOOLS.filter(name => team.includes(name)).join(',')
    // T6: a member is restricted by what leaves the team, not to a list: here a2a_route and the router's and observer's team tools.
    const memberDeny = [...new Set([...MEMBER_DENY, ...team])].filter(name => memberBoundary('member', name) && [...team, 'bash', 'a2a_route'].includes(name)).join(',')
    tools.sync(r)
    tools.sync(r)
    expect(log).toEqual([`r restrict ${routerAllow}`])
    roles.r = 'member'
    tools.sync(r)
    expect(log.slice(1)).toEqual(['r lift', `r deny ${memberDeny}`])
    expect(memberDeny).toContain('a2a_route')
    expect(memberDeny).not.toContain('bash')
    expect(memberDeny).not.toContain('a2a_ticket_report')
    delete roles.r
    tools.sync(r)
    expect(log.slice(3)).toEqual(['r lift', `r deny ${team.join(',')}`])
    expect(tools.list()).toEqual({})
  })

  it('a session with no role is not offered the team\'s tools, until it gets a role', () => {
    const roles: Record<string, Role> = {}
    const { log, scoped, tools } = setup(roles)
    const plain = scoped('p', [...TEAM_TOOLS, 'bash', 'a2a_route'])
    tools.sync(plain)
    tools.sync(plain)
    expect(log).toEqual([`p deny ${TEAM_TOOLS.join(',')}`])
    expect(tools.list()).toEqual({})
    roles.p = 'router'
    tools.sync(plain)
    // The fake registry has no schedule tools, no a2a_whoami and no MCP tools, and a restriction names only the tools the scope has.
    expect(log.slice(1)).toEqual(['p lift', `p restrict ${ROUTER_TOOLS.filter(name => !name.startsWith('schedule_') && name !== 'a2a_whoami' && !REFLECT.includes(name) && !name.startsWith('mcp__') && !['read', 'glob', 'grep', 'skill'].includes(name)).join(',')}`])
    expect(tools.list()).toEqual({ p: 'router' })
  })

  it('a restriction made before the plugin\'s own tools were visible is made again on the next sync (router after a restart, 2026-11-11)', () => {
    const { log, tools } = setup({ r: 'router' })
    const known = ['bash', 'schedule_list']
    const r: RoleAgent = { id: 'r', ctx: { [Symbol('dsh.scope')]: {}, tools: { get: name => (known.includes(name) ? {} : undefined), restrict: f => { log.push(`restrict ${f.allow!.join(',')}`); return () => { log.push('lift') } } } } } as never
    tools.sync(r)
    expect(log).toEqual(['restrict schedule_list'])
    known.push('superagent_route', 'superagent_status')
    tools.sync(r)
    expect(log.slice(1)).toEqual(['lift', 'restrict schedule_list,superagent_route,superagent_status'])
  })

  it('a short restriction is made again on every later sync and warns only once (warnedShort, #584)', () => {
    const log: string[] = []
    const warned: string[] = []
    const tools = new RoleTools({ roleOf: () => 'router', agentOf: () => undefined, logger: { warn: (f, ...a) => { warned.push([f, ...a].join(' ')) } } })
    // The sync ran while only these of the router's tools were visible (a session restored as the host starts), so the applied
    // list is one `superagent_*` short of the role's own tools: every later sync re-makes it, and the warning is not repeated.
    const known = ['bash', 'schedule_list', 'superagent_route']
    const r: RoleAgent = { id: 'r', ctx: { [Symbol('dsh.scope')]: {}, tools: { get: name => (known.includes(name) ? {} : undefined), restrict: f => { log.push(`restrict ${f.allow!.join(',')}`); return () => { log.push('lift') } } } } } as never
    tools.sync(r); tools.sync(r); tools.sync(r)
    expect(log).toEqual(['restrict schedule_list,superagent_route', 'lift', 'restrict schedule_list,superagent_route', 'lift', 'restrict schedule_list,superagent_route'])
    expect(warned.filter(line => line.includes('does not see'))).toHaveLength(1)
    expect(warned.join()).toContain('made again at its next turn')
    // Once the scope has the rest of the team's tools the restriction is complete: made once more, then left alone, and still
    // one warning for the whole run.
    known.push(...TEAM_TOOLS.filter(name => !known.includes(name)))
    const complete = ROUTER_TOOLS.filter(name => known.includes(name)).join(',')
    tools.sync(r); tools.sync(r)
    expect(log.slice(5)).toEqual(['lift', `restrict ${complete}`])
    expect(warned.filter(line => line.includes('does not see'))).toHaveLength(1)
  })

  it('a complete restriction is not made again on every sync', () => {
    const roles: Record<string, Role> = { m: 'member' }
    const { log, scoped, tools } = setup(roles)
    const m = scoped('m', [...MEMBER_TOOLS, 'a2a_route'])
    tools.sync(m); tools.sync(m); tools.sync(m)
    expect(log).toEqual(['m deny a2a_route'])
  })

  it('a context without the tools service does not throw into the session\'s creation', () => {
    const { tools } = setup({})
    const ctx = { get tools(): never { throw new Error('cannot get property "tools" without inject') } }
    expect(() => tools.sync({ id: 'x', ctx } as never)).not.toThrow()
  })

  it('a session with none of the team\'s tools is left alone', () => {
    const { log, scoped, tools } = setup({})
    tools.sync(scoped('p', ['bash']))
    expect(log).toEqual([])
  })

  it('a restriction the registry refuses is logged, never thrown into the agent\'s creation', () => {
    const warned: string[] = []
    const tools = new RoleTools({ roleOf: () => 'member', agentOf: () => undefined, logger: { warn: (f, ...a) => { warned.push([f, ...a].join(' ')) } } })
    tools.sync({ id: 'x', ctx: { [Symbol('dsh.scope')]: {}, tools: { get: () => ({}), restrict: () => { throw new Error('scope-local name') } } } as never })
    expect(warned.join()).toContain('not restricted')
    expect(tools.list()).toEqual({})
  })
})

describe('the team\'s agent presets: shipped in the bundle layer, required of a router and its members', () => {
  it('the bundle layer declares the observer preset: a member\'s composition with its own persona', async () => {
    const { readFileSync } = await import('node:fs')
    const { MEMBER_PRESET, OBSERVER_PRESET } = await import('../../src/superagent/host/role-tools.ts')
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const block = (id: string): string => { const start = layer.indexOf(`        id: ${id}\n`); expect(start).toBeGreaterThan(0); const next = layer.indexOf('\n    - id: ', start); return layer.slice(start, next < 0 ? undefined : next) }
    const plugins = (preset: string): string[] => preset.split('\n').filter(line => /^\s+(- id|name): /.test(line) && !/persona|prefix/.test(line) && !line.startsWith('        id:') && !line.startsWith('        name:'))
    const member = block(MEMBER_PRESET), observer = block(OBSERVER_PRESET)
    expect(plugins(observer)).toEqual(plugins(member))
    expect(observer).toContain('a2a_ticket_request')
    // #717: a member may propose too; only the observer raises decision cards of its own.
    expect(member).toContain('a2a_ticket_request')
    expect(observer).toContain('a2a_decision_propose')
    expect(member).not.toContain('a2a_decision_propose')
    expect(observer).not.toContain('dsh-tool-subagent')
    expect(observer).toContain("name: '@nelsonlongxiang/dsh-open-a2a-net/superagent-ptc'")
    expect(block('superagent-builder')).not.toContain('superagent-ptc')
  })

  it('the bundle layer declares the router and member presets the host names', async () => {
    const { readFileSync } = await import('node:fs')
    const { ROUTER_PRESET, MEMBER_PRESET } = await import('../../src/superagent/host/role-tools.ts')
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const block = (id: string): string => { const start = layer.indexOf(`        id: ${id}\n`); expect(start).toBeGreaterThan(0); const next = layer.indexOf('\n    - id: ', start); return layer.slice(start, next < 0 ? undefined : next) }
    const router = block(ROUTER_PRESET), member = block(MEMBER_PRESET)
    // The role lives in the composition: a persona each; the router reads only (files, search, skills), with no shell or jobs; no subagents anywhere.
    for (const preset of [router, member]) { expect(preset).toContain("name: '@deepseek-ai/dsh-persona'"); expect(preset).not.toContain('dsh-tool-subagent') }
    expect(router).toMatch(/dsh-tool-fs'\n\s+config:\n\s+write: false\n\s+edit: false/)
    expect(router).toContain("name: '@deepseek-ai/dsh-tool-fs-search'")
    for (const absent of ['dsh-tool-bash', 'dsh-tool-pwsh', 'dsh-bash-sandbox', 'dsh-tool-jobs']) expect(router).not.toContain(absent)
    // Owner 2026-11-18: members get the standard preset's goal and present tools.
    for (const plugin of ['dsh-command-goal', 'dsh-tool-goal', 'dsh-tool-present']) expect(member).toContain(`name: '@deepseek-ai/${plugin}'`)
    expect(router).toContain('superagent_route')
    // Owner 2026-11-19: members (and observers, whose plugins equal a member's) work in code mode by default; the router reads
    // only and stays native. The owned entry remains mounted and owns compatibility/service readiness, not a YAML snapshot.
    expect(member).toMatch(/- id: tool-executor-ptc\n\s+name: '@nelsonlongxiang\/dsh-open-a2a-net\/superagent-ptc'\n/)
    expect(member).not.toContain("!ctx.get(''ptcRuntime'')")
    expect(router).not.toContain('superagent-ptc')
    expect(member).toContain('a2a_ticket_report')
    expect(member).toContain('reasonable defaults for routine steps')
    expect(member).toContain("name: '@deepseek-ai/dsh-tool-fs'\n")
    // Both wait at most 5 s in the foreground, as upstream's executor: a long command moves to a background job, so a stop
    // notice or a person's answer is taken at the next step, and a job wait ends after 5 s too.
    for (const preset of [member]) {
      expect(preset).toMatch(/isolate:\n\s+shell: true/)
      expect(preset.match(/maxTimeoutMs: 5000/g)).toHaveLength(2)
      expect(preset).toMatch(/dsh-tool-jobs'\n\s+config:\n\s+waitTimeoutMs: 5000\n\s+maxWaitTimeoutMs: 5000/)
    }
  })

  it('a router or member on another preset is refused; an unloaded one (preset unknown) is not', async () => {
    const { presetRefusal } = await import('../../src/superagent/host/index.ts')
    const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-s': 'standard' }
    const of = (id: string) => presets[id]
    expect(presetRefusal('session-r', ['session-m'], of)).toBeUndefined()
    expect(presetRefusal('session-s', ['session-m'], of)).toContain('superagent-router')
    expect(presetRefusal('session-r', ['session-s'], of)).toContain('superagent-member')
    expect(presetRefusal('session-r', ['session-cold'], of)).toBeUndefined()
  })

  it('the host refuses such settings', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const of = (id: string) => ({ 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-s': 'standard' } as Record<string, string>)[id]
    // Design v5: the team is a canvas team; the host reads its sessions from the canvas (router first here).
    let local: string[] = []
    const h = new SuperagentHost({ home: mkdtempSync(join(tmpdir(), 'sa-presets-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, canvasTeam: name => name === 'team' ? { local, remote: [] } : undefined })
    cleanupBeforeTempDirs(() => h.stop())
    local = ['session-s', 'session-m']
    expect(h.saveSettings({ canvas: 'team', router: 'session-s' }, () => true, of)).toMatchObject({ ok: false, error: expect.stringContaining('superagent-router') })
    local = ['session-r', 'session-s']
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, of)).toMatchObject({ ok: false, error: expect.stringContaining('superagent-member') })
    local = ['session-r', 'session-m']
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, of)).toMatchObject({ ok: true })
    expect(h.serveTeam({ url: 'http://127.0.0.1:1', key: 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwxyz0123456789' }, ['session-s'], () => true, of)).toMatchObject({ ok: false })
    await h.stop()
  })
})
