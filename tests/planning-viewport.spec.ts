/**
 * Planning-canvas viewport math: pointer-anchored zoom (the world point
 * under the cursor stays under the cursor), screen<->world round-trips,
 * pan in screen px, clamped fit-view, and the CSS transform string.
 */
import { describe, expect, it } from 'vitest'
import {
  clampViewport,
  fitView,
  IDENTITY_VIEWPORT,
  panBy,
  screenToWorld,
  worldToScreen,
  worldTransformCss,
  zoomAt,
} from '../nexus-stage/src/viewport.ts'

describe('planning viewport', () => {
  it('zooms while keeping the anchor world point fixed', () => {
    const vp = { x: 100, y: 50, scale: 1 }
    const ax = 400
    const ay = 300
    const before = screenToWorld(vp, ax, ay)
    const zoomed = zoomAt(vp, 2, ax, ay)
    const after = screenToWorld(zoomed, ax, ay)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(zoomed.scale).toBe(2)
  })

  it('clamps zoom into the persisted scale envelope at any factor', () => {
    let vp = IDENTITY_VIEWPORT
    for (let i = 0; i < 20; i++) vp = zoomAt(vp, 10, 0, 0)
    expect(vp.scale).toBe(3)
    for (let i = 0; i < 40; i++) vp = zoomAt(vp, 0.1, 0, 0)
    expect(vp.scale).toBe(0.25)
  })

  it('is a no-op at the clamp boundary', () => {
    const max = { x: 5, y: 5, scale: 3 }
    expect(zoomAt(max, 2, 100, 100)).toEqual(max)
    const min = { x: 5, y: 5, scale: 0.25 }
    expect(zoomAt(min, 0.5, 100, 100)).toEqual(min)
  })

  it('round-trips screen <-> world at any scale', () => {
    const vp = { x: -37.5, y: 120.25, scale: 1.7 }
    const s = screenToWorld(vp, 233, 89)
    const back = worldToScreen(vp, s.x, s.y)
    expect(back.x).toBeCloseTo(233, 9)
    expect(back.y).toBeCloseTo(89, 9)
  })

  it('pans by screen px divided by scale', () => {
    expect(panBy({ x: 0, y: 0, scale: 2 }, 30, -10)).toEqual({ x: 15, y: -5, scale: 2 })
  })

  it('fits content bounds at 90% fill and centers them', () => {
    const vp = fitView({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 1000, 1000)
    expect(vp.scale).toBeCloseTo(0.9, 9)
    const tl = worldToScreen(vp, 0, 0)
    const br = worldToScreen(vp, 1000, 500)
    expect(tl.x).toBeCloseTo(50, 9)
    expect(br.x).toBeCloseTo(950, 9)
    // Content is 450px tall at 0.9 scale, centered vertically: 275px margins.
    expect(tl.y).toBeCloseTo(275, 9)
    expect(br.y).toBeCloseTo(725, 9)
  })

  it('resets to identity for empty bounds or a degenerate view', () => {
    expect(fitView(null, 800, 600)).toEqual(IDENTITY_VIEWPORT)
    expect(fitView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, 600)).toEqual(IDENTITY_VIEWPORT)
  })

  it('sanitizes non-finite state and clamps scale', () => {
    expect(clampViewport({ x: Number.NaN, y: 0, scale: 99 })).toEqual({ x: 0, y: 0, scale: 3 })
    expect(clampViewport({ x: 1, y: 1, scale: Number.NaN })).toEqual({ x: 1, y: 1, scale: 1 })
  })

  it('emits the CSS transform the world container applies', () => {
    expect(worldTransformCss({ x: 100, y: 40, scale: 2 })).toBe('translate(-200px, -80px) scale(2)')
  })
})
