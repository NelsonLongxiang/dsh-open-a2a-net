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
  const sessionLog = vi.fn(async () => ({ ok: true, messages: [
    { role: 'user', text: '检查默认 profile 插件' },
    { role: 'assistant', text: '开始扫描插件列表' },
  ] }))
  const sessionLogList = vi.fn(async () => ({ ok: true, sessions: [
    // One row shadowing a network row (must be deduplicated) + one archived
    // row with no network presence (the 0.6.12 reachability fix).
    { id: 'session-11111111-aaaa', mtimeMs: NOW - 1_000, sizeBytes: 2048 },
    { id: 'session-99998888-archived', mtimeMs: NOW - 2_000, sizeBytes: 5_500_000 },
  ] }))
  // 0.6.15: the /a2a/log proxy — used by remote-row and peer chat faces.
  const remoteSessionLog = vi.fn(async (query: { team?: string; peer?: string; id?: string }) => {
    if (query.team !== undefined) {
      return { ok: true, messages: [
        { role: 'user', text: '评审一下这个 PR' },
        { role: 'assistant', text: '已读 diff，开始评审' },
      ] }
    }
    if (query.id !== undefined) {
      return { ok: true, messages: [{ role: 'assistant', text: '对端会话正文' }] }
    }
    return { ok: true, sessions: [
      { id: 'session-77777777-peer', mtimeMs: NOW - 3_000, sizeBytes: 4096 },
    ] }
  })
  const v = createWorkbench({ now: () => NOW, abandon, copy, canvasOp, dispatchQuick, sessionLog, sessionLogList, remoteSessionLog })
  document.body.appendChild(v.root)
  return { v, abandon, copy, canvasOp, dispatchQuick, sessionLog, sessionLogList, remoteSessionLog }
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

  it('chat drawer shows a picked session as text only and closes via ✕ (0.6.13)', () => {
    const { v } = bench()
    v.update({ ...state, sessions: [{ ...state.sessions![0]!, name: '<img src=x onerror=1>' }] })
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n) === '<img src=x onerror=1>')!
    item.click()
    const chat = v.root.querySelector('.wb-chat')!
    expect(chat.classList.contains('is-open')).toBe(true)
    expect(text(chat.querySelector('.wb-chat-title'))).toBe('<img src=x onerror=1>')
    expect(chat.querySelectorAll('img').length).toBe(0)
    const close = [...chat.querySelectorAll('button')].find(b => text(b) === '✕')!
    close.click()
    expect(v.root.querySelector('.wb-chat')!.classList.contains('is-open')).toBe(false)
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
    // Local rows open the chat drawer (0.6.13); remote rows do too (0.6.15,
    // transcript through the proxy) — reading in place, nothing navigates.
    const items = [...v.root.querySelectorAll('.wb-directory .wb-item')]
    const scout = items.find(n => text(n).includes('scout-01'))!
    ;(scout.querySelector('.wb-item-label') as HTMLElement).click()
    expect(v.root.querySelector('.wb-chat.is-open')).not.toBeNull()
    const remote = items.find(n => text(n).includes('remote-host'))!
    ;(remote.querySelector('.wb-item-label') as HTMLElement).click()
    expect(v.root.querySelector('.wb-chat.is-open')).not.toBeNull()
    expect(text(v.root.querySelector('.wb-chat'))).toContain('remote-host')
  })

  it('a local session row dispatches through the chat drawer\u2019s inline 快派 form', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('scout-01'))!
    item.click()
    const form = v.root.querySelector('.wb-chat .wb-dispatch-form') as HTMLFormElement
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
    // 0.6.15: remote rows open the chat drawer — the dispatch form rides it.
    return v.root.querySelector('.wb-chat') as HTMLElement
  }

  it('dispatches from the remote row chat drawer keyed to the remote team handle', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const card = openRemote(v)
    const form = card.querySelector('.wb-dispatch-form') as HTMLFormElement
    const area = form.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    area.value = 'across the mesh'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dispatchQuick).toHaveBeenCalledWith('dsh-host-ca0c0a8d', 'across the mesh'))
  })

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

