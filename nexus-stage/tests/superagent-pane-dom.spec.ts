// @vitest-environment jsdom
/**
 * superagent design v4, PR-E: the 团队 tab. What needs a person comes first; the request box is the workbench Source;
 * tickets, the team (pinned keys included) and the settings follow. Records are data: textContent only.
 */
import { describe, expect, it, vi } from 'vitest'
import { createSuperagentPane, personTickets, problemsOf, stageLabel, type SaState, type SaTicket } from '../src/wb-superagent.ts'
import { createWorkbench } from '../src/workbench.ts'

const NOW = Date.parse('2026-11-07T12:00:00Z')
const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString()
const R = 'session-a0000000aaaa1111', M = 'session-b1111111bbbb2222', N = 'session-c2222222cccc3333'
const text = (n: Element | null | undefined): string => n?.textContent ?? ''

function ticket(id: string, over: Partial<SaTicket> = {}): SaTicket {
  return {
    id, title: `工单 ${id}`, createdAt: at(60), updatedAt: at(30),
    mandate: { strength: 'explicit', scope: '只改节点列表', basis: { via: 'addressed' }, actor: { source: 'workbench', id: 'owner' } },
    channels: [{ source: 'workbench', thread: `th-${id}` }], assignments: [], inputs: [], stage: { stage: 'working' }, ...over,
  }
}

