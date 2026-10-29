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
 * or middle-drag or Shift+wheel; wheel (with or without Ctrl) =
 * pointer-anchored zoom (owner ruling 2026-09-01).
 * Tests drive the same handlers production binds through `seam`.
 * @module nexus-stage/planning-view
 */

import type { LampState } from './layout-wire'
import { buildLayoutDoc, clampDoc, type LayoutDoc, type LayoutRect } from './layout-doc'
import { FRAME_HEAD_LIFT } from './edges'
import { drawMemberEdges } from './planning-edges'
import { createFederationOverlay } from './federation-overlay'
import { displayName } from './stage-name'
import {
  activityEdges, federalEdges, flyBounds, groupRemoteTeams, peerNodeId, peerHostOf, placePeers,
  type FrameAnchor, type InFlightRow, type PeerPlacement, type PeerRow,
  type RemoteTeamRow,
} from './federation'
import { clampViewport, fitView, panBy, screenToWorld, worldTransformCss, zoomAt, type LayoutViewport } from './viewport'
import { boardBounds, fitBelowHud, hudBottomOf } from './planning-fit'
import { WorldModel, nodeRect, deriveInitialFrame, homeTeams, planSeatClear, planTeamClusters, NODE_W, NODE_H } from './world'
import { applyAction, actionTeam, innermostFrameAt, reorderOps, yOrderedMembers, type CanvasAction } from './canvas-ops'
import { FRAME_HUES } from './tokens'
import { createPlanningMenus } from './planning-menus'
import { createNodeFlyer, mountBoardSearch } from './planning-search'
import { applyBoardRelayout } from './planning-relayout'
import { mirrorRoute } from './planning-mirror'
import { settleBoard, tidyMembers } from './planning-overlap'
import { createLayoutUndo, type LayoutSnap } from './planning-undo'
import { createNodeList } from './planning-nodelist'
import { cardText } from './planning-card-text'
import { createLegend } from './planning-legend'
import { viewportBucket, type PlanningDeps, type PlanningInput, type PlanningSession, type PlanningTeam, type PlanningView, type SeamKey, type SeamPointer, type ViewportBucket } from './planning-types'
import './planning.css'

export { viewportBucket } from './planning-types'
export type { PlanningDeps, PlanningInput, PlanningSession, PlanningTeam, PlanningView, SeamKey, SeamPointer, ViewportBucket } from './planning-types'

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


type Gesture =
  | { readonly kind: 'none' }
  | { readonly kind: 'node'; ids: readonly string[]; clicked: string; last: { x: number; y: number }; moved: boolean; el: Element | null }
  | { readonly kind: 'frame'; name: string; snap: NonNullable<ReturnType<WorldModel['beginFrameDrag']>>; origin: { x: number; y: number }; moved: boolean }
  | { readonly kind: 'frame-resize'; name: string; dir: string; startRect: { x: number; y: number; w: number; h: number }; origin: { x: number; y: number }; moved: boolean }
  | { readonly kind: 'pan'; last: { x: number; y: number }; moved: boolean }
  | { readonly kind: 'marquee'; origin: { x: number; y: number }; last: { x: number; y: number }; additive: boolean }

