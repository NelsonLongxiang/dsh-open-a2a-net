/**
 * Joined-store unit tests: join-intent set semantics (most-recent-first,
 * re-join reorders, quiet remove), the JOIN_CAP bound, and whole-file
 * persistence (round-trip, non-string filtering, corrupt degradation).
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JOIN_CAP, JoinedSessions } from '../src/joined-store.ts'

/** A fresh persistence path under a per-test directory. */
function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-joined-')), 'a2a', 'joined.json')
}

/** Pre-create the persistence directory so a hand-written snapshot lands. */
function seedFile(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

describe('JoinedSessions intent set', () => {
  it('remembers intents most-recent-first and moves a re-join to the front', () => {
    const store = new JoinedSessions('')
    store.add('agent-1')
    store.add('agent-2')
    expect(store.list()).toEqual(['agent-2', 'agent-1'])
    store.add('agent-1')
    expect(store.list()).toEqual(['agent-1', 'agent-2'])
    expect(store.has('agent-1')).toBe(true)
  })

  it('removes an intent and stays quiet for an unknown id', () => {
    const store = new JoinedSessions('')
    store.add('agent-1')
    store.remove('agent-1')
    store.remove('never-joined')
    expect(store.list()).toEqual([])
    expect(store.has('agent-1')).toBe(false)
  })

  it('bounds the intents at JOIN_CAP, evicting the oldest', () => {
    const store = new JoinedSessions('')
    for (let index = 0; index < JOIN_CAP + 5; index++) store.add(`agent-${String(index)}`)
    expect(store.list()).toHaveLength(JOIN_CAP)
    expect(store.list()[0]).toBe(`agent-${String(JOIN_CAP + 4)}`)
    expect(store.has('agent-0')).toBe(false)
  })
})

describe('JoinedSessions persistence', () => {
  it('round-trips intents across instances', () => {
    const path = storePath()
    const store = new JoinedSessions(path)
    store.add('agent-1')
    store.add('agent-2')
    const reloaded = new JoinedSessions(path)
    expect(reloaded.list()).toEqual(['agent-2', 'agent-1'])
    expect(existsSync(path)).toBe(true)
  })

  it('filters non-string and empty entries from the persisted snapshot', () => {
    const path = storePath()
    seedFile(path, JSON.stringify({ sessions: ['agent-1', '', 42, null, 'agent-2'] }))
    const reloaded = new JoinedSessions(path)
    expect(reloaded.list()).toEqual(['agent-1', 'agent-2'])
  })

  it('degrades to empty when the persisted file is corrupt', () => {
    const path = storePath()
    seedFile(path, 'not json')
    const reloaded = new JoinedSessions(path)
    expect(reloaded.list()).toEqual([])
  })
})
