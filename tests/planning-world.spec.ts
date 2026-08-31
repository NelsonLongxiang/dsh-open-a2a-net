/**
 * Planning-canvas world model: saved-layout precedence with deterministic
 * 2D seat fallback on the same world spot the 3D grid shows ({x, seatFor.z}),
 * malformed-layout fallthrough, derived initial frame geometry, group drag
 * from snapshots, marquee hit-testing, content bounds, and the host-mirror
 * clamp vectors both sides must answer identically.
 */
import { describe, expect, it } from 'vitest'
import { buildLayoutDoc, clampDoc, COORD_LIMIT, LAYOUT_FRAME_CAP, LAYOUT_NODE_CAP, SCALE_MAX } from '../nexus-stage/src/layout-doc.ts'
import { NODE_H, NODE_W, buildWorld, deriveInitialFrame, nodeRect, planSeatFor, type SessionLite, type TeamLite } from '../nexus-stage/src/world.ts'

const sessions: SessionLite[] = [
  { id: 's1', label: 'scout', team: 'dsh/1', name: 'scout-01', joined: true, live: true },
  { id: 's2', label: 'analyst', team: 'dsh/2', name: 'analyst-02', joined: true, live: true },
  { id: 's3', label: 'review', team: 'dsh/3', joined: true, live: false },
  { id: 's4', label: 'gone', team: 'dsh/4', joined: false, live: true },
]
const teams: TeamLite[] = [
  { name: '选品', members: [{ id: 's1' }, { id: 's2' }] },
  { name: '采购', members: [{ id: 's2' }, { id: 's3' }] },
]

describe('buildWorld', () => {
  it('lets saved layout win and falls back to the card-scaled ring seat', () => {
    const m = buildWorld({
      sessions,
      teams,
      layout: { version: 1, viewport: { x: 5, y: 6, scale: 2 }, nodes: { s1: { x: -70, y: 80 } }, frames: { 采购: { x: 0, y: 0, w: 300, h: 200 } } },
    })
    expect(m.getNode('s1')?.x).toBe(-70)
    expect(m.getNode('s1')?.y).toBe(80)
    const seat = planSeatFor('s2')
    expect(m.getNode('s2')?.x).toBe(seat.x)
    expect(m.getNode('s2')?.y).toBe(seat.y)
    expect(m.getFrame('采购')).toEqual({ x: 0, y: 0, w: 300, h: 200 })
    expect(m.viewport).toEqual({ x: 5, y: 6, scale: 2 })
  })

  it('drops unjoined rows and records memberships in state order', () => {
    const m = buildWorld({ sessions, teams, layout: null })
    expect(m.getNode('s4')).toBeUndefined()
    expect(m.getNode('s2')?.memberships).toEqual([
      { team: '选品', index: 1 },
      { team: '采购', index: 0 },
    ])
    expect(m.getNode('s3')?.live).toBe(false)
  })

  it('derives initial frames from member cards and skips empty frames without rects', () => {
    const m = buildWorld({ sessions, teams, layout: null })
    const r1 = m.getFrame('选品')!
    const a = nodeRect(m.getNode('s1')!)
    const b = nodeRect(m.getNode('s2')!)
    expect(r1.x).toBeLessThanOrEqual(Math.min(a.x, b.x))
    expect(r1.w).toBeGreaterThanOrEqual(Math.abs(a.x - b.x) + NODE_W)
    expect(m.allFrames().length).toBe(2)
    const empty = buildWorld({ sessions, teams: [{ name: '空队', members: [] }], layout: null })
    expect(empty.getFrame('空队')).toBeUndefined()
  })

  it('treats a malformed layout as absent (seat fallback), not as an error', () => {
    const m = buildWorld({ sessions, teams, layout: { version: 2, junk: true } })
    expect(m.viewport).toEqual({ x: 0, y: 0, scale: 1 })
    expect(m.getNode('s1')?.x).toBe(planSeatFor('s1').x)
  })
})

describe('group drag', () => {
  it('moves the frame rect and member centers from the pointerdown snapshot', () => {
    const m = buildWorld({ sessions, teams, layout: null })
    // Copies, not references - applyFrameDrag mutates the live geometry.
    const before = { ...m.getFrame('选品')! }
    const s1 = { ...m.getNode('s1')! }
    const s3 = { ...m.getNode('s3')! } // non-member: must stay put
    const snap = m.beginFrameDrag('选品')!
    m.applyFrameDrag(snap, 30, -20)
    const after = m.getFrame('选品')!
    expect(after.x).toBeCloseTo(before.x + 30, 9)
    expect(after.y).toBeCloseTo(before.y - 20, 9)
    expect(m.getNode('s1')!.x).toBeCloseTo(s1.x + 30, 9)
    expect(m.getNode('s1')!.y).toBeCloseTo(s1.y - 20, 9)
    // The non-member node's position is untouched by the group drag.
    expect(m.getNode('s3')!.x).toBeCloseTo(s3.x, 9)
    expect(m.getNode('s3')!.y).toBeCloseTo(s3.y, 9)
  })

  it('repeated applies from the same snapshot do not drift', () => {
    const m = buildWorld({ sessions, teams, layout: null })
    const snap = m.beginFrameDrag('选品')!
    const centerBefore = { x: m.getNode('s1')!.x, y: m.getNode('s1')!.y }
    for (let i = 1; i <= 50; i++) m.applyFrameDrag(snap, i * 0.1, i * 0.1)
    expect(m.getNode('s1')!.x).toBeCloseTo(centerBefore.x + 5, 6)
  })

  it('returns undefined for an unknown frame', () => {
    const m = buildWorld({ sessions, teams, layout: null })
    expect(m.beginFrameDrag('不存在')).toBeUndefined()
  })
})