function state(over: Partial<SaState> = {}): SaState {
  return {
    canvases: ['ops', 'other'],
    settings: { canvas: 'ops', router: R, members: [M], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [{ ref: 'bravo/dddddddd', key: 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwxyz0123456789', url: 'https://member.example.invalid' }] },
    policyVersion: 'p-1',
    a2a: { enabled: false, address: null, health: {} },
    executor: { bindings: [{ member: M, ticketId: 't-work', at: at(10) }] },
    threads: [{
      key: 'workbench:th-ask', ref: { source: 'workbench', id: 'th-ask' }, createdAt: at(50), lastAt: at(40), evaluating: null,
      triggers: [{ id: 'tr1', actor: { source: 'workbench', id: 'owner' }, at: at(50), text: '给节点列表加搜索框 <img src=x onerror=alert(1)>', disposition: null }],
      decisions: [{ id: 'd1', kind: 'accept', at: at(45), ticketId: 't-ask', reason: [{ code: 'text', values: { text: '属主明确提出' } }] }],
      replies: [{ message: { kind: 'acknowledgement', text: '收到，会加搜索框。' }, status: 'sent' }],
    }],
    tickets: [
      ticket('t-ask', { attention: { question: '搜索要不要支持拼音？' }, stage: { stage: 'person', action: 'answer' }, channels: [{ source: 'workbench', thread: 'th-ask' }] }),
      ticket('t-fail', { stage: { stage: 'person', action: 'failed' }, assignments: [{ id: 'a1', state: 'ended', report: { state: 'failed', summary: '构建挂了', at: at(5) } }] }),
      ticket('t-work', { stage: { stage: 'working' } }),
      ticket('t-queue', { stage: { stage: 'working', action: 'queued' } }),
      ticket('t-done', { stage: null, ended: { at: at(2), outcome: 'completed' } }),
    ],
    ...over,
  }
}
const sessions = [{ id: R, name: '总工', joined: true }, { id: M, name: '成员一', joined: true }, { id: N, name: '会话三', joined: true }]

function mount(act = vi.fn(async (_body: Record<string, unknown>) => ({ ok: true }))) {
  const refresh = vi.fn()
  const pane = createSuperagentPane({ act, refresh })
  document.body.replaceChildren(pane.root)
  return { pane, act, refresh }
}
const button = (root: Element, label: string): HTMLButtonElement => Array.from(root.querySelectorAll('button')).find(b => b.textContent === label)!
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('team tab helpers', () => {
  it('labels stages as a person reads them and finds what waits on a person', () => {
    const s = state()
    expect(s.tickets.map(stageLabel)).toEqual(['待你回答', '失败', '进行中', '排队等成员', '已结束 · completed'])
    expect(personTickets(s).map(t => t.id).sort()).toEqual(['t-ask', 't-fail'])
  })

  it('names the problems that block the team', () => {
    expect(problemsOf(state(), NOW)).toEqual([])
    const bad = state({ settings: { ...state().settings, router: undefined, members: [], remoteMembers: [], paused: true }, a2a: { enabled: true, address: null, health: { read: { state: 'error', detail: 'cli exited 1' } } } })
    expect(problemsOf(bad, NOW).map(p => p.text).join('\n')).toMatch(/还没有指定总工[\s\S]*成员池是空的[\s\S]*执行已暂停[\s\S]*cli exited 1/)
    // Design v5: unbound, or bound to a canvas that cannot run as the team.
    const { canvas: _bound, ...unbound } = state().settings
    expect(problemsOf(state({ settings: unbound }), NOW)[0]).toMatchObject({ tone: 'danger', text: expect.stringContaining('还没有绑定画布团队') })
    const sick = problemsOf(state({ health: [{ code: 'member-not-loaded', session: 'session-x' }, { code: 'ticket-quiet', title: '写文档', minutes: 90 }] }), NOW)
    expect(sick.map(p => p.tone)).toEqual(['danger', 'warn'])
    expect(sick[1]!.text).toContain('90 分钟没有动静')
    expect(problemsOf(state({ canvasProblem: 'the bound canvas team ops does not exist on this host' }), NOW)[0]).toMatchObject({ tone: 'danger', text: expect.stringContaining('画布团队「ops」不能作为团队运行') })
  })
})

describe('team tab', () => {
  it('opens on what needs a person: an answer box on the request thread, retry on a failed ticket; badge counts them', async () => {
    const { pane, act, refresh } = mount()
    const out = pane.update(state(), sessions, NOW)
    expect(out).toEqual({ badge: '2', tone: 'warn' })
    const cards = Array.from(pane.root.querySelectorAll<HTMLElement>('.wb-sa-ticket'))
    expect(cards.map(c => c.dataset.ticket)).toEqual(['t-ask', 't-fail'])
    expect(text(cards[0])).toContain('搜索要不要支持拼音？')
    const box = cards[0]!.querySelector('textarea')!
    box.value = '要支持'
    button(cards[0]!, '回答').click()
    await flush()
    expect(act).toHaveBeenCalledWith({ action: 'request', text: '要支持', thread: 'th-ask' })
    expect(refresh).toHaveBeenCalled()
    expect(box.value).toBe('')
    expect(text(cards[1])).toContain('构建挂了')
    button(cards[1]!, '重试').click()
    await flush()
    expect(act).toHaveBeenLastCalledWith({ action: 'retry', ticket_id: 't-fail' })
  })

  it('a question on a ticket an agent asked for is the owner\'s to answer here', async () => {
    const { pane, act } = mount()
    pane.update(state({ tickets: [ticket('t-bot', { attention: { question: '用哪种格式？' }, stage: { stage: 'person', action: 'answer' }, channels: [{ source: 'a2a', thread: 'a2a:ctx' }] })] }), sessions, NOW)
    const card = pane.root.querySelector<HTMLElement>('.wb-sa-ticket')!
    const box = card.querySelector('textarea')!
    box.value = '用 CSV'
    button(card, '回答').click()
    await flush()
    expect(act).toHaveBeenCalledWith({ action: 'answer', ticket_id: 't-bot', text: '用 CSV' })
    expect(box.value).toBe('')
  })

  it('the request box is the workbench Source; a thread shows the request, the decision and the reply as text', async () => {
    const { pane, act } = mount()
    pane.update(state(), sessions, NOW)
    pane.select('request')
    const thread = pane.root.querySelector<HTMLElement>('.wb-sa-thread')!
    expect(text(thread)).toContain('给节点列表加搜索框 <img src=x onerror=alert(1)>')
    expect(thread.querySelector('img')).toBeNull()
    expect(text(thread)).toContain('总工：接单 · 属主明确提出 · t-ask')
    expect(text(thread)).toContain('收到，会加搜索框。')
    const ask = pane.root.querySelector<HTMLTextAreaElement>('.wb-sa-form textarea')!
    ask.value = '再加一个导出按钮'
    button(pane.root, '提交需求').click()
    await flush()
    expect(act).toHaveBeenCalledWith({ action: 'request', text: '再加一个导出按钮' })
  })

  it('a turned-down request offers 重新判断 once; an accepted one or one being judged does not', async () => {
    const { pane, act } = mount()
    const thread = (over: Record<string, unknown>) => ({ key: 'workbench:th-no', ref: { source: 'workbench', id: 'th-no' }, createdAt: at(30), lastAt: at(20), evaluating: null,
      triggers: [{ id: 'tr-no', actor: { source: 'workbench', id: 'owner' }, at: at(30), text: '把导出按钮做了', disposition: null }],
      decisions: [{ id: 'd-no', kind: 'ignore', at: at(25), triggerIds: ['tr-no'], reason: [{ code: 'said', values: { text: '不在规则内' } }] }], replies: [], ...over })
    pane.update(state({ threads: [thread({}), ...state().threads] } as never), sessions, NOW)
    pane.select('request')
    const card = pane.root.querySelector<HTMLElement>('.wb-sa-thread[data-thread="th-no"]')!
    const again = Array.from(card.querySelectorAll('button')).find(b => b.textContent === '重新判断')!
    expect(again).toBeDefined()
    again.click()
    await flush()
    expect(act).toHaveBeenCalledWith({ action: 'reevaluate', trigger_id: 'tr-no' })
    expect(again.disabled).toBe(true)
    // The accepted thread has no such button; nor does a thread the router is judging right now.
    const accepted = pane.root.querySelector<HTMLElement>('.wb-sa-thread[data-thread="th-ask"]')!
    expect(Array.from(accepted.querySelectorAll('button')).some(b => b.textContent === '重新判断')).toBe(false)
    pane.update(state({ threads: [thread({ evaluating: { id: 'e', triggerIds: ['tr-no'] } })] } as never), sessions, NOW + 120_000)
    pane.select('request')
    expect(Array.from(pane.root.querySelectorAll('button')).some(b => b.textContent === '重新判断')).toBe(false)
  })

  it('a refused write is said, and the input is kept', async () => {
    const { pane } = mount(vi.fn(async () => ({ ok: false, error: 'workbench Source is off' })))
    pane.update(state(), sessions, NOW)
    pane.select('request')
    const ask = pane.root.querySelector<HTMLTextAreaElement>('.wb-sa-form textarea')!
    ask.value = '一个需求'
    button(pane.root, '提交需求').click()
    await flush()
    expect(text(pane.root.querySelector('.wb-sa-note'))).toContain('workbench Source is off')
    expect(ask.value).toBe('一个需求')
  })

  it('tickets by stage; stop asks first', async () => {
    const { pane, act } = mount()
    pane.update(state(), sessions, NOW)
    pane.select('tickets')
    const heads = Array.from(pane.root.querySelectorAll('.wb-led-group-head')).map(h => text(h.firstElementChild))
    expect(heads).toEqual(['待你处理', '进行中', '已结束（最近 20）'])
    const work = pane.root.querySelector<HTMLElement>('[data-ticket="t-work"]')!
    expect(text(work)).toContain('成员一')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    button(work, '停止').click()
    await flush()
    expect(act).not.toHaveBeenCalled()
    button(work, '停止').click()
    await flush()
    expect(act).toHaveBeenCalledWith({ action: 'stop', ticket_id: 't-work', reason: '属主在工作台停止' })
    confirm.mockRestore()
    expect(pane.root.querySelector('[data-ticket="t-done"] button')).toBeNull()
  })

  it('the team page shows the router, each member\'s slot, remote members with their pinned key, and the queue', () => {
    const { pane } = mount()
    pane.update(state(), sessions, NOW)
    pane.select('team')
    const t = text(pane.root)
    expect(t).toContain('总工（a0000000）')
    expect(t).toContain('在做「工单 t-work」')
    expect(t).toContain('bravo/dddddddd')
    expect(t).toContain('MCowBQYDK2Vw…')
    expect(t).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(t).toContain('工单 t-queue')
    // Design v5 (D4): the team this host serves shows its canvas id.
    pane.update({ ...state(), settings: { ...state().settings, serves: { url: 'https://team.example.invalid', key: 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwxyz0123456789', members: [M], team: 'alpha/canvas/team@0123abcd' } } }, sessions, NOW + 61_000)
    expect(text(pane.root)).toContain('alpha/canvas/team@0123abcd')
  })

  describe('several teams', () => {
    const teams = [{ id: '', canvas: 'ops' }, { id: 'aaaaaaaa', canvas: 'docs' }]
    const open = () => {
      const selectTeam = vi.fn(), addTeam = vi.fn(async () => ({ ok: true, id: 'bbbbbbbb' }))
      const pane = createSuperagentPane({ act: vi.fn(async () => ({ ok: true })), refresh: vi.fn(), selectTeam, addTeam })
      document.body.replaceChildren(pane.root)
      pane.update({ ...state(), teams, selectedTeam: 'aaaaaaaa', canvases: ['ops', 'docs', 'new'] }, sessions, NOW)
      return { pane, selectTeam, addTeam, picker: pane.root.querySelector<HTMLSelectElement>('[aria-label="当前团队"]')! }
    }
    it('lists the teams, shows the current one, and switches', () => {
      const { picker, selectTeam } = open()
      expect(Array.from(picker.options).map(o => o.text)).toEqual(['ops', 'docs'])
      expect(picker.value).toBe('aaaaaaaa')
      picker.value = ''
      picker.dispatchEvent(new Event('change'))
      expect(selectTeam).toHaveBeenCalledWith('')
    })
    it('offers only canvases no team holds, adds the team, and switches to it', async () => {
      const { pane, selectTeam, addTeam } = open()
      button(pane.root, '新增团队').click()
      const canvas = pane.root.querySelector<HTMLSelectElement>('[aria-label="新团队的画布"]')!
      expect(Array.from(canvas.options).map(o => o.value)).toEqual(['', 'new'])
      const router = pane.root.querySelector<HTMLSelectElement>('[aria-label="新团队的总工"]')!
      canvas.value = 'new'
      router.value = router.options[1]!.value
      button(pane.root, '添加').click()
      await flush()
      expect(addTeam).toHaveBeenCalledWith('new', router.value)
      expect(selectTeam).toHaveBeenCalledWith('bbbbbbbb')
    })
    const editSettings = (pane: ReturnType<typeof open>['pane']) => {
      pane.select('settings')
      const mode = pane.root.querySelector<HTMLSelectElement>('select[aria-label="接单模式"]')!
      mode.value = 'auto'
      mode.dispatchEvent(new Event('change'))
    }
    const toPrimary = (picker: HTMLSelectElement) => { picker.value = ''; picker.dispatchEvent(new Event('change')) }

    it('keeps unsaved settings when the person declines to switch', () => {
      const { pane, picker, selectTeam } = open()
      editSettings(pane)
      vi.stubGlobal('confirm', () => false)
      toPrimary(picker)
      vi.unstubAllGlobals()
      expect(selectTeam).not.toHaveBeenCalled()
      expect(picker.value).toBe('aaaaaaaa')
      expect(pane.root.querySelector<HTMLSelectElement>('select[aria-label="接单模式"]')!.value).toBe('auto')
    })

    it('drops unsaved settings on a switch, so they cannot be saved to the other team', () => {
      const { pane, picker, selectTeam } = open()
      editSettings(pane)
      vi.stubGlobal('confirm', () => true)
      toPrimary(picker)
      vi.unstubAllGlobals()
      expect(selectTeam).toHaveBeenCalledWith('')
      expect(pane.root.querySelector('select[aria-label="接单模式"]')).toBeNull()
      pane.update({ ...state(), teams, selectedTeam: '', canvases: ['ops', 'docs', 'new'] }, sessions, NOW)
      expect(pane.root.querySelector<HTMLSelectElement>('select[aria-label="接单模式"]')!.value).toBe('observe')
    })

    it('ignores the old team\'s state arriving after a switch', () => {
      const { pane, picker } = open()
      pane.select('settings')
      toPrimary(picker)
      pane.update({ ...state(), teams, selectedTeam: 'aaaaaaaa', canvases: [] }, sessions, NOW)
      expect(pane.root.querySelector('select[aria-label="接单模式"]')).toBeNull()
    })

    it('asks for both, and shows a refusal', async () => {
      const { pane, addTeam } = open()
      button(pane.root, '新增团队').click()
      button(pane.root, '添加').click()
      expect(addTeam).not.toHaveBeenCalled()
      expect(pane.root.querySelector('[role=status]')!.textContent).toContain('先选')
      addTeam.mockResolvedValueOnce({ ok: false, error: 'router must be a local session' } as never)
      const canvas = pane.root.querySelector<HTMLSelectElement>('[aria-label="新团队的画布"]')!, router = pane.root.querySelector<HTMLSelectElement>('[aria-label="新团队的总工"]')!
      canvas.value = 'new'; router.value = router.options[1]!.value
      button(pane.root, '添加').click()
      await flush()
      expect(pane.root.querySelector('[role=status]')!.textContent).toContain('router must be')
    })
  })

  it('settings bind a canvas team and name its router (members come from the canvas); an open form survives the poll', async () => {
    const { pane, act } = mount()
    pane.update(state(), sessions, NOW)
    pane.select('settings')
    const router = pane.root.querySelector<HTMLSelectElement>('select[aria-label="总工"]')!
    expect(router.value).toBe(R)
    const canvas = pane.root.querySelector<HTMLSelectElement>('select[aria-label="画布团队"]')!
    expect(canvas.value).toBe('ops')
    expect(Array.from(canvas.options).map(o => o.value)).toEqual(['', 'ops', 'other'])
    // Members are shown from the canvas, not edited here.
    expect(pane.root.querySelectorAll('.wb-sa-check input')).toHaveLength(0)
    expect(text(pane.root)).toContain('成员（来自画布）')
    canvas.value = 'other'
    canvas.dispatchEvent(new Event('change'))
    // A poll while the form is dirty does not reset it.
    pane.update(state(), sessions, NOW + 3000)
    expect(pane.root.querySelector<HTMLSelectElement>('select[aria-label="画布团队"]')!.value).toBe('other')
    button(pane.root, '保存').click()
    await flush()
    expect(act).toHaveBeenCalledWith({ action: 'settings', settings: { canvas: 'other', router: R, acceptMode: 'observe', sources: { workbench: true, a2a: false }, paused: false } })
  })

  describe('the settings that are lists', () => {
    const q = <T extends Element>(root: Element, label: string): T => root.querySelector<T>(`[aria-label="${label}"]`)!
    const type = (box: HTMLInputElement | HTMLTextAreaElement, value: string): void => { box.value = value; box.dispatchEvent(new Event('input')) }
    const open = (settings: Record<string, unknown> = {}) => {
      const m = mount()
      m.pane.update({ ...state(), settings: { ...state().settings, ...settings } }, sessions, NOW)
      m.pane.select('settings')
      return m
    }
    const sent = (act: ReturnType<typeof vi.fn>): Record<string, unknown> => act.mock.calls.at(-1)![0].settings

    it('shows what is set, and a save without edits writes none of them', async () => {
      const { pane, act } = open({ rules: [{ name: 'docs', text: '核对文档', enabled: false }], bots: { a2a: ['bot/1'] }, allowed: { github: ['Owner'] }, reviewer: 'dsh/aaaaaaaa', repos: { [M]: 'o/net' } })
      expect(q<HTMLInputElement>(pane.root, '规则名称').value).toBe('docs')
      expect(q<HTMLTextAreaElement>(pane.root, '规则内容').value).toBe('核对文档')
      expect(q<HTMLInputElement>(pane.root, '启用规则').checked).toBe(false)
      expect(q<HTMLTextAreaElement>(pane.root, '允许发需求的机器').value).toBe('bot/1')
      expect(q<HTMLTextAreaElement>(pane.root, '算人的 GitHub 账号').value).toBe('Owner')
      expect(q<HTMLInputElement>(pane.root, '送审地址').value).toBe('dsh/aaaaaaaa')
      button(pane.root, '保存').click()
      await flush()
      const written = sent(act)
      for (const key of ['rules', 'bots', 'allowed', 'reviewer', 'repos']) expect(written).not.toHaveProperty(key)
    })

    it('writes what was edited: a rule, the lists, a repository, the review address', async () => {
      const { pane, act } = open()
      button(pane.root, '添加规则').click()
      type(q<HTMLTextAreaElement>(pane.root, '规则内容'), '  以 [ops] 开头的文档核对  ')
      type(q<HTMLTextAreaElement>(pane.root, '允许发需求的机器'), 'bot/1\nbot/2, bot/1')
      type(q<HTMLTextAreaElement>(pane.root, '算人的 GitHub 账号'), 'Owner')
      type(pane.root.querySelector<HTMLInputElement>(`[aria-label$="的仓库"]`)!, 'o/net')
      type(q<HTMLInputElement>(pane.root, '送审地址'), 'dsh/aaaaaaaa')
      button(pane.root, '保存').click()
      await flush()
      expect(sent(act)).toMatchObject({
        rules: [{ name: 'rule-1', text: '以 [ops] 开头的文档核对', enabled: true }], bots: { a2a: ['bot/1', 'bot/2'] }, allowed: { github: ['Owner'] }, repos: { [M]: 'o/net' }, reviewer: 'dsh/aaaaaaaa',
      })
    })

    it('clears a review address and removes a rule', async () => {
      const { pane, act } = open({ rules: [{ name: 'docs', text: '核对文档', enabled: true }], reviewer: 'dsh/aaaaaaaa' })
      button(pane.root, '删除').click()
      type(q<HTMLInputElement>(pane.root, '送审地址'), '')
      button(pane.root, '保存').click()
      await flush()
      expect(sent(act)).toMatchObject({ rules: [], reviewer: null })
    })

    it('edits a member\'s role and rules and the dispatch rules; an untouched profile is not rewritten', async () => {
      const { pane, act } = open({ profiles: { [M]: { role: '写文档', rules: [{ name: 'docs', text: '文档类', enabled: true }] } }, dispatch: '看角色' })
      expect(q<HTMLTextAreaElement>(pane.root, '派单规则').value).toBe('看角色')
      expect(pane.root.querySelector<HTMLInputElement>('[aria-label$="的角色"]')!.value).toBe('写文档')
      button(pane.root, '保存').click()
      await flush()
      expect(sent(act)).not.toHaveProperty('profiles')
      expect(sent(act)).not.toHaveProperty('dispatch')
      type(pane.root.querySelector<HTMLInputElement>('[aria-label$="的角色"]')!, '写代码')
      type(q<HTMLTextAreaElement>(pane.root, '派单规则'), '看仓库')
      button(pane.root, '保存').click()
      await flush()
      expect(sent(act)).toMatchObject({ profiles: { [M]: { role: '写代码', rules: [{ name: 'docs', text: '文档类', enabled: true }] } }, dispatch: '看仓库' })
    })

    it('the team page says which member is the observer and which ticket it opened', () => {
      const m = mount()
      const base = state()
      m.pane.update({ ...base, settings: { ...base.settings, observers: [M] }, tickets: [ticket('t1', { mandate: { strength: 'explicit', scope: 's', basis: { via: 'listed' }, actor: { source: 'workbench', id: `observer:${M}` } } })] }, sessions, NOW)
      m.pane.select('team')
      expect(text(m.pane.root)).toContain('观察者')
      m.pane.select('tickets')
      expect(text(m.pane.root)).toContain('观察者开单')
    })

    it('the team page shows each member\'s role and rules, the team\'s rules, and pending and last changes', () => {
      const m = mount()
      const base = state()
      m.pane.update({ ...base, settings: { ...base.settings, rules: [{ name: 'ops', text: '核对文档', enabled: true }], dispatch: '看角色', profiles: { [M]: { role: '写文档', rules: [{ name: 'docs', text: '文档类', enabled: true }] } } },
        ruleChanges: { pending: { [`member:${M}`]: { at: at(1), by: M, reason: '想收窄', value: { role: '只写中文文档', rules: [] } } }, last: { team: { at: at(5), by: R, message: '同意' } } } }, sessions, NOW)
      m.pane.select('team')
      const page = text(m.pane.root)
      for (const words of ['写文档', '文档类', '核对文档', '看角色', '待你确认的修改', '想收窄', '只写中文文档', '最近修改', '同意']) expect(page).toContain(words)
    })

    it('an edit survives the poll', () => {
      const { pane } = open()
      button(pane.root, '添加规则').click()
      type(q<HTMLTextAreaElement>(pane.root, '规则内容'), '写到一半')
      pane.update(state(), sessions, NOW + 3000)
      expect(q<HTMLTextAreaElement>(pane.root, '规则内容').value).toBe('写到一半')
    })

    it.each([
      ['a bad name', (root: Element) => { button(root, '添加规则').click(); type(q(root, '规则名称'), 'Bad Name'); type(q(root, '规则内容'), 'x') }, '只能用小写字母'],
      ['an empty rule', (root: Element) => { button(root, '添加规则').click() }, '还没有写内容'],
      ['a repository without an owner', (root: Element) => { type(root.querySelector<HTMLInputElement>('[aria-label$="的仓库"]')!, 'net') }, 'owner/name'],
    ])('says what is wrong and sends nothing: %s', async (_name, edit, words) => {
      const { pane, act } = open()
      edit(pane.root)
      button(pane.root, '保存').click()
      await flush()
      expect(act).not.toHaveBeenCalled()
      expect(text(pane.root)).toContain(words)
    })
  })

  it('in the workbench the tab shows only while the host answers a superagent state', () => {
    const bench = createWorkbench({
      now: () => NOW, abandon: async () => true, canvasOp: async () => true, copy: () => {},
      superagent: { act: async () => ({ ok: true }), refresh: () => {} },
    } as never)
    document.body.replaceChildren(bench.root)
    const tab = bench.root.querySelector<HTMLElement>('#wb-tab-team')!
    expect(tab.hidden || tab.classList.contains('is-hidden') || tab.style.display === 'none').toBe(true)
    bench.update({ sessions } as never)
    bench.updateSuperagent(state())
    const pane = bench.root.querySelector<HTMLElement>('.wb-sa')!
    expect(pane.classList.contains('is-hidden')).toBe(false)
    bench.updateSuperagent(null)
    expect(pane.classList.contains('is-hidden')).toBe(true)
  })
})

describe('the poll leaves the view alone unless it changed (0.8.0 live test: a 停止 click was lost to the 3 s rebuild)', () => {
  it('says it is reading before the first poll, and that there is no team once the host says so', () => {
    const { pane } = mount()
    expect(text(pane.root)).toContain('正在读取团队状态…')
    pane.update(null, sessions, NOW)
    expect(text(pane.root)).toContain('这台主机没有运行 superagent 团队')
  })

  it('an unchanged poll keeps the same buttons; a change or a minute rebuilds them', () => {
    const { pane } = mount()
    pane.update(state(), sessions, NOW)
    const stop = button(pane.root, '停止')
    pane.update(state(), sessions, NOW + 3_000)
    expect(button(pane.root, '停止')).toBe(stop)
    // The A2A Source's heartbeat stamp moves on every read round; the view does not show it.
    pane.update(state({ a2a: { enabled: true, address: null, health: { a2a: { state: 'ready', detail: 'ok', at: at(0) } as never } } }), sessions, NOW + 4_000)
    pane.update(state({ a2a: { enabled: true, address: null, health: { a2a: { state: 'ready', detail: 'ok', at: at(-1) } as never } } }), sessions, NOW + 5_000)
    const steady = button(pane.root, '停止')
    pane.update(state({ a2a: { enabled: true, address: null, health: { a2a: { state: 'ready', detail: 'ok', at: at(-2) } as never } } }), sessions, NOW + 5_500)
    expect(button(pane.root, '停止')).toBe(steady)
    pane.update(state({ policyVersion: 'p-2' }), sessions, NOW + 6_000)
    expect(button(pane.root, '停止')).not.toBe(stop)
    const again = button(pane.root, '停止')
    pane.update(state({ policyVersion: 'p-2' }), sessions, NOW + 6_000 + 60_000)
    expect(button(pane.root, '停止')).not.toBe(again)
  })

  it('a press in progress is never rebuilt away; the next poll after it lands catches up', () => {
    const { pane } = mount()
    pane.update(state(), sessions, NOW)
    const stop = button(pane.root, '停止')
    stop.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    pane.update(state({ policyVersion: 'p-2' }), sessions, NOW + 3_000)
    expect(button(pane.root, '停止')).toBe(stop)
    document.dispatchEvent(new Event('pointerup'))
    pane.update(state({ policyVersion: 'p-2' }), sessions, NOW + 6_000)
    expect(button(pane.root, '停止')).not.toBe(stop)
  })

  it('a button reached by keyboard keeps its place; one clicked with the mouse does not hold the view', () => {
    const { pane } = mount()
    pane.update(state(), sessions, NOW)
    const stop = button(pane.root, '停止')
    stop.focus()
    const matches = vi.spyOn(stop, 'matches').mockImplementation(sel => sel === ':focus-visible')
    pane.update(state({ policyVersion: 'p-2' }), sessions, NOW + 3_000)
    expect(button(pane.root, '停止')).toBe(stop)
    matches.mockImplementation(() => false)
    pane.update(state({ policyVersion: 'p-3' }), sessions, NOW + 6_000)
    expect(button(pane.root, '停止')).not.toBe(stop)
  })
})

describe('ops loop: the team view shows each member\'s repository', () => {
  it('lists the repository on the member card when the settings name one', () => {
    const { pane } = mount()
    const s = state()
    pane.update({ ...s, settings: { ...s.settings, repos: { [M]: 'NelsonLongxiang/agent-atelier' } } }, sessions, NOW)
    pane.select('team')
    expect(text(pane.root)).toContain('仓库NelsonLongxiang/agent-atelier')
    pane.update(s, sessions, NOW + 1_000)
    expect(text(pane.root)).not.toContain('仓库')
  })
})
