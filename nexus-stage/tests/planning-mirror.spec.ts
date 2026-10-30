// @vitest-environment jsdom
/**
 * PR#96 single owner + mirror: a remote frame says whose team it is
 * (「镜像 · <owner host>」, dashed border) and 「同步中…」 while a relayed
 * edit waits for the owner; a local frame carries no marker.
 */
import { describe, expect, it, vi } from 'vitest'
import { mirrorRoute } from '../src/planning-mirror.ts'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'

const ptr = (o: Partial<SeamPointer>): SeamPointer =>
  ({ button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o })
const PEER = 'https://10.0.0.5:8787'
const input: PlanningInput = {
  sessions: [{ id: 'a', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true }],
  teams: [{ name: '本地队', team: 'dsh/canvas/local', members: [{ id: 'a' }] }],
  peerCount: 1,
  peers: [{ url: PEER, score: 0.9 }],
  inFlight: [],
  remoteTeams: [{ team: 'peerzone/d659a8f9', name: '集富物流', via: PEER }],
  peerOrg: [{ url: PEER, org: [{ name: '远端研发', team: 'peerzone/canvas/远端研发', members: ['peerzone/d659a8f9'] }] }],
}
function mount(onCanvasAction: (a: unknown) => Promise<boolean>) {
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction, now: () => 72_400 })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: { a: { x: 0, y: 0 } }, frames: { 本地队: { x: -200, y: -200, w: 500, h: 400 } } })
  v.reconcile(input)
  const frame = (n: string) => v.root.querySelector<HTMLElement>(`.p-frame[data-name="${n}"]`)!
  const route = (n: string) => frame(n).querySelector<HTMLElement>('.route')!
  return { v, frame, route }
}

describe('owner vs mirror frames (PR#96)', () => {
  it('mirrorRoute: undefined for a local frame; owner host for a remote one', () => {
    expect(mirrorRoute(undefined, false)).toBeUndefined()
    expect(mirrorRoute(PEER, false)).toMatchObject({ text: '镜像 · 10.0.0.5:8787', syncing: false })
    expect(mirrorRoute(PEER, true)).toMatchObject({ text: '同步中… · 10.0.0.5:8787', syncing: true })
    expect(mirrorRoute(PEER, false)!.title).toContain('经中继交给 10.0.0.5:8787')
  })

  it('a remote frame is marked as a mirror of its owner; a local frame is not', () => {
    const { frame, route } = mount(async () => true)
    expect(frame('远端研发').classList.contains('is-mirror')).toBe(true)
    expect(route('远端研发').textContent).toBe('镜像 · 10.0.0.5:8787')
    expect(frame('远端研发').querySelector('.p-frame-head')!.getAttribute('aria-label')).toContain('镜像 · 10.0.0.5:8787')
    expect(frame('本地队').classList.contains('is-mirror')).toBe(false)
    expect(route('本地队').textContent).toBe('dsh/canvas/local')
    expect(route('本地队').title).toBe('')
  })

  it('a relayed drop shows 同步中… until the owner answers, then 镜像 again', async () => {
    const waiting: Array<(ok: boolean) => void> = [] // a move may emit more than one action
    const { v, frame, route } = mount(() => new Promise<boolean>(r => { waiting.push(r) }))
    const card = v.root.querySelector<HTMLElement>('.p-node[data-id="a"]')!
    v.seam.pointerDown(ptr({ target: card, clientX: 400, clientY: 0 }))
    v.seam.pointerMove(ptr({ target: card, clientX: 325, clientY: 1005 }))
    v.seam.pointerUp(ptr({ target: frame('远端研发'), clientX: 325, clientY: 1005 }))
    await vi.waitFor(() => expect(route('远端研发').textContent).toBe('同步中… · 10.0.0.5:8787'))
    expect(frame('远端研发').classList.contains('is-syncing')).toBe(true)
    expect(frame('本地队').classList.contains('is-syncing')).toBe(false)
    for (const r of waiting) r(true)
    await vi.waitFor(() => expect(route('远端研发').textContent).toBe('镜像 · 10.0.0.5:8787'))
    expect(frame('远端研发').classList.contains('is-syncing')).toBe(false)
  }, 15_000)

  it('a re-render leaves an unchanged frame-head label alone (no screen-reader re-announce)', () => {
    const { v, frame } = mount(async () => true)
    const head = frame('远端研发').querySelector<HTMLElement>('.p-frame-head')!
    const writes = vi.spyOn(head, 'setAttribute')
    const local = frame('本地队').querySelector<HTMLElement>('.p-frame-head')!
    v.seam.pointerDown(ptr({ target: local, clientX: 0, clientY: 0 }))
    v.seam.pointerMove(ptr({ target: local, clientX: -40, clientY: 0 })) // a frame drag re-renders every frame
    v.seam.pointerUp(ptr({ target: local, clientX: -40, clientY: 0 }))
    expect(writes.mock.calls.filter(c => c[0] === 'aria-label')).toEqual([])
  })
})
