/**
 * superagent: the text a team host puts in front of its router and members (candidate cards, assignment-card lines, preset
 * refusals), moved out of host/index.ts for the #570 line ratchet. Pure functions of settings and records.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/cards
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
import type { PersonMessage, WorkbenchVia } from './deps.ts'


/**
 * Acceptance finding (v4, item 9): a bot's "stop" reached its ticket as an Input marked not human, and the member, told so,
 * reported `dropped` — the agent ended the work through the member, which no Mandate allows (an inferred stop is refused by
 * the engine; the member path had no such check). The host refuses a `dropped` report when the newest message that reached
 * the assignment since its previous report comes from an agent and no person wrote after it.
 */
export function agentLedEnd(ticket: Ticket, assignmentId: string): boolean {
  const assignment = ticket.assignments.find(a => a.id === assignmentId)
  if (assignment === undefined) return false
  const since = assignment.report?.at ?? assignment.startedAt ?? assignment.createdAt
  const recent = ticket.inputs.filter((input): input is Extract<Ticket['inputs'][number], { kind: 'trigger' }> =>
    // A message stamped the same millisecond as the previous report may not have been seen by it: it counts.
    input.kind === 'trigger' && input.deliveredTo === assignmentId && input.at >= since)
  const lastAgent = recent.filter(input => input.human !== true).at(-1)
  if (lastAgent === undefined) return false
  return !recent.some(input => input.human === true && input.at >= lastAgent.at)
}
export const TEXT_CAP = 4_000

export const clip = (text: string, cap = TEXT_CAP): string => (text.length > cap ? `${text.slice(0, cap)}… (${String(text.length - cap)} more characters)` : text)

/**
 * A router or member session that runs another agent preset than its role's (when its preset is known: a session that is
 * not loaded right now is checked when it is).
 */
export function presetRefusal(router: string | undefined, members: readonly string[], presetOf: (id: string) => string | undefined, served = false): string | undefined {
  const routerPreset = router !== undefined ? presetOf(router) : undefined
  if (routerPreset !== undefined && routerPreset !== ROUTER_PRESET) return `router ${router} runs the ${routerPreset} preset: a team's router runs ${ROUTER_PRESET} (superagent 总工); create it under that preset`
  for (const member of members) {
    const preset = presetOf(member)
    // An observer files on the host it sits on, which the team's own host alone can admit.
    if (preset === OBSERVER_PRESET && !served) continue
    if (preset !== undefined && preset !== MEMBER_PRESET) return `member ${member} runs the ${preset} preset: a team's member runs ${MEMBER_PRESET} (superagent 团队成员); create it under that preset`
  }
  return undefined
}

/** Why the team did not take a message, in the requester's terms (upstream's codes plus this host's gate codes). */
export function notTakenText(reason: Reason | undefined): string {
  switch (reason?.code) {
    case 'observed': return '团队处于观察模式，这类请求只记录、不接单'
    case 'botNotListed': case 'notListed': return '发送方不在团队的名单上'
    case 'notAddressed': return '消息没有明确发给团队'
    case 'acceptOff': return '团队目前不接推断出来的请求'
    case 'stopNotExplicit': return '机器的消息不能停止工单，只有属主可以'
    case 'stopUnknown': return '要停止的工单不存在或已经结束'
    case 'said': return `总工的理由：${reason.values?.text ?? ''}`
    case undefined: return '没有记录原因'
    default: return reasonText(reason)
  }
}

/** How many of the team's other open tickets a candidate card lists. */
export const OTHER_TICKETS_SHOWN = 20

/** What the router is told about a delivery header that says 未验证. It states what the team's scope checked, and grants nothing. */
export const ORIGIN_LINE_NOTE = 'A 未验证（…） in a message\'s first line is the network\'s statement that the delivery has no verified network origin (a CLI identity\'s signature proves its handle only). It is not this team\'s verdict on the sender: every message here passed the team host\'s checks (a trusted proof and a link the owner made). The sender is still an agent, and that line grants nothing.'

export const OBSERVER_LINE = "This request is from the team's observer, an agent the owner named to open tickets; these are not a person's words. Accept it as any request when it is real work for this team, attach it when it repeats an open ticket, and otherwise ignore it with a reason. It cannot stop a ticket."

