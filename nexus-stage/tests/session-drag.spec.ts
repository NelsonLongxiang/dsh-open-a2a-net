// @vitest-environment jsdom
/**
 * Owner request 2026-11-04: 左侧边栏 · 本机会话 can be dragged straight into a canvas team.
 * The rail row carries the session id in a private drag type; the board turns a drop on a
 * frame into the same add-member a card drop makes (mirror frames keep their fleetPeer).
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'
import { makeSessionDraggable, SESSION_DRAG_TYPE } from '../src/session-drag.ts'

const PEER = 'https://10.0.0.5:8787'
const LONE = 'session-22222222-0000'
const input: PlanningInput = {
  sessions: [
    { id: 'session-11111111-0000', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true },
    { id: LONE, label: 'B', team: 'dsh/22222222', name: 'beta', joined: true, live: true },
  ],
  teams: [{ name: '本地队', team: 'dsh/canvas/local', members: [{ id: 'session-11111111-0000' }] }],
  peerCount: 1,
  peers: [{ url: PEER, score: 0.9 }],
  inFlight: [],
  remoteTeams: [{ team: 'peerzone/d659a8f9', name: '集富物流', via: PEER }],
  peerOrg: [{ url: PEER, org: [{ name: '远端研发', team: 'peerzone/canvas/远端研发', members: ['peerzone/d659a8f9'] }] }],
}

function fakeTransfer(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (t: string) => data[t] ?? '', setData: (t: string, v: string) => { data[t] = v }, dropEffect: 'none', effectAllowed: 'all' }
}
function dragEvent(type: string, x: number, y: number, data: Record<string, string>): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, dataTransfer: fakeTransfer(data) })
}
function mount() {
  const actions: Array<{ type: string; team?: string; ids?: readonly string[]; fleetPeer?: string }> = []
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async a => { actions.push(a); return true }, now: () => 72_400 })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { 'session-11111111-0000': { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 }, 远端研发: { x: 600, y: -200, w: 300, h: 200 } } })
  v.reconcile(input)
  return { v, actions }
}

describe('drag a rail session into a canvas team', () => {
  it('a rail row becomes draggable and carries its session id in the private type', () => {
    const item = document.createElement('button')
    makeSessionDraggable(item, LONE)
    expect(item.draggable).toBe(true)
    const ev = dragEvent('dragstart', 0, 0, {})
    item.dispatchEvent(ev)
    expect((ev as unknown as { dataTransfer: { getData(t: string): string } }).dataTransfer.getData(SESSION_DRAG_TYPE)).toBe(LONE)
  })

  it('dropping a teamless session on a local frame emits add-member for that team', async () => {
    const { v, actions } = mount()
    const over = dragEvent('dragover', 10, 10, { [SESSION_DRAG_TYPE]: LONE })
    v.root.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(v.root.querySelector('.p-frame[data-name="本地队"]')?.classList.contains('drop-target')).toBe(true)
    v.root.dispatchEvent(dragEvent('drop', 10, 10, { [SESSION_DRAG_TYPE]: LONE }))
    await vi.waitFor(() => expect(actions.find(a => a.type === 'add-member')).toMatchObject({ team: '本地队', ids: [LONE] }))
    expect(v.root.querySelector('.drop-target')).toBeNull()
    v.destroy()
  })

  it('a drop on a mirror frame relays to its owner', async () => {
    const { v, actions } = mount()
    v.root.dispatchEvent(dragEvent('drop', 700, -100, { [SESSION_DRAG_TYPE]: LONE }))
    await vi.waitFor(() => expect(actions.find(a => a.type === 'add-member')).toMatchObject({ team: '远端研发', ids: [LONE], fleetPeer: PEER }))
    v.destroy()
  })

  it('blank board, foreign drags and an existing member do not write', async () => {
    const { v, actions } = mount()
    const blank = dragEvent('dragover', 2000, 2000, { [SESSION_DRAG_TYPE]: LONE })
    v.root.dispatchEvent(blank)
    expect(blank.defaultPrevented).toBe(false)
    v.root.dispatchEvent(dragEvent('drop', 2000, 2000, { [SESSION_DRAG_TYPE]: LONE }))
    v.root.dispatchEvent(dragEvent('drop', 10, 10, { 'text/plain': LONE }))
    v.root.dispatchEvent(dragEvent('drop', 10, 10, { [SESSION_DRAG_TYPE]: 'session-11111111-0000' }))
    await new Promise(r => setTimeout(r, 20))
    expect(actions).toHaveLength(0)
    expect(v.root.textContent).toContain('该会话已在这个队里')
    v.destroy()
  })
})
