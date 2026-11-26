/**
 * The user scope's session routes (#951 S1): list the sessions, read one page of a transcript, put a line into a live seat.
 * All three need the control key AND the owner: an owner delegate (X-DSH-Owner-Delegate) or the browser login. A caller with
 * only the control key is refused 401, a bad, revoked or expired delegate 403. Nothing is written to the audit file for a
 * request that was refused for its content; an accepted one writes one line (action, target, sizes, digest, never the text)
 * before it is served or delivered, and an audit that cannot be written refuses it 503.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/user-sessions
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import { browserOwnerProof, type DeferredOwnerProof } from '../superagent/host/owner-proof.ts'
import { readSessionPage, SESSION_ID_SHAPE, TranscriptCache } from '../session-log-page.ts'
import { TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_ENTRY_TEXT_CAP, TRANSCRIPT_MAX_LIMIT, TRANSCRIPT_PAGE_CHARS_MAX } from '../session-transcript.ts'
import { listUserSessions, OWNER_PROMPT_BODY_MAX_BYTES, PromptIdempotency, prepareOwnerPrompt, type PromptAgent, type SeatRole } from '../user-sessions.ts'

export interface UserSessionFaceDeps {
  readonly ctx: Context
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly readJsonBody: (req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void, maxBytes?: number) => void
  /** The host's live sessions. */
  readonly liveSessions: { has(id: string): boolean; get(id: string): unknown; keys(): Iterable<string> }
  readonly joinedSessions: { has(id: string): boolean; list(): readonly string[] }
  readonly archived: (id: string) => boolean
  readonly sessionLogRoots: () => readonly string[]
  readonly scanSessionLogList: () => Array<{ id: string; mtimeMs: number }>
  readonly nameOf: (agent: unknown) => string
  readonly teamOf: (agent: unknown) => string
  readonly roleOf: (id: string) => SeatRole
  /** Mark a live session as holding text from beyond this host. */
  readonly taint: (id: string) => void
  readonly idem?: PromptIdempotency
}

