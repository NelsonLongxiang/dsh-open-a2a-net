// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type SeamKey, type SeamPointer } from '../src/planning-view.ts'

const sessions = [
  { id: 'a', label: 'A', team: 't/a', joined: true, live: true },
  { id: 'c', label: 'C', team: 't/c', joined: true, live: true },
]
const arrangedInput = {
  sessions,
  teams: [{ name: '甲', team: 't/canvas/jia', members: [{ id: 'a' }, { id: 'c' }] }],
  peerCount: 0,
  peers: [{ url: 'http://p1:80', score: 1 }],
}
const arrangedLayout = {
  version: 1, viewport: { x: 0, y: 0, scale: 1 },
  nodes: { a: { x: 0, y: 0 }, c: { x: 0, y: 80 } },
  frames: { 甲: { x: -200, y: -200, w: 500, h: 400 } },
}

function ptr(o: Partial<SeamPointer>): SeamPointer {
  return { button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o }
}
function key(o: Partial<SeamKey>): SeamKey {
  return { key: '', shiftKey: false, target: null, preventDefault: () => {}, ...o }
}

describe('probe: peer 建队', () => {
  it('traces', () => {
    const actions: unknown[] = []
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: a => { actions.push(a); return Promise.resolve(true) } })
    document.body.appendChild(v.root)
    v.adoptExternalLayout(arrangedLayout)
    v.reconcile(arrangedInput)
    console.log('cards:', [...v.root.querySelectorAll('.p-node')].map(e => e.dataset.id))
    const a = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    const c = v.root.querySelector<HTMLElement>('.p-node[data-id="c"]')!
    const peerCard = v.root.querySelector<HTMLElement>('.p-node.remote')!
    console.log('baseline selected:', [...v.root.querySelectorAll('.p-node.selected')].map(e => e.dataset.id))
    v.seam.pointerDown(ptr({ target: a, clientX: 0, clientY: 0 }))
    v.seam.pointerUp(ptr({ target: a, clientX: 0, clientY: 0 }))
    console.log('after click a:', [...v.root.querySelectorAll('.p-node.selected')].map(e => e.dataset.id))
    v.seam.pointerDown(ptr({ target: c, clientX: 5, clientY: 5, shiftKey: true }))
    v.seam.pointerUp(ptr({ target: c, clientX: 5, clientY: 5, shiftKey: true }))
    console.log('after shift-click c:', [...v.root.querySelectorAll('.p-node.selected')].map(e => e.dataset.id))
    v.seam.pointerDown(ptr({ target: peerCard, clientX: 5, clientY: 5, shiftKey: true }))
    v.seam.pointerUp(ptr({ target: peerCard, clientX: 5, clientY: 5, shiftKey: true }))
    console.log('after shift-click peer:', [...v.root.querySelectorAll('.p-node.selected')].map(e => e.dataset.id))
    v.seam.key(key({ key: 'g', target: v.root }))
    console.log('dialog:', v.root.querySelector('.p-dialog') !== null)
    expect(true).toBe(true)
  })
})
