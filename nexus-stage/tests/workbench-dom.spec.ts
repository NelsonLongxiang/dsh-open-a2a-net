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
  const canvasOp = vi.fn(async () => true)
  const dispatchQuick = vi.fn(async () => ({ ok: true, task_id: 'direct-qqqq1111' }))
  const v = createWorkbench({ now: () => NOW, abandon, copy, canvasOp, dispatchQuick })
  document.body.appendChild(v.root)
  return { v, abandon, copy, canvasOp, dispatchQuick }
}

const state: StateBody = {
  version: '0.6.2',
  sessions: [
    { id: 'session-11111111-aaaa', label: 'dsh-host-x-11111111', team: 'dsh/11111111', name: 'scout-01', live: true, joined: true, workspace: '/tmp/scout', canvasTeams: ['dsh/canvas/ygl'] },
    { id: 'session-22222222-bbbb', label: 'dsh-host-x-22222222', team: 'dsh/22222222', name: 'cold-02', live: false, joined: true },
  ],
  canvas: { teams: [{ name: 'ygl', team: 'dsh/canvas/ygl', members: [
    { id: 'session-11111111-aaaa', live: true },
    { id: 'nel157/a1b2c3d4', team: 'nel157/a1b2c3d4', remote: true },
  ] }] },
  peers: [{ url: 'http://192.168.3.157:13080', score: 687700 }],
  remote: [{ team: 'dsh-host-ca0c0a8d', name: 'remote-host', origin: 'node 192.168.3.157', via: 'http://192.168.3.157:13080', canvasTeams: ['dsh/canvas/ygl'] }],
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
  archivedSplit: { completed: 9, declined: 2, abandoned: 1 },
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
      now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true),
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
      now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true),
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
  it('renders the ledger density strip: stats, archive split, age histogram, team load', () => {
    const { v } = bench()
    v.update(state)
    const pane = v.root.querySelector('.wb-pane')!
    // Stat chips carry the headline numbers plus their definitions as tooltips.
    const chips = [...pane.querySelectorAll('.wb-stat')].map(n => ({
      label: text(n.querySelector('.wb-stat-k')),
      value: text(n.querySelector('.wb-stat-v')),
      hint: n.getAttribute('title') ?? '',
    }))
    expect(chips.map(c => `${c.label}=${c.value}`)).toEqual([
      '待回执=2', '陈旧=1', '死信=1', '已归档=12',
    ])
    for (const chip of chips) expect(chip.hint.length).toBeGreaterThan(10)
    // Archive verdict split surfaces when the host sends it.
    expect(text(pane)).toContain('归档结局')
    // Age histogram buckets the pending rows (3.7e6ms ≈ 1-6h, 10s ≈ <10m).
    const bars = [...pane.querySelectorAll('.wb-bar-row')].map(n =>
      `${text(n.querySelector('.wb-bar-k'))}:${text(n.querySelector('.wb-bar-v'))}`)
    expect(bars).toEqual(['<10m:1', '10m-1h:0', '1-6h:1', '6-24h:0', '>24h:0'])
    // Team load ranks the teams holding debt.
    expect(text(pane)).toContain('债务队 Top2')
    expect(text(pane)).toContain('dsh/11111111 1')
  })

  it('renders ledger rows and settles a dead letter through the abandon seam', async () => {
    const { v, abandon } = bench()
    v.update(state)
    const pane = v.root.querySelector('.wb-pane')!
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

describe('directory search & filters (0.6.6)', () => {
  function visibleLabels(v: ReturnType<typeof createWorkbench>): string[] {
    return [...v.root.querySelectorAll('.wb-directory .wb-item .wb-item-label')].map(n => text(n))
  }

  it('unified search narrows rows across sections and reports no matches', () => {
    const { v } = bench()
    v.update(state)
    const search = v.root.querySelector('.wb-search') as HTMLInputElement
    search.value = 'cold'
    search.dispatchEvent(new Event('input'))
    let labels = visibleLabels(v)
    expect(labels.some(l => l.includes('cold-02'))).toBe(true)
    expect(labels.some(l => l.includes('scout-01'))).toBe(false)
    // Searching by remote name hits the remote section.
    search.value = 'remote-host'
    search.dispatchEvent(new Event('input'))
    labels = visibleLabels(v)
    expect(labels.length).toBe(1)
    expect(labels[0]!).toContain('remote-host')
    // Nothing matches → explicit empty state, sections hidden.
    search.value = 'zzz-no-such-thing'
    search.dispatchEvent(new Event('input'))
    expect(visibleLabels(v).length).toBe(0)
    expect(text(v.root.querySelector('.wb-directory'))).toContain('无匹配条目')
  })

  it('search survives a poll and matches canvas teams and remote handles', () => {
    const { v } = bench()
    v.update(state)
    const search = v.root.querySelector('.wb-search') as HTMLInputElement
    search.value = 'nel157/a1b2c3d4'
    search.dispatchEvent(new Event('input'))
    v.update(state) // a poll must not wipe the input
    expect((v.root.querySelector('.wb-search') as HTMLInputElement).value).toBe('nel157/a1b2c3d4')
    const labels = visibleLabels(v)
    expect(labels.length).toBe(1)
    expect(labels[0]!).toContain('ygl')
  })

  it('category chips narrow the directory to one group', () => {
    const { v } = bench()
    v.update(state)
    const chip = (label: string): HTMLElement => {
      const found = [...v.root.querySelectorAll('.wb-filter')].find(n => text(n) === label)
      expect(found).toBeDefined()
      return found as HTMLElement
    }
    chip('本机').click()
    let labels = visibleLabels(v)
    expect(labels.some(l => l.includes('scout-01'))).toBe(true)
    expect(labels.some(l => l.includes('cold-02'))).toBe(true)
    expect(labels.some(l => l.includes('remote-host'))).toBe(false)
    expect(labels.some(l => l.includes('ygl'))).toBe(false)
    expect(chip('本机').classList.contains('is-active')).toBe(true)
    chip('远端').click()
    labels = visibleLabels(v)
    expect(labels.length).toBe(1)
    expect(labels[0]!).toContain('remote-host')
    chip('全部').click()
    expect(visibleLabels(v).length).toBe(5) // 2 sessions + 1 canvas + 1 peer + 1 remote
  })

  it('canvas-team badges annotate session and remote rows', () => {
    const { v } = bench()
    v.update(state)
    const items = [...v.root.querySelectorAll('.wb-directory .wb-item')]
    const scout = items.find(n => text(n).includes('scout-01'))!
    expect(text(scout.querySelector('.wb-item-badge'))).toBe('▤ ygl')
    expect(scout.querySelector('.wb-item-badge')!.getAttribute('title')).toContain('dsh/canvas/ygl')
    const remote = items.find(n => text(n).includes('remote-host'))!
    expect(text(remote.querySelector('.wb-item-badge'))).toBe('▤ ygl')
    // The cold session has no canvas membership → no badge node at all.
    const cold = items.find(n => text(n).includes('cold-02'))!
    expect(cold.querySelector('.wb-item-badge')).toBeNull()
  })
})

describe('inline-only reach (0.6.10)', () => {
  it('no jump affordance exists anywhere: rows select in place, nothing navigates', () => {
    const { v } = bench()
    v.update(state)
    // 0.6.7/0.6.8's ↗ (openLocal broadcast / openRemote deep link) is gone
    // by ruling — 禁止任何跳转，全部使用响应式布局.
    expect(v.root.querySelector('.wb-item-open')).toBeNull()
    // Local and remote rows still select — the inspector is the interaction.
    const items = [...v.root.querySelectorAll('.wb-directory .wb-item')]
    const scout = items.find(n => text(n).includes('scout-01'))!
    ;(scout.querySelector('.wb-item-label') as HTMLElement).click()
    expect(v.root.querySelector('.wb-inspector.is-open')).not.toBeNull()
    const remote = items.find(n => text(n).includes('remote-host'))!
    ;(remote.querySelector('.wb-item-label') as HTMLElement).click()
    expect(text(v.root.querySelector('.wb-inspector'))).toContain('remote-host')
  })

  it('a local session row dispatches through the same inline 快派 form', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('scout-01'))!
    item.click()
    const form = v.root.querySelector('.wb-inspector .wb-dispatch-form') as HTMLFormElement
    expect(form).not.toBeNull()
    ;(form.querySelector('.wb-dispatch-text') as HTMLTextAreaElement).value = 'local hello'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dispatchQuick).toHaveBeenCalledWith('dsh/11111111', 'local hello'))
  })
})

