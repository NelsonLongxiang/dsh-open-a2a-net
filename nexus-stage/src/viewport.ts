/**
 * Viewport math for the 2D planning canvas: pan/zoom state with the same
 * clamp contract as the persisted layout (scale 0.25-3, coordinates
 * bounded), pointer-anchored zoom, and the CSS transform that carries the
 * world container. Pure functions throughout - the DOM layer applies the
 * returned transform, it never computes one.
 *
 * Convention (shared with the host LayoutStore): (x, y) is the world
 * point displayed at the viewport's top-left corner; scale multiplies
 * world units into screen pixels.
 * @module nexus-stage/viewport
 */

import { SCALE_MAX, SCALE_MIN, type LayoutViewport } from './layout-doc'

/** Re-export for callers that only want the viewport vocabulary. */
export type { LayoutViewport, LayoutViewport as ViewportState } from './layout-doc'

/** The zero viewport: origin, unzoomed - what a fresh canvas shows. */
export const IDENTITY_VIEWPORT: LayoutViewport = { x: 0, y: 0, scale: 1 }

function clampScale(scale: number): number {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale))
}

/** Clamp an untrusted viewport into the persisted-layout envelope. */
export function clampViewport(vp: LayoutViewport): LayoutViewport {
  const safe = Number.isFinite(vp.scale) ? vp.scale : 1
  const x = Number.isFinite(vp.x) ? vp.x : 0
  const y = Number.isFinite(vp.y) ? vp.y : 0
  return { x, y, scale: clampScale(safe) }
}

/** Screen (client-relative px) -> world point. */
export function screenToWorld(vp: LayoutViewport, sx: number, sy: number): { x: number; y: number } {
  return { x: vp.x + sx / vp.scale, y: vp.y + sy / vp.scale }
}

/** World point -> screen (client-relative px). */
export function worldToScreen(vp: LayoutViewport, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - vp.x) * vp.scale, y: (wy - vp.y) * vp.scale }
}

/** Pan by screen-space pixels; dividing by scale keeps 1px = 1px on screen. */
export function panBy(vp: LayoutViewport, dx: number, dy: number): LayoutViewport {
  return { x: vp.x + dx / vp.scale, y: vp.y + dy / vp.scale, scale: vp.scale }
}

/**
 * Zoom by a multiplicative factor keeping the world point under the
 * anchor screen position (ax, ay) fixed: the card under the cursor stays
 * under the cursor. Invariant: vp' = vp + a/s - a/s'.
 */
export function zoomAt(vp: LayoutViewport, factor: number, ax: number, ay: number): LayoutViewport {
  const scale = clampScale(vp.scale * factor)
  if (scale === vp.scale) return vp
  return { x: vp.x + ax / vp.scale - ax / scale, y: vp.y + ay / vp.scale - ay / scale, scale }
}

/** Content bounds in world space (null = nothing to fit). */
export interface WorldBounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** A fit never shrinks past a readable floor: below {@link NARROW_FIT_WIDTH}
 *  (the board's phone breakpoint) {@link NARROW_FIT_FLOOR}, at any wider
 *  viewport {@link WIDE_FIT_FLOOR}. Fitting a whole board drew 13px card
 *  names at ~7px on a phone, and a real 66-card board at 30% on a desktop
 *  (review 2026-10-27, real-host check). Past the floor the fit anchors the
 *  content's top-left corner instead of its centre; the rest is a pan away. */
export const NARROW_FIT_WIDTH = 680
export const NARROW_FIT_FLOOR = 0.8
export const WIDE_FIT_FLOOR = 0.6
const FIT_MARGIN = 16

/**
 * Fit the content bounds into a viewW x viewH viewport at 90% fill,
 * clamped to the persisted scale envelope; empty bounds reset to identity.
 * The scale is floored (see {@link WIDE_FIT_FLOOR}); an explicit maxScale
 * below the floor still wins.
 */
export function fitView(bounds: WorldBounds | null, viewW: number, viewH: number, maxScale = Number.POSITIVE_INFINITY): LayoutViewport {
  if (bounds === null || viewW <= 0 || viewH <= 0) return IDENTITY_VIEWPORT
  const bw = bounds.maxX - bounds.minX
  const bh = bounds.maxY - bounds.minY
  if (!(bw > 0) || !(bh > 0)) return IDENTITY_VIEWPORT
  // The floor is about content that does not FIT at a readable scale, so it
  // is judged on the natural fit — a caller's maxScale cap below the floor
  // must not turn a board that fits into a top-left-anchored one (PR #79 review).
  const natural = 0.9 * Math.min(viewW / bw, viewH / bh)
  const fitted = Math.min(maxScale, natural)
  const floor = viewW < NARROW_FIT_WIDTH ? NARROW_FIT_FLOOR : WIDE_FIT_FLOOR
  if (natural < floor) {
    const scale = clampScale(Math.min(maxScale, floor))
    return { x: bounds.minX - FIT_MARGIN / scale, y: bounds.minY - FIT_MARGIN / scale, scale }
  }
  const scale = clampScale(fitted)
  return {
    x: (bounds.minX + bounds.maxX) / 2 - viewW / (2 * scale),
    y: (bounds.minY + bounds.maxY) / 2 - viewH / (2 * scale),
    scale,
  }
}

/** The CSS transform for the world container: translate then scale. */
export function worldTransformCss(vp: LayoutViewport): string {
  return `translate(${-vp.x * vp.scale}px, ${-vp.y * vp.scale}px) scale(${vp.scale})`
}
