/**
 * #64 step 2 (owner ruling 2026-11-17, option C): the OriginClaim window measure that survives restarts. The in-memory
 * counters (legacyInbound, unboundInbound, boundMissInbound) restart at 0 with the process, so they never proved the
 * "7 consecutive days at zero" the unbound window closes on. This keeps one bucket per UTC day on disk — the three
 * counts, plus the fact that the host was running that day — and reads the streak of whole days at zero up to
 * yesterday.
 *
 * Unknown is never zero (#727 review R1/R2):
 * - a day the host never ran has no bucket and ends the streak;
 * - a persisted bucket whose counts are missing or not non-negative integers is kept as `invalid` and ends the streak;
 * - a failed write leaves the measure dirty: the next note or hourly touch retries it, and close() tries once more;
 * - each run records on disk that it has not ended cleanly yet; close() marks it clean only when nothing is left
 *   unwritten. A boot that finds the previous run unclean (a crash, or a write that never landed) marks every day of
 *   that run invalid, because an event of that run may be missing from disk;
 * - a run proves the time it covered only by what reached disk: its start, the hourly touch and its close each record
 *   `lastSeenAt`. A boot more than RESTART_GRACE_MS after the previous run's last recorded moment marks every day of
 *   that gap invalid — the host may have been down, or running without being able to write (#727 re-review R2: a run
 *   whose very first marker never landed leaves the previous run's clean marker behind). A short restart is covered.
 * @module window-measure
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type WindowCounter = 'legacy' | 'unbound' | 'boundMiss'

export interface WindowDay {
  /** UTC calendar day, YYYY-MM-DD. */
  readonly day: string
  readonly legacy: number
  readonly unbound: number
  readonly boundMiss: number
  /** The day's evidence is unknown: a damaged record, or a run that did not end with everything written. */
  readonly invalid?: true
}

export interface WindowMeasureView {
  /** The first day this host measured (its oldest bucket). */
  readonly since: string
  /** Whole UTC days before today, newest first, on which the host ran, the record is valid and all three counts were 0. */
  readonly zeroStreakDays: number
  /** False while a change is not yet on disk (a write failed and has not been retried successfully). */
  readonly persisted: boolean
  /** The newest buckets, newest first (at most WINDOW_VIEW_DAYS). */
  readonly days: readonly WindowDay[]
}

/** Buckets kept on disk and shown on the state face. */
export const WINDOW_KEEP_DAYS = 30
export const WINDOW_VIEW_DAYS = 14
/** The longest gap between one run's last recorded moment and the next boot that still counts as a restart. */
export const RESTART_GRACE_MS = 5 * 60_000

