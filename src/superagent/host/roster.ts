/**
 * superagent-market-progress-roster P3: the team's roster report. Every canvas remote member of the team's canvas whose
 * verified card declares `teamRoster` gets a full snapshot of the team's seats (router, members, observers): who they
 * are, whether they are on line, and their load. Every 5 minutes, and 30 seconds after a change. A fire-and-forget
 * direct message from the host's process face (`[A2A roster]`, task id `roster-<host fp8>-<epoch ms>`): no debt, no queue
 * slot, no receipt owed. It is information for people, never authority.
 */

/** How often a snapshot goes out anyway, how long a change settles before it goes, and how often the team is looked at. */
export const ROSTER_EVERY_MS = 5 * 60_000
export const ROSTER_SETTLE_MS = 30_000
export const ROSTER_TICK_MS = 10_000
/** At most this many seats in one report. */
const ROSTER_SEATS_CAP = 64

export interface RosterSeat {
  seat: string
  /** Named dispatch N2: the seat's stable id, kept when its session is replaced (the market keys assignments on it). */
  seatId?: string
  name?: string
  team: string
  role: 'router' | 'member' | 'observer'
  online: boolean
  active: number
  queued: number
  lastActiveAt?: string
}

export interface RosterDeps {
  /** The team's canvas and the seats on it, by role (session ids); undefined when the team is bound to no canvas. */
  readonly team: () => { canvas: string; router?: string; members: readonly string[]; observers: readonly string[] } | undefined
  /** The canvas's remote members (pinned refs). */
  readonly remotes: (canvas: string) => readonly string[]
  readonly declares: (ref: string, capability: string) => boolean
  readonly send: (ref: string, text: string, taskId: string) => Promise<void>
  readonly handleOf: (sessionId: string) => string
  readonly nameOf: (sessionId: string) => string | undefined
  readonly online: (sessionId: string) => boolean
  readonly seatIdOf?: (sessionId: string) => string | undefined
  readonly loadOf: (sessionId: string) => { active: number; queued: number; since?: string }
  readonly hostFingerprint: () => string | undefined
  readonly nowMs: () => number
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

/** The team's seats as the report lists them. */
export function rosterSeats(d: Pick<RosterDeps, 'team' | 'handleOf' | 'nameOf' | 'online' | 'loadOf' | 'seatIdOf'>): RosterSeat[] {
  const team = d.team()
  if (team === undefined) return []
  const seats: RosterSeat[] = []
  const seen = new Set<string>()
  const add = (id: string | undefined, role: RosterSeat['role']): void => {
    if (id === undefined || id === '' || seen.has(id)) return
    seen.add(id)
    const seat = d.handleOf(id)
    const canvasAddress = `${seat.split('/')[0] ?? ''}/canvas/${team.canvas}`
    const name = d.nameOf(id)
    const load = role === 'member' ? d.loadOf(id) : { active: 0, queued: 0 }
    const seatId = d.seatIdOf?.(id)
    seats.push({ seat, ...(seatId !== undefined ? { seatId } : {}), ...(name !== undefined && name !== '' ? { name: name.slice(0, 200) } : {}), team: canvasAddress, role, online: d.online(id), active: load.active, queued: load.queued, ...(load.since !== undefined ? { lastActiveAt: load.since } : {}) })
  }
  add(team.router, 'router')
  for (const id of team.members) add(id, 'member')
  for (const id of team.observers) add(id, 'observer')
  return seats.slice(0, ROSTER_SEATS_CAP)
}

/** The report's text: the `[A2A roster]` line, then one JSON line. */
export function rosterText(host: string, at: string, seats: readonly RosterSeat[]): string {
  return `[A2A roster] ${host.slice(0, 8)} ${at}\n${JSON.stringify({ host, at, seats })}`
}

export class RosterReports {
  private stop: (() => void) | undefined
  private lastKey: string | undefined
  private lastSentAt = 0
  private changedAt: number | undefined
  private sending = false

  constructor(private readonly d: RosterDeps) {}

  start(interval: (fn: () => void, ms: number) => () => void): void { this.stop ??= interval(() => { void this.tick() }, ROSTER_TICK_MS) }
  close(): void { this.stop?.(); this.stop = undefined }

  /** One look at the team: a snapshot goes out when it is due (5 minutes on, or a change settled for 30 seconds). */
  async tick(): Promise<void> {
    if (this.sending) return
    const team = this.d.team()
    const host = this.d.hostFingerprint()
    if (team === undefined || host === undefined) return
    const targets = this.d.remotes(team.canvas).filter(ref => this.d.declares(ref, 'teamRoster'))
    if (targets.length === 0) return
    const now = this.d.nowMs()
    const seats = rosterSeats(this.d)
    // The view a change is judged on: everything but when a hold began.
    const key = JSON.stringify(seats.map(({ lastActiveAt: _at, ...rest }) => rest))
    if (key !== this.lastKey) this.changedAt ??= now
    const settled = this.changedAt !== undefined && now - this.changedAt >= ROSTER_SETTLE_MS
    if (!settled && now - this.lastSentAt < ROSTER_EVERY_MS) return
    this.sending = true
    try {
      const at = new Date(now).toISOString()
      const text = rosterText(host, at, seats)
      const taskId = `roster-${host.slice(0, 8)}-${String(now)}`
      let delivered = 0
      for (const ref of targets) {
        try { await this.d.send(ref, text, taskId); delivered++ } catch (error) { this.d.logger.warn('superagent: roster report to %s failed: %s', ref, String(error)) }
      }
      // None got through: the next tick tries again.
      if (delivered === 0) return
      this.lastKey = key
      this.lastSentAt = now
      this.changedAt = undefined
    } finally { this.sending = false }
  }
}
