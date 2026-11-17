/**
 * #64 step 2 (owner ruling 2026-11-17, option C): the OriginClaim window measure that survives restarts. The in-memory
 * counters (legacyInbound, unboundInbound, boundMissInbound) restart at 0 with the process, so they never proved the
 * "7 consecutive days at zero" the unbound window closes on. This keeps one bucket per UTC day on disk — the three
 * counts, plus the fact that the host was running that day — and reads the streak of whole days at zero up to
 * yesterday. A day the host never ran is not a zero day: an absent bucket ends the streak.
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
}

export interface WindowMeasureView {
  /** The first day this host measured (its first bucket). */
  readonly since: string
  /** Whole UTC days before today, newest first, on which the host ran and all three counts stayed 0. */
  readonly zeroStreakDays: number
  /** The newest buckets, newest first (at most WINDOW_VIEW_DAYS). */
  readonly days: readonly WindowDay[]
}

/** Buckets kept on disk and shown on the state face. */
export const WINDOW_KEEP_DAYS = 30
export const WINDOW_VIEW_DAYS = 14

const DAY = /^\d{4}-\d{2}-\d{2}$/
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export class WindowMeasure {
  private days = new Map<string, { legacy: number; unbound: number; boundMiss: number }>()

  /**
   * @param path - the JSON file (under the a2a home); a missing or unreadable file starts empty, never throws.
   * @param now - the clock (tests inject one).
   * @param warn - where a failed write is reported; the counts stay in memory and the next write retries.
   */
  constructor(private readonly path: string, private readonly now: () => number = Date.now, private readonly warn: (message: string) => void = () => {}) {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as { days?: unknown }
        for (const row of Array.isArray(raw.days) ? raw.days as Array<Record<string, unknown>> : []) {
          if (row === null || typeof row !== 'object' || typeof row.day !== 'string' || !DAY.test(row.day)) continue
          this.days.set(row.day, { legacy: count(row.legacy), unbound: count(row.unbound), boundMiss: count(row.boundMiss) })
        }
      }
    } catch (error) { warn(`a2a: OriginClaim window measure unreadable, starting empty: ${String(error)}`) }
    this.touch()
  }

  /** Mark today as a measured day (boot and the daily tick call this), creating its bucket at zero. */
  touch(): void {
    const today = dayOf(this.now())
    if (this.days.has(today)) return
    this.days.set(today, { legacy: 0, unbound: 0, boundMiss: 0 })
    this.save()
  }

  note(counter: WindowCounter): void {
    const today = dayOf(this.now())
    const bucket = this.days.get(today) ?? { legacy: 0, unbound: 0, boundMiss: 0 }
    bucket[counter] += 1
    this.days.set(today, bucket)
    this.save()
  }

  view(): WindowMeasureView {
    const sorted = [...this.days.keys()].sort()
    const today = dayOf(this.now())
    let zeroStreakDays = 0
    for (let at = this.now() - 86_400_000; ; at -= 86_400_000) {
      const day = dayOf(at)
      const bucket = this.days.get(day)
      if (bucket === undefined || bucket.legacy + bucket.unbound + bucket.boundMiss > 0) break
      zeroStreakDays++
    }
    const since = sorted[0] ?? today
    const days = [...sorted].reverse().slice(0, WINDOW_VIEW_DAYS).map(day => ({ day, ...this.days.get(day)! }))
    return { since, zeroStreakDays, days }
  }

  private save(): void {
    const keep = [...this.days.keys()].sort().slice(-WINDOW_KEEP_DAYS)
    for (const day of [...this.days.keys()]) if (!keep.includes(day)) this.days.delete(day)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${String(process.pid)}.tmp`
      writeFileSync(tmp, JSON.stringify({ days: keep.map(day => ({ day, ...this.days.get(day)! })) }), { mode: 0o600 })
      renameSync(tmp, this.path)
    } catch (error) { this.warn(`a2a: OriginClaim window measure not written: ${String(error)}`) }
  }
}
