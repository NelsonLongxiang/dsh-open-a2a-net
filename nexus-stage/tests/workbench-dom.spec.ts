// @vitest-environment jsdom
/**
 * Workbench DOM behavior through the production seam (0.6.2 merged shell):
 * rail sections, the board stage vs the data stack, ledger rows with the
 * abandon action, the activity ring, derived plan actions, dispatch
 * drafting (input survives polls), the inspector overlay's text-only
 * rendering, and the responsive toggles (rail collapse / drawer).
 */
import { describe, expect, it, vi } from 'vitest'
import { createWorkbench, type StateBody } from '../src/workbench.ts'

const NOW = 1_700_000_000_000

function bench() {
  const abandon = vi.fn(async () => true)
  const copy = vi.fn()
  const v = createWorkbench({ now: () => NOW, abandon, copy })
  document.body.appendChild(v.root)
  return { v, abandon, copy }
}

const state: StateBody = {
  version: '0.6.2',
  sessions: [
    { id: 'session-11111111-aaaa', label: 'dsh-host-x-11111111', team: 'dsh/11111111', name: 'scout-01', live: true, joined: true, workspace: '/tmp/scout' },
    { id: 'session-22222222-bbbb', label: 'dsh-host-x-22222222', team: 'dsh/22222222', name: 'cold-02', live: false, joined: true },
  ],
  canvas: { teams: [{ name: 'ygl', team: 'dsh/canvas/ygl', members: [{ id: 'session-11111111-aaaa', live: true }] }] },
  peers: [{ url: 'http://192.168.3.157:13080', score: 687700 }],
  remote: [{ team: 'dsh-host-ca0c0a8d', name: 'remote-host', origin: 'node 192.168.3.157' }],
  activity: [
    { ts: NOW - 60_000, dir: 'out', team: 'dsh/11111111', peer: '192.168.3.157:13080', ok: true },
    { ts: NOW - 120_000, dir: 'in', team: 'dsh/22222222', peer: '192.168.3.157:13080', ok: false },
  ],
  inFlight: [{ team: 'dsh/11111111', peer: '192.168.3.157:13080', startedAt: NOW - 5_000 }],
  tasks: [
    { taskId: 'direct-aaaaaaaa', team: 'dsh/11111111', startedAt: NOW - 3_700_000, status: 'pending', direction: 'outbound', receiptExpected: true, settleable: true },
    { taskId: 'direct-bbbbbbbb', team: 'dsh/22222222', startedAt: NOW - 10_000, status: 'pending', receiptExpected: false, settleable: false },
  ],
  tasksStaleCount: 1,
  tasksDead: [{ taskId: 'direct-cccccccc', team: 'dsh/99999999', startedAt: NOW - 90_000_000, deadAt: NOW - 80_000_000, reason: 'stale TTL' }],
  archivedCount: 12,
  idempotency: { claimsFresh: 368, replays: 2, conflicts: 0 },
  reconcile: { state: 'idle', rows: [{ id: 'session-33333333', error: 'corrupt log: boom', attempts: 3, needsRepair: true }] },
}

function text(node: Element | null | undefined): string {
  return node?.textContent ?? ''
}

describe('workbench rail sections', () => {
  it('renders the directory sections with counts', () => {
    const { v } = bench()
    v.update(state)
    const heads = [...v.root.querySelectorAll('.wb-side-head')].map(n => text(n))
    expect(heads.join('|')).toContain('本机 · 现场 · 1')
    expect(heads.join('|')).toContain('本机 · 冷启动 · 1')
    expect(heads.join('|')).toContain('Canvas 队 · 1')
    expect(heads.join('|')).toContain('Peers · 1')
    expect(heads.join('|')).toContain('远端节点 · 1')
    const labels = [...v.root.querySelectorAll('.wb-item-label')].map(n => text(n))
    expect(labels).toContain('scout-01')
    expect(labels.some(l => l.includes('192.168.3.157:13080'))).toBe(true)
  })

  it('defaults to data mode without a board: panels stack in the stage, rail keeps the directory', () => {
    const { v } = bench()
    v.update(state)
    expect(v.mode()).toBe('data')
    expect(v.root.dataset.mode).toBe('data')
    const stack = v.root.querySelector('.wb-data')!
    expect(stack.classList.contains('is-hidden')).toBe(false)
    // The three panes live in the stage stack, not in the rail.
    for (const pane of [v.root.querySelector('.wb-pane')!]) {
      expect(pane.closest('.wb-stage')).not.toBeNull()
      expect(pane.closest('.wb-rail')).toBeNull()
    }
    const rail = v.root.querySelector('.wb-rail')!
    expect(rail.querySelectorAll('.wb-pane').length).toBe(0)
    // The directory seat stays in the rail in both modes.
    expect(rail.querySelector('.wb-sec[data-sec="directory"]')).not.toBeNull()
    expect(rail.querySelector('.wb-directory')).not.toBeNull()
  })
})

