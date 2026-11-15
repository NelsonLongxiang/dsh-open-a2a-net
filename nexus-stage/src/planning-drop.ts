/**
 * The planning board's node-drop dispatch (moved out of planning-view.ts, S3 batch 2: the view sits at the M1 line
 * cap). Pure move: the same 入队 / 队内 y 排序 / 离队 retract behaviour, with the model and the action emitter as
 * dependencies. Leaving a team stays an explicit menu action only — dragging out to blank is a position move.
 */
import { screenToWorld, type LayoutViewport } from './viewport'
import { innermostFrameAt, reorderOps, yOrderedMembers, type CanvasAction } from './canvas-ops'
import type { WorldModel } from './world'

export interface DropDispatchDeps {
  readonly root: HTMLElement
  readonly vp: LayoutViewport
  /** The board's model (allFrames / getNode / teamMemberIds). */
  readonly model: WorldModel
  /** The view's action emitter (optimistic apply + undo + server boundary). */
  readonly emitAction: (a: CanvasAction) => void
}

export function localXY(root: HTMLElement, ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = root.getBoundingClientRect()
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
}

/** Drop dispatch for a moved node drag: 入队 / 队内 y 排序. Leaving a team is an explicit menu action only. */
export function dropDispatch(deps: DropDispatchDeps, gesture: { ids: readonly string[]; clicked: string; rosterOrigin?: string }, ev: { clientX: number; clientY: number }): void {
  const p = localXY(deps.root, ev)
  const w = screenToWorld(deps.vp, p.x, p.y)
  const f = innermostFrameAt(new Map(deps.model.allFrames()), w)
  // gh#20 W-B: peer cards join canvas teams too — a mixed local+remote drop composes a cross-host team; the
  // server boundary translates peer ids to zone/id8 handles (emitAction's serverAction). Reorder stays local-only.
  const memberIds = gesture.ids.filter(id => {
    const node = deps.model.getNode(id)
    if (node === undefined) return false
    if (node.remote !== true) return true
    return node.remoteHandle !== undefined && node.remoteHandle !== ''
  })
  if (f !== undefined) {
    const fresh = memberIds.filter(id => !(deps.model.getNode(id)?.memberships.some(m => m.team === f)))
    if (fresh.length > 0) {
      deps.emitAction({ type: 'add-member', team: f, ids: fresh }) // 入队：不自动离原队（多对多）
      return
    }
    // Reorder only for LOCAL single-card drops: dropping a peer card is a position move, never a roster write.
    if (gesture.ids.length === 1 && deps.model.getNode(gesture.clicked)?.remote !== true) {
      const current = deps.model.teamMemberIds(f)
      const desired = yOrderedMembers(deps.model, f)
      if (desired.join('\u0000') !== current.join('\u0000')) {
        deps.emitAction({ type: 'reorder', team: f, ops: reorderOps(current, desired) })
      }
    }
  }
  // Canvas blank drops move only; leaving a roster frame explicitly retracts those declarations.
  if (gesture.rosterOrigin !== undefined && f !== gesture.rosterOrigin) {
    const leaving = gesture.ids.filter(id => deps.model.teamMemberIds(gesture.rosterOrigin!).includes(id))
    if (leaving.length > 0) deps.emitAction({ type: 'remove-member', team: gesture.rosterOrigin, ids: leaving })
  }
}
