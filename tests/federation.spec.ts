/**
 * Federation overlay geometry (PR D): the badge column is deterministic
 * (fixed x, fixed pitch, array order) with a fallback when the canvas is
 * empty, activity edges skip dangling rows (team without a frame, peer
 * without a badge) and label the route with its whole-second age, federal
 * lines label only the first fan spoke, and the fly region unions frames
 * bounds with the padded badge points.
 */
import { describe, expect, it } from 'vitest'
import {
  FEDERAL_ANCHOR_GAP,
  FEDERAL_GUTTER_GAP,
  PEER_COLUMN_GAP,
  PEER_COLUMN_STEP,
  activityEdges,
  federalEdges,
  flyBounds,
  placePeers,
  type FrameAnchor,
  type InFlightRow,
  type PeerRow,
} from '../nexus-stage/src/federation.ts'

const bounds = { minX: 100, minY: 50, maxX: 500, maxY: 400 }
const peers: PeerRow[] = [
  { url: 'http://10.0.0.5:8787', score: 3 },
  { url: 'http://10.0.0.6:8787' },
  { url: 'http://10.0.0.7:9000', score: 1 },
]
const anchors = new Map<string, FrameAnchor>([
  // alpha frame {x:100, y:200, w:400, h:300} -> titlebar anchor.
  ['alpha', { name: 'alpha', x: 100 + 400 / 2, y: 200 + 11 }],
  ['beta', { name: 'beta', x: 750, y: 211 }],
])
const inFlight: InFlightRow[] = [
  { team: 'alpha', peer: '10.0.0.5:8787', startedAt: 60_000 },
]

describe('placePeers', () => {
  it('stacks the column right of the content bounds at a fixed pitch', () => {
    const out = placePeers(peers, bounds)
    expect(out.map(p => p.x)).toEqual([500 + PEER_COLUMN_GAP, 640, 640])
    expect(out.map(p => p.y)).toEqual([50, 50 + PEER_COLUMN_STEP, 50 + 2 * PEER_COLUMN_STEP])
    expect(out.map(p => p.url)).toEqual(peers.map(p => p.url))
    expect(out[0]!.score).toBe(3)
    expect(out[1]!.score).toBeUndefined()
  })

  it('falls back to a fixed column origin when the canvas is empty', () => {
    const out = placePeers(peers.slice(0, 2), null)
    expect(out.map(p => p.x)).toEqual([200, 200])
    expect(out.map(p => p.y)).toEqual([0, 90])
  })

  it('returns no badges for no peers', () => {
    expect(placePeers([], bounds)).toEqual([])
    expect(placePeers([], null)).toEqual([])
  })
})

