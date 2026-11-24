// @vitest-environment jsdom
/**
 * T8 deep link: the 团队 tab's 等你拍板 group. The market links to `?tab=team&view=decisions&card=<id>`; the card is decided
 * here through the same host route as the DSH right bar, and whether the person is the owner is the host's call alone.
 */
import { describe, expect, it, vi } from 'vitest'
import { ATTACH_MAX, STAGE_REUSE_MS, CARD_ID, cardOf, inputMet, recommendedNeedsInput, createDecisionsGroup, decisionLink, fileHref, oneClick, refusalText, type DecisionCard } from '../src/wb-decisions.ts'
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

describe('the owner\'s files on a decision (C8, as the right bar)', () => {
  const ADDRESS = 'dsh/canvas/ops'
  function mountFiles(stage = vi.fn(async (file: File, _address: string) => ({ ref: `[A2A file] v1 ${file.name}` }) as { ref: string } | { refused: string })) {
    const decide = vi.fn(async (_body: Record<string, unknown>) => ({ status: 200, body: { ok: true } as Record<string, unknown> }))
    let rows: unknown[] = [row({ address: ADDRESS, level: 'P2' })]
    const group = createDecisionsGroup({ list: async () => ({ decisions: rows }), decide, stage })
    document.body.replaceChildren(group.root)
    const card = (): HTMLElement => document.querySelector<HTMLElement>('[data-card="d-1"]')!
    const pick = (files: File[]): void => {
      const input = card().querySelector<HTMLInputElement>('.wb-sa-attach input[type=file]')!
      Object.defineProperty(input, 'files', { value: files, configurable: true })
      input.dispatchEvent(new Event('change'))
    }
    return { group, decide, stage, card, pick, setRows: (r: unknown[]) => { rows = r } }
  }
  const file = (name: string, size = 3): File => { const f = new File(['abc'], name); if (size !== 3) Object.defineProperty(f, 'size', { value: size }); return f }

  it('files picked for a decision are staged to the team\'s canvas first, then go with the decision as reference lines', async () => {
    const m = mountFiles()
    await m.group.refresh()
    m.pick([file('a.md'), file(`b${XSS}.txt`)])
    expect(m.card().querySelector('img')).toBeNull()
    expect(m.card().textContent).toContain(`b${XSS}.txt`)
    button(m.card(), '同意推荐').click()
    await flush()
    expect(m.stage.mock.calls.map(([f, address]) => [f.name, address])).toEqual([['a.md', ADDRESS], [`b${XSS}.txt`, ADDRESS]])
    expect(m.decide).toHaveBeenLastCalledWith({ id: 'd-1', teamId: 't2', how: 'approve', files: ['[A2A file] v1 a.md', `[A2A file] v1 b${XSS}.txt`] })
  })

  it('a file that will not stage stops the decision: nothing is sent, and the page says which file and why', async () => {
    const m = mountFiles(vi.fn(async (f: File) => f.name === 'bad.bin' ? { refused: 'the file channel is full' } : { ref: 'ok' }))
    await m.group.refresh()
    m.pick([file('good.md'), file('bad.bin')])
    button(m.card(), '同意推荐').click()
    await flush()
    expect(m.decide).not.toHaveBeenCalled()
    expect(m.card().querySelector('.wb-sa-decision-said')!.textContent).toBe('没有提交：文件「bad.bin」没有附上（the file channel is full）')
    // The files stay picked, so the owner can try again.
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(2)
  })

  it('at most 16 files and 64 MB each; a file already picked is picked once; one can be removed', async () => {
    const m = mountFiles()
    await m.group.refresh()
    m.pick([file('huge.iso', 64 * 1024 * 1024 + 1)])
    expect(m.card().querySelector('.wb-sa-decision-said')!.textContent).toContain('超过 64 MB')
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(0)
    const same = file('a.md')
    m.pick([same, same])
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(1)
    m.pick(Array.from({ length: ATTACH_MAX }, (_, i) => file(`f${String(i)}.md`)))
    expect(m.card().querySelector('.wb-sa-decision-said')!.textContent).toContain('最多附 16 个文件')
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(1)
    m.card().querySelector<HTMLButtonElement>('.wb-sa-attach-remove')!.click()
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(0)
  })

  it('picked files survive a poll, go once the decision is sent, and go with a card decided elsewhere', async () => {
    const m = mountFiles()
    await m.group.refresh()
    m.pick([file('a.md')])
    await m.group.refresh()
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(1)
    button(m.card(), '同意推荐').click()
    await flush()
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(0)
    m.pick([file('b.md')])
    m.setRows([])
    await m.group.refresh()
    m.setRows([row({ address: ADDRESS, level: 'P2' })])
    await m.group.refresh()
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(0)
  })

  it('#771 review (Z11): only a drag of files is taken — dragging text is left to the browser', async () => {
    const m = mountFiles()
    await m.group.refresh()
    const drag = (type: string, types: string[], files: File[] = []): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { types, files } })
      m.card().dispatchEvent(event)
      return event
    }
    expect(drag('dragover', ['text/plain']).defaultPrevented).toBe(false)
    expect(m.card().classList.contains('is-dragging')).toBe(false)
    expect(drag('drop', ['text/plain'], [file('sneaky.md')]).defaultPrevented).toBe(false)
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(0)
    expect(drag('dragover', ['Files']).defaultPrevented).toBe(true)
    drag('drop', ['Files'], [file('real.md')])
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(1)
  })

  it('#771 review: two different files that share a name and size are both kept; the same file again is kept once, and said', async () => {
    const m = mountFiles()
    await m.group.refresh()
    const older = new File(['aaa'], 'report.md', { lastModified: 1_000 })
    const newer = new File(['bbb'], 'report.md', { lastModified: 2_000 })
    m.pick([older, newer])
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(2)
    m.pick([newer])
    expect(m.card().querySelectorAll('.wb-sa-attach-file')).toHaveLength(2)
    expect(m.card().querySelector('.wb-sa-decision-said')!.textContent).toBe('已经附上过，没有重复添加：report.md')
  })

  it('#771 review: a decision the host refuses and the owner sends again reuses the files already staged', async () => {
    const stage = vi.fn(async (f: File) => ({ ref: `[A2A file] v1 ${f.name}` }) as { ref: string } | { refused: string })
    let answer: { status: number; body: Record<string, unknown> } = { status: 403, body: { ok: false, error: 'browser owner proof required' } }
    const decide = vi.fn(async (_body: Record<string, unknown>) => answer)
    const group = createDecisionsGroup({ list: async () => ({ decisions: [row({ address: ADDRESS, level: 'P2' })] }), decide, stage })
    document.body.replaceChildren(group.root)
    await group.refresh()
    const card = (): HTMLElement => document.querySelector<HTMLElement>('[data-card="d-1"]')!
    const input = card().querySelector<HTMLInputElement>('.wb-sa-attach input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file('a.md'), file('b.md')] })
    input.dispatchEvent(new Event('change'))
    button(card(), '同意推荐').click()
    await flush()
    expect(stage).toHaveBeenCalledTimes(2)
    answer = { status: 200, body: { ok: true } }
    button(card(), '同意推荐').click()
    await flush()
    expect(stage).toHaveBeenCalledTimes(2)
    expect(decide).toHaveBeenLastCalledWith({ id: 'd-1', teamId: 't2', how: 'approve', files: ['[A2A file] v1 a.md', '[A2A file] v1 b.md'] })
  })

  async function refusedOnce() {
    const stage = vi.fn(async (f: File) => ({ ref: `[A2A file] v1 ${f.name}` }) as { ref: string } | { refused: string })
    let answer: { status: number; body: Record<string, unknown> } = { status: 403, body: { ok: false, error: 'browser owner proof required' } }
    const decide = vi.fn(async (_body: Record<string, unknown>) => answer)
    const group = createDecisionsGroup({ list: async () => ({ decisions: [row({ address: ADDRESS, level: 'P2' })] }), decide, stage })
    document.body.replaceChildren(group.root)
    await group.refresh()
    const card = (): HTMLElement => document.querySelector<HTMLElement>('[data-card="d-1"]')!
    const input = card().querySelector<HTMLInputElement>('.wb-sa-attach input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file('a.md'), file('b.md')] })
    input.dispatchEvent(new Event('change'))
    button(card(), '同意推荐').click()
    await flush()
    expect(stage).toHaveBeenCalledTimes(2)
    answer = { status: 200, body: { ok: true } }
    return { stage, decide, card }
  }

  it('#773 review (A10): a file removed after staging is not sent with the retried decision', async () => {
    const m = await refusedOnce()
    const remove = Array.from(m.card().querySelectorAll<HTMLButtonElement>('.wb-sa-attach-remove')).find(b => b.getAttribute('aria-label') === '移除 b.md')!
    remove.click()
    button(m.card(), '同意推荐').click()
    await flush()
    expect(m.stage).toHaveBeenCalledTimes(2)
    expect(m.decide).toHaveBeenLastCalledWith({ id: 'd-1', teamId: 't2', how: 'approve', files: ['[A2A file] v1 a.md'] })
  })

  it('#773 review: a staged copy close to the channel\'s 24 hours is staged again, never reused', async () => {
    const real = Date.now
    let now = real()
    Date.now = () => now
    try {
      const m = await refusedOnce()
      now += STAGE_REUSE_MS - 1
      button(m.card(), '同意推荐').click()
      await flush()
      expect(m.stage).toHaveBeenCalledTimes(2)
      expect(STAGE_REUSE_MS).toBeLessThan(24 * 60 * 60_000)
    } finally { Date.now = real }
    now = real()
    Date.now = () => now
    try {
      const m = await refusedOnce()
      now += STAGE_REUSE_MS
      button(m.card(), '同意推荐').click()
      await flush()
      expect(m.stage).toHaveBeenCalledTimes(4)
      expect(m.decide).toHaveBeenLastCalledWith({ id: 'd-1', teamId: 't2', how: 'approve', files: ['[A2A file] v1 a.md', '[A2A file] v1 b.md'] })
    } finally { Date.now = real }
  })

  it('a card with no team address takes no files: the page says so and sends nothing', async () => {
    const decide = vi.fn(async () => ({ status: 200, body: { ok: true } as Record<string, unknown> }))
    const group = createDecisionsGroup({ list: async () => ({ decisions: [row({ level: 'P2' })] }), decide, stage: vi.fn(async () => ({ ref: 'r' })) })
    document.body.replaceChildren(group.root)
    await group.refresh()
    const card = document.querySelector<HTMLElement>('[data-card="d-1"]')!
    const input = card.querySelector<HTMLInputElement>('.wb-sa-attach input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file('a.md')] })
    input.dispatchEvent(new Event('change'))
    button(document.querySelector<HTMLElement>('[data-card="d-1"]')!, '同意推荐').click()
    await flush()
    expect(decide).not.toHaveBeenCalled()
    expect(document.querySelector('[data-card="d-1"] .wb-sa-decision-said')!.textContent).toContain('没有团队地址')
  })

  it('without a stage dependency there is no attach control', async () => {
    const m = mount(() => [row({ address: ADDRESS })])
    await m.group.refresh()
    expect(document.querySelector('.wb-sa-attach')).toBeNull()
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

describe('#888 D4: options that need the owner to fill something in', () => {
  const plain = (over: Record<string, unknown> = {}) => row({ level: 'P2', options: ['甲', '乙'], recommended: '甲', files: [], address: 'dsh/canvas/team', ...over })
  it('inputs are read as data: unknown options, kinds or prompts are dropped; a ticket card is listed only with inputs', () => {
    const card = cardOf(plain({ inputs: { 乙: { kind: 'text', prompt: '写原因' }, 丙: { kind: 'text', prompt: 'p' }, 甲: { kind: 'image', prompt: 'p' } } }))!
    expect(card.inputs).toEqual({ 乙: { kind: 'text', prompt: '写原因' } })
    expect(cardOf(plain({ inputs: [] }))!.inputs).toEqual({})
    expect(cardOf(plain({ source: 'ticket' }))).toBeUndefined()
    expect(cardOf(plain({ source: 'ticket', inputs: { 乙: { kind: 'file', prompt: 'p' } } }))).toBeDefined()
    expect(cardOf(plain({ source: 'health', inputs: { 乙: { kind: 'file', prompt: 'p' } } }))).toBeUndefined()
  })
  it('no one-click when the recommendation needs input', () => {
    const card = cardOf(plain({ inputs: { 甲: { kind: 'text', prompt: 'p' } } }))!
    expect(recommendedNeedsInput(card)).toBe(true)
    expect(oneClick(card)).toBe(false)
    expect(oneClick(cardOf(plain({ inputs: { 乙: { kind: 'text', prompt: 'p' } } }))!)).toBe(true)
  })
  it('marks the option with its prompt; confirming waits for the words', async () => {
    const m = mount(() => [plain({ inputs: { 乙: { kind: 'text', prompt: '写下原因' } } })])
    await m.group.refresh()
    const card = document.querySelector('[data-card="d-1"]')!
    expect(card.textContent).toContain('需你填写')
    expect(card.textContent).toContain('写下原因')
    const radio = Array.from(card.querySelectorAll<HTMLInputElement>('input[type=radio]'))[1]!
    radio.checked = true; radio.dispatchEvent(new Event('change'))
    const confirm = card.querySelector<HTMLButtonElement>('.wb-sa-confirm')!
    expect(confirm.disabled).toBe(true)
    const words = card.querySelector<HTMLTextAreaElement>('.wb-sa-decision-note')!
    words.value = '太贵'; words.dispatchEvent(new Event('input'))
    expect(confirm.disabled).toBe(false)
  })
  it('a file option this page cannot attach to says why', async () => {
    const m = mount(() => [plain({ inputs: { 乙: { kind: 'file', prompt: '附合同' } } })])
    await m.group.refresh()
    const card = document.querySelector('[data-card="d-1"]')!
    const radio = Array.from(card.querySelectorAll<HTMLInputElement>('input[type=radio]'))[1]!
    radio.checked = true; radio.dispatchEvent(new Event('change'))
    const why = card.querySelector<HTMLElement>('.wb-sa-input-why')!
    expect(why.hidden).toBe(false)
    expect(card.querySelector<HTMLButtonElement>('.wb-sa-confirm')!.disabled).toBe(true)
  })
  it('the count splits by whether the recommendation needs input', async () => {
    const m = mount(() => [plain({ id: 'a', inputs: { 甲: { kind: 'text', prompt: 'p' } } }), plain({ id: 'b' })])
    await m.group.refresh()
    expect(document.querySelector('.wb-led-group-hint')!.textContent).toBe('2（需填写 1 · 可直接定 1）')
  })
  it('inputMet: text needs words, file needs a file, text+file both', () => {
    const card = cardOf(plain({ options: ['a', 'b', 'c'], recommended: 'a', inputs: { a: { kind: 'text', prompt: 'p' }, b: { kind: 'file', prompt: 'p' }, c: { kind: 'text+file', prompt: 'p' } } }))!
    expect([inputMet(card, 'a', ' ', 1), inputMet(card, 'a', 'x', 0), inputMet(card, 'b', 'x', 0), inputMet(card, 'b', '', 1), inputMet(card, 'c', 'x', 0), inputMet(card, 'c', 'x', 1)]).toEqual([false, true, false, true, false, true])
  })
})

describe('#888 D5: a card the host took automatically', () => {
  it('says so, is not counted as waiting, and can still be decided', async () => {
    const plain = (over: Record<string, unknown> = {}) => row({ level: 'P3', options: ['甲', '乙'], recommended: '甲', files: [], ...over })
    const m = mount(() => [plain({ id: 'a', autoApproved: { at: '2026-11-24T10:30:00.000Z', minutes: 30 } }), plain({ id: 'b' })])
    await m.group.refresh()
    expect(document.querySelector('[data-card="a"] .wb-sa-auto-approved')?.textContent).toContain('不是你本人的决定')
    expect(document.querySelector('[data-card="b"] .wb-sa-auto-approved')).toBeNull()
    expect(m.group.waiting()).toBe(1)
    expect(document.querySelector('.wb-led-group-hint')!.textContent).toBe('1')
    expect(cardOf(plain({ autoApproved: { at: 1 } }))!.autoApproved).toBeUndefined()
  })
})
