// @vitest-environment jsdom
/**
 * Owner ruling 2026-10-28: 移动团队边框时，成员节点不跟随移动 — a frame
 * ALWAYS moves only itself. The four new pins (supervisor order
 * direct-fa59f90a, spec item ④):
 *   ① drag → member coordinates unchanged (world-level, beyond the DOM pin)
 *   ② nudge → selected cards move, no frame follows; and no carry path exists
 *   ③ resize → rect changes, members unchanged
 *   ④ settleBoard step-yield → the YIELDING frame's members stay
 */
import { describe, expect, it } from 'vitest'
import { WorldModel, NODE_W, NODE_H } from '../src/world.ts'
import { separateFrames, OVERLAP_GAP } from '../src/planning-overlap.ts'

function modelWithFrameAndMember(): { m: WorldModel; memberX: () => number } {
  const m = new WorldModel()
  m.setFrame('T', { x: 0, y: 0, w: 400, h: 200 })
  m.upsertNode({ id: 'm1', x: 100, y: 100, label: 'M1', team: 'dsh/m1111111', live: true, memberships: [{ team: 'T' }] })
  m.setTeamMembers('T', ['m1'])
  return { m, memberX: () => m.getNode('m1')!.x }
}

describe('owner ruling: a frame moves only itself', () => {
  it('① frame drag: member coordinates unchanged', () => {
    const { m, memberX } = modelWithFrameAndMember()
    const before = memberX()
    const snap = m.beginFrameDrag('T')!
    m.applyFrameDrag(snap, 120, 60)
    expect(m.getFrame('T')).toEqual({ x: 120, y: 60, w: 400, h: 200 })
    expect(memberX()).toBe(before)
  })

  it('② nudge: selected cards move; no frame and no member carry exists', () => {
    const { m, memberX } = modelWithFrameAndMember()
    const before = memberX()
    // Nudge moves CARDS by ids — a frame is never in that id set; prove no
    // carry path: nudging the member does not move the frame either.
    m.nudge(['m1'], 8, 0)
    expect(m.getFrame('T')).toEqual({ x: 0, y: 0, w: 400, h: 200 })
    expect(memberX()).toBe(before + 8) // the nudged card itself moved 8
  })

  it('③ frame-resize semantics: only the rect changes; members unchanged', () => {
    const { m, memberX } = modelWithFrameAndMember()
    const before = memberX()
    // Resize mutates the rect directly (the view's frame-resize gesture); no
    // member path exists anywhere in that gesture.
    m.setFrame('T', { x: 0, y: 0, w: 500, h: 260 })
    expect(m.getFrame('T')).toEqual({ x: 0, y: 0, w: 500, h: 260 })
    expect(memberX()).toBe(before)
    expect(NODE_W).toBe(172) // card geometry contract intact
    expect(NODE_H).toBe(56)
  })

  it('④ settleBoard step-yield: the YIELDING frame moves, its members stay', () => {
    const m = new WorldModel()
    m.setFrame('X', { x: 0, y: 0, w: 400, h: 200 })
    m.setFrame('Y', { x: 300, y: 50, w: 400, h: 200 }) // overlaps X
    m.upsertNode({ id: 'y1', x: 500, y: 150, label: 'Y1', team: 'dsh/y1111111', live: true, memberships: [{ team: 'Y' }] })
    m.setTeamMembers('Y', ['y1'])
    separateFrames(m, new Set())
    // Y yielded (later in board order); the frame moved, y1 did NOT.
    expect(m.getFrame('Y')!.x).toBe(400 + OVERLAP_GAP)
    expect(m.getNode('y1')!.x).toBe(500)
  })
})
