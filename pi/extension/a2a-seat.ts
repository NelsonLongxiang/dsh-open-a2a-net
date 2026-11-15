/**
 * a2a-seat: a Pi extension that makes this Pi a superagent team member (docs/design/superagent-pi-platform.md P3–P6).
 *
 * The seat is the a2a-net CLI identity this Pi runs with (`a2a-net init`, `a2a-net publish --pi-seat`, deposited on the
 * team host). The team host writes the seat's work into that identity's mailbox; this extension polls the mailbox with
 * `a2a-net inbox --after <cursor>`, hands each piece of work to the Pi session, tells the host it was read, and tells it
 * when the run settles. The model answers with the `a2a-net ticket …` commands the work card names.
 *
 * Lifecycle rules (#688 reviews):
 * - One seat, one consumer: the cursor and state belong to the seat (handle + home host), and the seat's lock file is
 *   created exclusively and names its consumer with a token; only the token's holder reads the mailbox, and only it
 *   releases the lock. A lock of a dead process is reclaimed only under the seat's reclaim mutex, after reading again that
 *   the lock is still that dead holder's, and the lock moved aside is checked to be it (a live lock moved by mistake is
 *   put back without overwriting anything); never by overwriting, and an unreadable lock is left alone and reported.
 * - Facts are scoped and replay-safe: every turn fact (read, idle, error) names its ticket, the run of it (the work row's
 *   context id: each binding of a ticket has its own) and an event id made once and persisted, so the host acknowledges a
 *   replay without acting on it and ignores a fact that is not for the seat's current run. Owed facts are sent one at a
 *   time, oldest first, before any new work is fetched.
 * - A stop is a control row for one run (context id `stop.<run>`): it is shown to the Pi session, and that run's ticket
 *   leaves the in-flight list with no fact owed (the host has already let it go). It is never taken as new work.
 * - A fact the host refuses for good (the seat is no longer a member, or the fact is malformed) is not acknowledged and
 *   not retried forever: it is set aside with the refusal (kept as evidence, `refused`), its run counts as ended, and the
 *   mailbox is read again — so a stop for that run still arrives (#688 re-review R1). Work for an ended run (stopped,
 *   refused, or stopped in the same batch) is never handed to the session; only work of a new run is.
 * - In-flight work survives the consumer: the tickets handed over are recorded before the cursor moves; a consumer that
 *   finds tickets still in flight (its predecessor stopped without the run settling) owes an error for each of them.
 * - Shutdown fences: each session start opens a generation with its own AbortController; nothing from a closed
 *   generation hands work over, moves the cursor or sends a fact.
 * - The deposit is renewed every hour with `a2a-net publish --renew`, which keeps the piSeat declaration.
 *
 * Installed by `a2a-net pi install` into ~/.pi/agent/extensions/. It joins no team: the team's owner adds the handle to
 * the team canvas. Environment: A2A_NET (the CLI command, default `a2a-net`), A2A_SEAT_POLL_MS (default 15000).
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createHash, randomBytes } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One mailbox row as `a2a-net inbox --after` prints it. */
interface MailRow { readonly from?: string; readonly text?: string; readonly seq?: number; readonly task_id?: string; readonly context_id?: string }
interface AfterRead { readonly handle?: string; readonly next?: string; readonly mail?: readonly MailRow[]; readonly lost?: number | null; readonly epochChanged?: boolean; readonly cursorAhead?: boolean }
/** A turn fact the host has not acknowledged yet, scoped to its ticket and run, with an id made once. */
export interface OwedFact { readonly op: 'read' | 'idle' | 'error'; readonly ticket: string; readonly run: string; readonly event: string; readonly text?: string }
/** A ticket handed to the Pi session, in the run its work came in. */
export interface InflightWork { readonly ticket: string; readonly run: string }
/** A fact the host refused for good, kept as evidence with its refusal code. */
export interface RefusedFact extends OwedFact { readonly code: string; readonly at: string }
/** One seat's persisted consumer state. `ended`: runs that were stopped or whose facts were refused for good, newest last. */
export interface SeatState { readonly handle: string; readonly home: string; cursor: string; inflight: InflightWork[]; owed: OwedFact[]; ended: string[]; refused: RefusedFact[] }
/** The host's refusals that no retry changes: the fact is set aside, never sent again. */
export const TERMINAL_REFUSALS: readonly string[] = ['not-member', 'report', 'op']
const ENDED_KEPT = 128, REFUSED_KEPT = 32

