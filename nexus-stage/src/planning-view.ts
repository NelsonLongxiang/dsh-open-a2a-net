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
import { starEdges } from './edges'
import { clampViewport, fitView, panBy, screenToWorld, worldTransformCss, zoomAt, type LayoutViewport } from './viewport'
import { NODE_H, WorldModel, nodeRect, deriveInitialFrame, planSeatFor, type SessionLite, type TeamLite } from './world'
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
}

export interface PlanningDeps {
  /** An edit that should persist happened (drag/nudge/pan/zoom/marquee end). */
  onDirty(): void
  /** The save lamp was clicked (error state -> retry). */
  onLampClick(): void
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
  preventDefault(): void
}

export interface SeamKey { key: string; shiftKey: boolean; target: Element | null; preventDefault(): void }

type Gesture =
  | { readonly kind: 'none' }
  | { readonly kind: 'node'; ids: readonly string[]; last: { x: number; y: number }; moved: boolean; el: Element | null }
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
  seam: {
    pointerDown(ev: SeamPointer): void
    pointerMove(ev: SeamPointer): void
    pointerUp(ev: SeamPointer): void
    wheel(ev: SeamPointer): void
    key(ev: SeamKey): void
    keyUp(ev: SeamKey): void
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
  const ac = new AbortController()
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
  world.appendChild(svg)

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
  )
  const lamp = document.createElement('span')
  lamp.className = 'p-lamp'
  const lampDot = document.createElement('i')
  const lampText = document.createElement('span')
  lampText.textContent = '布局'
  lamp.append(lampDot, lampText)
  lamp.addEventListener('click', () => { if (lamp.classList.contains('error')) deps.onLampClick() }, signal)
  toolbar.appendChild(lamp)

  const status = document.createElement('div')
  status.className = 'p-status'
  const statusLive = document.createElement('span')
  const statusCold = document.createElement('span')
  const statusMut = document.createElement('span')
  statusMut.className = 'mut'
  status.append(statusLive, statusCold, statusMut)

  const legend = document.createElement('div')
  legend.className = 'p-legend'
  const legendRow = (dashed: boolean, text: string): void => {
    const row = document.createElement('span')
    const bar = document.createElement('i')
    if (dashed) bar.className = 'dashed'
    row.append(bar, document.createTextNode(text))
    legend.appendChild(row)
  }
  legendRow(false, '成员边（星形，框→成员）')
  legendRow(true, '跨队多属（虚线）')

  root.append(grid, world, marquee, toolbar, status, legend)

  // ── viewport application ──
  let viewW = 0
  let viewH = 0

  function applyViewport(): void {
    world.style.transform = worldTransformCss(vp)
    const step = 24 * vp.scale
    grid.style.backgroundSize = `${step}px ${step}px`
    grid.style.backgroundPosition = `${-vp.x * vp.scale}px ${-vp.y * vp.scale}px`
    zoomLabel.textContent = `${Math.round(vp.scale * 100)}%`
  }

  function render(): void {
    applyViewport()
    if (model.revision === renderedRevision) return
    renderedRevision = model.revision
    renderFrames()
    renderNodes()
    renderEdges()
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
        const title = document.createElement('span')
        title.className = 'ttl'
        const cnt = document.createElement('span')
        cnt.className = 'cnt mono'
        const route = document.createElement('span')
        route.className = 'route mono'
        head.append(title, cnt, route)
        el.appendChild(head)
        world.appendChild(el)
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
        world.appendChild(el)
        nodeEls.set(n.id, el)
      }
      const r = nodeRect(n)
      el.style.left = `${r.x}px`
      el.style.top = `${r.y}px`
      el.classList.toggle('cold', !n.live)
      el.classList.toggle('selected', model.isSelected(n.id))
      const nmText = n.name ?? n.label
      const nmEl = el.querySelector<HTMLElement>('.nm-text')!
      if (nmEl.textContent !== nmText) nmEl.textContent = nmText
      const subEl = el.querySelector<HTMLElement>('.sub')!
      const subText = n.team + (n.name !== undefined && n.name !== '' ? ' · ' + n.name : '')
        + (n.memberships.length > 1 ? ` · 跨队×${n.memberships.length}` : '')
      if (subEl.textContent !== subText) subEl.textContent = subText
      const prioEl = el.querySelector<HTMLElement>('.prio')!
      const first = n.memberships[0]
      const prioText = first !== undefined ? `P${first.index}` : ''
      if (prioEl.textContent !== prioText) prioEl.textContent = prioText
    }
    for (const [id, el] of [...nodeEls]) {
      if (!seen.has(id)) { el.remove(); nodeEls.delete(id) }
    }
  }

  // ── edges: stateless, rebuilt wholesale ──
  function renderEdges(): void {
    while (svg.firstChild !== null) svg.firstChild.remove()
    const teams = lastTeams.map(t => ({ name: t.name, members: t.members }))
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
    statusMut.className = 'mut'
    statusMut.textContent = `${input.teams.length} 队 · ${input.peerCount} peer`
  }

  // ── gestures ──
  function localXY(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = root.getBoundingClientRect()
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  }

  function pointerDown(ev: SeamPointer): void {
    if (viewW === 0) { viewW = root.clientWidth; viewH = root.clientHeight }
    const target = ev.target as Element | null
    if (target !== null && (target.closest('button') !== null || target.closest('.p-lamp') !== null)) return
    const p = localXY(ev)
    const nodeEl = target !== null ? target.closest<HTMLElement>('.p-node') : null
    const headEl = target !== null ? target.closest<HTMLElement>('.p-frame-head') : null
    if (nodeEl !== null) {
      const id = nodeEl.dataset.id ?? ''
      const already = model.isSelected(id)
      if (!already && !ev.shiftKey) model.setSelection([id])
      const ids = ev.shiftKey || already ? (model.isSelected(id) ? model.selectedIds() : [...model.selectedIds(), id]) : [id]
      gesture = { kind: 'node', ids, last: screenToWorld(vp, p.x, p.y), moved: false, el: nodeEl }
      nodeEl.classList.add('dragging')
    } else if (headEl !== null) {
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
      const id = gesture.ids[0] ?? ''
      if (!gesture.moved && gesture.ids.length === 1) {
        // A click (no drag): shift toggles, plain click selects alone.
        if (ev.shiftKey) {
          const current = model.selectedIds()
          model.setSelection(current.includes(id) ? current.filter(x => x !== id) : [...current, id])
        } else {
          model.setSelection([id])
        }
      } else {
        deps.onDirty()
      }
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
    const p = localXY(ev)
    if (ev.ctrlKey) {
      const factor = Math.exp(-(ev.deltaY ?? 0) * 0.0015)
      vp = zoomAt(vp, factor, p.x, p.y)
    } else {
      vp = panBy(vp, -(ev.deltaX ?? 0), -(ev.deltaY ?? 0))
    }
    ev.preventDefault()
    applyViewport()
    deps.onDirty()
  }

  function zoomCenter(factor: number): void {
    vp = zoomAt(vp, factor, viewW / 2, viewH / 2)
    applyViewport()
    deps.onDirty()
  }

  function fitToContent(): void {
    vp = fitView(model.contentBounds(), root.clientWidth || viewW, root.clientHeight || viewH)
    applyViewport()
    deps.onDirty()
  }

  function key(ev: SeamKey): void {
    if (ev.key === ' ' && ev.target === root) { spaceDown = true; ev.preventDefault(); return }
    if (ev.key === '0') { fitToContent(); return }
    if (ev.key === '=' || ev.key === '+') { zoomCenter(1.2); return }
    if (ev.key === '-') { zoomCenter(1 / 1.2); return }
    if (ev.key === 'Escape') { model.setSelection([]); render(); return }
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

  function keyUp(ev: SeamKey): void {
    if (ev.key === ' ') spaceDown = false
  }

  root.addEventListener('pointerdown', (ev) => pointerDown(ev as unknown as SeamPointer), signal)
  root.addEventListener('pointermove', (ev) => pointerMove(ev as unknown as SeamPointer), signal)
  root.addEventListener('pointerup', (ev) => pointerUp(ev as unknown as SeamPointer), signal)
  root.addEventListener('wheel', (ev) => wheel(ev as unknown as SeamPointer), { ...signal, passive: false })
  root.addEventListener('keydown', (ev) => key(ev as unknown as SeamKey), signal)
  root.addEventListener('keyup', (ev) => keyUp(ev as unknown as SeamKey), signal)

  // ── poll reconcile: incremental, never repositions existing nodes ──
  let lastTeams: ReadonlyArray<PlanningTeam> = []

  function reconcile(input: PlanningInput): void {
    lastTeams = input.teams
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
    for (const s of input.sessions) {
      if (s.joined !== true) continue
      seen.add(s.id)
      if (model.getNode(s.id) !== undefined) {
        model.upsertNode({
          id: s.id, x: model.getNode(s.id)!.x, y: model.getNode(s.id)!.y,
          label: s.label, team: s.team, name: s.name, live: s.live !== false,
          memberships: memberships.get(s.id) ?? [],
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
          memberships: memberships.get(s.id) ?? [],
        })
      }
    }
    for (const id of model.nodeIds()) {
      if (!seen.has(id)) model.removeNode(id)
    }
    for (const team of input.teams) {
      if (model.getFrame(team.name) !== undefined) continue // live rect wins
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
    const text = state === 'pending' ? '布局待保存…'
      : state === 'saved' ? `布局已保存 ${savedAt ?? ''}`.trimEnd()
      : state === 'error' ? '保存失败 · 点击重试'
      : '布局'
    lampText.textContent = text
  }

  function activate(): void {
    root.style.display = 'block'
    viewW = root.clientWidth
    viewH = root.clientHeight
    applyViewport()
    root.focus()
  }

  function deactivate(): void { root.style.display = 'none' }

  function destroy(): void { ac.abort() }

  return {
    root,
    reconcile,
    activate,
    deactivate,
    adoptExternalLayout,
    snapshotDoc,
    setLamp,
    destroy,
    seam: {
      pointerDown,
      pointerMove,
      pointerUp,
      wheel,
      key,
      keyUp,
    },
  }
}
