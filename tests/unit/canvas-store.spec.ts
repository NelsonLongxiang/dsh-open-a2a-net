/**
 * CanvasStore unit tests: name validation, caps, member ordering (routing
 * priority), cross-team drop, and persistence round-trip — the same contract
 * family as group-store.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CanvasStore, CANVAS_MEMBER_CAP, CANVAS_TEAM_CAP, isRemoteMemberRef, validRemoteMemberRef } from '../../src/canvas-store.ts'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'a2a-canvas-')), 'a2a', 'canvas.json')
}

describe('CanvasStore', () => {
  it('creates teams with trimmed names; rejects empty, slash, overlong, and pure-digit names', () => {
    const store = new CanvasStore(tmpFile())
    expect(store.create('  alpha ')).toBe('alpha')
    expect(store.create('')).toBeUndefined()
    expect(store.create('   ')).toBeUndefined()
    expect(store.create('a/b')).toBeUndefined()
    expect(store.create('x'.repeat(41))).toBeUndefined()
    expect(store.create('123')).toBeUndefined()
    expect(store.hasTeam('alpha')).toBe(true)
  })

  it('enforces the team cap', () => {
    const store = new CanvasStore(tmpFile())
    for (let i = 0; i < CANVAS_TEAM_CAP; i++) expect(store.create(`team-${String.fromCharCode(97 + (i % 26))}${i}`)).toBeDefined()
    expect(store.create('one-too-many')).toBeUndefined()
  })

  it('keeps member order as routing priority; duplicates are idempotent', () => {
    const store = new CanvasStore(tmpFile())
    store.create('alpha')
    expect(store.addMember('alpha', 'session-bbb')).toBe(true)
    expect(store.addMember('alpha', 'session-aaa')).toBe(true)
    expect(store.addMember('alpha', 'session-aaa')).toBe(true)
    expect(store.membersOf('alpha')).toEqual(['session-bbb', 'session-aaa'])
    expect(store.addMember('alpha', '')).toBe(false)
    expect(store.addMember('missing', 'session-x')).toBe(false)
  })

  it('enforces the member cap', () => {
    const store = new CanvasStore(tmpFile())
    store.create('alpha')
    for (let i = 0; i < CANVAS_MEMBER_CAP; i++) expect(store.addMember('alpha', `session-${i}`)).toBe(true)
    expect(store.addMember('alpha', 'session-overflow')).toBe(false)
  })

  it('one id may sit in many teams; dropMember leaves every team', () => {
    const store = new CanvasStore(tmpFile())
    store.create('alpha')
    store.create('beta')
    store.addMember('alpha', 'session-a')
    store.addMember('beta', 'session-a')
    expect(store.teamsOf('session-a')).toEqual(['alpha', 'beta'])
    store.dropMember('session-a')
    expect(store.membersOf('alpha')).toEqual([])
    expect(store.membersOf('beta')).toEqual([])
    expect(store.teamsOf('session-a')).toEqual([])
  })

  it('removeMember removes from one team only; remove deletes the team', () => {
    const store = new CanvasStore(tmpFile())
    store.create('alpha')
    store.addMember('alpha', 'session-a')
    expect(store.removeMember('alpha', 'session-a')).toBe(true)
    expect(store.removeMember('alpha', 'session-a')).toBe(false)
    expect(store.remove('alpha')).toBe(true)
    expect(store.hasTeam('alpha')).toBe(false)
  })

  it('persists and restores teams with order intact', () => {
    const path = tmpFile()
    const first = new CanvasStore(path)
    first.create('alpha')
    first.create('beta')
    first.addMember('alpha', 'session-b')
    first.addMember('alpha', 'session-a')
    const second = new CanvasStore(path)
    expect(second.list()).toEqual(['alpha', 'beta'])
    expect(second.membersOf('alpha')).toEqual(['session-b', 'session-a'])
  })

  it('a corrupt snapshot degrades to empty, not a crash', () => {
    const path = tmpFile()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '{not json', 'utf8')
    const store = new CanvasStore(path)
    expect(store.list()).toEqual([])
    expect(store.create('fresh')).toBe('fresh')
  })

  it('restores clamp an oversized or malformed snapshot within caps', () => {
    const path = tmpFile()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify({
      teams: [
        { name: 'alpha', members: ['session-a', 7, '', 'session-b'] },
        { name: 'a/b', members: ['session-x'] },
        { name: 'alpha', members: ['session-dup'] },
        'garbage',
      ],
    }), 'utf8')
    const store = new CanvasStore(path)
    expect(store.list()).toEqual(['alpha'])
    expect(store.membersOf('alpha')).toEqual(['session-a', 'session-b'])
  })

  it('an empty path keeps the store memory-only without touching disk', () => {
    const store = new CanvasStore('')
    store.create('alpha')
    store.addMember('alpha', 'session-a')
    expect(store.membersOf('alpha')).toEqual(['session-a'])
  })

  it('remote member refs ride alongside local ids, order intact', () => {
    const store = new CanvasStore(tmpFile())
    store.create('alpha')
    expect(store.addMember('alpha', 'nel157/a1b2c3d4')).toBe(true)
    expect(store.addMember('alpha', 'session-aaa')).toBe(true)
    expect(store.addMember('alpha', 'other-node/import-deadbeef')).toBe(true)
    expect(store.membersOf('alpha')).toEqual(['nel157/a1b2c3d4', 'session-aaa', 'other-node/import-deadbeef'])
    expect(store.remoteMembersOf('alpha')).toEqual(['nel157/a1b2c3d4', 'other-node/import-deadbeef'])
    expect(store.teamsOf('nel157/a1b2c3d4')).toEqual(['alpha'])
  })

  it('isRemoteMemberRef: local ids never carry a slash, handles always do', () => {
    expect(isRemoteMemberRef('session-ec4ce7f8-a29a')).toBe(false)
    expect(isRemoteMemberRef('import-deadbeef')).toBe(false)
    expect(isRemoteMemberRef('nel157/a1b2c3d4')).toBe(true)
    expect(isRemoteMemberRef('dsh/canvas/deep')).toBe(true)
  })

  it('validRemoteMemberRef gates shape: needs segments, no whitespace, no edge or doubled slashes', () => {
    expect(validRemoteMemberRef('nel157/a1b2c3d4')).toBe(true)
    expect(validRemoteMemberRef('z/a/b')).toBe(true)
    expect(validRemoteMemberRef('/a1b2c3d4')).toBe(false)
    expect(validRemoteMemberRef('nel157/')).toBe(false)
    expect(validRemoteMemberRef('nel157//a1')).toBe(false)
    expect(validRemoteMemberRef('nel 157/a1')).toBe(false)
    expect(validRemoteMemberRef(' nel157/a1')).toBe(false)
    expect(validRemoteMemberRef('session-plain')).toBe(false)
  })

  it('remote refs persist and restore verbatim alongside local ids', () => {
    const path = tmpFile()
    const first = new CanvasStore(path)
    first.create('alpha')
    first.addMember('alpha', 'nel157/a1b2c3d4')
    first.addMember('alpha', 'session-b')
    const second = new CanvasStore(path)
    expect(second.membersOf('alpha')).toEqual(['nel157/a1b2c3d4', 'session-b'])
    expect(second.remoteMembersOf('alpha')).toEqual(['nel157/a1b2c3d4'])
  })

  it('removeMember drops a remote ref like a local id; dropMember purges refs from every team', () => {
    const store = new CanvasStore(tmpFile())
    store.create('alpha')
    store.create('beta')
    store.addMember('alpha', 'nel157/a1b2c3d4')
    store.addMember('beta', 'nel157/a1b2c3d4')
    expect(store.removeMember('alpha', 'nel157/a1b2c3d4')).toBe(true)
    expect(store.membersOf('alpha')).toEqual([])
    expect(store.membersOf('beta')).toEqual(['nel157/a1b2c3d4'])
    store.dropMember('nel157/a1b2c3d4')
    expect(store.membersOf('beta')).toEqual([])
  })
})
