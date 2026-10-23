// @vitest-environment jsdom
/**
 * The rewritten chat drawer (wb-chat, 2026-10-23), driven directly:
 * conversation shown by default with line breaks kept, sends echoed as
 * bubbles that track their receipt through the ledger (发送中 → 已派发 →
 * 待回执 → 已结算 / 死信), owed ledger rows visible after a reload, a refused
 * send handed back to the composer, and a poll that never rebuilds the
 * composer or repaints an unchanged thread.
 */
import { describe, expect, it, vi } from 'vitest'
import { createChatDrawer, type ChatDrawerDeps } from '../src/wb-chat.ts'
import type { StateBody } from '../src/workbench.ts'

const NOW = 1_800_000_000_000
const TEAM = 'dsh/11111111'
const session = { kind: 'session' as const, id: 'session-11111111-aaaa', title: 'scout-01', sub: TEAM, team: TEAM, live: true }
const baseState: StateBody = {
  sessions: [{ id: session.id, label: 'dsh-host-x-11111111', team: TEAM, name: 'scout-01', live: true, joined: true }],
  tasks: [],
  tasksDead: [],
}

function drawer(over: Partial<ChatDrawerDeps> = {}) {
  let resolveSend: ((v: { ok: boolean; task_id?: string; error?: string }) => void) | undefined
  const dispatchQuick = vi.fn((_team: string, _message: string) => new Promise<{ ok: boolean; task_id?: string; error?: string }>(r => { resolveSend = r }))
  const sessionLog = vi.fn(async () => ({ ok: true, messages: [
    { role: 'user', text: '列出户外低毛利 SKU' },
    { role: 'assistant', text: '户外：\n1. 帐篷\n2. 睡袋' },
  ] }))
  const d = createChatDrawer({ now: () => NOW, sessionLog, dispatchQuick, ...over })
  document.body.appendChild(d.root)
  return { d, dispatchQuick, sessionLog, resolve: (v: { ok: boolean; task_id?: string; error?: string }) => resolveSend?.(v) }
}

const q = <T extends Element = HTMLElement>(root: Element, sel: string) => root.querySelector(sel) as T
const statuses = (root: Element) => [...root.querySelectorAll('.wb-chat-sent .wb-msg-status')].map(n => n.textContent)

