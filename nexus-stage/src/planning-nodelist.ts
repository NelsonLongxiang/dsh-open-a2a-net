/**
 * The 节点 drawer (network-membership-display): the canvas shows teamed
 * nodes only, so every other session — teamless joined, unjoined, and each
 * peer's published nodes — is listed and managed here, switched by host.
 * Split out of planning-view; it reads the latest poll facts through
 * `facts()` and writes only through the view's action channel.
 * @module nexus-stage/planning-nodelist
 */
import type { CanvasAction } from './canvas-ops'
import type { RemoteTeamRow } from './federation'
import type { PlanningSession, PlanningTeam } from './planning-types'
import type { WorldModel } from './world'
import { makeSessionDraggable } from './session-drag'

export interface NodeListFacts {
  readonly sessions: ReadonlyArray<PlanningSession>
  readonly canvasMemberIds: ReadonlySet<string>
  /** Remote team rows grouped by peer host (federation.groupRemoteTeams). */
  readonly remoteTeams: ReadonlyMap<string, RemoteTeamRow[]>
  readonly teams: ReadonlyArray<PlanningTeam>
}

export interface NodeListDeps {
  readonly root: HTMLElement
  /** The toolbar's 节点 button: the drawer anchors to it and returns focus there. */
  readonly trigger: HTMLButtonElement
  readonly signal: AddEventListenerOptions
  readonly model: WorldModel
  facts(): NodeListFacts
  menuItem(label: string, enabled: boolean, onPick: () => void): HTMLButtonElement
  emit(a: CanvasAction): void
  openNameDialog(ids: readonly string[]): void
  /** Center the board on one canvas node (closes the drawer). */
  locate(id: string): void
}

export interface PlanningNodeList {
  toggle(): void
  close(): void
  /** Re-render an open drawer from the latest facts (no-op when closed). */
  refresh(): void
}

