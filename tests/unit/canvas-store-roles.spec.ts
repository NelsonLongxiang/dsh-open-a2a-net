/**
 * v3.1 PR-1: role canvas persistence. A router turns the snapshot into formatVersion 3 so a plugin
 * that predates roles reads it as unsupported (read-only, no canvases) instead of dropping the rules.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { CanvasStore, CANVAS_ROLE_FORMAT } from '../../src/canvas-store.ts'

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'a2a-canvas-roles-')), 'a2a', 'canvas.json')
const disk = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8'))

describe('CanvasStore roles', () => {
  it('setRouter needs an existing canvas and a current member; v3 on disk only while a router exists', () => {
    const path = tmpFile()
    const store = new CanvasStore(path)
    store.create('crew')
    store.addMember('crew', 'session-r1')
    store.addMember('crew', 'session-m1')
    expect(disk(path).formatVersion).toBe(2)
    expect(store.setRouter('nope', 'session-r1')).toMatchObject({ ok: false })
    expect(store.setRouter('crew', 'session-x')).toMatchObject({ ok: false })
    expect(store.setRouter('crew', 'session-r1')).toEqual({ ok: true })
    expect(store.routerOf('crew')).toBe('session-r1')
    expect(disk(path)).toMatchObject({ formatVersion: CANVAS_ROLE_FORMAT, routers: { crew: 'session-r1' } })
    // Restart keeps the role.
    expect(new CanvasStore(path).routerEntries()).toEqual([['crew', 'session-r1']])
    // Clearing goes back to v2 with no routers key.
    expect(store.setRouter('crew', undefined)).toEqual({ ok: true })
    expect(disk(path).formatVersion).toBe(2)
    expect(disk(path).routers).toBeUndefined()
  })

  it('removing the canvas removes its role; a member removal keeps the canvas a role canvas (fail closed)', () => {
    const store = new CanvasStore(tmpFile())
    store.create('crew'); store.addMember('crew', 'session-r1'); store.addMember('crew', 'session-m1')
    store.setRouter('crew', 'session-r1')
    store.removeMember('crew', 'session-r1')
    expect(store.routerOf('crew')).toBe('session-r1')
    expect(store.remove('crew')).toBe(true)
    expect(store.routerEntries()).toEqual([])
  })

  it('a malformed v3 or a v2 file carrying routers goes read-only instead of losing roles', () => {
    for (const snapshot of [
      { formatVersion: 3, revision: 1, suspendedMembers: [], teams: [{ name: 'crew', members: ['session-r1'] }] },
      { formatVersion: 3, revision: 1, suspendedMembers: [], teams: [{ name: 'crew', members: ['session-r1'] }], routers: { ghost: 'session-r1' } },
      { formatVersion: 2, revision: 1, suspendedMembers: [], teams: [{ name: 'crew', members: ['session-r1'] }], routers: { crew: 'session-r1' } },
    ]) {
      const path = tmpFile(); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(snapshot))
      const store = new CanvasStore(path)
      expect(store.state().error).toBeDefined()
      expect(store.routerEntries()).toEqual([])
      expect(store.membersOf('crew')).toEqual([])
    }
  })

  it('a format this build does not know stays read-only (the downgrade direction for the next format)', () => {
    const path = tmpFile(); mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ formatVersion: 4, revision: 1, suspendedMembers: [], teams: [] }))
    expect(new CanvasStore(path).state().error).toBe('unsupported canvas formatVersion')
  })
})
