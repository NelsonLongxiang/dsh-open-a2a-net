/**
 * #688 R2: the turn facts each Pi seat sent that this host applied, on disk, so a replay after a restart is still
 * acknowledged as a duplicate and does nothing. An event is recorded only after its effect, and counts as seen only once
 * it is on disk (#688 C2): a fact whose effect or record failed is not acknowledged, and its retry is applied again. A
 * retry after the effect but before the record finds the binding the effect consumed gone, and is stale. Keyed by seat; each entry is `<run>:<event>`, newest last, at most
 * {@link PI_EVENTS_KEPT} per seat (a fact names its run, and a run's facts are a handful).
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/pi-events
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

export const PI_EVENTS_KEPT = 512

export class PiEvents {
  private readonly seen: Map<string, string[]>

  constructor(private readonly path: string) {
    this.seen = new Map()
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      for (const [seat, list] of Object.entries(raw)) if (Array.isArray(list)) this.seen.set(seat, list.filter((e): e is string => typeof e === 'string').slice(-PI_EVENTS_KEPT))
    } catch { /* none yet, or unreadable: start empty (a replay of a run that is no longer current is stale anyway) */ }
  }

  /** Whether the seat's fact was accepted before. */
  has(seat: string, run: string, event: string): boolean { return this.seen.get(seat)?.includes(`${run}:${event}`) === true }

  /** Record the seat's applied fact: written to disk first, then seen; a failed write throws and records nothing. */
  add(seat: string, run: string, event: string): void {
    const next = new Map(this.seen)
    next.set(seat, [...(next.get(seat) ?? []), `${run}:${event}`].slice(-PI_EVENTS_KEPT))
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
    try { writeFileSync(tmp, JSON.stringify(Object.fromEntries(next)), { mode: 0o600, flag: 'wx' }); renameSync(tmp, this.path) } finally { rmSync(tmp, { force: true }) }
    this.seen.set(seat, next.get(seat)!)
  }
}
