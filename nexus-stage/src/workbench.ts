/**
 * The A2A workbench: one DOM client UI for human AI researchers and agents
 * to OPERATE the network. Since 0.6.2 the 2D spatial planning board and the
 * operational panels are MERGED into one responsive shell — the board is the
 * stage (canvas mode, default while the host serves the canvas face) and the
 * directory/ledger/activity/plan panels ride a collapsible side rail; when
 * the canvas face is down the panels become the main stack (data mode).
 * Narrow screens turn the rail into a drawer and the inspector into a
 * bottom sheet (CSS media queries only — the DOM contract is stable).
 *
 * Discipline (inherited from the planning view it absorbed):
 * - Pure DOM, no WebGL, no three, no framework: every row is a textContent
 *   write, so attacker-shaped labels stay text.
 * - The workbench never fabricates capability: dead-letter rows act through
 *   the real abandon seam (deps), dispatch only DRAFTS a pasteable brief.
 * - update() re-renders data regions wholesale but never touches the
 *   dispatch textarea (user input survives polls); rail collapse, section
 *   state, and the active mode are view state kept across updates.
 * @module nexus-stage/workbench
 */
import { createChatDrawer, type ChatTarget } from './wb-chat'

/** One pending ledger row from /state `tasks`. */
export interface PendingRow {
  readonly taskId: string
  readonly team: string
  readonly peer?: string
  readonly startedAt: number
  readonly status: string
  readonly direction?: string
  readonly receiptExpected?: boolean
  readonly settleable?: boolean
  /**
   * First line of the dispatched message. A row without it is unreadable:
   * `direct-8f3a1c2b · dsh · 3h` says nothing about whether to nudge,
   * abandon, or go read the receipt — the operator's whole question is
   * WHAT is owed. Absent on rows persisted before the field existed.
   */
  readonly brief?: string
}

/** One dead-lettered row from /state `tasksDead`. */
export interface DeadRow {
  readonly taskId: string
  readonly team: string
  readonly peer?: string
  readonly startedAt: number
  readonly deadAt: number
  readonly reason?: string
  /** First line of the dispatched message (see {@link PendingRow.brief}). */
  readonly brief?: string
  /** gh#31: which side of the wire this row served (absent on old hosts). */
  readonly direction?: 'inbound' | 'outbound'
}

/** gh#31: one archived row from /state `archived` — the per-task outcome
 *  for a task that left the ledger (completed / abandoned / cancelled…). */
export interface ArchivedRow {
  readonly taskId: string
  readonly team: string
  readonly resolvedAt: number
  readonly outcome: string
  readonly summary?: string
}

/** One session row from /state `sessions` (live or cold joined). */
export interface SessionRow {
  readonly id: string
  readonly label: string
  readonly team: string
  readonly name?: string
  readonly description?: string
  readonly workspace?: string
  readonly joined?: boolean
  readonly live?: boolean
  readonly teams?: readonly string[]
  /** Canvas teams this session is a member of (0.6.6 roster annotation). */
  readonly canvasTeams?: readonly string[]
  /** @deprecated 0.6.6 — display-only taxonomy superseded by canvas teams. */
  readonly group?: string
}

/** One remote team row from /state `remote`. */
export interface RemoteRow {
  readonly team: string
  readonly name?: string
  readonly origin?: string
  readonly via?: string
  readonly workspace?: string
  readonly legacy?: boolean
  readonly teams?: readonly string[]
  /** Canvas teams on this host that carry this remote handle as a member. */
  readonly canvasTeams?: readonly string[]
}

/** One canvas member: a local bare session id or a zone-qualified remote
 *  handle (`zone/id8`) — remote members are routed by the directory, never
 *  woken locally (0.6.6 unified team model). */
export interface CanvasMemberRow {
  readonly id: string
  readonly team?: string
  readonly joined?: boolean
  readonly live?: boolean
  readonly remote?: boolean
}

/** One canvas team from /state `canvas.teams`. */
export interface CanvasTeamRow {
  readonly name: string
  readonly team: string
  readonly members: readonly CanvasMemberRow[]
}

/** One activity-ring entry. */
export interface ActivityRow {
  readonly ts: number
  readonly dir: 'in' | 'out'
  readonly team: string
  readonly peer: string
  readonly ok: boolean
}

/** The /state subset the workbench consumes (additive fields ignored). */
export interface StateBody {
  readonly version?: string
  readonly sessions?: readonly SessionRow[]
  readonly canvas?: { teams?: readonly CanvasTeamRow[] }
  /** gh#20 W-A/W-C: the peer row carries the link badge source, the host
   *  rail's label/version/last-contact facts (absent on older hosts). */
  readonly peers?: ReadonlyArray<{
    url: string
    score?: number
    link?: 'linked' | 'stranger'
    verified?: boolean
    name?: string
    version?: string
    lastContactAt?: number
    /** gh#24: whether the last contact attempt succeeded. */
    lastContactOk?: boolean
  }>
  readonly remote?: readonly RemoteRow[]
  readonly activity?: readonly ActivityRow[]
  readonly inFlight?: ReadonlyArray<{ team: string; peer: string; startedAt: number }>
  readonly tasks?: readonly PendingRow[]
  readonly tasksStaleCount?: number
  readonly tasksDead?: readonly DeadRow[]
  /** gh#31: per-task outcomes for rows that left the ledger (bounded). */
  readonly archived?: readonly ArchivedRow[]
  readonly archivedCount?: number
  /** Settled-archive split by verdict ('completed' | 'declined' | … | 'abandoned' | 'unclassified'). */
  readonly archivedSplit?: Readonly<Record<string, number>>
  readonly idempotency?: {
    window?: number
    pending?: number
    settled?: number
    claimsFresh?: number
    replays?: number
    conflicts?: number
  }
  readonly reconcile?: {
    state?: string
    woken?: number
    rows?: ReadonlyArray<{ id: string; error: string; attempts: number; needsRepair?: boolean }>
  }
}

/** What the workbench can DO — the seams tests drive. */
export interface WorkbenchDeps {
  now(): number
  /** Abandon one dead-lettered task via the control route. True on success. */
  abandon(taskId: string, reason: string): Promise<boolean>
  /** Canvas team member change via the control route (0.6.6): `id` is a
   *  local session id or a zone-qualified remote handle. True on success. */
  canvasOp(action: 'add-member' | 'remove-member', name: string, id: string): Promise<boolean>
  /** Quick dispatch (0.6.9): POST /__dsh_a2a/dispatch as a human gesture —
   *  one message to a routing team, async delivery, receipt lands in the
   *  ledger. Optional — without it the 快派 form hides. */
  dispatchQuick?(team: string, message: string): Promise<{ ok: boolean; task_id?: string; reply?: string; error?: string }>
  /** Inline transcript (0.6.11): the tail of a LOCAL session's own
   *  conversation log, read-only. Optional — without it the block hides. */
  sessionLog?(id: string): Promise<{ ok: boolean; messages?: Array<{ role: string; text: string }>; error?: string }>
  /** 0.6.12: list every local session holding a log artifact (newest first) —
   *  the reading face is host-scoped, so archived and never-joined sessions
   *  appear here even when the network directory shows no local rows. */
  sessionLogList?(): Promise<{ ok: boolean; sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>; error?: string }>
  /** 0.6.15: remote transcript via the local proxy — ?team=<zone/id8>
   *  resolves the publishing peer through the directory, ?peer=<base-url>
   *  reads one tracked peer directly. Without id the peer answers its
   *  readable-session listing. Optional — without it remote/peer chat
   *  shows the honest where-the-records-live note. */
  remoteSessionLog?(query: { team?: string; peer?: string; id?: string; limit?: number }): Promise<{ ok: boolean; messages?: Array<{ role: string; text: string }>; sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>; error?: string; via?: string }>
  /** Copy text to the clipboard; drafts are pasteable task briefs. */
  copy(text: string): void
  // 0.6.10: openLocal/openRemote (0.6.7/0.6.8 jump affordances) removed by
  // ruling — 禁止任何跳转，全部使用响应式布局. dispatchQuick is the only
  // reach primitive and it stays on this page.
  /** The spatial planning board. Optional: without it the shell stays in
   *  data mode permanently. `available()` mirrors the host's canvas face
   *  (state.canvas !== undefined) and gates canvas mode. */
  board?: {
    readonly root: HTMLElement
    activate(): void
    deactivate(): void
    available(): boolean
  }
}

