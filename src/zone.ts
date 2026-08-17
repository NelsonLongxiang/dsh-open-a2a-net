/**
 * Zone-relative name resolution over agent cards (GNUnet semantics, slice 3).
 * A name resolves in a zone: the zone's own team matches first, then its
 * signed delegate records, recursively. The walk is bounded by a hard depth
 * cap and by visited-URL cycle detection — both fail closed with a reason,
 * never a hang. Design basis:
 * .agents/notes/proposed/feature/2026-08-16-gnunet-prior-art-for-a2a-topology.md.
 * @module @nelsonlongxiang/dsh-open-a2a-net/zone
 */

import type { A2aPeerCard } from './types.ts'

/** Hard delegation-walk bound in hops (GNS `loop_threshold`). */
export const ZONE_DEPTH_CAP = 5

/** Why a resolution failed; every failure mode is closed. */
export type ZoneResolutionReason = 'not-found' | 'depth' | 'cycle' | 'key-mismatch' | 'unreachable'

/** The resolution outcome: the owning zone, or the closed-failure reason. */
export type ZoneResolution =
  | { readonly ok: true; readonly url: string; readonly card: A2aPeerCard }
  | { readonly ok: false; readonly reason: ZoneResolutionReason; readonly detail: string }

/**
 * Fetch one zone's verified card; returns undefined when unreachable or the
 * card fails verification. The caller owns scoring and referral intake.
 */
export type ZoneCardFetch = (url: string) => Promise<A2aPeerCard | undefined>

/**
 * Resolve one name starting from a zone's base URL.
 * @param fetchCard - verified-card fetch for one zone URL.
 * @param startUrl - base URL of the zone the name resolves in.
 * @param name - the zone-relative name (a team name).
 * @returns the resolved zone URL with its verified card, or the closed-failure reason.
 */
export async function resolveZone(fetchCard: ZoneCardFetch, startUrl: string, name: string): Promise<ZoneResolution> {
  if (name === '') return { ok: false, reason: 'not-found', detail: 'empty name' }
  return walk(fetchCard, startUrl, name, undefined, new Set([startUrl]), 0)
}

/**
 * One delegation hop. The zone's own team is authoritative for the name;
 * a delegate record hands the name to another zone.
 * @param fetchCard - verified-card fetch for one zone URL.
 * @param url - the zone being consulted.
 * @param name - the zone-relative name.
 * @param expectedKey - base64 SPKI key the consulted card must present when the delegating record bound one.
 * @param visited - zone URLs already consulted (cycle detection).
 * @param depth - delegations already walked.
 * @returns the resolved zone, or the closed-failure reason.
 */
async function walk(
  fetchCard: ZoneCardFetch,
  url: string,
  name: string,
  expectedKey: string | undefined,
  visited: Set<string>,
  depth: number,
): Promise<ZoneResolution> {
  if (depth > ZONE_DEPTH_CAP) {
    return { ok: false, reason: 'depth', detail: `delegation walk exceeded ${String(ZONE_DEPTH_CAP)} hops at ${url}` }
  }
  const card = await fetchCard(url)
  if (card === undefined) return { ok: false, reason: 'unreachable', detail: url }
  if (expectedKey !== undefined && card.publicKey !== expectedKey) {
    return { ok: false, reason: 'key-mismatch', detail: `${url} does not present the delegating zone's bound key` }
  }
  if (card.team === name) return { ok: true, url, card }
  const delegate = (card.records ?? []).find(record => record.name === name)
  if (delegate === undefined) return { ok: false, reason: 'not-found', detail: `zone ${url} publishes no ${name}` }
  if (visited.has(delegate.url)) {
    return { ok: false, reason: 'cycle', detail: `delegation cycle through ${delegate.url}` }
  }
  visited.add(delegate.url)
  return walk(fetchCard, delegate.url, name, delegate.publicKey, visited, depth + 1)
}
