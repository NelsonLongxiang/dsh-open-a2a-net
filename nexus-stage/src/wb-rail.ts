/**
 * The workbench's left rail as tabs (2026-10-23 rewrite): one tab per pane
 * — 目录 · 主机 · 台账 · 活动 · 规划 — each panel full-height with its own
 * scroll, replacing the single accordion scroll where the host rail sat
 * last and the ledger pushed everything below the fold.
 *
 * WAI-ARIA tabs: role=tablist / tab / tabpanel, roving tabindex, ←/→ and
 * Home/End move between tabs and activate them. Badges carry each pane's
 * count, colored only when there is something to act on (danger / warn).
 * The selected tab is a per-viewer convenience kept in localStorage (every
 * access guarded; the rail works the same without it).
 * @module nexus-stage/wb-rail
 */

export type RailTone = 'danger' | 'warn' | 'accent'

export interface RailTabDef<K extends string> {
  readonly key: K
  readonly label: string
}

export interface RailTabs<K extends string> {
  readonly root: HTMLElement
  /** The panel a pane mounts into for tab `key`. */
  panel(key: K): HTMLElement
  select(key: K, opts?: { focus?: boolean }): void
  selected(): K
  setBadge(key: K, text: string, tone?: RailTone): void
  /** Hide a tab (data mode moves its pane to the stage); a hidden selected tab falls back to the first visible one. */
  setHidden(key: K, hidden: boolean): void
}

const STORE_KEY = 'dsh-a2a.rail.tab'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

function writeStored(key: string): void {
  try {
    window.localStorage.setItem(STORE_KEY, key)
  } catch { /* per-viewer convenience only */ }
}

export function createRailTabs<K extends string>(defs: ReadonlyArray<RailTabDef<K>>, opts: { onChange?(key: K): void } = {}): RailTabs<K> {
  const root = document.createElement('aside')
  root.className = 'wb-rail'
  const list = document.createElement('div')
  list.className = 'wb-tabs'
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-label', '工作台侧栏')
  const panels = document.createElement('div')
  panels.className = 'wb-tabpanels'
  root.append(list, panels)

  const tabs = new Map<K, HTMLButtonElement>()
  const panelEls = new Map<K, HTMLElement>()
  const badges = new Map<K, HTMLElement>()
  const hidden = new Set<K>()
  for (const def of defs) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'wb-tab'
    tab.id = `wb-tab-${def.key}`
    tab.dataset.sec = def.key
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', `wb-panel-${def.key}`)
    const label = document.createElement('span')
    label.className = 'wb-tab-label'
    label.textContent = def.label
    const badge = document.createElement('span')
    badge.className = 'wb-tab-badge'
    tab.append(label, badge)
    tab.addEventListener('click', () => select(def.key))
    list.appendChild(tab)
    const panel = document.createElement('section')
    panel.className = 'wb-tabpanel'
    panel.id = `wb-panel-${def.key}`
    panel.dataset.sec = def.key
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', tab.id)
    panel.tabIndex = -1
    panels.appendChild(panel)
    tabs.set(def.key, tab)
    panelEls.set(def.key, panel)
    badges.set(def.key, badge)
  }

  const visible = (): K[] => defs.map(d => d.key).filter(k => !hidden.has(k))
  const stored = readStored()
  let current: K = defs.find(d => d.key === stored)?.key ?? defs[0]!.key

  list.addEventListener('keydown', ev => {
    const keys = visible()
    const at = keys.indexOf(current)
    let next: K | undefined
    if (ev.key === 'ArrowRight') next = keys[(at + 1) % keys.length]
    else if (ev.key === 'ArrowLeft') next = keys[(at - 1 + keys.length) % keys.length]
    else if (ev.key === 'Home') next = keys[0]
    else if (ev.key === 'End') next = keys[keys.length - 1]
    if (next === undefined) return
    ev.preventDefault()
    select(next, { focus: true })
  })

  function paint(): void {
    for (const def of defs) {
      const on = def.key === current
      const tab = tabs.get(def.key)!
      tab.setAttribute('aria-selected', String(on))
      tab.tabIndex = on ? 0 : -1
      tab.classList.toggle('is-active', on)
      tab.hidden = hidden.has(def.key)
      panelEls.get(def.key)!.hidden = !on
    }
  }

  function select(key: K, o: { focus?: boolean } = {}): void {
    if (hidden.has(key)) return
    const changed = key !== current
    current = key
    writeStored(key)
    paint()
    if (o.focus === true) tabs.get(key)!.focus()
    if (changed) opts.onChange?.(key)
  }

  function setBadge(key: K, text: string, tone?: RailTone): void {
    const b = badges.get(key)!
    b.textContent = text
    b.className = `wb-tab-badge${tone !== undefined ? ` is-${tone}` : ''}`
  }

  function setHidden(key: K, h: boolean): void {
    if (h) hidden.add(key)
    else hidden.delete(key)
    if (hidden.has(current)) current = visible()[0] ?? defs[0]!.key
    paint()
  }

  paint()
  return { root, panel: (k) => panelEls.get(k)!, select, selected: () => current, setBadge, setHidden }
}
