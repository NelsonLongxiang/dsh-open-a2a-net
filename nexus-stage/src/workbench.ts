/**
 * The A2A workbench: one DOM client UI for human AI researchers and agents
 * to OPERATE the network — directory, ledger, activity, and a derived
 * action plan, plus the RESTORED 2D spatial planning canvas as the board
 * tab (2026-10-19 rulings: 3D 观测不需要，删除；规划板保留，结合规划统一
 * 成一个 client ui 工作台 — the board is mounted inside the workbench,
 * not a separate mode page).
 *
 * Discipline (inherited from the planning view it replaces):
 * - Pure DOM, no WebGL, no three, no framework: every row is a textContent
 *   write, so attacker-shaped labels stay text.
 * - The workbench never fabricates capability: dead-letter rows act through
 *   the real abandon seam (deps), dispatch only DRAFTS a pasteable brief.
 * - update() re-renders data regions wholesale but never touches the
 *   dispatch textarea (user input survives polls); tab + selection are
 *   view state kept across updates.
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
}

/** One dead-lettered row from /state `tasksDead`. */
export interface DeadRow {
  readonly taskId: string
  readonly team: string
  readonly peer?: string
  readonly startedAt: number
  readonly deadAt: number
  readonly reason?: string
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
  /** The spatial planning board (restored 0.6.1). Optional: without it the
   *  workbench renders the three operational tabs only. `available()` gates
   *  the tab on the host's canvas face (state.canvas !== undefined). */
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
  | { kind: 'session'; row: SessionRow }
  | { kind: 'remote'; row: RemoteRow }
  | { kind: 'canvas'; row: CanvasTeamRow }
  | { kind: 'peer'; row: { url: string; score?: number } }
  | undefined

export type WorkbenchTab = 'ledger' | 'activity' | 'plan' | 'board'

export interface Workbench {
  readonly root: HTMLElement
  /** Feed one /state poll (or null while the first fetch is out). */
  update(state: StateBody | null): void
  /** Currently active main tab. */
  readonly tab: () => WorkbenchTab
  /** Focus a tab programmatically (?mode=plan → 'board'); a no-op when the
   *  board is absent or the canvas face is down. */
  selectTab(key: WorkbenchTab): void
}

export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const board = deps.board
  let tab: WorkbenchTab = 'ledger'
  let selection: Selection
  let last: StateBody | null = null

  const root = el('div', 'wb')
  root.setAttribute('data-testid', 'wb-root')

  // ── Static skeleton: built once, update() only rewrites data regions. ──
  const header = el('header', 'wb-header')
  const title = el('div', 'wb-title')
  title.appendChild(el('span', 'wb-title-main')).textContent = 'A2A 工作台'
  const versionBadge = el('span', 'wb-badge')
  title.appendChild(versionBadge)
  header.appendChild(title)
  const headerStats = el('div', 'wb-header-stats')
  header.appendChild(headerStats)

  const body = el('div', 'wb-body')
  const sidebar = el('aside', 'wb-sidebar')
  const sidebarBody = el('div', 'wb-sidebar-body')
  sidebar.appendChild(sidebarBody)
  const main = el('main', 'wb-main')
  const tabs = el('nav', 'wb-tabs')
  const tabDefs: Array<{ key: WorkbenchTab; label: string }> = [
    { key: 'ledger', label: '台账' },
    { key: 'activity', label: '活动' },
    { key: 'plan', label: '规划' },
    ...(board !== undefined ? [{ key: 'board' as const, label: '空间' }] : []),
  ]
  for (const def of tabDefs) {
    const btn = el('button', 'wb-tab')
    btn.type = 'button'
    btn.textContent = def.label
    btn.dataset.tab = def.key
    btn.addEventListener('click', () => {
      tab = def.key
      syncTabs()
    })
    tabs.appendChild(btn)
  }
  const ledgerPane = el('section', 'wb-pane')
  const activityPane = el('section', 'wb-pane')
  const planPane = el('section', 'wb-pane')
  const panes: Partial<Record<WorkbenchTab, HTMLElement>> = {
    ledger: ledgerPane,
    activity: activityPane,
    plan: planPane,
  }
  if (board !== undefined) {
    const pane = el('section', 'wb-pane wb-pane-board')
    pane.appendChild(board.root)
    panes.board = pane
  }
  main.appendChild(tabs)
  main.appendChild(ledgerPane)
  main.appendChild(activityPane)
  main.appendChild(planPane)
  if (panes.board !== undefined) main.appendChild(panes.board)
  const inspector = el('aside', 'wb-inspector')
  const inspectorBody = el('div', 'wb-inspector-body')
  inspector.appendChild(inspectorBody)

