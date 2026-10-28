/**
 * Board overlap rules (owner, 2026-10-27: 团队方框需要避免遮盖和覆盖 — frames
 * must not overlap each other, and a card must not sit on a frame it is not
 * a member of).
 *
 * settleBoard() resolves both, deterministically:
 * - Frame vs frame: one frame of an overlapping pair steps aside along the
 *   shortest of the four directions, carrying its members like a drag. The
 *   frame the user just touched stays where it was put; a remote org frame
 *   never moves on its own (gh#44: its rect is the user's), so a local frame
 *   yields to it; two remote frames are left alone.
 * - Card vs frame: a card lying on a frame it does not belong to goes home
 *   first — the first free grid seat inside its own frame (memberships in
 *   state order) — and only a card with no frame (or no free seat) goes
 *   outside: right of that frame, else below it, else down a column right of
 *   every frame. No landing spot covers another card or a foreign frame, and
 *   frames are never moved or resized by this step. Members are never moved
 *   off their own frame; a member merely outside its frame (PR#85: a frame
 *   moves only itself) is left where it is.
 * Callers run it after a frame drag or resize, after 整理成员 / 一键重排,
 * and once when the board first has content — never on every poll (a poll
 * does not reposition what the user arranged).
 *
 * tidyMembers() is the gh#48 整理成员 grid, moved here from planning-view.
 * @module nexus-stage/planning-overlap
 */
import { NODE_W, NODE_H, nodeRect, type FrameGeom, type WorldModel } from './world'

/** Clearance kept between a moved frame or card and what it stepped off. */
export const OVERLAP_GAP = 24
/** Bound on resolution passes (a dense board settles in a few). */
const MAX_PASSES = 200

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
const hit = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The shortest translation that takes `m` clear of `f` (plus the gap). */
function stepAside(m: Rect, f: Rect): { dx: number; dy: number } {
  const right = f.x + f.w + OVERLAP_GAP - m.x
  const left = f.x - OVERLAP_GAP - (m.x + m.w)
  const down = f.y + f.h + OVERLAP_GAP - m.y
  const up = f.y - OVERLAP_GAP - (m.y + m.h)
  const dx = Math.abs(right) <= Math.abs(left) ? right : left
  const dy = Math.abs(down) <= Math.abs(up) ? down : up
  return Math.abs(dx) <= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy }
}

function moveFrame(model: WorldModel, name: string, dx: number, dy: number): void {
  const snap = model.beginFrameDrag(name)
  if (snap !== undefined) model.applyFrameDrag(snap, dx, dy)
}

/** Separate overlapping frames; true when anything moved. */
export function separateFrames(model: WorldModel, remote: ReadonlySet<string>, touched?: string): boolean {
  let changed = false
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const frames = model.allFrames()
    let pair: [string, FrameGeom, string, FrameGeom] | undefined
    for (let i = 0; i < frames.length && pair === undefined; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const [a, ra] = frames[i]!
        const [b, rb] = frames[j]!
        if (remote.has(a) && remote.has(b)) continue
        if (hit(ra, rb)) { pair = [a, ra, b, rb]; break }
      }
    }
    if (pair === undefined) return changed
    const [a, ra, b, rb] = pair
    // Who yields: the lower stay score moves — remote 2 (never moves on its
    // own), the frame just placed 1, any other 0; a tie moves the later one
    // in board order. (A plain "a stays" check moved a remote b whenever a
    // was the frame just placed — order-dependent: PR #83 review.)
    const stay = (n: string): number => remote.has(n) ? 2 : n === touched ? 1 : 0
    const [mover, mr, fixed] = stay(a) < stay(b) ? [a, ra, rb] : [b, rb, ra]
    const { dx, dy } = stepAside(mr, fixed)
    moveFrame(model, mover, dx, dy)
    changed = true
  }
  return changed
}

/** Grid of the 整理成员 layout, shared by eviction seats. */
const PAD = 28
const GAP_X = 16
const GAP_Y = 14

