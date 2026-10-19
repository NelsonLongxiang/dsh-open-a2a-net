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
}

/** One canvas team from /state `canvas.teams`. */
export interface CanvasTeamRow {
  readonly name: string
  readonly team: string
  readonly members: ReadonlyArray<{ id: string; team?: string; joined?: boolean; live?: boolean }>
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
  readonly peers?: ReadonlyArray<{ url: string; score?: number }>
  readonly remote?: readonly RemoteRow[]
  readonly activity?: readonly ActivityRow[]
  readonly inFlight?: ReadonlyArray<{ team: string; peer: string; startedAt: number }>
  readonly tasks?: readonly PendingRow[]
  readonly tasksStaleCount?: number
  readonly tasksDead?: readonly DeadRow[]
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
  /** Copy text to the clipboard; drafts are pasteable task briefs. */
  copy(text: string): void
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
  | { kind: 'session'; row: SessionRow }
  | { kind: 'remote'; row: RemoteRow }
  | { kind: 'canvas'; row: CanvasTeamRow }
  | { kind: 'peer'; row: { url: string; score?: number } }
  | undefined

/** The four rail sections. */
export type WorkbenchSection = 'directory' | 'ledger' | 'activity' | 'plan'

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
}

const SECTION_DEFS: ReadonlyArray<{ key: WorkbenchSection; label: string }> = [
  { key: 'directory', label: '目录' },
  { key: 'ledger', label: '台账' },
  { key: 'activity', label: '活动' },
  { key: 'plan', label: '规划' },
]