describe('workbench merged stage (canvas mode)', () => {
  function boardBench(available = true) {
    const boardRoot = document.createElement('div')
    boardRoot.dataset.board = 'plan'
    const activate = vi.fn()
    const deactivate = vi.fn()
    const v = createWorkbench({
      now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(),
      board: { root: boardRoot, activate, deactivate, available: () => available },
    })
    document.body.appendChild(v.root)
    return { v, boardRoot, activate, deactivate }
  }

  it('canvas mode is the default while the board is available: board fills the stage, panels ride the rail', () => {
    const { v, boardRoot, activate } = boardBench()
    v.update(state)
    expect(v.mode()).toBe('canvas')
    expect(v.root.dataset.mode).toBe('canvas')
    expect(activate).toHaveBeenCalledTimes(1)
    const boardPane = v.root.querySelector('.wb-stage-board')!
    expect(boardPane.classList.contains('is-hidden')).toBe(false)
    expect(v.root.contains(boardRoot)).toBe(true)
    // The three panes were re-parented into their rail sections.
    const rail = v.root.querySelector('.wb-rail')!
    expect(rail.querySelectorAll('.wb-pane').length).toBe(3)
    expect(v.root.querySelector('.wb-data')!.classList.contains('is-hidden')).toBe(true)
  })

  it('canvas face drop: board deactivates once, panes return to the stage stack', () => {
    let available = true
    const boardRoot = document.createElement('div')
    const activate = vi.fn()
    const deactivate = vi.fn()
    const v = createWorkbench({
      now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(),
      board: { root: boardRoot, activate, deactivate, available: () => available },
    })
    document.body.appendChild(v.root)
    v.update(state)
    available = false
    v.update({ ...state, canvas: undefined })
    expect(v.mode()).toBe('data')
    expect(deactivate).toHaveBeenCalledTimes(1)
    const rail = v.root.querySelector('.wb-rail')!
    expect(rail.querySelectorAll('.wb-pane').length).toBe(0)
    const stack = v.root.querySelector('.wb-data')!
    expect(stack.classList.contains('is-hidden')).toBe(false)
    // selectTab('board') while the face is down stays in data mode.
    v.selectTab('board')
    expect(v.mode()).toBe('data')
  })

  it('selectTab un-collapses a rail section', () => {
    const { v } = boardBench()
    v.update(state)
    const planSec = v.root.querySelector('.wb-sec[data-sec="plan"]')!
    expect(planSec.classList.contains('is-collapsed')).toBe(true)
    v.selectTab('plan')
    expect(planSec.classList.contains('is-collapsed')).toBe(false)
    // Section head click re-collapses.
    ;(planSec.querySelector('.wb-sec-head') as HTMLElement).click()
    expect(planSec.classList.contains('is-collapsed')).toBe(true)
  })

  it('rail toggle collapses the rail and re-syncs the board view size', () => {
    const { v, activate } = boardBench()
    v.update(state)
    activate.mockClear()
    const toggle = v.root.querySelector('[data-testid="wb-rail-toggle"]') as HTMLElement
    toggle.click()
    expect(v.root.classList.contains('is-rail-collapsed')).toBe(true)
    expect(activate).toHaveBeenCalledTimes(1) // stage widened → board re-sync
    toggle.click()
    expect(v.root.classList.contains('is-rail-collapsed')).toBe(false)
  })
})

