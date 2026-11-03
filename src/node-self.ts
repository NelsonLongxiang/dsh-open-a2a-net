/**
 * Node self-update (docs/design/node-identity.md §6; slice N4): the
 * `node_update_self` tool a session carrying a node may call to write ONE
 * section of its node's mutable layer, and the human review queue.
 *
 * - Only bound sessions get the tool (it is registered with the node's
 *   sections at mount). Its parameters cannot name, role, team or touch the
 *   core layer: one of the four mutable sections, text, reason, CAS sha.
 * - Session-level taint (§6, H2; owner ruling 2026-11-03 「会话级污染」, which
 *   reads §9's `via != host-face` as "this session has received input from
 *   outside this host"): once a session has, every self-update it makes is
 *   parked in the review queue, where a human approves or rejects it through
 *   the apiKey-gated nodes face. Either of two signals taints:
 *   1. the host marks the session when it DELIVERS remote content into it
 *      (every relay steer and the queue-mode nudge — {@link SessionTaint});
 *      the mark is persisted and never cleared;
 *   2. a scan of the session's whole event log (fail-closed backstop): an
 *      `a2a-relay` message that is not a host-built node reminder, a `user`
 *      message whose controller rpcId starts with `a2a-` (this plugin's
 *      nudge), or any source kind not known here. Context the agent loop
 *      injects (runtime/time/skill/tool-job notices…) is neutral.
 *   3. this plugin's own A2A tools that hand the model peer-originated text
 *      (any route answer — a reply or an error —, inbound task briefs, peer
 *      card rows — {@link toolTaint}) mark the calling session when they return.
 *   Messages that carry ANOTHER session's text (a subagent's closing message,
 *   a peer agent's message, a referenced transcript) take that session's
 *   taint, so a subagent that talked to a peer cannot launder its reply.
 *   Only remote EVIDENCE is persisted (a relay, a nudge, a tainted other
 *   session, an A2A tool read); an unknown source, an unknown sender or a log
 *   with no person's input refuses this one call (fail-closed) without
 *   marking, so a host feature this module does not know yet never taints a
 *   session forever.
 *   The boundary, stated honestly: remote text the model reads through
 *   general tools (a fetched page, an issue body) is not a delivery and does
 *   not taint; nor can a `kind:'user'` prompt another plugin submits through
 *   the session controller be told apart from a person (only this plugin's
 *   nudge, rpcId `a2a-*`, is recognised).
 * - Daily cap: at most {@link SELF_UPDATE_DAILY_MAX} node writes per node
 *   per UTC day; beyond that the call is refused (not queued).
 * - Each write freezes a full mutable version through the store (quota,
 *   CAS, max+1), attributed `by: node:<session>`, `via: node-tool`; the
 *   session's frozen prompt does not change — the write is echoed in a live
 *   runtime context instead (§5).
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-self
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MUTABLE_SECTIONS, QUOTA, type NodeResult, type NodeStore, type PromptVersion } from './node-store.ts'

export const SELF_UPDATE_DAILY_MAX = 8
/** Queued writes awaiting a human, across all nodes. */
export const REVIEW_QUEUE_MAX = 64
/** Queued writes per node: a tainted session cannot crowd out every other node's items. */
export const REVIEW_PER_NODE_MAX = 8

/** Input from a person at this host (UI or controller RPC); an `a2a-` rpcId is this plugin's nudge, not a person. */
const LOCAL_SOURCES: ReadonlySet<string> = new Set(['user'])
/**
 * Messages the harness or agent loop injects on its own: they neither prove a person nor carry a
 * delivery, so they neither count as input nor taint (projections of state already on this host).
 */
const NEUTRAL_SOURCES: ReadonlySet<string> = new Set([
  'runtime-context', 'time-context', 'skill-catalog', 'tool-jobs', 'user-approval', 'model-selection', 'tool-registry', 'ptc-mode', 'system-prompt',
  // Host features of a long-running session: compaction (its own history), a person's /skill, schedules, goals.
  'compact-checkpoint', 'skill-invocation', 'schedule', 'goal',
])
/**
 * Messages that carry ANOTHER session's text into this one, and where the field naming that session
 * sits: a subagent's closing message, a peer agent's message, a referenced transcript. Their taint is
 * the other session's: see {@link sessionSource}.
 */
