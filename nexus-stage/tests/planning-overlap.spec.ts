/**
 * Board overlap rules (owner 2026-10-27: 团队方框需要避免遮盖和覆盖):
 * frames never overlap, and no card sits on a frame it does not belong to.
 */
import { describe, expect, it } from 'vitest'
import { evictStrangers, OVERLAP_GAP, separateFrames, settleBoard } from '../src/planning-overlap.ts'
import { NODE_H, NODE_W, nodeRect, WorldModel, type WorldNode } from '../src/world.ts'

const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const node = (id: string, x: number, y: number, over: Partial<WorldNode> = {}): WorldNode =>
  ({ id, x, y, label: id, team: `dsh/${id}`, live: true, memberships: [], ...over })

function board(): WorldModel {
  const m = new WorldModel()
  m.setFrame('A', { x: 0, y: 0, w: 400, h: 200 })
  m.setFrame('B', { x: 300, y: 50, w: 400, h: 200 }) // overlaps A by 100 px horizontally
  m.upsertNode(node('a1', 100, 100))
  m.upsertNode(node('b1', 500, 150))
  m.setTeamMembers('A', ['a1'])
  m.setTeamMembers('B', ['b1'])
  return m
}
const noOverlaps = (m: WorldModel): boolean => {
  const f = m.allFrames()
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (hit(f[i]![1], f[j]![1])) return false
  return true
}

