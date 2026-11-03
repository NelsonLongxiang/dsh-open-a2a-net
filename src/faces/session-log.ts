/**
 * gh#77 (src/index.ts line ratchet): the two session-log faces, moved verbatim out of apply() —
 * the LOCAL transcript reader `/__dsh_a2a/session-log` and the REMOTE proxy
 * `/__dsh_a2a/remote-session-log`. Behavior unchanged; apply() hands over the captures below.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/session-log
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Config } from '../index.ts'
import type { PeerStore } from '../peer-store.ts'
import type { A2aPeerCard } from '../types.ts'
import { TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_LIMIT } from '../session-transcript.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Everything the session-log faces capture from apply(). */
export interface SessionLogFaceDeps {
  readonly ctx: Context
  readonly config: Pick<Config, 'team'>
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly scanSessionLogList: () => Array<{ id: string; mtimeMs: number; sizeBytes: number }>
  readonly readSessionLogTail: (id: string, limit: number) => { ok: true; id: string; messages: Array<{ role: string; text: string; time?: number }> } | { ok: false; error: string }
  readonly peerStore: Pick<PeerStore, 'list'>
  readonly peerFetch: typeof globalThis.fetch
  readonly directoryPeerCandidates: (fetch: (url: string) => Promise<A2aPeerCard | undefined>, team: string, failures: string[]) => Promise<string[]>
  readonly memoizedCardFetch: () => (url: string) => Promise<A2aPeerCard | undefined>
}

/**
 * Register the local transcript reader and the remote-log proxy on the shared web server.
 * @param d - the captures listed on {@link SessionLogFaceDeps}.
 */
