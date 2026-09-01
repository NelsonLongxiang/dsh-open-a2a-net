// @vitest-environment jsdom
/**
 * Node list drawer + teamed-only canvas (network-membership-display ruling):
 * the canvas holds teamed nodes only; teamless joined, unjoined, and each
 * peer's published nodes are managed from the 节点 panel with its host
 * selector. Covers the three local groups, the remote read-only view, and
 * the join/leave/入队 gestures emitted through the canvas action channel.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'
import type { CanvasAction } from '../src/canvas-ops.ts'

const sessions = [
  // Teamed by roster declaration only — no canvas frame holds it.
  { id: 't1', label: 'T1', team: 'dsh/t1111111', name: 'teamed-one', joined: true, live: true, teams: ['dsh/ops'] },
  // Joined but teamless: no canvas card, the 未组队 group carries it.
  { id: 'u1', label: 'U1', team: 'dsh/u1111111', name: 'unteamed-one', joined: true, live: true },
  // Never joined: the 未入网 group with its 入网 gesture.
  { id: 'n1', label: 'N1', team: 'dsh/n1111111', name: 'never-joined', joined: false, live: true },
]
const input: PlanningInput = {
  sessions,
  teams: [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 't1' }] }],
  peerCount: 1,
  peers: [{ url: 'http://192.168.3.156:13080', score: 0.9 }],
  remoteTeams: [
    { team: 'peer/bb22cc33', name: 'remote-teamed', via: 'http://192.168.3.156:13080', origin: 'sess-156 (192.168.3.156)', teams: ['dsh/ops'] },
    { team: 'peer/dd44ee55', name: 'remote-teameless', via: 'http://192.168.3.156:13080', origin: 'sess-156 (192.168.3.156)' },
  ],
}

function view(holdWire = false) {
  const actions: CanvasAction[] = []
  let release: ((ok: boolean) => void) | undefined
  const v = createPlanningView({
    onDirty: vi.fn(),
    onLampClick: vi.fn(),
    onCanvasAction: (a) => {
      actions.push(a)
      if (!holdWire) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => { release = resolve })
    },
    viewSize: () => ({ w: 1000, h: 800 }),
  })
  document.body.appendChild(v.root)
  return { v, actions }
}

function openPanel(v: ReturnType<typeof view>['v']): HTMLElement {
  const btn = Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button'))
    .find(b => b.textContent === '节点')!
  btn.click()
  const panel = v.root.querySelector<HTMLElement>('.p-nodelist')
  expect(panel).not.toBeNull()
  return panel!
}

describe('teamed-only canvas + node list drawer', () => {
  it('unteamed joined sessions earn no canvas card; roster-teamed ones do', () => {
    const { v } = view()
    v.reconcile(input)
    expect(v.root.querySelector('.p-node[data-id="t1"]')).not.toBeNull()
    expect(v.root.querySelector('.p-node[data-id="u1"]')).toBeNull()
    expect(v.root.querySelector('.p-node[data-id="n1"]')).toBeNull()
  })

  it('the panel groups local sessions: 未组队 carries the 无网络能力 tag, 未入网 offers 入网, 已组队 offers 定位', () => {
    const { v, actions } = view()
    v.reconcile(input)
    const panel = openPanel(v)
    const text = panel.textContent ?? ''
    expect(text).toContain('未组队 (1)')
    expect(text).toContain('无网络能力')
    expect(text).toContain('unteamed-one')
    expect(text).toContain('未入网 (1)')
    expect(text).toContain('never-joined')
    expect(text).toContain('已组队 (1)')
    expect(text).toContain('teamed-one')
    // 入网 gesture emits the network join action for the unjoined session.
    const joinBtn = Array.from(panel.querySelectorAll<HTMLButtonElement>('.p-listbtn'))
      .find(b => b.textContent === '入网')!
    joinBtn.click()
    expect(actions).toEqual([{ type: 'join-network', id: 'n1' }])
  })

  it('退网 on a teamless joined session emits leave-network', () => {
    const { v, actions } = view()
    v.reconcile(input)
    const panel = openPanel(v)
    const leaveBtn = Array.from(panel.querySelectorAll<HTMLButtonElement>('.p-listbtn'))
      .find(b => b.textContent === '退网')!
    leaveBtn.click()
    expect(actions).toEqual([{ type: 'leave-network', id: 'u1' }])
  })

  it('入队▸ drills into existing canvas teams plus 新团队…', () => {
    const { v, actions } = view()
    v.reconcile(input)
    const panel = openPanel(v)
    const joinBtn = Array.from(panel.querySelectorAll<HTMLButtonElement>('.p-listbtn'))
      .find(b => b.textContent === '入队▸')!
    joinBtn.click()
    const menu = v.root.querySelector<HTMLElement>('.p-menu[role=menu]')!
    expect(menu.textContent).toContain('alpha')
    expect(menu.textContent).toContain('新团队…')
    const alphaItem = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
      .find(b => b.textContent === 'alpha')!
    alphaItem.click()
    expect(actions).toEqual([{ type: 'add-member', team: 'alpha', ids: ['u1'] }])
  })

  it('the host selector switches to a peer view: remote rows read-only with the same teamed split', () => {
    const { v } = view()
    v.reconcile(input)
    const panel = openPanel(v)
    const sel = panel.querySelector<HTMLSelectElement>('.p-nodesel')!
    const values = Array.from(sel.options).map(o => o.value)
    expect(values).toContain('192.168.3.156:13080')
    sel.value = '192.168.3.156:13080'
    sel.dispatchEvent(new Event('change'))
    const text = panel.textContent ?? ''
    expect(text).toContain('remote-teamed')
    expect(text).toContain('remote-teameless')
    expect(text).toContain('只读')
    // Remote rows carry no gesture buttons.
    expect(panel.querySelector('.p-listbtn')).toBeNull()
  })

  it('an open panel follows the poll: a fresh join moves the row between groups', () => {
    const { v } = view()
    v.reconcile(input)
    const panel = openPanel(v)
    expect(panel.textContent).toContain('未入网 (1)')
    // Next poll: n1 joined and teamed — the groups re-derive.
    v.reconcile({
      ...input,
      sessions: [
        sessions[0]!,
        sessions[1]!,
        { ...sessions[2]!, joined: true, teams: ['dsh/ops'] },
      ],
    })
    expect(panel.textContent).toContain('未入网 (0)')
    expect(panel.textContent).toContain('已组队 (2)')
  })

  it('an in-flight add-member keeps the joining node on the canvas across a racing poll (pendingTeams guard, review 201 hard item)', () => {
    // u1 starts joined-but-teamless: no canvas card under the teamed gate.
    const { v, actions } = view(true)
    v.reconcile(input)
    expect(v.root.querySelector('.p-node[data-id="u1"]')).toBeNull()
    // Hold the wire: the drawer's 入队 gesture applies optimistically and
    // pins the team's pending guard until we release. The optimistic seat
    // materializes u1 (write actions read and write memberships through
    // the node table) and earns its card in the same tick…
    const panel = openPanel(v)
    const joinBtn = Array.from(panel.querySelectorAll<HTMLButtonElement>('.p-listbtn'))
      .find(b => b.textContent === '入队▸')!
    joinBtn.click()
    const alphaItem = Array.from(v.root.querySelectorAll<HTMLElement>('.p-menu [role=menuitem]'))
      .find(b => b.textContent === 'alpha')!
    alphaItem.click()
    expect(actions).toEqual([{ type: 'add-member', team: 'alpha', ids: ['u1'] }])
    expect(v.root.querySelector('.p-node[data-id="u1"]')).not.toBeNull()
    // …and a poll lands BEFORE the wire settles: the stale payload has no
    // alpha membership for u1, but the pendingTeams guard keeps the
    // in-flight membership — the card must not pop off the canvas.
    v.reconcile(input)
    expect(v.root.querySelector('.p-node[data-id="u1"]')).not.toBeNull()
  })
})
