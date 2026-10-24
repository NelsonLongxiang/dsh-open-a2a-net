// @vitest-environment jsdom
/**
 * gh#38 (owner ruling 「统一到画布里面拖拽」): every remote session-team
 * HANDLE renders as its own draggable member card beside its host's peer
 * card — pulling a remote member into a local team is a plain drag into a
 * frame (or 建队 selection). The server boundary translates member- ids to
 * their handles exactly like peer- ids.
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
const teams = [{ name: '本地队', team: 'dsh/canvas/local', members: [{ id: 'a' }] }]
const peers = [{ url: 'https://10.0.0.5:8787', score: 0.9 }]
const input: PlanningInput = {
  sessions,
  teams,
  peerCount: peers.length,
  peers,
  inFlight: [],
  remoteTeams: [
    { team: 'peerzone/d659a8f9', name: '集富物流', via: 'https://10.0.0.5:8787' },
    { team: 'peerzone/004ee0e6', name: '开发席', via: 'https://10.0.0.5:8787' },
    { team: 'peerzone', name: 'bare zone row', via: 'https://10.0.0.5:8787' }, // 无句柄——不建卡
  ],
}

describe('gh#38 remote member cards on the board', () => {
  it('handle rows render as member cards beside the host; bare rows do not', () => {
    const actions: Array<{ type: string; ids?: readonly string[]; name?: string; team?: string }> = []
    const v = createPlanningView({
      onDirty: vi.fn(),
      onLampClick: vi.fn(),
      onCanvasAction: async a => { actions.push(a as { type: string }); return true },
      now: () => NOW,
    })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    const m1 = v.root.querySelector<HTMLElement>('.p-node[data-id="member-peerzone-d659a8f9"]')
    const m2 = v.root.querySelector<HTMLElement>('.p-node[data-id="member-peerzone-004ee0e6"]')
    expect(m1).not.toBeNull()
    expect(m1?.textContent).toContain('集富物流')
    expect(m2?.textContent).toContain('开发席')
    // The bare-zone row (no handle) never becomes a card.
    expect(v.root.querySelectorAll('.p-node[data-id^="member-"]').length).toBe(2)
  })

  it('dropping a member card into a frame emits add-member with the HANDLE (not the card id)', async () => {
    const actions: Array<{ type: string; ids?: readonly string[]; team?: string }> = []
    const v = createPlanningView({
      onDirty: vi.fn(),
      onLampClick: vi.fn(),
      onCanvasAction: async a => { actions.push(a as { type: string }); return true },
      now: () => NOW,
    })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    const memberCard = v.root.querySelector<HTMLElement>('.p-node[data-id="member-peerzone-d659a8f9"]')!
    // Drag it into the 本地队 frame (world point inside the frame).
    v.seam.pointerDown(ptr({ target: memberCard, clientX: 400, clientY: 0 }))
    v.seam.pointerMove(ptr({ target: memberCard, clientX: 0, clientY: 0 }))
    v.seam.pointerUp(ptr({ target: memberCard, clientX: 0, clientY: 0 }))
    await vi.waitFor(() => expect(actions.some(a => a.type === 'add-member')).toBe(true))
    const add = actions.find(a => a.type === 'add-member') as { ids?: readonly string[]; team?: string }
    expect(add.ids).toContain('peerzone/d659a8f9')
    expect(add.ids?.some(id => id.startsWith('member-'))).toBe(false)
    expect(add.team).toBe('本地队')
  }, 15_000)
})
