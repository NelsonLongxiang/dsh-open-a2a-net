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
