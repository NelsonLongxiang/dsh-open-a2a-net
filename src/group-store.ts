/**
 * Persisted session groups: user-named buckets for the network panel's
 * session listing, stored under the a2a home so they survive restarts and
 * follow the node (not the browser). Plain JSON, one writer (the control
 * routes), read fresh by the state route.
 * @module @nelsonlongxiang/dsh-open-a2a-net/group-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** On-disk shape; assignments map a session id to its group name. */
export interface GroupSnapshot {
  readonly groups: readonly string[]
  readonly assignments: Readonly<Record<string, string>>
}

/** Upper bound on named groups (a panel taxonomy, not a database). */
export const GROUP_CAP = 20

/**
 * Bounded group store with last-write-wins persistence.
 */
export class GroupStore {
  private groups: string[] = []
  private assignments: Record<string, string> = {}
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
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<GroupSnapshot> | null
      if (Array.isArray(snapshot?.groups)) {
        this.groups = snapshot.groups.filter((name): name is string => typeof name === 'string' && name.trim() !== '').slice(0, GROUP_CAP)
      }
      if (snapshot?.assignments !== null && typeof snapshot?.assignments === 'object') {
        const kept: Record<string, string> = {}
        for (const [id, name] of Object.entries(snapshot.assignments as Record<string, unknown>)) {
          if (typeof name === 'string' && this.groups.includes(name)) kept[id] = name
        }
        this.assignments = kept
      }
    } catch {
      // A corrupt store is not fatal: fall back to empty groups.
    }
  }

  /** Persist the current snapshot (no-op without a path). */
  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const snapshot: GroupSnapshot = { groups: [...this.groups], assignments: { ...this.assignments } }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break the panel; the store degrades to memory-only.
    }
  }

  /** Every named group, in creation order. */
  list(): readonly string[] {
    return [...this.groups]
  }

  /**
   * The group a session belongs to, if any.
   * @param id - the session id.
   */
  groupOf(id: string): string | undefined {
    return this.assignments[id]
  }

  /** Every assignment, for the state route's session rows. */
  all(): Readonly<Record<string, string>> {
    return { ...this.assignments }
  }

  /**
   * Create a named group; whitespace trims, duplicates are idempotent, and
   * the cap rejects a group beyond {@link GROUP_CAP}.
   * @param name - the raw user-supplied name.
   * @returns the stored name, or undefined when rejected.
   */
  create(name: string): string | undefined {
    const clean = name.trim()
    if (clean === '' || clean.length > 40) return undefined
    if (this.groups.includes(clean)) return clean
    if (this.groups.length >= GROUP_CAP) return undefined
    this.groups.push(clean)
    this.persist()
    return clean
  }

  /**
   * Assign one session to an existing group (creating it when new and
   * under the cap); an empty group name unassigns.
   * @param id - the session id.
   * @param name - the group name, or '' to clear.
   */
  assign(id: string, name: string): boolean {
    if (name === '') {
      if (this.assignments[id] === undefined) return true
      delete this.assignments[id]
      this.persist()
      return true
    }
    const stored = this.create(name)
    if (stored === undefined) return false
    this.assignments[id] = stored
    this.persist()
    return true
  }

  /**
   * Delete an empty-or-not group; its assignments clear with it.
   * @param name - the group name.
   */
  remove(name: string): boolean {
    const index = this.groups.indexOf(name)
    if (index < 0) return false
    this.groups.splice(index, 1)
    for (const id of Object.keys(this.assignments)) {
      if (this.assignments[id] === name) delete this.assignments[id]
    }
    this.persist()
    return true
  }
}
