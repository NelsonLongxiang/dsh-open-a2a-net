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

function view() {
  const onDirty = vi.fn()
  const onLampClick = vi.fn()
  const onCanvasAction = vi.fn(() => Promise.resolve(true))
  const v = createPlanningView({ onDirty, onLampClick, onCanvasAction })
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

  it('Ctrl+wheel zooms in on scroll-up', () => {
    const { v } = view()
    const t = (): string => v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.seam.wheel({ button: 0, shiftKey: false, ctrlKey: true, clientX: 400, clientY: 300, target: v.root, deltaY: -100, preventDefault: () => {} })
    expect(t()).toContain('scale(1.')
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

  it('wheel pans with the native delta (scroll down reveals lower content)', () => {
    const { v } = view()
    const t = (): string => v.root.querySelector<HTMLElement>('.p-world')!.style.transform
    v.seam.wheel({ button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, target: v.root, deltaY: 100, preventDefault: () => {} })
    const afterDown = t()
    expect(afterDown).toContain('translate(0px, -100px)') // viewport moved down the world
    v.seam.wheel({ button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, target: v.root, deltaY: -100, preventDefault: () => {} })
    expect(t()).toBe('translate(0px, 0px) scale(1)') // and back
  })

  it('toolbar carries the PR-C 建队 control (4 buttons)', () => {
    const { v } = view()
    const buttons = Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button'))
    expect(buttons).toHaveLength(4)
    expect(buttons.some(b => b.textContent === '建队')).toBe(true)
  })

  it('attacker-shaped labels land as text, never as markup', () => {
    const { v } = view()
    const evil = '<img src=x onerror=alert(1)>'
    v.reconcile({
      sessions: [{ id: 'sx', label: 'x', team: 'dsh/99999999', name: evil, joined: true, live: true }],
      teams: [],
      peerCount: 0,
    })
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="sx"]')!
    expect(el.querySelector('.nm-text')!.textContent).toBe(evil)
    expect(v.root.querySelector('img')).toBeNull()
  })
})
