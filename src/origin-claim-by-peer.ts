/**
 * #787: per-peer OriginClaim callerUrl selection. The operator maps a
 * normalized target peer (exact origin, or an exact mounted card path) to
 * the local card URL this host should declare when talking to that peer.
 * Absent or empty, every outbound claim keeps the global ownCardUrl.
 *
 * Matching is exact after normalization: no domain-suffix shortcuts, no
 * userinfo, no non-http(s) schemes, no query or fragment in the rule, and
 * a mount path never covers a sibling path. Conflicting rules for the same
 * normalized peer are dropped (fail closed) rather than picking one.
 */
import { isRootOriginUrl, originOf, sameMountedUrl } from './origin-claim.ts'

export type OriginClaimByPeerReason =
  | 'unparsable-peer'
  | 'peer-userinfo'
  | 'peer-protocol'
  | 'peer-query-or-fragment'
  | 'unparsable-claim'
  | 'claim-userinfo'
  | 'claim-protocol'
  | 'claim-query-or-fragment'
  | 'conflict'

export interface OriginClaimPeerRule {
  readonly kind: 'origin' | 'mount'
  /** Origin (`https://hub.example.invalid`) or origin+path (`https://f.example/node`). */
  readonly key: string
  readonly claimUrl: string
}

export interface IgnoredOriginClaimByPeer {
  readonly peer: string
  readonly claimUrl: string
  readonly reason: OriginClaimByPeerReason
}

export interface NormalizedOriginClaimByPeer {
  readonly rules: readonly OriginClaimPeerRule[]
  readonly ignored: readonly IgnoredOriginClaimByPeer[]
}

interface ParsedHttpUrl {
  readonly url: URL
  readonly kind: 'origin' | 'mount'
  readonly key: string
  readonly href: string
}

/** A configured selector or claim URL: http(s), no userinfo, no query/fragment. */
function parseConfiguredUrl(raw: string, side: 'peer' | 'claim'): { ok: true; value: ParsedHttpUrl } | { ok: false; reason: OriginClaimByPeerReason } {
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, reason: side === 'peer' ? 'unparsable-peer' : 'unparsable-claim' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: side === 'peer' ? 'peer-protocol' : 'claim-protocol' }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: side === 'peer' ? 'peer-userinfo' : 'claim-userinfo' }
  if (url.search !== '' || url.hash !== '') return { ok: false, reason: side === 'peer' ? 'peer-query-or-fragment' : 'claim-query-or-fragment' }
  const path = url.pathname.replace(/\/+$/, '')
  const kind = path === '' ? 'origin' as const : 'mount' as const
  const key = kind === 'origin' ? url.origin : url.origin + path
  const href = kind === 'origin' ? url.origin : url.origin + path
  return { ok: true, value: { url, kind, key, href } }
}

/** Request target: query/fragment ignored; userinfo and non-http(s) never match a rule. */
function parseTargetUrl(raw: string): { origin: string; path: string } | undefined {
  try {
    const url = new URL(raw)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return undefined
    return { origin: url.origin, path: url.pathname }
  } catch { return undefined }
}

function mountPath(key: string): string {
  try { return new URL(key).pathname.replace(/\/+$/, '') } catch { return '' }
}

/**
 * Drop unusable entries; when two keys normalize to the same peer with
 * different claim URLs, drop every copy of that peer.
 */
export function normalizeOriginClaimByPeer(input: Readonly<Record<string, unknown>> | undefined): NormalizedOriginClaimByPeer {
  const ignored: IgnoredOriginClaimByPeer[] = []
  const pending = new Map<string, OriginClaimPeerRule[]>()
  for (const [peer, value] of Object.entries(input ?? {})) {
    const claimRaw = typeof value === 'string' ? value : ''
    const parsedPeer = parseConfiguredUrl(peer, 'peer')
    if (!parsedPeer.ok) { ignored.push({ peer, claimUrl: claimRaw, reason: parsedPeer.reason }); continue }
    const parsedClaim = parseConfiguredUrl(claimRaw, 'claim')
    if (!parsedClaim.ok) { ignored.push({ peer, claimUrl: claimRaw, reason: parsedClaim.reason }); continue }
    const rule: OriginClaimPeerRule = { kind: parsedPeer.value.kind, key: parsedPeer.value.key, claimUrl: parsedClaim.value.href }
    const list = pending.get(rule.key) ?? []
    list.push(rule)
    pending.set(rule.key, list)
  }
  const rules: OriginClaimPeerRule[] = []
  for (const [key, list] of pending) {
    const urls = new Set(list.map(rule => rule.claimUrl))
    if (urls.size !== 1) {
      for (const rule of list) ignored.push({ peer: key, claimUrl: rule.claimUrl, reason: 'conflict' })
      continue
    }
    rules.push(list[0]!)
  }
  return { rules, ignored }
}