/** Display name for one node: session title, then team, then label. */
function displayName(node: { name?: string; team?: string; label?: string }): string {
  return node.name ?? node.team ?? node.label ?? ''
}

function ageText(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  return node
}

/** One labelled counter in a pane's stat strip; `title` carries the definition
 *  (native tooltip — the definition lives with the number it explains). */
function statChip(label: string, value: number, hint: string, tone?: 'warn' | 'danger'): HTMLElement {
  const chip = el('span', 'wb-stat')
  if (tone !== undefined) chip.classList.add(`wb-stat-${tone}`)
  chip.setAttribute('title', hint)
  chip.appendChild(el('span', 'wb-stat-k')).textContent = label
  chip.appendChild(el('span', 'wb-stat-v')).textContent = String(value)
  return chip
}

/** One proportional bar: label · track · count. Cheap density for a histogram. */
function barRow(parent: HTMLElement, label: string, count: number, max: number): void {
  const row = el('div', 'wb-bar-row')
  row.appendChild(el('span', 'wb-bar-k')).textContent = label
  const track = el('span', 'wb-bar-track')
  const fill = el('span', 'wb-bar-fill')
  fill.style.width = `${max > 0 ? Math.max(count > 0 ? 2 : 0, Math.round((count / max) * 100)) : 0}%`
  track.appendChild(fill)
  row.appendChild(track)
  row.appendChild(el('span', 'wb-bar-v')).textContent = String(count)
  parent.appendChild(row)
}

function textRow(parent: HTMLElement, label: string, value: string): void {
  const row = el('div', 'wb-kv')
  row.appendChild(el('span', 'wb-kv-k')).textContent = label
  row.appendChild(el('span', 'wb-kv-v')).textContent = value
  parent.appendChild(row)
}

type Selection =
  | { kind: 'canvas'; row: CanvasTeamRow }
  | undefined

/** The rail sections. */
export type WorkbenchSection = 'directory' | 'hosts' | 'ledger' | 'activity' | 'plan'

/** Directory category filter (0.6.6): one chip per directory section group. */
type DirFilter = 'all' | 'local' | 'canvas' | 'peers' | 'remote'

const DIRECTORY_FILTERS: ReadonlyArray<{ key: DirFilter; label: string; hint: string }> = [
  { key: 'all', label: '全部', hint: '不过滤：目录全部条目' },
  { key: 'local', label: '本机', hint: '本机会话节点（现场 + 冷启动）' },
  { key: 'canvas', label: '队', hint: '画布队（人类手工分配的组队）' },
  { key: 'peers', label: 'Peers', hint: '对等节点（peer 池）' },
  { key: 'remote', label: '远端', hint: '远端会话队（来自对端卡片）' },
]

/** Lowercased haystack for the unified search: name/team/label/id/url/teams. */
function rowHaystack(...parts: ReadonlyArray<string | readonly string[] | undefined>): string {
  const flat: string[] = []
  for (const part of parts) {
    if (part === undefined) continue
    if (typeof part === 'string') {
      if (part !== '') flat.push(part)
    } else for (const entry of part) if (entry !== '') flat.push(entry)
  }
  return flat.join(' ').toLowerCase()
}

/** Legacy deep-link targets: 'board' focuses the stage, sections open a rail section. */
export type WorkbenchTab = 'board' | WorkbenchSection

/** Which face fills the stage. */
export type WorkbenchMode = 'canvas' | 'data'

export interface Workbench {
  readonly root: HTMLElement
  /** Feed one /state poll (or null while the first fetch is out). */
  update(state: StateBody | null): void
  /** Current stage mode: the board while the canvas face is up, else data. */
  readonly mode: () => WorkbenchMode
  /** Focus a target: 'board' converges on canvas mode (no-op while the
   *  canvas face is down); a section un-collapses its rail panel. */
  selectTab(key: WorkbenchTab): void
  /** A node was picked on the planning board (0.6.13): resolve it against
   *  the latest state and open the right-side chat drawer for it. */
  openNodeChat(id: string): void
}

/** Bare host:port of a peer url (workbench-local twin of federation's
 *  helper — this module keeps a zero-import posture). */
function peerHostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const SECTION_DEFS: ReadonlyArray<{ key: WorkbenchSection; label: string }> = [
  { key: 'directory', label: '目录' },
  { key: 'ledger', label: '台账' },
  { key: 'activity', label: '活动' },
  { key: 'plan', label: '规划' },
  // gh#20 W-C: the host rail — one row per tracked peer host. Appended so
  // the existing rail order and first-pane assumptions stay untouched.
  { key: 'hosts', label: '主机轨' },
]

