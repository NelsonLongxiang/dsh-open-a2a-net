/**
 * Owner 2026-11-03: each live local node card shows whether its session is working or idle, and
 * how many receipt-owing tasks wait on it. A cold node, a remote peer, or an older host (no status
 * on the row) shows nothing — never a guessed state.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPlanningView, workLabel, type PlanningInput } from '../src/planning-view.ts'

function board(sessions: PlanningInput['sessions']) {
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: async () => true })
  document.body.appendChild(v.root)
  v.reconcile({ sessions, teams: [], peerCount: 0 })
  const card = (id: string): HTMLElement => v.root.querySelector<HTMLElement>(`.p-node[data-id="${id}"]`)!
  return { v, card }
}
const row = (id: string, extra: Record<string, unknown>) => ({ id, label: id.toUpperCase(), team: `t/${id}`, joined: true, live: true, teams: ['t/ops'], ...extra })

describe('node work status chip', () => {
  it('workLabel: working / idle, the queue when non-zero, nothing without a reported status', () => {
    expect(workLabel({ status: 'running', queued: 2 })).toBe('工作中 · 排队 2')
    expect(workLabel({ status: 'running', queued: 0 })).toBe('工作中')
    expect(workLabel({ status: 'idle' })).toBe('空闲')
    expect(workLabel({ queued: 3 })).toBe('')
    expect(workLabel(undefined)).toBe('')
  })

  it('a working card says so and pulses; an idle card says 空闲; an older host row shows no chip', () => {
    const { card } = board([row('a', { status: 'running', queued: 21 }), row('b', { status: 'idle', queued: 0 }), row('c', {})])
    expect(card('a').querySelector('.work')?.textContent).toBe('工作中 · 排队 21')
    expect(card('a').classList.contains('is-working')).toBe(true)
    expect(card('b').querySelector('.work')?.textContent).toBe('空闲')
    expect(card('b').classList.contains('is-working')).toBe(false)
    expect(card('c').querySelector('.work')?.textContent).toBe('')
  })

  it('updates on the next poll and never shows a status on a cold node', () => {
    const { v, card } = board([row('a', { status: 'running', queued: 1 })])
    v.reconcile({ sessions: [row('a', { status: 'idle', queued: 0 })], teams: [], peerCount: 0 })
    expect(card('a').querySelector('.work')?.textContent).toBe('空闲')
    v.reconcile({ sessions: [row('a', { live: false, status: 'running', queued: 4 })], teams: [], peerCount: 0 })
    expect(card('a').querySelector('.work')?.textContent).toBe('')
    expect(card('a').classList.contains('is-working')).toBe(false)
  })
})
