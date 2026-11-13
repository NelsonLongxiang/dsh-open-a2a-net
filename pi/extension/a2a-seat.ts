/**
 * a2a-seat: a Pi extension that makes this Pi a superagent team member (docs/design/superagent-pi-platform.md P3–P6).
 *
 * The seat is the a2a-net CLI identity this Pi runs with (`a2a-net init`, `a2a-net publish --pi-seat`, deposited on the
 * team host). The team host writes the seat's work into that identity's mailbox; this extension polls the mailbox with
 * `a2a-net inbox --after <cursor>`, hands each piece of work to the Pi session, tells the host it was read, and tells it
 * when the run settles. The model answers with the `a2a-net ticket …` commands the work card names.
 *
 * Lifecycle rules (#688 review):
 * - F1: the cursor belongs to one seat — its handle and home host — and is kept in that seat's own state file. A read
 *   that names another handle, a cursor the host never issued, and lost mail are reported, never silently accepted.
 *   One Pi session at a time consumes a seat (a lock file names the consuming process).
 * - F2: a turn end (idle, or an error when the run was aborted) and a read acknowledgement are owed facts: they are kept,
 *   in the state file too, until the CLI succeeds, and retried on later polls. Owed facts are settled before any new work
 *   is handed over, so an old turn end can never settle newer work.
 * - F3: every session start opens a generation with its own AbortController; shutdown aborts it, and nothing from an old
 *   generation hands work over, moves the cursor or acknowledges anything.
 * - F4: the extension re-publishes the deposit every hour with `a2a-net publish --renew`, which signs the declarations
 *   of the last explicit publish (piSeat stays declared).
 *
 * Installed by `a2a-net pi install` into ~/.pi/agent/extensions/. It joins no team: the team's owner adds the handle to
 * the team canvas. Environment: A2A_NET (the CLI command, default `a2a-net`), A2A_SEAT_POLL_MS (default 15000).
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One mailbox row as `a2a-net inbox --after` prints it. */
interface MailRow { readonly from?: string; readonly text?: string; readonly seq?: number; readonly task_id?: string }
interface AfterRead { readonly handle?: string; readonly next?: string; readonly mail?: readonly MailRow[]; readonly lost?: number | null; readonly epochChanged?: boolean; readonly cursorAhead?: boolean }
/** A turn end the host has not acknowledged yet. */
type OwedEnd = { readonly op: 'idle' } | { readonly op: 'error'; readonly text: string }
/** One seat's persisted consumer state. */
interface SeatState { readonly handle: string; readonly home: string; cursor: string; owedEnd?: OwedEnd; owedRead?: boolean }

/** The sender name the team host writes a seat's work under (src/index.ts piDeliver). */
export const TEAM_SENDER = 'superagent'
const CLI = process.env.A2A_NET ?? 'a2a-net'
const POLL_MS = Math.max(5_000, Number(process.env.A2A_SEAT_POLL_MS ?? 15_000) || 15_000)
const RENEW_MS = 60 * 60_000
const STATE_DIR = join(homedir(), '.pi', 'agent', 'a2a-seat')

/** The state file of one seat: its handle and home host, never only this OS user. */
export function seatStatePath(handle: string, home: string, dir: string = STATE_DIR): string {
  const slug = handle.replace(/[^a-z0-9-]/gi, '_')
  return join(dir, `${slug}-${createHash('sha256').update(home).digest('hex').slice(0, 8)}.json`)
}

function loadState(path: string, handle: string, home: string): SeatState {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Partial<SeatState>
    if (stored.handle === handle && stored.home === home && typeof stored.cursor === 'string') return { handle, home, cursor: stored.cursor, ...(stored.owedEnd !== undefined ? { owedEnd: stored.owedEnd } : {}), ...(stored.owedRead === true ? { owedRead: true } : {}) }
  } catch { /* no state yet */ }
  return { handle, home, cursor: 'start' }
}

function saveState(path: string, state: SeatState): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  renameSync(tmp, path)
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as { code?: string }).code === 'EPERM' }
}

/** One consumer per seat: take the lock unless another live process holds it. */
function takeLock(path: string): boolean {
  const lock = `${path}.lock`
  try {
    const holder = Number(JSON.parse(readFileSync(lock, 'utf8')).pid)
    if (Number.isInteger(holder) && holder !== process.pid && alive(holder)) return false
  } catch { /* free, or unreadable: take it */ }
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), { mode: 0o600 })
  return true
}

function dropLock(path: string): void {
  const lock = `${path}.lock`
  try { if (Number(JSON.parse(readFileSync(lock, 'utf8')).pid) === process.pid) rmSync(lock) } catch { /* not ours */ }
}