export function createPlanningView(deps: PlanningDeps): PlanningView {
  const model = new WorldModel()
  let layoutDoc: LayoutDoc | undefined
  let vp: LayoutViewport = { ...model.viewport }
  let gesture: Gesture = { kind: 'none' }
  let spaceDown = false
  let renderedRevision = -1
  /** Until the first reconcile with nodes (or an adopted viewport), frame the content once. */
  let firstFitPending = true
  let settledOnce = false
  const layoutUndo = createLayoutUndo(model) // 撤销 (planning-undo)
  let undoBefore: LayoutSnap | undefined
  let viewportAdopted = false
  const bucket = (): ViewportBucket => viewportBucket(globalThis.innerWidth || viewW)
  const markDirty = (): void => {
    deps.viewportStore?.set(bucket(), vp)
    deps.onDirty()
  }
  const clock = deps.now ?? Date.now
  const ac = new AbortController()
  const noticeTimers: Array<ReturnType<typeof setTimeout>> = []
  /** Active right-button press: hold-drag pans; a clean release opens the
   *  context menu (the contextmenu event itself is always suppressed). */
  let rightPress: { x: number; y: number; target: Element | null; moved: boolean } | null = null
  let suppressNextMenu = false
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
  /** The selected frame keeps its resize handles visible without hover. */
  let selectedFrame: string | undefined
  const markSelectedFrame = (name: string | undefined): void => {
    if (selectedFrame !== undefined) {
      frameEls.get(selectedFrame)?.classList.remove('selected')
    }
    selectedFrame = name
    if (name !== undefined) {
      frameEls.get(name)?.classList.add('selected')
    }
  }
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
  // Review 2026-10-27: the toolbar reads as three groups — view | arrange |
  // network — split by separators; every action stays one click (owner orders).
  const sep = (): HTMLElement => { const s = document.createElement('span'); s.className = 'p-sep'; s.setAttribute('role', 'separator'); s.setAttribute('aria-orientation', 'vertical'); return s }
  toolbar.append(
    mkButton('适配', '适配视图（快捷键 0）', () => fitToContent()),
    mkButton('－', '缩小', () => zoomCenter(1 / 1.2)),
    zoomLabel,
    mkButton('＋', '放大', () => zoomCenter(1.2)),
    sep(),
    mkButton('建队', '组成团队（G）：先框选至少 2 个节点', () => menus.startCreateFromSelection()),
    // gh#48 (owner order, review-seat spec): one-click tidy — inside every
    // team frame, the members that belong to EXACTLY that one team re-seat
    // into a padded grid flow (the frame grows downward, bounded); members
    // of 2+ teams keep their positions (the dashed edges express their
    // membership). Idempotent; empty frames untouched; remote member cards
    // ride the same rule; the move persists through the ordinary layout
    // save loop exactly like a hand drag.
    mkButton('整理成员', '每队框内仅属一队的成员自动排齐（多队成员不动）', () => tidyTeamMembers()),
    // Supervisor order v2 (upgrades gh#48): one-click WHOLE-BOARD relayout —
    // the two buttons split the job (整理成员 = cards inside one frame;
    // 一键重排 = every local frame AND its cards). Frame size derives from
    // content (width and height both); frames tile in a row flow
    // (constructively disjoint); multi-team members never enter the size
    // math and never move; remote org frames and frameless nodes stay put.
    mkButton('一键重排', '全板队框+成员重排：框尺寸随内容自适应、框位行流式平铺（远端队框与多归属成员不动）', () => relayoutBoard()),
    mkButton('撤销', '撤销上一次布局改动：拖动、缩放、整理、重排、载入时避让（Ctrl+Z；入队离队不撤销）', () => undoLayout()),
  )
  // Unjoined sessions ride a toolbar chip + dropdown: the panel-slim
  // migration made the planning view the join surface — without this, an
  // unjoined session had no GUI path into the mesh at all.
  const netBtn = mkButton('未入网', '未入网会话（点击选择入网）', () => menus.toggleNetMenu())
  netBtn.className = 'p-netbtn'
  netBtn.setAttribute('aria-haspopup', 'menu')
  toolbar.append(sep(), netBtn)
  const search = mountBoardSearch(toolbar, model, displayName, id => flyToNode(id))
  // Node list (network-membership-display): the canvas shows teamed nodes
  // only; every other session — teamless joined, unjoined, and each peer's
  // published nodes — is managed from this list, switched by host.
  const nodesBtn = mkButton('节点', '节点清单：本机与对等节点（未组队/未入网在此管理）', () => nodes.toggle())
  nodesBtn.className = 'p-nodebtn'
  nodesBtn.setAttribute('aria-haspopup', 'dialog')
  toolbar.appendChild(nodesBtn)
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

  // Edge key: a closed-by-default fold (planning-legend), not a fixed panel.
  const legend = createLegend()

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

  /**
   * gh#48 (owner order): one-click member tidy. For every team frame, the
   * members belonging to EXACTLY that one team re-seat into a padded grid
   * flow inside the frame (the frame grows downward if the members need
   * more rows — bounded); members of 2+ teams stay put (their dashed edges
   * express membership). Remote member cards (member-) are ordinary board
   * cards and ride the same rule. The move goes through markDirty()/render()
   * — the same persistence path a hand drag takes.
   */
  function tidyTeamMembers(): void {
    const before = layoutUndo.capture()
    tidyMembers(model) // gh#48 grid (planning-overlap); then nothing may overlap
    settleBoard(model, new Set(remoteFramesRef.keys()))
    layoutUndo.commit(before)
    markDirty()
    render()
  }

  /**
   * Supervisor order v2: whole-board deterministic relayout (the planner
   * and the model adapter live in planning-relayout.ts): LOCAL frames +
   * sole members only — remote org frames keep gh#44 live-rect-wins,
   * frameless nodes and multi-team members never move; the same
   * markDirty()/render() persistence path a hand drag takes.
   */
  function relayoutBoard(): void {
    const before = layoutUndo.capture()
    if (!applyBoardRelayout(model, new Set(remoteFramesRef.keys()))) return
    settleBoard(model, new Set(remoteFramesRef.keys())) // vs remote frames + stray cards
    layoutUndo.commit(before)
    markDirty()
    render()
  }

  function render(): void {
    applyViewport()
    if (model.revision !== renderedRevision) {
      renderedRevision = model.revision
      renderFrames()
      renderNodes()
      drawMemberEdges(svg, model) // planning-edges
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
        // Resize handles (owner ruling: the frame canvas is stretchable and
        // adjustable): eight directions, pointer seam routes them to the
        // frame-resize gesture. Purely visual affordance + hit targets.
        for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
          const handle = document.createElement('div')
          handle.className = `p-frame-handle p-h-${dir}`
          handle.dataset.frame = name
          handle.dataset.dir = dir
          el.appendChild(handle)
        }
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
      const mirror = mirrorRoute(remoteFramesRef.get(name), pendingTeams.has(name)) // PR#96 single owner + mirror
      const routeText0 = mirror?.text ?? routeText(name)
      if (route.textContent !== routeText0) route.textContent = routeText0
      route.title = mirror?.title ?? ''
      el.classList.toggle('is-mirror', mirror !== undefined)
      el.classList.toggle('is-syncing', mirror?.syncing === true)
      const label = `团队框 ${name}${mirror !== undefined ? `（${mirror.text}）` : ''}（拖动整组，回车菜单）`
      const headEl = el.querySelector('.p-frame-head')!
      if (headEl.getAttribute('aria-label') !== label) headEl.setAttribute('aria-label', label) // a rewrite re-announces
    }
    for (const [name, el] of [...frameEls]) {
      if (!seen.has(name)) { el.remove(); frameEls.delete(name) }
    }
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
      // Title / second line / tooltip rules: planning-card-text.
      const txt = cardText(n, n.remote === true ? lastRemoteTeams.get(host) ?? [] : [], peerScoreByText.get(host))
      const nmEl = el.querySelector<HTMLElement>('.nm-text')!
      if (nmEl.textContent !== txt.title) nmEl.textContent = txt.title
      const subEl = el.querySelector<HTMLElement>('.sub')!
      if (subEl.textContent !== txt.sub) subEl.textContent = txt.sub
      if (el.title !== txt.tip) el.title = txt.tip
      const prioEl = el.querySelector<HTMLElement>('.prio')!
      if (n.remote === true) {
        // gh#20 W-A: the peer badge — link class colors the chip (linked
        // green / stranger gray), the verified tick/cross rides after it.
        // An absent link field (older host) renders the neutral 'peer'.
        const info = peerInfoByHost.get(host)
        const cls = info?.link === 'linked' ? 'lnk-linked' : info?.link === 'stranger' ? 'lnk-stranger' : ''
        if (prioEl.className !== `prio mono ${cls}`.trim()) prioEl.className = `prio mono ${cls}`.trim()
        const mark = info === undefined ? '' : info.verified === true ? '✓' : '✗'
        const badge = (info?.link ?? 'peer') + mark
        if (prioEl.textContent !== badge) prioEl.textContent = badge
      } else {
        if (prioEl.className !== 'prio mono') prioEl.className = 'prio mono'
        const prioText = n.memberships[0] !== undefined ? `P${n.memberships[0]!.index}` : ''
        if (prioEl.textContent !== prioText) prioEl.textContent = prioText
      }
    }
    for (const [id, el] of [...nodeEls]) {
      if (!seen.has(id)) { el.remove(); nodeEls.delete(id) }
    }
    search.refresh()
  }

  // ── federation overlay (PR D): peer cards' activity/federal edges ──
  // Runs on EVERY render, outside the model-revision gate: the poll's
  // inFlight ages must tick even when the model is unchanged, and the
  // badge column tracks the content bounds each reconcile. Its SVG
  // children are tracked separately because drawMemberEdges clears the svg
  // wholesale - this appends after it (render() orders the two).
  // gh#49: the DOM drawing lives in federation-overlay.ts (module-size
  // ruling); this view keeps only the seams (facts + fly).
  const federation = createFederationOverlay(svg, model)
  let lastPeers: ReadonlyArray<PeerRow> = []
  let lastRemoteTeams: ReadonlyMap<string, RemoteTeamRow[]> = new Map()
  const peerScoreByText = new Map<string, number | undefined>()
  /** gh#20 W-A: per-host link/verified info for the peer badges. */
  const peerInfoByHost = new Map<string, { link?: 'linked' | 'stranger'; verified?: boolean }>()

  function renderFederation(): void {
    federation.render(clock())
  }

  /** Statusbar fly: fit the frames ∪ peers region (flyBounds pads it). */
  function flyToFederation(): void {
    vp = fitView(flyBounds(model.contentBounds(), federation.placements()), root.clientWidth || viewW, root.clientHeight || viewH)
    applyViewport()
    markDirty()
  }

  /** W1 pick: frame one node at ~100% and pulse its card. */
  const flyToNode = createNodeFlyer({ model, viewSize: measure, setVp: next => { vp = next }, applyViewport, markDirty, cardEl: id => nodeEls.get(id) })
  // ── status counts ──
  function renderStatus(input: PlanningInput): void {
    const live = input.sessions.filter(s => s.live !== false).length
    const dot = (host: HTMLElement, cls: string, text: string): void => {
      const b = document.createElement('b')
      b.className = cls
      b.textContent = text
      host.replaceChildren(b)
    }
    dot(statusLive, 'ok', `● ${live} live`)
    dot(statusCold, 'warn', `● ${input.sessions.length - live} cold`)
    statusAct.textContent = `${input.inFlight?.length ?? 0} inFlight`
    statusMut.className = 'mut'
    statusMut.textContent = `${input.teams.length} 队 · ${input.peerCount} peer`
  }

  // ── canvas write actions: optimistic apply + team-scoped undo ──
  // Per-team REFERENCE COUNT: two queued actions on one team keep the guard
  // up until BOTH settle (a Set deleted per action let a mid-queue poll wipe
  // the second action's optimistic membership).
  const pendingTeams = new Map<string, number>()
  // Each change re-renders frames: the mirror 「同步中…」 marker reads pendingTeams, not the model revision.
  const pendingAdd = (team: string): void => { pendingTeams.set(team, (pendingTeams.get(team) ?? 0) + 1); renderedRevision = -1 }
  const pendingRelease = (team: string): void => {
    renderedRevision = -1
    const n = (pendingTeams.get(team) ?? 0) - 1
    if (n <= 0) pendingTeams.delete(team)
    else pendingTeams.set(team, n)
  }
  // gh#41: remote-frame registry (frame name → peer URL), refreshed by
  // reconcile and read by emitAction's serverAction to fork remote drops.
  let remoteFramesRef = new Map<string, string>()

  function emitAction(a: CanvasAction): void {
    // gh#20 W-B: the SERVER sees zone/id8 remote handles where the model
    // keeps its peer-<host> node id — the canvas member contract is
    // session-id-or-remote-ref. Translation happens here, one boundary;
    // the model action keeps board-local ids so rendering and undo stay
    // node-keyed. A peer without a known handle (no remote team rows yet)
    // is filtered out — the server would refuse the raw peer- id.
    function serverAction(act: CanvasAction): CanvasAction {
      const mapIds = (ids: readonly string[]): string[] => {
        const out: string[] = []
        for (const id of ids) {
          // Both remote card families translate to their zone/id8 handle
          // (gh#38: member- cards join teams like peer- cards do).
          if (!id.startsWith('peer-') && !id.startsWith('member-')) { out.push(id); continue }
          const handle = model.getNode(id)?.remoteHandle
          if (handle !== undefined && handle !== '') out.push(handle)
        }
        return out
      }
      if (act.type === 'add-member' || act.type === 'remove-member' || act.type === 'create-team') {
        const ids = mapIds(act.ids)
        // gh#41: a drop into a REMOTE frame carries the peer URL — main.ts
        // forks it to the fleet relay instead of the local canvas control.
        const fleetPeer = act.type !== 'create-team' ? remoteFramesRef.get(act.team) : undefined
        return ids.length > 0 || fleetPeer !== undefined
          ? { ...act, ids, ...(fleetPeer !== undefined ? { fleetPeer } : {}) }
          : act
      }
      return act
    }

    // Optimistic seats: a write may reference a session the teamed gate
    // keeps OFF the model (no canvas card yet). The write actions read and
    // write memberships through the node table, so materialize those ids
    // from the last poll's inventory first — the next reconcile refreshes
    // label/live/teams and keeps the saved-or-seat position.
    if (a.type === 'add-member' || a.type === 'remove-member' || a.type === 'reorder' || a.type === 'create-team') {
      const ids = a.type === 'reorder' ? a.ops.map(op => op.id) : [...a.ids]
      for (const id of ids) {
        if (id === '' || id.startsWith('peer-') || id.startsWith('member-')) continue
        if (model.getNode(id) !== undefined) continue
        const s = lastSessions.find(row => row.id === id)
        if (s === undefined) continue
        const saved = layoutDoc?.nodes[id]
        const seat = saved !== undefined ? { x: saved.x, y: saved.y } : seatFor2(id)
        model.upsertNode({
          id, x: seat.x, y: seat.y, label: s.label, team: s.team, name: s.name, description: s.description,
          live: s.live !== false, memberships: [],
          ...(s.teams !== undefined && s.teams.length > 0 ? { teams: s.teams } : {}),
        })
      }
    }
    const undo = applyAction(model, a)
    const team = actionTeam(a)
    pendingAdd(team)
    render()
    void deps.onCanvasAction(serverAction(a)).then(
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

  // ── popovers: 建队 dialog, context menu, 未入网 dropdown (planning-menus) ──
  const menus = createPlanningMenus({
    root, netBtn, signal, model,
    teams: () => lastTeams,
    anchorFor: (t) => (t.kind === 'node' ? nodeEls.get(t.id) : frameEls.get(t.name)) ?? null,
    emit: emitAction,
    notice,
  })

  // ── 节点列表 drawer (planning-nodelist) ──
  let lastSessions: ReadonlyArray<PlanningSession> = []
  let lastCanvasMemberIds: ReadonlySet<string> = new Set()
  const nodes = createNodeList({
    root, trigger: nodesBtn, signal, model,
    facts: () => ({ sessions: lastSessions, canvasMemberIds: lastCanvasMemberIds, remoteTeams: lastRemoteTeams, teams: lastTeams }),
    menuItem: menus.menuItem,
    emit: emitAction,
    openNameDialog: menus.openNameDialog,
    locate: locateNode,
  })

  /** Center the viewport on one canvas node (the 已组队 row's 定位). */
  function locateNode(id: string): void {
    const n = model.getNode(id)
    if (n === undefined) return
    nodes.close()
    const size = deps.viewSize?.() ?? { w: root.clientWidth > 0 ? root.clientWidth : 800, h: root.clientHeight > 0 ? root.clientHeight : 600 }
    vp = clampViewport({ scale: vp.scale, x: n.x - size.w / (2 * vp.scale), y: n.y - size.h / (2 * vp.scale) })
    applyViewport()
    renderedRevision = -1
    render()
  }

  // ── gestures ──
  function localXY(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = root.getBoundingClientRect()
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  }

  /** Drop dispatch for a moved node drag: 入队 / 队内 y 排序. Leaving a team
   * is an explicit menu action only — dragging out to blank is a position
   * move (owner removal 2026-09-02: the drag-out-to-blank 离队 path is
   * removed; accidental blank drops wrote whole-group removals). */
  function dropDispatch(gesture: Extract<Gesture, { kind: 'node' }>, ev: SeamPointer): void {
    const p = localXY(ev)
    const w = screenToWorld(vp, p.x, p.y)
    const f = innermostFrameAt(new Map(model.allFrames()), w)
    // gh#20 W-B: peer cards join canvas teams too — a mixed local+remote
    // drop composes a cross-host team; the server boundary translates
    // peer ids to zone/id8 handles (emitAction's serverAction). Reorder
    // stays local-only (roster priority is a local-session fact).
    const memberIds = gesture.ids.filter(id => {
      const node = model.getNode(id)
      if (node === undefined) return false
      if (node.remote !== true) return true
      return node.remoteHandle !== undefined && node.remoteHandle !== ''
    })
    if (f !== undefined) {
      const fresh = memberIds.filter(id => !(model.getNode(id)?.memberships.some(m => m.team === f)))
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
    }
    // Blank drop: a position move only. No roster writes — the explicit
    // context-menu 离队 (and the node drawer) remain the removal paths.
  }

  function pointerDown(ev: SeamPointer): void {
    if (viewW === 0) syncViewSize()
    if (menus.isDialogOpen()) { ev.preventDefault(); return } // modal: no gestures behind the dialog
    const target = ev.target as Element | null
    // Context-menu dismissal: the first pointerdown outside an open menu
    // closes it and is swallowed; a press on the menu's own chrome is
    // swallowed too — only its items act.
    if (menus.isMenuOpen()) {
      if (target !== null && target.closest('.p-menu') !== null) return
      menus.closeMenu()
      ev.preventDefault()
      return
    }
    if (target !== null && target.closest('button, input, textarea, select, .p-toolbar, .p-search, .p-lamp, .p-status, .p-legend') !== null) return // HUD chrome owns its presses (no marquee / preventDefault: that stole the search box's focus — and, first, its native right-click menu)
    undoBefore = layoutUndo.capture() // committed at pointerUp only if this press moved something
    const p = localXY(ev)
    // 右键按下：按住拖动 = 平移（Figma 惯例），原地抬起 = 上下文菜单。
    // Pan actually starts on the first move beyond RIGHT_DRAG_THRESHOLD px;
    // a clean press falls through to the context menu at pointerup.
    if (ev.button === 2) {
      rightPress = { x: p.x, y: p.y, target: ev.target, moved: false }
      ev.preventDefault()
      try { root.setPointerCapture(ev.pointerId ?? 0) } catch { /* jsdom */ }
      return
    }
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
    const handleEl = target !== null ? target.closest<HTMLElement>('.p-frame-handle') : null
    // Selection clearing: any press NOT on the selected frame's own chrome
    // (head/handle/body) drops the frame selection.
    if (selectedFrame !== undefined) {
      const selFrameEl = frameEls.get(selectedFrame)
      const onSelectedChrome = target !== null && selFrameEl !== undefined &&
        (selFrameEl.contains(target) || selFrameEl === target)
      const onSelectedHead = headEl !== null && headEl.dataset.frame === selectedFrame
      if (!onSelectedChrome && !onSelectedHead) markSelectedFrame(undefined)
    }
    if (handleEl !== null && ev.button === 0) {
      // Frame resize (owner ruling): record the frame's current rect and
      // the world-space origin; the move branch re-solves the rect per
      // direction with a minimum size clamp.
      const name = handleEl.dataset.frame ?? ''
      markSelectedFrame(name)
      const rect = model.getFrame(name)
      if (rect === undefined) return
      gesture = { kind: 'frame-resize', name, dir: handleEl.dataset.dir ?? 'se', startRect: { ...rect }, origin: screenToWorld(vp, p.x, p.y), moved: false }
      ev.preventDefault()
      try { root.setPointerCapture(ev.pointerId ?? 0) } catch { /* jsdom: no capture */ }
      return
    }
    if (nodeEl !== null) {
      if (ev.button !== 0) return // right on a card: contextmenu only, never a card drag (F3)
      const id = nodeEl.dataset.id ?? ''
      const already = model.isSelected(id)
      if (!already && !ev.shiftKey) model.setSelection([id])
      const ids = ev.shiftKey || already ? (model.isSelected(id) ? model.selectedIds() : [...model.selectedIds(), id]) : [id]
      gesture = { kind: 'node', clicked: id, ids, last: screenToWorld(vp, p.x, p.y), moved: false, el: nodeEl }
      nodeEl.classList.add('dragging')
    } else if (headEl !== null) {
      if (ev.button !== 0) return
      const name = headEl.dataset.frame ?? ''
      // Selecting a frame keeps its resize handles visible (hover-only
      // handles vanished the moment the pointer left).
      markSelectedFrame(name)
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
    if (rightPress !== null) {
      // Right-hold pan: incremental viewport follow once past the threshold.
      // User ruling (2026-08-30): the drag moves the CONTENT, not the window —
      // drag right and the canvas follows the cursor (Figma convention), so
      // the viewport origin moves OPPOSITE the pointer delta. The wheel and
      // middle/space pans keep their own established directions.
      const dx = p.x - rightPress.x
      const dy = p.y - rightPress.y
      if (Math.hypot(dx, dy) > 4) {
        rightPress.moved = true
        vp = clampViewport(panBy(vp, -dx, -dy))
        rightPress.x = p.x
        rightPress.y = p.y
        applyViewport()
      }
      return
    }
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
      // W-B: peers with a remote handle are droppable members too.
      const joinables = gesture.ids.filter(id => {
        const node = model.getNode(id)
        if (node === undefined) return false
        return node.remote !== true || (node.remoteHandle !== undefined && node.remoteHandle !== '')
      })
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
    } else if (gesture.kind === 'frame-resize') {
      // Re-solve the rect from the start rect plus the world delta, per
      // direction. Minimum 220x120 keeps the titlebar and成员 badges
      // readable; the frame rect is independent of member positions, so
      // no node moves — star edges follow on the next render.
      const w = screenToWorld(vp, p.x, p.y)
      const dx = w.x - gesture.origin.x
      const dy = w.y - gesture.origin.y
      if (!gesture.moved && dx === 0 && dy === 0) return
      gesture.moved = true
      const MIN_W = 220
      const MIN_H = 120
      const r = { ...gesture.startRect }
      let { x, y, w: width, h: height } = r
      if (gesture.dir.includes('e')) width = Math.max(MIN_W, r.w + dx)
      if (gesture.dir.includes('s')) height = Math.max(MIN_H, r.h + dy)
      if (gesture.dir.includes('w')) {
        width = Math.max(MIN_W, r.w - dx)
        x = r.x + (r.w - width)
      }
      if (gesture.dir.includes('n')) {
        height = Math.max(MIN_H, r.h - dy)
        y = r.y + (r.h - height)
      }
      model.setFrame(gesture.name, { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) })
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
    if (rightPress !== null) {
      const wasPan = rightPress.moved
      const pressTarget = rightPress.target
      const x = rightPress.x
      const y = rightPress.y
      rightPress = null
      if (wasPan) {
        suppressNextMenu = true
        markDirty() // the viewport persists with the layout
      } else if (pressTarget !== null) {
        menus.contextMenuAt(x, y, pressTarget) // clean right-click: context menu
      }
      return
    }
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
          // 0.6.13: a clean single click is also a node pick — the host opens
          // the chat drawer. Shift-click (multi-select) stays a pure selection.
          deps.onNodePick?.(id)
        }
      } else {
        dropDispatch(gesture, ev)
        markDirty()
      }
      for (const el of frameEls.values()) el.classList.remove('drop-target')
      gesture.el?.classList.remove('dragging')
      render()
    } else if (gesture.kind === 'frame' || gesture.kind === 'frame-resize') {
      // The frame stays where it was put; neighbours and stray cards yield (planning-overlap).
      if (gesture.moved) { settleBoard(model, new Set(remoteFramesRef.keys()), gesture.name); markDirty(); render() }
    } else if (gesture.kind === 'pan') {
      if (gesture.moved) markDirty() // the viewport persists with the layout
    } else if (gesture.kind === 'marquee') {
      const p = gesture.last
      const a = screenToWorld(vp, Math.min(gesture.origin.x, p.x), Math.min(gesture.origin.y, p.y))
      const b = screenToWorld(vp, Math.max(gesture.origin.x, p.x), Math.max(gesture.origin.y, p.y))
      model.marqueeSelect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, gesture.additive)
      marquee.style.display = 'none'
      render()
    }
    gesture = { kind: 'none' }
    if (undoBefore !== undefined) { layoutUndo.commit(undoBefore); undoBefore = undefined }
    try { root.releasePointerCapture(ev.pointerId ?? 0) } catch { /* not captured */ }
  }

  /** The OS took the pointer (touch scroll, system gesture): abandon the press — no drop, no menu, layout back. */
  function pointerCancel(ev: SeamPointer): void {
    for (const el of frameEls.values()) el.classList.remove('drop-target')
    if (gesture.kind === 'node') gesture.el?.classList.remove('dragging')
    const panned = gesture.kind === 'pan' && gesture.moved
    marquee.style.display = 'none'
    rightPress = null
    gesture = { kind: 'none' }
    if (undoBefore !== undefined && layoutUndo.revert(undoBefore)) render()
    if (panned) markDirty() // the pan stays (it is the view, not the layout) and persists like a finished one
    undoBefore = undefined
    try { root.releasePointerCapture(ev.pointerId ?? 0) } catch { /* not captured */ }
  }

  function wheel(ev: SeamPointer): void {
    if (menus.isMenuOpen()) menus.closeMenu()
    const p = localXY(ev)
    // Wheel = pointer-anchored zoom (owner ruling 2026-09-01: 鼠标滚动 =
    // 放大缩小), with or without Ctrl — both muscle memories land on the
    // same action. Shift+wheel keeps the natural-scroll pan as the escape
    // hatch. Line-mode wheels (Firefox, deltaMode=1) report ~3 per notch.
    if (ev.shiftKey && !ev.ctrlKey) {
      const line = ev.deltaMode === 1 ? 16 : 1
      vp = clampViewport(panBy(vp, (ev.deltaX ?? 0) * line, (ev.deltaY ?? 0) * line))
    } else {
      const line = ev.deltaMode === 1 ? 16 : 1
      const factor = Math.exp(-((ev.deltaY ?? 0) * line) * 0.0015)
      vp = zoomAt(vp, factor, p.x, p.y)
    }
    ev.preventDefault()
    applyViewport()
    markDirty()
  }

  function zoomCenter(factor: number): void {
    syncViewSize()
    vp = zoomAt(vp, factor, viewW / 2, viewH / 2)
    applyViewport()
    markDirty()
  }

  function undoLayout(): void {
    if (layoutUndo.undo()) { markDirty(); render() } else notice('info', '没有可撤销的布局改动')
  }

  function fitToContent(): void {
    syncViewSize()
    vp = fitBelowHud(boardBounds(model.contentBounds(), model.allNodes()), viewW, viewH, hudBottomOf(toolbar, status))
    applyViewport()
    markDirty()
  }

  function key(ev: SeamKey): void {
    if (menus.isDialogOpen() || (ev.target as Element | null)?.closest?.('.p-search') !== null) return // modal / search box own their keys
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); search.focus(); return } // W1 Ctrl+K
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undoLayout(); return }
    if (ev.ctrlKey || ev.metaKey) return // browser/OS chords stay browser/OS
    if (menus.isMenuOpen()) {
      // The menu owns most keys (its own handler navigates); Escape still
      // closes from here so a seam/keyboard Esc never gets lost.
      if (ev.key === 'Escape') { menus.closeMenu(); ev.preventDefault() }
      return
    }
    if (ev.key === ' ' && ev.target === root) { spaceDown = true; ev.preventDefault(); return }
    // 键盘全等路径（WCAG 2.2 Dragging Movements）：
    const headTarget = (ev.target as Element | null)?.closest?.('.p-frame-head') ?? null
    if ((ev.key === 'Enter' || ev.key === ' ') && headTarget !== null) {
      ev.preventDefault()
      const r = headTarget.getBoundingClientRect()
      menus.contextMenuAt(r.left + r.width / 2, r.top + r.height / 2, headTarget)
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
      menus.contextMenuAt(r.left + r.width / 2, r.top + r.height / 2, fe)
      return
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteFocused(); return }
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); altMove(ev.key === 'ArrowUp'); return }
    if (ev.key === 'g' || ev.key === 'G') { menus.startCreateFromSelection(); return }
    if (ev.key === '0') { fitToContent(); return }
    if (ev.key === '=' || ev.key === '+') { zoomCenter(1.2); return }
    if (ev.key === '-') { zoomCenter(1 / 1.2); return }
    if (ev.key === 'Escape') {
      if (menus.isMenuOpen()) { menus.closeMenu(); render(); return } // menu > clear selection
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
        const before = layoutUndo.capture()
        model.nudge(ids, d[0]!, d[1]!)
        layoutUndo.commit(before)
        render()
        markDirty()
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
      menus.openMenu(window.innerWidth / 2, window.innerHeight / 2, { kind: 'node', id }, 'leave', nodeEl)
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
  root.addEventListener('pointercancel', (ev) => pointerCancel(ev as unknown as SeamPointer), signal)
  root.addEventListener('wheel', (ev) => wheel(ev as unknown as SeamPointer), { ...signal, passive: false })
  root.addEventListener('keydown', (ev) => key(ev as unknown as SeamKey), signal)
  root.addEventListener('keyup', (ev) => keyUp(ev as unknown as SeamKey), signal)
  root.addEventListener('contextmenu', (ev) => {
    const e = ev as unknown as SeamPointer
    if ((e.target as Element | null)?.closest?.('input, textarea, .p-search') != null) return // text fields keep the native menu (paste)
    // Right-drag pans (suppressNextMenu); a clean right-click opens the
    // menu programmatically at pointerup. Either way the native menu dies.
    e.preventDefault()
    if (suppressNextMenu) { suppressNextMenu = false; return }
    menus.contextMenuAt(e.clientX, e.clientY, e.target)
  }, signal)

  // ── poll reconcile: incremental, never repositions existing nodes ──
  let lastTeams: ReadonlyArray<PlanningTeam> = []

  function reconcile(input: PlanningInput): void {
    // gh#41: remote-frame registry shared with serverAction (drop fork).
    lastTeams = input.teams
    lastPeers = input.peers ?? []
    federation.setInFlight(input.inFlight ?? [])
    // Unjoined sessions have no node on the canvas — the panel-slim
    // migration made this view the join surface, so they ride a compact
    // toolbar chip instead of vanishing entirely.
    lastSessions = input.sessions
    menus.setUnjoined(input.sessions.filter(s => s.joined !== true && !s.id.startsWith('peer-')))
    const memberships = new Map<string, Array<{ team: string; index: number }>>()
    for (const team of input.teams) {
      for (let i = 0; i < team.members.length; i++) {
        const id = team.members[i]!.id
        const list = memberships.get(id) ?? []
        list.push({ team: team.name, index: i })
        memberships.set(id, list)
      }
    }
    lastCanvasMemberIds = new Set(memberships.keys())
    const seen = new Set<string>()
    // In-flight write guard: membership entries of teams with unsettled
    // writes come from the model, not the (stale) payload — a poll racing
    // an optimistic add must not snap the new edge away.
    const resolveMemberships = (id: string): Array<{ team: string; index: number }> => {
      const payload = memberships.get(id) ?? []
      if (pendingTeams.size === 0) return payload
      const keep = payload.filter(m => !pendingTeams.has(m.team))
      // In-flight teams read their in-membership from the team roster
      // (teamMemberIds), NOT from getNode(id).memberships: an optimistic
      // add can target a node the teamed gate kept OFF the model (no card
      // yet) — its membership lives only in the roster map, and dropping
      // it here would pop the node right back off the canvas mid-flight.
      const pending: Array<{ team: string; index: number }> = []
      for (const [team] of pendingTeams) {
        const roster = model.teamMemberIds(team)
        const index = roster.indexOf(id)
        if (index >= 0) pending.push({ team, index })
      }
      return [...keep, ...pending]
    }
    // First build with nothing saved: seat the fleet team by team (see
    // planTeamClusters). Later arrivals, or any board with a saved layout,
    // keep the ring fallback.
    let clusterSeats: Map<string, { x: number; y: number }> | undefined
    if (layoutDoc === undefined && !model.allNodes().some(n => n.remote !== true)) {
      const seatIds = input.sessions
        .filter(s => s.joined === true && (resolveMemberships(s.id).length > 0 || (s.teams?.length ?? 0) > 0))
        .map(s => s.id)
      syncViewSize()
      clusterSeats = planTeamClusters(input.teams, seatIds, viewW > 0 ? viewW : undefined)
    }
    for (const s of input.sessions) {
      if (s.joined !== true) continue
      // Teamed-only canvas (network-membership-display ruling): a joined
      // session earns a canvas node only with a team — canvas membership
      // (optimistic-aware) or a declared roster team. Teamless joined
      // sessions ride the node list's 未组队 group instead; sessions absent
      // from `seen` are swept from the model below.
      const effective = resolveMemberships(s.id)
      if (effective.length === 0 && (s.teams === undefined || s.teams.length === 0)) continue
      seen.add(s.id)
      if (model.getNode(s.id) !== undefined) {
        model.upsertNode({
          id: s.id, x: model.getNode(s.id)!.x, y: model.getNode(s.id)!.y,
          label: s.label, team: s.team, name: s.name, description: s.description, live: s.live !== false,
          memberships: effective,
          ...(s.teams !== undefined && s.teams.length > 0 ? { teams: s.teams } : {}),
        })
      } else {
        const saved = layoutDoc?.nodes[s.id]
        let x: number
        let y: number
        if (saved !== undefined) { x = saved.x; y = saved.y } else {
          const seat = clusterSeats?.get(s.id) ?? seatFor2(s.id)
          x = seat.x
          y = seat.y
        }
        model.upsertNode({
          id: s.id, x, y, label: s.label, team: s.team, name: s.name, description: s.description, live: s.live !== false,
          memberships: effective,
          ...(s.teams !== undefined && s.teams.length > 0 ? { teams: s.teams } : {}),
        })
      }
    }
    for (const id of model.nodeIds()) {
      // peer- and member- cards are reconciled by their own blocks below.
      if (!seen.has(id) && !id.startsWith('peer-') && !id.startsWith('member-')) model.removeNode(id)
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
      peerInfoByHost.set(peerHostOf(p.url), { link: p.link, verified: p.verified })
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
        // gh#20 W-B: the peer's server-side member form — its first remote
        // team row's zone/id8 handle (canvas remote refs are exact handles
        // per the D1 ruling). Absent until the first remote team row lands.
        const host = peerHostOf(p.url)
        const handle = lastRemoteTeams.get(host)?.[0]?.team
        model.upsertNode({
          id, x: base.x, y: base.y,
          label: p.url, team: '', name: p.url, peerUrl: p.url,
          remoteHandle: handle,
          live: true, remote: true, memberships: [],
        })
        model.upsertScore(id, p.score)
      })
    }
    for (const id of model.nodeIds()) {
      if (id.startsWith('peer-') && !peerSeen.has(id)) model.removeNode(id)
    }
    // gh#38 (owner ruling 「统一到画布里面拖拽」): every remote session-team
    // HANDLE renders as its own draggable card, stacked beside its host's
    // peer card — pulling a specific remote member into a local team is a
    // plain drag (no picker, no hand-typed handle). Host cards stay for
    // federation context; the member cards carry the actual join gesture.
    const memberSeen = new Set<string>()
    for (const [host, rows] of lastRemoteTeams) {
      const hostNode = model.allNodes().find(n => n.remote === true && peerHostOf(n.peerUrl ?? '') === host && !n.id.startsWith('member-'))
      const baseX = (hostNode?.x ?? 400) + 190
      let y = hostNode?.y ?? 0
      for (const row of rows) {
        if (!row.team.includes('/')) continue
        const id = `member-${row.team.replace(/[^a-z0-9-]/gi, '-')}`
        if (memberSeen.has(id)) continue
        memberSeen.add(id)
        const saved = layoutDoc?.nodes[id]
        const existing = model.getNode(id)
        const pos = existing !== undefined ? { x: existing.x, y: existing.y } : saved !== undefined ? { x: saved.x, y: saved.y } : { x: baseX, y }
        y += 92
        model.upsertNode({
          id, x: pos.x, y: pos.y,
          label: row.team, team: row.team, name: row.name !== undefined && row.name !== '' ? row.name : row.team,
          remoteHandle: row.team,
          live: true, remote: true, memberships: [],
        })
      }
    }
    for (const id of model.nodeIds()) {
      if (id.startsWith('member-') && !memberSeen.has(id)) model.removeNode(id)
    }
    // gh#42 (owner report: dragged a remote peer into base, no edge): team
    // edges derive from NODE memberships, but remote cards carried hardcoded
    // empty memberships — the server truth (base contains dsh/d659a8f9)
    // never re-attached after a poll or reload. Re-attach here: every local
    // team's remote member handles resolve onto their cards (member- card
    // preferred, the peer HOST card as fallback), in-flight teams excluded.
    const handleToNode = new Map<string, string>()
    for (const n of model.allNodes()) {
      if (n.remote !== true || n.remoteHandle === undefined || n.remoteHandle === '') continue
      if (!handleToNode.has(n.remoteHandle) || n.id.startsWith('member-')) handleToNode.set(n.remoteHandle, n.id)
    }
    for (const team of input.teams) {
      if (pendingTeams.has(team.name)) continue
      const resolved: string[] = []
      for (const m of team.members) {
        const id = handleToNode.get(m.id) ?? m.id
        if (model.getNode(id) !== undefined) resolved.push(id)
      }
      const current = [...model.teamMemberIds(team.name)].sort().join('|')
      const next = [...resolved].sort().join('|')
      if (current !== next) model.setTeamMembers(team.name, resolved)
    }
    // gh#41 fleet planning: the peers' published canvas org renders as
    // REMOTE team frames — the owner reads the other side's grouping from
    // ANY node and regulates it in place. Members attach as board
    // memberships; drops into a remote frame fork to the host relay (see
    // serverAction: the action carries fleetPeer, and main.ts routes it to
    // /__dsh_a2a/fleet-canvas-op instead of the local canvas control).
    const remoteFrames = new Map<string, string>()
    const prevRemoteFrames = remoteFramesRef
    remoteFramesRef = remoteFrames
    if (input.peerOrg !== undefined) {
      let slot = 0
      const localNames = new Set(input.teams.map(t => t.name))
      for (const row of input.peerOrg) {
        // The peer's zone comes from its directory rows ('dsh/xxxx' →
        // 'dsh'); the org's members are stored verbatim — LOCAL members as
        // session ids, remote members as zone/id8 handles. Both must
        // resolve onto that host's session cards: id-form members become
        // `member-<zone>-<id8>` (id8 = strip 'session-' prefix, first 8
        // chars — the repo's id8 derivation), handle members sanitize
        // directly. The old sanitize-only pass misresolved every local
        // member (owner: 数据对不上).
        const peerZone = input.remoteTeams?.find(r => r.via === row.url)?.team.split('/')[0] ?? 'dsh'
        const id8of = (id: string): string => id.replace(/^session-/, '').slice(0, 8)
        // The server now canonicalizes org members to handles (gh#41 wire
        // form); the id-form branch stays as the defensive path for peers
        // on an older build that still publish raw session ids.
        const memberBoardId = (m: string): string =>
          m.includes('/') ? `member-${m.replace(/[^a-z0-9-]/gi, '-')}` : `member-${peerZone}-${id8of(m)}`
        for (const team of row.org) {
          if (team.name === '' || localNames.has(team.name)) continue
          const memberIds = team.members.map(memberBoardId).filter(id => model.getNode(id) !== undefined)
          const saved = layoutDoc?.frames?.[team.name]
          // gh#44 (owner: frame position/size never sticks): the LOCAL-team
          // path keeps an existing frame's live rect ("live rect wins" — a
          // poll must not snap a frame the user just dragged, the save loop
          // persists it a beat later). Remote frames re-set unconditionally
          // every poll, so every drag snapped back before the save landed.
          // Same contract here: only place the frame when it is absent.
          if (model.getFrame(team.name) === undefined) {
            model.setFrame(team.name, saved !== undefined ? { x: saved.x, y: saved.y, w: saved.w, h: saved.h } : { x: 200 + (slot % 4) * 280, y: 940 + Math.floor(slot / 4) * 160, w: 250, h: 130 })
          }
          model.setTeamMembers(team.name, memberIds)
          remoteFrames.set(team.name, row.url)
          slot += 1
        }
      }
    }
    for (const [name, url] of prevRemoteFrames) {
      if (!remoteFrames.has(name)) {
        model.removeFrame(name)
        void url
      }
    }
    // gh#20 W-B: the server echoes cross-host members as zone/id8 handles —
    // map each handle back onto the peer node that carries it, so the
    // reconcile keeps remote memberships instead of dropping them.
    const handleToPeer = new Map<string, string>()
    for (const n of model.allNodes()) {
      if (n.remote === true && n.remoteHandle !== undefined && n.remoteHandle !== '') handleToPeer.set(n.remoteHandle, n.id)
    }
    const homes = homeTeams(input.teams)
    for (const team of input.teams) {
      if (model.getFrame(team.name) !== undefined) continue // live rect wins
      if (pendingTeams.has(team.name)) continue // 散队 in flight: don't resurrect
      const saved = layoutDoc?.frames[team.name]
      if (saved !== undefined) { model.setFrame(team.name, { ...saved }); continue }
      // A derived frame wraps its HOME members only: a cross-team member is
      // reached by its dashed edge, not by stretching this frame over its
      // home frame. A team made only of members homed elsewhere falls back
      // to wrapping them all.
      const rects: LayoutRect[] = []
      const all: LayoutRect[] = []
      for (const m of team.members) {
        const n = model.getNode(handleToPeer.get(m.id) ?? m.id)
        if (n === undefined) continue
        all.push(nodeRect(n))
        if (homes.get(n.id) === team.name) rects.push(nodeRect(n))
      }
      const wrap = rects.length > 0 ? rects : all
      if (wrap.length > 0) model.setFrame(team.name, deriveInitialFrame(wrap))
    }
    for (const [name] of model.allFrames()) {
      if (pendingTeams.has(name)) continue // an in-flight create/remove owns this name
      // gh#41: remote org frames are reconciled by the peerOrg block above —
      // the local-team cleanup must not remove them.
      if (!input.teams.some(t => t.name === name) && !remoteFrames.has(name)) model.removeFrame(name)
    }
    // An open node panel follows the poll: facts (joins, leaves, team
    // declarations, peer arrivals) land within one cadence.
    nodes.refresh()
    renderStatus(input)
    // First-run framing: with no saved layout the ring seats are centered on
    // world (0,0) while the viewport origin is the board's top-left corner,
    // so half the fleet landed above/left of the view and a healthy board
    // opened empty. Fit once, the first time there is something to frame.
    // Not marked dirty — nothing the user arranged changed; a saved layout
    // (adopted at any point) keeps its own viewport and cancels this.
    // Once per load, a board that arrives overlapped is shown settled (not
    // saved: no write without a user action; the next edit persists it).
    if (!settledOnce && gesture.kind === 'none' && model.nodeIds().length > 0) { settledOnce = true; const b = layoutUndo.capture(); settleBoard(model, new Set(remoteFramesRef.keys())); layoutUndo.commit(b) }
    if (firstFitPending && gesture.kind === 'none' && model.nodeIds().length > 0) {
      syncViewSize()
      if (viewW > 0 && viewH > 0) {
        firstFitPending = false
        // Peer cards hang outside the local content bounds — frame them too,
        // or the federation column opens clipped at the board's edge. Same
        // framing as 适配 (planning-fit): ≤100%, below the HUD.
        vp = fitBelowHud(boardBounds(model.contentBounds(), model.allNodes()), viewW, viewH, hudBottomOf(toolbar, status))
      }
    }
    render()
  }

  // Same fallback contract as WorldModel.fromState: the card-scaled ring.
  function seatFor2(id: string): { x: number; y: number } {
    return planSeatClear(id, model.allNodes().filter(n => n.remote !== true))
  }

  function adoptExternalLayout(layout: unknown): void {
    const doc = clampDoc(layout)
    if (doc === undefined) return
    layoutDoc = doc
    const store = deps.viewportStore
    if (store === undefined) {
      firstFitPending = false
      if (gesture.kind === 'none') vp = clampViewport({ ...doc.viewport })
    } else if (!viewportAdopted && gesture.kind === 'none') {
      viewportAdopted = true
      const local = store.get(bucket()) as Partial<LayoutViewport> | null | undefined
      if (local != null && Number.isFinite(local.x) && Number.isFinite(local.y) && Number.isFinite(local.scale)) {
        vp = clampViewport({ x: local.x!, y: local.y!, scale: local.scale! })
        firstFitPending = false
      } else if (bucket() === 'wide') {
        vp = clampViewport({ ...doc.viewport })
        firstFitPending = false
      } // narrow/medium with no memory of its own: keep firstFitPending, frame on reconcile
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
      pointerCancel,
      wheel,
      key,
      keyUp,
      contextMenu(ev: SeamPointer): void {
        ev.preventDefault()
        menus.contextMenuAt(ev.clientX, ev.clientY, ev.target)
      },
    },
  }
}