describe('activityEdges', () => {
  it('draws anchor -> badge and labels the route with its age in seconds', () => {
    const placed = placePeers(peers, bounds)
    const edges = activityEdges(inFlight, anchors, placed, 72_400)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.x1).toBe(300)
    expect(edges[0]!.y1).toBe(211)
    expect(edges[0]!.x2).toBe(placed[0]!.x)
    expect(edges[0]!.y2).toBe(placed[0]!.y)
    expect(edges[0]!.label).toBe('a2a_route · 10.0.0.5:8787 · 12s')
  })

  it('rounds the age half-up and clamps future-started rows to 0s', () => {
    const placed = placePeers(peers, bounds)
    expect(activityEdges(inFlight, anchors, placed, 72_500)[0]!.label)
      .toBe('a2a_route · 10.0.0.5:8787 · 13s')
    expect(activityEdges(inFlight, anchors, placed, 59_000)[0]!.label)
      .toBe('a2a_route · 10.0.0.5:8787 · 0s')
  })

  it('matches the peer by exact parsed host:port against the badge url', () => {
    // Badge urls carry the scheme; peer rows store bare host:port.
    const placed = placePeers([{ url: 'https://10.0.0.5:8787' }], bounds)
    expect(activityEdges(inFlight, anchors, placed, 61_000)).toHaveLength(1)
    // A bare endsWith would let 'bad10.0.0.5:8787' satisfy '10.0.0.5:8787' — parse, don't guess.
    const tricky = placePeers([{ url: 'http://bad10.0.0.5:8787' }], bounds)
    expect(activityEdges(inFlight, anchors, tricky, 61_000)).toHaveLength(0)
  })

  it('merges identical (team, peer) routes into one counted edge', () => {
    const rows: InFlightRow[] = [
      { team: 'alpha', peer: '10.0.0.5:8787', startedAt: 60_000 },
      { team: 'alpha', peer: '10.0.0.5:8787', startedAt: 68_000 }, // newer duplicate
    ]
    const edges = activityEdges(rows, anchors, placePeers(peers, bounds), 72_400)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.label).toContain('×2')
    // Age reports the OLDEST route of the merged span.
    expect(edges[0]!.label).toContain('12s')
  })

  it('does not merge routes to different peers', () => {
    const rows: InFlightRow[] = [
      { team: 'alpha', peer: '10.0.0.5:8787', startedAt: 60_000 },
      { team: 'alpha', peer: '10.0.0.7:9000', startedAt: 60_000 },
    ]
    const edges = activityEdges(rows, anchors, placePeers(peers, bounds), 72_400)
    expect(edges).toHaveLength(2)
    expect(edges.every(e => !e.label.includes('×'))).toBe(true)
  })

  it('skips rows whose team has no frame or whose peer matches no badge', () => {
    const placed = placePeers(peers, bounds)
    const rows: InFlightRow[] = [
      { team: '无框队', peer: '10.0.0.5:8787', startedAt: 60_000 }, // no anchor
      { team: 'alpha', peer: '10.9.9.9:1', startedAt: 60_000 }, // no badge
      ...inFlight,
    ]
    const edges = activityEdges(rows, anchors, placed, 72_400)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.label).toContain('10.0.0.5:8787')
  })
})

describe('federalEdges', () => {
  it('fans from the bounds-left anchor and labels only the first spoke', () => {
    const placed = placePeers(peers, bounds)
    const edges = federalEdges(placed, bounds)
    expect(edges).toHaveLength(3)
    expect(edges.map(e => e.label)).toEqual(['gns referral', '', ''])
    // Gutter anchor: right of the card field, at the badges' vertical mid —
    // short stubs that cannot cross the card field (the wiring-anomaly fix).
    expect(edges[0]!.x1).toBe(bounds.maxX + FEDERAL_GUTTER_GAP)
    expect(edges[0]!.y1).toBe((placed[0]!.y + placed[2]!.y) / 2)
    expect(edges[2]!.x2).toBe(500 + PEER_COLUMN_GAP)
    expect(edges[2]!.y2).toBe(50 + 2 * PEER_COLUMN_STEP)
  })

  it('anchors the fan at the fallback origin with null bounds', () => {
    const edges = federalEdges(placePeers(peers.slice(0, 1), null), null)
    expect(edges[0]!.x1).toBe(-FEDERAL_ANCHOR_GAP)
    expect(edges[0]!.y1).toBe(0)
  })

  it('draws nothing for no peers', () => {
    expect(federalEdges([], bounds)).toEqual([])
  })
})

describe('flyBounds', () => {
  it('unions the frames bounds with each badge padded by 60', () => {
    const placed = placePeers(peers, bounds)
    expect(flyBounds(bounds, placed)).toEqual({
      minX: 100, // frames bound wins over badge.x - 60 = 580
      minY: -10, // badge.y - 60
      maxX: 700, // badge.x + 60
      maxY: 400, // frames bound wins over badge.y + 60
    })
  })

  it('pads a badge-only region and passes frames-only bounds through', () => {
    const solo = placePeers(peers.slice(0, 2), null) // (200, 0) and (200, 90)
    expect(flyBounds(null, solo)).toEqual({ minX: 140, minY: -60, maxX: 260, maxY: 150 })
    expect(flyBounds(bounds, [])).toEqual(bounds)
  })

  it('is null only when there is nothing at all to fly to', () => {
    expect(flyBounds(null, [])).toBeNull()
  })
})
