/**
 * Canvas change notification (owner ruling 2026-10-29: single owner + mirror).
 *
 * A canvas team belongs to the host that created it. Peers MIRROR it from the
 * owner's full card (`canvasOrg`, rendered through the state face's
 * `peerOrg`) and EDIT it through the fleet relay (`/__dsh_a2a/fleet-canvas-op`
 * → the owner's `/a2a/canvas-op`). Nothing is replicated, so there is no
 * merge: the owner's store is the single truth. What was missing is
 * freshness — a mirror only moved when the 60s card-cache window lapsed.
 *
 * This face closes that gap with a content-free ping:
 * - SEND: any change to this host's canvas store (local board, a peer's
 *   canvas-op, a leave/archive prune) schedules one debounced
 *   `POST /a2a/canvas-changed` to every tracked peer that is linked to this
 *   host by the same predicate the card face uses to serve the full card —
 *   exactly the peers that can see `canvasOrg` at all. The body is empty:
 *   the ping says "re-read my card", never what changed.
 * - RECEIVE: a verified OriginClaim from a TRACKED peer marks that peer's
 *   cached card stale (the card stays readable — no frame flicker) and
 *   refetches it through the shared single-flight cache; the board's next
 *   3s poll renders the new org. Per-peer rate limit; untracked or unsigned
 *   callers are refused without a fetch.
 * @module src/faces/canvas-notify
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { A2aPeerCard } from '../types.ts'
import type { CanvasStore } from '../canvas-store.ts'
import type { PeerStore } from '../peer-store.ts'
import type { CardCacheEntry } from '../runtime.ts'

/** Coalesce a burst of store writes (a drag that adds three members) into one ping. */
export const CANVAS_NOTIFY_DEBOUNCE_MS = 400
/** A peer's pings refresh its card at most this often. */
export const CANVAS_REFRESH_MIN_GAP_MS = 1_000
const SEND_TIMEOUT_MS = 5_000

/** The captures this face needs from `apply()`. */
export interface CanvasNotifyDeps {
  readonly ctx: Context
  readonly logger: ReturnType<Context['logger']>
  readonly peerStore: PeerStore
  readonly canvasStore: CanvasStore
  readonly cardCache: Map<string, CardCacheEntry>
  readonly originClaimHeaders: () => Record<string, string>
  readonly verifyOriginClaim: (req: IncomingMessage) => Promise<{ ok: true; caller: string; callerUrl: string; card: A2aPeerCard } | { ok: false; reason: string }>
  readonly callerLinkedToThisHost: (caller: string, callerUrl: string, callerCard: A2aPeerCard | undefined) => boolean
  readonly cachedCardFetch: (url: string) => Promise<A2aPeerCard | undefined>
}

/**
 * Re-read one peer's card now. The entry goes stale, not away (the board keeps
 * rendering the old org until the refetch lands). The shared cache is
 * single-flight, so the first fetch may JOIN one that started before the
 * peer's change; the second always starts after the first settled, i.e. after
 * the change — that one is the answer.
 * @param d - the card cache and its single-flight fetch.
 * @param url - the tracked peer URL.
 */
export async function refreshPeerCard(d: Pick<CanvasNotifyDeps, 'cardCache' | 'cachedCardFetch'>, url: string): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    const hit = d.cardCache.get(url)
    if (hit !== undefined) d.cardCache.set(url, { at: 0, card: hit.card })
    await d.cachedCardFetch(url)
  }
}

const originOf = (url: string): string => {
  try { return new URL(url).origin } catch { return '' }
}

/**
 * Register the receive face and subscribe the send side to the canvas store.
 * @param webServer - the settled host web server.
 * @param d - the captures listed on {@link CanvasNotifyDeps}.
 */
export function registerCanvasNotify(webServer: WebServer, d: CanvasNotifyDeps): void {
  const { ctx, logger, peerStore, canvasStore, originClaimHeaders, verifyOriginClaim, callerLinkedToThisHost } = d

  // ── send ──
  let timer: ReturnType<typeof setTimeout> | undefined
  const recipients = (): string[] => peerStore.list().filter(url => {
    const card = d.cardCache.get(url)?.card
    // The card face's own predicate (bare-zone caller, as originClaimHeaders
    // signs it): only a peer that is served the full card ever sees canvasOrg.
    return card !== undefined && callerLinkedToThisHost(card.team, url, card)
  })
  const flush = (): void => {
    timer = undefined
    for (const url of recipients()) {
      void globalThis.fetch(url.replace(/\/$/, '') + '/a2a/canvas-changed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...originClaimHeaders() },
        body: '{}',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }).then(async (reply) => {
        const out = await reply.json().catch(() => undefined) as { ok?: unknown; error?: unknown } | undefined
        if (out?.ok !== true) logger.debug(`a2a: canvas-changed ping to ${url} not taken: ${String(out?.error ?? `HTTP ${String(reply.status)}`)}`)
      }, (error: unknown) => {
        // A down peer re-reads the card on its own TTL once it is back.
        logger.debug(`a2a: canvas-changed ping to ${url} failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }
  ctx.effect(() => canvasStore.onChange(() => {
    if (timer === undefined) timer = setTimeout(flush, CANVAS_NOTIFY_DEBOUNCE_MS)
  }), 'a2a: canvas change notifier')
  ctx.effect(() => () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }, 'a2a: canvas change notifier timer')

  // ── receive ──
  const lastRefresh = new Map<string, number>()
  const trailing = new Map<string, ReturnType<typeof setTimeout>>()
  const refresh = (url: string): void => {
    lastRefresh.set(url, Date.now())
    void refreshPeerCard(d, url)
  }
  ctx.effect(() => () => {
    for (const handle of trailing.values()) clearTimeout(handle)
    trailing.clear()
  }, 'a2a: canvas-changed trailing refreshes')
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/canvas-changed',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const send = (payload: Record<string, unknown>): void => {
        const text = JSON.stringify(payload)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
        res.end(text)
      }
      // The ping has no content: drain a small body without buffering it,
      // and cut off anything larger.
      let size = 0
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 4 * 1024) req.destroy() })
      req.on('end', () => {
        void (async () => {
          if (req.method !== 'POST') { send({ ok: false, error: 'POST required' }); return }
          const claim = await verifyOriginClaim(req)
          if (!claim.ok) { send({ ok: false, error: `untrusted-origin: OriginClaim verification failed (${claim.reason})` }); return }
          const origin = originOf(claim.callerUrl)
          const tracked = origin === '' ? [] : peerStore.list().filter(url => originOf(url) === origin)
          if (tracked.length === 0) { send({ ok: false, error: 'caller is not a tracked peer of this host' }); return }
          // Rate limit without losing an update: a ping inside the gap is
          // deferred to one trailing refresh at the gap's end, never dropped.
          let refreshed = 0
          let deferred = 0
          for (const url of tracked) {
            const wait = CANVAS_REFRESH_MIN_GAP_MS - (Date.now() - (lastRefresh.get(url) ?? 0))
            if (wait <= 0) { refresh(url); refreshed += 1; continue }
            deferred += 1
            if (!trailing.has(url)) trailing.set(url, setTimeout(() => { trailing.delete(url); refresh(url) }, wait))
          }
          send({ ok: true, refreshed, deferred })
        })()
      })
    },
  }), 'a2a: canvas-changed peer route')
}