const DERIVED_SOURCES: Readonly<Record<string, 'senderSessionId' | 'sessionId'>> = {
  'subagent-settled': 'senderSessionId',
  'agent-message': 'senderSessionId',
  'session-reference': 'sessionId',
}

/** This plugin's A2A tools that hand the model peer-originated text ({@link toolTaint}). */
const A2A_READ_TOOLS: ReadonlySet<string> = new Set(['a2a_route', 'a2a_tasks', 'a2a_teams', 'a2a_status', 'a2a_probe'])

/** What the log scan may ask about OTHER sessions. */
export interface SessionLookups {
  /** Whether that session is marked tainted. */
  readonly tainted: (session: string) => boolean
  /** Whether that id is a session of this host the plugin knows (a live or joined root). */
  readonly local: (session: string) => boolean
}

/** Host-only marker routeTrunk puts on a route result it built from this host alone (a symbol: no peer JSON can carry it). */
export const LOCAL_ROUTE: unique symbol = Symbol('a2a.localRoute')
/** Mark a route result as built on this host alone (host refusals, host-built delivery notes, a clean local session's reply). */
export function localRoute<T extends object>(value: T): T { return Object.assign(value, { [LOCAL_ROUTE]: true }) }

/**
 * gh#198 (owner ruling 2026-11-03 「按建议判据做」): whether one of this plugin's A2A tools just handed the
 * model content that came from outside this host — a route that reached (or tried) a peer, inbound task
 * rows, a directory row that is not this host's, a status/probe that names peers. A result built from
 * this host's own facts alone is not remote. `a2a_route` reads the host-written `peer_content` flag the
 * tool sets last (so a peer reply cannot set it); anything else defaults to remote.
 */
export function peerContentOf(name: string, value: unknown): boolean {
  const v = value as { peer_content?: unknown; tasks?: unknown; archive?: unknown; teams?: unknown; peers?: unknown; inFlight?: unknown; activity?: unknown; results?: unknown } | null
  if (v === null || typeof v !== 'object') return false
  const rows = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
  const remotePeer = (row: unknown): boolean => (row as { peer?: unknown } | null)?.peer !== 'local'
  if (name === 'a2a_route') return v.peer_content !== false
  if (name === 'a2a_tasks') return rows(v.tasks).length > 0 || rows(v.archive).length > 0
  if (name === 'a2a_teams') return rows(v.teams).some(row => (row as { local?: unknown } | null)?.local !== true)
  if (name === 'a2a_status') return rows(v.peers).length > 0 || rows(v.inFlight).some(remotePeer) || rows(v.activity).some(remotePeer)
  if (name === 'a2a_probe') return rows(v.results).length > 0
  return false
}

/**
 * The via to mark the calling session with after one of the A2A tools returned, or '' when its result
 * carries nothing from outside this host ({@link peerContentOf}).
 */
export function toolTaint(name: string, value: unknown): string {
  return A2A_READ_TOOLS.has(name) && peerContentOf(name, value) ? name.replace('_', '-') : ''
}

/** The `tool/result` meta the A2A tools persist, so the log backstop reads the same verdict ({@link sessionSource}). */
export const peerContentMeta = (name: string) => (_args: unknown, value: unknown): { a2aPeerContent: boolean } => ({ a2aPeerContent: peerContentOf(name, value) })

/**
 * The event-log backstop of the session taint: whether ANY input in the session's log came from
 * outside this host. A node reminder is local only when the HOST built it (`nodeReminder: true` on an
 * `a2a-relay` source — remote deliveries are relayed by this host with a fixed source shape, so a
 * remote caller cannot set that field). A session with no person's input at all is not local either.
 */
