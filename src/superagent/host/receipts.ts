/**
 * superagent: the receipts a team host owes A2A requesters (acknowledged, ended, and other outcomes), moved out of
 * host/index.ts for the #570 line ratchet. Behaviour unchanged; one pass at a time each, retried on later passes.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/receipts
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Engine, UserError, reasonText, ticketStage, type Assessor, type Candidate, type Outbox, type Reason, type Ticket, type Trigger, type ReceiveResult } from '../upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories, type StoredMessage } from './store.ts'
import { A2aSource } from './a2a-source.ts'
import { MemberExecutor, transientError, type MemberTurn, type PrepareRunner } from './executor.ts'
import { ReviewRequests } from './review-requests.ts'
import { RuleChanges, memberScope, type RuleScope } from './rule-changes.ts'
import { SettingsHistory } from './settings-history.ts'
import { HealthReminders, HEALTH_TICK_MS, type HealthProblem } from './health-reminders.ts'
import { DECISION_FILES_MAX, DecisionBook, oneClick, parseDecision, ticketCardId, type DecisionFile, type DecisionSpec, type StoredCard } from './decisions.ts'
import { parseFileRef } from '../../blob-store.ts'
import { GITHUB_SOURCE, PrFollower, defaultGh, parsePullRequest, type GhRun } from './pr-follow.ts'
import { IssueSource } from './github-issues.ts'
import type { ReportState } from '../upstream/dsh-superagent/src/core/index.ts'
import { MEMBER_PRESET, OBSERVER_PRESET, ROUTER_PRESET, type Role } from './role-tools.ts'
import { CLI_HANDLE_RE } from '../../cli-deposit.ts'
import { DEFAULT_SETTINGS, WORKBENCH_CLI, WORKBENCH_OWNER, OBSERVER_OPEN_MAX, PROMPT_MAX, observerActor, observerOfActor, parseSettings, parseStoredSettings, policyEffects, policyVersion, teamPolicy, teamScope, type RemoteMember, type TeamSettings } from './policy.ts'
import { searchTeam } from './search.ts'
import { agentLedEnd, clip, TEXT_CAP, presetRefusal, notTakenText, OTHER_TICKETS_SHOWN, ORIGIN_LINE_NOTE, OBSERVER_LINE, candidateCard, YGL_WRITE, YGL_CARD_LINES } from './cards.ts'
import type { SuperagentHostDeps, PersonMessage, WorkbenchVia } from './deps.ts'

/** How long an ended ticket's request waits for the router's own result before the host sends the ending receipt. */
export const END_RECEIPT_GRACE_MS = 5 * 60_000
/** Tickets that ended longer ago than this get no ending receipt (the requester's acknowledged row is gone by then). */
export const END_RECEIPT_HORIZON_MS = 8 * 86_400_000

export interface A2aReceiptsDeps {
  readonly store: JsonRepositories
  readonly a2a: A2aSource
  /** Whether the team's A2A Source is on: nothing is receipted while it is off. */
  readonly a2aOn: () => boolean
  readonly now: () => string
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

export class A2aReceipts {
  constructor(private readonly d: A2aReceiptsDeps) {}

  /** One pass of each receipt kind, as the host's pass makes it. */
  tick(): void {
    this.acknowledgeRequests()
    this.receiptEndedRequests()
    this.receiptOtherMessages()
  }

  /** Requester acknowledgements in flight, and the tasks acknowledged (or never acknowledgeable) in this process. */
  private acknowledging = false
  private readonly ackSettled = new Set<string>()
  private endReceipting = false
  private readonly endReceipted = new Set<string>()
  private outcomeReceipting = false
  private readonly outcomeReceipted = new Set<string>()

