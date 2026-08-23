/**
 * Group-store unit tests: panel taxonomy bounds (trim, name length, group
 * cap), assignment lifecycle (auto-create, clear, cascade delete), and
 * whole-file persistence semantics (round-trip, orphaned-assignment
 * filtering, corrupt-file degradation).
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GROUP_CAP, GroupStore } from '../src/group-store.ts'

/** A fresh persistence path under a per-test directory. */
function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-groups-')), 'a2a', 'groups.json')
}

/** Pre-create the persistence directory so a hand-written snapshot lands. */
function seedFile(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

describe('GroupStore naming bounds', () => {
  it('creates a trimmed group name and keeps duplicates idempotent', () => {
    const store = new GroupStore('')
    expect(store.create('  ops  ')).toBe('ops')
    expect(store.create('ops')).toBe('ops')
    expect(store.list()).toEqual(['ops'])
  })

  it('rejects an empty or oversized name', () => {
    const store = new GroupStore('')
    expect(store.create('')).toBeUndefined()
    expect(store.create('   ')).toBeUndefined()
    expect(store.create('x'.repeat(41))).toBeUndefined()
    expect(store.list()).toEqual([])
  })

  it('bounds the taxonomy at GROUP_CAP groups, rejecting the next create', () => {
    const store = new GroupStore('')
    for (let index = 0; index < GROUP_CAP; index++) expect(store.create(`g-${String(index)}`)).toBeDefined()
    expect(store.list()).toHaveLength(GROUP_CAP)
    expect(store.create('one-too-many')).toBeUndefined()
    expect(store.list()).toHaveLength(GROUP_CAP)
  })
})

describe('GroupStore assignment lifecycle', () => {
  it('assigns a session, creating the group when new, and an empty name clears it', () => {
    const store = new GroupStore('')
    expect(store.assign('s1', 'ops')).toBe(true)
    expect(store.groupOf('s1')).toBe('ops')
    expect(store.list()).toEqual(['ops'])
    expect(store.assign('s1', '')).toBe(true)
    expect(store.groupOf('s1')).toBeUndefined()
    // An unassign of an unassigned session stays a quiet success.
    expect(store.assign('s1', '')).toBe(true)
  })

  it('fails the assignment when the group cannot be created', () => {
    const store = new GroupStore('')
    expect(store.assign('s1', 'x'.repeat(41))).toBe(false)
    expect(store.groupOf('s1')).toBeUndefined()
    expect(store.list()).toEqual([])
  })

  it('deletes a group and cascades the clear to its assignments', () => {
    const store = new GroupStore('')
    store.assign('s1', 'ops')
    store.assign('s2', 'ops')
    store.assign('s3', 'lab')
    expect(store.remove('ops')).toBe(true)
    expect(store.list()).toEqual(['lab'])
    expect(store.all()).toEqual({ s3: 'lab' })
    expect(store.remove('never-named')).toBe(false)
  })
})

describe('GroupStore persistence', () => {
  it('round-trips groups and assignments across instances', () => {
    const path = storePath()
    const store = new GroupStore(path)
    store.assign('s1', 'ops')
    store.assign('s2', 'lab')
    const reloaded = new GroupStore(path)
    expect(reloaded.list()).toEqual(['ops', 'lab'])
    expect(reloaded.groupOf('s1')).toBe('ops')
    expect(existsSync(path)).toBe(true)
  })

  it('drops on-disk assignments whose group no longer exists', () => {
    const path = storePath()
    seedFile(path, JSON.stringify({ groups: ['ops'], assignments: { s1: 'ops', s2: 'gone' } }))
    const reloaded = new GroupStore(path)
    expect(reloaded.list()).toEqual(['ops'])
    expect(reloaded.all()).toEqual({ s1: 'ops' })
  })

  it('degrades to empty groups when the persisted file is corrupt', () => {
    const path = storePath()
    seedFile(path, 'not json')
    const reloaded = new GroupStore(path)
    expect(reloaded.list()).toEqual([])
    expect(reloaded.all()).toEqual({})
  })
})
