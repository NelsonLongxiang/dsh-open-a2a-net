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
import { MEMBER_PRESET, OBSERVER_PRESET, ROUTER_PRESET, grantClass, type Role } from './role-tools.ts'
import { CLI_HANDLE_RE } from '../../cli-deposit.ts'
import { DEFAULT_SETTINGS, WORKBENCH_CLI, WORKBENCH_OWNER, OBSERVER_OPEN_MAX, PROMPT_MAX, observerActor, observerOfActor, parseSettings, parseStoredSettings, policyEffects, policyVersion, teamPolicy, teamScope, type RemoteMember, type TeamSettings } from './policy.ts'
import { searchTeam } from './search.ts'
import { A2aReceipts, END_RECEIPT_GRACE_MS } from './receipts.ts'
export { END_RECEIPT_GRACE_MS } from './receipts.ts'
/** How long a declined tool request stays declined before the tool may be asked about again (design tool-requests T4). */
export const TOOL_ASK_AGAIN_MS = 24 * 3_600_000
import { agentLedEnd, clip, TEXT_CAP, presetRefusal, notTakenText, OTHER_TICKETS_SHOWN, ORIGIN_LINE_NOTE, OBSERVER_LINE, candidateCard, YGL_WRITE, YGL_CARD_LINES } from './cards.ts'
import type { SuperagentHostDeps, PersonMessage, WorkbenchVia } from './deps.ts'
export * from './cards.ts'
export type * from './deps.ts'

