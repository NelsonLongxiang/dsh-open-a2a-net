/**
 * superagent design v4, PR-D: the role tool lists (pinned) and how the host applies them.
 */
import { describe, expect, it } from 'vitest'
import { MEMBER_TOOLS, ROUTER_TOOLS, RoleTools, roleToolRefusal, type Role, type RoleAgent } from '../../src/superagent/host/role-tools.ts'

describe('role tool lists', () => {
  it('pins what the router and a member may call', () => {
    expect(ROUTER_TOOLS).toEqual(['superagent_route', 'superagent_read', 'superagent_reply', 'superagent_status'])
    expect(MEMBER_TOOLS).toEqual(['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill',
      'web_search', 'web_fetch', 'skill', 'todo_write', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_file_fetch'])
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

describe('RoleTools', () => {
  const setup = (roles: Record<string, Role>) => {
    const agents = new Map<string, RoleAgent>()
    const log: string[] = []
    const scoped = (id: string, known: string[]): RoleAgent => ({
      id,
      // The agent's scope key, under dsh-scope's symbol description, as on a host.
      ctx: { [Symbol('dsh.scope')]: {}, tools: { get: name => (known.includes(name) ? {} : undefined), restrict: f => { log.push(`${id} restrict ${f.allow.join(',')}`); return () => { log.push(`${id} lift`) } } } },
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
    expect(log.slice(3)).toEqual(['r lift'])
    expect(tools.list()).toEqual({})
  })

  it('a restriction the registry refuses is logged, never thrown into the agent\'s creation', () => {
    const warned: string[] = []
    const tools = new RoleTools({ roleOf: () => 'member', agentOf: () => undefined, logger: { warn: (f, ...a) => { warned.push([f, ...a].join(' ')) } } })
    tools.sync({ id: 'x', ctx: { [Symbol('dsh.scope')]: {}, tools: { get: () => ({}), restrict: () => { throw new Error('scope-local name') } } } as never })
    expect(warned.join()).toContain('not restricted')
    expect(tools.list()).toEqual({})
  })
})
