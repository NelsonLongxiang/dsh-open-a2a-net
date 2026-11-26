/**
 * superagent design v4, PR-B: the vendored superagent engine composed inside the a2a host.
 *
 * The engine (upstream src/core, unchanged) owns the domain: Triggers, Threads, Evals, Decisions, Tickets with Mandates,
 * Assignments, Subscriptions, Replies. This host implements its ports for a2a:
 * - Repositories: {@link JsonRepositories} under the a2a home;
 * - Policy and SourceScope: {@link teamPolicy} / {@link teamScope} from the owner's team settings;
 * - Assessor: the router (upstream's main Session), a fixed local session the owner names, receives each candidate card
 *   in its own session and decides through the superagent_* host tools (see ./tools.ts) — never by free text;
 * - Outbox: workbench replies are stored on their Thread for the workbench to show; other Channels wait (later PRs);
 * - Executor: a placeholder in this PR — accepted tickets wait in `working / queued`; the A2A executor (fixed member
 *   pool, no new sessions) is PR-C.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host
 */
import { PI_PLATFORM, piCardText } from '../platforms/pi.ts'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Engine, UserError, reasonText, ticketStage, type Assessor, type Candidate, type Outbox, type Reason, type Ticket, type Trigger, type ReceiveResult } from '../upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories, type StoredMessage } from './store.ts'
import { A2aSource } from './a2a-source.ts'
import { ProgressReceipts } from './progress.ts'
import { SplitBook } from './split.ts'
import { progressState } from './progress.ts'
import { TeamMcp } from './team-mcp.ts'
import { credentialVerdict, redactedPreview, type CredentialKind } from './credential-audit.ts'
import { RosterReports } from './roster.ts'
import { MemberExecutor, runOf, transientError, type MemberTurn, type PrepareRunner, type QueuedAssignment } from './executor.ts'
import { PiEvents } from './pi-events.ts'
import { ReviewRequests, reviewRoute } from './review-requests.ts'
import { unsettledText } from './receipt-settlement.ts'
import { approverCheck, OutboundRequests, ownAddresses, OUTBOUND_APPROVE, OUTBOUND_DECLINE, writeTicketNoteOnce, type OutboundAsk, type OutboundRecord, type OutboundApproval } from './outbound.ts'
import {legacyOutboundApproval} from './legacy-outbound-approval.ts'
import { OutboundResults, RESULT_UNAVAILABLE } from './outbound-results.ts'
import { DENY_ALL, RESTRICTED_TURN_TEXT, ResultAudit, renderResultBody } from './outbound-disclosure.ts'
import {NarrowOutboundRecovery} from './narrow-outbound.ts'
import { RuleChanges, memberScope, type RuleScope } from './rule-changes.ts'
import { SettingsHistory } from './settings-history.ts'
import { HealthReminders, HEALTH_TICK_MS, cleanName, type HealthProblem } from './health-reminders.ts'
import { DecisionPush, PUSH_TICK_MS } from './decision-push.ts'
import { QuestionGate, questionToken } from './question-gate.ts'
import { AUTO_ACK_TEXT, DECISION_FILES_MAX, DecisionBook, decisionFiles, DECISION_NOTE_MAX, inputFor, needsInput, recommendedNeedsInput, oneClick, parseDecision, resolveOption, ticketCardId, type DecisionFile, type DecisionSpec, type StoredCard } from './decisions.ts'
import { GITHUB_SOURCE, PrFollower, defaultGh, parsePullRequest, type GhRun } from './pr-follow.ts'
import { IssueSource } from './github-issues.ts'
import type { ReportState } from '../upstream/dsh-superagent/src/core/index.ts'
import { MEMBER_PRESET, OBSERVER_PRESET, ROUTER_PRESET, YGL_TREES, blockableTool, grantClass, type Role } from './role-tools.ts'
import { CLI_HANDLE_RE } from '../../cli-deposit.ts'
import { armAutoApprove, CREDENTIAL_ACK_MINUTES_DEFAULT, DEFAULT_SETTINGS, WORKBENCH_CLI, WORKBENCH_OWNER, OBSERVER_OPEN_MAX, PROMPT_MAX, memberActor, observerActor, observerOfActor, parseSettings, parseStoredSettings, policyEffects, policyVersion, teamPolicy, teamScope, type RemoteMember, type TeamSettings } from './policy.ts'
import { searchTeam } from './search.ts'
import { A2aReceipts, END_RECEIPT_GRACE_MS } from './receipts.ts'
export { END_RECEIPT_GRACE_MS } from './receipts.ts'
/** How long a declined tool request stays declined before the tool may be asked about again (design tool-requests T4). */
export const TOOL_ASK_AGAIN_MS = 24 * 3_600_000
import { agentLedEnd, clip, TEXT_CAP, presetRefusal, notTakenText, OTHER_TICKETS_SHOWN, ORIGIN_LINE_NOTE, OBSERVER_LINE, candidateCard, YGL_WRITE, yglCardLines, yglRouterLine } from './cards.ts'
import { teamYglProject, teamYglScope, YGL_UNKNOWN } from './ygl-home.ts'
import { NamedDispatch, WAIT, SWAP } from './named-dispatch.ts'
import { RootDispatch, childLabel, isChildTeam } from './root-dispatch.ts'
import { splitTeamRef } from '../../canvas-member.ts'

/** superagent-root-team R7: the rule a child team on this instance gets for its root's requests. */
const ROOT_RULE = 'root-dispatch'

/** A session's name for the market (roster, receipt `by`): without the ` (<id8>)` the host adds for the router's cards; the seat carries the handle. */
const plainName = (name: string | undefined): string | undefined => name?.replace(/ \([0-9a-f]{8}\)$/, '')
import type { SuperagentHostDeps, PersonMessage, WorkbenchVia } from './deps.ts'
export * from './cards.ts'
export type * from './deps.ts'

/** How often due Evals are checked and undelivered candidates retried. */
export const PASS_MS = 5_000
/** How many refusals the state keeps with their detail (the counts keep all). */
const REFUSALS_KEPT = 50
/** How long a working ticket may go without any change before the health check names it (reliability R6). */
export const QUIET_MINUTES = 60

/** One group of tickets queued past QUIET_MINUTES for the same reason: the member or repository it names, how many, the oldest. */
/** A queue reason as reads and health report it: a `launching` entry waiting past the quiet time is `launch-stalled` (#744 R1). */
export type QueueReason = Exclude<QueuedAssignment['reason'], 'launching'> | 'launching' | 'launch-stalled'

/** What a queued entry is reported as, given how long it has waited: a launch that has not happened within the quiet time is stalled. */
export function queueReason(reason: QueuedAssignment['reason'], minutes: number | undefined): QueueReason {
  return reason === 'launching' && minutes !== undefined && minutes >= QUIET_MINUTES ? 'launch-stalled' : reason
}

export interface QueuedProblem { code: 'tickets-queued'; reason: QueueReason; session?: string; repo?: string; count: number; ticketId: string; title: string; minutes: number }

/**
 * Group long-waiting Assignments by what holds them (field report 2026-11-19): one problem per member or repository, so
 * eleven tickets behind one busy member raise one reminder card, not eleven. A `launching` entry still waiting past the quiet
 * time is named too, as `launch-stalled` (#744 review R1): a free member exists, yet the ticket has not gone out.
 * @param queued - the executor's waiting Assignments with their reasons.
 * @param since - when an Assignment began waiting (its createdAt), or undefined when the ticket is gone.
 * @param titleOf - a ticket's title.
 * @param now - the clock, in milliseconds.
 */
export function queuedProblems(queued: readonly QueuedAssignment[], since: (q: QueuedAssignment) => string | undefined, titleOf: (ticketId: string) => string, now: number): QueuedProblem[] {
  const groups = new Map<string, QueuedProblem>()
  for (const q of queued) {
    if (q.reason === 'paused') continue
    const at = since(q)
    if (at === undefined) continue
    const minutes = Math.floor((now - Date.parse(at)) / 60_000)
    if (!(minutes >= QUIET_MINUTES)) continue
    const reason = queueReason(q.reason, minutes)
    const key = `${reason}:${q.member ?? q.repo ?? ''}`
    const seen = groups.get(key)
    if (seen === undefined) groups.set(key, { code: 'tickets-queued', reason, ...(q.member !== undefined ? { session: q.member } : {}), ...(q.repo !== undefined ? { repo: q.repo } : {}), count: 1, ticketId: q.ticketId, title: titleOf(q.ticketId), minutes })
    else { seen.count += 1; if (minutes > seen.minutes) { seen.minutes = minutes; seen.ticketId = q.ticketId; seen.title = titleOf(q.ticketId) } }
  }
  return [...groups.values()]
}

/** A remote member's refs that take tickets: those whose handle is not on the team's A2A bot list. */
export function workerRemotes(settings: Pick<TeamSettings, 'remoteMembers' | 'bots'>): string[] {
  const bots = new Set(settings.bots.a2a.map(ref => ref.split('@')[0]))
  return settings.remoteMembers.map(r => r.ref).filter(ref => !bots.has(ref.split('@')[0]))
}

/** The credential-access audit: at most one owner card per session and kind in this long, and how many hits are kept. */
export const CREDENTIAL_CARD_GAP_MS = 10 * 60_000
/** The credential-access card's two options that act (ticket 4351d67f), only on the owner's own choice. */
export const CREDENTIAL_STOP = '停掉这个会话的工单', CREDENTIAL_BLOCK = '在团队设置里禁用这个工具'
/** How long a credential card the host closed on a timeout stays on the panel, open to the owner's decision. */
export const AUTO_ACK_SHOWN_MS = 24 * 60 * 60_000
const CREDENTIAL_HITS_KEPT = 100
const CREDENTIAL_KIND_TEXT: Record<CredentialKind, string> = { 'credential-file': '凭据类文件或目录', 'authorization-header': '带 Authorization 的请求', 'other-session': '别的会话的文件' }

/** Staffing changes (S1a): a team's confirmation card answers one of these. */
export const STAFFING_CONFIRM = '确认执行', STAFFING_REFUSE = '不执行'
/** Design M12: the choices on a `sender` card, for a request from a sender the team's bot list does not hold. */
export const SENDER_TAKE = '接这一单', SENDER_TAKE_LIST = '接这一单，并把发送方加进名单', SENDER_DECLINE = '不接'
/** M12 limits: open `sender` cards at a time, and how old a message may be to wait on one. */
export const SENDER_CARDS_MAX = 10, SENDER_HOLD_MAX_AGE_MS = 24 * 3_600_000

/** Observer phase 1: how many intervention rows one read returns by default, and at most (the plugin's own cap). */
const INTERVENTIONS_READ_DEFAULT = 100, INTERVENTIONS_READ_MAX = 500
/** #764 review: per target session, at most this many casts an hour, and one wake per this window. */
const CAST_PER_HOUR = 3, CAST_WAKE_MS = 15 * 60_000
/** #902 S2: the observer's own cards kept per team, at most. */
const OBSERVER_CARDS_MAX = 50
/** #902 S3: a trigger wakes one target at most once per TRIGGER_MS; a target holds at most RELEASES_MAX armed releases. */
const TRIGGER_MS = 30 * 60_000, RELEASES_MAX = 5, RELEASE_TICK_MS = 60_000
/** #902 S3: a release's default and longest life, and how near and far an `at` time may be. */
const RELEASE_HOURS = 24, RELEASE_HOURS_MAX = 168, AT_MIN_MS = 5 * 60_000, AT_MAX_MS = 7 * 24 * 3_600_000
/** #902 S3: a release the observer armed: the cast it holds, when it goes, and how it ended. */
export interface CardRelease {
  readonly id: string
  readonly observer: string
  readonly session_id: string
  readonly template_id: string
  readonly reason: string
  readonly basis: string
  readonly when: string
  readonly then: 'insert' | 'queue' | 'trigger'
  readonly armedAt: string
  readonly expiresAt: string
  quietSince?: string
  /** #910 review B2: `releasing` is written before the cast goes to the plugin, so a restart in between is reconciled, not repeated. */
  state: 'armed' | 'releasing' | 'released' | 'expired' | 'withdrawn' | 'failed'
  attemptAt?: string
  endedAt?: string
  result?: string
}
/** #902 S2: one card of the observer's own, as kept in the team's observer-cards.json. */
interface ObserverCard { readonly name: string; readonly for: readonly string[] | 'team'; readonly scene: string; readonly from?: string; readonly at: string; readonly sha256: string; /** #908 review: the observer session that wrote it (absent on cards written before). */ readonly author?: string; /** #913 review: an edit is under way or did not finish; the card is not cast until a save completes it. */ readonly pending?: true }

export class SuperagentHost {
  readonly store: JsonRepositories
  readonly engine: Engine
  private settingsValue: TeamSettings
  private readonly settingsPath: string
  /** Candidates waiting to reach the router, by evalId; delivered ones stay until the engine releases them. */
  private readonly candidates = new Map<string, { candidate: Candidate; delivered: boolean }>()
  /** Tickets whose member was already reminded once to record in ygl-trees before ready. */
  private readonly yglReminded = new Set<string>()
  private readonly prs: PrFollower
  /** GitHub issues as a source of requests (design github-issues). */
  private readonly issues: IssueSource
  private readonly reviews: ReviewRequests
  private readonly narrowOutbound: NarrowOutboundRecovery
  private readonly outbound: OutboundRequests
  /** #881 v2: verified final results of outbound requests (status served; bodies kept, not served yet). */
  private readonly outboundResults: OutboundResults
  /** #881 v2: the delivery audit, written before any body leaves the store. */
  private readonly resultAudit: ResultAudit
  /** Proposals to change a rule set, each set's revision and last change (design D8–D10b). */
  readonly ruleChanges: RuleChanges
  private disposeTimer: (() => void) | undefined
  private healthTimer: (() => void) | undefined
  /** #902 S3: the release look (once a minute). */
  private releaseTimer: (() => void) | undefined
  /** The router's latest failed turn (its model refused: a quota, an outage), until it decides again. In memory only. */
  private routerFailure: { at: string; error: string } | undefined
  /** The A2A executor (PR-C1): the owner's fixed member pool, one worker slot each. */
  readonly executor: MemberExecutor
  private readonly decisions: DecisionBook
  /** The team's settings saves, for the team page's 设置 (each team keeps its own, with its state). */
  private readonly settingsHistory: SettingsHistory
  /** The team's health reminders: one card per problem, taken back when it goes away (reliability R7). */
  private readonly healthReminders: HealthReminders
  /** R7b: questions that go to the observer first. */
  private readonly questionGate: QuestionGate
  /** The A2A Source (PR-B2b): the team's A2A address and its mailbox loop. */
  readonly a2a: A2aSource
  /** What the team owes A2A requesters (host/receipts.ts). */
  private readonly receipts: A2aReceipts
  private readonly progress: ProgressReceipts
  /** docs/design/superagent-split.md: split parents and their children. */
  readonly splits: SplitBook
  /** docs/design/superagent-named-dispatch.md: seats, named dispatch and rework returns. */
  readonly named: NamedDispatch
  /** docs/design/superagent-root-team.md R2-R4: this team's child teams, when it is a root. */
  readonly root: RootDispatch
  private readonly roster: RosterReports
  /** T8: the router's and observer's decision cards to the market, on the roster's route. */
  readonly decisionPush: DecisionPush
  private pushTimer: (() => void) | undefined
  /** Outbox messages being sent right now, so a pass never sends one twice at once. */
  private readonly sending = new Set<string>()
  private started = false
  /** Refusals at the team's edge by rule, and the latest ones (noteRefusal). */
  private readonly refusalCounts = new Map<string, number>()
  private readonly refusalRecent: Array<{ at: string; rule: string; caller?: string; target?: string }> = []
  /** The credential-access audit's recent hits (kinds and a redacted preview, never what was read) and when each session last raised a card. */
  /** #825 review: the request a credential card filed back, by trigger id, and the session its ticket must not go to. */
  private readonly credentialExclusions = new Map<string, string>()
  private readonly exclusionsPath: string
  private readonly credentialHits: Array<{ at: string; session: string; role: string; tool: string; kinds: readonly CredentialKind[]; preview: string; card?: string; recordOnly?: true }> = []
  private readonly credentialCardAt = new Map<string, number>()
  /** docs/design/superagent-team-mcp.md M1–M3: the team's MCP servers, their tokens in this process's memory only. */
  readonly mcp: TeamMcp

