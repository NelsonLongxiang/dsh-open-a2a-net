// @vitest-environment jsdom
/**
 * PR C team interactions through the production seam: 建队 (dialog →
 * optimistic frame/edges BEFORE the wire settles → rollback + verbatim
 * notice on failure), the context menu with its join drill-down, the
 * keyboard equivalents (Shift+F10 menu, Delete, Alt+arrows reorder),
 * drop targeting (into frame = add-member, blank = remove-member, own
 * frame = y-sort reorder), and the notice stack.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type SeamKey, type SeamPointer, type PlanningInput } from '../src/planning-view.ts'
import type { CanvasAction } from '../src/canvas-ops.ts'

const sessions = [
  { id: 'a', label: 'A', team: 't/a', name: 'alpha', joined: true, live: true },
  { id: 'b', label: 'B', team: 't/b', name: 'beta', joined: true, live: true },
  { id: 'c', label: 'C', team: 't/c', name: 'gamma', joined: true, live: true },
]
const baseInput: PlanningInput = {
  sessions,
  teams: [],
  peerCount: 0,
}
const arrangedInput: PlanningInput = {
  sessions,
  teams: [{ name: '甲', team: 't/canvas/jia', members: [{ id: 'a' }, { id: 'c' }] }],
  peerCount: 0,
}
// a(0,0), c(0,80) inside 甲; b(600,0) outside.
const arrangedLayout = {
  version: 1,
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: { a: { x: 0, y: 0 }, c: { x: 0, y: 80 }, b: { x: 600, y: 0 } },
  frames: { 甲: { x: -200, y: -200, w: 500, h: 400 } },
}

function view(arranged = false) {
  const onDirty = vi.fn()
  const onLampClick = vi.fn()
  let release: ((ok: boolean) => void) | undefined
  const actions: CanvasAction[] = []
  const v = createPlanningView({
    onDirty,
    onLampClick,
    onCanvasAction: (a) => new Promise<boolean>((resolve) => {
      actions.push(a)
      release = (ok) => resolve(ok)
    }),
  })
  document.body.appendChild(v.root)
  if (arranged) {
    // Pinned seats so drop coordinates are deterministic.
    v.adoptExternalLayout(arrangedLayout)
  }
  return {
    v,
    onDirty,
    actions,
    settle: (ok = true) => { release?.(ok); release = undefined; return settleMicro() },
  }
}

async function settleMicro(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

function ptr(overrides: Partial<SeamPointer>): SeamPointer {
  return {
    button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0,
    pointerId: 1, target: null, preventDefault: () => {},
    ...overrides,
  }
}

function key(overrides: Partial<SeamKey>): SeamKey {
  return { key: '', shiftKey: false, altKey: false, target: null, preventDefault: () => {}, ...overrides }
}

/** Select two cards via Space on each (the keyboard 建队 prerequisite). */
function selectTwo(v: ReturnType<typeof view>['v']): void {
  const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
  const b = v.root.querySelector<HTMLElement>('.p-node[data-id="b"]')!
  a.focus()
  v.seam.key(key({ key: ' ', target: a, preventDefault: () => {} }))
  b.focus()
  v.seam.key(key({ key: ' ', target: b, preventDefault: () => {} }))
}

function drag(v: ReturnType<typeof view>['v'], el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  v.seam.pointerDown(ptr({ target: el, clientX: from.x, clientY: from.y }))
  v.seam.pointerMove(ptr({ target: v.root, clientX: to.x, clientY: to.y }))
  v.seam.pointerUp(ptr({ target: v.root, clientX: to.x, clientY: to.y }))
}

