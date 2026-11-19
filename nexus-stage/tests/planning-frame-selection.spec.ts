// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'

const input: PlanningInput = {
  sessions: [
    { id: 's1', label: 'One', team: 'dsh/11111111', joined: true },
    { id: 's2', label: 'Two', team: 'dsh/22222222', joined: true },
  ],
  teams: [
    { name: 'Alpha', team: 'dsh/canvas/Alpha', members: [{ id: 's1' }] },
    { name: 'Beta', team: 'dsh/canvas/Beta', members: [{ id: 's2' }] },
  ],
  peerCount: 0,
}
const views: ReturnType<typeof createPlanningView>[] = []
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren() })
function setup() {
  const onDirty = vi.fn(), onCanvasAction = vi.fn(async () => true)
  const view = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction, viewSize: () => ({ w: 1000, h: 700 }) })
  views.push(view); document.body.append(view.root); view.reconcile(input)
  const head = (name: string) => view.root.querySelector<HTMLElement>('.p-frame-head[data-frame="' + name + '"]')!
  const frame = (name: string) => head(name).closest<HTMLElement>('.p-frame')!
  return { view, head, frame, onDirty, onCanvasAction }
}
function click(head: HTMLElement, shiftKey = false) {
  for (const type of ['pointerdown', 'pointerup']) head.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, shiftKey, clientX: 20, clientY: 20 }))
}
function key(target: HTMLElement, value: string, shiftKey = false) { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, shiftKey })) }

describe('team frame selection before root composition', () => {
  it('shift-selects two frames without moving members or writing, and preserves selection over polling', () => {
    const { view, head, frame, onDirty, onCanvasAction } = setup()
    const before = view.snapshotDoc()
    click(head('Alpha')); click(head('Beta'), true)
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(frame('Beta').classList.contains('selected')).toBe(true)
    expect(head('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(head('Beta').getAttribute('aria-pressed')).toBe('true')
    view.reconcile(input)
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(frame('Beta').classList.contains('selected')).toBe(true)
    expect(view.snapshotDoc()).toEqual(before)
    expect(onDirty).not.toHaveBeenCalled(); expect(onCanvasAction).not.toHaveBeenCalled()
  })
  it('shift-click toggles one selected frame while a plain click replaces the selection', () => {
    const { head, frame, onCanvasAction } = setup()
    click(head('Alpha')); click(head('Beta'), true); click(head('Alpha'), true)
    expect(frame('Alpha').classList.contains('selected')).toBe(false)
    expect(frame('Beta').classList.contains('selected')).toBe(true)
    click(head('Alpha'))
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(frame('Beta').classList.contains('selected')).toBe(false)
    expect(onCanvasAction).not.toHaveBeenCalled()
  })
  it('supports keyboard frame multi-selection with Shift+Space and Escape without opening a menu', () => {
    const { view, head, frame, onDirty, onCanvasAction } = setup()
    head('Alpha').focus(); key(head('Alpha'), ' ', true)
    head('Beta').focus(); key(head('Beta'), ' ', true)
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(frame('Beta').classList.contains('selected')).toBe(true)
    expect(view.root.querySelector('.p-menu')).toBeNull()
    key(view.root, 'Escape')
    expect(frame('Alpha').classList.contains('selected')).toBe(false)
    expect(frame('Beta').classList.contains('selected')).toBe(false)
    expect(onDirty).not.toHaveBeenCalled(); expect(onCanvasAction).not.toHaveBeenCalled()
  })
  it('clears frame selection on a session click, but not on toolbar interaction', () => {
    const { view, head, frame } = setup()
    click(head('Alpha')); click(head('Beta'), true)
    view.root.querySelector<HTMLButtonElement>('.p-toolbar button')!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(frame('Beta').classList.contains('selected')).toBe(true)
    const node = view.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    click(node)
    expect(frame('Alpha').classList.contains('selected')).toBe(false)
    expect(frame('Beta').classList.contains('selected')).toBe(false)
  })
  it('switches from frame selection to keyboard card selection without retaining a mixed selection', () => {
    const { view, head, frame, onDirty, onCanvasAction } = setup()
    click(head('Alpha')); click(head('Beta'), true)
    const node = view.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    node.focus(); key(node, ' ')
    expect(node.classList.contains('selected')).toBe(true)
    expect(frame('Alpha').classList.contains('selected')).toBe(false)
    expect(frame('Beta').classList.contains('selected')).toBe(false)
    expect(onDirty).not.toHaveBeenCalled(); expect(onCanvasAction).not.toHaveBeenCalled()
  })
  it.each(['pointer', 'keyboard'] as const)('clears painted session selection immediately when switching to a frame by %s', method => {
    const { view, head, frame, onDirty, onCanvasAction } = setup()
    const node = view.root.querySelector<HTMLElement>('.p-node[data-id="s1"]')!
    node.focus(); key(node, ' ')
    expect(node.classList.contains('selected')).toBe(true)
    if (method === 'pointer') click(head('Alpha'))
    else key(head('Alpha'), ' ', true)
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(node.classList.contains('selected')).toBe(false)
    expect(onDirty).not.toHaveBeenCalled(); expect(onCanvasAction).not.toHaveBeenCalled()
  })
  it('prunes a removed frame from selection and does not select a later same-name team', () => {
    const { view, head, frame, onDirty, onCanvasAction } = setup()
    click(head('Alpha')); click(head('Beta'), true)
    view.reconcile({ ...input, teams: input.teams.filter(t => t.name !== 'Beta') })
    expect(view.root.querySelector('.p-frame[data-name="Beta"]')).toBeNull()
    view.reconcile(input)
    expect(frame('Alpha').classList.contains('selected')).toBe(true)
    expect(frame('Beta').classList.contains('selected')).toBe(false)
    expect(head('Beta').getAttribute('aria-pressed')).toBe('false')
    expect(onDirty).not.toHaveBeenCalled(); expect(onCanvasAction).not.toHaveBeenCalled()
  })
})
