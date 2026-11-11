/**
 * superagent design v4, PR-C1: the A2A executor over a fixed pool of local member sessions.
 *
 * Upstream's DSH executor opens one session per ticket; the owner forbids new sessions (S39), and the Executor is a port
 * whose concurrency and workspaces are its own concern, so this one runs Assignments on the members the owner named:
 * - one worker slot per member: `start` binds a pending Assignment to a free member, or leaves it waiting (the ticket
 *   shows `working / queued`); `stop` frees the slot and the next waiting Assignment launches, oldest first;
 * - a member that hands off (a result, a question, blocked, failed or waiting) parks its Assignment and takes the next
 *   ticket, as upstream's slot holds only while a turn runs; an Input for a parked Assignment brings it back first;
 * - a turn that ended without a report reports `waiting` with the member's last words, and a failed turn retries or fails;
 * - the assignment card and every Input reach the member's own session by host relay (never A2A);
 * - the member's turn ending is the executor's `turnEnded` fact, and the Inputs delivered before it count as read;
 * - the member reports with `a2a_ticket_report` (upstream orchestrator_report), only for the ticket bound to it.
 * - a ticket the router accepted for a repository runs only on that repository's members (settings `repos`); it waits
 *   for one of them without holding up the tickets behind it;
 * Bindings and ticket repositories persist under `<a2a home>/superagent/executor.json`, so a restart knows which member
 * ran what and where each ticket belongs.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/executor
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { waitsForPerson, type Assignment, type Engine, type Executor, type PolicyEffect, type Ticket, type TicketInput } from '../upstream/dsh-superagent/src/core/index.ts'

export interface MemberExecutorDeps {
  readonly path: string
  /** The members the owner named, in order (the order is the launch preference). */
  readonly members: () => readonly string[]
  /** The repository a member works in (`owner/name`), if the owner named one. */
  readonly repoOf: (member: string) => string | undefined
  /** What a member is told of its own rules and the rules its ticket was accepted on (design D6). */
  readonly memberNotes?: (member: string, ticket: Ticket) => readonly string[]
  /**
   * Put text into a member's session: a local one by host relay, a remote one by a signed request to its host (PR-C2).
   * `kind` says what it carries. False (or a rejected promise) when it did not arrive.
   */
  readonly deliver: (member: string, text: string, kind: 'assign' | 'input' | 'stop', ticketId: string) => boolean | Promise<boolean>
  readonly engine: () => Engine
  /** The owner paused the team (upstream: evaluation, dispatch and outbound delivery hold). */
  readonly paused?: () => boolean
  /** Stop a member's running turn (upstream cancels the worker on stop). True when a turn was running, and an idle event will follow. */
  readonly cancelTurn?: (member: string) => boolean
  /** The ticket's report made on the member's behalf (a turn that ended silently, or failed), told to the router as a report is. */
  readonly reportFor: (ticketId: string, member: string, state: 'waiting' | 'failed', summary: string) => void
  /** A stored ticket (the engine's repositories). */
  readonly ticket: (id: string) => Ticket | undefined
  /** Text of a stored Trigger, for Inputs. */
  readonly trigger: (id: string) => { text: string; actor: { source: string; id: string }; at: string } | undefined
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  /** The team's prepare command (design reliability R1), if it has one. */
  readonly prepare?: () => { readonly command: string; readonly timeoutMs: number } | undefined
  /** A local member session's workspace directory. */
  readonly workspaceOf?: (member: string) => string | undefined
  /** Run a prepare command; tests replace it. */
  readonly runPrepare?: PrepareRunner
  /** How many tickets may run at once; 0 is no cap (design reliability R5). */
  readonly maxConcurrent?: () => number
}

/** Runs a prepare command: whether it exited 0, and the end of what it printed. */
export type PrepareRunner = (command: string, cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number) => Promise<{ ok: boolean; output: string }>
const PREPARE_OUTPUT_TAIL = 2_000

/** `sh -c` in the workspace, with the ticket's variables added to this process's environment. */
export const defaultPrepare: PrepareRunner = (command, cwd, env, timeoutMs) => new Promise((resolve) => {
  execFile('sh', ['-c', command], { cwd, env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    const output = `${String(stdout)}${String(stderr)}`.slice(-PREPARE_OUTPUT_TAIL)
    if (error === null) { resolve({ ok: true, output }); return }
    const why = (error as { killed?: boolean }).killed === true ? `timed out after ${String(Math.round(timeoutMs / 1000))} s` : `exit ${String((error as { code?: unknown }).code ?? '?')}`
    resolve({ ok: false, output: `${why}\n${output}`.slice(-PREPARE_OUTPUT_TAIL) })
  })
})

