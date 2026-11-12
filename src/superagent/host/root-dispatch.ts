/**
 * docs/design/superagent-root-team.md R2–R4 (step S2): a root team's workers are other teams. When the root's executor
 * gives a ticket to a child team, the host sends that team a request from the root team's A2A identity (the outbound
 * path, no card: the owner registered the child); the child's receipts on that task come back to the root team's
 * mailbox and move the root ticket — its question becomes the root ticket's question, its result the root ticket's
 * report, a refusal hands the ticket back to the root router. Persisted beside the executor's state.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/root-dispatch
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { splitTeamRef } from '../../canvas-member.ts'
import { DIRECT_HEADER } from '../../dispatch.ts'
import { parseReceipt } from '../../receipt.ts'
import { TRUSTED_PROOFS } from '../a2a-watch.ts'
import type { ReportState, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'

/** How many dispatched tasks are remembered (oldest answered ones go first). */
const BOOK_CAP = 2_000

interface Dispatch { ticketId: string; child: string; at: string; state: 'sent' | 'acknowledged' | 'question' | 'ended' }

export interface RootDispatchDeps {
  readonly path: string
  /** Send from the root team's A2A identity; the task id, or undefined when the child is not reachable or not admitted. */
  readonly route: (address: string, text: string, context?: string) => Promise<string | undefined>
  /** A child team's report on the root ticket (the executor's own path: report, relay to the router, pass). */
  readonly report: (ticketId: string, child: string, state: ReportState, summary: string) => void
  /** A child team's question on the root ticket: asked of the root's requester with the child's options. */
  readonly ask: (ticketId: string, child: string, question: string, options: readonly string[], recommended: string | undefined) => void
  /** The answer to a child's question was passed on to the child: the root ticket's question is settled. */
  readonly forwarded?: (ticketId: string) => void
  readonly now: () => string
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

/** Whether a pool entry is a child team (`<zone>/canvas/<name>@<fp8>`) rather than a session. */
export const isChildTeam = (member: string): boolean => splitTeamRef(member) !== undefined

/** How a child team is named to people and to the root router. */
export function childLabel(ref: string): string {
  const team = splitTeamRef(ref)
  return team === undefined ? ref : `子团队 ${team.name}（${team.zone}@${team.fingerprint}）`
}

export class RootDispatch {
  private book: Record<string, Dispatch> = {}

  constructor(private readonly d: RootDispatchDeps) {
    try { if (existsSync(d.path)) this.book = (JSON.parse(readFileSync(d.path, 'utf8')) as { book?: Record<string, Dispatch> }).book ?? {} } catch { this.book = {} }
  }

  private save(): void {
    const entries = Object.entries(this.book)
    if (entries.length > BOOK_CAP) this.book = Object.fromEntries(entries.sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(-BOOK_CAP))
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify({ book: this.book }), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  /** The task a root ticket was sent to a child on (the latest), for a follow-up in the same conversation. */
  private taskOf(ticketId: string, child: string): string | undefined {
    return Object.entries(this.book).filter(([, row]) => row.ticketId === ticketId && row.child === child).sort((a, b) => b[1].at.localeCompare(a[1].at))[0]?.[0]
  }

  /** The root tickets each child holds now (for the board and the root router's card). */
  open(): Array<{ task: string; ticketId: string; child: string; state: Dispatch['state'] }> {
    return Object.entries(this.book).filter(([, row]) => row.state !== 'ended').map(([task, row]) => ({ task, ...row }))
  }

  /**
   * The executor gives a root ticket to a child, hands it new input, or stops it: one A2A request to the child's address.
   * An assignment is a new conversation; input and a stop follow in the conversation the assignment started.
   */
  async send(child: string, text: string, kind: 'assign' | 'input' | 'stop', ticketId: string): Promise<boolean> {
    const team = splitTeamRef(child)
    if (team === undefined) return false
    const context = kind === 'assign' ? undefined : this.taskOf(ticketId, child)
    if (kind !== 'assign' && context === undefined) return false
    const body = kind === 'stop' ? `[root 停止] 根团队已停止这件事：${text}` : text
    let task: string | undefined
    try { task = await this.d.route(child, body, context) } catch (error) { this.d.logger.warn('superagent: root ticket %s not sent to %s: %s', ticketId, child, String(error)); return false }
    if (task === undefined) return false
    if (kind === 'assign') { this.book[task] = { ticketId, child, at: this.d.now(), state: 'sent' }; this.save() }
    if (kind === 'input' && context !== undefined && this.book[context]?.state === 'question') { this.book[context] = { ...this.book[context]!, state: 'acknowledged' }; this.save(); this.d.forwarded?.(ticketId) }
    if (kind === 'stop' && context !== undefined) { this.book[context] = { ...this.book[context]!, state: 'ended' }; this.save() }
    this.d.logger.info('superagent: root ticket %s %s to %s (task %s)', ticketId, kind === 'assign' ? 'sent' : kind, child, task)
    return true
  }

  /** A receipt in the root team's mailbox: when it answers a task this root sent to a child, the root ticket moves. */
  received(trigger: Trigger): void {
    const receiptFor = trigger.meta.receiptFor
    if (typeof receiptFor !== 'string') return
    const row = this.book[receiptFor]
    if (row === undefined || row.state === 'ended') return
    if (typeof trigger.meta.proof !== 'string' || !TRUSTED_PROOFS.has(trigger.meta.proof)) return
    const parsed = parseReceipt(trigger.text.replace(DIRECT_HEADER, ''))
    if (parsed === null) return
    const envelope = parsed.envelope
    const summary = parsed.summary.trim() || '(子团队没有写说明)'
    const who = childLabel(row.child)
    if (envelope?.disposition === 'acknowledged' || envelope?.disposition === 'progress') {
      if (row.state === 'sent') { row.state = 'acknowledged'; this.save() }
      return
    }
    if (envelope?.disposition === 'attention') {
      const question = envelope.question
      row.state = 'question'
      this.save()
      this.d.ask(row.ticketId, row.child, `${who}问：${question?.text ?? summary}`, question?.options ?? [], question?.default)
      return
    }
    row.state = 'ended'
    this.save()
    const outcome = envelope?.outcome
    if (outcome === 'completed' || outcome === 'sync_completed') this.d.report(row.ticketId, row.child, 'ready', `${who}完成：${summary}`)
    else if (outcome === 'failed') this.d.report(row.ticketId, row.child, 'failed', `${who}没有完成（failed）：${summary}`)
    // rejected, abandoned, expired, unknown or none: the work is not done; the root router chooses again (blocked → reassignable).
    else this.d.report(row.ticketId, row.child, 'blocked', `${who}没有接或没有做成（${outcome ?? '未说明结局'}）：${summary}。请用 superagent_assign 另选一个子团队，或向请求方说明。`)
  }
}
