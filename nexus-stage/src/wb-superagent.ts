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
 *   设置      router, members, accept mode, the A2A Source, pause, and the rules, sender list, repositories, GitHub people
 *             and review address (a partial settings write; pins have their own actions).
 * Records are attacker-shaped data (requests and reports come from people and agents): textContent only.
 * Inputs (request, follow-ups, answers, the settings form) are built once and survive the poll.
 * @module nexus-stage/wb-superagent
 */
import type { RailTone } from './wb-rail'
import { buildTeamFields, type TeamRule } from './wb-superagent-settings'

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
  readonly follows?: ReadonlyArray<{ thread: string; closed?: { outcome: string } }>
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
  /** The owner's prompt supplements (owner 2026-11-10, 对照上游): communication and delivery; empty is the default. */
  readonly prompts?: { readonly communication?: string; readonly delivery?: string }
  readonly rules?: readonly TeamRule[]
  readonly profiles?: Readonly<Record<string, { readonly role?: string; readonly rules: readonly TeamRule[] }>>
  readonly observers?: readonly string[]
  readonly dispatch?: string
  readonly bots?: { readonly a2a?: readonly string[] }
  readonly allowed?: { readonly github?: readonly string[] }
  readonly reviewer?: string
  readonly serves?: { url: string; key: string; members: readonly string[]; team?: string }
}
/** One team on this instance (`GET /__dsh_a2a/superagent/teams`); id '' is the primary team. */
export interface SaTeamRow { readonly id: string; readonly canvas?: string }

/** A problem the host found (design reliability R6). */
export interface SaHealth { readonly code: string; readonly session?: string; readonly ticketId?: string; readonly title?: string; readonly minutes?: number }

/** The words for a problem the host found. */
export function healthText(problem: SaHealth, sessionName: (id: string) => string = id => id): string {
  if (problem.code === 'router-not-loaded') return `总工会话 ${sessionName(problem.session ?? '')} 没有加载：需求送不到它，打开这个会话即可`
  if (problem.code === 'member-not-loaded') return `成员会话 ${sessionName(problem.session ?? '')} 没有加载：工单派不给它，打开这个会话即可`
  if (problem.code === 'ticket-quiet') return `工单「${problem.title ?? problem.ticketId ?? ''}」已经 ${String(problem.minutes ?? 0)} 分钟没有动静`
  return problem.code
}

export interface SaState {
  readonly health?: readonly SaHealth[]
  readonly settings: SaSettings; readonly policyVersion: string
  /** This instance's teams, and which one this state is, added by the poll. */
  readonly teams?: readonly SaTeamRow[]
  readonly selectedTeam?: string
  /** Proposals waiting for the owner and each rule set's last change, by scope (`team`, `dispatch`, `member:<id>`). */
  readonly ruleChanges?: {
    readonly pending: Readonly<Record<string, { readonly at: string; readonly by: string; readonly reason: string; readonly value: unknown }>>
    readonly last: Readonly<Record<string, { readonly at: string; readonly by: string; readonly reason?: string; readonly message?: string }>>
  }
  /** Design v5: why the bound canvas cannot run as the team, and the canvas teams this host owns (to bind one). */
  readonly canvasProblem?: string
  readonly pullRequestProblem?: string
  readonly reviews?: ReadonlyArray<{ ticketId: string; head: string; verdict?: { pass: boolean } }>
  /** v5 acceptance F4: why a session this host serves another team with cannot take work (wrong preset). */
  readonly servesProblem?: string
  readonly canvases?: readonly string[]
  readonly a2a: { enabled: boolean; address: string | null; health: Record<string, { state: string; detail?: string }> }
  readonly executor: { bindings: ReadonlyArray<{ member: string; ticketId: string; at: string }> }
  readonly error?: string
  readonly threads: readonly SaThread[]; readonly tickets: readonly SaTicket[]
  /** The team's recent settings saves (the 设置 view shows them): who, when, which fields changed. */
  readonly settingsHistory?: ReadonlyArray<{ id: string; at: string; by: string; changes: ReadonlyArray<{ field: string; from: string; to: string }> }>
}
/** A local session the pickers offer (the workbench's /state rows). */
export interface SaSession { readonly id: string; readonly name?: string; readonly joined?: boolean }

