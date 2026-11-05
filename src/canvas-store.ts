/**
 * Persisted canvas teams: user-composed multi-member routing groups under
 * the a2a home (`a2a/canvas.json`). A canvas team is a named set of member
 * references in one of two shapes: a local session id (a joined session
 * node on this host) or a remote team handle (`<zone>/<id8>`, a session
 * node published by a peer — one member may sit in many teams). Routing to
 * `<team>/canvas/<name>` resolves the first live local member, wakes the
 * first cold local one, then falls through to the remote members in order
 * (the directory resolves their handles; remote nodes never wake from
 * here). The dispatching session itself is exempt from the local tiers
 * (issue #41: the self-route rule extends to canvas — an initiator
 * occupying a member slot never captures its own dispatch, which would
 * only echo home; the seam lives in the dispatch layer, the store stays
 * pure). Membership order is the routing priority (member list order),
 * preserved verbatim on disk. Plain JSON, one writer (the control routes),
 * read fresh by the state route.
 * @module @nelsonlongxiang/dsh-open-a2a-net/canvas-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { CLI_HANDLE_RE } from './cli-deposit.ts'

/** On-disk shape: ordered team entries, each an ordered member id list. */
export interface SuspendedCanvasMember {
  readonly team: string; readonly member: string; readonly localSessionId: string
  readonly reason: 'leave' | 'archive' | 'remove'; readonly at: string; readonly token: string
}
/** A bare session handle is not a CLI identity or a qualified owner selector. */
export function legacyBareMember(id: string): boolean {
  return isRemoteMemberRef(id) && !CLI_HANDLE_RE.test(id) && !/@[0-9a-f]{8}$/.test(id)
}
export interface CanvasSnapshot {
  readonly formatVersion?: number
  readonly revision?: number
  readonly memberOwners?: Readonly<Record<string, string>>
  readonly suspendedMembers?: readonly SuspendedCanvasMember[]
  readonly teams: ReadonlyArray<{ readonly name: string; readonly members: readonly string[] }>
  /** Pinned CLI handle -> linked home origin (only while some canvas team holds the handle). */
  readonly cliHome?: Readonly<Record<string, string>>
  /** Local publish cleared an older pin; kept for the owner inspector until membership is removed or re-pinned. */
  readonly cliHomeCleared?: readonly string[]
}

/** Upper bounds: a canvas taxonomy, not a database. */
export const CANVAS_TEAM_CAP = 64
export const CANVAS_MEMBER_CAP = 32

/** Longest accepted team name (same budget as group names). */
export const CANVAS_NAME_MAX = 40

/**
 * Whether one member entry references a remote node rather than a local
 * session id. Remote refs are zone-qualified team handles (`<zone>/<id8>`),
 * so the '/'-test is deterministic: local session ids (`session-<uuid>`,
 * `import-<uuid>`) never contain one, and canvas team names — the only other
 * strings in a member slot — are barred from '/' at creation.
 */
export function isRemoteMemberRef(id: string): boolean {
  return id.includes('/')
}

/**
 * Shape-gate for a remote member reference at the control-route seam: at
 * least one '/'-delimited segment on each side, no whitespace. The registry
 * cross-check lives in the UI (the picker offers discovered rows only);
 * this gate keeps malformed strings out of the persisted file.
 */
export function validRemoteMemberRef(id: string): boolean {
  const trimmed = id.trim()
  return trimmed === id && isRemoteMemberRef(id) && !/\s/.test(id)
    && !id.startsWith('/') && !id.endsWith('/') && !id.includes('//')
}

function validName(raw: string): string | undefined {
  const clean = raw.trim()
  if (clean === '' || clean.length > CANVAS_NAME_MAX) return undefined
  // '/' would nest the wire namespace (<team>/canvas/a/b); pure digits would
  // reorder under JSON.parse's integer-like key ordering if the store ever
  // migrated to a keyed map — both stay out now.
  if (clean.includes('/') || /^\d+$/.test(clean)) return undefined
  return clean
}

/** A NEW canvas name: `@<8 lowercase hex>` at the end is the owner-fingerprint suffix of a routing id (#282 S2), never part of a name.
 *  An existing canvas with such a name still loads; it is reached by its full id `<zone>/canvas/<name>@<own fp8>`. */
function validNewName(raw: string): string | undefined {
  const clean = validName(raw)
  return clean === undefined || /@[0-9a-f]{8}$/.test(clean) ? undefined : clean
}

