// @vitest-environment jsdom
/**
 * gh#48 one-click member tidy (owner order, review-seat spec):
 *   ① sole-team members re-seat into a padded grid INSIDE their frame
 *      (bbox containment);
 *   ② multi-team members (≥2 memberships) keep their coordinates;
 *   ③ idempotent — pressing tidy twice yields the same layout;
 *   ④ an empty frame (or one holding only shared members) is untouched.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'
import { NODE_W, NODE_H } from '../src/world.ts'

function ptr(o: Partial<SeamPointer>): SeamPointer {
  return { button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o }
}

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

const input: PlanningInput = {
  sessions: [
    { id: 'a', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true },
    { id: 'b', label: 'B', team: 'dsh/bbbbbbbb', name: 'beta', joined: true, live: true },
    { id: 'c', label: 'C', team: 'dsh/cccccccc', name: 'gamma', joined: true, live: true },
  ],
  teams: [
    { name: 'T1', team: 'dsh/canvas/T1', members: [{ id: 'a' }, { id: 'b' }] },
    { name: 'T2', team: 'dsh/canvas/T2', members: [{ id: 'b' }, { id: 'c' }] },
  ],
  peerCount: 0,
  peers: [],
  inFlight: [],
  remoteTeams: [],
}

function bench(onDirty = vi.fn()) {
  const v = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 }, b: { x: 900, y: 900 }, c: { x: 500, y: 500 } }, frames: { T1: { x: 0, y: 0, w: 460, h: 300 }, T2: { x: 600, y: 0, w: 460, h: 300 } } })
  v.reconcile(input)
  return { v, onDirty }
}

function tidy(v: { root: HTMLElement }): void {
  const btn = [...v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')].find(b => b.textContent === '整理成员')!
  btn.click()
}

describe('gh#48 one-click member tidy', () => {
  it('① sole-team members land inside their frame; ② the shared member never moves', () => {
    const { v } = bench()
    const bBefore = nodeOf(v, 'b')
    tidy(v)
    const f1 = frameOf(v, 'T1')
    const f2 = frameOf(v, 'T2')
    const a = nodeOf(v, 'a')
    const c = nodeOf(v, 'c')
    // a is sole in T1: its card sits within the T1 frame's bbox.
    expect(a.x).toBeGreaterThanOrEqual(f1.x)
    expect(a.x).toBeLessThanOrEqual(f1.x + f1.w)
    expect(a.y).toBeGreaterThanOrEqual(f1.y)
    expect(a.y).toBeLessThanOrEqual(f1.y + f1.h)
    // c is sole in T2: inside T2.
    expect(c.x).toBeGreaterThanOrEqual(f2.x)
    expect(c.x).toBeLessThanOrEqual(f2.x + f2.w)
    expect(c.y).toBeGreaterThanOrEqual(f2.y)
    expect(c.y).toBeLessThanOrEqual(f2.y + f2.h)
    // b belongs to BOTH: coordinates unchanged.
    expect(nodeOf(v, 'b')).toEqual(bBefore)
  })

  it('③ idempotent: a second press leaves the layout stable', () => {
    const { v } = bench()
    tidy(v)
    const a1 = nodeOf(v, 'a')
    const c1 = nodeOf(v, 'c')
    const f1 = frameOf(v, 'T1')
    tidy(v)
    expect(nodeOf(v, 'a')).toEqual(a1)
    expect(nodeOf(v, 'c')).toEqual(c1)
    expect(frameOf(v, 'T1')).toEqual(f1)
  })

  it('④ a frame whose members are all shared (or none) is untouched', () => {
    // b belongs to BOTH T1 and T2 (2 memberships); only T1 has a frame —
    // T1's sole listed member is shared, so the tidy must skip it entirely.
    const onlyShared: PlanningInput = {
      ...input,
      teams: [
        { name: 'T1', team: 'dsh/canvas/T1', members: [{ id: 'b' }] },
        { name: 'T2', team: 'dsh/canvas/T2', members: [{ id: 'b' }] },
      ],
    }
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { b: { x: 900, y: 900 } }, frames: { T1: { x: 0, y: 0, w: 460, h: 300 } } })
    v.reconcile(onlyShared)
    const bBefore = nodeOf(v, 'b')
    const fBefore = frameOf(v, 'T1')
    tidy(v)
    expect(nodeOf(v, 'b')).toEqual(bBefore)
    expect(frameOf(v, 'T1')).toEqual(fBefore)
  })
})