export function sessionSource(events: readonly unknown[], others: SessionLookups = { tainted: () => false, local: () => false }): { local: true } | { local: false; via: string; evidence: boolean } {
  let inputs = 0
  // gh#198: a top-level A2A call whose persisted result says (host-written meta, not an error) that it
  // carried nothing from outside this host is not evidence. A run_code sub-dispatch has no meta, and an
  // older log has none either: both stay evidence.
  const localCalls = new Set<unknown>()
  for (const event of events) {
    const r = event as { type?: unknown; data?: { message?: { toolCallId?: unknown; isError?: unknown }; meta?: { a2aPeerContent?: unknown } } } | null
    if (r?.type === 'tool/result' && r.data?.meta?.a2aPeerContent === false && r.data.message?.isError !== true) localCalls.add(r.data.message?.toolCallId)
  }
  for (const event of events) {
    const e = event as { type?: unknown; data?: { name?: unknown; callId?: unknown; source?: { kind?: unknown; nodeReminder?: unknown; localSender?: unknown; rpcId?: unknown; senderSessionId?: unknown; sessionId?: unknown; references?: unknown } } } | null
    // An A2A tool call in the log (native or a run_code sub-dispatch) is remote evidence: it survives into a
    // fork's inherited prefix, and backs up a mark that was lost.
    if ((e?.type === 'tool/call' || e?.type === 'tool/ptc-dispatch') && typeof e.data?.name === 'string' && A2A_READ_TOOLS.has(e.data.name)) {
      if (e.type === 'tool/call' && e.data.callId !== undefined && localCalls.has(e.data.callId)) continue
      return { local: false, via: `tool:${e.data.name}`, evidence: true }
    }
    if (e?.type !== 'user/message') continue
    const source = e.data?.source
    const kind = source?.kind
    if (typeof kind !== 'string') return { local: false, via: 'unknown', evidence: false }
    if (NEUTRAL_SOURCES.has(kind)) continue
    if (kind === 'a2a-relay' && source?.nodeReminder === true) continue
    // gh#198: an in-process delivery the HOST stamped with its local sender takes that session's taint
    // (a remote delivery never carries the field: the host builds every relay source itself).
    if (kind === 'a2a-relay' && typeof source?.localSender === 'string' && source.localSender !== '') {
      if (others.tainted(source.localSender)) return { local: false, via: 'a2a-relay:tainted', evidence: true }
      if (!others.local(source.localSender)) return { local: false, via: 'a2a-relay:unknown-sender', evidence: false }
      continue
    }
    if (kind === 'a2a-relay') return { local: false, via: kind, evidence: true }
    if (kind === 'user' && typeof source?.rpcId === 'string' && source.rpcId.startsWith('a2a-')) return { local: false, via: 'a2a-nudge', evidence: true }
    const field = DERIVED_SOURCES[kind]
    if (field !== undefined) {
      // Another session's text: its taint becomes ours (persisted); a clean one is neutral. A subagent is
      // always this host's; a peer agent or a reference must be a session this host knows, else this
      // call is refused (a native-teams bridge could name a remote caller here).
      // A session reference names its sessions in references[].sessionId (the installed shape); the others name one.
      const named = kind === 'session-reference' && Array.isArray(source?.references)
        ? (source.references as Array<{ sessionId?: unknown } | null>).map(r => r?.sessionId)
        : [source?.[field]]
      if (named.length === 0 || named.some(id => typeof id !== 'string' || id === '')) return { local: false, via: `${kind}:no-sender`, evidence: false }
      if ((named as string[]).some(id => others.tainted(id))) return { local: false, via: `${kind}:tainted`, evidence: true }
      if (kind !== 'subagent-settled' && !(named as string[]).every(id => others.local(id))) return { local: false, via: `${kind}:unknown-sender`, evidence: false }
      continue
    }
    if (!LOCAL_SOURCES.has(kind)) return { local: false, via: kind, evidence: false }
    inputs++
  }
  return inputs > 0 ? { local: true } : { local: false, via: 'no-input', evidence: false }
}

/** Sessions remembered as tainted; the oldest beyond this are forgotten (a forgotten one re-taints from its log or next delivery). */
export const TAINT_CAP = 4096

/**
 * The persisted half of the session taint (`node-taint.json`): the host marks a session the moment it
 * delivers remote content into it, and the mark is never cleared. A file that does not parse is kept
 * in place and read-only, and then EVERY session reads as tainted (fail-closed).
 */
export class SessionTaint {
  private rows: Array<{ session: string; via: string; at: string }> = []
  private readOnlyReason = ''