/**
 * Bounded canvas-team store with last-write-wins persistence. Pure of any
 * registry knowledge: callers validate join state and resolve members.
 */
export class CanvasStore {
  /** Team entries in creation order; members in add order (routing priority). */
  private teams: Array<{ name: string; members: string[] }> = []
  private cliHome: Record<string, string> = {}
  private cliHomeCleared = new Set<string>()
  private suspended: SuspendedCanvasMember[] = []
  private revision = 0
  private committed = ''
  private memberOwners: Record<string, string> = {}
  private disk: string | undefined
  private readOnlyReason = ''
  private lastWriteError = ''
  private failedSuspension = false
  private readonly path: string
  private readonly listeners = new Set<() => void>()

  /**
   * @param path - the snapshot file; an empty path keeps the store in memory.
   */
  constructor(path: string, private readonly options: { legacyBareMembers?: boolean } = {}) {
    this.path = path
    this.restore()
    this.committed = this.serialize()
  }

  /**
   * Observe changes: the listener runs after every write that changed the
   * store (never on restore). A throwing listener cannot break the write.
   * @param listener - called with no arguments.
   * @returns the unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Load a persisted snapshot, if present and well-formed. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      this.disk = readFileSync(this.path, 'utf8')
      const snapshot = JSON.parse(this.disk) as Partial<CanvasSnapshot> | null
      if (snapshot?.formatVersion !== undefined && snapshot.formatVersion !== 2) { this.readOnlyReason = 'unsupported canvas formatVersion'; return }
      if (snapshot?.memberOwners && typeof snapshot.memberOwners === 'object' && !Array.isArray(snapshot.memberOwners)) this.memberOwners = { ...snapshot.memberOwners }
      if (snapshot?.formatVersion === 2) {
        if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision! < 0 || !Array.isArray(snapshot.suspendedMembers) || !Array.isArray(snapshot.teams) || snapshot.teams.length > CANVAS_TEAM_CAP) throw Error('incomplete or oversized canvas v2 snapshot')
        const names = new Set<string>()
        for (const entry of snapshot.teams) {
          if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || validName(entry.name) !== entry.name || names.has(entry.name) || !Array.isArray(entry.members) || entry.members.length > CANVAS_MEMBER_CAP) throw Error('invalid canvas v2 team')
          names.add(entry.name)
          const members = new Set<string>()
          for (const member of entry.members) {
            if (typeof member !== 'string' || member === '' || /[\x00-\x1f\x7f]/.test(member) || members.has(member)) throw Error('invalid canvas v2 member')
            members.add(member)
          }
        }
        if (snapshot.memberOwners !== undefined && (snapshot.memberOwners === null || typeof snapshot.memberOwners !== 'object' || Array.isArray(snapshot.memberOwners) || Object.values(snapshot.memberOwners).some(key => typeof key !== 'string'))) throw Error('invalid canvas v2 owners')
        if (snapshot.cliHome !== undefined && (snapshot.cliHome === null || typeof snapshot.cliHome !== 'object' || Array.isArray(snapshot.cliHome) || Object.entries(snapshot.cliHome).some(([handle, home]) => !CLI_HANDLE_RE.test(handle) || typeof home !== 'string' || !validHomeOrigin(home) || !snapshot.teams!.some(t => t.members.includes(handle))))) throw Error('invalid canvas v2 CLI homes')
        if (snapshot.cliHomeCleared !== undefined && (!Array.isArray(snapshot.cliHomeCleared) || new Set(snapshot.cliHomeCleared).size !== snapshot.cliHomeCleared.length || snapshot.cliHomeCleared.some(handle => typeof handle !== 'string' || !CLI_HANDLE_RE.test(handle) || !snapshot.teams!.some(t => t.members.includes(handle))))) throw Error('invalid canvas v2 cleared homes')
      }
      this.revision = Number.isSafeInteger(snapshot?.revision) && snapshot!.revision! >= 0 ? snapshot!.revision! : 0
      if (snapshot?.suspendedMembers !== undefined) {
        if (!Array.isArray(snapshot.suspendedMembers)) throw Error('invalid suspension records')
        const seen = new Set<string>()
        for (const row of snapshot.suspendedMembers) {
          if (!row || typeof row.team !== 'string' || typeof row.member !== 'string' || typeof row.localSessionId !== 'string' || !['leave', 'archive', 'remove'].includes(row.reason) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)) || typeof row.token !== 'string' || !row.token) throw Error('invalid suspension record')
          if (snapshot.formatVersion === 2 && !snapshot.teams?.some(t => t.name === row.team && t.members.includes(row.member))) throw Error('orphan suspension record')
          const key = JSON.stringify([row.team,row.member,row.reason,row.localSessionId])
          if (seen.has(key)) throw Error('duplicate suspension record'); seen.add(key)
          this.suspended.push({ ...row })
        }
      }
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
      if (snapshot.cliHome !== null && typeof snapshot.cliHome === 'object' && !Array.isArray(snapshot.cliHome)) {
        for (const [handle, home] of Object.entries(snapshot.cliHome)) {
          if (CLI_HANDLE_RE.test(handle) && typeof home === 'string' && validHomeOrigin(home) && this.teams.some(t => t.members.includes(handle))) this.cliHome[handle] = home
        }
      }
      if (Array.isArray(snapshot.cliHomeCleared)) for (const handle of snapshot.cliHomeCleared) {
        if (typeof handle === 'string' && CLI_HANDLE_RE.test(handle) && this.cliHome[handle] === undefined && this.teams.some(t => t.members.includes(handle))) this.cliHomeCleared.add(handle)
      }
    } catch {
      this.teams = []; this.suspended = []
      // A malformed v2 suspension must never silently reactivate members.
      if (this.disk?.includes('suspendedMembers') || this.disk?.includes('formatVersion')) this.readOnlyReason = 'invalid canvas v2 snapshot'
    }
  }

  /** Persist the current snapshot (no-op without a path), then tell the listeners. */
  private persist(): void {
    try { this.write(); this.committed = this.serialize(); this.lastWriteError = '' } catch (error) {
      this.lastWriteError = String(error)
      const previous = JSON.parse(this.committed) as CanvasSnapshot
      this.teams = previous.teams.map(t => ({ name: t.name, members: [...t.members] }))
      this.suspended = [...previous.suspendedMembers ?? []]
      this.cliHome = { ...previous.cliHome }; this.cliHomeCleared = new Set(previous.cliHomeCleared)
      this.revision = previous.revision ?? 0
      throw error
    }
    for (const listener of this.listeners) {
      try { listener() } catch { /* a listener's failure is its own */ }
    }
  }

