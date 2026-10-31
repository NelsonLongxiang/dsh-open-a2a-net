/**
 * OriginClaim envelope (gh#9+gh#10, docs/protocol/delivery-origin-auth.md):
 * the signer every outbound peer request stamps and the verifier every peer
 * face (card, /a2a/direct, /a2a/log, /a2a/canvas-op, /a2a/canvas-changed)
 * runs.
 *
 * Two canonical forms ride the same four base headers
 * (X-A2A-Caller / -Url / -Ts):
 *   · bound (v2, §2.1): JSON.stringify([tag, caller, callerUrl, ts,
 *     audience, METHOD, path]) in X-A2A-Caller-Sig2, the audience origin in
 *     X-A2A-Caller-Aud. The verifier requires the audience to be one of its
 *     own origins and signs-over its own method and path, so an envelope is
 *     good at exactly the host and route it was made for.
 *   · unbound (v1, legacy): JSON.stringify([caller, callerUrl, ts]) in
 *     X-A2A-Caller-Sig. Emitted and accepted only while the unbound window
 *     is open (originClaimUnboundWindow); accepted ones are counted.
 * A present Sig2 is the only thing verified — never a fallback to Sig.
 */
import { createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { TLSSocket } from 'node:tls'
import { verifyCard } from './card.ts'
import type { A2aFetch } from './a2a-client.ts'
import type { CardCacheEntry } from './runtime.ts'
import type { A2aPeerCard } from './types.ts'

/** ts skew tolerance (protocol constant, §7). */
export const ORIGIN_CLAIM_SKEW_MS = 5 * 60_000
/** Domain tag of the bound form: a v1 signature can never verify as v2. */
export const ORIGIN_CLAIM_BOUND_TAG = 'a2a-origin-claim/2'

/** Where an outbound request goes: the bound form signs both. */
export interface OriginClaimTarget {
  readonly url: string
  readonly method: string
}

export type OriginClaimRefusal = 'absent' | 'bad-caller-shape' | 'bad-ts' | 'no-card' | 'bad-sig' | 'not-derivable' | 'wrong-audience' | 'unbound-closed'
export type OriginClaimVerdict =
  | { ok: true; caller: string; callerUrl: string; card: A2aPeerCard; bound: boolean }
  | { ok: false; reason: OriginClaimRefusal }

/** The unbound (v1) canonical form. */
export function unboundCanonical(caller: string, callerUrl: string, ts: number): string {
  return JSON.stringify([caller, callerUrl, ts])
}

/** The bound (v2) canonical form; method upper-cased, path without query. */
export function boundCanonical(caller: string, callerUrl: string, ts: number, audience: string, method: string, path: string): string {
  return JSON.stringify([ORIGIN_CLAIM_BOUND_TAG, caller, callerUrl, ts, audience, method.toUpperCase(), path])
}

/** An origin in URL's normal form, or '' when the text is not an http(s) URL. */
export function originOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : ''
  } catch {
    return ''
  }
}

/** The path a request names, without its query (the bound form signs this). */
export function pathOf(url: string): string {
  try {
    return new URL(url, 'http://x').pathname
  } catch {
    return ''
  }
}

/**
 * Sign one envelope for `target`. The bound form is always present; the
 * unbound one only while `unbound` (the window) is open, so an upgraded
 * host stops signing the unbound form the moment it closes.
 */
export function signOriginClaim(target: OriginClaimTarget, signer: {
  readonly caller: string
  readonly callerUrl: string
  readonly privateKey: KeyObject
  readonly unbound: boolean
  readonly now: number
}): Record<string, string> {
  const { caller, callerUrl, privateKey, now: ts } = signer
  const sign = (text: string): string => edSign(undefined, Buffer.from(text, 'utf8'), privateKey).toString('base64')
  const headers: Record<string, string> = {
    'X-A2A-Caller': caller,
    'X-A2A-Caller-Url': callerUrl,
    'X-A2A-Caller-Ts': String(ts),
  }
  const audience = originOf(target.url)
  if (audience !== '') {
    headers['X-A2A-Caller-Aud'] = audience
    headers['X-A2A-Caller-Sig2'] = sign(boundCanonical(caller, callerUrl, ts, audience, target.method, pathOf(target.url)))
  }
  if (signer.unbound) headers['X-A2A-Caller-Sig'] = sign(unboundCanonical(caller, callerUrl, ts))
  return headers
}

/** IPv4-mapped and bare IPv6 socket addresses in URL host form. */
function hostForm(address: string): string {
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address
  return plain.includes(':') ? `[${plain}]` : plain
}

/**
 * The origins this host answers to for one request: the configured ones
 * (own card URL, operator aliases) plus the address the request actually
 * arrived on — the socket's LOCAL end, which a sender cannot choose (unlike
 * the Host header). A loopback arrival also answers to the other loopback
 * spellings of the same port.
 */