  constructor(private readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.restore()
  }

  private get file(): string { return join(this.root, 'node-taint.json') }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')) } catch { raw = undefined }
    const list = (raw as { sessions?: unknown } | null | undefined)?.sessions
    if (!Array.isArray(list)) {
      const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
      try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
      this.readOnlyReason = `node-taint.json is unreadable (copy kept at ${aside}); every session reads as tainted until it is repaired`
      return
    }
    for (const r of list as Array<{ session?: unknown; via?: unknown; at?: unknown } | null>) {
      // A row that is not a mark means the file was edited or damaged: fail closed, as for an unreadable file.
      if (r === null || typeof r !== 'object' || typeof r.session !== 'string' || r.session === '' || typeof r.via !== 'string') {
        const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
        try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
        this.readOnlyReason = `node-taint.json has a malformed row (copy kept at ${aside}); every session reads as tainted until it is repaired`
        this.rows = []
        return
      }
      if (!this.rows.some(x => x.session === r.session)) this.rows.push({ session: r.session, via: r.via, at: typeof r.at === 'string' ? r.at : '' })
    }
  }

  get readOnly(): string { return this.readOnlyReason }

  /** Why a session is tainted ('' = it is not). Fail-closed while the file is unreadable. */
  of(session: string): string {
    if (this.readOnlyReason !== '') return 'taint-store-unreadable'
    return this.rows.find(r => r.session === session)?.via ?? ''
  }

  /** Mark a session (idempotent). Never throws; a mark that cannot be written still holds in memory. */
  mark(session: string, via: string): void {
    if (session === '' || this.of(session) !== '') return
    this.rows = [...this.rows, { session, via: via === '' ? 'delivery' : via, at: this.now() }].slice(-TAINT_CAP)
    if (this.root === '' || this.readOnlyReason !== '') return
    try {
      mkdirSync(this.root, { recursive: true })
      const tmp = `${this.file}.${String(process.pid)}.tmp`
      writeFileSync(tmp, JSON.stringify({ sessions: this.rows }), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch { /* memory still holds it for this process; the log backstop covers a restart */ }
  }
}

export interface ReviewItem {
  readonly id: string
  readonly node: string
  readonly section: string
  readonly text: string
  readonly reason: string
  readonly expected_sha256: string
  readonly session: string
  /** Why it was parked: the remote source kind of the turn. */
  readonly via: string
  readonly at: string
}

const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'quota' | 'unavailable', error: string): NodeResult<T> => ({ ok: false, code, error })

function itemOf(raw: unknown): ReviewItem | undefined {
  const r = raw as Partial<ReviewItem> | null
  if (r === null || typeof r !== 'object') return undefined
  const keys = ['id', 'node', 'section', 'text', 'reason', 'expected_sha256', 'session', 'via', 'at'] as const
  if (!keys.every(k => typeof r[k] === 'string')) return undefined
  if (!(MUTABLE_SECTIONS as readonly string[]).includes(r.section as string)) return undefined
  return r as ReviewItem
}

/** The human review queue for remote-turn self-updates (`node-review.json`; corrupt = kept in place, read-only). */
export class NodeReviewQueue {
  private items: ReviewItem[] = []
  private readOnlyReason = ''

  constructor(private readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.restore()
  }

