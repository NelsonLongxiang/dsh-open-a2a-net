/** Durable owner message releases. The releasing record is the no-retry point. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SESSION_ID_SHAPE } from './session-log-page.ts'
import { ownerLiveSeat, prepareOwnerPrompt, readSeatStatus, validateOwnerPromptFields, type OwnerPromptInput, type OwnerPromptMode, type UserRefusal, type UserSessionsDeps } from './user-sessions.ts'

const HOUR = 3_600_000
const RETENTION = 7 * 24 * HOUR
const ACTIVE_LIMIT = 5
export const RELEASE_POLL_MS = 60_000

type Actor = OwnerPromptInput['delegate']
type Audit = (extra: Readonly<Record<string, unknown>>) => boolean
type Condition = { readonly kind: 'idle'; readonly minutes: number } | { readonly kind: 'at'; readonly at: number }
interface ReleaseInfo {
  readonly release: string
  readonly id: string
  readonly condition: Condition
  readonly then: OwnerPromptMode
  readonly expiresAt: number
  readonly armedBy: Actor
  readonly sha256: string
  readonly chars: number
  readonly requestId?: string
  readonly requestKey: string
}
type Active = ReleaseInfo & { readonly state: 'armed' | 'releasing'; readonly text: string; readonly callerTaint: string }
type Terminal = ReleaseInfo & { readonly state: 'released' | 'failed' | 'unknown' | 'withdrawn' | 'expired' | 'cancelled'; readonly finishedAt: number; readonly code?: string }
type Release = Active | Terminal

export interface ReleaseStorage { read(): unknown; write(rows: readonly Release[]): void }
export interface ReleaseHost {
  readonly deps: UserSessionsDeps
  readonly delegateActive: (id: string) => boolean
  readonly auditTimer: Audit
  readonly warn: (message: string) => void
  readonly now?: () => number
}

function refused(status: number, code: string, error: string): UserRefusal { return { ok: false, status, code, error } }
function active(row: Release): row is Active { return row.state === 'armed' || row.state === 'releasing' }
function conditionFrom(value: unknown): Condition | undefined {
  if (typeof value !== 'string') return undefined
  const idle = /^idle:(\d+)$/.exec(value)
  if (idle !== null) {
    const minutes = Number(idle[1])
    return minutes >= 10 && minutes <= 1440 ? { kind: 'idle', minutes } : undefined
  }
  if (!/^at:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined
  const at = Date.parse(value.slice(3))
  return Number.isFinite(at) ? { kind: 'at', at } : undefined
}
function publicRelease(row: Release) {
  const when = row.condition.kind === 'idle' ? 'idle:' + String(row.condition.minutes) : 'at:' + new Date(row.condition.at).toISOString()
  return { release: row.release, id: row.id, when, then: row.then, state: row.state, expires_at: new Date(row.expiresAt).toISOString(),
    chars: row.chars, sha256: row.sha256, ...(!active(row) && row.code !== undefined ? { code: row.code } : {}) }
}
function auditFields(row: Release) {
  const { release, id, when, then, expires_at, sha256, chars } = publicRelease(row)
  return { release, target: id, when, then, expires_at, sha256, chars, armedBy: { id: row.armedBy.id, name: row.armedBy.name } }
}
function terminal(row: Active, state: Terminal['state'], finishedAt: number, code?: string): Terminal {
  const { text: _text, callerTaint: _taint, ...metadata } = row
  return { ...metadata, state, finishedAt, ...(code === undefined ? {} : { code }) }
}
function validRelease(value: unknown): value is Release {
  const row = value as (Partial<ReleaseInfo> & { state?: unknown; text?: unknown; callerTaint?: unknown; finishedAt?: unknown }) | null
  if (row === null || typeof row !== 'object' || typeof row.id !== 'string' || !SESSION_ID_SHAPE.test(row.id)
    || typeof row.release !== 'string' || !/^release-[a-f0-9-]{36}$/.test(row.release)
    || typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)
    || (row.then !== 'steer' && row.then !== 'queue' && row.then !== 'trigger')
    || typeof row.armedBy?.name !== 'string' || (row.armedBy.id !== null && typeof row.armedBy.id !== 'string')
    || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)
    || !Number.isInteger(row.chars) || typeof row.requestKey !== 'string'
    || (row.requestId !== undefined && typeof row.requestId !== 'string')) return false
  const condition = row.condition
  if (!(condition?.kind === 'idle' && Number.isInteger(condition.minutes) && condition.minutes >= 10 && condition.minutes <= 1440)
    && !(condition?.kind === 'at' && Number.isFinite(condition.at) && condition.at < row.expiresAt)) return false
  if (row.state === 'armed' || row.state === 'releasing') return typeof row.text === 'string' && typeof row.callerTaint === 'string'
  return ['released', 'failed', 'unknown', 'withdrawn', 'expired', 'cancelled'].some(state => state === row.state)
    && typeof row.finishedAt === 'number' && Number.isFinite(row.finishedAt) && row.text === undefined
}

/** Keep user releases in a private file replaced atomically on the same filesystem. */
export function releaseFile(path: string): ReleaseStorage {
  return {
    read: () => {
      try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
    },
    write: rows => {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        writeFileSync(temporary, JSON.stringify(rows), { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true })
        renameSync(temporary, path)
      } catch (error) {
        try { rmSync(temporary, { force: true }) } catch { /* Preserve the write or rename failure. */ }
        throw error
      }
    },
  }
}

