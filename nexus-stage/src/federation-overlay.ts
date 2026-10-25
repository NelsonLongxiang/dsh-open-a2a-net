/**
 * Federation overlay DOM renderer (gh#49 module split from planning-view,
 * the 1550→<1530 M1 ruling): draws the activity/federal overlay edges onto
 * the planning svg and exposes the placements bookkeeping. The geometry
 * stays in federation.ts (pure derivation); this module owns the DOM side
 * and is created per planning view instance.
 * @module nexus-stage/federation-overlay
 */

import type { WorldModel } from './world'
import { activityEdges, federalEdges, flyBounds, type FrameAnchor, type InFlightRow, type PeerPlacement, type PeerRow } from './federation'

/** The per-instance federation overlay: draw + bookkeeping seams. */
export interface FederationOverlay {
  /** Redraw the overlay from the model's remote nodes (peer cards). */
  render(now: number): void
  /** Statusbar fly: fit frames ∪ peers (flyBounds pads). */
  flyTo(viewportApply: () => void): PeerPlacement[]
  /** The most recent placements (fly bounds + status reads). */
  placements(): readonly PeerPlacement[]
  /** Sync the polling facts the edges derive from. */
  setInFlight(rows: ReadonlyArray<InFlightRow>): void
}

export interface FederationHostFacts {
  /** Peer rows from /state (score + link/verified for badges). */
  peers: ReadonlyArray<PeerRow>
  /** Pending outbound routes from /state. */
  inFlight: ReadonlyArray<InFlightRow>
}

const FRAME_HEAD_LIFT = 11

export function createFederationOverlay(svg: SVGElement, model: WorldModel): FederationOverlay {
  let fedSvg: SVGElement[] = []
  let lastPlacements: PeerPlacement[] = []
  let lastInFlight: ReadonlyArray<InFlightRow> = []

  function render(now: number): void {
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
      for (const e of activityEdges(lastInFlight, anchors, placements, now)) {
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

  return {
    render,
    flyTo(viewportApply: () => void): PeerPlacement[] {
      viewportApply()
      return lastPlacements
    },
    placements: () => lastPlacements,
    setInFlight: rows => { lastInFlight = rows },
  }
}

/** The fly-bounds helper re-export for the view's statusbar fit. */
export { flyBounds }
