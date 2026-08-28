/**
 * Federation overlay geometry for the 2D planning canvas (PR D 活动/联邦
 * 层): where peer badges sit, which accent edges carry the pending a2a
 * routes, and where the indigo federal referral lines attach. Everything
 * is derived from the polling state (`/__dsh_a2a/state` -> inFlight,
 * peers) plus the team-frame anchors, so the DOM layer only draws what
 * these functions return - same derivation discipline as edges.ts.
 *
 * Pure: no DOM, no three, no clock. `now` is always a parameter so the
 * suite pins time deterministically. All coordinates are world-space;
 * the transformed #world container carries them to the screen for free.
 * @module nexus-stage/federation
 */

import type { WorldBounds } from './viewport'

/** One pending outbound route from /state `inFlight`. */
export interface InFlightRow {
  team: string
  /** peer as `host:port` (no scheme) - the badge url carries the scheme. */
  peer: string
  startedAt: number
}

/** One federation peer from /state `peers`. */
export interface PeerRow {
  url: string
  score?: number
}

/** A team frame's titlebar anchor {fx + fw/2, fy + 11} (edges.ts lockstep). */
export interface FrameAnchor {
  name: string
  x: number
  y: number
}

/** A peer badge's resolved slot in the placement column. */
export interface PeerPlacement {
  url: string
  score?: number
  x: number
  y: number
}

/** One derived overlay edge, ready for the SVG / label layers. */
export interface ActivityEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

/** Badge column x-offset right of the frames' content bounds (maxX + gap). */
export const PEER_COLUMN_GAP = 140
/** Fallback column x while the canvas has no frames to anchor against. */
export const PEER_COLUMN_FALLBACK_X = 200
/** Vertical pitch between badges in the column. */
export const PEER_COLUMN_STEP = 90
/** Federal-line origin gap left of the content bounds (minX - gap). */
export const FEDERAL_ANCHOR_GAP = 80
/** Padding around every badge point when computing the fly region. */
export const FLY_PAD = 60

/**
 * Lay the peer badges out in a deterministic column: one x for all,
 * y stacked from the content bounds' top at a fixed 90px pitch, in the
 * peers array's order. Recomputed every reconcile - the column tracks
 * the content, never the mouse. Null bounds (empty canvas) fall back to
 * a fixed origin so first paint is still deterministic.
 */
export function placePeers(
  peers: ReadonlyArray<PeerRow>,
  bounds: WorldBounds | null,
): PeerPlacement[] {
  const x = bounds !== null ? bounds.maxX + PEER_COLUMN_GAP : PEER_COLUMN_FALLBACK_X
  const y0 = bounds !== null ? bounds.minY : 0
  return peers.map((peer, i) => ({
    url: peer.url,
    score: peer.score,
    x,
    y: y0 + i * PEER_COLUMN_STEP,
  }))
}

/**
 * One accent edge per pending outbound route: from the route's team
 * frame titlebar anchor to the matching peer badge, labelled with the
 * route and its whole-second age. Rows whose team has no frame or whose
 * peer matches no badge are skipped - dangling rows are a polling
 * transient, not an error. Peer match is by suffix (`host:port` against
 * `scheme://host:port`), first badge in array order wins.
 */
export function activityEdges(
  inFlight: ReadonlyArray<InFlightRow>,
  anchors: ReadonlyMap<string, FrameAnchor>,
  peers: ReadonlyArray<PeerPlacement>,
  now: number,
): ActivityEdge[] {
  const out: ActivityEdge[] = []
  for (const row of inFlight) {
    const anchor = anchors.get(row.team)
    if (anchor === undefined) continue
    const badge = peers.find(p => p.url.endsWith(row.peer))
    if (badge === undefined) continue
    const elapsed = Math.max(0, Math.round((now - row.startedAt) / 1000))
    out.push({
      x1: anchor.x,
      y1: anchor.y,
      x2: badge.x,
      y2: badge.y,
      label: `a2a_route · ${row.peer} · ${elapsed}s`,
    })
  }
  return out
}

/**
 * Federal referral lines: from a content-bounds anchor (minX - 80,
 * vertical center) out to every peer badge. Only the first line is
 * labelled "gns referral" - one legend row, not one label per peer.
 * Null bounds anchors the fan at the fixed fallback origin.
 */
export function federalEdges(
  peers: ReadonlyArray<PeerPlacement>,
  bounds: WorldBounds | null,
): ActivityEdge[] {
  // Gutter anchor: between the card field's right edge and the badge column,
  // at the badges' vertical mid — short stubs that cannot cross any card
  // (an anchor at the content's left middle raked long diagonals through
  // the whole field: the reported wiring anomaly).
  const anchor = bounds !== null
    ? { x: bounds.maxX + 20, y: peers.length > 0 ? (peers[0]!.y + peers[peers.length - 1]!.y) / 2 : (bounds.minY + bounds.maxY) / 2 }
    : { x: -FEDERAL_ANCHOR_GAP, y: 0 }
  return peers.map((peer, i) => ({
    x1: anchor.x,
    y1: anchor.y,
    x2: peer.x,
    y2: peer.y,
    label: i === 0 ? 'gns referral' : '',
  }))
}

/**
 * The fly region: frames' content bounds unioned with every badge point
 * padded by FLY_PAD, so a fit over it frames the whole federation
 * (canvas + column) with breathing room. Null only when there is
 * nothing at all to fly to.
 */
export function flyBounds(
  bounds: WorldBounds | null,
  peers: ReadonlyArray<PeerPlacement>,
): WorldBounds | null {
  if (bounds === null && peers.length === 0) return null
  let minX = bounds !== null ? bounds.minX : Number.POSITIVE_INFINITY
  let minY = bounds !== null ? bounds.minY : Number.POSITIVE_INFINITY
  let maxX = bounds !== null ? bounds.maxX : Number.NEGATIVE_INFINITY
  let maxY = bounds !== null ? bounds.maxY : Number.NEGATIVE_INFINITY
  for (const peer of peers) {
    minX = Math.min(minX, peer.x - FLY_PAD)
    minY = Math.min(minY, peer.y - FLY_PAD)
    maxX = Math.max(maxX, peer.x + FLY_PAD)
    maxY = Math.max(maxY, peer.y + FLY_PAD)
  }
  return { minX, minY, maxX, maxY }
}