export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const board = deps.board
  let mode: WorkbenchMode = 'data'
  let selection: Selection
  let last: StateBody | null = null
  const collapsed = new Set<WorkbenchSection>(['activity', 'plan'])

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
  sectionBodies.get('directory')!.appendChild(directoryBody)

  const ledgerPane = el('section', 'wb-pane')
  const activityPane = el('section', 'wb-pane')
  const planPane = el('section', 'wb-pane')
  const dataPanes: ReadonlyArray<[WorkbenchSection, HTMLElement]> = [
    ['ledger', ledgerPane],
    ['activity', activityPane],
    ['plan', planPane],
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

  stage.appendChild(dataStack)
  body.appendChild(rail)
  body.appendChild(stage)
  body.appendChild(inspector)
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
    renderInspector()
    // Narrow screens: picking from the drawer closes it so the stage shows.
    root.classList.remove('is-rail-open')
  }

  // ── Directory section ──
  function renderSidebar(): void {
    const box = clear(directoryBody)
    if (last === null) {
      box.appendChild(el('div', 'wb-muted')).textContent = '载入中…'
      sectionCounts.get('directory')!.textContent = ''
      return
    }
    const state = last
    const section = (label: string, count: number): HTMLElement => {
      const head = el('div', 'wb-side-head')
      head.textContent = `${label} · ${count}`
      box.appendChild(head)
      return box
    }
    const sessions = state.sessions ?? []
    const live = sessions.filter(row => row.live === true)
    const cold = sessions.filter(row => row.live !== true)
    sectionCounts.get('directory')!.textContent = `${live.length}/${cold.length}`
    section('本机 · 现场', live.length)
    for (const row of live) {
      const item = el('button', 'wb-item')
      item.type = 'button'
      item.appendChild(el('span', 'wb-dot wb-dot-live')).textContent = '●'
      item.appendChild(el('span', 'wb-item-label')).textContent = displayName(row)
      item.addEventListener('click', () => select({ kind: 'session', row }))
      box.appendChild(item)
    }
    if (cold.length > 0) {
      section('本机 · 冷启动', cold.length)
      for (const row of cold) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-cold')).textContent = '○'
        item.appendChild(el('span', 'wb-item-label')).textContent = displayName(row)
        item.addEventListener('click', () => select({ kind: 'session', row }))
        box.appendChild(item)
      }
    }
    const canvases = state.canvas?.teams ?? []
    if (canvases.length > 0) {
      section('Canvas 队', canvases.length)
      for (const row of canvases) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-canvas')).textContent = '▤'
        item.appendChild(el('span', 'wb-item-label')).textContent = `${row.name} · ${row.members.length}`
        item.addEventListener('click', () => select({ kind: 'canvas', row }))
        box.appendChild(item)
      }
    }
    const peers = state.peers ?? []
    if (peers.length > 0) {
      section('Peers', peers.length)
      for (const row of peers) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-peer')).textContent = '⇄'
        item.appendChild(el('span', 'wb-item-label')).textContent =
          row.url.replace(/^https?:\/\//, '') + (row.score !== undefined ? ` · ${row.score}` : '')
        item.addEventListener('click', () => select({ kind: 'peer', row }))
        box.appendChild(item)
      }
    }
    const remote = state.remote ?? []
    if (remote.length > 0) {
      section('远端节点', remote.length)
      for (const row of remote) {
        const item = el('button', 'wb-item')
        item.type = 'button'
        item.appendChild(el('span', 'wb-dot wb-dot-remote')).textContent = '◇'
        item.appendChild(el('span', 'wb-item-label')).textContent = displayName(row)
        item.addEventListener('click', () => select({ kind: 'remote', row }))
        box.appendChild(item)
      }
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
      const line = el('div', 'wb-row')
      const badges: string[] = []
      if (row.settleable === true) badges.push('可结算')
      if (row.receiptExpected === false) badges.push('无回执债')
      if (row.direction === 'inbound') badges.push('入站')
      line.appendChild(el('span', 'wb-row-id')).textContent = row.taskId
      line.appendChild(el('span', 'wb-row-team')).textContent = row.team
      const briefText = row.brief ?? ''
      const brief = el('span', 'wb-row-brief')
      brief.textContent = briefText
      brief.title = briefText
      line.appendChild(brief)
      line.appendChild(el('span', 'wb-row-meta')).textContent = ageText(row.startedAt, now)
      line.appendChild(el('span', 'wb-row-badges')).textContent = badges.join(' ')
      table.appendChild(line)
    }
    pane.appendChild(table)
    if (dead.length > 0) {
      const deadHead = el('div', 'wb-pane-subhead')
      deadHead.textContent = '死信（可清账）'
      pane.appendChild(deadHead)
      const deadTable = el('div', 'wb-table wb-table-dead')
      for (const row of dead) {
        const line = el('div', 'wb-row')
        line.appendChild(el('span', 'wb-row-id')).textContent = row.taskId
        line.appendChild(el('span', 'wb-row-team')).textContent = row.team
        const deadBriefText = row.brief ?? ''
        const deadBrief = el('span', 'wb-row-brief')
        deadBrief.textContent = deadBriefText
        deadBrief.title = deadBriefText
        line.appendChild(deadBrief)
        line.appendChild(el('span', 'wb-row-meta')).textContent = ageText(row.deadAt, now)
        const reason = el('span', 'wb-row-meta wb-muted')
        reason.textContent = row.reason ?? ''
        line.appendChild(reason)
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
    if (sel.kind === 'session') {
      textRow(card, '名称', displayName(sel.row))
      textRow(card, '状态', sel.row.live === true ? '现场' : '冷启动')
      textRow(card, '会话队', sel.row.team)
      textRow(card, '标签', sel.row.label)
      if (sel.row.workspace !== undefined) textRow(card, '工作区', sel.row.workspace)
      if (sel.row.description !== undefined) textRow(card, '说明', sel.row.description)
      for (const team of sel.row.teams ?? []) textRow(card, '成员队', team)
      textRow(card, '会话 ID', sel.row.id)
    } else if (sel.kind === 'remote') {
      textRow(card, '名称', displayName(sel.row))
      textRow(card, '队', sel.row.team)
      if (sel.row.origin !== undefined) textRow(card, '来源', sel.row.origin)
      if (sel.row.via !== undefined) textRow(card, '经', sel.row.via)
      if (sel.row.workspace !== undefined) textRow(card, '工作区', sel.row.workspace)
      if (sel.row.legacy === true) textRow(card, '形态', '旧卡片（legacy）')
    } else if (sel.kind === 'canvas') {
      textRow(card, 'Canvas 队', sel.row.name)
      textRow(card, '路由队', sel.row.team)
      for (const member of sel.row.members) {
        textRow(card, member.live === true ? '成员（现场）' : '成员', `${member.team ?? member.id}`)
      }
    } else {
      textRow(card, 'Peer', sel.row.url)
      textRow(card, '质量分', sel.row.score !== undefined ? String(sel.row.score) : '—')
    }
    box.appendChild(card)
  }

  // ── Header ──
  function renderHeader(): void {
    versionBadge.textContent = last?.version !== undefined ? `v${last.version}` : 'v?'
    const box = clear(headerStats)
    if (last === null) return
    const idem = last.idempotency
    if (idem !== undefined) {
      textRow(box, '幂等', `claims ${idem.claimsFresh ?? 0} · replays ${idem.replays ?? 0} · conflicts ${idem.conflicts ?? 0}`)
    }
    const reconcileState = last.reconcile?.state
    if (reconcileState !== undefined) textRow(box, 'reconcile', reconcileState)
  }

  function update(state: StateBody | null): void {
    last = state
    renderHeader()
    renderSidebar()
    renderDraftTargets()
    renderLedger()
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
  return { root, update, mode: () => mode, selectTab }
}
