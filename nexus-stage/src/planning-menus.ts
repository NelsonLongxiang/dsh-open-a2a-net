/**
 * The planning board's popovers: the 建队 name dialog (focus-trapped modal),
 * the node / frame-head context menu (single-level drill-down, full
 * keyboard parity) and the 未入网 dropdown on the toolbar. Split out of
 * planning-view (which keeps gestures, rendering and reconcile); the view
 * hands in the model, its element anchors and the write channel, and asks
 * back only through the returned surface.
 * @module nexus-stage/planning-menus
 */
import { reorderOps, type CanvasAction } from './canvas-ops'
import type { PlanningSession, PlanningTeam } from './planning-types'
import type { WorldModel } from './world'

export type MenuTarget = { kind: 'node'; id: string } | { kind: 'frame'; name: string }
export type MenuLevel = 'root' | 'join' | 'leave' | 'promote'

export interface MenusDeps {
  readonly root: HTMLElement
  /** The toolbar's 未入网 chip: the dropdown anchors to it and it shows the count. */
  readonly netBtn: HTMLButtonElement
  readonly signal: AddEventListenerOptions
  readonly model: WorldModel
  /** Canvas teams from the latest poll. */
  teams(): ReadonlyArray<PlanningTeam>
  /** The card or frame-head element a menu re-focuses on close. */
  anchorFor(target: MenuTarget): HTMLElement | null
  emit(a: CanvasAction): void
  notice(kind: 'error' | 'info', text: string): void
}

export interface PlanningMenus {
  menuItem(label: string, enabled: boolean, onPick: () => void): HTMLButtonElement
  isMenuOpen(): boolean
  isDialogOpen(): boolean
  closeMenu(): void
  openMenu(x: number, y: number, target: MenuTarget, level?: MenuLevel, anchor?: HTMLElement): void
  /** Context menu from a real contextmenu event or the keyboard equivalent. */
  contextMenuAt(x: number, y: number, target: Element | null): void
  openNameDialog(ids: readonly string[]): void
  startCreateFromSelection(): void
  toggleNetMenu(): void
  /** Latest unjoined sessions: refreshes the chip's count and closes an emptied dropdown. */
  setUnjoined(sessions: ReadonlyArray<PlanningSession>): void
}