export function createNodeList(d: NodeListDeps): PlanningNodeList {
  const { root, trigger: nodesBtn, signal, model } = d

  // ── 节点列表 drawer（组队节点上画布；单一节点按 host/对等节点在列表管理）──
  let nodePanel: HTMLDivElement | null = null
  let nodeHost = '' // '' = 本机；否则为 d.facts().remoteTeams 的 host:port 键
  let nodeJoinMenu: HTMLDivElement | null = null
  let joiningId: string | undefined
  let dragging = false
  let renderedFacts = ''
  const joinChoices = new Map<string, HTMLButtonElement>()

  const mayJoin = (id: string, team: string): boolean => d.facts().sessions.some(s => s.id === id && s.joined === true)
    && d.facts().teams.some(t => t.name === team)
    && model.getNode(id)?.memberships.some(m => m.team === team) !== true

  function refreshChoices(): void {
    if (joiningId === undefined) return
    for (const [team, button] of joinChoices) {
      button.disabled = !mayJoin(joiningId, team)
      button.setAttribute('aria-disabled', String(button.disabled))
    }
  }

  function draggable(row: HTMLElement, id: string): void {
    makeSessionDraggable(row, id)
    row.addEventListener('dragstart', () => { dragging = true })
    row.addEventListener('dragend', () => { dragging = false; if (nodePanel !== null) renderNodePanel() })
  }

  function closeNodeJoinMenu(): void {
    nodeJoinMenu?.remove()
    nodeJoinMenu = null
    joiningId = undefined
    joinChoices.clear()
  }
  function closeNodePanel(): void {
    closeNodeJoinMenu()
    dragging = false
    nodePanel?.remove()
    nodePanel = null
    renderedFacts = ''
  }
  function toggleNodePanel(): void {
    if (nodePanel !== null) { closeNodePanel(); return }
    const el = document.createElement('div')
    el.className = 'p-menu p-nodelist'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', '节点清单')
    nodePanel = el
    root.appendChild(el)
    const rect = nodesBtn.getBoundingClientRect()
    el.style.left = `${String(Math.min(rect.left, window.innerWidth - 340))}px`
    el.style.top = `${String(Math.max(8, rect.top - 320))}px`
    el.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Escape') {
        ev.stopPropagation()
        closeNodePanel()
        nodesBtn.focus()
      }
    })
    renderNodePanel()
  }

  /** Rebuild the panel's host selector + body from the latest poll facts. */
  function renderNodePanel(): void {
    const el = nodePanel
    if (el === null) return
    // A poll may update facts, but must not detach a native drag or an open menu.
    if (dragging || nodeJoinMenu !== null) { refreshChoices(); return }
    const latest = d.facts()
    const stamp = JSON.stringify([nodeHost, latest.sessions, Array.from(latest.canvasMemberIds), Array.from(latest.remoteTeams), latest.teams])
    if (stamp === renderedFacts && el.firstElementChild !== null) return
    renderedFacts = stamp
    const scroll = el.querySelector('.p-nodelist-body')?.scrollTop ?? 0
    el.textContent = ''
    const head = document.createElement('div')
    head.className = 'p-nodelist-head'
    const headLabel = document.createElement('span')
    headLabel.className = 'p-nodelist-title'
    headLabel.textContent = '节点'
    const sel = document.createElement('select')
    sel.className = 'p-nodesel'
    sel.setAttribute('aria-label', '选择 host 或对等节点')
    const localOpt = document.createElement('option')
    localOpt.value = ''
    localOpt.textContent = '本机'
    sel.appendChild(localOpt)
    for (const [host, rows] of d.facts().remoteTeams) {
      if (host === '') continue
      const opt = document.createElement('option')
      opt.value = host
      opt.textContent = rows[0]?.origin !== undefined && rows[0].origin !== '' ? `${rows[0].origin}（${host}）` : host
      sel.appendChild(opt)
    }
    if (nodeHost !== '' && !d.facts().remoteTeams.has(nodeHost)) nodeHost = ''
    sel.value = nodeHost
    sel.addEventListener('change', () => { closeNodeJoinMenu(); nodeHost = sel.value; renderNodePanel() })
    head.append(headLabel, sel)
    const body = document.createElement('div')
    body.className = 'p-nodelist-body'
    el.append(head, body)
    if (nodeHost === '') renderLocalNodeGroups(body)
    else renderRemoteNodeGroups(body, d.facts().remoteTeams.get(nodeHost) ?? [])
    body.scrollTop = scroll
  }

  function nodeRowDot(live: boolean | undefined, joined: boolean): HTMLSpanElement {
    const dot = document.createElement('span')
    dot.className = 'p-nodedot' + (joined !== true ? ' off' : live === false ? ' cold' : '')
    return dot
  }

  function listBtn(label: string, onPick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'p-listbtn'
    b.textContent = label
    b.addEventListener('click', (ev) => { ev.stopPropagation(); onPick() })
    return b
  }

  function groupTitle(text: string, note?: string): HTMLDivElement {
    const t = document.createElement('div')
    t.className = 'p-nodelist-group'
    t.textContent = text
    if (note !== undefined) {
      const n = document.createElement('span')
      n.className = 'p-nodelist-note'
      n.textContent = note
      t.appendChild(n)
    }
    return t
  }

  /** 入队▸ submenu: existing canvas teams, plus 新团队… for the bootstrap case. */
  function openNodeJoinMenu(anchor: HTMLElement, id: string): void {
    closeNodeJoinMenu()
    const el = document.createElement('div')
    el.className = 'p-menu'
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', '加入团队')
    joiningId = id
    for (const t of d.facts().teams) {
      const already = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? false
      const choice = d.menuItem(already ? `${t.name}（已加入）` : t.name, true, () => {
        // The DOM may outlive its poll facts; never dispatch a disappeared target/source.
        if (!mayJoin(id, t.name)) { refreshChoices(); return }
        closeNodePanel()
        d.emit({ type: 'add-member', team: t.name, ids: [id] })
      })
      joinChoices.set(t.name, choice)
      el.appendChild(choice)
    }
    el.appendChild(d.menuItem('新团队…', true, () => {
      if (!d.facts().sessions.some(s => s.id === id && s.joined === true)) return
      closeNodePanel()
      d.openNameDialog([id])
    }))
    nodeJoinMenu = el
    refreshChoices()
    root.appendChild(el)
    const rect = anchor.getBoundingClientRect()
    el.style.left = `${String(Math.min(rect.right + 4, window.innerWidth - 180))}px`
    el.style.top = `${String(Math.max(8, rect.top - 60))}px`
    el.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Escape') { ev.stopPropagation(); closeNodeJoinMenu(); anchor.focus() }
    })
    el.querySelector('button')?.focus()
  }

  function renderLocalNodeGroups(body: HTMLDivElement): void {
    const teamed = new Set<string>(d.facts().canvasMemberIds)
    for (const s of d.facts().sessions) if (s.teams !== undefined && s.teams.length > 0) teamed.add(s.id)
    const unteamed = d.facts().sessions.filter(s => s.joined === true && !teamed.has(s.id))
    const unjoined = d.facts().sessions.filter(s => s.joined !== true)
    const teamedRows = d.facts().sessions.filter(s => s.joined === true && teamed.has(s.id))

    body.appendChild(groupTitle(`未组队 (${String(unteamed.length)})`, '无网络能力'))
    for (const s of unteamed) {
      const row = document.createElement('div')
      row.className = 'p-noderow'
      draggable(row, s.id)
      const name = document.createElement('span')
      name.className = 'p-nodename'
      name.textContent = s.name !== undefined && s.name !== '' ? s.name : s.label
      name.title = s.team
      const tag = document.createElement('span')
      tag.className = 'p-nonet'
      tag.textContent = '无网络能力'
      const joinBtn = listBtn('入队▸', () => openNodeJoinMenu(joinBtn, s.id))
      row.append(nodeRowDot(s.live, true), name, tag, joinBtn,
        listBtn('退网', () => { closeNodePanel(); d.emit({ type: 'leave-network', id: s.id }) }))
      body.appendChild(row)
    }

    body.appendChild(groupTitle(`未入网 (${String(unjoined.length)})`))
    for (const s of unjoined) {
      const row = document.createElement('div')
      row.className = 'p-noderow'
      const name = document.createElement('span')
      name.className = 'p-nodename'
      name.textContent = s.name !== undefined && s.name !== '' ? s.name : s.label
      name.title = s.id
      row.append(nodeRowDot(s.live, false), name,
        listBtn('入网', () => { closeNodePanel(); d.emit({ type: 'join-network', id: s.id }) }))
      body.appendChild(row)
    }

    body.appendChild(groupTitle(`已组队 (${String(teamedRows.length)})`, '画布展示'))
    for (const s of teamedRows) {
      const row = document.createElement('div')
      row.className = 'p-noderow'
      draggable(row, s.id)
      const name = document.createElement('span')
      name.className = 'p-nodename'
      name.textContent = s.name !== undefined && s.name !== '' ? s.name : s.label
      name.title = s.team
      const canvasCount = model.getNode(s.id)?.memberships.length ?? 0
      const rosterCount = s.teams?.length ?? 0
      const badge = document.createElement('span')
      badge.className = 'p-teamcount'
      badge.textContent = `队×${String(Math.max(canvasCount, 0) + rosterCount)}`
      row.append(nodeRowDot(s.live, true), name, badge,
        listBtn('定位', () => { d.locate(s.id) }))
      body.appendChild(row)
    }
    if (d.facts().sessions.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'p-nodelist-empty'
      empty.textContent = '无会话节点'
      body.appendChild(empty)
    }
  }

  function renderRemoteNodeGroups(body: HTMLDivElement, rows: ReadonlyArray<RemoteTeamRow>): void {
    const unteamed = rows.filter(r => r.teams === undefined || r.teams.length === 0)
    const teamedRows = rows.filter(r => r.teams !== undefined && r.teams.length > 0)
    body.appendChild(groupTitle(`未组队 (${String(unteamed.length)})`, '无网络能力 · 只读'))
    for (const r of unteamed) {
      const row = document.createElement('div')
      row.className = 'p-noderow'
      const name = document.createElement('span')
      name.className = 'p-nodename'
      name.textContent = r.name !== undefined && r.name !== '' ? r.name : r.team
      name.title = r.team
      const tag = document.createElement('span')
      tag.className = 'p-nonet'
      tag.textContent = '无网络能力'
      row.append(nodeRowDot(true, true), name, tag)
      body.appendChild(row)
    }
    body.appendChild(groupTitle(`已组队 (${String(teamedRows.length)})`, '只读'))
    for (const r of teamedRows) {
      const row = document.createElement('div')
      row.className = 'p-noderow'
      const name = document.createElement('span')
      name.className = 'p-nodename'
      name.textContent = r.name !== undefined && r.name !== '' ? r.name : r.team
      name.title = r.team
      const badge = document.createElement('span')
      badge.className = 'p-teamcount'
      badge.textContent = `队×${String(r.teams?.length ?? 0)}`
      row.append(nodeRowDot(true, true), name, badge)
      body.appendChild(row)
    }
    if (rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'p-nodelist-empty'
      empty.textContent = '该节点未发布会话'
      body.appendChild(empty)
    }
  }

  // Outside-click dismissal for the node panel: the popover appends to root
  // (scoped .p-menu styles apply; no transformed ancestor), so dismissal
  // rides a document listener — the canvas pointer seam never sees presses
  // on body-level chrome. The panel, its 入队 submenu, and the trigger are
  // exempt.
  document.addEventListener('pointerdown', (ev) => {
    if (nodePanel === null) return
    const t = ev.target as Element | null
    if (t === null) { closeNodePanel(); return }
    if (t.closest('.p-nodelist') !== null || t.closest('.p-menu') !== null) return
    if (t === nodesBtn || nodesBtn.contains(t)) return
    closeNodePanel()
  }, signal)

  return {
    toggle: toggleNodePanel,
    close: closeNodePanel,
    refresh: () => { if (nodePanel !== null) renderNodePanel() },
  }
}
