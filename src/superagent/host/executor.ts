/**
 * superagent design v4, PR-C1: the A2A executor over a fixed pool of local member sessions.
 *
 * Upstream's DSH executor opens one session per ticket; the owner forbids new sessions (S39), and the Executor is a port
 * whose concurrency and workspaces are its own concern, so this one runs Assignments on the members the owner named:
 * - one worker slot per member: `start` binds a pending Assignment to a free member, or leaves it waiting (the ticket
 *   shows `working / queued`); `stop` frees the slot and the next waiting Assignment launches, oldest first;
 * - the assignment card and every Input reach the member's own session by host relay (never A2A);
 * - the member's turn ending is the executor's `turnEnded` fact, and the Inputs delivered before it count as read;
 * - the member reports with `a2a_ticket_report` (upstream orchestrator_report), only for the ticket bound to it.
 * Bindings persist under `<a2a home>/superagent/executor.json`, so a restart knows which member ran what.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/executor
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { Assignment, Engine, Executor, Ticket, TicketInput } from '../upstream/dsh-superagent/src/core/index.ts'

export interface MemberExecutorDeps {
  readonly path: string
  /** The members the owner named, in order (the order is the launch preference). */
  readonly members: () => readonly string[]
  /** Put text into a live local session; false when it is not live. */
  readonly deliver: (sessionId: string, text: string) => boolean
  readonly engine: () => Engine
  /** A stored ticket (the engine's repositories). */
  readonly ticket: (id: string) => Ticket | undefined
  /** Text of a stored Trigger, for Inputs. */
  readonly trigger: (id: string) => { text: string; actor: { source: string; id: string }; at: string } | undefined
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

/** One binding: which member runs which ticket's Assignment. */
interface Binding { readonly member: string; readonly ticketId: string; readonly assignmentId: string; readonly at: string }

export class MemberExecutor implements Executor {
  private bindings: Binding[]
  /** Assignments waiting for a free member, oldest first. */
  private waiting: { ticketId: string; assignmentId: string }[] = []

  constructor(private readonly d: MemberExecutorDeps) {
    this.bindings = this.load()
  }

  private load(): Binding[] {
    try { return existsSync(this.d.path) ? (JSON.parse(readFileSync(this.d.path, 'utf8')) as { bindings: Binding[] }).bindings ?? [] : [] } catch { return [] }
  }
  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify({ bindings: this.bindings }), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  /** The ticket bound to a member, if any. */
  bindingOf(member: string): Binding | undefined { return this.bindings.find(b => b.member === member) }
  /** Every binding (for the workbench). */
  list(): readonly Binding[] { return [...this.bindings] }
  /** Members with no ticket bound. */
  private free(): string[] { return this.d.members().filter(m => !this.bindings.some(b => b.member === m)) }

  start(ticket: Ticket, assignment: Assignment): void {
    if (!this.waiting.some(w => w.assignmentId === assignment.id)) this.waiting.push({ ticketId: ticket.id, assignmentId: assignment.id })
    queueMicrotask(() => this.launch())
  }

  /** Launch waiting Assignments on free members, oldest first, while both exist. */
  launch(): void {
    for (;;) {
      const next = this.waiting[0]
      if (next === undefined) return
      const engine = this.d.engine()
      const ticket = this.d.ticket(next.ticketId)
      const assignment = ticket?.assignments.find(a => a.id === next.assignmentId)
      if (ticket === undefined || ticket.ended || assignment === undefined || assignment.state !== 'pending') { this.waiting.shift(); continue }
      const member = this.free().find(m => this.d.deliver(m, assignmentCard(ticket, this.d.trigger)))
      if (member === undefined) return
      this.waiting.shift()
      this.bindings.push({ member, ticketId: ticket.id, assignmentId: assignment.id, at: new Date().toISOString() })
      this.save()
      this.d.logger.info('superagent: ticket %s assigned to %s', ticket.id, member)
      try { engine.assignmentStarted(ticket.id, assignment.id) } catch (error) { this.d.logger.warn('superagent: assignment %s not recorded started: %s', assignment.id, String(error)) }
    }
  }

