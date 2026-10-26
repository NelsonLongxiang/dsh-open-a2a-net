// @vitest-environment jsdom
/**
 * First-run board (no saved layout): every teamed node lands inside the
 * view on its own seat. Before 0.6.18 the hash ring was centered on world
 * (0,0) with the viewport at the board's top-left, so a healthy 8-node
 * fleet opened on an empty board, and colliding hash slots stacked cards
 * pixel-for-pixel. A saved layout keeps its own viewport untouched.
 * Seats are grouped by team so the derived frames sit side by side; a
 * cross-team member lives in its home frame only (first team in state
 * order, the solid-edge one) and the other team reaches it by its dashed
 * edge instead of stretching its frame over the home frame.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, viewportBucket, type ViewportBucket } from '../src/planning-view.ts'
import { NODE_H, NODE_W, planSeatClear, planTeamClusters } from '../src/world.ts'

const VIEW = { w: 1100, h: 860 }
const ids = ['a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2', '11223344', '55667788', '99aabbcc', 'ddeeff00', '0badcafe']
const sessions = ids.map((id, i) => ({ id, label: `n${i}`, team: `mac/${id}`, name: `node-${i}`, joined: true, live: true }))
const teams = [
  { name: 'alpha', team: 'mac/canvas/alpha', members: ids.slice(0, 4).map(id => ({ id })) },
  { name: 'beta', team: 'mac/canvas/beta', members: ids.slice(4).map(id => ({ id })) },
]
/** The mock fleet's real shape: e5f6a7b8 sits in both teams (home = alpha). */
const sharedTeams = [
  teams[0]!,
  { name: 'beta', team: 'mac/canvas/beta', members: [...ids.slice(4), 'e5f6a7b8'].map(id => ({ id })) },
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

  it('peer cards are framed too, not clipped at the board edge', () => {
    const { v } = view()
    v.reconcile({ sessions, teams, peerCount: 2, peers: [{ url: 'http://10.0.0.5:8787', score: 4 }, { url: 'http://10.0.0.6:8787', score: 2 }] })
    const { tx, ty, s } = transformOf(v.root)
    const cards = [...v.root.querySelectorAll<HTMLElement>('.p-node.remote')]
    expect(cards.length).toBe(2)
    for (const el of cards) {
      const left = parseFloat(el.style.left) * s + tx
      const top = parseFloat(el.style.top) * s + ty
      expect(left).toBeGreaterThanOrEqual(0)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(left + NODE_W * s).toBeLessThanOrEqual(VIEW.w)
      expect(top + NODE_H * s).toBeLessThanOrEqual(VIEW.h)
    }
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

  it('frames of a fresh board sit side by side, never nested', () => {
    const { v } = view()
    v.reconcile({ sessions, teams: sharedTeams, peerCount: 0 })
    const a = frameRect(v.root, 'alpha')
    const b = frameRect(v.root, 'beta')
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    expect(overlapX > 0 && overlapY > 0, 'alpha and beta frames overlap').toBe(false)
    // Centered titles need the frame centers apart by at least one frame's width.
    expect(Math.abs((a.x + a.w / 2) - (b.x + b.w / 2))).toBeGreaterThanOrEqual(Math.min(a.w, b.w))
  })

  it('every home member sits inside its home frame; the shared one only in alpha', () => {
    const { v } = view()
    v.reconcile({ sessions, teams: sharedTeams, peerCount: 0 })
    const inside = (id: string, name: string): boolean => {
      const el = v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!
      const x = parseFloat(el.style.left)
      const y = parseFloat(el.style.top)
      const f = frameRect(v.root, name)
      return x >= f.x && y >= f.y && x + NODE_W <= f.x + f.w && y + NODE_H <= f.y + f.h
    }
    for (const id of ids.slice(0, 4)) expect(inside(id, 'alpha'), id).toBe(true)
    for (const id of ids.slice(4)) expect(inside(id, 'beta'), id).toBe(true)
    expect(inside('e5f6a7b8', 'beta')).toBe(false)
  })

  it('a narrow board stacks the team clusters instead of one long strip', () => {
    const wide = planTeamClusters(teams, ids)
    const narrow = planTeamClusters(teams, ids, 375)
    expect(wide.get(ids[4]!)!.y).toBe(wide.get(ids[0]!)!.y) // side by side
    expect(narrow.get(ids[4]!)!.x).toBe(narrow.get(ids[0]!)!.x) // stacked: same column
    expect(narrow.get(ids[4]!)!.y).toBeGreaterThan(narrow.get(ids[3]!)!.y)
  })

  it('planTeamClusters seats roster-only sessions in a trailing cluster, clear of the teams', () => {
    const seats = planTeamClusters(teams, [...ids, 'roster-only'])
    expect(seats.size).toBe(ids.length + 1)
    const lone = seats.get('roster-only')!
    for (const id of ids) expect(seats.get(id)!.x).toBeLessThan(lone.x)
  })

  describe('per-device viewport memory', () => {
    const saved = { version: 1, viewport: { x: 40, y: 30, scale: 1 }, nodes: {}, frames: {} }
    function withStore(width: number, slots: Partial<Record<ViewportBucket, unknown>> = {}) {
      const writes: Array<[ViewportBucket, { x: number; y: number; scale: number }]> = []
      const store = { get: (b: ViewportBucket) => slots[b], set: (b: ViewportBucket, vp: { x: number; y: number; scale: number }) => { writes.push([b, { ...vp }]) } }
      const prev = globalThis.innerWidth
      Object.defineProperty(globalThis, 'innerWidth', { value: width, configurable: true })
      const onDirty = vi.fn()
      const v = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction: () => Promise.resolve(true), viewSize: () => VIEW, viewportStore: store })
      document.body.appendChild(v.root)
      const restore = () => { Object.defineProperty(globalThis, 'innerWidth', { value: prev, configurable: true }) }
      return { v, writes, restore }
    }
    const transform = (root: HTMLElement) => root.querySelector<HTMLElement>('.p-world')!.style.transform

    it('buckets by window width', () => {
      expect(viewportBucket(375)).toBe('narrow')
      expect(viewportBucket(800)).toBe('medium')
      expect(viewportBucket(1440)).toBe('wide')
    })

    it('a phone with no memory frames the content instead of the desktop viewport', () => {
      const { v, restore } = withStore(375)
      v.adoptExternalLayout(saved)
      v.reconcile({ sessions, teams, peerCount: 0 })
      expect(transform(v.root)).not.toBe('translate(-40px, -30px) scale(1)')
      expect(transformOf(v.root).s).toBeLessThanOrEqual(1)
      restore()
    })

    it("a device's own memory wins over the host viewport", () => {
      const { v, restore } = withStore(375, { narrow: { x: 5, y: 6, scale: 0.5 } })
      v.adoptExternalLayout(saved)
      v.reconcile({ sessions, teams, peerCount: 0 })
      expect(transform(v.root)).toBe('translate(-2.5px, -3px) scale(0.5)')
      restore()
    })

    it('a wide screen with no memory keeps the host viewport (legacy layouts)', () => {
      const { v, restore } = withStore(1440)
      v.adoptExternalLayout(saved)
      v.reconcile({ sessions, teams, peerCount: 0 })
      expect(transform(v.root)).toBe('translate(-40px, -30px) scale(1)')
      restore()
    })

    it("another device's save does not yank this view; edits write this bucket", () => {
      const { v, writes, restore } = withStore(1440)
      v.adoptExternalLayout(saved)
      v.reconcile({ sessions, teams, peerCount: 0 })
      v.adoptExternalLayout({ ...saved, viewport: { x: 900, y: 900, scale: 2 } })
      expect(transform(v.root)).toBe('translate(-40px, -30px) scale(1)')
      v.seam.key({ key: '+', shiftKey: false, target: v.root, preventDefault: () => {} })
      expect(writes.at(-1)?.[0]).toBe('wide')
      expect(writes.at(-1)?.[1].scale).toBeCloseTo(1.2)
      restore()
    })
  })

  it("peer cards leave room for their 'peer' tag", () => {
    // jsdom's import.meta.url is not file:, so resolve from the run directory (package or repo root).
    const css = readFileSync(['src/planning.css', 'nexus-stage/src/planning.css'].find(f => existsSync(f))!, 'utf8')
    const rule = /#dsh-plan \.p-node\.remote\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const pad = Number(/padding-right:(\d+)px/.exec(rule)?.[1] ?? 0)
    expect(pad).toBeGreaterThanOrEqual(44) // 'peer' at 10px mono + tag padding/border + 8px inset
    // and a long address wraps to TWO clamped lines instead of a hard
    // mid-digit cut (owner order W2: the single-line ellipsis became a
    // two-line clamp; the card geometry is untouched).
    expect(/#dsh-plan \.p-node \.nm-text\{[^}]*-webkit-line-clamp:2/.test(css)).toBe(true)
  })
})

/** A frame's world rect from its inline style. */
function frameRect(root: HTMLElement, name: string): { x: number; y: number; w: number; h: number } {
  const el = [...root.querySelectorAll<HTMLElement>('.p-frame')].find(f => f.querySelector('.ttl')?.textContent === name)!
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }
}
