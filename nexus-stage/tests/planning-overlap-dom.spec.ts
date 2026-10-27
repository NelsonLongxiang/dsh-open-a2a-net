// @vitest-environment jsdom
/**
 * Overlap rules on the live board (owner 2026-10-27): a board that loads
 * overlapped is shown settled (and not saved without a user action); a
 * frame dragged onto another stays where it was dropped while the other
 * yields; 整理成员 growing a frame into its neighbour pushes the neighbour.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'
import { NODE_W, NODE_H } from '../src/world.ts'

const ptr = (o: Partial<SeamPointer>): SeamPointer =>
  ({ button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o })
const rectOf = (v: { root: HTMLElement }, name: string) => {
  const el = v.root.querySelector<HTMLElement>(`.p-frame[data-name="${name}"]`)!
  const n = (s: string) => Number(s.replace('px', ''))
  return { x: n(el.style.left), y: n(el.style.top), w: n(el.style.width), h: n(el.style.height) }
}
const cardOf = (v: { root: HTMLElement }, id: string) => {
  const el = v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!
  return { x: Number(el.style.left.replace('px', '')), y: Number(el.style.top.replace('px', '')), w: NODE_W, h: NODE_H }
}
const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const input: PlanningInput = {
  sessions: [
    { id: 'a', label: 'A', team: 'dsh/aaaaaaaa', name: 'alpha', joined: true, live: true },
    { id: 'b', label: 'B', team: 'dsh/bbbbbbbb', name: 'beta', joined: true, live: true },
    { id: 's', label: 'S', team: 'dsh/ssssssss', name: 'stray', joined: true, live: true },
  ],
  teams: [
    { name: 'T1', team: 'dsh/canvas/T1', members: [{ id: 'a' }] },
    { name: 'T2', team: 'dsh/canvas/T2', members: [{ id: 'b' }, { id: 's' }] },
  ],
  peerCount: 0, peers: [], inFlight: [], remoteTeams: [],
}

function bench(layout: { nodes: Record<string, { x: number; y: number }>; frames: Record<string, { x: number; y: number; w: number; h: number }> }) {
  const onDirty = vi.fn()
  const v = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => 1000, viewSize: () => ({ w: 1600, h: 1000 }) })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, ...layout })
  v.reconcile(input)
  return { v, onDirty }
}

describe('overlap rules on the board', () => {
  it('a board that loads with overlapping frames is shown separated, without an unsolicited save', () => {
    const { v, onDirty } = bench({
      nodes: { a: { x: 100, y: 100 }, b: { x: 450, y: 120 }, s: { x: 900, y: 600 } },
      frames: { T1: { x: 0, y: 0, w: 400, h: 220 }, T2: { x: 300, y: 40, w: 400, h: 220 } },
    })
    expect(hit(rectOf(v, 'T1'), rectOf(v, 'T2'))).toBe(false)
    expect(onDirty).not.toHaveBeenCalled()
  })

  it('a frame dropped onto another stays put; the other steps aside; a card left on a foreign frame moves off', () => {
    const { v, onDirty } = bench({
      nodes: { a: { x: 100, y: 100 }, b: { x: 1100, y: 120 }, s: { x: 1150, y: 160 } },
      frames: { T1: { x: 0, y: 0, w: 400, h: 220 }, T2: { x: 1000, y: 0, w: 400, h: 220 } },
    })
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="T2"]')!
    v.seam.pointerDown(ptr({ target: head, clientX: 1200, clientY: 10 }))
    v.seam.pointerMove(ptr({ target: head, clientX: 500, clientY: 30 })) // T2 lands over T1
    v.seam.pointerUp(ptr({ target: head, clientX: 500, clientY: 30 }))
    const t2 = rectOf(v, 'T2')
    expect(t2.x).toBe(300) // where it was dropped
    expect(hit(rectOf(v, 'T1'), t2)).toBe(false)
    // T1's member moved with T1; no card sits on a frame it is not in.
    const a = cardOf(v, 'a')
    expect(hit(a, rectOf(v, 'T1'))).toBe(true)
    expect(hit(a, t2)).toBe(false)
    expect(onDirty).toHaveBeenCalled()
  })
})