  constructor(private readonly d: SuperagentHostDeps) {
    const dir = this.stateDir = d.stateDir ?? join(d.home, 'superagent')
    this.settingsPath = join(dir, 'settings.json')
    this.settingsValue = this.loadSettings()
    this.store = new JsonRepositories(join(dir, 'state.json'))
    this.exclusionsPath = join(dir, 'credential-exclusions.json')
    try { const raw = JSON.parse(readFileSync(this.exclusionsPath, 'utf8')) as unknown; if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) for (const [trigger, session] of Object.entries(raw as Record<string, unknown>)) if (typeof session === 'string') this.credentialExclusions.set(trigger, session) } catch { /* none yet */ }
    const assessor: Assessor = {
      request: candidate => { this.candidates.set(candidate.evalId, { candidate, delivered: false }); queueMicrotask(() => this.flushCandidates()) },
      release: evalId => { this.candidates.delete(evalId) },
    }
    this.splits = new SplitBook(join(dir, 'split.json'))
    const executor = this.executor = new MemberExecutor({
      path: join(dir, 'executor.json'), members: () => this.pool(),
      held: ticketId => this.splitHeld(ticketId) || this.named.held(ticketId),
      repoOf: member => this.settingsValue.repos[member],
      excluded: ticketId => this.credentialExcluded(ticketId),
      memberNotes: (member, ticket) => this.memberNotes(member, ticket),
      deliver: (member, text, kind, ticketId, run) => this.deliverToMember(member, text, kind, ticketId, run), engine: () => this.engine,
      paused: () => this.settingsValue.paused,
      ready: () => this.yglReady(),
      cancelTurn: member => this.d.cancelTurn?.(member) === true,
      reportFor: (ticketId, member, state, summary) => { this.engine.report(ticketId, { state, summary: clip(summary, 2_000) }); this.relayReport(ticketId, state, summary); this.pass(); void member },
      ticket: id => this.store.tickets.get(id), trigger: id => this.store.triggers.get(id), logger: d.logger,
      prepare: () => this.settingsValue.prepare, workspaceOf: member => this.d.workspaceOf?.(member), maxConcurrent: () => this.settingsValue.maxConcurrent ?? 0, capacity: member => this.childSlots(member) ?? 1, outlivesRestart: isChildTeam,
      ...(d.runPrepare !== undefined ? { runPrepare: d.runPrepare } : {}),
    })
    const outbox: Outbox = {
      send: message => {
        if (this.store.messages.get(message.id) !== undefined) return
        const workbench = message.channel.source === 'workbench'
        this.store.messages.save({ message, status: workbench ? 'sent' : 'pending', queuedAt: this.now(), ...(workbench ? { sentAt: this.now() } : {}) })
      },
      status: id => this.store.messages.get(id)?.status,
      withdraw: id => {
        const row = this.store.messages.get(id)
        if (row === undefined || row.status !== 'pending') return
        this.store.messages.save({ ...row, status: 'dropped', droppedAt: this.now(), reason: 'withdrawn' })
      },
    }
    this.a2a = new A2aSource({
      dir, homeUrl: () => d.homeUrl?.(), apiKey: () => d.apiKey?.(), claimAudience: () => d.claimAudience?.(), declares: () => { try { return this.childTeams().length > 0 ? ['progressReceipts', 'directedSeats', 'reworkReturns'] : [] } catch { return [] } }, enabled: () => this.settingsValue.sources.a2a,
      receive: trigger => { this.reviews.received(trigger as unknown as Trigger); this.outbound.received(trigger as unknown as Trigger); this.root.received(trigger as unknown as Trigger); const result = this.engine.receive(trigger as unknown as Trigger); queueMicrotask(() => this.pass()); return result },
      ticket: id => this.store.tickets.get(id) as never,
      resultPending: (ticketId, task) => this.resultPending(ticketId, task),
      seatOf: ticketId => this.seatOf(ticketId),
      choicesOf: ticketId => this.choicesOf(ticketId),
      splitOf: ticketId => this.splitView(ticketId),
      logger: d.logger, ...(d.runCli !== undefined ? { run: d.runCli } : {}), ...(d.teamSend !== undefined ? { teamSend: d.teamSend } : {}), ...(d.a2aPollSeconds !== undefined ? { pollSeconds: d.a2aPollSeconds } : {}),
    })
    this.roster = new RosterReports({
      team: () => { const s = this.settings; return s.canvas === undefined ? undefined : { canvas: s.canvas, ...(s.router !== undefined ? { router: s.router } : {}), members: s.members.filter(id => !s.observers.includes(id)), observers: s.observers } },
      remotes: canvas => (d.canvasTeam?.(canvas)?.remote ?? []).map(r => r.ref),
      declares: (ref, capability) => d.memberDeclares?.(ref, capability) === true,
      send: async (ref, text, taskId) => { if (d.rosterSend === undefined) throw new Error('no roster send on this host'); await d.rosterSend(ref, text, taskId) },
      handleOf: id => d.handleOf?.(id) ?? id, nameOf: id => cleanName(plainName(d.sessionName?.(id))), online: id => d.sessionLoaded?.(id) ?? false, seatIdOf: id => this.named.seatIdOf(id),
      loadOf: id => this.executor.loadOf(id), hostFingerprint: () => d.hostFingerprint?.(), warm: () => d.warmPeerCards?.(), nowMs: () => Date.parse(this.now()), logger: d.logger,
    })
    // T8 step 1: the roster's recipients, transport and canvas address; the outbox is kept across restarts.
    const pushPath = join(dir, 'decision-push.json')
    this.decisionPush = new DecisionPush({
      on: () => this.settingsValue.decisionPush === true,
      holds: cardId => this.decisions?.get(cardId) !== undefined,
      team: () => { const s = this.settings; if (s.canvas === undefined) return undefined; const router = s.router ?? s.members[0]; const zone = router === undefined ? undefined : (d.handleOf?.(router) ?? router).split('/')[0]; return zone === undefined || zone === '' ? undefined : { canvas: s.canvas, address: `${zone}/canvas/${s.canvas}` } },
      remotes: canvas => (d.canvasTeam?.(canvas)?.remote ?? []).map(r => r.ref),
      declares: (ref, capability) => d.memberDeclares?.(ref, capability) === true,
      send: async (ref, text, taskId) => { if (d.rosterSend === undefined) throw new Error('no roster send on this host'); await d.rosterSend(ref, text, taskId) },
      hostFingerprint: () => d.hostFingerprint?.(),
      load: () => { try { return existsSync(pushPath) ? JSON.parse(readFileSync(pushPath, 'utf8')) as unknown : undefined } catch { return undefined } },
      save: kept => { mkdirSync(dir, { recursive: true }); const tmp = `${pushPath}.tmp-${randomUUID()}`; writeFileSync(tmp, JSON.stringify(kept), { mode: 0o600 }); renameSync(tmp, pushPath) },
      nowMs: () => Date.parse(this.now()), logger: d.logger,
    })
    const progressPath = join(dir, 'progress.json')
    this.progress = new ProgressReceipts({
      store: this.store, a2a: this.a2a, on: () => this.settingsValue.sources.a2a && this.settingsValue.progressOff !== true, nowMs: () => Date.parse(this.now()),
      seatOf: ticketId => this.seatOf(ticketId), queueAhead: ticketId => this.executor.queueAhead(ticketId), answered: task => this.a2a.answered(task),
      parentOf: ticketId => this.splits.parentOf(ticketId), splitView: ticketId => this.splitView(ticketId),
      load: () => { try { return existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, 'utf8')) as never : undefined } catch { return undefined } },
      save: value => { try { mkdirSync(dir, { recursive: true }); const tmp = `${progressPath}.tmp-${randomUUID()}`; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, progressPath) } catch (error) { d.logger.warn('superagent: progress state not saved: %s', String(error)) } },
      logger: d.logger,
    })
    this.receipts = new A2aReceipts({ store: this.store, a2a: this.a2a, a2aOn: () => this.settingsValue.sources.a2a, now: () => this.now(), seatOf: ticketId => this.seatOf(ticketId),
      parentOf: ticketId => this.splits.parentOf(ticketId), splitView: ticketId => this.splitView(ticketId), senderHold: triggerId => this.senderHold(triggerId), ...(d.receiptLedger !== undefined ? { ledger: d.receiptLedger } : {}), logger: d.logger })
    this.prs = new PrFollower({
      path: join(dir, 'pr-follow.json'), tickets: () => this.store.tickets.list(), engine: () => this.engine, gh: d.gh ?? defaultGh,
      allowed: () => this.settingsValue.allowed.github, paused: () => this.settingsValue.paused, logger: d.logger,
      onOpen: (thread, head, url, ticketId) => this.reviews.opened(thread, head, url, ticketId),
    })
    this.issues = new IssueSource({
      path: join(dir, 'github-issues.json'), engine: () => this.engine, gh: d.gh ?? defaultGh, logger: d.logger,
      settings: () => ({ on: this.settingsValue.sources.github === true, intake: this.settingsValue.github }),
      allowed: () => this.settingsValue.allowed.github ?? [], paused: () => this.settingsValue.paused,
    })
    this.ruleChanges = new RuleChanges(join(dir, 'rule-changes.json'))
    this.settingsHistory = new SettingsHistory(join(dir, 'settings-history.json'))
    // The book prunes decided cards by age: on the host's clock, the one the cards are stamped with (a real clock here would
    // drop a card the host decided "just now" whenever the two disagree, e.g. a host or test with an injected clock).
    this.decisions = new DecisionBook(join(dir, 'decisions.json'), ticketId => { const ticket = this.store.tickets.get(ticketId); return ticket !== undefined && ticket.ended === undefined }, () => Date.parse(this.now()))
    // T8: the book tells the push when a card is raised, decided or dropped (router and observer cards go to the market).
    this.decisions.onChange = (event, card) => { this.decisionPush?.noted(event, card) }
    this.healthReminders = new HealthReminders(
      (question, key, at) => { const out = this.decisions.propose({ source: 'health', by: 'health', question, reason: key, at, spec: { level: 'P2', options: ['去处理', '先忽略 24 小时'], recommended: '去处理' } }); return out.ok ? out.id : undefined },
      cardId => this.decisions.withdraw(cardId),
      () => this.decisions.open().filter(card => card.source === 'health').map(card => ({ id: card.id, ...(card.reason !== undefined ? { reason: card.reason } : {}) })),
      () => this.now(),
      // R7a (workbench-market 18 §八): a loaded observer the problem is not about sees it first.
      { pick: problem => this.settings.observers.find(id => id !== problem.session && (d.sessionLoaded?.(id) ?? true)),
        tell: (observer, text) => d.deliverToSession(observer, text),
        // #754 review: the observer's hour survives a restart (written whole, then renamed into place).
        persist: { load: () => { const path = join(dir, 'observer-health.json'); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Array<{ key: string; observer: string; since: number }> : [] },
          save: rows => { const path = join(dir, 'observer-health.json'), temporary = `${path}.tmp-${String(process.pid)}`; mkdirSync(dir, { recursive: true }); writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600 }); renameSync(temporary, path) } } },
    )
    // R7b (workbench-market 18, #880): a member's question goes to the team's loaded observer first.
    this.questionGate = new QuestionGate({
      pick: reporter => this.settings.observers.find(id => id !== reporter && (d.sessionLoaded?.(id) ?? true)),
      loaded: id => d.sessionLoaded?.(id) ?? true,
      tell: (observer, text) => d.deliverToSession(observer, text),
      persist: { load: () => { const path = join(dir, 'observer-questions.json'); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as unknown : undefined },
        save: kept => { const path = join(dir, 'observer-questions.json'), temporary = `${path}.tmp-${String(process.pid)}`; mkdirSync(dir, { recursive: true }); writeFileSync(temporary, JSON.stringify(kept), { mode: 0o600 }); renameSync(temporary, path) } },
    })
    this.resultAudit = new ResultAudit({ path: join(dir, 'outbound-result-audit.json'), now: () => Date.parse(this.now()), logger: d.logger })
    this.outboundResults = new OutboundResults({ indexPath: join(dir, 'outbound-results.json'), bodyPath: join(dir, 'outbound-bodies.json'), now: () => Date.parse(this.now()), logger: d.logger })
    this.outbound = new OutboundRequests({ path: join(dir, 'outbound.json'), result: credential => { this.outboundResults.register(credential) }, ask: (address, text, task, sender) => this.a2a.askApproved(address, text, task!, sender!),
      sender: create => create ? this.a2a.ensureIdentity() : Promise.resolve(this.a2a.address ?? ''), approval: record => this.outboundApproval(record),
      narrowReceipt:(binding,caller,message)=>this.d.narrowRecovery?.receipt(binding,caller,message)===true,
      narrowNote:(ticketId,text)=>{try{const ticket=this.store.tickets.get(ticketId);if(!ticket||ticket.ended)return false;if(!ticket.inputs.some(input=>input.kind==='note'&&input.text===text))this.engine.note(ticketId,text);return true}catch{return false}},
      query: async (record, attempt) => d.outboundOutcome?.({ sender: attempt.sender, task: attempt.task, address: record.address, message: record.approval!.message }) ?? { delivery: 'unknown' }, logger: d.logger, now: () => this.now(),
      // Only a note actually added wakes another pass: one already in the ticket must not, or a checkpoint that keeps failing
      // to save would wake pass after pass without end (#882 review B1).
      noteOnce: (ticketId, text) => { let added = false; const result = writeTicketNoteOnce(this.store.tickets.get(ticketId), text, t => { this.engine.note(ticketId, t); added = true }); if (added) queueMicrotask(() => { this.pass() }); return result },
      note: (ticketId, text) => { try { this.engine.note(ticketId, text); this.pass() } catch (error) { this.d.logger.warn('superagent: outbound note on %s lost: %s', ticketId, String(error)) } } })
    this.narrowOutbound=new NarrowOutboundRecovery({outbound:this.outbound,now:()=>Date.parse(this.now()),
      approval:record=>{if(!this.settingsValue.sources.a2a||this.settingsValue.paused)return undefined;const t=this.store.tickets.get(record.ticketId);return t&&!t.ended?legacyOutboundApproval(record,this.decisions.retainedForRecovery(record.card),this.settingsValue.canvas??'',Date.parse(this.now())):undefined},
      identity:()=>this.d.narrowRecovery?.identity(this.a2a.address??''),
      proposal:binding=>{if(!this.d.narrowRecovery)throw Error('narrow recovery unavailable');return this.d.narrowRecovery.proposal(binding)},
      transport:(permit,mode,current)=>{if(!this.d.narrowRecovery)throw Error('narrow recovery unavailable');return this.d.narrowRecovery.transport(permit,mode,current)}})
    this.reviews = new ReviewRequests({
      path: join(dir, 'reviews.json'), reviewer: () => this.settingsValue.reviewer, logger: d.logger,
      // #877 (owner decision 2026-11-24): review requests carry a task id recorded before the send, from the team identity.
      ...reviewRoute(this.a2a),
      note: (ticketId, text) => { try { this.engine.note(ticketId, text); this.pass() } catch (error) { this.d.logger.warn('superagent: review verdict of %s not noted: %s', ticketId, String(error)) } },
    })
    this.engine = new Engine({
      repo: this.store,
      policy: () => teamPolicy(this.settings, { taken: triggerId => this.senderChoice(triggerId) === 'taken' }),
      scope: teamScope(() => this.settingsValue),
      assessor, executor, outbox,
      // P2 light path: decided inside the intake's unit of work, before any pass can hand the message to the router.
      emit: event => { if (event.type !== 'trigger.received') return; const id = (event.data as { triggerId: string }).triggerId; if (!this.named.rework(id)) this.lightPath(id) },
      ...(d.now !== undefined ? { now: d.now } : {}),
    })
    this.root = new RootDispatch({
      path: join(dir, 'root.json'), now: () => this.now(), logger: d.logger,
      route: (address, text, context) => this.a2a.routeAs(address, text, context),
      progress: (ticketId, summary) => { try { this.engine.report(ticketId, { state: 'progress', summary: clip(summary, 2_000) }); this.pass() } catch (error) { this.d.logger.warn('superagent: child progress on %s not recorded: %s', ticketId, String(error)) } },
      forwarded: ticketId => { try { this.engine.report(ticketId, { state: 'progress', summary: '答复已转给子团队', question: null }) } catch (error) { this.d.logger.warn('superagent: question on %s not cleared: %s', ticketId, String(error)) } },
      report: (ticketId, child, state, summary) => { this.engine.report(ticketId, { state, summary: clip(summary, 2_000) }); this.relayReport(ticketId, state, summary); this.pass(); void child },
      ask: (ticketId, child, question, options, recommended) => {
        this.engine.report(ticketId, { state: 'waiting', summary: clip(question, 2_000), question })
        if (options.length > 0) this.decisions.forTicket({ ticketId, by: child, question, spec: { level: 'P1', options: [...options], recommended: recommended ?? '' }, at: this.now() })
        try { this.engine.reply({ purpose: 'attention', ticketId, question, text: question }) } catch (error) { this.d.logger.warn('superagent: a child team\'s question on %s not relayed: %s', ticketId, String(error)) }
        this.relayReport(ticketId, 'waiting', question)
        this.pass()
      },
    })
    // The market's MCP, called for members with one-hour seat tokens exchanged under the node key (owner 2026-11-13). The tool
    // list is read as one of the team's member seats.
    this.mcp = new TeamMcp({ servers: () => this.settingsValue.mcp ?? [], now: () => this.now(), toolsChanged: () => this.d.mcpToolsChanged?.(),
      catalogSeat: () => this.settings.members.map(id => this.named.seatIdOf(id)).find((seat): seat is string => seat !== undefined),
      ...(d.seatSigner !== undefined ? { signer: d.seatSigner } : {}), ...(d.seatTokenFetch !== undefined ? { tokenFetch: d.seatTokenFetch } : {}),
      ...(d.mcpTransport !== undefined ? { transport: d.mcpTransport } : {}) })
    this.named = new NamedDispatch({
      path: join(dir, 'seats.json'), engine: this.engine, ticket: id => this.store.tickets.get(id), tickets: () => this.store.tickets.list(),
      trigger: id => this.store.triggers.get(id), pool: () => this.pool(), router: () => this.settingsValue.router,
      loaded: member => member.includes('@') || (d.sessionLoaded?.(member) ?? true),
      resolveMember: value => this.resolveMember(value), memberName: member => this.displayName(member),
      declares: (caller, capability) => d.callerDeclares?.(caller, capability) === true,
      setMember: (ticketId, member) => this.executor.setMember(ticketId, member), clearMember: ticketId => this.executor.clearMember(ticketId),
      lastMemberOf: ticketId => this.executor.lastMemberOf(ticketId),
      fileQuestion: (ticketId, question) => this.decisions.forTicket({ ticketId, by: 'host', question, spec: { level: 'P1', options: [WAIT, SWAP], recommended: WAIT }, at: this.now() }),
      profiled: () => this.membersProfiled(), tellRouter: text => { const router = this.settingsValue.router; if (router !== undefined && router !== '') this.d.deliverToSession(router, `${text}\n${this.memberListLine()}`) },
      now: () => this.now(), logger: d.logger,
    })
  }

  private now(): string { return this.d.now?.() ?? new Date().toISOString() }

  private loadSettings(): TeamSettings {
    if (!existsSync(this.settingsPath)) return DEFAULT_SETTINGS
    try {
      const parsed = parseStoredSettings(JSON.parse(readFileSync(this.settingsPath, 'utf8')))
      if (parsed.ok) return parsed.settings
      this.d.logger.warn('superagent: settings invalid (%s); using defaults with every Source off', parsed.error)
    } catch (error) { this.d.logger.warn('superagent: settings unreadable (%s); using defaults with every Source off', String(error)) }
    // An unreadable file never widens anything: no Source listens until the owner saves settings again.
    return { ...DEFAULT_SETTINGS, sources: { workbench: false, a2a: false } }
  }

  /** Start the evaluation pass and re-request every candidate a restart left undelivered. */
  start(): void {
    if (this.store.loadError !== undefined) { this.d.logger.warn('superagent: %s', this.store.loadError); return }
    for (const thread of this.store.threads.active()) {
      const evaluation = thread.evaluating
      const first = evaluation?.triggerIds[0]
      if (evaluation === undefined || first === undefined) continue
      const candidate = this.engine.candidate(first)
      if (candidate !== undefined) this.candidates.set(candidate.evalId, { candidate, delivered: evaluation.delivered !== undefined })
    }
    // Upstream's restart rule: Assignments that were running restart with a recovery note; pending ones launch again.
    this.executor.recover()
    for (const ticket of this.store.tickets.open()) {
      const latest = ticket.assignments.at(-1)
      if (latest !== undefined && latest.state === 'pending' && this.executor.list().every(b => b.assignmentId !== latest.id)) this.executor.start(ticket, latest)
    }
    this.ensureYglProject()
    this.disposeTimer = this.d.interval(() => this.pass(), PASS_MS)
    // Reliability R7: look at the team's health every 15 minutes; a new problem raises one card (the boot grace period
    // keeps health() quiet, so nothing is raised from it either).
    // #761 review: each look stands alone, so a fault in the health look never skips the question look (or the other way round).
    this.healthTimer = this.d.interval(() => {
      try { this.healthReminders.tick(this.health() as readonly HealthProblem[], Date.parse(this.now())) } catch (error) { this.d.logger.warn('superagent: health look skipped: %s', String(error)) }
      this.questionTick()
    }, HEALTH_TICK_MS)
    this.roster.start(this.d.interval)
    this.releaseTimer ??= this.d.interval(() => { try { this.releaseTick() } catch (error) { this.d.logger.warn('superagent: release look skipped: %s', String(error)) } }, RELEASE_TICK_MS)
    this.pushTimer ??= this.d.interval(() => { void this.decisionPush.tick().catch((error: unknown) => { this.d.logger.warn('superagent: decision push skipped: %s', String(error)) }) }, PUSH_TICK_MS)
    // Defer: start() may run while the plugin's apply() still executes, when the canvas lookups it touches are not
    // initialized yet (a TDZ crash took the plugin down on hosts with models set - review of #566). A microtask runs
    // after apply() finishes; the catch inside applyModels is the second fence.
    queueMicrotask(() => { this.applyModels() })
    // #739 review R1: what waited on the ygl-trees version read goes out once it settles (resumeHeld), or now if it has.
    queueMicrotask(() => { this.resumeHeld() })
    this.started = true
    this.syncA2a()
    this.pass()
  }

  stop(): Promise<void> { this.executor.close(); this.roster.close(); this.disposeTimer?.(); this.disposeTimer = undefined; this.healthTimer?.(); this.healthTimer = undefined; this.pushTimer?.(); this.pushTimer = undefined; this.releaseTimer?.(); this.releaseTimer = undefined; this.started = false; return this.a2a.stop() }

  /** Run the A2A Source's mailbox loop exactly while its Source is on. */
  private syncA2a(): void {
    if (this.started && this.settingsValue.sources.a2a) this.a2a.start()
    else void this.a2a.stop()
  }

  /** Whether a local session is the router or a member (of this team, or of the team this host serves): no A2A work either way. */
  roleOf(sessionId: string): 'router' | 'member' | undefined {
    if (this.settingsValue.router === sessionId) return 'router'
    return this.settings.members.includes(sessionId) || this.settingsValue.serves?.members.includes(sessionId) === true ? 'member' : undefined
  }

  /** Whether a session is one of this team's observers: a local member created under the observer preset. */
  isObserver(sessionId: string): boolean { return this.settings.observers.includes(sessionId) }

  /**
   * #881 v2 B1: the status of one exact outbound result (ticket and task), for the router, a member truly working that open
   * ticket on this host, or an observer (status alone, open tickets only). Everything else, and any unknown or out-of-scope
   * pair, gets the same refusal with no hint of what exists. Bodies are not served in this slice.
   */
  outboundResult(session: string, ticketId: string, taskId: string): Record<string, unknown> {
    const role = this.resultRole(session, ticketId)
    if (role === undefined) return { ...RESULT_UNAVAILABLE }
    const record = this.outbound.list().find(r => r.ticketId === ticketId && (r.task === taskId || (r.attempts ?? []).some(a => a.task === taskId)))
    if (record === undefined || record.narrowRecovery !== undefined) return { ...RESULT_UNAVAILABLE }
    const current = record.task === taskId
    const view = current ? this.outboundResults.view(ticketId, taskId) : undefined
    const result: Record<string, unknown> = view !== undefined ? { ...view }
      : current && (record.state === 'sent' || record.state === 'sending') ? { status: 'pending' }
        : current && record.state === 'answered' ? { status: 'unavailable', reason: 'source-unproven', hasBody: false }
          : { status: 'unavailable' }
    if (role === 'observer') return { ok: true, status: result['status'] }
    if (result['status'] !== 'ready' && result['status'] !== 'truncated') return { ok: true, ...result }
    // #881 v2 B4: a body leaves only through policy, then an audit row on disk, then a restricted mark on disk, then the
    // same authorization rechecked. Any step that fails withholds it (a row without a delivery is acceptable).
    const body = this.outboundResults.bodyOf(ticketId, taskId)
    const withheld = (reason: string): Record<string, unknown> => ({ ok: true, ...result, status: 'unavailable', reason, hasBody: true })
    if (body === undefined) return withheld('storage')
    const verdict = (this.d.disclosure ?? DENY_ALL)({ ticketId, task: taskId, ...(body.outcome !== undefined ? { outcome: body.outcome } : {}), bodyHash: body.hash, source: body.source })
    if (!verdict.allow) return withheld('policy')
    if (this.resultAudit.record({ session, role, ticketId, task: taskId, bodyHash: body.hash, rule: verdict.rule }) !== 'recorded') return withheld('audit')
    if (this.d.restrict?.(session) !== true) return withheld('storage')
    if (this.resultRole(session, ticketId) !== role || this.outboundResults.bodyOf(ticketId, taskId)?.hash !== body.hash) return { ...RESULT_UNAVAILABLE }
    return { ok: true, ...result, body: renderResultBody({ ticketId, task: taskId, ...(body.outcome !== undefined ? { outcome: body.outcome } : {}), clipped: body.clipped, text: body.text }) }
  }

  /** Who may read this ticket's outbound results now (B1), or undefined: router; observer and bound local member while open. */
  private resultRole(session: string, ticketId: string): Exclude<Role, 'builder'> | undefined {
    const role = this.toolRoleOf(session)
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || role === undefined) return undefined
    const open = ticket.ended === undefined
    return role === 'router' || (open && (role === 'observer' || (this.settings.members.includes(session) && this.executor.bindingFor(session, ticketId) !== undefined))) ? role : undefined
  }

  /** A session's tool list: its role, an observer being a member with one tool more. */
  toolRoleOf(sessionId: string): Exclude<Role, 'builder'> | undefined {
    const role = this.roleOf(sessionId)
    return role === 'member' && this.isObserver(sessionId) ? 'observer' : role
  }

  /** How a member's turn ended, and whether it answered the owner in person. */
  private turnOf(sessionId: string): MemberTurn | undefined {
    const turn = this.d.memberTurn?.(sessionId)
    if (turn === undefined) return undefined
    // #881 v2: a session that received an outbound result body is never paraphrased; whether its turn is over is kept.
    const text = this.d.restricted?.(sessionId) === true ? RESTRICTED_TURN_TEXT : turn.text
    return { ...turn, text, person: this.d.personMessage?.(sessionId) !== undefined }
  }

  /** A member's turn ended (agent idle): the executor's turn-end fact — told to the served team host when it is theirs. */
  memberIdle(sessionId: string): void { this.memberEvent(sessionId, 'idle') }
  /** A member's turn failed (agent error): retried or reported as failed — by the team host when it is theirs. */
  memberFailed(sessionId: string, error: unknown): void {
    if (this.settings.members.includes(sessionId)) { this.executor.memberError(sessionId, error); return }
    // The router's failed turn judged nothing: requests wait for it, and only the team's health says why.
    if (sessionId === this.settingsValue.router) {
      this.routerFailure = { at: this.now(), error: clip(String((error as { message?: unknown } | undefined)?.message ?? error), 300) }
      this.d.logger.warn('superagent: the router\'s turn failed: %s', this.routerFailure.error)
      return
    }
    const serves = this.settingsValue.serves
    if (serves?.members.includes(sessionId) === true && this.d.signedPost !== undefined && this.d.handleOf !== undefined) {
      void this.d.signedPost(serves.url, '/a2a/superagent-team', { op: 'error', member: this.d.handleOf(sessionId), report: { error: String(error).slice(0, 500), transient: transientError(error) } })
        .catch(failure => { this.d.logger.warn('superagent: failed turn not told to the team host: %s', String(failure)) })
    }
  }

  /**
   * PR-F: a member's session took a message into its history (its inbox claim). The Inputs delivered to it count as read
   * from then on — as upstream's executor marks them when the message enters the session — not only once the turn ends:
   * a member that answers and reports in the same turn has read the person's message before its report.
   */
  memberClaimed(sessionId: string): void { this.memberEvent(sessionId, 'read') }

  private memberEvent(sessionId: string, op: 'idle' | 'read'): void {
    if (this.settings.members.includes(sessionId)) {
      if (op === 'idle') this.executor.memberIdle(sessionId, this.turnOf(sessionId))
      else this.executor.memberRead(sessionId)
      return
    }
    const serves = this.settingsValue.serves
    if (serves?.members.includes(sessionId) === true && this.d.signedPost !== undefined && this.d.handleOf !== undefined) {
      void this.d.signedPost(serves.url, '/a2a/superagent-team', { op, member: this.d.handleOf(sessionId), ...(op === 'idle' ? { report: this.turnOf(sessionId) ?? { quiet: true, text: '' } } : {}) })
        .catch(error => { this.d.logger.warn('superagent: %s not told to the team host: %s', op, String(error)) })
    }
  }

  /** #688 R2: the turn facts each Pi seat sent that were accepted, on disk (a replay, even after a restart, does nothing). */
  private piEventLog: PiEvents | undefined
  /** The team's state directory (executor.json, pi-events.json, …). */
  private readonly stateDir: string
  private piEvents(): PiEvents { return this.piEventLog ??= new PiEvents(join(this.stateDir, 'pi-events.json')) }
  /** Pi facts whose effect ran in this process (seat, run, event): never run again here, whatever the journal managed to write. */
  private readonly piApplied = new Set<string>()
  /** Pi platform: the key each Pi seat's work was last delivered under (in memory: a seat's work does not outlive a restart). */
  private readonly piPins = new Map<string, string>()

  /** PR-C2: put a card into a member's session — local by host relay, remote by a signed request to its host. */
  private async deliverToMember(member: string, text: string, kind: 'assign' | 'input' | 'stop', ticketId: string, run?: string): Promise<boolean> {
    if (isChildTeam(member)) return await this.root.send(member, text, kind, ticketId)
    const remote = this.settings.remoteMembers.find(r => r.ref === member)
    // A CLI handle is never a session (#685 review F2): a Pi seat removed while its ticket runs still gets the stop in its
    // mailbox while its deposit is a Pi seat here (R6 takes effect at its next poll); anything else for it goes nowhere.
    // #688 C1: a Pi seat's mailbox row names the run in its context id; a stop is a control row for that run (`stop.<run>`),
    // so the seat ends that run's work without taking it as new work.
    const context = run === undefined ? undefined : kind === 'stop' ? `stop.${run}` : run
    if (remote === undefined && CLI_HANDLE_RE.test(member)) {
      // Only under the key pinned when its work was given: never a key the deposit holds now (a re-keyed seat gets nothing).
      const pinned = kind === 'stop' ? this.piPins.get(member) : undefined
      return pinned !== undefined ? this.d.piDeliver?.(member, pinned, piCardText(text, kind, ticketId), ticketId, context) ?? false : false
    }
    if (remote === undefined) return this.d.deliverToSession(member, text)
    // Pi platform P3: a Pi seat's work goes to its CLI mailbox on this host, as the Pi variant of the card.
    if (remote.platform === PI_PLATFORM) {
      const delivered = this.d.piDeliver?.(remote.ref, remote.key, piCardText(text, kind, ticketId), ticketId, context) ?? false
      // #685 review F2: the key its work went out under, so a stop after the seat leaves the canvas still finds it (and only it).
      if (delivered) this.piPins.set(remote.ref, remote.key)
      return delivered
    }
    if (this.d.signedPost === undefined || remote.url === '') return false
    const out = await this.d.signedPost(remote.url, '/a2a/superagent-member', { op: kind, member: remote.ref.replace(/@[0-9a-f]{8}$/, ''), ticket: ticketId, text })
    return out.ok === true
  }

  /**
   * PR-C2, team host side: a member host's signed report or turn end. It counts only when the signer's key is the key the
   * owner pinned for that member's ref (another instance sharing the zone and id8 has another key).
   */
  remoteEvent(op: unknown, memberHandle: unknown, signerKey: string, report: unknown, cliSigned = false): Record<string, unknown> {
    // Pi platform P4: a Pi seat speaks only through a CLI claim, and a remote member session only through a node claim; neither
    // claim shape stands for the other kind of member.
    const entry = this.settings.remoteMembers.find(r => r.ref.replace(/@[0-9a-f]{8}$/, '') === memberHandle && r.key === signerKey && (r.platform === PI_PLATFORM) === cliSigned)
    if (entry === undefined) return { ok: false, code: 'not-member', error: 'no remote member of this team is that session under that key' }
    // #685 review F1: a member host vouches for what a person typed in its session; a Pi seat signs for itself, so nothing it
    // says can stand for the owner. It has the P4 vocabulary only: no rule changes, and no person flag on a turn end.
    const pi = entry.platform === PI_PLATFORM
    if (pi && !['report', 'ack', 'handback', 'idle', 'read', 'error'].includes(String(op))) return { ok: false, code: 'op', error: 'a Pi seat may send report, ack, handback, idle, read or error: rule changes need the owner, whom a seat cannot speak for' }
    // #688 R2: a Pi seat's turn facts name their ticket, the run of it the work came in (each binding has its own), and an
    // event id. An event accepted before — even before a restart — is acknowledged again and does nothing (its first answer
    // may have been lost). A fact whose ticket and run are not the seat's current binding does nothing either: it never
    // touches newer work, not even a later run of the same ticket.
    if (pi && (op === 'idle' || op === 'read' || op === 'error')) {
      const fact = (report ?? {}) as Record<string, unknown>
      const id = /^[A-Za-z0-9._:-]{1,80}$/
      if (typeof fact.ticket_id !== 'string' || typeof fact.run_id !== 'string' || !id.test(fact.run_id) || typeof fact.event_id !== 'string' || !id.test(fact.event_id)) return { ok: false, code: 'report', error: 'a Pi seat names the ticket (ticket_id), the run (run_id) and the event (event_id) of a turn fact' }
      const key = `${entry.ref}\u0000${fact.run_id}\u0000${fact.event_id}`
      const recorded = this.piEvents().state(entry.ref, fact.run_id, fact.event_id)
      // Applied before, on disk or in this process: acknowledged again, and nothing runs twice.
      if (recorded === 'applied' || this.piApplied.has(key)) return { ok: true, duplicate: true }
      const binding = this.executor.bindingOf(entry.ref)
      if (binding === undefined || binding.ticketId !== fact.ticket_id || runOf(binding) !== fact.run_id) return { ok: true, stale: true }
      // #688 re-review R2: the record first (pending), then the effect, then applied. A pending record that cannot be
      // written refuses the fact as retryable with no effect at all, however often it is sent.
      if (recorded === undefined) {
        try { this.piEvents().record(entry.ref, fact.run_id, fact.event_id, 'pending') } catch (error) {
          this.d.logger.warn('superagent: Pi seat %s fact %s not recorded, not applied: %s', entry.ref, fact.event_id, String(error))
          return { ok: false, code: 'journal', retryable: true, error: 'this host could not record the fact, so it did not act on it; send it again' }
        }
      }
      const effect = this.piFact(entry.ref, op, fact)
      this.piApplied.add(key)
      if (this.piApplied.size > 4096) this.piApplied.delete(this.piApplied.values().next().value!)
      // The effect ran: a failed `applied` write is logged, and this process still never runs it again (piApplied).
      try { this.piEvents().record(entry.ref, fact.run_id, fact.event_id, 'applied') } catch (error) {
        this.d.logger.warn('superagent: Pi seat %s fact %s applied, its record left pending: %s', entry.ref, fact.event_id, String(error))
      }
      return effect
    }
    if (op === 'idle') {
      const turn = (report ?? {}) as Record<string, unknown>
      this.executor.memberIdle(entry.ref, { quiet: turn.quiet !== false, text: typeof turn.text === 'string' ? clip(turn.text, 2_000) : '', ...(turn.person === true && !pi ? { person: true } : {}) })
      return { ok: true }
    }
    if (op === 'error') {
      const r = (report ?? {}) as Record<string, unknown>
      this.executor.memberError(entry.ref, Object.assign(new Error(typeof r.error === 'string' ? r.error : 'failed'), r.transient === true ? {} : { status: 400 }))
      return { ok: true }
    }
    if (op === 'read') { this.executor.memberRead(entry.ref); return { ok: true } }
    if (op === 'rules-propose') { const r = (report ?? {}) as Record<string, unknown>; return this.proposeRules(memberScope(entry.ref), entry.ref, r.value, typeof r.reason === 'string' ? r.reason : '') }
    if (op === 'rules-apply') { const r = (report ?? {}) as { person?: PersonMessage }; return this.applyRules(memberScope(entry.ref), entry.ref, r.person) }
    if (op === 'ticket-request') { const r = (report ?? {}) as Record<string, unknown>; return this.requestForMember(entry.ref, typeof r.text === 'string' ? r.text : '', true) }
    if (op === 'ack' || op === 'handback') {
      const r = (report ?? {}) as Record<string, unknown>
      return this.takeUp(entry.ref, op, r.trigger_id, r.text)
    }
    if (op !== 'report') return { ok: false, code: 'op', error: 'op must be report, ack, handback, rules-propose, rules-apply, ticket-request, read, idle or error' }
    const r = (report ?? {}) as Record<string, unknown>
    if (typeof r.state !== 'string' || !['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'].includes(r.state) || typeof r.summary !== 'string' || r.summary.trim() === '') return { ok: false, code: 'report', error: 'a report needs a state and a summary' }
    // #688 G1, #888 D2: every remote member's question is a decision card (Pi or DSH): a malformed one, inputs included, refuses
    // the whole report instead of falling back to a bare card. Inputs without a question are refused too.
    if (typeof r.question === 'string') { const decision = parseDecision(r); if (typeof decision === 'string') return { ok: false, code: 'decision', error: `a question for the owner is a decision card: ${decision}` } }
    else if (r.inputs !== undefined && r.inputs !== null) return { ok: false, code: 'inputs', error: 'inputs go with a question for the owner' }
    return this.report(entry.ref, { state: r.state as ReportState, summary: r.summary, ...(typeof r.question === 'string' || r.question === null ? { question: r.question as string | null } : {}), ...(typeof r.answers === 'string' ? { answers: r.answers } : {}), ...(typeof r.question === 'string' && typeof parseDecision(r) !== 'string' ? { decision: parseDecision(r) as DecisionSpec } : {}) }, typeof r.ticket_id === 'string' ? r.ticket_id : undefined, typeof r.pull_request === 'string' ? r.pull_request : undefined)
  }

  /** A Pi seat's turn fact for its current run (#688): the executor hears it. */
  private piFact(ref: string, op: 'idle' | 'read' | 'error', fact: Record<string, unknown>): Record<string, unknown> {
    if (op === 'idle') this.executor.memberIdle(ref, { quiet: fact.quiet !== false, text: typeof fact.text === 'string' ? clip(fact.text, 2_000) : '' })
    else if (op === 'error') this.executor.memberError(ref, Object.assign(new Error(typeof fact.error === 'string' ? fact.error : 'failed'), fact.transient === true ? {} : { status: 400 }))
    else this.executor.memberRead(ref)
    return { ok: true }
  }

  /** PR-C2, member host side: work the served team host sends one of this host's member sessions, signed by its pinned key. */
  assignedWork(op: unknown, memberHandle: unknown, signerKey: string, text: unknown): Record<string, unknown> {
    const serves = this.settingsValue.serves
    if (serves === undefined || serves.key !== signerKey) return { ok: false, code: 'not-team', error: 'this host serves no team under that key' }
    const local = typeof memberHandle === 'string' ? this.d.localSessionOf?.(memberHandle) : undefined
    if (local === undefined || !serves.members.includes(local)) return { ok: false, code: 'not-member', error: 'that session does not serve this team' }
    if (op !== 'assign' && op !== 'input' && op !== 'stop') return { ok: false, code: 'op', error: 'op must be assign, input or stop' }
    // v5 acceptance F4: a serve stored before presets (or a session since swapped) takes no new work on another preset;
    // a stop still reaches it.
    const wrongPreset = op === 'stop' ? undefined : presetRefusal(undefined, [local], this.d.presetOf ?? (() => undefined), true)
    if (wrongPreset !== undefined) { this.noteRefusal('superagent-member-preset', { target: local }); return { ok: false, code: 'preset', error: wrongPreset } }
    if (typeof text !== 'string' || text === '') return { ok: false, code: 'text', error: 'text is required' }
    if (op === 'stop') this.d.cancelTurn?.(local)
    return { ok: this.d.deliverToSession(local, text) }
  }

  /** PR-C2, member host side: a served member's report goes to the team host (it answers whether it took it). */
  async forwardReport(member: string, report: { state: ReportState; summary: string; question?: string | null; answers?: string; ticket_id?: string; pull_request?: string; options?: readonly string[]; recommended?: string; level?: string; inputs?: Readonly<Record<string, unknown>> }): Promise<Record<string, unknown>> {
    const serves = this.settingsValue.serves
    if (serves === undefined || !serves.members.includes(member) || this.d.signedPost === undefined || this.d.handleOf === undefined) return { ok: false, code: 'not-member', error: 'this session serves no team' }
    try { return await this.d.signedPost(serves.url, '/a2a/superagent-team', { op: 'report', member: this.d.handleOf(member), report }) } catch (error) { return { ok: false, code: 'unreachable', error: String(error) } }
  }

  /** PR-F: a served member's acknowledgement or handback goes to the team host as a report does, signed. */
  async forwardTakeUp(member: string, op: 'ack' | 'handback', triggerId: string, text: string): Promise<Record<string, unknown>> {
    const serves = this.settingsValue.serves
    if (serves === undefined || !serves.members.includes(member) || this.d.signedPost === undefined || this.d.handleOf === undefined) return { ok: false, code: 'not-member', error: 'this session serves no team' }
    try { return await this.d.signedPost(serves.url, '/a2a/superagent-team', { op, member: this.d.handleOf(member), report: { trigger_id: triggerId, text } }) } catch (error) { return { ok: false, code: 'unreachable', error: String(error) } }
  }

  /**
   * PR-F (upstream orchestrator_ack / orchestrator_trigger_handback): a member takes up a person's message that reached its
   * ticket — `ack` posts a short acknowledgement on that person's Thread, and the ticket's worker owns the message from then on;
   * `handback` returns a message that asks for work beyond the ticket to the router's assessment. Only for the ticket bound to
   * the member. A message no member took up is handed to the router when its ticket ends (the engine's letGo), so nothing a
   * person said is lost.
   */
  takeUp(member: string, op: 'ack' | 'handback', triggerId: unknown, text: unknown): Record<string, unknown> {
    const bindings = this.executor.list().filter(b => b.member === member)
    const stored = typeof triggerId === 'string' ? bindings.find(b => this.store.tickets.get(b.ticketId)?.inputs.some(input => input.kind === 'trigger' && input.triggerId === triggerId)) : undefined
    const binding = stored ?? this.executor.bindingOf(member)
    if (binding === undefined) return { ok: false, code: 'not-assigned', error: 'no ticket is assigned to this session' }
    if (typeof triggerId !== 'string' || triggerId === '') return { ok: false, code: 'missing', error: 'trigger_id is required' }
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, code: 'missing', error: op === 'ack' ? 'text is required' : 'reason is required' }
    try {
      if (op === 'ack') {
        const comment = this.ackComment(binding.ticketId, triggerId)
        if (comment !== undefined) return comment
        const reply = this.engine.reply({ purpose: 'acknowledgement', ticketId: binding.ticketId, triggerId, text: clip(text.trim(), 1_000) })
        this.pass()
        return { ok: true, ticketId: binding.ticketId, trigger_id: triggerId, acknowledgement: reply.status, reused: reply.reused }
      }
      const queued = this.engine.handback(binding.ticketId, triggerId, clip(text.trim(), 300))
      this.pass()
      return { ok: true, ticketId: binding.ticketId, trigger_id: triggerId, queued }
    } catch (error) { return { ok: false, code: error instanceof UserError ? error.code : 'refused', error: error instanceof Error ? error.message : String(error) } }
  }

  /**
   * A member takes up a person's comment on the pull request its ticket follows. The host only reads GitHub, so a comment has
   * no Channel and the engine's acknowledgement refuses it; left untaken, it would go to the router as a new message when the
   * ticket ends. Recording the take-up is what the acknowledgement does on the engine's side; nothing is posted.
   * @returns undefined for anything else, which the engine then answers.
   */
  private ackComment(ticketId: string, triggerId: string): Record<string, unknown> | undefined {
    const trigger = this.store.triggers.get(triggerId), ticket = this.store.tickets.get(ticketId), disposition = this.store.triggers.disposition(triggerId)
    if (trigger?.source !== GITHUB_SOURCE || trigger.human !== true || ticket === undefined || ticket.ended !== undefined) return undefined
    if (disposition === undefined || !disposition.fanout.includes(ticketId) || disposition.context?.includes(ticketId) === true) return undefined
    const reused = disposition.acked?.includes(ticketId) === true
    if (!reused) this.store.atomic(() => { this.store.triggers.saveDisposition(triggerId, { ...disposition, acked: [...disposition.acked ?? [], ticketId] }) })
    return { ok: true, ticketId, trigger_id: triggerId, acknowledgement: 'recorded', reused, note: 'Recorded that you took this GitHub comment up. Nothing is posted on the pull request.' }
  }

  /** The person's own message this session's turn answers, if it answers one (design D11). */
  personMessageOf(session: string): PersonMessage | undefined { return this.d.personMessage?.(session) }

  /** The rule sets a settings write changed: each moves its revision, and a proposal against the old text goes stale. */
  private recordOwnerEdits(before: TeamSettings, after: TeamSettings): void {
    const change = { at: this.now(), by: 'owner' }
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
    if (!same(before.rules, after.rules)) this.ruleChanges.changed('team', change)
    if ((before.dispatch ?? '') !== after.dispatch) this.ruleChanges.changed('dispatch', change)
    for (const member of new Set([...Object.keys(before.profiles ?? {}), ...Object.keys(after.profiles)])) {
      if (!same(before.profiles?.[member], after.profiles[member])) this.ruleChanges.changed(memberScope(member), change)
    }
  }

  /**
   * The team's workers: the canvas's local members and its remote members — except a remote member the team lists as an
   * A2A bot, which is a caller (the workbench market sits on the canvas to be linked, docs/ops/superagent-market-team.md),
   * never one that takes tickets. Nor is an observer (workbench-market 18 §八, design D19): it stands outside the execution
   * and takes no ticket; it stays a member of the team for the gate, its requests and its cards.
   */
  private pool(): string[] { const now = this.settings; return [...now.members.filter(id => !now.observers.includes(id)), ...workerRemotes(now), ...this.childTeams().map(c => c.ref)] }
  /** superagent-root-team: a root team's child teams, from its canvas (none for a plain team). */
  private childTeams(): ReadonlyArray<{ ref: string; slots: number }> {
    const canvas = this.settingsValue.canvas
    return canvas === undefined ? [] : this.d.canvasTeam?.(canvas)?.children ?? []
  }
  private childSlots(member: string): number | undefined { return isChildTeam(member) ? this.childTeams().find(c => c.ref === member)?.slots : undefined }
  private memberName(id: string): string { return isChildTeam(id) ? childLabel(id) : this.d.sessionName?.(id) ?? id }
  /** A member's name as it is shown anywhere (#851 review, non-blocking 3): the same cleaning as the health problems; the id when nothing is left. */
  private displayName(id: string): string { return cleanName(this.memberName(id)) ?? id }

  /** A split that failed after its parent was accepted: the parent runs as an ordinary ticket after all. */
  releaseSplit(parentId: string): void {
    const ticket = this.store.tickets.get(parentId)
    const latest = ticket?.assignments.at(-1)
    if (ticket !== undefined && !ticket.ended && latest !== undefined && latest.state === 'pending') this.executor.start(ticket, latest)
  }

  /** S3: the part of a split that an answer goes to: the one with an open question, else the first still open. */
  private splitTarget(parentId: string): string | undefined {
    const open = this.splits.children(parentId).map(id => this.store.tickets.get(id)).filter((t): t is Ticket => t !== undefined && !t.ended)
    return (open.find(t => t.attention !== undefined) ?? open[0])?.id
  }

  /** A ticket no member takes: a split parent, or the ticket of a request being split right now. */
  private splitHeld(ticketId: string): boolean {
    if (this.splits.isParent(ticketId)) return true
    const ticket = this.store.tickets.get(ticketId)
    return ticket !== undefined && this.splits.isSplitting(ticket.origin.triggerId)
  }

  /** S1: whether `asked` is the request's own words (whitespace aside), so a split happens only when the request asks for parts. */
  askedIn(triggerId: string, asked: string): boolean {
    const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()
    const words = norm(asked)
    const trigger = this.store.triggers.get(triggerId)
    return words.length >= 4 && trigger !== undefined && norm(trigger.text).includes(words)
  }

  /**
   * S2: make the parts of a parent ticket. Each part is the parent's request cloned onto a thread of its own (so a part's
   * start fans into nothing), accepted at once with the part's title and scope under the parent's rules: the router's
   * split is the decision. A part may name its member. The parent is held from members from now on.
   */
  splitParent(parentId: string, asked: string, parts: ReadonlyArray<{ title: string; scope: string; member?: string }>, reason: string): { ok: true; children: string[]; refused: Array<{ part: number; member: string }> } | { ok: false; code: string; error: string } {
    const parent = this.store.tickets.get(parentId)
    const origin = parent === undefined ? undefined : this.store.triggers.get(parent.origin.triggerId)
    if (parent === undefined || origin === undefined || parent.ended) return { ok: false, code: 'ticket', error: 'no open ticket with that id' }
    const rules = parent.mandate.basis.rules ?? []
    const children: string[] = []
    const refused: Array<{ part: number; member: string }> = []
    const at = this.now()
    for (const [index, part] of parts.entries()) {
      const thread = origin.threads[0]!
      const child = { ...origin, id: `split-${parentId.slice(0, 8)}-${String(index + 1)}-${randomUUID().slice(0, 8)}`, at,
        threads: [{ source: thread.source, id: `${thread.id}#part${String(index + 1)}` }],
        text: `[part ${String(index + 1)}/${String(parts.length)} of «${parent.title}»] ${part.scope}`, meta: { ...origin.meta, splitOf: parentId } }
      try {
        const received = this.engine.receive(child as Trigger)
        if (received !== 'stored') return { ok: false, code: 'part', error: `part ${String(index + 1)} was not taken in (${received})` }
        const decision = this.engine.decide(child.id, { kind: 'accept', title: part.title, scope: part.scope, reason, ...(rules.length > 0 ? { rules: [...rules] } : {}) } as never)
        if (decision.ticketId === undefined) return { ok: false, code: 'part', error: `part ${String(index + 1)} opened no ticket` }
        children.push(decision.ticketId)
        const named = this.named.namedOf(parentId)
        // Ticket eabe1586 (#865 review): a part named to a member the owner took this work off is not recorded as that
        // member's, nor handed to the parent's named seat: like accept, it goes to another member and the result says so. It asks
        // about the parent: the children are recorded as its split only after this loop, so a child cannot reach it yet.
        const excluded = part.member !== undefined && this.excludedFrom(parentId, part.member)
        if (excluded) refused.push({ part: index + 1, member: part.member! })
        else if (part.member !== undefined) this.executor.setMember(decision.ticketId, part.member)
        else if (named !== undefined) this.named.accepted(decision.ticketId, named)
      } catch (error) { return { ok: false, code: 'part', error: `part ${String(index + 1)}: ${String(error)}` } }
    }
    this.splits.record(parentId, children, asked, at)
    this.d.logger.info('superagent: ticket %s split into %s', parentId, children.join(', '))
    queueMicrotask(() => this.pass())
    return { ok: true, children, refused }
  }

  /**
   * S4: a split parent whose parts have all ended ends too, with one combined report — \`ready\` when every part completed,
   * else \`failed\` part by part and then stopped (its receipt says failed).
   */
  private settleSplits(): void {
    for (const parentId of this.splits.parentIds()) {
      const parent = this.store.tickets.get(parentId)
      if (parent === undefined || parent.ended) continue
      const children = this.splits.children(parentId).map(id => this.store.tickets.get(id))
      if (children.length === 0 || children.some(child => child === undefined || child.ended === undefined)) continue
      const done = children.every(child => child!.ended!.outcome === 'completed' || child!.ended!.outcome === 'merged')
      const lines = children.map((child, index) => {
        const seat = this.seatOf(child!.id)
        const summary = [...child!.assignments].reverse().find(a => a.report !== undefined)?.report?.summary
        return `${String(index + 1)}. ${child!.title} — ${seat?.name ?? seat?.seat ?? '?'}: ${child!.ended!.outcome}${summary !== undefined ? `；${summary}` : ''}`
      })
      const summary = clip(`${done ? '全部子项完成' : '部分完成（有子项未完成）'}：\n${lines.join('\n')}`, 3_000)
      try {
        if (done) this.engine.report(parentId, { state: 'ready', summary })
        else {
          this.splits.markFailed(parentId)
          this.engine.report(parentId, { state: 'failed', summary })
          this.engine.stopTicket(parentId, 'a part of the split did not complete')
        }
        this.d.logger.info('superagent: split ticket %s ended (%s)', parentId, done ? 'completed' : 'failed')
      } catch (error) { this.d.logger.warn('superagent: split ticket %s not ended: %s', parentId, String(error)) }
    }
  }

  /** S2/S4: a split parent's children as the requester sees them, and the parent's outcome once it ended. */
  splitView(ticketId: string): { tickets: Array<{ id: string; title: string; seat?: string; state: 'queued' | 'working' | 'waiting' | 'blocked' | 'ended'; outcome?: string }>; outcome?: 'completed' | 'failed' } | undefined {
    if (!this.splits.isParent(ticketId)) return undefined
    const parent = this.store.tickets.get(ticketId)
    const tickets = this.splits.children(ticketId).flatMap(id => {
      const child = this.store.tickets.get(id)
      if (child === undefined) return []
      const seat = this.seatOf(id)?.seat
      const state = child.ended ? 'ended' as const : (progressState(child) ?? 'working')
      return [{ id, title: child.title.slice(0, 200), ...(seat !== undefined ? { seat } : {}), state, ...(child.ended ? { outcome: child.ended.outcome } : {}) }]
    })
    const outcome = parent?.ended === undefined ? undefined : this.splits.failed(ticketId) ? 'failed' as const : 'completed' as const
    return { tickets, ...(outcome !== undefined ? { outcome } : {}) }
  }

  /** #888 D4: whether a ticket's open question is a card with an option that needs input (decided on the decision page). */
  private questionNeedsInput(ticketId: string, question: string): boolean {
    const card = this.decisions.get(ticketCardId(ticketId, question))
    return card !== undefined && card.decided === undefined && needsInput(card)
  }

  /** market N1d: the answers the ticket's open question offers, from the card the member's question report raised. */
  choicesOf(ticketId: string): { options: string[]; recommended?: string } | undefined {
    const ticket = this.store.tickets.get(ticketId)
    if (ticket?.attention === undefined) return undefined
    const card = this.decisions.get(ticketCardId(ticket.id, ticket.attention.question))
    // #888 D4: a question with an option that needs input is decided on this host only in phase one; no choices go out.
    if (card === undefined || card.options.length === 0 || needsInput(card)) return undefined
    return { options: [...card.options], ...(card.recommended !== '' ? { recommended: card.recommended } : {}) }
  }

  /**
   * superagent-market-progress-roster P2, the light path: an agent's message that reached a live ticket on that ticket's own
   * thread, from the very caller the ticket was accepted from, is routed to that ticket at once — the router's `attach`,
   * made by the host — so it is not queued for the router's judgement. A person's message is the engine's to decide
   * already; another caller's message in the same conversation still goes to the router.
   */
  private lightPath(triggerId: string): void {
    const trigger = this.store.triggers.get(triggerId)
    const disposition = this.store.triggers.disposition(triggerId)
    if (trigger === undefined || trigger.human || disposition === undefined) return
    for (const ticketId of disposition.fanout) {
      if (disposition.context?.includes(ticketId)) continue
      const ticket = this.store.tickets.get(ticketId)
      const origin = ticket !== undefined && !ticket.ended ? this.store.triggers.get(ticket.origin.triggerId) : undefined
      if (origin === undefined || origin.human || origin.actor.source !== trigger.actor.source || origin.actor.id !== trigger.actor.id) continue
      // S3: a split parent takes no work; the answer goes to the part that asked (else the first open one).
      const target = this.splits.isParent(ticketId) ? this.splitTarget(ticketId) ?? ticketId : ticketId
      try {
        this.engine.attach(target, triggerId)
        this.d.logger.info('superagent: %s from %s goes straight to ticket %s (light path)', triggerId, trigger.actor.id, ticketId)
        this.named.answered(target, trigger.text)
        return
      } catch (error) { this.d.logger.warn('superagent: light path for %s into %s not taken: %s', triggerId, ticketId, String(error)) }
    }
  }

  /**
   * market N1c: the seat a ticket's receipts name as the one that took it up — its member once one holds it (the one it
   * last ran on, after it ended), else the router that accepted it — as its A2A handle (the session id where the host has none) and its name.
   */
  seatOf(ticketId: string): { seat: string; seatId?: string; name?: string; role: 'router' | 'member' | 'observer' } | undefined {
    const worker = this.executor.memberOfTicket(ticketId)?.member ?? this.executor.lastMemberOf(ticketId)
    const session = worker ?? this.settingsValue.router
    if (session === undefined || session === '') return undefined
    // The market shows who does the work (its 承接) from a member's seat only: the role says which one this is.
    // From the session's preset, not the canvas settings: this runs in the first pass at boot (a progress step for an open
    // ticket), before the a2a plugin's card cache exists, and reading the canvas there failed the plugin's start.
    const role = worker === undefined ? 'router' as const : this.d.presetOf?.(worker) === OBSERVER_PRESET ? 'observer' as const : 'member' as const
    const seat = this.d.handleOf?.(session) ?? session
    // #861 review: the seat's name is shown (receipts, the market's 承接), so it is cleaned like every other shown name.
    const name = cleanName(plainName(this.d.sessionName?.(session)))
    // The seat's stable id (named dispatch N2), as the roster gives it: the market keys its records on it, not the handle.
    const seatId = this.named.seatIdOf(session)
    return { seat, ...(seatId !== undefined ? { seatId } : {}), ...(name !== undefined && name !== '' && name !== seat ? { name } : {}), role }
  }
  /** The stable seat id a member's team MCP calls are made as (#690 F1): the member's own, from the roster. */
  mcpSeatOf(member: string): string | undefined { return this.named.seatIdOf(member) }
  memberListLine(): string {
    // Names that read the same once cleaned also show their id, so the router can still name the one it means.
    const pool = this.pool(), shown = pool.map(id => this.displayName(id))
    const twice = new Set(shown.filter((name, i) => shown.indexOf(name) !== i))
    return `The team's members: ${pool.map((id, i) => twice.has(shown[i]!) ? `${shown[i]} (${id})` : shown[i]).join('; ') || '(none)'}.`
  }

  /** A member by its session id, the first eight of it, or its name; undefined when none matches, or more than one. */
  resolveMember(value: string): string | undefined {
    const wanted = value.trim().toLowerCase()
    const matches = this.pool().filter(id => {
      const short = id.replace(/^session-/, '')
      // The raw name still matches, and so does the name as shown (the router only ever sees that one); two members that
      // read the same either way match together, so neither is picked. A name cleaned to nothing is reached by its id.
      const raw = this.memberName(id), shown = cleanName(raw)
      return id.toLowerCase() === wanted || short.toLowerCase() === wanted || short.slice(0, 8).toLowerCase() === wanted || raw.toLowerCase() === wanted || (shown !== undefined && shown.toLowerCase() === wanted)
    })
    return matches.length === 1 ? matches[0] : undefined
  }

  /** Whether any member has a role or rules: then an accept must name one (design D5). */
  membersProfiled(): boolean { return this.pool().some(id => this.settingsValue.profiles[id] !== undefined) }

  /** What the router sees of the team when it dispatches (design D4). */
  /** This team's ygl-trees project (design Y1c), named after its canvas; none while the team has no canvas. */
  yglProject(): string | undefined { return this.settingsValue.canvas === undefined ? undefined : teamYglProject(this.settingsValue.canvas) }
  /** Ask the host to make the team's project (idempotent, cached there); never in the way of the work. */
  /** This team's kb scope (design Y1e); none while the team has no canvas, or the installed ygl-trees has no kb scopes. */
  yglScope(): string | undefined { return this.settingsValue.canvas === undefined || this.yglCaps().kbScope !== true ? undefined : teamYglScope(this.settingsValue.canvas) }
  private yglCaps() { return this.d.yglCapabilities?.() ?? YGL_UNKNOWN }
  /** Whether cards that depend on the installed ygl-trees may go out yet (#739 review R1). */
  private yglReady(): boolean { return this.d.yglReady?.() !== false }
  /** Send what the ygl-trees barrier held: undelivered candidates and waiting launches. */
  resumeHeld(): void { if (!this.yglReady()) return; this.flushCandidates(); this.executor.launch() }
  private ensureYglProject(): void { const project = this.yglProject(); if (project !== undefined) { try { this.d.ensureYglProject?.(project) } catch { /* best effort */ } } }
  private yglRouterLines(router: string): string[] {
    const project = this.yglProject()
    if (project === undefined || (this.d.hasTool?.(router, 'mcp__ygl__read') !== true && this.d.hasTool?.(router, YGL_TREES) !== true)) return []
    this.ensureYglProject()
    return [yglRouterLine(project, this.yglScope())]
  }

  private teamCardLines(): string[] {
    const pool = this.pool()
    const dispatch = this.settingsValue.dispatch
    const children = this.childTeams()
    if (dispatch === '' && !this.membersProfiled() && children.length === 0) return []
    const lines = ['The team\'s members. When you accept, name the one the work fits as member, by the dispatch rules and each member\'s role and rules:']
    // superagent-root-team R1: a root's members are teams; the host sends each ticket to the team named, and the team's own router decides inside it.
    if (children.length > 0) lines.unshift(`This team is a root: its members include other teams (${children.map(c => `${childLabel(c.ref)}, up to ${String(c.slots)} at once`).join('; ')}). Name the team the work fits as member; the host sends it there and the team's own router decides who does it. To have several teams work on one request that asks for parts, split it with superagent_split.`)
    for (const id of pool) {
      const profile = this.settingsValue.profiles[id]
      const held = this.executor.bindingOf(id)
      const repo = this.settingsValue.repos[id]
      lines.push(`- ${this.displayName(id)} · ${held === undefined ? 'free' : `working on ${held.ticketId}`}${repo !== undefined ? ` · repository ${repo}` : ''}${profile?.role !== undefined ? ` · role: ${clip(profile.role, 200)}` : ''}`)
      for (const rule of (profile?.rules ?? []).filter(r => r.enabled)) lines.push(`  - takes (${rule.name}): ${clip(rule.text, 400)}`)
    }
    if (dispatch !== '') lines.push('Dispatch rules:', clip(dispatch, 2_000))
    return lines
  }

  /** What a member is told along with a ticket (design D6). */
  private memberNotes(member: string, ticket: Ticket): string[] {
    const profile = this.settingsValue.profiles[member]
    const lines: string[] = []
    if (profile?.role !== undefined) lines.push(`your role: ${profile.role}`)
    for (const rule of (profile?.rules ?? []).filter(r => r.enabled)) lines.push(`your rule ${rule.name}: ${clip(rule.text, 600)}`)
    if (profile !== undefined) lines.push('If this ticket does not fit your role and rules, report blocked and say why; the router will choose again.')
    // The team's memory, in the card the member acts on (owner 2026-11-10: a persona line alone was not followed).
    if (this.d.hasTool?.(member, YGL_WRITE) === true || this.d.hasTool?.(member, YGL_TREES) === true) { this.ensureYglProject(); lines.push(...yglCardLines(this.yglProject(), { scope: this.yglScope(), caps: this.yglCaps(), trees: this.d.hasTool?.(member, YGL_TREES) === true })) }
    for (const name of ticket.mandate.basis.rules ?? []) {
      const rule = this.settingsValue.rules.find(r => r.name === name)
      if (rule !== undefined) lines.push(`accepted on team rule ${rule.name}: ${clip(rule.text, 600)}`)
    }
    // superagent-team-mcp M2: the team's MCP servers go through the host; a member never looks for a token (the 2026-11-11 trial).
    const servers = this.settingsValue.mcp ?? []
    if (servers.length > 0) lines.push(`This team's MCP servers: ${servers.map(s => s.name).join(', ')}. Their tools are your tools named team__<server>__<tool>; call them for this ticket and the host calls the server with the token it holds. Never look for or use a token file yourself.`)
    lines.push(...this.promptCardLines('communication'))
    lines.push(...this.promptCardLines('delivery'))
    return lines
  }

  /** The owner's prompt supplements as card lines (owner 2026-11-10, 对照上游): presets stand; on a clash these lose. */
  private promptCardLines(which: 'communication' | 'delivery'): string[] {
    const text = this.settingsValue.prompts?.[which]
    if (text === undefined || text.trim() === '') return []
    const head = which === 'communication' ? 'the owner\'s words on how this team talks (they add to the preset; where they clash, the preset stands)' : 'the owner\'s words on what delivery looks like (they add to the preset; where they clash, the preset stands)'
    return [head + ':', clip(text, PROMPT_MAX)]
  }

  /** Give a ticket to another member: one still waiting for its first, or one whose member reported it cannot go on (design D6, D7a). */
  assignTicket(ticketId: string, value: string): Record<string, unknown> {
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended !== undefined) return { ok: false, code: 'unknownTicket', error: this.wrongId('ticket', ticketId) }
    const member = this.resolveMember(value)
    if (member === undefined) return { ok: false, code: 'member', error: `no such member: ${value}. ${this.memberListLine()}` }
    // Ticket 877ca64f: say so instead of ok:true for a member this ticket will never run on.
    if (this.credentialExcluded(ticketId).includes(member)) return { ok: false, code: 'excluded', error: `${this.displayName(member)} is excluded from this ticket: the owner took this work off it on a credential-access card; give it to another member` }
    const latest = ticket.assignments.at(-1)
    const card = this.executor.list().find(b => b.assignmentId === latest?.id)?.card
    if (card === 'sending') return { ok: false, code: 'assignment-in-flight', error: 'the original assignment card is still in flight; wait for its result or stop that ticket, do not send another card' }
    if (latest?.state === 'pending' && card === undefined) { this.named.assigned(ticketId); this.executor.setMember(ticketId, member); return { ok: true, ticket_id: ticketId, member: this.displayName(member) } }
    // A restored unknown card has a failed report: only this explicit retry action (after reconciliation) creates a new run.
    // A refused reassignment leaves nothing changed (#690 F1): the running member keeps the ticket, its name and its hold.
    const before = this.executor.memberOfTicket(ticketId)
    this.executor.setMember(ticketId, member)
    try { this.engine.retryTicket(ticketId) } catch (error) {
      this.executor.restoreMember(ticketId, before)
      return { ok: false, code: error instanceof UserError ? error.code : 'refused', error: `the ticket is running and its member has not reported it cannot go on: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.named.assigned(ticketId)
    this.pass()
    return { ok: true, ticket_id: ticketId, member: this.displayName(member) }
  }

  /** What a rule set holds now, in the shape a proposal for it takes. */
  private rulePatch(scope: RuleScope, value: unknown): Record<string, unknown> {
    if (scope === 'team') return { rules: value }
    if (scope === 'dispatch') return { dispatch: value }
    const member = scope.slice('member:'.length)
    const pool = new Set(this.pool())
    return { profiles: { ...Object.fromEntries(Object.entries(this.settingsValue.profiles).filter(([id]) => pool.has(id))), [member]: value } }
  }

  /** File a proposal: checked as a write would be, and nothing changes (design D8). */
  proposeRules(scope: RuleScope, by: string, value: unknown, reason: string): Record<string, unknown> {
    const checked = parseSettings(this.rulePatch(scope, value), this.settings)
    if (!checked.ok) return { ok: false, code: 'invalid', error: checked.error }
    const proposal = this.ruleChanges.propose(scope, by, value, clip(reason.trim(), 1_000), Date.parse(this.now()))
    return { ok: true, scope, proposal_id: proposal.id, revision: proposal.base, next: 'Show the owner the text and wait. It applies only after the owner has replied to you, with the apply tool.' }
  }

  /** Apply a proposal once the person has spoken after it (design D9). */
  applyRules(scope: RuleScope, by: string, person: PersonMessage | undefined): Record<string, unknown> {
    if (person === undefined) return { ok: false, code: 'not-the-owner', error: 'this applies only in a turn answering the owner\'s own message' }
    const proposal = this.ruleChanges.pending(scope)
    if (proposal === undefined || proposal.by !== by) return { ok: false, code: 'no-proposal', error: 'there is no proposal of yours for this rule set' }
    if (person.atMs <= proposal.atMs) return { ok: false, code: 'not-yet', error: 'the owner has not replied since this proposal: show it to them and wait' }
    if (this.ruleChanges.revision(scope) !== proposal.base) return { ok: false, code: 'stale', error: 'this rule set changed after the proposal: read it again and propose afresh', revision: this.ruleChanges.revision(scope) }
    const parsed = parseSettings(this.rulePatch(scope, proposal.value), this.settings)
    if (!parsed.ok) return { ok: false, code: 'invalid', error: parsed.error }
    const before = policyVersion(this.settingsValue)
    const previous = this.settings
    this.writeSettings(parsed.settings)
    this.ruleChanges.applied(scope, { at: this.now(), by, reason: proposal.reason, message: clip(person.text, 1_000) })
    const after = policyVersion(parsed.settings)
    if (before !== after) this.engine.policyChanged(before, after, policyEffects(previous, this.settings, this.store.tickets.list().filter(t => !t.ended)))
    this.pass()
    return { ok: true, scope, revision: this.ruleChanges.revision(scope) }
  }

  /** File the person's own message as their request, once (design D12). */
  requestForPerson(person: PersonMessage): Record<string, unknown> {
    const existing = this.ruleChanges.requestOf(person.id)
    if (existing !== undefined) return { ok: true, trigger_id: existing, reused: true }
    const filed = this.request(person.text)
    if (!filed.ok) return { ok: false, code: 'refused', error: filed.error }
    this.ruleChanges.recordRequest(person.id, filed.triggerId)
    return { ok: true, trigger_id: filed.triggerId, thread: filed.thread }
  }

  /** What an observer or a member filed that is still undecided or on an open ticket. */
  private proposerOpen(actor: string): Trigger[] {
    const ids = new Set<string>()
    for (const thread of this.store.threads.list()) for (const id of [...thread.pending, ...(thread.evaluating?.triggerIds ?? [])]) ids.add(id)
    for (const ticket of this.store.tickets.list()) if (ticket.ended === undefined && ticket.mandate?.actor.id === actor) for (const id of ticket.origin?.triggerIds ?? []) ids.add(id)
    return [...ids].flatMap(id => { const t = this.store.triggers.get(id); return t !== undefined && t.actor.source === 'workbench' && t.actor.id === actor ? [t] : [] })
  }

  /** File an observer's own request (design D15). It reaches the router as any request does; the host only keeps a loop from flooding it. */
  requestForObserver(session: string, text: string): Record<string, unknown> {
    if (!this.isObserver(session)) return { ok: false, code: 'not-observer', error: 'a2a_ticket_request serves only the sessions on this team created under the observer preset' }
    const filed = this.fileProposal(observerActor(session), text, { observer: session })
    if (filed.ok === true) { const at = Date.parse(this.now()); this.healthReminders.observerActed(session, text, at); this.questionGate.acted(session, text, at) }
    return filed
  }

  /**
   * #717: file a plain member's proposal of new work. It is an agent's request, as an observer's is: it reaches the router as a
   * candidate and the router alone accepts, attaches or ignores it and chooses who works it. It does not touch, end or widen
   * any ticket the member holds. An observer's goes on as its own (actor `observer:`); a local member of this team files as
   * `member:<session>`, a remote member's arrives from its host as `member:<ref>` (remoteEvent).
   * @param member - the calling local session, or a remote member's ref.
   * @param text - what needs doing and why.
   * @param remote - whether `member` is a remote member's ref its pinned host vouched for.
   * @returns the request, the same one for an identical open text, or why not.
   */
  requestForMember(member: string, text: string, remote = false): Record<string, unknown> {
    if (!remote && this.isObserver(member)) return this.requestForObserver(member, text)
    const known = remote ? this.settings.remoteMembers.some(r => r.ref === member && r.platform !== PI_PLATFORM) : this.settings.members.includes(member)
    if (!known) return { ok: false, code: 'not-member', error: 'a2a_ticket_request serves only the members and observers of this team' }
    return this.fileProposal(memberActor(member), text, { member })
  }

  /** One agent's request (D15–D17, #717): an identical open text returns the same request, and at most OBSERVER_OPEN_MAX stay open. */
  private fileProposal(actor: string, text: string, via: Exclude<WorkbenchVia, 'cli'>): Record<string, unknown> {
    const open = this.proposerOpen(actor)
    const repeated = open.find(t => t.text === text.trim())
    if (repeated !== undefined) return { ok: true, trigger_id: repeated.id, reused: true }
    if (open.length >= OBSERVER_OPEN_MAX) return { ok: false, code: 'too-many-open', error: `you already have ${String(open.length)} requests open; wait for one to end before filing another` }
    const filed = this.request(text, undefined, via)
    if (!filed.ok) return { ok: false, code: 'refused', error: filed.error }
    return { ok: true, trigger_id: filed.triggerId, thread: filed.thread }
  }

  /** #717, member host side: a served member's proposal goes to the team host it serves, signed, as its reports do. */
  async forwardProposal(member: string, text: string): Promise<Record<string, unknown>> {
    const serves = this.settingsValue.serves
    if (serves === undefined || !serves.members.includes(member) || this.d.signedPost === undefined || this.d.handleOf === undefined) return { ok: false, code: 'not-member', error: 'this session serves no team' }
    try { return await this.d.signedPost(serves.url, '/a2a/superagent-team', { op: 'ticket-request', member: this.d.handleOf(member), report: { text } }) } catch (error) { return { ok: false, code: 'unreachable', error: String(error).slice(0, 200) } }
  }

  /**
   * Stage a session's files for a card it raises (decision cards C8).
   * @param session - the proposing session, whose workspace relative paths are read from.
   * @param paths - the files; none is fine.
   * @returns the staged files, or why not.
   */
  stageCardFiles(session: string, paths: unknown): { ok: true; files: DecisionFile[] } | { ok: false; code: string; error: string } {
    const list = Array.isArray(paths) ? paths.map(p => String(p).trim()).filter(p => p !== '') : []
    if (list.length === 0) return { ok: true, files: [] }
    if (list.length > DECISION_FILES_MAX) return { ok: false, code: 'files', error: `a card carries at most ${String(DECISION_FILES_MAX)} files` }
    const canvas = this.settings.canvas
    if (this.d.stageFiles === undefined || canvas === undefined) return { ok: false, code: 'files', error: 'this host cannot put files on a card' }
    return this.d.stageFiles(session, list, canvas)
  }

  /** Raise a card of the router's or an observer's own (decision cards C2, C8). */
  proposeDecision(source: 'router' | 'observer', by: string, question: string, spec: DecisionSpec, reason?: string, files?: readonly DecisionFile[]): Record<string, unknown> {
    const out = this.decisions.propose({ source, by, question, spec, at: this.now(), ...(reason !== undefined && reason.trim() !== '' ? { reason: reason.trim() } : {}), ...(files !== undefined ? { files } : {}) })
    // R7a: an observer's card that names a health problem it was told about counts as acting on it.
    if (out.ok && source === 'observer') { const at = Date.parse(this.now()); this.healthReminders.observerActed(by, `${question}\n${reason ?? ''}`, at); this.questionGate.acted(by, `${question}\n${reason ?? ''}`, at) }
    return out
  }

  /**
   * R7b: the observer leaves a note on one of this team's open tickets. It reaches the member holding it as a fact that
   * grants nothing, like the router's notes; it cannot change, stop or reassign the ticket. A note carrying a question's
   * `[提问 <ticket>]` token handles that question, and starts the no-loop hour on the ticket.
   */
  observerNote(session: string, ticketId: string, text: string): Record<string, unknown> {
    if (!this.isObserver(session)) return { ok: false, code: 'not-observer', error: 'a2a_ticket_note serves only the team\'s observer' }
    const body = text.trim()
    if (body === '' || body.length > 4_000) return { ok: false, code: 'text', error: 'text must be 1..4000 characters' }
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended !== undefined) return { ok: false, code: 'ticket', error: 'name an open ticket of this team' }
    try { this.engine.note(ticketId, `[观察者留言] ${body}`) } catch (error) { return { ok: false, code: 'refused', error: error instanceof Error ? error.message : String(error) } }
    const at = Date.parse(this.now())
    this.questionGate.notedOn(ticketId, at)
    this.questionGate.acted(session, body, at)
    this.pass()
    return { ok: true, ticketId }
  }

  /** R7b: questions the observer did not settle go on to the person by the existing route. */
  private questionTick(): void {
    let moved: Array<{ ticketId: string; why: string }>
    try { moved = this.questionGate.tick(id => { const t = this.store.tickets.get(id); return t !== undefined && t.ended === undefined && t.attention !== undefined }, Date.parse(this.now())) } catch (error) { this.d.logger.warn('superagent: question look skipped: %s', String(error)); return }
    const words: Record<string, string> = { unloaded: '观察者会话没有加载', silent: '观察者一小时内没有处理', 'still-waiting': '观察者处理后一小时单子仍在等' }
    for (const { ticketId, why } of moved) {
      const ticket = this.store.tickets.get(ticketId)
      if (ticket === undefined) continue
      this.relayReport(ticketId, 'waiting', `${words[why] ?? why}，问题按原路交给人。`)
    }
    if (moved.length > 0) this.pass()
  }

  /**
   * Observer phase 1 (workbench-market 18 #883): what the observer reads of the same host's prompt-template plugin —
   * the card library, one session's own templates, and the intervention log (digests, never text). The plugin's
   * read-only routes are the source in phase 1. A host without the plugin, or with one older than 0.16 (schema 9),
   * answers `available: false` with why, never an error that stops the observer.
   */
  async promptTemplates(kind: 'library' | 'templates' | 'interventions', q: { session_id?: string; since?: string; source?: string; limit?: number } = {}): Promise<Record<string, unknown>> {
    // The plugin's /plugins/ routes answer this host's own loopback without a token; the observer never sees a credential.
    const read = this.d.templatesRead ?? (async (path: string) => {
      const home = this.d.homeUrl?.()
      if (home === undefined) throw new Error('web server not up')
      const res = await fetch(`${home}/plugins/dsh-prompt-templates/${path}`, { signal: AbortSignal.timeout(5_000) })
      return { status: res.status, body: await res.json().catch(() => undefined) }
    })
    // #762 review: one domain, one observer — templates and interventions are read for this team's own sessions only.
    // The library is the host's shared card set and is read whole.
    const team = new Set([this.settings.router, ...this.settings.members].filter((id): id is string => typeof id === 'string'))
    const session = q.session_id?.trim() ?? ''
    if (kind !== 'library' && session !== '' && !team.has(session)) return { ok: false, code: 'not-in-team', error: 'that session is not a member of this team: an observer reads its own team\'s sessions only' }
    const params = new URLSearchParams()
    let limit = INTERVENTIONS_READ_DEFAULT
    if (kind === 'templates') {
      if (session === '') return { ok: false, code: 'session_id', error: 'kind templates needs session_id: the session whose own templates to read' }
      params.set('session_id', session)
    }
    if (kind === 'interventions') {
      if (q.since !== undefined && q.since.trim() !== '') {
        const at = Date.parse(q.since.trim())
        if (!/^\d{4}-\d{2}-\d{2}/.test(q.since.trim()) || Number.isNaN(at)) return { ok: false, code: 'since', error: 'since must be an ISO time, e.g. 2026-11-20T08:00:00Z' }
        params.set('since', new Date(at).toISOString())
      }
      if (q.source !== undefined && q.source.trim() !== '') {
        if (!['schedule', 'event', 'manual', 'plugin'].includes(q.source.trim())) return { ok: false, code: 'source', error: 'source must be schedule, event, manual or plugin' }
        params.set('source', q.source.trim())
      }
      if (q.limit !== undefined && Number.isFinite(q.limit)) limit = Math.max(1, Math.min(INTERVENTIONS_READ_MAX, Math.trunc(q.limit)))
      if (session !== '') params.set('session_id', session)
      // Without a session the plugin is asked for its widest page and the rows are kept to this team's sessions.
      params.set('limit', String(session !== '' ? limit : INTERVENTIONS_READ_MAX))
    }
    const target = `${kind === 'interventions' ? 'interventions' : 'library'}${params.size > 0 ? `?${params.toString()}` : ''}`
    // Fixed words to the observer; the plugin's own error text goes to the host log only.
    const unavailable = (reason: string, detail?: string): Record<string, unknown> => {
      if (detail !== undefined) this.d.logger.warn('superagent: prompt-templates %s read: %s', kind, detail)
      return { ok: true, available: false, reason }
    }
    let out: { status: number; body: unknown }
    try { out = await read(target) } catch (error) { return unavailable('dsh-prompt-templates could not be read on this host right now', error instanceof Error ? error.message : String(error)) }
    if (out.status === 404) return unavailable('dsh-prompt-templates is not installed on this host, or is older than 0.16')
    const body = out.body as { schema?: unknown; items?: unknown } | undefined
    if (out.status !== 200 || body === undefined) return unavailable('dsh-prompt-templates did not answer the read', `HTTP ${String(out.status)}`)
    if (typeof body.schema !== 'number' || body.schema < 9 || !Array.isArray(body.items)) return unavailable('dsh-prompt-templates is older than 0.16 (schema 9): upgrade it to read the library and the log')
    let items = body.items as Array<Record<string, unknown>>
    if (kind === 'interventions' && session === '') items = items.filter(row => typeof row['session_id'] === 'string' && team.has(row['session_id'] as string)).slice(-limit)
    return { ok: true, available: true, schema: body.schema, items }
  }

  /**
   * Observer phase 2 (T5-A): the observer casts one card into one of its own team's sessions, through the same host's
   * prompt-template plugin. The plugin only recognizes the caller as this a2a plugin, so who may cast is checked here:
   * the team's observer (by the session calling, never a parameter), into a session of this team other than itself, while
   * the owner has turned observerCast on. The target is woken so the card goes in at its next step.
   */
  castCard(observer: string, input: { session_id?: unknown; template_id?: unknown; reason?: unknown; basis?: unknown; mode?: unknown; when?: unknown; then?: unknown; expires_hours?: unknown }, release?: string): Record<string, unknown> {
    const checked = this.castCheck(observer, input)
    if ('refusal' in checked) return checked.refusal
    const { target, templateId, reason, basis, draft } = checked
    // #902 S3: how the card goes in — insert (next step, woken), queue (its next turn, not woken), trigger (only while
    // idle: queued and woken now), or release (armed now, cast later when its condition holds).
    const mode = input.mode === undefined || input.mode === null || input.mode === '' ? 'insert' : String(input.mode)
    if (mode !== 'insert' && mode !== 'queue' && mode !== 'trigger' && mode !== 'release') return { ok: false, code: 'mode', error: 'mode is insert, queue, trigger or release' }
    // #902 review (#910 B1): an older plugin may ignore a mode it does not know, so only insert goes to one that does not declare queue.
    if (mode !== 'insert' && !this.castModes().includes('queue')) return { ok: true, available: false, reason: `this host's dsh-prompt-templates does not declare the queue mode (needs #89+): ${mode} is off here; cast insert` }
    if (mode === 'release') return this.armRelease(observer, { target, templateId, reason, basis }, input)
    if (mode !== 'insert' && mode !== 'queue' && mode !== 'trigger') return { ok: false, code: 'mode', error: 'mode is insert, queue, trigger or release' }
    if (mode === 'trigger' && target === this.settingsValue.router && this.settingsValue.observerTriggerRouter !== true) return { ok: false, code: 'trigger-router', error: 'trigger does not wake the router unless the owner allows it: cast insert or queue into it' }
    // #764 review: per target, at most CAST_PER_HOUR casts an hour and one wake per CAST_WAKE_MS; kept across restarts.
    const now = Date.parse(this.now())
    const limits = this.castLimits()
    const entry = limits[target] ?? { casts: [], wakeAt: 0 }
    entry.casts = entry.casts.filter(at => now - at < 3_600_000 && at <= now + 60_000)
    if (entry.casts.length >= CAST_PER_HOUR) return { ok: false, code: 'rate-limited', error: `at most ${String(CAST_PER_HOUR)} casts an hour into one session` }
    if (mode === 'trigger') {
      if (this.d.sessionBusy === undefined) return { ok: true, available: false, reason: 'this host cannot tell whether a session is idle, so it does not trigger' }
      if (this.d.sessionBusy(target) !== false) return { ok: false, code: 'busy', error: 'trigger only into an idle session: it is in a turn now (cast queue, or arm a release with when idle:<minutes>)' }
      const last = entry.triggerAt ?? 0
      if (now - last < TRIGGER_MS && last <= now + 60_000) return { ok: false, code: 'trigger-limited', error: 'at most one trigger every 30 minutes into one session' }
    }
    // #902 review (#907 B2): every cast carries its team, observer and requested mode (and its release), when the plugin keeps it.
    const origin = this.castOrigin(observer, mode, release)
    const out = this.d.castCard?.({ sessionId: target, templateId, reason, basis, ...(draft !== undefined ? { authorSession: observer } : {}), ...(mode === 'insert' ? {} : { mode: 'queue' as const }), ...(origin !== undefined ? { origin } : {}) })
    if (out === undefined) return { ok: true, available: false, reason: 'dsh-prompt-templates with the cast service (0.17+) is not on this host' }
    if (!out.ok) return { ok: false, code: out.code ?? 'refused', error: out.error ?? 'the card was not cast' }
    entry.casts.push(now)
    // Wake the target so the card goes in at its next step (a wake carries no instruction of its own): insert at most
    // once per window; trigger always (its own limit above); queue never — it waits for the target's next turn.
    const wake = mode === 'trigger' || (mode === 'insert' && (now - entry.wakeAt >= CAST_WAKE_MS || entry.wakeAt > now + 60_000))
    if (wake) {
      entry.wakeAt = now
      if (mode === 'trigger') entry.triggerAt = now
    }
    // #902 review (#910 B2): the wake is reported as it went — sent, the target not live here, or failed — never assumed.
    let wakeResult: 'none' | 'sent' | 'not-live' | 'failed' = 'none'
    if (wake) {
      try { wakeResult = this.d.deliverToSession(target, '[superagent card] 团队观察者投来一张卡，会在你下一步看到；它不是新的指令，不授予任何权限。') ? 'sent' : 'not-live' } catch { wakeResult = 'failed' }
    }
    limits[target] = entry
    const recorded = this.saveCastLimits(limits)
    return { ok: true, mode, queued: out.queued ?? 1, woken: wakeResult === 'sent', wake: wakeResult, ...(recorded ? {} : { limitsRecorded: false }), ...(typeof out.id === 'string' ? { id: out.id } : {}), ...(origin !== undefined ? { origin } : {}), basis }
  }

  /** #902 review (#910 B1): the cast modes the plugin declares; an older plugin declares none, so only insert. */
  private castModes(): readonly string[] {
    try { return this.d.castCapabilities?.()?.modes ?? ['insert'] } catch { return ['insert'] }
  }

  /** The label a cast of this team carries in the plugin's queue and intervention log; undefined when the plugin keeps none. */
  private castOrigin(observer: string, mode: string, release?: string): string | undefined {
    let keeps = false
    try { keeps = this.d.castCapabilities?.()?.origin === true } catch { /* none */ }
    if (!keeps) return undefined
    return `${this.castTeamPrefix()}observer:${observer}|mode:${mode}${release !== undefined ? `|release:${release}` : ''}`
  }

  /**
   * #911 review: withdraw this team's waiting casts and armed releases for the given sessions (the owner turned casting
   * off for them). Rows of other teams and rows from before origins are left alone; the owner withdraws those by hand.
   */
  private withdrawCastsFor(sessions: readonly string[]): { withdrawn: number; notWithdrawn: string[]; releasesWithdrawn: number; releasesSaved: boolean } {
    // #913 review: each withdrawal's answer is kept. A card already handed to a step (sent, not yet confirmed) or one the
    // plugin refuses is reported as not withdrawn: it is not claimed back here, and no new card goes to the member.
    const out = { withdrawn: 0, notWithdrawn: [] as string[], releasesWithdrawn: 0, releasesSaved: true }
    const svc = this.d.castQueue?.()
    for (const session of sessions) {
      let listed: { ok: boolean; items?: unknown[] } | undefined
      try { listed = svc?.list({ sessionId: session, state: 'waiting', limit: 500 }) } catch { listed = undefined }
      if (svc !== undefined && listed?.ok !== true) { out.notWithdrawn.push(`${session}:list-failed`); continue }
      for (const row of (Array.isArray(listed?.items) ? listed!.items : []) as Array<{ id?: unknown; origin?: unknown }>) {
        if (typeof row.origin !== 'string' || !row.origin.startsWith(this.castTeamPrefix())) continue
        let answer: { ok: boolean; withdrawn?: boolean } | undefined
        try { answer = svc!.withdraw({ sessionId: session, id: String(row.id), origin: row.origin }) } catch { answer = undefined }
        if (answer?.ok === true && answer.withdrawn === true) out.withdrawn += 1
        else out.notWithdrawn.push(String(row.id))
      }
    }
    const releases = this.releases()
    for (const r of releases) if (r.state === 'armed' && sessions.includes(r.session_id)) { r.state = 'withdrawn'; r.endedAt = this.now(); r.result = 'member-off'; out.releasesWithdrawn += 1 }
    if (out.releasesWithdrawn > 0) out.releasesSaved = this.saveReleases(releases)
    if (out.notWithdrawn.length > 0 || !out.releasesSaved) this.d.logger.warn('superagent: casting off %s left %d cast(s) not withdrawn; releases saved: %s', sessions.join(','), out.notWithdrawn.length, String(out.releasesSaved))
    return out
  }

  /** The prefix of every origin this team writes: the plugin, the team (its canvas), then the fields. */
  private castTeamPrefix(): string { return `a2a|team:${this.settingsValue.canvas ?? 'primary'}|` }

  /**
   * #902 S4: the team page's 待投卡 group: the switches, the members the owner turned casting off for, the casts still
   * waiting and the armed releases (no card text). Never throws: a fault reads as unavailable.
   */
  private castsView(): Record<string, unknown> {
    const s = this.settingsValue
    const base = { on: s.observerCast === true, draft: s.observerCardDraft === true, triggerRouter: s.observerTriggerRouter === true, off: [...(s.castOff ?? [])] }
    try {
      const out = this.ownerCastQueue({ state: 'waiting' })
      if (out.ok !== true || out.available === false) return { ...base, available: false }
      return { ...base, available: true, waiting: out.items, releases: (out.releases as CardRelease[]).filter(r => r.state === 'armed' || r.state === 'releasing') }
    } catch { return { ...base, available: false } }
  }

  /** Who may cast what into whom (shared by casting now and arming a release). */
  private castCheck(observer: string, input: { session_id?: unknown; template_id?: unknown; reason?: unknown; basis?: unknown }): { refusal: Record<string, unknown> } | { target: string; templateId: string; reason: string; basis: string; draft: ObserverCard | undefined } {
    const no = (code: string, error: string) => ({ refusal: { ok: false, code, error } })
    if (!this.isObserver(observer)) return no('not-observer', 'a2a_card_cast serves only the team\'s observer')
    if (this.settingsValue.observerCast !== true) return no('off', 'casting cards is off for this team (the owner turns on observerCast)')
    const target = String(input.session_id ?? '').trim()
    const team = new Set([this.settings.router, ...this.settings.members].filter((id): id is string => typeof id === 'string'))
    if (target === '' || !team.has(target) || target === observer) return no('not-in-team', 'cast only into another session of this team')
    // #902 S4: the owner turned casting off for this member.
    if (this.settingsValue.castOff?.includes(target) === true) return no('member-off', 'the owner turned casting off for that member')
    const templateId = String(input.template_id ?? '').trim()
    const reason = String(input.reason ?? '')
    if (templateId === '') return no('template', 'name the card (template_id from a2a_ticket_read kind library or templates)')
    // #902 S1: every cast names what it rests on — a ticket of this team, an event, or none with a sentence.
    const basis = this.castBasis(input.basis)
    if (typeof basis !== 'string') return { refusal: basis }
    // #902 S2: the observer's own card goes only to the members it was written for.
    const draft = this.observerCards()[templateId]
    // #908 review: an observer's own card is cast by the observer that wrote it (after a handover the new one writes its own).
    if (draft !== undefined && draft.author !== undefined && draft.author !== observer) return no('not-yours', 'that card was written by another observer session; write your own with a2a_card_draft')
    if (draft?.pending === true) return no('pending', 'an edit of that card did not finish; save it again with a2a_card_draft before casting it')
    if (draft !== undefined && draft.for !== 'team' && !draft.for.includes(target)) return no('not-for', 'that card of yours is written for other members; edit its for list with a2a_card_draft')
    return { target, templateId, reason, basis, draft }
  }

  /**
   * #902 S3: arm a release — the cast waits here (not in the plugin) until its condition holds, then goes in the `then`
   * way through castCard, with every check and limit of a cast made at that moment. Conditions: `ticket:<id> <stage>`
   * (the ticket reaches person, person:<action>, working, idle or ended), `idle:<minutes>` (the target stays idle that
   * long, 10..1440), `at:<ISO time>` (5 minutes to 7 days ahead). It expires after expires_hours (default 24, at most 168).
   */
  private armRelease(observer: string, cast: { target: string; templateId: string; reason: string; basis: string }, input: { when?: unknown; then?: unknown; expires_hours?: unknown }): Record<string, unknown> {
    const no = (code: string, error: string): Record<string, unknown> => ({ ok: false, code, error })
    const now = Date.parse(this.now())
    const then = input.then === undefined || input.then === null || input.then === '' ? 'insert' : String(input.then)
    if (then !== 'insert' && then !== 'queue' && then !== 'trigger') return no('then', 'then is insert, queue or trigger: how the card goes in once released')
    if (then === 'trigger' && cast.target === this.settingsValue.router && this.settingsValue.observerTriggerRouter !== true) return no('trigger-router', 'trigger does not wake the router unless the owner allows it')
    const hours = input.expires_hours === undefined || input.expires_hours === null || input.expires_hours === '' ? RELEASE_HOURS : Number(input.expires_hours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > RELEASE_HOURS_MAX) return no('expires', `expires_hours is 1..${String(RELEASE_HOURS_MAX)} (default ${String(RELEASE_HOURS)})`)
    const expiresAt = now + hours * 3_600_000
    const when = this.releaseWhen(input.when, now, expiresAt)
    if (typeof when !== 'string') return when
    if (then === 'trigger' && when.startsWith('idle:') === false && this.d.sessionBusy === undefined) return no('then', 'this host cannot tell whether a session is idle, so it does not trigger')
    const releases = this.releases()
    if (releases.filter(r => (r.state === 'armed' || r.state === 'releasing') && r.session_id === cast.target).length >= RELEASES_MAX) return no('full', `at most ${String(RELEASES_MAX)} armed releases per session: withdraw one with a2a_card_queue`)
    const release: CardRelease = { id: `r-${randomUUID().replace(/-/g, '').slice(0, 12)}`, observer, session_id: cast.target, template_id: cast.templateId, reason: cast.reason, basis: cast.basis, when, then: then as CardRelease['then'], armedAt: new Date(now).toISOString(), expiresAt: new Date(expiresAt).toISOString(), state: 'armed' }
    releases.push(release)
    // #910 review B2: armed only once it is on disk; otherwise nothing is armed and the caller hears so.
    if (!this.saveReleases(releases)) return no('not-saved', 'the release could not be written to disk, so nothing was armed')
    return { ok: true, mode: 'release', release: release.id, when, then, expiresAt: release.expiresAt, basis: cast.basis }
  }

  /** #902 S3: a release condition, normalized; or the refusal. */
  private releaseWhen(raw: unknown, now: number, expiresAt: number): string | Record<string, unknown> {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
    const no = (error: string): Record<string, unknown> => ({ ok: false, code: 'when', error })
    if (/^event[:\s]/.test(text)) return no('event conditions are not available yet (#902 S3 defers them): use ticket:, idle: or at:')
    const help = 'when is ticket:<id> <person|person:<action>|working|idle|ended>, idle:<minutes 10..1440>, or at:<ISO time 5 minutes..7 days ahead>'
    let m = /^ticket:(\S+) (person(?::(?:delivery|answer|review|blocked|failed))?|working|idle|ended)$/.exec(text)
    if (m !== null) {
      const key = m[1]!
      const hits = key.length >= 8 ? this.store.tickets.list().filter(t => t.id === key || t.id.startsWith(key)) : []
      if (hits.length !== 1) return no('ticket: must name one ticket of this team (its id, or a prefix of at least 8 characters)')
      return `ticket:${hits[0]!.id} ${m[2]!}`
    }
    m = /^idle:(\d+)$/.exec(text)
    if (m !== null) {
      const minutes = Number(m[1])
      if (minutes < 10 || minutes > 1440) return no('idle: is 10..1440 minutes')
      return `idle:${String(minutes)}`
    }
    m = /^at:(.+)$/.exec(text)
    if (m !== null) {
      const at = Date.parse(m[1]!)
      if (!Number.isFinite(at) || at - now < AT_MIN_MS || at - now > AT_MAX_MS) return no('at: is an ISO time 5 minutes to 7 days ahead')
      if (at >= expiresAt) return no('at: falls after the release expires: raise expires_hours')
      return `at:${new Date(at).toISOString()}`
    }
    return no(help)
  }

  /**
   * #902 S3: the release look, once a minute. An armed release whose condition holds goes in once, through castCard (so
   * the switch, the team, the card and the limits are checked again now); one past its time expires. A release whose
   * cast is refused ends failed, with the refusal kept, and is not tried again.
   */
  releaseTick(): void {
    const releases = this.releases()
    if (!releases.some(r => r.state === 'armed' || r.state === 'releasing')) return
    const now = Date.parse(this.now())
    const at = new Date(now).toISOString()
    let changed = false
    // #910 review B2: a release left `releasing` (the host stopped between writing it and hearing the plugin) is settled
    // from the plugin's queue: its row there (origin names the release) means it went; none means it did not, and it is
    // looked at again. A plugin that keeps no origin cannot tell, so it ends failed as uncertain rather than cast twice.
    for (const r of releases) {
      if (r.state !== 'releasing') continue
      const found = this.releaseRow(r)
      if (found === 'unknown') { r.state = 'failed'; r.endedAt = at; r.result = 'uncertain: the host stopped while releasing and the plugin keeps no origin to check'; changed = true }
      else if (found !== undefined) { r.state = 'released'; r.endedAt = at; r.result = `reconciled ${found}`; changed = true }
      else { r.state = 'armed'; delete r.attemptAt; changed = true }
    }
    for (const r of releases) {
      if (r.state !== 'armed') continue
      if (now >= Date.parse(r.expiresAt)) { r.state = 'expired'; r.endedAt = at; changed = true; continue }
      let ready = false
      if (r.when.startsWith('at:')) ready = now >= Date.parse(r.when.slice(3))
      else if (r.when.startsWith('idle:')) {
        const busy = this.d.sessionBusy?.(r.session_id)
        if (busy !== false) { if (r.quietSince !== undefined) { delete r.quietSince; changed = true } }
        else if (r.quietSince === undefined) { r.quietSince = at; changed = true }
        else ready = now - Date.parse(r.quietSince) >= Number(r.when.slice(5)) * 60_000
      } else {
        const [ticketPart, want] = r.when.split(' ')
        const ticket = this.store.tickets.get(ticketPart!.slice(7))
        if (ticket !== undefined) {
          const s = ticket.ended ? { stage: 'ended' as const } : ticketStage(ticket)
          ready = want === s.stage || want === `${s.stage}:${'action' in s ? String(s.action) : ''}`
        }
      }
      if (!ready) continue
      // Written as releasing first: if that cannot be saved, nothing is cast this time.
      r.state = 'releasing'; r.attemptAt = at
      if (!this.saveReleases(releases)) { r.state = 'armed'; delete r.attemptAt; continue }
      // A trigger released by an idle condition finds the session idle; one released otherwise may find it busy, and then
      // the card is queued for its next turn instead of being refused.
      // A plugin that throws here leaves the release `releasing` (already on disk): the next look settles it by its origin,
      // and the other releases of this look go on (#913 review 2).
      let out: Record<string, unknown>
      try {
        out = this.castCard(r.observer, { session_id: r.session_id, template_id: r.template_id, reason: r.reason, basis: r.basis, mode: r.then }, r.id)
        if (r.then === 'trigger' && out.ok === false && (out.code === 'busy' || out.code === 'trigger-limited')) out = this.castCard(r.observer, { session_id: r.session_id, template_id: r.template_id, reason: r.reason, basis: r.basis, mode: 'queue' }, r.id)
      } catch (error) { this.d.logger.warn('superagent: release %s left releasing, settled at the next look: %s', r.id, String(error)); continue }
      r.state = out.ok === true && out.available !== false ? 'released' : 'failed'
      r.endedAt = at
      r.result = out.ok === true ? (out.available === false ? String(out.reason ?? 'unavailable') : `${String(out.mode)}${typeof out.id === 'string' ? ` ${out.id}` : ''}`) : `${String(out.code)}: ${String(out.error ?? '')}`.slice(0, 300)
      changed = true
    }
    if (changed) this.saveReleases(releases)
  }

  /** The plugin queue row a release produced (its id), none (undefined), or 'unknown' when the plugin keeps no origin. */
  private releaseRow(r: CardRelease): string | undefined | 'unknown' {
    let keeps = false
    try { keeps = this.d.castCapabilities?.()?.origin === true } catch { /* none */ }
    // #913 review 2: a plugin that throws (its service or its database) is unknown too, and the other releases go on.
    let svc: ReturnType<NonNullable<SuperagentHostDeps['castQueue']>> | undefined
    try { svc = this.d.castQueue?.() } catch { return 'unknown' }
    if (!keeps || svc === undefined) return 'unknown'
    try { return this.releaseRowExact(r, svc) } catch { return 'unknown' }
  }

  private releaseRowExact(r: CardRelease, svc: NonNullable<ReturnType<NonNullable<SuperagentHostDeps['castQueue']>>>): string | undefined | 'unknown' {
    // #913 review: ask for the exact origins this release could have cast with (its then mode, or queue when a trigger
    // found the target busy), so "none" is proven by the plugin's own filter, not by a window of recent rows.
    for (const mode of [...new Set([r.then, 'queue'])]) {
      const out = svc.list({ sessionId: r.session_id, origin: this.castOrigin(r.observer, mode, r.id), limit: 500 })
      if (out.ok !== true || !Array.isArray(out.items)) return 'unknown'
      const row = (out.items as Array<{ id?: unknown }>)[0]
      if (row !== undefined) return String(row.id)
    }
    return undefined
  }

  /** #902 S3: the team's releases (armed and the latest ended), in observer-releases.json. */
  private releasesPath(): string { return join(this.stateDir, 'observer-releases.json') }
  private releases(): CardRelease[] {
    try { const v = JSON.parse(readFileSync(this.releasesPath(), 'utf8')) as { releases?: CardRelease[] }; return Array.isArray(v.releases) ? v.releases : [] } catch { return [] }
  }
  /** @returns whether the releases reached the disk. */
  private saveReleases(releases: CardRelease[]): boolean {
    // Armed and releasing ones are all kept; of the ended, the newest 50.
    const open = (r: CardRelease): boolean => r.state === 'armed' || r.state === 'releasing'
    const ended = releases.filter(r => !open(r)).slice(-50)
    const kept = releases.filter(r => open(r) || ended.includes(r))
    try {
      const path = this.releasesPath(), temporary = `${path}.tmp-${String(process.pid)}`
      mkdirSync(this.stateDir, { recursive: true }); writeFileSync(temporary, `${JSON.stringify({ releases: kept }, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, path)
      return true
    } catch (error) { this.d.logger.warn('superagent: releases not saved: %s', String(error)); return false }
  }

  /**
   * #902 S1: a cast's basis — `ticket:<id>` (a ticket of this team, named by its id or an unambiguous prefix of at least 8
   * characters), `event:<id>`, or `none: <one sentence>`; one line, at most 200 characters. Returns the normalized basis,
   * or the refusal.
   */
  private castBasis(raw: unknown): string | Record<string, unknown> {
    const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim()
    const refuse = (error: string): Record<string, unknown> => ({ ok: false, code: 'basis', error })
    if (text === '' || text.length > 200) return refuse('give a basis: ticket:<id> of this team, event:<id>, or none: <why>; one line, at most 200 characters')
    const m = /^(ticket|event|none):\s*(.+)$/.exec(text)
    if (m === null) return refuse('basis must start with ticket:, event: or none:')
    if (m[1] === 'none') return `none: ${m[2]!.trim()}`
    // #907 review B1: an event basis names an event this team recorded (a trigger in its own store: a request, an
    // A2A or GitHub message it took in). Anything else has no record here to check, so it is refused and the observer
    // says what it saw with none: <sentence> instead.
    if (m[1] === 'event') {
      const id = m[2]!.trim()
      if (this.store.triggers.get(id) === undefined) return refuse('event: must name an event this team recorded (a trigger id from its state); for anything else write none: <what you saw>')
      return `event:${id}`
    }
    const key = m[2]!.trim()
    const hits = key.length >= 8 ? this.store.tickets.list().filter(t => t.id === key || t.id.startsWith(key)) : []
    if (hits.length !== 1) return refuse('ticket: must name one ticket of this team (its id, or a prefix of at least 8 characters)')
    return `ticket:${hits[0]!.id}`
  }

  /** #902 S2: the observer's own cards of this team, by template id: who each is for, its scene and what it came from. */
  private observerCardsPath(): string { return join(this.stateDir, 'observer-cards.json') }
  private observerCards(): Record<string, ObserverCard> {
    try { const v = JSON.parse(readFileSync(this.observerCardsPath(), 'utf8')) as { cards?: Record<string, ObserverCard> }; return v.cards ?? {} } catch { return {} }
  }
  /** @returns whether the cards reached the disk (#908 review: a failed write is reported, never taken as saved). */
  private saveObserverCards(cards: Record<string, ObserverCard>): boolean {
    try {
      const path = this.observerCardsPath(), temporary = `${path}.tmp-${String(process.pid)}`
      mkdirSync(this.stateDir, { recursive: true }); writeFileSync(temporary, `${JSON.stringify({ cards }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, path)
      return true
    } catch (error) { this.d.logger.warn('superagent: observer cards not saved: %s', String(error)); return false }
  }

  /**
   * #902 S2: the observer writes its own cards — ordinary session templates of its own session, through the same host's
   * prompt-template plugin (#87+) — each for named members of this team (or the whole team), with a one-line scene and,
   * optionally, the library card it came from. Off unless the owner turns on observerCardDraft; at most
   * OBSERVER_CARDS_MAX per team. Actions: list (default), create, update (id), delete (id).
   */
  cardDraft(observer: string, input: { action?: unknown; id?: unknown; name?: unknown; content?: unknown; for?: unknown; scene?: unknown; from?: unknown }): Record<string, unknown> {
    if (!this.isObserver(observer)) return { ok: false, code: 'not-observer', error: 'a2a_card_draft serves only the team\'s observer' }
    const cards = this.observerCards()
    const action = String(input.action ?? 'list')
    if (action === 'list') return { ok: true, on: this.settingsValue.observerCardDraft === true, cards: Object.entries(cards).map(([id, { author, ...c }]) => ({ id, ...c, mine: author === undefined || author === observer })) }
    if (this.settingsValue.observerCardDraft !== true) return { ok: false, code: 'off', error: 'writing your own cards is off for this team (the owner turns on observerCardDraft)' }
    const svc = this.d.cardDrafts?.()
    if (svc === undefined) return { ok: true, available: false, reason: 'dsh-prompt-templates with author-session cards (#87) is not on this host' }
    const id = String(input.id ?? '').trim()
    // #908 review B1: a card is changed only by the observer that wrote it (a card from before authors were kept counts as
    // the current observer's, and the plugin still checks the template belongs to the calling session).
    if ((action === 'delete' || action === 'update') && cards[id] !== undefined && cards[id]!.author !== undefined && cards[id]!.author !== observer) return { ok: false, code: 'not-yours', error: 'that card was written by another observer session' }
    if (action === 'delete') {
      if (cards[id] === undefined) return { ok: false, code: 'card', error: 'no card of yours with that id' }
      const out = svc.remove({ authorSession: observer, id })
      if (!out.ok) return out as Record<string, unknown>
      // The host's record goes only when the template is gone: deleted now, or already gone from the session.
      if (out.deleted !== true && svc.has(observer, id)) return { ok: false, code: 'not-deleted', error: 'the plugin kept that card (it is not your session\'s template); nothing was removed' }
      const before = cards[id]!
      delete cards[id]
      if (!this.saveObserverCards(cards)) { cards[id] = before; return { ok: false, code: 'not-saved', error: 'the card was deleted but the team record could not be written; it will show until the next save' } }
      return { ok: true, deleted: out.deleted === true, ...(out.deleted !== true ? { reconciled: true } : {}) }
    }
    if (action !== 'create' && action !== 'update') return { ok: false, code: 'input', error: 'action is list, create, update or delete' }
    if (action === 'update' && cards[id] === undefined) return { ok: false, code: 'card', error: 'no card of yours with that id' }
    if (action === 'create' && Object.keys(cards).length >= OBSERVER_CARDS_MAX) return { ok: false, code: 'full', error: `at most ${String(OBSERVER_CARDS_MAX)} cards of your own per team: delete one first` }
    const team = new Set([this.settings.router, ...this.settings.members].filter((s): s is string => typeof s === 'string' && s !== observer))
    const forRaw = input.for
    const named = Array.isArray(forRaw) ? [...new Set(forRaw.map(v => String(v).trim()))] : forRaw === 'team' ? ['team'] : []
    const forList = named.length === 1 && named[0] === 'team' ? 'team' as const : named
    if (forList !== 'team' && (forList.length === 0 || forList.some(s => !team.has(s)))) return { ok: false, code: 'for', error: 'for is ["team"] or a list of this team\'s sessions (not you)' }
    const scene = String(input.scene ?? '').replace(/\s+/g, ' ').trim()
    if (scene === '' || scene.length > 200) return { ok: false, code: 'scene', error: 'scene is one line of 1..200 characters: the business situation this card is for' }
    const from = input.from === undefined || input.from === null || String(input.from).trim() === '' ? undefined : String(input.from).trim().slice(0, 100)
    const description = `for: ${forList === 'team' ? 'team' : forList.join(', ')} · scene: ${scene}${from !== undefined ? ` · from: ${from}` : ''}`.slice(0, 512)
    // #913 review: an edit is marked pending on disk before the plugin's text changes, so a stop or a failed write between
    // the two never leaves new text under the old audience: a pending card is not cast until a save completes it.
    const before = action === 'update' ? cards[id] : undefined
    if (before !== undefined) {
      cards[id] = { ...before, pending: true }
      if (!this.saveObserverCards(cards)) return { ok: false, code: 'not-saved', error: 'the team record could not be written, so nothing was changed' }
    }
    const out = svc.draft({ authorSession: observer, ...(action === 'update' ? { id } : {}), name: String(input.name ?? ''), content: String(input.content ?? ''), description })
    if (!out.ok || typeof out.id !== 'string') {
      if (before !== undefined) { cards[id] = before; if (!this.saveObserverCards(cards)) return { ...(out as Record<string, unknown>), pending: true } }
      return out as Record<string, unknown>
    }
    cards[out.id] = { name: String(out.name ?? input.name ?? ''), for: forList, scene, ...(from !== undefined ? { from } : {}), at: this.now(), sha256: String(out.content_sha256 ?? ''), author: observer }
    if (!this.saveObserverCards(cards)) {
      if (out.created !== true) return { ok: false, code: 'not-saved', pending: true, error: 'the card text changed but the team record could not be finished; the card stays pending (not cast) until you save it again' }
      // A new card the team record cannot hold is taken back, and whether that worked is said.
      let removed: { ok: boolean; deleted?: boolean } | undefined
      try { removed = svc.remove({ authorSession: observer, id: out.id }) } catch { removed = undefined }
      if (removed?.ok === true && removed.deleted === true) return { ok: false, code: 'not-saved', error: 'the team record could not be written, so the new card was taken back' }
      return { ok: false, code: 'not-saved', orphan: out.id, error: `the team record could not be written and the new card ${out.id} could not be taken back: delete it from your session's templates` }
    }
    return { ok: true, id: out.id, created: out.created === true, for: forList, scene, sha256: String(out.content_sha256 ?? '') }
  }

  /**
   * #902 S1: the observer reads or withdraws cards queued for its own team's sessions, through the same host's
   * prompt-template plugin (0.23.1+). Another team's or session's rows are never shown or touched.
   */
  cardQueue(observer: string, input: { action?: unknown; session_id?: unknown; id?: unknown; state?: unknown }): Record<string, unknown> {
    if (!this.isObserver(observer)) return { ok: false, code: 'not-observer', error: 'a2a_card_queue serves only the team\'s observer' }
    try { return this.castQueueView(input, observer) } catch (error) { return { ok: false, code: 'plugin', error: `the prompt-template plugin failed: ${String((error as Error)?.message ?? error)}` } }
  }

  /**
   * #902 S4: the same list and withdraw for the owner's team page (the face checks the owner's browser proof): what waits
   * in the plugin's queue for this team's sessions, and this team's releases.
   */
  ownerCastQueue(input: { action?: unknown; session_id?: unknown; id?: unknown; state?: unknown }): Record<string, unknown> {
    try { return this.castQueueView(input, undefined) } catch (error) { return { ok: false, code: 'plugin', error: `the prompt-template plugin failed: ${String((error as Error)?.message ?? error)}` } }
  }

  /**
   * #907 review B2: rows are attributed by the origin each cast carried (this team's prefix, the observer, the requested
   * mode, the release), not by who the target is now. A row of another team is never shown or touched, even for a
   * session both teams share. A row cast before origins (`legacy: true`) is shown for this team's sessions, and only the
   * owner withdraws it. The observer withdraws only what it cast itself; the owner, anything of this team. No row shows
   * the observer's session id: the observer sees `mine`.
   */
  private castQueueView(input: { action?: unknown; session_id?: unknown; id?: unknown; state?: unknown }, observer: string | undefined): Record<string, unknown> {
    const team = new Set([this.settings.router, ...this.settings.members].filter((id): id is string => typeof id === 'string'))
    const session = String(input.session_id ?? '').trim()
    // #911 review B2: a row is this team's by its origin, so a cast for a member that has since moved to another team is
    // still listed and withdrawn here; only a list or withdraw for a session never on this team, with no row of ours, is refused.
    if (session !== '' && !team.has(session) && input.action !== 'withdraw') return { ok: false, code: 'not-in-team', error: 'that session is not on this team' }
    const svc = this.d.castQueue?.()
    if (svc === undefined) return { ok: true, available: false, reason: 'dsh-prompt-templates with the durable cast queue (#902 S1) is not on this host' }
    const prefix = this.castTeamPrefix()
    const field = (origin: string, name: string): string | undefined => origin.split('|').find(part => part.startsWith(`${name}:`))?.slice(name.length + 1)
    type Row = { id?: unknown; session_id?: unknown; origin?: unknown; [k: string]: unknown }
    // #913 review: a row without an origin has no evidence of which team cast it, so no team view lists or withdraws it.
    // Such rows were cast before origins and end within the plugin's wait limit (an hour) on their own.
    const ours = (row: Row): 'team' | 'legacy' | undefined => typeof row.origin === 'string' && row.origin.startsWith(prefix) ? 'team' : undefined
    // #911 review: only these fields of a plugin row leave this host's state and tools, whatever the plugin adds later.
    const FIELDS = ['id', 'session_id', 'template_id', 'name', 'version', 'caller', 'reason', 'basis', 'at', 'state', 'ended_at', 'mode', 'sent_at'] as const
    const view = (row: Row): Record<string, unknown> => {
      const origin = row.origin
      const rest: Record<string, unknown> = {}
      for (const key of FIELDS) if (key in row) rest[key] = row[key]
      if (typeof origin !== 'string') return { ...rest, legacy: true }
      const release = field(origin, 'release')
      return { ...rest, requested: field(origin, 'mode') ?? null, ...(release !== undefined ? { release } : {}), ...(observer !== undefined ? { mine: field(origin, 'observer') === observer } : {}) }
    }
    if (input.action === 'withdraw') {
      const id = String(input.id ?? '').trim()
      // #902 S3: an armed release is withdrawn here, before it ever reaches the plugin.
      if (id.startsWith('r-')) {
        const releases = this.releases()
        // Releases live in this team's own state directory: each is this team's, wherever its target sits now.
        const r = releases.find(x => x.id === id)
        if (r === undefined) return { ok: false, code: 'release', error: 'no release of this team with that id' }
        if (observer !== undefined && r.observer !== observer) return { ok: false, code: 'not-yours', error: 'that release was armed by another observer session; the owner can withdraw it' }
        if (r.state !== 'armed') return { ok: true, withdrawn: false, state: r.state }
        r.state = 'withdrawn'; r.endedAt = this.now()
        if (!this.saveReleases(releases)) return { ok: false, code: 'not-saved', error: 'the withdrawal could not be written to disk; the release stays armed' }
        return { ok: true, withdrawn: true }
      }
      if (session === '' || id === '') return { ok: false, code: 'input', error: 'withdraw takes session_id and id' }
      if (!team.has(session) && observer !== undefined) return { ok: false, code: 'not-in-team', error: 'that session is not on this team; the owner can withdraw a card cast before it moved' }
      const listed = svc.list({ sessionId: session, limit: 500 })
      const row = listed.ok === true && Array.isArray(listed.items) ? (listed.items as Row[]).find(item => item.id === id) : undefined
      const kind = row === undefined ? undefined : ours(row)
      if (row === undefined || kind === undefined) return { ok: false, code: 'cast', error: 'no cast of this team with that id for that session' }
      if (observer !== undefined && field(String(row.origin), 'observer') !== observer) return { ok: false, code: 'not-yours', error: 'that card was cast by another observer session; the owner can withdraw it' }
      return svc.withdraw({ sessionId: session, id, ...(typeof row.origin === 'string' ? { origin: row.origin } : {}) }) as Record<string, unknown>
    }
    const state = input.state === undefined ? undefined : String(input.state)
    const out = svc.list({ ...(session !== '' ? { sessionId: session } : {}), ...(state !== undefined ? { state } : {}), limit: 100 })
    if (out.ok !== true || !Array.isArray(out.items)) return out as Record<string, unknown>
    const releases = this.releases().filter(r => session === '' || r.session_id === session).reverse().map(({ observer: by, ...r }) => ({ ...r, ...(observer !== undefined ? { mine: by === observer } : {}) }))
    return { ok: true, items: (out.items as Row[]).filter(row => ours(row) !== undefined).map(view), releases }
  }

  /** #764 review: the per-target cast limits, kept in the team's observer-casts.json. */
  private castLimitsPath(): string { return join(this.stateDir, 'observer-casts.json') }
  private castLimits(): Record<string, { casts: number[]; wakeAt: number; triggerAt?: number }> {
    try {
      const path = this.castLimitsPath()
      if (!existsSync(path)) return {}
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { casts?: unknown; wakeAt?: unknown }>
      const out: Record<string, { casts: number[]; wakeAt: number; triggerAt?: number }> = {}
      for (const [k, v] of Object.entries(raw ?? {})) out[k] = { casts: Array.isArray(v?.casts) ? v.casts.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [], wakeAt: typeof v?.wakeAt === 'number' ? v.wakeAt : 0, ...(typeof (v as { triggerAt?: unknown })?.triggerAt === 'number' ? { triggerAt: (v as { triggerAt: number }).triggerAt } : {}) }
      return out
    } catch { return {} }
  }
  /** @returns whether the limits reached the disk. */
  private saveCastLimits(limits: Record<string, { casts: number[]; wakeAt: number; triggerAt?: number }>): boolean {
    try {
      const path = this.castLimitsPath(), temporary = `${path}.tmp-${String(process.pid)}`
      mkdirSync(this.stateDir, { recursive: true }); writeFileSync(temporary, JSON.stringify(limits), { mode: 0o600 }); renameSync(temporary, path)
      return true
    } catch (error) { this.d.logger.warn('superagent: cast limits not saved: %s', String(error)); return false }
  }

  /** R7b: what the observer holds now (for the team state). */
  observerQuestions(): { pending: string[]; handled: string[] } { return this.questionGate.holds() }

  /**
   * A ready report from a member that has ygl-trees but names nothing it wrote there is sent back once (design Y2): the
   * second ready goes through, so a ticket with nothing worth keeping is never held.
   * @returns the refusal, or undefined to take the report.
   */
  yglReadyRefusal(member: string, ticketId: string, state: string, ids: readonly string[]): { ok: false; code: string; error: string } | undefined {
    if (state !== 'ready' || ids.length > 0 || (this.d.hasTool?.(member, YGL_WRITE) !== true && this.d.hasTool?.(member, YGL_TREES) !== true) || this.yglReminded.has(ticketId)) return undefined
    this.yglReminded.add(ticketId)
    return { ok: false, code: 'ygl-record', error: 'Before ready, record what this ticket found in ygl-trees: evidence and claims with mcp__ygl__write (or mcp__ygl__trees), and kb add what the next session should reuse. Then report ready again with the ids in ygl. If nothing here is worth keeping, report ready again and say why in summary; this reminder comes only once.' }
  }

  /** The team page's 搜索 (host/search.ts): this team's records only. */
  search(query: string): Record<string, unknown> { return searchTeam(this.store, query) }

  /**
   * The logins with push access to the team's GitHub repositories, for the owner to add to allowed.github (design
   * github-issues G6). The caller saves them, so the write goes through settings like any other.
   * @returns the logins to add, or why not.
   */
  async githubCollaborators(): Promise<{ ok: true; logins: string[] } | { ok: false; code: string; error: string }> {
    const repos = this.settingsValue.github?.repos ?? []
    if (repos.length === 0) return { ok: false, code: 'no-repos', error: 'list the team\'s GitHub repositories first' }
    try { return { ok: true, logins: await this.issues.collaborators(repos) } } catch (error) { return { ok: false, code: 'github', error: String(error).slice(0, 300) } }
  }

  /** Tools the owner granted the team for this session's role (design tool-requests T1). */
  grantedTools(session: string): readonly string[] {
    const role = this.toolRoleOf(session)
    return role === undefined ? [] : this.settingsValue.extraTools?.[grantClass(role)] ?? []
  }

  /**
   * A grantable tool was refused to a team session: ask the owner with a P0 card, once per role and tool (T3). A tool the
   * owner declined is not asked about again within a day.
   * @returns what the refusal should add, for the session to read.
   */
  /** Design outbound-requests O1, O2: a team session asks for a message to another team on a ticket; a P0 card decides it. */
  requestOutbound(session: string, ask: OutboundAsk): Record<string, unknown> {
    const ticket = typeof ask.ticket_id === 'string' ? this.store.tickets.get(ask.ticket_id.trim()) : undefined
    const checked = this.outbound.check(session, ask, { role: this.toolRoleOf(session), a2aOn: this.settingsValue.sources.a2a, own: ownAddresses(this.d.handleOf, this.settingsValue.canvas, [this.settingsValue.router, ...this.pool(), ...this.settings.observers]),
      ticket: ticket === undefined ? undefined : { open: !ticket.ended, title: ticket.title, holder: this.executor.list().find(b => b.ticketId === ticket.id)?.member } })
    if (!checked.ok) return checked
    const out = this.decisions.propose({ source: 'outbound', by: session, at: this.now(), question: `${this.displayName(session)} ${checked.question}`, ...(checked.reason !== undefined ? { reason: checked.reason } : {}), spec: { level: 'P0', options: [OUTBOUND_APPROVE, OUTBOUND_DECLINE], recommended: OUTBOUND_APPROVE }, outbound: { ticketId: checked.ticketId, address: checked.address, text: checked.text, team: this.settingsValue.canvas ?? '', title: ticket!.title } })
    if (out.ok && out.reused !== true) this.outbound.waiting(out.id, checked.ticketId, checked.address, checked.text, session)
    return out.ok ? { ok: true, card_id: out.id } : out
  }

  /** Validate retained server-owned approval, not recovery-call text or a member's assertion. */
  private outboundApproval(record: Readonly<OutboundRecord>): OutboundApproval {
    const deny = (code: string, error: string): OutboundApproval => ({ ok: false, code, error })
    if (!this.settingsValue.sources.a2a || this.settingsValue.paused) return deny('a2a-off', '团队来源已停用或暂停，未恢复发送。')
    const ticket = this.store.tickets.get(record.ticketId)
    if (ticket === undefined || ticket.ended !== undefined) return deny('ticket', '原工单不存在或已结束，未恢复发送。')
    const card = this.decisions.get(record.card), payload = card?.outbound
    if (card?.source !== 'outbound' || card.decided === undefined || card.by !== record.by || payload === undefined
      || card.decided.text.split('\n')[0] !== '决定：' + OUTBOUND_APPROVE
      || !Number.isFinite(Date.parse(card.decided.at)) || Date.parse(this.now()) < Date.parse(card.decided.at)
      || Date.parse(this.now()) - Date.parse(card.decided.at) > 30 * 86_400_000
      || payload.ticketId !== record.ticketId || payload.address !== record.address || payload.text !== record.text
      || payload.team === '' || payload.team !== this.settingsValue.canvas) return deny('outbound-approval', '缺少相符且有效的原批准载荷，未恢复发送；旧记录需维护核账。')
    const title = payload.title.length > 80 ? payload.title.slice(0, 80) + '…' : payload.title
    return { ok: true, at: card.decided.at, team: payload.team,
      message: '[来自 superagent 团队 ' + payload.team + ' 的请求 · 工单「' + title + '」]\n' + payload.text }
  }

  async prepareNarrowOutbound(card:string,task:string,receiver:{home:string;key:string;session:string},reconciliation:string):Promise<Record<string,unknown>> {try{return {ok:true,proposal:await this.narrowOutbound.prepare(card,task,receiver,reconciliation)}}catch{return {ok:false,code:'narrow-recovery-refused',error:'原批准、尝试链或精确接收身份无法可靠核验，未发送。'}}}
  async runNarrowOutbound(card:string,task:string,permit:unknown,send:boolean):Promise<Record<string,unknown>> {try{return {...await this.narrowOutbound.run(card,task,permit,send)}}catch{return {ok:false,code:'narrow-recovery-refused',error:'窄恢复许可或原请求状态不匹配，未发送。'}}}

  /** Only invoked by the browser-owner face; this does not expand any model role's tools. */
  async recoverOutbound(card: string, task: string, retry: boolean): Promise<Record<string, unknown>> {
    try { return { ...await this.outbound.recover(card, task, retry) } }
    catch { return { ok: false, code: 'outbound-storage', error: '外发状态未能可靠保存，未确认再次发送；请按原 task 对账。' } }
  }

  /** Design outbound-requests O3: an approver the owner named decides an outbound card it did not raise, with a reason. */
  approverDecide(session: string, id: string, option: unknown, reason: unknown): Record<string, unknown> {
    const card = this.decisionCards().find(row => row.id === id)
    // #888 D3: an approver has no input fields and its reason is not an input; an option that needs input waits for the owner.
    if (card !== undefined && typeof option === 'string' && inputFor(card, option) !== undefined) return { ok: false, code: 'needs-input', error: 'that option needs the owner to fill something in; only the owner can choose it on the decision page' }
    const checked = approverCheck({ approvers: this.settingsValue.approvers ?? [], role: this.toolRoleOf(session), card, session, reason })
    return checked.ok ? this.decide(id, 'choose', option, `审批人 ${this.displayName(session)}：${checked.reason}`) : checked
  }

  requestTool(session: string, role: Role, name: string, why?: string): string {
    const cls = grantClass(role), by = `${cls}:${name}`
    if (this.decisions.open().some(card => card.source === 'tool' && card.by === by)) return `A request to use ${name} is already waiting for the owner as a P0 decision card; try again after it is approved.`
    const last = this.decisions.lastDecided('tool', by)
    if (last !== undefined && !last.decided!.text.includes('批准') && Date.parse(this.now()) - Date.parse(last.decided!.at) < TOOL_ASK_AGAIN_MS) return `The owner declined ${name} for this team at ${last.decided!.at}; it is not asked about again for a day.`
    const who = cls === 'router' ? '总工' : '成员和观察者'
    const out = this.decisions.propose({ source: 'tool', by, at: this.now(), question: `${this.displayName(session)} 申请使用工具 ${name}（不在这个角色的工具列表里），要放行给本团队的${who}吗？`,
      reason: `${why !== undefined && why.trim() !== '' ? `申请理由：${why.trim().slice(0, 300)}。` : ''}这个工具不在团队预设里，宿主确认不了它来自哪个插件、有没有沙箱。信得过提供它的插件再批准；批准后本团队的${who}都能用，可以在设置里收回。`,
      spec: { level: 'P0', options: [`批准：本团队的${who}可用 ${name}`, '拒绝'], recommended: '拒绝' } })
    return out.ok ? `A P0 decision card asks the owner whether this team's ${cls === 'router' ? 'router' : 'members'} may use ${name}; try again after it is approved.` : `The request could not be raised: ${out.error}`
  }

  /** Apply an approved tool request: the tool joins the team's grants for that role, and the sessions' lists update now. */
  private grantTool(by: string): void {
    const [cls, name] = [by.slice(0, by.indexOf(':')), by.slice(by.indexOf(':') + 1)] as ['router' | 'member', string]
    const current = this.settingsValue.extraTools?.[cls] ?? []
    if (current.includes(name)) return
    const previous = this.settings
    this.writeSettings({ ...this.settingsValue, extraTools: { ...(this.settingsValue.extraTools ?? {}), [cls]: [...current, name] } })
    this.settingsHistory.record(this.now(), 'owner', previous as unknown as Record<string, unknown>, this.settings as unknown as Record<string, unknown>)
    try { this.d.onRolesChanged?.() } catch (error) { this.d.logger.warn('superagent: granted tool not applied: %s', String(error)) }
  }

  /** A file on one of the cards, for the owner to download (C8). */
  decisionFile(cardId: string, sha256: string): DecisionFile | undefined { return this.decisions.fileOf(cardId, sha256) }

  /** The cards waiting for the owner: those raised on their own, and every open question on a ticket. */
  decisionCards(): Array<StoredCard & { readonly title?: string }> {
    const onTickets = this.store.tickets.list().flatMap((ticket): Array<StoredCard & { title: string }> => {
      if (ticket.ended !== undefined || ticket.attention === undefined) return []
      // R7b: while the observer holds the question it has not reached the person.
      if (this.questionGate.held(ticket.id)) return []
      const id = ticketCardId(ticket.id, ticket.attention.question)
      const card = this.decisions.get(id)
      if (card?.decided !== undefined) return []
      // The person's clock (workbench-market 15) starts when the question reached them, not when the member asked.
      const reached = this.questionGate.reachedAt(ticket.id)
      const since = reached !== undefined ? { at: new Date(reached).toISOString() } : {}
      // A question asked before cards, or by an older member: it has no recommendation, so it is the strictest kind.
      return [{ ...(card ?? { id, question: ticket.attention.question, source: 'ticket' as const, by: '', ticketId: ticket.id, at: ticket.updatedAt, level: 'P1' as const, options: [], recommended: '' }), ...since, title: ticket.title }]
    })
    // Owner 2026-11-23: credential cards the host closed on a timeout stay a day, so the owner sees them and may decide again.
    const autoAcked = this.decisions.autoAcked(Date.parse(this.now()) - AUTO_ACK_SHOWN_MS)
    // #888 D5 I3: cards the host took automatically stay a day too, so the owner sees them and may decide again.
    const autoApproved = this.decisions.autoApprovedSince(Date.parse(this.now()) - AUTO_ACK_SHOWN_MS)
    return [...this.decisions.open().filter(card => card.source !== 'ticket'), ...autoAcked, ...autoApproved, ...onTickets]
  }

  /**
   * The owner decides a card (decision cards C3, C4).
   * @param id - the card.
   * @param how - `approve` takes the recommendation (P2 and P3 only); `choose` names an option, or writes a decision in `note`.
   * @param option - the option chosen.
   * @param note - the owner's words, added to the decision or standing as it.
   * @returns what was filed, or why not.
   */
  decide(id: string, how: unknown, option?: unknown, note?: unknown, files?: unknown): Record<string, unknown> {
    const card = this.decisionCards().find(row => row.id === id)
    // #934: say where a card that is no longer waiting went, instead of a bare refusal.
    if (card === undefined) return this.staleDecision(id)
    // The owner's files, staged by the right bar like a request's (C8): reference lines, added below the decision.
    const parsedFiles = decisionFiles(files)
    if (!parsedFiles.ok) return parsedFiles
    const attached = parsedFiles.files
    const words = typeof note === 'string' ? note.trim() : ''
    if (words.length > DECISION_NOTE_MAX) return { ok: false, code: 'text', error: `a decision's words are at most ${String(DECISION_NOTE_MAX)} characters` }
    let chosen: string
    if (how === 'approve') {
      if (!oneClick(card.level) || card.recommended === '') return { ok: false, code: 'needs-choice', error: `a ${card.level} decision needs an option chosen, not one click` }
      // #888 D3: a recommendation that needs input is never one click, whatever came with the request.
      if (recommendedNeedsInput(card)) return { ok: false, code: 'needs-input', error: 'the recommended option needs you to fill something in: choose it and fill it in' }
      chosen = card.recommended
    } else if (how === 'choose') {
      // #923: the option by its exact text, its id (o2) or its number (2).
      const named = resolveOption(card.options, option)
      if (named !== undefined) chosen = named
      else if (option === undefined || option === null || option === '') { if (words === '') return { ok: false, code: 'choice', error: 'choose an option, or write your decision' }; chosen = '' }
      else return { ok: false, code: 'choice', error: `that is not one of the options: give its text, its id (o1..o${String(card.options.length)}) or its number (1..${String(card.options.length)})` }
    } else return { ok: false, code: 'how', error: 'how must be approve or choose' }
    // #888 D3: an option that needs input is chosen only with it (the owner's own free-text decision, no option, stays open).
    const required = chosen === '' ? undefined : inputFor(card, chosen)
    if (required !== undefined) {
      if (required.kind !== 'file' && words === '') return { ok: false, code: 'needs-input', error: `「${chosen}」需要你填写：${required.prompt}` }
      if (required.kind !== 'text' && attached.length === 0) return { ok: false, code: 'needs-input', error: `「${chosen}」需要你附上文件：${required.prompt}` }
      if (required.kind !== 'text' && this.d.blobExists !== undefined && attached.some(file => this.d.blobExists!(file.sha256) !== true)) return { ok: false, code: 'needs-input', error: 'an attached file is no longer on the file channel; stage it again' }
    }
    // The first line stays exactly 决定：<option>; readers of decided.text depend on it.
    const answer = [...(chosen !== '' ? [`决定：${chosen}`] : []), ...(words !== '' ? [`说明：${words}`] : []), ...attached.map(file => file.ref)].join('\n')
    const withFiles = attached.length > 0 ? { files: attached } : {}
    // #935 review B1/B2: the option is recorded by its position, so readers never guess it back from the text, where a
    // note or a words-only decision can look like another option.
    const optionAt = chosen === '' ? -1 : card.options.indexOf(chosen)
    const choice = optionAt >= 0 ? { option: optionAt } : {}
    const at = this.now()
    const { title: _title, ...stored } = card
    // A health reminder's decision is a dismissal: it opens no ticket and answers no question (reliability R7).
    if (card.source === 'health') {
      this.decisions.decide(card.id, { at, text: answer, ...choice, ...withFiles }, stored)
      this.healthReminders.decided(card.id, chosen, Date.parse(at))
      // Owner ruling 2026-11-23 (ticket 4351d67f): on a credential-access card the owner's own choice acts. Only this
      // owner route reaches here; the timeout writes 「知道了」 without it, and an approver may decide outbound cards only.
      if (card.by.startsWith('credential:') && (chosen === CREDENTIAL_STOP || chosen === CREDENTIAL_BLOCK)) return { ok: true, ...this.credentialAction(card.id, card.by.slice('credential:'.length), card.question, chosen) }
      return { ok: true }
    }
    // Staffing changes (S1a): the team's confirmation of a change; the host's executor carries it out once all agree.
    if (card.source === 'staffing') {
      this.decisions.decide(card.id, { at, text: answer, ...choice, ...withFiles }, stored)
      this.d.staffingDecided?.(card.by, this, chosen === STAFFING_CONFIRM)
      return { ok: true, confirmed: chosen === STAFFING_CONFIRM }
    }
    // Design M12: the owner takes, or not, one request from a sender the bot list does not hold.
    if (card.source === 'sender') {
      if (chosen === '') return { ok: false, code: 'choice', error: 'choose whether to take this request' }
      this.decisions.decide(card.id, { at, text: answer, ...choice, ...withFiles }, stored)
      if (chosen === SENDER_DECLINE) { this.pass(); return { ok: true, taken: false } }
      const trigger = this.store.triggers.get(card.by)
      if (chosen === SENDER_TAKE_LIST && trigger !== undefined && !this.settingsValue.bots.a2a.includes(trigger.actor.id)) {
        const out = this.saveSettings({ bots: { ...this.settingsValue.bots, a2a: [...this.settingsValue.bots.a2a, trigger.actor.id] } }, () => true, this.d.presetOf ?? (() => undefined))
        if (!out.ok) this.d.logger.warn('superagent: sender %s not put on the bot list: %s', trigger.actor.id, out.error)
      }
      const again = trigger === undefined ? { ok: false as const, code: 'unknownTrigger', error: 'the message is gone' } : this.reevaluate(card.by)
      return { ok: true, taken: true, ...(again.ok ? { queued: again.queued } : { note: again.error }) }
    }
    // Design tool-requests T4: a tool request is applied to the team's grants, not ticketed.
    if (card.source === 'tool') {
      this.decisions.decide(card.id, { at, text: answer, ...choice, ...withFiles }, stored)
      if (chosen.startsWith('批准')) this.grantTool(card.by)
      return { ok: true, granted: chosen.startsWith('批准') }
    }
    // Design outbound-requests O4: the decision sends, or not; the result reaches the ticket as a note.
    if (card.source === 'outbound') {
      // Refuse before consuming the decision: re-enabling the Source can then approve this same card.
      if (chosen === OUTBOUND_APPROVE && (!this.settingsValue.sources.a2a || this.settingsValue.paused)) return { ok: false, code: 'a2a-off', error: '团队来源已停用或暂停；原卡仍待批准，没有发出。' }
      this.decisions.decide(card.id, { at, text: answer, ...choice, ...withFiles }, stored)
      void this.outbound.decided(card.id, chosen === OUTBOUND_APPROVE, this.settingsValue.canvas ?? '', ticketId => this.store.tickets.get(ticketId)?.title).catch(error => this.d.logger.warn('superagent: approved outbound %s needs reconciliation: %s', card.id, String(error)))
      return { ok: true, approved: chosen === OUTBOUND_APPROVE }
    }
    if (card.ticketId !== undefined) {
      const out = this.attachAnswer(card.ticketId, answer)
      if (!out.ok) return out
      this.decisions.decide(card.id, { at, text: answer, ...choice, triggerId: out.triggerId, ...withFiles }, stored)
      return { ok: true, ticket_id: card.ticketId, trigger_id: out.triggerId }
    }
    const filed = this.request(`[决策卡]（${card.source === 'router' ? '总工' : '观察者'}提出）${card.question}\n${answer}`)
    if (!filed.ok) return { ok: false, code: 'refused', error: filed.error }
    this.decisions.decide(card.id, { at, text: answer, ...choice, triggerId: filed.triggerId, ...withFiles }, stored)
    return { ok: true, trigger_id: filed.triggerId, thread: filed.thread }
  }

  /**
   * #934: a card that is no longer waiting, and where it went: its decision (when, by whom, its first line), or the stage of
   * the ticket it was asked on. Nothing changes; the answer only tells the decider what to look at instead.
   */
  private staleDecision(id: string): Record<string, unknown> {
    const known = this.decisions.get(id)
    const ticketId = known?.ticketId ?? known?.outbound?.ticketId
    let now: Record<string, unknown> | undefined
    let where = 'this host has no record of it'
    if (known?.decided !== undefined) {
      // #938 review B1: a credential card the host closed on its timeout carries autoAck and no decided.by. The autoAck record
      // stays when the owner decides again, so the host is named only while the decision is still that auto-ack itself (same
      // time, the host's fixed text); a later owner decision, even in the same millisecond, stays the owner's.
      const hostAck = known.autoAck !== undefined && known.decided.at === known.autoAck.at && known.decided.text === AUTO_ACK_TEXT
      const by = known.decided.by ?? (hostAck ? 'host' : 'owner')
      const first = known.decided.text.split('\n')[0] ?? ''
      now = { decided: { at: known.decided.at, by, text: first } }
      where = `it was decided at ${known.decided.at}${by === 'owner' ? '' : ` by the ${by}`}: ${first}`
    } else if (ticketId !== undefined) {
      const ticket = this.store.tickets.get(ticketId)
      const stage = ticket === undefined ? { stage: 'gone' } : ticket.ended !== undefined ? { stage: 'ended', outcome: ticket.ended.outcome } : { stage: this.ticket(ticketId)?.stage ?? null }
      now = { ticket: { id: ticketId, ...stage } }
      where = ticket === undefined ? `its ticket ${ticketId} is no longer on this host` : ticket.ended !== undefined ? `its ticket ${ticketId} ended (${String(ticket.ended.outcome)})` : `its ticket ${ticketId} moved on: the question it asked is no longer open`
    }
    return { ok: false, code: 'stale', error: `that decision is no longer waiting: ${where}`, ...(now !== undefined ? { now } : {}) }
  }

  /** Recent inferred candidates and what became of them, for improving the rules (design D13). */
  recentDecisions(limit = 40): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown> & { at: string }> = []
    for (const thread of this.store.threads.list()) {
      for (const decision of this.store.decisions.byThread(thread.key)) {
        const text = (decision.triggerIds ?? []).map(id => this.store.triggers.get(id)?.text ?? '').join('\n')
        rows.push({ at: decision.at, kind: decision.kind, ...(decision.ticketId !== undefined ? { ticket_id: decision.ticketId } : {}), audit: decision.audit ?? null, reason: decision.reason, text: clip(text, 600) })
      }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
  }

  /** Forward a member's rule change to the team host it serves. */
  async forwardRules(member: string, op: 'rules-propose' | 'rules-apply', body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const serves = this.settingsValue.serves
    if (serves === undefined || !serves.members.includes(member) || this.d.signedPost === undefined || this.d.handleOf === undefined) return { ok: false, code: 'not-member', error: 'this session serves no team' }
    try { return await this.d.signedPost(serves.url, '/a2a/superagent-team', { op, member: this.d.handleOf(member), report: body }) } catch (error) { return { ok: false, code: 'unreachable', error: String(error).slice(0, 200) } }
  }

  /** The repositories the team's members work in, each with its members (settings `repos`). */
  teamRepos(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    // Only members the canvas still has: a repository named for a member that left is kept for its return, not used.
    const now = this.settings
    const pool = new Set(this.pool())
    for (const [member, repo] of Object.entries(this.settingsValue.repos)) if (pool.has(member)) out.set(repo, [...(out.get(repo) ?? []), member])
    return out
  }

  /**
   * Design v5 R3/R4: why a member may not be added to a canvas, if it may not. The team's canvas takes no CLI handle (a
   * handle is a requester, not a worker), no session that serves another team host, and only local sessions on the member
   * preset; any other canvas takes no session that holds a role in this team.
   */
  canvasMemberRefusal(canvas: string, member: string, presetOf: (id: string) => string | undefined = () => undefined): string | undefined {
    // v5 acceptance F1: with no canvas bound there is no team canvas to protect — an upgraded team's stored router must be
    // able to join the canvas that becomes the team; binding checks one role per session then.
    if (!this.teamBound()) return undefined
    const local = member.includes('/') ? this.d.localSessionOf?.(member.replace(/@[0-9a-f]{8}$/, '')) : member
    if (canvas === this.settingsValue.canvas) {
      // R4 as revised by the pi platform (P1): only a Pi seat deposited here joins a team canvas; any other CLI handle is a requester.
      if (CLI_HANDLE_RE.test(member)) {
        const seat = this.d.piSeat?.(member)
        if (seat?.ok === true) return undefined
        return `[superagent-team-canvas] ${canvas} is the superagent team's canvas: a CLI handle is a requester, not a member — it sends requests to the team's address instead${seat !== undefined ? ` (${seat.error})` : ''}`
      }
      if (local === undefined || local === this.settingsValue.router) return undefined
      if (this.settingsValue.serves?.members.includes(local) === true) return `[superagent-team-canvas] ${local} serves another team host: a session has one team role`
      return presetRefusal(undefined, [local], presetOf)
    }
    if (local !== undefined && this.roleOf(local) !== undefined) return `[superagent-team-canvas] ${local} is the superagent team's ${this.roleOf(local)!}: a team session sits in no other canvas`
    return undefined
  }

  /** One session's model pick, by role. */
  private modelPickFor(session: string): { provider: string; model: string; reasoningEffort?: string } | undefined {
    const { models } = this.settingsValue
    if (models === undefined) return undefined
    if (session === this.settingsValue.router) return models.router
    if (this.settings.members.includes(session)) return models.member
    return undefined
  }

  /** The last model selection per session, for the team page (review of #566). */
  private readonly modelResults = new Map<string, { model: string; at: string; ok: boolean; error?: string }>()

  /** Put one local team session's model choice through (owner 2026-11-10): what a just-loaded session catches up with. */
  applyModelFor(session: string): void {
    try {
      const pick = this.modelPickFor(session)
      if (pick === undefined) return
      const select = this.d.selectModel
      if (select === undefined) return
      // The outcome is kept for the team page (review of #566: the host log does not reach the operator, so a silent miss looked like success).
      const at = this.now(), model = `${pick.provider}/${pick.model}${pick.reasoningEffort !== undefined ? ` (${pick.reasoningEffort})` : ''}`
      void select(session, pick).then(
        ok => { this.modelResults.set(session, { model, at, ok: ok === true, ...(ok === true ? {} : { error: 'session not loaded, or the model service refused it' }) }); if (ok !== true) this.d.logger.warn('superagent: the team model was not selected for %s', session) },
        error => { this.modelResults.set(session, { model, at, ok: false, error: String(error).slice(0, 300) }); this.d.logger.warn('superagent: the team model was not selected for %s: %s', session, String(error)) })
    } catch (error) { this.d.logger.warn('superagent: applying the team model failed: %s', String(error)) }
  }

  /** Put the team's model choices on its local sessions (owner 2026-11-10): unset leaves a session alone; a failure is logged, never blocks. Never throws: start() may call this while the plugin's apply() still runs. */
  applyModels(): void {
    try {
      if (this.settingsValue.models === undefined) return
      const router = this.settingsValue.router
      if (router !== undefined) this.applyModelFor(router)
      for (const member of this.settings.members) this.applyModelFor(member)
    } catch (error) { this.d.logger.warn('superagent: applying the team models failed: %s', String(error)) }
  }

  /**
   * Design v5: the bound canvas changed (a member added, removed, suspended, or the canvas gone). The pool is read from
   * the canvas, so a new member is simply free; a member that left while it ran a ticket loses that Assignment — the
   * ticket gets a new one on another member (owner ruling Q2: stop and requeue), and the member is told to stop.
   */
  poolChanged(): void {
    // v5 acceptance F3: with no canvas bound (or the bound one gone) the pool reads empty; that is not the owner taking
    // members away — running work stays where it is until a canvas is bound again.
    if (!this.teamBound()) {
      try { this.d.onRolesChanged?.() } catch (error) { this.d.logger.warn('superagent: role change not applied: %s', String(error)) }
      return
    }
    const pool = new Set(this.pool())
    // Named dispatch N4: a dispatch-named ticket whose seat left asks the requester, not the router.
    const orphaned = this.named.seatsLeft(this.executor.membersLeft(pool))
    const router = this.settingsValue.router
    if (orphaned.length > 0 && router !== undefined) this.d.deliverToSession(router, `[superagent] the member named for ${orphaned.map(id => `ticket ${id}`).join(', ')} has left the team. Choose another with superagent_assign (ticket_id, member).\n${this.memberListLine()}`)
    for (const binding of this.executor.list()) {
      if (pool.has(binding.member)) continue
      this.executor.removing(binding.member)
      const ticket = this.store.tickets.get(binding.ticketId)
      const assignment = ticket?.assignments.find(a => a.id === binding.assignmentId)
      // Review of #441: a member that already reported ready leaves a result the ticket ends on (its followed threads
      // closing); moving it would redo finished work — the member is only let go.
      if (ticket !== undefined && assignment !== undefined && assignment.report?.state === 'ready') { this.executor.stop(ticket, assignment, 'removed from the team'); continue }
      try {
        this.engine.deliveryFailed(binding.ticketId, binding.assignmentId, 'member removed from the team')
        this.engine.retryTicket(binding.ticketId)
      } catch (error) {
        // Review of #441: whatever the engine says, the removed member is let go (a binding must not outlive membership).
        this.d.logger.warn('superagent: ticket %s not moved off a removed member: %s', binding.ticketId, String(error))
        if (ticket !== undefined && assignment !== undefined && this.executor.bindingOf(binding.member) !== undefined) this.executor.stop(ticket, assignment, 'removed from the team')
      }
    }
    try { this.d.onRolesChanged?.() } catch (error) { this.d.logger.warn('superagent: role change not applied: %s', String(error)) }
    this.applyModels()
    this.executor.launch()
    this.pass()
  }
  /** Owner control: serve a team host (its key pinned from a linked peer's signed card) with these local sessions. */
  serveTeam(team: { url: string; key: string; canvas?: string } | undefined, members: readonly string[], sessionValid: (id: string) => boolean, presetOf: (id: string) => string | undefined = () => undefined): { ok: boolean; error?: string } {
    if (team === undefined) { const { serves: _gone, ...rest } = this.settingsValue; this.writeSettings(rest); return { ok: true } }
    const bad = members.find(m => !sessionValid(m) || m === this.settingsValue.router || this.settings.members.includes(m))
    if (bad !== undefined) return { ok: false, error: `${bad} must be a joined local session that is neither this team's router nor its member` }
    const wrongPreset = presetRefusal(undefined, members, presetOf, true)
    if (wrongPreset !== undefined) return { ok: false, error: wrongPreset }
    this.writeSettings({ ...this.settingsValue, serves: { url: team.url, key: team.key, members: [...new Set(members)], ...(team.canvas !== undefined ? { team: team.canvas } : {}) } })
    return { ok: true }
  }

  private writeSettings(next: TeamSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    const temporary = `${this.settingsPath}.tmp-${randomUUID()}`
    // The pool is the canvas's (design v5): never stored.
    const stored: TeamSettings = { ...next, members: [], remoteMembers: [] }
    try { writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.settingsPath) } finally { rmSync(temporary, { force: true }) }
    this.settingsValue = stored
    try { this.d.onRolesChanged?.() } catch (error) { this.d.logger.warn('superagent: role change not applied: %s', String(error)) }
  }

  /**
   * A member's report (upstream orchestrator_report) on the ticket bound to it. The router hears it in its own session,
   * so it can hand a ready result or a question to the person (superagent_reply).
   */
  report(member: string, { decision, ...report }: { state: ReportState; summary: string; question?: string | null; answers?: string; decision?: DecisionSpec & { files?: readonly DecisionFile[] } }, ticketId?: string, pullRequest?: string): { ok: true; ticketId: string; stage: unknown } | { ok: false; code: string; error: string } {
    const binding = ticketId === undefined ? this.executor.bindingOf(member) : this.executor.bindingFor(member, ticketId)
    if (binding === undefined) return ticketId === undefined ? { ok: false, code: 'not-assigned', error: 'no ticket is assigned to this session' } : this.notYours(member, ticketId)
    const current = this.store.tickets.get(binding.ticketId)
    if (report.state === 'dropped' && current !== undefined && agentLedEnd(current, binding.assignmentId)) {
      return { ok: false, code: 'agent-cannot-end', error: 'an agent\'s message cannot end this ticket: only a person (or the owner\'s stop) can. Keep working within the scope, or report blocked with a question for the person.' }
    }
    if (pullRequest !== undefined) {
      const refused = this.followPullRequest(binding.ticketId, pullRequest)
      if (refused !== undefined) return refused
    }
    let ticket: Ticket
    try { ticket = this.engine.report(binding.ticketId, report) } catch (error) { return { ok: false, code: 'refused', error: error instanceof Error ? error.message : String(error) } }
    const stage = ticket.ended ? { stage: 'ended', outcome: ticket.ended.outcome } : ticketStage(ticket)
    if (decision !== undefined && typeof report.question === 'string') this.decisions.forTicket({ ticketId: ticket.id, by: member, question: report.question, spec: { level: decision.level, options: decision.options, recommended: decision.recommended, ...(decision.inputs !== undefined ? { inputs: decision.inputs } : {}) }, at: this.now(), ...(decision.files !== undefined ? { files: decision.files } : {}) })
    // R7b: a new question for a person goes to the observer first; the person path waits while it holds it.
    const asks = typeof report.question === 'string' && report.question.trim() !== '' && ticket.attention !== undefined && ticket.ended === undefined
    const route = asks ? this.questionGate.ask(ticket.id, member, ticket.title, ticket.attention!.question, Date.parse(this.now())) : 'person'
    this.relayReport(ticket.id, report.state, report.summary, route === 'observer')
    this.pass()
    return { ok: true, ticketId: ticket.id, stage }
  }

  /** Design D1: the ticket follows the pull request its member named, so `ready` ends it only when that pull request ends. */
  private followPullRequest(ticketId: string, url: string): { ok: false; code: string; error: string } | undefined {
    const pull = parsePullRequest(url)
    if (pull === undefined) return { ok: false, code: 'pull-request', error: 'pull_request must be a GitHub pull request URL' }
    const repo = this.executor.repoOfTicket(ticketId)
    if (repo !== undefined && repo.toLowerCase() !== pull.repo.toLowerCase()) return { ok: false, code: 'pull-request', error: `that pull request is in ${pull.repo}; this ticket works in ${repo}` }
    try { this.engine.bindThread(ticketId, { source: GITHUB_SOURCE, id: pull.id }, true) } catch (error) { return { ok: false, code: 'refused', error: error instanceof Error ? error.message : String(error) } }
    return undefined
  }

  /** A report named a ticket this member does not hold: refused and counted, naming the ones it does. */
  private notYours(member: string, ticketId: string): { ok: false; code: string; error: string } {
    this.noteRefusal('superagent-wrong-id', { caller: member, target: ticketId })
    const held = this.executor.list().filter(b => b.member === member).map(b => b.ticketId)
    return { ok: false, code: 'not-yours', error: `ticket ${ticketId} is not assigned to this session (any more), and nothing was changed. ${held.length > 0 ? `Your tickets: ${held.join(', ')}. Copy the id exactly; if that was an old ticket, stop working on it.` : 'You hold no ticket now: stop working on it and do not report on it again.'}` }
  }

  /** The router hears a report in its own session, so it can hand a result or a question to the person. */
  private relayReport(ticketId: string, state: string, summary: string, held = false): void {
    const router = this.settingsValue.router, ticket = this.store.tickets.get(ticketId)
    if (router === undefined || ticket === undefined) return
    const stage = ticket.ended ? { stage: 'ended', outcome: ticket.ended.outcome } : ticketStage(ticket)
    const question = ticket.attention === undefined ? ''
      : held || this.questionGate.held(ticket.id) ? `\nThe team's observer has this ticket's question first (${questionToken(ticket.id)}): do not send it to the person yet. The host passes it on by this same route if the observer does not settle it within the hour.`
      : `\nquestion for the person (send it with superagent_reply purpose attention, copied exactly): ${ticket.attention.question}`
    // The owner asked for this in the router's own session, and reads the answer there: superagent_reply goes to the team page.
    const inChat = (state === 'ready' || state === 'failed' || state === 'dropped' || ticket.attention !== undefined) && ticket.origin.triggerIds.some(id => this.ruleChanges.filedFromChat(id))
      ? '\nThe owner asked for this in this session: besides superagent_reply, tell them here in plain words what came of it, or what you need from them.' : ''
    this.d.deliverToSession(router, `[superagent report] ticket ${ticket.id} «${ticket.title}» · ${state} · stage ${JSON.stringify(stage)}\n${clip(summary, 2_000)}${question}${inChat}`)
  }

  /** The team's A2A address: requests to it are Triggers, so they take no target queue slot. */
  get a2aAddress(): string | undefined { return this.settingsValue.sources.a2a ? this.a2a.address : undefined }
  /** Whether an approved outbound card is being sent to `target` right now (its decision is the sender scope then). */
  outboundAuthorizes(target: string): boolean { return this.outbound.authorizes(target) }
  /** superagent-root-team S5: whether `target` is one of this root's child teams (its address, with or without `@<fp8>`). */
  childAuthorizes(target: string): boolean {
    try { return this.childTeams().some(child => target === child.ref || target === child.ref.replace(/@[0-9a-f]{8}$/, '')) } catch { return false }
  }
  /** S5: the root team identities this team takes requests from (on its bot list, with the root rule). */
  admittedRoots(): string[] {
    const now = this.settingsValue
    return now.rules.some(rule => rule.name === ROOT_RULE && rule.enabled) ? now.bots.a2a.filter(handle => handle.startsWith('superagent-team/')) : []
  }

  /** Send pending a2a Channel messages; a thrown send stays pending for the next pass (a2a-watch gives up after 24h). */
  private flushOutbox(): void {
    for (const row of this.store.messages.list()) {
      if (row.status !== 'pending' || (row.message.channel.source !== 'a2a' && row.message.channel.source !== GITHUB_SOURCE) || this.sending.has(row.message.id)) continue
      const github = row.message.channel.source === GITHUB_SOURCE
      // Design github-issues G5: a reply on an issue's thread goes back as a comment while the source is on.
      if (this.settingsValue.paused || (github ? this.settingsValue.sources.github !== true : !this.a2a.allowed(row.message as never))) continue
      this.sending.add(row.message.id)
      void (github ? this.issues.send(row.message.channel.address, row.message.text) : this.a2a.send(row.message as never)).then(result => {
        this.store.atomic(() => {
          const now = this.store.messages.get(row.message.id)
          if (now === undefined || now.status !== 'pending') return
          this.store.messages.save(result === 'sent' ? { ...now, status: 'sent', sentAt: this.now() } : { ...now, status: 'dropped', droppedAt: this.now(), reason: 'gone' })
        })
      }, (error: unknown) => { this.d.logger.warn('superagent: a2a reply %s not sent yet: %s', row.message.id, String(error)) })
        .finally(() => { this.sending.delete(row.message.id) })
    }
  }

  /**
   * A person asks for a fresh judgement of a stored message (upstream `Engine.reevaluate`, "a person's replay"). An A2A
   * message whose sender already has its formal outcome is refused: its task is settled, and a later decision could not be
   * its outcome — the sender sends it again (design: superagent-reevaluate-note D1).
   * @param triggerId - the message's trigger id.
   * @returns queued false while an Eval still holds it.
   */
  reevaluate(triggerId: string): { ok: true; queued: boolean } | { ok: false; code: string; error: string } {
    const trigger = this.store.triggers.get(triggerId)
    if (trigger === undefined) return { ok: false, code: 'unknownTrigger', error: 'no such trigger' }
    const task = trigger.source === 'a2a' ? trigger.channel?.address.task : undefined
    if (task !== undefined && this.a2a.answered(task)) return { ok: false, code: 'answered', error: 'its sender already has the formal outcome of this A2A message; ask the sender to send it again' }
    const queued = this.engine.reevaluate(triggerId)
    this.pass()
    return { ok: true, queued }
  }

  /** Design M12: the owner's choice on a message's `sender` card: waiting, taken (either way) or declined; undefined with no card. */
  senderChoice(triggerId: string): 'hold' | 'taken' | 'declined' | undefined {
    if (this.decisions.open().some(card => card.source === 'sender' && card.by === triggerId)) return 'hold'
    const decided = this.decisions.lastDecided('sender', triggerId)?.decided?.text
    if (decided === undefined) return undefined
    return decided.startsWith(`决定：${SENDER_TAKE}`) ? 'taken' : 'declined'
  }

  /**
   * Design M12: a message the gate refused only for its sender not being on the bot list waits on a `sender` card for the
   * owner, within limits: one waiting card per sender, {@link SENDER_CARDS_MAX} at a time, a message at most a day old.
   * @returns the message's state, or undefined when it is not held (refused as before).
   */
  senderHold(triggerId: string): 'hold' | 'taken' | 'declined' | undefined {
    const known = this.senderChoice(triggerId)
    if (known !== undefined) return known
    const trigger = this.store.triggers.get(triggerId)
    if (trigger === undefined || trigger.source !== 'a2a' || trigger.human === true || trigger.channel?.address.task === undefined) return undefined
    if (Date.parse(this.now()) - Date.parse(trigger.at) > SENDER_HOLD_MAX_AGE_MS || this.a2a.answered(trigger.channel.address.task)) return undefined
    const open = this.decisions.open().filter(card => card.source === 'sender')
    if (open.length >= SENDER_CARDS_MAX || open.some(card => this.store.triggers.get(card.by)?.actor.id === trigger.actor.id)) return undefined
    const who = trigger.actor.id
    const out = this.decisions.propose({ source: 'sender', by: triggerId, at: this.now(),
      question: clip(`${who} 发来一条需求，发送方不在团队名单上：接不接？`, 400),
      reason: clip(`发送方不在团队的 A2A 名单上，团队不会自己接。需求原文：\n${trigger.text}`, 3_000),
      spec: { level: 'P1', options: [SENDER_TAKE, SENDER_TAKE_LIST, SENDER_DECLINE], recommended: SENDER_TAKE } })
    if (!out.ok) { this.d.logger.warn('superagent: no sender card for %s: %s', triggerId, out.error); return undefined }
    this.d.logger.info('superagent: A2A message %s from %s waits on the owner (card %s)', triggerId, trigger.actor.id, out.id)
    return 'hold'
  }

  /** Staffing changes (S1a): one confirmation card on this team for a change; its id. */
  proposeStaffingCard(changeId: string, question: string, reason: string, level: 'P0' | 'P1'): string | undefined {
    const out = this.decisions.propose({ source: 'staffing', by: changeId, question: clip(question, 400), reason: clip(reason, 3_000), at: this.now(), spec: { level, options: [STAFFING_CONFIRM, STAFFING_REFUSE], recommended: STAFFING_CONFIRM } })
    return out.ok ? out.id : undefined
  }

  /** The router decided (a routing call): its turns work again, and a failure it had is over. */
  routerDecided(): void { this.routerFailure = undefined }

  /** One pass: expire or start due Evals, then deliver what waits for the router. */
  /** When the team's MCP tool lists were last read (0: read on the next pass). */
  private mcpReadAt = 0
  private mcpReading = false
  /** Read the MCP servers' tool lists: on the first pass, after a settings save, and every 5 minutes while one is not ready. */
  private readMcpTools(): void {
    const servers = this.settingsValue.mcp ?? []
    if (servers.length === 0 || this.mcpReading) return
    const now = Date.parse(this.now())
    const notReady = this.mcp.status().some(s => s.state !== 'ready')
    if (this.mcpReadAt !== 0 && (!notReady || now - this.mcpReadAt < 5 * 60_000)) return
    this.mcpReadAt = now
    this.mcpReading = true
    void this.mcp.refreshAll().catch(error => { this.d.logger.warn('superagent: team MCP tool lists not read: %s', String(error)) }).finally(() => { this.mcpReading = false })
  }

  pass(): void {
    if (this.store.loadError !== undefined) return
    try{this.outbound.flushNarrowNotes()}catch{this.d.logger.warn('superagent: original recovery result note remains pending')}
    try { this.outbound.flushOutboundNotes() } catch (error) { this.d.logger.warn('superagent: outbound answer notes remain owed: %s', String(error)) }
    try { this.readMcpTools() } catch (error) { this.d.logger.warn('superagent: team MCP check failed: %s', String(error)) }
    try { this.engine.evaluateDue() } catch (error) { this.d.logger.warn('superagent: evaluation pass failed: %s', String(error)) }
    this.flushCandidates()
    this.flushOutbox()
    this.settleSplits()
    try { this.admitChildren() } catch (error) { this.d.logger.warn('superagent: child teams not checked yet: %s', String(error)) }
    try { this.a2a.syncDeclarations() } catch (error) { this.d.logger.warn('superagent: declarations not synced yet: %s', String(error)) }
    try { this.named.tick() } catch (error) { this.d.logger.warn('superagent: named dispatch pass failed: %s', String(error)) }
    try { this.ackCredentialCards() } catch (error) { this.d.logger.warn('superagent: credential card timeout pass failed: %s', String(error)) }
    // Upstream: evaluation, dispatch and outbound delivery hold while paused.
    if (this.settingsValue.paused) return
    try { this.autoApproveCards() } catch (error) { this.d.logger.warn('superagent: automatic approval pass failed: %s', String(error)) }
    this.executor.tick()
    this.prs.tick()
    this.issues.tick()
    this.receipts.tick()
    this.progress.tick()
  }

  /**
   * Whether `task` is an A2A request a still-open ticket was accepted from and no member report on the ticket is ready yet
   * (the A2A Source then sends a reply on it as a follow-up and keeps the formal receipt for the result).
   */
  private resultPending(ticketId: string, task: string): boolean {
    // S3: a part never sends the request's formal receipt; only its parent's end does.
    if (this.splits.parentOf(ticketId) !== undefined) return true
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended) return false
    const fromTask = ticket.origin.triggerIds.some(id => this.store.triggers.get(id)?.channel?.address?.task === task)
    // A ticket that follows a pull request has its outcome when that ends; `ready` only hands it to a person.
    const following = (ticket.follows ?? []).some(f => !f.closed)
    return fromTask && (following || !ticket.assignments.some(a => a.report?.state === 'ready'))
  }

  private flushCandidates(): void {
    const router = this.settingsValue.router
    // #739 review R1: a candidate card names the team's kb scope, which waits on the ygl-trees version read.
    if (router === undefined || this.settingsValue.paused || !this.yglReady()) return
    for (const [evalId, entry] of this.candidates) {
      if (entry.delivered) continue
      const open = this.store.tickets.list().filter(t => !t.ended)
      const requeued = new Set(entry.candidate.triggers.filter(t => this.store.triggers.disposition(t.id)?.requeued === true).map(t => t.id))
      if (!this.d.deliverToSession(router, candidateCard(entry.candidate, this.settingsValue, open, requeued, [...this.teamCardLines(), ...this.named.cardLines(entry.candidate.triggers.map(t => t.id)), ...this.yglRouterLines(router), ...this.promptCardLines('communication')]))) return
      entry.delivered = true
      try { this.engine.candidateDelivered(evalId) } catch (error) { this.d.logger.warn('superagent: candidate %s delivered but not recorded: %s', evalId, String(error)) }
    }
  }

  /**
   * A refusal at the team's edge, by its rule: an A2A route to or from a role session, a role session's tool call outside
   * its list, a host-to-host request whose signer is not the pinned key. Counted for this process (the acceptance and the
   * workbench read them); the latest ones are kept with who and what.
   */
  /**
   * A tool call named an id that does not exist. It stays refused and nothing changes; it is counted, and the text names
   * what is waiting so the caller can retry. A long id is easy to miscopy, and "unknown" alone left the router repeating it.
   */
  wrongId(kind: 'trigger' | 'ticket', given: string): string {
    this.noteRefusal('superagent-wrong-id', { target: given })
    const open = kind === 'trigger'
      ? [...new Set([...this.candidates.values()].flatMap(entry => entry.candidate.triggers.map(t => t.id)))]
      : this.store.tickets.list().filter(t => !t.ended).map(t => t.id)
    const lead = `No ${kind} has the id ${given}, and nothing was changed.`
    if (open.length === 0) return `${lead} Nothing is open for you now.`
    const distance = (id: string): number => id.length !== given.length ? Number.MAX_SAFE_INTEGER : [...id].filter((c, n) => c !== given[n]).length
    const closest = [...open].sort((a, b) => distance(a) - distance(b))[0]!
    const near = distance(closest) <= 4 ? ` Closest: ${closest}.` : ''
    return `${lead}${near} Open ${kind}s: ${open.slice(0, 20).join(', ')}. Copy the id exactly from this list or the card.`
  }

  /**
   * The credential-access audit (local market trial, 2026-11-11): a team session's tool call that touches credential
   * files, an Authorization header or another session's files is recorded — the kinds, the tool, a redacted preview,
   * never what was read. #895 (owner ruling 2026-11-26): only a call that really reads, sends or copies a protected file,
   * makes a request with an Authorization or x-api-key header, or reads another session's credential files also gives the
   * owner a P1 card, at most one per session and kind every 10 minutes; a name that only appears in a search term, a
   * description or a body is recorded and nothing more. It does not block: a team session's sandbox limits writes, not
   * reads, and the boundary is the owner's to set.
   * @returns the kinds recorded, whether or not a card was raised.
   */
  auditCall(session: string, role: string, tool: string, args: unknown): CredentialKind[] {
    const { kinds, card: cardKinds } = credentialVerdict(tool, args)
    if (kinds.length === 0) return kinds
    const at = this.now(), nowMs = Date.parse(at)
    const preview = redactedPreview(args)
    const key = `${session}|${cardKinds.join(',')}`
    const last = this.credentialCardAt.get(key)
    let card: string | undefined
    if (cardKinds.length > 0 && (last === undefined || nowMs - last >= CREDENTIAL_CARD_GAP_MS)) {
      this.credentialCardAt.set(key, nowMs)
      const who = this.displayName(session)
      const what = cardKinds.map(kind => CREDENTIAL_KIND_TEXT[kind]).join('、')
      const out = this.decisions.propose({ source: 'health', by: `credential:${session}`, question: `${who} 的 ${tool} 调用触及${what}（${at}）`, reason: `宿主只记录不拦截；命令预览（已遮蔽）：${preview}`, at,
        spec: { level: 'P1', options: ['知道了', CREDENTIAL_STOP, CREDENTIAL_BLOCK], recommended: '知道了' } })
      if (out.ok) card = out.id
    }
    this.credentialHits.push({ at, session, role, tool, kinds, preview, ...(card !== undefined ? { card } : {}), ...(cardKinds.length === 0 ? { recordOnly: true as const } : {}) })
    if (this.credentialHits.length > CREDENTIAL_HITS_KEPT) this.credentialHits.splice(0, this.credentialHits.length - CREDENTIAL_HITS_KEPT)
    if (cardKinds.length > 0) this.d.logger.warn('superagent: credential-access audit: %s (%s) %s touched %s', session, role, tool, cardKinds.join(','))
    else this.d.logger.info('superagent: credential-access audit (record only): %s (%s) %s mentioned %s', session, role, tool, kinds.join(','))
    return kinds
  }

  /**
   * Ticket 4351d67f: what the owner's own choice on a credential-access card does. 「停掉这个会话的工单」 stops each open
   * ticket that session holds and files it back to the router to give to another member; 「在团队设置里禁用这个工具」
   * adds the tool that touched the credentials to the team's blockedTools. Nothing here runs on a timeout or for an agent.
   */
  /** Ticket 269f287e: whether the owner took this ticket's work off this member on a credential-access card. */
  excludedFrom(ticketId: string, member: string): boolean { return this.credentialExcluded(ticketId).includes(member) }

  /**
   * Ticket 269f287e: whether a ticket is this session's to stop. Its binding decides when it has one (the named record can
   * still name a session the work never went to); a ticket not bound yet is the session's when it is named to it.
   */
  private heldBy(ticketId: string, session: string): boolean {
    const bound = this.executor.list().filter(b => b.ticketId === ticketId)
    return bound.length > 0 ? bound.some(b => b.member === session) : this.executor.memberOfTicket(ticketId)?.member === session
  }

  /** #825 review: the sessions a ticket must not go to: those a credential card took the same work off. */
  private credentialExcluded(ticketId: string): string[] {
    // #825 re-review: a split child is accepted from a new trigger, so walk up to every parent it was split from.
    const out = new Set<string>()
    for (let id: string | undefined = ticketId, depth = 0; id !== undefined && depth < 16; id = this.splits.parentOf(id), depth++) {
      const ticket = this.store.tickets.get(id)
      const decision = ticket === undefined ? undefined : this.store.decisions.get(ticket.decisionId) as { triggerIds?: readonly string[] } | undefined
      for (const trigger of decision?.triggerIds ?? []) { const session = this.credentialExclusions.get(trigger); if (session !== undefined) out.add(session) }
    }
    return [...out]
  }

  private credentialAction(cardId: string, session: string, question: string, chosen: string): Record<string, unknown> {
    const who = this.displayName(session)
    if (chosen === CREDENTIAL_STOP) {
      const stopped: string[] = [], refiled: string[] = [], failed: string[] = []
      for (const ticket of this.store.tickets.list()) {
        if (ticket.ended !== undefined || !this.heldBy(ticket.id, session)) continue
        try { this.engine.stopTicket(ticket.id, `属主在凭据访问审计卡上停掉了 ${who} 的工单`) } catch (error) { failed.push(ticket.id); this.d.logger.warn('superagent: credential card %s: ticket %s not stopped: %s', cardId, ticket.id, String(error)); continue }
        stopped.push(ticket.id)
        const scope = ticket.mandate.scope
        // #825 review: the host files this on the owner's card decision; the original scope is quoted with its source, never
        // restated as the owner's own words (it may come from GitHub or a member).
        const origin = `${ticket.mandate.actor.source}/${ticket.mandate.actor.id}`
        const quoted = scope.split('\n').map(line => `> ${line}`).join('\n')
        const filed = this.request(clip(`[凭据访问审计] 宿主按属主在凭据访问审计卡上的决定，把 ${who} 手上的工单「${ticket.title}」交还总工，请交给别的成员重做（宿主不会再派给 ${who}）。${scope !== '' ? `\n下面是原工单的范围，原样引自其原授权来源 ${origin}，不是属主的新指示：\n${quoted}` : ''}`, 4_000))
        if (filed.ok) {
          refiled.push(filed.triggerId)
          this.credentialExclusions.set(filed.triggerId, session)
          for (const old of [...this.credentialExclusions.keys()].slice(0, Math.max(0, this.credentialExclusions.size - 500))) this.credentialExclusions.delete(old)
          const temporary = `${this.exclusionsPath}.tmp-${randomUUID()}`
          try { writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.credentialExclusions)), { mode: 0o600 }); renameSync(temporary, this.exclusionsPath) } catch (error) { rmSync(temporary, { force: true }); this.d.logger.warn('superagent: credential exclusions not saved: %s', String(error)) }
        }
        else this.d.logger.warn('superagent: credential card %s: ticket %s stopped but not filed back: %s', cardId, ticket.id, filed.error)
      }
      this.d.logger.info('superagent: credential card %s: owner stopped %d ticket(s) of %s', cardId, stopped.length, session)
      return { action: 'stop-tickets', session, stopped, refiled, ...(failed.length > 0 ? { failed } : {}) }
    }
    const tool = this.credentialHits.find(hit => hit.card === cardId)?.tool ?? /的 (\S+) 调用触及/.exec(question)?.[1]
    if (tool === undefined || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(tool)) return { action: 'block-tool', blocked: false, note: 'the tool behind this card is not known any more (the host restarted); block it in the team settings' }
    if (!blockableTool('member', tool)) return { action: 'block-tool', tool, blocked: false, note: `${tool} is a team tool a member needs to report and be stopped (or the run_code transport); it cannot be blocked` }
    const current = this.settingsValue.blockedTools ?? []
    if (current.includes(tool)) return { action: 'block-tool', tool, blocked: true, already: true }
    const saved = this.saveSettings({ blockedTools: [...current, tool] }, () => true, this.d.presetOf ?? (() => undefined))
    if (!saved.ok) return { action: 'block-tool', tool, blocked: false, note: saved.error }
    this.d.logger.info('superagent: credential card %s: owner blocked tool %s for the team', cardId, tool)
    return { action: 'block-tool', tool, blocked: true }
  }

  /**
   * Owner 2026-11-23: a credential-access audit card nobody decided within the team's credentialAckMinutes (default 15,
   * 0 off) is closed as 「知道了」, its only option without a side effect. No other card kind, no other option. The card
   * keeps an audit record and stays on the panel for a day, marked as closed on a timeout, so the owner may decide again.
   */
  ackCredentialCards(): number {
    const minutes = this.settingsValue.credentialAckMinutes ?? CREDENTIAL_ACK_MINUTES_DEFAULT
    if (minutes === 0) return 0
    const at = this.now(), nowMs = Date.parse(at)
    let closed = 0
    for (const card of this.decisions.open()) {
      if (card.source !== 'health' || !card.by.startsWith('credential:') || nowMs - Date.parse(card.at) < minutes * 60_000) continue
      if (!this.decisions.autoAcknowledge(card.id, at, minutes)) continue
      this.healthReminders.decided(card.id, '知道了', nowMs)
      this.d.logger.info('superagent: credential card %s closed as 知道了 after %d minutes (credential-ack-timeout)', card.id, minutes)
      closed += 1
    }
    return closed
  }

  /**
   * #888 D5 (phase one: router and observer cards). On the owner's setting, an eligible card nobody decided gets its
   * recommendation taken: the record first, then the decision, then a host note to the proposer. It is not a workbench
   * trigger and passes no engine gate, so it is never the owner's explicit word and opens no ticket. Runs only while not
   * paused (pass() returns before it). Unfinished ones from before a restart are finished with the same delivery id.
   */
  autoApproveCards(): number {
    for (const card of this.decisions.autoUnfinished()) {
      if (card.decided === undefined) this.decisions.autoApproveDecide(card.id)
      const done = this.decisions.get(card.id)
      if (done !== undefined) this.tellAutoApproved(done)
    }
    const rule = this.settingsValue.autoApprove
    if (rule === undefined || !rule.enabled || rule.armedAt === undefined) return 0
    const at = this.now(), nowMs = Date.parse(at), armedMs = Date.parse(rule.armedAt)
    let room = rule.perHour - this.decisions.autoApprovedCount(nowMs - 3_600_000)
    let taken = 0
    for (const card of this.decisions.open()) {
      if (room <= 0) break
      // Levels are only ever P2 or P3 (parseSettings), so P0 and P1 never pass; a card already recorded is refused by the record.
      if (!(rule.sources as readonly string[]).includes(card.source) || !(rule.levels as readonly string[]).includes(card.level)) continue
      if (card.recommended === '' || !card.options.includes(card.recommended) || needsInput(card)) continue
      if (nowMs - Math.max(Date.parse(card.at), armedMs) < rule.afterMinutes * 60_000) continue
      if (!this.decisions.autoApproveRecord(card.id, at, rule.afterMinutes, `auto-${randomUUID()}`)) continue
      this.decisions.autoApproveDecide(card.id)
      const done = this.decisions.get(card.id)
      if (done !== undefined) this.tellAutoApproved(done)
      this.d.logger.info('superagent: card %s taken automatically after %d minutes (auto-approve)', card.id, rule.afterMinutes)
      taken += 1
      room -= 1
    }
    return taken
  }

  /** #888 D5: the host note to the proposer; marked delivered only once it reached the session. */
  private tellAutoApproved(card: StoredCard): void {
    const auto = card.autoApproved
    if (auto === undefined || auto.deliveredAt !== undefined) return
    const text = `[superagent decision] ${auto.deliveryId} 宿主按属主设置自动采纳了你提的决策卡的推荐项（非属主本人，等了 ${String(auto.minutes)} 分钟无人处理）：${card.question}\n决定：${card.recommended}\n这不是属主的指令：不开新工单，不放宽你的权限或接单规则；属主仍可改判。`
    let delivered = false
    try { delivered = this.d.deliverToSession(card.by, text) } catch (error) { this.d.logger.warn('superagent: automatic decision %s not told yet: %s', card.id, String(error)) }
    if (delivered) this.decisions.autoApproveDelivered(card.id, this.now())
  }

  noteRefusal(rule: string, detail: { caller?: string; target?: string } = {}): void {
    this.refusalCounts.set(rule, (this.refusalCounts.get(rule) ?? 0) + 1)
    this.refusalRecent.push({ at: (this.d.now ?? (() => new Date().toISOString()))(), rule, ...(detail.caller !== undefined ? { caller: detail.caller } : {}), ...(detail.target !== undefined ? { target: detail.target } : {}) })
    if (this.refusalRecent.length > REFUSALS_KEPT) this.refusalRecent.splice(0, this.refusalRecent.length - REFUSALS_KEPT)
  }

  /**
   * The settings with the pool derived from the bound canvas (design v5): the router comes out of the canvas's local
   * sessions, the rest are the members, and the canvas's remote slots are the remote members. Unbound, or bound to a
   * canvas that is gone: no members.
   */
  get settings(): TeamSettings { return this.derive(this.settingsValue) }
  private derive(stored: TeamSettings): TeamSettings {
    const team = stored.canvas !== undefined ? this.d.canvasTeam?.(stored.canvas) : undefined
    if (team === undefined) return { ...stored, members: [], remoteMembers: [], observers: [] }
    const members = team.local.filter(id => id !== stored.router)
    return { ...stored, members, remoteMembers: [...team.remote], observers: members.filter(id => this.d.presetOf?.(id) === OBSERVER_PRESET) }
  }
  /** Whether the team is bound to a canvas team that exists here (v5 acceptance F1/F3: otherwise nothing is protected or moved). */
  private teamBound(): boolean { return this.settingsValue.canvas !== undefined && this.d.canvasTeam?.(this.settingsValue.canvas) !== undefined }
  /** v5 acceptance F4: why sessions this host serves another team with cannot take work, if one cannot (wrong preset). */
  servesProblem(): string | undefined {
    const serves = this.settingsValue.serves
    if (serves === undefined) return undefined
    return presetRefusal(undefined, serves.members, this.d.presetOf ?? (() => undefined), true)
  }
  /** Why the team cannot run its canvas as bound, if it cannot (the workbench's 待你处理 shows it). */
  canvasProblem(stored: TeamSettings = this.settingsValue): string | undefined {
    if (stored.canvas === undefined) return 'the team is bound to no canvas team: compose it on the canvas (建队), then bind it with canvas and router'
    const team = this.d.canvasTeam?.(stored.canvas)
    if (team === undefined) return `the bound canvas team ${stored.canvas} does not exist on this host`
    if (stored.router !== undefined && !team.local.includes(stored.router)) return `the router ${stored.router} is not a local session of the canvas team ${stored.canvas}`
    return undefined
  }
  get routerSession(): string | undefined { return this.settingsValue.router }

  /** Owner control: replace the team settings; a Policy version change is reported to the engine as upstream does. */
  /**
   * superagent-root-team R7: a root team on this instance sends this team requests from its A2A identity. The identity
   * goes on the bot list and a rule takes its requests, as the owner would set them for the market; recorded as the
   * root's change. Nothing changes when both are there already.
   */
  admitRequester(handle: string): void {
    if (!CLI_HANDLE_RE.test(handle) || handle === this.a2a.address) return
    const now = this.settingsValue
    const listed = now.bots.a2a.includes(handle), ruled = now.rules.some(rule => rule.name === ROOT_RULE)
    if (listed && ruled) return
    const out = this.saveSettings({ bots: { ...now.bots, a2a: listed ? now.bots.a2a : [...now.bots.a2a, handle] },
      rules: ruled ? now.rules : [...now.rules, { name: ROOT_RULE, text: '根团队派来的工作：照派工里写的要求做；需要人决定的先提问；做不了就如实回报。', enabled: true }] },
      () => true, this.d.presetOf ?? (() => undefined), `root team ${handle}`)
    if (out.ok) this.d.logger.info('superagent: root team %s may now send this team requests', handle)
    else this.d.logger.warn('superagent: root team %s not admitted here: %s', handle, out.error)
  }

  /** A root team: each child team on this instance admits this root's identity (R7, same owner). */
  private admitChildren(): void {
    const handle = this.a2a.address, own = this.d.hostFingerprint?.()
    if (handle === undefined || own === undefined || this.d.admitAtChild === undefined) return
    for (const child of this.childTeams()) {
      const team = splitTeamRef(child.ref)
      if (team !== undefined && team.fingerprint === own) this.d.admitAtChild(team.name, handle)
    }
  }

  saveSettings(raw: unknown, sessionValid: (id: string) => boolean, presetOf: (id: string) => string | undefined = () => undefined, by = 'owner'): { ok: true; settings: TeamSettings; castOff?: { withdrawn: number; notWithdrawn: string[]; releasesWithdrawn: number; releasesSaved: boolean } } | { ok: false; error: string } {
    // Repositories are checked against the pool this write leads to: the canvas and router it names, or the current ones.
    const fields = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const pick = <K extends 'canvas' | 'router'>(key: K): string | undefined => key in fields ? (typeof fields[key] === 'string' && fields[key] !== '' ? fields[key] as string : undefined) : this.settingsValue[key]
    const { canvas: _canvas, router: _router, ...unbound } = this.settingsValue
    const nextCanvas = pick('canvas'), nextRouter = pick('router')
    const parsed = parseSettings(raw, this.derive({ ...unbound, ...(nextCanvas !== undefined ? { canvas: nextCanvas } : {}), ...(nextRouter !== undefined ? { router: nextRouter } : {}) }))
    if (!parsed.ok) return parsed
    // Design v5: the canvas named must exist here, and the router must be one of its local sessions.
    if (parsed.settings.canvas !== undefined && this.d.canvasTeam?.(parsed.settings.canvas) === undefined) return { ok: false, error: `no canvas team ${parsed.settings.canvas} on this host: compose it on the canvas (建队) first` }
    if (parsed.settings.router !== undefined && parsed.settings.canvas === undefined) return { ok: false, error: 'bind the team to its canvas team (canvas) before naming its router' }
    if (parsed.settings.canvas !== undefined && this.d.canvasTaken?.(parsed.settings.canvas, this) === true) return { ok: false, error: `canvas ${parsed.settings.canvas} is already another team's on this instance` }
    const next = this.derive(parsed.settings)
    const team = parsed.settings.canvas !== undefined ? this.d.canvasTeam?.(parsed.settings.canvas) : undefined
    if (parsed.settings.router !== undefined && team !== undefined && !team.local.includes(parsed.settings.router)) return { ok: false, error: `router must be a local session of the canvas team ${parsed.settings.canvas}` }
    if (parsed.settings.router !== undefined && !sessionValid(parsed.settings.router)) return { ok: false, error: 'router must be a joined local session' }
    // Design v5 R3: one session, one team role — a team session sits in no other canvas (a route there would reach a role).
    const elsewhere = [parsed.settings.router, ...next.members].find(id => id !== undefined && (this.d.canvasesOf?.(id) ?? []).some(name => name !== parsed.settings.canvas))
    if (elsewhere !== undefined) return { ok: false, error: `${elsewhere} also sits in canvas ${(this.d.canvasesOf?.(elsewhere) ?? []).filter(name => name !== parsed.settings.canvas).join(', ')}: a team session sits in no other canvas` }
    const serving = [parsed.settings.router, ...next.members].find(id => id !== undefined && this.settingsValue.serves?.members.includes(id) === true)
    if (serving !== undefined) return { ok: false, error: `${serving} already serves another team host: a session has one team role` }
    const wrongPreset = presetRefusal(parsed.settings.router, next.members, presetOf)
    if (wrongPreset !== undefined) return { ok: false, error: wrongPreset }
    const before = policyVersion(this.settingsValue)
    const previous = this.settings
    const routerChanged = parsed.settings.router !== this.settingsValue.router
    // #888 D5 B-D5-2: the host stamps when automatic approval took effect; turning it on or widening it restamps.
    const armed = armAutoApprove(this.settingsValue.autoApprove, parsed.settings.autoApprove, this.now())
    const { autoApprove: _requested, ...withoutAuto } = parsed.settings
    parsed.settings = { ...withoutAuto, ...(armed !== undefined ? { autoApprove: armed } : {}) } as typeof parsed.settings
    this.writeSettings(parsed.settings)
    // #671: the staffing executor writes its own history line for each rule set it changes, so a write it makes is not also
    // recorded as the owner's edit (that moved the revision twice and left a line for an edit nobody made).
    if (by !== 'staffing') this.recordOwnerEdits(previous, parsed.settings)
    this.settingsHistory.record(this.now(), by, previous as unknown as Record<string, unknown>, this.settings as unknown as Record<string, unknown>)
    this.poolChanged()
    const after = policyVersion(parsed.settings)
    // Open tickets hear what the change means to them (upstream PolicyEffect): their rule, proactive work, their requester.
    if (before !== after) this.engine.policyChanged(before, after, policyEffects(previous, this.settings, this.store.tickets.list().filter(t => !t.ended)))
    // A new router receives whatever the old one had not decided yet.
    if (routerChanged) for (const entry of this.candidates.values()) entry.delivered = false
    this.d.logger.info('superagent: team settings saved (policy %s)', after)
    this.applyModels()
    this.syncA2a()
    // superagent-team-mcp: the allowed tools or the servers may have changed; the plugin registers what members may call.
    this.d.mcpToolsChanged?.()
    this.mcpReadAt = 0
    // #911 review: turning casting off for a member also takes back what already waits for it (this team's casts).
    const turnedOff = (parsed.settings.castOff ?? []).filter(id => !(previous.castOff ?? []).includes(id))
    const castOff = turnedOff.length > 0 ? this.withdrawCastsFor(turnedOff) : undefined
    this.executor.launch()
    this.pass()
    return { ok: true, settings: this.settings, ...(castOff !== undefined ? { castOff } : {}) }
  }

  /**
   * The owner answers a question on a ticket that did not start in the workbench: its requester is an agent, so nobody else
   * can (definition 找人: a question reaches a person). The answer is the owner's message on a new workbench Thread, routed
   * straight to the ticket as the router's attach does.
   *
   * #929 gap 1: a question that is a card with options names its card (`card`, `options`) when it needs input, and `option`
   * answers it by the option's text, id (o2) or number (2) with the text as its words, exactly as deciding the card does; a
   * ticket with no open question takes the owner's note for its holder instead of a refusal.
   * @param option - an option of the ticket's question card, when the answer picks one.
   */
  answer(ticketId: string, text: string, option?: string): Record<string, unknown> {
    const body = text.trim()
    if (body.length > 20_000) return { ok: false, code: 'text', error: 'text is at most 20000 characters' }
    if (body === '' && (option === undefined || option === '')) return { ok: false, code: 'text', error: 'text is required, at most 20000 characters' }
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended !== undefined) return { ok: false, code: 'ticket', error: 'no open ticket has that id' }
    if (ticket.attention === undefined) {
      if (option !== undefined && option !== '') return { ok: false, code: 'no-question', error: 'that ticket has no open question, so there is no option to answer; send the text alone to leave the holder a note' }
      // #929: no question to answer, but the owner may still leave the holder a note (a new delivery, as an observer's note is).
      try { this.engine.note(ticketId, `[属主留言] ${body}`) } catch (error) { return { ok: false, code: 'refused', error: error instanceof Error ? error.message : String(error) } }
      this.pass()
      return { ok: true, noted: true, ticketId }
    }
    const card = this.decisions.get(ticketCardId(ticket.id, ticket.attention.question))
    const open = card !== undefined && card.decided === undefined ? card : undefined
    if (option !== undefined && option !== '') {
      if (open === undefined) return { ok: false, code: 'no-card', error: "that ticket's question is not a card with options; answer it with text alone" }
      return { ...this.decide(open.id, 'choose', option, body === '' ? undefined : body), card: open.id }
    }
    // #888 D3: a question with an option that needs input is answered on the decision page, not in plain text here.
    if (open !== undefined && needsInput(open)) return { ok: false, code: 'needs-input', card: open.id, options: open.options, error: `这个问题有需要填写的选项：用 user decide ${open.id} --option <选项文字|o2|2> --note <说明>（或 user answer … --option）作答，也可到决策页作答` }
    return this.attachAnswer(ticketId, body)
  }

  /**
   * The owner's words as a message on a new workbench Thread, attached to the ticket in one step so the router never gets it
   * as a candidate. #929: deciding the ticket's question card calls this, not `answer`, which refuses an unfilled card.
   */
  private attachAnswer(ticketId: string, body: string): { ok: true; triggerId: string; thread: string } | { ok: false; code: string; error: string } {
    const trigger = this.workbenchTrigger(body)
    try { this.engine.receive(trigger); this.engine.attach(ticketId, trigger.id) } catch (error) { return { ok: false, code: 'refused', error: error instanceof Error ? error.message : String(error) } }
    this.pass()
    return { ok: true, triggerId: trigger.id, thread: trigger.threads[0]!.id }
  }

  /** The workbench Source: the owner's message, as one Trigger on a new Thread or on the Thread it continues. */
  request(text: string, thread?: string, via?: WorkbenchVia): { ok: true; result: ReceiveResult; triggerId: string; thread: string } | { ok: false; error: string } {
    const body = text.trim()
    if (body === '') return { ok: false, error: 'text is required' }
    if (body.length > 20_000) return { ok: false, error: 'text is longer than 20000 characters' }
    if (thread !== undefined && !/^wb-[0-9a-f-]{36}$/.test(thread)) return { ok: false, error: 'thread must be a workbench thread id' }
    const trigger = this.workbenchTrigger(body, thread, via)
    try {
      const result = this.engine.receive(trigger)
      this.pass()
      return { ok: true, result, triggerId: trigger.id, thread: trigger.threads[0]!.id }
    } catch (error) { return { ok: false, error: String(error) } }
  }

  private workbenchTrigger(body: string, thread?: string, via?: WorkbenchVia): Trigger {
    const threadId = thread ?? `wb-${randomUUID()}`
    const id = `wb-${randomUUID()}`
    return {
      id, source: 'workbench', threads: [{ source: 'workbench', id: threadId }],
      actor: { source: 'workbench', id: via === undefined ? WORKBENCH_OWNER : via === 'cli' ? WORKBENCH_CLI : 'member' in via ? memberActor(via.member) : observerActor(via.observer) }, human: via === undefined, addressed: 'direct', at: this.now(), text: body,
      channel: { source: 'workbench', thread: threadId, address: { trigger: id } }, meta: {},
    }
  }

  /** The workbench's read: threads with their triggers, decisions and replies; tickets with their stage. */
  /**
   * Design reliability R6: what keeps this team from working, beyond what its settings already show. Codes, not words: each
   * page says them in its own language.
   * @param now - the clock, in milliseconds.
   * @returns the team's problems.
   */
  // #722: default to the host's clock, the one routerFailure.at and the engine's updatedAt are stamped with (as #721 did for the
  // decision book); the real clock here misreported a ticket quiet for days whenever the host's clock was injected.
  health(now = Date.parse(this.now())): Array<{ code: string; session?: string; name?: string; ticketId?: string; title?: string; minutes?: number; detail?: string; reason?: string; repo?: string; count?: number }> {
    const out: Array<{ code: string; session?: string; ticketId?: string; title?: string; minutes?: number; detail?: string; reason?: string; repo?: string; count?: number }> = []
    const loaded = this.d.sessionLoaded
    if (loaded === undefined || !this.teamBound()) return out
    const { router, members } = this.settings
    if (this.d.bootSettled?.() !== false) {
      if (router !== undefined && !loaded(router)) out.push({ code: 'router-not-loaded', session: router })
      for (const member of members) if (!loaded(member)) out.push({ code: 'member-not-loaded', session: member })
    }
    for (const server of this.mcp.status()) if (server.state !== 'ready') out.push({ code: server.state === 'no-seat' ? 'mcp-no-seat' : 'mcp-token-unavailable', title: server.name, ...(server.problem !== undefined ? { detail: server.problem } : {}) })
    if (this.routerFailure !== undefined && router !== undefined) out.push({ code: 'router-turn-failed', session: router, minutes: Math.max(0, Math.floor((now - Date.parse(this.routerFailure.at)) / 60_000)), detail: this.routerFailure.error })
    for (const binding of this.executor.list()) {
      const ticket = this.store.tickets.get(binding.ticketId)
      if (ticket === undefined || ticket.ended !== undefined || ticketStage(ticket).stage !== 'working') continue
      const minutes = Math.floor((now - Date.parse(ticket.updatedAt)) / 60_000)
      if (minutes >= QUIET_MINUTES) out.push({ code: 'ticket-quiet', ticketId: ticket.id, title: ticket.title, minutes })
    }
    // A queued ticket has no binding, so the quiet check above never sees it: say what it has waited for, and for how long.
    out.push(...queuedProblems(this.executor.queued(), q => this.queuedSince(q), id => this.store.tickets.get(id)?.title ?? id, now))
    // T8: a decision card the market refused (or this host could not shape for it) stays visible: one problem per team and card.
    for (const p of this.outbound.unsettledProblems()) out.push({ code: 'receipt-unsettled', ticketId: p.ticketId, title: this.store.tickets.get(p.ticketId)?.title ?? p.ticketId, detail: `对外请求 task ${p.task}：${unsettledText(p.last)}` })
    for (const p of this.reviews.unsettledProblems()) out.push({ code: 'receipt-unsettled', ticketId: p.ticketId, title: this.store.tickets.get(p.ticketId)?.title ?? p.ticketId, detail: `评审 task ${p.task}：${unsettledText(p.last)}` })
    for (const p of this.outbound.noteProblems()) out.push({ code: p.kind === 'pending' ? 'outbound-note-pending' : 'outbound-note-ticket-ended', ticketId: p.ticketId, title: this.store.tickets.get(p.ticketId)?.title ?? p.ticketId, detail: `task ${p.task}` })
    for (const refused of this.decisionPush.problems()) out.push({ code: 'decision-push-refused', title: `${this.settings.canvas ?? ''}/${refused.cardId}`, detail: refused.why })
    if (this.settingsValue.idleSweep === true) out.push(...this.idleSweep(now))
    // A short id says nothing to the owner: a problem about a session carries its seat name or title when there is one
    // (owner decision card 2026-11-23). The key stays the session id, so a rename never raises a problem anew.
    return out.map(problem => {
      const raw = problem.session !== undefined ? this.memberName(problem.session) : undefined
      // Shown text only: control characters and bidirectional controls are dropped and the length is capped; the key stays the id.
      const name = cleanName(raw)
      return name !== undefined && name !== problem.session ? { ...problem, name } : problem
    })
  }

  /**
   * T5-B (workbench-market 18, the session idle sweep): what the wrap-up self-check log says about the members holding a
   * ticket. Three problems, each going to the observer first (R7a): a registered wait past its deadline with nothing
   * newer (session-wait-overdue), an orphan stop as the latest word (session-orphan-stop), and a member that has held a
   * ticket for QUIET_MINUTES with no self-check record at all (session-no-selfcheck: the check never ran — an error, an
   * interruption, a session not loaded). Only rows written since this Assignment began count: a member's earlier ticket
   * says nothing about this one (#765 review X1–X3). The latest word is the latest orphan or concluded row; rows the
   * check writes along the way (written, hint, no-template, injected) never hide it (X4). Silent when the self-check log
   * is not readable or the check is off; a member whose log read throws is skipped, the others are still swept.
   */
  private idleSweep(now: number): Array<{ code: string; session: string; ticketId?: string; title?: string; minutes?: number; detail?: string }> {
    const out: Array<{ code: string; session: string; ticketId?: string; title?: string; minutes?: number; detail?: string }> = []
    if (this.d.selfChecksOf === undefined) return out
    for (const binding of this.executor.list()) {
      const member = binding.member
      if (member.includes('@')) continue
      const ticket = this.store.tickets.get(binding.ticketId)
      if (ticket === undefined || ticket.ended !== undefined) continue
      const since = Date.parse(ticket.assignments.find(a => a.id === binding.assignmentId)?.createdAt ?? '')
      if (!Number.isFinite(since)) continue
      let rows: ReadonlyArray<{ kind: string; conclusion: string | null; deadline: string | null; at: string }> | undefined
      try { rows = this.d.selfChecksOf(member) } catch { continue }
      if (rows === undefined) return out
      const ref = { session: member, ticketId: ticket.id, title: ticket.title }
      const current = rows.filter(row => Date.parse(row.at) >= since)
      if (current.length === 0) {
        const minutes = Math.floor((now - since) / 60_000)
        if (minutes >= QUIET_MINUTES) out.push({ code: 'session-no-selfcheck', ...ref, minutes })
        continue
      }
      const last = current.filter(row => row.kind === 'orphan' || row.kind === 'concluded').at(-1)
      if (last === undefined) continue
      if (last.kind === 'orphan' || last.conclusion === 'orphan') { out.push({ code: 'session-orphan-stop', ...ref }); continue }
      if (last.conclusion === 'waiting' && last.deadline !== null) {
        const due = Date.parse(last.deadline)
        if (Number.isFinite(due) && now > due) out.push({ code: 'session-wait-overdue', ...ref, minutes: Math.floor((now - due) / 60_000), detail: last.deadline })
      }
    }
    return out
  }

  /** When a waiting Assignment began waiting: its createdAt, or undefined when the ticket or Assignment is gone. */
  private queuedSince(q: QueuedAssignment): string | undefined {
    const ticket = this.store.tickets.get(q.ticketId)
    return ticket === undefined || ticket.ended !== undefined ? undefined : ticket.assignments.find(a => a.id === q.assignmentId)?.createdAt
  }

  /**
   * What a queued ticket waits for, for the router's and observers' reads: the reason, the member or repository, since
   * when. Undefined when the ticket is not waiting for a member.
   */
  queueOf(ticketId: string): { reason: QueueReason; member?: string; repo?: string; since?: string; refusedAt?: string } | undefined {
    const q = this.executor.queued().find(entry => entry.ticketId === ticketId)
    if (q === undefined) return undefined
    const since = this.queuedSince(q)
    const minutes = since === undefined ? undefined : Math.floor((Date.parse(this.now()) - Date.parse(since)) / 60_000)
    return { reason: queueReason(q.reason, minutes), ...(q.member !== undefined ? { member: this.displayName(q.member) } : {}), ...(q.repo !== undefined ? { repo: q.repo } : {}), ...(since !== undefined ? { since } : {}), ...(q.refusedAt !== undefined ? { refusedAt: q.refusedAt } : {}) }
  }

  state(): Record<string, unknown> {
    const messages = this.store.messages.list()
    const repliesOf = (thread: string): StoredMessage[] => messages.filter(row => row.message.channel.source === 'workbench' && row.message.channel.thread === thread)
    return {
      health: this.health(),
      // Design Y1d/Y1e: what the installed ygl-trees can do, and this team's project and kb scope.
      ygl: { ...this.yglCaps(), ...(this.yglProject() !== undefined ? { project: this.yglProject() } : {}), ...(this.yglScope() !== undefined ? { scope: this.yglScope() } : {}) },
      settings: this.settings,
      ...(this.canvasProblem() !== undefined ? { canvasProblem: this.canvasProblem() } : {}),
      ...(this.servesProblem() !== undefined ? { servesProblem: this.servesProblem() } : {}),
      canvases: [...(this.d.canvasNames?.() ?? [])],
      policyVersion: policyVersion(this.settingsValue),
      ruleChanges: this.ruleChanges.view(),
      a2a: { enabled: this.settingsValue.sources.a2a, address: this.a2a.address ?? null, health: this.a2a.health },
      refusals: { counts: Object.fromEntries(this.refusalCounts), recent: [...this.refusalRecent] },
      credentialAudit: [...this.credentialHits],
      mcp: { servers: this.mcp.status(), calls: this.mcp.calls().slice(-50) },
      settingsHistory: this.settingsHistory.list(),
      casts: this.castsView(),
      modelResults: Object.fromEntries(this.modelResults),
      ...(this.prs.problem !== undefined ? { pullRequestProblem: this.prs.problem } : {}),
      ...(this.issues.problem !== undefined ? { githubIssuesProblem: this.issues.problem } : {}),
      reviews: this.reviews.list(),
      outbound: this.outbound.list(),
      executor: { canvas: this.settingsValue.canvas ?? null, members: this.settings.members, remoteMembers: this.settings.remoteMembers, bindings: this.executor.list(), queued: this.executor.queued().map(q => { const since = this.queuedSince(q); return { ...q, reason: queueReason(q.reason, since === undefined ? undefined : Math.floor((Date.parse(this.now()) - Date.parse(since)) / 60_000)), since: since ?? null } }) },
      ...(this.settingsValue.serves !== undefined ? { serves: this.settingsValue.serves } : {}),
      ...(this.store.loadError !== undefined ? { error: this.store.loadError } : {}),
      threads: this.store.threads.list().map(thread => ({
        key: thread.key, ref: thread.ref, createdAt: thread.createdAt, lastAt: thread.lastAt ?? null, subscriptions: thread.subscriptions,
        evaluating: thread.evaluating ? { id: thread.evaluating.id, triggerIds: thread.evaluating.triggerIds, delivered: thread.evaluating.delivered ?? null, deadline: thread.evaluating.deadline } : null,
        pending: thread.pending,
        triggers: [...new Set([...thread.pending, ...(thread.evaluating?.triggerIds ?? []), ...this.store.decisions.byThread(thread.key).flatMap(d => d.triggerIds)])]
          .map(id => this.store.triggers.get(id)).filter((t): t is Trigger => t !== undefined)
          .map(t => ({ id: t.id, actor: t.actor, at: t.at, text: t.text, disposition: this.store.triggers.disposition(t.id) ?? null })),
        decisions: this.store.decisions.byThread(thread.key),
        replies: thread.ref.source === 'workbench' ? repliesOf(thread.ref.id) : [],
      })),
      // #888 D4: an open question whose card has an option that needs input says so, for the workbench's ticket page.
      tickets: this.store.tickets.list().map(ticket => ({ ...ticket, ...(ticket.attention !== undefined && this.questionNeedsInput(ticket.id, ticket.attention.question) ? { attention: { ...ticket.attention, needsInput: true } } : {}), stage: ticket.ended ? null : ticketStage(ticket) })),
    }
  }

  /** A ticket as the router reads it. */
  ticket(id: string): (Ticket & { stage: unknown }) | undefined {
    const ticket = this.store.tickets.get(id)
    return ticket === undefined ? undefined : { ...ticket, stage: ticket.ended ? null : ticketStage(ticket) }
  }
}