describe('planning-overlap', () => {
  it('overlapping frames are separated by the shortest step; the moved frame carries NO members (owner ruling 2026-10-28)', () => {
    const m = board()
    expect(separateFrames(m, new Set())).toBe(true)
    expect(noOverlaps(m)).toBe(true)
    // B (later in board order) stepped right by 100 + gap; its member STAYS.
    expect(m.getFrame('B')).toEqual({ x: 400 + OVERLAP_GAP, y: 50, w: 400, h: 200 })
    expect(m.getNode('b1')!.x).toBe(500) // unchanged — a frame moves only itself
    expect(m.getNode('a1')!.x).toBe(100) // untouched frame's member untouched
    expect(m.getFrame('A')).toEqual({ x: 0, y: 0, w: 400, h: 200 })
  })

  it('the frame just placed stays; the one it landed on yields', () => {
    const m = board()
    separateFrames(m, new Set(), 'B')
    expect(m.getFrame('B')).toEqual({ x: 300, y: 50, w: 400, h: 200 })
    expect(noOverlaps(m)).toBe(true)
    expect(m.getFrame('A')!.x).toBe(300 - OVERLAP_GAP - 400)
  })

  it('a remote org frame never moves on its own; a local frame yields to it, even when just placed', () => {
    const m = board()
    separateFrames(m, new Set(['A']), 'B')
    expect(m.getFrame('A')).toEqual({ x: 0, y: 0, w: 400, h: 200 })
    expect(noOverlaps(m)).toBe(true)
    // Two remote frames are left alone (not ours to move).
    const r = board()
    expect(separateFrames(r, new Set(['A', 'B']))).toBe(false)
  })

  it('a just-placed local frame yields to a remote frame whichever was added first (PR #83 review)', () => {
    for (const order of [['L', 'R'], ['R', 'L']] as const) {
      const m = new WorldModel()
      const rect = { L: { x: 300, y: 50, w: 400, h: 200 }, R: { x: 0, y: 0, w: 400, h: 200 } }
      for (const name of order) m.setFrame(name, rect[name])
      m.upsertNode(node('r1', 100, 100))
      m.setTeamMembers('R', ['r1'])
      separateFrames(m, new Set(['R']), 'L')
      expect(m.getFrame('R')).toEqual({ x: 0, y: 0, w: 400, h: 200 })
      expect(m.getNode('r1')!.x).toBe(100)
      expect(noOverlaps(m)).toBe(true)
    }
  })

  it('a chain of overlaps settles with no overlap left', () => {
    const m = new WorldModel()
    for (let i = 0; i < 6; i++) m.setFrame(`F${i}`, { x: i * 50, y: i * 30, w: 300, h: 160 })
    separateFrames(m, new Set())
    expect(noOverlaps(m)).toBe(true)
  })

  it('a card with no frame of its own moves just outside the frame it sat on; members stay', () => {
    const m = board()
    m.setFrame('B', { x: 900, y: 0, w: 400, h: 200 }) // no frame overlap now
    m.dragNodes(['b1'], 500, -50) // keep B's member inside B, off the landing spot (upsert never repositions)
    m.upsertNode(node('peer-x', 200, 120, { remote: true }))
    m.upsertNode(node('a2', 150, 60))
    m.setTeamMembers('A', ['a1', 'a2'])
    expect(evictStrangers(m)).toBe(true)
    const peer = m.getNode('peer-x')!
    expect(hit(nodeRect(peer), m.getFrame('A')!)).toBe(false)
    expect(peer.x).toBe(400 + OVERLAP_GAP + NODE_W / 2) // right of A, same height
    expect([m.getNode('a1')!.x, m.getNode('a2')!.x]).toEqual([100, 150])
    // Idempotent: nothing left to move.
    expect(evictStrangers(m)).toBe(false)
  })

  it('when the right side is taken by another frame, the card goes below instead', () => {
    const m = new WorldModel()
    m.setFrame('A', { x: 0, y: 0, w: 400, h: 200 })
    m.setFrame('C', { x: 400 + OVERLAP_GAP, y: 0, w: 400, h: 400 })
    m.upsertNode(node('stray', 200, 100))
    evictStrangers(m)
    const s = m.getNode('stray')!
    expect(s.y).toBe(200 + OVERLAP_GAP + NODE_H / 2)
    for (const [, f] of m.allFrames()) expect(hit(nodeRect(s), f)).toBe(false)
  })

  it('settleBoard does both and is stable on a second press', () => {
    const m = board()
    m.upsertNode(node('stray', 350, 120))
    expect(settleBoard(m, new Set())).toBe(true)
    expect(noOverlaps(m)).toBe(true)
    for (const n of m.allNodes()) {
      const own = new Set(n.memberships.map(x => x.team))
      for (const [name, f] of m.allFrames()) if (!own.has(name)) expect(hit(nodeRect(n), f)).toBe(false)
    }
    expect(settleBoard(m, new Set())).toBe(false)
  })

  describe('home first, never stacked (PR#85 follow-up)', () => {
    const inside = (m: WorldModel, id: string, f: string): boolean => {
      const r = nodeRect(m.getNode(id)!), g = m.getFrame(f)!
      return r.x >= g.x && r.y >= g.y && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h
    }
    const noCardOverlaps = (m: WorldModel): boolean => {
      const ns = m.allNodes()
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (hit(nodeRect(ns[i]!), nodeRect(ns[j]!))) return false
      return true
    }
    function dropAOnB(): WorldModel {
      const m = new WorldModel()
      m.setFrame('A', { x: 0, y: 0, w: 400, h: 240 })
      m.setFrame('B', { x: 600, y: 0, w: 400, h: 240 })
      m.upsertNode(node('a1', 120, 100))
      m.upsertNode(node('b1', 720, 100))
      m.upsertNode(node('b2', 880, 100))
      m.setTeamMembers('A', ['a1'])
      m.setTeamMembers('B', ['b1', 'b2'])
      const snap = m.beginFrameDrag('A')!
      m.applyFrameDrag(snap, 500, 0) // the user drops A onto B (the rect only, PR#85)
      return m
    }

    it('dropping a frame onto another: the yielding frame\'s members go back inside it, not stacked beside the dropped one', () => {
      const m = dropAOnB()
      settleBoard(m, new Set(), 'A')
      expect(noOverlaps(m)).toBe(true)
      expect(inside(m, 'b1', 'B')).toBe(true)
      expect(inside(m, 'b2', 'B')).toBe(true)
      expect(noCardOverlaps(m)).toBe(true)
      expect(settleBoard(m, new Set(), 'A')).toBe(false) // stable
    })

    it('eviction never moves or resizes a frame, and leaves a member merely outside its own frame alone', () => {
      const m = dropAOnB()
      separateFrames(m, new Set(), 'A')
      const before = new Map(m.allFrames().map(([k, f]) => [k, { ...f }]))
      evictStrangers(m)
      for (const [k, f] of m.allFrames()) expect(f).toEqual(before.get(k))
      expect(m.getNode('a1')!.x).toBe(120) // left behind by A's drag (PR#85): not a stranger anywhere, untouched
      expect(inside(m, 'a1', 'A')).toBe(false)
    })

    it('a card in two frames goes to the first of its memberships (state order), whatever the frame order', () => {
      for (const order of [['H', 'K'], ['K', 'H']]) {
        const m = new WorldModel()
        m.setFrame('S', { x: 0, y: 0, w: 400, h: 240 })
        for (const k of order) m.setFrame(k, k === 'H' ? { x: 600, y: 0, w: 400, h: 240 } : { x: 0, y: 400, w: 400, h: 240 })
        m.upsertNode(node('x', 200, 120, { memberships: [{ team: 'K', index: 0 }, { team: 'H', index: 0 }] }))
        evictStrangers(m)
        expect(inside(m, 'x', 'K')).toBe(true)
      }
    })

    it('a remote frame\'s member follows the same rule', () => {
      const m = new WorldModel()
      m.setFrame('local', { x: 0, y: 0, w: 400, h: 240 })
      m.setFrame('org-remote', { x: 600, y: 0, w: 400, h: 240 })
      m.upsertNode(node('r1', 200, 120, { remote: true }))
      m.setTeamMembers('org-remote', ['r1'])
      evictStrangers(m)
      expect(inside(m, 'r1', 'org-remote')).toBe(true)
    })

    it('a full home frame sends the card outside, and two strangers never land on the same spot', () => {
      const m = new WorldModel()
      m.setFrame('A', { x: 0, y: 0, w: 400, h: 240 })
      m.setFrame('T', { x: 600, y: 0, w: 120, h: 60 }) // too small for any seat
      m.upsertNode(node('s1', 150, 100))
      m.upsertNode(node('s2', 250, 160))
      m.setTeamMembers('T', ['s1'])
      evictStrangers(m)
      for (const id of ['s1', 's2']) for (const [name, f] of m.allFrames()) if (!(id === 's1' && name === 'T')) expect(hit(nodeRect(m.getNode(id)!), f)).toBe(false)
      expect(noCardOverlaps(m)).toBe(true)
    })

    it('a crowded board still ends: every stranger finds a free spot, none stacked', () => {
      const m = new WorldModel()
      m.setFrame('A', { x: 0, y: 0, w: 400, h: 240 })
      m.setFrame('R', { x: 400 + OVERLAP_GAP, y: 0, w: 400, h: 2000 }) // blocks the right side
      for (let i = 0; i < 12; i++) m.upsertNode(node(`s${i}`, 100 + (i % 3) * 100, 60 + Math.floor(i / 3) * 40))
      expect(evictStrangers(m)).toBe(true)
      for (const n of m.allNodes()) for (const [, f] of m.allFrames()) expect(hit(nodeRect(n), f)).toBe(false)
      expect(noCardOverlaps(m)).toBe(true)
    })
  })
})
