/**
 * The 团队 tab (superagent design v4, PR-E): the team's work as a person sees it, from GET /__dsh_a2a/superagent.
 *
 * Page order follows upstream dsh-superagent's panel: what needs a person comes first, then the person's requests and
 * their threads, the tickets, the team, and the settings.
 *   待你处理  tickets waiting on a person (answer, review, blocked/failed, failed delivery) and the team's problems;
 *   提需求    the workbench Source: a request box, and each request's thread (messages, decisions, replies), with a
 *             follow-up box per thread;
 *   工单      every ticket by stage, with its mandate, assignee, latest report, and stop / retry;
 *   团队      the router, the member pool with each member's slot, remote members and the team this host serves, with the
 *             keys pinned for them, and the A2A address;
 *   设置      router, members, accept mode, the A2A Source, pause (a partial settings write; pins have their own actions).
 * Records are attacker-shaped data (requests and reports come from people and agents): textContent only.
 * Inputs (request, follow-ups, answers, the settings form) are built once and survive the poll.
 * @module nexus-stage/wb-superagent
 */
import type { RailTone } from './wb-rail'

type Json = Record<string, unknown>

export interface SaTrigger { readonly id: string; readonly actor: { source: string; id: string }; readonly at: string; readonly text: string; readonly disposition: unknown }
export interface SaDecision { readonly id: string; readonly kind: string; readonly at: string; readonly ticketId?: string; readonly triggerIds?: readonly string[]; readonly reason?: ReadonlyArray<{ code?: string; text?: string; values?: Record<string, string> }> | string }
export interface SaReply { readonly message: { kind: string; text: string }; readonly status: string; readonly reason?: string }
export interface SaThread {
  readonly key: string; readonly ref: { source: string; id: string }; readonly createdAt: string; readonly lastAt: string | null
  readonly evaluating: { id: string; deadline: string } | null
  readonly triggers: readonly SaTrigger[]; readonly decisions: readonly SaDecision[]; readonly replies: readonly SaReply[]
}
export interface SaAssignment { readonly id: string; readonly state: string; readonly report?: { state: string; summary: string; at: string } }
export interface SaTicket {
  readonly id: string; readonly title: string; readonly createdAt: string; readonly updatedAt: string
  readonly mandate: { strength: string; scope: string; basis: { via: string }; actor: { source: string; id: string } }
  readonly channels: ReadonlyArray<{ source: string; thread: string }>
  readonly ended?: { at: string; outcome: string; reason?: string }
  readonly attention?: { question: string }
  readonly delivery?: { error: string; at: string }
  readonly assignments: readonly SaAssignment[]
  readonly inputs: readonly unknown[]
  readonly stage: { stage: string; action?: string } | null
}
export interface SaSettings {
  /** Design v5: the canvas team that is the team (absent until the owner binds one). */
  readonly canvas?: string
  readonly router?: string; readonly members: readonly string[]; readonly acceptMode: string; readonly paused: boolean
  readonly sources: { workbench: boolean; a2a: boolean }
  readonly remoteMembers: ReadonlyArray<{ ref: string; key: string; url: string }>
  /** The repository each member works in (owner/name), by member; absent on hosts before it. */
  readonly repos?: Readonly<Record<string, string>>
  readonly serves?: { url: string; key: string; members: readonly string[]; team?: string }
}
export interface SaState {
  readonly settings: SaSettings; readonly policyVersion: string
  /** Design v5: why the bound canvas cannot run as the team, and the canvas teams this host owns (to bind one). */
  readonly canvasProblem?: string
  /** v5 acceptance F4: why a session this host serves another team with cannot take work (wrong preset). */
  readonly servesProblem?: string
  readonly canvases?: readonly string[]
  readonly a2a: { enabled: boolean; address: string | null; health: Record<string, { state: string; detail?: string }> }
  readonly executor: { bindings: ReadonlyArray<{ member: string; ticketId: string; at: string }> }
  readonly error?: string
  readonly threads: readonly SaThread[]; readonly tickets: readonly SaTicket[]
}
/** A local session the pickers offer (the workbench's /state rows). */
export interface SaSession { readonly id: string; readonly name?: string; readonly joined?: boolean }

