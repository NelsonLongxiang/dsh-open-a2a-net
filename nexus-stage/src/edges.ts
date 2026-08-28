/**
 * Star-shaped membership edges for the 2D planning canvas: one spoke per
 * (team frame -> member card), replacing the O(n^2) pairwise mesh. All
 * geometry is world-space so the SVG layer can emit raw coordinates - the
 * transformed #world container carries them to the screen for free.
 *
 * Anchor contract (must stay in lockstep with planning.css):
 * - origin   = the frame titlebar's bottom-edge midpoint. The head is a
 *   24px border-box straddling the frame's top border at top:-13px, so
 *   its bottom edge sits at fy + 11, horizontally centered at fx + fw/2.
 * - target   = the member card's top-edge midpoint {nx, ny - NODE_H/2}.
 *
 * Cross-team members draw solid from their first membership (state order)
 * and dashed from every later one - the many-to-many invariant made
 * visible. Edges are derived only; there is no freehand edge in this
 * canvas. Pure: no DOM, no three.
 * @module nexus-stage/edges
 */

import { NODE_H } from './world'
import type { FrameGeom } from './world'

/** Titlebar border-box height (planning.css .frame-head must match). */
export const FRAME_HEAD_H = 24
/** Titlebar CSS top offset, negative - straddles the frame's top border. */
export const FRAME_HEAD_TOP = -13
/** Origin anchor: frame top + the head's bottom edge offset. */
export const FRAME_HEAD_LIFT = FRAME_HEAD_TOP + FRAME_HEAD_H

/** Minimal team shape (topology.CanvasTeam satisfies it). */
export interface EdgeTeam { name: string; members: ReadonlyArray<{ id: string }> }

/** One derived spoke, ready for the SVG layer. */
export interface StarEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  /** True from a member's second membership on (cross-team many-to-many). */
  dashed: boolean
  /** Team name and member id, for keyed diffing. */
  team: string
  id: string
}

/**
 * Compute every membership spoke for the current world. Frames without a
 * rect and member ids without a position are skipped - dangling rows are
 * a polling transient, not an error.
 */
export function starEdges(
  teams: ReadonlyArray<EdgeTeam>,
  frames: ReadonlyMap<string, FrameGeom>,
  positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): StarEdge[] {
  const out: StarEdge[] = []
  const seen = new Set<string>()
  for (const team of teams) {
    const rect = frames.get(team.name)
    if (rect === undefined) continue
    const x1 = rect.x + rect.w / 2
    const y1 = rect.y + FRAME_HEAD_LIFT
    for (const member of team.members) {
      const pos = positions.get(member.id)
      if (pos === undefined) continue
      const dashed = seen.has(member.id)
      seen.add(member.id)
      out.push({ x1, y1, x2: pos.x, y2: pos.y - NODE_H / 2, dashed, team: team.name, id: member.id })
    }
  }
  return out
}
