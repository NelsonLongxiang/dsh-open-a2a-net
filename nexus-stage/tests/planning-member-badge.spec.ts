/**
 * A remote MEMBER card is one session on another host, not the host. Its chip used to fall through to
 * the host-card fallback 'peer' (owner report 2026-11-04: 「远端成员显示的也是 peers」). It now reads 成员,
 * ticked and colored by the link of the host that publishes its handle.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView } from '../src/planning-view.ts'

const VIA = 'http://10.0.0.5:13080'
function board(link: 'linked' | 'stranger' | undefined, verified?: boolean) {
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async () => true })
  document.body.appendChild(v.root)
  v.reconcile({
    sessions: [{ id: 'a', label: 'A', team: 't/a', joined: true, live: true, teams: ['t/ops'] }],
    teams: [],
    peerCount: 1,
    peers: [{ url: VIA, ...(link !== undefined ? { link } : {}), ...(verified !== undefined ? { verified } : {}) }],
    remoteTeams: [{ team: 'dsh/aaaa1111', name: '采购员', via: VIA }],
  })
  const chip = (prefix: string): HTMLElement => v.root.querySelector<HTMLElement>(`.p-node[data-id^="${prefix}"] .prio`)!
  return { host: chip('peer-'), member: chip('member-') }
}

describe('remote member card chip', () => {
  it('reads 成员 with the host link tick and color; the host card keeps its link badge', () => {
    const { host, member } = board('linked', true)
    expect(host.textContent).toBe('linked✓')
    expect(member.textContent).toBe('成员✓')
    expect(member.classList.contains('lnk-linked')).toBe(true)
  })
  it('a stranger host colors its member gray and crosses it', () => {
    const { member } = board('stranger', false)
    expect(member.textContent).toBe('成员✗')
    expect(member.classList.contains('lnk-stranger')).toBe(true)
  })
  it('an older host with no link field: the member still reads 成员, never peer', () => {
    const { host, member } = board(undefined)
    expect(host.textContent?.startsWith('peer')).toBe(true) // the host card's own fallback is unchanged
    expect(member.textContent?.startsWith('成员')).toBe(true)
    expect(member.textContent).not.toContain('peer')
  })
})
