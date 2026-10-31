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

  // Single owner + mirror: dissolving a mirror frame is the OWNER's write.
  // It used to go to the LOCAL canvas control, which has no such team, and
  // the wire read its {ok:false, teams:[…without it]} as "already gone" —
  // the frame vanished, the owner never heard, and the next poll put it back.
  function dissolve(v: ReturnType<typeof createPlanningView>, name: string): void {
    const head = v.root.querySelector<HTMLElement>(`.p-frame-head[data-frame="${name}"]`)!
    v.seam.contextMenu(ptr({ target: head, clientX: 10, clientY: 10 }))
    Array.from(v.root.querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find(b => b.textContent!.includes('解散团队'))!.click()
  }

  it('解散 on a REMOTE frame carries fleetPeer; on a local frame it does not', async () => {
    const actions: unknown[] = []
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async a => { actions.push(a); return true }, now: () => NOW })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    dissolve(v, '远端研发')
    dissolve(v, '本地队')
    await vi.waitFor(() => expect(actions).toEqual([
      { type: 'remove-team', name: '远端研发', fleetPeer: 'https://10.0.0.5:8787' },
      { type: 'remove-team', name: '本地队' },
    ]))
  })

  it('an owner refusal puts the mirror frame back', async () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async () => false, now: () => NOW })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    dissolve(v, '远端研发')
    expect(v.root.querySelector('.p-frame[data-name="远端研发"]')).toBeNull() // optimistic
    await vi.waitFor(() => expect(v.root.querySelector('.p-frame[data-name="远端研发"]')).not.toBeNull())
  })

  it('a stale poll never draws a dissolved mirror frame back; the name is free again once the owner drops it', async () => {
    let answer!: (ok: boolean) => void
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: () => new Promise<boolean>(r => { answer = r }), now: () => NOW })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
    v.reconcile(input)
    const shown = (): boolean => v.root.querySelector('.p-frame[data-name="远端研发"]') !== null
    dissolve(v, '远端研发')
    v.reconcile(input) // a poll while the relay is in flight: the owner still lists it
    expect(shown()).toBe(false)
    answer(true)
    await vi.waitFor(() => expect(v.root.querySelector('.p-frame.is-syncing')).toBeNull())
    v.reconcile(input) // the owner's card not re-read yet: still listed
    expect(shown()).toBe(false)
    v.reconcile({ ...input, peerOrg: [{ url: 'https://10.0.0.5:8787', org: [] }] }) // the owner dropped it
    v.reconcile(input) // a NEW team of that name on the owner later: drawn again
    expect(shown()).toBe(true)
  })
})