export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const board = deps.board
  let mode: WorkbenchMode = 'data'
  let selection: Selection
  let last: StateBody | null = null
  const collapsed = new Set<WorkbenchSection>(['activity', 'plan'])
  // Directory view state (survives polls): unified search + category filter.
  let searchText = ''
  let dirFilter: DirFilter = 'all'
  // Canvas add-member form cache (static DOM re-mounted across polls; keyed
  // by team name — same trick as draftForm so inputs survive the 3s poll).
  let canvasForm: { name: string; form: HTMLFormElement; pick: HTMLSelectElement; manual: HTMLInputElement } | null = null
  // Quick-dispatch form (0.6.9), cached per target routing team the same
  // draftForm way: a textarea's draft must survive the 3s poll remount.
  let dispatchForm: { team: string; form: HTMLFormElement; text: HTMLTextAreaElement; note: HTMLElement } | null = null
  // 0.6.12: readable local logs (host-scope list, newest first). Refreshed
  // opportunistically per poll; rows render in the directory's 本机日志 section.
  let logRows: Array<{ id: string; mtimeMs: number; sizeBytes: number }> = []
  let logRowsBusy = false

  const root = el('div', 'wb')
  root.setAttribute('data-testid', 'wb-root')

  // ── Static skeleton: built once, update() only rewrites data regions. ──
  const header = el('header', 'wb-header')
  const menuBtn = el('button', 'wb-icon-btn wb-menu')
  menuBtn.type = 'button'
  menuBtn.dataset.testid = 'wb-menu'
  menuBtn.setAttribute('aria-label', '打开目录抽屉')
  menuBtn.textContent = '☰'
  menuBtn.addEventListener('click', () => root.classList.toggle('is-rail-open'))
  header.appendChild(menuBtn)
  const title = el('div', 'wb-title')
  title.appendChild(el('span', 'wb-title-main')).textContent = 'A2A 工作台'
  const versionBadge = el('span', 'wb-badge')
  title.appendChild(versionBadge)
  header.appendChild(title)
  const headerStats = el('div', 'wb-header-stats')
  header.appendChild(headerStats)
  const railToggle = el('button', 'wb-icon-btn wb-rail-toggle')
  railToggle.type = 'button'
  railToggle.dataset.testid = 'wb-rail-toggle'
  railToggle.setAttribute('aria-label', '折叠/展开侧栏')
  railToggle.textContent = '◧'
  railToggle.addEventListener('click', () => {
    root.classList.toggle('is-rail-collapsed')
    // The stage width changed while the board fills it → re-sync its view
    // size (idempotent; focus side effect is harmless in a shell toggle).
    if (mode === 'canvas' && board !== undefined) board.activate()
  })
  header.appendChild(railToggle)

  const body = el('div', 'wb-body')
  const rail = el('aside', 'wb-rail')

  // Rail sections (accordion). Panes are created once and re-parented
  // between section bodies (canvas mode) and the stage stack (data mode).
  const sectionBodies = new Map<WorkbenchSection, HTMLElement>()
  const sectionCounts = new Map<WorkbenchSection, HTMLElement>()
  for (const def of SECTION_DEFS) {
    const sec = el('section', 'wb-sec')
    sec.dataset.sec = def.key
    const head = el('button', 'wb-sec-head')
    head.type = 'button'
    head.appendChild(el('span', 'wb-sec-label')).textContent = def.label
    const count = el('span', 'wb-sec-count')
    head.appendChild(count)
    head.addEventListener('click', () => {
      if (collapsed.has(def.key)) collapsed.delete(def.key)
      else collapsed.add(def.key)
      syncSections()
    })
    sec.appendChild(head)
    const secBody = el('div', 'wb-sec-body')
    sec.appendChild(secBody)
    rail.appendChild(sec)
    sectionBodies.set(def.key, secBody)
    sectionCounts.set(def.key, count)
  }

  const directoryBody = el('div', 'wb-directory')
  // Directory toolbar: unified search + category filter chips (0.6.6). Built
  // once above the re-rendered list so the input keeps focus and its text
  // across polls; filtering is pure frontend over /state.
  const directoryTools = el('div', 'wb-dir-tools')
  const searchInput = document.createElement('input')
  searchInput.className = 'wb-search'
  searchInput.type = 'search'
  searchInput.placeholder = '搜索：名称 / 队 / 会话 / 节点'
  searchInput.setAttribute('aria-label', '统一搜索目录')
  searchInput.addEventListener('input', () => {
    searchText = searchInput.value.trim().toLowerCase()
    renderSidebar()
  })
  directoryTools.appendChild(searchInput)
  const filterRow = el('div', 'wb-filters')
  for (const def of DIRECTORY_FILTERS) {
    const chip = el('button', 'wb-filter')
    chip.type = 'button'
    chip.textContent = def.label
    chip.dataset.filter = def.key
    chip.title = def.hint
    chip.addEventListener('click', () => {
      dirFilter = def.key
      renderSidebar()
    })
    filterRow.appendChild(chip)
  }
  directoryTools.appendChild(filterRow)
  sectionBodies.get('directory')!.appendChild(directoryTools)
  sectionBodies.get('directory')!.appendChild(directoryBody)

  const ledgerPane = el('section', 'wb-pane')
  const activityPane = el('section', 'wb-pane')
  const planPane = el('section', 'wb-pane')
  // gh#20 W-C: the host rail pane (one row per tracked peer).
  const hostsPane = el('section', 'wb-pane')
  const dataPanes: ReadonlyArray<[WorkbenchSection, HTMLElement]> = [
    ['ledger', ledgerPane],
    ['activity', activityPane],
    ['plan', planPane],
    ['hosts', hostsPane],
  ]

  const stage = el('main', 'wb-stage')
  const boardPane = el('section', 'wb-stage-board')
  if (board !== undefined) {
    boardPane.appendChild(board.root)
    stage.appendChild(boardPane)
  }
  const dataStack = el('div', 'wb-data')

  const inspector = el('aside', 'wb-inspector')
  const inspectorHead = el('div', 'wb-inspector-head')
  inspectorHead.appendChild(el('span', 'wb-inspector-title')).textContent = '详情'
  const inspectorClose = el('button', 'wb-icon-btn')
  inspectorClose.type = 'button'
  inspectorClose.setAttribute('aria-label', '关闭详情')
  inspectorClose.textContent = '✕'
  inspectorClose.addEventListener('click', () => select(undefined))
  inspectorHead.appendChild(inspectorClose)
  inspector.appendChild(inspectorHead)
  const inspectorBody = el('div', 'wb-inspector-body')
  inspector.appendChild(inspectorBody)

  // ── Node chat drawer (0.6.13; rewritten 2026-10-23 as wb-chat) ──
  // Clicking a node — on the planning board or a directory row — opens the
  // conversation as a right-side chat: thread + composer + receipt tracking.
  const chat = createChatDrawer({
    now: deps.now,
    sessionLog: deps.sessionLog,
    remoteSessionLog: deps.remoteSessionLog,
    dispatchQuick: deps.dispatchQuick,
  })

  stage.appendChild(dataStack)
  body.appendChild(rail)
  body.appendChild(stage)
  body.appendChild(inspector)
  body.appendChild(chat.root)
  root.appendChild(header)
  root.appendChild(body)

  function syncSections(): void {
    for (const def of SECTION_DEFS) {
      const sec = sectionBodies.get(def.key)!.parentElement!
      sec.classList.toggle('is-collapsed', collapsed.has(def.key))
    }
  }

  /** Move the data panes to their mode home: rail sections while the board
   *  owns the stage, the stage stack when the board is out. */
  function placePanes(m: WorkbenchMode): void {
    for (const [key, pane] of dataPanes) {
      const home = m === 'canvas' ? sectionBodies.get(key)! : dataStack
      if (pane.parentElement !== home) home.appendChild(pane)
    }
  }

  function syncMode(): void {
    const canvasUp = board !== undefined && board.available()
    const next: WorkbenchMode = canvasUp ? 'canvas' : 'data'
    root.dataset.mode = next
    boardPane.classList.toggle('is-hidden', next !== 'canvas')
    dataStack.classList.toggle('is-hidden', next === 'canvas')
    placePanes(next)
    if (next !== mode) {
      if (board !== undefined) {
        if (next === 'canvas') board.activate()
        else board.deactivate()
      }
      mode = next
    }
  }

  function clear(node: HTMLElement): HTMLElement {
    while (node.firstChild !== null) node.removeChild(node.firstChild)
    return node
  }

  function select(next: Selection): void {
    selection = next
    // Canvas add-member form is cached per team name (draftForm trick):
    // drop it whenever the selection moves off its team.
    if (next?.kind !== 'canvas' || canvasForm?.name !== next.row.name) canvasForm = null
    // Same for the quick-dispatch form: it is cached per target team
    // (0.6.15: remote dispatch moved to the chat drawer's own form).
    if (next?.kind !== 'canvas') dispatchForm = null
    renderInspector()
    // Narrow screens: picking from the drawer closes it so the stage shows.
    root.classList.remove('is-rail-open')
  }

  // ── Directory section ──
  function renderSidebar(): void {
    const box = clear(directoryBody)
    // Filter chips reflect the live view state (built once, toggled here).
    for (let i = 0; i < filterRow.children.length; i++) {
      const node = filterRow.children[i] as HTMLElement
      node.classList.toggle('is-active', node.dataset.filter === dirFilter)
    }
    if (last === null) {
      box.appendChild(el('div', 'wb-muted')).textContent = '载入中…'
      sectionCounts.get('directory')!.textContent = ''
      return
    }
    const state = last
    const filtering = searchText !== '' || dirFilter !== 'all'
    /** One directory row factory with the shared search+filter gate. */
    const admit = (cat: DirFilter, haystack: string): boolean =>
      (dirFilter === 'all' || dirFilter === cat) && (searchText === '' || haystack.includes(searchText))
    /** Canvas-team badge for roster annotation (▤ + short name). */
    const badges = (item: HTMLElement, teams: readonly string[] | undefined): void => {
      if (teams === undefined || teams.length === 0) return
      const chip = el('span', 'wb-item-badge')
      const names = teams.map(t => t.slice(t.lastIndexOf('/') + 1))
      chip.textContent = `▤ ${names.slice(0, 3).join(' ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
      chip.title = `画布队：${teams.join(' · ')}`
      item.appendChild(chip)
    }
    const section = (label: string, count: number): HTMLElement => {
      const head = el('div', 'wb-side-head')
      head.textContent = `${label} · ${count}`
      box.appendChild(head)
      return box
    }
    const sessions = state.sessions ?? []
    const live = sessions.filter(row => row.live === true && admit('local', rowHaystack(displayName(row), row.team, row.label, row.id, row.canvasTeams)))
    const cold = sessions.filter(row => row.live !== true && admit('local', rowHaystack(displayName(row), row.team, row.label, row.id, row.canvasTeams)))
    sectionCounts.get('directory')!.textContent = `${live.length}/${cold.length}${logRows.length > 0 ? ` · 档 ${logRows.length}` : ''}`
    if (live.length > 0) {
      section('本机 · 现场', live.length)
      for (const row of live) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-live')).textContent = '●'
        item.appendChild(el('span', 'wb-item-label')).textContent = displayName(row)
        badges(item, row.canvasTeams)
        item.addEventListener('click', () => openChat({ kind: 'session', id: row.id, title: displayName(row), sub: row.team, team: row.team, live: row.live }))
        box.appendChild(item)
      }
    }
    if (cold.length > 0) {
      section('本机 · 冷启动', cold.length)
      for (const row of cold) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-cold')).textContent = '○'
        item.appendChild(el('span', 'wb-item-label')).textContent = displayName(row)
        badges(item, row.canvasTeams)
        item.addEventListener('click', () => openChat({ kind: 'session', id: row.id, title: displayName(row), sub: row.team, team: row.team, live: row.live }))
        box.appendChild(item)
      }
    }
    const canvases = (state.canvas?.teams ?? []).filter(row =>
      admit('canvas', rowHaystack(row.name, row.team, row.members.map(member => member.team ?? member.id))))
    if (canvases.length > 0) {
      section('Canvas 队', canvases.length)
      for (const row of canvases) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-canvas')).textContent = '▤'
        const remote = row.members.filter(member => member.remote === true).length
        item.appendChild(el('span', 'wb-item-label')).textContent =
          `${row.name} · ${row.members.length}${remote > 0 ? `（远端 ${remote}）` : ''}`
        item.addEventListener('click', () => select({ kind: 'canvas', row }))
        box.appendChild(item)
      }
    }
    const peers = (state.peers ?? []).filter(row => admit('peers', rowHaystack(row.url)))
    if (peers.length > 0) {
      section('Peers', peers.length)
      for (const row of peers) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-peer')).textContent = '⇄'
        item.appendChild(el('span', 'wb-item-label')).textContent =
          row.url.replace(/^https?:\/\//, '') + (row.score !== undefined ? ` · ${row.score}` : '')
        item.addEventListener('click', () => {
          const host = row.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
          openChat({ kind: 'peer', id: `peer-${host}`, title: row.url, sub: host, url: row.url })
        })
        box.appendChild(item)
      }
    }
    const remote = (state.remote ?? []).filter(row => admit('remote', rowHaystack(displayName(row), row.team, row.origin, row.workspace, row.canvasTeams)))
    if (remote.length > 0) {
      section('远端节点', remote.length)
      for (const row of remote) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-remote')).textContent = '◇'
        item.appendChild(el('span', 'wb-item-label')).textContent = displayName(row)
        badges(item, row.canvasTeams)
        // 0.6.15: remote rows open the chat drawer — the transcript now
        // reads through the proxy instead of the where-the-records-live note.
        item.addEventListener('click', () => openChat({ kind: 'remote', team: row.team, title: displayName(row), sub: row.team, row }))
        box.appendChild(item)
      }
    }
    // 0.6.12: 本机日志 — every local session artifact EXCEPT ids already shown
    // as network rows (those open the same transcript from their own cards).
    // This is the reachability fix for hosts whose cold rows are all archived:
    // reading is host-scoped, the network directory is not the reading gate.
    const networkIds = new Set(sessions.map(row => row.id))
    const fmtSize = (n: number): string => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1_000 ? `${Math.round(n / 1_000)} KB` : `${n} B`
    const logs = logRows.filter(row => !networkIds.has(row.id) && admit('local', rowHaystack(row.id)))
    if (logs.length > 0) {
      section('本机日志', logs.length)
      for (const row of logs) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot')).textContent = '❐'
        const label = el('span', 'wb-item-label')
        label.textContent = `…${row.id.slice(-12)} · ${fmtSize(row.sizeBytes)}`
        item.title = `${row.id}\n${fmtSize(row.sizeBytes)} · ${new Date(row.mtimeMs).toLocaleString()}`
        item.appendChild(label)
        item.addEventListener('click', () => openChat({ kind: 'log', id: row.id, title: `…${row.id.slice(-12)}`, sub: '档案' }))
        box.appendChild(item)
      }
    }
    if (filtering && live.length + cold.length + canvases.length + peers.length + remote.length + logs.length === 0) {
      box.appendChild(el('div', 'wb-muted')).textContent = '无匹配条目'
    }
  }

  // ── Ledger pane ──
  /** Age buckets for debt: what the ledger is actually made of, at a glance.
   *  Boundaries mirror the C-ruling split (1h = settleable→conversational). */
  const AGE_BUCKETS: ReadonlyArray<{ label: string; maxMs: number }> = [
    { label: '<10m', maxMs: 10 * 60_000 },
    { label: '10m-1h', maxMs: 60 * 60_000 },
    { label: '1-6h', maxMs: 6 * 60 * 60_000 },
    { label: '6-24h', maxMs: 24 * 60 * 60_000 },
    { label: '>24h', maxMs: Number.POSITIVE_INFINITY },
  ]

  /** Group pending rows by age bucket; returns buckets in age order with counts. */
  function ageHistogram(rows: readonly PendingRow[], now: number): number[] {
    const counts = AGE_BUCKETS.map(() => 0)
    for (const row of rows) {
      const age = now - row.startedAt
      const index = AGE_BUCKETS.findIndex(bucket => age < bucket.maxMs)
      counts[index === -1 ? counts.length - 1 : index]! += 1
    }
    return counts
  }

  /** Top teams by pending-row count, most loaded first (bounded to 5). */
  function topTeams(rows: readonly PendingRow[]): Array<[string, number]> {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.team, (counts.get(row.team) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }

  /**
   * gh#20 W-C: the host rail — one row per tracked peer host. Each row is a
   * HOST card: operator-facing label (the peer's published card name, host
   * fallback), the W-A tri-state badge (link class + verified mark), a
   * health lamp driven by the last-contact recency (green ≤60s, amber
   * ≤5min, gray older/never — tooltip carries the exact timestamp), and the
   * peer's published version chip. Clicking drills down: the peer chat
   * drawer (remote log entry) rides the existing face.
   */
  function renderHosts(): void {
    const pane = clear(hostsPane)
    if (last === null) {
      sectionCounts.get('hosts')!.textContent = ''
      return
    }
    const now = deps.now()
    const peers = [...(last.peers ?? [])].sort((a, b) => {
      const rank = (row: { link?: string }): number => row.link === 'linked' ? 0 : 1
      return rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0)
    })
    sectionCounts.get('hosts')!.textContent = `${peers.filter(row => row.link === 'linked').length}/${peers.length}`
    if (peers.length === 0) {
      pane.appendChild(el('div', 'wb-nodelist-empty')).textContent = '暂无 tracked peer——配 peers 种子或等 referral 到达'
      return
    }
    for (const row of peers) {
      const host = peerHostOf(row.url)
      const lineEl = el('div', 'wb-host-row')
      // Health lamp (gh#24 semantics): recency alone lied — a FAILED fresh
      // contact glowed green. Tiers by age: ≤60s live / ≤5min warm /
      // beyond cold, overridden by the OUTCOME: a recent failure (≤5min)
      // is red regardless of the live/warm band, and a never-contacted
      // peer is the hollow unknown state.
      const lamp = el('span', 'wb-host-lamp')
      const last = row.lastContactAt
      const age = last === undefined ? undefined : now - last
      const ok = row.lastContactOk
      if (age === undefined) lamp.classList.add('is-unknown')
      else if (ok === false && age <= 5 * 60_000) lamp.classList.add('is-fail')
      else if (age <= 60_000) lamp.classList.add('is-live')
      else if (age <= 5 * 60_000) lamp.classList.add('is-warm')
      else lamp.classList.add('is-cold')
      lamp.title = last === undefined
        ? '尚无接触记录'
        : `最近接触 ${ageText(last, now)}${ok === false ? '（失败）' : ok === true ? '（成功）' : ''}`
      lineEl.appendChild(lamp)
      // Label: the peer's published name, host fallback.
      lineEl.appendChild(el('span', 'wb-host-name')).textContent = row.name !== undefined && row.name !== '' ? row.name : host
      // W-A badge: link class + verified mark.
      const badge = el('span', `wb-host-badge ${row.link === 'linked' ? 'is-linked' : 'is-stranger'}`)
      badge.textContent = `${row.link === 'linked' ? 'linked' : 'stranger'} ${row.verified === true ? '✓' : '✗'}`
      // The tooltip follows the verified mark (gh#24): a linked ✗ must not
      // claim a valid signature.
      badge.title = row.link === 'linked'
        ? `已建立运营者链接（互种或 canvas 引用）；${row.verified === true ? '验签有效' : '尚未持有验签通过的卡片'}`
        : '无运营者关系（验签 ≠ 关系）'
      lineEl.appendChild(badge)
      // Version chip from the warm card.
      if (row.version !== undefined && row.version !== '') {
        lineEl.appendChild(el('span', 'wb-host-ver')).textContent = row.version
      }
      lineEl.appendChild(el('span', 'wb-host-url mono')).textContent = host
      lineEl.setAttribute('role', 'button')
      lineEl.tabIndex = 0
      lineEl.title = `${row.url} · score ${String(row.score ?? 0)}`
      const drill = (): void => { openChat({ kind: 'peer', id: `peer-${host}`, title: row.name !== undefined && row.name !== '' ? row.name : host, sub: host, url: row.url }) }
      lineEl.addEventListener('click', drill)
      lineEl.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); drill() } })
      pane.appendChild(lineEl)
    }
  }

  function renderLedger(): void {
    const pane = clear(ledgerPane)
    if (last === null) return
    const now = deps.now()
    const pending = last.tasks ?? []
    const dead = last.tasksDead ?? []
    const stale = last.tasksStaleCount ?? 0
    const archived = last.archivedCount ?? 0
    sectionCounts.get('ledger')!.textContent = `待 ${pending.length} · 死 ${dead.length}`

    // Stat strip: the four headline numbers, each carrying its definition.
    const stats = el('div', 'wb-stats')
    stats.appendChild(statChip('待回执', pending.length,
      '等待回执的任务（pending）。其中「陈旧」= 超过 1 小时仍未回执，或本就无回执债（fire-and-forget）'))
    stats.appendChild(statChip('陈旧', stale,
      '陈旧尾：≥1h 无回执的旧账 + receiptExpected:false 的免回执行。它们到 24h TTL 自动转死信，不算可催办债务',
      stale > 0 ? 'warn' : undefined))
    stats.appendChild(statChip('死信', dead.length,
      '超过 24h TTL 仍未结算，或目标早已离开。需清账（abandon）才能移出',
      dead.length > 0 ? 'danger' : undefined))
    stats.appendChild(statChip('已归档', archived,
      '已结算并留档的任务（回执已关联）。用于审计，不再占待回执名额'))
    pane.appendChild(stats)

    // Archive verdict split: how those settled rows actually ended.
    const split = last.archivedSplit
    if (archived > 0 && split !== undefined) {
      const entries = Object.entries(split).sort((a, b) => b[1] - a[1])
      if (entries.length > 0) {
        const line = el('div', 'wb-pane-head')
        line.textContent = `归档结局 · ${entries.map(([key, count]) => `${key} ${count}`).join(' · ')}`
        pane.appendChild(line)
      }
    }

    // Forensics (moved off the header): the plumbing counters a seat reads
    // when something looks off — muted, never the owner's first line.
    const idem = last.idempotency
    const reconcileState = last.reconcile?.state
    if (idem !== undefined || reconcileState !== undefined) {
      const parts: string[] = []
      if (idem !== undefined) parts.push(`幂等 claims ${idem.claimsFresh ?? 0} · replays ${idem.replays ?? 0} · conflicts ${idem.conflicts ?? 0}`)
      if (reconcileState !== undefined) parts.push(`reconcile ${reconcileState}`)
      const line = el('div', 'wb-pane-head wb-forensics')
      line.textContent = `取证 · ${parts.join(' · ')}`
      pane.appendChild(line)
    }

    if (pending.length > 0) {
      // Age histogram + team load: WHERE the debt sits and how old it is.
      const counts = ageHistogram(pending, now)
      const max = Math.max(...counts, 1)
      const hist = el('div', 'wb-hist')
      for (let i = 0; i < AGE_BUCKETS.length; i += 1) {
        barRow(hist, AGE_BUCKETS[i]!.label, counts[i]!, max)
      }
      pane.appendChild(hist)
      const teams = topTeams(pending)
      const teamLine = el('div', 'wb-pane-head')
      teamLine.textContent = `债务队 Top${teams.length} · ${teams.map(([team, count]) => `${team} ${count}`).join(' · ')}`
      pane.appendChild(teamLine)
    }

    const table = el('div', 'wb-table')
    for (const row of pending) {
      // Owner signal (2026-10-21): the ledger is a RESULTS face — the brief
      // is the primary copy, ids/teams/ages are muted forensics underneath.
      // Exception-driven: only overdue (>1h) rows raise their voice; normal
      // rows stay quiet so the debt that needs eyes stands out.
      const overdue = now - row.startedAt > 60 * 60_000
      const line = el('div', `wb-row wb-row-result${overdue ? ' wb-row-alert' : ''}`)
      const briefText = row.brief ?? '（无摘要——派发未带 brief）'
      const brief = el('span', 'wb-row-head')
      brief.textContent = briefText
      brief.title = briefText
      line.appendChild(brief)
      const badges: string[] = []
      if (row.settleable === true) badges.push('可结算')
      if (row.receiptExpected === false) badges.push('无回执债')
      if (row.direction === 'inbound') badges.push('入站')
      const meta = el('span', 'wb-row-meta-line')
      meta.textContent = `${row.taskId} · ${row.team} · ${ageText(row.startedAt, now)}${badges.length > 0 ? ` · ${badges.join(' ')}` : ''}`
      line.appendChild(meta)
      table.appendChild(line)
    }
    pane.appendChild(table)
    if (dead.length > 0) {
      const deadHead = el('div', 'wb-pane-subhead')
      deadHead.textContent = '死信（可清账）'
      pane.appendChild(deadHead)
      const deadTable = el('div', 'wb-table wb-table-dead')
      for (const row of dead) {
        // Same results-first shape, always exception-colored: dead letters
        // ARE the alarm.
        const line = el('div', 'wb-row wb-row-result wb-row-alert')
        const deadBriefText = row.brief ?? '（无摘要）'
        const deadBrief = el('span', 'wb-row-head')
        deadBrief.textContent = deadBriefText
        deadBrief.title = deadBriefText
        line.appendChild(deadBrief)
        const meta = el('span', 'wb-row-meta-line')
        meta.textContent = `${row.taskId} · ${row.team} · ${ageText(row.deadAt, now)}${row.reason !== undefined && row.reason !== '' ? ` · ${row.reason}` : ''}`
        line.appendChild(meta)
        const btn = el('button', 'wb-btn')
        btn.type = 'button'
        btn.textContent = '清账'
        btn.addEventListener('click', () => {
          btn.disabled = true
          void deps.abandon(row.taskId, 'workbench dead-letter cleanup').then(ok => {
            btn.disabled = false
            btn.textContent = ok ? '已清' : '失败'
          })
        })
        line.appendChild(btn)
        deadTable.appendChild(line)
      }
      pane.appendChild(deadTable)
    }
  }

  // ── Activity pane ──
  function renderActivity(): void {
    const pane = clear(activityPane)
    if (last === null) return
    const now = deps.now()
    const flights = last.inFlight ?? []
    sectionCounts.get('activity')!.textContent = `${flights.length}+${last.activity?.length ?? 0}`
    const head = el('div', 'wb-pane-head')
    head.textContent = `在途 ${flights.length} · 活动 ${last.activity?.length ?? 0}`
    pane.appendChild(head)
    if (flights.length > 0) {
      const sub = el('div', 'wb-pane-subhead')
      sub.textContent = '在途路由'
      pane.appendChild(sub)
      for (const row of flights) {
        const line = el('div', 'wb-row')
        line.appendChild(el('span', 'wb-row-dir')).textContent = '→'
        line.appendChild(el('span', 'wb-row-team')).textContent = row.team
        line.appendChild(el('span', 'wb-row-meta')).textContent = `${row.peer} · ${ageText(row.startedAt, now)}`
        pane.appendChild(line)
      }
    }
    const ringHead = el('div', 'wb-pane-subhead')
    ringHead.textContent = '活动环（最新在前）'
    pane.appendChild(ringHead)
    const ring = last.activity ?? []
    if (ring.length === 0) {
      pane.appendChild(el('div', 'wb-muted')).textContent = '暂无活动'
      return
    }
    for (const row of ring) {
      const line = el('div', 'wb-row')
      const dir = el('span', 'wb-row-dir')
      dir.textContent = row.dir === 'out' ? '→' : '←'
      if (row.ok !== true) dir.classList.add('is-fail')
      line.appendChild(dir)
      line.appendChild(el('span', 'wb-row-team')).textContent = row.team
      line.appendChild(el('span', 'wb-row-meta')).textContent = `${row.peer} · ${ageText(row.ts, now)}`
      line.appendChild(el('span', 'wb-row-badges')).textContent = row.ok === true ? '' : '失败'
      pane.appendChild(line)
    }
  }

  // ── Plan pane: derived actions + dispatch drafting ──
  function planActions(state: StateBody): Array<{ severity: 'high' | 'normal'; text: string; brief?: string }> {
    const now = deps.now()
    const actions: Array<{ severity: 'high' | 'normal'; text: string; brief?: string }> = []
    const dead = state.tasksDead ?? []
    if (dead.length > 0) {
      actions.push({ severity: 'high', text: `清账 ${dead.length} 条死信（目标早已离开或死信化，无回执可期）` })
    }
    for (const row of state.tasks ?? []) {
      const age = now - row.startedAt
      if (age > 60 * 60_000 && row.settleable === true) {
        // Quote the original ask: a nudge that only repeats a task id makes
        // the target re-derive WHAT was owed, and the target is exactly the
        // session that already failed to answer once.
        const subject = row.brief === undefined || row.brief === '' ? '' : `「${row.brief}」`
        actions.push({
          severity: 'normal',
          text: `催办 ${row.taskId} → ${row.team}（等待 ${ageText(row.startedAt, now)} 无回执）${subject}`,
          brief: `a2a_route 催收回执：task ${row.taskId}（team ${row.team}）${subject === '' ? '' : `原任务「${row.brief}」`}已派发 ${ageText(row.startedAt, now)}，请回报结果或回执。`,
        })
      }
    }
    for (const row of state.sessions ?? []) {
      if (row.live !== true) {
        actions.push({ severity: 'normal', text: `冷会话 ${displayName(row)}：在 GUI 打开该会话即可唤醒加入面` })
      }
    }
    for (const row of state.reconcile?.rows ?? []) {
      if (row.needsRepair === true) {
        actions.push({ severity: 'high', text: `reconcile 需修复：${row.id} ${row.error}` })
      }
    }
    const conflicts = state.idempotency?.conflicts ?? 0
    if (conflicts > 0) {
      actions.push({ severity: 'high', text: `幂等冲突 ${conflicts} 例：人工核查 UNIQUE-ization 流量` })
    }
    return actions
  }

  function renderPlan(): void {
    const pane = clear(planPane)
    if (last === null) return
    const actions = planActions(last)
    sectionCounts.get('plan')!.textContent = `${actions.length}`
    const head = el('div', 'wb-pane-head')
    head.textContent = actions.length === 0 ? '网络健康——无待办行动' : `待办行动 ${actions.length}`
    pane.appendChild(head)
    for (const action of actions) {
      const line = el('div', `wb-action${action.severity === 'high' ? ' wb-action-high' : ''}`)
      line.appendChild(el('span', 'wb-action-text')).textContent = action.text
      if (action.brief !== undefined) {
        const btn = el('button', 'wb-btn')
        btn.type = 'button'
        btn.textContent = '复制催办'
        btn.addEventListener('click', () => deps.copy(action.brief ?? ''))
        line.appendChild(btn)
      }
      pane.appendChild(line)
    }
    // Dispatch drafting — static inner form so textarea survives updates.
    const draftHead = el('div', 'wb-pane-subhead')
    draftHead.textContent = '派单起草（复制后在任一会话粘贴执行）'
    pane.appendChild(draftHead)
    pane.appendChild(draftForm)
  }

  // Dispatch draft form: created ONCE; renderPlan re-attaches the same node.
  const draftForm = el('div', 'wb-draft')
  const draftTarget = document.createElement('select')
  draftTarget.className = 'wb-select'
  const draftInput = document.createElement('textarea')
  draftInput.className = 'wb-textarea'
  draftInput.rows = 3
  draftInput.placeholder = '任务正文：目标、验收、期限…'
  const draftBtn = el('button', 'wb-btn wb-btn-primary')
  draftBtn.type = 'button'
  draftBtn.textContent = '复制任务书'
  draftBtn.addEventListener('click', () => {
    const target = draftTarget.value
    const message = draftInput.value.trim()
    if (target === '' || message === '') return
    deps.copy(`a2a_route 派单 → ${target}：\n${message}`)
  })
  draftForm.appendChild(draftTarget)
  draftForm.appendChild(draftInput)
  draftForm.appendChild(draftBtn)

  function renderDraftTargets(): void {
    const previous = draftTarget.value
    clear(draftTarget)
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = '选择目标队…'
    draftTarget.appendChild(empty)
    if (last === null) return
    const state = last
    const targets = new Map<string, string>()
    for (const row of state.sessions ?? []) {
      if (row.team !== undefined && row.team !== '') targets.set(row.team, `${displayName(row)}（会话队）`)
    }
    for (const row of state.canvas?.teams ?? []) targets.set(row.team, `${row.name}（canvas 队）`)
    for (const row of state.remote ?? []) targets.set(row.team, `${displayName(row)}（远端）`)
    for (const [team, label] of targets) {
      const opt = document.createElement('option')
      opt.value = team
      opt.textContent = `${label} · ${team}`
      draftTarget.appendChild(opt)
    }
    if (previous !== '' && targets.has(previous)) draftTarget.value = previous
  }

  // ── Inspector (overlay card over the stage; bottom sheet on narrow) ──
  function renderInspector(): void {
    const box = clear(inspectorBody)
    inspector.classList.toggle('is-open', selection !== undefined)
    if (selection === undefined) return
    const sel = selection
    const card = el('div', 'wb-card')
    // 0.6.13: session/log/peer faces moved to the chat drawer; 0.6.15 took
    // the remote rows with them (their metadata rides the chat head) — the
    // inspector keeps the canvas team card.
    if (sel.kind === 'canvas') {
      // Re-resolve the team from the freshest state: membership changes here
      // must be visible on the next render even though the click-time row is
      // a stale snapshot.
      const fresh = (last?.canvas?.teams ?? []).find(t => t.name === sel.row.name) ?? sel.row
      textRow(card, 'Canvas 队', fresh.name)
      textRow(card, '路由队', fresh.team)
      const head = el('div', 'wb-side-head')
      head.textContent = `成员 · ${fresh.members.length}`
      card.appendChild(head)
      if (fresh.members.length === 0) {
        const empty = el('div', 'wb-muted')
        empty.textContent = '空队——用下方表单添加成员'
        card.appendChild(empty)
      }
      for (const member of fresh.members) {
        const row = el('div', 'wb-member-row')
        const dot = member.remote === true ? '◇ 远端' : member.live === true ? '● 现场' : member.joined === true ? '○ 冷启' : '· 未入网'
        row.appendChild(el('span', 'wb-member-dot')).textContent = dot
        const label = el('span', 'wb-member-label')
        const session = (last?.sessions ?? []).find(s => s.id === member.id)
        label.textContent = member.remote === true ? member.id : (session !== undefined ? displayName(session) : member.id)
        label.title = member.team ?? member.id
        row.appendChild(label)
        const remove = el('button', 'wb-member-remove')
        remove.type = 'button'
        remove.textContent = '移除'
        remove.addEventListener('click', async () => {
          remove.disabled = true
          if (!(await deps.canvasOp('remove-member', fresh.name, member.id))) remove.disabled = false
        })
        row.appendChild(remove)
        card.appendChild(row)
      }
      // Add-member form: static DOM re-mounted per poll (draftForm trick) —
      // rebuilt only when the inspected team changes.
      if (canvasForm?.name !== fresh.name) {
        const form = el('form', 'wb-member-add')
        const pick = document.createElement('select')
        pick.className = 'wb-member-pick'
        pick.setAttribute('aria-label', '选择成员')
        const manual = document.createElement('input')
        manual.type = 'text'
        manual.className = 'wb-member-manual'
        manual.placeholder = '或输入远端句柄 zone/id8'
        manual.setAttribute('aria-label', '远端成员句柄')
        const submit = el('button', 'wb-member-submit')
        submit.type = 'submit'
        submit.textContent = '添加'
        form.appendChild(pick)
        form.appendChild(manual)
        form.appendChild(submit)
        form.addEventListener('submit', async ev => {
          ev.preventDefault()
          const handle = manual.value.trim()
          const id = handle !== '' ? handle : pick.value
          if (id === '') return
          submit.disabled = true
          const ok = await deps.canvasOp('add-member', fresh.name, id)
          submit.disabled = false
          if (ok) manual.value = ''
        })
        canvasForm = { name: fresh.name, form, pick, manual }
      }
      // Refresh the picker's options from the freshest state, preserving the
      // current choice (sessions/remote rows churn across polls).
      const pick = canvasForm.pick
      const keep = pick.value
      clear(pick)
      pick.appendChild(new Option('本机会话（现场/冷启动）…', '', true, true))
      const memberIds = new Set(fresh.members.map(member => member.id))
      for (const session of last?.sessions ?? []) {
        if (memberIds.has(session.id)) continue
        pick.appendChild(new Option(`${displayName(session)} — 本机`, session.id))
      }
      let remoteLabeled = false
      for (const remote of last?.remote ?? []) {
        if (memberIds.has(remote.team)) continue
        if (!remoteLabeled) {
          pick.appendChild(new Option('远端会话队（目录卡片）…', '', true, false))
          remoteLabeled = true
        }
        pick.appendChild(new Option(`${displayName(remote)} — 远端`, remote.team))
      }
      if (keep !== '' && Array.from(pick.options).some(option => option.value === keep)) pick.value = keep
      card.appendChild(canvasForm.form)
      const hint = el('div', 'wb-hint')
      hint.textContent =
        '成员由人类在此手工分配（agent 不可自组队）。远端成员走对端目录路由，不做本机冷唤醒；地址由目录在派发时重解析。'
      card.appendChild(hint)
      // Quick dispatch targets the canvas ROUTING team (0.6.9): local tiers
      // first, then the remote members in order — the seam's own priority.
      if (deps.dispatchQuick !== undefined) card.appendChild(dispatchCard(fresh.team))
    }
    box.appendChild(card)
  }

  // ── Quick dispatch (0.6.9) ──
  // One human-typed message to a routing team, no session opened. The form
  // is cached per target team (draftForm trick) so the textarea draft and
  // the result note survive the 3s poll remount.
  function buildDispatchForm(target: string): { form: HTMLFormElement; text: HTMLTextAreaElement; note: HTMLElement } {
    const form = el('form', 'wb-dispatch-form')
    const text = document.createElement('textarea')
    text.className = 'wb-dispatch-text'
    text.placeholder = '一句话任务…（≤4000 字符，异步送达，回执进台账）'
    text.setAttribute('aria-label', '快派消息')
    const submit = el('button', 'wb-dispatch-submit')
    submit.type = 'submit'
    submit.textContent = '发送'
    const note = el('div', 'wb-dispatch-note')
    form.appendChild(text)
    form.appendChild(submit)
    form.appendChild(note)
    // 0.6.17 chat-UI conventions (deepseek-harness composer): Enter sends,
    // Shift+Enter is a soft newline, IME composition is never hijacked.
    text.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return
      if (ev.isComposing) return
      ev.preventDefault()
      if (!submit.disabled) form.requestSubmit()
    })
    form.addEventListener('submit', async ev => {
      ev.preventDefault()
      const message = text.value.trim()
      if (message === '' || submit.disabled) return
      submit.disabled = true
      note.textContent = '派发中…'
      let outcome: { ok: boolean; task_id?: string; reply?: string; error?: string }
      try {
        outcome = await (deps.dispatchQuick?.(target, message) ?? Promise.resolve({ ok: false, error: 'dispatch unavailable' }))
      } catch (error) {
        outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      submit.disabled = false
      if (outcome.ok === true) {
        // Sent: clear the composer like every chat surface and hand the
        // caret back — the submit round-trip must not strand focus.
        text.value = ''
      }
      text.focus({ preventScroll: true })
      note.textContent = outcome.ok === true
        ? `已派发${outcome.task_id !== undefined ? ` · ${outcome.task_id}` : ''} · 回执将入台账（待回执）`
        : `失败：${outcome.error ?? '未知原因'}`
    })
    return { form, text, note }
  }

  function dispatchCard(target: string): HTMLElement {
    const wrap = el('div', 'wb-dispatch')
    const head = el('div', 'wb-side-head')
    head.textContent = '快派'
    wrap.appendChild(head)
    if (dispatchForm?.team !== target) dispatchForm = { team: target, ...buildDispatchForm(target) }
    wrap.appendChild(dispatchForm.form)
    return wrap
  }

  function openChat(target: ChatTarget): void {
    chat.open(target)
    root.classList.remove('is-rail-open')
  }

  /** Board picks (0.6.13): resolve a node id against the latest state. */
  function openNodeChat(id: string): void {
    if (last === null) return
    const session = (last.sessions ?? []).find(row => row.id === id)
    if (session !== undefined) {
      openChat({ kind: 'session', id, title: displayName(session), sub: session.team, team: session.team, live: session.live })
      return
    }
    if (id.startsWith('peer-')) {
      const host = id.slice('peer-'.length)
      const peer = (last.peers ?? []).find(row => row.url.includes(host))
      openChat({ kind: 'peer', id, title: peer !== undefined ? peer.url : host, sub: host, url: peer?.url })
      return
    }
    const log = logRows.find(row => row.id === id)
    if (log !== undefined) openChat({ kind: 'log', id, title: `…${id.slice(-12)}`, sub: '档案' })
  }

  // ── Header ──
  // Results first (owner signal, 0.6.24): the header carries the verdict —
  // exceptions only, one pill each; a healthy host says so quietly. The
  // forensic counters that used to sit here (idempotency claims/replays,
  // reconcile state) read on the ledger's 取证 line instead.
  function renderHeader(): void {
    versionBadge.textContent = last?.version !== undefined ? `v${last.version}` : 'v?'
    const box = clear(headerStats)
    if (last === null) return
    const alerts: Array<{ text: string; tone: 'warn' | 'danger'; title: string }> = []
    const dead = last.tasksDead?.length ?? 0
    if (dead > 0) alerts.push({ text: `死信 ${dead}`, tone: 'danger', title: '超过 24h TTL 仍未结算的任务，需在台账清账' })
    const stale = last.tasksStaleCount ?? 0
    if (stale > 0) alerts.push({ text: `陈旧 ${stale}`, tone: 'warn', title: '≥1h 无回执的旧账（含免回执行），到 24h TTL 自动转死信' })
    const conflicts = last.idempotency?.conflicts ?? 0
    if (conflicts > 0) alerts.push({ text: `幂等冲突 ${conflicts}`, tone: 'danger', title: '同一幂等键对应了不同载荷，需人工核查' })
    const repair = (last.reconcile?.rows ?? []).filter(row => row.needsRepair === true).length
    if (repair > 0) alerts.push({ text: `需修复 ${repair}`, tone: 'danger', title: 'reconcile 无法自动恢复的会话，见行动计划' })
    if (alerts.length === 0) {
      box.appendChild(el('span', 'wb-header-ok')).textContent = '● 无异常'
      return
    }
    for (const a of alerts) {
      const pill = el('span', `wb-alert wb-alert-${a.tone}`)
      pill.textContent = a.text
      pill.title = a.title
      box.appendChild(pill)
    }
  }

  function update(state: StateBody | null): void {
    last = state
    // 0.6.12: refresh the readable-log list opportunistically (single flight;
    // the sidebar re-renders when rows land, mid-poll remount is idempotent).
    if (deps.sessionLogList !== undefined && !logRowsBusy) {
      logRowsBusy = true
      deps.sessionLogList().then(result => {
        logRows = result.ok && result.sessions !== undefined ? result.sessions : []
      }).catch(() => {}).finally(() => {
        logRowsBusy = false
        renderSidebar()
      })
    }
    renderHeader()
    renderSidebar()
    renderDraftTargets()
    renderHosts()
    renderLedger()
    // The open chat drawer refreshes in place (head + receipt statuses); its
    // thread and composer are never rebuilt by the poll.
    chat.update(state)
    renderActivity()
    renderPlan()
    renderInspector()
    // Mode is availability-derived every poll: canvas face down → data mode,
    // the board deactivates and the panes return to the stage stack.
    syncMode()
    syncSections()
  }

  function selectTab(key: WorkbenchTab): void {
    if (key === 'board') {
      syncMode()
      return
    }
    collapsed.delete(key)
    syncSections()
  }

  update(null)
  return { root, update, mode: () => mode, selectTab, openNodeChat }
}