/** The sender name the team host writes a seat's work under (src/index.ts piDeliver). */
export const TEAM_SENDER = 'superagent'
/** The context id prefix of a stop row: `stop.<run>` ends that run's work. */
export const STOP_PREFIX = 'stop.'
const CLI = process.env.A2A_NET ?? 'a2a-net'
const POLL_MS = Math.max(5_000, Number(process.env.A2A_SEAT_POLL_MS ?? 15_000) || 15_000)
const RENEW_MS = 60 * 60_000

const stateDir = (): string => join(homedir(), '.pi', 'agent', 'a2a-seat')
const newId = (): string => randomBytes(12).toString('base64url')

/** The state file of one seat: its handle and home host, never only this OS user. */
export function seatStatePath(handle: string, home: string, dir: string = stateDir()): string {
  const slug = handle.replace(/[^a-z0-9-]/gi, '_')
  return join(dir, `${slug}-${createHash('sha256').update(home).digest('hex').slice(0, 8)}.json`)
}

function loadState(path: string, handle: string, home: string): SeatState {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Partial<SeatState>
    if (stored.handle === handle && stored.home === home && typeof stored.cursor === 'string') {
      // Entries without a run (written before runs) cannot be scoped: the host would refuse them, so they are not kept.
      const inflight = Array.isArray(stored.inflight) ? stored.inflight.filter((w): w is InflightWork => w !== null && typeof w === 'object' && typeof w.ticket === 'string' && typeof w.run === 'string') : []
      const owed = Array.isArray(stored.owed) ? stored.owed.filter((f): f is OwedFact => f !== null && typeof f === 'object' && ['read', 'idle', 'error'].includes(String(f.op)) && typeof f.ticket === 'string' && typeof f.run === 'string' && typeof f.event === 'string') : []
      const ended = Array.isArray(stored.ended) ? stored.ended.filter((r): r is string => typeof r === 'string').slice(-ENDED_KEPT) : []
      const refused = Array.isArray(stored.refused) ? stored.refused.filter((f): f is RefusedFact => f !== null && typeof f === 'object' && typeof f.ticket === 'string' && typeof f.code === 'string').slice(-REFUSED_KEPT) : []
      return { handle, home, cursor: stored.cursor, inflight, owed, ended, refused }
    }
  } catch { /* no state yet */ }
  return { handle, home, cursor: 'start', inflight: [], owed: [], ended: [], refused: [] }
}