  private get file(): string { return join(this.root, 'node-review.json') }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')) } catch { raw = undefined }
    const list = (raw as { items?: unknown } | null | undefined)?.items
    if (!Array.isArray(list)) {
      const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
      try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
      this.readOnlyReason = `node-review.json is unreadable (copy kept at ${aside}); repair it, then restart`
      return
    }
    for (const raw of list) {
      const item = itemOf(raw)
      if (item !== undefined && !this.items.some(i => i.id === item.id)) this.items.push(item)
    }
  }

  private commit(items: ReviewItem[]): NodeResult<true> {
    if (this.readOnlyReason !== '') return fail('unavailable', `the review queue is read-only: ${this.readOnlyReason}`)
    if (this.root !== '') {
      try {
        mkdirSync(this.root, { recursive: true })
        const tmp = `${this.file}.${String(process.pid)}.tmp`
        writeFileSync(tmp, JSON.stringify({ items }), { mode: 0o600 })
        renameSync(tmp, this.file)
      } catch (error) {
        return fail('unavailable', `could not persist node-review.json: ${String(error)}`)
      }
    }
    this.items = items
    return { ok: true, value: true }
  }

  get readOnly(): string { return this.readOnlyReason }
  list(node?: string): readonly ReviewItem[] { return node === undefined ? this.items : this.items.filter(i => i.node === node) }
  get(id: string): ReviewItem | undefined { return this.items.find(i => i.id === id) }

  /**
   * Queue one write. A newer proposal for the same node, section and session REPLACES the older one
   * (the human reviews the latest wish, not a backlog of drafts); the text must fit the section quota;
   * each node holds at most {@link REVIEW_PER_NODE_MAX} items and the queue {@link REVIEW_QUEUE_MAX}.
   */
  add(input: Omit<ReviewItem, 'id' | 'at'>): NodeResult<ReviewItem> {
    if ([...input.text].length > QUOTA.mutableSection) return fail('quota', `section text exceeds ${String(QUOTA.mutableSection)} characters`)
    const rest = this.items.filter(i => !(i.node === input.node && i.section === input.section && i.session === input.session))
    if (rest.filter(i => i.node === input.node).length >= REVIEW_PER_NODE_MAX) return fail('quota', `node ${input.node} already has ${String(REVIEW_PER_NODE_MAX)} writes waiting for review — a human must clear them first`)
    if (rest.length >= REVIEW_QUEUE_MAX) return fail('quota', `the review queue is full (${String(REVIEW_QUEUE_MAX)} items) — a human must clear it first`)
    const item: ReviewItem = { ...input, id: `rv-${randomBytes(6).toString('hex')}`, at: this.now() }
    const done = this.commit([...rest, item])
    return done.ok ? { ok: true, value: item } : done
  }

  remove(id: string): NodeResult<true> {
    if (this.get(id) === undefined) return fail('not-found', `no review item ${id}`)
    return this.commit(this.items.filter(i => i.id !== id))
  }

  /** A node archived: its pending items go with it. */
  dropNode(node: string): void {
    if (this.items.some(i => i.node === node)) this.commit(this.items.filter(i => i.node !== node))
  }
}

/** Node writes (`by: node:…`) frozen for `node` on the UTC day of `now`. */
export function nodeWritesToday(store: NodeStore, node: string, now: string): number {
  const day = now.slice(0, 10)
  let n = 0
  for (const version of store.versions(node, 'mutable')) {
    const v = store.version(node, 'mutable', version)
    if (v !== undefined && typeof v.by === 'string' && v.by.startsWith('node:') && typeof v.at === 'string' && v.at.slice(0, 10) === day) n++
  }
  return n
}

export interface SelfUpdateDeps {
  readonly store: NodeStore
  readonly queue: NodeReviewQueue
  /** The persisted session taint (marked at remote deliveries). */
  readonly taint: SessionTaint
  /** The calling session's event log (the taint's fail-closed backstop). */
  readonly events: (agent: unknown) => readonly unknown[]
  /** Whether an id is a session of this host the plugin knows (for messages naming another session). */
  readonly localSession?: (session: string) => boolean
  readonly now?: () => string
  /** A write went through (the binder echoes it in the session's live context). */
  readonly onWritten: (session: string, version: PromptVersion, section: string) => void
}

export type SelfUpdateResult =
  | { ok: true; version: number; sha256: string }
  | { ok: false; error: string; queued?: string; code?: string; current_sha256?: string }

