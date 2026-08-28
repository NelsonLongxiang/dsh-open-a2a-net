/**
 * The 3D observation lens' reprojection of the shared layout document
 * (ruling: feedback/2026-08-27-nexus-canvas-ux/review-node-position.md,
 * direction A). The persisted {x, y} is a 2D card center in pixels; the
 * scene must not consume it as an absolute scene coordinate - a modest 2D
 * arrangement measurably threw 4 of 5 nodes off camera. Instead the whole
 * fleet (saved positions plus unsaved polar fallbacks) is recentered on
 * its centroid and uniformly scaled so its outermost point lands on the
 * observation envelope: topology preserved, scale re-expressed in the
 * lens' own language.
 *
 * Recomputed every poll, which also makes the 3D view follow 2D saves
 * mid-session (the old code read the layout only at mesh creation).
 * Pure: no DOM, no three.
 * @module nexus-stage/reproject
 */

import { seatFor } from './seat'

/** Target radius of the reprojected cloud in scene units. */
export const SCENE_ENVELOPE_RADIUS = 20

/** One raw source position (2D pixels or a fallback seat). */
export interface RawPoint { x: number; y: number }

/**
 * Project a fleet into the observation envelope. `saved` holds the
 * persisted 2D positions (finite-checked); sessions without one fall back
 * to their deterministic polar seat so the cloud is always complete.
 * Degenerate clouds (a single node, or nodes sharing one spot) land at
 * the origin - the envelope only governs spread, and there is none.
 */
export function projectFleet(
  sessionIds: ReadonlyArray<string>,
  saved: Readonly<Record<string, RawPoint>>,
  envelope: number = SCENE_ENVELOPE_RADIUS,
): Map<string, { x: number; y: number }> {
  const raw = new Map<string, { x: number; y: number }>()
  let cx = 0
  let cy = 0
  for (const id of sessionIds) {
    const s = saved[id]
    const p = s !== undefined && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : seatFor2D(id)
    raw.set(id, p)
    cx += p.x
    cy += p.y
  }
  const n = raw.size
  if (n === 0) return raw
  cx /= n
  cy /= n

  let maxRadius = 0
  for (const p of raw.values()) {
    maxRadius = Math.max(maxRadius, Math.hypot(p.x - cx, p.y - cy))
  }
  const scale = maxRadius > 0 ? envelope / maxRadius : 0

  const out = new Map<string, { x: number; y: number }>()
  for (const [id, p] of raw) {
    out.set(id, { x: (p.x - cx) * scale, y: (p.y - cy) * scale })
  }
  return out
}

function seatFor2D(id: string): { x: number; y: number } {
  const p = seatFor(id)
  return { x: p.x, y: p.z }
}
