/**
 * The /a2a/* wire faces (gh#77 batch B2; slice 2 adds log + query).
 *
 * Moved verbatim out of apply() in src/index.ts: the routes register when
 * the web server settles, exactly as before. What used to be closure
 * captures arrives through WireDeps and is destructured once below, so the
 * route bodies read as they did in index.ts (the B1 admin.ts pattern). The
 * one accessor deviation: the log face's `legacyInboundCount += 1` (a let in
 * index.ts) goes through `d.bumpLegacyInbound()`, the same mutable-binding
 * treatment admin.ts gives its six lets. direct stays inline for slice 3.
 * @module src/faces/wire
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { A2aPeerCard } from '../types.ts'
import { CanvasStore, isRemoteMemberRef, validRemoteMemberRef } from '../canvas-store.ts'
import type { CliDepositStore } from '../cli-deposit.ts'
import type { IdempotencyStore } from '../idempotency-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import { TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_LIMIT } from '../session-transcript.ts'
import type { Config } from '../index.ts'
import { WIRE_ERROR_PAYLOAD_TOO_LARGE } from '../transport-caps.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** What verifyOriginClaim answers (see index.ts; reason widens to string here — the faces only interpolate it). */
export type OriginClaimResult = { ok: true; caller: string; callerUrl: string; card: A2aPeerCard } | { ok: false; reason: string }

/** The closure captures the wire faces read (grows with each extracted face). */
export interface WireDeps {
  readonly ctx: Context
  readonly logger: ReturnType<Context['logger']>
  readonly config: Config
  readonly cliDeposits: CliDepositStore
  readonly canvasStore: CanvasStore
  readonly sessionNodes: Map<string, Agent>
  readonly joinedSessions: JoinedSessions
  readonly idempotencyStore: IdempotencyStore
  readonly verifyOriginClaim: (req: IncomingMessage) => Promise<OriginClaimResult>
  readonly callerLinkedToThisHost: (caller: string, callerUrl: string, callerCard: A2aPeerCard | undefined) => boolean
  readonly recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void
  readonly bumpLegacyInbound: () => void
  readonly secretEqual: (a: string, b: string) => boolean
  readonly a2aCallerRefusal: (caller: string, targetTeam?: string) => string | undefined
  readonly scanSessionLogList: () => Array<{ id: string; mtimeMs: number; sizeBytes: number }>
  readonly readSessionLogTail: (id: string, limit: number) => { ok: true; id: string; messages: Array<{ role: string; text: string; time?: number }> } | { ok: false; error: string }
}

/**
 * Register the small wire faces on a settled web server.
 * @param webServer - the settled host web server.
 * @param d - the captures listed on {@link WireDeps}.
 */