  /**
   * superagent v4 (requester acknowledgement): the A2A request a live ticket was accepted from gets one `acknowledged`
   * receipt, so the requester's owed row waits for the result without counting against its host's queue or expiring at
   * 24 hours. A person's request already gets the engine's acknowledgement reply; an agent's gets none upstream, and its
   * first reply is its formal receipt, so this is the transport's own acknowledgement. One at a time; a failure is tried
   * again on a later pass; a request that can never be acknowledged is not tried again in this process.
   */
  acknowledgeRequests(): void {
    if (this.acknowledging || !this.d.a2aOn()) return
    const due: Array<{ task: string; address: Record<string, string>; text: string }> = []
    for (const ticket of this.d.store.tickets.list()) {
      if (ticket.ended) continue
      const trigger = this.d.store.triggers.get(ticket.origin.triggerId)
      const address = trigger?.source === 'a2a' && trigger.human !== true ? trigger.channel?.address : undefined
      const task = address?.task
      if (address !== undefined && task !== undefined && !this.ackSettled.has(task)) due.push({ task, address, text: clip(`已接下，工单「${ticket.title}」完成后回执结果。Accepted as ticket «${ticket.title}»; the result follows.`, 400) })
      // A message delivered into this ticket as a follow-up is taken up, not finished: its formal outcome follows when the ticket ends.
      for (const followUp of this.followUpsOf(ticket)) {
        const followTask = followUp.channel.address.task
        if (followTask === undefined || this.ackSettled.has(followTask) || this.outcomeReceipted.has(followUp.triggerId) || this.d.a2a.answered(followTask)) continue
        due.push({ task: followTask, address: followUp.channel.address, text: clip(`已转给工单「${ticket.title}」的成员，工单结束后回执结果。Passed to the member of ticket «${ticket.title}»; the result follows when it ends.`, 400) })
      }
    }
    if (due.length === 0) return
    this.acknowledging = true
    void (async () => {
      for (const item of due) {
        try {
          const result = await this.d.a2a.acknowledge(item.address, item.text)
          this.ackSettled.add(item.task)
          if (result === 'sent') this.d.logger.info('superagent: acknowledged A2A task %s to %s', item.task, item.address.caller ?? '?')
          else if (result === 'gone') this.d.logger.warn('superagent: A2A task %s cannot be acknowledged', item.task)
        } catch (error) { this.d.logger.warn('superagent: acknowledging A2A task %s failed (retried later): %s', item.task, String(error)) }
      }
    })().finally(() => { this.acknowledging = false })
  }

  /**
   * Acceptance run 3: the A2A request a ticket was accepted from gets its one formal receipt even when nobody sends the
   * ticket's result to it — upstream allows no result for a stopped or closed ticket, and the router may not relay one. A
   * ticket that ended with its request still unanswered gets the host's ending receipt (the outcome as a2a-watch maps it,
   * with the latest report's summary): at once when stopped or closed, else after {@link END_RECEIPT_GRACE_MS} so the
   * router's own result goes first. Without it an acknowledged request stays owed for 7 days. One at a time; a failure is
   * tried again on a later pass.
   */
  receiptEndedRequests(): void {
    if (this.endReceipting || !this.d.a2aOn()) return
    const now = Date.parse(this.d.now())
    const due: Array<{ ticket: Ticket; channel: NonNullable<Trigger['channel']>; key: string }> = []
    for (const ticket of this.d.store.tickets.list()) {
      if (!ticket.ended) continue
      const trigger = this.d.store.triggers.get(ticket.origin.triggerId)
      const origin = trigger?.source === 'a2a' && trigger.human !== true ? trigger.channel : undefined
      const grace = ticket.ended.outcome === 'stopped' || ticket.ended.outcome === 'closed' ? 0 : END_RECEIPT_GRACE_MS
      const since = now - Date.parse(ticket.ended.at)
      // The request the ticket came from, and the messages that reached it as follow-ups.
      const targets = [{ key: ticket.id, channel: origin }, ...this.followUpsOf(ticket).map(f => ({ key: `${ticket.id}:${f.triggerId}`, channel: f.channel as typeof origin }))]
      for (const { key, channel } of targets) {
        if (this.endReceipted.has(key)) continue
        const task = channel?.address.task
        if (channel === undefined || task === undefined || this.d.a2a.answered(task) || since > END_RECEIPT_HORIZON_MS) { this.endReceipted.add(key); continue }
        if (since >= grace) due.push({ ticket, channel, key })
      }
    }
    if (due.length === 0) return
    this.endReceipting = true
    void (async () => {
      for (const { ticket, channel, key } of due) {
        const summary = [...ticket.assignments].reverse().find(a => a.report !== undefined)?.report?.summary
        const text = clip(`工单「${ticket.title}」已结束（${ticket.ended!.outcome}）${summary !== undefined ? `：${summary}` : '。'} Ticket «${ticket.title}» ended (${ticket.ended!.outcome}).`, 1_000)
        try {
          const result = await this.d.a2a.send({ id: `a2a-end:${key}`, channel, text, kind: 'notice', ticketId: ticket.id })
          this.endReceipted.add(key)
          this.d.logger.info('superagent: ticket %s ended; its A2A request %s got the ending receipt (%s)', ticket.id, channel.address.task ?? '?', result)
        } catch (error) { this.d.logger.warn('superagent: ending receipt for ticket %s failed (retried later): %s', ticket.id, String(error)) }
      }
    })().finally(() => { this.endReceipting = false })
  }

