/**
 * 适配 framing (review 2026-10-27): never past 100%, frame titles and peer
 * cards included, the content kept below the HUD instead of under it.
 */
import { describe, expect, it } from 'vitest'
import { boardBounds, fitBelowHud } from '../src/planning-fit.ts'
import { FRAME_HEAD_TOP } from '../src/edges.ts'
import { NODE_H, NODE_W, type WorldNode } from '../src/world.ts'

const content = { minX: 0, minY: 0, maxX: 400, maxY: 300 }
const peer = (x: number, y: number): WorldNode => ({ id: `peer-${x}`, x, y, label: '', team: '', live: true, remote: true, memberships: [] })

describe('planning-fit', () => {
  it('a small board is never magnified past 100%', () => {
    expect(fitBelowHud(content, 1200, 800, 0).scale).toBe(1)
  })

  it('bounds lift to the frame titles and reach the peer cards', () => {
    const b = boardBounds(content, [peer(900, 100), { ...peer(0, 0), remote: false }])!
    expect(b.minY).toBe(FRAME_HEAD_TOP)
    expect(b.maxX).toBe(900 + NODE_W / 2)
    expect(b.maxY).toBe(300)
    expect(boardBounds(null, [peer(10, 10)])).toEqual({ minX: 10 - NODE_W / 2, minY: 10 - NODE_H / 2, maxX: 10 + NODE_W / 2, maxY: 10 + NODE_H / 2 })
  })

  it('the content is centred in the area below the HUD, not under it', () => {
    const big = { minX: 0, minY: 0, maxX: 1600, maxY: 1000 }
    const hud = 60
    const vp = fitBelowHud(big, 1200, 800, hud)
    // Top of the content lands below the HUD's bottom edge.
    const topPx = (big.minY - vp.y) * vp.scale
    expect(topPx).toBeGreaterThanOrEqual(hud)
    // And it fits the reduced height at 90% fill.
    expect(vp.scale).toBeCloseTo(0.9 * Math.min(1200 / 1600, (800 - hud) / 1000), 5)
  })

  it('a board too big to read whole floors at 60% and anchors its top-left corner just below the HUD', () => {
    const huge = { minX: 100, minY: 50, maxX: 6100, maxY: 4050 }
    const hud = 60
    const vp = fitBelowHud(huge, 1500, 800, hud)
    expect(vp.scale).toBe(0.6)
    expect((huge.minX - vp.x) * vp.scale).toBeCloseTo(16, 5)
    expect((huge.minY - vp.y) * vp.scale).toBeCloseTo(hud + 16, 5)
  })

  it('no HUD (not laid out) or an implausible one fits the whole board', () => {
    const big = { minX: 0, minY: 0, maxX: 2400, maxY: 1600 }
    expect(fitBelowHud(big, 1200, 800, 0)).toEqual(fitBelowHud(big, 1200, 800, 500))
  })
})
