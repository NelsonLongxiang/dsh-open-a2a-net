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
import { createRailTabs } from './wb-rail'
import { DIRECTORY_FILTERS, learnLogTitle, loadLogTitles, renderDirectory, type DirFilter } from './wb-directory'
import { ledgerFacts, renderLedger as paintLedger } from './wb-ledger'

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

/** gh#31: one archived row from /state `archived` (newest first) — the
 *  per-task outcome for a task that left the ledger. Fields past `summary`
 *  are absent on hosts that predate them. */
export interface ArchivedRow {
  readonly taskId: string
  readonly team: string
  readonly resolvedAt: number
  readonly outcome: string
  readonly summary?: string
  readonly peer?: string
  readonly startedAt?: number
  /** How the row left the book: a receipt, a content echo, or the caller
   *  (abandon / cancel — both archive with outcome 'abandoned'). */
  readonly endedBy?: 'receipt' | 'echo' | 'abandoned' | 'cancelled'
  /** A receipt arrived after the caller had already ended the row. */
  readonly late?: boolean
  readonly direction?: 'inbound' | 'outbound'
  readonly brief?: string
}

/** gh#41: one tracked peer's published canvas organization (full-card
 *  canvasOrg) — the board renders REMOTE team frames from these rows. */
export interface PeerOrgRow {
  readonly url: string
  readonly org: ReadonlyArray<{ name: string; team: string; members: readonly string[] }>
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
  /** gh#41 fleet planning: each tracked peer's published canvas org. */
  readonly peerOrg?: readonly PeerOrgRow[]
  readonly archivedCount?: number
  /** Settled-archive split by verdict (the receipt outcome vocabulary — 'completed' | 'rejected' | 'failed' | … | 'abandoned' — or 'unclassified'). */
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
  /** gh#41 fleet planning: each tracked peer's published canvas org. */
  peerOrg?: readonly PeerOrgRow[]
  /** gh#34: read the owner three-key panel state (GET /__dsh_a2a/owner-settings). */
  ownerSettingsRead?(): Promise<{ ok: boolean; teamJoinAllowlist?: string[]; teamScopeInfo?: boolean; announce?: boolean; announceRestartPending?: boolean; error?: string }>
  /** gh#34: write owner panel changes; true on success (POST the same face). */
  ownerSettingsWrite?(changes: { teamJoinAllowlist?: string[]; teamScopeInfo?: boolean; announce?: boolean }): Promise<{ ok: boolean; restartNeeded?: boolean; error?: string }>
  /** gh#41 fleet planning: regulate a REMOTE peer's canvas team (this host
   *  signs the envelope and forwards; the peer's link gate authorizes). */
  fleetCanvasOp?(peer: string, op: 'create' | 'add-member' | 'remove-member', name: string, id?: string): Promise<{ ok: boolean; members?: string[]; error?: string }>
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
  sessionLogList?(): Promise<{ ok: boolean; sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>; count?: number; error?: string }>
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

/** Rail tabs (2026-10-23): 主机 moved up next to 目录 — host health was the
 *  last accordion section and sat below the fold. */
const SECTION_DEFS: ReadonlyArray<{ key: WorkbenchSection; label: string }> = [
  { key: 'directory', label: '目录' },
  { key: 'hosts', label: '主机' },
  { key: 'ledger', label: '台账' },
  { key: 'activity', label: '活动' },
  { key: 'plan', label: '规划' },
]

export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const board = deps.board
  let mode: WorkbenchMode = 'data'
  let selection: Selection
  let last: StateBody | null = null
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
  /** How many logs the host holds (the list face caps at 50); from the listing's count. */
  let logTotal: number | undefined
  /** Learned 本机日志 titles: the first user line of a transcript, captured
   *  when the chat drawer loads it (the list face carries no titles). */
  const logTitles = loadLogTitles()
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
  // gh#34 owner three-key panel: the header gear opens the inspector panel
  // (teamJoinAllowlist / teamScopeInfo / announce) — 远程建联三件不再翻配置文件。
  const ownerBtn = el('button', 'wb-icon-btn wb-owner-btn')
  ownerBtn.type = 'button'
  ownerBtn.dataset.testid = 'wb-owner-btn'
  ownerBtn.setAttribute('aria-label', '主人设置（三键面板）')
  ownerBtn.title = '主人设置：入网白名单 / 可见性 / 发布'
  ownerBtn.textContent = '⚙'
  ownerBtn.addEventListener('click', () => { ownerPanelOpen = !ownerPanelOpen; renderOwnerPanel() })
  header.appendChild(ownerBtn)
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
  // Rail tabs (2026-10-23, wb-rail): one panel per pane, each with its own
  // scroll. Panes are created once and re-parented between tab panels
  // (canvas mode) and the stage stack (data mode).
  const railTabs = createRailTabs(SECTION_DEFS)
  const rail = railTabs.root

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
  railTabs.panel('directory').appendChild(directoryTools)
  railTabs.panel('directory').appendChild(directoryBody)

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
    onTranscript: (target, messages) => {
      if (target.kind !== 'log' && target.kind !== 'session') return
      if (learnLogTitle(logTitles, target.id, messages)) renderSidebar()
    },
  })

  stage.appendChild(dataStack)
  body.appendChild(rail)
  body.appendChild(stage)
  body.appendChild(inspector)
  body.appendChild(chat.root)
  root.appendChild(header)
  root.appendChild(body)

  /** Move the data panes to their mode home: rail sections while the board
   *  owns the stage, the stage stack when the board is out. */
  function placePanes(m: WorkbenchMode): void {
    for (const [key, pane] of dataPanes) {
      const home = m === 'canvas' ? railTabs.panel(key) : dataStack
      // Data mode: the pane lives on the stage, so its tab steps aside.
      railTabs.setHidden(key, m !== 'canvas')
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
    // Filter chips reflect the live view state (built once, toggled here).
    for (let i = 0; i < filterRow.children.length; i++) {
      const node = filterRow.children[i] as HTMLElement
      node.classList.toggle('is-active', node.dataset.filter === dirFilter)
    }
    if (last === null) {
      directoryBody.replaceChildren(el('div', 'wb-muted'))
      directoryBody.firstElementChild!.textContent = '载入中…'
      railTabs.setBadge('directory', '')
      return
    }
    const badge = renderDirectory(directoryBody, {
      state: last,
      logs: logRows,
      logTotal,
      titles: logTitles,
      search: searchText,
      filter: dirFilter,
      now: deps.now(),
      openChat,
      selectCanvas: (row) => select({ kind: 'canvas', row }),
    })
    railTabs.setBadge('directory', badge)
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
      railTabs.setBadge('hosts', '')
      return
    }
    const now = deps.now()
    const peers = [...(last.peers ?? [])].sort((a, b) => {
      const rank = (row: { link?: string }): number => row.link === 'linked' ? 0 : 1
      return rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0)
    })
    railTabs.setBadge('hosts', peers.length > 0 ? `${peers.filter(row => row.link === 'linked').length}/${peers.length}` : '')
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

  // ── Ledger pane (wb-ledger) ──
  function renderLedger(): void {
    if (last === null) { ledgerPane.replaceChildren(); railTabs.setBadge('ledger', ''); return }
    const state = last
    const resolve = (team: string): ChatTarget | undefined => {
      const session = (state.sessions ?? []).find(row => row.team === team)
      if (session !== undefined) return { kind: 'session', id: session.id, title: displayName(session), sub: session.team, team: session.team, live: session.live }
      const remote = (state.remote ?? []).find(row => row.team === team)
      if (remote !== undefined) return { kind: 'remote', team: remote.team, title: displayName(remote), sub: remote.team, row: remote }
      return undefined
    }
    const out = paintLedger(ledgerPane, {
      state,
      now: deps.now(),
      abandon: (taskId, reason) => deps.abandon(taskId, reason),
      canOpenTeam: (team) => resolve(team) !== undefined,
      openTeam: (team) => {
        const target = resolve(team)
        if (target === undefined) return false
        openChat(target)
        return true
      },
    })
    railTabs.setBadge('ledger', out.badge, out.tone)
  }

  // ── Activity pane ──
  /** The readable name behind a routing team id — a session, a remote node
   *  or a canvas team on the last state — or undefined when none matches
   *  (review 2026-10-27: activity and plan rows read bare `dsh/1111…` ids).
   *  An empty name counts as no match: displayName's `??` keeps '', and a
   *  peer can publish one. `remote` marks a name the PEER chose — it can
   *  collide with a local session's, so callers must show where it is from. */
  function teamName(state: StateBody, team: string): { name: string; remote: boolean } | undefined {
    const named = (name: string | undefined, remote: boolean) => name !== undefined && name.trim() !== '' ? { name, remote } : undefined
    const s = (state.sessions ?? []).find(r => r.team === team)
    if (s !== undefined) return named(displayName(s), false)
    const r = (state.remote ?? []).find(x => x.team === team)
    if (r !== undefined) return named(displayName(r), true)
    return named((state.canvas?.teams ?? []).find(t => t.team === team)?.name, false)
  }
  /** A name for plain text: a peer-published one says it is remote. */
  function teamLabel(state: StateBody, team: string): string {
    const n = teamName(state, team)
    return n === undefined ? team : n.remote ? `${n.name}（远端）` : n.name
  }
  /** A team cell: the name when known (the id rides the tooltip), else the
   *  id; a peer-published name carries a visible 远端 chip. */
  function teamCell(line: HTMLElement, state: StateBody, team: string): void {
    const cell = line.appendChild(el('span', 'wb-row-team'))
    const n = teamName(state, team)
    cell.textContent = n?.name ?? team
    cell.title = team
    if (n?.remote === true) {
      const chip = cell.appendChild(el('span', 'wb-row-remote'))
      chip.textContent = '远端'
      chip.title = '名字由对端自行发布'
    }
  }

  function renderActivity(): void {
    const pane = clear(activityPane)
    if (last === null) return
    const now = deps.now()
    const flights = last.inFlight ?? []
    railTabs.setBadge('activity', flights.length > 0 ? String(flights.length) : '', flights.length > 0 ? 'accent' : undefined)
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
        teamCell(line, last, row.team)
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
      teamCell(line, last, row.team)
      line.appendChild(el('span', 'wb-row-meta')).textContent = `${row.peer} · ${ageText(row.ts, now)}`
      line.appendChild(el('span', 'wb-row-badges')).textContent = row.ok === true ? '' : '失败'
      pane.appendChild(line)
    }
  }

  // ── Plan pane: derived actions + dispatch drafting ──
  function planActions(state: StateBody): Array<{ severity: 'high' | 'normal'; text: string; brief?: string }> {
    const now = deps.now()
    const actions: Array<{ severity: 'high' | 'normal'; text: string; brief?: string }> = []
    // One definition with the 台账 tab: fire-forget expiries are bookkeeping,
    // not dead letters (review L1), and only OUR stale sends are nudgeable.
    const facts = ledgerFacts(state, now)
    if (facts.deadLetters.length > 0) {
      actions.push({ severity: 'high', text: `清账 ${facts.deadLetters.length} 条死信（目标早已离开或死信化，无回执可期）` })
    }
    // (The old `age > 1h && settleable === true` never fired against a real
    // host — the server's settleable means receipt-expected AND age < 1h.)
    for (const row of facts.stale) {
      // Quote the original ask: a nudge that only repeats a task id makes
      // the target re-derive WHAT was owed, and the target is exactly the
      // session that already failed to answer once.
      const subject = row.brief === undefined || row.brief === '' ? '' : `「${row.brief}」`
      actions.push({
        severity: 'normal',
        text: `催办 ${row.taskId} → ${teamLabel(state, row.team)}（等待 ${ageText(row.startedAt, now)} 无回执）${subject}`,
        brief: `a2a_route 催收回执：task ${row.taskId}（team ${row.team}）${subject === '' ? '' : `原任务「${row.brief}」`}已派发 ${ageText(row.startedAt, now)}，请回报结果或回执。`,
      })
    }
    // Cold sessions are one action, not one per session: they share the same
    // remedy (open them in the GUI), and a list of identical lines buried the
    // actions that differ.
    const cold = (state.sessions ?? []).filter(row => row.live !== true).map(row => displayName(row))
    if (cold.length > 0) {
      const names = cold.slice(0, 3).join('、') + (cold.length > 3 ? ` 等 ${cold.length} 个` : '')
      actions.push({ severity: 'normal', text: `冷会话 ${cold.length} 个（${names}）：在 GUI 打开即可唤醒加入面` })
    }
    for (const row of state.reconcile?.rows ?? []) {
      if (row.needsRepair === true) {
        // Name the session; the id stays for the operator who greps logs.
        const s = (state.sessions ?? []).find(x => x.id === row.id)
        const who = s !== undefined ? `${displayName(s)}（${row.id}）` : row.id
        actions.push({ severity: 'high', text: `reconcile 需修复：${who} ${row.error}` })
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
    railTabs.setBadge('plan', actions.length > 0 ? String(actions.length) : '', actions.some(a => a.severity === 'high') ? 'danger' : undefined)
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
  // gh#34 owner panel state + render (the gear toggles; the inspector hosts).
  let ownerPanelOpen = false
  let ownerState: { teamJoinAllowlist: string[]; teamScopeInfo: boolean; announce: boolean; announceRestartPending: boolean } | null = null
  function renderOwnerPanel(): void {
    renderInspector()
    if (!ownerPanelOpen) return
    void deps.ownerSettingsRead?.().then(result => {
      if (!ownerPanelOpen) return
      if (result.ok !== true) { ownerState = null; renderInspector(); return }
      ownerState = {
        teamJoinAllowlist: result.teamJoinAllowlist ?? [],
        teamScopeInfo: result.teamScopeInfo !== false,
        announce: result.announce === true,
        announceRestartPending: result.announceRestartPending === true,
      }
      renderInspector()
    })
  }
  function renderOwnerPanelInto(box: HTMLElement): void {
    const card = el('div', 'wb-card')
    const head = el('div', 'wb-inspector-head')
    head.appendChild(el('span', 'wb-inspector-title')).textContent = '主人设置'
    const closeBtn = el('button', 'wb-icon-btn')
    closeBtn.type = 'button'
    closeBtn.setAttribute('aria-label', '关闭主人设置')
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => { ownerPanelOpen = false; renderInspector() })
    head.appendChild(closeBtn)
    card.appendChild(head)
    if (deps.ownerSettingsRead === undefined) {
      const note = el('div', 'wb-hint')
      note.textContent = '此宿主未提供主人设置面（旧版本）——升级后可用。'
      card.appendChild(note)
      box.appendChild(card)
      return
    }
    if (ownerState === null) {
      const note = el('div', 'wb-hint')
      note.textContent = '读取中…'
      card.appendChild(note)
      box.appendChild(card)
      return
    }
    const st = ownerState
    // ① 入网白名单（精确团队名增删）
    const alHead = el('div', 'wb-side-head')
    alHead.textContent = '入网白名单（精确团队名）'
    card.appendChild(alHead)
    for (const name of st.teamJoinAllowlist) {
      const row = el('div', 'wb-member-row')
      row.appendChild(el('span', 'wb-member-label')).textContent = name
      const del = el('button', 'wb-member-remove')
      del.type = 'button'
      del.textContent = '移除'
      del.addEventListener('click', () => {
        void deps.ownerSettingsWrite?.({ teamJoinAllowlist: st.teamJoinAllowlist.filter(n => n !== name) }).then(() => renderOwnerPanel())
      })
      row.appendChild(del)
      card.appendChild(row)
    }
    const addForm = el('div', 'wb-member-add')
    const input = el('input', 'wb-member-manual')
    input.type = 'text'
    input.placeholder = 'dsh/团队名（精确，无通配）'
    input.setAttribute('aria-label', '新增白名单团队名')
    const addBtn = el('button', 'wb-member-submit')
    addBtn.type = 'button'
    addBtn.textContent = '加入'
    const doAdd = (): void => {
      const v = input.value.trim()
      if (v === '' || st.teamJoinAllowlist.includes(v)) return
      void deps.ownerSettingsWrite?.({ teamJoinAllowlist: [...st.teamJoinAllowlist, v] }).then(() => renderOwnerPanel())
    }
    addBtn.addEventListener('click', doAdd)
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') doAdd() })
    addForm.append(input, addBtn)
    card.appendChild(addForm)
    // ② 可见性开关 + 精度固化文案
    const tsHead = el('div', 'wb-side-head')
    tsHead.textContent = '目录可见性（teamScopeInfo）'
    card.appendChild(tsHead)
    const tsRow = el('div', 'wb-member-row')
    const tsBtn = el('button', 'wb-member-submit')
    tsBtn.type = 'button'
    tsBtn.textContent = st.teamScopeInfo ? '已开：仅显示已加入团队（点击放开为全舰队可见）' : '已关：全舰队可见（点击收窄为已加入团队）'
    tsBtn.addEventListener('click', () => {
      void deps.ownerSettingsWrite?.({ teamScopeInfo: !st.teamScopeInfo }).then(() => renderOwnerPanel())
    })
    tsRow.appendChild(tsBtn)
    card.appendChild(tsRow)
    const tsNote = el('div', 'wb-hint')
    tsNote.textContent = '精度说明：teamScopeInfo 只管「目录显示范围」。关上它不会解锁任何通信准入——会话入网（S3）与目标级路由（F5）规则原样生效。'
    card.appendChild(tsNote)
    // ③ 发布开关（重启生效）
    const anHead = el('div', 'wb-side-head')
    anHead.textContent = '节点发布（announce）'
    card.appendChild(anHead)
    const anRow = el('div', 'wb-member-row')
    const anBtn = el('button', 'wb-member-submit')
    anBtn.type = 'button'
    anBtn.textContent = st.announce ? '已开：本节点发布签名卡（点击关闭）' : '已关：本节点不发布（点击开启——重启宿主后生效）'
    anBtn.addEventListener('click', () => {
      void deps.ownerSettingsWrite?.({ announce: !st.announce }).then(() => renderOwnerPanel())
    })
    anRow.appendChild(anBtn)
    card.appendChild(anRow)
    if (st.announceRestartPending) {
      const anNote = el('div', 'wb-hint')
      anNote.textContent = '有 announce 变更待生效：重启宿主后按新配置发布。'
      card.appendChild(anNote)
    }
    box.appendChild(card)
  }

  function renderInspector(): void {
    const box = clear(inspectorBody)
    // gh#34: the owner panel owns the inspector when open (selection cards
    // yield; the gear closes it back).
    if (ownerPanelOpen) { inspector.classList.add('is-open'); renderOwnerPanelInto(box); return }
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
        // gh#37: only zone/id8 HANDLES are addable members — a bare zone row
        // (the peer's own team card, e.g. 'dsh') fails the backend shape
        // gate and the old picker offered it anyway: the owner clicked 远端,
        // got refused, and read the feature as broken. Rows without a '/'
        // are skipped; when the directory carries no handles at all the
        // hint explains why (unlinked peers serve the minimal card, which
        // carries no session teams) instead of offering dead options.
        if (!remote.team.includes('/')) continue
        if (memberIds.has(remote.team)) continue
        if (!remoteLabeled) {
          pick.appendChild(new Option('远端会话队（目录卡片）…', '', true, false))
          remoteLabeled = true
        }
        pick.appendChild(new Option(`${displayName(remote)} — 远端`, remote.team))
      }
      if (!remoteLabeled) {
        pick.appendChild(new Option('（暂无可拉入的远端会话队——见下方说明）', '', true, false))
      }
      if (keep !== '' && Array.from(pick.options).some(option => option.value === keep)) pick.value = keep
      card.appendChild(canvasForm.form)
      const hint = el('div', 'wb-hint')
      hint.textContent =
        '成员由人类在此手工分配（agent 不可自组队）。远端成员走对端目录路由，不做本机冷唤醒；地址由目录在派发时重解析。远端下拉只列 zone/id8 会话句柄——若为空，说明目录里还没有已链接对端的会话队（未链接的对端只给最小卡）；此时可在输入框手输句柄（如 dsh/xxxxxxxx）先把人拉进来，句柄本身即链接手势。'
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
    // An unknown version says nothing: hide the badge rather than print 'v?'.
    versionBadge.textContent = last?.version !== undefined ? `v${last.version}` : ''
    versionBadge.hidden = last?.version === undefined
    const box = clear(headerStats)
    if (last === null) return
    // Each pill is a way in: it opens the tab (and ledger group) that holds
    // the rows behind its count.
    const alerts: Array<{ text: string; tone: 'warn' | 'danger'; title: string; tab: 'ledger' | 'plan' | 'activity'; group?: string }> = []
    // Same definitions as the 台账 tab (wb-ledger ledgerFacts): fire-forget
    // expiries are not dead letters, receiptless rows are never stale.
    const facts = ledgerFacts(last, deps.now())
    const dead = facts.deadLetters.length
    if (dead > 0) alerts.push({ text: `死信 ${dead}`, tone: 'danger', title: '超过 24h TTL 仍未结算的任务（unconsumed），需在台账清账', tab: 'ledger', group: '死信' })
    const stale = facts.stale.length
    if (stale > 0) alerts.push({ text: `陈旧 ${stale}`, tone: 'warn', title: '我方派发、要回执、已等待 ≥1h 仍未回执（可催办；免回执行不算）', tab: 'ledger', group: '陈旧' })
    const owed = facts.owedOverdue.length
    if (owed > 0) alerts.push({ text: `欠回执 ${owed}`, tone: 'warn', title: '对方投递给本机、已等待本机回执超过 1 小时', tab: 'ledger', group: '待本机回执' })
    const conflicts = last.idempotency?.conflicts ?? 0
    if (conflicts > 0) alerts.push({ text: `幂等冲突 ${conflicts}`, tone: 'danger', title: '同一幂等键对应了不同载荷，需人工核查', tab: 'ledger', group: '取证' })
    const repair = (last.reconcile?.rows ?? []).filter(row => row.needsRepair === true).length
    if (repair > 0) alerts.push({ text: `需修复 ${repair}`, tone: 'danger', title: 'reconcile 无法自动恢复的会话，见行动计划', tab: 'plan' })
    if (alerts.length === 0) {
      box.appendChild(el('span', 'wb-header-ok')).textContent = '● 无异常'
      return
    }
    for (const a of alerts) {
      const pill = el('button', `wb-alert wb-alert-${a.tone}`)
      pill.type = 'button'
      pill.textContent = a.text
      pill.title = `${a.title}（点击查看）`
      pill.addEventListener('click', () => openAlert(a.tab, a.group))
      box.appendChild(pill)
    }
  }

  /** Open the pane behind a header pill. With the board up the panes are
   *  rail tabs (on a narrow screen the rail slides in first); without it they
   *  sit on the stage. A ledger group (or the 取证 fold) scrolls into view. */
  function openAlert(tab: 'ledger' | 'plan' | 'activity', group?: string): void {
    const pane = dataPanes.find(([k]) => k === tab)![1]
    if (mode === 'canvas') {
      root.classList.add('is-rail-open')
      railTabs.select(tab, { focus: false })
    }
    const target = group === undefined ? pane
      : group === '取证' ? pane.querySelector<HTMLDetailsElement>('details.wb-led-forensics')
        : Array.from(pane.querySelectorAll<HTMLElement>('.wb-led-group')).find(g => g.dataset.group === group) ?? null
    if (target === null) return
    if (target instanceof HTMLDetailsElement) target.open = true
    target.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  function update(state: StateBody | null): void {
    last = state
    // 0.6.12: refresh the readable-log list opportunistically (single flight;
    // the sidebar re-renders when rows land, mid-poll remount is idempotent).
    if (deps.sessionLogList !== undefined && !logRowsBusy) {
      logRowsBusy = true
      deps.sessionLogList().then(result => {
        logRows = result.ok && result.sessions !== undefined ? result.sessions : []
        logTotal = result.ok ? result.count : undefined
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
  }

  function selectTab(key: WorkbenchTab): void {
    if (key === 'board') {
      syncMode()
      return
    }
    railTabs.select(key)
  }

  update(null)
  return { root, update, mode: () => mode, selectTab, openNodeChat }
}