type Bucket = { legacy: number; unbound: number; boundMiss: number; invalid?: true }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export class WindowMeasure {
  private days = new Map<string, Bucket>()
  /** The day this run started (written to disk with clean: false until close()). */
  private readonly runSince: string
  private dirty = false
  private clean = false

  /**
   * @param path - the JSON file (under the a2a home); a missing or unreadable file starts empty, never throws.
   * @param now - the clock (tests inject one).
   * @param warn - where a damaged record, an unclean previous run or a failed write is reported.
   */
  constructor(private readonly path: string, private readonly now: () => number = Date.now, private readonly warn: (message: string) => void = () => {}) {
    this.runSince = dayOf(now())
    let previous: { since?: unknown; clean?: unknown; lastSeenAt?: unknown } | undefined
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as { days?: unknown; run?: unknown }
        let damaged = 0
        for (const row of Array.isArray(raw.days) ? raw.days as Array<Record<string, unknown>> : []) {
          if (row === null || typeof row !== 'object' || typeof row.day !== 'string' || !DAY.test(row.day)) { damaged++; continue }
          if (row.invalid === true || !valid(row.legacy) || !valid(row.unbound) || !valid(row.boundMiss)) {
            if (row.invalid !== true) damaged++
            this.days.set(row.day, { legacy: valid(row.legacy) ? row.legacy : 0, unbound: valid(row.unbound) ? row.unbound : 0, boundMiss: valid(row.boundMiss) ? row.boundMiss : 0, invalid: true })
            continue
          }
          this.days.set(row.day, { legacy: row.legacy, unbound: row.unbound, boundMiss: row.boundMiss })
        }
        if (damaged > 0) warn(`a2a: OriginClaim window measure: ${String(damaged)} damaged day record(s) kept as invalid (unknown, never zero)`)
        if (raw.run !== null && typeof raw.run === 'object') previous = raw.run as { since?: unknown; clean?: unknown; lastSeenAt?: unknown }
      }
    } catch (error) { warn(`a2a: OriginClaim window measure unreadable, starting empty: ${String(error)}`) }
    if (previous !== undefined && previous.clean !== true) {
      // The previous run did not end with everything on disk: any of its days may be missing an event.
      const since = typeof previous.since === 'string' && DAY.test(previous.since) ? previous.since : ''
      let marked = 0
      for (const [day, bucket] of this.days) if (day >= since && bucket.invalid !== true) { bucket.invalid = true; marked++ }
      if (marked > 0) warn(`a2a: OriginClaim window measure: the previous run did not end cleanly; ${String(marked)} of its day(s) marked invalid`)
    }
    // Coverage: the time from the previous run's last recorded moment to now is unmeasured unless it is a short restart.
    // No record at all (first boot, or a file without run data) leaves today's earlier hours unmeasured too.
    const nowMs = now()
    const lastSeen = previous !== undefined && typeof previous.lastSeenAt === 'number' && Number.isFinite(previous.lastSeenAt) && previous.lastSeenAt <= nowMs ? previous.lastSeenAt : undefined
    if (lastSeen === undefined || nowMs - lastSeen > RESTART_GRACE_MS) {
      let marked = 0
      for (let day = dayOf(lastSeen ?? nowMs); day <= this.runSince; day = dayOf(Date.parse(`${day}T00:00:00Z`) + 86_400_000)) {
        const bucket = this.days.get(day) ?? { legacy: 0, unbound: 0, boundMiss: 0 }
        if (bucket.invalid !== true) { bucket.invalid = true; marked++ }
        this.days.set(day, bucket)
      }
      if (lastSeen !== undefined && marked > 0) warn(`a2a: OriginClaim window measure: ${String(Math.round((nowMs - lastSeen) / 60_000))} min since the previous run's last record; ${String(marked)} day(s) not fully measured marked invalid`)
    }
    this.touch()
    this.save()
  }

  /** Mark today as a measured day and record that the run is alive (boot and the hourly tick call this); retries a failed write. */
  touch(): void {
    const today = dayOf(this.now())
    if (!this.days.has(today)) this.days.set(today, { legacy: 0, unbound: 0, boundMiss: 0 })
    this.save()
  }

  note(counter: WindowCounter): void {
    const today = dayOf(this.now())
    const bucket = this.days.get(today) ?? { legacy: 0, unbound: 0, boundMiss: 0 }
    bucket[counter] += 1
    this.days.set(today, bucket)
    this.save()
  }

  /** End of run: write anything left, then mark the run clean only if nothing is unwritten. */
  close(): void {
    if (this.dirty) this.save()
    if (this.dirty) { this.warn('a2a: OriginClaim window measure: closing with unwritten changes; the next boot marks this run invalid'); return }
    this.clean = true
    this.save()
  }

  view(): WindowMeasureView {
    const sorted = [...this.days.keys()].sort()
    const today = dayOf(this.now())
    let zeroStreakDays = 0
    for (let at = this.now() - 86_400_000; ; at -= 86_400_000) {
      const bucket = this.days.get(dayOf(at))
      if (bucket === undefined || bucket.invalid === true || bucket.legacy + bucket.unbound + bucket.boundMiss > 0) break
      zeroStreakDays++
    }
    const since = sorted[0] ?? today
    const days = [...sorted].reverse().slice(0, WINDOW_VIEW_DAYS).map(day => ({ day, ...this.days.get(day)! }))
    return { since, zeroStreakDays, persisted: !this.dirty, days }
  }

  private save(): void {
    const keep = [...this.days.keys()].sort().slice(-WINDOW_KEEP_DAYS)
    for (const day of [...this.days.keys()]) if (!keep.includes(day)) this.days.delete(day)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${String(process.pid)}.tmp`
      const body = { run: { since: this.runSince, clean: this.clean, lastSeenAt: this.now() }, days: keep.map(day => ({ day, ...this.days.get(day)! })) }
      writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 })
      renameSync(tmp, this.path)
      this.dirty = false
    } catch (error) {
      this.dirty = true
      this.warn(`a2a: OriginClaim window measure not written (retried on the next note or hourly touch): ${String(error)}`)
    }
  }
}