describe('canvas inspector member management (0.6.6)', () => {
  function openTeam(v: ReturnType<typeof createWorkbench>): HTMLElement {
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('ygl'))!
    item.click()
    return v.root.querySelector('.wb-inspector .wb-card') as HTMLElement
  }

  it('lists members with local/remote dots and removes through canvasOp', () => {
    const { v, canvasOp } = bench()
    v.update(state)
    const card = openTeam(v)
    const rows = [...card.querySelectorAll('.wb-member-row')]
    expect(rows.length).toBe(2)
    expect(text(rows[0]!.querySelector('.wb-member-dot'))).toContain('● 现场')
    expect(text(rows[1]!.querySelector('.wb-member-dot'))).toContain('◇ 远端')
    // Local member shows the session label, remote shows the raw handle.
    expect(text(rows[0]!.querySelector('.wb-member-label'))).toContain('scout-01')
    expect(text(rows[1]!.querySelector('.wb-member-label'))).toBe('nel157/a1b2c3d4')
    ;([...rows[0]!.querySelectorAll('button')].find(b => text(b) === '移除') as HTMLElement).click()
    expect(canvasOp).toHaveBeenCalledWith('remove-member', 'ygl', 'session-11111111-aaaa')
  })

  it('adds members by picker (local session) and by manual remote handle', async () => {
    const { v, canvasOp } = bench()
    v.update(state)
    const card = openTeam(v)
    const form = card.querySelector('.wb-member-add') as HTMLFormElement
    const pick = form.querySelector('.wb-member-pick') as HTMLSelectElement
    const manual = form.querySelector('.wb-member-manual') as HTMLInputElement
    // Existing members are not pickable; the cold session is.
    const values = [...pick.options].map(o => o.value)
    expect(values).not.toContain('session-11111111-aaaa')
    expect(values).toContain('session-22222222-bbbb')
    expect(values).toContain('dsh-host-ca0c0a8d')
    pick.value = 'session-22222222-bbbb'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(canvasOp).toHaveBeenCalledWith('add-member', 'ygl', 'session-22222222-bbbb'))
    // Manual handle wins over the picker when filled.
    manual.value = 'nel85/9abc1234'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(canvasOp).toHaveBeenCalledWith('add-member', 'ygl', 'nel85/9abc1234'))
    expect(manual.value).toBe('') // cleared on success
  })

  it('add-member inputs survive polls (draftForm trick)', () => {
    const { v } = bench()
    v.update(state)
    const card = openTeam(v)
    const manual = card.querySelector('.wb-member-manual') as HTMLInputElement
    manual.value = 'nel85/9abc1234'
    v.update(state) // a poll must not rebuild the form
    const manualAfter = v.root.querySelector('.wb-member-manual') as HTMLInputElement
    expect(manualAfter.value).toBe('nel85/9abc1234')
    expect(manualAfter).toBe(manual) // same node re-mounted, not rebuilt
  })
})

