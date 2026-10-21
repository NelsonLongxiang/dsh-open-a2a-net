// @vitest-environment jsdom
/**
 * First-run board (no saved layout): every teamed node lands inside the
 * view on its own seat. Before 0.6.18 the hash ring was centered on world
 * (0,0) with the viewport at the board's top-left, so a healthy 8-node
 * fleet opened on an empty board, and colliding hash slots stacked cards
 * pixel-for-pixel. A saved layout keeps its own viewport untouched.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView } from '../src/planning-view.ts'
import { NODE_H, NODE_W, planSeatClear } from '../src/world.ts'

const VIEW = { w: 1100, h: 860 }
const ids = ['a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2', '11223344', '55667788', '99aabbcc', 'ddeeff00', '0badcafe']
const sessions = ids.map((id, i) => ({ id, label: `n${i}`, team: `mac/${id}`, name: `node-${i}`, joined: true, live: true }))
const teams = [
  { name: 'alpha', team: 'mac/canvas/alpha', members: ids.slice(0, 4).map(id => ({ id })) },
  { name: 'beta', team: 'mac/canvas/beta', members: ids.slice(4).map(id => ({ id })) },
]

function view() {
  const onDirty = vi.fn()
  const v = createPlanningView({
    onDirty, onLampClick: vi.fn(), onCanvasAction: () => Promise.resolve(true),
    viewSize: () => VIEW,
  })
  document.body.appendChild(v.root)
  return { v, onDirty }
}

/** Parse `translate(Xpx, Ypx) scale(S)` back into numbers. */
function transformOf(root: HTMLElement): { tx: number; ty: number; s: number } {
  const t = root.querySelector<HTMLElement>('.p-world')!.style.transform
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t)!
  return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) }
}

describe('first-run board', () => {
  it('planSeatClear never stacks two cards', () => {
    const placed: Array<{ x: number; y: number }> = []
    for (let i = 0; i < 60; i++) placed.push(planSeatClear(`sid-${String(i)}`, placed))
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!
        const b = placed[j]!
        const overlap = Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H
        expect(overlap, `cards ${String(i)} and ${String(j)} overlap`).toBe(false)
      }
    }
  })

  it('frames every node inside the view, never magnified, without marking dirty', () => {
    const { v, onDirty } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const { tx, ty, s } = transformOf(v.root)
    expect(s).toBeLessThanOrEqual(1)
    for (const id of ids) {
      const el = v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!
      const left = parseFloat(el.style.left) * s + tx
      const top = parseFloat(el.style.top) * s + ty
      expect(left, id).toBeGreaterThanOrEqual(0)
      expect(top, id).toBeGreaterThanOrEqual(0)
      expect(left + NODE_W * s, id).toBeLessThanOrEqual(VIEW.w)
      expect(top + NODE_H * s, id).toBeLessThanOrEqual(VIEW.h)
    }
    expect(onDirty).not.toHaveBeenCalled()
  })

  it('fits once: a later poll does not yank a viewport the user moved', () => {
    const { v } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    v.seam.key({ key: '+', shiftKey: false, target: v.root, preventDefault: () => {} })
    const moved = v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.reconcile({ sessions, teams, peerCount: 0 })
    expect(v.root.querySelector<HTMLElement>('.p-world')!.style.transform).toBe(moved)
  })

  it('a saved layout keeps its own viewport', () => {
    const { v } = view()
    v.adoptExternalLayout({ version: 1, viewport: { x: 40, y: 30, scale: 1 }, nodes: {}, frames: {} })
    v.reconcile({ sessions, teams, peerCount: 0 })
    expect(v.root.querySelector<HTMLElement>('.p-world')!.style.transform).toBe('translate(-40px, -30px) scale(1)')
  })

  it('the fit button reads as an action, not a count', () => {
    const { v } = view()
    const fit = [...v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')].find(b => b.title.startsWith('适配'))!
    expect(fit.textContent).toBe('适配')
    expect(fit.title).toContain('快捷键 0')
  })
})
