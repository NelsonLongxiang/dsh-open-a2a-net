// @vitest-environment jsdom
/**
 * Owner report 2026-11-04: 「离队，无法离开镜像 canvas 队伍」. The node menu's 离队 drill-down
 * listed only this host's own teams, so a card in a mirror frame (a peer's team) had nothing
 * to pick — and with no local team at all the 离队 entry was not even offered. A mirror
 * membership leaves through the owner's relay: the action carries fleetPeer.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'

function ptr(o: Partial<SeamPointer>): SeamPointer {
  return { button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o }
}

const PEER = 'https://10.0.0.5:8787'
const base: PlanningInput = {
  sessions: [{ id: 'session-11111111-0000', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true }],
  teams: [],
  peerCount: 1,
  peers: [{ url: PEER, score: 0.9 }],
  inFlight: [],
  remoteTeams: [{ team: 'peerzone/d659a8f9', name: '集富物流', via: PEER }],
  peerOrg: [{ url: PEER, org: [{ name: '远端研发', team: 'peerzone/canvas/远端研发', members: ['dsh/11111111', 'peerzone/d659a8f9'] }] }],
}

function mount(input: PlanningInput) {
  const actions: Array<{ type: string; team?: string; ids?: readonly string[]; fleetPeer?: string }> = []
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async a => { actions.push(a); return true }, now: () => 72_400 })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { 'session-11111111-0000': { x: 0, y: 0 } }, frames: {} })
  v.reconcile(input)
  return { v, actions }
}
const items = (v: { root: HTMLElement }) => Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-menu [role=menuitem]'))
const openLeave = (v: { root: HTMLElement; seam: { contextMenu(p: SeamPointer): void } }, id: string) => {
  v.seam.contextMenu(ptr({ target: v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!, clientX: 10, clientY: 10 }))
  const leave = items(v).find(b => b.textContent!.includes('离队'))
  expect(leave).toBeDefined()
  leave!.click()
  return items(v)
}

describe('离队 from a mirror frame', () => {
  it('a local card whose only team is a mirror is offered 离队, and leaving relays to the owner', async () => {
    const { v, actions } = mount(base)
    const leaveItems = openLeave(v, 'session-11111111-0000')
    const mirror = leaveItems.find(b => b.textContent === '远端研发')
    expect(mirror?.disabled).toBe(false)
    mirror!.click()
    await vi.waitFor(() => expect(actions.find(a => a.type === 'remove-member')).toMatchObject({ team: '远端研发', ids: ['session-11111111-0000'], fleetPeer: PEER }))
    v.destroy()
  })

  it('a remote member card leaves the mirror by its handle', async () => {
    const { v, actions } = mount(base)
    openLeave(v, 'member-peerzone-d659a8f9').find(b => b.textContent === '远端研发')!.click()
    await vi.waitFor(() => expect(actions.find(a => a.type === 'remove-member')).toMatchObject({ team: '远端研发', ids: ['peerzone/d659a8f9'], fleetPeer: PEER }))
    v.destroy()
  })

  it('with a local team too, both memberships are listed once each and the local one stays local', async () => {
    const { v, actions } = mount({ ...base, teams: [{ name: '本地队', team: 'dsh/canvas/local', members: [{ id: 'session-11111111-0000' }] }] })
    const names = openLeave(v, 'session-11111111-0000').map(b => b.textContent).filter(t => t !== '‹ 返回')
    expect(names).toEqual(['本地队', '远端研发'])
    items(v).find(b => b.textContent === '本地队')!.click()
    await vi.waitFor(() => expect(actions.find(a => a.type === 'remove-member')).toMatchObject({ team: '本地队', ids: ['session-11111111-0000'] }))
    expect(actions.find(a => a.type === 'remove-member')).not.toHaveProperty('fleetPeer')
    v.destroy()
  })
})
