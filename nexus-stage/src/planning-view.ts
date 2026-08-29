/**
 * The 2D planning-mode view: one section#dsh-plan holding a screen-fixed
 * dot-grid layer, the transformed world container (SVG star edges + team
 * frames + node cards), a marquee, and the HUD (toolbar / tabs host /
 * status / legend). This is the ONLY new DOM module; everything spatial
 * lives in the pure modules (viewport/world/edges/layout-doc).
 *
 * Reconcile discipline:
 * - the WorldModel persists across polls and is maintained incrementally
 *   (upsert refreshes rendered attributes, never positions - a poll must
 *   not snap a dragged card back to its last-saved spot);
 * - card/frame elements are keyed-diffed so focus, the pickup transition,
 *   and an in-flight pointer capture survive a poll; SVG edges carry no
 *   state and are rebuilt wholesale;
 * - the federation overlay (peer cards + activity/federal edges) renders
 *   on every render, OUTSIDE the revision gate, so inFlight ages tick per
 *   poll and the badge cards track the local content bounds;
 * - XSS: session labels/teams are attacker-shaped data and land only via
 *   createElement + textContent.
 *
 * Gestures (Figma-style ruling): left-blank drag = marquee; pan = Space+drag
 * or middle-drag; Ctrl+wheel = pointer-anchored zoom; plain wheel pans.
 * Tests drive the same handlers production binds through `seam`.
 * @module nexus-stage/planning-view
 */

import type { LampState } from './layout-wire'
import { buildLayoutDoc, clampDoc, type LayoutDoc, type LayoutRect } from './layout-doc'
import { FRAME_HEAD_LIFT, starEdges } from './edges'
import {
  activityEdges, federalEdges, flyBounds, groupRemoteTeams, peerNodeId, peerHostOf, placePeers,
  type FrameAnchor, type InFlightRow, type PeerPlacement, type PeerRow,
  type RemoteTeamRow,
} from './federation'
import { clampViewport, fitView, panBy, screenToWorld, worldTransformCss, zoomAt, type LayoutViewport } from './viewport'
import { NODE_H, WorldModel, nodeRect, deriveInitialFrame, planSeatFor, type SessionLite, type TeamLite } from './world'
import { applyAction, actionTeam, innermostFrameAt, reorderOps, yOrderedMembers, type CanvasAction, type RosterOp } from './canvas-ops'
import { FRAME_HUES } from './tokens'
import './planning.css'

/** Team-name hue, same 31-polynomial family as the 3D scene's getHue. */
function frameHue(name: string): { line: string; bg: string } {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h * 31 + name.charCodeAt(i)) & 0xfffffff) >>> 0
  const rgb = FRAME_HUES[h % FRAME_HUES.length]!
  const line = '#' + rgb.toString(16).padStart(6, '0')
  // 5% alpha fill over the dark base, per the design system.
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  return { line, bg: `rgba(${r},${g},${b},0.05)` }
}

/** Minimal session/team shapes consumed here (topology rows satisfy them). */
export interface PlanningSession extends SessionLite {}
export interface PlanningTeam extends TeamLite {}

export interface PlanningInput {
  sessions: ReadonlyArray<PlanningSession>
  teams: ReadonlyArray<PlanningTeam>
  peerCount: number
  /** Federation peers (PR D): rows for the badge column right of the content. */
  peers?: ReadonlyArray<PeerRow>
  /** Pending outbound routes (PR D): the accent activity edges. */
  inFlight?: ReadonlyArray<InFlightRow>
  /** Remote team directory rows (PR D v1 ruling): grouped under peer cards. */
  remoteTeams?: ReadonlyArray<RemoteTeamRow>
}

export interface PlanningDeps {
  /** An edit that should persist happened (drag/nudge/pan/zoom/marquee end). */
  onDirty(): void
  /** The save lamp was clicked (error state -> retry). */
  onLampClick(): void
  /** Viewport size in CSS px (defaults to the root element's box; tests
   *  inject fixed sizes so fit math is assertable without layout). */
  viewSize?(): { w: number; h: number }
  /**
   * A team write action (optimistic state already applied by the view).
   * Resolves true when the host accepted it — or it was an idempotent
   * no-op (ok:false without an error string). Resolves false when the
   * write was refused/failed: the view then rolls the action's scoped
   * undo back itself. Rejecting the promise is also handled (treated as
   * false) — the channel must not leave the team's guard pinned.
   */
  onCanvasAction(a: CanvasAction): Promise<boolean>
  /** Wall clock for the inFlight age labels (tests pin it; default Date.now). */
  now?(): number
}

/** Pointer-like event surface the handlers consume (real events satisfy it). */
export interface SeamPointer {
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  clientX: number
  clientY: number
  pointerId?: number
  target: Element | null
  deltaX?: number
  deltaY?: number
  deltaMode?: number
  preventDefault(): void
}

export interface SeamKey { key: string; shiftKey: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; target: Element | null; preventDefault(): void }

type Gesture =
  | { readonly kind: 'none' }
  | { readonly kind: 'node'; ids: readonly string[]; clicked: string; last: { x: number; y: number }; moved: boolean; el: Element | null; origins: ReadonlyArray<{ team: string; ids: readonly string[] }> }
  | { readonly kind: 'frame'; name: string; snap: NonNullable<ReturnType<WorldModel['beginFrameDrag']>>; origin: { x: number; y: number }; moved: boolean }
  | { readonly kind: 'pan'; last: { x: number; y: number }; moved: boolean }
  | { readonly kind: 'marquee'; origin: { x: number; y: number }; last: { x: number; y: number }; additive: boolean }

export interface PlanningView {
  root: HTMLElement
  reconcile(input: PlanningInput): void
  activate(): void
  deactivate(): void
  /** Adopt a (possibly normalized) layout document when the save loop allows. */
  adoptExternalLayout(layout: unknown): void
  /** The current document for the save loop, read at send time. */
  snapshotDoc(): unknown
  setLamp(state: LampState, savedAt?: string): void
  /** A transient notice (host error verbatim or an info hint). */
  notice(kind: 'error' | 'info', text: string): void
  seam: {
    pointerDown(ev: SeamPointer): void
    pointerMove(ev: SeamPointer): void
    pointerUp(ev: SeamPointer): void
    wheel(ev: SeamPointer): void
    key(ev: SeamKey): void
    keyUp(ev: SeamKey): void
    contextMenu(ev: SeamPointer): void
  }
  destroy(): void
}

