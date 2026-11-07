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
import { Engine, ticketStage, type Assessor, type Candidate, type Executor, type Outbox, type Ticket, type Trigger, type ReceiveResult } from '../upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories, type StoredMessage } from './store.ts'
import { DEFAULT_SETTINGS, WORKBENCH_OWNER, parseSettings, policyVersion, teamPolicy, teamScope, type TeamSettings } from './policy.ts'

export interface SuperagentHostDeps {
  /** The a2a home directory; state lives under `<home>/superagent/`. */
  readonly home: string
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  /** Put text into a live local session as a follow-up; false when the session is not live here. */
  readonly deliverToSession: (sessionId: string, text: string) => boolean
  /** A repeating timer; returns its disposer. */
  readonly interval: (fn: () => void, ms: number) => () => void
  readonly now?: () => string
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

  constructor(private readonly d: SuperagentHostDeps) {
    const dir = join(d.home, 'superagent')
    this.settingsPath = join(dir, 'settings.json')
    this.settingsValue = this.loadSettings()
    this.store = new JsonRepositories(join(dir, 'state.json'))
    const assessor: Assessor = {
      request: candidate => { this.candidates.set(candidate.evalId, { candidate, delivered: false }); queueMicrotask(() => this.flushCandidates()) },
      release: evalId => { this.candidates.delete(evalId) },
    }
    // PR-C replaces this placeholder with the A2A executor (fixed member pool, no new sessions).
    const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
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
      const parsed = parseSettings(JSON.parse(readFileSync(this.settingsPath, 'utf8')), DEFAULT_SETTINGS)
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
    this.disposeTimer = this.d.interval(() => this.pass(), PASS_MS)
    this.pass()
  }

  stop(): void { this.disposeTimer?.(); this.disposeTimer = undefined }

  /** One pass: expire or start due Evals, then deliver what waits for the router. */
  pass(): void {
    if (this.store.loadError !== undefined) return
    try { this.engine.evaluateDue() } catch (error) { this.d.logger.warn('superagent: evaluation pass failed: %s', String(error)) }
    this.flushCandidates()
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
  saveSettings(raw: unknown, routerValid: (id: string) => boolean): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
    const parsed = parseSettings(raw, this.settingsValue)
    if (!parsed.ok) return parsed
    if (parsed.settings.router !== undefined && !routerValid(parsed.settings.router)) return { ok: false, error: 'router must be a joined local session' }
    const before = policyVersion(this.settingsValue)
    const routerChanged = parsed.settings.router !== this.settingsValue.router
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    const temporary = `${this.settingsPath}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(parsed.settings), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.settingsPath) } finally { rmSync(temporary, { force: true }) }
    this.settingsValue = parsed.settings
    const after = policyVersion(parsed.settings)
    if (before !== after) this.engine.policyChanged(before, after)
    // A new router receives whatever the old one had not decided yet.
    if (routerChanged) for (const entry of this.candidates.values()) entry.delivered = false
    this.d.logger.info('superagent: team settings saved (policy %s)', after)
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
