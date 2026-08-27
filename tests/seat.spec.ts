/**
 * Deterministic seating tests: same session id reproduces the same seat,
 * every seat stays inside the historical random envelope (radial 12-30,
 * vertical +-1), and distinct sessions spread across distinct seats.
 */
import { describe, expect, it } from 'vitest'
import { SEAT_DIST_MAX, SEAT_DIST_MIN, SEAT_Y_SPAN, seatFor } from '../nexus-stage/src/seat.ts'

const sid = (i: number): string => `session-${i.toString(16).padStart(8, '0')}-0000`

describe('deterministic seating', () => {
  it('reproduces the same seat for the same session id', () => {
    expect(seatFor(sid(1))).toEqual(seatFor(sid(1)))
  })

  it('keeps every seat inside the historical envelope', () => {
    for (let i = 0; i < 200; i++) {
      const p = seatFor(sid(i))
      const dist = Math.hypot(p.x, p.z)
      expect(dist).toBeGreaterThanOrEqual(SEAT_DIST_MIN - 1e-9)
      expect(dist).toBeLessThanOrEqual(SEAT_DIST_MAX + 1e-9)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(SEAT_Y_SPAN + 1e-9)
    }
  })

  it('spreads distinct sessions across mostly distinct seats', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => {
      const p = seatFor(sid(i))
      return `${p.x.toFixed(3)},${p.z.toFixed(3)}`
    }))
    expect(seen.size).toBeGreaterThan(50)
  })
})
