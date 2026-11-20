// @vitest-environment jsdom
/**
 * T8 deep link: the 团队 tab's 等你拍板 group. The market links to `?tab=team&view=decisions&card=<id>`; the card is decided
 * here through the same host route as the DSH right bar, and whether the person is the owner is the host's call alone.
 */
import { describe, expect, it, vi } from 'vitest'
import { CARD_ID, cardOf, createDecisionsGroup, decisionLink, fileHref, oneClick, refusalText, type DecisionCard } from '../src/wb-decisions.ts'
import { createSuperagentPane } from '../src/wb-superagent.ts'

const XSS = '<img src=x onerror="window.__pwned=1">'
const SHA = 'a'.repeat(64)
const row = (over: Record<string, unknown> = {}) => ({ id: 'd-1', teamId: 't2', team: 'ops', question: `用哪个？${XSS}`, level: 'P1', options: ['甲', `乙${XSS}`], recommended: '甲', reason: `因为${XSS}`, source: 'observer', files: [{ sha256: SHA, size: 2048, name: `报告${XSS}.md` }], ...over })
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const button = (root: Element, text: string): HTMLButtonElement => Array.from(root.querySelectorAll('button')).find(b => (b.textContent ?? '').startsWith(text))!

function mount(rows: () => unknown[], decide = vi.fn(async (_body: Record<string, unknown>) => ({ status: 200, body: { ok: true } as Record<string, unknown> }))) {
  const list = vi.fn(async () => ({ decisions: rows() }))
  const group = createDecisionsGroup({ list, decide })
  document.body.replaceChildren(group.root)
  return { group, list, decide }
}

describe('the deep link: only tab, view and a card id that fits the rule', () => {
  it('reads tab=team, view=decisions and the card; anything else is ignored', () => {
    expect(decisionLink('?tab=team&view=decisions&card=d-1')).toBe('d-1')
    expect(decisionLink('?card=ticket%3Aabc.1&view=decisions&tab=team&mode=plan&x=<b>')).toBe('ticket:abc.1')
    expect(decisionLink('?tab=team&view=tickets&card=d-1')).toBeUndefined()
    expect(decisionLink('?tab=ledger&view=decisions&card=d-1')).toBeUndefined()
    expect(decisionLink('?tab=team&view=decisions')).toBeUndefined()
  })
  it('a card id outside the rule is refused: no markup, no path, no query, nothing over 64', () => {
    for (const bad of ['<img>', '../../owner-settings', 'a/b', 'a?b=1', 'a&b', 'd 1', '"x"', 'x'.repeat(65), '']) {
      expect(decisionLink(`?tab=team&view=decisions&card=${encodeURIComponent(bad)}`), bad).toBeUndefined()
      expect(CARD_ID.test(bad)).toBe(false)
    }
  })
})

