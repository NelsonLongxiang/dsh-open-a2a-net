/**
 * #697 review: the origin and key each superagent-intake caller was admitted under (owner ruling 2026-11-14, option B).
 * The rechecks — the authorization observer and the team Source's admission query — judge the link of exactly that
 * host under exactly that key, never a cached namesake. On disk (mode 0600), newest last, at most {@link INTAKE_ORIGINS_MAX}.
 * @module @nelsonlongxiang/dsh-open-a2a-net/intake-origins
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const INTAKE_ORIGINS_MAX = 1024

export interface IntakeOrigin { readonly origin: string; readonly key: string; readonly at: number }

export class IntakeOrigins {
  private rows: Array<[string, IntakeOrigin]> = []

  constructor(private readonly path: string, private readonly now: () => number = () => Date.now()) {
    if (path === '' || !existsSync(path)) return
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { rows?: unknown }
      if (Array.isArray(raw.rows)) this.rows = raw.rows.filter((r): r is [string, IntakeOrigin] => Array.isArray(r) && typeof r[0] === 'string' && r[1] !== null && typeof r[1] === 'object' && typeof (r[1] as IntakeOrigin).origin === 'string' && typeof (r[1] as IntakeOrigin).key === 'string' && Number.isSafeInteger((r[1] as IntakeOrigin).at)).slice(-INTAKE_ORIGINS_MAX)
    } catch { this.rows = [] /* unreadable: no intake caller rechecks as linked (fail closed) */ }
  }

  get(caller: string): IntakeOrigin | undefined { return this.rows.find(([c]) => c === caller)?.[1] }

  /** Keep the origin and key `caller` was just admitted under (a later admission replaces it). */
  record(caller: string, origin: string, key: string): void {
    const next: Array<[string, IntakeOrigin]> = [...this.rows.filter(([c]) => c !== caller), [caller, { origin, key, at: this.now() }] as [string, IntakeOrigin]].slice(-INTAKE_ORIGINS_MAX)
    if (this.path !== '') {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
      try { writeFileSync(tmp, JSON.stringify({ rows: next }), { mode: 0o600, flag: 'wx' }); renameSync(tmp, this.path) } finally { rmSync(tmp, { force: true }) }
    }
    this.rows = next
  }
}
