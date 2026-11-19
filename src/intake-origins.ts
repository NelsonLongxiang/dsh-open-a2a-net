/**
 * #697 reviews: the birth provenance of each superagent-intake task (owner ruling 2026-11-14, option B) — the caller, the
 * canvas team it asked, and the origin and key of the host it was admitted from. Keyed by the task, written once: a later
 * admission of the same caller handle from another host never replaces it (review R1). The rechecks for a task — the
 * team Source's signed admission query names the task — judge exactly that host's link under exactly that key. A task
 * with no record (unknown, pushed out by the cap, or an unreadable file) rechecks as not linked (fail closed). On disk,
 * mode 0600, newest last, at most {@link INTAKE_ORIGINS_MAX}.
 * @module @nelsonlongxiang/dsh-open-a2a-net/intake-origins
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const INTAKE_ORIGINS_MAX = 2048

export interface IntakeOrigin { readonly task: string; readonly caller: string; readonly team: string; readonly origin: string; readonly key: string; readonly at: number }

const valid = (r: unknown): r is IntakeOrigin => {
  const o = r as Partial<IntakeOrigin> | null
  return o !== null && typeof o === 'object' && [o.task, o.caller, o.team, o.origin, o.key].every(v => typeof v === 'string' && v !== '') && Number.isSafeInteger(o.at)
}

export class IntakeOrigins {
  private rows: IntakeOrigin[] = []

  constructor(private readonly path: string, private readonly now: () => number = () => Date.now()) {
    if (path === '' || !existsSync(path)) return
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { rows?: unknown }
      if (Array.isArray(raw.rows)) this.rows = raw.rows.filter(valid).slice(-INTAKE_ORIGINS_MAX)
    } catch { this.rows = [] /* unreadable: no intake task rechecks as linked (fail closed) */ }
  }

  /** The birth provenance of `task`, if it was admitted by intake (and is still kept). */
  of(task: string): IntakeOrigin | undefined { return this.rows.find(r => r.task === task) }

  /**
   * Keep `task`'s birth provenance. Written once: a task already recorded keeps its first record (a replay under another
   * host's key changes nothing). False when the task is already recorded with a different caller, team, origin or key.
   */
  record(entry: Omit<IntakeOrigin, 'at'>): boolean {
    const existing = this.of(entry.task)
    if (existing !== undefined) return existing.caller === entry.caller && existing.team === entry.team && existing.origin === entry.origin && existing.key === entry.key
    const next = [...this.rows, { ...entry, at: this.now() }].slice(-INTAKE_ORIGINS_MAX)
    if (this.path !== '') {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
      try { writeFileSync(tmp, JSON.stringify({ rows: next }), { mode: 0o600, flag: 'wx' }); renameSync(tmp, this.path) } finally { rmSync(tmp, { force: true }) }
    }
    this.rows = next
    return true
  }
}
