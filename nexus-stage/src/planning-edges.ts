/**
 * The membership spokes' SVG layer (edges.ts stays pure geometry). Moved
 * out of planning-view (module-size cap) when pointercancel landed.
 * @module nexus-stage/planning-edges
 */
import { starEdges } from './edges'
import type { WorldModel } from './world'

/**
 * Stateless, rebuilt wholesale. Derived from the MODEL (not the host's
 * teams): optimistic membership changes must repaint their edges
 * immediately, before the host confirms.
 */
export function drawMemberEdges(svg: SVGSVGElement, model: WorldModel): void {
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

/** One root→child edge as the board draws it (superagent-root-team R8, S3 batch 3). */
export interface RootEdgeInput { readonly rootFrame: string; readonly childFrame: string; readonly label: string; readonly open: number }

/**
 * The root's dispatch edges: one dashed line per child frame the root's state names (not model memberships — a child
 * team on this canvas is its own frame). Hover titles the child and its open count; a click hands the child's canvas
 * name to the host (the team tab opens filtered to it).
 */
export function drawRootEdges(svg: SVGSVGElement, edges: ReadonlyArray<RootEdgeInput>, frames: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>, onChildPicked?: (childCanvas: string) => void): void {
  for (const e of edges) {
    const a = frames.get(e.rootFrame), b = frames.get(e.childFrame)
    if (a === undefined || b === undefined) continue
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('class', 'e-root')
    g.setAttribute('role', 'button')
    g.setAttribute('aria-label', `${e.rootFrame} → ${e.label}（在办 ${String(e.open)}）`)
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', String(a.x + a.w / 2)); line.setAttribute('y1', String(a.y + a.h / 2))
    line.setAttribute('x2', String(b.x + b.w / 2)); line.setAttribute('y2', String(b.y + b.h / 2))
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = `${e.label}（在办 ${String(e.open)}）`
    g.append(line, title)
    if (onChildPicked !== undefined) g.addEventListener('click', () => { const canvas = e.childFrame.split('/canvas/')[1]?.split('@')[0] ?? e.childFrame; onChildPicked(canvas) })
    svg.appendChild(g)
  }
}