export function createPlanningMenus(d: MenusDeps): PlanningMenus {
  const { root, netBtn, signal, model } = d

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
    if (ids.length < 2) { d.notice('info', '框选至少 2 个会话节点'); return }
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
        d.notice('info', `已加入现有团队「${name}」`)
        d.emit({ type: 'add-member', team: name, ids })
        return
      }
      d.emit({ type: 'create-team', name, ids, created: true })
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
  let menu: HTMLDivElement | null = null
  let menuTarget: MenuTarget | undefined
  let menuLevel: MenuLevel = 'root'
  let menuAnchor: HTMLElement | null = null

  // ── 未入网会话 dropdown（面板瘦身后迁入的入网面）──
  let netMenu: HTMLDivElement | null = null
  let lastUnjoined: ReadonlyArray<PlanningSession> = []
  function closeNetMenu(): void {
    netMenu?.remove()
    netMenu = null
  }
  function toggleNetMenu(): void {
    if (netMenu !== null) { closeNetMenu(); return }
    if (lastUnjoined.length === 0) return
    const el = document.createElement('div')
    el.className = 'p-menu p-netmenu'
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', '未入网会话')
    for (const s of lastUnjoined) {
      el.appendChild(menuItem(`${s.name !== undefined && s.name !== '' ? s.name : s.label} — 入网`, true, () => {
        closeNetMenu()
        d.emit({ type: 'join-network', id: s.id })
      }))
    }
    netMenu = el
    // Menus append to root (not document.body): the .p-menu styles are
    // #dsh-plan-scoped, and root has no transformed ancestor, so fixed
    // positioning stays viewport-relative.
    root.appendChild(el)
    const rect = netBtn.getBoundingClientRect()
    el.style.left = `${String(Math.min(rect.left, window.innerWidth - 220))}px`
    el.style.top = `${String(Math.max(8, rect.top - (lastUnjoined.length * 30 + 10)))}px`
    el.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Escape') {
        ev.stopPropagation()
        closeNetMenu()
        netBtn.focus()
      }
    })
    el.querySelector('button')?.focus()
    // Outside-click dismissal: the dropdown lives at root level, so canvas
    // presses never reach a menu-local handler — and focus leaves with the
    // first outside click, killing the Escape path too (the stuck-dropdown
    // defect the owner hit). The trigger button stays exempt so its click
    // still toggles.
    document.addEventListener('pointerdown', (ev) => {
      if (netMenu === null) return
      const t = ev.target as Element | null
      if (t !== null && (t.closest('.p-netmenu') !== null || t === netBtn || netBtn.contains(t))) return
      closeNetMenu()
    }, signal)
  }

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

  function openMenu(x: number, y: number, target: MenuTarget, level: MenuLevel = 'root', anchor?: HTMLElement): void {
    // Re-seed the anchor after a drill-down: closeMenu focuses whatever this
    // menu was anchored to, or keyboard focus falls to body and the canvas
    // goes deaf.
    if (anchor !== undefined) menuAnchor = anchor
    if (menuAnchor === null) menuAnchor = d.anchorFor(target)
    menu?.remove()
    menuTarget = target
    menuLevel = level
    const el = document.createElement('div')
    el.className = 'p-menu'
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', '团队操作')
    let items: HTMLButtonElement[] = []
    if (target.kind === 'frame') {
      items = [menuItem(`解散团队「${target.name}」`, true, () => d.emit({ type: 'remove-team', name: target.name }))]
    } else {
      const id = target.id
      if (level === 'root') {
        const create = menuItem('组成团队…', model.selectedIds().length >= 2, () => openNameDialog(selectedByY()))
        create.title = '先框选或 Shift 加选至少 2 个节点'
        items.push(create)
        if (d.teams().length > 0) {
          items.push(menuItem('加入团队 ▸', true, () => openMenu(x, y, target, 'join')))
          const teamsOf = model.getNode(id)?.memberships.map(m => m.team) ?? []
          if (teamsOf.length > 0) {
            items.push(menuItem('置顶路由 ▸', true, () => openMenu(x, y, target, 'promote')))
            items.push(menuItem('离队 ▸', true, () => openMenu(x, y, target, 'leave')))
          }
        }
        // Network-level leave (distinct from canvas-team membership): the
        // panel-slim migration moved the join/leave toggle here. Remote
        // nodes are read-only entries — never a leave target.
        if (model.getNode(id)?.remote !== true) {
          items.push(menuItem('退网', true, () => d.emit({ type: 'leave-network', id })))
        }
      } else {
        items.push(menuItem('‹ 返回', true, () => openMenu(x, y, target, 'root')))
        for (const t of d.teams()) {
          if (level === 'join') {
            const already = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? true
            items.push(menuItem(already ? `${t.name}（已加入）` : t.name, !already, () => d.emit({ type: 'add-member', team: t.name, ids: [id] })))
          } else if (level === 'leave') {
            const member = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? false
            items.push(menuItem(t.name, member, () => d.emit({ type: 'remove-member', team: t.name, ids: [id] })))
          } else {
            const member = (model.getNode(id)?.memberships.some(m => m.team === t.name)) ?? false
            items.push(menuItem(t.name, member, () => {
              const current = model.teamMemberIds(t.name)
              const desired = [id, ...current.filter(x => x !== id)]
              d.emit({ type: 'reorder', team: t.name, ops: reorderOps(current, desired) })
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

  function setUnjoined(sessions: ReadonlyArray<PlanningSession>): void {
    lastUnjoined = sessions
    netBtn.textContent = `未入网${lastUnjoined.length > 0 ? `(${String(lastUnjoined.length)})` : ''}`
    netBtn.disabled = lastUnjoined.length === 0
    netBtn.setAttribute('aria-disabled', String(lastUnjoined.length === 0))
    if (lastUnjoined.length === 0) closeNetMenu()
  }

  return {
    menuItem,
    isMenuOpen: () => menu !== null,
    isDialogOpen: () => dialog !== null,
    closeMenu,
    openMenu,
    contextMenuAt,
    openNameDialog,
    startCreateFromSelection,
    toggleNetMenu,
    setUnjoined,
  }
}
