/**
 * superagent-market-progress-roster P1/N2b: progress receipts to an A2A requester between its acknowledgement and its
 * result — where its ticket stands (queued with how many ahead, working, waiting, blocked), who holds it, and the
 * tickets the request became. A step goes out when that view changes, at most one per task per minute (a change to
 * blocked at once), and a change of summary alone at most every ten minutes. Only through the team's host face, which
 * sends a step only to a caller that declares progressReceipts; a task whose caller does not is not tried again.
 */
import { ticketStage, type Ticket } from '../upstream/dsh-superagent/src/core/index.ts'
import type { JsonRepositories } from './store.ts'
import type { A2aSource } from './a2a-source.ts'
import type { ReceiptSeat } from '../a2a-watch.ts'

/** The fastest a task gets a new step, and the fastest a step that changes only its summary goes out. */
export const PROGRESS_MIN_MS = 60_000
export const PROGRESS_SUMMARY_MS = 10 * 60_000
/** How many tasks' last steps are kept. */
const PROGRESS_RECORD_CAP = 500

type State = 'queued' | 'working' | 'waiting' | 'blocked'
interface Sent { n: number; key: string; state: State; summary: string; at: number }
/** A ticket the request became, as the requester sees it. */
export interface ProgressTicket { id: string; title: string; seat?: string; state: State | 'ended'; outcome?: string }

export interface ProgressDeps {
  readonly store: JsonRepositories
  readonly a2a: A2aSource
  /** Whether progress goes out at all: the A2A Source is on and the team did not turn progress off. */
  readonly on: () => boolean
  readonly nowMs: () => number
  readonly seatOf: (ticketId: string) => ReceiptSeat | undefined
  readonly queueAhead: (ticketId: string) => number | undefined
  /** Whether the request's formal receipt already went out (no progress after it). */
  readonly answered: (task: string) => boolean
  readonly load: () => Record<string, Sent> | undefined
  readonly save: (value: Record<string, Sent>) => void
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

/** A live ticket's progress state, or undefined when there is nothing to say (its result is due, or it ended). */
export function progressState(ticket: Ticket): State | undefined {
  const stage = ticketStage(ticket)
  if (stage.stage === 'ended') return undefined
  if (stage.stage === 'working') return stage.action === 'queued' ? 'queued' : 'working'
  if (stage.stage === 'idle') return 'waiting'
  if (stage.action === 'review') return undefined
  if (stage.action === 'answer') return 'waiting'
  return 'blocked'
}

export class ProgressReceipts {
  private sending = false
  private sent: Record<string, Sent>
  /** Tasks whose caller takes no progress (or that cannot carry it): not tried again in this process. */
  private readonly gone = new Set<string>()

  constructor(private readonly d: ProgressDeps) { this.sent = d.load() ?? {} }

  /** One pass: every live ticket's A2A request whose view changed gets its next step. */
  tick(): void {
    if (this.sending || !this.d.on()) return
    const now = this.d.nowMs()
    const due: Array<{ task: string; address: Record<string, string>; step: Parameters<A2aSource['progress']>[1]; record: Sent }> = []
    const tickets = this.d.store.tickets.list()
    for (const ticket of tickets) {
      if (ticket.ended) continue
      const trigger = this.d.store.triggers.get(ticket.origin.triggerId)
      const address = trigger?.source === 'a2a' && trigger.human !== true ? trigger.channel?.address : undefined
      const task = address?.task
      if (address === undefined || task === undefined || this.gone.has(task) || this.d.answered(task)) continue
      const state = progressState(ticket)
      if (state === undefined) continue
      const by = this.d.seatOf(ticket.id)
      const report = [...ticket.assignments].reverse().find(a => a.report !== undefined)?.report
      const summary = (report?.summary ?? ticket.title).replace(/\s+/g, ' ').trim().slice(0, 400)
      const ahead = state === 'queued' ? this.d.queueAhead(ticket.id) : undefined
      // N2b: the tickets this request became — every ticket accepted from its trigger.
      const became: ProgressTicket[] = tickets.filter(t => t.origin.triggerIds.includes(ticket.origin.triggerId)).slice(0, 16).map(t => {
        const s = t.ended ? 'ended' as const : (progressState(t) ?? 'working')
        const seat = this.d.seatOf(t.id)?.seat
        return { id: t.id, title: t.title.slice(0, 200), ...(seat !== undefined ? { seat } : {}), state: s, ...(t.ended ? { outcome: t.ended.outcome } : {}) }
      })
      const key = JSON.stringify([state, ahead ?? null, by?.seat ?? null, became.map(t => [t.id, t.seat ?? null, t.state])])
      const last = this.sent[task]
      if (last !== undefined) {
        const sameView = last.key === key
        if (sameView && last.summary === summary) continue
        if (sameView && now - last.at < PROGRESS_SUMMARY_MS) continue
        if (state !== 'blocked' && now - last.at < PROGRESS_MIN_MS) continue
      }
      const n = (last?.n ?? 0) + 1
      due.push({ task, address, record: { n, key, state, summary, at: now },
        step: { n, state, summary, ...(ahead !== undefined ? { ahead } : {}), tickets: became, ...(by !== undefined ? { by } : {}) } })
    }
    if (due.length === 0) return
    this.sending = true
    void (async () => {
      for (const item of due) {
        try {
          const result = await this.d.a2a.progress(item.address, item.step)
          if (result === 'gone') { this.gone.add(item.task); continue }
          this.sent[item.task] = item.record
          this.d.logger.info('superagent: progress %d (%s) to A2A task %s', item.record.n, item.record.state, item.task)
        } catch (error) { this.d.logger.warn('superagent: progress for A2A task %s failed (retried later): %s', item.task, String(error)) }
      }
      this.prune()
      this.d.save(this.sent)
    })().finally(() => { this.sending = false })
  }

  /** Keeps the newest records of tasks whose ticket is still open, at most PROGRESS_RECORD_CAP. */
  private prune(): void {
    const open = new Set(this.d.store.tickets.list().filter(t => !t.ended).flatMap(t => {
      const task = this.d.store.triggers.get(t.origin.triggerId)?.channel?.address?.task
      return task === undefined ? [] : [task]
    }))
    this.sent = Object.fromEntries(Object.entries(this.sent).filter(([task]) => open.has(task)).sort((a, b) => a[1].at - b[1].at).slice(-PROGRESS_RECORD_CAP))
  }
}