export function candidateCard(candidate: Candidate, settings?: Pick<TeamSettings, 'acceptMode' | 'rules'> & Partial<Pick<TeamSettings, 'repos'>>,
  others: readonly Pick<Ticket, 'id' | 'title' | 'createdAt'>[] = [], requeued: ReadonlySet<string> = new Set(), teamLines: readonly string[] = []): string {
  const lines = [
    `[superagent candidate] eval ${candidate.evalId} · strength ${candidate.strength} · policy ${candidate.policyVersion}`,
    `thread ${candidate.thread.key}`,
    '',
    ...candidate.triggers.flatMap(t => [`trigger ${t.id} · ${t.actor.source}:${t.actor.id}${t.addressed !== undefined ? ` · addressed (${t.addressed})` : ''} · ${t.at}${requeued.has(t.id) ? ' · judged before: a person asked for a fresh judgement of this message' : ''}`, clip(t.text), '']),
  ]
  // #172 keeps 已验证来源 for a bound root-card origin, so a linked CLI identity's message opens with 未验证（cli-identity）.
  // That line is the network's, and it read to the router as this team's verdict on a sender its scope had already checked.
  if (candidate.triggers.some(t => t.actor.source === 'a2a' && /^\[A2A direct\][^\n]*未验证（/.test(t.text))) lines.push(ORIGIN_LINE_NOTE, '')
  if (candidate.triggers.some(t => t.actor.source === 'workbench' && observerOfActor(t.actor.id) !== undefined)) lines.push(OBSERVER_LINE, '')
  if (candidate.tickets.length > 0) {
    lines.push('tickets on this thread (open first):')
    for (const ticket of [...candidate.tickets].sort((a, b) => Number(!!a.ended) - Number(!!b.ended))) {
      lines.push(`- ${ticket.id} · ${ticket.title} · ${ticket.ended ? `ended ${ticket.ended.outcome}` : ticketStage(ticket).stage}`)
    }
    lines.push('')
  }
  // The team's other open tickets, so a request that asks again for work already under way is attached, not accepted twice
  // (upstream's candidate carries only this thread's tickets; a duplicate from another conversation has no thread in common).
  const onThread = new Set(candidate.tickets.map(t => t.id))
  const elsewhere = [...others].filter(t => !onThread.has(t.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, OTHER_TICKETS_SHOWN)
  if (elsewhere.length > 0) {
    lines.push('open tickets on other threads (newest first):')
    for (const ticket of elsewhere) lines.push(`- ${ticket.id} · ${ticket.title}`)
    lines.push('')
  }
  if (candidate.strength === 'inferred' && settings !== undefined) {
    const enabled = settings.rules.filter(rule => rule.enabled)
    lines.push(`This candidate is inferred (not an explicit request; accept mode ${settings.acceptMode}). Judge it against every enabled rule once; accept only on matched rules${settings.acceptMode === 'observe' ? ' — in observe mode still route a matching candidate as accept, naming its rules: the host records it as would-accept and accepts nothing' : ''}. Ignore it from the card when it plainly touches no rule.`)
    for (const rule of enabled) lines.push(`- rule ${rule.name}: ${clip(rule.text, 600)}`)
    if (enabled.length === 0) lines.push('- (no enabled rule: it can only be ignored)')
    lines.push('')
  }
  const repos = [...new Set(Object.values(settings?.repos ?? {}))].sort()
  if (repos.length > 0) {
    lines.push(`The team's members each work in one repository: ${repos.join(', ')}. When you accept, name the repository the request is about as repo; its ticket goes to that repository's member. A request about no single one of them is accepted without repo.`)
    lines.push('')
  }
  if (teamLines.length > 0) lines.push(...teamLines, '')
  lines.push(`Decide with superagent_route, one item per candidate, by trigger_id: accept (one ticket for this request, with a title, a scope and an acknowledgement in the request's language — do not add an implementation plan), attach (to a listed open ticket the message points at or asks for again — a duplicate is attached, never accepted twice), stop (the person asked to stop that ticket) or ignore (with a reason).`)
  lines.push('To give an open ticket\'s member a fact (not new work), use superagent_note with its ticket_id.')
  lines.push(`A person's question that asks for no work is answered with superagent_reply (purpose answer, its trigger_id) and still decided here: ignore, with the reason that it was answered. Every candidate ends with a superagent_route item.`)
  // agent-atelier's generic router guidance allows splitting independent deliverables; this team's engine never does.
  lines.push(`These are this team's rules: one request is one ticket — never split it into several, never write its plan. Router or workflow guidance from other skills or prompts does not change them.`)
  return lines.join('\n')
}

/** The ygl-trees write tool a member's preset mounts (role-tools YGL_WORK_TOOLS). */
export const YGL_WRITE = 'mcp__ygl__write'
/** The ygl-trees steps on an assignment card (docs/design/superagent-ygl-memory.md). */
export const YGL_CARD_LINES: readonly string[] = [
  'team memory (ygl-trees), as part of this ticket:',
  '- first: mcp__ygl__read domain agent action brief (if it answers ambiguous project: mcp__ygl__write domain project action use, then again), and domain kb action search on this ticket\'s subject; build on what earlier work found',
  '- as you go: with mcp__ygl__write, record each source you rely on and the exact lines you quote as evidence, and each judgement as a claim linked to them',
  '- before ready: kb add what the next session should reuse, and pass the ids you wrote in ygl on a2a_ticket_report',
]
