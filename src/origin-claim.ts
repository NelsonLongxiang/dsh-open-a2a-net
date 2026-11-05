/**
 * OriginClaim envelope (gh#9+gh#10, docs/protocol/delivery-origin-auth.md):
 * the signer every outbound peer request stamps and the verifier every peer
 * face (card, /a2a/direct, /a2a/log, /a2a/canvas-op, /a2a/canvas-changed)
 * runs.
 *
 * Three canonical forms share the base caller headers
 * (X-A2A-Caller / -Url / -Ts):
 *   · bound (v2, §2.1): JSON.stringify([tag, caller, callerUrl, ts,
 *     audience, METHOD, path]) in X-A2A-Caller-Sig2, the audience origin in
 *     X-A2A-Caller-Aud. The verifier requires the audience to be one of its
 *     own origins and signs-over its own method and path, so an envelope is
 *     good at exactly the host and route it was made for.
 *   · unbound (v1, legacy): JSON.stringify([caller, callerUrl, ts]) in
 *     X-A2A-Caller-Sig. Emitted and accepted only while the unbound window
 *     is open (originClaimUnboundWindow); accepted ones are counted.
 * A present Sig3 requires the exact raw body and v3 signature, with no downgrade.
 * Without Sig3, once the window closes a present Sig2 is the only thing verified. While
 * it is open, a Sig2 that misses (audience or signature) falls back to the
 * Sig the envelope also carries — no more than stripping Sig2 would give —
 * and the miss is counted, so a peer dialled by an unlisted name keeps
 * working through the rollout and shows on the gauge.
 */
import { createHash, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto'
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
export const ORIGIN_CLAIM_BODY_TAG = 'a2a-origin-claim/3'

/** Digest the exact UTF-8 string/bytes passed to transport, never reserialized JSON. */
export const originBodySha256 = (body: string | Uint8Array): string => createHash('sha256').update(body).digest('base64url')

/** Where an outbound request goes: the bound form signs both. */
export interface OriginClaimTarget {
  readonly url: string
  readonly method: string
  readonly body?: string | Uint8Array
}

export type OriginClaimRefusal = 'absent' | 'bad-caller-shape' | 'bad-ts' | 'no-card' | 'bad-sig' | 'not-derivable' | 'wrong-audience' | 'unbound-closed' | 'body-mismatch'

/** Only the canonical origin root can claim that origin's identity. */
export function isRootOriginUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === ''
  } catch { return false }
}
/**
 * #189 follow-up: whether a path-prefixed claim URL is EXACTLY a peer URL the operator seeded (a
 * mounted card endpoint, delivery-origin-auth §"挂载卡片端点"): same origin and same path (trailing
 * slashes ignored), neither carrying userinfo, query or fragment. A different path under the same
 * origin is a different publisher and never matches.
 */
