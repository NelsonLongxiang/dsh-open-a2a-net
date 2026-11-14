/**
 * #688: the turn facts each Pi seat sent, as this host has taken them, on disk. Each entry is `<run>:<event>` in one of
 * two states, newest last, at most {@link PI_EVENTS_KEPT} per seat:
 *
 * - `pending`: written to disk before the fact's effect runs. When it cannot be written, the fact is refused as retryable
 *   and nothing happens (re-review R2: no effect is ever applied without its record).
 * - `applied`: written after the effect. A replay of an applied fact is acknowledged as a duplicate and does nothing.
 *
 * Within one host process an event's effect runs at most once (the host also keeps the events it applied in memory, so a
 * failed `applied` write does not let a retry run it again). A `pending` entry found after a restart was taken by an earlier
 * process that may have stopped before or during its effect. A restart interrupts every running assignment and runs its
 * ticket again in a new run (executor.recover), so that fact is stale there and touches nothing; were its run still
 * current, it would run once in the new process (whose retry budgets and timers start afresh) and be recorded applied.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/pi-events
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

export const PI_EVENTS_KEPT = 512
export type PiEventState = 'pending' | 'applied'

export class PiEvents {
  private readonly seen: Map<string, Array<[string, PiEventState]>>

  constructor(private readonly path: string) {
    this.seen = new Map()
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      for (const [seat, list] of Object.entries(raw)) {
        if (!Array.isArray(list)) continue
        // Entries written before states (a bare string) were recorded after their effect: applied.
        const entries = list.flatMap((e): Array<[string, PiEventState]> => typeof e === 'string' ? [[e, 'applied']] : Array.isArray(e) && typeof e[0] === 'string' && (e[1] === 'pending' || e[1] === 'applied') ? [[e[0], e[1]]] : [])
        this.seen.set(seat, entries.slice(-PI_EVENTS_KEPT))
      }
    } catch { /* none yet, or unreadable: start empty (a replay of a run that is no longer current is stale anyway) */ }
  }

  /** The state the seat's fact was recorded in, if any. */
  state(seat: string, run: string, event: string): PiEventState | undefined {
    return this.seen.get(seat)?.find(([key]) => key === `${run}:${event}`)?.[1]
  }

  /** Record the seat's fact in `state`: written to disk first, then kept; a failed write throws and changes nothing. */
  record(seat: string, run: string, event: string, state: PiEventState): void {
    const key = `${run}:${event}`
    const next = new Map(this.seen)
    next.set(seat, [...(next.get(seat) ?? []).filter(([k]) => k !== key), [key, state] as [string, PiEventState]].slice(-PI_EVENTS_KEPT))
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
    try { writeFileSync(tmp, JSON.stringify(Object.fromEntries(next)), { mode: 0o600, flag: 'wx' }); renameSync(tmp, this.path) } finally { rmSync(tmp, { force: true }) }
    this.seen.set(seat, next.get(seat)!)
  }
}