describe('the 等你拍板 group', () => {
  it('every text on a card is text: question, reason, options and file names never become markup', async () => {
    const m = mount(() => [row()])
    await m.group.refresh()
    expect(document.querySelector('img')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    const card = document.querySelector('[data-card="d-1"]')!
    expect(card.textContent).toContain(`用哪个？${XSS}`)
    expect(card.textContent).toContain(`因为${XSS}`)
    expect(card.textContent).toContain(`乙${XSS}`)
    expect(card.textContent).toContain(`报告${XSS}.md`)
  })

  it('a file is fetched with every part of its address encoded, and a digest that is not one is dropped', () => {
    const card = cardOf(row({ id: 'ticket:a.b', teamId: 'team&x=1' }))!
    expect(fileHref(card, SHA)).toBe(`/__dsh_a2a/superagent/decisions/file?card=ticket%3Aa.b&sha256=${SHA}&teamId=team%26x%3D1`)
    expect(cardOf(row({ files: [{ sha256: '../x', size: 1, name: 'a' }] }))!.files).toEqual([])
  })

  it('P0/P1 need an option or written words; P2/P3 with a recommendation approve in one click; the body names the card and team', async () => {
    const m = mount(() => [row(), row({ id: 'd-2', level: 'P2', question: '小事' })])
    await m.group.refresh()
    const p1 = document.querySelector<HTMLElement>('[data-card="d-1"]')!
    const confirm = p1.querySelector<HTMLButtonElement>('.wb-sa-confirm')!
    expect(confirm.disabled).toBe(true)
    expect(p1.querySelector('.wb-sa-approve')).toBeNull()
    expect(oneClick(cardOf(row())!)).toBe(false)
    const second = p1.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!
    second.checked = true
    second.dispatchEvent(new Event('change'))
    expect(p1.querySelector<HTMLButtonElement>('.wb-sa-confirm')!.disabled).toBe(false)
    p1.querySelector<HTMLButtonElement>('.wb-sa-confirm')!.click()
    await flush()
    expect(m.decide).toHaveBeenLastCalledWith({ id: 'd-1', teamId: 't2', how: 'choose', option: `乙${XSS}` })
    const p2 = document.querySelector<HTMLElement>('[data-card="d-2"]')!
    button(p2, '同意推荐').click()
    await flush()
    expect(m.decide).toHaveBeenLastCalledWith({ id: 'd-2', teamId: 't2', how: 'approve' })
  })

  it('#1: nothing here decides who the owner is — the host refuses a non-owner, and the page says so as the host said it', async () => {
    const decide = vi.fn(async () => ({ status: 403, body: { ok: false, error: 'browser owner proof required' } as Record<string, unknown> }))
    const m = mount(() => [row({ level: 'P3' })], decide)
    await m.group.refresh()
    // The buttons are there for anyone: the page makes no owner judgement of its own.
    const card = document.querySelector<HTMLElement>('[data-card="d-1"]')!
    button(card, '同意推荐').click()
    await flush()
    expect(decide).toHaveBeenCalledTimes(1)
    const said = document.querySelector('[data-card="d-1"] .wb-sa-decision-said')!.textContent
    expect(said).toContain('只有在浏览器里登录的属主能拍板')
    expect(said).toContain('browser owner proof required')
    expect(document.querySelector('[data-card="d-1"]')).not.toBeNull()
  })

  it('#4: a card already decided in the right bar is gone after the next read, and the deep link says it was handled', async () => {
    let rows: unknown[] = [row()]
    const m = mount(() => rows)
    await m.group.refresh()
    expect(m.group.waiting()).toBe(1)
    rows = []
    await m.group.refresh()
    expect(document.querySelector('[data-card="d-1"]')).toBeNull()
    expect(m.group.waiting()).toBe(0)
    m.group.focus('d-1')
    await flush()
    expect(document.querySelector('.wb-sa-decisions-notice')!.textContent).toBe('这张卡已经处理了，或者不在这台机器上')
  })

  it('#4: a press on a card decided elsewhere in the meantime gets the host\'s stale answer, shown, and no second submit', async () => {
    let rows: unknown[] = [row({ level: 'P2' })]
    const decide = vi.fn(async () => { rows = []; return { status: 200, body: { ok: false, code: 'stale', error: 'that decision is no longer waiting' } as Record<string, unknown> } })
    const m = mount(() => rows, decide)
    await m.group.refresh()
    button(document.querySelector<HTMLElement>('[data-card="d-1"]')!, '同意推荐').click()
    await flush()
    expect(refusalText(200, { code: 'stale' })).toContain('已经处理了')
    expect(decide).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-card="d-1"]')).toBeNull()
    expect(document.querySelector('.wb-sa-decisions-notice')!.textContent).toContain('已经处理了')
  })

  it('the deep-linked card is scrolled to and flashed once the cards are read', async () => {
    const m = mount(() => [row(), row({ id: 'd-2' })])
    m.group.focus('d-2')
    await flush()
    expect(document.querySelector('[data-card="d-2"]')!.classList.contains('is-flash')).toBe(true)
    expect(document.querySelector('[data-card="d-1"]')!.classList.contains('is-flash')).toBe(false)
    m.group.focus('<img src=x>')
    await flush()
    expect(document.querySelector('img')).toBeNull()
  })

  it('a pick and words being written survive a poll that brings the same cards', async () => {
    const m = mount(() => [row()])
    await m.group.refresh()
    const box = document.querySelector<HTMLTextAreaElement>('.wb-sa-decision-note')!
    box.value = '我的决定'
    box.dispatchEvent(new Event('input'))
    await m.group.refresh()
    expect(document.querySelector<HTMLTextAreaElement>('.wb-sa-decision-note')!.value).toBe('我的决定')
  })
})