describe('建队 flow', () => {
  it('G with a selection opens the dialog and Enter emits create-team in y order', async () => {
    const { v, actions } = view()
    v.reconcile(baseInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    const b = v.root.querySelector<HTMLElement>('.p-node[data-id="b"]')!
    a.focus()
    v.seam.key(key({ key: ' ', target: a, preventDefault: () => {} })) // Space toggles/selects
    v.seam.key(key({ key: ' ', target: b, preventDefault: () => {} })) // shifts... plain Space toggles
    v.seam.key(key({ key: 'g', target: v.root }))
    const dialog = v.root.querySelector('.p-dialog')!
    expect(dialog).not.toBeNull()
    const input = dialog.querySelector('input')!
    input.value = '先锋'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toEqual({ type: 'create-team', name: '先锋', ids: ['a', 'b'] })
    // Optimistic before settle: frame + P badges exist already.
    expect(v.root.querySelector('.p-frame[data-name="先锋"]')).not.toBeNull()
  })

  it('G with fewer than two selected only raises an info notice', () => {
    const { v, actions } = view()
    v.reconcile(baseInput)
    v.seam.key(key({ key: 'g', target: v.root }))
    expect(v.root.querySelector('.p-dialog')).toBeNull()
    expect(actions).toHaveLength(0)
    expect(v.root.textContent).toContain('框选至少 2 个节点')
  })

  it('empty name shows the inline mirror error and emits nothing', async () => {
    const { v, actions } = view()
    v.reconcile(baseInput)
    selectTwo(v)
    v.seam.key(key({ key: 'g', target: v.root }))
    const input = v.root.querySelector('.p-dialog input')!
    input.value = '123' // pure digits — host-mirror rejects
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(v.root.querySelector('.p-dialog')).not.toBeNull()
    expect(v.root.querySelector('.p-dialog-err')!.textContent).toContain('纯数字')
    expect(actions).toHaveLength(0)
  })

  it('Esc cancels the dialog without emitting', () => {
    const { v, actions } = view()
    v.reconcile(baseInput)
    selectTwo(v)
    v.seam.key(key({ key: 'g', target: v.root }))
    const input = v.root.querySelector('.p-dialog input')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(v.root.querySelector('.p-dialog')).toBeNull()
    expect(actions).toHaveLength(0)
  })

  it('a refused create rolls the optimistic frame and roster back, with the host text', async () => {
    const { v, actions, settle } = view()
    v.reconcile(baseInput)
    selectTwo(v)
    v.seam.key(key({ key: 'g', target: v.root }))
    const input = v.root.querySelector('.p-dialog input')!
    input.value = '先锋'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(v.root.querySelector('.p-frame[data-name="先锋"]')).not.toBeNull()
    await settle(false)
    expect(v.root.querySelector('.p-frame[data-name="先锋"]')).toBeNull()
    expect(actions[0]).toEqual({ type: 'create-team', name: '先锋', ids: ['a', 'b'] })
  })
})

describe('context menu', () => {
  it('right-click on a node offers 组成团队/加入团队/置顶路由/离队', () => {
    const { v } = view()
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.contextMenu(ptr({ target: a, clientX: 10, clientY: 10 }))
    const menu = v.root.querySelector('.p-menu')!
    const labels = Array.from(menu.querySelectorAll('[role=menuitem]')).map(b => b.textContent)
    expect(labels.some(t => t!.includes('组成团队'))).toBe(true)
    expect(labels.some(t => t!.includes('加入团队'))).toBe(true)
    expect(labels.some(t => t!.includes('置顶路由'))).toBe(true)
    expect(labels.some(t => t!.includes('离队'))).toBe(true)
    v.seam.key(key({ key: 'Escape', target: v.root })) // closes
    expect(v.root.querySelector('.p-menu')).toBeNull()
  })

  it('加入团队 drill-down lists teams; picking one emits add-member (idempotent ones disabled)', () => {
    const { v, actions } = view()
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.contextMenu(ptr({ target: a, clientX: 10, clientY: 10 }))
    const join = Array.from(v.root.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
      .find(b => b.textContent!.includes('加入团队'))!
    join.click()
    const items = Array.from(v.root.querySelectorAll('[role=menuitem]')).map(b => ({ text: b.textContent!, disabled: (b as HTMLButtonElement).disabled }))
    expect(items.some(i => i.text.includes('‹ 返回'))).toBe(true)
    const jia = items.find(i => i.text.includes('甲'))!
    expect(jia.disabled).toBe(true) // a is already in 甲
    expect(jia.text).toContain('已加入')
    // No second team exists: nothing else enabled; no action emitted.
    expect(actions).toHaveLength(0)
  })

  it('Shift+F10 on a focused card opens the same menu; Esc closes and restores focus', () => {
    const { v } = view()
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    a.focus()
    v.seam.key(key({ key: 'F10', shiftKey: true, target: a, preventDefault: () => {} }))
    expect(v.root.querySelector('.p-menu')).not.toBeNull()
    v.seam.key(key({ key: 'Escape', target: v.root }))
    expect(v.root.querySelector('.p-menu')).toBeNull()
    expect(document.activeElement).toBe(a)
  })

  it('an open menu dismisses on outside pointerdown (swallowed, no gesture) and on wheel', () => {
    const { v, actions, onDirty } = view()
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.contextMenu(ptr({ target: a, clientX: 10, clientY: 10 }))
    expect(v.root.querySelector('.p-menu')).not.toBeNull()
    // Outside pointerdown: closes the menu and is swallowed — no marquee,
    // no selection change, no action, no dirty.
    v.seam.pointerDown(ptr({ target: v.root, clientX: 5, clientY: 5 }))
    v.seam.pointerUp(ptr({ target: v.root, clientX: 5, clientY: 5 }))
    expect(v.root.querySelector('.p-menu')).toBeNull()
    expect(v.root.querySelector('.p-node.selected')).toBeNull()
    expect(actions).toHaveLength(0)
    expect(onDirty).not.toHaveBeenCalled()

    // Wheel also dismisses…
    v.seam.contextMenu(ptr({ target: a, clientX: 10, clientY: 10 }))
    expect(v.root.querySelector('.p-menu')).not.toBeNull()
    v.seam.wheel(ptr({ target: v.root, deltaY: 100 }))
    expect(v.root.querySelector('.p-menu')).toBeNull()

    // …and while a menu is open, root shortcuts are owned by the menu.
    v.seam.contextMenu(ptr({ target: a, clientX: 10, clientY: 10 }))
    v.seam.key(key({ key: 'g', target: v.root }))
    expect(v.root.querySelector('.p-dialog')).toBeNull()
    v.seam.key(key({ key: 'Escape', target: v.root })) // Esc closes the menu
    expect(v.root.querySelector('.p-menu')).toBeNull()
  })

  it('a press on the menu chrome is swallowed; an enabled item acts and closes', () => {
    const { v, actions } = view()
    v.reconcile(arrangedInput)
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="甲"]')!
    v.seam.contextMenu(ptr({ target: head, clientX: 10, clientY: 10 }))
    const menu = v.root.querySelector<HTMLElement>('.p-menu')!
    v.seam.pointerDown(ptr({ target: menu, clientX: 10, clientY: 10 }))
    v.seam.pointerUp(ptr({ target: menu, clientX: 10, clientY: 10 }))
    expect(v.root.querySelector('.p-menu')).not.toBeNull() // chrome press keeps it open
    const item = menu.querySelector<HTMLButtonElement>('[role=menuitem]')! // 解散团队, enabled
    item.click()
    expect(actions).toEqual([{ type: 'remove-team', name: '甲' }])
    expect(v.root.querySelector('.p-menu')).toBeNull()
  })

  it('queued same-team actions keep the guard up until BOTH settle (the race)', async () => {
    const { v, actions, settle } = view(true)
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    const edgeForA = (): boolean =>
      Array.from(v.root.querySelectorAll('svg .e-member')).some(l => l.getAttribute('x2') === '0')
    // Gesture 1: drag a out to blank -> remove-member (in flight)
    drag(v, a, { x: 0, y: 0 }, { x: 1500, y: 800 })
    // Gesture 2 (same team, queued): drag a back into the frame -> add-member
    drag(v, a, { x: 1500, y: 800 }, { x: 10, y: 10 })
    expect(actions).toHaveLength(2)
    // A poll arrives BEFORE either settles, carrying the old payload:
    v.reconcile(arrangedInput)
    expect(edgeForA()).toBe(true) // refcount guard: a's optimistic edge survives
    await settle(true) // op 1 settles
    v.reconcile(arrangedInput)
    expect(edgeForA()).toBe(true) // op 2 still in flight: guard must stay up
    await settle(true) // op 2 settles
    v.reconcile(arrangedInput)
    expect(edgeForA()).toBe(true)
  })

  it('Esc after a drill-down restores focus to the anchored card', () => {
    const { v } = view(true)
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    a.focus()
    v.seam.contextMenu(ptr({ target: a, clientX: 10, clientY: 10 }))
    const join = Array.from(v.root.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
      .find(b => b.textContent!.includes('加入团队'))!
    join.click() // drill down (the root close consumed the anchor)
    v.seam.key(key({ key: 'Escape', target: v.root })) // close from the drilled level
    expect(document.activeElement).toBe(a) // re-seeded anchor: canvas stays keyboard-alive
  })

  it('frame-head context menu offers 解散团队 and emits remove-team', () => {
    const { v, actions } = view()
    v.reconcile(arrangedInput)
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="甲"]')!
    v.seam.contextMenu(ptr({ target: head, clientX: 10, clientY: 10 }))
    const item = Array.from(v.root.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
      .find(b => b.textContent!.includes('解散团队'))!
    item.click()
    expect(actions).toEqual([{ type: 'remove-team', name: '甲' }])
  })

  it('Delete on a team-less node raises info; Delete on a frame head removes the team', () => {
    const { v, actions } = view()
    v.reconcile(baseInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    a.focus()
    v.seam.key(key({ key: 'Delete', target: a, preventDefault: () => {} }))
    expect(actions).toHaveLength(0)
    expect(v.root.textContent).toContain('未加入任何团队')

    const v2 = view()
    v2.v.reconcile(arrangedInput)
    const head = v2.v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="甲"]')!
    head.focus()
    v2.v.seam.key(key({ key: 'Delete', target: head, preventDefault: () => {} }))
    expect(v2.actions).toEqual([{ type: 'remove-team', name: '甲' }])
  })
})

describe('drop targeting', () => {
  it('drag into a frame highlights it and emits add-member for non-members', () => {
    const { v, actions } = view(true)
    v.reconcile(arrangedInput)
    const b = v.root.querySelector<HTMLElement>('.p-node[data-id="b"]')!
    const frame = v.root.querySelector<HTMLElement>('.p-frame[data-name="甲"]')!
    drag(v, b, { x: 600, y: 0 }, { x: 10, y: 10 })
    expect(frame.classList.contains('drop-target')).toBe(false) // cleared on release
    expect(actions).toEqual([{ type: 'add-member', team: '甲', ids: ['b'] }])
  })

  it('drag out to blank emits remove-member against the origin team', () => {
    const { v, actions } = view(true)
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    drag(v, a, { x: 0, y: 0 }, { x: 1500, y: 800 })
    expect(actions).toEqual([{ type: 'remove-member', team: '甲', ids: ['a'] }])
  })

  it('dropping inside the own frame y-sorts members (reorder when changed)', () => {
    const { v, actions } = view(true)
    v.reconcile(arrangedInput)
    const c = v.root.querySelector<HTMLElement>('.p-node[data-id="c"]')!
    // c (y=80) dragged above a (y=0): desired [c, a] ≠ current [a, c].
    drag(v, c, { x: 0, y: 80 }, { x: 0, y: -60 })
    expect(actions).toHaveLength(1)
    expect(actions[0]!.type).toBe('reorder')
    expect((actions[0] as { team: string }).team).toBe('甲')
  })

  it('no drop logic without movement (plain click)', () => {
    const { v, actions } = view(true)
    v.reconcile(arrangedInput)
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.pointerDown(ptr({ target: a, clientX: 0, clientY: 0 }))
    v.seam.pointerUp(ptr({ target: a, clientX: 0, clientY: 0 }))
    expect(actions).toHaveLength(0)
  })
})

describe('Alt+arrows priority reorder', () => {
  function singleTeamView() {
    const v3 = view(true)
    v3.v.reconcile({
      sessions: [
        { id: 'a', label: 'A', team: 'x/a', joined: true, live: true },
        { id: 'b', label: 'B', team: 'x/b', joined: true, live: true },
        { id: 'c', label: 'C', team: 'x/c', joined: true, live: true },
        { id: 'd', label: 'D', team: 'x/d', joined: true, live: true },
      ],
      teams: [{ name: '甲', team: 'dsh/canvas/jia', members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }],
      peerCount: 0,
    })
    return v3
  }
  const focusCard = (v: ReturnType<typeof view>['v'], id: string): void => {
    v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!.focus()
  }

  it('Alt+ArrowUp promotes the focused member one slot', () => {
    const v3 = singleTeamView()
    focusCard(v3.v, 'b')
    v3.v.seam.key(key({ key: 'ArrowUp', altKey: true, target: v3.v.root, preventDefault: () => {} }))
    expect(v3.actions[0]!.type).toBe('reorder')
    expect((v3.actions[0] as { team: string }).team).toBe('甲')
  })

  it('boundaries emit nothing (first up, last down)', () => {
    const v3 = singleTeamView()
    focusCard(v3.v, 'a')
    v3.v.seam.key(key({ key: 'ArrowUp', altKey: true, target: v3.v.root, preventDefault: () => {} }))
    expect(v3.actions).toHaveLength(0) // already first
    focusCard(v3.v, 'c')
    v3.v.seam.key(key({ key: 'ArrowDown', altKey: true, target: v3.v.root, preventDefault: () => {} }))
    expect(v3.actions).toHaveLength(0) // already last
  })
})

describe('notices', () => {
  it('keeps at most three and auto-dismisses after 4s', () => {
    vi.useFakeTimers()
    try {
      const { v } = view()
      v.notice('info', 'one')
      v.notice('info', 'two')
      v.notice('info', 'three')
      v.notice('error', 'four — host text')
      const stack = v.root.querySelector('.p-notice-stack')!
      expect(stack.childElementCount).toBe(3)
      expect(stack.textContent).not.toContain('one')
      const err = stack.querySelectorAll('.p-notice.error')
      expect(err).toHaveLength(1)
      expect(err[0]!.getAttribute('role')).toBe('alert')
      vi.advanceTimersByTime(4100)
      expect(stack.childElementCount).toBe(0)
    } finally {
      vi.useRealTimers() // no fake-timer leak into the rest of the file
    }
  })
})

describe('optimistic edges', () => {
  it('an optimistic add-member repaints its edge before the wire settles', () => {
    const { v, actions } = view(true)
    v.reconcile(arrangedInput)
    const lines0 = v.root.querySelectorAll('svg .e-member').length
    const b = v.root.querySelector<HTMLElement>('.p-node[data-id="b"]')!
    drag(v, b, { x: 600, y: 0 }, { x: 10, y: 10 }) // add-member 甲 b (pending)
    const lines1 = v.root.querySelectorAll('svg .e-member').length
    expect(lines1).toBe(lines0 + 1) // model-derived edges, not payload edges
    expect(actions).toHaveLength(1)
  })
})
