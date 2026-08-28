// @vitest-environment jsdom
/**
 * PR D federation overlay through the production seam: peer badge chips
 * in the deterministic column, accent activity edges per pending route
 * (labelled `a2a_route · peer · age`), the indigo federal referral fan
 * ("gns referral" on the first line only), the statusbar inFlight count
 * and its fly control (Enter fits the frames ∪ peers region), and the
 * XSS discipline — attacker-shaped peer urls land as text only.
 * Time is pinned through the injectable `now` dep.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'

const NOW = 72_400

const sessions = [
  { id: 'a', label: 'A', team: 'dsh/11111111', name: 'alpha', joined: true, live: true },
  { id: 'c', label: 'C', team: 'dsh/33333333', name: 'gamma', joined: true, live: true },
]
const teams = [{ name: '甲', team: 'dsh/canvas/jia', members: [{ id: 'a' }, { id: 'c' }] }]
const peers = [
  { url: 'https://10.0.0.5:8787', score: 0.9 },
  { url: 'http://192.168.3.9:13080', score: 0.4 },
]
const inFlight = [
  { team: '甲', peer: '10.0.0.5:8787', startedAt: 60_000 },
  { team: '甲', peer: '192.168.3.9:13080', startedAt: 71_000 },
]
const fedInput: PlanningInput = { sessions, teams, peerCount: peers.length, peers, inFlight }

// a(0,0), c(0,80) inside 甲(-200,-200,500,400): contentBounds is exactly
// the frame, so the badge column sits at x = 300+140 = 440, y from -200
// at a 90px pitch; the titlebar anchor is (50, -189).
const layout = {
  version: 1,
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: { a: { x: 0, y: 0 }, c: { x: 0, y: 80 } },
  frames: { 甲: { x: -200, y: -200, w: 500, h: 400 } },
}

function view(viewport: { x: number; y: number; scale: number } = { x: 0, y: 0, scale: 1 }) {
  const onDirty = vi.fn()
  const v = createPlanningView({
    onDirty,
    onLampClick: vi.fn(),
    onCanvasAction: () => Promise.resolve(true),
    now: () => NOW,
  })
  document.body.appendChild(v.root)
  v.adoptExternalLayout({ ...layout, viewport })
  return { v, onDirty }
}

describe('federation overlay DOM', () => {
  it('inFlight ages tick across reconciles as the injected clock advances', () => {
    let t = 72_400
    const onDirty = vi.fn()
    const v = createPlanningView({
      onDirty,
      onLampClick: vi.fn(),
      onCanvasAction: () => Promise.resolve(true),
      now: () => t,
    })
    document.body.appendChild(v.root)
    v.adoptExternalLayout({ ...layout, viewport: { x: 0, y: 0, scale: 1 } })
    v.reconcile(fedInput)
    const label = () => v.root.querySelector('.edge-label')!.textContent!
    expect(label()).toContain('12s')
    t = 77_400 // +5s, same reconcile input: the label must age on the next poll
    v.reconcile(fedInput)
    expect(label()).toContain('17s')
  })

  it('reconcile with peers+inFlight lays badge chips in the deterministic column', () => {
    const { v } = view()
    v.reconcile(fedInput)
    const chips = v.root.querySelectorAll<HTMLElement>('.peer')
    expect(chips).toHaveLength(2)
    const first = v.root.querySelector<HTMLElement>('.peer[data-url="https://10.0.0.5:8787"]')!
    expect(first).not.toBeNull()
    expect(first.textContent).toContain('https://10.0.0.5:8787')
    expect(first.textContent).toContain('score 0.9')
    expect(first.style.left).toBe('440px')
    expect(first.style.top).toBe('-200px')
    const second = v.root.querySelector<HTMLElement>('.peer[data-url="http://192.168.3.9:13080"]')!
    expect(second.style.left).toBe('440px')
    expect(second.style.top).toBe('-110px')
  })

  it('each pending route draws an accent edge labelled a2a_route · peer · age', () => {
    const { v } = view()
    v.reconcile(fedInput)
    const lines = v.root.querySelectorAll('svg .e-activity')
    expect(lines).toHaveLength(2)
    const labels = Array.from(v.root.querySelectorAll('svg .edge-label')).map(t => t.textContent)
    expect(labels.some(t => t!.includes('a2a_route'))).toBe(true)
    // elapsed = now(72_400) - startedAt(60_000), whole seconds.
    expect(labels.some(t => t === 'a2a_route · 10.0.0.5:8787 · 12s')).toBe(true)
  })

  it('the federal fan labels only the first line "gns referral"', () => {
    const { v } = view()
    v.reconcile(fedInput)
    const federal = v.root.querySelectorAll('svg .e-federal')
    expect(federal).toHaveLength(2)
    const referrals = Array.from(v.root.querySelectorAll('svg .edge-label'))
      .filter(t => t.textContent === 'gns referral')
    expect(referrals).toHaveLength(1)
  })

  it('no inFlight -> zero activity edges (federal fan stays)', () => {
    const { v } = view()
    v.reconcile({ ...fedInput, inFlight: [] })
    expect(v.root.querySelectorAll('svg .e-activity')).toHaveLength(0)
    expect(v.root.querySelectorAll('svg .e-federal')).toHaveLength(2)
  })

  it('routes whose team has no frame draw nothing (dangling rows are transients)', () => {
    const { v } = view()
    v.reconcile({ ...fedInput, inFlight: [{ team: '不存在', peer: '10.0.0.5:8787', startedAt: 60_000 }] })
    expect(v.root.querySelectorAll('svg .e-activity')).toHaveLength(0)
  })

  it('degenerate bounds (empty canvas) skip badges and federation edges', () => {
    const { v } = view()
    v.reconcile(fedInput)
    expect(v.root.querySelectorAll('.peer')).toHaveLength(2)
    v.reconcile({ sessions: [], teams: [], peerCount: peers.length, peers, inFlight: [] })
    expect(v.root.querySelectorAll('.peer')).toHaveLength(0)
    expect(v.root.querySelectorAll('svg .e-activity')).toHaveLength(0)
    expect(v.root.querySelectorAll('svg .e-federal')).toHaveLength(0)
  })

  it('the statusbar counts inFlight between cold and the 队/peer counts', () => {
    const { v } = view()
    v.reconcile(fedInput)
    const status = v.root.querySelector<HTMLElement>('.p-status')!
    expect(status.textContent).toContain('2 inFlight')
    expect(status.textContent).toContain('1 队 · 2 peer')
    expect(status.getAttribute('title')).toBe('定位在途与联邦（回车）')
    expect(status.tabIndex).toBe(0)
  })

  it('statusbar Enter flies (viewport transform changes) and marks dirty', () => {
    const { v, onDirty } = view({ x: 120, y: 60, scale: 1.5 })
    v.reconcile(fedInput)
    const world = v.root.querySelector<HTMLElement>('.p-world')!
    const before = world.style.transform
    expect(before).toBe('translate(-180px, -90px) scale(1.5)')
    const status = v.root.querySelector<HTMLElement>('.p-status')!
    status.focus()
    status.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(world.style.transform).not.toBe(before)
    expect(onDirty).toHaveBeenCalled()
  })

  it('attacker-shaped peer urls stay textContent, never markup', () => {
    const { v } = view()
    const evil = '<img src=x onerror=alert(1)>'
    v.reconcile({
      sessions, teams, peerCount: 1,
      peers: [{ url: evil, score: 0.5 }],
      inFlight: [{ team: '甲', peer: evil, startedAt: 60_000 }],
    })
    const chip = v.root.querySelector<HTMLElement>('.peer')!
    expect(chip.dataset.url).toBe(evil)
    expect(chip.textContent).toContain(evil)
    expect(v.root.querySelector('img')).toBeNull()
  })

  it('the legend gains the 活动边 and 联邦线 rows', () => {
    const { v } = view()
    const legend = v.root.querySelector<HTMLElement>('.p-legend')!
    expect(legend.textContent).toContain('活动边（inFlight 路由，瞬时）')
    expect(legend.textContent).toContain('联邦线（→peer）')
    const bars = legend.querySelectorAll('i')
    expect(bars.length).toBeGreaterThanOrEqual(4)
  })
})
