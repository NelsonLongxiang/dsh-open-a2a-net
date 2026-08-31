/**
 * Persisted spatial layout for the infinite-canvas page ('a2a/canvas-layout.json').
 * Pure presentation state: node coordinates, team-frame rectangles, and the
 * viewport transform. Membership truth stays in canvas.json - this store may
 * be reset freely without touching who sits in which team.
 *
 * Unit semantics (contract note 6, 2026-08-28 ruling): {x,y} are 2D
 * planning-canvas card centers in pixels. Other consumers (the 3D
 * observation lens) must reproject into their own envelope, never consume
 * the values as absolute scene coordinates.
 * @module @nelsonlongxiang/dsh-open-a2a-net/layout-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** One draggable point in world space. */
export interface LayoutPoint { readonly x: number; readonly y: number }

/** One team-frame rectangle in world space. */
export interface LayoutRect extends LayoutPoint { readonly w: number; readonly h: number }

/** The viewport transform (world point at the top-left corner, plus zoom). */
export interface LayoutViewport extends LayoutPoint { readonly scale: number }

/** The whole persisted document. */
export interface LayoutSnapshot {
  readonly version: 1
  readonly viewport: LayoutViewport
  readonly nodes: Readonly<Record<string, LayoutPoint>>
  readonly frames: Readonly<Record<string, LayoutRect>>
}

/** World-coordinate magnitude bound: values beyond are clamped, never trusted. */
export const COORD_LIMIT = 1_000_000
/** Zoom bounds, matching the page's wheel clamps. */
export const SCALE_MIN = 0.25
export const SCALE_MAX = 3
/** Document shape caps: a layout taxonomy, not a database. */
export const LAYOUT_NODE_CAP = 256
export const LAYOUT_FRAME_CAP = 96

function clampCoord(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return undefined
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)))
}

function clampPoint(raw: unknown): LayoutPoint | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const x = clampCoord(rec.x)
  const y = clampCoord(rec.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function clampRect(raw: unknown): LayoutRect | undefined {
  const point = clampPoint(raw)
  if (point === undefined) return undefined
  const rec = raw as Record<string, unknown>
  const w = clampCoord(rec.w)
  const h = clampCoord(rec.h)
  if (w === undefined || h === undefined || w <= 0 || h <= 0) return undefined
  return { ...point, w: Math.min(w, COORD_LIMIT), h: Math.min(h, COORD_LIMIT) }
}

function clampDoc(raw: unknown): LayoutSnapshot | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  if (rec.version !== 1) return undefined
  // The viewport is a point+scale, not a rect - validate its own shape.
  const vpRaw = rec.viewport
  if (vpRaw === null || typeof vpRaw !== 'object') return undefined
  const vp = vpRaw as Record<string, unknown>
  const vx = clampCoord(vp.x)
  const vy = clampCoord(vp.y)
  const vsRaw = vp.scale
  const vsNum = typeof vsRaw === 'number' ? vsRaw : Number.NaN
  if (vx === undefined || vy === undefined || !Number.isFinite(vsNum)) return undefined
  const viewport = { x: vx, y: vy }
  const scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, vsNum))
  const nodes: Record<string, LayoutPoint> = {}
  if (rec.nodes !== null && typeof rec.nodes === 'object') {
    for (const [id, point] of Object.entries(rec.nodes as Record<string, unknown>)) {
      if (typeof id !== 'string' || id === '' || id.length > 128) continue
      const p = clampPoint(point)
      if (p !== undefined) nodes[id] = p
      if (Object.keys(nodes).length >= LAYOUT_NODE_CAP) break
    }
  }
  const frames: Record<string, LayoutRect> = {}
  if (rec.frames !== null && typeof rec.frames === 'object') {
    for (const [name, rect] of Object.entries(rec.frames as Record<string, unknown>)) {
      // Frame keys mirror canvas team names: same discipline (no '/', cap 40).
      if (typeof name !== 'string' || name === '' || name.includes('/') || name.length > 40) continue
      const r = clampRect(rect)
      if (r !== undefined) frames[name] = r
      if (Object.keys(frames).length >= LAYOUT_FRAME_CAP) break
    }
  }
  return { version: 1, viewport: { x: viewport.x, y: viewport.y, scale }, nodes, frames }
}

/**
 * Whole-document layout store with last-write-wins persistence. Accepts
 * anything the client sends and answers with the normalized truth: clients
 * round-trip GET after save when they need canonical numbers.
 */
export class LayoutStore {
  private doc: LayoutSnapshot | undefined
  private readonly path: string

  /** @param path - the snapshot file; an empty path keeps memory-only. */
  constructor(path: string) {
    this.path = path
    this.restore()
  }

  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      this.doc = clampDoc(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      this.doc = undefined // corrupt layout is presentation loss only
    }
  }

  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.doc), { mode: 0o600 })
    } catch {
      // An unwritable home degrades to memory-only presentation state.
    }
  }

  /** The current snapshot, or null before the first save. */
  get(): LayoutSnapshot | null {
    return this.doc ?? null
  }

  /**
   * Replace the document wholesale after normalization.
   * @returns false when the payload is not a version-1 layout document.
   */
  save(raw: unknown): boolean {
    const doc = clampDoc(raw)
    if (doc === undefined) return false
    this.doc = doc
    this.persist()
    return true
  }

  /** Drop all persisted presentation state. */
  reset(): void {
    this.doc = undefined
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, '', { mode: 0o600 })
    } catch { /* degrade to memory-only */ }
  }
}