/** What a member's turn left when it ended: whether nothing of it still runs (shell jobs), and its last words. */
export interface MemberTurn { readonly quiet: boolean; readonly text: string; /** The turn answered the owner talking to this session directly. */ readonly person?: boolean }

/** One binding: which member runs which ticket's Assignment. */
interface Binding { readonly member: string; readonly ticketId: string; readonly assignmentId: string; readonly at: string }

/** How often a launch or delivery a failure left behind is tried again. */
const RETRY_MS = 30_000
/** Upstream: a failed turn for a passing reason goes on, three times, with backoff from 15 seconds. */
const TRANSIENT_TRIES = 3, TRANSIENT_BACKOFF_MS = 15_000
/** How long a member stopped mid-turn is kept from new work if its turn never reports ending. */
const STOPPING_MS = 60_000
/** Upstream: a worker's background work holds its slot at most this long after its turn ended. */
const BACKGROUND_LIMIT_MS = 30 * 60_000
const PASSING = new RegExp(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'UND_ERR', 'socket hang up', 'fetch failed',
  'network error', 'overloaded', 'rate limit', '\\b(?:408|429|50[0-4])\\b'].join('|'), 'i')
/** A network or provider failure that passes (upstream's `transient`). */
export function transientError(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500
  return PASSING.test(error instanceof Error ? `${error.name} ${error.message} ${String((error as { code?: unknown }).code ?? '')}` : String(error))
}

/** How many tickets' last members the executor keeps (market N1c: who did an ended ticket's work). */
const LAST_MEMBERS_CAP = 500

export class MemberExecutor implements Executor {
  private bindings: Binding[]
  /** Assignments whose member handed off: still running for the engine, holding no slot until an Input brings them back. */
  private parked: Binding[]
  /** Members stopped mid-turn, until the turn ends: a late report of the old turn must not meet a new ticket. */
  private readonly stopping = new Map<string, number>()
  /** Members idle with shell jobs still running, since when: nothing is decided about their ticket until the jobs end. */
  private readonly background = new Map<string, number>()
  /** Failed turns retried so far, by Assignment; while a retry waits, the idle that follows the failure ends nothing. */
  private readonly retries = new Map<string, number>()
  private readonly resuming = new Set<string>()
  /** The repository each open ticket was accepted for (`owner/name`); a ticket not here runs on any member. */
  private ticketRepos: Record<string, string>
  /** The member a ticket stays with. `named`: the router chose it, so the ticket waits for it (design D5); otherwise it is where the ticket last ran (D7). */
  private ticketMembers: Record<string, { member: string; named: boolean }>
  /**
   * market N1c: the member each ticket last ran on, kept after the ticket ends (ticketMembers is not), so the ending
   * receipt can name who did the work. Pruned to tickets the store still keeps, newest LAST_MEMBERS_CAP.
   */
  private lastMembers: Record<string, string>
  /** Members leaving the team right now (design v5: removed from the canvas): their stop notice says why. */
  private readonly leaving = new Set<string>()
  /** Assignments waiting for a free member, oldest first. */
  private waiting: { ticketId: string; assignmentId: string }[] = []
  /** One launch loop at a time, so two launches never bind one slot; a request during a run runs it again. */
  private launching = false
  private launchAgain = false
  /** One delivery at a time per Assignment: the retry never sends what a delivery in flight is sending. */
  private readonly delivering = new Set<string>()
  private readonly deliverAgain = new Set<string>()
  private lastRetry = 0
  /** When each member's session last took a message into its history (memberRead), for a claim that beats the delivery record. */
  private readonly claimedAt = new Map<string, number>()

  constructor(private readonly d: MemberExecutorDeps) {
    const stored = this.load()
    this.bindings = stored.bindings
    this.parked = stored.parked
    this.ticketRepos = stored.repos
    this.ticketMembers = stored.ticketMembers ?? {}
    this.lastMembers = stored.lastMembers ?? {}
    this.prepared = stored.prepared ?? {}
  }
  /** Tickets whose directory the prepare command has made (R1: once per ticket). */
  private prepared: Record<string, true>

