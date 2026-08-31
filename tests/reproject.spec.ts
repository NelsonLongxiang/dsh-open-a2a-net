/**
 * The 3D lens reprojection (ruling A of review-node-position.md): the
 * fleet cloud is recentered on its centroid and uniformly scaled so its
 * outermost point lands on the observation envelope - relative structure
 * preserved, pixel magnitude discarded. Deterministic; degenerate clouds
 * collapse to the origin.
 */
import { describe, expect, it } from 'vitest'
import { SCENE_ENVELOPE_RADIUS, projectFleet } from '../nexus-stage/src/reproject.ts'

describe('projectFleet', () => {
  it('recenters the cloud on the origin', () => {
    const out = projectFleet(['a', 'b', 'c'], {
      a: { x: 1000, y: 2000 }, b: { x: 1000, y: 2000 }, c: { x: 1300, y: 2300 },
    })
    let cx = 0
    let cy = 0
    for (const p of out.values()) { cx += p.x; cy += p.y }
    expect(cx / 3).toBeCloseTo(0, 9)
    expect(cy / 3).toBeCloseTo(0, 9)
  })

  it('fits the outermost point to the envelope and preserves proportions', () => {
    const out = projectFleet(['near', 'far'], {
      near: { x: 0, y: 0 }, far: { x: 600, y: 0 },
    })
    const n = out.get('near')!
    const f = out.get('far')!
    // Two points, centroid at the midpoint: each sits AT the envelope
    // (outermost radius from the centroid = envelope).
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(SCENE_ENVELOPE_RADIUS, 9)
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(SCENE_ENVELOPE_RADIUS, 9)
    // 300%-spread cloud keeps its proportions (uniform scale, no skew).
    const tri = projectFleet(['a', 'b', 'c'], {
      a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 0, y: 600 },
    })
    const ta = tri.get('a')!
    const tb = tri.get('b')!
    const tc = tri.get('c')!
    const rawDist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y)
    const dRaw = rawDist({ x: 0, y: 0 }, { x: 300, y: 0 }) / rawDist({ x: 0, y: 0 }, { x: 0, y: 600 })
    expect(rawDist(ta, tb) / rawDist(ta, tc)).toBeCloseTo(dRaw, 9)
  })

  it('is magnitude-blind: a 10x larger document projects identically', () => {
    const small = projectFleet(['a', 'b'], { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
    const large = projectFleet(['a', 'b'], { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } })
    expect(large.get('a')).toEqual(small.get('a'))
    expect(large.get('b')).toEqual(small.get('b'))
  })

  it('falls back to the deterministic polar seat for unsaved sessions', () => {
    const out = projectFleet(['solo'], {})
    // A single point has no spread: it lands at the origin either way.
    expect(out.get('solo')).toEqual({ x: 0, y: 0 })
  })

  it('collapses degenerate clouds (identical points) to the origin', () => {
    const out = projectFleet(['a', 'b', 'c'], {
      a: { x: 50, y: 50 }, b: { x: 50, y: 50 }, c: { x: 50, y: 50 },
    })
    for (const p of out.values()) expect(p).toEqual({ x: 0, y: 0 })
  })

  it('drops malformed saved rows to the seat fallback instead of NaN', () => {
    const out = projectFleet(['a'], { a: { x: Number.NaN, y: 2 } })
    expect(out.get('a')).toEqual({ x: 0, y: 0 }) // lone point → origin
  })

  it('returns an empty map for an empty fleet', () => {
    expect(projectFleet([], {})).toEqual(new Map())
  })
})