/** The effective map operators can inspect: normalized peer key → local claim URL. */
export function originClaimByPeerMap(rules: readonly OriginClaimPeerRule[]): Record<string, string> {
  return Object.fromEntries(rules.map(rule => [rule.key, rule.claimUrl]))
}

function pathUnderMount(path: string, mount: string): boolean {
  return mount !== '' && (path === mount || path.startsWith(mount + '/'))
}

/**
 * The first exact rule for `targetUrl`: longest matching mount path, else
 * an origin rule for that exact origin. No suffix or sibling-path match.
 */
export function matchOriginClaimByPeer(targetUrl: string, rules: readonly OriginClaimPeerRule[]): OriginClaimPeerRule | undefined {
  const target = parseTargetUrl(targetUrl)
  if (target === undefined) return undefined
  const mounts = rules.filter(rule => rule.kind === 'mount' && originOf(rule.key) === target.origin && pathUnderMount(target.path, mountPath(rule.key)))
  if (mounts.length > 0) {
    mounts.sort((a, b) => mountPath(b.key).length - mountPath(a.key).length)
    const best = mounts[0]!
    const tied = mounts.filter(rule => mountPath(rule.key).length === mountPath(best.key).length)
    if (new Set(tied.map(rule => rule.claimUrl)).size !== 1) return undefined
    return best
  }
  return rules.find(rule => rule.kind === 'origin' && rule.key === target.origin)
}

/** The callerUrl to sign for `targetUrl`, or `defaultUrl` when no rule matches. */
export function claimUrlForTarget(targetUrl: string, rules: readonly OriginClaimPeerRule[], defaultUrl: string): string {
  return matchOriginClaimByPeer(targetUrl, rules)?.claimUrl ?? defaultUrl
}

/** Local card URLs this host recognizes as itself when judging `peerUrl`. */
export function ownClaimUrlsForPeer(peerUrl: string, rules: readonly OriginClaimPeerRule[], defaultUrl: string): string[] {
  const out: string[] = []
  const add = (url: string): void => { if (url !== '' && !out.includes(url)) out.push(url) }
  add(defaultUrl)
  const mapped = matchOriginClaimByPeer(peerUrl, rules)?.claimUrl
  if (mapped !== undefined) add(mapped)
  return out
}

/** Every local claim URL the operator named (the default plus every mapped value). */
export function allOwnClaimUrls(rules: readonly OriginClaimPeerRule[], defaultUrl: string): string[] {
  const out: string[] = []
  const add = (url: string): void => { if (url !== '' && !out.includes(url)) out.push(url) }
  add(defaultUrl)
  for (const rule of rules) add(rule.claimUrl)
  return out
}

/** Whether a peer card lists one of our claim URLs (root: origin match; mount: exact path). */
export function cardListsOwnClaim(peers: readonly string[] | undefined, ownClaimUrls: readonly string[]): boolean {
  return (peers ?? []).some(listed => ownClaimUrls.some(own => ownClaimListedAs(own, listed)))
}

function ownClaimListedAs(own: string, listed: string): boolean {
  if (own === '' || listed === '') return false
  try {
    if (isRootOriginUrl(own) || new URL(own).pathname.replace(/\/+$/, '') === '') {
      return originOf(listed) === originOf(own)
    }
    return sameMountedUrl(own, listed)
  } catch { return false }
}

/** Whether `callerUrl` is one of this host's own card URLs (self-call, not a bilateral seed). */
export function isOwnClaimCaller(callerUrl: string, ownClaimUrls: readonly string[]): boolean {
  if (callerUrl === '') return false
  if (isRootOriginUrl(callerUrl)) {
    const origin = originOf(callerUrl)
    return origin !== '' && ownClaimUrls.some(own => {
      try { return (isRootOriginUrl(own) || new URL(own).pathname.replace(/\/+$/, '') === '') && new URL(own).origin === origin } catch { return false }
    })
  }
  return ownClaimUrls.some(own => sameMountedUrl(own, callerUrl))
}

/** A one-line warning for an ignored mapping; never includes userinfo or a raw secret-shaped value. */
export function originClaimByPeerWarning(row: IgnoredOriginClaimByPeer): string {
  const peer = originOf(row.peer) || 'invalid-peer'
  return `a2a: originClaimByPeer ignored (${row.reason}) for ${peer}`
}
