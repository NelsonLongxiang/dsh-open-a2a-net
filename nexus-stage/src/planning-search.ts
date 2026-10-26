/**
 * 画板全局搜索（属主令 W1）: a toolbar search box (Ctrl+K focuses) over the
 * board's node FACTS — display name, zone/id8 handle, and host spelling, in
 * one substring match (case-insensitive). Picking a hit rides the existing
 * fitView flight chain (the caller frames ~100% and pulses the card);
 * Escape clears. Pure front end: no backend, no routing, no persistence.
 * @module nexus-stage/planning-search
 */
import { fitView, type LayoutViewport } from './viewport'
import { NODE_W, NODE_H } from './world'
/** One searchable node fact row (already display-resolved by the caller). */
export interface SearchHit {
  readonly id: string
  /** Display name (member cards' person name, peer hosts' spelling). */
  readonly name: string
  /** The zone/id8 handle (n.team) and any extra host tokens. */
  readonly team: string
  /** Optional host/owner token (peer cards carry the host spelling). */
  readonly host?: string
}

/** Case-insensitive substring match across name / team / host. */
export function matchHits(rows: ReadonlyArray<SearchHit>, query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  return rows.filter(r =>
    r.name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q) || (r.host ?? '').toLowerCase().includes(q))
    .slice(0, 8)
}

/**
 * Build the searchable rows from the board model — the SAME display facts
 * the cards render (member display name / peer host spelling / its handle),
 * so every hit is a card the user can see.
 */
export function hitsFromModel(model: { allNodes(): ReadonlyArray<{ id: string; name?: string; team: string; remote?: boolean }> }, displayName: (n: never) => string): SearchHit[] {
  return model.allNodes().map(n => {
    const host = n.id.slice('peer-'.length)
    const name = n.id.startsWith('member-')
      ? (n.name !== undefined && n.name !== '' ? n.name : n.team)
      : n.remote === true ? host : displayName(n as never)
    return { id: n.id, name, team: n.team, ...(n.remote === true ? { host } : {}) }
  })
}

/** W1 pulse: briefly ring the picked card (class removed on the timer). */
export function pulseCard(el: HTMLElement | undefined, ms = 1200): void {
  if (el === undefined) return
  el.classList.add('pulse')
  setTimeout(() => el.classList.remove('pulse'), ms)
}

/** The view seams the node flyer needs (the view keeps owning its model). */
export interface NodeFlyerSpec {
  readonly model: { getNode(id: string): { x: number; y: number } | undefined }
  readonly viewSize: () => { w: number; h: number }
  readonly setVp: (vp: LayoutViewport) => void
  readonly applyViewport: () => void
  readonly markDirty: () => void
  readonly cardEl: (id: string) => HTMLElement | undefined
}

/**
 * W1 pick flight: frame ONE node's rect at ~100% (the same fitView chain the
 * statusbar fly rides) and pulse its card for 1.2s.
 */
export function createNodeFlyer(spec: NodeFlyerSpec): (id: string) => void {
  return id => {
    const n = spec.model.getNode(id)
    if (n === undefined) return
    const size = spec.viewSize()
    // fitView takes WorldBounds ({minX,minY,maxX,maxY}), not the card rect —
    // passing {x,y,w,h} silently yielded NaN → IDENTITY (flight never landed).
    spec.setVp(fitView({ minX: n.x, minY: n.y, maxX: n.x + NODE_W, maxY: n.y + NODE_H }, size.w, size.h, 1))
    spec.applyViewport()
    spec.markDirty()
    pulseCard(spec.cardEl(id))
  }
}

export interface SearchMount extends PlanningSearch {
  /** Rebuild the index from the model (call from the node reconcile). */
  refresh(): void
}

/**
 * Mount the whole search surface into the toolbar — the wiring lines the
 * view used to carry live here (create + append + index builder), keeping
 * the view under the M1 ratchet; the view keeps ONE call.
 */
export function mountBoardSearch(
  toolbar: HTMLElement,
  model: Parameters<typeof hitsFromModel>[0],
  displayName: Parameters<typeof hitsFromModel>[1],
  onPick: (id: string) => void,
): SearchMount {
  const search = createPlanningSearch({ onPick })
  toolbar.appendChild(search.root)
  return { ...search, refresh: () => search.setIndex(hitsFromModel(model, displayName)) }
}

export interface PlanningSearch {
  readonly root: HTMLElement
  /** Refresh the searchable index (called from the node reconcile). */
  setIndex(rows: ReadonlyArray<SearchHit>): void
  /** Focus the box (Ctrl+K) and select the current text. */
  focus(): void
  /** Clear the query and the dropdown (Escape elsewhere). */
  clear(): void
}

/** Build the search box widget (input + hit list + keyboard handling). */
export function createPlanningSearch(opts: { onPick: (id: string) => void }): PlanningSearch {
  const root = document.createElement('div')
  root.className = 'p-search'
  const input = document.createElement('input')
  input.type = 'search'
  input.className = 'p-search-input'
  input.placeholder = '🔍 搜索名字/句柄/宿主（Ctrl+K）'
  input.setAttribute('aria-label', '搜索画板节点')
  const list = document.createElement('div')
  list.className = 'p-search-list'
  let rows: ReadonlyArray<SearchHit> = []
  let hits: SearchHit[] = []
  let active = 0
  const close = (): void => { list.style.display = 'none'; list.textContent = '' }
  const paint = (): void => {
    list.textContent = ''
    if (hits.length === 0) { close(); return }
    hits.forEach((h, i) => {
      const row = document.createElement('div')
      row.className = 'p-search-hit' + (i === active ? ' active' : '')
      row.dataset.id = h.id
      row.textContent = h.name === h.team ? h.name : `${h.name} · ${h.team}`
      row.addEventListener('mousedown', ev => { ev.preventDefault(); opts.onPick(h.id); clearBox() })
      list.appendChild(row)
    })
    list.style.display = 'block'
  }
  const clearBox = (): void => { input.value = ''; hits = []; close() }
  const refresh = (): void => { hits = matchHits(rows, input.value); active = 0; paint() }
  input.addEventListener('input', refresh)
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { clearBox(); input.blur(); ev.stopPropagation(); return }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (hits.length === 0) return
      ev.preventDefault()
      active = (active + (ev.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length
      paint()
      return
    }
    if (ev.key === 'Enter' && hits.length > 0) {
      ev.preventDefault()
      opts.onPick(hits[active]!.id)
      clearBox()
    }
  })
  root.append(input, list)
  return {
    root,
    setIndex(next) { rows = next; if (input.value !== '') refresh() },
    focus() { input.focus(); input.select() },
    clear() { clearBox() },
  }
}