export interface SuperagentPaneDeps {
  /** POST /__dsh_a2a/superagent. */
  act(body: Json): Promise<Json>
  /** Re-read the state after a write (the next poll otherwise). */
  refresh(): void
  /** The team page's 搜索: GET the current team's records for a query (empty query: no results). */
  search?(query: string): Promise<Json>
  /** Show another team on this instance. */
  selectTeam?(id: string): void
  /** Bind another canvas team as a new team on this instance. */
  addTeam?(canvas: string, router: string): Promise<Json>
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
  for (const problem of state.health ?? []) out.push({ tone: problem.code === 'ticket-quiet' ? 'warn' : 'danger', text: healthText(problem) })
  if (state.pullRequestProblem !== undefined) out.push({ tone: 'warn', text: `读取 PR 状态失败，稍后重试：${state.pullRequestProblem}` })
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

/** A proposal's text for reading: a rule list by its names and text, anything else as it is. */
function describeRuleValue(value: unknown): string {
  const rules = (list: unknown): string => Array.isArray(list) ? list.map(rule => { const r = rule as TeamRule; return `${r.name}：${r.text}` }).join('；') : ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return rules(value)
  const profile = (value ?? {}) as { role?: string; rules?: unknown }
  return [profile.role, rules(profile.rules)].filter(part => part !== undefined && part !== '').join(' · ')
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
  const teamBar = el('div', 'wb-sa-teambar')
  const teamSelect = el('select', 'wb-sa-select')
  teamSelect.setAttribute('aria-label', '当前团队')
  // Blurred at once: a select that keeps focus counts as typing, and would hold back the new team's view.
  teamSelect.addEventListener('change', () => {
    // Unsaved edits belong to the team they were made for: a save after the switch would write them to the other one.
    if (settingsDirty && typeof window.confirm === 'function' && !window.confirm('设置里还有没保存的修改，切换团队会丢弃它们。继续吗？')) { teamSelect.value = last?.selectedTeam ?? ''; return }
    switchTeam(teamSelect.value)
    teamSelect.blur()
  })
  const addTeamToggle = el('button', 'wb-btn', '新增团队')
  addTeamToggle.type = 'button'
  const addTeamBox = el('div', 'wb-sa-addteam')
  addTeamBox.hidden = true
  teamBar.append(teamSelect, addTeamToggle)
  // The team page's 搜索 (upstream's search): this team's requests, threads and tickets; clicking a result shows it.
  const searchBox = el('input', 'wb-sa-search')
  searchBox.type = 'search'
  searchBox.setAttribute('aria-label', '搜索本团队')
  searchBox.placeholder = '搜索：文字 / 工单或需求 id / 线程 / #数字'
  const searchDrop = el('div', 'wb-sa-drop')
  searchDrop.hidden = true
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  const closeSearch = (): void => { searchDrop.hidden = true }
  const runSearch = (query: string): void => {
    clearTimeout(searchTimer)
    if (deps.search === undefined || query.trim().length < 2) { searchDrop.hidden = true; return }
    searchTimer = setTimeout(() => {
      void deps.search?.(query).then(out => {
        if (searchBox.value !== query || !root.contains(searchBox)) return
        const rows = Array.isArray(out.results) ? out.results as ReadonlyArray<Record<string, unknown>> : []
        searchDrop.replaceChildren()
        if (rows.length === 0) searchDrop.appendChild(el('div', 'wb-sa-hint', '没有匹配的结果'))
        for (const row of rows.slice(0, 20)) {
          const kind = String(row.kind)
          const line = el('button', 'wb-sa-hit')
          line.type = 'button'
          line.append(el('span', 'wb-sa-hit-kind', kind === 'ticket' ? '工单' : kind === 'request' ? '需求' : '消息'), el('span', 'wb-sa-hit-text', String(row.title ?? '')))
          line.addEventListener('click', () => { closeSearch(); searchBox.value = ''; locate(kind, row) })
          searchDrop.appendChild(line)
        }
        searchDrop.hidden = false
      }).catch(() => { searchDrop.hidden = true })
    }, 300)
  }
  searchBox.addEventListener('input', () => { runSearch(searchBox.value) })
  searchBox.addEventListener('blur', () => { setTimeout(closeSearch, 150) })
  const searchWrap = el('div', 'wb-sa-searchwrap')
  searchWrap.append(searchBox, searchDrop)
  root.append(el('div', 'wb-pane-head', 'superagent 团队'), teamBar, addTeamBox, searchWrap, nav, note, body)

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
  let teamOptions = ''
  /** The team just asked for: until its state arrives the old one's view is gone, so nothing can be written from it. */
  let pendingTeam: string | undefined
  function switchTeam(id: string): void {
    pendingTeam = id
    settingsDirty = false
    settingsForm = undefined
    body.replaceChildren()
    deps.selectTeam?.(id)
  }
  /** The team picker: rebuilt only when the list changes, and left alone while it is open. */
  function syncTeams(state: SaState | null): void {
    teamBar.hidden = state === null || deps.selectTeam === undefined
    if (state === null) return
    const teams = state.teams ?? []
    const key = JSON.stringify(teams)
    if (key !== teamOptions && document.activeElement !== teamSelect) {
      teamOptions = key
      teamSelect.replaceChildren(...teams.map(team => new Option(team.canvas ?? '（未绑定）', team.id)))
    }
    if (document.activeElement !== teamSelect) teamSelect.value = state.selectedTeam ?? ''
  }
  function openAddTeam(): void {
    const taken = new Set((last?.teams ?? []).flatMap(team => team.canvas !== undefined ? [team.canvas] : []))
    const canvas = el('select', 'wb-sa-select')
    canvas.setAttribute('aria-label', '新团队的画布')
    canvas.appendChild(new Option('选择画布团队', ''))
    for (const name of last?.canvases ?? []) if (!taken.has(name)) canvas.appendChild(new Option(name, name))
    const router = el('select', 'wb-sa-select')
    router.setAttribute('aria-label', '新团队的总工')
    router.appendChild(new Option('选择总工', ''))
    for (const row of sessions) if (row.joined === true) router.appendChild(new Option(row.name ?? row.id, row.id))
    const confirm = el('button', 'wb-btn wb-btn-primary', '添加')
    confirm.type = 'button'
    confirm.addEventListener('click', () => {
      if (canvas.value === '' || router.value === '') { note.textContent = '先选画布团队和总工'; return }
      void deps.addTeam?.(canvas.value, router.value).then((out) => {
        if (out.ok !== true) { note.textContent = `没有添加成功：${String(out.error ?? '未知原因')}`; return }
        addTeamBox.hidden = true
        note.textContent = `已新增团队 ${canvas.value}`
        switchTeam(String(out.id ?? ''))
      })
    })
    addTeamBox.replaceChildren(canvas, router, confirm, el('div', 'wb-sa-hint', '先在画布上建队。总工用 superagent-router 预设，且必须在这个画布里。'))
    addTeamBox.hidden = false
  }
  addTeamToggle.addEventListener('click', () => { if (addTeamBox.hidden) openAddTeam(); else addTeamBox.hidden = true })

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
    const { source, id: actorId } = ticket.mandate.actor
    kv(card, '授权', source === 'workbench' && actorId.startsWith('observer:') ? `观察者开单 · ${sessionName(actorId.slice('observer:'.length))}` : `${ticket.mandate.strength === 'explicit' ? '明确请求' : '推断'} · ${source}:${actorId}`)
    const binding = last?.executor.bindings.find(b => b.ticketId === ticket.id)
    if (binding !== undefined) kv(card, '成员', sessionName(binding.member))
    for (const f of ticket.follows ?? []) if (f.thread.startsWith('github:')) kv(card, 'PR', `${f.thread.slice(7)}${f.closed !== undefined ? ` · ${f.closed.outcome === 'merged' ? '已合并' : '已关闭'}` : ' · 等待合并'}`)
    for (const r of last?.reviews ?? []) if (r.ticketId === ticket.id) kv(card, '评审', `${r.head.slice(0, 7)} · ${r.verdict === undefined ? '等待评审' : r.verdict.pass ? 'PASS' : '未通过'}`)
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
        } else {
          // Its requester is an agent, so the question is the owner's to answer here.
          const box = draftFor(`ticket:${ticket.id}`, '回答这个问题（请求方是 agent，由你来答，答复会送给成员）')
          const answer = el('button', 'wb-btn wb-btn-primary', '回答')
          answer.type = 'button'
          answer.addEventListener('click', () => { void send({ action: 'answer', ticket_id: ticket.id, text: box.value }, () => { box.value = '' }, '回答已送出') })
          card.appendChild(box)
          actions.appendChild(answer)
        }
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
    const change = (scope: string, card: HTMLElement): void => {
      const pending = state.ruleChanges?.pending[scope]
      if (pending !== undefined) kv(card, '待你确认的修改', `${pending.reason}：${describeRuleValue(pending.value)}`)
      const last = state.ruleChanges?.last[scope]
      if (last !== undefined) kv(card, '最近修改', `${ago(last.at, now)} · ${last.by === 'owner' ? '你在页面上改的' : `${sessionName(last.by)} 提议${last.message !== undefined ? `，你说：${last.message}` : ''}`}`)
    }
    const profile = (member: string, card: HTMLElement): void => {
      const p = s.profiles?.[member]
      if (p?.role !== undefined) kv(card, '角色', p.role)
      for (const rule of p?.rules ?? []) kv(card, `规则 ${rule.name}${rule.enabled ? '' : '（停用）'}`, rule.text)
      change(`member:${member}`, card)
    }
    const members = s.members.map(m => { const c = el('div', 'wb-led-card'); kv(c, s.observers?.includes(m) === true ? '观察者' : '成员', sessionName(m)); profile(m, c); repo(m, c); kv(c, '槽位', slot(m)); return c })
    const remote = s.remoteMembers.map(r => { const c = el('div', 'wb-led-card'); kv(c, '远端成员', r.ref); profile(r.ref, c); repo(r.ref, c); kv(c, '主机', r.url); kv(c, '钉住公钥', fingerprint(r.key)); kv(c, '槽位', slot(r.ref)); return c })
    body.appendChild(group('成员池', '', [...members, ...remote], '没有成员'))
    const teamRules = el('div', 'wb-led-card')
    for (const rule of s.rules ?? []) kv(teamRules, `规则 ${rule.name}${rule.enabled ? '' : '（停用）'}`, rule.text)
    change('team', teamRules)
    const dispatchRules = el('div', 'wb-led-card')
    if (s.dispatch !== undefined && s.dispatch !== '') kv(dispatchRules, '派单规则', s.dispatch)
    change('dispatch', dispatchRules)
    const ruleCards = [teamRules, dispatchRules].filter(card => card.childElementCount > 0)
    body.appendChild(group('团队规则', '', ruleCards, '还没有团队规则'))
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
    // The team's recent settings saves: who, when, and what moved (rules keep their own 最近修改; this is the rest).
    const history = state.settingsHistory ?? []
    if (history.length > 0) {
      const block = el('div', 'wb-led-card')
      block.appendChild(el('div', 'wb-kv-k', '设置保存记录（最近）'))
      for (const row of history.slice(0, 10)) {
        const item = el('div', 'wb-sa-hist')
        item.append(el('span', 'wb-sa-when', `${ago(row.at, now)} · ${row.by === 'owner' ? '属主' : row.by}`))
        for (const change of row.changes.slice(0, 8)) item.appendChild(el('div', 'wb-sa-hist-line', `${change.field}：${change.from} → ${change.to}`))
        block.appendChild(item)
      }
      body.appendChild(block)
    }
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
    const fields = buildTeamFields(s, sessionName, mark, () => { void send({ action: 'sync-github-allowed' }, () => { settingsDirty = false }, 'GitHub 账号已同步') })
    form.append(...fields.nodes)

