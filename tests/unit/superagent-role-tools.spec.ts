/**
 * superagent design v4, PR-D: the role tool lists (pinned) and how the host applies them.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../../src/config.ts'
import { MEMBER_TOOLS, ROUTER_TOOLS, RoleTools, TEAM_TOOLS, roleToolRefusal, type Role, type RoleAgent } from '../../src/superagent/host/role-tools.ts'

describe('role tool lists', () => {
  it('the team\'s own tools are the router\'s and the member\'s ticket tools', () => {
    expect(TEAM_TOOLS).toEqual([...ROUTER_TOOLS.filter(name => !name.startsWith('schedule_') && name !== 'a2a_whoami' && !name.startsWith('mcp__ygl__')), 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_ticket_request', 'a2a_decision_propose'])
    for (const name of ['a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback']) expect(MEMBER_TOOLS).toContain(name)
  })

  it('pins what the router and a member may call', () => {
    expect(ROUTER_TOOLS).toEqual(['schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view', 'a2a_whoami', 'mcp__ygl__read', 'superagent_route', 'superagent_read', 'superagent_reply', 'superagent_status', 'superagent_note', 'superagent_request', 'superagent_assign', 'superagent_rules_propose', 'superagent_rules_apply', 'superagent_decision_propose'])
    expect(MEMBER_TOOLS).toEqual(['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill',
      'web_search', 'web_fetch', 'skill', 'todo_write', 'schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view', 'a2a_whoami', 'mcp__ygl__read', 'mcp__ygl__write', 'mcp__ygl__verify', 'mcp__ygl__doctor', 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_file_fetch'])
  })

  it('no role may open or reach sessions, or route or report over A2A', () => {
    const sideChannels = ['subagent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent', 'a2a_route', 'a2a_report', 'a2a_teams',
      'a2a_tasks', 'a2a_file_send', 'a2a_team_join', 'a2a_exposure', 'ask_user', 'schedule']
    for (const role of ['router', 'member'] as const) for (const name of sideChannels) expect(roleToolRefusal(role, name), `${role} ${name}`).toContain('[superagent-role-tools]')
    expect(roleToolRefusal('router', 'bash')).toBeDefined()
    expect(roleToolRefusal('router', 'a2a_ticket_report')).toBeDefined()
    expect(roleToolRefusal('member', 'superagent_route')).toBeDefined()
    // The runtime's transport is not a capability: each call it makes is guarded on its own.
    expect(roleToolRefusal('router', 'run_code')).toBeUndefined()
    expect(roleToolRefusal('member', 'run_code')).toBeUndefined()
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
    const r = scoped('r', ['superagent_route', 'superagent_status', 'bash', 'a2a_route'])
    tools.sync(r)
    tools.sync(r)
    expect(log).toEqual(['r restrict superagent_route,superagent_status'])
    roles.r = 'member'
    tools.sync(r)
    expect(log.slice(1)).toEqual(['r lift', 'r restrict bash'])
    delete roles.r
    tools.sync(r)
    expect(log.slice(3)).toEqual(['r lift', 'r deny superagent_route,superagent_status'])
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
    expect(log.slice(1)).toEqual(['p lift', `p restrict ${ROUTER_TOOLS.filter(name => !name.startsWith('schedule_') && name !== 'a2a_whoami' && !name.startsWith('mcp__')).join(',')}`])
    expect(tools.list()).toEqual({ p: 'router' })
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
    expect(member).not.toContain('a2a_ticket_request')
    expect(observer).not.toContain('dsh-tool-subagent')
  })

  it('the bundle layer declares the router and member presets the host names', async () => {
    const { readFileSync } = await import('node:fs')
    const { ROUTER_PRESET, MEMBER_PRESET } = await import('../../src/superagent/host/role-tools.ts')
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const block = (id: string): string => { const start = layer.indexOf(`        id: ${id}\n`); expect(start).toBeGreaterThan(0); const next = layer.indexOf('\n    - id: ', start); return layer.slice(start, next < 0 ? undefined : next) }
    const router = block(ROUTER_PRESET), member = block(MEMBER_PRESET)
    // The role lives in the composition: a persona each; the router reads only and waits at most 5 s; no subagents anywhere.
    for (const preset of [router, member]) { expect(preset).toContain("name: '@deepseek-ai/dsh-persona'"); expect(preset).not.toContain('dsh-tool-subagent') }
    expect(router).toMatch(/dsh-tool-fs'\n\s+config:\n\s+write: false\n\s+edit: false/)
    expect(router).toContain('superagent_route')
    expect(member).toContain('a2a_ticket_report')
    expect(member).toContain('reasonable defaults for routine steps')
    expect(member).toContain("name: '@deepseek-ai/dsh-tool-fs'\n")
    // Both wait at most 5 s in the foreground, as upstream's executor: a long command moves to a background job, so a stop
    // notice or a person's answer is taken at the next step, and a job wait ends after 5 s too.
    for (const preset of [router, member]) {
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
    const { mkdtempSync } = await import('../temp-dirs.ts')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const of = (id: string) => ({ 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-s': 'standard' } as Record<string, string>)[id]
    // Design v5: the team is a canvas team; the host reads its sessions from the canvas (router first here).
    let local: string[] = []
    const h = new SuperagentHost({ home: mkdtempSync(join(tmpdir(), 'sa-presets-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, canvasTeam: name => name === 'team' ? { local, remote: [] } : undefined })
    local = ['session-s', 'session-m']
    expect(h.saveSettings({ canvas: 'team', router: 'session-s' }, () => true, of)).toMatchObject({ ok: false, error: expect.stringContaining('superagent-router') })
    local = ['session-r', 'session-s']
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, of)).toMatchObject({ ok: false, error: expect.stringContaining('superagent-member') })
    local = ['session-r', 'session-m']
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, of)).toMatchObject({ ok: true })
    expect(h.serveTeam({ url: 'http://127.0.0.1:1', key: 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwxyz0123456789' }, ['session-s'], () => true, of)).toMatchObject({ ok: false })
  })
})
