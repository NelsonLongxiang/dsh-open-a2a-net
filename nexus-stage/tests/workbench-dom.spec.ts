// @vitest-environment jsdom
/**
 * Workbench DOM behavior through the production seam: directory sections,
 * ledger rows with the abandon action, the activity ring, derived plan
 * actions, dispatch drafting (input survives polls), tabs, and the
 * inspector's text-only rendering (attacker-shaped labels stay text).
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
  version: '0.6.0',
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

describe('workbench', () => {
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
    const tab = [...v.root.querySelectorAll('.wb-tab')].find(b => text(b) === '活动')!
    tab.click()
    const rows = [...v.root.querySelectorAll('.wb-pane')].filter(p => !p.classList.contains('is-hidden'))[0]
    const html = rows.innerHTML
    expect(html.indexOf('dsh/11111111')).toBeGreaterThanOrEqual(0)
    const fail = rows.querySelector('.wb-row-dir.is-fail')
    expect(fail).not.toBeNull()
  })

  it('derives plan actions: dead cleanup, stale nudge with copy brief, cold wake, repair flag', () => {
    const { v, copy } = bench()
    v.update(state)
    const tab = [...v.root.querySelectorAll('.wb-tab')].find(b => text(b) === '规划')!
    tab.click()
    const pane = [...v.root.querySelectorAll('.wb-pane')].filter(p => !p.classList.contains('is-hidden'))[0]
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
    const tab = [...v.root.querySelectorAll('.wb-tab')].find(b => text(b) === '规划')!
    tab.click()
    const pane = [...v.root.querySelectorAll('.wb-pane')].filter(p => !p.classList.contains('is-hidden'))[0]
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
      version: '0.6.0',
      sessions: [{ id: 'session-11111111-aaaa', label: 'l', team: 'dsh/11111111', live: true }],
      tasks: [],
      tasksDead: [],
    })
    const tab = [...v.root.querySelectorAll('.wb-tab')].find(b => text(b) === '规划')!
    tab.click()
    const pane = [...v.root.querySelectorAll('.wb-pane')].filter(p => !p.classList.contains('is-hidden'))[0]
    expect(text(pane.querySelector('.wb-pane-head'))).toContain('网络健康')
  })

  it('inspector shows a selected session as text only', () => {
    const { v } = bench()
    v.update({ ...state, sessions: [{ ...state.sessions![0]!, name: '<img src=x onerror=1>' }] })
    const item = [...v.root.querySelectorAll('.wb-item-label')].find(n => text(n) === '<img src=x onerror=1>')!
    item.click()
    const card = v.root.querySelector('.wb-card')!
    expect(text(card.querySelector('.wb-kv-v'))).toBe('<img src=x onerror=1>')
    expect(card.querySelectorAll('img').length).toBe(0)
  })

  it('header shows version and idempotency counters', () => {
    const { v } = bench()
    v.update(state)
    const stats = text(v.root.querySelector('.wb-header-stats'))
    expect(stats).toContain('claims 368')
    expect(stats).toContain('conflicts 0')
    expect(text(v.root.querySelector('.wb-badge'))).toBe('v0.6.0')
  })
})
