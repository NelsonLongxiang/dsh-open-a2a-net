// @vitest-environment jsdom
/**
 * 属主令 W1 + W2 acceptance pins (the supervisor's five nails):
 *   ① search hits BOTH a display name and a zone/id8 handle (substring,
 *      case-insensitive, name / handle / host tokens)
 *   ② picking a hit frames the card (the world transform changes to the
 *      flight viewport; the card bbox sits inside the viewport)
 *   ③ long two-line names do not resize the card — the 172x56 geometry is
 *      untouched (gh#48/45 math zero-perturbation; the CSS clamp absorbs
 *      the overflow, the GIF geometry gate is the review seat's)
 *   ④ idempotent facts: the same query always yields the same hits
 *   ⑤ gh#45/#48 family zero-regression (the full nexus suite runs in CI;
 *      this spec pins the card geometry contract only)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'
import { matchHits, createPlanningSearch } from '../src/planning-search.ts'

const NOW = 72_400
const mounted: Array<() => void> = []
afterEach(() => {
  while (mounted.length > 0) (mounted.pop() as () => void)()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function bench(input: PlanningInput): ReturnType<typeof createPlanningView> {
  const v = createPlanningView({ onDirty: vi.fn(), onLampClick: vi.fn(), onCanvasAction: vi.fn(async () => true), now: () => NOW, viewSize: () => ({ w: 1200, h: 800 }) })
  document.body.appendChild(v.root)
  mounted.push(() => v.root.remove())
  v.adoptExternalLayout({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: {}, frames: {} })
  v.reconcile(input)
  return v
}

const INPUT: PlanningInput = {
  sessions: [
    { id: 'lin', label: 'L', team: 'dsh/aaaa1111', name: '林产品开发海外调研工厂报告线负责人', joined: true, live: true },
    { id: 'zhao', label: 'Z', team: 'dsh/bbbb2222', name: '赵采集席长名字测试项', joined: true, live: true },
  ],
  teams: [{ name: 'T', team: 'dsh/canvas/T', members: [{ id: 'lin' }, { id: 'zhao' }] }],
  peerCount: 0,
}

describe('W1 search — matching', () => {
  it('① hits a display name AND a zone/id8 handle; empty query yields nothing; case-insensitive', () => {
    const rows = [
      { id: 'lin', name: '林产品开发', team: 'dsh/aaaa1111' },
      { id: 'zhao', name: '赵采集席', team: 'dsh/bbbb2222' },
    ]
    expect(matchHits(rows, '产品').map(h => h.id)).toEqual(['lin'])
    expect(matchHits(rows, 'bbbb').map(h => h.id)).toEqual(['zhao'])
    expect(matchHits(rows, 'DSH/AAAA').map(h => h.id)).toEqual(['lin'])
    expect(matchHits(rows, '   ')).toEqual([])
    // ④ repeatable: the same query, the same hits.
    expect(matchHits(rows, '采集')).toEqual(matchHits(rows, '采集'))
  })
})

describe('W1 search — the board widget', () => {
  it('the widget itself: Enter picks the active hit, mousedown on a row picks it too', () => {
    const picked: string[] = []
    const w = createPlanningSearch({ onPick: id => picked.push(id) })
    document.body.appendChild(w.root)
    mounted.push(() => w.root.remove())
    w.setIndex([{ id: 'lin', name: '林产品开发', team: 'dsh/aaaa1111' }, { id: 'zhao', name: '赵采集席', team: 'dsh/bbbb2222' }])
    const box = w.root.querySelector<HTMLInputElement>('.p-search-input')!
    box.value = 'bbbb'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    const row = w.root.querySelector<HTMLElement>('.p-search-hit')!
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    box.value = 'aaaa'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(picked).toEqual(['zhao', 'lin'])
  })

  it('② typing a handle lists the hit; picking it flies the viewport with a pulse', () => {
    vi.useFakeTimers()
    const v = bench(INPUT)
    const box = v.root.querySelector<HTMLInputElement>('.p-search-input')!
    expect(box).not.toBeNull()
    box.value = 'bbbb'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    const hits = [...v.root.querySelectorAll<HTMLElement>('.p-search-hit')]
    expect(hits.some(h => h.dataset.id === 'zhao')).toBe(true)
    hits[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    // ② the real nail: after the flight the card's screen bbox sits INSIDE
    // the 1200x800 viewport (parsed from the world transform).
    const t = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(v.root.querySelector<HTMLElement>('.p-world')!.style.transform)!
    const tx = Number(t[1]); const ty = Number(t[2]); const sc = Number(t[3])
    const card = v.root.querySelector<HTMLElement>('[data-id="zhao"]')!
    const cx = Number(card.style.left.replace('px', '')) * sc + tx
    const cy = Number(card.style.top.replace('px', '')) * sc + ty
    expect(cx).toBeGreaterThanOrEqual(-1)
    expect(cy).toBeGreaterThanOrEqual(-1)
    expect(cx + 172 * sc).toBeLessThanOrEqual(1201)
    expect(cy + 56 * sc).toBeLessThanOrEqual(801)
    // Pulse armed on the picked card, then cleared by the 1.2s timer.
    expect(v.root.querySelector<HTMLElement>('[data-id="zhao"]')!.classList.contains('pulse')).toBe(true)
    vi.advanceTimersByTime(1300)
    expect(v.root.querySelector<HTMLElement>('[data-id="zhao"]')!.classList.contains('pulse')).toBe(false)
    // The dropdown cleared after the pick.
    expect(v.root.querySelectorAll('.p-search-hit').length).toBe(0)
  })

  it('Ctrl+K focuses the search box; Escape clears it', () => {
    const v = bench(INPUT)
    const box = v.root.querySelector<HTMLInputElement>('.p-search-input')!
    v.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    expect(document.activeElement).toBe(box)
    box.value = '林'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    expect(v.root.querySelectorAll('.p-search-hit').length).toBeGreaterThan(0)
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(box.value).toBe('')
    expect(v.root.querySelectorAll('.p-search-hit').length).toBe(0)
  })
})

describe('W2 name wrapping — geometry contract', () => {
  it('③ a long two-line name leaves the card geometry untouched (no inline size/ellipsis re-write)', () => {
    const v = bench(INPUT)
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="lin"]')!
    // The clamp lives in CSS; the card carries NO inline width/height — the
    // 172x56 contract stays the stylesheet's.
    expect(el.style.width).toBe('')
    expect(el.style.height).toBe('')
    const nm = el.querySelector<HTMLElement>('.nm-text')!
    expect(nm.textContent).toBe('林产品开发海外调研工厂报告线负责人')
    // The handle line stays its own single-line row (.sub) and is not merged.
    expect(el.querySelector<HTMLElement>('.sub')!.textContent).toContain('dsh/aaaa1111')
  })
})

describe('card second line (review 2026-10-27)', () => {
  it('a session card shows its description, refreshes it on the next poll, and keeps the handle in the tooltip', () => {
    const v = bench({ ...INPUT, sessions: [{ ...INPUT.sessions[0]!, description: '整理海外工厂报告' }, INPUT.sessions[1]!] })
    const el = v.root.querySelector<HTMLElement>('.p-node[data-id="lin"]')!
    expect(el.querySelector<HTMLElement>('.sub')!.textContent).toBe('整理海外工厂报告')
    expect(el.title).toContain('dsh/aaaa1111')
    v.reconcile({ ...INPUT, sessions: [{ ...INPUT.sessions[0]!, description: '复核报价' }, INPUT.sessions[1]!] })
    expect(el.querySelector<HTMLElement>('.sub')!.textContent).toBe('复核报价')
  })
})
