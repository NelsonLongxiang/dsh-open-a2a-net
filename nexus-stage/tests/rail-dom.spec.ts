// @vitest-environment jsdom
/**
 * The rewritten left rail (2026-10-23), module by module: the tab shell
 * (wb-rail), the 目录 tab with its 本机日志 redesign (wb-directory) and the
 * redesigned 台账 tab (wb-ledger).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRailTabs } from '../src/wb-rail.ts'
import { learnLogTitle, loadLogTitles, renderDirectory, type DirectoryContext } from '../src/wb-directory.ts'
import { ledgerFacts, renderLedger, type LedgerContext } from '../src/wb-ledger.ts'
import type { StateBody } from '../src/workbench.ts'

// 2026-10-23 12:00 local time: "today" / "yesterday" buckets are calendar days.
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime()
const HOUR = 3_600_000
const text = (n: Element | null | undefined): string => n?.textContent ?? ''

// jsdom here runs on an opaque origin with no localStorage at all — the
// modules must work without it (guarded), and tests that pin persistence
// install an in-memory Storage.
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => { m.clear() },
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}
beforeEach(() => { Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true }) })
afterEach(() => { Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true }) })

describe('without browser storage', () => {
  it('the rail and the title store still work', () => {
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true })
    const t = createRailTabs([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }])
    t.select('b')
    expect(t.selected()).toBe('b')
    const titles = loadLogTitles()
    expect(titles.size).toBe(0)
    expect(learnLogTitle(titles, 'id', [{ role: 'user', text: 'hello' }])).toBe(true)
    expect(titles.get('id')).toBe('hello')
  })
})

describe('rail tabs (wb-rail)', () => {
  const defs = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }] as const

  it('remembers the selected tab per viewer and reports changes', () => {
    const onChange = vi.fn()
    const first = createRailTabs(defs, { onChange })
    first.select('c')
    expect(onChange).toHaveBeenCalledWith('c')
    expect(window.localStorage.getItem('dsh-a2a.rail.tab')).toBe('c')
    const second = createRailTabs(defs)
    expect(second.selected()).toBe('c')
    expect(second.panel('c').hidden).toBe(false)
    expect(second.panel('a').hidden).toBe(true)
  })

  it('a hidden selected tab falls back to the first visible one; Home/End skip hidden tabs', () => {
    const t = createRailTabs(defs)
    document.body.appendChild(t.root)
    t.select('b')
    t.setHidden('b', true)
    expect(t.selected()).toBe('a')
    t.select('b')
    expect(t.selected()).toBe('a') // a hidden tab cannot be selected
    const list = t.root.querySelector('.wb-tabs')!
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(t.selected()).toBe('c')
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(t.selected()).toBe('a')
    expect(document.activeElement).toBe(t.root.querySelector('.wb-tab[data-sec="a"]'))
  })

  it('badges count, and take a tone only when something needs a hand', () => {
    const t = createRailTabs(defs)
    t.setBadge('a', '3', 'danger')
    t.setBadge('b', '1/2')
    const badge = (k: string) => t.root.querySelector(`.wb-tab[data-sec="${k}"] .wb-tab-badge`)!
    expect(text(badge('a'))).toBe('3')
    expect(badge('a').classList.contains('is-danger')).toBe(true)
    expect(badge('b').className).toBe('wb-tab-badge')
  })
})

describe('目录 (wb-directory)', () => {
  const state: StateBody = {
    sessions: [{ id: 'session-11111111-aaaa', label: 'x', team: 'dsh/11111111', name: 'scout-01', live: true, joined: true }],
  }
  const logs = [
    { id: 'session-11111111-aaaa', mtimeMs: NOW - 60_000, sizeBytes: 9_000 }, // also a network row: deduped
    { id: 'session-aaaa0000-today', mtimeMs: NOW - 2 * HOUR, sizeBytes: 48_000 },
    { id: 'session-bbbb0000-yday', mtimeMs: NOW - 20 * HOUR, sizeBytes: 1_200_000 },
    { id: 'session-cccc0000-older', mtimeMs: NOW - 80 * HOUR, sizeBytes: 400 },
  ]
  function render(over: Partial<DirectoryContext> = {}) {
    const box = document.createElement('div')
    const ctx: DirectoryContext = {
      state, logs, titles: new Map(), search: '', filter: 'all', now: NOW,
      openChat: vi.fn(), selectCanvas: vi.fn(), ...over,
    }
    const badge = renderDirectory(box, ctx)
    return { box, ctx, badge }
  }

  it('groups 本机日志 by day, newest first, with relative time and size', () => {
    const { box } = render()
    expect([...box.querySelectorAll('.wb-dir-day')].map(text)).toEqual(['今天', '昨天', '更早'])
    const rows = [...box.querySelectorAll('.wb-item.is-untitled')]
    expect(rows.map(r => text(r.querySelector('.wb-item-label')))).toEqual(['会话 …aa0000-today', '会话 …bbb0000-yday', '会话 …cc0000-older'])
    expect(rows.map(r => text(r.querySelector('.wb-item-sub')))).toEqual(['2 小时前 · 48 KB', '20 小时前 · 1.2 MB', '3 天前 · 400 B'])
    // The network row is not repeated as a log.
    expect(text(box).includes('1111-aaaa · ')).toBe(false)
  })

  it('says how many logs it shows when the host caps the list', () => {
    const { box } = render({ logTotal: 73 })
    expect(text(box.querySelector('.wb-dir-group:last-child .wb-dir-head-note'))).toBe('显示 4 / 共 73')
    const uncapped = render({ logTotal: 4 }).box
    expect([...uncapped.querySelectorAll('.wb-dir-head-note')].map(text)).not.toContain('显示 4 / 共 4')
  })

  it('learned titles replace the id, are searchable, and open the log read-only', () => {
    const titles = new Map([['session-aaaa0000-today', '复核 Q3 选品清单']])
    const { box, ctx } = render({ titles, search: '选品' })
    const items = [...box.querySelectorAll('.wb-item')]
    expect(items).toHaveLength(1)
    expect(text(items[0]!.querySelector('.wb-item-label'))).toBe('复核 Q3 选品清单')
    expect(items[0]!.classList.contains('is-untitled')).toBe(false)
    ;(items[0] as HTMLElement).click()
    expect(ctx.openChat).toHaveBeenCalledWith({ kind: 'log', id: 'session-aaaa0000-today', title: '复核 Q3 选品清单', sub: '本机日志' })
  })

  it('the 日志 chip shows only logs; the badge counts live/total sessions', () => {
    const { box, badge } = render({ filter: 'logs' })
    expect([...box.querySelectorAll('.wb-dir-head-label')].map(text)).toEqual(['本机日志 · 3'])
    expect(badge).toBe('1/1')
  })

  it('learnLogTitle takes the first user line, trims it to 60 characters, persists it', () => {
    const titles = new Map<string, string>()
    const long = '帮'.repeat(80)
    expect(learnLogTitle(titles, 'id-1', [{ role: 'assistant', text: 'hi' }, { role: 'user', text: `${long}\nsecond line` }])).toBe(true)
    expect(titles.get('id-1')).toBe(`${'帮'.repeat(59)}…`)
    expect(learnLogTitle(titles, 'id-1', [{ role: 'user', text: `${long}\nother` }])).toBe(false) // unchanged
    expect(loadLogTitles().get('id-1')).toBe(`${'帮'.repeat(59)}…`)
    // Corrupt storage reads as empty, never throws.
    window.localStorage.setItem('dsh-a2a.logtitles', '{not json')
    expect(loadLogTitles().size).toBe(0)
  })
})

describe('台账 (wb-ledger)', () => {
  const state: StateBody = {
    tasks: [
      { taskId: 'direct-young001', team: 'dsh/11111111', startedAt: NOW - 5 * 60_000, status: 'pending', direction: 'outbound', receiptExpected: true, brief: '刚派的活' },
      { taskId: 'direct-in000001', team: 'dsh/11111111', peer: 'local:cargo/22222222', startedAt: NOW - 2 * HOUR, status: 'pending', direction: 'inbound', receiptExpected: true, brief: '对方来的请求' },
      { taskId: 'direct-free0001', team: 'dsh/99999999', startedAt: NOW - 10 * 60_000, status: 'pending', receiptExpected: false },
    ],
    tasksDead: [],
    tasksStaleCount: 2,
    archivedCount: 0,
  }
  function render(over: Partial<LedgerContext> = {}, s: StateBody = state) {
    const pane = document.createElement('div')
    document.body.appendChild(pane)
    const ctx: LedgerContext = {
      state: s, now: NOW, abandon: vi.fn(async () => true),
      canOpenTeam: (team) => team === 'dsh/11111111', openTeam: vi.fn(() => true), ...over,
    }
    return { pane, ctx, out: renderLedger(pane, ctx) }
  }

  it('groups our waiting sends, receipts we owe, and receiptless rows; inbound names its sender', () => {
    const { pane, out } = render()
    const groups = [...pane.querySelectorAll('.wb-led-group-head')].map(n => text(n).split(' · ')[0])
    expect(groups).toEqual(['待本机回执', '等待回执', '免回执'])
    const inbound = [...pane.querySelectorAll('.wb-led-card')].find(c => text(c).includes('对方来的请求'))!
    expect(inbound.querySelector('.wb-led-dir')!.classList.contains('is-in')).toBe(true)
    // The sender is the peer (local:<sender>); the team is this host's own (review L2).
    expect(text(inbound.querySelector('.wb-led-team'))).toBe('来自 cargo/22222222')
    expect(text(inbound.querySelector('.wb-led-to'))).toBe('至 dsh/11111111')
    expect(text(inbound)).toContain('入站')
    // A receipt WE owe is never "可催办".
    expect(text(pane.querySelector('.wb-led-group .wb-led-group-hint'))).toBe('对方在等本机回执 · 1 条超过 1 小时')
    // Owed = receipts still expected (2); receiptless rows owe nothing. The
    // 2h-old inbound row makes it amber.
    expect(out).toEqual({ badge: '2', tone: 'warn' })
  })

  it('a fire-forget expiry is bookkeeping, not a dead letter (review L1)', () => {
    const s: StateBody = { tasks: [], tasksDead: [{ taskId: 'direct-ff000001', team: 'dsh/99999999', peer: 'http://x', startedAt: NOW - 25 * HOUR, deadAt: NOW - HOUR, reason: 'fire-forget', brief: 'fyi only' }] }
    const { pane, out } = render({}, s)
    expect([...pane.querySelectorAll('.wb-led-group-head span:first-child')].map(n => text(n))).toEqual(['已过期（免回执） · 1'])
    expect(text([...pane.querySelectorAll('.wb-led-tile')].find(t => text(t).includes('死信'))!.querySelector('.wb-led-tile-v'))).toBe('0')
    expect(pane.querySelector('.wb-led-card.is-danger')).toBeNull()
    expect(out).toEqual({ badge: '', tone: undefined })
    // Moving it out is an optional tidy, never 清账.
    const btn = pane.querySelector('.wb-led-abandon')!
    expect([text(btn), btn.classList.contains('is-quiet')]).toEqual(['移出', true])
  })

  it('the 待回执 tile counts exactly the receipt-owed rows the groups show; receiptless ones owe nothing', () => {
    const { pane } = render()
    const tileV = text([...pane.querySelectorAll('.wb-led-tile')].find(t => text(t).includes('待回执'))!.querySelector('.wb-led-tile-v'))
    // fixture: 1 young outbound + 1 inbound expected, 1 receiptless
    expect(tileV).toBe('2')
    expect([...pane.querySelectorAll('.wb-led-tile')].find(t => text(t).includes('待回执'))!.getAttribute('title')).toContain('免回执 1 条不计')
  })

  it('an inbound dead letter keeps its direction from the peer prefix (review L2)', () => {
    const s: StateBody = { tasks: [], tasksDead: [{ taskId: 'direct-in000002', team: 'dsh/11111111', peer: 'local:cargo/22222222', startedAt: NOW - 25 * HOUR, deadAt: NOW - HOUR, reason: 'unconsumed', brief: '请核报价' }] }
    const { pane } = render({}, s)
    const c = pane.querySelector('.wb-led-card')!
    expect(text(c.querySelector('.wb-led-dir'))).toBe('↙')
    expect(text(c.querySelector('.wb-led-team'))).toBe('来自 cargo/22222222')
  })

  it('a dead letter reads its direction from the row (gh#31), the peer prefix only on older hosts', () => {
    const s: StateBody = { tasks: [], tasksDead: [{ taskId: 'direct-in000004', team: 'dsh/11111111', peer: 'http://192.168.3.157:13080', direction: 'inbound', startedAt: NOW - 25 * HOUR, deadAt: NOW - HOUR, reason: 'unconsumed', brief: '远端来的请求' }] }
    const { pane } = render({}, s)
    const c = pane.querySelector('.wb-led-card')!
    expect(text(c.querySelector('.wb-led-dir'))).toBe('↙')
    expect(text(c.querySelector('.wb-led-team'))).toBe('来自 对端')
    expect(text(c.querySelector('.wb-led-to'))).toBe('至 dsh/11111111')
  })

  it('cards name the session behind each team id; a peer-published name carries 远端; unknown ids stay ids', () => {
    const s: StateBody = {
      sessions: [{ id: 'session-1', label: 'l1', team: 'dsh/11111111', name: 'scout-01', live: true, joined: true }],
      remote: [{ team: 'cargo/22222222', name: 'scout-01' }],
      tasks: [
        { taskId: 'direct-nm000001', team: 'dsh/11111111', peer: 'local', startedAt: NOW - 60_000, status: 'pending', direction: 'outbound', receiptExpected: true, brief: '发给本机会话' },
        { taskId: 'direct-nm000002', team: 'dsh/11111111', peer: 'local:cargo/22222222', startedAt: NOW - 60_000, status: 'pending', direction: 'inbound', receiptExpected: true, brief: '对端来的' },
        { taskId: 'direct-nm000003', team: 'dsh/99999999', peer: 'local', startedAt: NOW - 60_000, status: 'pending', direction: 'outbound', receiptExpected: true, brief: '无名队' },
      ],
      tasksDead: [],
    }
    const { pane } = render({}, s)
    const card = (brief: string) => [...pane.querySelectorAll('.wb-led-card')].find(c => text(c).includes(brief))!
    expect(text(card('发给本机会话').querySelector('.wb-led-team'))).toBe('发往 scout-01')
    expect(card('发给本机会话').querySelector<HTMLElement>('.wb-led-team')!.title).toBe('dsh/11111111')
    // The peer that also calls itself scout-01 reads differently from the local one.
    const inbound = card('对端来的')
    expect(text(inbound.querySelector('.wb-led-team'))).toBe('来自 scout-01远端')
    expect(text(inbound.querySelector('.wb-led-to'))).toBe('至 scout-01')
    expect(text(card('无名队').querySelector('.wb-led-team'))).toBe('发往 dsh/99999999')
  })

  it('the 陈旧 tile counts exactly the stale rows shown, at the server ≥1h boundary (review L3)', () => {
    const s: StateBody = {
      tasks: [
        { taskId: 'direct-st000001', team: 'dsh/99999999', startedAt: NOW - HOUR, status: 'pending', direction: 'outbound', receiptExpected: true },
        { taskId: 'direct-rl000001', team: 'dsh/99999999', startedAt: NOW - 5 * 60_000, status: 'pending', direction: 'outbound', receiptExpected: false },
        { taskId: 'direct-rl000002', team: 'dsh/99999999', startedAt: NOW - 5 * 60_000, status: 'pending', direction: 'outbound', receiptExpected: false },
      ],
      tasksStaleCount: 3, // server count includes receiptless rows; the tab does not
      tasksDead: [],
    }
    const { pane } = render({}, s)
    const tileV = text([...pane.querySelectorAll('.wb-led-tile')].find(t => text(t).includes('陈旧'))!.querySelector('.wb-led-tile-v'))
    const group = [...pane.querySelectorAll('.wb-led-group-head span:first-child')].map(n => text(n)).find(h => h.startsWith('陈旧'))
    expect(tileV).toBe('1')
    expect(group).toBe('陈旧 · 1') // exactly 1h old is stale (≥1h)
  })

  it('an inbound row past its hour is owed overdue, never stale: tile, groups and header agree (review P3)', () => {
    const s: StateBody = {
      tasks: [{ taskId: 'direct-in000003', team: 'dsh/11111111', peer: 'local:cargo/22222222', startedAt: NOW - 2 * HOUR, status: 'pending', direction: 'inbound', receiptExpected: true, settleable: false }],
      tasksDead: [],
    }
    const { pane, out } = render({}, s)
    const tileV = text([...pane.querySelectorAll('.wb-led-tile')].find(t => text(t).includes('陈旧'))!.querySelector('.wb-led-tile-v'))
    const heads = [...pane.querySelectorAll('.wb-led-group-head span:first-child')].map(n => text(n))
    expect(tileV).toBe('0')
    expect(heads).toEqual(['待本机回执 · 1'])
    expect(text(pane.querySelector('.wb-led-group-hint'))).toBe('对方在等本机回执 · 1 条超过 1 小时')
    expect(out).toEqual({ badge: '1', tone: 'warn' })
    const facts = ledgerFacts(s, NOW)
    expect([facts.stale.length, facts.owedOverdue.length]).toEqual([0, 1])
  })

  it('the hour boundary follows the server’s settleable verdict over the browser clock', () => {
    // A browser clock 2h ahead of the host: by our clock both rows are old,
    // but the host still calls one settleable (young) — trust the host.
    const s: StateBody = {
      tasks: [
        { taskId: 'direct-sk000001', team: 'dsh/99999999', startedAt: NOW - 2 * HOUR, status: 'pending', direction: 'outbound', receiptExpected: true, settleable: true },
        { taskId: 'direct-sk000002', team: 'dsh/99999999', startedAt: NOW - 3 * HOUR, status: 'pending', direction: 'outbound', receiptExpected: true, settleable: false },
        // An older host without the field: the browser clock decides.
        { taskId: 'direct-sk000003', team: 'dsh/99999999', startedAt: NOW - 2 * HOUR, status: 'pending', direction: 'outbound', receiptExpected: true },
      ],
      tasksDead: [],
    }
    const { pane } = render({}, s)
    const byGroup = Object.fromEntries([...pane.querySelectorAll('.wb-led-group')].map(g => [
      text(g.querySelector('.wb-led-group-head span:first-child')).split(' · ')[0],
      [...g.querySelectorAll('.wb-led-task')].map(n => text(n)),
    ]))
    expect(byGroup['陈旧']).toEqual(['direct-sk000002', 'direct-sk000003'])
    expect(byGroup['等待回执']).toEqual(['direct-sk000001'])
  })

  it('a card opens its team’s conversation when the team resolves; otherwise it is not a link', () => {
    const { pane, ctx } = render()
    const young = [...pane.querySelectorAll('.wb-led-card')].find(c => text(c).includes('刚派的活')) as HTMLElement
    expect(young.getAttribute('role')).toBe('button')
    young.click()
    expect(ctx.openTeam).toHaveBeenCalledWith('dsh/11111111')
    young.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(ctx.openTeam).toHaveBeenCalledTimes(2)
    const free = [...pane.querySelectorAll('.wb-led-card')].find(c => text(c).includes('direct-free0001')) as HTMLElement
    expect(free.getAttribute('role')).toBeNull()
    expect(free.classList.contains('is-link')).toBe(false)
    expect(text(free.querySelector('.wb-led-brief'))).toContain('无摘要')
  })

  it('清账 on a dead card abandons without opening the conversation', async () => {
    const dead: StateBody = { ...state, tasks: [], tasksDead: [{ taskId: 'direct-dead0001', team: 'dsh/11111111', startedAt: NOW - 30 * HOUR, deadAt: NOW - HOUR, reason: 'unconsumed', brief: '死掉的' }] }
    const { pane, ctx, out } = render({}, dead)
    expect(out.tone).toBe('danger')
    const btn = pane.querySelector('.wb-led-abandon') as HTMLButtonElement
    btn.click()
    await vi.waitFor(() => expect(btn.textContent).toBe('已清'))
    expect(ctx.abandon).toHaveBeenCalledWith('direct-dead0001', 'workbench dead-letter cleanup')
    expect(ctx.openTeam).not.toHaveBeenCalled()
  })

  it('an empty ledger says so, and the badge goes quiet', () => {
    const { pane, out } = render({}, { tasks: [], tasksDead: [], archivedCount: 0 })
    expect(text(pane.querySelector('.wb-led-empty'))).toContain('台账为空')
    expect(out).toEqual({ badge: '', tone: undefined })
  })
})
