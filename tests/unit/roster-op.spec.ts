import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamMembershipStore } from '../../src/team-store.ts'
import { rosterOp, type RosterOpDeps } from '../../src/roster-op.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'a2a-roster-op-'))
  const store = new TeamMembershipStore(join(home, 'a2a', 'teams.json'))
  let allowlist: string[] = []
  const joined = new Set(['session-a', 'session-b'])
  const audit: Array<{ action: string; team: string; id: string; ok: boolean; reason: string }> = []
  const deps: RosterOpDeps = {
    zone: 'dsh', home, store, joined: id => joined.has(id), canvasExists: name => name === 'canvas',
    allowlist: () => allowlist, setAllowlist: list => { allowlist = list },
    audit: (action, team, id, ok, reason) => { audit.push({ action, team, id, ok, reason }) },
  }
  return { home, store, joined, audit, deps, allowlist: () => allowlist }
}

describe('#199 owner roster operation', () => {
  it('creates an exact name and two declarations; joins/leaves and dissolution share teams.json and audit', () => {
    const m = fixture()
    expect(rosterOp(m.deps, { op: 'create', name: '生产服务组', ids: ['session-a', 'session-b'] })).toEqual({ ok: true, team: 'dsh/生产服务组', members: ['session-a', 'session-b'] })
    expect(m.allowlist()).toEqual(['dsh/生产服务组'])
    expect(readFileSync(join(m.home, 'cordis.patch.yml'), 'utf8')).toContain('dsh/生产服务组')
    expect(new TeamMembershipStore(join(m.home, 'a2a', 'teams.json')).membersOf('dsh/生产服务组')).toEqual(['session-a', 'session-b'])
    m.joined.add('session-c')
    expect(rosterOp(m.deps, { op: 'add-member', name: '生产服务组', id: 'session-c' })).toMatchObject({ ok: true, members: ['session-a', 'session-b', 'session-c'] })
    expect(rosterOp(m.deps, { op: 'remove-member', name: '生产服务组', id: 'session-b' })).toMatchObject({ ok: true, members: ['session-a', 'session-c'] })
    expect(rosterOp(m.deps, { op: 'dissolve', name: '生产服务组' })).toMatchObject({ ok: true, members: [] })
    expect(m.store.membersOf('dsh/生产服务组')).toEqual([])
    expect(m.allowlist()).toEqual([])
    expect(readFileSync(join(m.home, 'cordis.patch.yml'), 'utf8')).not.toContain('dsh/生产服务组')
    expect(m.audit.every(row => row.ok)).toBe(true)
    expect(m.audit.some(row => row.id === 'human:owner' && row.reason.includes('dissolved'))).toBe(true)
  })

  it('refuses remote/unjoined ids, duplicate canvas names, canvas paths and invalid body without touching persistence', () => {
    const m = fixture()
    for (const body of [
      { op: 'create', name: 'canvas', ids: ['session-a', 'session-b'] },
      { op: 'create', name: 'dsh/canvas/生产服务组', ids: ['session-a', 'session-b'] },
      { op: 'create', name: '123', ids: ['session-a', 'session-b'] },
      { op: 'create', name: 'roster:伪造', ids: ['session-a', 'session-b'] },
      { op: 'create', name: '生产服务组', ids: ['session-a', 'remote/abc'] },
      { op: 'create', name: '生产服务组', ids: ['session-a', 'session-a'] },
      { op: 'create', name: '生产服务组', ids: ['session-a'] },
      null,
    ]) expect(rosterOp(m.deps, body).ok).toBe(false)
    expect(m.store.list()).toEqual([])
    expect(m.allowlist()).toEqual([])
    expect(existsSync(join(m.home, 'cordis.patch.yml'))).toBe(false)
    expect(m.audit.every(row => !row.ok)).toBe(true)
  })

  it('rolls back allowlist when teams.json cannot be persisted, without changing in-memory roster', () => {
    const m = fixture()
    writeFileSync(join(m.home, 'a2a'), 'not a directory')
    const result = rosterOp(m.deps, { op: 'create', name: '生产服务组', ids: ['session-a', 'session-b'] })
    expect(result.ok).toBe(false)
    expect(m.allowlist()).toEqual([])
    expect(existsSync(join(m.home, 'cordis.patch.yml'))).toBe(false)
    expect(m.store.list()).toEqual([])
  })
})
