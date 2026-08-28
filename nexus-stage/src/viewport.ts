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

/**
 * Fit the content bounds into a viewW x viewH viewport at 90% fill,
 * clamped to the persisted scale envelope; empty bounds reset to identity.
 */
export function fitView(bounds: WorldBounds | null, viewW: number, viewH: number): LayoutViewport {
  if (bounds === null || viewW <= 0 || viewH <= 0) return IDENTITY_VIEWPORT
  const bw = bounds.maxX - bounds.minX
  const bh = bounds.maxY - bounds.minY
  if (!(bw > 0) || !(bh > 0)) return IDENTITY_VIEWPORT
  const scale = clampScale(0.9 * Math.min(viewW / bw, viewH / bh))
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
