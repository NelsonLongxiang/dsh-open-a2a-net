/**
 * The owner's hand on a seat's session (#951 S1): list the sessions, and put a line into a live one as a steer or a queued
 * follow-up. Pure of HTTP and of the audit file: the user routes (faces/user-sessions.ts) and #931's `a2a_user` both call
 * these, so there is one rule set. A caller first prepares (validation only, nothing written), then commits its audit
 * line, then delivers.
 *
 * What reaches the seat is marked twice: the host sets `source.kind = 'a2a-owner-proxy'` (the request body cannot say it),
 * and the text opens with a marker line naming the delegate. The marker is for the eye; a seat must go by the source.
 * The kind joins none of node-self's source sets, so a session that holds one has its `node_update_self` queued for review
 * instead of applied (fail closed: someone with a delegate cannot make the seat rewrite its own node prompt unreviewed).
 * It is not a person's message either (personMessageFrom looks at kind user), so the latest-person-message read ends at it.
 * @module @nelsonlongxiang/dsh-open-a2a-net/user-sessions
 */
import { createHash, randomUUID } from 'node:crypto'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_ID_SHAPE } from './session-log-page.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** An owner's delegate (or the owner at the control API) putting a line into a seat; set by the host only (#951). */
    'a2a-owner-proxy': { kind: 'a2a-owner-proxy'; delegateId?: string; delegateName: string; mode: 'steer' | 'queue' }
  }
}

/** The longest prompt, in Unicode code points. */
export const OWNER_PROMPT_TEXT_MAX = 8000
/** The prompt route's body limit in bytes: 8000 code points written as \uXXXX escapes (a Python client's default) or as emoji still fit. */
export const OWNER_PROMPT_BODY_MAX_BYTES = 100_000
/** How long and how many request ids the host remembers; in memory only (a restart forgets them). */
export const OWNER_PROMPT_IDEM_TTL_MS = 10 * 60_000
export const OWNER_PROMPT_IDEM_MAX = 256

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/

export type SeatRole = 'router' | 'observer' | 'member' | null

/** A refusal: one status and one code per case (the table in the #951 design, M3). */
export interface UserRefusal { readonly ok: false; readonly status: number; readonly code: string; readonly error: string }
const refuse = (status: number, code: string, error: string): UserRefusal => ({ ok: false, status, code, error })

/** The request ids seen lately: the key a request id was first used with, and what answered it. Only the host's memory. */
export class PromptIdempotency {
  private readonly rows = new Map<string, { key: string; at: number; response: Record<string, unknown> }>()
  constructor(private readonly now: () => number = Date.now) {}

  /** @returns the earlier answer for this request id, or undefined; a row older than the ttl is gone. */
  lookup(requestId: string): { key: string; response: Record<string, unknown> } | undefined {
    const row = this.rows.get(requestId)
    if (row === undefined) return undefined
    if (this.now() - row.at > OWNER_PROMPT_IDEM_TTL_MS) { this.rows.delete(requestId); return undefined }
    this.rows.delete(requestId); this.rows.set(requestId, row)
    return row
  }

  /** Remember a request id (its key and answer) before the line is delivered. */
  register(requestId: string, key: string, response: Record<string, unknown>): void {
    this.rows.delete(requestId)
    this.rows.set(requestId, { key, at: this.now(), response })
    while (this.rows.size > OWNER_PROMPT_IDEM_MAX) this.rows.delete(this.rows.keys().next().value as string)
  }

  /** Forget it again (the delivery threw, so a retry has to be possible). */
  revoke(requestId: string): void { this.rows.delete(requestId) }
}

/** What the prompt needs of a live session's agent. */
export interface PromptAgent { steer(message: UserMessage): void; followup(message: UserMessage): void }

/** What the session functions need of the host. */
export interface UserSessionsDeps {
  /** In the host's live session map. */
  live(id: string): boolean
  /** Registered as joined (live or cold). */
  joined(id: string): boolean
  archived(id: string): boolean
  agent(id: string): PromptAgent | undefined
  role(id: string): SeatRole
  /** Mark a live session as holding text from beyond this host (the relay lineage mark). */
  taint(id: string): void
  readonly idem: PromptIdempotency
}

