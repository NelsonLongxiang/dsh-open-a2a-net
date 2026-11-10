// @vitest-environment node
/** Router, member and observer sessions schedule for themselves, never for a new session (owner 2026-11-10). */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MEMBER_TOOLS, OBSERVER_TOOLS, ROUTER_TOOLS, SCHEDULE_TOOLS, TEAM_TOOLS, roleToolRefusal } from '../../src/superagent/host/role-tools.ts'

describe('schedule tools for team sessions', () => {
  it('every role has the four, and a session outside the team is not affected', () => {
    for (const list of [ROUTER_TOOLS, MEMBER_TOOLS, OBSERVER_TOOLS]) for (const name of SCHEDULE_TOOLS) expect(list).toContain(name)
    for (const name of SCHEDULE_TOOLS) expect(TEAM_TOOLS).not.toContain(name)
  })
  it('create only for this_session, in every role', () => {
    for (const role of ['router', 'member', 'observer'] as const) {
      expect(roleToolRefusal(role, 'schedule_create', { target: 'this_session' })).toBeUndefined()
      expect(roleToolRefusal(role, 'schedule_create', { target: 'new_once' })).toContain('this_session')
      expect(roleToolRefusal(role, 'schedule_create', { target: 'new' })).toContain('this_session')
      expect(roleToolRefusal(role, 'schedule_create', {})).toContain('this_session')
    }
  })
  it('an edit keeps or names this_session; list and view need nothing', () => {
    expect(roleToolRefusal('member', 'schedule_edit', { id: 'x', action: 'update', prompt: 'p' })).toBeUndefined()
    expect(roleToolRefusal('member', 'schedule_edit', { id: 'x', action: 'update', target: 'this_session' })).toBeUndefined()
    expect(roleToolRefusal('member', 'schedule_edit', { id: 'x', action: 'update', target: 'new' })).toContain('this_session')
    expect(roleToolRefusal('router', 'schedule_edit', { id: 'x', action: 'delete' })).toBeUndefined()
    expect(roleToolRefusal('router', 'schedule_list', {})).toBeUndefined()
    expect(roleToolRefusal('observer', 'schedule_view', { id: 'x' })).toBeUndefined()
  })
  it('the three presets mount the schedule tool', () => {
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    for (const id of ['superagent-router', 'superagent-member', 'superagent-observer']) {
      const start = layer.indexOf(`        id: ${id}\n`), next = layer.indexOf('\n    - id: ', start)
      expect(layer.slice(start, next < 0 ? undefined : next)).toContain("name: '@deepseek-ai/dsh-tool-schedule'")
    }
  })
})

describe('reading where work stands', () => {
  it('every role may ask who it is; members and observers may read tickets; a session outside the team is not offered the read', async () => {
    for (const role of ['router', 'member', 'observer'] as const) expect(roleToolRefusal(role, 'a2a_whoami', {})).toBeUndefined()
    expect(roleToolRefusal('member', 'a2a_ticket_read', { kind: 'mine' })).toBeUndefined()
    expect(roleToolRefusal('router', 'a2a_ticket_read', { kind: 'mine' })).toContain('a2a_ticket_read')
    expect(TEAM_TOOLS).toContain('a2a_ticket_read')
    expect(TEAM_TOOLS).not.toContain('a2a_whoami')
  })
})

describe('ygl-trees in the team presets', () => {
  it('every team preset mounts the ygl-trees MCP server and names it as the team memory; the router only reads; nobody installs it', async () => {
    const { readFileSync } = await import('node:fs')
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const preset = (id: string) => layer.slice(layer.indexOf(`- id: ${id}-preset`)).split(/\n    - id: superagent-/)[0]!
    for (const id of ['superagent-router', 'superagent-member', 'superagent-observer']) {
      const text = preset(id)
      expect(text).toContain("name: '@deepseek-ai/dsh-mcp-client'")
      expect(text).toContain('serverName: ygl')
      expect(text).toContain('transport: stdio')
      expect(text).toContain('YGL_SESSION="superagent-$$" exec ygl-trees mcp')
      expect(text).toContain('- id: mcp-ygl-win')
      expect(text.match(/disabled: !!js process.platform [!=]== 'win32'/g)?.length).toBeGreaterThanOrEqual(2)
      expect(text).toContain('YGL_HOME: !!js process.env.SUPERAGENT_YGL_HOME ??')
      expect(text).toContain("ygl-trees is the team's memory")
      expect(text).toMatch(/do not install anything/)
    }
    expect(preset('superagent-router')).toContain('You only read ygl-trees')
    expect(preset('superagent-router')).not.toContain('mcp__ygl__write')
    for (const id of ['superagent-member', 'superagent-observer']) expect(preset(id)).toContain('mcp__ygl__write')
  })
  it('the router may only read ygl-trees; members and observers may read, write, verify and check it', () => {
    expect(roleToolRefusal('router', 'mcp__ygl__read', {})).toBeUndefined()
    for (const name of ['mcp__ygl__write', 'mcp__ygl__verify', 'mcp__ygl__doctor']) {
      expect(roleToolRefusal('router', name, {})).toBeDefined()
      for (const role of ['member', 'observer'] as const) expect(roleToolRefusal(role, name, {})).toBeUndefined()
    }
    expect(TEAM_TOOLS.some(name => name.startsWith('mcp__ygl__'))).toBe(false)
  })
})