  body.appendChild(sidebar)
  body.appendChild(main)
  body.appendChild(inspector)
  root.appendChild(header)
  root.appendChild(body)

  function syncTabs(): void {
    for (const btn of Array.from(tabs.children) as HTMLElement[]) {
      btn.classList.toggle('is-active', btn.dataset.tab === tab)
      // Canvas face down → the board tab hides (same contract as the old
      // ?mode=plan tab: state.canvas === undefined is the master switch).
      if (btn.dataset.tab === 'board') {
        btn.classList.toggle('is-hidden', board !== undefined && !board.available())
      }
    }
    for (const [key, pane] of Object.entries(panes) as Array<[WorkbenchTab, HTMLElement]>) {
      pane.classList.toggle('is-hidden', key !== tab)
    }
    // Board activation fires on tab TRANSITIONS only (the old stage's
    // setMode contract), not on every syncTabs poll re-render.
    if (board !== undefined) {
      const next = tab === 'board'
      if (next !== boardActive) {
        boardActive = next
        if (next) board.activate()
        else board.deactivate()
      }
    }
  }

  let boardActive = false

  function clear(node: HTMLElement): HTMLElement {
    while (node.firstChild !== null) node.removeChild(node.firstChild)
    return node
  }

  function select(next: Selection): void {
    selection = next
    renderInspector()
  }

  // ── Directory sidebar ──
  function renderSidebar(): void {
    const box = clear(sidebarBody)
    if (last === null) {
      box.appendChild(el('div', 'wb-muted')).textContent = '载入中…'
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
  function renderLedger(): void {
    const pane = clear(ledgerPane)
    if (last === null) return
    const now = deps.now()
    const pending = last.tasks ?? []
    const dead = last.tasksDead ?? []
    const stale = last.tasksStaleCount ?? 0
    const head = el('div', 'wb-pane-head')
    head.textContent = `待回执 ${pending.length}（陈旧 ${stale}） · 死信 ${dead.length} · 已归档 ${last.archivedCount ?? 0}`
    pane.appendChild(head)
    const table = el('div', 'wb-table')
    for (const row of pending) {
      const line = el('div', 'wb-row')
      const badges: string[] = []
      if (row.settleable === true) badges.push('可结算')
      if (row.receiptExpected === false) badges.push('无回执债')
      if (row.direction === 'inbound') badges.push('入站')
      line.appendChild(el('span', 'wb-row-id')).textContent = row.taskId
      line.appendChild(el('span', 'wb-row-team')).textContent = row.team
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
    if (flights.length > 0) {
      const head = el('div', 'wb-pane-subhead')
      head.textContent = '在途路由'
      pane.appendChild(head)
      for (const row of flights) {
        const line = el('div', 'wb-row')
        line.appendChild(el('span', 'wb-row-dir')).textContent = '→'
        line.appendChild(el('span', 'wb-row-team')).textContent = row.team
        line.appendChild(el('span', 'wb-row-meta')).textContent = `${row.peer} · ${ageText(row.startedAt, now)}`
        pane.appendChild(line)
      }
    }
    const head = el('div', 'wb-pane-subhead')
    head.textContent = '活动环（最新在前）'
    pane.appendChild(head)
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
        actions.push({
          severity: 'normal',
          text: `催办 ${row.taskId} → ${row.team}（等待 ${ageText(row.startedAt, now)} 无回执）`,
          brief: `a2a_route 催收回执：task ${row.taskId}（team ${row.team}）已派发 ${ageText(row.startedAt, now)}，请回报结果或回执。`,
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

  // ── Inspector ──
  function renderInspector(): void {
    const box = clear(inspectorBody)
    if (selection === undefined) {
      box.appendChild(el('div', 'wb-muted')).textContent = '从目录选择一项查看详情'
      return
    }
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
    // Canvas face dropped while the board is focused → fall back to the
    // ledger (the old stage left plan mode the same way).
    if (tab === 'board' && (board === undefined || !board.available())) tab = 'ledger'
    syncTabs()
  }

  function selectTab(key: WorkbenchTab): void {
    if (key === 'board' && (panes.board === undefined || (board !== undefined && !board.available()))) return
    tab = key
    syncTabs()
  }

  update(null)
  return { root, update, tab: () => tab, selectTab }
}