/** How often due Evals are checked and undelivered candidates retried. */
export const PASS_MS = 5_000
/** How many refusals the state keeps with their detail (the counts keep all). */
const REFUSALS_KEPT = 50
/** How long a working ticket may go without any change before the health check names it (reliability R6). */
export const QUIET_MINUTES = 60

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
  /** Proposals to change a rule set, each set's revision and last change (design D8–D10b). */
  readonly ruleChanges: RuleChanges
  private disposeTimer: (() => void) | undefined
  private healthTimer: (() => void) | undefined
  /** The A2A executor (PR-C1): the owner's fixed member pool, one worker slot each. */
  readonly executor: MemberExecutor
  private readonly decisions: DecisionBook
  /** The team's settings saves, for the team page's 设置 (each team keeps its own, with its state). */
  private readonly settingsHistory: SettingsHistory
  /** The team's health reminders: one card per problem, taken back when it goes away (reliability R7). */
  private readonly healthReminders: HealthReminders
  /** The A2A Source (PR-B2b): the team's A2A address and its mailbox loop. */
  readonly a2a: A2aSource
  /** What the team owes A2A requesters (host/receipts.ts). */
  private readonly receipts: A2aReceipts
  /** Outbox messages being sent right now, so a pass never sends one twice at once. */
  private readonly sending = new Set<string>()
  private started = false
  /** Refusals at the team's edge by rule, and the latest ones (noteRefusal). */
  private readonly refusalCounts = new Map<string, number>()
  private readonly refusalRecent: Array<{ at: string; rule: string; caller?: string; target?: string }> = []

  constructor(private readonly d: SuperagentHostDeps) {
    const dir = d.stateDir ?? join(d.home, 'superagent')
    this.settingsPath = join(dir, 'settings.json')
    this.settingsValue = this.loadSettings()
    this.store = new JsonRepositories(join(dir, 'state.json'))
    const assessor: Assessor = {
      request: candidate => { this.candidates.set(candidate.evalId, { candidate, delivered: false }); queueMicrotask(() => this.flushCandidates()) },
      release: evalId => { this.candidates.delete(evalId) },
    }
    const executor = this.executor = new MemberExecutor({
      path: join(dir, 'executor.json'), members: () => { const now = this.settings; return [...now.members, ...now.remoteMembers.map(r => r.ref)] },
      repoOf: member => this.settingsValue.repos[member],
      memberNotes: (member, ticket) => this.memberNotes(member, ticket),
      deliver: (member, text, kind, ticketId) => this.deliverToMember(member, text, kind, ticketId), engine: () => this.engine,
      paused: () => this.settingsValue.paused,
      cancelTurn: member => this.d.cancelTurn?.(member) === true,
      reportFor: (ticketId, member, state, summary) => { this.engine.report(ticketId, { state, summary: clip(summary, 2_000) }); this.relayReport(ticketId, state, summary); this.pass(); void member },
      ticket: id => this.store.tickets.get(id), trigger: id => this.store.triggers.get(id), logger: d.logger,
      prepare: () => this.settingsValue.prepare, workspaceOf: member => this.d.workspaceOf?.(member), maxConcurrent: () => this.settingsValue.maxConcurrent ?? 0,
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
      dir, homeUrl: () => d.homeUrl?.(), apiKey: () => d.apiKey?.(), enabled: () => this.settingsValue.sources.a2a,
      receive: trigger => { this.reviews.received(trigger as unknown as Trigger); const result = this.engine.receive(trigger as unknown as Trigger); queueMicrotask(() => this.pass()); return result },
      ticket: id => this.store.tickets.get(id) as never,
      resultPending: (ticketId, task) => this.resultPending(ticketId, task),
      logger: d.logger, ...(d.runCli !== undefined ? { run: d.runCli } : {}), ...(d.teamSend !== undefined ? { teamSend: d.teamSend } : {}), ...(d.a2aPollSeconds !== undefined ? { pollSeconds: d.a2aPollSeconds } : {}),
    })
    this.receipts = new A2aReceipts({ store: this.store, a2a: this.a2a, a2aOn: () => this.settingsValue.sources.a2a, now: () => this.now(), logger: d.logger })
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
    this.decisions = new DecisionBook(join(dir, 'decisions.json'), ticketId => { const ticket = this.store.tickets.get(ticketId); return ticket !== undefined && ticket.ended === undefined })
    this.healthReminders = new HealthReminders(
      (question, key, at) => { const out = this.decisions.propose({ source: 'health', by: 'health', question, reason: key, at, spec: { level: 'P2', options: ['去处理', '先忽略 24 小时'], recommended: '去处理' } }); return out.ok ? out.id : undefined },
      cardId => this.decisions.withdraw(cardId),
      () => this.decisions.open().filter(card => card.source === 'health').map(card => ({ id: card.id, ...(card.reason !== undefined ? { reason: card.reason } : {}) })),
      () => this.now(),
    )
    this.reviews = new ReviewRequests({
      path: join(dir, 'reviews.json'), reviewer: () => this.settingsValue.reviewer, logger: d.logger,
      ask: (address, text) => this.a2a.askReview(address, text),
      note: (ticketId, text) => { try { this.engine.note(ticketId, text); this.pass() } catch (error) { this.d.logger.warn('superagent: review verdict of %s not noted: %s', ticketId, String(error)) } },
    })
    this.engine = new Engine({
      repo: this.store,
      policy: () => teamPolicy(this.settings),
      scope: teamScope(() => this.settingsValue),
      assessor, executor, outbox,
      ...(d.now !== undefined ? { now: d.now } : {}),
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
    this.disposeTimer = this.d.interval(() => this.pass(), PASS_MS)
    // Reliability R7: look at the team's health every 15 minutes; a new problem raises one card (the boot grace period
    // keeps health() quiet, so nothing is raised from it either).
    this.healthTimer = this.d.interval(() => { this.healthReminders.tick(this.health() as readonly HealthProblem[], Date.parse(this.now())) }, HEALTH_TICK_MS)
    // Defer: start() may run while the plugin's apply() still executes, when the canvas lookups it touches are not
    // initialized yet (a TDZ crash took the plugin down on hosts with models set - review of #566). A microtask runs
    // after apply() finishes; the catch inside applyModels is the second fence.
    queueMicrotask(() => { this.applyModels() })
    this.started = true
    this.syncA2a()
    this.pass()
  }

  stop(): Promise<void> { this.disposeTimer?.(); this.disposeTimer = undefined; this.healthTimer?.(); this.healthTimer = undefined; this.started = false; return this.a2a.stop() }

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

  /** A session's tool list: its role, an observer being a member with one tool more. */
  toolRoleOf(sessionId: string): Role | undefined {
    const role = this.roleOf(sessionId)
    return role === 'member' && this.isObserver(sessionId) ? 'observer' : role
  }

  /** How a member's turn ended, and whether it answered the owner in person. */
  private turnOf(sessionId: string): MemberTurn | undefined {
    const turn = this.d.memberTurn?.(sessionId)
    return turn === undefined ? undefined : { ...turn, person: this.d.personMessage?.(sessionId) !== undefined }
  }

  /** A member's turn ended (agent idle): the executor's turn-end fact — told to the served team host when it is theirs. */
  memberIdle(sessionId: string): void { this.memberEvent(sessionId, 'idle') }
  /** A member's turn failed (agent error): retried or reported as failed — by the team host when it is theirs. */
  memberFailed(sessionId: string, error: unknown): void {
    if (this.settings.members.includes(sessionId)) { this.executor.memberError(sessionId, error); return }
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

  /** PR-C2: put a card into a member's session — local by host relay, remote by a signed request to its host. */
  private async deliverToMember(member: string, text: string, kind: 'assign' | 'input' | 'stop', ticketId: string): Promise<boolean> {
    const remote = this.settings.remoteMembers.find(r => r.ref === member)
    if (remote === undefined) return this.d.deliverToSession(member, text)
    if (this.d.signedPost === undefined || remote.url === '') return false
    const out = await this.d.signedPost(remote.url, '/a2a/superagent-member', { op: kind, member: remote.ref.replace(/@[0-9a-f]{8}$/, ''), ticket: ticketId, text })
    return out.ok === true
  }

  /**
   * PR-C2, team host side: a member host's signed report or turn end. It counts only when the signer's key is the key the
   * owner pinned for that member's ref (another instance sharing the zone and id8 has another key).
   */
  remoteEvent(op: unknown, memberHandle: unknown, signerKey: string, report: unknown): Record<string, unknown> {
    const entry = this.settings.remoteMembers.find(r => r.ref.replace(/@[0-9a-f]{8}$/, '') === memberHandle && r.key === signerKey)
    if (entry === undefined) return { ok: false, code: 'not-member', error: 'no remote member of this team is that session under that key' }
    if (op === 'idle') {
      const turn = (report ?? {}) as Record<string, unknown>
      this.executor.memberIdle(entry.ref, { quiet: turn.quiet !== false, text: typeof turn.text === 'string' ? clip(turn.text, 2_000) : '', ...(turn.person === true ? { person: true } : {}) })
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
    if (op === 'ack' || op === 'handback') {
      const r = (report ?? {}) as Record<string, unknown>
      return this.takeUp(entry.ref, op, r.trigger_id, r.text)
    }
    if (op !== 'report') return { ok: false, code: 'op', error: 'op must be report, ack, handback, rules-propose, rules-apply, read, idle or error' }
    const r = (report ?? {}) as Record<string, unknown>
    if (typeof r.state !== 'string' || !['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'].includes(r.state) || typeof r.summary !== 'string' || r.summary.trim() === '') return { ok: false, code: 'report', error: 'a report needs a state and a summary' }
    return this.report(entry.ref, { state: r.state as ReportState, summary: r.summary, ...(typeof r.question === 'string' || r.question === null ? { question: r.question as string | null } : {}), ...(typeof r.answers === 'string' ? { answers: r.answers } : {}), ...(typeof r.question === 'string' && typeof parseDecision(r) !== 'string' ? { decision: parseDecision(r) as DecisionSpec } : {}) }, typeof r.ticket_id === 'string' ? r.ticket_id : undefined, typeof r.pull_request === 'string' ? r.pull_request : undefined)
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
  async forwardReport(member: string, report: { state: ReportState; summary: string; question?: string | null; answers?: string; ticket_id?: string; pull_request?: string; options?: readonly string[]; recommended?: string; level?: string }): Promise<Record<string, unknown>> {
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

  private pool(): string[] { const now = this.settings; return [...now.members, ...now.remoteMembers.map(r => r.ref)] }
  private memberName(id: string): string { return this.d.sessionName?.(id) ?? id }
  memberListLine(): string { return `The team's members: ${this.pool().map(id => this.memberName(id)).join('; ') || '(none)'}.` }

  /** A member by its session id, the first eight of it, or its name; undefined when none matches, or more than one. */
  resolveMember(value: string): string | undefined {
    const wanted = value.trim().toLowerCase()
    const matches = this.pool().filter(id => {
      const short = id.replace(/^session-/, '')
      return id.toLowerCase() === wanted || short.toLowerCase() === wanted || short.slice(0, 8).toLowerCase() === wanted || this.memberName(id).toLowerCase() === wanted
    })
    return matches.length === 1 ? matches[0] : undefined
  }

  /** Whether any member has a role or rules: then an accept must name one (design D5). */
  membersProfiled(): boolean { return this.pool().some(id => this.settingsValue.profiles[id] !== undefined) }

  /** What the router sees of the team when it dispatches (design D4). */
  private teamCardLines(): string[] {
    const pool = this.pool()
    const dispatch = this.settingsValue.dispatch
    if (dispatch === '' && !this.membersProfiled()) return []
    const lines = ['The team\'s members. When you accept, name the one the work fits as member, by the dispatch rules and each member\'s role and rules:']
    for (const id of pool) {
      const profile = this.settingsValue.profiles[id]
      const held = this.executor.bindingOf(id)
      const repo = this.settingsValue.repos[id]
      lines.push(`- ${this.memberName(id)} · ${held === undefined ? 'free' : `working on ${held.ticketId}`}${repo !== undefined ? ` · repository ${repo}` : ''}${profile?.role !== undefined ? ` · role: ${clip(profile.role, 200)}` : ''}`)
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
    if (this.d.hasTool?.(member, YGL_WRITE) === true) lines.push(...YGL_CARD_LINES)
    for (const name of ticket.mandate.basis.rules ?? []) {
      const rule = this.settingsValue.rules.find(r => r.name === name)
      if (rule !== undefined) lines.push(`accepted on team rule ${rule.name}: ${clip(rule.text, 600)}`)
    }
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
    const latest = ticket.assignments.at(-1)
    if (latest?.state === 'pending') { this.executor.setMember(ticketId, member); return { ok: true, ticket_id: ticketId, member: this.memberName(member) } }
    this.executor.setMember(ticketId, member)
    try { this.engine.retryTicket(ticketId) } catch (error) { return { ok: false, code: error instanceof UserError ? error.code : 'refused', error: `the ticket is running and its member has not reported it cannot go on: ${error instanceof Error ? error.message : String(error)}` } }
    this.pass()
    return { ok: true, ticket_id: ticketId, member: this.memberName(member) }
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

  /** What an observer filed that is still undecided or on an open ticket. */
  private observerOpen(actor: string): Trigger[] {
    const ids = new Set<string>()
    for (const thread of this.store.threads.list()) for (const id of [...thread.pending, ...(thread.evaluating?.triggerIds ?? [])]) ids.add(id)
    for (const ticket of this.store.tickets.list()) if (ticket.ended === undefined && ticket.mandate?.actor.id === actor) for (const id of ticket.origin?.triggerIds ?? []) ids.add(id)
    return [...ids].flatMap(id => { const t = this.store.triggers.get(id); return t !== undefined && t.actor.source === 'workbench' && t.actor.id === actor ? [t] : [] })
  }

  /** File an observer's own request (design D15). It reaches the router as any request does; the host only keeps a loop from flooding it. */
  requestForObserver(session: string, text: string): Record<string, unknown> {
    if (!this.isObserver(session)) return { ok: false, code: 'not-observer', error: 'a2a_ticket_request serves only the sessions on this team created under the observer preset' }
    const open = this.observerOpen(observerActor(session))
    const repeated = open.find(t => t.text === text.trim())
    if (repeated !== undefined) return { ok: true, trigger_id: repeated.id, reused: true }
    if (open.length >= OBSERVER_OPEN_MAX) return { ok: false, code: 'too-many-open', error: `you already have ${String(open.length)} requests open; wait for one to end before filing another` }
    const filed = this.request(text, undefined, { observer: session })
    if (!filed.ok) return { ok: false, code: 'refused', error: filed.error }
    return { ok: true, trigger_id: filed.triggerId, thread: filed.thread }
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
    return this.decisions.propose({ source, by, question, spec, at: this.now(), ...(reason !== undefined && reason.trim() !== '' ? { reason: reason.trim() } : {}), ...(files !== undefined ? { files } : {}) })
  }

  /**
   * A ready report from a member that has ygl-trees but names nothing it wrote there is sent back once (design Y2): the
   * second ready goes through, so a ticket with nothing worth keeping is never held.
   * @returns the refusal, or undefined to take the report.
   */
  yglReadyRefusal(member: string, ticketId: string, state: string, ids: readonly string[]): { ok: false; code: string; error: string } | undefined {
    if (state !== 'ready' || ids.length > 0 || this.d.hasTool?.(member, YGL_WRITE) !== true || this.yglReminded.has(ticketId)) return undefined
    this.yglReminded.add(ticketId)
    return { ok: false, code: 'ygl-record', error: 'Before ready, record what this ticket found in ygl-trees: evidence and claims with mcp__ygl__write, and kb add what the next session should reuse. Then report ready again with the ids in ygl. If nothing here is worth keeping, report ready again and say why in summary; this reminder comes only once.' }
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
  requestTool(session: string, role: Role, name: string): string {
    const cls = grantClass(role), by = `${cls}:${name}`
    if (this.decisions.open().some(card => card.source === 'tool' && card.by === by)) return `A request to use ${name} is already waiting for the owner as a P0 decision card; try again after it is approved.`
    const last = this.decisions.lastDecided('tool', by)
    if (last !== undefined && !last.decided!.text.includes('批准') && Date.parse(this.now()) - Date.parse(last.decided!.at) < TOOL_ASK_AGAIN_MS) return `The owner declined ${name} for this team at ${last.decided!.at}; it is not asked about again for a day.`
    const who = cls === 'router' ? '总工' : '成员和观察者'
    const out = this.decisions.propose({ source: 'tool', by, at: this.now(), question: `${this.memberName(session)} 申请使用工具 ${name}（不在这个角色的工具列表里），要放行给本团队的${who}吗？`,
      reason: `这个工具不在团队预设里，宿主确认不了它来自哪个插件、有没有沙箱。信得过提供它的插件再批准；批准后本团队的${who}都能用，可以在设置里收回。`,
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
      const id = ticketCardId(ticket.id, ticket.attention.question)
      const card = this.decisions.get(id)
      if (card?.decided !== undefined) return []
      // A question asked before cards, or by an older member: it has no recommendation, so it is the strictest kind.
      return [{ ...(card ?? { id, question: ticket.attention.question, source: 'ticket' as const, by: '', ticketId: ticket.id, at: ticket.updatedAt, level: 'P1' as const, options: [], recommended: '' }), title: ticket.title }]
    })
    return [...this.decisions.open().filter(card => card.source !== 'ticket'), ...onTickets]
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
    if (card === undefined) return { ok: false, code: 'stale', error: 'that decision is no longer waiting: it was decided, or its ticket moved on' }
    // The owner's files, staged by the right bar like a request's (C8): reference lines, added below the decision.
    const lines = files === undefined || files === null ? [] : Array.isArray(files) ? files.map(f => String(f).trim()) : [String(files)]
    if (lines.length > DECISION_FILES_MAX) return { ok: false, code: 'files', error: `a decision carries at most ${String(DECISION_FILES_MAX)} files` }
    const attached: DecisionFile[] = []
    for (const line of lines) {
      const ref = parseFileRef(line)
      if (ref === undefined) return { ok: false, code: 'files', error: 'each file must be an "[A2A file] v1 …" reference line' }
      attached.push({ sha256: ref.sha256, size: ref.size, name: ref.name, ref: line })
    }
    const words = typeof note === 'string' ? note.trim() : ''
    let chosen: string
    if (how === 'approve') {
      if (!oneClick(card.level) || card.recommended === '') return { ok: false, code: 'needs-choice', error: `a ${card.level} decision needs an option chosen, not one click` }
      chosen = card.recommended
    } else if (how === 'choose') {
      if (typeof option === 'string' && card.options.includes(option)) chosen = option
      else if (option === undefined || option === null || option === '') { if (words === '') return { ok: false, code: 'choice', error: 'choose an option, or write your decision' }; chosen = '' }
      else return { ok: false, code: 'choice', error: 'that is not one of the options' }
    } else return { ok: false, code: 'how', error: 'how must be approve or choose' }
    const answer = [...(chosen !== '' ? [`决定：${chosen}`] : []), ...(words !== '' ? [`说明：${words}`] : []), ...attached.map(file => file.ref)].join('\n')
    const withFiles = attached.length > 0 ? { files: attached } : {}
    const at = this.now()
    const { title: _title, ...stored } = card
    // A health reminder's decision is a dismissal: it opens no ticket and answers no question (reliability R7).
    if (card.source === 'health') {
      this.decisions.decide(card.id, { at, text: answer, ...withFiles }, stored)
      this.healthReminders.decided(card.id, chosen, Date.parse(at))
      return { ok: true }
    }
    // Design tool-requests T4: a tool request is applied to the team's grants, not ticketed.
    if (card.source === 'tool') {
      this.decisions.decide(card.id, { at, text: answer, ...withFiles }, stored)
      if (chosen.startsWith('批准')) this.grantTool(card.by)
      return { ok: true, granted: chosen.startsWith('批准') }
    }
    if (card.ticketId !== undefined) {
      const out = this.answer(card.ticketId, answer)
      if (!out.ok) return out
      this.decisions.decide(card.id, { at, text: answer, triggerId: out.triggerId, ...withFiles }, stored)
      return { ok: true, ticket_id: card.ticketId, trigger_id: out.triggerId }
    }
    const filed = this.request(`[决策卡]（${card.source === 'router' ? '总工' : '观察者'}提出）${card.question}\n${answer}`)
    if (!filed.ok) return { ok: false, code: 'refused', error: filed.error }
    this.decisions.decide(card.id, { at, text: answer, triggerId: filed.triggerId, ...withFiles }, stored)
    return { ok: true, trigger_id: filed.triggerId, thread: filed.thread }
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
    const pool = new Set([...now.members, ...now.remoteMembers.map(r => r.ref)])
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
      if (CLI_HANDLE_RE.test(member)) return `[superagent-team-canvas] ${canvas} is the superagent team's canvas: a CLI handle is a requester, not a member — it sends requests to the team's address instead`
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
    const now = this.settings
    const pool = new Set([...now.members, ...now.remoteMembers.map(r => r.ref)])
    const orphaned = this.executor.membersLeft(pool)
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
    if (decision !== undefined && typeof report.question === 'string') this.decisions.forTicket({ ticketId: ticket.id, by: member, question: report.question, spec: { level: decision.level, options: decision.options, recommended: decision.recommended }, at: this.now(), ...(decision.files !== undefined ? { files: decision.files } : {}) })
    this.relayReport(ticket.id, report.state, report.summary)
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
  private relayReport(ticketId: string, state: string, summary: string): void {
    const router = this.settingsValue.router, ticket = this.store.tickets.get(ticketId)
    if (router === undefined || ticket === undefined) return
    const stage = ticket.ended ? { stage: 'ended', outcome: ticket.ended.outcome } : ticketStage(ticket)
    const question = ticket.attention !== undefined ? `\nquestion for the person (send it with superagent_reply purpose attention, copied exactly): ${ticket.attention.question}` : ''
    // The owner asked for this in the router's own session, and reads the answer there: superagent_reply goes to the team page.
    const inChat = (state === 'ready' || state === 'failed' || state === 'dropped' || ticket.attention !== undefined) && ticket.origin.triggerIds.some(id => this.ruleChanges.filedFromChat(id))
      ? '\nThe owner asked for this in this session: besides superagent_reply, tell them here in plain words what came of it, or what you need from them.' : ''
    this.d.deliverToSession(router, `[superagent report] ticket ${ticket.id} «${ticket.title}» · ${state} · stage ${JSON.stringify(stage)}\n${clip(summary, 2_000)}${question}${inChat}`)
  }

  /** The team's A2A address: requests to it are Triggers, so they take no target queue slot. */
  get a2aAddress(): string | undefined { return this.settingsValue.sources.a2a ? this.a2a.address : undefined }

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

  /** One pass: expire or start due Evals, then deliver what waits for the router. */
  pass(): void {
    if (this.store.loadError !== undefined) return
    try { this.engine.evaluateDue() } catch (error) { this.d.logger.warn('superagent: evaluation pass failed: %s', String(error)) }
    this.flushCandidates()
    this.flushOutbox()
    // Upstream: evaluation, dispatch and outbound delivery hold while paused.
    if (this.settingsValue.paused) return
    this.executor.tick()
    this.prs.tick()
    this.issues.tick()
    this.receipts.tick()
  }

  /**
   * Whether `task` is an A2A request a still-open ticket was accepted from and no member report on the ticket is ready yet
   * (the A2A Source then sends a reply on it as a follow-up and keeps the formal receipt for the result).
   */
  private resultPending(ticketId: string, task: string): boolean {
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended) return false
    const fromTask = ticket.origin.triggerIds.some(id => this.store.triggers.get(id)?.channel?.address?.task === task)
    // A ticket that follows a pull request has its outcome when that ends; `ready` only hands it to a person.
    const following = (ticket.follows ?? []).some(f => !f.closed)
    return fromTask && (following || !ticket.assignments.some(a => a.report?.state === 'ready'))
  }

  private flushCandidates(): void {
    const router = this.settingsValue.router
    if (router === undefined || this.settingsValue.paused) return
    for (const [evalId, entry] of this.candidates) {
      if (entry.delivered) continue
      const open = this.store.tickets.list().filter(t => !t.ended)
      const requeued = new Set(entry.candidate.triggers.filter(t => this.store.triggers.disposition(t.id)?.requeued === true).map(t => t.id))
      if (!this.d.deliverToSession(router, candidateCard(entry.candidate, this.settingsValue, open, requeued, [...this.teamCardLines(), ...this.promptCardLines('communication')]))) return
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
  saveSettings(raw: unknown, sessionValid: (id: string) => boolean, presetOf: (id: string) => string | undefined = () => undefined, by = 'owner'): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
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
    this.writeSettings(parsed.settings)
    this.recordOwnerEdits(previous, parsed.settings)
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
    this.executor.launch()
    this.pass()
    return { ok: true, settings: this.settings }
  }

  /**
   * The owner answers a question on a ticket that did not start in the workbench: its requester is an agent, so nobody else
   * can (definition 找人: a question reaches a person). The answer is the owner's message on a new workbench Thread, routed
   * straight to the ticket as the router's attach does.
   */
  answer(ticketId: string, text: string): { ok: true; triggerId: string; thread: string } | { ok: false; code: string; error: string } {
    const body = text.trim()
    if (body === '' || body.length > 20_000) return { ok: false, code: 'text', error: 'text is required, at most 20000 characters' }
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined || ticket.ended !== undefined) return { ok: false, code: 'ticket', error: 'no open ticket has that id' }
    if (ticket.attention === undefined) return { ok: false, code: 'no-question', error: 'that ticket has no open question' }
    const trigger = this.workbenchTrigger(body)
    // Received and attached in one step, so the router never gets it as a candidate.
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
      actor: { source: 'workbench', id: via === undefined ? WORKBENCH_OWNER : via === 'cli' ? WORKBENCH_CLI : observerActor(via.observer) }, human: via === undefined, addressed: 'direct', at: this.now(), text: body,
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
  health(now = Date.now()): Array<{ code: string; session?: string; ticketId?: string; title?: string; minutes?: number }> {
    const out: Array<{ code: string; session?: string; ticketId?: string; title?: string; minutes?: number }> = []
    const loaded = this.d.sessionLoaded
    if (loaded === undefined || !this.teamBound()) return out
    const { router, members } = this.settings
    if (this.d.bootSettled?.() !== false) {
      if (router !== undefined && !loaded(router)) out.push({ code: 'router-not-loaded', session: router })
      for (const member of members) if (!loaded(member)) out.push({ code: 'member-not-loaded', session: member })
    }
    for (const binding of this.executor.list()) {
      const ticket = this.store.tickets.get(binding.ticketId)
      if (ticket === undefined || ticket.ended !== undefined || ticketStage(ticket).stage !== 'working') continue
      const minutes = Math.floor((now - Date.parse(ticket.updatedAt)) / 60_000)
      if (minutes >= QUIET_MINUTES) out.push({ code: 'ticket-quiet', ticketId: ticket.id, title: ticket.title, minutes })
    }
    return out
  }

  state(): Record<string, unknown> {
    const messages = this.store.messages.list()
    const repliesOf = (thread: string): StoredMessage[] => messages.filter(row => row.message.channel.source === 'workbench' && row.message.channel.thread === thread)
    return {
      health: this.health(),
      settings: this.settings,
      ...(this.canvasProblem() !== undefined ? { canvasProblem: this.canvasProblem() } : {}),
      ...(this.servesProblem() !== undefined ? { servesProblem: this.servesProblem() } : {}),
      canvases: [...(this.d.canvasNames?.() ?? [])],
      policyVersion: policyVersion(this.settingsValue),
      ruleChanges: this.ruleChanges.view(),
      a2a: { enabled: this.settingsValue.sources.a2a, address: this.a2a.address ?? null, health: this.a2a.health },
      refusals: { counts: Object.fromEntries(this.refusalCounts), recent: [...this.refusalRecent] },
      settingsHistory: this.settingsHistory.list(),
      modelResults: Object.fromEntries(this.modelResults),
      ...(this.prs.problem !== undefined ? { pullRequestProblem: this.prs.problem } : {}),
      ...(this.issues.problem !== undefined ? { githubIssuesProblem: this.issues.problem } : {}),
      reviews: this.reviews.list(),
      executor: { canvas: this.settingsValue.canvas ?? null, members: this.settings.members, remoteMembers: this.settings.remoteMembers, bindings: this.executor.list() },
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
      tickets: this.store.tickets.list().map(ticket => ({ ...ticket, stage: ticket.ended ? null : ticketStage(ticket) })),
    }
  }

  /** A ticket as the router reads it. */
  ticket(id: string): (Ticket & { stage: unknown }) | undefined {
    const ticket = this.store.tickets.get(id)
    return ticket === undefined ? undefined : { ...ticket, stage: ticket.ended ? null : ticketStage(ticket) }
  }
}