/** Card-centred seats inside a frame, row by row (the 整理成员 grid). */
function seatsIn(f: Rect): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (let y = f.y + PAD; y + NODE_H <= f.y + f.h - PAD; y += NODE_H + GAP_Y) {
    for (let x = f.x + PAD; x + NODE_W <= f.x + f.w - PAD; x += NODE_W + GAP_X) out.push({ x: x + NODE_W / 2, y: y + NODE_H / 2 })
  }
  return out
}

/** Move cards off frames they do not belong to; true when anything moved. */
export function evictStrangers(model: WorldModel): boolean {
  let changed = false
  const frames = model.allFrames()
  const rectOf = new Map(frames)
  for (const n of model.allNodes()) {
    const own = new Set(n.memberships.map(m => m.team))
    const host = frames.find(([name, f]) => !own.has(name) && hit(nodeRect(n), f))
    if (host === undefined) continue
    const f = host[1]
    // Free = no foreign frame and no other card under it (cards read live: earlier evictions count).
    const free = (p: { x: number; y: number }): boolean => {
      const r = nodeRect(p)
      return frames.every(([name, g]) => own.has(name) || !hit(r, g)) &&
        model.allNodes().every(o => o.id === n.id || !hit(r, nodeRect(o)))
    }
    const home = n.memberships.map(m => rectOf.get(m.team)).filter((g): g is FrameGeom => g !== undefined)
    const seat = home.flatMap(seatsIn).find(free)
    const right = { x: f.x + f.w + OVERLAP_GAP + NODE_W / 2, y: n.y }
    const below = { x: n.x, y: f.y + f.h + OVERLAP_GAP + NODE_H / 2 }
    // Last resort: a column right of every frame, top-down from this frame. A card blocks
    // at most two seats of this pitch, so 2·cards+1 seats always hold a free one.
    const farX = Math.max(...frames.map(([, g]) => g.x + g.w)) + OVERLAP_GAP + NODE_W / 2
    const column = Array.from({ length: 2 * model.allNodes().length + 1 }, (_, i) => ({ x: farX, y: f.y + NODE_H / 2 + i * (NODE_H + GAP_Y) }))
    const to = seat ?? [right, below, ...column].find(free) ?? column[column.length - 1]!
    model.dragNodes([n.id], to.x - n.x, to.y - n.y)
    changed = true
  }
  return changed
}

/** Both rules, frames first (moving a frame can uncover or cover cards). */
export function settleBoard(model: WorldModel, remote: ReadonlySet<string>, touched?: string): boolean {
  const framesMoved = separateFrames(model, remote, touched)
  const cardsMoved = evictStrangers(model)
  return framesMoved || cardsMoved
}

/**
 * gh#48 整理成员: inside every frame, the members that belong to exactly that
 * one team re-seat into a padded grid; the frame grows downward (bounded) to
 * fit them. Members of 2+ teams keep their positions.
 */
export function tidyMembers(model: WorldModel): void {
  for (const [name, rect] of model.allFrames()) {
    const sole = model.teamMemberIds(name)
      .map(id => model.getNode(id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
      .filter(n => n.memberships.length === 1)
    if (sole.length === 0) continue // empty frame / only shared members: untouched
    const perRow = Math.max(1, Math.floor((rect.w - 2 * PAD + GAP_X) / (NODE_W + GAP_X)))
    const rows = Math.ceil(sole.length / perRow)
    const needed = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y
    if (needed > rect.h) model.setFrame(name, { ...rect, h: Math.min(needed, rect.h + 400) })
    const startX = rect.x + PAD + NODE_W / 2
    let y = rect.y + PAD + NODE_H / 2
    sole.forEach((n, i) => {
      const col = i % perRow
      if (i > 0 && col === 0) y += NODE_H + GAP_Y
      const x = startX + col * (NODE_W + GAP_X)
      model.dragNodes([n.id], x - n.x, y - n.y)
    })
  }
}