function saveState(path: string, state: SeatState): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.${process.pid}.${newId()}.tmp`
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  renameSync(tmp, path)
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as { code?: string }).code === 'EPERM' }
}

/** The lock's holder as written, or undefined when the file is missing; 'unreadable' when it is not a lock this code wrote. */
function readLock(lock: string): { pid: number; token: string } | 'unreadable' | undefined {
  let text: string
  try { text = readFileSync(lock, 'utf8') } catch (error) { return (error as { code?: string }).code === 'ENOENT' ? undefined : 'unreadable' }
  try {
    const holder = JSON.parse(text) as { pid?: unknown; token?: unknown }
    return Number.isInteger(holder.pid) && typeof holder.token === 'string' ? { pid: holder.pid as number, token: holder.token } : 'unreadable'
  } catch { return 'unreadable' }
}

const create = (file: string, token: string): boolean => {
  try { writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { mode: 0o600, flag: 'wx' }); return true } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
    return false
  }
}

/**
 * Move `file` aside only if it still is the lock of `expected` (a dead holder's token). The move is checked afterwards: if
 * what was moved is not `expected`'s (another contender put a live lock there in between), it is put back with a hard link,
 * which never overwrites, and the move counts for nothing. #688 review R1: an atomic rename does not compare ownership.
 */
export function moveAsideIf(file: string, expected: string): boolean {
  const before = readLock(file)
  if (before === undefined || before === 'unreadable' || before.token !== expected) return false
  const aside = `${file}.stale-${newId()}`
  try { renameSync(file, aside) } catch { return false }
  const moved = readLock(aside)
  if (moved !== undefined && moved !== 'unreadable' && moved.token === expected) { rmSync(aside, { force: true }); return true }
  try { linkSync(aside, file) } catch { /* a new lock is already there: the moved one's owner finds it is not its own and stops */ }
  rmSync(aside, { force: true })
  return false
}

/**
 * The seat's reclaim mutex: only its holder may move a dead consumer's lock aside. Taken by exclusive create; a mutex left
 * by a dead reclaimer is moved aside the same checked way. Released only by its holder.
 */
function takeReclaim(mutex: string, token: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (create(mutex, token)) return true
    const holder = readLock(mutex)
    if (holder === 'unreadable') return false
    if (holder === undefined) continue
    if (alive(holder.pid)) return false
    moveAsideIf(mutex, holder.token)
  }
  return false
}

/**
 * Reclaim the seat's lock from a dead holder seen as `dead`: under the reclaim mutex, read the lock again and move it aside
 * only if it still is that dead holder's. A contender that saw the same dead lock but comes second finds a live lock (or
 * none) and leaves it alone.
 */
export function reclaimSeatLock(path: string, dead: string, token: string): void {
  const lock = `${path}.lock`, mutex = `${lock}.reclaim`
  if (!takeReclaim(mutex, token)) return
  try {
    const again = readLock(lock)
    if (again !== undefined && again !== 'unreadable' && again.token === dead && !alive(again.pid)) moveAsideIf(lock, dead)
  } finally {
    const held = readLock(mutex)
    if (held !== undefined && held !== 'unreadable' && held.token === token) rmSync(mutex, { force: true })
  }
}

/**
 * Take the seat's lock for `token`: exclusive create; a dead holder's lock is reclaimed under the reclaim mutex
 * ({@link reclaimSeatLock}) and the create tried again. Never overwrites a lock, never takes an unreadable one.
 * @returns 'taken', 'held' (a live consumer has it, or another contender is reclaiming it), or 'unreadable'.
 */
export function takeSeatLock(path: string, token: string): 'taken' | 'held' | 'unreadable' {
  const lock = `${path}.lock`
  mkdirSync(join(path, '..'), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    if (create(lock, token)) return 'taken'
    const holder = readLock(lock)
    if (holder === 'unreadable') return 'unreadable'
    if (holder === undefined) continue
    if (holder.token === token) return 'taken'
    if (alive(holder.pid)) return 'held'
    reclaimSeatLock(path, holder.token, token)
  }
  return 'held'
}

/** Whether `token` still holds the seat's lock. */
export function holdsSeatLock(path: string, token: string): boolean {
  const holder = readLock(`${path}.lock`)
  return holder !== undefined && holder !== 'unreadable' && holder.token === token
}

/** Release the seat's lock only if `token` holds it. */
export function dropSeatLock(path: string, token: string): void {
  if (holdsSeatLock(path, token)) { try { rmSync(`${path}.lock`) } catch { /* already gone */ } }
}

export default function a2aSeat(pi: ExtensionAPI): void {
  /** The current generation: every session start opens one, shutdown closes it. */
  let generation = 0
  let abort: AbortController | undefined
  let poller: ReturnType<typeof setInterval> | undefined
  let renewer: ReturnType<typeof setInterval> | undefined
  let seat: { path: string; state: SeatState; token: string } | undefined
  let polling = false
  /** Owed facts go out one at a time (poll and settle share this chain). */
  let flushing: Promise<boolean> = Promise.resolve(true)
  const warned = new Set<string>()

  const warn = (ctx: ExtensionContext, key: string, message: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    if (ctx.hasUI) ctx.ui.notify(`a2a-seat: ${message}`, 'warning')
  }
  const current = (gen: number): boolean => gen === generation && abort !== undefined && !abort.signal.aborted
  /** This generation still consumes the seat: not shut down, and the lock is still its own. */
  const owns = (gen: number): boolean => current(gen) && seat !== undefined && holdsSeatLock(seat.path, seat.token)

  const cli = async (gen: number, args: string[]): Promise<{ code: number; stdout: string } | undefined> => {
    if (!current(gen)) return undefined
    try {
      const out = await pi.exec(CLI, args, { timeout: 60_000, ...(abort !== undefined ? { signal: abort.signal } : {}) })
      return current(gen) ? { code: out.code, stdout: out.stdout } : undefined
    } catch { return current(gen) ? { code: 1, stdout: '' } : undefined }
  }

  const factArgs = (fact: OwedFact): string[] => {
    const scope = ['--ticket', fact.ticket, '--run', fact.run, '--event', fact.event, '--json']
    if (fact.op === 'error') return ['ticket', 'error', '--transient', ...scope, '--', fact.text ?? 'the Pi run did not settle']
    return ['ticket', fact.op, ...scope]
  }

  /** A run that is over here (stopped, or its facts refused for good): out of flight, and its work is never handed over. */
  const endRun = (ticket: string, run: string): void => {
    if (seat === undefined) return
    seat.state.inflight = seat.state.inflight.filter(w => !(w.ticket === ticket && w.run === run))
    if (!seat.state.ended.includes(run)) seat.state.ended = [...seat.state.ended, run].slice(-ENDED_KEPT)
  }

  /** Send the owed facts, oldest first, one at a time; true when none is left owed. */
  const flushOwed = (gen: number, ctx: ExtensionContext): Promise<boolean> => {
    flushing = flushing.then(async () => {
      while (seat !== undefined && seat.state.owed.length > 0) {
        if (!owns(gen)) return false
        const fact = seat.state.owed[0]!
        const out = await cli(gen, factArgs(fact))
        if (out === undefined || seat === undefined) return false
        if (out.code !== 0) {
          let refusal: { ok?: unknown; code?: unknown; retryable?: unknown } | undefined
          try { refusal = JSON.parse(out.stdout) as typeof refusal } catch { /* no answer: the transport failed */ }
          const code = typeof refusal?.code === 'string' ? refusal.code : undefined
          if (refusal?.ok === false && code !== undefined && refusal.retryable !== true && TERMINAL_REFUSALS.includes(code)) {
            // Refused for good: set aside as evidence (never counted as taken), its run ended, and the mailbox read on.
            warn(ctx, `refused-${fact.run}`, `the team host refused ticket ${fact.ticket} (${fact.op}): ${code}; this run is ended here and its facts are kept in ${seat.path}`)
            endRun(fact.ticket, fact.run)
            seat.state.refused = [...seat.state.refused, { ...fact, code, at: new Date().toISOString() }].slice(-REFUSED_KEPT)
            seat.state.owed = seat.state.owed.filter(f => f.event !== fact.event)
            saveState(seat.path, seat.state)
            continue
          }
          warn(ctx, 'owed', `telling the team host about ticket ${fact.ticket} (${fact.op}) failed; retrying on the next poll`)
          return false
        }
        warned.delete('owed')
        seat.state.owed = seat.state.owed.filter(f => f.event !== fact.event)
        saveState(seat.path, seat.state)
      }
      return true
    }, () => false)
    return flushing
  }

  /** Every ticket still in flight now owes a fact (the run settled, was aborted, or its consumer is gone). */
  const settleInflight = (op: 'idle' | 'error', text?: string): void => {
    if (seat === undefined || seat.state.inflight.length === 0) return
    for (const { ticket, run } of seat.state.inflight) seat.state.owed.push({ op, ticket, run, event: newId(), ...(text !== undefined ? { text } : {}) })
    seat.state.inflight = []
    saveState(seat.path, seat.state)
  }

  const poll = async (gen: number, ctx: ExtensionContext): Promise<void> => {
    if (polling || seat === undefined) return
    if (!owns(gen)) { warn(ctx, 'lost-lock', 'this session no longer holds the seat lock and stops consuming'); return }
    polling = true
    try {
      if (!(await flushOwed(gen, ctx))) return
      const { state, path } = seat
      const out = await cli(gen, ['inbox', '--after', state.cursor])
      if (out === undefined) return
      if (out.code !== 0) { warn(ctx, 'inbox', 'reading the mailbox failed; retrying on the next poll'); return }
      warned.delete('inbox')
      const read = JSON.parse(out.stdout) as AfterRead
      if (read.handle !== state.handle) { warn(ctx, 'handle', `the CLI read the mailbox of ${String(read.handle)}, not ${state.handle}; this seat stops consuming`); return }
      if (read.cursorAhead === true) { warn(ctx, 'ahead', `the stored cursor ${state.cursor} was not issued by ${state.home}; nothing is read until it is reset (delete ${path})`); return }
      if (read.lost === null || (typeof read.lost === 'number' && read.lost > 0) || read.epochChanged === true) warn(ctx, `lost-${String(read.next)}`, read.epochChanged === true ? 'the team host restarted its mailbox store: mail from before may be gone' : `${String(read.lost)} message(s) were pushed out of the mailbox before they were read`)
      // Work names its ticket (task id) and its run (context id); a row without both is not work this seat can account for.
      // A stop names the run it ends as `stop.<run>` (#688 C1).
      const team = (read.mail ?? []).filter(row => row.from === TEAM_SENDER && typeof row.text === 'string' && row.text !== '' && typeof row.task_id === 'string' && row.task_id !== '' && typeof row.context_id === 'string' && row.context_id !== '')
      const stops = team.filter(row => (row.context_id as string).startsWith(STOP_PREFIX) && (row.context_id as string).length > STOP_PREFIX.length)
      // Work of a run already ended here, or stopped in this same batch, is not handed over.
      const stopped = new Set(stops.map(row => (row.context_id as string).slice(STOP_PREFIX.length)))
      const work = team.filter(row => !(row.context_id as string).startsWith(STOP_PREFIX) && !state.ended.includes(row.context_id as string) && !stopped.has(row.context_id as string))
      if (!owns(gen)) return
      // In flight first (durable), then the handover, then the cursor and the read facts: a consumer that dies in between
      // leaves its successor the tickets to account for, never a silent gap.
      if (work.length > 0) {
        const known = new Set(state.inflight.map(w => `${w.ticket}\u0000${w.run}`))
        for (const row of work) {
          const key = `${row.task_id as string}\u0000${row.context_id as string}`
          if (!known.has(key)) { known.add(key); state.inflight.push({ ticket: row.task_id as string, run: row.context_id as string }) }
        }
        saveState(path, state)
      }
      for (const row of work) {
        if (ctx.isIdle()) pi.sendUserMessage(row.text as string)
        else pi.sendUserMessage(row.text as string, { deliverAs: 'followUp' })
      }
      for (const row of stops) {
        endRun(row.task_id as string, (row.context_id as string).slice(STOP_PREFIX.length))
        if (ctx.isIdle()) pi.sendUserMessage(row.text as string)
        else pi.sendUserMessage(row.text as string, { deliverAs: 'followUp' })
      }
      if (typeof read.next === 'string') state.cursor = read.next
      for (const row of work) state.owed.push({ op: 'read', ticket: row.task_id as string, run: row.context_id as string, event: newId() })
      saveState(path, state)
      await flushOwed(gen, ctx)
    } catch (error) {
      warn(ctx, 'poll', `mailbox poll failed: ${String(error)}`)
    } finally {
      polling = false
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    generation += 1
    const gen = generation
    abort?.abort()
    abort = new AbortController()
    const who = await cli(gen, ['whoami', '--json'])
    if (who === undefined) return
    let handle: unknown, home: unknown
    try { ({ handle, host: home } = JSON.parse(who.stdout) as { handle?: unknown; host?: unknown }) } catch { /* below */ }
    if (who.code !== 0 || typeof handle !== 'string' || typeof home !== 'string') { warn(ctx, 'whoami', 'no a2a-net identity: run a2a-net init and a2a-net publish --pi-seat'); return }
    const path = seatStatePath(handle, home)
    const token = newId()
    const lock = takeSeatLock(path, token)
    if (lock === 'unreadable') { warn(ctx, 'lock', `the seat lock ${path}.lock is not one this extension wrote; remove it if no Pi consumes ${handle}`); return }
    if (lock !== 'taken') { warn(ctx, 'lock', `another Pi consumer holds seat ${handle}; this session does not consume it`); return }
    if (!current(gen)) { dropSeatLock(path, token); return }
    seat = { path, state: loadState(path, handle, home), token }
    // A predecessor that stopped without its run settling left tickets in flight: each owes an error, scoped to its ticket.
    settleInflight('error', 'the Pi consumer stopped before the run settled')
    void poll(gen, ctx)
    poller = setInterval(() => { void poll(gen, ctx) }, POLL_MS)
    renewer = setInterval(() => { void cli(gen, ['publish', '--renew']).then(out => { if (out !== undefined && out.code !== 0) warn(ctx, 'renew', 're-publishing the seat deposit failed') }) }, RENEW_MS)
  })

  pi.on('agent_settled', async (event, ctx) => {
    if (seat === undefined || !owns(generation)) return
    settleInflight(event.aborted ? 'error' : 'idle', event.aborted ? 'the Pi run was aborted' : undefined)
    await flushOwed(generation, ctx)
  })

  pi.on('session_shutdown', async () => {
    const closing = seat
    // Close the generation first: an in-flight poll from it can no longer hand work over, move the cursor or send a fact.
    generation += 1
    abort?.abort()
    abort = undefined
    if (poller !== undefined) clearInterval(poller)
    if (renewer !== undefined) clearInterval(renewer)
    poller = undefined
    renewer = undefined
    if (closing !== undefined && holdsSeatLock(closing.path, closing.token)) {
      seat = closing
      settleInflight('error', 'the Pi session closed before the run settled')
      dropSeatLock(closing.path, closing.token)
    }
    seat = undefined
    polling = false
  })
}
