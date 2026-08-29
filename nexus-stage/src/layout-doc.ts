/**
 * Client-side mirror of the host layout contract (src/layout-store.ts).
 * The host module imports node:fs, so the stage cannot share its types -
 * this file redeclares the v1 document shape and reimplements the exact
 * clamp discipline. Parity is not optional: the save loop adopts the
 * host's normalized response, and a mirror that clamped differently from
 * the host would make every save look like an external edit and keep the
 * save lamp pending forever. The clamp vectors in tests/planning-world.spec.ts
 * pin both sides to the same answers.
 *
 * Zero dependencies, no DOM - unit-testable straight from the root suite.
 * @module nexus-stage/layout-doc
 */

/** One draggable point in world space. */
export interface LayoutPoint { readonly x: number; readonly y: number }

/** One team-frame rectangle in world space. */
export interface LayoutRect extends LayoutPoint { readonly w: number; readonly h: number }

/** The viewport transform (world point at the top-left corner, plus zoom). */
export interface LayoutViewport extends LayoutPoint { readonly scale: number }

/** The whole persisted document (v1). */
export interface LayoutDoc {
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

/**
 * Normalize an untrusted layout document exactly as the host does:
 * version!==1 rejects the whole doc; non-finite coordinates drop the
 * point; coordinates round and clamp to ±COORD_LIMIT; scale clamps to
 * [SCALE_MIN, SCALE_MAX]; node keys cap at 128 chars; frame keys mirror
 * canvas team names (no '/', cap 40); rects need w>0 and h>0; caps are
 * first-wins in insertion order - entries beyond are silently dropped,
 * never refused (an overflow renders, it just does not persist).
 */
export function clampDoc(raw: unknown): LayoutDoc | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  if (rec.version !== 1) return undefined
  const vpRaw = rec.viewport
  if (vpRaw === null || typeof vpRaw !== 'object') return undefined
  const vp = vpRaw as Record<string, unknown>
  const vx = clampCoord(vp.x)
  const vy = clampCoord(vp.y)
  const vsRaw = vp.scale
  const vsNum = typeof vsRaw === 'number' ? vsRaw : Number.NaN
  if (vx === undefined || vy === undefined || !Number.isFinite(vsNum)) return undefined
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
      if (typeof name !== 'string' || name === '' || name.includes('/') || name.length > 40) continue
      const r = clampRect(rect)
      if (r !== undefined) frames[name] = r
      if (Object.keys(frames).length >= LAYOUT_FRAME_CAP) break
    }
  }
  return { version: 1, viewport: { x: vx, y: vy, scale }, nodes, frames }
}

/**
 * Build a save payload from trusted in-memory state. Pre-clamps with the
 * same mirror discipline and truncates in roster insertion order, so the
 * document we send is already the document the host will normalize to -
 * the save response is then a fixpoint of our payload, which the save
 * loop relies on to tell "our own save echoed back" from "someone else
 * edited while the request was in flight".
 */
export function buildLayoutDoc(
  viewport: LayoutViewport,
  nodes: ReadonlyMap<string, LayoutPoint>,
  frames: ReadonlyMap<string, LayoutRect>,
): LayoutDoc {
  const clamp = (n: number): number => Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)))
  const docNodes: Record<string, LayoutPoint> = {}
  for (const [id, p] of nodes) {
    if (typeof id !== 'string' || id === '' || id.length > 128) continue
    docNodes[id] = { x: clamp(p.x), y: clamp(p.y) }
    if (Object.keys(docNodes).length >= LAYOUT_NODE_CAP) break
  }
  const docFrames: Record<string, LayoutRect> = {}
  for (const [name, r] of frames) {
    if (typeof name !== 'string' || name === '' || name.includes('/') || name.length > 40) continue
    const w = clamp(r.w)
    const h = clamp(r.h)
    if (w <= 0 || h <= 0) continue
    docFrames[name] = { x: clamp(r.x), y: clamp(r.y), w: Math.min(w, COORD_LIMIT), h: Math.min(h, COORD_LIMIT) }
    if (Object.keys(docFrames).length >= LAYOUT_FRAME_CAP) break
  }
  return {
    version: 1,
    viewport: { x: clamp(viewport.x), y: clamp(viewport.y), scale: Math.max(SCALE_MIN, Math.min(SCALE_MAX, viewport.scale)) },
    nodes: docNodes,
    frames: docFrames,
  }
}
