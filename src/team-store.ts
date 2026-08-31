/**
 * Persisted team-membership declarations: which routable teams each joined
 * session node declares itself a member of (`a2a/teams.json`). Membership
 * is the node's own state — the inverse of canvas teams, where a team
 * declares its members — and is published serve-fresh on the host card so
 * a team's roster rebuilds as the union of member declarations (desired
 * state, no central directory; the S2 half of the team-roster iteration).
 * Joins are allowlist-gated at the tool layer; the store is pure storage.
 * Plain JSON, one writer (the a2a_team_join / a2a_team_leave tools), read
 * fresh by the state route.
 * @module @nelsonlongxiang/dsh-open-a2a-net/team-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** On-disk shape: one entry per session node that declares memberships. */
export interface TeamSnapshot {
  readonly memberships: ReadonlyArray<{ readonly session: string; readonly teams: readonly string[] }>
}

/** Upper bounds: a curation surface, not a database. */
export const TEAM_NODE_CAP = 64
export const TEAMS_PER_NODE_CAP = 16

/** Longest accepted team name (full routable form, `zone/<id8>` etc.). */
export const TEAM_NAME_MAX = 60

function validTeam(raw: string): string | undefined {
  const clean = raw.trim()
  if (clean === '' || clean.length > TEAM_NAME_MAX) return undefined
  return clean
}

/**
 * Bounded membership store with last-write-wins persistence. Pure of any
 * policy: callers gate joins and resolve rosters.
 */
export class TeamMembershipStore {
  /** Entries in first-declaration order; teams in join order. */
  private entries: Array<{ session: string; teams: string[] }> = []
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
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TeamSnapshot> | null
      const raw: ReadonlyArray<{ session?: unknown; teams?: unknown }> = Array.isArray(snapshot?.memberships)
        ? snapshot.memberships
        : []
      for (const entry of raw) {
        if (typeof entry.session !== 'string' || entry.session === '') continue
        if (!Array.isArray(entry.teams)) continue
        const teams = entry.teams
          .filter((team): team is string => typeof team === 'string')
          .map(team => validTeam(team))
          .filter((team): team is string => team !== undefined)
        if (teams.length > 0) this.entries.push({ session: entry.session, teams })
      }
    } catch {
      // A malformed snapshot stays unloaded; the next write replaces it.
    }
  }

  private persist(): void {
    if (this.path === '') return
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify({ memberships: this.entries }))
  }

  /** Membership entries, copies — callers cannot mutate the store. */
  list(): ReadonlyArray<{ readonly session: string; readonly teams: readonly string[] }> {
    return this.entries.map(entry => ({ session: entry.session, teams: [...entry.teams] }))
  }

  /** Teams one session node declares, in join order. */
  teamsOf(session: string): readonly string[] {
    return [...(this.entries.find(entry => entry.session === session)?.teams ?? [])]
  }

  /** Local sessions declaring one team, in declaration order. */
  membersOf(team: string): string[] {
    return this.entries.filter(entry => entry.teams.includes(team)).map(entry => entry.session)
  }

  /** Declare one membership. Idempotent; silently caps at the bounds. */
  add(session: string, team: string): void {
    const clean = validTeam(team)
    if (clean === undefined || session === '') return
    let entry = this.entries.find(candidate => candidate.session === session)
    if (entry === undefined) {
      if (this.entries.length >= TEAM_NODE_CAP) return
      entry = { session, teams: [] }
      this.entries.push(entry)
    }
    if (entry.teams.includes(clean) || entry.teams.length >= TEAMS_PER_NODE_CAP) return
    entry.teams.push(clean)
    this.persist()
  }

  /** Retract one membership; a no-op when absent. */
  remove(session: string, team: string): void {
    const entry = this.entries.find(candidate => candidate.session === session)
    if (entry === undefined) return
    const index = entry.teams.indexOf(team)
    if (index >= 0) {
      entry.teams.splice(index, 1)
      if (entry.teams.length === 0) this.entries = this.entries.filter(candidate => candidate.session !== session)
      this.persist()
    }
  }

  /** Drop every declaration of one session (a left or archived node). */
  dropSession(session: string): void {
    const before = this.entries.length
    this.entries = this.entries.filter(entry => entry.session !== session)
    if (this.entries.length !== before) this.persist()
  }
}