describe('inline transcript (0.6.11)', () => {
  function openSession(v: ReturnType<typeof createWorkbench>): Element {
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('scout-01'))!
    item.click()
    // 0.6.13: session rows open the chat drawer (was the inspector card).
    const chat = v.root.querySelector('.wb-chat')!
    expect(chat.classList.contains('is-open')).toBe(true)
    return chat
  }

  it('renders the tail of a local session\u2019s log inline after selection', async () => {
    const { v, sessionLog } = bench()
    v.update(state)
    openSession(v)
    expect(sessionLog).toHaveBeenCalledWith('session-11111111-aaaa')
    await vi.waitFor(() => {
      const body = v.root.querySelector('.wb-transcript-body')!
      expect(text(body)).toContain('检查默认 profile 插件')
      expect(text(body)).toContain('开始扫描插件列表')
    })
    const roles = [...v.root.querySelectorAll('.wb-transcript-role')].map(n => text(n))
    expect(roles).toEqual(['问', '答'])
  })

  it('serves the cached tail across poll remounts without refetching', async () => {
    const { v, sessionLog } = bench()
    v.update(state)
    openSession(v)
    await vi.waitFor(() => expect(v.root.querySelector('.wb-transcript-body')!.textContent).toContain('开始扫描'))
    // The 3s poll rebuilds the inspector; the cache answers, not the route.
    v.update({ ...state, sessions: [...state.sessions] })
    await vi.waitFor(() => expect(v.root.querySelector('.wb-transcript-body')!.textContent).toContain('开始扫描'))
    expect(sessionLog).toHaveBeenCalledTimes(1)
    // The refresh button forces exactly one re-read.
    ;(v.root.querySelector('.wb-transcript-refresh') as HTMLElement).click()
    await vi.waitFor(() => expect(sessionLog).toHaveBeenCalledTimes(2))
  })

  it('explains failure and hides entirely when the dep is absent', async () => {
    const failing = vi.fn(async () => ({ ok: false, error: 'no log artifact for this session' }))
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true), sessionLog: failing })
    document.body.appendChild(v.root)
    v.update(state)
    openSession(v)
    await vi.waitFor(() => expect(text(v.root.querySelector('.wb-transcript-body'))).toContain('无法读取（no log artifact'))

    const bare = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true) })
    document.body.appendChild(bare.root)
    bare.update(state)
    const item = [...bare.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('scout-01'))!
    item.click()
    expect(bare.root.querySelector('.wb-transcript')).toBeNull()
  })

  it('remote rows without the proxy dep keep the honest note instead of a transcript', () => {
    // 0.6.15: the proxy read face is opt-in — without the dep the chat says
    // where the records live instead of guessing.
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true), sessionLog: vi.fn(async () => ({ ok: true, messages: [] })) })
    document.body.appendChild(v.root)
    v.update(state)
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('remote-host'))!
    item.click()
    expect(text(v.root.querySelector('.wb-chat'))).toContain('远端节点的对话记录在对端机器上')
    expect(v.root.querySelector('.wb-transcript')).toBeNull()
  })
})

describe('local log archive section (0.6.12)', () => {
  it('lists archived sessions with no network row and opens their transcript', async () => {
    const { v, sessionLog } = bench()
    v.update(state)
    // The listing lands async; the section appears when rows resolve.
    await vi.waitFor(() => {
      const head = [...v.root.querySelectorAll('.wb-side-head')].map(n => text(n))
      expect(head.join('|')).toContain('本机日志 · 1')
    })
    // The network row session-11111111-aaaa is deduplicated: only the
    // archived session-99998888-archived remains.
    const rows = [...v.root.querySelectorAll('.wb-item-label')].map(n => text(n))
    expect(rows.some(l => l.includes('888-archived'))).toBe(true)
    expect(rows.some(l => l.includes('1111-aaaa') && l.includes('KB'))).toBe(false)
    ;([...v.root.querySelectorAll('.wb-item')].find(n => text(n).includes('888-archived')) as HTMLElement).click()
    expect(text(v.root.querySelector('.wb-chat'))).toContain('只读日志')
    expect(sessionLog).toHaveBeenCalledWith('session-99998888-archived')
    await vi.waitFor(() => expect(text(v.root.querySelector('.wb-transcript-body'))).toContain('开始扫描插件列表'))
  })

  it('counts the archive in the directory header and hides the section without the dep', async () => {
    const { v } = bench()
    v.update(state)
    await vi.waitFor(() => expect(text(v.root.querySelector('.wb-sec[data-sec="directory"] .wb-sec-count'))).toContain('档'))
    const bare = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true), sessionLog: vi.fn(async () => ({ ok: true, messages: [] })) })
    document.body.appendChild(bare.root)
    bare.update(state)
    await Promise.resolve()
    await Promise.resolve()
    const heads = [...bare.root.querySelectorAll('.wb-side-head')].map(n => text(n))
    expect(heads.join('|')).not.toContain('本机日志')
  })
})

