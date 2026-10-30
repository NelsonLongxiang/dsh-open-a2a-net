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
