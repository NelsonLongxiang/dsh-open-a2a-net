// @vitest-environment jsdom
/**
 * gh#20 W-B end-to-end: marquee-select a LOCAL session + a REMOTE peer
 * (with handle) → 组成团队 → the server boundary receives the peer's
 * zone/id8 HANDLE (not the peer- node id) — the cross-host compose
 * pipeline. A peer WITHOUT a handle never reaches the server action.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'

function ptr(o: Partial<SeamPointer>): SeamPointer {
  return { button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o }
}

const NOW = 72_400

const sessions = [
  { id: 'a', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true },
]
const peers = [
  { url: 'https://10.0.0.5:8787', score: 0.9 },
  { url: 'http://192.168.3.9:13080', score: 0.4 },
]
const input: PlanningInput = {
  sessions,
  // Teamed-only canvas: 'a' needs a canvas team to earn a board node.
  teams: [{ name: 'home', team: 'dsh/canvas/home', members: [{ id: 'a' }] }],
  peerCount: peers.length,
  peers,
  inFlight: [],
  // 10.0.0.5 carries a remote team row (handle); 192.168.3.9 does not.
  remoteTeams: [{ team: 'peerzone/01234567', via: 'https://10.0.0.5:8787' }],
}

describe('W-B cross-host compose pipeline', () => {
  it('mixed selection create-team emits the peer HANDLE at the server boundary; handleless peers are dropped', async () => {
    const actions: Array<{ type: string; ids?: readonly string[]; name?: string }> = []
    const v = createPlanningView({
      onDirty: vi.fn(),
      onLampClick: vi.fn(),
      onCanvasAction: async a => { actions.push(a as { type: string }); return true },
      now: () => NOW,
    })
    document.body.appendChild(v.root)
    // Adopt a fixed identity layout BEFORE reconcile so the first-fit never
    // pans/scales (client coords == world coords for the marquee below).
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: {} })
    v.reconcile(input)
    // Marquee over everything (blank-drag): selects the local session AND
    // both peers — the 建队 filter keeps local + WITH-HANDLE peers only.
    v.seam.pointerDown(ptr({ target: v.root, clientX: -2000, clientY: -2000 }))
    v.seam.pointerMove(ptr({ target: v.root, clientX: 4000, clientY: 4000 }))
    v.seam.pointerUp(ptr({ target: v.root, clientX: 4000, clientY: 4000 }))
    // Create-team from the selection via the keyboard shortcut (g).
    v.seam.key({ key: 'g', shiftKey: false, altKey: false, target: v.root, preventDefault: () => {} })
    const dialogInput = v.root.querySelector<HTMLInputElement>('.p-dialog-input')!
    dialogInput.value = '跨宿队'
    dialogInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => expect(actions.length).toBeGreaterThan(0))
    // The server saw the local id + the peer's HANDLE (never the peer- id).
    const created = actions.find(a => a.type === 'create-team') as { ids?: readonly string[] }
    expect(created?.ids).toContain('a')
    expect(created?.ids).toContain('peerzone/01234567')
    expect(created?.ids?.some(id => id.startsWith('peer-'))).toBe(false)
    v.root.remove()
  }, 15_000)
})