export interface SuperagentPaneDeps {
  /** POST /__dsh_a2a/superagent. */
  act(body: Json): Promise<Json>
  /** Re-read the state after a write (the next poll otherwise). */
  refresh(): void
}

export type SaView = 'person' | 'request' | 'tickets' | 'team' | 'settings'
const VIEWS: ReadonlyArray<{ key: SaView; label: string }> = [
  { key: 'person', label: '待你处理' }, { key: 'request', label: '提需求' }, { key: 'tickets', label: '工单' },
  { key: 'team', label: '团队' }, { key: 'settings', label: '设置' },
]

const PERSON_ACTION: Readonly<Record<string, string>> = { answer: '待你回答', review: '待你查看结果', blocked: '受阻', failed: '失败', delivery: '投递失败' }

/** One line for a ticket's stage, as a person reads it. */
export function stageLabel(ticket: SaTicket): string {
  if (ticket.ended !== undefined) return `已结束 · ${ticket.ended.outcome}`
  const s = ticket.stage
  if (s === null) return '已结束'
  if (s.stage === 'person') return PERSON_ACTION[s.action ?? ''] ?? '待你处理'
  if (s.stage === 'working') return s.action === 'queued' ? '排队等成员' : '进行中'
  if (s.stage === 'idle') return '等待中'
  return s.stage
}

export interface SaProblem { readonly text: string; readonly tone: 'danger' | 'warn' }

/** The team's problems a person must fix (upstream overview "problems"). */
export function problemsOf(state: SaState, now: number): SaProblem[] {
  const out: SaProblem[] = []
  if (state.error !== undefined) out.push({ tone: 'danger', text: `团队记录读不出来，写入已停止：${state.error}` })
  if (state.settings.canvas === undefined) out.push({ tone: 'danger', text: '团队还没有绑定画布团队：先在画布上建队（总工 + 成员），再到「设置」里绑定' })
  else if (state.canvasProblem !== undefined) out.push({ tone: 'danger', text: `画布团队「${state.settings.canvas}」不能作为团队运行：${state.canvasProblem}` })
  if (state.servesProblem !== undefined) out.push({ tone: 'danger', text: `本机为别的团队服务的会话不能接活：${state.servesProblem}` })
  if (state.settings.router === undefined) out.push({ tone: 'danger', text: '还没有指定总工：需求会停在候选里，没人决定（到「设置」里选）' })
  if (state.settings.members.length === 0 && state.settings.remoteMembers.length === 0) out.push({ tone: 'warn', text: '成员池是空的：在画布团队里加成员，接下的工单才有人做' })
  if (state.settings.paused) out.push({ tone: 'warn', text: '执行已暂停：新工单不会派给成员' })
  for (const [entry, health] of Object.entries(state.a2a.health)) if (health.state === 'error') out.push({ tone: 'danger', text: `A2A Source（${entry}）出错：${health.detail ?? ''}` })
  for (const thread of state.threads) {
    if (thread.evaluating !== null && Date.parse(thread.evaluating.deadline) < now) out.push({ tone: 'warn', text: `「${firstText(thread)}」等总工决定已超时` })
    for (const reply of thread.replies) if (reply.status === 'dropped') out.push({ tone: 'warn', text: `回复没能送达：${reply.reason ?? reply.message.text}` })
  }
  return out
}