  deliver(ticket: Ticket, assignment: Assignment): void {
    queueMicrotask(() => {
      const binding = this.bindings.find(b => b.assignmentId === assignment.id)
      if (binding === undefined) return
      const current = this.d.ticket(ticket.id)
      if (current === undefined || current.ended) return
      const inputs = current.inputs.filter(input => current.undelivered.includes(input.id))
      if (inputs.length === 0) return
      const engine = this.d.engine()
      // The Triggers the ticket was accepted from are already in its assignment card: recorded delivered, not sent twice.
      const fresh = inputs.filter(input => !(input.kind === 'trigger' && current.origin.triggerIds.includes(input.triggerId)))
      if (fresh.length > 0 && !this.d.deliver(binding.member, inputsCard(current, fresh, this.d.trigger))) {
        try { engine.deliveryFailed(ticket.id, assignment.id, `member ${binding.member} is not live`) } catch { /* the ticket ended meanwhile */ }
        return
      }
      try { engine.inputsDelivered(ticket.id, assignment.id, inputs.map(input => input.id)) } catch (error) { this.d.logger.warn('superagent: inputs of %s not recorded delivered: %s', ticket.id, String(error)) }
    })
  }

  stop(ticket: Ticket, assignment: Assignment, reason: string): void {
    const binding = this.bindings.find(b => b.assignmentId === assignment.id)
    this.waiting = this.waiting.filter(w => w.assignmentId !== assignment.id)
    if (binding !== undefined) {
      this.bindings = this.bindings.filter(b => b !== binding)
      this.save()
      this.d.deliver(binding.member, `[superagent] ticket ${ticket.id} «${ticket.title}» is no longer yours (${reason}). Stop working on it; do not report on it again.`)
    }
    queueMicrotask(() => this.launch())
  }

  /** The member's turn ended: Inputs delivered to it before now count as read, and the engine hears the turn end. */
  memberIdle(member: string): void {
    const binding = this.bindingOf(member)
    if (binding === undefined) return
    const engine = this.d.engine()
    const ticket = this.d.ticket(binding.ticketId)
    if (ticket === undefined) return
    const unread = ticket.inputs.filter((input): input is Extract<TicketInput, { kind: 'trigger' }> => input.kind === 'trigger' && input.readAt === null && input.deliveredTo === binding.assignmentId).map(input => input.id)
    try {
      if (unread.length > 0) engine.inputsRead(ticket.id, unread)
      engine.turnEnded(ticket.id, binding.assignmentId)
    } catch (error) { this.d.logger.warn('superagent: turn end of %s not recorded: %s', ticket.id, String(error)) }
  }

  /** After a restart: each Assignment that was running gets upstream's interruption handling (restart with a recovery note). */
  recover(): void {
    const engine = this.d.engine()
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
export function assignmentCard(ticket: Ticket, trigger: MemberExecutorDeps['trigger']): string {
  const origin = trigger(ticket.origin.triggerId)
  const name = ticket.execution?.name ?? ticket.id
  return [
    `[superagent assignment] ticket ${ticket.id} «${ticket.title}»`,
    `scope: ${ticket.mandate.scope}`,
    `mandate: ${ticket.mandate.strength} (${ticket.mandate.basis.via}), from ${ticket.mandate.actor.source}:${ticket.mandate.actor.id}`,
    '',
    'request:',
    origin === undefined ? '(the original message is not readable)' : origin.text,
    '',
    `Work in your own workspace, in a directory or worktree named ${name}. Stay within the scope; derive what to do from the request yourself.`,
    'Do not open sessions, subagents, or A2A routes: this ticket is your only work. Report with a2a_ticket_report:',
    '- progress while you work only when something changed for the person; waiting when you wait for a Trigger;',
    '- ready when the result can be reviewed or used (a pull request link in the summary when there is one);',
    '- blocked or failed when you cannot go on; dropped when there turns out to be nothing to do;',
    '- question: one concrete question when the ticket owner must decide something.',
  ].join('\n')
}

/** Inputs that reached the ticket after its assignment: later messages, policy changes, notes. */
export function inputsCard(ticket: Ticket, inputs: readonly TicketInput[], trigger: MemberExecutorDeps['trigger']): string {
  const lines = [`[superagent input] ticket ${ticket.id} «${ticket.title}»`]
  for (const input of inputs) {
    if (input.kind === 'trigger') {
      const t = trigger(input.triggerId)
      lines.push(`- message from ${t?.actor.source ?? '?'}:${t?.actor.id ?? '?'}${input.human === true ? ' (a person)' : ''}${input.context === true ? ' (context only)' : ''}:`, t?.text ?? '(unreadable)')
      if (input.note !== undefined) lines.push(`  note from the router: ${input.note}`)
    } else lines.push(`- ${input.kind}: ${JSON.stringify(input).slice(0, 600)}`)
  }
  lines.push('Report with a2a_ticket_report when this changes what the person must know.')
  return lines.join('\n')
}