export class OwnerReleases {
  private rows = new Map<string, Release>()
  private readonly idleSince = new Map<string, number>()
  private readonly now: () => number
  private unavailable = false

  constructor(private readonly storage: ReleaseStorage, private readonly host: ReleaseHost) {
    this.now = host.now ?? Date.now
    try {
      const rows = storage.read()
      if (!Array.isArray(rows) || !rows.every(validRelease)) throw new Error('invalid release file')
      this.rows = new Map(rows.map(row => [row.release, row]))
      if (this.rows.size !== rows.length) throw new Error('duplicate releases')
    } catch {
      this.unavailable = true
      host.warn('owner release store is unavailable')
    }
  }

  list(id?: string) {
    if (this.unavailable) return refused(503, 'not-saved', 'release store is unavailable')
    const cutoff = this.now() - RETENTION
    const rows = Array.from(this.rows.values()).filter(row => (id === undefined || row.id === id) && (active(row) || row.finishedAt > cutoff))
    return { ok: true as const, releases: rows.map(publicRelease) }
  }

  arm(fields: Readonly<Record<string, unknown>>, actor: Actor, callerTaint: string, audit: Audit) {
    if (this.unavailable) return refused(503, 'not-saved', 'release store is unavailable')
    const target = ownerLiveSeat(this.host.deps, fields.id)
    if (!target.ok) return target
    const checked = validateOwnerPromptFields({ text: fields.text, mode: fields.then, requestId: fields.request_id })
    if (!checked.ok) return checked.code === 'mode' ? { ...checked, code: 'then' } : checked
    const hours = fields.expires_hours === undefined ? 24 : fields.expires_hours
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 168) {
      return refused(400, 'expires', 'expires_hours must be greater than zero and at most 168')
    }
    const now = this.now()
    const expiresAt = now + hours * HOUR
    // Build the key before checking the moving time window so a retry can recover a previous result.
    const condition = conditionFrom(fields.when)
    const invalidWhen = () => refused(400, 'when', 'use idle:10..1440 or an ISO at: time between 5 minutes and 7 days ahead and before expiry')
    if (condition === undefined) return invalidWhen()
    const requestKey = JSON.stringify([actor.id, target.id, checked.digest, checked.mode, condition, hours])
    for (const row of this.rows.values()) {
      if (checked.requestId !== undefined && row.requestId === checked.requestId && (active(row) || row.finishedAt > now - RETENTION)) {
        return row.requestKey === requestKey ? { ok: true as const, ...publicRelease(row), replayed: true }
          : refused(409, 'request-id-conflict', 'this request_id was used for a different release')
      }
    }
    if (condition.kind === 'at' && (condition.at < now + 5 * RELEASE_POLL_MS || condition.at > now + RETENTION || condition.at >= expiresAt)) {
      return invalidWhen()
    }
    const current = Array.from(this.rows.values()).filter(row => row.id === target.id && active(row)).length
    if (current >= ACTIVE_LIMIT) return refused(409, 'full', 'this seat already has five active releases')
    const row: Active = { release: 'release-' + randomUUID(), id: target.id, condition, then: checked.mode, expiresAt, armedBy: actor,
      state: 'armed', text: checked.text, sha256: checked.digest, chars: checked.chars, requestId: checked.requestId, requestKey, callerTaint }
    const fieldsForAudit = { ...auditFields(row), actor }
    if (!audit({ ...fieldsForAudit, action: 'release-arm' })) return refused(503, 'audit', 'release was not armed because its audit could not be written')
    if (!this.put(row)) {
      audit({ ...fieldsForAudit, action: 'release-arm-failed' })
      return refused(503, 'not-saved', 'arm attempt audited, but the release was not saved')
    }
    return { ok: true as const, ...publicRelease(row) }
  }

  withdraw(id: unknown, actor: Actor, audit: Audit) {
    if (this.unavailable) return refused(503, 'not-saved', 'release store is unavailable')
    const row = typeof id === 'string' ? this.rows.get(id) : undefined
    if (row === undefined) return refused(404, 'no-release', 'no such release')
    if (row.state !== 'armed') return refused(409, 'not-armed', 'the release is no longer armed')
    const fields = { ...auditFields(row), actor }
    if (!audit({ ...fields, action: 'release-withdraw' })) return refused(503, 'audit', 'release was not withdrawn because its audit could not be written')
    const updated = terminal(row, 'withdrawn', this.now())
    if (!this.put(updated)) {
      audit({ ...fields, action: 'withdraw-failed' })
      return refused(503, 'not-saved', 'withdrawal was not saved and the release may still fire')
    }
    return { ok: true as const, ...publicRelease(updated) }
  }

  /** Forget a previous idle interval even if a complete turn ran between timer ticks. */
  noteStatus(id: string): void {
    this.idleSince.delete(id)
  }

  /** Run one synchronous timer tick. Persist each attempt before invoking any delivery. */
  tick(): void {
    if (this.unavailable) return
    const now = this.now()
    const idleTargets = new Set<string>()
    for (const row of this.rows.values()) {
      if (row.state === 'armed' && row.condition.kind === 'idle' && readSeatStatus(this.host.deps.agent(row.id)) === 'idle') {
        idleTargets.add(row.id)
        if (!this.idleSince.has(row.id)) this.idleSince.set(row.id, now)
      }
    }
    for (const id of this.idleSince.keys()) if (!idleTargets.has(id)) this.idleSince.delete(id)
    for (const id of this.rows.keys()) this.advance(id, this.now())
    const retained = new Map(Array.from(this.rows).filter(([, row]) => active(row) || row.finishedAt > now - RETENTION))
    if (retained.size !== this.rows.size) this.save(retained)
  }

  private advance(id: string, now: number): void {
    const row = this.rows.get(id)
    if (row?.state === 'releasing') {
      this.finish(row, 'unknown', now, 'restart-or-uncommitted-result')
      return
    }
    if (row?.state !== 'armed') return
    if (now >= row.expiresAt) { this.finish(row, 'expired', now); return }
    if (row.condition.kind === 'idle' && readSeatStatus(this.host.deps.agent(row.id)) !== 'idle') {
      this.idleSince.delete(row.id)
      return
    }
    const due = row.condition.kind === 'at' ? row.condition.at : (this.idleSince.get(row.id) ?? Infinity) + row.condition.minutes * RELEASE_POLL_MS
    if (now < due) return
    if (row.armedBy.id !== null && !this.host.delegateActive(row.armedBy.id)) {
      this.finish(row, 'cancelled', now, 'delegate-invalid', { authorized: false })
      return
    }
    const prepared = prepareOwnerPrompt(this.host.deps, { id: row.id, mode: row.then, text: row.text, callerTaint: row.callerTaint, delegate: row.armedBy })
    if (!prepared.ok) {
      if (prepared.code !== 'busy') this.finish(row, 'failed', now, prepared.code)
      return
    }
    if (prepared.replay !== undefined) {
      this.finish(row, 'failed', now, 'unexpected-prompt-replay', { authorized: true })
      return
    }
    const audit = { ...auditFields(row), authorized: true }
    if (!this.host.auditTimer({ ...audit, action: 'fire-accepted' })) return
    const attempt: Active = { ...row, state: 'releasing' }
    if (!this.put(attempt)) {
      this.host.auditTimer({ ...audit, action: 'fire-aborted' })
      return
    }
    let outcome: ReturnType<typeof prepared.deliver>
    try { outcome = prepared.deliver() } catch { outcome = refused(500, 'deliver-failed', 'delivery outcome is unknown') }
    if (!outcome.ok) {
      this.finish(attempt, outcome.code === 'not-live' ? 'failed' : 'unknown', now, outcome.code, { authorized: true })
      return
    }
    this.finish(attempt, 'released', now, undefined, { authorized: true })
  }

  private finish(row: Active, state: Terminal['state'], now: number, code?: string, extra?: Readonly<Record<string, unknown>>): void {
    const updated = terminal(row, state, now, code)
    const saved = this.put(updated)
    if (saved || row.state === 'releasing') {
      if (!this.host.auditTimer({ ...auditFields(row), ...extra, action: state === 'released' ? 'released' : 'release-' + state, ...(code === undefined ? {} : { code }), persisted: saved })) {
        this.host.warn('owner release outcome audit could not be written')
      }
    }
  }

  private put(row: Release): boolean {
    return this.save(new Map(this.rows).set(row.release, row))
  }

  private save(rows: Map<string, Release>): boolean {
    try { this.storage.write(Array.from(rows.values())) } catch {
      this.host.warn('owner release state could not be saved')
      return false
    }
    this.rows = rows
    return true
  }
}
