/**
 * Canvas action algebra: optimistic apply + team-scoped undo for the five
 * write actions (cross-team memberships preserved, priority indexes
 * renormalized), the reorder walk's exact op sequence, y-ordered members,
 * and innermost-frame hit-testing.
 */
import { describe, expect, it } from 'vitest'
import { applyAction, innermostFrameAt, reorderOps, yOrderedMembers } from '../nexus-stage/src/canvas-ops.ts'
import { buildWorld, type FrameGeom } from '../nexus-stage/src/world.ts'

function model() {
  const sessions = [
    { id: 'a', label: 'A', team: 't/a', joined: true, live: true },
    { id: 'b', label: 'B', team: 't/b', joined: true, live: true },
    { id: 'c', label: 'C', team: 't/c', joined: true, live: true },
    { id: 'd', label: 'D', team: 't/d', joined: true, live: false },
  ]
  return buildWorld({
    sessions,
    teams: [],
    // Pinned seats so y-ordering is deterministic.
    layout: { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, c: { x: 200, y: 50 }, d: { x: 300, y: 300 } }, frames: {} },
  })
}

describe('applyAction + scoped undo', () => {
  it('create-team derives a frame and sets membership order; undo removes both', () => {
    const m = model()
    const undo = applyAction(m, { type: 'create-team', name: '先锋', ids: ['c', 'a'] })
    expect(m.teamMemberIds('先锋')).toEqual(['c', 'a']) // given order = priority
    expect(m.getFrame('先锋')).toBeDefined()
    undo()
    expect(m.teamMemberIds('先锋')).toEqual([])
    expect(m.getFrame('先锋')).toBeUndefined()
  })

  it('add-member appends without touching cross-team memberships', () => {
    const m = model()
    applyAction(m, { type: 'create-team', name: '甲', ids: ['a', 'b'] })
    applyAction(m, { type: 'add-member', team: '甲', ids: ['d'] })
    expect(m.teamMemberIds('甲')).toEqual(['a', 'b', 'd'])
    // a is also in 乙; 乙 roster untouched by 甲's membership change.
    applyAction(m, { type: 'create-team', name: '乙', ids: ['a', 'c'] })
    applyAction(m, { type: 'remove-member', team: '甲', ids: ['a'] })
    expect(m.teamMemberIds('乙')).toEqual(['a', 'c'])
    expect(m.getNode('a')!.memberships.map(x => x.team)).toEqual(['乙'])
  })

  it('renormalizes priority indexes to 0..n-1 after every mutation', () => {
    const m = model()
    applyAction(m, { type: 'create-team', name: '甲', ids: ['a', 'b', 'c'] })
    applyAction(m, { type: 'remove-member', team: '甲', ids: ['a'] })
    const indexes = m.teamMemberIds('甲').map(id => m.getNode(id)!.memberships.find(x => x.team === '甲')!.index)
    expect(indexes).toEqual([0, 1])
    const badges = m.teamMemberIds('甲').map(id => `P${m.getNode(id)!.memberships.find(x => x.team === '甲')!.index}`)
    expect(badges).toEqual(['P0', 'P1'])
  })

  it('remove-team undo restores roster AND the exact frame rect', () => {
    const m = model()
    applyAction(m, { type: 'create-team', name: '甲', ids: ['a', 'b'] })
    const rect = { ...m.getFrame('甲')! }
    const undo = applyAction(m, { type: 'remove-team', name: '甲' })
    expect(m.getFrame('甲')).toBeUndefined()
    expect(m.teamMemberIds('甲')).toEqual([])
    undo()
    expect(m.teamMemberIds('甲')).toEqual(['a', 'b'])
    expect(m.getFrame('甲')).toEqual(rect)
  })

  it('queued actions survive an earlier action\'s failure undo', () => {
    const m = model()
    const undo1 = applyAction(m, { type: 'add-member', team: '甲', ids: ['a'] })
    const undo2 = applyAction(m, { type: 'add-member', team: '甲', ids: ['b'] })
    // First write fails and rolls back; the second (queued) must survive.
    undo1()
    expect(m.teamMemberIds('甲')).toEqual(['b'])
    expect(() => undo2()).not.toThrow()
  })
})

describe('reorderOps walk', () => {
  it('produces the exact remove+add sequence for a rotation', () => {
    expect(reorderOps(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([
      { op: 'remove', id: 'c' }, { op: 'add', id: 'c' },
      { op: 'remove', id: 'a' }, { op: 'add', id: 'a' },
      { op: 'remove', id: 'b' }, { op: 'add', id: 'b' },
    ])
  })

  it('emits zero ops for an already-equal roster', () => {
    expect(reorderOps(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('skips desired ids that are not current members (never adds)', () => {
    expect(reorderOps(['a'], ['a', 'ghost'])).toEqual([])
  })

  it('promote-to-top is a reorder with the id moved to the front', () => {
    const current = ['a', 'b', 'c']
    const desired = ['c', ...current.filter(x => x !== 'c')]
    expect(reorderOps(current, desired)).toEqual([
      { op: 'remove', id: 'c' }, { op: 'add', id: 'c' },
      { op: 'remove', id: 'a' }, { op: 'add', id: 'a' },
      { op: 'remove', id: 'b' }, { op: 'add', id: 'b' },
    ])
  })
})

describe('yOrderedMembers + innermostFrameAt', () => {
  it('orders members by card-center y with current-index tiebreak', () => {
    const m = model()
    applyAction(m, { type: 'create-team', name: '甲', ids: ['b', 'a', 'c'] })
    // y: a=0, c=50, b=100 → y order wins over the b,a,c roster order.
    expect(yOrderedMembers(m, '甲')).toEqual(['a', 'c', 'b'])
  })

  it('hits the innermost (smallest) containing frame regardless of map order', () => {
    const frames = new Map<string, FrameGeom>([
      ['big', { x: 0, y: 0, w: 500, h: 500 }],
      ['small', { x: 100, y: 100, w: 100, h: 100 }],
    ])
    expect(innermostFrameAt(frames, { x: 150, y: 150 })).toBe('small')
    expect(innermostFrameAt(frames, { x: 40, y: 40 })).toBe('big')
    expect(innermostFrameAt(frames, { x: 999, y: 999 })).toBeUndefined()
  })
})
