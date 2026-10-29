// @vitest-environment jsdom
/**
 * 撤销 (planning-undo): automatic moves carry no status-bar hint (owner
 * 2026-10-28), so any layout change — drag, resize, nudge, 整理成员, 一键重排,
 * load-time settle — is one Ctrl+Z (or the 撤销 button) from undone.
 * Positions and frame rects only; membership writes are not replayed.
 */
import { describe, expect, it, vi } from 'vitest'
import { createLayoutUndo, UNDO_LIMIT } from '../src/planning-undo.ts'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'
import { WorldModel, type WorldNode } from '../src/world.ts'

const ptr = (o: Partial<SeamPointer>): SeamPointer =>
  ({ button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o })
const ctrlZ = (v: { root: HTMLElement; seam: { key: (k: never) => void } }) =>
  v.seam.key({ key: 'z', shiftKey: false, ctrlKey: true, target: v.root, preventDefault: () => {} } as never)
const px = (s: string) => Number(s.replace('px', ''))
const rectOf = (v: { root: HTMLElement }, name: string) => {
  const el = v.root.querySelector<HTMLElement>(`.p-frame[data-name="${name}"]`)!
  return { x: px(el.style.left), y: px(el.style.top), w: px(el.style.width), h: px(el.style.height) }
}
const cardOf = (v: { root: HTMLElement }, id: string) => {
  const el = v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!
  return { x: px(el.style.left), y: px(el.style.top) }
}
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
  const onCanvasAction = vi.fn(async () => true)
  const onDirty = vi.fn()
  const v = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction, now: () => 1000, viewSize: () => ({ w: 1600, h: 1000 }) })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, ...layout })
  v.reconcile(input)
  return { v, onCanvasAction, onDirty }
}
const apart = {
  nodes: { a: { x: 100, y: 100 }, b: { x: 1100, y: 120 }, s: { x: 1150, y: 160 } },
  frames: { T1: { x: 0, y: 0, w: 400, h: 220 }, T2: { x: 1000, y: 0, w: 400, h: 220 } },
}
const button = (v: { root: HTMLElement }, text: string) => [...v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')].find(b => b.textContent === text)!

describe('planning-undo (model)', () => {
  const node = (id: string, x: number, y: number): WorldNode => ({ id, x, y, label: id, team: `dsh/${id}`, live: true, memberships: [] })
  it('records only edits that moved something already there; undo restores positions and rects', () => {
    const m = new WorldModel()
    m.upsertNode(node('n', 10, 10))
    m.setFrame('F', { x: 0, y: 0, w: 300, h: 200 })
    const u = createLayoutUndo(m)
    u.commit(u.capture()) // nothing moved
    expect(u.depth).toBe(0)
    let before = u.capture()
    m.upsertNode(node('late', 500, 500)) // a poll adds a card mid-gesture: not a move
    u.commit(before)
    expect(u.depth).toBe(0)
    before = u.capture()
    m.dragNodes(['n'], 40, 0)
    m.setFrame('F', { x: 5, y: 0, w: 320, h: 200 })
    u.commit(before)
    expect(u.undo()).toBe(true)
    expect([m.getNode('n')!.x, m.getFrame('F')]).toEqual([10, { x: 0, y: 0, w: 300, h: 200 }])
    expect(m.getNode('late')!.x).toBe(500) // unknown to the snapshot: left alone
    expect(u.undo()).toBe(false)
  })
  it(`keeps the last ${UNDO_LIMIT} steps`, () => {
    const m = new WorldModel()
    m.upsertNode(node('n', 0, 0))
    const u = createLayoutUndo(m)
    for (let i = 0; i < UNDO_LIMIT + 5; i++) { const b = u.capture(); m.dragNodes(['n'], 1, 0); u.commit(b) }
    expect(u.depth).toBe(UNDO_LIMIT)
    while (u.undo()) { /* drain */ }
    expect(m.getNode('n')!.x).toBe(5) // the 5 oldest steps fell off
  })
  it('revert puts the layout back without recording a step', () => {
    const m = new WorldModel()
    m.upsertNode(node('n', 10, 10))
    const u = createLayoutUndo(m)
    const before = u.capture()
    expect(u.revert(before)).toBe(false) // nothing moved
    m.dragNodes(['n'], 40, 0)
    expect(u.revert(before)).toBe(true)
    expect([m.getNode('n')!.x, u.depth]).toEqual([10, 0])
  })
})

describe('撤销 on the board', () => {
  it('Ctrl+Z after a frame drag puts the frame, the frame it pushed and the cards it evicted back', () => {
    const { v } = bench(apart)
    const before = { t1: rectOf(v, 'T1'), t2: rectOf(v, 'T2'), a: cardOf(v, 'a'), b: cardOf(v, 'b'), s: cardOf(v, 's') }
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="T2"]')!
    v.seam.pointerDown(ptr({ target: head, clientX: 1200, clientY: 10 }))
    v.seam.pointerMove(ptr({ target: head, clientX: 500, clientY: 30 })) // T2 lands over T1
    v.seam.pointerUp(ptr({ target: head, clientX: 500, clientY: 30 }))
    expect(rectOf(v, 'T1')).not.toEqual(before.t1) // T1 yielded
    ctrlZ(v)
    expect({ t1: rectOf(v, 'T1'), t2: rectOf(v, 'T2'), a: cardOf(v, 'a'), b: cardOf(v, 'b'), s: cardOf(v, 's') }).toEqual(before)
  })

  it('the 撤销 button undoes 一键重排 in one step', () => {
    const { v } = bench(apart)
    const before = { t1: rectOf(v, 'T1'), t2: rectOf(v, 'T2'), a: cardOf(v, 'a'), b: cardOf(v, 'b') }
    button(v, '一键重排').click()
    expect(rectOf(v, 'T2')).not.toEqual(before.t2)
    button(v, '撤销').click()
    expect({ t1: rectOf(v, 'T1'), t2: rectOf(v, 'T2'), a: cardOf(v, 'a'), b: cardOf(v, 'b') }).toEqual(before)
  })

  it('the load-time settle is undoable too', () => {
    const { v } = bench({ nodes: apart.nodes, frames: { T1: { x: 0, y: 0, w: 400, h: 220 }, T2: { x: 300, y: 40, w: 400, h: 220 } } })
    expect(rectOf(v, 'T2')).not.toEqual({ x: 300, y: 40, w: 400, h: 220 }) // settled on load
    ctrlZ(v)
    expect(rectOf(v, 'T2')).toEqual({ x: 300, y: 40, w: 400, h: 220 })
  })

  it('a card drag undoes its position only; the membership write is not replayed', async () => {
    const { v, onCanvasAction } = bench(apart)
    const card = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    const at = cardOf(v, 'a')
    v.seam.pointerDown(ptr({ target: card, clientX: 100, clientY: 100 }))
    const t2 = v.root.querySelector<HTMLElement>('.p-frame[data-name="T2"]')!
    v.seam.pointerMove(ptr({ target: card, clientX: 1300, clientY: 60 }))
    v.seam.pointerUp(ptr({ target: t2, clientX: 1300, clientY: 60 }))
    await vi.waitFor(() => expect(onCanvasAction).toHaveBeenCalled()) // dropped into T2 → a membership write
    const calls = onCanvasAction.mock.calls.length
    ctrlZ(v)
    expect(cardOf(v, 'a')).toEqual(at)
    expect(onCanvasAction.mock.calls.length).toBe(calls)
  })

  it('a click, a pan or a marquee records nothing; an empty stack says so', () => {
    const { v } = bench(apart)
    const card = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.pointerDown(ptr({ target: card, clientX: 100, clientY: 100 }))
    v.seam.pointerUp(ptr({ target: card, clientX: 100, clientY: 100 }))
    v.seam.pointerDown(ptr({ target: v.root, clientX: 700, clientY: 700 }))
    v.seam.pointerMove(ptr({ target: v.root, clientX: 760, clientY: 760 }))
    v.seam.pointerUp(ptr({ target: v.root, clientX: 760, clientY: 760 }))
    ctrlZ(v)
    expect(v.root.querySelector('.p-notice')?.textContent).toBe('没有可撤销的布局改动')
  })

  it('a cancelled drag (pointercancel) never drops: card back, no write, nothing to undo', async () => {
    const { v, onCanvasAction } = bench(apart)
    const card = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    const at = cardOf(v, 'a')
    v.seam.pointerDown(ptr({ target: card, clientX: 100, clientY: 100 }))
    v.seam.pointerMove(ptr({ target: card, clientX: 1300, clientY: 60 })) // over T2
    v.seam.pointerCancel(ptr({ target: card, clientX: 1300, clientY: 60 }))
    expect(cardOf(v, 'a')).toEqual(at)
    expect(card.classList.contains('dragging')).toBe(false)
    expect(v.root.querySelector('.p-frame.drop-target')).toBeNull()
    await Promise.resolve()
    expect(onCanvasAction).not.toHaveBeenCalled()
    ctrlZ(v)
    expect(v.root.querySelector('.p-notice')?.textContent).toBe('没有可撤销的布局改动')
    v.seam.pointerUp(ptr({ target: card, clientX: 1300, clientY: 60 })) // a late pointerup is inert
    expect(cardOf(v, 'a')).toEqual(at)
    await Promise.resolve()
    expect(onCanvasAction).not.toHaveBeenCalled() // the gesture was disarmed: no late drop
  })

  it('a cancelled pan keeps the view and still persists it', () => {
    const { v, onDirty } = bench(apart)
    v.seam.pointerDown(ptr({ target: v.root, button: 1, clientX: 700, clientY: 700 }))
    v.seam.pointerMove(ptr({ target: v.root, button: 1, clientX: 760, clientY: 760 }))
    onDirty.mockClear()
    v.seam.pointerCancel(ptr({ target: v.root, button: 1, clientX: 760, clientY: 760 }))
    expect(onDirty).toHaveBeenCalled()
    v.seam.pointerDown(ptr({ target: v.root, button: 2, clientX: 700, clientY: 700 })) // right-drag pan
    v.seam.pointerMove(ptr({ target: v.root, button: 2, clientX: 760, clientY: 760 }))
    onDirty.mockClear()
    v.seam.pointerCancel(ptr({ target: v.root, button: 2, clientX: 760, clientY: 760 }))
    expect(onDirty).toHaveBeenCalled()
  })

  it('Ctrl+Z in the search box stays the input\'s own undo', () => {
    const { v } = bench(apart)
    button(v, '一键重排').click()
    const moved = rectOf(v, 'T2')
    const box = v.root.querySelector<HTMLInputElement>('.p-search-input')!
    let prevented = false
    v.seam.key({ key: 'z', shiftKey: false, ctrlKey: true, target: box, preventDefault: () => { prevented = true } })
    expect([rectOf(v, 'T2'), prevented]).toEqual([moved, false])
  })
})
