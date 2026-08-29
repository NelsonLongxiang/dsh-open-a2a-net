/**
 * Star membership edges: the origin anchor is the centered titlebar's
 * bottom-edge midpoint, the target the member card's top-edge midpoint,
 * a member's second-and-later spokes go dashed (many-to-many invariant),
 * and dangling ids / missing frames are skipped silently.
 */
import { describe, expect, it } from 'vitest'
import { FRAME_HEAD_LIFT, starEdges } from '../nexus-stage/src/edges.ts'
import { NODE_H, type FrameGeom } from '../nexus-stage/src/world.ts'

const frames = new Map<string, FrameGeom>([
  ['alpha', { x: 100, y: 200, w: 400, h: 300 }],
  ['beta', { x: 600, y: 200, w: 300, h: 300 }],
])
const positions = new Map([
  ['s1', { x: 150, y: 400 }],
  ['s2', { x: 400, y: 400 }],
  ['s3', { x: 700, y: 400 }],
])

describe('star edges', () => {
  it('anchors at the titlebar bottom midpoint and the card top midpoint', () => {
    const edges = starEdges([{ name: 'alpha', members: [{ id: 's1' }] }], frames, positions)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.x1).toBe(100 + 400 / 2)
    expect(edges[0]!.y1).toBe(200 + FRAME_HEAD_LIFT)
    expect(edges[0]!.x2).toBe(150)
    expect(edges[0]!.y2).toBe(400 - NODE_H / 2)
    expect(edges[0]!.dashed).toBe(false)
  })

  it('dashes the second and later membership of a cross-team member', () => {
    const edges = starEdges(
      [
        { name: 'alpha', members: [{ id: 's2' }] },
        { name: 'beta', members: [{ id: 's2' }, { id: 's3' }] },
      ],
      frames,
      positions,
    )
    expect(edges.map(e => e.dashed)).toEqual([false, true, false])
    expect(edges[1]!.team).toBe('beta')
  })

  it('skips dangling member ids and teams without a frame', () => {
    const edges = starEdges(
      [
        { name: 'alpha', members: [{ id: 'ghost' }, { id: 's1' }] },
        { name: '无框队', members: [{ id: 's1' }] },
      ],
      frames,
      positions,
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]!.id).toBe('s1')
  })

  it('determinism: same input, same edge list', () => {
    const teams = [{ name: 'alpha', members: [{ id: 's1' }, { id: 's2' }] }]
    expect(starEdges(teams, frames, positions)).toEqual(starEdges(teams, frames, positions))
  })
})