  /** The agents' A2A messages that reached a ticket's member as follow-ups (delivered, and not handed back). */
  private followUpsOf(ticket: Ticket): Array<{ triggerId: string; channel: NonNullable<Trigger['channel']> }> {
    const out = new Map<string, NonNullable<Trigger['channel']>>()
    for (const input of ticket.inputs) {
      if (input.kind !== 'trigger' || input.deliveredTo === undefined || ticket.origin.triggerIds.includes(input.triggerId)) continue
      if (this.d.store.triggers.disposition(input.triggerId)?.handbacks?.some(item => item.ticketId === ticket.id)) continue
      const trigger = this.d.store.triggers.get(input.triggerId)
      if (trigger?.source === 'a2a' && trigger.human !== true && trigger.channel !== undefined) out.set(input.triggerId, trigger.channel)
    }
    return [...out].map(([triggerId, channel]) => ({ triggerId, channel }))
  }

  /**
   * Every A2A message to the team address gets a formal outcome, not only the ones that start a ticket (the ops team's
   * ledger: each dead letter was a message the team did not take, and nobody told its sender). A message delivered into
   * a ticket as a follow-up is acknowledged, and gets its outcome when the ticket ends; one the team decided not to take
   * (observe mode, a sender not on the list, a stop an agent may not give, the router's ignore) gets a `rejected` receipt
   * with the reason. A ticket's own request keeps its acknowledgement and result receipts. One at a time per pass;
   * a failure is tried again on a later pass.
   */
  receiptOtherMessages(): void {
    if (this.outcomeReceipting || !this.d.a2aOn()) return
    const now = Date.parse(this.d.now())
    const origins = new Set(this.d.store.tickets.list().flatMap(t => t.origin.triggerIds))
    // A message the engine fanned out into a ticket is that ticket's follow-up even when the router also judged it and
    // ignored it in its own words (a requester's answer to a member's question, 2026-11-11): its one formal receipt is the
    // ticket's ending receipt, so a rejected one here would contradict the "passed to the member" acknowledgement and use it
    // up. A refusal of what the message asked (an agent's stop, a sender not listed) is still told; one the member handed
    // back is the router's again, and a rejection stands.
    const intoTicket = (triggerId: string): boolean => {
      const disposition = this.d.store.triggers.disposition(triggerId)
      const tickets = disposition?.fanout ?? []
      return tickets.some(ticketId => !(disposition?.handbacks ?? []).some(item => item.ticketId === ticketId))
    }
    const due = new Map<string, { channel: NonNullable<Trigger['channel']>; text: string; outcome: 'completed' | 'rejected'; ticketId?: string }>()
    const consider = (triggerId: string, make: () => { text: string; outcome: 'completed' | 'rejected'; ticketId?: string }): void => {
      if (origins.has(triggerId) || due.has(triggerId) || this.outcomeReceipted.has(triggerId)) return
      const trigger = this.d.store.triggers.get(triggerId)
      const channel = trigger?.source === 'a2a' && trigger.human !== true ? trigger.channel : undefined
      const task = channel?.address.task
      if (channel === undefined || task === undefined || this.d.a2a.answered(task) || now - Date.parse(trigger!.at) > END_RECEIPT_HORIZON_MS) { this.outcomeReceipted.add(triggerId); return }
      due.set(triggerId, { channel, ...make() })
    }
    for (const thread of this.d.store.threads.list()) {
      for (const decision of this.d.store.decisions.byThread(thread.key)) {
        if (decision.kind !== 'ignore') continue
        decision.triggerIds.forEach((triggerId, i) => {
          const reason = decision.reason.find(r => r.triggerId === triggerId) ?? decision.reason[decision.reason.length === decision.triggerIds.length ? i : 0]
          // A message routed into a ticket is answered when its member has it (above); so is one fanned out into one and only
          // set aside by the router.
          if (reason?.code === 'routed' || (reason?.code === 'said' && intoTicket(triggerId))) return
          consider(triggerId, () => ({ outcome: 'rejected', text: clip(`团队未接这条消息：${notTakenText(reason)}。The team did not take this message: ${reason === undefined ? 'no reason recorded' : reasonText(reason)}.`, 1_000) }))
        })
      }
    }
    if (due.size === 0) return
    this.outcomeReceipting = true
    void (async () => {
      for (const [triggerId, item] of due) {
        try {
          const result = await this.d.a2a.send({ id: `a2a-outcome:${triggerId}`, channel: item.channel, text: item.text, kind: 'notice', ...(item.ticketId !== undefined ? { ticketId: item.ticketId } : {}) }, { outcome: item.outcome })
          this.outcomeReceipted.add(triggerId)
          this.d.logger.info('superagent: A2A message %s got its outcome receipt (%s, %s)', triggerId, item.outcome, result)
        } catch (error) { this.d.logger.warn('superagent: outcome receipt for %s failed (retried later): %s', triggerId, String(error)) }
      }
    })().finally(() => { this.outcomeReceipting = false })
  }
}
