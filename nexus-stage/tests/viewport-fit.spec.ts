/**
 * fitView on a phone (review 2026-10-27): fitting a whole board into a
 * 375px viewport drew card names at ~7px. Below the narrow breakpoint the
 * fit floors its scale and anchors the content's top-left corner.
 */
import { describe, expect, it } from 'vitest'
import { fitView, NARROW_FIT_FLOOR } from '../src/viewport.ts'

const board = { minX: 0, minY: 0, maxX: 1200, maxY: 900 }

describe('fitView narrow floor', () => {
  it('a wide viewport still fits the whole board, centred', () => {
    const vp = fitView(board, 1440, 900)
    expect(vp.scale).toBeCloseTo(0.9, 5)
    expect(vp.x + 1440 / (2 * vp.scale)).toBeCloseTo(600, 5)
  })

  it('a phone viewport never shrinks past the floor and anchors the top-left corner', () => {
    const vp = fitView(board, 375, 700)
    expect(vp.scale).toBe(NARROW_FIT_FLOOR)
    // Content's top-left sits 16px in from the viewport's top-left.
    expect((board.minX - vp.x) * vp.scale).toBeCloseTo(16, 5)
    expect((board.minY - vp.y) * vp.scale).toBeCloseTo(16, 5)
  })

  it('a small board on a phone fits normally, and a maxScale cap still wins', () => {
    const small = { minX: 0, minY: 0, maxX: 300, maxY: 200 }
    expect(fitView(small, 375, 700).scale).toBeCloseTo(0.9 * 375 / 300, 5)
    expect(fitView(board, 375, 700, 0.5).scale).toBe(0.5)
  })
})
