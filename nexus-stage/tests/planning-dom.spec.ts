// @vitest-environment jsdom
/**
 * Planning-mode DOM behavior through the production seam (no re-implementa-
 * tion): drag paints position + fires onDirty once, marquee selects, the
 * frame head drags the whole group, keyboard fits/clears, keyed diff keeps
 * element identity across reconciles, the lamp carries its state class,
 * the toolbar has no PR-C controls, and attacker-shaped labels stay text.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type SeamKey, type SeamPointer } from '../src/planning-view.ts'

function view(viewSize?: { w: number; h: number }) {
  const onDirty = vi.fn()
  const onLampClick = vi.fn()
  const onCanvasAction = vi.fn(() => Promise.resolve(true))
  const v = createPlanningView({ onDirty, onLampClick, onCanvasAction, viewSize: viewSize ? () => viewSize : undefined })
  document.body.appendChild(v.root)
  return { v, onDirty, onLampClick, onCanvasAction }
}

const sessions = [
  { id: 's1', label: 'scout', team: 'dsh/11111111', name: 'scout-01', joined: true, live: true },
  { id: 's2', label: 'analyst', team: 'dsh/22222222', name: 'analyst-02', joined: true, live: true },
]
const teams = [
  { name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 's1' }, { id: 's2' }] },
]

function ptr(overrides: Partial<SeamPointer> & { target?: Element | null }): SeamPointer {
  return {
    button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0,
    pointerId: 1, target: null, preventDefault: () => {},
    ...overrides,
  }
}

function key(overrides: Partial<SeamKey>): SeamKey {
  return { key: '', shiftKey: false, target: null, preventDefault: () => {}, ...overrides }
}

describe('planning view DOM', () => {
  it('drag moves the card and fires onDirty exactly once on release', () => {
    const { v, onDirty } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    const left0 = parseFloat(el.style.left)
    const top0 = parseFloat(el.style.top)
    v.seam.pointerDown(ptr({ target: el, clientX: 100, clientY: 100 }))
    v.seam.pointerMove(ptr({ target: el, clientX: 180, clientY: 130 }))
    v.seam.pointerUp(ptr({ target: el, clientX: 180, clientY: 130 }))
    expect(parseFloat(el.style.left)).toBe(left0 + 80)
    expect(parseFloat(el.style.top)).toBe(top0 + 30)
    expect(onDirty).toHaveBeenCalledTimes(1)
  })

  it('blank-drag is a marquee (Figma ruling) and selects intersecting cards', () => {
    const { v, onDirty } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const s1 = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    const s2 = v.root.querySelector<HTMLElement>('.p-node[data-id="s2"]')!
    v.seam.pointerDown(ptr({ target: v.root, clientX: -200, clientY: -200 }))
    v.seam.pointerMove(ptr({ target: v.root, clientX: 400, clientY: 400 }))
    v.seam.pointerUp(ptr({ target: v.root, clientX: 400, clientY: 400 }))
    expect(s1.classList.contains('selected')).toBe(true)
    expect(s2.classList.contains('selected')).toBe(true)
    expect(onDirty).not.toHaveBeenCalled() // selection is not persisted state
  })

  it('frame-head drag moves the whole group (rect + members), onDirty once', () => {
    const { v, onDirty } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="alpha"]')!
    const frame = head.closest<HTMLElement>('.p-frame')!
    const s1 = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    const fx0 = parseFloat(frame.style.left)
    const s1x0 = parseFloat(s1.style.left)
    v.seam.pointerDown(ptr({ target: head, clientX: 10, clientY: 10 }))
    v.seam.pointerMove(ptr({ target: head, clientX: 110, clientY: 10 }))
    v.seam.pointerUp(ptr({ target: head, clientX: 110, clientY: 10 }))
    expect(parseFloat(frame.style.left)).toBe(fx0 + 100)
    expect(parseFloat(s1.style.left)).toBe(s1x0 + 100)
    expect(onDirty).toHaveBeenCalledTimes(1)
  })

  it('keyboard: 0 fits (transform moves off identity, dirty fires)', () => {
    // Injected viewport size: jsdom has no layout, so fit math needs a
    // deterministic box to produce a non-identity transform.
    const onDirty = vi.fn()
    const v = createPlanningView({
      onDirty, onLampClick: vi.fn(), onCanvasAction: () => Promise.resolve(true),
      viewSize: () => ({ w: 1000, h: 800 }),
    })
    document.body.appendChild(v.root)
    v.reconcile({ sessions, teams, peerCount: 0 })
    const before = v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.seam.key(key({ key: '0', target: v.root }))
    const after = v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    expect(after).not.toBe(before)
    expect(after).toContain('scale(')
    expect(onDirty).toHaveBeenCalled()
  })

  it('keyboard: 0 fits (dirty), Escape clears selection, arrows nudge selection', () => {
    const { v, onDirty } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const s1 = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    v.seam.key(key({ key: '0', target: v.root }))
    expect(onDirty).toHaveBeenCalled()
    onDirty.mockClear()
    v.seam.pointerDown(ptr({ target: s1, clientX: 5, clientY: 5 }))
    v.seam.pointerUp(ptr({ target: s1, clientX: 5, clientY: 5 }))
    onDirty.mockClear()
    const x0 = parseFloat(s1.style.left)
    v.seam.key(key({ key: 'ArrowRight', shiftKey: true, target: v.root }))
    expect(parseFloat(s1.style.left)).toBe(x0 + 40)
    expect(onDirty).toHaveBeenCalledTimes(1)
    v.seam.key(key({ key: 'Escape', target: v.root }))
    expect(s1.classList.contains('selected')).toBe(false)
  })

  it('paint order: the frames layer precedes the nodes layer (hit-test ruling)', () => {
    const { v } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const frames = v.root.querySelector('.p-frames')!
    const nodes = v.root.querySelector('.p-nodes')!
    // FOLLOWING means frames precede nodes in DOM order = frames paint
    // below cards = cards win hit-testing (the aa455f5 ruling).
    expect(frames.compareDocumentPosition(nodes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a poll never snaps a dragged card back (position survives reconcile)', () => {
    const { v } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    const left0 = parseFloat(el.style.left)
    const top0 = parseFloat(el.style.top)
    v.seam.pointerDown(ptr({ target: el, clientX: 100, clientY: 100 }))
    v.seam.pointerMove(ptr({ target: el, clientX: 180, clientY: 130 }))
    v.seam.pointerUp(ptr({ target: el, clientX: 180, clientY: 130 }))
    v.reconcile({ sessions, teams, peerCount: 0 }) // a poll lands right after the drag
    expect(parseFloat(el.style.left)).toBe(left0 + 80)
    expect(parseFloat(el.style.top)).toBe(top0 + 30)
  })

  it('wheel zooms pointer-anchored (owner ruling 2026-09-01), Ctrl or not', () => {
    const { v } = view()
    const t = (): string => v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.seam.wheel({ button: 0, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300, target: v.root, deltaY: -100, preventDefault: () => {} })
    expect(t()).toContain('scale(1.') // plain wheel zooms in on scroll-up
    v.seam.wheel({ button: 0, shiftKey: false, ctrlKey: true, clientX: 400, clientY: 300, target: v.root, deltaY: 100, preventDefault: () => {} })
    // Ctrl+wheel zooms back out — one action both ways. Multiplicative zoom
    // returns to identity within float dust, never to a literal string.
    const scale = Number(t().match(/scale\(([\d.]+)\)/)?.[1])
    expect(Math.abs(scale - 1)).toBeLessThan(1e-9)
  })

  it('middle-button drag on a card pans the viewport (no card drag, no roster write)', () => {
    const { v, onDirty } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    const left0 = a.style.left
    const t0 = v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.seam.pointerDown(ptr({ target: a, clientX: 100, clientY: 100, button: 1 }))
    v.seam.pointerMove(ptr({ target: v.root, clientX: 160, clientY: 160, button: 1 }))
    v.seam.pointerUp(ptr({ target: v.root, clientX: 160, clientY: 160, button: 1 }))
    expect(a.style.left).toBe(left0) // the card itself never moves
    expect(v.root.querySelector<HTMLElement>('.p-world')!.style.transform).not.toBe(t0) // viewport panned
    expect(onDirty).toHaveBeenCalled() // viewport persists
  })

  it('keyed diff: a re-rendered card keeps element identity across polls', () => {
    const { v } = view()
    v.reconcile({ sessions, teams, peerCount: 0 })
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="s2"]')!
    v.reconcile({ sessions: [sessions[0]!, { ...sessions[1]!, live: false }], teams, peerCount: 0 })
    const el2 = v.root.querySelector<HTMLElement>('.p-node[data-id="s2"]')!
    expect(el2).toBe(el) // focus/transitions/capture survive the poll
    expect(el2.classList.contains('cold')).toBe(true)
  })

  it('lamp carries its state class and click only retries on error', () => {
    const { v, onLampClick } = view()
    v.setLamp('saved', '12:03')
    const lamp = v.root.querySelector<HTMLElement>('.p-lamp')!
    expect(lamp.classList.contains('saved')).toBe(true)
    expect(lamp.textContent).toContain('12:03')
    lamp.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onLampClick).not.toHaveBeenCalled() // saved: click is inert
    v.setLamp('error')
    expect(lamp.classList.contains('error')).toBe(true)
    lamp.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onLampClick).toHaveBeenCalledTimes(1)
  })

  it('Shift+wheel keeps the pan escape hatch (scroll down reveals lower content)', () => {
    const { v } = view()
    const t = (): string => v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.seam.wheel({ button: 0, shiftKey: true, ctrlKey: false, clientX: 0, clientY: 0, target: v.root, deltaY: 100, preventDefault: () => {} })
    const afterDown = t()
    expect(afterDown).toContain('translate(0px, -100px)') // viewport moved down the world
    v.seam.wheel({ button: 0, shiftKey: true, ctrlKey: false, clientX: 0, clientY: 0, target: v.root, deltaY: -100, preventDefault: () => {} })
    expect(t()).toBe('translate(0px, 0px) scale(1)') // and back
  })

  it('toolbar carries the 建队 control plus the network surfaces (6 buttons)', () => {
    const { v } = view()
    const buttons = Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button'))
    // 5th = 未入网 chip (panel-slim migration); 6th = 节点 list (the
    // teamed-only canvas ruling moved teamless/unjoined sessions there).
    expect(buttons).toHaveLength(6)
    expect(buttons.some(b => b.textContent === '建队')).toBe(true)
    expect(buttons.some(b => (b.textContent ?? '').startsWith('未入网'))).toBe(true)
    expect(buttons.some(b => b.textContent === '节点')).toBe(true)
  })

  it('attacker-shaped labels land as text, never as markup', () => {
    const { v } = view()
    const evil = '<img src=x onerror=alert(1)>'
    v.reconcile({
      sessions: [{ id: 'sx', label: 'x', team: 'dsh/99999999', name: evil, joined: true, live: true, teams: ['dsh/ops'] }],
      teams: [],
      peerCount: 0,
    })
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="sx"]')!
    expect(el.querySelector('.nm-text')!.textContent).toBe(evil)
    expect(v.root.querySelector('img')).toBeNull()
  })
})

describe('frame resize (owner ruling: frames stretch and adjust)', () => {
  const resizeView = () => {
    const onDirty = vi.fn()
    const onCanvasAction = vi.fn(() => Promise.resolve(true))
    const v = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction, viewSize: () => ({ w: 1000, h: 800 }) })
    document.body.appendChild(v.root)
    v.reconcile({
      sessions: [{ id: 's1', label: 'scout', team: 'dsh/11111111', name: 'scout-01', joined: true, live: true }],
      teams: [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 's1' }] }],
      peerCount: 0,
    })
    return { v, onDirty }
  }
  const grab = (v: ReturnType<typeof resizeView>['v'], dir: string) =>
    v.root.querySelector<HTMLElement>(`.p-frame-handle[data-dir="${dir}"]`)!

  function ptr(target: Element, x: number, y: number): any {
    return { button: 0, shiftKey: false, ctrlKey: false, clientX: x, clientY: y, pointerId: 1, target, preventDefault: () => {} }
  }

  it('eight handles render per frame', () => {
    const { v } = resizeView()
    expect(v.root.querySelectorAll('.p-frame-handle').length).toBe(8)
  })

  it('dragging the SE handle grows the rect and fires onDirty once on release', () => {
    const { v, onDirty } = resizeView()
    const handle = grab(v, 'se')
    const frame = handle.closest<HTMLElement>('.p-frame')!
    const w0 = parseFloat(frame.style.width)
    const h0 = parseFloat(frame.style.height)
    v.seam.pointerDown(ptr(handle, 300, 300))
    v.seam.pointerMove(ptr(handle, 380, 340))
    expect(parseFloat(frame.style.width)).toBe(w0 + 80)
    expect(parseFloat(frame.style.height)).toBe(h0 + 40)
    v.seam.pointerUp(ptr(handle, 380, 340))
    expect(onDirty).toHaveBeenCalledTimes(1)
    // Poll keeps the resized rect (model state, not a transient style).
    v.reconcile({
      sessions: [{ id: 's1', label: 'scout', team: 'dsh/11111111', name: 'scout-01', joined: true, live: true }],
      teams: [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 's1' }] }],
      peerCount: 0,
    })
    expect(parseFloat(frame.style.width)).toBe(w0 + 80)
  })

  it('dragging the NW handle moves the top-left corner and clamps to the minimum', () => {
    const { v } = resizeView()
    const handle = grab(v, 'nw')
    const frame = handle.closest<HTMLElement>('.p-frame')!
    const x0 = parseFloat(frame.style.left)
    v.seam.pointerDown(ptr(handle, 200, 200))
    v.seam.pointerMove(ptr(handle, 260, 400)) // past the min: x grows, height clamps
    expect(parseFloat(frame.style.left)).toBeGreaterThan(x0)
    expect(parseFloat(frame.style.height)).toBeGreaterThanOrEqual(120)
    v.seam.pointerUp(ptr(handle, 260, 400))
  })

  it('a resize gesture never moves member cards', () => {
    const { v } = resizeView()
    const card = v.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    const left0 = card.style.left
    const handle = grab(v, 'e')
    v.seam.pointerDown(ptr(handle, 300, 300))
    v.seam.pointerMove(ptr(handle, 500, 300))
    v.seam.pointerUp(ptr(handle, 500, 300))
    expect(card.style.left).toBe(left0)
  })
})

describe('netmenu dismissal (owner-reported stuck dropdown)', () => {
  const netView = () => {
    const onCanvasAction = vi.fn(() => Promise.resolve(true))
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction, viewSize: () => ({ w: 1000, h: 800 }) })
    document.body.appendChild(v.root)
    v.reconcile({
      sessions: [
        { id: 'j1', label: 'joined', team: 'dsh/aaaaaaa1', name: 'joined-one', joined: true, live: true },
        { id: 'u1', label: 'unjoined', team: 'dsh/aaaaaaa2', name: 'unjoined-one', joined: false, live: true },
      ],
      teams: [],
      peerCount: 0,
    })
    return { v, onCanvasAction }
  }
  const openNet = (v: ReturnType<typeof netView>['v']) => {
    const btn = v.root.querySelector<HTMLElement>('.p-netbtn')!
    btn.click()
    return v.root.querySelector<HTMLElement>('.p-netmenu')!
  }
  const outside = (v: ReturnType<typeof netView>['v'], x: number, y: number) => {
    const ev = new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })
    Object.defineProperty(ev, 'target', { value: v.root.querySelector('.p-world') })
    document.dispatchEvent(ev)
  }

  it('clicking outside the dropdown closes it (stuck-dropdown fix)', () => {
    const { v } = netView()
    const menu = openNet(v)
    expect(menu).not.toBeNull()
    outside(v, 5, 5) // canvas blank press
    expect(v.root.querySelector('.p-netmenu')).toBeNull()
  })

  it('the trigger button still toggles: second click closes', () => {
    const { v } = netView()
    openNet(v)
    const btn = v.root.querySelector<HTMLElement>('.p-netbtn')!
    btn.click()
    expect(v.root.querySelector('.p-netmenu')).toBeNull()
  })

  it('pressing a menu item joins and closes; outside press does not re-open', () => {
    const { v, onCanvasAction } = netView()
    const menu = openNet(v)
    const item = menu.querySelector<HTMLElement>('[role=menuitem]')!
    item.click()
    expect(onCanvasAction).toHaveBeenCalledTimes(1)
    expect(v.root.querySelector('.p-netmenu')).toBeNull()
  })
})

describe('frame selection keeps handles visible (owner Q&A)', () => {
  const selView = () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(() => Promise.resolve(true)), viewSize: () => ({ w: 1000, h: 800 }) })
    document.body.appendChild(v.root)
    v.reconcile({
      sessions: [{ id: 's1', label: 'scout', team: 'dsh/11111111', name: 'scout-01', joined: true, live: true }],
      teams: [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 's1' }] }],
      peerCount: 0,
    })
    return v
  }
  const handlesVisible = (v: ReturnType<typeof selView>): boolean => {
    const h = v.root.querySelector<HTMLElement>('.p-frame-handle')
    return h !== null && getComputedStyle(h).opacity !== '0'
  }

  it('pressing a frame head marks it selected; handles stay visible without hover', () => {
    const v = selView()
    const head = v.root.querySelector<HTMLElement>('.p-frame-head')!
    // Press the head (select) — no hover after.
    v.seam.pointerDown(ptr({ target: head, clientX: 10, clientY: 10 }))
    v.seam.pointerUp(ptr({ target: head, clientX: 10, clientY: 10 }))
    expect(v.root.querySelector('.p-frame.selected')).not.toBeNull()
    expect(handlesVisible(v)).toBe(true)
  })

  it('a blank press clears the selection', () => {
    const v = selView()
    const head = v.root.querySelector<HTMLElement>('.p-frame-head')!
    v.seam.pointerDown(ptr({ target: head, clientX: 10, clientY: 10 }))
    v.seam.pointerUp(ptr({ target: head, clientX: 10, clientY: 10 }))
    expect(v.root.querySelector('.p-frame.selected')).not.toBeNull()
    const world = v.root.querySelector<HTMLElement>('.p-world')!
    v.seam.pointerDown(ptr({ target: world, clientX: 5, clientY: 5 }))
    v.seam.pointerUp(ptr({ target: world, clientX: 5, clientY: 5 }))
    expect(v.root.querySelector('.p-frame.selected')).toBeNull()
  })
})