export default function a2aSeat(pi: ExtensionAPI): void {
  /** The current generation: every session start opens one, shutdown closes it. */
  let generation = 0
  let abort: AbortController | undefined
  let poller: ReturnType<typeof setInterval> | undefined
  let renewer: ReturnType<typeof setInterval> | undefined
  let seat: { path: string; state: SeatState } | undefined
  let polling = false
  /** Team work reached this session since the last turn end was recorded as owed. */
  let working = false
  const warned = new Set<string>()

  const warn = (ctx: ExtensionContext, key: string, message: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    if (ctx.hasUI) ctx.ui.notify(`a2a-seat: ${message}`, 'warning')
  }
  const current = (gen: number): boolean => gen === generation && abort !== undefined && !abort.signal.aborted

  const cli = async (gen: number, args: string[]): Promise<{ code: number; stdout: string } | undefined> => {
    if (!current(gen)) return undefined
    try {
      const out = await pi.exec(CLI, args, { timeout: 60_000, ...(abort !== undefined ? { signal: abort.signal } : {}) })
      return current(gen) ? { code: out.code, stdout: out.stdout } : undefined
    } catch { return current(gen) ? { code: 1, stdout: '' } : undefined }
  }

  /** F2: settle what the host is owed, oldest first; false while something is still owed (no new work then). */
  const flushOwed = async (gen: number, ctx: ExtensionContext): Promise<boolean> => {
    if (seat === undefined) return false
    const { state, path } = seat
    if (state.owedEnd !== undefined) {
      const end = state.owedEnd
      const out = await cli(gen, end.op === 'idle' ? ['ticket', 'idle'] : ['ticket', 'error', '--transient', '--', end.text])
      if (out === undefined) return false
      if (out.code !== 0) { warn(ctx, 'owed-end', `telling the team host the turn ended failed; retrying on the next poll`); return false }
      state.owedEnd = undefined
      warned.delete('owed-end')
      saveState(path, state)
    }
    if (state.owedRead === true) {
      const out = await cli(gen, ['ticket', 'read'])
      if (out === undefined) return false
      if (out.code !== 0) { warn(ctx, 'owed-read', 'telling the team host the work was read failed; retrying on the next poll'); return false }
      state.owedRead = undefined
      warned.delete('owed-read')
      saveState(path, state)
    }
    return true
  }

  const poll = async (gen: number, ctx: ExtensionContext): Promise<void> => {
    if (polling || seat === undefined || !current(gen)) return
    polling = true
    try {
      if (!(await flushOwed(gen, ctx))) return
      const { state, path } = seat
      const out = await cli(gen, ['inbox', '--after', state.cursor])
      if (out === undefined) return
      if (out.code !== 0) { warn(ctx, 'inbox', 'reading the mailbox failed; retrying on the next poll'); return }
      warned.delete('inbox')
      const read = JSON.parse(out.stdout) as AfterRead
      // F1: the read must be this seat's mailbox, at a cursor its host issued.
      if (read.handle !== state.handle) { warn(ctx, 'handle', `the CLI read the mailbox of ${String(read.handle)}, not ${state.handle}; this seat stops consuming`); return }
      if (read.cursorAhead === true) { warn(ctx, 'ahead', `the stored cursor ${state.cursor} was not issued by ${state.home}; nothing is read until it is reset (delete ${path})`); return }
      if (read.lost === null || (typeof read.lost === 'number' && read.lost > 0) || read.epochChanged === true) warn(ctx, `lost-${String(read.next)}`, read.epochChanged === true ? 'the team host restarted its mailbox store: mail from before may be gone' : `${String(read.lost)} message(s) were pushed out of the mailbox before they were read`)
      const work = (read.mail ?? []).filter(row => row.from === TEAM_SENDER && typeof row.text === 'string' && row.text !== '')
      if (!current(gen)) return
      for (const row of work) {
        if (ctx.isIdle()) pi.sendUserMessage(row.text as string)
        else pi.sendUserMessage(row.text as string, { deliverAs: 'followUp' })
        working = true
      }
      // The cursor moves only after the work is handed over (a crash in between delivers it again, never loses it), and the
      // read acknowledgement it owes is recorded with it.
      if (typeof read.next === 'string') state.cursor = read.next
      if (work.length > 0) state.owedRead = true
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
    if (!takeLock(path)) { warn(ctx, 'lock', `another Pi process is consuming seat ${handle}; this session does not`); return }
    if (!current(gen)) { dropLock(path); return }
    seat = { path, state: loadState(path, handle, home) }
    void poll(gen, ctx)
    poller = setInterval(() => { void poll(gen, ctx) }, POLL_MS)
    renewer = setInterval(() => { void cli(gen, ['publish', '--renew']).then(out => { if (out !== undefined && out.code !== 0) warn(ctx, 'renew', 're-publishing the seat deposit failed') }) }, RENEW_MS)
  })

  pi.on('agent_settled', async (event, ctx) => {
    if (!working || seat === undefined) return
    working = false
    // F2: owed until the host takes it (kept across a restart in the state file).
    seat.state.owedEnd = event.aborted ? { op: 'error', text: 'the Pi run was aborted' } : { op: 'idle' }
    saveState(seat.path, seat.state)
    await flushOwed(generation, ctx)
  })

  pi.on('session_shutdown', async () => {
    // F3: close the generation — an in-flight poll from it can no longer hand work over, move the cursor or acknowledge.
    generation += 1
    abort?.abort()
    abort = undefined
    if (poller !== undefined) clearInterval(poller)
    if (renewer !== undefined) clearInterval(renewer)
    poller = undefined
    renewer = undefined
    if (seat !== undefined) {
      // Work handed over and never settled: the turn end is owed (sent by the next session that consumes this seat).
      if (working && seat.state.owedEnd === undefined) { seat.state.owedEnd = { op: 'error', text: 'the Pi session closed before the run settled' }; saveState(seat.path, seat.state) }
      dropLock(seat.path)
    }
    seat = undefined
    polling = false
    working = false
  })
}

/** Exported for tests: whether a lock file is held by another live process. */
export function seatLockedByOther(path: string): boolean {
  const lock = `${path}.lock`
  if (!existsSync(lock)) return false
  try { const pid = Number(JSON.parse(readFileSync(lock, 'utf8')).pid); return Number.isInteger(pid) && pid !== process.pid && alive(pid) } catch { return false }
}
