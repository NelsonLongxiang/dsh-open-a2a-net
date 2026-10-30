// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView } from '../src/planning-view'
import type { LayoutDoc } from '../src/layout-doc'
import { createSaveLoop } from '../src/layout-wire'
import { settleAction } from '../src/canvas-ops'
import { WorldModel } from '../src/world'
const sessions = [
  { id: 'a', label: 'A', team: 'dsh/a', joined: true, live: true, teams: ['ops'] },
  { id: 'b', label: 'B', team: 'dsh/b', joined: true, live: true, teams: ['ops'] },
]
const empty = { sessions, teams: [], peerCount: 0 }
const team = { name: '新队', members: [{ id: 'a' }, { id: 'b' }] }
const saved = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }, frames: { 新队: { x: 9999, y: 9999, w: 250, h: 130 } } }
async function micro() { for (let i = 0; i < 15; i++) await Promise.resolve() }
function create(v: ReturnType<typeof createPlanningView>) {
  for (const id of ['a','b']) v.seam.key({ key: ' ', target: v.root.querySelector('.p-node[data-id="' + id + '"]'), preventDefault() {} })
  v.seam.key({ key: 'g', target: v.root, preventDefault() {} })
  const input = v.root.querySelector<HTMLInputElement>('.p-dialog input')!
  input.value = '新队'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}
describe('gh108 team settlement owns layout correction', () => {
  it('a slow optimistic-layout POST is followed by a rollback correction, not adopted back', async () => {
    let settle!: (ok: boolean) => void; let response!: (reply: {ok: boolean; layout: unknown}) => void
    const sent: LayoutDoc[] = []; const timers: Array<() => void> = []
    const v = createPlanningView({ onDirty: () => loop.markDirty(), onLampClick() {}, onCanvasAction: () => new Promise<boolean>(ok => { settle = ok }) })
    const loop = createSaveLoop({ snapshot: () => v.snapshotDoc(), send: async doc => {
      sent.push(doc as LayoutDoc)
      return sent.length === 1 ? new Promise(resolve => { response = resolve }) : { ok: true, layout: doc }
    }, schedule: fn => { timers.push(fn); return () => {} }, now: Date.now, onLamp() {}, onAdopt: doc => v.adoptExternalLayout(doc), onHttpError() {} })
    document.body.append(v.root); v.adoptExternalLayout(saved); v.reconcile(empty); create(v)
    loop.markDirty(); timers.pop()!(); await micro() // in-flight optimistic geometry
    expect(sent[0]!.frames['新队']).toBeDefined()
    settle(false); await micro(); response({ ok: true, layout: sent[0] }); await micro()
    timers.pop()!(); await micro()
    expect(sent.at(-1)!.frames['新队']).toBeUndefined()
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']).toBeUndefined()
    loop.dispose(); v.destroy()
  })
  it('cleans only the removed name, keeping node positions and offline remote-frame geometry', () => {
    const layout = { ...saved, frames: { ...saved.frames, Remote: { x: 300, y: 400, w: 250, h: 130 } } } as LayoutDoc
    const result = settleAction(new WorldModel(), { type: 'remove-team', name: '新队' }, true, () => {}, layout)!
    expect(result.frames['新队']).toBeUndefined(); expect(result.frames.Remote).toEqual(layout.frames.Remote)
    expect(result.nodes).toEqual(layout.nodes); expect(layout.frames['新队']).toBeDefined()
  })
  it.each(['refuse', 'throw'] as const)('failed create (%s) schedules a correcting save and cannot reuse orphan geometry', async mode => {
    let resolve!: (ok: boolean) => void; let reject!: () => void
    const dirty = vi.fn()
    const v = createPlanningView({ onDirty: dirty, onLampClick() {}, onCanvasAction: () => new Promise<boolean>((ok, fail) => { resolve = ok; reject = () => fail(new Error('down')) }) })
    document.body.append(v.root); v.adoptExternalLayout(saved); v.reconcile(empty); create(v)
    // Simulate geometry which escaped in an earlier layout save/adoption.
    v.adoptExternalLayout(saved)
    dirty.mockClear()
    if (mode === 'throw') reject(); else resolve(false)
    await micro()
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']).toBeUndefined()
    expect(dirty).toHaveBeenCalled()
    v.reconcile({ ...empty, teams: [team] })
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']).toBeDefined()
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']?.x).not.toBe(9999)
    v.destroy()
  })
  it('successful dissolve saves frame removal and a same-name team derives a new rect', async () => {
    const dirty = vi.fn()
    const v = createPlanningView({ onDirty: dirty, onLampClick() {}, onCanvasAction: async () => true })
    document.body.append(v.root); v.adoptExternalLayout(saved); v.reconcile({ ...empty, teams: [team] })
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="新队"]')!
    head.focus(); v.seam.key({ key: 'Delete', target: head, preventDefault() {} }); await micro()
    expect(dirty).toHaveBeenCalled()
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']).toBeUndefined()
    v.reconcile(empty); v.reconcile({ ...empty, teams: [team] })
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']).toBeDefined()
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']?.x).not.toBe(9999)
    v.destroy()
  })
  it('refused dissolve restores its rect and schedules correction rather than discarding saved geometry', async () => {
    const dirty = vi.fn()
    const v = createPlanningView({ onDirty: dirty, onLampClick() {}, onCanvasAction: async () => false })
    document.body.append(v.root); v.adoptExternalLayout(saved); v.reconcile({ ...empty, teams: [team] })
    const before = (v.snapshotDoc() as LayoutDoc).frames['新队']
    const head = v.root.querySelector<HTMLElement>('.p-frame-head[data-frame="新队"]')!
    head.focus(); v.seam.key({ key: 'Delete', target: head, preventDefault() {} }); await micro()
    expect((v.snapshotDoc() as LayoutDoc).frames['新队']).toEqual(before)
    expect(dirty).toHaveBeenCalled()
    v.destroy()
  })
})