const sendJson = (res: ServerResponse, status: number, value: unknown): void => {
  const payload = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** A whole number in range from a query value; undefined when absent, null when present but wrong. */
function intParam(value: string | null, min: number, max: number): number | undefined | null {
  if (value === null) return undefined
  if (!/^\d{1,9}$/.test(value)) return null
  const n = Number(value)
  return n >= min && n <= max ? n : null
}

/**
 * Register the three routes.
 * @param webServer - the host's web server.
 * @param d - what they need from the host.
 */
export function registerUserSessionFaces(webServer: WebServer, d: UserSessionFaceDeps): void {
  const cache = new TranscriptCache()
  const idem = d.idem ?? new PromptIdempotency()
  const hostDeps = {
    live: (id: string) => d.liveSessions.has(id),
    joined: (id: string) => d.joinedSessions.has(id),
    archived: d.archived,
    agent: (id: string) => d.liveSessions.get(id) as PromptAgent | undefined,
    role: d.roleOf,
    taint: d.taint,
    idem,
  }
  const prove = (req: IncomingMessage, res: ServerResponse): DeferredOwnerProof | undefined => {
    let connection: unknown
    try { connection = d.ctx.get('connection') } catch { /* an inactive provider: the proof below refuses */ }
    const proof = browserOwnerProof(connection, req, { deferAudit: true })
    if (!proof.ok) { sendJson(res, proof.status, proof); return undefined }
    return proof
  }
  const auditRefused = (res: ServerResponse): void => sendJson(res, 503, { ok: false, code: 'audit', error: '审计记录写不进去，未执行操作。' })

  d.ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/user/sessions',
    handler: d.controlRoute((req, res) => {
      if (req.method !== 'GET') { sendJson(res, 405, { ok: false, code: 'method', error: 'GET only' }); return }
      const proof = prove(req, res); if (proof === undefined) return
      const team = new URL(req.url ?? '/', 'http://x').searchParams.get('team') ?? undefined
      const mtimes = new Map(d.scanSessionLogList().map(row => [row.id, row.mtimeMs]))
      const listed = listUserSessions({
        ...hostDeps,
        ids: () => [...new Set([...d.liveSessions.keys(), ...d.joinedSessions.list()])],
        name: id => { const agent = d.liveSessions.get(id); return agent === undefined ? id : d.nameOf(agent) },
        team: id => { const agent = d.liveSessions.get(id); return agent === undefined ? null : d.teamOf(agent) },
        mtimeMs: id => mtimes.get(id),
      }, team === undefined ? {} : { team })
      if (!proof.commit({ action: 'sessions', ...(team !== undefined ? { target: team } : {}) })) { auditRefused(res); return }
      sendJson(res, 200, { ok: true, count: listed.sessions.length, truncated: listed.truncated, sessions: listed.sessions })
    }),
  }), 'a2a: user sessions route')

  d.ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/user/session',
    handler: d.controlRoute((req, res) => {
      if (req.method !== 'GET') { sendJson(res, 405, { ok: false, code: 'method', error: 'GET only' }); return }
      const proof = prove(req, res); if (proof === undefined) return
      const params = new URL(req.url ?? '/', 'http://x').searchParams
      const id = params.get('id') ?? ''
      if (!SESSION_ID_SHAPE.test(id)) { sendJson(res, 400, { ok: false, code: 'id', error: 'id must be a session id (session-…)' }); return }
      const before = intParam(params.get('before'), 0, 1_000_000_000)
      const limit = intParam(params.get('limit'), 1, TRANSCRIPT_MAX_LIMIT)
      const chars = intParam(params.get('chars'), 1, TRANSCRIPT_PAGE_CHARS_MAX)
      const wrong = before === null ? 'before' : limit === null ? 'limit' : chars === null ? 'chars' : undefined
      if (wrong !== undefined) { sendJson(res, 400, { ok: false, code: wrong, error: `${wrong} is out of range` }); return }
      const page = readSessionPage({ roots: d.sessionLogRoots, cache }, id, { ...(before !== undefined && before !== null ? { before } : {}), limit: limit ?? TRANSCRIPT_DEFAULT_LIMIT, entryCap: chars ?? TRANSCRIPT_ENTRY_TEXT_CAP })
      if (!page.ok) { sendJson(res, page.code === 'no-log' ? 404 : page.code === 'too-large' ? 413 : 500, page); return }
      if (!proof.commit({ action: 'read', target: id })) { auditRefused(res); return }
      sendJson(res, 200, page)
    }),
  }), 'a2a: user session read route')

  d.ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/user/session/prompt',
    handler: d.controlRoute((req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' }); return }
      // The owner is proved before the body is read: nothing is buffered for a caller that is not the owner.
      const proof = prove(req, res); if (proof === undefined) return
      d.readJsonBody(req, res, (body) => {
        const fields = body as Record<string, unknown>
        const prepared = prepareOwnerPrompt(hostDeps, {
          id: fields.id, mode: fields.mode, text: fields.text, requestId: fields.request_id,
          callerTaint: '', delegate: proof.delegate ?? { id: null, name: 'browser-owner' },
        })
        if (!prepared.ok) { sendJson(res, prepared.status, prepared); return }
        if (prepared.replay !== undefined) { sendJson(res, 200, prepared.replay); return }
        if (!proof.commit(prepared.audit)) { auditRefused(res); return }
        const done = prepared.deliver()
        if (!done.ok) { proof.commit({ ...prepared.audit, phase: 'delivery-failed', code: done.code }); sendJson(res, done.status, done); return }
        sendJson(res, 200, done.response)
      }, OWNER_PROMPT_BODY_MAX_BYTES)
    }),
  }), 'a2a: user session prompt route')
}