describe('quick dispatch form (0.6.9)', () => {
  function openTeam(v: ReturnType<typeof createWorkbench>): HTMLElement {
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('ygl'))!
    item.click()
    return v.root.querySelector('.wb-inspector .wb-card') as HTMLElement
  }

  function openRemote(v: ReturnType<typeof createWorkbench>): HTMLElement {
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('remote-host'))!
    item.click()
    return v.root.querySelector('.wb-inspector .wb-card') as HTMLElement
  }

  it('dispatches from the canvas team inspector keyed to the routing team; the note names the task', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const card = openTeam(v)
    const form = card.querySelector('.wb-dispatch-form') as HTMLFormElement
    const area = form.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    area.value = 'quick line for ops'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dispatchQuick).toHaveBeenCalledWith('dsh/canvas/ygl', 'quick line for ops'))
    await vi.waitFor(() => expect(text(v.root.querySelector('.wb-dispatch-note'))).toContain('direct-qqqq1111'))
    // The draft survives a poll (draftForm trick, same as member inputs).
    area.value = 'second draft'
    v.update(state)
    const areaAfter = v.root.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    expect(areaAfter.value).toBe('second draft')
    expect(areaAfter).toBe(area)
  })

  it('dispatches from the remote row inspector keyed to the remote team handle', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const card = openRemote(v)
    const form = card.querySelector('.wb-dispatch-form') as HTMLFormElement
    const area = form.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    area.value = 'across the mesh'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dispatchQuick).toHaveBeenCalledWith('dsh-host-ca0c0a8d', 'across the mesh'))
  })

  it('a refused dispatch surfaces the reason in the note', async () => {
    const dispatchQuick = vi.fn(async () => ({ ok: false, error: 'rate limited: one quick dispatch per 5s per client' }))
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true), dispatchQuick })
    document.body.appendChild(v.root)
    v.update(state)
    const card = openTeam(v)
    const form = card.querySelector('.wb-dispatch-form') as HTMLFormElement
    ;(form.querySelector('.wb-dispatch-text') as HTMLTextAreaElement).value = 'too fast'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(text(v.root.querySelector('.wb-dispatch-note'))).toContain('失败：rate limited'))
  })

  it('hides the form entirely when the dep is absent (graceful degradation)', () => {
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true) })
    document.body.appendChild(v.root)
    v.update(state)
    openTeam(v)
    expect(v.root.querySelector('.wb-dispatch')).toBeNull()
  })
})