/** Whether and how busy a live seat is: its status and the messages waiting in its inbox (best effort: undefined when the host hides them). */
export function seatState(agent: unknown): { status?: string; queued?: number } {
  const a = agent as { status?: unknown; inbox?: { nextTurn?: readonly unknown[]; nextStep?: readonly unknown[] } } | undefined
  let queued: number | undefined
  try { if (Array.isArray(a?.inbox?.nextTurn) && Array.isArray(a?.inbox?.nextStep)) queued = a.inbox.nextTurn.length + a.inbox.nextStep.length } catch { queued = undefined }
  let status: string | undefined
  try { status = typeof a?.status === 'string' ? a.status : undefined } catch { status = undefined }
  return { ...(status !== undefined ? { status } : {}), ...(queued !== undefined ? { queued } : {}) }
}

/** The marker line: who put this in, in what mode. Delegate names are the owner's own words; control characters and brackets are replaced. */
export function ownerPromptMarker(name: string, mode: 'steer' | 'queue'): string {
  return `[属主代输入 · ${name.replace(/[\u0000-\u001f\u007f\]\[]/g, ' ').trim().slice(0, 64)} · ${mode}]`
}

export interface OwnerPromptInput {
  readonly id: unknown
  readonly mode: unknown
  readonly text: unknown
  readonly requestId?: unknown
  /**
   * The calling session's taint: '' when clean. Required with no default, so a caller that forgets it does not compile; a
   * value that is not a string is read as tainted. The HTTP routes cannot see an outside caller's taint and pass '': that is the owner's
   * trust boundary (the owner at the browser, or a delegate the owner issued, counts as the owner typing).
   */
  readonly callerTaint: string
  /** Who was verified: the delegate record, or the browser owner (id null). */
  readonly delegate: { readonly id: string | null; readonly name: string }
}

export interface PreparedOwnerPrompt {
  readonly ok: true
  readonly replay?: undefined
  /** The audit fields of an accepted delivery. */
  readonly audit: Readonly<Record<string, unknown>>
  /** Deliver it. Call only after the audit line was written. */
  readonly deliver: () => { readonly ok: true; readonly response: Record<string, unknown> } | UserRefusal
}
export interface ReplayedOwnerPrompt { readonly ok: true; readonly replay: Record<string, unknown> }

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Check an owner prompt; write nothing. The cases, one status and code each: id spelled wrong 400 id; neither live nor
 * joined 404 unknown-session; archived 409 archived; live but not joined 409 not-joined; joined but not live 409 not-live;
 * mode 400 mode; text empty or not text 400 text; over 8000 code points 400 text-too-long; request id spelled wrong 400
 * request-id; the request id used before with other content 409 request-id-conflict; the same again is a replay.
 * @param deps - the host.
 * @param input - the request and who was verified.
 * @returns a refusal, a replay of the earlier answer, or the audit fields and the delivery to run after the audit is written.
 */
