/**
 * #838 A: the two read-only doctor faces.
 *
 * - `GET /__dsh_a2a/net-doctor` — control-gated: this host's own effective network view and offline checks
 *   (src/net-doctor.ts). Makes no peer call.
 * - `POST /a2a/link-check` — the double-sided check: a peer that already passes the peer gates asks "how does this host
 *   see me". It can only diagnose a failure that happens AFTER verification (an audience miss, a missing admission, a wrong
 *   pinned home); a signature failure never reaches it, and is read from this host's own doctor instead. No gate says why
 *   it refused: every refusal before the answer is the same 404, so a stranger or an unconfigured caller learns nothing.
 *
 * Gate order (design §A-2). Nothing before step 4 may make an outbound request, because verifying a claim fetches the
 * caller's card from the caller's self-declared URL:
 *   1. limit by source address;   2. static key check (apiKey, or the link key for the declared caller origin);
 *   3. the declared caller URL must already be one of this host's peers;   4. only then verify the claim (body-bound) and
 *   run the full peer key gate.
 * The answer holds only facts about the verified caller. It never carries this host's socket address (NAT/forwarding would
 * leak an inner one), peer list, other peers' configuration, member rosters, or any credential.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/net-doctor
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { DoctorMissRow } from '../net-doctor.ts'
import type { OriginClaimResult } from './wire.ts'

/** Checks per source address in a sliding minute, and how many addresses the limiter remembers. */
export const LINK_CHECKS_PER_MINUTE = 30
const SOURCES_MAX = 1024
const BODY_MAX = 4096

export interface NetDoctorFaceDeps {
  readonly ctx: Context
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  /** This host's own report (built from live config, the home file and the recent-refusal rings). */
  readonly report: () => Record<string, unknown>
  /** The double-sided half this host initiates: ask one configured peer how it sees us (src/index.ts linkCheckPeer). */
  readonly linkCheck?: (peer: string) => Promise<Record<string, unknown>>
  /** Step 2: the key check that makes no request (apiKey, or the link key matching the declared caller origin). */
  readonly keyPrecheck: (req: IncomingMessage) => boolean
  /** Step 3: whether the declared caller URL is already one of this host's peers (no request). */
  readonly peerConfigured: (callerUrl: string) => boolean
  readonly verifyOriginClaim: (req: IncomingMessage, options?: { readonly cli?: boolean; readonly rawBody?: Uint8Array }) => Promise<OriginClaimResult>
  readonly peerKeyAdmits: (req: IncomingMessage, rawBody?: Uint8Array) => Promise<boolean>
  readonly boundMisses: () => readonly DoctorMissRow[]
  readonly pinnedCliHomes: () => ReadonlyArray<readonly [string, string]>
  readonly now?: () => number
}

export function registerNetDoctorFaces(webServer: WebServer, d: NetDoctorFaceDeps): void {
  const now = d.now ?? (() => Date.now())
  const json = (res: ServerResponse, status: number, body: Record<string, unknown>): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  }
  const hits = new Map<string, number[]>()
  const takeCheck = (source: string): boolean => {
    const at = now()
    for (const [key, times] of hits) if (times.every(t => at - t >= 60_000)) hits.delete(key)
    const recent = (hits.get(source) ?? []).filter(t => at - t < 60_000)
    if (recent.length >= LINK_CHECKS_PER_MINUTE) return false
    if (!hits.has(source) && hits.size >= SOURCES_MAX) return false
    hits.set(source, [...recent, at])
    return true
  }
  // One answer for every refusal that is not a rate limit: a probe learns neither that the face exists for it nor which gate failed.
  const notFound = (res: ServerResponse): void => json(res, 404, { ok: false, error: 'not found' })

  ctx_effect(d.ctx, () => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/net-doctor',
    handler: d.controlRoute((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'GET is the only method on this face' }); return }
      const peer = new URL(req.url ?? '/', 'http://x').searchParams.get('peer') ?? ''
      if (peer === '') { json(res, 200, { ok: true, ...d.report() }); return }
      // Only a peer this host already has: the doctor is not a way to make this host call an arbitrary URL.
      if (d.linkCheck === undefined || !d.peerConfigured(peer)) { json(res, 400, { ok: false, error: 'peer must be one of this host peers' }); return }
      d.linkCheck(peer).then(peerCheck => json(res, 200, { ok: true, ...d.report(), peerCheck }), (error: unknown) => json(res, 200, { ok: true, ...d.report(), peerCheck: { status: 'error', error: error instanceof Error ? error.message : String(error) } }))
    }),
  }), 'a2a: net doctor face')

  ctx_effect(d.ctx, () => webServer.register({
    kind: 'exact',
    path: '/a2a/link-check',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') { notFound(res); return }
      if (!takeCheck(req.socket.remoteAddress ?? 'unknown')) { json(res, 429, { ok: false, error: 'rate-limited' }); return }
      if (!d.keyPrecheck(req)) { notFound(res); return }
      const declared = String(req.headers['x-a2a-caller-url'] ?? '')
      if (declared === '' || !d.peerConfigured(declared)) { notFound(res); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > BODY_MAX) { notFound(res); return }
        chunks.push(chunk as Buffer)
      }
      const rawBody = new Uint8Array(Buffer.concat(chunks))
      const claim = await d.verifyOriginClaim(req, { rawBody })
      if (!claim.ok || claim.cli === true || claim.bound !== true || claim.bodyBound !== true) { notFound(res); return }
      if (!await d.peerKeyAdmits(req, rawBody)) { notFound(res); return }
      const mine = (name: string): boolean => name === claim.caller || name.startsWith(claim.caller + '/')
      json(res, 200, {
        ok: true,
        you: {
          caller: claim.caller,
          callerUrl: claim.callerUrl,
          inPeers: true,
          // The Host header is the address the caller itself dialled; it is not this host's socket address.
          dialledHost: String(req.headers.host ?? ''),
          audienceMisses: d.boundMisses().filter(row => row.caller === claim.caller).map(row => ({ audience: row.audience, count: row.count, lastAt: row.lastAt })),
          pinnedCliHomes: d.pinnedCliHomes().filter(([handle]) => mine(handle)).map(([handle, home]) => ({ handle, home })),
        },
      })
    },
  }), 'a2a: link-check face')
}

const ctx_effect = (ctx: Context, fn: () => (() => void) | void, label: string): void => { ctx.effect(fn as never, label) }
