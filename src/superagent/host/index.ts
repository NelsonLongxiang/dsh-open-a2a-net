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
import { Engine, ticketStage, type Assessor, type Candidate, type Outbox, type Ticket, type Trigger, type ReceiveResult } from '../upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories, type StoredMessage } from './store.ts'
import { A2aSource } from './a2a-source.ts'
import { MemberExecutor } from './executor.ts'
import type { ReportState } from '../upstream/dsh-superagent/src/core/index.ts'
import { DEFAULT_SETTINGS, WORKBENCH_OWNER, parseRemoteMember, parseSettings, parseStoredSettings, policyVersion, teamPolicy, teamScope, type TeamSettings } from './policy.ts'

export interface SuperagentHostDeps {
  /** The a2a home directory; state lives under `<home>/superagent/`. */
  readonly home: string
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  /** Put text into a live local session as a follow-up; false when the session is not live here. */
  readonly deliverToSession: (sessionId: string, text: string) => boolean
  /** A repeating timer; returns its disposer. */
  readonly interval: (fn: () => void, ms: number) => () => void
  readonly now?: () => string
  /** This host's own base URL for the team identity's CLI, once the web server listens. */
  readonly homeUrl?: () => string | undefined
  /** This host's API key (the CLI's control credential). */
  readonly apiKey?: () => string | undefined
  /**
   * PR-C2: a signed request to another a2a host (OriginClaim, body-bound, on this host's card key). Absent: no remote
   * members can be reached and no team can be served.
   */
  readonly signedPost?: (baseUrl: string, path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** A local session's `<zone>/<id8>` handle, and the local session a handle of this host names. */
  readonly handleOf?: (sessionId: string) => string
  readonly localSessionOf?: (handle: string) => string | undefined
  /** Tests shorten the A2A mailbox poll. */
  readonly a2aPollSeconds?: number
  /** Tests stub the CLI. */
  readonly runCli?: (args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<string>
}

/** How often due Evals are checked and undelivered candidates retried. */
export const PASS_MS = 5_000
const TEXT_CAP = 4_000

const clip = (text: string, cap = TEXT_CAP): string => (text.length > cap ? `${text.slice(0, cap)}… (${String(text.length - cap)} more characters)` : text)

/** The candidate card the router reads: bounded facts and the ids its decision names, never authority. */
export function candidateCard(candidate: Candidate, settings?: Pick<TeamSettings, 'acceptMode' | 'rules'>): string {
  const lines = [
    `[superagent candidate] eval ${candidate.evalId} · strength ${candidate.strength} · policy ${candidate.policyVersion}`,
    `thread ${candidate.thread.key}`,
    '',
    ...candidate.triggers.flatMap(t => [`trigger ${t.id} · ${t.actor.source}:${t.actor.id}${t.addressed !== undefined ? ` · addressed (${t.addressed})` : ''} · ${t.at}`, clip(t.text), '']),
  ]
  if (candidate.tickets.length > 0) {
    lines.push('tickets on this thread (open first):')
    for (const ticket of [...candidate.tickets].sort((a, b) => Number(!!a.ended) - Number(!!b.ended))) {
      lines.push(`- ${ticket.id} · ${ticket.title} · ${ticket.ended ? `ended ${ticket.ended.outcome}` : ticketStage(ticket).stage}`)
    }
    lines.push('')
  }
  if (candidate.strength === 'inferred' && settings !== undefined) {
    const enabled = settings.rules.filter(rule => rule.enabled)
    lines.push(`This candidate is inferred (not an explicit request; accept mode ${settings.acceptMode}). Judge it against every enabled rule once; accept only on matched rules${settings.acceptMode === 'observe' ? ' — observe mode records it as would-accept and accepts nothing' : ''}. Ignore it from the card when it plainly touches no rule.`)
    for (const rule of enabled) lines.push(`- rule ${rule.name}: ${clip(rule.text, 600)}`)
    if (enabled.length === 0) lines.push('- (no enabled rule: it can only be ignored)')
    lines.push('')
  }
  lines.push(`Decide with superagent_route, one item per candidate, by trigger_id: accept (one ticket for this request, with a title, a scope and an acknowledgement in the request's language — do not add an implementation plan), attach (to a listed ticket the message points at explicitly), stop (the person asked to stop that ticket) or ignore (with a reason).`)
  return lines.join('\n')
}

export class SuperagentHost {
  readonly store: JsonRepositories
  readonly engine: Engine
  private settingsValue: TeamSettings
  private readonly settingsPath: string
  /** Candidates waiting to reach the router, by evalId; delivered ones stay until the engine releases them. */
  private readonly candidates = new Map<string, { candidate: Candidate; delivered: boolean }>()
  private disposeTimer: (() => void) | undefined
  /** The A2A executor (PR-C1): the owner's fixed member pool, one worker slot each. */
  readonly executor: MemberExecutor
  /** The A2A Source (PR-B2b): the team's A2A address and its mailbox loop. */
  readonly a2a: A2aSource
  /** Outbox messages being sent right now, so a pass never sends one twice at once. */
  private readonly sending = new Set<string>()
  private started = false

  constructor(private readonly d: SuperagentHostDeps) {
    const dir = join(d.home, 'superagent')
    this.settingsPath = join(dir, 'settings.json')
    this.settingsValue = this.loadSettings()
    this.store = new JsonRepositories(join(dir, 'state.json'))
    const assessor: Assessor = {
      request: candidate => { this.candidates.set(candidate.evalId, { candidate, delivered: false }); queueMicrotask(() => this.flushCandidates()) },
      release: evalId => { this.candidates.delete(evalId) },
    }
    const executor = this.executor = new MemberExecutor({
      path: join(dir, 'executor.json'), members: () => [...this.settingsValue.members, ...this.settingsValue.remoteMembers.map(r => r.ref)],
      deliver: (member, text, kind, ticketId) => this.deliverToMember(member, text, kind, ticketId), engine: () => this.engine,
      ticket: id => this.store.tickets.get(id), trigger: id => this.store.triggers.get(id), logger: d.logger,
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
      receive: trigger => { const result = this.engine.receive(trigger as unknown as Trigger); queueMicrotask(() => this.pass()); return result },
      ticket: id => this.store.tickets.get(id) as never,
      logger: d.logger, ...(d.runCli !== undefined ? { run: d.runCli } : {}), ...(d.a2aPollSeconds !== undefined ? { pollSeconds: d.a2aPollSeconds } : {}),
    })
    this.engine = new Engine({
      repo: this.store,
      policy: () => teamPolicy(this.settingsValue),
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
    this.started = true
    this.syncA2a()
    this.pass()
  }

  stop(): Promise<void> { this.disposeTimer?.(); this.disposeTimer = undefined; this.started = false; return this.a2a.stop() }

  /** Run the A2A Source's mailbox loop exactly while its Source is on. */
  private syncA2a(): void {
    if (this.started && this.settingsValue.sources.a2a) this.a2a.start()
    else void this.a2a.stop()
  }

  /** Whether a local session is the router or a member (of this team, or of the team this host serves): no A2A work either way. */
  roleOf(sessionId: string): 'router' | 'member' | undefined {
    if (this.settingsValue.router === sessionId) return 'router'
    return this.settingsValue.members.includes(sessionId) || this.settingsValue.serves?.members.includes(sessionId) === true ? 'member' : undefined
  }

  /** A member's turn ended (agent idle): the executor's turn-end fact — told to the served team host when it is theirs. */
  memberIdle(sessionId: string): void {
    if (this.settingsValue.members.includes(sessionId)) { this.executor.memberIdle(sessionId); return }
    const serves = this.settingsValue.serves
    if (serves?.members.includes(sessionId) === true && this.d.signedPost !== undefined && this.d.handleOf !== undefined) {
      void this.d.signedPost(serves.url, '/a2a/superagent-team', { op: 'idle', member: this.d.handleOf(sessionId) })
        .catch(error => { this.d.logger.warn('superagent: turn end not told to the team host: %s', String(error)) })
    }
  }

  /** PR-C2: put a card into a member's session — local by host relay, remote by a signed request to its host. */
  private async deliverToMember(member: string, text: string, kind: 'assign' | 'input' | 'stop', ticketId: string): Promise<boolean> {
    const remote = this.settingsValue.remoteMembers.find(r => r.ref === member)
    if (remote === undefined) return this.d.deliverToSession(member, text)
    if (this.d.signedPost === undefined) return false
    const out = await this.d.signedPost(remote.url, '/a2a/superagent-member', { op: kind, member: remote.ref.replace(/@[0-9a-f]{8}$/, ''), ticket: ticketId, text })
    return out.ok === true
  }

  /**
   * PR-C2, team host side: a member host's signed report or turn end. It counts only when the signer's key is the key the
   * owner pinned for that member's ref (another instance sharing the zone and id8 has another key).
   */
  remoteEvent(op: unknown, memberHandle: unknown, signerKey: string, report: unknown): Record<string, unknown> {
    const entry = this.settingsValue.remoteMembers.find(r => r.ref.replace(/@[0-9a-f]{8}$/, '') === memberHandle && r.key === signerKey)
    if (entry === undefined) return { ok: false, code: 'not-member', error: 'no remote member of this team is that session under that key' }
    if (op === 'idle') { this.executor.memberIdle(entry.ref); return { ok: true } }
    if (op !== 'report') return { ok: false, code: 'op', error: 'op must be report or idle' }
    const r = (report ?? {}) as Record<string, unknown>
    if (typeof r.state !== 'string' || !['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'].includes(r.state) || typeof r.summary !== 'string' || r.summary.trim() === '') return { ok: false, code: 'report', error: 'a report needs a state and a summary' }
    return this.report(entry.ref, { state: r.state as ReportState, summary: r.summary, ...(typeof r.question === 'string' || r.question === null ? { question: r.question as string | null } : {}), ...(typeof r.answers === 'string' ? { answers: r.answers } : {}) })
  }

  /** PR-C2, member host side: work the served team host sends one of this host's member sessions, signed by its pinned key. */
  assignedWork(op: unknown, memberHandle: unknown, signerKey: string, text: unknown): Record<string, unknown> {
    const serves = this.settingsValue.serves
    if (serves === undefined || serves.key !== signerKey) return { ok: false, code: 'not-team', error: 'this host serves no team under that key' }
    const local = typeof memberHandle === 'string' ? this.d.localSessionOf?.(memberHandle) : undefined
    if (local === undefined || !serves.members.includes(local)) return { ok: false, code: 'not-member', error: 'that session does not serve this team' }
    if (op !== 'assign' && op !== 'input' && op !== 'stop') return { ok: false, code: 'op', error: 'op must be assign, input or stop' }
    if (typeof text !== 'string' || text === '') return { ok: false, code: 'text', error: 'text is required' }
    return { ok: this.d.deliverToSession(local, text) }
  }

  /** PR-C2, member host side: a served member's report goes to the team host (it answers whether it took it). */
  async forwardReport(member: string, report: { state: ReportState; summary: string; question?: string | null; answers?: string }): Promise<Record<string, unknown>> {
    const serves = this.settingsValue.serves
    if (serves === undefined || !serves.members.includes(member) || this.d.signedPost === undefined || this.d.handleOf === undefined) return { ok: false, code: 'not-member', error: 'this session serves no team' }
    try { return await this.d.signedPost(serves.url, '/a2a/superagent-team', { op: 'report', member: this.d.handleOf(member), report }) } catch (error) { return { ok: false, code: 'unreachable', error: String(error) } }
  }

  /** Owner control: pin a remote member (resolved from a linked peer's signed card by the caller). */
  addRemoteMember(member: { ref: string; key: string; url: string }): { ok: boolean; error?: string } {
    const parsed = parseRemoteMember(member)
    if (parsed === undefined) return { ok: false, error: 'a remote member needs a qualified ref, a key and a base URL' }
    const others = this.settingsValue.remoteMembers.filter(r => r.ref !== parsed.ref)
    if (others.length + this.settingsValue.members.length >= 32) return { ok: false, error: 'at most 32 members' }
    this.writeSettings({ ...this.settingsValue, remoteMembers: [...others, parsed] })
    this.executor.launch()
    return { ok: true }
  }
  removeRemoteMember(ref: string): { ok: boolean } {
    this.writeSettings({ ...this.settingsValue, remoteMembers: this.settingsValue.remoteMembers.filter(r => r.ref !== ref) })
    return { ok: true }
  }
  /** Owner control: serve a team host (its key pinned from a linked peer's signed card) with these local sessions. */
  serveTeam(team: { url: string; key: string } | undefined, members: readonly string[], sessionValid: (id: string) => boolean): { ok: boolean; error?: string } {
    if (team === undefined) { const { serves: _gone, ...rest } = this.settingsValue; this.writeSettings(rest); return { ok: true } }
    const bad = members.find(m => !sessionValid(m) || m === this.settingsValue.router || this.settingsValue.members.includes(m))
    if (bad !== undefined) return { ok: false, error: `${bad} must be a joined local session that is neither this team's router nor its member` }
    this.writeSettings({ ...this.settingsValue, serves: { url: team.url, key: team.key, members: [...new Set(members)] } })
    return { ok: true }
  }

  private writeSettings(next: TeamSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    const temporary = `${this.settingsPath}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.settingsPath) } finally { rmSync(temporary, { force: true }) }
    this.settingsValue = next
  }

  /**
   * A member's report (upstream orchestrator_report) on the ticket bound to it. The router hears it in its own session,
   * so it can hand a ready result or a question to the person (superagent_reply).
   */
  report(member: string, report: { state: ReportState; summary: string; question?: string | null; answers?: string }): { ok: true; ticketId: string; stage: unknown } | { ok: false; code: string; error: string } {
    const binding = this.executor.bindingOf(member)
    if (binding === undefined) return { ok: false, code: 'not-assigned', error: 'no ticket is assigned to this session' }
    let ticket: Ticket
    try { ticket = this.engine.report(binding.ticketId, report) } catch (error) { return { ok: false, code: 'refused', error: error instanceof Error ? error.message : String(error) } }
    const router = this.settingsValue.router
    const stage = ticket.ended ? { stage: 'ended', outcome: ticket.ended.outcome } : ticketStage(ticket)
    if (router !== undefined) {
      const question = ticket.attention !== undefined ? `\nquestion for the person (send it with superagent_reply purpose attention, copied exactly): ${ticket.attention.question}` : ''
      this.d.deliverToSession(router, `[superagent report] ticket ${ticket.id} «${ticket.title}» · ${report.state} · stage ${JSON.stringify(stage)}\n${clip(report.summary, 2_000)}${question}`)
    }
    this.pass()
    return { ok: true, ticketId: ticket.id, stage }
  }

  /** The team's A2A address: requests to it are Triggers, so they take no target queue slot. */
  get a2aAddress(): string | undefined { return this.settingsValue.sources.a2a ? this.a2a.address : undefined }

  /** Send pending a2a Channel messages; a thrown send stays pending for the next pass (a2a-watch gives up after 24h). */
  private flushOutbox(): void {
    for (const row of this.store.messages.list()) {
      if (row.status !== 'pending' || row.message.channel.source !== 'a2a' || this.sending.has(row.message.id)) continue
      if (this.settingsValue.paused || !this.a2a.allowed(row.message as never)) continue
      this.sending.add(row.message.id)
      void this.a2a.send(row.message as never).then(result => {
        this.store.atomic(() => {
          const now = this.store.messages.get(row.message.id)
          if (now === undefined || now.status !== 'pending') return
          this.store.messages.save(result === 'sent' ? { ...now, status: 'sent', sentAt: this.now() } : { ...now, status: 'dropped', droppedAt: this.now(), reason: 'gone' })
        })
      }, (error: unknown) => { this.d.logger.warn('superagent: a2a reply %s not sent yet: %s', row.message.id, String(error)) })
        .finally(() => { this.sending.delete(row.message.id) })
    }
  }

  /** One pass: expire or start due Evals, then deliver what waits for the router. */
  pass(): void {
    if (this.store.loadError !== undefined) return
    try { this.engine.evaluateDue() } catch (error) { this.d.logger.warn('superagent: evaluation pass failed: %s', String(error)) }
    this.flushCandidates()
    this.flushOutbox()
  }

  private flushCandidates(): void {
    const router = this.settingsValue.router
    if (router === undefined || this.settingsValue.paused) return
    for (const [evalId, entry] of this.candidates) {
      if (entry.delivered) continue
      if (!this.d.deliverToSession(router, candidateCard(entry.candidate, this.settingsValue))) return
      entry.delivered = true
      try { this.engine.candidateDelivered(evalId) } catch (error) { this.d.logger.warn('superagent: candidate %s delivered but not recorded: %s', evalId, String(error)) }
    }
  }

  get settings(): TeamSettings { return this.settingsValue }
  get routerSession(): string | undefined { return this.settingsValue.router }

  /** Owner control: replace the team settings; a Policy version change is reported to the engine as upstream does. */
  saveSettings(raw: unknown, sessionValid: (id: string) => boolean): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
    const parsed = parseSettings(raw, this.settingsValue)
    if (!parsed.ok) return parsed
    if (parsed.settings.router !== undefined && !sessionValid(parsed.settings.router)) return { ok: false, error: 'router must be a joined local session' }
    const strange = parsed.settings.members.find(member => !sessionValid(member))
    if (strange !== undefined) return { ok: false, error: `member ${strange} must be a joined local session` }
    const before = policyVersion(this.settingsValue)
    const routerChanged = parsed.settings.router !== this.settingsValue.router
    this.writeSettings(parsed.settings)
    const after = policyVersion(parsed.settings)
    if (before !== after) this.engine.policyChanged(before, after)
    // A new router receives whatever the old one had not decided yet.
    if (routerChanged) for (const entry of this.candidates.values()) entry.delivered = false
    this.d.logger.info('superagent: team settings saved (policy %s)', after)
    this.syncA2a()
    this.executor.launch()
    this.pass()
    return parsed
  }

  /** The workbench Source: the owner's message, as one Trigger on a new Thread or on the Thread it continues. */
  request(text: string, thread?: string): { ok: true; result: ReceiveResult; triggerId: string; thread: string } | { ok: false; error: string } {
    const body = text.trim()
    if (body === '') return { ok: false, error: 'text is required' }
    if (body.length > 20_000) return { ok: false, error: 'text is longer than 20000 characters' }
    if (thread !== undefined && !/^wb-[0-9a-f-]{36}$/.test(thread)) return { ok: false, error: 'thread must be a workbench thread id' }
    const threadId = thread ?? `wb-${randomUUID()}`
    const id = `wb-${randomUUID()}`
    const trigger: Trigger = {
      id, source: 'workbench', threads: [{ source: 'workbench', id: threadId }],
      actor: { source: 'workbench', id: WORKBENCH_OWNER }, human: true, addressed: 'direct', at: this.now(), text: body,
      channel: { source: 'workbench', thread: threadId, address: { trigger: id } }, meta: {},
    }
    try {
      const result = this.engine.receive(trigger)
      this.pass()
      return { ok: true, result, triggerId: id, thread: threadId }
    } catch (error) { return { ok: false, error: String(error) } }
  }

  /** The workbench's read: threads with their triggers, decisions and replies; tickets with their stage. */
  state(): Record<string, unknown> {
    const messages = this.store.messages.list()
    const repliesOf = (thread: string): StoredMessage[] => messages.filter(row => row.message.channel.source === 'workbench' && row.message.channel.thread === thread)
    return {
      settings: this.settingsValue,
      policyVersion: policyVersion(this.settingsValue),
      a2a: { enabled: this.settingsValue.sources.a2a, address: this.a2a.address ?? null, health: this.a2a.health },
      executor: { members: this.settingsValue.members, remoteMembers: this.settingsValue.remoteMembers, bindings: this.executor.list() },
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
