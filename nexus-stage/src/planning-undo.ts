/**
 * 撤销 for the board layout (frontend seat, 2026-10-29): with no status-bar
 * hint for automatic moves (owner: 载入时避让挪了卡片，不需要在状态条提示),
 * a wrong move must be one keystroke away from undone. Covers card drags,
 * frame drags and resizes, keyboard nudges, 整理成员, 一键重排 and the
 * load-time settle — positions and frame rects only. Team membership
 * (入队 / 离队, host writes) is not undone here.
 *
 * capture() before an edit, commit(before) after it: only an edit that
 * actually moved something already on the board is recorded, so a click,
 * a pan or a marquee leaves the stack alone, and a card that arrived by
 * poll mid-gesture is not counted as a move.
 * @module nexus-stage/planning-undo
 */
import type { FrameGeom, WorldModel } from './world'

export interface LayoutSnap {
  readonly nodes: ReadonlyMap<string, { readonly x: number; readonly y: number }>
  readonly frames: ReadonlyMap<string, FrameGeom>
}

/** Undo depth (older steps fall off). */
export const UNDO_LIMIT = 30

export function createLayoutUndo(model: WorldModel) {
  const stack: LayoutSnap[] = []
  const capture = (): LayoutSnap => ({
    nodes: new Map(model.allNodes().map(n => [n.id, { x: n.x, y: n.y }])),
    frames: new Map(model.allFrames().map(([name, f]) => [name, { ...f }])),
  })
  /** True when something present both before and now has moved or changed size. */
  const moved = (before: LayoutSnap): boolean =>
    model.allNodes().some(n => { const b = before.nodes.get(n.id); return b !== undefined && (b.x !== n.x || b.y !== n.y) }) ||
    model.allFrames().some(([name, f]) => { const b = before.frames.get(name); return b !== undefined && (b.x !== f.x || b.y !== f.y || b.w !== f.w || b.h !== f.h) })
  return {
    capture,
    commit(before: LayoutSnap): void {
      if (!moved(before)) return
      stack.push(before)
      if (stack.length > UNDO_LIMIT) stack.shift()
    },
    /** Restore the last recorded layout; false when there is nothing to undo. */
    undo(): boolean {
      const snap = stack.pop()
      if (snap === undefined) return false
      for (const n of model.allNodes()) {
        const b = snap.nodes.get(n.id)
        if (b !== undefined && (b.x !== n.x || b.y !== n.y)) model.dragNodes([n.id], b.x - n.x, b.y - n.y)
      }
      for (const [name, f] of model.allFrames()) {
        const b = snap.frames.get(name)
        if (b !== undefined && (b.x !== f.x || b.y !== f.y || b.w !== f.w || b.h !== f.h)) model.setFrame(name, { ...b })
      }
      return true
    },
    get depth(): number { return stack.length },
  }
}