    // The owner's prompt supplements (owner 2026-11-10, 对照上游): how the team talks, and what delivery looks like.
    // Empty is the default; the presets' own text cannot be edited, and on a clash it stands.
    const promptBox = (text: string, which: 'communication' | 'delivery', aria: string): HTMLTextAreaElement => {
      const box = el('textarea', 'wb-sa-prompt')
      box.setAttribute('aria-label', aria)
      box.maxLength = 4000
      box.placeholder = '（留空：按预设默认）'
      box.value = s.prompts?.[which] ?? ''
      box.addEventListener('input', mark)
      form.appendChild(label(text, box))
      return box
    }
    const communication = promptBox('沟通方式补充说明', 'communication', '沟通方式补充说明')
    const delivery = promptBox('交付要求补充说明', 'delivery', '交付要求补充说明')
    void communication; void delivery

    const save = el('button', 'wb-btn wb-btn-primary', '保存')
    save.type = 'button'
    save.addEventListener('click', () => {
      const patch: Json = { canvas: canvas.value === '' ? null : canvas.value, router: router.value === '' ? null : router.value, acceptMode: mode.value, sources: { workbench: wb.checked, a2a: a2a.checked }, paused: paused.checked }
      const edited = fields.patch()
      if ('error' in edited) { say(edited.error, 'danger'); return }
      // The GitHub switch rides in sources only when it changed (design github-issues G7).
      const { sources: githubSource, ...rest } = edited.patch as Json & { sources?: Json }
      Object.assign(patch, rest)
      if (githubSource !== undefined) patch.sources = { ...(patch.sources as Json), ...githubSource }
      // Prompts ride along only when one actually changed (review of #567): untouched saves keep their own owner-proof
      // lane, and a host with no login saves ordinary settings without a 403.
      const saved = s.prompts ?? {}
      const nextCommunication = communication.value, nextDelivery = delivery.value
      const communicationChanged = (nextCommunication.trim() === '' ? undefined : nextCommunication) !== saved.communication
      const deliveryChanged = (nextDelivery.trim() === '' ? undefined : nextDelivery) !== saved.delivery
      if (communicationChanged || deliveryChanged) {
        // Clearing one box sends '' for it explicitly (host: '' clears that one; both-empty '' would too, but '' is only
        // sent for what actually changed) - prompts: null would clear both (#567 second review).
        const prompts: Json = { ...(communicationChanged ? { communication: nextCommunication } : {}), ...(deliveryChanged ? { delivery: nextDelivery } : {}) }
        Object.assign(patch, { prompts })
      }
      void send({ action: 'settings', settings: patch }, () => { settingsDirty = false }, '设置已保存')
    })
    const reset = el('button', 'wb-btn', '放弃修改')
    reset.type = 'button'
    reset.addEventListener('click', () => { settingsDirty = false; render() })
    const actions = el('div', 'wb-sa-actions')
    actions.append(save, reset)
    form.append(actions, el('div', 'wb-sa-hint', '团队就是一支画布团队：在画布上建队、增删成员（含远端成员），这里只绑定画布并从中指定总工。总工用 superagent-router 预设，本机成员用 superagent-member 预设，能自己开工单的观察者用 superagent-observer 预设；团队里的会话不再加入别的画布。'))
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
    applyFocus()
  }

  function select(next: SaView): void { view = next; render() }

  /** A search result the person clicked: show it where it lives, and flash it. */
  let pendingFocus: { readonly kind: string; readonly id: string } | undefined
  function locate(kind: string, row: Record<string, unknown>): void {
    const id = String(row.id ?? '')
    if (id === '') return
    pendingFocus = { kind, id }
    const wanted: SaView = kind === 'ticket' ? 'tickets' : 'request'
    if (view !== wanted) { view = wanted; render() } else { render() }
  }

  function applyFocus(): void {
    const focus = pendingFocus
    pendingFocus = undefined
    if (focus === undefined) return
    const node = focus.kind === 'ticket' ? body.querySelector(`[data-ticket="${focus.id}"]`) : body.querySelector(`[data-thread="${focus.id}"]`) ?? body.querySelector(`[data-thread="${String(focus.id)}"]`)
    if (node instanceof HTMLElement) {
      node.scrollIntoView?.({ block: 'center' })
      node.classList.add('is-flash')
      setTimeout(() => { node.classList.remove('is-flash') }, 1600)
    }
  }

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
    if (pendingTeam !== undefined) {
      if (state !== null && state.selectedTeam !== pendingTeam) return { badge: '' }
      pendingTeam = undefined
    }
    last = state
    sessions = rows
    now = at
    syncTeams(state)
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