export function createPlanningView(deps: PlanningDeps): PlanningView {
  const model = new WorldModel()
  let layoutDoc: LayoutDoc | undefined
  let vp: LayoutViewport = { ...model.viewport }
  let gesture: Gesture = { kind: 'none' }
  let spaceDown = false
  let renderedRevision = -1
  const clock = deps.now ?? Date.now
  const ac = new AbortController()
  const noticeTimers: Array<ReturnType<typeof setTimeout>> = []
  const signal = { signal: ac.signal } as AddEventListenerOptions

  // ── DOM shell (built once) ──
  const root = document.createElement('section')
  root.id = 'dsh-plan'
  root.setAttribute('role', 'tabpanel')
  root.setAttribute('aria-label', 'A2A 规划画布')
  root.tabIndex = 0
  root.style.display = 'none'

  const grid = document.createElement('div')
  grid.className = 'p-grid'

  const world = document.createElement('div')
  world.className = 'p-world'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'p-edges')
  // NOTE: the svg is intentionally NOT aria-hidden — its .edge-label texts
  // carry the route ages that reduced-motion users rely on.
  // Stable layers: frames must ALWAYS paint (and lose hit-testing) below
  // cards, regardless of which keyed diff created its element first — a
  // frame created after the cards used to sit on top of them and swallow
  // every real-pointer drag inside the team (synthetic tests bypassed it
  // by targeting cards directly).
  const frameLayer = document.createElement('div')
  frameLayer.className = 'p-layer p-frames'
  const nodeLayer = document.createElement('div')
  nodeLayer.className = 'p-layer p-nodes'
  nodeLayer.setAttribute('role', 'listbox')
  nodeLayer.setAttribute('aria-multiselectable', 'true')
  nodeLayer.setAttribute('aria-label', '会话节点')
  world.append(svg, frameLayer, nodeLayer)

  const marquee = document.createElement('div')
  marquee.className = 'p-marquee'

  const toolbar = document.createElement('div')
  toolbar.className = 'p-toolbar'
  const zoomLabel = document.createElement('span')
  zoomLabel.className = 'p-zoom mono'
  zoomLabel.textContent = '100%'
  const mkButton = (text: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.title = title
    b.addEventListener('click', onClick, signal)
    return b
  }
  toolbar.append(
    mkButton('适配(0)', '适配视图（0）', () => fitToContent()),
    mkButton('－', '缩小', () => zoomCenter(1 / 1.2)),
    zoomLabel,
    mkButton('＋', '放大', () => zoomCenter(1.2)),
    mkButton('建队', '组成团队（G）：先框选至少 2 个节点', () => startCreateFromSelection()),
  )
  const lamp = document.createElement('span')
  lamp.setAttribute('aria-live', 'polite')
  lamp.className = 'p-lamp'
  const lampDot = document.createElement('i')
  const lampText = document.createElement('span')
  lampText.textContent = '布局'
  lamp.append(lampDot, lampText)
  lamp.addEventListener('click', () => { if (lamp.classList.contains('error')) deps.onLampClick() }, signal)
  lamp.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent
    if ((e.key === 'Enter' || e.key === ' ') && lamp.classList.contains('error')) {
      e.preventDefault()
      deps.onLampClick()
    }
  }, signal)
  toolbar.appendChild(lamp)

  const status = document.createElement('div')
  status.className = 'p-status'
  const statusLive = document.createElement('span')
  const statusCold = document.createElement('span')
  const statusAct = document.createElement('span')
  statusAct.className = 'mut'
  const statusMut = document.createElement('span')
  statusMut.className = 'mut'
  status.append(statusLive, statusCold, statusAct, statusMut)
  // Fly control (PR D): the whole statusbar fits the frames ∪ peers region,
  // keyboard-parity via Enter/Space with a focus ring (a11y parity with 0).
  status.tabIndex = 0
  status.setAttribute('role', 'button')
  status.setAttribute('aria-label', '定位在途路由与联邦对端')
  status.title = '定位在途与联邦（回车）'
  status.addEventListener('click', () => flyToFederation(), signal)
  status.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flyToFederation() }
  }, signal)

  const legend = document.createElement('div')
  legend.className = 'p-legend'
  const legendRow = (dashed: boolean, text: string, color?: string): void => {
    const row = document.createElement('span')
    const bar = document.createElement('i')
    if (dashed) bar.className = 'dashed'
    if (color !== undefined) bar.style.borderTopColor = color
    row.append(bar, document.createTextNode(text))
    legend.appendChild(row)
  }
  legendRow(false, '成员边（星形，框→成员）')
  legendRow(true, '跨队多属（虚线）')
  legendRow(false, '活动边（inFlight 路由，瞬时）', 'var(--accent)')
  legendRow(true, '联邦线（→peer）', 'var(--federal)')

  const noticeStack = document.createElement('div')
  noticeStack.className = 'p-notice-stack'
  noticeStack.setAttribute('role', 'log')
  noticeStack.setAttribute('aria-live', 'polite')

  root.append(grid, world, marquee, toolbar, status, legend, noticeStack)

  // ── viewport application ──
  let viewW = 0
  let viewH = 0
  const measure = (): { w: number; h: number } =>
    deps.viewSize ? deps.viewSize() : { w: root.clientWidth, h: root.clientHeight }
  const syncViewSize = (): void => {
    const size = measure()
    viewW = size.w
    viewH = size.h
  }

  function applyViewport(): void {
    world.style.transform = worldTransformCss(vp)
    const step = 24 * vp.scale
    grid.style.backgroundSize = `${step}px ${step}px`
    grid.style.backgroundPosition = `${-vp.x * vp.scale}px ${-vp.y * vp.scale}px`
    zoomLabel.textContent = `${Math.round(vp.scale * 100)}%`
  }

  function render(): void {
    applyViewport()
    if (model.revision !== renderedRevision) {
      renderedRevision = model.revision
      renderFrames()
      renderNodes()
      renderEdges()
    }
    renderFederation()
  }

  // ── keyed diff: frames ──
  // Element maps instead of selector lookups: keyed identity for focus and
  // transitions, no CSS.escape dependency, O(1) per row.
  const frameEls = new Map<string, HTMLElement>()
  const nodeEls = new Map<string, HTMLElement>()

  function renderFrames(): void {
    const seen = new Set<string>()
    for (const [name, rect] of model.allFrames()) {
      seen.add(name)
      let el = frameEls.get(name)
      if (el === undefined) {
        el = document.createElement('div')
        el.className = 'p-frame'
        el.dataset.name = name
        const head = document.createElement('div')
        head.className = 'p-frame-head'
        head.dataset.frame = name
        head.tabIndex = 0 // keyboard: Shift+F10 menu, Delete 散队
        head.setAttribute('role', 'button')
        head.setAttribute('aria-haspopup', 'menu')
        head.setAttribute('aria-label', `团队框 ${name}（拖动整组，回车菜单）`)
        const title = document.createElement('span')
        title.className = 'ttl'
        const cnt = document.createElement('span')
        cnt.className = 'cnt mono'
        const route = document.createElement('span')
        route.className = 'route mono'
        head.append(title, cnt, route)
        el.appendChild(head)
        frameLayer.appendChild(el)
        frameEls.set(name, el)
      }
      const hue = frameHue(name)
      el.style.setProperty('--frame-line', hue.line)
      el.style.setProperty('--frame-bg', hue.bg)
      el.style.left = `${rect.x}px`
      el.style.top = `${rect.y}px`
      el.style.width = `${rect.w}px`
      el.style.height = `${rect.h}px`
      const title = el.querySelector<HTMLElement>('.ttl')!
      const cnt = el.querySelector<HTMLElement>('.cnt')!
      const route = el.querySelector<HTMLElement>('.route')!
      if (title.textContent !== name) title.textContent = name
      let members = 0
      let cross = 0
      for (const m of model.allNodes()) {
        const mem = m.memberships.find(x => x.team === name)
        if (mem === undefined) continue
        members += 1
        if (m.memberships.length > 1) cross += 1
      }
      const cntText = `${members} 成员` + (cross > 0 ? ` +${cross} 跨队` : '')
      if (cnt.textContent !== cntText) cnt.textContent = cntText
      const routeText0 = routeText(name)
      if (route.textContent !== routeText0) route.textContent = routeText0
    }
    for (const [name, el] of [...frameEls]) {
      if (!seen.has(name)) { el.remove(); frameEls.delete(name) }
    }
  }

  /** Remote card sub line: score + remote team count/names behind this peer. */
  function remoteSubText(host: string): string {
    const rows = lastRemoteTeams.get(host) ?? []
    const names = rows.map(r => r.name !== undefined && r.name !== '' ? r.name : r.team)
    const head = names.slice(0, 2).join('、')
    const more = names.length > 2 ? ` +${names.length - 2}` : ''
    const score = peerScoreByText.get(host)
    return (score !== undefined ? `score ${score} · ` : '') + `${rows.length} 远端团队` + (head !== '' ? `：${head}${more}` : '')
  }

  /** The mono route line `<host>/canvas/<name>` when the payload carries it. */
  function routeText(name: string): string {
    const t = lastTeams.find(x => x.name === name)
    return t?.team ?? name
  }

  // ── keyed diff: nodes ──
  function renderNodes(): void {
    const seen = new Set<string>()
    for (const n of model.allNodes()) {
      seen.add(n.id)
      let el = nodeEls.get(n.id)
      if (el === undefined) {
        el = document.createElement('div')
        el.className = 'p-node'
        el.dataset.id = n.id
        el.tabIndex = 0
        const nm = document.createElement('div')
        nm.className = 'nm'
        const dot = document.createElement('span')
        dot.className = 'dot'
        const name = document.createElement('span')
        name.className = 'nm-text'
        nm.append(dot, name)
        const sub = document.createElement('div')
        sub.className = 'sub mono'
        const prio = document.createElement('span')
        prio.className = 'prio mono'
        el.append(nm, sub, prio)
        nodeLayer.appendChild(el)
        nodeEls.set(n.id, el)
      }
      const r = nodeRect(n)
      el.style.left = `${r.x}px`
      el.style.top = `${r.y}px`
      el.classList.toggle('cold', !n.live)
      el.classList.toggle('remote', n.remote === true)
      el.classList.toggle('selected', model.isSelected(n.id))
      el.setAttribute('aria-selected', String(model.isSelected(n.id)))
      const host = n.id.slice('peer-'.length)
      const nmText = n.remote === true ? host : (n.name ?? n.label)
      const nmEl = el.querySelector<HTMLElement>('.nm-text')!
      if (nmEl.textContent !== nmText) nmEl.textContent = nmText
      const subEl = el.querySelector<HTMLElement>('.sub')!
      const subText = n.remote === true
        ? remoteSubText(host)
        : n.team + (n.name !== undefined && n.name !== '' ? ' · ' + n.name : '')
          + (n.memberships.length > 1 ? ` · 跨队×${n.memberships.length}` : '')
      if (subEl.textContent !== subText) subEl.textContent = subText
      const prioEl = el.querySelector<HTMLElement>('.prio')!
      const prioText = n.remote === true ? 'peer' : (n.memberships[0] !== undefined ? `P${n.memberships[0]!.index}` : '')
      if (prioEl.textContent !== prioText) prioEl.textContent = prioText
    }
    for (const [id, el] of [...nodeEls]) {
      if (!seen.has(id)) { el.remove(); nodeEls.delete(id) }
    }
  }

  // ── edges: stateless, rebuilt wholesale ──
  // Derived from the MODEL (not lastTeams): optimistic membership changes
  // must repaint their edges immediately, before the host confirms.
  function renderEdges(): void {
    while (svg.firstChild !== null) svg.firstChild.remove()
    const teams = model.allFrames().map(([name]) => ({ name, members: model.teamMemberIds(name).map(id => ({ id })) }))
    for (const e of starEdges(teams, new Map(model.allFrames()), model.positions())) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('class', 'e-member' + (e.dashed ? ' dashed' : ''))
      line.setAttribute('x1', String(e.x1))
      line.setAttribute('y1', String(e.y1))
      line.setAttribute('x2', String(e.x2))
      line.setAttribute('y2', String(e.y2))
      svg.appendChild(line)
    }
  }

  // ── federation overlay (PR D): peer chips + activity/federal edges ──
  // Runs on EVERY render, outside the model-revision gate: the poll's
  // inFlight ages must tick even when the model is unchanged, and the
  // badge column tracks the content bounds each reconcile. Its SVG
  // children are tracked separately because renderEdges clears the svg
  // wholesale - this appends after it (render() orders the two).
  let fedSvg: SVGElement[] = []
  let lastPlacements: PeerPlacement[] = []
  let lastPeers: ReadonlyArray<PeerRow> = []
  let lastRemoteTeams: ReadonlyMap<string, RemoteTeamRow[]> = new Map()
  const peerScoreByText = new Map<string, number | undefined>()
  let lastInFlight: ReadonlyArray<InFlightRow> = []

  function renderFederation(): void {
    for (const el of fedSvg) el.remove()
    fedSvg = []
    // Peer placements come from the MODEL's remote nodes (v1 ruling: peers
    // are cards in the same pipeline, dragged/saved like sessions) — the
    // old chip column is gone.
    const placements: PeerPlacement[] = model.allNodes()
      .filter(n => n.remote === true)
      .map(n => ({ url: n.peerUrl ?? n.id.slice(5), score: n.score, x: n.x, y: n.y }))
    lastPlacements = placements
    const bounds = model.contentBounds()
    if (bounds !== null) {
      // Edges: titlebar anchors (fx + fw/2, fy + 11, edges.ts lockstep).
      const anchors = new Map<string, FrameAnchor>()
      for (const [name, rect] of model.allFrames()) {
        anchors.set(name, { name, x: rect.x + rect.w / 2, y: rect.y + FRAME_HEAD_LIFT })
      }
      for (const e of activityEdges(lastInFlight, anchors, placements, clock())) {
        fedSvg.push(...fedEdge(e, 'e-activity', e.label))
      }
      for (const e of federalEdges(placements, bounds)) {
        fedSvg.push(...fedEdge(e, 'e-federal', e.label))
      }
    }
  }

  /** One overlay line + its optional midpoint label (offset +14/+18). */
  function fedEdge(
    e: { x1: number; y1: number; x2: number; y2: number },
    cls: string,
    label: string,
  ): SVGElement[] {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('class', cls)
    line.setAttribute('x1', String(e.x1))
    line.setAttribute('y1', String(e.y1))
    line.setAttribute('x2', String(e.x2))
    line.setAttribute('y2', String(e.y2))
    svg.appendChild(line)
    const out: SVGElement[] = [line]
    if (label !== '') {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('class', 'edge-label mono')
      t.setAttribute('x', String((e.x1 + e.x2) / 2 + 14))
      t.setAttribute('y', String((e.y1 + e.y2) / 2 + 18))
      t.textContent = label
      svg.appendChild(t)
      out.push(t)
    }
    return out
  }

  /** Statusbar fly: fit the frames ∪ peers region (flyBounds pads it). */
  function flyToFederation(): void {
    vp = fitView(flyBounds(model.contentBounds(), lastPlacements), root.clientWidth || viewW, root.clientHeight || viewH)
    applyViewport()
    deps.onDirty()
  }

  // ── status counts ──
  function renderStatus(input: PlanningInput): void {
    const live = input.sessions.filter(s => s.live !== false).length
    const cold = input.sessions.length - live
    statusLive.textContent = ''
    const bLive = document.createElement('b')
    bLive.className = 'ok'
    bLive.textContent = `● ${live} live`
    statusLive.appendChild(bLive)
    statusCold.textContent = ''
    const bCold = document.createElement('b')
    bCold.className = 'warn'
    bCold.textContent = `● ${cold} cold`
    statusCold.appendChild(bCold)
    statusAct.textContent = `${input.inFlight?.length ?? 0} inFlight`
    statusMut.className = 'mut'
    statusMut.textContent = `${input.teams.length} 队 · ${input.peerCount} peer`
  }

  // ── canvas write actions: optimistic apply + team-scoped undo ──
  // Per-team REFERENCE COUNT: two queued actions on one team keep the guard
  // up until BOTH settle (a Set deleted per action let a mid-queue poll wipe
  // the second action's optimistic membership).
  const pendingTeams = new Map<string, number>()
  const pendingAdd = (team: string): void => { pendingTeams.set(team, (pendingTeams.get(team) ?? 0) + 1) }
  const pendingRelease = (team: string): void => {
    const n = (pendingTeams.get(team) ?? 0) - 1
    if (n <= 0) pendingTeams.delete(team)
    else pendingTeams.set(team, n)
  }

  function emitAction(a: CanvasAction): void {
    const undo = applyAction(model, a)
    const team = actionTeam(a)
    pendingAdd(team)
    render()
    void deps.onCanvasAction(a).then(
      ok => {
        pendingRelease(team)
        if (!ok) undo() // host refused: roll this action's optimistic delta back
        render()
      },
      () => {
        // Contract-robustness: a rejecting action channel must not pin the
        // team's guard (and its optimistic state) forever — and per §3.4
        // 不吞错, the rollback surfaces to the user.
        pendingRelease(team)
        undo()
        notice('error', '操作通道异常，已回滚')
        render()
      },
    )
  }

  // ── notices (host errors verbatim; design.md §3.4 不吞错) ──
  function notice(kind: 'error' | 'info', text: string): void {
    while (noticeStack.childElementCount >= 3) noticeStack.firstElementChild?.remove()
    const item = document.createElement('div')
    item.className = 'p-notice' + (kind === 'error' ? ' error' : '')
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    item.textContent = text
    noticeStack.appendChild(item)
    noticeTimers.push(setTimeout(() => item.remove(), 4000))
  }

  // ── 建队：selection → 命名对话框 → create-team ──
  function selectedByY(): string[] {
    return model
      .selectedIds()
      .map(id => ({ id, y: model.getNode(id)?.y ?? 0 }))
      .sort((a, b) => a.y - b.y)
      .map(r => r.id)
  }

  function startCreateFromSelection(): void {
    if (dialog !== null) return
    // Peer cards are not joinable sessions: they never enter 建队 ids.
    const ids = selectedByY().filter(id => model.getNode(id)?.remote !== true)
    if (ids.length < 2) { notice('info', '框选至少 2 个会话节点'); return }
    openNameDialog(ids)
  }

  let dialog: {
    wrap: HTMLDivElement
    restoreFocus: HTMLElement | null
  } | null = null

  function openNameDialog(ids: readonly string[]): void {
    const wrap = document.createElement('div')
    wrap.className = 'p-dialog'
    const panel = document.createElement('div')
    panel.className = 'p-dialog-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.setAttribute('aria-labelledby', 'p-dialog-title')
    const title = document.createElement('div')
    title.id = 'p-dialog-title'
    title.className = 'p-dialog-title'
    title.textContent = `组建团队（${ids.length} 个节点，自上而下即优先级）`
    const input = document.createElement('input')
    input.className = 'p-dialog-input'
    input.maxLength = 40
    input.setAttribute('aria-label', '团队名')
    const err = document.createElement('div')
    err.className = 'p-dialog-err'
    err.setAttribute('aria-live', 'polite')
    const row = document.createElement('div')
    row.className = 'p-dialog-row'
    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.textContent = '组建'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = '取消'
    row.append(okBtn, cancelBtn)
    panel.append(title, input, err, row)
    wrap.appendChild(panel)
    root.appendChild(wrap)

    const restoreFocus = document.activeElement as HTMLElement | null
    const close = (): void => {
      wrap.remove()
      dialog = null
      restoreFocus?.focus()
    }
    const nameError = (): string | null => {
      const name = input.value.trim()
      if (name === '' || name.length > 40 || name.includes('/') || /^\d+$/.test(name)) {
        return '队名需 1..40 字，不含“/”，不为纯数字'
      }
      return null
    }
    const confirm = (): void => {
      const problem = nameError()
      if (problem !== null) { err.textContent = problem; input.focus(); return }
      const name = input.value.trim()
      close()
      if (model.getFrame(name) !== undefined) {
        // Duplicate name: host create is idempotent-ok, but the optimistic
        // create-team would WIPE the existing roster and overwrite its saved
        // frame rect. Join instead — same wire result, nothing destroyed.
        notice('info', `已加入现有团队「${name}」`)
        emitAction({ type: 'add-member', team: name, ids })
        return
      }
      emitAction({ type: 'create-team', name, ids, created: true })
    }
    okBtn.addEventListener('click', confirm)
    cancelBtn.addEventListener('click', close)
    input.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      if (e.key === 'Enter') { e.preventDefault(); confirm() }
      if (e.key === 'Escape') { e.preventDefault(); close() }
    })
    // Focus trap (aria-modal must not be a false promise): Tab cycles the
    // three focusables; Esc anywhere in the panel cancels.
    wrap.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
      if (e.key !== 'Tab') return
      e.preventDefault()
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>('input, button'))
      const idx = focusables.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey
        ? focusables[(idx - 1 + focusables.length) % focusables.length]
        : focusables[(idx + 1) % focusables.length]
      next?.focus()
    }, signal)
    dialog = { wrap, restoreFocus }
    input.focus()
  }

  // ── context menu（节点/框头；下钻单层；键盘全等）──
  type MenuTarget = { kind: 'node'; id: string } | { kind: 'frame'; name: string }
  let menu: HTMLDivElement | null = null
  let menuTarget: MenuTarget | undefined
  let menuLevel: 'root' | 'join' | 'leave' | 'promote' = 'root'
  let menuAnchor: HTMLElement | null = null

  function closeMenu(): void {
    menu?.remove()
    menu = null
    menuTarget = undefined
    menuLevel = 'root'
    // The anchor may have been detached by a poll while the menu was open —
    // focus() on a detached node drops focus to body and the canvas goes deaf.
    if (menuAnchor !== null && menuAnchor.isConnected) menuAnchor.focus()
    else root.focus()
    menuAnchor = null
  }

  function menuItem(label: string, enabled: boolean, onPick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    b.textContent = label
    if (!enabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true') }
    else b.addEventListener('click', () => { closeMenu(); onPick() })
    return b
  }

  function openMenu(x: number, y: number, target: MenuTarget, level: 'root' | 'join' | 'leave' | 'promote' = 'root'): void {
    // Re-seed the anchor after a drill-down: closeMenu focuses whatever this
    // menu was anchored to, or keyboard focus falls to body and the canvas
    // goes deaf.
    if (menuAnchor === null) {
      menuAnchor = target.kind === 'node'
        ? nodeEls.get(target.id) ?? null
        : frameEls.get(target.name) ?? null
    }
    menu?.remove()
    menuTarget = target
    menuLevel = level
    const el = document.createElement('div')
    el.className = 'p-menu'
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', '团队操作')
    let items: HTMLButtonElement[] = []
    if (target.kind === 'frame') {
      items = [menuItem(`解散团队「${target.name}」`, true, () => emitAction({ type: 'remove-team', name: target.name }))]
    } else {
      const id = target.id
      if (level === 'root') {
        const create = menuItem('组成团队…', model.selectedIds().length >= 2, () => openNameDialog(selectedByY()))
        create.title = '先框选或 Shift 加选至少 2 个节点'
        items.push(create)
        if (lastTeams.length > 0) {
          items.push(menuItem('加入团队 ▸', true, () => openMenu(x, y, target, 'join')))
          const teamsOf = model.getNode(id)?.memberships.map(m => m.team) ?? []
          if (teamsOf.length > 0) {
            items.push(menuItem('置顶路由 ▸', true, () => openMenu(x, y, target, 'promote')))
            items.push(menuItem('离队 ▸', true, () => openMenu(x, y, target, 'leave')))
          }
        }
      } else {
        items.push(menuItem('‹ 返回', true, () => openMenu(x, y, target, 'root')))
        for (const t of lastTeams) {
          if (level === 'join') {
            const already = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? true
            items.push(menuItem(already ? `${t.name}（已加入）` : t.name, !already, () => emitAction({ type: 'add-member', team: t.name, ids: [id] })))
          } else if (level === 'leave') {
            const member = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? false
            items.push(menuItem(t.name, member, () => emitAction({ type: 'remove-member', team: t.name, ids: [id] })))
          } else {
            const member = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? false
            items.push(menuItem(t.name, member, () => {
              const current = model.teamMemberIds(t.name)
              const desired = [id, ...current.filter(x => x !== id)]
              emitAction({ type: 'reorder', team: t.name, ops: reorderOps(current, desired) })
            }))
          }
        }
      }
    }
    el.append(...items)
    el.style.left = `${Math.min(x, window.innerWidth - 200)}px`
    const menuH = items.length * 30 + 8
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menuH - 8))}px`
    el.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(idx + 1 + buttons.length) % buttons.length]?.focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(idx - 1 + buttons.length) % buttons.length]?.focus() }
      else if (e.key === 'Home') { e.preventDefault(); buttons[0]?.focus() }
      else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1]?.focus() }
      else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // drill-back is menu-internal; root must not double-close
        if (menuLevel !== 'root') openMenu(x, y, target, 'root')
        else closeMenu()
      }
    })
    root.appendChild(el)
    menu = el
    items[0]?.focus()
  }

  /** Context menu from a real contextmenu event or the keyboard equivalent. */
  function contextMenuAt(x: number, y: number, target: Element | null): void {
    if (dialog !== null) return
    // Peer endpoints are read-only entries: no roster menu for them.
    const probeNode = target?.closest<HTMLElement>('.p-node') ?? null
    if (probeNode !== null && model.getNode(probeNode.dataset.id ?? '')?.remote === true) return
    const nodeEl = probeNode
    const headEl = target?.closest<HTMLElement>('.p-frame-head') ?? null
    if (nodeEl !== null) {
      const id = nodeEl.dataset.id ?? ''
      if (!model.isSelected(id)) model.setSelection([id])
      menuAnchor = nodeEl
      openMenu(x, y, { kind: 'node', id })
    } else if (headEl !== null) {
      menuAnchor = headEl
      openMenu(x, y, { kind: 'frame', name: headEl.dataset.frame ?? '' })
    }
  }

  // ── gestures ──
  function localXY(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = root.getBoundingClientRect()
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  }

  /** Drop dispatch for a moved node drag: 入队 / 离队 / 队内 y 排序. */
  function dropDispatch(gesture: Extract<Gesture, { kind: 'node' }>, ev: SeamPointer): void {
    const p = localXY(ev)
    const w = screenToWorld(vp, p.x, p.y)
    const f = innermostFrameAt(new Map(model.allFrames()), w)
    // 契约不变量 1：成员必须 joined session——对等卡永远不进名单写面。
    const localIds = gesture.ids.filter(id => model.getNode(id)?.remote !== true)
    if (f !== undefined) {
      const fresh = localIds.filter(id => !(model.getNode(id)?.memberships.some(m => m.team === f)))
      if (fresh.length > 0) {
        emitAction({ type: 'add-member', team: f, ids: fresh }) // 入队：不自动离原队（多对多）
        return
      }
      // Reorder only for LOCAL single-card drops: dropping a peer card is a
      // position move, never a roster write (P2 from the incremental seat).
      if (gesture.ids.length === 1 && model.getNode(gesture.clicked)?.remote !== true) {
        // Already a member: an in-frame drop sorts that frame's members by y.
        const current = model.teamMemberIds(f)
        const desired = yOrderedMembers(model, f)
        if (desired.join('\u0000') !== current.join('\u0000')) {
          emitAction({ type: 'reorder', team: f, ops: reorderOps(current, desired) })
        }
      }
      return
    }
    // Blank: 离队 from the teams the dragged ids belonged to at drag start.
    for (const origin of gesture.origins) {
      emitAction({ type: 'remove-member', team: origin.team, ids: [...origin.ids] })
    }
  }

  function pointerDown(ev: SeamPointer): void {
    if (viewW === 0) syncViewSize()
    if (dialog !== null) { ev.preventDefault(); return } // modal: no gestures behind the dialog
    const target = ev.target as Element | null
    // Context-menu dismissal: the first pointerdown outside an open menu
    // closes it and is swallowed; a press on the menu's own chrome is
    // swallowed too — only its items act.
    if (menu !== null) {
      if (target !== null && target.closest('.p-menu') !== null) return
      closeMenu()
      ev.preventDefault()
      return
    }
    if (target !== null && (target.closest('button') !== null || target.closest('.p-lamp') !== null || target.closest('.p-status') !== null)) return
    const p = localXY(ev)
    const nodeEl = target !== null ? target.closest<HTMLElement>('.p-node') : null
    const headEl = target !== null ? target.closest<HTMLElement>('.p-frame-head') : null
    if ((nodeEl !== null || headEl !== null) && ev.button === 1) {
      // Middle-button anywhere — including on cards and frame heads — pans
      // (baf51a1 claimed this; the guards used to swallow it before the pan
      // branch was reachable, and skipped preventDefault, re-enabling
      // native autoscroll).
      gesture = { kind: 'pan', last: p, moved: false }
      ev.preventDefault()
      try { root.setPointerCapture(ev.pointerId ?? 0) } catch { /* jsdom */ }
      return
    }
    if (nodeEl !== null) {
      if (ev.button !== 0) return // right on a card: contextmenu only, never a card drag (F3)
      const id = nodeEl.dataset.id ?? ''
      const already = model.isSelected(id)
      if (!already && !ev.shiftKey) model.setSelection([id])
      const ids = ev.shiftKey || already ? (model.isSelected(id) ? model.selectedIds() : [...model.selectedIds(), id]) : [id]
      // Origin teams (for the drag-out-to-blank 离队 path), captured at down.
      const byTeam = new Map<string, string[]>()
      for (const dragged of ids) {
        for (const m of model.getNode(dragged)?.memberships ?? []) {
          byTeam.set(m.team, [...(byTeam.get(m.team) ?? []), dragged])
        }
      }
      gesture = { kind: 'node', clicked: id, ids, last: screenToWorld(vp, p.x, p.y), moved: false, el: nodeEl, origins: [...byTeam].map(([team, tIds]) => ({ team, ids: tIds })) }
      nodeEl.classList.add('dragging')
    } else if (headEl !== null) {
      if (ev.button !== 0) return
      const name = headEl.dataset.frame ?? ''
      const snap = model.beginFrameDrag(name)
      if (snap === undefined) return
      gesture = { kind: 'frame', name, snap, origin: screenToWorld(vp, p.x, p.y), moved: false }
    } else {
      if (ev.button === 1 || (ev.button === 0 && spaceDown)) {
        gesture = { kind: 'pan', last: p, moved: false }
      } else if (ev.button === 0) {
        gesture = { kind: 'marquee', origin: p, last: p, additive: ev.shiftKey }
        marquee.style.display = 'block'
        marquee.style.left = `${p.x}px`
        marquee.style.top = `${p.y}px`
        marquee.style.width = '0px'
        marquee.style.height = '0px'
      } else return
    }
    ev.preventDefault()
    try { root.setPointerCapture(ev.pointerId ?? 0) } catch { /* jsdom: no capture */ }
  }

  function pointerMove(ev: SeamPointer): void {
    const p = localXY(ev)
    if (gesture.kind === 'node') {
      const w = screenToWorld(vp, p.x, p.y)
      const dx = w.x - gesture.last.x
      const dy = w.y - gesture.last.y
      if (dx === 0 && dy === 0) return
      gesture.moved = true
      gesture.last = w
      model.dragNodes(gesture.ids, dx, dy)
      // Drop-target highlight: the innermost frame under the pointer, but
      // only when the drop would change something (some id not yet member).
      const f = innermostFrameAt(new Map(model.allFrames()), w)
      const joinables = gesture.ids.filter(id => model.getNode(id)?.remote !== true)
      const relevant = f !== undefined && joinables.length > 0
      for (const [name, el] of frameEls) el.classList.toggle('drop-target', relevant && name === f)
      render()
    } else if (gesture.kind === 'frame') {
      const w = screenToWorld(vp, p.x, p.y)
      const dx = w.x - gesture.origin.x
      const dy = w.y - gesture.origin.y
      if (!gesture.moved && dx === 0 && dy === 0) return
      gesture.moved = true
      model.applyFrameDrag(gesture.snap, dx, dy)
      render()
    } else if (gesture.kind === 'pan') {
      vp = panBy(vp, p.x - gesture.last.x, p.y - gesture.last.y)
      gesture.last = p
      gesture.moved = true
      applyViewport()
    } else if (gesture.kind === 'marquee') {
      const x = Math.min(gesture.origin.x, p.x)
      const y = Math.min(gesture.origin.y, p.y)
      marquee.style.left = `${x}px`
      marquee.style.top = `${y}px`
      marquee.style.width = `${Math.abs(p.x - gesture.origin.x)}px`
      marquee.style.height = `${Math.abs(p.y - gesture.origin.y)}px`
      gesture.last = p
    }
  }

  function pointerUp(ev: SeamPointer): void {
    if (gesture.kind === 'node') {
      const id = gesture.clicked
      if (!gesture.moved) {
        // A click (no drag) is pure selection — NEVER a drop. The F1 fix:
        // an unmoved multi-select click used to fall through to dropDispatch
        // and write an entire group's 离队 to the host.
        if (ev.shiftKey) {
          const current = model.selectedIds()
          model.setSelection(current.includes(id) ? current.filter(x => x !== id) : [...current, id])
        } else {
          model.setSelection([id])
        }
      } else {
        dropDispatch(gesture, ev)
        deps.onDirty()
      }
      for (const el of frameEls.values()) el.classList.remove('drop-target')
      gesture.el?.classList.remove('dragging')
      render()
    } else if (gesture.kind === 'frame') {
      if (gesture.moved) deps.onDirty()
    } else if (gesture.kind === 'pan') {
      if (gesture.moved) deps.onDirty() // the viewport persists with the layout
    } else if (gesture.kind === 'marquee') {
      const p = gesture.last
      const a = screenToWorld(vp, Math.min(gesture.origin.x, p.x), Math.min(gesture.origin.y, p.y))
      const b = screenToWorld(vp, Math.max(gesture.origin.x, p.x), Math.max(gesture.origin.y, p.y))
      model.marqueeSelect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, gesture.additive)
      marquee.style.display = 'none'
      render()
    }
    gesture = { kind: 'none' }
    try { root.releasePointerCapture(ev.pointerId ?? 0) } catch { /* not captured */ }
  }

  function wheel(ev: SeamPointer): void {
    if (menu !== null) closeMenu()
    const p = localXY(ev)
    if (ev.ctrlKey) {
      const line = ev.deltaMode === 1 ? 16 : 1
      const factor = Math.exp(-((ev.deltaY ?? 0) * line) * 0.0015)
      vp = zoomAt(vp, factor, p.x, p.y)
    } else {
      // Natural scrolling: the viewport follows the wheel (scroll down
      // reveals content further down), same convention as a webpage.
      // Line-mode wheels (Firefox, deltaMode=1) report ~3 per notch.
      const line = ev.deltaMode === 1 ? 16 : 1
      vp = clampViewport(panBy(vp, (ev.deltaX ?? 0) * line, (ev.deltaY ?? 0) * line))
    }
    ev.preventDefault()
    applyViewport()
    deps.onDirty()
  }

  function zoomCenter(factor: number): void {
    syncViewSize()
    vp = zoomAt(vp, factor, viewW / 2, viewH / 2)
    applyViewport()
    deps.onDirty()
  }

  function fitToContent(): void {
    syncViewSize()
    vp = fitView(model.contentBounds(), viewW, viewH)
    applyViewport()
    deps.onDirty()
  }

  function key(ev: SeamKey): void {
    if (dialog !== null) return // modal: the dialog input handles Enter/Esc itself
    if (ev.ctrlKey || ev.metaKey) return // browser/OS chords stay browser/OS
    if (menu !== null) {
      // The menu owns most keys (its own handler navigates); Escape still
      // closes from here so a seam/keyboard Esc never gets lost.
      if (ev.key === 'Escape') { closeMenu(); ev.preventDefault() }
      return
    }
    if (ev.key === ' ' && ev.target === root) { spaceDown = true; ev.preventDefault(); return }
    // 键盘全等路径（WCAG 2.2 Dragging Movements）：
    const headTarget = (ev.target as Element | null)?.closest?.('.p-frame-head') ?? null
    if ((ev.key === 'Enter' || ev.key === ' ') && headTarget !== null) {
      ev.preventDefault()
      const r = headTarget.getBoundingClientRect()
      contextMenuAt(r.left + r.width / 2, r.top + r.height / 2, headTarget)
      return
    }
    if (ev.key === ' ' && (ev.target as Element | null)?.classList?.contains('p-node')) {
      const el = ev.target as HTMLElement
      const id = el.dataset.id ?? ''
      const current = model.selectedIds()
      model.setSelection(current.includes(id) ? current.filter(x => x !== id) : [...current, id])
      render()
      ev.preventDefault()
      return
    }
    if ((ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu') {
      ev.preventDefault()
      const fe = (document.activeElement as Element | null) ?? null
      const r = fe?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 }
      contextMenuAt(r.left + r.width / 2, r.top + r.height / 2, fe)
      return
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteFocused(); return }
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); altMove(ev.key === 'ArrowUp'); return }
    if (ev.key === 'g' || ev.key === 'G') { startCreateFromSelection(); return }
    if (ev.key === '0') { fitToContent(); return }
    if (ev.key === '=' || ev.key === '+') { zoomCenter(1.2); return }
    if (ev.key === '-') { zoomCenter(1 / 1.2); return }
    if (ev.key === 'Escape') {
      if (menu !== null) { closeMenu(); render(); return } // menu > clear selection
      model.setSelection([])
      render()
      return
    }
    const step = ev.shiftKey ? 40 : 8
    const dxdy: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }
    const d = dxdy[ev.key]
    if (d !== undefined) {
      ev.preventDefault()
      const ids = model.selectedIds()
      if (ids.length > 0) {
        model.nudge(ids, d[0]!, d[1]!)
        render()
        deps.onDirty()
      }
    }
  }

  /** Delete 按焦点对象：单队卡=离队、多队卡=下钻离队菜单、无队=info、框头=散队。 */
  function deleteFocused(): void {
    const fe = document.activeElement as HTMLElement | null
    const headEl = fe?.closest?.<HTMLElement>('.p-frame-head') ?? null
    const nodeEl = fe?.closest?.<HTMLElement>('.p-node') ?? null
    if (headEl !== null) {
      emitAction({ type: 'remove-team', name: headEl.dataset.frame ?? '' })
      return
    }
    if (nodeEl !== null) {
      const id = nodeEl.dataset.id ?? ''
      const teams = model.getNode(id)?.memberships.map(m => m.team) ?? []
      if (teams.length === 0) { notice('info', '该节点未加入任何团队'); return }
      if (teams.length === 1) {
        emitAction({ type: 'remove-member', team: teams[0]!, ids: [id] })
        return
      }
      menuAnchor = nodeEl
      openMenu(window.innerWidth / 2, window.innerHeight / 2, { kind: 'node', id }, 'leave')
      return
    }
    notice('info', '焦点不在节点或团队框上')
  }

  /** Alt+↑/↓: move the focused card within its single team's priority. */
  function altMove(up: boolean): void {
    const fe = document.activeElement as HTMLElement | null
    const nodeEl = fe?.closest?.<HTMLElement>('.p-node') ?? null
    if (nodeEl === null) return
    const id = nodeEl.dataset.id ?? ''
    const mem = model.getNode(id)?.memberships ?? []
    if (mem.length !== 1) return
    const team = mem[0]!.team
    const current = model.teamMemberIds(team)
    const idx = current.indexOf(id)
    const to = up ? Math.max(0, idx - 1) : Math.min(current.length - 1, idx + 1)
    if (to === idx) return
    const desired = [...current]
    desired.splice(idx, 1)
    desired.splice(to, 0, id)
    emitAction({ type: 'reorder', team, ops: reorderOps(current, desired) })
  }

  function keyUp(ev: SeamKey): void {
    if (ev.key === ' ') spaceDown = false
  }

  root.addEventListener('pointerdown', (ev) => pointerDown(ev as unknown as SeamPointer), signal)
  root.addEventListener('pointermove', (ev) => pointerMove(ev as unknown as SeamPointer), signal)
  root.addEventListener('pointerup', (ev) => pointerUp(ev as unknown as SeamPointer), signal)
  root.addEventListener('wheel', (ev) => wheel(ev as unknown as SeamPointer), { ...signal, passive: false })
  root.addEventListener('keydown', (ev) => key(ev as unknown as SeamKey), signal)
  root.addEventListener('keyup', (ev) => keyUp(ev as unknown as SeamKey), signal)
  root.addEventListener('contextmenu', (ev) => {
    const e = ev as unknown as SeamPointer
    e.preventDefault()
    contextMenuAt(e.clientX, e.clientY, e.target)
  }, signal)

  // ── poll reconcile: incremental, never repositions existing nodes ──
  let lastTeams: ReadonlyArray<PlanningTeam> = []

  function reconcile(input: PlanningInput): void {
    lastTeams = input.teams
    lastPeers = input.peers ?? []
    lastInFlight = input.inFlight ?? []
    const memberships = new Map<string, Array<{ team: string; index: number }>>()
    for (const team of input.teams) {
      for (let i = 0; i < team.members.length; i++) {
        const id = team.members[i]!.id
        const list = memberships.get(id) ?? []
        list.push({ team: team.name, index: i })
        memberships.set(id, list)
      }
    }
    const seen = new Set<string>()
    // In-flight write guard: membership entries of teams with unsettled
    // writes come from the model, not the (stale) payload — a poll racing
    // an optimistic add must not snap the new edge away.
    const resolveMemberships = (id: string): Array<{ team: string; index: number }> => {
      const payload = memberships.get(id) ?? []
      if (pendingTeams.size === 0) return payload
      const keep = payload.filter(m => !pendingTeams.has(m.team))
      const pending = (model.getNode(id)?.memberships ?? []).filter(m => pendingTeams.has(m.team))
      return [...keep, ...pending]
    }
    for (const s of input.sessions) {
      if (s.joined !== true) continue
      seen.add(s.id)
      if (model.getNode(s.id) !== undefined) {
        model.upsertNode({
          id: s.id, x: model.getNode(s.id)!.x, y: model.getNode(s.id)!.y,
          label: s.label, team: s.team, name: s.name, live: s.live !== false,
          memberships: resolveMemberships(s.id),
        })
      } else {
        const saved = layoutDoc?.nodes[s.id]
        let x: number
        let y: number
        if (saved !== undefined) { x = saved.x; y = saved.y } else {
          const seat = seatFor2(s.id)
          x = seat.x
          y = seat.y
        }
        model.upsertNode({
          id: s.id, x, y, label: s.label, team: s.team, name: s.name, live: s.live !== false,
          memberships: resolveMemberships(s.id),
        })
      }
    }
    for (const id of model.nodeIds()) {
      if (!seen.has(id) && !id.startsWith('peer-')) model.removeNode(id)
    }

    // Peer nodes (v1 ruling): same model pipeline as sessions, `remote` flag
    // on. Saved positions win; new peers take the deterministic column over
    // the LOCAL content bounds (remote cards hang outside the field and are
    // excluded from bounds, so the column cannot feed back into itself).
    const peerSeen = new Set<string>()
    lastRemoteTeams = groupRemoteTeams(input.remoteTeams ?? [])
    peerScoreByText.clear()
    for (const p of input.peers ?? []) {
      peerScoreByText.set(peerHostOf(p.url), p.score)
    }
    if (input.peers !== undefined) {
      const localBounds = model.contentBounds()
      const placements = placePeers(input.peers, localBounds)
      input.peers.forEach((p, i) => {
        const id = peerNodeId(p.url)
        peerSeen.add(id)
        const saved = layoutDoc?.nodes[id]
        const existing = model.getNode(id)
        const base = existing !== undefined
          ? { x: existing.x, y: existing.y }
          : saved !== undefined
            ? { x: saved.x, y: saved.y }
            : { x: placements[i]?.x ?? 200, y: placements[i]?.y ?? 0 }
        model.upsertNode({
          id, x: base.x, y: base.y,
          label: p.url, team: '', name: p.url, peerUrl: p.url,
          live: true, remote: true, memberships: [],
        })
        model.upsertScore(id, p.score)
      })
    }
    for (const id of model.nodeIds()) {
      if (id.startsWith('peer-') && !peerSeen.has(id)) model.removeNode(id)
    }
    for (const team of input.teams) {
      if (model.getFrame(team.name) !== undefined) continue // live rect wins
      if (pendingTeams.has(team.name)) continue // 散队 in flight: don't resurrect
      const saved = layoutDoc?.frames[team.name]
      if (saved !== undefined) { model.setFrame(team.name, { ...saved }); continue }
      const rects: LayoutRect[] = []
      for (const m of team.members) {
        const n = model.getNode(m.id)
        if (n !== undefined) rects.push(nodeRect(n))
      }
      if (rects.length > 0) model.setFrame(team.name, deriveInitialFrame(rects))
    }
    for (const [name] of model.allFrames()) {
      if (pendingTeams.has(name)) continue // an in-flight create/remove owns this name
      if (!input.teams.some(t => t.name === name)) model.removeFrame(name)
    }
    renderStatus(input)
    render()
  }

  // Same fallback contract as WorldModel.fromState: the card-scaled ring.
  function seatFor2(id: string): { x: number; y: number } {
    return planSeatFor(id)
  }

  function adoptExternalLayout(layout: unknown): void {
    const doc = clampDoc(layout)
    if (doc === undefined) return
    layoutDoc = doc
    if (gesture.kind === 'none') {
      vp = clampViewport({ ...doc.viewport })
    }
    renderedRevision = -1 // force a repaint of frames/edges on next render
    render()
  }

  function snapshotDoc(): unknown {
    return buildLayoutDoc(vp, model.positions(), model.frameRects())
  }

  function setLamp(state: LampState, savedAt?: string): void {
    lamp.classList.remove('pending', 'saved', 'error')
    if (state === 'pending') lamp.classList.add('pending')
    if (state === 'saved') lamp.classList.add('saved')
    if (state === 'error') lamp.classList.add('error')
    // Error state is a keyboard-reachable retry control (review P0-2).
    if (state === 'error') {
      lamp.tabIndex = 0
      lamp.setAttribute('role', 'button')
      lamp.setAttribute('aria-label', '布局保存失败，按回车重试')
    } else {
      lamp.removeAttribute('tabindex')
      lamp.removeAttribute('role')
      lamp.removeAttribute('aria-label')
    }
    const text = state === 'pending' ? '布局待保存…'
      : state === 'saved' ? `布局已保存 ${savedAt ?? ''}`.trimEnd()
      : state === 'error' ? '保存失败 · 回车重试'
      : '布局'
    lampText.textContent = text
  }

  function activate(): void {
    root.style.display = 'block'
    syncViewSize()
    applyViewport()
    root.focus()
  }

  function deactivate(): void { root.style.display = 'none' }

  function destroy(): void {
    ac.abort()
    for (const t of noticeTimers) clearTimeout(t)
  }

  return {
    root,
    reconcile,
    activate,
    deactivate,
    adoptExternalLayout,
    snapshotDoc,
    setLamp,
    notice,
    destroy,
    seam: {
      pointerDown,
      pointerMove,
      pointerUp,
      wheel,
      key,
      keyUp,
      contextMenu(ev: SeamPointer): void {
        ev.preventDefault()
        contextMenuAt(ev.clientX, ev.clientY, ev.target)
      },
    },
  }
}