describe('node chat drawer (0.6.13)', () => {
  it('a board session pick opens the drawer with transcript and send form', async () => {
    const { v, sessionLog, dispatchQuick } = bench()
    v.update(state)
    v.openNodeChat('session-11111111-aaaa')
    const chat = v.root.querySelector('.wb-chat')!
    expect(chat.classList.contains('is-open')).toBe(true)
    expect(text(chat.querySelector('.wb-chat-title'))).toBe('scout-01')
    expect(text(chat.querySelector('.wb-chat-sub'))).toBe('dsh/11111111')
    expect(sessionLog).toHaveBeenCalledWith('session-11111111-aaaa')
    await vi.waitFor(() => expect(text(chat.querySelector('.wb-transcript-body'))).toContain('开始扫描插件列表'))
    // The chat face carries its own send form (read + reply in one place).
    const form = chat.querySelector('.wb-dispatch-form') as HTMLFormElement
    ;(form.querySelector('.wb-dispatch-text') as HTMLTextAreaElement).value = 'board hello'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dispatchQuick).toHaveBeenCalledWith('dsh/11111111', 'board hello'))
  })

  it('a board peer pick without the proxy dep shows the honest cross-host note', () => {
    // 0.6.15: with remoteSessionLog wired the peer face becomes a drill-down
    // (see the 0.6.15 describe); the honest note remains the no-dep fallback.
    const sessionLog = vi.fn(async () => ({ ok: true, messages: [] }))
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true), sessionLog })
    document.body.appendChild(v.root)
    v.update(state)
    v.openNodeChat('peer-192.168.3.157:13080')
    const chat = v.root.querySelector('.wb-chat')!
    expect(chat.classList.contains('is-open')).toBe(true)
    expect(text(chat.querySelector('.wb-chat-title'))).toBe('http://192.168.3.157:13080')
    expect(text(chat)).toContain('会话记录存放在对端机器上')
    expect(chat.querySelector('.wb-transcript')).toBeNull()
    expect(sessionLog).not.toHaveBeenCalled()
  })

  it('an unknown pick is a no-op and the drawer survives poll remounts', async () => {
    const { v } = bench()
    v.update(state)
    v.openNodeChat('session-00000000-zzzz')
    expect(v.root.querySelector('.wb-chat')!.classList.contains('is-open')).toBe(false)
    // Open a real one, then feed the 3s poll: the drawer re-renders in place.
    v.openNodeChat('session-22222222-bbbb')
    expect(v.root.querySelector('.wb-chat.is-open')).not.toBeNull()
    v.update({ ...state, sessions: [...state.sessions] })
    expect(v.root.querySelector('.wb-chat.is-open')).not.toBeNull()
    expect(text(v.root.querySelector('.wb-chat-title'))).toBe('cold-02')
  })
})

describe('remote chat through the proxy (0.6.15)', () => {
  it('a remote row loads its transcript via remoteSessionLog(team) in the drawer', async () => {
    const { v, remoteSessionLog } = bench()
    v.update(state)
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('remote-host'))!
    item.click()
    const chat = v.root.querySelector('.wb-chat')!
    expect(chat.classList.contains('is-open')).toBe(true)
    // Card metadata rides the chat head area (0.6.15 moved the remote card).
    expect(text(chat)).toContain('node 192.168.3.157')
    await vi.waitFor(() => expect(remoteSessionLog).toHaveBeenCalledWith({ team: 'dsh-host-ca0c0a8d' }))
    await vi.waitFor(() => {
      const body = chat.querySelector('.wb-transcript-body')!
      expect(text(body)).toContain('评审一下这个 PR')
      expect(text(body)).toContain('已读 diff，开始评审')
    })
  })

  it('a peer pick drills: session list from the peer, then the picked transcript, then back', async () => {
    const { v, remoteSessionLog } = bench()
    v.update(state)
    v.openNodeChat('peer-192.168.3.157:13080')
    const chat = v.root.querySelector('.wb-chat')!
    expect(chat.classList.contains('is-open')).toBe(true)
    // Phase 1: the listing (via the proxy, never a direct dial).
    await vi.waitFor(() => expect(remoteSessionLog).toHaveBeenCalledWith({ peer: 'http://192.168.3.157:13080' }))
    await vi.waitFor(() => {
      const rows = [...chat.querySelectorAll('.wb-member-row')].map(n => text(n))
      expect(rows.some(r => r.includes('-peer'))).toBe(true)
    })
    // Phase 2: pick a session → transcript keyed peer:url:id.
    ;(chat.querySelector('.wb-member-row') as HTMLElement).click()
    await vi.waitFor(() => expect(remoteSessionLog).toHaveBeenLastCalledWith({ peer: 'http://192.168.3.157:13080', id: 'session-77777777-peer' }))
    await vi.waitFor(() => expect(text(chat.querySelector('.wb-transcript-body'))).toContain('对端会话正文'))
    // Phase 3: back to the listing.
    ;(chat.querySelector('.wb-transcript-refresh') as HTMLElement).click()
    await vi.waitFor(() => {
      const rows = [...chat.querySelectorAll('.wb-member-row')].map(n => text(n))
      expect(rows.some(r => r.includes('-peer'))).toBe(true)
    })
  })

  it('a peer listing failure surfaces the proxy error inline', async () => {
    const failing = vi.fn(async () => ({ ok: false, error: 'remote log unavailable — http://192.168.3.157:13080' }))
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true), remoteSessionLog: failing })
    document.body.appendChild(v.root)
    v.update(state)
    v.openNodeChat('peer-192.168.3.157:13080')
    const chat = v.root.querySelector('.wb-chat')!
    await vi.waitFor(() => expect(text(chat)).toContain('无法读取（remote log unavailable'))
  })
})