  private load(): { bindings: Binding[]; parked: Binding[]; repos: Record<string, string>; ticketMembers?: Record<string, { member: string; named: boolean }>; lastMembers?: Record<string, string>; prepared?: Record<string, true> } {
    try {
      if (!existsSync(this.d.path)) return { bindings: [], parked: [], repos: {} }
      const raw = JSON.parse(readFileSync(this.d.path, 'utf8')) as { bindings?: Binding[]; parked?: Binding[]; repos?: Record<string, unknown>; ticketMembers?: Record<string, { member: string; named: boolean }>; lastMembers?: Record<string, unknown>; prepared?: Record<string, true> }
      const lastMembers = Object.fromEntries(Object.entries(raw.lastMembers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      const repos = Object.fromEntries(Object.entries(raw.repos ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      return { bindings: raw.bindings ?? [], parked: raw.parked ?? [], repos, ...(raw.ticketMembers !== undefined ? { ticketMembers: raw.ticketMembers } : {}), lastMembers, ...(raw.prepared !== undefined ? { prepared: raw.prepared } : {}) }
    } catch { return { bindings: [], parked: [], repos: {} } }
  }
  private save(): void {
    // An ended ticket's repository is no longer needed.
    this.ticketRepos = Object.fromEntries(Object.entries(this.ticketRepos).filter(([id]) => { const t = this.d.ticket(id); return t !== undefined && !t.ended }))
    this.ticketMembers = Object.fromEntries(Object.entries(this.ticketMembers).filter(([id]) => { const t = this.d.ticket(id); return t !== undefined && !t.ended }))
    this.prepared = Object.fromEntries(Object.entries(this.prepared).filter(([id]) => { const t = this.d.ticket(id); return t !== undefined && !t.ended })) as Record<string, true>
    this.lastMembers = Object.fromEntries(Object.entries(this.lastMembers).filter(([id]) => this.d.ticket(id) !== undefined).slice(-LAST_MEMBERS_CAP))
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify({ bindings: this.bindings, parked: this.parked, repos: this.ticketRepos, ticketMembers: this.ticketMembers, lastMembers: this.lastMembers }), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  /** A member is leaving the team (removed from the canvas): the stop its Assignment gets next says so. */
  removing(member: string): void { this.leaving.add(member) }
  /** The ticket bound to a member, if any. */
  bindingOf(member: string): Binding | undefined { return this.bindings.find(b => b.member === member) }
  /** A member's hold on one ticket, running or parked: a report names its ticket, so a late turn cannot report on the next one. */
  bindingFor(member: string, ticketId: string): Binding | undefined { return [...this.bindings, ...this.parked].find(b => b.member === member && b.ticketId === ticketId) }
  /** Every binding (for the workbench). */
  list(): readonly Binding[] { return [...this.bindings, ...this.parked] }
  /** Members with no ticket bound — for a ticket of a repository, only that repository's members. */
  private free(ticketId?: string): string[] {
    const held = ticketId !== undefined ? this.ticketMembers[ticketId] : undefined
    if (held !== undefined) return this.d.members().filter(m => m === held.member && this.available(m))
    const repo = ticketId !== undefined ? this.ticketRepos[ticketId] : undefined
    return this.d.members().filter(m => this.available(m) && (repo === undefined || this.d.repoOf(m) === repo))
  }

  private available(member: string): boolean {
    const stopping = this.stopping.get(member)
    if (stopping !== undefined && Date.now() - stopping >= STOPPING_MS) this.stopping.delete(member)
    return !this.bindings.some(b => b.member === member) && !this.stopping.has(member) && !this.background.has(member)
  }

  /** The repository a ticket was accepted for. */
  repoOfTicket(ticketId: string): string | undefined { return this.ticketRepos[ticketId] }

  /**
   * Record the repository the router accepted a ticket for, before its first Assignment launches (the engine queues it
   * through start; the launch runs on a microtask after the accept returns).
   */
  setRepo(ticketId: string, repo: string): void {
    this.ticketRepos[ticketId] = repo
    this.save()
    queueMicrotask(() => this.launch())
  }

  /** The member the router named for a ticket (design D5). It waits for that member and goes to nobody else. */
  setMember(ticketId: string, member: string): void {
    this.ticketMembers[ticketId] = { member, named: true }
    this.save()
    queueMicrotask(() => this.launch())
  }

  memberOfTicket(ticketId: string): { member: string; named: boolean } | undefined { return this.ticketMembers[ticketId] }
  /** The member a ticket last ran on, also after it ended (market N1c). */
  lastMemberOf(ticketId: string): string | undefined { return this.lastMembers[ticketId] }

  /**
   * The team's members changed. A ticket that merely last ran on a member who left is free to go anywhere; one the router
   * named a departed member for waits, and is returned so the router can choose again (design D7a).
   */
  membersLeft(pool: ReadonlySet<string>): string[] {
    const orphaned: string[] = []
    let changed = false
    for (const [ticketId, held] of Object.entries(this.ticketMembers)) {
      if (pool.has(held.member)) continue
      if (held.named) orphaned.push(ticketId)
      else { Reflect.deleteProperty(this.ticketMembers, ticketId); changed = true }
    }
    if (changed) this.save()
    return orphaned
  }

  start(ticket: Ticket, assignment: Assignment): void {
    if (!this.waiting.some(w => w.assignmentId === assignment.id)) this.waiting.push({ ticketId: ticket.id, assignmentId: assignment.id })
    queueMicrotask(() => this.launch())
  }

  /** Launch waiting Assignments on free members, oldest first, while both exist. */
  launch(): void {
    if (this.d.paused?.() === true) return
    if (this.launching) { this.launchAgain = true; return }
    this.launching = true
    void this.launchLoop().catch(error => { this.d.logger.warn('superagent: launch failed: %s', String(error)) }).finally(() => {
      this.launching = false
      if (this.launchAgain) { this.launchAgain = false; this.launch() }
    })
    this.redeliver()
  }

  /** The periodic retry (upstream retries launches and deliveries): an assignment or Input a failed delivery left behind goes out again. */
  tick(): void {
    const now = Date.now()
    if (now - this.lastRetry < RETRY_MS) return
    this.lastRetry = now
    // A member whose background work ran past the limit is settled as upstream does; what it says next still counts.
    for (const [member, since] of [...this.background]) if (now - since >= BACKGROUND_LIMIT_MS) { this.background.delete(member); this.memberIdle(member, { quiet: true, text: 'Background jobs still ran 30 minutes after the turn ended.' }) }
    this.launch()
  }

  /** Inputs still undelivered on the Assignments that run (held while paused, or left by a failed delivery). */
  private redeliver(): void {
    for (const binding of this.bindings) {
      const ticket = this.d.ticket(binding.ticketId)
      const assignment = ticket?.assignments.find(a => a.id === binding.assignmentId)
      if (ticket !== undefined && !ticket.ended && assignment?.state === 'running' && ticket.undelivered.length > 0) this.deliver(ticket, assignment)
    }
  }

  private async tryDeliver(member: string, text: string, kind: 'assign' | 'input' | 'stop', ticketId: string): Promise<boolean> {
    try { return await this.d.deliver(member, text, kind, ticketId) } catch (error) { this.d.logger.warn('superagent: delivery to %s failed: %s', member, String(error)); return false }
  }

  private async launchLoop(): Promise<void> {
    // Oldest first, but a ticket waiting for its repository's member does not hold up the ones behind it.
    for (let progressed = true; progressed;) {
      progressed = false
      // A parked Assignment with something new for it comes before a new ticket (upstream keeps a slot for a person's message).
      for (const held of [...this.parked]) {
        const ticket = this.d.ticket(held.ticketId)
        const assignment = ticket?.assignments.find(a => a.id === held.assignmentId)
        if (ticket === undefined || ticket.ended || assignment?.state !== 'running') { this.parked = this.parked.filter(b => b !== held); this.save(); continue }
        if (ticket.undelivered.length === 0 || !this.available(held.member)) continue
        this.parked = this.parked.filter(b => b !== held)
        this.bindings.push({ ...held, at: new Date().toISOString() })
        this.save()
        this.d.logger.info('superagent: ticket %s back on %s', ticket.id, held.member)
        this.deliver(ticket, assignment)
        progressed = true
      }
      for (const next of [...this.waiting]) {
        const engine = this.d.engine()
        const ticket = this.d.ticket(next.ticketId)
        const assignment = ticket?.assignments.find(a => a.id === next.assignmentId)
        if (ticket === undefined || ticket.ended || assignment === undefined || assignment.state !== 'pending') { this.waiting = this.waiting.filter(w => w !== next); continue }
        // R5: at the cap a new ticket waits; a parked ticket coming back for a person's message (above) is not held.
        const cap = this.d.maxConcurrent?.() ?? 0
        if (cap > 0 && this.bindings.length >= cap) break
        let member: string | undefined
        let preparing: { command: string; timeoutMs: number; cwd: string } | 'no-workspace' | undefined
        for (const candidate of this.free(ticket.id)) {
          preparing = this.preparationFor(ticket.id, candidate)
          if (preparing !== undefined) { member = candidate; break }
          if (await this.tryDeliver(candidate, assignmentCard(ticket, this.d.trigger, this.ticketRepos[ticket.id], this.d.memberNotes?.(candidate, ticket) ?? []), 'assign', ticket.id)) { member = candidate; break }
        }
        if (member === undefined) continue
        this.waiting = this.waiting.filter(w => w !== next)
        this.bindings.push({ member, ticketId: ticket.id, assignmentId: assignment.id, at: new Date().toISOString() })
        if (this.ticketMembers[ticket.id] === undefined) this.ticketMembers[ticket.id] = { member, named: false }
        delete this.lastMembers[ticket.id]
        this.lastMembers[ticket.id] = member
        this.save()
        this.d.logger.info('superagent: ticket %s assigned to %s', ticket.id, member)
        try { engine.assignmentStarted(ticket.id, assignment.id) } catch (error) { this.d.logger.warn('superagent: assignment %s not recorded started: %s', assignment.id, String(error)) }
        if (preparing !== undefined) void this.prepareThenAssign(ticket.id, assignment.id, member, preparing)
        progressed = true
      }
    }
  }

  /** What preparing a ticket for this member needs, or undefined when nothing is to be prepared (R1, R4). */
  private preparationFor(ticketId: string, member: string): { command: string; timeoutMs: number; cwd: string } | 'no-workspace' | undefined {
    const prepare = this.d.prepare?.()
    if (prepare === undefined || this.prepared[ticketId] === true || !member.startsWith('session-')) return undefined
    const cwd = this.d.workspaceOf?.(member)
    return cwd === undefined || cwd === '' ? 'no-workspace' : { ...prepare, cwd }
  }

  /** R1–R3: run the prepare command for a bound ticket, then hand the member its card; a failure frees the member. */
  private async prepareThenAssign(ticketId: string, assignmentId: string, member: string, preparing: { command: string; timeoutMs: number; cwd: string } | 'no-workspace'): Promise<void> {
    const ticket = this.d.ticket(ticketId)
    const fail = (why: string): void => {
      try { this.d.engine().deliveryFailed(ticketId, assignmentId, why) } catch (error) { this.d.logger.warn('superagent: prepare failure of %s not recorded: %s', ticketId, String(error)) }
      this.bindings = this.bindings.filter(b => b.assignmentId !== assignmentId)
      this.save()
      this.d.logger.warn('superagent: ticket %s not prepared: %s', ticketId, why.slice(0, 200))
      queueMicrotask(() => this.launch())
    }
    if (ticket === undefined) return
    if (preparing === 'no-workspace') { fail(`prepare command not run: member ${member} has no workspace directory`); return }
    const name = ticket.execution?.name ?? ticket.id
    const env = { SUPERAGENT_TICKET_ID: ticket.id, SUPERAGENT_TICKET_NAME: name, SUPERAGENT_REPO: this.ticketRepos[ticket.id] ?? '', SUPERAGENT_MEMBER: member }
    const result = await (this.d.runPrepare ?? defaultPrepare)(preparing.command, preparing.cwd, env, preparing.timeoutMs)
    const now = this.d.ticket(ticketId)
    if (now === undefined || now.ended || !this.bindings.some(b => b.assignmentId === assignmentId)) return
    if (!result.ok) { fail(`prepare command failed: ${result.output}`); return }
    this.prepared[ticketId] = true
    this.save()
    const notes = [...(this.d.memberNotes?.(member, now) ?? []), `prepared: the team's prepare command ran in your workspace for this ticket (directory name ${name}); work in what it made`]
    if (!(await this.tryDeliver(member, assignmentCard(now, this.d.trigger, this.ticketRepos[now.id], notes), 'assign', now.id))) fail(`member ${member} did not receive the assignment`)
  }

  deliver(ticket: Ticket, assignment: Assignment): void {
    queueMicrotask(() => { void (async () => {
      if (this.d.paused?.() === true) return
      // An Input that arrives during a delivery goes out right after it.
      if (this.delivering.has(assignment.id)) { this.deliverAgain.add(assignment.id); return }
      const binding = this.bindings.find(b => b.assignmentId === assignment.id)
      // A parked Assignment comes back through the launch loop once its member is free.
      if (binding === undefined) { if (this.parked.some(b => b.assignmentId === assignment.id)) this.launch(); return }
      this.delivering.add(assignment.id)
      try { await this.deliverNow(ticket, assignment, binding) } finally {
        this.delivering.delete(assignment.id)
        if (this.deliverAgain.delete(assignment.id)) this.deliver(ticket, assignment)
      }
    })() })
  }

  private async deliverNow(ticket: Ticket, assignment: Assignment, binding: Binding): Promise<void> {
    const current = this.d.ticket(ticket.id)
    if (current === undefined || current.ended) return
    const inputs = current.inputs.filter(input => current.undelivered.includes(input.id))
    if (inputs.length === 0) return
    const engine = this.d.engine()
    // The Triggers the ticket was accepted from are already in its assignment card: recorded delivered, not sent twice.
    const fresh = inputs.filter(input => !(input.kind === 'trigger' && current.origin.triggerIds.includes(input.triggerId)))
    const sentAt = Date.now()
    if (fresh.length > 0 && !(await this.tryDeliver(binding.member, inputsCard(current, fresh, this.d.trigger), 'input', ticket.id))) {
      try { engine.deliveryFailed(ticket.id, assignment.id, `member ${binding.member} did not receive the input`) } catch { /* the ticket ended meanwhile */ }
      return
    }
    try { engine.inputsDelivered(ticket.id, assignment.id, inputs.map(input => input.id)) } catch (error) { this.d.logger.warn('superagent: inputs of %s not recorded delivered: %s', ticket.id, String(error)) }
    // The member's session may take the message in before its delivery is recorded: that claim counts for it.
    if ((this.claimedAt.get(binding.member) ?? 0) >= sentAt) this.memberRead(binding.member)
  }

  stop(ticket: Ticket, assignment: Assignment, reason: string): void {
    const binding = this.bindings.find(b => b.assignmentId === assignment.id)
    this.waiting = this.waiting.filter(w => w.assignmentId !== assignment.id)
    this.retries.delete(assignment.id); this.resuming.delete(assignment.id)
    const parked = this.parked.find(b => b.assignmentId === assignment.id)
    if (parked !== undefined) {
      // It holds no turn and may be on another ticket by now: nothing to stop. A member removed from the team is told.
      this.parked = this.parked.filter(b => b !== parked)
      this.save()
      if (this.leaving.delete(parked.member)) void this.tryDeliver(parked.member, `[superagent] ticket ${ticket.id} «${ticket.title}» is no longer yours (you were removed from the team). Do not report on it again.`, 'stop', ticket.id)
    }
    if (binding !== undefined) {
      this.bindings = this.bindings.filter(b => b !== binding)
      this.save()
      // The member's own ready or dropped report ended the ticket: it knows, and a notice would only wake it for a turn.
      const ownEnd = ticket.ended?.by === 'executor' && assignment.report !== undefined && assignment.report.at === ticket.ended.at
        && (assignment.report.state === 'ready' || assignment.report.state === 'dropped')
      const why = this.leaving.delete(binding.member) ? 'you were removed from the team' : reason
      // Upstream cancels the worker's turn; here the member stays out of the pool until that turn has ended.
      if (!ownEnd && this.d.cancelTurn?.(binding.member) === true) this.stopping.set(binding.member, Date.now())
      if (!ownEnd) void this.tryDeliver(binding.member, `[superagent] ticket ${ticket.id} «${ticket.title}» is no longer yours (${why}). Stop working on it; do not report on it again.`, 'stop', ticket.id)
    }
    queueMicrotask(() => this.launch())
  }

  /** The member's session took a message into its history: the Inputs delivered to its assignment so far count as read. */
  memberRead(member: string): void {
    this.claimedAt.set(member, Date.now())
    const binding = this.bindingOf(member)
    if (binding === undefined) return
    const ticket = this.d.ticket(binding.ticketId)
    if (ticket === undefined || ticket.ended) return
    const unread = ticket.inputs.filter((input): input is Extract<TicketInput, { kind: 'trigger' }> => input.kind === 'trigger' && !input.readAt && input.deliveredTo === binding.assignmentId).map(input => input.id)
    if (unread.length === 0) return
    try { this.d.engine().inputsRead(ticket.id, unread) } catch (error) { this.d.logger.warn('superagent: inputs of %s not recorded read: %s', ticket.id, String(error)) }
  }

  /** The member's turn ended: Inputs delivered to it before now count as read, and the engine hears the turn end. */
  memberIdle(member: string, turn: MemberTurn = { quiet: true, text: '' }): void {
    if (this.stopping.delete(member)) queueMicrotask(() => this.launch())
    const binding = this.bindingOf(member)
    if (binding === undefined) { this.background.delete(member); return }
    this.memberRead(member)
    // The owner talked to this session directly: that turn says nothing about the ticket, and the ticket goes on after it.
    if (turn.person === true && turn.quiet && !this.resuming.has(binding.assignmentId)) {
      this.background.delete(member)
      void this.tryDeliver(member, `[superagent] ticket ${binding.ticketId}: your conversation with the owner is separate from this ticket. Go on with the assignment where it stopped, and report on it as usual.`, 'input', binding.ticketId)
      return
    }
    try { this.d.engine().turnEnded(binding.ticketId, binding.assignmentId) } catch (error) { this.d.logger.warn('superagent: turn end of %s not recorded: %s', binding.ticketId, String(error)) }
    if (this.resuming.has(binding.assignmentId)) return
    // Shell jobs still run for it: the job's end wakes it, and that turn's end decides.
    if (!turn.quiet) { if (!this.background.has(member)) this.background.set(member, Date.now()); return }
    this.background.delete(member)
    this.retries.delete(binding.assignmentId)
    this.settle(binding, turn.text)
  }

  /** The turn ended with nothing left running: a handoff parks the Assignment; a turn that said nothing formal reports `waiting` (upstream). */
  private settle(binding: Binding, text: string): void {
    const ticket = this.d.ticket(binding.ticketId)
    const assignment = ticket?.assignments.find(a => a.id === binding.assignmentId)
    if (ticket === undefined || ticket.ended || assignment?.state !== 'running' || this.delivering.has(assignment.id) || ticket.undelivered.length > 0) return
    const report = assignment.report
    const since = !!assignment.deliveredAt && !!report && assignment.deliveredAt >= report.at
    const handedOff = ((report?.state === 'ready' || report?.state === 'waiting' || !!ticket.attention) && !since) || waitsForPerson(ticket)
    if (!handedOff) {
      try { this.d.reportFor(ticket.id, binding.member, 'waiting', text !== '' ? text : report?.summary ?? 'The member ended its turn without a report.') } catch (error) { this.d.logger.warn('superagent: turn-end report of %s failed: %s', ticket.id, String(error)); return }
      if (this.d.ticket(ticket.id)?.ended) return
    }
    this.bindings = this.bindings.filter(b => b !== binding)
    this.parked.push(binding)
    this.save()
    queueMicrotask(() => this.launch())
  }

  /** The member's turn failed: a passing failure goes on after a backoff (upstream, three times); any other fails the ticket for a person. */
  memberError(member: string, error: unknown): void {
    const binding = this.bindingOf(member)
    if (binding === undefined) return
    const { ticketId, assignmentId } = binding
    const tries = this.retries.get(assignmentId) ?? 0
    if (transientError(error) && tries < TRANSIENT_TRIES) {
      this.retries.set(assignmentId, tries + 1)
      this.resuming.add(assignmentId)
      const timer = setTimeout(() => {
        this.resuming.delete(assignmentId)
        const still = this.bindings.some(b => b.assignmentId === assignmentId)
        if (still) void this.tryDeliver(member, `[superagent] ticket ${ticketId}: your last turn failed for a passing reason (${String(error).slice(0, 200)}). Continue the assignment where it stopped.`, 'input', ticketId)
      }, TRANSIENT_BACKOFF_MS * 2 ** tries)
      timer.unref?.()
      return
    }
    this.retries.delete(assignmentId)
    try { this.d.reportFor(ticketId, member, 'failed', `The member's turn failed: ${String(error).slice(0, 500)}`) } catch (failure) { this.d.logger.warn('superagent: failure of %s not recorded: %s', ticketId, String(failure)); return }
    this.memberIdle(member, { quiet: true, text: '' })
  }

  /** After a restart: each Assignment that was running gets upstream's interruption handling (restart with a recovery note). */
  recover(): void {
    const engine = this.d.engine()
    // A parked Assignment holds no turn to interrupt; one that ended while this host was down is forgotten.
    this.parked = this.parked.filter(b => { const t = this.d.ticket(b.ticketId); return t !== undefined && !t.ended && t.assignments.find(a => a.id === b.assignmentId)?.state === 'running' })
    for (const binding of [...this.bindings]) {
      const ticket = this.d.ticket(binding.ticketId)
      const assignment = ticket?.assignments.find(a => a.id === binding.assignmentId)
      if (ticket === undefined || ticket.ended || assignment === undefined || assignment.state === 'ended') {
        this.bindings = this.bindings.filter(b => b !== binding)
        continue
      }
      if (assignment.state === 'running') {
        try { engine.assignmentInterrupted(ticket.id, assignment.id) } catch (error) { this.d.logger.warn('superagent: interrupted %s not recorded: %s', assignment.id, String(error)) }
      }
      // Upstream either keeps the Assignment (its last report stands) or ends it and opens a new one with a recovery note:
      // a replaced Assignment frees its member, and the new one launches like any other (the engine queued it through start).
      const after = this.d.ticket(binding.ticketId)
      const current = after?.assignments.find(a => a.id === binding.assignmentId)
      if (after === undefined || after.ended || current === undefined || current.state === 'ended') this.bindings = this.bindings.filter(b => b !== binding)
    }
    this.save()
    queueMicrotask(() => this.launch())
  }
}

/** The first message a member gets for a ticket: what it may do, bounded by its Mandate, and how to report. */
export function assignmentCard(ticket: Ticket, trigger: MemberExecutorDeps['trigger'], repo?: string, notes: readonly string[] = []): string {
  const origin = trigger(ticket.origin.triggerId)
  const name = ticket.execution?.name ?? ticket.id
  return [
    `[superagent assignment] ticket ${ticket.id} «${ticket.title}»`,
    `request: trigger ${ticket.origin.triggerId}`,
    ...(repo !== undefined ? [`repository: ${repo} (yours)`] : []),
    ...notes,
    `scope: ${ticket.mandate.scope}`,
    `mandate: ${ticket.mandate.strength} (${ticket.mandate.basis.via}), from ${ticket.mandate.actor.source}:${ticket.mandate.actor.id}`,
    '',
    'request text:',
    origin === undefined ? '(the original message is not readable)' : origin.text,
    '',
    `Work in your own workspace, in a directory or worktree named ${name}; in a git checkout, create that worktree at .worktrees/${name} and list .worktrees/ in the checkout's .git/info/exclude, so the checkout stays clean (your sandbox writes only inside your workspace: a path beside the checkout is refused). Stay within the scope; derive what to do from the request yourself.`,
    `Do not open sessions, subagents, or A2A routes. Report with a2a_ticket_report, naming ticket_id ${ticket.id}. When you hand off (a result, a question, waiting, blocked) you may get another ticket; a later [superagent input] brings this one back:`,
    '- progress while you work only when something changed for the person; waiting when you wait for a Trigger;',
    '- ready when the result can be reviewed or used. Name a pull request in pull_request: the ticket then stays open until it merges, and review comments come back to you as [superagent input];',
    '- blocked or failed when you cannot go on; dropped when there turns out to be nothing to do;',
    '- question: one concrete question, only for what a person alone can decide. Choose reasonable defaults for routine steps yourself and say in your report which you chose.',
    'Later messages on this ticket arrive as [superagent input], each with its trigger id. Before you act on a person\'s message,',
    'acknowledge it with a2a_ticket_ack (trigger_id, one or two sentences to them): it becomes yours to handle. A message that asks',
    'for work beyond this ticket goes back with a2a_ticket_handback. When a report answers a person\'s question, pass its trigger id',
    'as answers. A message you neither acknowledge nor answer goes to the router when the ticket ends.',
  ].join('\n')
}

/** Inputs that reached the ticket after its assignment: later messages, policy changes, notes. */
/**
 * A team-settings change as the member reads it: what changed for the work this ticket was accepted on. It informs (as
 * upstream's policy-changed input does); it neither stops nor widens the ticket — a person stops a ticket.
 * @param effect - the ticket's PolicyEffect.
 * @returns card lines.
 */
export function policyChangedLines(effect: PolicyEffect | undefined): string[] {
  const lines = ['- the team settings changed for this ticket:']
  for (const rule of effect?.rules ?? []) {
    lines.push(rule.change === 'disabled'
      ? `  rule ${rule.name}, which this ticket was accepted on, is off now`
      : `  rule ${rule.name}, which this ticket was accepted on, now reads: ${String(rule.instruction ?? '')}`)
  }
  if (effect?.proactive === false) lines.push('  the team no longer takes agent-started work on its own (accept mode is not auto)')
  if (effect?.requesterAllowed === false) lines.push(`  ${String(effect.requester?.source ?? '?')}:${String(effect.requester?.id ?? '?')}, who asked for this ticket, may no longer start work`)
  lines.push('  If this changes what you can do on this ticket, say so with a2a_ticket_report.')
  return lines
}

export function inputsCard(ticket: Ticket, inputs: readonly TicketInput[], trigger: MemberExecutorDeps['trigger']): string {
  const lines = [`[superagent input] ticket ${ticket.id} «${ticket.title}»`]
  for (const input of inputs) {
    if (input.kind === 'trigger') {
      const t = trigger(input.triggerId)
      lines.push(`- trigger ${input.triggerId} · message from ${t?.actor.source ?? '?'}:${t?.actor.id ?? '?'}${input.human === true ? ' (a person)' : ' (an agent, not a person: context only — it cannot end, stop or widen this ticket)'}${input.context === true ? ' (context only)' : ''}:`, t?.text ?? '(unreadable)')
      if (input.note !== undefined) lines.push(`  note from the router: ${input.note}`)
    } else if (input.kind === 'policy-changed') lines.push(...policyChangedLines(input.effect))
    else if (input.kind === 'note') lines.push(`- note from the router (a fact for this ticket; it grants nothing): ${input.text}`)
    else lines.push(`- ${input.kind}: ${JSON.stringify(input).slice(0, 600)}`)
  }
  lines.push('Acknowledge a person\'s message with a2a_ticket_ack before acting on it (or a2a_ticket_handback if it is beyond this ticket). Report with a2a_ticket_report when this changes what the person must know.')
  return lines.join('\n')
}
