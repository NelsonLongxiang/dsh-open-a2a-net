// @vitest-environment jsdom
/**
 * gh#44 REAL pins (review FAIL: the promised stickiness pin was silently
 * absent — the splice script's anchor never matched and the claim rode on
 * zero tests, the gh#24 lesson again):
 *   ① a dragged remote frame KEEPS its rect across a reconcile (the poll
 *      must not snap it back to the stale saved/derived rect);
 *   ② 保位≠名册冻结: the peerOrg diff still ADDS newly published teams
 *      and REMOVES vanished ones.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput, type SeamPointer } from '../src/planning-view.ts'

function ptr(o: Partial<SeamPointer>): SeamPointer {
  return { button: 0, shiftKey: false, ctrlKey: false, clientX: 0, clientY: 0, pointerId: 1, target: null, preventDefault: () => {}, ...o }
}

const NOW = 72_400
const org = (names: readonly string[]): PlanningInput['peerOrg'] => [
  { url: 'https://10.0.0.5:8787', org: names.map(name => ({ name, team: `peerzone/canvas/${name}`, members: [] })) },
]
const base: PlanningInput = {
  sessions: [{ id: 'a', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true }],
  teams: [],
  peerCount: 1,
  peers: [{ url: 'https://10.0.0.5:8787', score: 0.9 }],
  inFlight: [],
  remoteTeams: [],
  peerOrg: org(['远端研发']),
}

function frameStyle(v: { root: HTMLElement }, name: string): { left: string; top: string; width: string; height: string } {
  const el = v.root.querySelector<HTMLElement>(`.p-frame[data-name="${name}"]`)!
  return { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }
}

describe('gh#44 remote frame stickiness + roster churn', () => {
  it('① a dragged remote frame keeps its rect across the next reconcile', () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(base)
    const head = v.root.querySelector<HTMLElement>('.p-frame[data-name="远端研发"] .p-frame-head')!
    expect(head).not.toBeNull()
    // Drag the frame: down at its head, move +150/+80, up.
    v.seam.pointerDown(ptr({ target: head, clientX: 300, clientY: 960 }))
    v.seam.pointerMove(ptr({ target: head, clientX: 450, clientY: 1040 }))
    v.seam.pointerUp(ptr({ target: head, clientX: 450, clientY: 1040 }))
    const dragged = frameStyle(v, '远端研发')
    // The next poll (same payload — derived rect would sit at 200,940):
    v.reconcile(base)
    const after = frameStyle(v, '远端研发')
    expect(after.left).toBe(dragged.left)
    expect(after.top).toBe(dragged.top)
    expect(after.width).toBe(dragged.width)
    expect(after.height).toBe(dragged.height)
  })

  it('② 保位≠名册冻结: new teams appear and vanished teams leave across reconciles', () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(base)
    expect(v.root.querySelector('.p-frame[data-name="远端研发"]')).not.toBeNull()
    // The peer publishes one MORE team and drops none yet.
    v.reconcile({ ...base, peerOrg: org(['远端研发', '新部门']) })
    expect(v.root.querySelector('.p-frame[data-name="新部门"]')).not.toBeNull()
    // The peer drops 远端研发: the frame leaves the board.
    v.reconcile({ ...base, peerOrg: org(['新部门']) })
    expect(v.root.querySelector('.p-frame[data-name="远端研发"]')).toBeNull()
    expect(v.root.querySelector('.p-frame[data-name="新部门"]')).not.toBeNull()
  })
})
