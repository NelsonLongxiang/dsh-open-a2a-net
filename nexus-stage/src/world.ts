/**
 * The 2D planning-canvas world model: joined session nodes, team-frame
 * rectangles, the selection set, and the drag/marquee mutations. Pure
 * state + math, no DOM and no three (structural types redeclared here so
 * this module stays unit-testable from the root suite; main.ts passes the
 * topology.ts rows straight in - they satisfy these shapes structurally).
 *
 * Coordinate contract: a node's persisted {x, y} is its CARD CENTER (the
 * 3D scene writes mesh centers into the same layout document), so every
 * rectangle math goes through nodeRect(). Team frames own their saved
 * rects; a frame absent from the layout derives one from its members'
 * card bounding box. Group drag works from a pointerdown snapshot and
 * applies total deltas - never incremental accumulation, so a long drag
 * cannot drift.
 * @module nexus-stage/world
 */

import { clampDoc, type LayoutDoc, type LayoutPoint, type LayoutRect } from './layout-doc'
import { seatFor } from './seat'
import type { WorldBounds } from './viewport'

/** Card geometry: the single source both CSS and edge math must agree with. */
export const NODE_W = 172
export const NODE_H = 56

/** Minimal session row shape the model needs (topology.SessionRow satisfies it). */
export interface SessionLite { id: string; label: string; team: string; name?: string; joined: boolean; live?: boolean }

/** Minimal team shape (topology.CanvasTeam satisfies it). */
export interface TeamLite { name: string; members: ReadonlyArray<{ id: string }> }

/** One node's memberships in state order: team name + index (member order = routing priority). */
export interface Membership { readonly team: string; readonly index: number }

/** A placed session node: center position plus everything the card renders. */
export interface WorldNode {
  x: number
  y: number
  readonly id: string
  readonly label: string
  readonly name?: string
  readonly live: boolean
  readonly memberships: ReadonlyArray<Membership>
}

/** A team frame rectangle in world space (top-left + size). */
export interface FrameGeom { x: number; y: number; w: number; h: number }

/** Snapshot for group drag: the frame rect plus member centers at pointerdown. */
export interface FrameDragSnapshot {
  readonly name: string
  readonly rect: FrameGeom
  readonly centers: ReadonlyArray<readonly [string, number, number]>
}

/** The card rectangle (top-left + size) for a node centered at (x, y). */
export function nodeRect(n: { readonly x: number; readonly y: number }): LayoutRect {
  return { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2, w: NODE_W, h: NODE_H }
}

/**
 * Derive an initial frame rect from member card rects: bounding box plus
 * padding (extra headroom on top for the straddling titlebar), minimum
 * 260x160, rounded to integers - deterministic, so the same roster always
 * proposes the same frame until the user moves something.
 */