export function requestAudiences(req: IncomingMessage, configured: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const url of configured) {
    const origin = originOf(url)
    if (origin !== '') out.add(origin)
  }
  const socket = req.socket as (TLSSocket & { encrypted?: boolean }) | undefined
  const local = socket?.localAddress
  const port = socket?.localPort
  if (local !== undefined && port !== undefined) {
    const scheme = socket?.encrypted === true ? 'https' : 'http'
    const host = hostForm(local)
    const loopback = host === '[::1]' || /^127\./.test(host)
    for (const name of loopback ? [host, '127.0.0.1', 'localhost', '[::1]'] : [host]) {
      const origin = originOf(`${scheme}://${name}:${String(port)}`)
      if (origin !== '') out.add(origin)
    }
  }
  return out
}

const originClaimCallerShape = /^[a-z0-9-]+$/i

/**
 * Verify one request's envelope. Cheap refusals (shape, ts, audience,
 * closed window) answer before any card fetch; the card is then read from
 * the shared cache or fetched PLAIN from the caller's well-known URL.
 */
export async function verifyOriginClaim(req: IncomingMessage, d: {
  readonly cardCache: Map<string, CardCacheEntry>
  readonly fetch: A2aFetch
  /** This host's configured origins (own card URL, operator aliases). */
  readonly audiences: readonly string[]
  /** The unbound window: accept a Sig-only (v1) envelope. */
  readonly unboundOpen: boolean
  /** Count one accepted unbound envelope (the drain gauge). */
  readonly onUnbound: () => void
  readonly now: number
}): Promise<OriginClaimVerdict> {
  const header = (name: string): string => String(req.headers[name] ?? '')
  const caller = header('x-a2a-caller')
  const callerUrl = header('x-a2a-caller-url')
  const ts = Number(header('x-a2a-caller-ts'))
  const unboundSig = header('x-a2a-caller-sig')
  const boundSig = header('x-a2a-caller-sig2')
  const audience = header('x-a2a-caller-aud')
  if (caller === '' || callerUrl === '' || !Number.isFinite(ts) || ts <= 0 || (unboundSig === '' && boundSig === '')) return { ok: false, reason: 'absent' }
  if (!originClaimCallerShape.test(caller)) return { ok: false, reason: 'bad-caller-shape' }
  if (Math.abs(d.now - ts) > ORIGIN_CLAIM_SKEW_MS) return { ok: false, reason: 'bad-ts' }
  const bound = boundSig !== ''
  if (bound) {
    if (!requestAudiences(req, d.audiences).has(originOf(audience))) return { ok: false, reason: 'wrong-audience' }
  } else if (!d.unboundOpen) {
    return { ok: false, reason: 'unbound-closed' }
  }
  // Fetch the caller's card PLAIN (REVIEW M2 third-round ruling: the
  // envelope names a BARE ZONE, and derivation is the exact match
  // card.team === caller below — both ride the minimal card's signed core,
  // so a single envelope-less fetch suffices and never recurses). A warm
  // cache entry short-circuits the fetch.
  let card: A2aPeerCard | undefined = d.cardCache.get(callerUrl)?.card
  if (card === undefined) {
    try {
      // callerUrl is the caller's BASE URL — the card lives under it.
      const cardUrl = callerUrl.endsWith('/') ? `${callerUrl}.well-known/agent-card.json` : `${callerUrl}/.well-known/agent-card.json`
      const response = await d.fetch(cardUrl, { method: 'GET', headers: {} })
      const verdict = verifyCard(JSON.parse(await response.text()), Date.now())
      if (verdict.ok) card = verdict.card
    } catch {
      card = undefined
    }
  }
  if (card === undefined) return { ok: false, reason: 'no-card' }
  const canonical = bound
    ? boundCanonical(caller, callerUrl, ts, audience, req.method ?? '', pathOf(req.url ?? ''))
    : unboundCanonical(caller, callerUrl, ts)
  try {
    const publicKey = createPublicKey({ key: Buffer.from(card.publicKey, 'base64'), format: 'der', type: 'spki' })
    if (!edVerify(undefined, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(bound ? boundSig : unboundSig, 'base64'))) return { ok: false, reason: 'bad-sig' }
  } catch {
    return { ok: false, reason: 'bad-sig' }
  }
  // Derivation (REVIEW M2, third-round ruling): card.team === caller EXACT.
  // A zone/id8 envelope is bad-caller-shape at the gate — session identity
  // rides the body's caller_session, judged by N3/S3 against the PUBLISHED
  // roster (the prefix variant let a same-zone foreign host sign a target's
  // session handle with its own key).
  if (card.team !== caller) return { ok: false, reason: 'not-derivable' }
  if (!bound) d.onUnbound()
  return { ok: true, caller, callerUrl, card, bound }
}
