// @vitest-environment jsdom
/**
 * Design v5 (D6): the planning view marks the superagent team's canvas and its roles — the bound frame says
 * `superagent 团队`, the router's card 总工, each member's card 成员 (and its repository). Unbinding takes the marks away.
 */
import { describe, expect, it } from 'vitest'
import { createTeamRoleDecorator, roleLabel, roleText, teamRolesOf } from '../src/planning-team-roles.ts'
import { createCardElement } from '../src/planning-card.ts'
import type { SaState } from '../src/wb-superagent.ts'

const R = 'session-a0000000aaaa1111', M = 'session-b1111111bbbb2222', O = 'session-c2222222cccc3333'
const state = (settings: Record<string, unknown>): SaState => ({ settings: { members: [], remoteMembers: [], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, ...settings } } as unknown as SaState)
const frame = (name: string): HTMLElement => {
  const el = document.createElement('div'); el.className = 'p-frame'; el.dataset.name = name
  const head = document.createElement('div'); head.className = 'p-frame-head'; el.appendChild(head)
  return el
}

describe('planning view: the superagent team canvas and its roles', () => {
  it('reads the roles from the team state', () => {
    expect(teamRolesOf(null)).toBeUndefined()
    expect(teamRolesOf(state({ router: R, members: [M] }))).toBeUndefined() // unbound
    const roles = teamRolesOf(state({ canvas: 'ops', router: R, members: [M], repos: { [M]: 'o/net' } }))!
    expect(roleText(roles, R)).toBe('总工')
    expect(roleText(roles, M)).toBe('成员 · o/net')
    expect(roleText(roles, O)).toBeUndefined()
    // A member on another host: its planning card id is derived from the canvas ref.
    const withRemote = teamRolesOf(state({ canvas: 'ops', router: R, members: [M], remoteMembers: [{ ref: 'dsh/3a0d2c35@46744199', key: 'k', url: 'u' }], repos: { 'dsh/3a0d2c35@46744199': 'acceptance/c5' } }))!
    expect(roleText(withRemote, 'member-dsh-3a0d2c35-46744199')).toBe('成员 · acceptance/c5（远端）')
    const noRepo = teamRolesOf(state({ canvas: 'ops', remoteMembers: [{ ref: 'dsh/3a0d2c35@46744199', key: 'k', url: 'u' }] }))!
    expect(roleText(noRepo, 'member-dsh-3a0d2c35-46744199')).toBe('成员（远端）')
  })

  it('the badge drops the owner of a repository; its tooltip has the whole of it', () => {
    expect(roleLabel('总工')).toBe('总工')
    expect(roleLabel('成员')).toBe('成员')
    expect(roleLabel('成员 · o/net')).toBe('成员 · net')
    expect(roleLabel('成员 · acceptance/c5（远端）')).toBe('成员 · c5（远端）')
    expect(roleLabel('成员（远端）')).toBe('成员（远端）')
    const card = createCardElement(M)
    const d = createTeamRoleDecorator()
    d.decorate(new Map(), new Map([[M, card]]))
    d.update(state({ canvas: 'ops', members: [M], repos: { [M]: 'o/net' } }))
    const badge = card.querySelector<HTMLElement>(':scope > .sa-role')!
    expect(badge.textContent).toBe('成员 · net')
    expect(badge.title).toBe('成员 · o/net')
    expect(card.querySelector('.nm .sa-role')).toBeNull()
  })

  it('a member\'s tooltip carries its role and enabled rules, once', () => {
    const card = createCardElement(M); card.title = '原提示'
    const d = createTeamRoleDecorator()
    d.decorate(new Map(), new Map([[M, card]]))
    d.update(state({ canvas: 'ops', members: [M], profiles: { [M]: { role: '写文档', rules: [{ name: 'a', text: '接文档', enabled: true }, { name: 'b', text: '停用的', enabled: false }] } } }))
    d.decorate(new Map(), new Map([[M, card]]))
    expect(card.title).toBe('原提示\n角色：写文档\n规则 a：接文档')
  })

  it('marks the bound frame and the role cards, follows the state, and takes the marks away when unbound', () => {
    const frames = new Map([['ops', frame('ops')], ['other', frame('other')]])
    const nodes = new Map([[R, createCardElement(R)], [M, createCardElement(M)], [O, createCardElement(O)]])
    const d = createTeamRoleDecorator()
    d.decorate(frames, nodes)
    expect(document.body.contains(frames.get('ops')!)).toBe(false) // detached elements are fine: the decorator only marks
    d.update(state({ canvas: 'ops', router: R, members: [M] }))
    expect(frames.get('ops')!.classList.contains('is-superagent-team')).toBe(true)
    expect(frames.get('ops')!.querySelector('.p-frame-head .sa-team')?.textContent).toBe('superagent 团队')
    expect(frames.get('other')!.querySelector('.sa-team')).toBeNull()
    expect(nodes.get(R)!.querySelector(':scope > .sa-role')?.textContent).toBe('总工')
    expect(nodes.get(R)!.classList.contains('is-superagent-router')).toBe(true)
    expect(nodes.get(M)!.querySelector(':scope > .sa-role')?.textContent).toBe('成员')
    expect(nodes.get(O)!.querySelector('.sa-role')).toBeNull()
    // A re-render hands the same elements again: one badge each, not two.
    d.decorate(frames, nodes)
    expect(nodes.get(R)!.querySelectorAll('.sa-role')).toHaveLength(1)
    expect(frames.get('ops')!.querySelectorAll('.sa-team')).toHaveLength(1)
    // The owner rebinds the team to another canvas: the marks move.
    d.update(state({ canvas: 'other', router: R, members: [] }))
    expect(frames.get('ops')!.querySelector('.sa-team')).toBeNull()
    expect(frames.get('ops')!.classList.contains('is-superagent-team')).toBe(false)
    expect(frames.get('other')!.querySelector('.sa-team')).not.toBeNull()
    expect(nodes.get(M)!.querySelector('.sa-role')).toBeNull()
    // No team on this host: no marks at all.
    d.update(null)
    expect(document.createElement('div').querySelector('.sa-team')).toBeNull()
    for (const el of [...frames.values(), ...nodes.values()]) expect(el.querySelector('.sa-team, .sa-role')).toBeNull()
  })
})
