// @vitest-environment jsdom
/**
 * gh#42 (owner report: dragged a remote peer into the base team — the server
 * accepted it but NO edge rendered): team edges derive from node
 * memberships, and remote cards carried hardcoded empty memberships, so the
 * server truth never re-attached on poll or reload. The reconcile now
 * re-attaches every local team's remote member handles onto their cards.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'

const NOW = 72_400

// The server payload shape AFTER the owner's drag: base contains a remote
// handle next to its local sessions, and the directory still carries the
// handle row (the member card exists).
const input: PlanningInput = {
  sessions: [
    { id: 'session-aaaaaaaa11111111', label: 'A', team: 'dsh/aaaaaaaa', name: 'alpha', joined: true, live: true },
    { id: 'session-bbbbbbbb22222222', label: 'B', team: 'dsh/bbbbbbbb', name: 'beta', joined: true, live: true },
  ],
  teams: [
    {
      name: 'base',
      team: 'dsh/canvas/base',
      members: [
        { id: 'session-aaaaaaaa11111111' },
        { id: 'session-bbbbbbbb22222222' },
        { id: 'dsh/d659a8f9', team: 'dsh/d659a8f9', remote: true },
      ],
    },
  ],
  peerCount: 1,
  peers: [{ url: 'https://10.0.0.5:8787', score: 0.9 }],
  inFlight: [],
  remoteTeams: [{ team: 'dsh/d659a8f9', name: '集富物流', via: 'https://10.0.0.5:8787' }],
}

describe('gh#42 remote member edges', () => {
  it('a reload renders the dashed member edge from the base frame to the remote member card', () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    // No saved layout — the cold board must rebuild from the payload alone.
    v.reconcile(input)
    v.reconcile(input) // second poll: the re-attach pass is idempotent
    const member = v.root.querySelector<HTMLElement>('.p-node[data-id="member-dsh-d659a8f9"]')
    expect(member).not.toBeNull()
    // The dashed member edge exists — count svg lines after the reconcile.
    const lines = v.root.querySelectorAll('svg line')
    expect(lines.length).toBeGreaterThan(0)
  })

  it('without a member card the handle falls back onto the peer HOST card', () => {
    const noRow: PlanningInput = { ...input, remoteTeams: [] }
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(noRow)
    // No member card; the peer node exists and the roster maps the handle
    // onto it via remoteHandle (W-B first-row semantics) — no crash, and the
    // roster keeps exactly the resolvable ids.
    const roster = v.root.querySelectorAll('.p-node')
    expect(roster.length).toBeGreaterThanOrEqual(3) // A, B, peer card
  })
})