export function registerWireFaces(webServer: WebServer, d: WireDeps): void {
  const {
    ctx,
    logger,
    config,
    cliDeposits,
    canvasStore,
    sessionNodes,
    joinedSessions,
    idempotencyStore,
    verifyOriginClaim,
    callerLinkedToThisHost,
    recordActivity,
    secretEqual,
    a2aCallerRefusal,
    scanSessionLogList,
    readSessionLogTail,
  } = d
  // gh#45 CLI 户口卡面 (peer face, unsigned card serve): the deposited
  // CLI's SIGNED card is served verbatim under its own base URL — an
  // OriginClaim verification of a CLI envelope fetches exactly here
  // (callerUrl + /.well-known/agent-card.json). Expired or unknown
  // handles 404 (auto-deregistered — the identity is dead until
  // re-publish).
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/a2a/cli',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const MOUNT = '/a2a/cli'
      const rest = (req.url ?? '').slice(MOUNT.length)
      const m = /^\/([^/]+)\/\.well-known\/agent-card\.json$/.exec(rest)
      if (req.method !== 'GET' || m === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end()
        return
      }
      const handle = decodeURIComponent(m[1]!)
      const row = cliDeposits.get(handle)
      if (row === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(row.cardJson)
    },
  }), 'a2a: cli deposit card face')

  // gh#41 fleet planning, peer-write face: a LINKED peer may regulate this
  // host's canvas teams (create / add-member / remove-member) with a
  // VERIFIED OriginClaim envelope. The owner's ruling: any peer composes
  // and regulates the whole fleet — the bilateral/operator link IS the
  // authorization, the envelope proves the key, and every op lands in the
  // activity ring + host log for audit. Unlinked or unsigned callers get
  // a refusal, never a mutation.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/canvas-op',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const send = (status: number, payload: string): void => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }
      if (req.method !== 'POST') { send(200, JSON.stringify({ ok: false, error: 'POST required' })); return }
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16 * 1024) { chunks.length = 0; return } chunks.push(chunk) })
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { op?: unknown; name?: unknown; id?: unknown }
            const claim = await verifyOriginClaim(req)
            if (!claim.ok) {
              logger.warn(`a2a: canvas-op claim failed (${claim.reason}) — caller=${String(req.headers['x-a2a-caller'] ?? '')} url=${String(req.headers['x-a2a-caller-url'] ?? '')} ts=${String(req.headers['x-a2a-caller-ts'] ?? '')}`)
              send(200, JSON.stringify({ ok: false, error: `untrusted-origin: OriginClaim verification failed (${claim.reason}) — canvas regulation requires a signed envelope`, code: -32000 }))
              return
            }
            if (!callerLinkedToThisHost(claim.caller, claim.callerUrl, claim.card)) {
              recordActivity('in', 'fleet-canvas', claim.caller, false)
              send(200, JSON.stringify({ ok: false, error: `caller "${claim.caller}" is not linked to this host — canvas regulation requires the operator link (bilateral seed, canvas ref, or same-host membership)` }))
              return
            }
            const op = body.op
            const name = typeof body.name === 'string' ? body.name : ''
            const id = typeof body.id === 'string' ? body.id : ''
            let payload: { ok: boolean; members?: readonly string[]; error?: string }
            if (op === 'create') {
              const stored = canvasStore.create(name)
              payload = stored === undefined ? { ok: false, error: 'invalid name or team cap reached' } : { ok: true, members: canvasStore.membersOf(stored) }
            } else if (op === 'add-member') {
              const memberValid = isRemoteMemberRef(id) ? validRemoteMemberRef(id) : id !== '' && (sessionNodes.has(id) || joinedSessions.has(id))
              payload = name === '' || !memberValid
                ? { ok: false, error: 'name and a member (joined session id, or a zone-qualified remote team handle) are required' }
                : (canvasStore.create(name), { ok: canvasStore.addMember(name, id), members: canvasStore.membersOf(name) })
            } else if (op === 'remove-member') {
              payload = { ok: name !== '' && canvasStore.removeMember(name, id), members: name !== '' ? canvasStore.membersOf(name) : undefined }
            } else {
              payload = { ok: false, error: 'op must be create | add-member | remove-member' }
            }
            recordActivity('in', 'fleet-canvas', `${claim.caller}:${String(op)}`, payload.ok)
            logger.info(`a2a: fleet canvas op from ${claim.caller} (${String(op)} ${name}${id !== '' ? ` ${id}` : ''}) -> ${payload.ok ? 'applied' : `refused: ${payload.error ?? '?'}`}`)
            send(200, JSON.stringify(payload))
          } catch (error) {
            send(200, JSON.stringify({ ok: false, error: `canvas-op failed: ${error instanceof Error ? error.message : String(error)}` }))
          }
        })()
      })
    },
  }), 'a2a: fleet canvas-op peer route')

  // 0.6.15: the read-only peer log face — a peer asks for THIS node's
  // session transcript tail (or, without id, the readable-session
  // listing) so a remote workbench can show "what has this node been
  // talking about". Admission is a2aCallerRefusal — exactly the rule
  // /a2a/direct applies to message delivery: caller_session required,
  // zone/id8 callers judged on shared teams. Read semantics are the
  // local /__dsh_a2a/session-log face verbatim (artifact existence is
  // the only gate; archived and never-joined sessions stay readable;
  // caps mirror session-transcript.ts). Nothing here steers a session,
  // claims a task, or writes state — the only side effects are the
  // activity-ring record and the admission path's background
  // directory learn.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/log',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const send = (status: number, body: Record<string, JsonValue>): void => {
        const payload = JSON.stringify(body)
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }
      if (req.method !== 'GET') {
        send(405, { ok: false, error: 'GET is the only method on this face' })
        return
      }
      // V2 (gh#7, S1): the read-only log face rides the same apiKey gate
      // as delivery — a configured key must be presented here too.
      if (config.apiKey !== '') {
        const presented = String(req.headers['x-api-key'] ?? '')
        if (!secretEqual(presented, config.apiKey)) {
          send(401, { ok: false, error: 'unauthorized: X-API-Key required (apiKey is configured)', code: -32000 })
          return
        }
      }
      const url = new URL(req.url ?? '/', 'http://x')
      const caller = url.searchParams.get('caller_session') ?? ''
      const id = url.searchParams.get('id') ?? ''
      const limitArg = Number(url.searchParams.get('limit') ?? TRANSCRIPT_DEFAULT_LIMIT)
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(TRANSCRIPT_MAX_LIMIT, Math.floor(limitArg))) : TRANSCRIPT_DEFAULT_LIMIT
      const refusal = a2aCallerRefusal(caller)
      if (refusal !== undefined) {
        recordActivity('in', 'log', caller === '' ? 'anonymous' : caller, false)
        send(200, { ok: false, error: refusal, code: -32000 })
        return
      }
      // gh#9+gh#10: the log face reuses the exact OriginClaim
      // verification (§8.3) — same window semantics as delivery.
      const logClaim = await verifyOriginClaim(req)
      if (!logClaim.ok) {
        if (logClaim.reason !== 'absent' || config.originClaimWindow === false) {
          recordActivity('in', 'log', caller, false)
          send(200, { ok: false, error: `untrusted-origin: OriginClaim verification failed (${logClaim.reason}) — present a signed envelope or upgrade your node`, code: -32000 })
          return
        }
        d.bumpLegacyInbound()
      }
      recordActivity('in', 'log', caller, true)
      if (id.includes('/') || id.includes('\\') || id.includes('..')) {
        send(200, { ok: false, error: 'id is required' })
        return
      }
      if (id === '') {
        try {
          const rows = scanSessionLogList()
          send(200, { ok: true, count: rows.length, sessions: rows.slice(0, 50) })
        } catch (error) {
          send(200, { ok: false, error: `transcript list failed: ${error instanceof Error ? error.message : String(error)}` })
        }
        return
      }
      try {
        const tail = readSessionLogTail(id, limit)
        if (!tail.ok) send(200, { ok: false, error: tail.error })
        else send(200, { ok: true, id: tail.id, count: tail.messages.length, messages: tail.messages })
      } catch (error) {
        send(200, { ok: false, error: `transcript failed: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
  }), 'a2a: peer log face endpoint')

  // W7 slice 2: the S1 outcome-retrieval surface — a READ-ONLY lookup of
  // one claimed task's settled outcome. The body carries ONLY the task id
  // and the submit payload's fingerprint (peerPayloadFingerprint, the
  // gate's own shared implementation): the fingerprint match is the
  // authorization, and the fan-out probe never leaks the original message
  // to peers that never saw it. Constant-200 semantics — a query NEVER
  // produces a wire error code (the frozen -32002/-32003 vocabulary stays
  // submit-only), never claims, never steers, never enters a session: the
  // gate's "verdict before steer" has its mirror in "a query executes
  // nothing". Malformed fields degrade to unknown-task rather than
  // guessing; an unparseable body answers 400 like /a2a/direct.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/query',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = []
      let size = 0
      let overflowed = false
      req.on('data', (chunk: Buffer) => {
        if (overflowed) return
        const next = size + chunk.length
        if (next > 65_536) {
          overflowed = true
          chunks.length = 0
          return
        }
        size = next
        chunks.push(chunk)
      })
      req.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(400)
          res.end()
        }
      })
      req.on('end', () => {
        if (overflowed) {
          if (!res.writableEnded && !res.headersSent) {
            const payload = JSON.stringify({ error: 'payload too large', code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
            res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            res.end(payload)
          }
          return
        }
        let body: {
          readonly task_id?: unknown
          readonly fingerprint?: unknown
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
        } catch {
          const payload = JSON.stringify({ error: 'malformed body', code: -32000 })
          res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
          return
        }
        const taskId = typeof body.task_id === 'string' ? body.task_id : ''
        const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : ''
        const verdict = taskId === '' || fingerprint === ''
          ? { found: false as const, reason: 'unknown-task' as const }
          : idempotencyStore.query(taskId, fingerprint)
        const payload = JSON.stringify(
          verdict.found
            ? verdict.status === 'pending'
              ? { found: true, status: 'pending', task_id: taskId }
              : verdict.status === 'completed'
                ? {
                  found: true,
                  status: 'completed',
                  reply: verdict.reply,
                  settled_at: new Date(verdict.settledAt).toISOString(),
                  task_id: taskId,
                  ...(verdict.truncated === true ? { truncated: true } : {}),
                }
                : {
                  found: true,
                  status: 'failed',
                  error: verdict.error,
                  settled_at: new Date(verdict.settledAt).toISOString(),
                  task_id: taskId,
                  ...(verdict.truncated === true ? { truncated: true } : {}),
                }
            : { found: false, reason: verdict.reason, task_id: taskId },
        )
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    },
  }), 'a2a: query endpoint')
}