export function sameMountedUrl(seeded: string, claimUrl: string): boolean {
  try {
    const a = new URL(seeded)
    const b = new URL(claimUrl)
    const clean = (u: URL): boolean => (u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === '' && u.search === '' && u.hash === ''
    const path = (u: URL): string => u.pathname.replace(/\/+$/, '')
    return clean(a) && clean(b) && a.origin === b.origin && path(a) !== '' && path(a) === path(b)
  } catch { return false }
}
export type OriginClaimVerdict =
  | { ok: true; caller: string; callerUrl: string; card: A2aPeerCard; bound: boolean; cli?: true; bodyBound?: true }
  | { ok: false; reason: OriginClaimRefusal }

/** The unbound (v1) canonical form. */
export function unboundCanonical(caller: string, callerUrl: string, ts: number): string {
  return JSON.stringify([caller, callerUrl, ts])
}

/** The bound (v2) canonical form; method upper-cased, path without query. */
export function boundCanonical(caller: string, callerUrl: string, ts: number, audience: string, method: string, path: string): string {
  return JSON.stringify([ORIGIN_CLAIM_BOUND_TAG, caller, callerUrl, ts, audience, method.toUpperCase(), path])
}

/** The body-bound v3 form is domain-separated from v1/v2, with the digest appended. */
export function bodyBoundCanonical(caller: string, callerUrl: string, ts: number, audience: string, method: string, path: string, bodySha256: string): string {
  return JSON.stringify([ORIGIN_CLAIM_BODY_TAG, caller, callerUrl, ts, audience, method.toUpperCase(), path, bodySha256])
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
    if (target.body !== undefined) {
      const digest = originBodySha256(target.body)
      headers['X-A2A-Body-Sha256'] = digest
      headers['X-A2A-Caller-Sig3'] = sign(bodyBoundCanonical(caller, callerUrl, ts, audience, target.method, pathOf(target.url), digest))
    }
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
 * the Host header). A loopback arrival answers to all its loopback
 * spellings — unless `loopbackArrival` is off (originClaimUrl declares a
 * tunnel or proxy, whose requests all arrive on loopback), and then only
 * when a configured origin is loopback at that port.
 */
export function requestAudiences(req: IncomingMessage, configured: readonly string[], loopbackArrival = true): Set<string> {
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
    const spellings = [host, '127.0.0.1', 'localhost', '[::1]'].map(name => originOf(`${scheme}://${name}:${String(port)}`))
    const names = loopback ? (loopbackArrival || spellings.some(origin => out.has(origin)) ? spellings : []) : [spellings[0]!]
    for (const origin of names) if (origin !== '') out.add(origin)
  }
  return out
}

const originClaimCallerShape = /^[a-z0-9-]+$/i
/** #312: explain unsupported host zone configuration without changing startup or signature policy. */
export function originClaimTeamWarning(team: string): string | undefined {
  return originClaimCallerShape.test(team) ? undefined : 'a2a: configured host team contains invalid characters; OriginClaim cannot produce a verifiable host identity. Use ^[a-z0-9-]+$ (no slash).'
}

/**
 * gh#133: a CLI identity deposited on the verifying host — the full handle,
 * the bare name it signs as, and its deposited card (undefined when the
 * deposit no longer verifies).
 */