describe('#769 review follow-ups', () => {
  it('only the router\'s and the observer\'s cards are listed — a member\'s ticket question and the host\'s own cards are not', async () => {
    const m = mount(() => [row({ id: 'r-1', source: 'router' }), row({ id: 'o-1', source: 'observer' }), row({ id: 'ticket:t-ask', source: 'ticket' }), row({ id: 'h-1', source: 'health' }), row({ id: 'x-1', source: 'tool' }), row({ id: 'n-1', source: undefined })])
    await m.group.refresh()
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-card]')).map(n => n.dataset.card)).toEqual(['r-1', 'o-1'])
    expect(m.group.waiting()).toBe(2)
  })

  it('a read that fails says why instead of reading forever; a later good read clears it; a failed refresh keeps the cards', async () => {
    let fail: string | undefined = 'HTTP 503'
    const list = vi.fn(async () => { if (fail !== undefined) throw new Error(fail); return { decisions: [row()] } })
    const group = createDecisionsGroup({ list, decide: vi.fn(async () => ({ status: 200, body: { ok: true } })) })
    document.body.replaceChildren(group.root)
    await group.refresh()
    expect(group.root.textContent).toContain('读不到等你拍板的卡：HTTP 503')
    expect(group.root.textContent).not.toContain('正在读取')
    fail = undefined
    await group.refresh()
    expect(group.root.querySelector('.wb-sa-decisions-failed')).toBeNull()
    expect(group.root.querySelector('[data-card="d-1"]')).not.toBeNull()
    fail = 'network down'
    await group.refresh()
    expect(group.root.querySelector('.wb-sa-decisions-failed')!.textContent).toContain('刷新失败，下面是上次读到的卡：network down')
    expect(group.root.querySelector('[data-card="d-1"]')).not.toBeNull()
  })

  it('the 团队 badge counts a member\'s question once: on its ticket, not again as a card', async () => {
    const list = vi.fn(async () => ({ decisions: [row({ id: 'ticket:t-ask', source: 'ticket' }), row({ id: 'o-1', source: 'observer' })] }))
    const pane = createSuperagentPane({ act: vi.fn(async () => ({ ok: true })), refresh: vi.fn(), decisions: { list, decide: vi.fn(async () => ({ status: 200, body: { ok: true } })) } })
    document.body.replaceChildren(pane.root)
    const state = { canvases: ['ops'], settings: { canvas: 'ops', router: 'session-r', members: ['session-m'], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [] }, policyVersion: 'p', a2a: { enabled: false, address: null, health: {} }, executor: { bindings: [] }, threads: [],
      tickets: [{ id: 't-ask', title: '问一下', createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', mandate: { strength: 'explicit', scope: 's', basis: { via: 'addressed' }, actor: { source: 'workbench', id: 'owner' } }, channels: [], assignments: [], inputs: [], attention: { question: '用哪个？' }, stage: { stage: 'person', action: 'answer' } }] } as never
    const sessions = [{ id: 'session-r', name: '总工', joined: true }, { id: 'session-m', name: '成员', joined: true }]
    pane.update(state, sessions, Date.now())
    await flush()
    // One ticket waiting on the person, one observer card: two, not three.
    expect(pane.update(state, sessions, Date.now()).badge).toBe('2')
  })
})

describe('in the 团队 tab', () => {
  it('focusDecision opens 待你处理 with the group, and the poll reads the cards', async () => {
    const list = vi.fn(async () => ({ decisions: [row()] }))
    const pane = createSuperagentPane({ act: vi.fn(async () => ({ ok: true })), refresh: vi.fn(), decisions: { list, decide: vi.fn(async () => ({ status: 200, body: { ok: true } })) } })
    document.body.replaceChildren(pane.root)
    pane.select('tickets')
    pane.update({ canvases: ['ops'], settings: { canvas: 'ops', members: [], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [] }, policyVersion: 'p', a2a: { enabled: false, address: null, health: {} }, executor: { bindings: [] }, threads: [], tickets: [] } as never, [], Date.now())
    pane.focusDecision('d-1')
    await flush()
    expect(list).toHaveBeenCalled()
    expect(pane.root.querySelector('[data-group="decisions"]')).not.toBeNull()
    expect(pane.root.querySelector('[data-card="d-1"]')!.classList.contains('is-flash')).toBe(true)
  })
})

export type { DecisionCard }
