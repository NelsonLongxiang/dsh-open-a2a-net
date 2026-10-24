// @vitest-environment jsdom
/**
 * gh#41 fleet planning: the peers' published canvas org renders as REMOTE
 * team frames on the board, and a drop into a remote frame carries
 * fleetPeer — the action forks to the host relay instead of the local
 * canvas control (any peer composes and regulates the whole fleet).
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'

function ptr(o: Partial<SeamPointer>): SeamPointer {
  return { button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o }
}

const NOW = 72_400
const input: PlanningInput = {
  sessions: [
    { id: 'a', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true },
  ],
  teams: [{ name: '本地队', team: 'dsh/canvas/local', members: [{ id: 'a' }] }],
  peerCount: 1,
  peers: [{ url: 'https://10.0.0.5:8787', score: 0.9 }],
  inFlight: [],
  remoteTeams: [{ team: 'peerzone/d659a8f9', name: '集富物流', via: 'https://10.0.0.5:8787' }],
  peerOrg: [{ url: 'https://10.0.0.5:8787', org: [{ name: '远端研发', team: 'peerzone/canvas/远端研发', members: ['peerzone/d659a8f9'] }] }],
}

describe('gh#41 remote org frames + fleet drop fork', () => {
  it('the peer org renders as a remote frame; its member card joins the frame', () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    const all = [...v.root.querySelectorAll('.p-frame')].map(n => n.dataset.name)
    console.log('FRAMES:', JSON.stringify(all))
    const frame = [...v.root.querySelectorAll('.p-frame')].find(n => n.dataset.name === '远端研发')
    expect(frame).toBeDefined()
    // The member card (gh#38) is attached to the remote frame by handle.
    const member = v.root.querySelector<HTMLElement>('.p-node[data-id="member-peerzone-d659a8f9"]')
    expect(member).not.toBeNull()
  })

  it('dropping a LOCAL card into a REMOTE frame emits add-member carrying fleetPeer', async () => {
    const actions: Array<{ type: string; team?: string; ids?: readonly string[]; fleetPeer?: string }> = []
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async a => { actions.push(a as { type: string }); return true }, now: () => NOW })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    // Default remote-frame rect {x:200,y:940,w:250,h:130}; viewport at
    // origin scale 1 → world point == screen point.
    const frameEl = v.root.querySelector<HTMLElement>('.p-frame[data-name="远端研发"]')!
    expect(frameEl).not.toBeNull()
    const cx = 325
    const cy = 1005
    const card = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.pointerDown(ptr({ target: card, clientX: 400, clientY: 0 }))
    v.seam.pointerMove(ptr({ target: card, clientX: cx, clientY: cy }))
    v.seam.pointerUp(ptr({ target: frameEl, clientX: cx, clientY: cy }))
    await vi.waitFor(() => {
      const add = actions.find(a => a.type === 'add-member') as { team?: string; fleetPeer?: string } | undefined
      expect(add).toBeDefined()
      expect(add?.fleetPeer).toBe('https://10.0.0.5:8787')
      expect(add?.team).toBe('远端研发')
    })
  }, 15_000)
})