describe('workbench panels', () => {
  it('renders ledger rows and settles a dead letter through the abandon seam', async () => {
    const { v, abandon } = bench()
    v.update(state)
    const pane = v.root.querySelector('.wb-pane')!
    expect(text(pane.querySelector('.wb-pane-head'))).toContain('待回执 2')
    expect(text(pane.querySelector('.wb-pane-head'))).toContain('死信 1')
    const rows = [...pane.querySelectorAll('.wb-row-id')].map(n => text(n))
    expect(rows).toContain('direct-aaaaaaaa')
    expect(rows).toContain('direct-cccccccc')
    const badges = [...pane.querySelectorAll('.wb-row-badges')].map(n => text(n))
    expect(badges.join('|')).toContain('可结算')
    expect(badges.join('|')).toContain('无回执债')
    const btn = [...pane.querySelectorAll('button')].find(b => text(b) === '清账')!
    btn.click()
    await vi.waitFor(() => expect(text(btn)).toBe('已清'))
    expect(abandon).toHaveBeenCalledWith('direct-cccccccc', 'workbench dead-letter cleanup')
  })

  it('renders activity: in-flight first, failed inbound marked', () => {
    const { v } = bench()
    v.update(state)
    const panes = [...v.root.querySelectorAll('.wb-pane')]
    const activityPane = panes.find(p => text(p).includes('活动环'))!
    expect(activityPane.innerHTML.indexOf('dsh/11111111')).toBeGreaterThanOrEqual(0)
    expect(activityPane.querySelector('.wb-row-dir.is-fail')).not.toBeNull()
  })

  it('derives plan actions: dead cleanup, stale nudge with copy brief, cold wake, repair flag', () => {
    const { v, copy } = bench()
    v.update(state)
    const panes = [...v.root.querySelectorAll('.wb-pane')]
    const pane = panes.find(p => text(p).includes('待办行动'))!
    const actions = [...pane.querySelectorAll('.wb-action-text')].map(n => text(n))
    expect(actions.some(t => t.includes('清账 1 条死信'))).toBe(true)
    expect(actions.some(t => t.includes('催办 direct-aaaaaaaa'))).toBe(true)
    expect(actions.some(t => t.includes('冷会话 cold-02'))).toBe(true)
    expect(actions.some(t => t.includes('corrupt log: boom'))).toBe(true)
    const nudge = [...pane.querySelectorAll('button')].find(b => text(b) === '复制催办')!
    nudge.click()
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy.mock.calls[0]![0]).toContain('task direct-aaaaaaaa')
    // Dispatch drafting present with target options.
    const select = pane.querySelector('.wb-select') as HTMLSelectElement
    const options = [...select.options].map(o => o.value)
    expect(options).toContain('dsh/11111111')
    expect(options).toContain('dsh/canvas/ygl')
    expect(options).toContain('dsh-host-ca0c0a8d')
  })

  it('keeps dispatch input across polls and drafts a pasteable brief', () => {
    const { v, copy } = bench()
    v.update(state)
    const panes = [...v.root.querySelectorAll('.wb-pane')]
    const pane = panes.find(p => p.querySelector('.wb-textarea') !== null)!
    const select = pane.querySelector('.wb-select') as HTMLSelectElement
    const area = pane.querySelector('.wb-textarea') as HTMLTextAreaElement
    select.value = 'dsh/11111111'
    area.value = '做点工作并回报'
    v.update(state) // a poll must not wipe user input
    const areaAfter = pane.querySelector('.wb-textarea') as HTMLTextAreaElement
    expect(areaAfter.value).toBe('做点工作并回报')
    const btn = [...pane.querySelectorAll('button')].find(b => text(b) === '复制任务书')!
    btn.click()
    expect(copy.mock.calls[0]![0]).toBe('a2a_route 派单 → dsh/11111111：\n做点工作并回报')
  })

  it('healthy state renders the calm banner', () => {
    const { v } = bench()
    v.update({
      version: '0.6.2',
      sessions: [{ id: 'session-11111111-aaaa', label: 'l', team: 'dsh/11111111', live: true }],
      tasks: [],
      tasksDead: [],
    })
    const panes = [...v.root.querySelectorAll('.wb-pane')]
    const planPane = panes.find(p => text(p).includes('网络健康'))!
    expect(text(planPane.querySelector('.wb-pane-head'))).toContain('网络健康')
  })

  it('inspector shows a selected session as text only and closes via ✕', () => {
    const { v } = bench()
    v.update({ ...state, sessions: [{ ...state.sessions![0]!, name: '<img src=x onerror=1>' }] })
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n) === '<img src=x onerror=1>')!
    item.click()
    const inspector = v.root.querySelector('.wb-inspector')!
    expect(inspector.classList.contains('is-open')).toBe(true)
    const card = inspector.querySelector('.wb-card')!
    expect(text(card.querySelector('.wb-kv-v'))).toBe('<img src=x onerror=1>')
    expect(card.querySelectorAll('img').length).toBe(0)
    const close = [...inspector.querySelectorAll('button')].find(b => text(b) === '✕')!
    close.click()
    expect(v.root.querySelector('.wb-inspector')!.classList.contains('is-open')).toBe(false)
  })

  it('header shows version and idempotency counters', () => {
    const { v } = bench()
    v.update(state)
    const stats = text(v.root.querySelector('.wb-header-stats'))
    expect(stats).toContain('claims 368')
    expect(stats).toContain('conflicts 0')
    expect(text(v.root.querySelector('.wb-badge'))).toBe('v0.6.2')
  })
})