export function prepareOwnerPrompt(deps: UserSessionsDeps, input: OwnerPromptInput): UserRefusal | PreparedOwnerPrompt | ReplayedOwnerPrompt {
  const id = input.id
  if (typeof id !== 'string' || !SESSION_ID_SHAPE.test(id)) return refuse(400, 'id', 'id must be a session id (session-…)')
  const live = deps.live(id)
  const joined = deps.joined(id)
  if (!live && !joined) return refuse(404, 'unknown-session', 'no such session on this host')
  if (deps.archived(id)) return refuse(409, 'archived', 'the session is archived')
  if (live && !joined) return refuse(409, 'not-joined', 'the session is running but has not joined the network; a prompt goes only to joined sessions')
  if (!live) return refuse(409, 'not-live', 'the session is joined but not running; wake it first (a prompt does not start one)')
  const mode = input.mode
  if (mode !== 'steer' && mode !== 'queue') return refuse(400, 'mode', "mode must be 'steer' or 'queue'")
  const text = input.text
  if (typeof text !== 'string' || text.trim() === '') return refuse(400, 'text', 'text must be a non-empty string')
  const chars = [...text].length
  if (chars > OWNER_PROMPT_TEXT_MAX) return refuse(400, 'text-too-long', `text is at most ${String(OWNER_PROMPT_TEXT_MAX)} characters`)
  const requestId = input.requestId
  if (requestId !== undefined && (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))) return refuse(400, 'request-id', 'request_id must be 1 to 64 of letters, digits, . _ : -')
  const digest = sha256(text)
  const key = sha256(JSON.stringify([input.delegate.id ?? 'browser-owner', id, mode, digest]))
  if (typeof requestId === 'string') {
    const earlier = deps.idem.lookup(requestId)
    if (earlier !== undefined) return earlier.key === key ? { ok: true, replay: { ...earlier.response, replayed: true } } : refuse(409, 'request-id-conflict', 'this request_id was used for different content')
  }
  const seat = seatState(deps.agent(id))
  const response: Record<string, unknown> = {
    ok: true, id, mode, delivered: mode === 'steer' ? 'steered' : 'queued', role: deps.role(id),
    ...seat, ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
  }
  const audit = { action: `prompt-${mode}`, target: id, phase: 'accepted', chars, bytes: Buffer.byteLength(text, 'utf8'), sha256: digest, ...(typeof requestId === 'string' ? { request_id: requestId } : {}) }
  const deliver = (): { ok: true; response: Record<string, unknown> } | UserRefusal => {
    const agent = deps.agent(id)
    if (agent === undefined) return refuse(409, 'not-live', 'the session stopped before the line was delivered')
    const message: UserMessage = {
      id: MessageId(`a2a-owner-proxy-${randomUUID()}`), role: 'user',
      content: [{ type: 'text', text: `${ownerPromptMarker(input.delegate.name, mode)}\n${text}` }],
      source: { kind: 'a2a-owner-proxy', delegateName: input.delegate.name, ...(input.delegate.id !== null ? { delegateId: input.delegate.id } : {}), mode },
    }
    // Registered after the audit line and before the delivery, in one synchronous stretch: a concurrent retry sees it, a throw below undoes it.
    if (typeof requestId === 'string') deps.idem.register(requestId, key, response)
    try {
      if (typeof input.callerTaint !== 'string' || input.callerTaint !== '') deps.taint(id)
      if (mode === 'steer') agent.steer(message); else agent.followup(message)
    } catch (error) {
      if (typeof requestId === 'string') deps.idem.revoke(requestId)
      return refuse(500, 'deliver-failed', `delivery failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { ok: true, response }
  }
  return { ok: true, audit, deliver }
}

/** One row of the session list. */
export interface UserSessionRow {
  readonly id: string
  readonly name: string
  readonly team: string | null
  readonly joined: boolean
  readonly live: boolean
  readonly archived: boolean
  readonly role: SeatRole
  readonly status?: string
  readonly queued?: number
  readonly mtimeMs?: number
}

/** What the list needs beyond UserSessionsDeps. */
export interface UserSessionListDeps extends UserSessionsDeps {
  /** Every session the host knows as live or joined. */
  ids(): readonly string[]
  name(id: string): string
  team(id: string): string | null
  /** Last write of the session's log, when it has one. */
  mtimeMs(id: string): number | undefined
}

/** The most rows a list returns. */
export const USER_SESSIONS_MAX = 200

/**
 * The sessions of this host the owner may read or prompt, newest log first.
 * @param deps - the host.
 * @param filter - keep only one canvas team's sessions.
 * @returns the rows and whether the list was cut.
 */
export function listUserSessions(deps: UserSessionListDeps, filter: { team?: string } = {}): { sessions: UserSessionRow[]; truncated: boolean } {
  const rows: UserSessionRow[] = []
  for (const id of deps.ids()) {
    const team = deps.team(id)
    if (filter.team !== undefined && team !== filter.team) continue
    const live = deps.live(id)
    const mtimeMs = deps.mtimeMs(id)
    rows.push({
      id, name: deps.name(id), team, joined: deps.joined(id), live, archived: deps.archived(id), role: deps.role(id),
      ...(live ? seatState(deps.agent(id)) : {}), ...(mtimeMs !== undefined ? { mtimeMs } : {}),
    })
  }
  rows.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || a.id.localeCompare(b.id))
  return { sessions: rows.slice(0, USER_SESSIONS_MAX), truncated: rows.length > USER_SESSIONS_MAX }
}