describe('selection', () => {
  it('marquee selects by card-rect intersection, additive on shift', () => {
    // Pinned seats: hash seats can land two cards inside one marquee.
    const m = buildWorld({
      sessions,
      teams,
      layout: { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { s1: { x: 0, y: 0 }, s2: { x: 500, y: 0 } }, frames: {} },
    })
    const n1 = nodeRect(m.getNode('s1')!)
    m.marqueeSelect({ x: n1.x - 10, y: n1.y - 10, w: NODE_W + 20, h: NODE_H + 20 }, false)
    expect(m.isSelected('s1')).toBe(true)
    expect(m.isSelected('s2')).toBe(false)
    const n2 = nodeRect(m.getNode('s2')!)
    m.marqueeSelect({ x: n2.x - 10, y: n2.y - 10, w: NODE_W + 20, h: NODE_H + 20 }, true)
    expect(m.isSelected('s1')).toBe(true)
    expect(m.isSelected('s2')).toBe(true)
    m.setSelection([])
    expect(m.selectedIds()).toEqual([])
  })

  it('nudges only the given ids and bumps the revision', () => {
    const m = buildWorld({ sessions, teams, layout: null })
    const rev0 = m.revision
    const y0 = m.getNode('s1')!.y
    m.nudge(['s1'], 8, -8)
    expect(m.getNode('s1')!.y).toBe(y0 - 8)
    expect(m.revision).toBeGreaterThan(rev0)
  })
})

describe('content bounds', () => {
  it('unions cards and frames; null when empty', () => {
    const empty = buildWorld({ sessions: [], teams: [], layout: null })
    expect(empty.contentBounds()).toBeNull()
    const m = buildWorld({ sessions, teams, layout: null })
    const b = m.contentBounds()!
    const n3 = nodeRect(m.getNode('s3')!)
    expect(b.maxX).toBeGreaterThanOrEqual(n3.x + NODE_W)
    expect(b.minY).toBeLessThanOrEqual(m.getFrame('选品')!.y)
  })
})

describe('host-mirror clamp vectors (both sides must agree)', () => {
  it('rejects non-v1 documents', () => {
    expect(clampDoc(null)).toBeUndefined()
    expect(clampDoc('x')).toBeUndefined()
    expect(clampDoc({ version: 2 })).toBeUndefined()
    expect(clampDoc({ version: 1 })).toBeUndefined() // missing viewport
  })

  it('clamps scale 99 -> 3 and out-of-range coords to ±1e6, rounding', () => {
    const doc = clampDoc({
      version: 1,
      viewport: { x: 0, y: 0, scale: 99 },
      nodes: { a: { x: 2e6, y: -2e6 }, b: { x: 1.6, y: 'junk' } },
      frames: {},
    })
    expect(doc?.viewport.scale).toBe(SCALE_MAX)
    expect(doc?.nodes.a).toEqual({ x: COORD_LIMIT, y: -COORD_LIMIT })
    expect(doc?.nodes.b).toBeUndefined() // non-finite member drops the point
  })

  it('drops frame keys mirroring team-name rules and non-positive rects', () => {
    const longName = ''.padEnd(41, '长')
    const doc = clampDoc({
      version: 1,
      viewport: { x: 0, y: 0, scale: 1 },
      nodes: {},
      frames: {
        'ok队': { x: 1, y: 2, w: 3, h: 4 },
        'a/b': { x: 0, y: 0, w: 1, h: 1 },
        [longName]: { x: 0, y: 0, w: 1, h: 1 },
        flat: { x: 0, y: 0, w: 0, h: 4 },
      },
    })
    expect(Object.keys(doc?.frames ?? {})).toEqual(['ok队'])
  })

  it('truncates beyond caps first-wins in insertion order', () => {
    const nodes: Record<string, { x: number; y: number }> = {}
    for (let i = 0; i < LAYOUT_NODE_CAP + 10; i++) nodes['n' + i] = { x: i, y: 0 }
    const frames: Record<string, { x: number; y: number; w: number; h: number }> = {}
    for (let i = 0; i < LAYOUT_FRAME_CAP + 5; i++) frames['f' + i] = { x: 0, y: 0, w: 1, h: 1 }
    const doc = clampDoc({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes, frames })
    expect(Object.keys(doc?.nodes ?? {}).length).toBe(LAYOUT_NODE_CAP)
    expect(Object.keys(doc?.frames ?? {}).length).toBe(LAYOUT_FRAME_CAP)
    expect(doc?.nodes.n0).toBeDefined()
    expect(doc?.nodes['n' + (LAYOUT_NODE_CAP + 9)]).toBeUndefined()
  })

  it('buildLayoutDoc pre-clamps so the payload is already host-normalized', () => {
    const nodes = new Map([['a', { x: 1.6, y: 2e6 }]])
    const frames = new Map([['队', { x: 0, y: 0, w: 10, h: 0 }]])
    const doc = buildLayoutDoc({ x: 0, y: 0, scale: 42 }, nodes, frames)
    expect(doc).toEqual({
      version: 1,
      viewport: { x: 0, y: 0, scale: 3 },
      nodes: { a: { x: 2, y: COORD_LIMIT } },
      frames: {},
    })
    // Fixpoint: re-clamping the built doc changes nothing.
    expect(clampDoc(doc)).toEqual(doc)
  })
})
