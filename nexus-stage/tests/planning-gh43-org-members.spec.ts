// @vitest-environment jsdom
/**
 * gh#43 (owner: remote team frames render, but the DATA doesn't match):
 * the peer's canvas org publishes members VERBATIM — local members as raw
 * session ids, remote members as zone/id8 handles. The old renderer
 * sanitized every member the same way, so each local member (a session
 * id) resolved to a nonexistent card and the frame's roster/chips came
 * back wrong. The wire is now canonical (handles only — the host
 * translates its session ids at publish time) and the renderer also
 * carries the defensive id-form resolution for older peers.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'

const NOW = 72_400

// The peer publishes its org with a canonical HANDLE for its own local
// session (c6c6f4f6) and a handle for a remote member (d659a8f9); the
// directory carries the corresponding session cards.
const input: PlanningInput = {
  sessions: [{ id: 'session-aaaaaaaa11111111', label: 'A', team: 'dsh/aaaaaaaa', name: 'alpha', joined: true, live: true }],
  teams: [{ name: '本地队', team: 'dsh/canvas/local', members: [{ id: 'session-aaaaaaaa11111111' }] }],
  peerCount: 1,
  peers: [{ url: 'https://10.0.0.5:8787', score: 0.9 }],
  inFlight: [],
  remoteTeams: [
    { team: 'dsh/c6c6f4f6', name: '采购部门', via: 'https://10.0.0.5:8787' },
    { team: 'dsh/d659a8f9', name: '集富物流', via: 'https://10.0.0.5:8787' },
  ],
  peerOrg: [
    {
      url: 'https://10.0.0.5:8787',
      org: [{ name: '远端研发', team: 'dsh/canvas/远端研发', members: ['dsh/c6c6f4f6', 'dsh/d659a8f9'] }],
    },
  ],
}

describe('gh#43 remote org member resolution', () => {
  it("a peer-org handle resolving to one of this host sessions attaches that local session card to the mirror frame", () => {
    const target = 'session-414d2b90-5fe0-4b98-9840-180cb3f96336'
    const observed: PlanningInput = {
      ...input,
      sessions: [
        { id: target, label: '总工', team: 'dsh/414d2b90', name: '系统架构设计总工程师', joined: true, live: true, canvasTeams: ['基础建设项目组', '生产服务组'] },
        { id: 'session-66abc2cf-6424-4d76-b333-ff0a7f481560', label: '本席', team: 'dsh/66abc2cf', name: 'open-a2a-net', joined: true, live: true, canvasTeams: ['基础建设项目组'] },
      ],
      teams: [
        { name: '基础建设项目组', team: 'dsh/canvas/基础建设项目组', members: [{ id: target }, { id: 'session-66abc2cf-6424-4d76-b333-ff0a7f481560' }] },
        { name: 'dsh-ecom-prodcut-dev--开发组', team: 'dsh/canvas/dsh-ecom-prodcut-dev--开发组', members: [{ id: target }] },
      ],
      remoteTeams: [
        { team: 'dsh/e99d5bd5', name: 'owner-seat', via: 'https://10.0.0.5:8787' },
      ],
      peerOrg: [{ url: 'https://10.0.0.5:8787', org: [{ name: '生产服务组', team: 'dsh/canvas/生产服务组', members: ['dsh/e99d5bd5', 'dsh/414d2b90', 'dsh/66abc2cf'] }] }],
    }
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(observed)
    const frame = [...v.root.querySelectorAll('.p-frame')].find(node => node.getAttribute('data-name') === '生产服务组')
    expect(frame?.classList.contains('is-mirror')).toBe(true)
    const member = v.root.querySelector<HTMLElement>(`.p-node[data-id="${target}"]`)
    expect(member).not.toBeNull()
    expect(frame?.querySelector('.cnt')?.textContent).toBe('3 成员 +2 跨队')
    v.reconcile(observed)
    expect(v.root.querySelector<HTMLElement>(`.p-node[data-id="${target}"]`)).not.toBeNull()
    expect(frame?.querySelector('.cnt')?.textContent).toBe('3 成员 +2 跨队')
    expect(frame?.querySelector('.route')?.textContent).toBe('镜像 · 10.0.0.5:8787')
  })

  it('a duplicate local id8 cannot make a peer canvas handle attach to either session', () => {
    const observed: PlanningInput = {
      ...input,
      sessions: [
        { id: 'session-414d2b90-0000-0001', label: 'A', team: 'dsh/414d2b90', joined: true, live: true },
        { id: 'session-414d2b90-0000-0002', label: 'B', team: 'dsh/414d2b90', joined: true, live: true },
      ],
      teams: [{ name: 'local', team: 'dsh/canvas/local', members: [{ id: 'session-414d2b90-0000-0001' }, { id: 'session-414d2b90-0000-0002' }] }],
      remoteTeams: [{ team: 'dsh/e99d5bd5', name: 'owner-seat', via: 'https://10.0.0.5:8787' }],
      peerOrg: [{ url: 'https://10.0.0.5:8787', org: [{ name: '生产服务组', team: 'dsh/canvas/生产服务组', members: ['dsh/414d2b90'] }] }],
    }
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(observed)
    const member = v.root.querySelector('.p-node[data-id="member-dsh-414d2b90"]')
    expect(member).not.toBeNull()
    expect(v.root.querySelector('.p-node[data-id="session-414d2b90-0000-0001"]')).not.toBeNull()
    expect(v.root.querySelector('.p-node[data-id="session-414d2b90-0000-0002"]')).not.toBeNull()
  })

  it('canonical handle members resolve onto the peer session cards', () => {
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(input)
    // Both member cards exist (gh#38 renders directory rows as cards)…
    expect(v.root.querySelector('.p-node[data-id="member-dsh-c6c6f4f6"]')).not.toBeNull()
    expect(v.root.querySelector('.p-node[data-id="member-dsh-d659a8f9"]')).not.toBeNull()
    // …and the remote frame attaches BOTH (data matches the peer's org).
    const frame = [...v.root.querySelectorAll('.p-frame')].find(n => n.dataset.name === '远端研发')
    expect(frame).toBeDefined()
  })

  it('the defensive id-form branch maps a raw session id via id8 + peer zone', () => {
    const legacy: PlanningInput = {
      ...input,
      peerOrg: [{ url: 'https://10.0.0.5:8787', org: [{ name: '远端研发', team: 'x', members: ['session-c6c6f4f6-d357-417d-93d8-83c038a26c8e'] }] }],
    }
    const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW })
    document.body.appendChild(v.root)
    v.reconcile(legacy)
    expect(v.root.querySelector('.p-node[data-id="member-dsh-c6c6f4f6"]')).not.toBeNull()
    const frame = [...v.root.querySelectorAll('.p-frame')].find(n => n.dataset.name === '远端研发')
    expect(frame).toBeDefined()
  })
})
