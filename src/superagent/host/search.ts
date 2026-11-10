/**
 * superagent: the team page search over one team's records (moved out of host/index.ts for the #570 line ratchet).
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/search
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
import { agentLedEnd, clip, TEXT_CAP, presetRefusal, notTakenText, OTHER_TICKETS_SHOWN, ORIGIN_LINE_NOTE, OBSERVER_LINE, candidateCard, YGL_WRITE, YGL_CARD_LINES } from './cards.ts'
import type { SuperagentHostDeps, PersonMessage, WorkbenchVia } from './deps.ts'

/**
 * The team page's 搜索 (upstream's search): a person looks for a request, a thread or a ticket by words, an id, a link
 * or a #number. This team's records only (the page names the team it is showing).
 * @param query - what the person typed, already trimmed.
 * @returns the matching items, newest activity first, at most 30.
 */
export function searchTeam(store: JsonRepositories, query: string): Record<string, unknown> {
  const q = query.trim()
  if (q === '') return { ok: true, results: [] }
  if (q.length > 200) return { ok: false, code: 'query', error: 'the search text is at most 200 characters' }
  const needle = q.toLowerCase()
  // #tail: a ticket id's short tail (the ids are hex), as a person reads them off a card; either case.
  const hash = /^#([0-9a-fA-F]{1,8})$/.exec(q)?.[1]?.toLowerCase()
  const has = (...texts: ReadonlyArray<string | undefined>): boolean => texts.some(text => text !== undefined && text.toLowerCase().includes(needle))
  const results: Array<Record<string, unknown>> = []
  const push = (kind: 'request' | 'thread' | 'ticket', id: string, title: string, at: string | undefined, extra: Record<string, unknown>): void => {
    if (results.length >= 30 || results.some(row => row.kind === kind && row.id === id)) return
    results.push({ kind, id, title, ...(at !== undefined ? { at } : {}), ...extra })
  }
  for (const ticket of store.tickets.list()) {
    const thread = ticket.channels[0]?.thread
    const numbered = hash !== undefined && ticket.id.endsWith(hash)
    if (!numbered && !has(ticket.id, ticket.title, ticket.mandate?.scope, ticket.attention?.question, thread)) continue
    push('ticket', ticket.id, ticket.title, ticket.updatedAt, { stage: ticket.ended !== undefined ? 'ended' : ticketStage(ticket).stage, thread })
  }
  for (const thread of store.threads.list()) {
    const texts = [...new Set([...thread.pending, ...(thread.evaluating?.triggerIds ?? []), ...store.decisions.byThread(thread.key).flatMap(d => d.triggerIds)])]
      .map(id => store.triggers.get(id)).filter((t): t is Trigger => t !== undefined)
    const hit = texts.find(t => has(t.id, t.text))
    if (hit === undefined && !has(thread.key, thread.ref.id)) continue
    const text = hit?.text ?? store.triggers.get(thread.pending[0] ?? '')?.text ?? ''
    push('request', thread.ref.id, clip(text, 120), thread.lastAt ?? thread.createdAt, { key: thread.key, ticket: store.tickets.list().find(t => t.channels.some(c => c.thread === thread.ref.id))?.id })
  }
  // A trigger id the person pasted: name the thread it belongs to (the trigger list itself is not enumerable).
  const byTrigger = /^wb-[0-9a-f-]{36}$/.test(q) || /^\d+$/.test(q) ? q : undefined
  if (byTrigger !== undefined) {
    for (const thread of store.threads.list()) {
      const ids = [...new Set([...thread.pending, ...(thread.evaluating?.triggerIds ?? []), ...store.decisions.byThread(thread.key).flatMap(d => d.triggerIds)])]
      if (ids.includes(byTrigger) && !results.some(row => row.id === thread.ref.id)) {
        const text = store.triggers.get(byTrigger)?.text ?? ''
        push('request', thread.ref.id, clip(text, 120), thread.lastAt ?? thread.createdAt, { key: thread.key, ticket: store.tickets.list().find(t => t.channels.some(c => c.thread === thread.ref.id))?.id })
      }
    }
  }
  results.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
  return { ok: true, results: results.slice(0, 30) }
}
