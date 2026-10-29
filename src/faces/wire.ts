/**
 * The /a2a/* wire faces (gh#77 batch B2, small faces first: cli + canvas-op).
 *
 * Moved verbatim out of apply() in src/index.ts: the routes register when
 * the web server settles, exactly as before. What used to be closure
 * captures arrives through WireDeps and is destructured once below, so the
 * route bodies read as they did in index.ts (the B1 admin.ts pattern).
 * direct / log / query follow in the next slice of this batch; until then
 * they stay inline in index.ts.
 * @module src/faces/wire
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { A2aPeerCard } from '../types.ts'
import { CanvasStore, isRemoteMemberRef, validRemoteMemberRef } from '../canvas-store.ts'
import type { CliDepositStore } from '../cli-deposit.ts'
import type { JoinedSessions } from '../joined-store.ts'

/** What verifyOriginClaim answers (see index.ts; reason widens to string here — the faces only interpolate it). */
export type OriginClaimResult = { ok: true; caller: string; callerUrl: string; card: A2aPeerCard } | { ok: false; reason: string }

/** The closure captures the wire faces read (grows with each extracted face). */
export interface WireDeps {
  readonly ctx: Context
  readonly logger: ReturnType<Context['logger']>
  readonly cliDeposits: CliDepositStore
  readonly canvasStore: CanvasStore
  readonly sessionNodes: Map<string, Agent>
  readonly joinedSessions: JoinedSessions
  readonly verifyOriginClaim: (req: IncomingMessage) => Promise<OriginClaimResult>
  readonly callerLinkedToThisHost: (caller: string, callerUrl: string, callerCard: A2aPeerCard | undefined) => boolean
  readonly recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void
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
    cliDeposits,
    canvasStore,
    sessionNodes,
    joinedSessions,
    verifyOriginClaim,
    callerLinkedToThisHost,
    recordActivity,
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
}