export function deriveInitialFrame(memberRects: ReadonlyArray<LayoutRect>): FrameGeom {
  if (memberRects.length === 0) return { x: 0, y: 0, w: 260, h: 160 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const r of memberRects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  const padX = 24
  const padTop = 44
  const padBottom = 24
  const w = Math.max(260, Math.round(maxX - minX + padX * 2))
  const h = Math.max(160, Math.round(maxY - minY + padTop + padBottom))
  return { x: Math.round(minX - padX), y: Math.round(minY - padTop), w, h }
}

/** The planning-canvas model. */
export class WorldModel {
  private revisionCounter = 0

  /** Monotonic mutation counter: the view re-renders only when this moves. */
  get revision(): number { return this.revisionCounter }

  private nodes = new Map<string, WorldNode>()
  private frames = new Map<string, FrameGeom>()
  private selection = new Set<string>()
  viewport = { x: 0, y: 0, scale: 1 }

  /** Read-only node access for rendering/edges. */
  getNode(id: string): WorldNode | undefined { return this.nodes.get(id) }
  allNodes(): ReadonlyArray<WorldNode> { return [...this.nodes.values()] }
  nodeIds(): ReadonlyArray<string> { return [...this.nodes.keys()] }
  getFrame(name: string): FrameGeom | undefined { return this.frames.get(name) }
  allFrames(): ReadonlyArray<[string, FrameGeom]> { return [...this.frames.entries()] }
  isSelected(id: string): boolean { return this.selection.has(id) }
  selectedIds(): ReadonlyArray<string> { return [...this.selection] }

  private bump(): void { this.revisionCounter += 1 }

  /**
   * Move nodes by a world-space delta (drag/nudge); also moves each
   * selected node out of no frame - frames track rects, not membership,
   * so positions and rects stay independent.
   */
  dragNodes(ids: ReadonlyArray<string>, dx: number, dy: number): void {
    let moved = false
    for (const id of ids) {
      const n = this.nodes.get(id)
      if (n === undefined) continue
      n.x += dx
      n.y += dy
      moved = true
    }
    if (moved) this.bump()
  }

  /**
   * Start a frame group drag: snapshot the rect and member centers so the
   * drag applies total deltas from this origin (no float drift). Returns
   * undefined for an unknown frame.
   */
  beginFrameDrag(name: string): FrameDragSnapshot | undefined {
    const rect = this.frames.get(name)
    if (rect === undefined) return undefined
    const centers: Array<readonly [string, number, number]> = []
    for (const n of this.nodes.values()) {
      for (const m of n.memberships) {
        if (m.team === name) { centers.push([n.id, n.x, n.y] as const); break }
      }
    }
    return { name, rect: { ...rect }, centers }
  }

  /** Apply a total world-space delta from the drag origin to rect + members. */
  applyFrameDrag(snap: FrameDragSnapshot, dx: number, dy: number): void {
    const rect = this.frames.get(snap.name)
    if (rect === undefined) return
    rect.x = snap.rect.x + dx
    rect.y = snap.rect.y + dy
    for (const [id, cx, cy] of snap.centers) {
      const n = this.nodes.get(id)
      if (n === undefined) continue
      n.x = cx + dx
      n.y = cy + dy
    }
    this.bump()
  }

  /** Nudge (keyboard micro-move) - same math as drag, kept as a named act. */
  nudge(ids: ReadonlyArray<string>, dx: number, dy: number): void { this.dragNodes(ids, dx, dy) }

  /** Set selection: nodes whose card rect intersects the world-space marquee. */
  marqueeSelect(rect: LayoutRect, additive: boolean): void {
    if (!additive) this.selection.clear()
    for (const n of this.nodes.values()) {
      const r = nodeRect(n)
      const intersects = r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y
      if (intersects) this.selection.add(n.id)
    }
    this.bump()
  }

  /** Replace the whole selection (click / Shift-click add / Esc clears). */
  setSelection(ids: ReadonlyArray<string>): void {
    this.selection = new Set(ids)
    this.bump()
  }

  /** Union of node cards and frame rects; null when the canvas is empty. */
  contentBounds(): WorldBounds | null {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const absorb = (r: LayoutRect): void => {
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.w)
      maxY = Math.max(maxY, r.y + r.h)
    }
    for (const n of this.nodes.values()) absorb(nodeRect(n))
    for (const r of this.frames.values()) absorb(r)
    return minX === Number.POSITIVE_INFINITY ? null : { minX, minY, maxX, maxY }
  }

  /**
   * Build from one state payload plus the persisted layout (when the host
   * has one). Joined sessions only (same roster rule as the 3D scene);
   * saved positions win, the deterministic 2D seat {seatFor.x, seatFor.z}
   * falls back - the same world spot the 3D grid plane shows for an
   * unsaved node. Frames come from the layout when present; a frame with
   * neither saved rect nor members is skipped. The layout is clamped with
   * the host-mirror discipline, so malformed rows fall through to seats
   * exactly like the 3D scene's typeof guard.
   */
  static fromState(input: {
    sessions: ReadonlyArray<SessionLite>
    teams: ReadonlyArray<TeamLite>
    layout: unknown
  }): WorldModel {
    const model = new WorldModel()
    const doc: LayoutDoc | undefined = clampDoc(input.layout)

    const memberships = new Map<string, Array<Membership>>()
    for (const team of input.teams) {
      for (let i = 0; i < team.members.length; i++) {
        const id = team.members[i]!.id
        const list = memberships.get(id) ?? []
        list.push({ team: team.name, index: i })
        memberships.set(id, list)
      }
    }

    for (const s of input.sessions) {
      if (s.joined !== true) continue
      const saved: LayoutPoint | undefined = doc?.nodes[s.id]
      let x: number
      let y: number
      if (saved !== undefined && typeof saved.x === 'number' && typeof saved.y === 'number') {
        x = saved.x
        y = saved.y
      } else {
        const p = seatFor(s.id)
        x = p.x
        y = p.z
      }
      model.nodes.set(s.id, {
        id: s.id,
        x,
        y,
        label: s.label,
        name: s.name,
        live: s.live !== false,
        memberships: memberships.get(s.id) ?? [],
      })
    }

    for (const team of input.teams) {
      const savedRect = doc?.frames[team.name]
      if (savedRect !== undefined) {
        model.frames.set(team.name, { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h })
        continue
      }
      const memberRects: Array<LayoutRect> = []
      for (const m of team.members) {
        const n = model.nodes.get(m.id)
        if (n !== undefined) memberRects.push(nodeRect(n))
      }
      if (memberRects.length > 0) model.frames.set(team.name, deriveInitialFrame(memberRects))
    }

    model.viewport = doc !== undefined ? { ...doc.viewport } : { x: 0, y: 0, scale: 1 }
    return model
  }
}

/** Functional entry point; see {@link WorldModel.fromState} for the contract. */
export function buildWorld(input: {
  sessions: ReadonlyArray<SessionLite>
  teams: ReadonlyArray<TeamLite>
  layout: unknown
}): WorldModel {
  return WorldModel.fromState(input)
}