/** One self-update call, decided. Pure over its deps (the tool below only adapts it). */
export function selfUpdate(d: SelfUpdateDeps, node: string, session: string, agent: unknown, args: Record<string, unknown>): SelfUpdateResult {
  const section = typeof args.section === 'string' ? args.section : ''
  if (!(MUTABLE_SECTIONS as readonly string[]).includes(section)) return { ok: false, code: 'bad-request', error: `section must be one of ${MUTABLE_SECTIONS.join(' / ')}` }
  if (typeof args.text !== 'string') return { ok: false, code: 'bad-request', error: 'text must be a string' }
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  if (reason === '') return { ok: false, code: 'bad-request', error: 'reason is required' }
  const expected = typeof args.expected_sha256 === 'string' ? args.expected_sha256 : ''
  // The CAS sha the model needs: every refusal hands back the layer's current one.
  const current = d.store.get(node)?.prompt.mutable_sha256 ?? ''
  const marked = d.taint.of(session)
  const logged = marked === '' ? sessionSource(d.events(agent), { tainted: id => d.taint.of(id) !== '', local: id => d.localSession?.(id) === true }) : undefined
  // Only remote evidence is persisted; an unknown source or no person's input refuses this call alone.
  if (logged !== undefined && !logged.local && logged.evidence) d.taint.mark(session, `log:${logged.via}`)
  const via = marked !== '' ? marked : logged !== undefined && !logged.local ? `log:${logged.via}` : ''
  if (via !== '') {
    const parked = d.queue.add({ node, section, text: args.text, reason, expected_sha256: expected, session, via })
    if (!parked.ok) return { ok: false, code: parked.code, current_sha256: current, error: `this session has received input from outside this host (${via}); the write could not be queued for review: ${parked.error}` }
    return { ok: false, code: 'queued', queued: parked.value.id, current_sha256: current, error: `this session has received input from outside this host (${via}), so the write was NOT applied: it waits for a human in the review queue (${parked.value.id})` }
  }
  const now = (d.now ?? (() => new Date().toISOString()))()
  if (nodeWritesToday(d.store, node, now) >= SELF_UPDATE_DAILY_MAX) return { ok: false, code: 'quota', current_sha256: current, error: `daily self-update cap reached (${String(SELF_UPDATE_DAILY_MAX)} per node per UTC day)` }
  const written = d.store.writeLayer(node, 'mutable', { [section]: args.text }, { expectedSha: expected, reason, by: `node:${session}`, via: 'node-tool' })
  if (!written.ok) return { ok: false, code: written.code, current_sha256: current, error: written.error }
  d.onWritten(session, written.value, section)
  return { ok: true, version: written.value.version, sha256: written.value.sha256 }
}

/** The tool registered on a bound session's own scope. */
export function selfUpdateTool(d: SelfUpdateDeps, node: string, session: string) {
  return defineTool({
    name: 'node_update_self',
    description:
      `Update one section of YOUR node's self-notes (node "${node}", the 节点自记 layer): 当前状态 / 执行要点 / 已知陷阱 / 当前重点. `
      + `Give the FULL new text of that section (≤${String(QUOTA.mutableSection)} characters), a reason, and the sha256 of the mutable layer you read `
      + '(the CAS guard: the a2a:node:self context shows the current one, and every reply of this tool returns current_sha256). '
      + 'The new version takes effect from your next session; this session sees it as a runtime note. You cannot change your name, role, team or '
      + 'the 节点契约. Once this session has received input from outside this host (an A2A delivery), no write is applied — each is queued for a '
      + `human to approve. At most ${String(SELF_UPDATE_DAILY_MAX)} writes per node per day.`,
    parameters: {
      section: { type: 'string', required: true, enum: [...MUTABLE_SECTIONS], description: 'Which section to replace.' },
      text: { type: 'string', required: true, description: 'The full new text of that section.' },
      reason: { type: 'string', required: true, description: 'Why (recorded with the version).' },
      expected_sha256: { type: 'string', required: true, description: 'The current mutable layer sha256 ("" if the layer has no version yet).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          version: { type: 'number' },
          sha256: { type: 'string' },
          queued: { type: 'string', description: 'Review item id when the write was parked for a human.' },
          current_sha256: { type: 'string', description: 'The mutable layer sha to pass as expected_sha256 next time.' },
          code: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === true
          ? `节点自记已写入 v${String(value.version)}（sha256 ${String(value.sha256)}）`
          : `未写入：${String(value.error)}${typeof value.current_sha256 === 'string' ? `（当前 sha256 ${value.current_sha256}）` : ''}`,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'Node self-update', kind: 'other', rawInput: null }),
    execute: async (args, exec): Promise<SelfUpdateResult> => selfUpdate(d, node, session, (exec as { agent?: unknown } | undefined)?.agent, args as Record<string, unknown>),
  })
}