function send(root: Element, message: string): void {
  const area = q<HTMLTextAreaElement>(root, '.wb-dispatch-text')
  area.value = message
  area.dispatchEvent(new Event('input'))
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

describe('chat drawer (wb-chat)', () => {
  it('shows the conversation by default as bubbles, keeping line breaks, text only', async () => {
    const { d } = drawer({ sessionLog: vi.fn(async () => ({ ok: true, messages: [
      { role: 'user', text: '<img src=x onerror=alert(1)>' },
      { role: 'assistant', text: '户外：\n1. 帐篷\n2. 睡袋' },
    ] })) })
    d.update(baseState)
    d.open(session)
    await vi.waitFor(() => expect(d.root.querySelectorAll('.wb-chat-log .wb-msg').length).toBe(2))
    const texts = [...d.root.querySelectorAll('.wb-chat-log .wb-msg-text')].map(n => n.textContent)
    expect(texts[1]).toBe('户外：\n1. 帐篷\n2. 睡袋')
    expect(texts[0]).toBe('<img src=x onerror=alert(1)>')
    expect(d.root.querySelectorAll('img').length).toBe(0)
    expect(q(d.root, '.wb-chat-info').hidden).toBe(true)
  })

  it('echoes a send and tracks it: 发送中 → 已派发 → 待回执 → 已离开台账', async () => {
    const { d, dispatchQuick, resolve } = drawer()
    d.update(baseState)
    d.open(session)
    send(d.root, '再拉晨光的历史报价')
    expect(dispatchQuick).toHaveBeenCalledWith(TEAM, '再拉晨光的历史报价')
    expect(q<HTMLTextAreaElement>(d.root, '.wb-dispatch-text').value).toBe('')
    expect(statuses(d.root)).toEqual(['发送中…'])
    expect(q(d.root, '.wb-chat-sent .wb-msg-text').textContent).toBe('再拉晨光的历史报价')
    resolve({ ok: true, task_id: 'direct-12345678' })
    await vi.waitFor(() => expect(statuses(d.root)).toEqual(['已派发']))
    expect(q(d.root, '.wb-msg-task').textContent).toBe('direct-12345678')
    // The ledger picks it up as pending, then it leaves the ledger. /state has
    // no per-task outcome (settled, abandoned and cancelled all archive), so
    // the drawer claims only that it left (review C3, PR #28).
    d.update({ ...baseState, tasks: [{ taskId: 'direct-12345678', team: TEAM, startedAt: NOW - 5_000, status: 'pending', direction: 'outbound', receiptExpected: true }] })
    expect(statuses(d.root)).toEqual(['待回执 · pending'])
    d.update(baseState)
    expect(statuses(d.root)).toEqual(['已离开台账'])
    expect(q(d.root, '.wb-msg-status').title).toContain('放弃或撤回')
    // Only one bubble: the ledger row and the local echo are the same message.
    expect(d.root.querySelectorAll('.wb-chat-sent .wb-msg').length).toBe(1)
  })

  it('a dead-lettered send turns red', async () => {
    const { d, resolve } = drawer()
    d.update(baseState)
    d.open(session)
    send(d.root, 'ping')
    resolve({ ok: true, task_id: 'direct-dead0001' })
    await vi.waitFor(() => expect(statuses(d.root)).toEqual(['已派发']))
    d.update({ ...baseState, tasksDead: [{ taskId: 'direct-dead0001', team: TEAM, startedAt: NOW - 90_000_000, deadAt: NOW - 1_000, reason: 'stale TTL' }] })
    expect(statuses(d.root)).toEqual(['死信'])
    expect(q(d.root, '.wb-msg-status').classList.contains('is-danger')).toBe(true)
  })

  it('after a reload, ledger rows still owed by this team show by their brief; old ones read 陈旧', () => {
    const { d } = drawer()
    d.update({ ...baseState, tasks: [
      { taskId: 'direct-old00001', team: TEAM, startedAt: NOW - 2 * 3_600_000, status: 'working', brief: '复核 Q3 选品清单' },
      { taskId: 'direct-new00002', team: TEAM, startedAt: NOW - 60_000, status: 'pending' },
      { taskId: 'direct-other003', team: 'dsh/99999999', startedAt: NOW - 60_000, status: 'pending', brief: '别的队' },
    ] })
    d.open(session)
    const bubbles = [...d.root.querySelectorAll('.wb-chat-sent .wb-msg-text')].map(n => n.textContent)
    expect(bubbles).toEqual(['复核 Q3 选品清单', '（无摘要）'])
    expect(statuses(d.root)).toEqual(['陈旧 · working', '待回执 · pending'])
    expect(q(d.root, '.wb-msg-status').classList.contains('is-warn')).toBe(true)
  })

  it('an inbound delivery to this session sits on their side, owed by us (review C1)', () => {
    const { d } = drawer()
    d.update({ ...baseState, tasks: [{ taskId: 'direct-aaaa0001', team: TEAM, peer: 'peer/22222222', startedAt: NOW - 30_000, status: 'pending', direction: 'inbound', receiptExpected: true, brief: '请帮我核一下晨光报价' }] })
    d.open(session)
    const b = q(d.root, '.wb-chat-sent .wb-msg')
    expect(b.classList.contains('wb-msg-in')).toBe(true)
    expect(b.classList.contains('wb-msg-out')).toBe(false)
    expect(q(b, '.wb-msg-who').textContent).toBe('对方')
    expect(q(b, '.wb-msg-text').textContent).toBe('请帮我核一下晨光报价')
    expect(statuses(d.root)).toEqual(['待本机回执 · pending'])
    // Once it dead-letters (/state dead rows carry no direction), the learned
    // direction keeps it on their side.
    d.update({ ...baseState, tasksDead: [{ taskId: 'direct-aaaa0001', team: TEAM, startedAt: NOW - 25 * 3_600_000, deadAt: NOW, reason: 'unconsumed', brief: '请帮我核一下晨光报价' }] })
    expect(q(d.root, '.wb-chat-sent .wb-msg').classList.contains('wb-msg-in')).toBe(true)
  })

  it('a dead row of unknown direction is a neutral ledger line, never our words', () => {
    const { d } = drawer()
    d.update({ ...baseState, tasksDead: [{ taskId: 'direct-unk00001', team: TEAM, startedAt: NOW - 25 * 3_600_000, deadAt: NOW, reason: 'unconsumed', brief: '谁说的？' }] })
    d.open(session)
    const b = q(d.root, '.wb-chat-sent .wb-msg')
    expect(b.classList.contains('wb-msg-ledger')).toBe(true)
    expect(q(b, '.wb-msg-who').textContent).toBe('台账记录')
    expect(statuses(d.root)).toEqual(['死信'])
  })

  it('a receiptless send never waits for a receipt, and its expiry is not a dead letter (review C2)', () => {
    const { d } = drawer()
    d.update({ ...baseState, tasks: [{ taskId: 'direct-bbbb0001', team: TEAM, peer: 'local', startedAt: NOW - 30_000, status: 'pending', direction: 'outbound', receiptExpected: false, brief: 'fire and forget' }] })
    d.open(session)
    expect(statuses(d.root)).toEqual(['已送达 · 无回执'])
    d.update({ ...baseState, tasksDead: [{ taskId: 'direct-bbbb0001', team: TEAM, peer: 'local', startedAt: NOW - 25 * 3_600_000, deadAt: NOW, reason: 'fire-forget', brief: 'fire and forget' }] })
    expect(statuses(d.root)).toEqual(['已过期（免回执）'])
    expect(q(d.root, '.wb-msg-status').classList.contains('is-muted')).toBe(true)
    expect(q(d.root, '.wb-chat-sent .wb-msg').classList.contains('wb-msg-out')).toBe(true)
  })

  it('a refused send hands the text back to the composer and says why', async () => {
    const { d, resolve } = drawer()
    d.update(baseState)
    d.open(session)
    send(d.root, '跨网消息')
    resolve({ ok: false, error: 'team not linked' })
    await vi.waitFor(() => expect(statuses(d.root)).toEqual(['失败：team not linked']))
    expect(q<HTMLTextAreaElement>(d.root, '.wb-dispatch-text').value).toBe('跨网消息')
    const note = q(d.root, '.wb-dispatch-note')
    expect(note.textContent).toContain('失败：team not linked')
    expect(note.classList.contains('is-error')).toBe(true)
  })

  it('a poll rebuilds neither the composer nor an unchanged thread', async () => {
    const { d } = drawer()
    d.update(baseState)
    d.open(session)
    await vi.waitFor(() => expect(d.root.querySelectorAll('.wb-chat-log .wb-msg').length).toBe(2))
    const area = q<HTMLTextAreaElement>(d.root, '.wb-dispatch-text')
    expect(document.activeElement).toBe(area)
    const firstBubble = q(d.root, '.wb-chat-log .wb-msg')
    d.update({ ...baseState, sessions: [...baseState.sessions!] })
    expect(q(d.root, '.wb-dispatch-text')).toBe(area)
    expect(document.activeElement).toBe(area)
    expect(q(d.root, '.wb-chat-log .wb-msg')).toBe(firstBubble)
    // A title change on the poll reaches the head in place.
    d.update({ ...baseState, sessions: [{ ...baseState.sessions![0]!, name: 'scout-renamed', live: false }] })
    expect(q(d.root, '.wb-chat-title').textContent).toBe('scout-renamed')
    expect(q(d.root, '.wb-chat-dot').classList.contains('is-cold')).toBe(true)
  })

  it('blocks sends over the 4000-character limit and shows the count', () => {
    const { d, dispatchQuick } = drawer()
    d.update(baseState)
    d.open(session)
    const area = q<HTMLTextAreaElement>(d.root, '.wb-dispatch-text')
    area.value = 'x'.repeat(4001)
    area.dispatchEvent(new Event('input'))
    expect(q<HTMLButtonElement>(d.root, '.wb-dispatch-submit').disabled).toBe(true)
    expect(q(d.root, '.wb-dispatch-note').textContent).toBe('4001/4000')
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(dispatchQuick).not.toHaveBeenCalled()
  })

  it('read-only targets get a footer instead of a composer; the info panel toggles', () => {
    const { d } = drawer({ remoteSessionLog: vi.fn(async () => ({ ok: true, sessions: [] })) })
    d.update(baseState)
    d.open({ kind: 'log', id: 'session-99998888-archived', title: '…98888-archived', sub: '档案' })
    expect(d.root.querySelector('.wb-dispatch-form')).toBeNull()
    expect(q(d.root, '.wb-chat-readonly').textContent).toContain('只读日志')
    d.open({ kind: 'peer', id: 'peer-10.0.0.5:8787', title: 'http://10.0.0.5:8787', sub: '10.0.0.5:8787', url: 'http://10.0.0.5:8787' })
    expect(q(d.root, '.wb-chat-readonly').textContent).toContain('对端主机')
    const btn = q(d.root, '.wb-chat-info-btn')
    btn.click()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(q(d.root, '.wb-chat-info').hidden).toBe(false)
    expect(q(d.root, '.wb-chat-info').textContent).toContain('http://10.0.0.5:8787')
  })
})