export function registerSessionLogFaces(webServer: WebServer, d: SessionLogFaceDeps): void {
  const { ctx, config, controlRoute, scanSessionLogList, readSessionLogTail, peerStore, peerFetch, directoryPeerCandidates, memoizedCardFetch } = d
  // Session transcript reader (0.6.11): the workbench inspector shows the
  // tail of a LOCAL node's own conversation log inline — owner ruling
  // 2026-10-20 banned navigation, and reading is the need jumps used to
  // serve. The id gate is artifact existence under this host's sessions
  // tree — reading is a host-workbench concern, not a network-membership
  // concern, so archived and never-joined sessions stay readable while the
  // network faces keep their own visibility rules. Path shape is still
  // checked (no '/', '\', '..') and the tree never leaves <dshHome>/sessions.
  // Without an id the same face lists readable sessions (newest activity
  // first, capped) so the workbench directory can offer log rows even when
  // the network directory shows none. Caps mirror session-transcript.ts.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/session-log',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const id = url.searchParams.get('id') ?? ''
      const limitArg = Number(url.searchParams.get('limit') ?? TRANSCRIPT_DEFAULT_LIMIT)
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(TRANSCRIPT_MAX_LIMIT, Math.floor(limitArg))) : TRANSCRIPT_DEFAULT_LIMIT
      let result: Record<string, JsonValue>
      if (id.includes('/') || id.includes('\\') || id.includes('..')) {
        result = { ok: false, error: 'id is required' }
      } else if (id === '') {
        // Listing face: every session directory holding a log artifact.
        try {
          const rows = scanSessionLogList()
          result = { ok: true, count: rows.length, sessions: rows.slice(0, 50) }
        } catch (error) {
          result = { ok: false, error: `transcript list failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      } else {
        try {
          const tail = readSessionLogTail(id, limit)
          if (!tail.ok) result = { ok: false, error: tail.error }
          else result = { ok: true, id: tail.id, count: tail.messages.length, messages: tail.messages }
        } catch (error) {
          result = { ok: false, error: `transcript failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      }
      const payload = JSON.stringify(result)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
    }),
  }), 'a2a: session-log route')

  // 0.6.15: the local proxy for REMOTE session logs. The workbench runs
  // in this host's browser page, so cross-host reads must originate from
  // this host (no CORS, one trust boundary). ?team=<zone/id8> resolves
  // directory candidates that publish that team (same walk as routing);
  // ?peer=<base-url> targets one tracked peer directly and MUST name a
  // URL already in the peer store — the proxy never fetches an
  // arbitrary address. The caller label we present is config.team (this
  // node's own zone handle, the same host face quick-dispatch uses).
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/remote-session-log',
    handler: controlRoute(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const team = url.searchParams.get('team') ?? ''
      const peer = url.searchParams.get('peer') ?? ''
      const id = url.searchParams.get('id') ?? ''
      const limitArg = Number(url.searchParams.get('limit') ?? TRANSCRIPT_DEFAULT_LIMIT)
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(TRANSCRIPT_MAX_LIMIT, Math.floor(limitArg))) : TRANSCRIPT_DEFAULT_LIMIT
      const finish = (body: Record<string, JsonValue>): void => {
        const payload = JSON.stringify(body)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }
      if (id.includes('/') || id.includes('\\') || id.includes('..')) {
        finish({ ok: false, error: 'id is required' })
        return
      }
      const trackedPeers = new Set(peerStore.list().map(entry => entry.replace(/\/+$/, '')))
      let targets: string[]
      if (peer !== '') {
        const normalized = peer.replace(/\/+$/, '')
        if (!trackedPeers.has(normalized)) {
          finish({ ok: false, error: 'unknown peer on this node — the proxy only reads tracked peers' })
          return
        }
        targets = [normalized]
      } else if (team !== '') {
        const failures: string[] = []
        targets = await directoryPeerCandidates(memoizedCardFetch(), team, failures)
        if (targets.length === 0) {
          finish({ ok: false, error: `no directory candidate publishes team "${team}"${failures.length > 0 ? ` (${failures.slice(0, 3).join('; ')})` : ''}` })
          return
        }
      } else {
        finish({ ok: false, error: 'team or peer is required' })
        return
      }
      // 0.6.16: a team-handle read without an explicit id names a NODE, not
      // a session. The handle suffix (zone/<id8>) is the first 8 hex of the
      // peer-side session id (sessionTeamOf), so resolve the listing once
      // and pick that session — bare zone teams fall back to the newest.
      // An explicit id (peer drill) short-circuits this.
      let resolvedId = id
      if (resolvedId === '' && team !== '') {
        const suffix = team.includes('/') ? team.slice(team.lastIndexOf('/') + 1) : ''
        for (const base of targets) {
          const listUrl = new URL('/a2a/log', base)
          listUrl.searchParams.set('caller_session', config.team)
          try {
            const listResponse = await peerFetch(listUrl, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
            const listBody = await listResponse.json().catch(() => ({ ok: false, error: `peer answered HTTP ${listResponse.status}` })) as { ok?: boolean; error?: string; sessions?: Array<{ id: string }> }
            if (listResponse.ok && listBody.ok === true && Array.isArray(listBody.sessions)) {
              const picked = suffix !== '' ? listBody.sessions.find(row => row.id.includes(suffix)) : listBody.sessions[0]
              if (picked !== undefined) {
                resolvedId = picked.id
                break
              }
            }
          } catch {
            // listing failed on this candidate — the tail attempt below
            // will surface the honest error for the same base
          }
        }
        if (resolvedId === '') {
          finish({ ok: false, error: `no readable session on this peer matches "${team}"` })
          return
        }
      }
      const attempts: string[] = []
      for (const base of targets) {
        const target = new URL('/a2a/log', base)
        target.searchParams.set('caller_session', config.team)
        if (resolvedId !== '') target.searchParams.set('id', resolvedId)
        target.searchParams.set('limit', String(limit))
        try {
          const response = await peerFetch(target, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
          const body = await response.json().catch(() => ({ ok: false, error: `peer answered HTTP ${response.status}` })) as { ok?: boolean; error?: string }
          if (response.ok && body.ok === true) {
            finish({ ...body, via: base } as Record<string, JsonValue>)
            return
          }
          attempts.push(`${base}: ${body.error ?? `HTTP ${response.status}`}`)
        } catch (error) {
          attempts.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      finish({ ok: false, error: `remote log unavailable — ${attempts.join(' | ')}` })
    }),
  }), 'a2a: remote-session-log proxy route')
}