export interface CliDepositCard {
  readonly handle: string
  readonly name: string
  readonly card: A2aPeerCard | undefined
}

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
  /** Count one bound form that missed and fell back to the unbound one. */
  readonly onBoundMiss?: (miss: { readonly caller: string; readonly audience: string }) => void
  /** A loopback arrival is an audience of its own (default); off when originClaimUrl declares a tunnel or proxy. */
  readonly loopbackArrival?: boolean
  readonly now: number
  /** Exact received bytes, supplied by the bounded body reader. Missing bytes cannot verify Sig3. */
  readonly rawBody?: Uint8Array
  /** On the faces that admit CLI identities: the deposit a claim URL names. */
  readonly cliDeposit?: (callerUrl: string) => CliDepositCard | undefined
}): Promise<OriginClaimVerdict> {
  const header = (name: string): string => String(req.headers[name] ?? '')
  const caller = header('x-a2a-caller')
  const callerUrl = header('x-a2a-caller-url')
  const ts = Number(header('x-a2a-caller-ts'))
  const unboundSig = header('x-a2a-caller-sig')
  const boundSig = header('x-a2a-caller-sig2')
  const audience = header('x-a2a-caller-aud')
  const hasBodySig = req.headers['x-a2a-caller-sig3'] !== undefined
  const bodySig = header('x-a2a-caller-sig3')
  const digest = header('x-a2a-body-sha256')
  // Presence, even malformed/empty, opts into v3. It must never become absent/legacy or fall back to Sig2/v1.
  if (hasBodySig && (!bodySig || !/^[A-Za-z0-9_-]{43}$/.test(digest) || d.rawBody === undefined || originBodySha256(d.rawBody) !== digest)) return { ok: false, reason: 'body-mismatch' }
  if (caller === '' || callerUrl === '' || !Number.isFinite(ts) || ts <= 0 || (unboundSig === '' && boundSig === '' && !hasBodySig)) return { ok: false, reason: hasBodySig ? 'bad-sig' : 'absent' }
  if (!originClaimCallerShape.test(caller)) return { ok: false, reason: 'bad-caller-shape' }
  if (Math.abs(d.now - ts) > ORIGIN_CLAIM_SKEW_MS) return { ok: false, reason: 'bad-ts' }
  const hasBound = boundSig !== '' || hasBodySig
  const audienceOk = hasBound && requestAudiences(req, d.audiences, d.loopbackArrival ?? true).has(originOf(audience))
  const fallback = !hasBodySig && d.unboundOpen && unboundSig !== ''
  if (hasBound && !audienceOk && !fallback) return { ok: false, reason: 'wrong-audience' }
  if (!hasBound && !d.unboundOpen) return { ok: false, reason: 'unbound-closed' }
  const verifies = (card: A2aPeerCard, canonical: string, signature: string): boolean => {
    try {
      const publicKey = createPublicKey({ key: Buffer.from(card.publicKey, 'base64'), format: 'der', type: 'spki' })
      return edVerify(undefined, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signature, 'base64'))
    } catch {
      return false
    }
  }
  // Only a successful bound signature is origin proof. A v1/fallback
  // signature is accepted for migration compatibility but remains unbound.
  let bound = false
  const signedBy = (card: A2aPeerCard): boolean => {
    if (hasBodySig) {
      bound = audienceOk && verifies(card, bodyBoundCanonical(caller, callerUrl, ts, audience, req.method ?? '', pathOf(req.url ?? ''), digest), bodySig)
      return bound
    }
    bound = audienceOk && verifies(card, boundCanonical(caller, callerUrl, ts, audience, req.method ?? '', pathOf(req.url ?? '')), boundSig)
    return bound || (fallback && verifies(card, unboundCanonical(caller, callerUrl, ts), unboundSig))
  }
  const accepted = (): void => {
    if (bound) return
    d.onUnbound()
    if (hasBound) d.onBoundMiss?.({ caller, audience: originOf(audience) })
  }
  // gh#133: a CLI identity deposited HERE, decided from the deposit table
  // before any fetch (the CLI may reach its home through a proxy the host
  // cannot dial back). Same forms, audience and window as a zone claim.
  const cli = d.cliDeposit?.(callerUrl)
  if (cli !== undefined) {
    if (cli.card === undefined) return { ok: false, reason: 'no-card' }
    if (!signedBy(cli.card)) return { ok: false, reason: 'bad-sig' }
    if (cli.name !== caller) return { ok: false, reason: 'not-derivable' }
    accepted()
    return { ok: true, caller: cli.handle, callerUrl, card: cli.card, bound, cli: true, ...(bound && hasBodySig ? { bodyBound: true as const } : {}) }
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
      const cardBase = new URL(callerUrl)
      cardBase.username = ''
      cardBase.password = ''
      cardBase.pathname = `${cardBase.pathname.replace(/\/+$/, '')}/.well-known/agent-card.json`
      cardBase.search = ''
      cardBase.hash = ''
      const cardUrl = cardBase.toString()
      const response = await d.fetch(cardUrl, { method: 'GET', headers: {}, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) return { ok: false, reason: 'not-derivable' }
      const verdict = verifyCard(JSON.parse(await response.text()), Date.now())
      if (verdict.ok) card = verdict.card
    } catch {
      card = undefined
    }
  }
  if (card === undefined) return { ok: false, reason: 'no-card' }
  if (!signedBy(card)) return { ok: false, reason: 'bad-sig' }
  // Derivation (REVIEW M2, third-round ruling): card.team === caller EXACT.
  // A zone/id8 envelope is bad-caller-shape at the gate — session identity
  // rides the body's caller_session, judged by N3/S3 against the PUBLISHED
  // roster (the prefix variant let a same-zone foreign host sign a target's
  // session handle with its own key).
  if (card.team !== caller) return { ok: false, reason: 'not-derivable' }
  accepted()
  // #282 S3 review: a verified Sig3 means the body itself was signed (stripping it falls back to Sig2, which has no bodyBound).
  return { ok: true, caller, callerUrl, card, bound, ...(bound && hasBodySig ? { bodyBound: true as const } : {}) }
}
