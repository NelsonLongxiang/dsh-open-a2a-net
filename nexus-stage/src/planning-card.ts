/**
 * Board node card: the DOM skeleton and the right-hand chip. Extracted from planning-view so the card's static
 * structure reads in one place and the view stays under its M1 module-size cap (1507 lines; it reached 1529 with
 * the 工作中/空闲 chip). Pure DOM helpers — no view state; renderNodes still decides what each card shows.
 * @module nexus-stage/planning-card
 */
import type { PlanningSession } from './planning-types'
import type { WorldNode } from './world'

/** The card's 工作中/空闲 chip text; empty when the host reported no status (older host, cold or remote node). */
export function workLabel(work: Pick<PlanningSession, 'status' | 'queued'> | undefined): string {
  if (work?.status === undefined) return ''
  const base = work.status === 'running' ? '工作中' : '空闲'
  return typeof work.queued === 'number' && work.queued > 0 ? `${base} · 排队 ${String(work.queued)}` : base
}

/** A fresh `.p-node` card: title row (dot + text), second row (description + 工作中/空闲 chip), and the right-hand chip. */
export function createCardElement(id: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'p-node'
  el.dataset.id = id
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
  // Second line: the description, with the 工作中/空闲 chip at its right end — the title keeps its full width.
  const work = document.createElement('span')
  work.className = 'work'
  const subRow = document.createElement('div')
  subRow.className = 'sub-row'
  subRow.append(sub, work)
  el.append(nm, subRow, prio)
  return el
}

/**
 * The right-hand chip. Peer cards show the link badge (gh#20 W-A: linked green / stranger gray, then the
 * verified tick/cross; an absent link field from an older host renders the neutral 'peer'); session cards show
 * their first membership priority `P<n>`. Writes only on change.
 */
export function paintPrio(prioEl: HTMLElement, n: WorldNode, info: { link?: 'linked' | 'stranger'; verified?: boolean } | undefined): void {
  if (n.remote === true) {
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
