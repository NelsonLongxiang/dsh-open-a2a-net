// @vitest-environment node
/**
 * docs/design/superagent-builder.md BS1 (TB1, TB2, TB5): the team builder reads and advises. Its guard list, an inventory that
 * never carries #626 W3's fields, rule templates distilled from running teams, and a preset with no shell and no writes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { orgInventory, type InventoryTeam } from '../../src/superagent/host/builder-tools.ts'
import { BUILDER_PRESET, BUILDER_TOOLS, memberBoundary, roleToolRefusal } from '../../src/superagent/host/role-tools.ts'
import { RULE_TEMPLATES } from '../../src/superagent/host/rule-templates.ts'

const R = 'session-r0000000', M = 'session-m0000000', O = 'session-o0000000', FREE = 'session-f0000000'

describe('the builder\'s guard', () => {
  it('reads and proposes only: its list, nothing that writes or leaves', () => {
    for (const name of ['superagent_org_read', 'superagent_rule_templates', 'read', 'glob', 'grep', 'a2a_whoami']) expect(roleToolRefusal('builder', name), name).toBeUndefined()
    for (const name of ['bash', 'write', 'edit', 'a2a_route', 'subagent', 'superagent_route', 'a2a_ticket_report', 'mcp__ygl__write', 'web_fetch']) expect(roleToolRefusal('builder', name), name).toMatch(/team builder only reads/)
    expect(BUILDER_TOOLS).not.toContain('bash')
  })

  it('its tools are no other role\'s: a member and the router are refused them', () => {
    expect(memberBoundary('member', 'superagent_org_read')).toBe(true)
    expect(roleToolRefusal('router', 'superagent_rule_templates')).toMatch(/router acts only/)
  })
})

describe('the inventory', () => {
  const team: InventoryTeam = {
    ref: 't-1',
    settings: {
      canvas: 'docs', router: R, members: [M, O], observers: [O],
      rules: [{ name: 'take-docs', text: '接文档请求', enabled: true }], dispatch: '按仓库派单',
      profiles: { [M]: { role: '写文档', rules: [{ name: 'own-repo', text: '只接 acme/docs' }] } },
      repos: { [M]: 'acme/docs' }, acceptMode: 'auto',
      // W3 fields the host's settings carry; the inventory must never show them.
      ...({ bots: { a2a: ['market/0123456789abcdef'] }, allowed: { workbench: ['owner'], a2a: ['x/0123456789abcdef'], github: ['someone'] }, mcp: [{ name: 'market', url: 'http://127.0.0.1:9890/mcp' }], prepare: { command: '/Users/secret/prep.sh', timeoutMs: 1 }, extraTools: { member: ['bash'] }, blockedTools: ['web_fetch'], github: { repos: ['acme/docs'] }, approvers: [M] } as object),
    } as never,
    revisions: { team: 3, dispatch: 1, [`member:${M}`]: 2 },
    seatOf: session => session === M ? 'seat-0000abcd' : undefined,
    children: [{ ref: 'ext/canvas/sales@0a1b2c3d', slots: 2 }],
  }
  const out = orgInventory({ teams: [team], sessions: [R, M, O, FREE], nameOf: id => `name-${id.slice(8, 9)}`, presetOf: id => id === FREE ? 'superagent-member' : undefined,
    staffing: [{ id: 'bp-1', state: 'done', source: 'owner-local', at: '2026-11-13T00:00:00Z', summary: '建队', ops: [{ op: 'team.create' }] }] })

  it('has what a builder needs: members by seat, roles and rules with revisions, root children, candidates, the ledger', () => {
    const teams = out.teams as Array<Record<string, unknown>>
    expect(teams[0]).toMatchObject({ team: 't-1', canvas: 'docs', router: { session: R }, acceptMode: 'auto', root: { children: [{ ref: 'ext/canvas/sales@0a1b2c3d', slots: 2 }] },
      rules: { team: [{ name: 'take-docs' }], teamRevision: 3, dispatch: '按仓库派单', dispatchRevision: 1 } })
    expect(teams[0]!.members).toEqual([
      { seatId: 'seat-0000abcd', session: M, name: 'name-m', preset: null, kind: 'member', role: '写文档', rules: [{ name: 'own-repo', text: '只接 acme/docs', enabled: true }], revision: 2, repo: 'acme/docs' },
      { session: O, name: 'name-o', preset: null, kind: 'observer', rules: [], revision: 0 },
    ])
    expect(out.candidates).toEqual([{ session: FREE, name: 'name-f', preset: 'superagent-member' }])
    expect(out.staffing).toEqual([{ id: 'bp-1', state: 'done', source: 'owner-local', at: '2026-11-13T00:00:00Z', summary: '建队', ops: ['team.create'] }])
  })

  it('never shows a W3 field: bots, allow-lists, MCP, tool grants or blocks, GitHub, approvers, commands or paths', () => {
    // The note names the kinds it leaves out; the data itself must carry none of them.
    const { note: _note, ...data } = out
    const text = JSON.stringify(data)
    for (const leak of ['bots', 'allowed', 'mcp', '9890', 'prepare', '/Users/secret', 'extraTools', 'blockedTools', 'github', 'approvers', 'someone', 'market/0123456789abcdef']) expect(text, leak).not.toContain(leak)
  })
})

describe('the rule templates', () => {
  it('cover the three rule sets, each says where it comes from, and none asks a session to parse a header', () => {
    expect(new Set(RULE_TEMPLATES.map(t => t.scope))).toEqual(new Set(['team', 'dispatch', 'member']))
    for (const t of RULE_TEMPLATES) {
      expect(t.source, t.id).not.toBe('')
      expect(t.scope === 'dispatch' ? typeof t.text : t.rules?.length, t.id).toBeTruthy()
      expect(JSON.stringify(t), t.id).not.toContain('[A2A dispatch]')
    }
  })
})

describe('the preset', () => {
  it('is shipped with no shell, no writes and no ygl-trees', () => {
    const yml = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const start = yml.indexOf(`id: ${BUILDER_PRESET}\n`)
    expect(start).toBeGreaterThan(0)
    const block = yml.slice(start)
    expect(block).toContain('write: false')
    expect(block).toContain('edit: false')
    for (const absent of ['dsh-tool-bash', 'dsh-tool-pwsh', 'mcp-ygl', 'dsh-tool-web', 'dsh-tool-jobs']) expect(block, absent).not.toContain(absent)
  })
})
