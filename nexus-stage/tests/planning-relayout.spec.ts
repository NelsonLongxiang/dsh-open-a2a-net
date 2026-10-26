// @vitest-environment jsdom
/**
 * Supervisor order v2 — 「一键重排」whole-board relayout (upgrades gh#48),
 * the review seat's six acceptance checks:
 *   ① every sole member's card bbox lands inside its frame
 *   ② local frames are pairwise disjoint
 *   ③ a multi-team member's coordinates are byte-identical after relayout
 *   ④ frame size follows content (a 3-member frame and a 6-member frame
 *      differ in width/height)
 *   ⑤ idempotent — a second press yields the identical layout
 *   ⑥ a remote org frame's coordinates are identical (untouched)
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'

const NOW = 72_400

function frameOf(v: { root: HTMLElement }, name: string): { x: number; y: number; w: number; h: number } {
  const el = v.root.querySelector<HTMLElement>(`.p-frame[data-name="${name}"]`)!
  return {
    x: Number(el.style.left.replace('px', '')),
    y: Number(el.style.top.replace('px', '')),
    w: Number(el.style.width.replace('px', '')),
    h: Number(el.style.height.replace('px', '')),
  }
}

function nodeOf(v: { root: HTMLElement }, id: string): { x: number; y: number } {
  const el = v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!
  return { x: Number(el.style.left.replace('px', '')), y: Number(el.style.top.replace('px', '')) }
}

function relayout(v: { root: HTMLElement }): void {
  const btn = [...v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')].find(b => b.textContent === '一键重排')!
  btn.click()
}

const sessions = (n: number, prefix = 's'): PlanningInput['sessions'] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, label: `${prefix.toUpperCase()}${i}`, team: `dsh/${prefix}0000${i}`, name: `node${i}`, joined: true, live: true }))

function bench(input: PlanningInput): ReturnType<typeof createPlanningView> {
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: {}, frames: {} })
  v.reconcile(input)
  return v
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('supervisor order v2 — one-click board relayout', () => {
  const base: PlanningInput = {
    sessions: [
      ...sessions(3, 'a'), // a0 a1 a2 → T3 (three sole members)
      ...sessions(6, 'b'), // b0..b5 → T6 (six sole members)
      { id: 'shared', label: 'SH', team: 'dsh/sh000000', name: 'shared', joined: true, live: true },
    ],
    teams: [
      { name: 'T3', team: 'dsh/canvas/T3', members: [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }, { id: 'shared' }] },
      { name: 'T6', team: 'dsh/canvas/T6', members: [{ id: 'b0' }, { id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }, { id: 'b5' }, { id: 'shared' }] },
    ],
    peerCount: 0,
  }

  it('① sole cards inside frames · ② frames pairwise disjoint · ③ shared member byte-identical', () => {
    const v = bench(base)
    const sharedBefore = nodeOf(v, 'shared')
    relayout(v)
    const f3 = frameOf(v, 'T3')
    const f6 = frameOf(v, 'T6')
    // ② disjoint local frames.
    expect(overlap(f3, f6)).toBe(false)
    // ① every sole member inside its frame's bbox.
    for (const id of ['a0', 'a1', 'a2']) {
      const p = nodeOf(v, id)
      expect(p.x).toBeGreaterThanOrEqual(f3.x)
      expect(p.x).toBeLessThanOrEqual(f3.x + f3.w)
      expect(p.y).toBeGreaterThanOrEqual(f3.y)
      expect(p.y).toBeLessThanOrEqual(f3.y + f3.h)
    }
    for (const id of ['b0', 'b1', 'b2', 'b3', 'b4', 'b5']) {
      const p = nodeOf(v, id)
      expect(p.x).toBeGreaterThanOrEqual(f6.x)
      expect(p.x).toBeLessThanOrEqual(f6.x + f6.w)
      expect(p.y).toBeGreaterThanOrEqual(f6.y)
      expect(p.y).toBeLessThanOrEqual(f6.y + f6.h)
    }
    // ③ the multi-team member never moved.
    expect(nodeOf(v, 'shared')).toEqual(sharedBefore)
  })

  it('④ size follows content: the 6-member frame is wider than the 3-member frame', () => {
    const v = bench(base)
    relayout(v)
    const f3 = frameOf(v, 'T3')
    const f6 = frameOf(v, 'T6')
    // ceil(sqrt(3)) = 2 cols vs ceil(sqrt(6)) = 3 cols (cap 4): widths differ.
    expect(f6.w).toBeGreaterThan(f3.w)
    // rows: ceil(3/2) = 2 vs ceil(6/3) = 2 → heights equal here; assert
    // the width gap is at least one card column.
    expect(f6.w - f3.w).toBeGreaterThanOrEqual(172 + 16)
  })

  it('⑤ idempotent: a second press leaves frames and cards stable', () => {
    const v = bench(base)
    relayout(v)
    const snap = {
      f3: frameOf(v, 'T3'), f6: frameOf(v, 'T6'),
      a0: nodeOf(v, 'a0'), b5: nodeOf(v, 'b5'), shared: nodeOf(v, 'shared'),
    }
    relayout(v)
    expect(frameOf(v, 'T3')).toEqual(snap.f3)
    expect(frameOf(v, 'T6')).toEqual(snap.f6)
    expect(nodeOf(v, 'a0')).toEqual(snap.a0)
    expect(nodeOf(v, 'b5')).toEqual(snap.b5)
    expect(nodeOf(v, 'shared')).toEqual(snap.shared)
  })

  it('⑥ a remote org frame keeps its coordinates', () => {
    const withRemote: PlanningInput = {
      ...base,
      peerCount: 1,
      peers: [{ url: 'http://peer:13080', session: 'peer-host', name: 'peer', teams: [] }],
      remoteTeams: [{ team: 'dsh/xxxx', name: 'x', description: '', via: 'http://peer:13080' }],
      peerOrg: [{ url: 'http://peer:13080', org: [{ name: 'RT', members: ['dsh/aaaa1111'] }] }],
    }
    const v = bench(withRemote)
    // The remote member card must exist for the remote frame to materialize.
    const before = frameOf(v, 'RT')
    relayout(v)
    expect(frameOf(v, 'RT')).toEqual(before)
  })
})
