// @vitest-environment node
/** ygl single tool, option A: the router's mcp__ygl__trees is narrowed to help and the old read routes; members are not. */
import { describe, expect, it } from 'vitest'
import { yglCardLines } from '../../src/superagent/host/cards.ts'
import { roleToolRefusal, roleTools, YGL_TREES, YGL_TREES_READ_ROUTES } from '../../src/superagent/host/role-tools.ts'

describe('mcp__ygl__trees by role', () => {
  it('every role keeps the old four names for the transition and has trees', () => {
    expect(roleTools('router')).toEqual(expect.arrayContaining(['mcp__ygl__read', YGL_TREES]))
    expect(roleTools('router')).not.toContain('mcp__ygl__write')
    for (const role of ['member', 'observer'] as const) expect(roleTools(role)).toEqual(expect.arrayContaining(['mcp__ygl__read', 'mcp__ygl__write', 'mcp__ygl__verify', 'mcp__ygl__doctor', YGL_TREES]))
  })
  it('the router may call help and every old read route', () => {
    expect(roleToolRefusal('router', YGL_TREES, { action: 'help' })).toBeUndefined()
    expect(roleToolRefusal('router', YGL_TREES, { domain: 'kb', action: 'help' })).toBeUndefined()
    for (const [domain, actions] of Object.entries(YGL_TREES_READ_ROUTES)) for (const action of actions)
      expect(roleToolRefusal('router', YGL_TREES, { domain, action, params: {} }), domain + '/' + action).toBeUndefined()
  })
  it('the router is refused writes, verify, doctor, unknown routes and malformed calls', () => {
    for (const call of [{ domain: 'kb', action: 'add' }, { domain: 'task', action: 'advance' }, { domain: 'produce', action: 'export' }, { domain: 'verify', action: 'run' }, { domain: 'verify', action: 'report' }, { domain: 'doctor', action: 'check' }, { domain: 'doctor', action: 'fix' }, { domain: 'kb', action: 'nope' }, { domain: 'constructor', action: 'list' }, { action: 'list' }, {}, null, 'kb'])
      expect(roleToolRefusal('router', YGL_TREES, call), JSON.stringify(call)).toMatch(/only reads the team's memory/)
  })
  it('members and observers are not narrowed', () => {
    for (const role of ['member', 'observer'] as const) {
      expect(roleToolRefusal(role, YGL_TREES, { domain: 'kb', action: 'add' })).toBeUndefined()
      expect(roleToolRefusal(role, YGL_TREES, { domain: 'doctor', action: 'fix' })).toBeUndefined()
    }
  })
})

describe('assignment card wording', () => {
  it('without trees the card is unchanged; with it every step names mcp__ygl__trees and says where the arguments go', () => {
    const caps = { briefHonorsProject: true, kbScope: true } as never
    const legacy = yglCardLines('p', { scope: 'bench:x', caps })
    expect(yglCardLines('p', { scope: 'bench:x', caps, trees: false })).toEqual(legacy)
    const trees = yglCardLines('p', { scope: 'bench:x', caps, trees: true })
    expect(trees).toHaveLength(legacy.length + 1)
    expect(trees.join('\n')).not.toMatch(/mcp__ygl__(read|write)\b/)
    expect(trees[1]).toMatch(/inside params/)
    expect(trees.slice(2).join('\n')).toBe(legacy.slice(1).join('\n').replace(/mcp__ygl__(read|write)\b/g, 'mcp__ygl__trees'))
  })
})
