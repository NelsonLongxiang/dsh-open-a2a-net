/**
 * 「一键重排」board relayout (supervisor order v2, upgrade of gh#48): a
 * deterministic whole-board re-seat — every LOCAL canvas team frame is
 * resized from its content (sole-member count drives cols/rows; width AND
 * height both derive from the grid), then the frames tile in a row flow
 * (constructively non-overlapping, no collision pass). Multi-team members
 * never enter the size derivation and never move (their dashed edges
 * express membership); remote org frames and frameless nodes are out of
 * scope. Pure geometry: same input, same output — pressing twice is
 * stable by construction.
 * @module nexus-stage/planning-relayout
 */
import { NODE_W, NODE_H, type FrameGeom, type WorldModel } from './world'

/** Inner padding between frame edge and the card grid (gh#48 family). */
export const RELAYOUT_PAD = 28
/** Card gaps inside a frame (same family as the tidy grid). */
export const RELAYOUT_GAP_X = 16
export const RELAYOUT_GAP_Y = 14
/** Gap between neighbouring frames in the row-flow tiling. */
export const FRAME_GAP = 48
/** Column cap: perRow = min(4, ceil(sqrt(n))). */
export const PER_ROW_CAP = 4
/** Floor widths/heights: keeps the floating title band legible. */
export const FRAME_MIN_W = 180
export const FRAME_MIN_H = 90
/** Default world-space wrap width of one tiling row. */
export const RELAYOUT_WRAP = 1600

/** One local frame to re-seat: its current rect and its SOLE member ids. */
export interface RelayoutFrameInput {
  readonly name: string
  readonly rect: FrameGeom
  readonly soleIds: readonly string[]
}

/** The deterministic outcome: new frame rects and absolute card centers. */
export interface RelayoutOutput {
  readonly frames: ReadonlyArray<{ name: string; rect: FrameGeom }>
  readonly seats: ReadonlyArray<{ id: string; x: number; y: number }>
}

/**
 * Derive the whole-board layout. Frame order in = tiling order out (the
 * caller passes a stable order, e.g. the model's insertion order, which
 * keeps the result deterministic across presses).
 */
export function planBoardRelayout(input: {
  frames: ReadonlyArray<RelayoutFrameInput>
  wrapWidth?: number
}): RelayoutOutput {
  const wrap = input.wrapWidth ?? RELAYOUT_WRAP
  // Pass 1 — content-derived size per frame (multi-team members excluded
  // upstream: soleIds carries exactly the re-seatable cards).
  const sized = input.frames.map(f => {
    const n = Math.max(f.soleIds.length, 1)
    const perRow = Math.min(PER_ROW_CAP, Math.max(1, Math.ceil(Math.sqrt(n))))
    const rows = Math.ceil(n / perRow)
    const w = Math.max(FRAME_MIN_W, RELAYOUT_PAD * 2 + perRow * NODE_W + (perRow - 1) * RELAYOUT_GAP_X)
    const h = Math.max(FRAME_MIN_H, RELAYOUT_PAD * 2 + rows * NODE_H + (rows - 1) * RELAYOUT_GAP_Y)
    return { name: f.name, w, h, rows, perRow, soleIds: f.soleIds }
  })
  // Pass 2 — row-flow tiling: left→right until the wrap width is full,
  // then advance one row by the tallest frame of the band. Constructive
  // disjointness: boxes on one band share the y band and never overlap in
  // x; bands stack with FRAME_GAP.
  const frames: Array<{ name: string; rect: FrameGeom }> = []
  const seats: Array<{ id: string; x: number; y: number }> = []
  let x = 0
  let y = 0
  let bandH = 0
  for (const f of sized) {
    if (x > 0 && x + f.w > wrap) {
      x = 0
      y += bandH + FRAME_GAP
      bandH = 0
    }
    const rect: FrameGeom = { x, y, w: f.w, h: f.h }
    frames.push({ name: f.name, rect })
    // Pass 3 — seat the sole cards on the new rect's grid (the gh#48 rule,
    // driven by the NEW frame geometry).
    const startX = rect.x + RELAYOUT_PAD + NODE_W / 2
    let cy = rect.y + RELAYOUT_PAD + NODE_H / 2
    f.soleIds.forEach((id, i) => {
      const col = i % f.perRow
      if (i > 0 && col === 0) cy += NODE_H + RELAYOUT_GAP_Y
      seats.push({ id, x: startX + col * (NODE_W + RELAYOUT_GAP_X), y: cy })
    })
    x += f.w + FRAME_GAP
    bandH = Math.max(bandH, f.h)
  }
  return { frames, seats }
}

/**
 * The model adapter (supervisor order v2): collect the LOCAL frames and
 * their sole members (remote org frames and multi-team members are out of
 * scope by spec), run the pure planner, apply the rects and seat moves
 * through the model's own mutation seam. Returns false when nothing is in
 * scope (the caller decides whether to dirty the layout).
 */
export function applyBoardRelayout(model: WorldModel, remoteNames: ReadonlySet<string>): boolean {
  const frames: Array<{ name: string; rect: FrameGeom; soleIds: string[] }> = []
  for (const [name, rect] of model.allFrames()) {
    if (remoteNames.has(name)) continue // remote org frames: untouched
    const soleIds = model.teamMemberIds(name)
      .map(id => model.getNode(id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
      .filter(n => n.memberships.length === 1)
      .map(n => n.id)
    frames.push({ name, rect, soleIds })
  }
  if (frames.length === 0) return false
  const out = planBoardRelayout({ frames })
  for (const f of out.frames) model.setFrame(f.name, f.rect)
  for (const seat of out.seats) {
    const n = model.getNode(seat.id)
    if (n !== undefined) model.dragNodes([seat.id], seat.x - n.x, seat.y - n.y)
  }
  return true
}
