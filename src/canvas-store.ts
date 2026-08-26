/**
 * Persisted canvas teams: user-composed multi-member routing groups under
 * the a2a home (`a2a/canvas.json`). A canvas team is a named set of joined
 * session ids — one atomic session node may sit in many teams, and routing
 * to `<team>/canvas/<name>` resolves the first live member or wakes the
 * first cold one. Membership order is the routing priority (member list
 * order), preserved verbatim on disk. Plain JSON, one writer (the control
 * routes), read fresh by the state route.
 * @module @nelsonlongxiang/dsh-open-a2a-net/canvas-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** On-disk shape: ordered team entries, each an ordered member id list. */
export interface CanvasSnapshot {
  readonly teams: ReadonlyArray<{ readonly name: string; readonly members: readonly string[] }>
}

/** Upper bounds: a canvas taxonomy, not a database. */
export const CANVAS_TEAM_CAP = 64
export const CANVAS_MEMBER_CAP = 32

/** Longest accepted team name (same budget as group names). */
export const CANVAS_NAME_MAX = 40

function validName(raw: string): string | undefined {
  const clean = raw.trim()
  if (clean === '' || clean.length > CANVAS_NAME_MAX) return undefined
  // '/' would nest the wire namespace (<team>/canvas/a/b); pure digits would
  // reorder under JSON.parse's integer-like key ordering if the store ever
  // migrated to a keyed map — both stay out now.
  if (clean.includes('/') || /^\d+$/.test(clean)) return undefined
  return clean
}

/**
 * Bounded canvas-team store with last-write-wins persistence. Pure of any
 * registry knowledge: callers validate join state and resolve members.
 */
export class CanvasStore {
  /** Team entries in creation order; members in add order (routing priority). */
  private teams: Array<{ name: string; members: string[] }> = []
  private readonly path: string

  /**
   * @param path - the snapshot file; an empty path keeps the store in memory.
   */
  constructor(path: string) {
    this.path = path
    this.restore()
  }

  /** Load a persisted snapshot, if present and well-formed. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<CanvasSnapshot> | null
      if (!Array.isArray(snapshot?.teams)) return
      const kept: Array<{ name: string; members: string[] }> = []
      for (const entry of snapshot.teams) {
        if (entry === null || typeof entry !== 'object') continue
        if (validName(String(entry.name)) === undefined) continue
        const members = Array.isArray(entry.members)
          ? entry.members.filter((id: unknown): id is string => typeof id === 'string' && id !== '').slice(0, CANVAS_MEMBER_CAP)
          : []
        if (kept.some(t => t.name === entry.name)) continue
        kept.push({ name: String(entry.name), members })
      }
      this.teams = kept.slice(0, CANVAS_TEAM_CAP)
    } catch {
      // A corrupt store is not fatal: the user re-creates teams; routing
      // names simply stop resolving until then.
    }
  }

  /** Persist the current snapshot (no-op without a path). */
  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const snapshot: CanvasSnapshot = { teams: this.teams.map(t => ({ name: t.name, members: [...t.members] })) }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break the canvas; the store degrades to
      // memory-only.
    }
  }

  /** Every team name, in creation order. */
  list(): readonly string[] {
    return this.teams.map(t => t.name)
  }

  /** Whether the named team exists. */
  hasTeam(name: string): boolean {
    return this.teams.some(t => t.name === name)
  }

  /** The named team's member ids in routing-priority order (a copy). */
  membersOf(name: string): readonly string[] {
    const entry = this.teams.find(t => t.name === name)
    return entry === undefined ? [] : [...entry.members]
  }

  /** Every team name the id is a member of, in team creation order. */
  teamsOf(id: string): readonly string[] {
    return this.teams.filter(t => t.members.includes(id)).map(t => t.name)
  }

  /**
   * Create a named team; whitespace trims, duplicates are idempotent, and
   * the cap rejects a team beyond {@link CANVAS_TEAM_CAP}.
   * @param name - the raw user-supplied name.
   * @returns the stored name, or undefined when rejected.
   */
  create(name: string): string | undefined {
    const clean = validName(name)
    if (clean === undefined) return undefined
    if (this.hasTeam(clean)) return clean
    if (this.teams.length >= CANVAS_TEAM_CAP) return undefined
    this.teams.push({ name: clean, members: [] })
    this.persist()
    return clean
  }

  /**
   * Delete a team (with its memberships).
   * @param name - the team name.
   */
  remove(name: string): boolean {
    const index = this.teams.findIndex(t => t.name === name)
    if (index < 0) return false
    this.teams.splice(index, 1)
    this.persist()
    return true
  }

  /**
   * Add one member (idempotent; duplicates keep the original priority slot).
   * The team must exist — callers create it first so the cap applies once.
   * @param name - the existing team name.
   * @param id - the member session id.
   */
  addMember(name: string, id: string): boolean {
    if (id === '') return false
    const entry = this.teams.find(t => t.name === name)
    if (entry === undefined) return false
    if (entry.members.includes(id)) return true
    if (entry.members.length >= CANVAS_MEMBER_CAP) return false
    entry.members.push(id)
    this.persist()
    return true
  }

  /**
   * Remove one member from one team (a no-op when absent).
   */
  removeMember(name: string, id: string): boolean {
    const entry = this.teams.find(t => t.name === name)
    if (entry === undefined) return false
    const index = entry.members.indexOf(id)
    if (index < 0) return false
    entry.members.splice(index, 1)
    this.persist()
    return true
  }

  /**
   * Drop one id from every team — the leave and archive paths: a session
   * leaving the network keeps no canvas membership anywhere.
   * @param id - the departing session id.
   */
  dropMember(id: string): void {
    let dirty = false
    for (const entry of this.teams) {
      const index = entry.members.indexOf(id)
      if (index >= 0) {
        entry.members.splice(index, 1)
        dirty = true
      }
    }
    if (dirty) this.persist()
  }
}