describe('chat UI conventions (0.6.17)', () => {
  function openScoutChat(v: ReturnType<typeof createWorkbench>): HTMLElement {
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n).includes('scout-01'))!
    item.click()
    return v.root.querySelector('.wb-chat') as HTMLElement
  }

  it('Enter sends, Shift+Enter inserts a newline instead', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const chat = openScoutChat(v)
    const area = chat.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    area.focus()
    area.value = 'enter line'
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dispatchQuick).toHaveBeenCalledWith('dsh/11111111', 'enter line'))
    // Shift+Enter: soft newline, no submit.
    dispatchQuick.mockClear()
    area.value = 'first'
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    expect(dispatchQuick).not.toHaveBeenCalled()
    expect(area.value).toBe('first')
    // IME composition is never hijacked: a composing Enter does not submit.
    area.value = ' composing'
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))
    expect(dispatchQuick).not.toHaveBeenCalled()
  })

  it('clears the composer after a successful send and keeps focus through poll remounts', async () => {
    const { v, dispatchQuick } = bench()
    v.update(state)
    const chat = openScoutChat(v)
    const area = chat.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    expect(document.activeElement).toBe(area)
    area.value = 'clear me'
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(text(v.root.querySelector('.wb-dispatch-note'))).toContain('已派发'))
    expect(area.value).toBe('')
    // The 3s poll remounts the drawer; the cached form node keeps focus —
    // this is the focus-loss bug the owner hit.
    expect(document.activeElement).toBe(area)
    v.update({ ...state, sessions: [...state.sessions] })
    const areaAfter = v.root.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    expect(areaAfter).toBe(area)
    expect(document.activeElement).toBe(areaAfter)
    // Caret position survives the poll too — typing continues in place.
    areaAfter.value = 'typing more'
    areaAfter.setSelectionRange(4, 4)
    v.update({ ...state, sessions: [...state.sessions] })
    const areaThird = v.root.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    expect(document.activeElement).toBe(areaThird)
    expect(areaThird.selectionStart).toBe(4)
  })

  it('Escape closes the drawer; focus lands in the composer on open only', () => {
    const { v } = bench()
    v.update(state)
    const chat = openScoutChat(v)
    expect(chat.classList.contains('is-open')).toBe(true)
    const area = chat.querySelector('.wb-dispatch-text') as HTMLTextAreaElement
    expect(document.activeElement).toBe(area)
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(chat.classList.contains('is-open')).toBe(false)
  })

  it('transcript scroll position survives poll remounts instead of jumping to top', async () => {
    const { v } = bench()
    v.update(state)
    const chat = openScoutChat(v)
    await vi.waitFor(() => expect(text(chat.querySelector('.wb-transcript-body'))).toContain('开始扫描插件列表'))
    const body = chat.querySelector('.wb-transcript-body') as HTMLElement
    // The user scrolled up while reading; the poll fires. The settle runs
    // on the next frame (scroll writes only stick on attached elements).
    body.scrollTop = 120
    body.dispatchEvent(new Event('scroll', { bubbles: false }))
    v.update({ ...state, sessions: [...state.sessions] })
    await new Promise(resolve => { requestAnimationFrame(() => { resolve(null) }) })
    const bodyAfter = v.root.querySelector('.wb-chat .wb-transcript-body') as HTMLElement
    expect(bodyAfter).not.toBe(body)
    expect(bodyAfter.scrollTop).toBe(120)
  })
})
