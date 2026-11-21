// @vitest-environment jsdom
/** #735: real board pointer drags use the same root join path as the menu, never a layout write on refusal. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type PlanningTeam } from '../src/planning-view'
import type { ComposeIo } from '../src/planning-root-compose'

const ref = (name: string) => `dsh/canvas/${name}@a1b2c3d4`
const team = (name: string, more: Partial<PlanningTeam> = {}): PlanningTeam => ({ name, team: `dsh/canvas/${name}`, id: ref(name), superagentTeam: true, members: [], ...more })
const views: ReturnType<typeof createPlanningView>[] = []
// jsdom has no CSS.escape; identifiers below are controlled ASCII fixture refs, not a production polyfill.
beforeEach(() => vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/["\\\\]/g, '\\\\$&') }))
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals() })

function board(teams = [team('Child'), team('Root', { root: true, children: [] })], io?: ComposeIo) {
  const call = vi.fn(async (_path: string, body?: unknown) => ({ status: 200, body: { ok: true, children: [{ ref: (body as { team: string }).team }] } }))
  const onDirty = vi.fn(), onCanvasAction = vi.fn(async () => true)
  const view = createPlanningView({ onDirty, onCanvasAction, onLampClick() {}, compose: io ?? { call }, viewSize: () => ({ w: 1000, h: 700 }) })
  views.push(view); document.body.append(view.root)
  const input: PlanningInput = { teams, sessions: [], peerCount: 0 }
  view.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: {}, frames: { Child: { x: 20, y: 40, w: 240, h: 140 }, Root: { x: 420, y: 40, w: 300, h: 220 }, Other: { x: 800, y: 40, w: 240, h: 140 } } })
  view.reconcile(input); view.activate()
  const head = () => view.root.querySelector<HTMLElement>('.p-frame-head[data-frame="Child"]')!
  const target = () => view.root.querySelector<HTMLElement>('.p-frame[data-name="Root"]')!
  const event = (type: string, x: number, y: number) => head().dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX: x, clientY: y }))
  const start = () => event('pointerdown', 100, 40)
  const move = () => event('pointermove', 500, 110)
  const drop = () => event('pointerup', 500, 110)
  return { view, call, onDirty, onCanvasAction, input, head, target, event, start, move, drop }
}

describe('#735 root frame pointer wiring', () => {
  it('a real pointer drag previews on the root and executes exactly one add-team with the advertised ref', async () => {
    const b = board(), before = b.view.snapshotDoc()
    b.start(); b.move()
    expect(b.target().textContent).toContain('松开加入为子团队：Child')
    b.drop()
    await vi.waitFor(() => expect(b.call).toHaveBeenCalledTimes(1))
    expect(b.call).toHaveBeenCalledWith('/__dsh_a2a/canvas', { action: 'add-team', name: 'Root', team: ref('Child') })
    expect(b.onCanvasAction).not.toHaveBeenCalled()
    expect(b.onDirty).not.toHaveBeenCalled()
    expect(b.view.snapshotDoc()).toEqual(before)
  })

  it.each([
    ['another root', { root: true }, '它已是 root 团队'],
    ['plain team', { superagentTeam: false }, '它不是 superagent 团队'],
    ['missing address', { id: undefined }, '没有画布地址'],
  ] as const)('a %s is refused visibly before any write', async (_why, extra, reason) => {
    const b = board([team('Child', extra), team('Root', { root: true, children: [] })]), before = b.view.snapshotDoc()
    b.start(); b.move(); b.drop()
    await Promise.resolve()
    expect(b.target().textContent).toContain(reason)
    expect(b.call).not.toHaveBeenCalled()
    expect(b.onCanvasAction).not.toHaveBeenCalled()
    expect(b.onDirty).not.toHaveBeenCalled()
    expect(b.view.snapshotDoc()).toEqual(before)
  })

  it('a poll during a drag is read again: a newly registered child is refused and no stale write is sent', async () => {
    const b = board()
    b.start(); b.move()
    b.view.reconcile({ ...b.input, teams: [team('Child'), team('Root', { root: true, children: [{ ref: ref('Child'), label: 'Child', slots: 1, open: 0, state: 'ready' }] })] })
    b.drop(); await Promise.resolve()
    expect(b.call).not.toHaveBeenCalled()
    expect(b.target().textContent).toContain('它已是这个 root 的子团队')
  })

  it('a target that stops being root after preview is refused without turning the drop into a layout save', async () => {
    const b = board(), before = b.view.snapshotDoc()
    b.start(); b.move()
    b.view.reconcile({ ...b.input, teams: [team('Child'), team('Root', { root: false })] })
    b.drop(); await Promise.resolve()
    expect(b.call).not.toHaveBeenCalled()
    expect(b.onDirty).not.toHaveBeenCalled()
    expect(b.view.snapshotDoc()).toEqual(before)
    expect(b.target().textContent).toContain('团队或 root 已变化')
  })

  it('a refused host reply stays on the root frame and does not retry or persist the dragged layout', async () => {
    const call = vi.fn(async () => ({ status: 200, body: { ok: false, error: 'fixture refusal' } }))
    const b = board(undefined, { call })
    b.start(); b.move(); b.drop()
    await vi.waitFor(() => expect(b.target().textContent).toContain('fixture refusal'))
    expect(call).toHaveBeenCalledTimes(1)
    expect(b.onDirty).not.toHaveBeenCalled()
  })

  it('duplicate drop gestures while the original add-team is pending do not write twice', async () => {
    let release!: (value: { status: number; body: unknown }) => void
    const call = vi.fn(() => new Promise<{ status: number; body: unknown }>(done => { release = done }))
    const b = board(undefined, { call })
    b.start(); b.move(); b.drop()
    expect(call).toHaveBeenCalledTimes(1)
    b.start(); b.move(); b.drop()
    expect(call).toHaveBeenCalledTimes(1)
    release({ status: 200, body: { ok: true, children: [{ ref: ref('Child') }] } })
    await vi.waitFor(() => expect(b.target().textContent).not.toContain('正在加入'))
    expect(b.onDirty).not.toHaveBeenCalled()
  })

  it('native drag events use the same current target controller and do not accumulate across polls', async () => {
    const b = board()
    const drag = (type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/team-frame'], getData: (kind: string) => kind === 'text/team-frame' ? 'Child' : '' } })
      b.target().dispatchEvent(ev)
    }
    b.view.reconcile(b.input); b.view.reconcile(b.input)
    drag('dragover')
    expect(b.target().textContent).toContain('松开加入为子团队：Child')
    drag('drop')
    await vi.waitFor(() => expect(b.call).toHaveBeenCalledTimes(1))
    expect(b.call).toHaveBeenCalledWith('/__dsh_a2a/canvas', { action: 'add-team', name: 'Root', team: ref('Child') })
    expect(b.onDirty).not.toHaveBeenCalled()
  })

  it('a late unknown reply after the view is destroyed cannot repaint a detached frame', async () => {
    let release!: (value: { status: number; body: unknown }) => void
    const call = vi.fn(() => new Promise<{ status: number; body: unknown }>(done => { release = done }))
    const b = board(undefined, { call })
    b.start(); b.move(); b.drop()
    const target = b.target(), before = target.textContent
    b.view.destroy()
    release({ status: 500, body: { ok: false, error: 'late fixture refusal' } })
    await new Promise<void>(done => setTimeout(done, 0))
    expect(target.textContent).toBe(before)
  })

  it('cancelling a drag removes its preview and sends nothing', () => {
    const b = board(), before = b.view.snapshotDoc()
    b.start(); b.move(); b.event('pointercancel', 500, 110)
    expect(b.target().textContent).not.toContain('松开加入')
    expect(b.call).not.toHaveBeenCalled()
    expect(b.view.snapshotDoc()).toEqual(before)
  })

  it('a completed drag with no root target remains an ordinary persisted layout move', () => {
    const b = board(), before = b.view.snapshotDoc()
    b.start(); b.event('pointermove', 300, 300); b.event('pointerup', 300, 300)
    expect(b.call).not.toHaveBeenCalled()
    expect(b.onDirty).toHaveBeenCalledTimes(1)
    expect(b.view.snapshotDoc()).not.toEqual(before)
  })
})
