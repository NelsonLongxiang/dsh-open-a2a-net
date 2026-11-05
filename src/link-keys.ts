/**
 * #317 link keys: a per-peer `X-API-Key` so a public node never holds the fleet key. Outbound requests to a
 * linked origin carry that link's key; inbound, a link key is accepted on the peer faces only when the
 * caller's verified OriginClaim names exactly that origin. The control routes never accept a link key.
 */

import { originOf } from './origin-claim.ts'

export { originOf }

/** The configured link keys keyed by normalized origin; blank keys and unparsable origins are dropped. */
export function normalizeLinkKeys(linkKeys: Readonly<Record<string, unknown>> | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const [peer, key] of Object.entries(linkKeys ?? {})) {
    const origin = originOf(peer)
    if (origin !== '' && typeof key === 'string' && key !== '') out.set(origin, key)
  }
  return out
}

/** The `X-API-Key` to send to `url`: its link key, else this host's apiKey ('' omits the header). */
export function outboundKeyFor(url: string, linkKeys: ReadonlyMap<string, string>, apiKey: string): string {
  return linkKeys.get(originOf(url)) ?? apiKey
}

/** Whether `presented` is one of the link keys (every key is compared, in constant time each). */
export function isLinkKey(presented: string, linkKeys: ReadonlyMap<string, string>, secretEqual: (a: string, b: string) => boolean): boolean {
  let matched = false
  for (const key of linkKeys.values()) if (secretEqual(presented, key)) matched = true
  return matched
}