  private serialize(): string {
    return JSON.stringify({ teams: this.teams, suspendedMembers: this.suspended, cliHome: this.cliHome, cliHomeCleared: [...this.cliHomeCleared], revision: this.revision })
  }
  private write(): void {
    if (this.readOnlyReason) throw Error(this.readOnlyReason)
    const revision = this.revision + 1
    const snapshot: CanvasSnapshot = { formatVersion: 2, revision,
      teams: this.teams.map(t => ({ name: t.name, members: [...t.members] })),
      suspendedMembers: this.suspended.map(r => ({ ...r })),
      ...(Object.keys(this.memberOwners).length ? { memberOwners: this.memberOwners } : {}),
      ...(Object.keys(this.cliHome).length ? { cliHome: { ...this.cliHome } } : {}),
      ...(this.cliHomeCleared.size ? { cliHomeCleared: [...this.cliHomeCleared] } : {}) }
    const bytes = JSON.stringify(snapshot)
    if (this.path !== '') {
      mkdirSync(dirname(this.path), { recursive: true })
      const lock = this.path + '.lock'
      // Never steal another writer's lock. Diagnostics do not authorize removal.
      try { mkdirSync(lock) } catch (error) { throw Error('canvas lock held at ' + lock + ': ' + JSON.stringify(this.lockInfo()) + ' (' + String(error) + ')') }
      try {
        writeFileSync(lock + '/owner.json', JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' })
        const current = existsSync(this.path) ? readFileSync(this.path, 'utf8') : undefined
        if (current !== this.disk) throw Error('canvas snapshot changed externally; reload before writing')
        let oldVersion: unknown
        try { oldVersion = current === undefined ? undefined : JSON.parse(current)?.formatVersion } catch { /* back up malformed legacy data too */ }
        if (current !== undefined && oldVersion !== 2) {
          const backup = this.path + '.pre-v2'
          if (existsSync(backup)) {
            if (readFileSync(backup, 'utf8') !== current) throw Error('canvas pre-v2 backup differs; inspect before migration: ' + backup)
          } else this.replaceFile(backup, current)
        }
        this.replaceFile(this.path, bytes)
        this.disk = bytes
      } finally { rmSync(lock, { recursive: true }) }
    }
    this.revision = revision
  }

  private replaceFile(target: string, bytes: string): void {
    const temporary = target + '.tmp-' + randomUUID()
    try {
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' })
      const fd = openSync(temporary, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, target)
      if (process.platform !== 'win32') {
        try {
          const dir = openSync(dirname(target), 'r'); try { fsyncSync(dir) } finally { closeSync(dir) }
        } catch (error) {
          // Rename already committed: rolled-back memory must not be used as active state.
          this.readOnlyReason = 'canvas directory fsync failed after rename: ' + String(error)
          throw error
        }
      }
    } finally { rmSync(temporary, { force: true }) }
  }
  private lockInfo(): { path: string; owner?: unknown; error?: string } | undefined {
    const path = this.path + '.lock'
    if (this.path === '' || !existsSync(path)) return undefined
    try { return { path, owner: JSON.parse(readFileSync(path + '/owner.json', 'utf8')) } }
    catch (error) { return { path, error: 'owner metadata unavailable: ' + String(error) } }
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
    if (this.readOnlyReason || this.failedSuspension) return []
    return entry === undefined ? [] : entry.members.filter(id => !this.isSuspended(name, id) && (this.options.legacyBareMembers !== false || !legacyBareMember(id)))
  }

  /** Inspection only: never use raw rows for routing, authorization or counts. */
  rawMembersOf(name: string): readonly string[] { return [...(this.teams.find(t => t.name === name)?.members ?? [])] }
  isSuspended(name: string, member: string): boolean { return this.suspended.some(r => r.team === name && r.member === member) }
  suspensionOf(name: string, member: string): readonly SuspendedCanvasMember[] { return this.suspended.filter(r => r.team === name && r.member === member).map(r => ({ ...r })) }
  state(): { revision: number; suspendedMembers: readonly SuspendedCanvasMember[]; error?: string; lock?: unknown; directoryFsync: string } {
    return { revision: this.revision, suspendedMembers: this.suspended.map(r => ({ ...r })),
      directoryFsync: process.platform === 'win32' ? 'unavailable on Windows; file fsync and atomic rename only' : 'required after rename',
      ...(this.lockInfo() ? { lock: this.lockInfo() } : {}),
      ...(this.readOnlyReason || this.failedSuspension || this.lastWriteError ? { error: this.readOnlyReason || (this.failedSuspension ? 'canvas suspension persistence failed; restart after repair' : this.lastWriteError) } : {}) }
  }
  ownerKeyOf(member: string): string | undefined { return this.memberOwners[member] }
  /** Durably revoke canvas consent BEFORE join/agent/roster state is removed. */
  revokeLocal(id: string, ownQualified: string | undefined, inferredBare: string | undefined, reason: SuspendedCanvasMember['reason'], team?: string): boolean {
    if (this.readOnlyReason || this.failedSuspension) throw Error(this.state().error)
    let changed = false
    for (const entry of this.teams) {
      if (team !== undefined && entry.name !== team) continue
      if (inferredBare !== undefined && entry.members.includes(inferredBare) && !this.suspended.some(r => r.team === entry.name && r.member === inferredBare && r.localSessionId === id && r.reason === reason)) {
        this.suspended.push({ team: entry.name, member: inferredBare, localSessionId: id, reason, at: new Date().toISOString(), token: randomUUID() }); changed = true
      }
      const kept = entry.members.filter(m => m !== id && m !== ownQualified)
      if (kept.length !== entry.members.length) { entry.members = kept; changed = true }
    }
    if (changed) { try { this.persist() } catch (error) { this.failedSuspension = true; throw error } }
    return changed
  }
  /** Owner-only CAS. The caller supplies the exact slot and the complete current suspension records. */
  regulateSuspended(action: 'restore' | 'delete', team: string, member: string, revision: unknown, expected: unknown): { ok: boolean; error?: string } {
    if (this.readOnlyReason || this.failedSuspension) return { ok: false, error: this.state().error }
    const records = this.suspensionOf(team, member)
    if (revision !== this.revision || !records.length || !this.rawMembersOf(team).includes(member) || JSON.stringify(expected) !== JSON.stringify(records)) return { ok: false, error: 'canvas version, member slot or suspension records changed; refresh first' }
    const old = this.suspended
    const entry = this.teams.find(t => t.name === team)!, members = entry.members
    this.suspended = this.suspended.filter(r => r.team !== team || r.member !== member)
    if (action === 'delete') entry.members = entry.members.filter(m => m !== member)
    try { this.persist(); return { ok: true } } catch (error) { this.suspended = old; entry.members = members; return { ok: false, error: String(error) } }
  }

  /** Frozen, operator-linked CLI home; undefined means unknown or ambiguous. */
  cliHomeOf(handle: string): string | undefined { return this.cliHome[handle] }
  pinnedCliHomes(): ReadonlyArray<readonly [string, string]> { return Object.entries(this.cliHome) }
  wasCliHomeCleared(handle: string): boolean { return this.cliHomeCleared.has(handle) }
  clearCliHomeForLocal(handle: string): boolean {
    if (this.cliHome[handle] === undefined) return false
    delete this.cliHome[handle]
    this.cliHomeCleared.add(handle)
    this.persist()
    return true
  }

  /**
   * The named team's remote member refs (zone-qualified team handles) in
   * routing-priority order — the failover tier after the local live/cold
   * tiers miss. Shape test only: whether the handle currently resolves is
   * the directory's question at route time, not the store's.
   */
  remoteMembersOf(name: string): readonly string[] {
    return this.membersOf(name).filter(isRemoteMemberRef)
  }

  /** Every team name the id is a member of, in team creation order. */
  teamsOf(id: string): readonly string[] {
    return this.teams.filter(t => this.membersOf(t.name).includes(id)).map(t => t.name)
  }

  /**
   * Create a named team; whitespace trims, duplicates are idempotent, and
   * the cap rejects a team beyond {@link CANVAS_TEAM_CAP}.
   * @param name - the raw user-supplied name.
   * @returns the stored name, or undefined when rejected.
   */
  create(name: string): string | undefined {
    const clean = validNewName(name)
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
    if (this.suspended.some(r => r.team === name)) return false
    const [removed] = this.teams.splice(index, 1)
    for (const id of removed!.members) this.forgetUnusedHome(id)
    this.persist()
    return true
  }

  /**
   * Add one member (idempotent; duplicates keep the original priority slot).
   * The team must exist — callers create it first so the cap applies once.
   * @param name - the existing team name.
   * @param id - the member session id.
   */
  addMember(name: string, id: string, home?: string, options: { replaceHome?: boolean } = {}): boolean {
    if (id === '' || (home !== undefined && (!CLI_HANDLE_RE.test(id) || !validHomeOrigin(home)))) return false
    if (home !== undefined && this.cliHome[id] !== undefined && this.cliHome[id] !== home && options.replaceHome !== true) return false
    const entry = this.teams.find(t => t.name === name)
    if (entry === undefined) return false
    if (entry.members.includes(id)) {
      if (home !== undefined && this.cliHome[id] !== home) { this.cliHome[id] = home; this.cliHomeCleared.delete(id); this.persist() }
      return true
    }
    if (entry.members.length >= CANVAS_MEMBER_CAP) return false
    entry.members.push(id)
    if (home !== undefined) { this.cliHome[id] = home; this.cliHomeCleared.delete(id) }
    this.persist()
    return true
  }

  /**
   * Remove one member from one team (a no-op when absent).
   */
  removeMember(name: string, id: string): boolean {
    const entry = this.teams.find(t => t.name === name)
    if (entry === undefined) return false
    // Suspended slots require owner CAS, never a peer remove/readd round trip.
    if (this.isSuspended(name, id)) return false
    const index = entry.members.indexOf(id)
    if (index < 0) return false
    entry.members.splice(index, 1)
    this.forgetUnusedHome(id)
    this.persist()
    return true
  }

  private forgetUnusedHome(id: string): void {
    if (!this.teams.some(team => team.members.includes(id))) { delete this.cliHome[id]; this.cliHomeCleared.delete(id) }
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
      if (index >= 0 && !this.isSuspended(entry.name, id)) {
        entry.members.splice(index, 1)
        dirty = true
      }
    }
    if (dirty) { this.forgetUnusedHome(id); this.persist() }
  }
}

/** One policy predicate for local and signed-remote canvas creation. */
export function canvasNameReserved(raw: string, zone: string, allowlist: readonly string[], roster: { membersOf(team: string): readonly string[] }): boolean {
  const name = raw.trim()
  const team = `${zone}/${name}`
  return name.startsWith('roster:') || allowlist.includes(team) || roster.membersOf(team).length > 0
}

function validHomeOrigin(raw: string): boolean {
  try { const url = new URL(raw); return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === raw }
  catch { return false }
}