/** Open tickets waiting on a person, oldest change first. */
export function personTickets(state: SaState): SaTicket[] {
  return state.tickets.filter(t => t.ended === undefined && t.stage?.stage === 'person').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

/** The workbench thread a person answers a ticket on, if the ticket came from one. */
export function workbenchThreadOf(ticket: SaTicket): string | undefined {
  return ticket.channels.find(c => c.source === 'workbench')?.thread
}

function firstText(thread: SaThread): string {
  const text = thread.triggers[0]?.text ?? thread.ref.id
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function latestReport(ticket: SaTicket): { state: string; summary: string } | undefined {
  for (let i = ticket.assignments.length - 1; i >= 0; i--) { const r = ticket.assignments[i]!.report; if (r !== undefined) return r }
  return undefined
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function kv(parent: HTMLElement, k: string, v: string): void {
  const row = el('div', 'wb-kv')
  row.append(el('span', 'wb-kv-k', k), el('span', 'wb-kv-v', v))
  parent.appendChild(row)
}

function fingerprint(key: string): string { return key.length > 16 ? `${key.slice(0, 12)}…` : key }

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return iso
  if (s < 90) return `${s}s 前`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m 前`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h 前` : `${Math.round(h / 24)}d 前`
}

export interface SuperagentPane {
  readonly root: HTMLElement
  /** Feed one poll: the team's state (null when the host runs no superagent) and the local sessions. */
  update(state: SaState | null, sessions: readonly SaSession[], now: number): { badge: string; tone?: RailTone }
  select(view: SaView): void
}

export function createSuperagentPane(deps: SuperagentPaneDeps): SuperagentPane {
  const root = el('section', 'wb-pane wb-sa')
  const nav = el('div', 'wb-filters wb-sa-nav')
  nav.setAttribute('role', 'tablist')
  nav.setAttribute('aria-label', '团队视图')
  const body = el('div', 'wb-sa-body')
  const note = el('div', 'wb-sa-note')
  note.setAttribute('role', 'status')
  // On the stage (data mode) the panes stack: the heading says whose this is.
  root.append(el('div', 'wb-pane-head', 'superagent 团队'), nav, note, body)

  let view: SaView = 'person'
  // undefined until the first poll answers; null once it says this host runs no team.
  let last: SaState | null | undefined = undefined
  let sessions: readonly SaSession[] = []
  let now = Date.now()
  /** What the view was last built from, and when: an unchanged poll leaves the view (and its buttons) alone. */
  let builtFrom = ''
  let builtAt = 0
  /** A press in progress inside the pane: a rebuild between pointerdown and click would swallow the click. */
  let pressing = false
  const navButtons = new Map<SaView, HTMLButtonElement>()
  for (const def of VIEWS) {
    const b = el('button', 'wb-filter', def.label)
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.dataset.view = def.key
    b.addEventListener('click', () => { select(def.key) })
    navButtons.set(def.key, b)
    nav.appendChild(b)
  }

  // Inputs that survive the poll.
  const requestBox = el('textarea', 'wb-sa-input')
  requestBox.rows = 3
  requestBox.placeholder = '向团队提一个需求：说清楚要什么、范围多大'
  requestBox.setAttribute('aria-label', '需求内容')
  const requestSend = el('button', 'wb-btn wb-btn-primary', '提交需求')
  requestSend.type = 'button'
  requestSend.addEventListener('click', () => { void send({ action: 'request', text: requestBox.value }, () => { requestBox.value = '' }, '需求已提交，等总工决定') })
  /** Follow-up / answer drafts by thread id. */
  const drafts = new Map<string, HTMLTextAreaElement>()
  const draftFor = (thread: string, placeholder: string): HTMLTextAreaElement => {
    let box = drafts.get(thread)
    if (box === undefined) { box = el('textarea', 'wb-sa-input'); box.rows = 2; drafts.set(thread, box) }
    box.placeholder = placeholder
    return box
  }
  let settingsForm: HTMLElement | undefined
  let settingsDirty = false

  function say(text: string, tone?: 'danger'): void {
    note.textContent = text
    note.classList.toggle('is-danger', tone === 'danger')
  }

  async function send(body: Json, done?: () => void, okText = '已提交'): Promise<boolean> {
    try {
      const result = await deps.act(body)
      if (result.ok === true) { done?.(); say(okText); deps.refresh(); return true }
      say(`没有成功：${String(result.error ?? result.code ?? '未知原因')}`, 'danger')
    } catch (error) { say(`没有成功：${String(error)}`, 'danger') }
    return false
  }

  function sessionName(id: string): string {
    const row = sessions.find(s => s.id === id)
    return row?.name !== undefined && row.name !== '' ? `${row.name}（${id.replace(/^session-/, '').slice(0, 8)}）` : id
  }

  function ticketCard(ticket: SaTicket, opts: { answer?: boolean } = {}): HTMLElement {
    const person = ticket.stage?.stage === 'person'
    const card = el('div', `wb-led-card wb-sa-ticket${person ? ' is-warn' : ''}${ticket.ended !== undefined ? ' is-muted' : ''}`)
    card.dataset.ticket = ticket.id
    const head = el('div', 'wb-sa-ticket-head')
    head.append(el('strong', 'wb-sa-title', ticket.title), el('span', 'wb-sa-stage', stageLabel(ticket)))
    card.appendChild(head)
    kv(card, '范围', ticket.mandate.scope)
    kv(card, '授权', `${ticket.mandate.strength === 'explicit' ? '明确请求' : '推断'} · ${ticket.mandate.actor.source}:${ticket.mandate.actor.id}`)
    const binding = last?.executor.bindings.find(b => b.ticketId === ticket.id)
    if (binding !== undefined) kv(card, '成员', sessionName(binding.member))
    if (ticket.attention !== undefined) kv(card, '问题', ticket.attention.question)
    if (ticket.delivery !== undefined) kv(card, '投递', ticket.delivery.error)
    const report = latestReport(ticket)
    if (report !== undefined) kv(card, '报告', `${REPORT[report.state] ?? report.state} · ${report.summary}`)
    if (ticket.ended?.reason !== undefined) kv(card, '结束', ticket.ended.reason)
    kv(card, '更新', `${ago(ticket.updatedAt, now)} · ${ticket.id}`)
    if (ticket.ended === undefined) {
      const actions = el('div', 'wb-sa-actions')
      const thread = workbenchThreadOf(ticket)
      if (opts.answer === true && ticket.stage?.action === 'answer') {
        if (thread !== undefined) {
          const box = draftFor(thread, '回答这个问题（会作为这条需求的后续消息送给成员）')
          const answer = el('button', 'wb-btn wb-btn-primary', '回答')
          answer.type = 'button'
          answer.addEventListener('click', () => { void send({ action: 'request', text: box.value, thread }, () => { box.value = '' }, '回答已送出') })
          card.appendChild(box)
          actions.appendChild(answer)
        } else card.appendChild(el('div', 'wb-sa-hint', '这张工单来自别的渠道，请在原渠道回答'))
      }
      const retryable = ticket.delivery !== undefined || (person && (ticket.stage?.action === 'blocked' || ticket.stage?.action === 'failed'))
      if (retryable) {
        const retry = el('button', 'wb-btn', '重试')
        retry.type = 'button'
        retry.addEventListener('click', () => { void send({ action: 'retry', ticket_id: ticket.id }, undefined, '已重试') })
        actions.appendChild(retry)
      }
      const stop = el('button', 'wb-btn', '停止')
      stop.type = 'button'
      stop.addEventListener('click', () => {
        if (typeof window.confirm === 'function' && !window.confirm(`停止工单「${ticket.title}」？成员会被告知不再做它。`)) return
        void send({ action: 'stop', ticket_id: ticket.id, reason: '属主在工作台停止' }, undefined, '已停止')
      })
      actions.appendChild(stop)
      card.appendChild(actions)
    }
    return card
  }

  function group(title: string, tone: '' | 'is-warn' | 'is-danger', children: HTMLElement[], empty?: string): HTMLElement {
    const g = el('div', `wb-led-group ${tone}`.trim())
    const head = el('div', 'wb-led-group-head')
    head.append(el('span', undefined, title), el('span', 'wb-led-group-hint', String(children.length)))
    g.appendChild(head)
    if (children.length === 0 && empty !== undefined) g.appendChild(el('div', 'wb-sa-hint', empty))
    g.append(...children)
    return g
  }

  function renderPerson(state: SaState): void {
    const problems = problemsOf(state, now).map(p => { const c = el('div', `wb-led-card is-${p.tone}`, p.text); return c })
    if (problems.length > 0) body.appendChild(group('问题', 'is-danger', problems))
    body.appendChild(group('待你处理的工单', 'is-warn', personTickets(state).map(t => ticketCard(t, { answer: true })), '没有需要你处理的工单'))
  }

  function renderRequest(state: SaState): void {
    const form = el('div', 'wb-sa-form')
    form.append(requestBox, requestSend)
    if (!state.settings.sources.workbench) form.appendChild(el('div', 'wb-sa-hint', '工作台 Source 已关闭：需求不会被受理（到「设置」里打开）'))
    body.appendChild(form)
    const threads = state.threads.filter(t => t.ref.source === 'workbench').sort((a, b) => (b.lastAt ?? b.createdAt).localeCompare(a.lastAt ?? a.createdAt))
    const cards = threads.map(thread => {
      const card = el('div', 'wb-led-card wb-sa-thread')
      card.dataset.thread = thread.ref.id
      for (const t of thread.triggers) {
        const line = el('div', 'wb-sa-msg')
        line.append(el('span', 'wb-sa-who', '你'), el('span', 'wb-sa-text', t.text), el('span', 'wb-sa-when', ago(t.at, now)))
        card.appendChild(line)
      }
      for (const d of thread.decisions) {
        const reason = typeof d.reason === 'string' ? d.reason : (d.reason ?? []).map(r => r.text ?? r.values?.text ?? r.code ?? '').filter(Boolean).join('；')
        const row = el('div', 'wb-sa-decision', `总工：${DECISION[d.kind] ?? d.kind}${reason !== '' ? ` · ${reason}` : ''}${d.ticketId !== undefined ? ` · ${d.ticketId}` : ''}`)
        // Design superagent-reevaluate-note D3: the owner asks the router to judge a turned-down message again.
        if ((d.kind === 'ignore' || d.kind === 'unavailable') && thread.evaluating === null && (d.triggerIds ?? []).length > 0) {
          const again = el('button', 'wb-btn wb-sa-reevaluate', '重新判断')
          again.type = 'button'
          // One ask per click: the button turns off until the next render (design review: no repeated requeues).
          again.addEventListener('click', () => { again.disabled = true; for (const id of d.triggerIds ?? []) void send({ action: 'reevaluate', trigger_id: id }, undefined, '已请总工重新判断') })
          row.appendChild(again)
        }
        card.appendChild(row)
      }
      if (thread.evaluating !== null) card.appendChild(el('div', 'wb-sa-hint', '等总工决定…'))
      for (const r of thread.replies) {
        const line = el('div', `wb-sa-msg is-reply${r.status === 'dropped' ? ' is-danger' : ''}`)
        line.append(el('span', 'wb-sa-who', '团队'), el('span', 'wb-sa-text', r.message.text), el('span', 'wb-sa-when', r.status === 'sent' ? '' : r.status))
        card.appendChild(line)
      }
      const box = draftFor(thread.ref.id, '在这条需求下追加（补充、回答、或要求停止）')
      const more = el('button', 'wb-btn', '追加')
      more.type = 'button'
      more.addEventListener('click', () => { void send({ action: 'request', text: box.value, thread: thread.ref.id }, () => { box.value = '' }, '已追加') })
      const actions = el('div', 'wb-sa-actions')
      actions.appendChild(more)
      card.append(box, actions)
      return card
    })
    body.appendChild(group('我的需求', '', cards, '还没有提过需求'))
  }

  function renderTickets(state: SaState): void {
    const open = state.tickets.filter(t => t.ended === undefined)
    body.appendChild(group('待你处理', 'is-warn', personTickets(state).map(t => ticketCard(t))))
    body.appendChild(group('进行中', '', open.filter(t => t.stage?.stage !== 'person').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(t => ticketCard(t))))
    const ended = state.tickets.filter(t => t.ended !== undefined).sort((a, b) => (b.ended?.at ?? '').localeCompare(a.ended?.at ?? '')).slice(0, 20)
    body.appendChild(group('已结束（最近 20）', '', ended.map(t => ticketCard(t)), '还没有结束的工单'))
  }

  function renderTeam(state: SaState): void {
    const s = state.settings
    const head = el('div', 'wb-led-card')
    kv(head, '画布团队', s.canvas ?? '未绑定')
    kv(head, '总工', s.router === undefined ? '未指定' : sessionName(s.router))
    kv(head, '接单模式', ACCEPT[s.acceptMode] ?? s.acceptMode)
    kv(head, 'A2A 地址', state.a2a.address ?? (s.sources.a2a ? '创建中…' : '未开启'))
    kv(head, '策略版本', state.policyVersion)
    if (s.paused) kv(head, '执行', '已暂停')
    body.appendChild(group('团队', '', [head]))
    const slot = (member: string): string => {
      const b = state.executor.bindings.find(x => x.member === member)
      if (b === undefined) return '空闲'
      const t = state.tickets.find(x => x.id === b.ticketId)
      return `在做「${t?.title ?? b.ticketId}」 · ${ago(b.at, now)}`
    }
    const repo = (member: string, card: HTMLElement): void => { const r = s.repos?.[member]; if (r !== undefined) kv(card, '仓库', r) }
    const members = s.members.map(m => { const c = el('div', 'wb-led-card'); kv(c, '成员', sessionName(m)); repo(m, c); kv(c, '槽位', slot(m)); return c })
    const remote = s.remoteMembers.map(r => { const c = el('div', 'wb-led-card'); kv(c, '远端成员', r.ref); repo(r.ref, c); kv(c, '主机', r.url); kv(c, '钉住公钥', fingerprint(r.key)); kv(c, '槽位', slot(r.ref)); return c })
    body.appendChild(group('成员池', '', [...members, ...remote], '没有成员'))
    const queued = state.tickets.filter(t => t.ended === undefined && t.stage?.stage === 'working' && t.stage.action === 'queued')
    if (queued.length > 0) body.appendChild(group('排队', 'is-warn', queued.map(t => el('div', 'wb-led-card', `${t.title} · ${ago(t.createdAt, now)}`))))
    if (s.serves !== undefined) {
      const c = el('div', 'wb-led-card')
      if (s.serves.team !== undefined) kv(c, '画布团队', s.serves.team)
      kv(c, '团队宿主', s.serves.url)
      kv(c, '钉住公钥', fingerprint(s.serves.key))
      kv(c, '本机成员', s.serves.members.map(sessionName).join('、') || '无')
      body.appendChild(group('本机为别的团队干活', '', [c]))
    }
  }

  function renderSettings(state: SaState): void {
    if (settingsForm === undefined || !settingsDirty) settingsForm = buildSettings(state.settings, state.canvases ?? [])
    body.appendChild(settingsForm)
  }

  function buildSettings(s: SaSettings, canvases: readonly string[]): HTMLElement {
    const form = el('div', 'wb-sa-form wb-sa-settings')
    const joined = sessions.filter(x => x.joined === true)
    const mark = (): void => { settingsDirty = true }
    const label = (text: string, input: HTMLElement): HTMLElement => { const l = el('label', 'wb-sa-field'); l.append(el('span', 'wb-kv-k', text), input); return l }

    // Design v5: the team is a canvas team; composing it happens on the canvas, binding it here.
    const canvas = el('select', 'wb-sa-select')
    canvas.setAttribute('aria-label', '画布团队')
    canvas.appendChild(new Option('（不绑定）', ''))
    for (const name of canvases) canvas.appendChild(new Option(name, name, false, name === s.canvas))
    if (s.canvas !== undefined && !canvases.includes(s.canvas)) canvas.appendChild(new Option(`${s.canvas}（已不存在）`, s.canvas, false, true))
    canvas.addEventListener('change', mark)
    form.appendChild(label('画布团队', canvas))

    const router = el('select', 'wb-sa-select')
    router.setAttribute('aria-label', '总工')
    router.appendChild(new Option('（不指定）', ''))
    for (const x of joined) router.appendChild(new Option(sessionName(x.id), x.id, false, x.id === s.router))
    if (s.router !== undefined && !joined.some(x => x.id === s.router)) router.appendChild(new Option(`${s.router}（不在线）`, s.router, false, true))
    router.addEventListener('change', mark)
    form.appendChild(label('总工', router))

    const members = el('div', 'wb-sa-hint', s.members.length + s.remoteMembers.length === 0 ? '（画布团队里除总工外还没有成员）' : [...s.members.map(sessionName), ...s.remoteMembers.map(r => r.ref)].join('、'))
    members.setAttribute('aria-label', '成员')
    form.appendChild(label('成员（来自画布）', members))

    const mode = el('select', 'wb-sa-select')
    mode.setAttribute('aria-label', '接单模式')
    for (const [value, text] of Object.entries(ACCEPT)) mode.appendChild(new Option(text, value, false, value === s.acceptMode))
    mode.addEventListener('change', mark)
    form.appendChild(label('接单模式', mode))

    const flag = (text: string, on: boolean): HTMLInputElement => {
      const box = el('input'); box.type = 'checkbox'; box.checked = on
      box.addEventListener('change', mark)
      form.appendChild(label(text, box))
      return box
    }
    const wb = flag('工作台 Source', s.sources.workbench)
    const a2a = flag('A2A Source', s.sources.a2a)
    const paused = flag('暂停执行', s.paused)

    const save = el('button', 'wb-btn wb-btn-primary', '保存')
    save.type = 'button'
    save.addEventListener('click', () => {
      const patch: Json = { canvas: canvas.value === '' ? null : canvas.value, router: router.value === '' ? null : router.value, acceptMode: mode.value, sources: { workbench: wb.checked, a2a: a2a.checked }, paused: paused.checked }
      void send({ action: 'settings', settings: patch }, () => { settingsDirty = false }, '设置已保存')
    })
    const reset = el('button', 'wb-btn', '放弃修改')
    reset.type = 'button'
    reset.addEventListener('click', () => { settingsDirty = false; render() })
    const actions = el('div', 'wb-sa-actions')
    actions.append(save, reset)
    form.append(actions, el('div', 'wb-sa-hint', '团队就是一支画布团队：在画布上建队、增删成员（含远端成员），这里只绑定画布并从中指定总工。总工用 superagent-router 预设，本机成员用 superagent-member 预设；团队里的会话不再加入别的画布。'))
    return form
  }

  function render(): void {
    for (const [key, b] of navButtons) { const on = key === view; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)) }
    body.replaceChildren()
    builtFrom = viewKey()
    builtAt = now
    if (last === undefined) { body.appendChild(el('div', 'wb-sa-hint', '正在读取团队状态…')); return }
    if (last === null) { body.appendChild(el('div', 'wb-sa-hint', '这台主机没有运行 superagent 团队')); return }
    if (view === 'person') renderPerson(last)
    else if (view === 'request') renderRequest(last)
    else if (view === 'tickets') renderTickets(last)
    else if (view === 'team') renderTeam(last)
    else renderSettings(last)
  }

  function select(next: SaView): void { view = next; render() }

  function focusVisible(node: HTMLElement): boolean { try { return node.matches(':focus-visible') } catch { return false } }

  /**
   * What the view is built from, minus what moves without changing it: the A2A Source stamps its health on every read
   * round (`at`), which the view does not show.
   */
  function viewKey(): string {
    const shown = last === undefined || last === null ? last ?? null
      : { ...last, a2a: { ...last.a2a, health: Object.fromEntries(Object.entries(last.a2a.health).map(([k, h]) => [k, { state: h.state, detail: h.detail }])) } }
    return JSON.stringify([view, shown, sessions])
  }

  function update(state: SaState | null, rows: readonly SaSession[], at: number): { badge: string; tone?: RailTone } {
    last = state
    sessions = rows
    now = at
    // The poll rebuilds the view only when what it shows changed (or a minute passed, for the "n 分钟前" times), and never
    // under the person's hands: not while a control inside the pane has focus (a box being typed in, a button reached by
    // keyboard), and not in the middle of a press, which a rebuild would swallow.
    const active = document.activeElement
    const typing = active instanceof HTMLElement && root.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.tagName === 'INPUT')
    // A button keeps focus after a mouse click; only keyboard focus (focus-visible) holds the view still.
    const keyboard = active instanceof HTMLElement && body.contains(active) && focusVisible(active)
    const busy = pressing || typing || keyboard
    const changed = viewKey() !== builtFrom || at - builtAt >= 60_000
    if (changed && !busy) render()
    if (state === null) return { badge: '' }
    const waiting = personTickets(state).length
    const problems = problemsOf(state, at)
    if (problems.some(p => p.tone === 'danger')) return { badge: String(waiting + problems.length), tone: 'danger' }
    return waiting + problems.length > 0 ? { badge: String(waiting + problems.length), tone: 'warn' } : { badge: '' }
  }

  root.addEventListener('pointerdown', () => { pressing = true })
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { pressing = false })
  render()
  return { root, update, select }
}

const REPORT: Readonly<Record<string, string>> = { progress: '进展', waiting: '等待', ready: '已就绪', blocked: '受阻', failed: '失败', dropped: '无需做' }
const DECISION: Readonly<Record<string, string>> = { accept: '接单', attach: '并入工单', stop: '停止', ignore: '不接', reopen: '重开', unavailable: '暂时无法判断' }
const ACCEPT: Readonly<Record<string, string>> = { off: '关（只接明确请求）', observe: '观察（推断的只记录）', auto: '自动（按规则接推断的）' }
