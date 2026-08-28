/**
 * Canvas action algebra for PR C (design.md §3.3/§3.4): the five user-facing
 * write actions as optimistic model mutations that each return a TEAM-SCOPED
 * undo. Scoped undos are the feedback loop's core - a whole-state revert
 * would clobber other queued actions' optimistic state; a per-team undo only
 * ever touches the team whose write failed, so queued actions on other teams
 * survive, and undo state (captured at apply time) stays consistent with the
 * per-team serial settle order.
 *
 * Pure: no DOM, no three, no fetch. The wire (canvas-wire.ts) owns transport;
 * the view owns calling applyAction before emitting and undo() on failure.
 * @module nexus-stage/canvas-ops
 */

import { nodeRect, deriveInitialFrame, type WorldModel } from './world'

/** The five user-facing write actions (one per design.md §3.3 row). */
export type CanvasAction =
  | { type: 'create-team'; name: string; ids: readonly string[] }
  | { type: 'add-member'; team: string; ids: readonly string[] }
  | { type: 'remove-member'; team: string; ids: readonly string[] }
  | { type: 'remove-team'; name: string }
  | { type: 'reorder'; team: string; ids: readonly string[] }

/** Reverts exactly what one applyAction did (team-scoped). */
export type Undo = () => void

/** The team whose writes this action touches (queue key for the wire). */
export function actionTeam(a: CanvasAction): string {
  return a.type === 'create-team' || a.type === 'remove-team' ? a.name : a.team
}

/**
 * Apply one action's optimistic mutation and return its undo. The undo is
 * expressed as the INVERSE DELTA against the roster at undo time, never as
 * a wholesale restore of a captured prefix - a later queued action on the
 * same team may have applied optimistically before this action's write
 * fails, and rolling back must remove only this action's effect.
 */
export function applyAction(model: WorldModel, a: CanvasAction): Undo {
  if (a.type === 'create-team') {
    const rects = a.ids
      .map(id => model.getNode(id))
      .filter(n => n !== undefined)
      .map(n => nodeRect(n))
    model.setFrame(a.name, deriveInitialFrame(rects))
    model.setTeamMembers(a.name, a.ids)
    return () => {
      // Only the created ids (a later add to this new team must survive).
      model.setTeamMembers(a.name, model.teamMemberIds(a.name).filter(id => !a.ids.includes(id)))
      model.removeFrame(a.name)
    }
  }
  if (a.type === 'add-member') {
    const pre = model.teamMemberIds(a.team)
    const fresh = a.ids.filter(id => !pre.includes(id))
    model.setTeamMembers(a.team, [...pre, ...fresh])
    return () => {
      model.setTeamMembers(a.team, model.teamMemberIds(a.team).filter(id => !fresh.includes(id)))
    }
  }
  if (a.type === 'remove-member') {
    const pre = model.teamMemberIds(a.team)
    model.setTeamMembers(a.team, pre.filter(id => !a.ids.includes(id)))
    return () => {
      // Re-append the removed ids that nothing else has re-added since.
      const current = model.teamMemberIds(a.team)
      model.setTeamMembers(a.team, [...current, ...a.ids.filter(id => !current.includes(id))])
    }
  }
  if (a.type === 'remove-team') {
    const preIds = model.teamMemberIds(a.name)
    const frame = model.getFrame(a.name)
    const preRect = frame !== undefined ? { ...frame } : undefined
    model.setTeamMembers(a.name, [])
    model.removeFrame(a.name)
    return () => {
      if (preRect !== undefined) model.setFrame(a.name, preRect)
      model.setTeamMembers(a.name, preIds)
    }
  }
  // reorder: the desired roster replaces the current one wholesale. The
  // undo WALKS the current roster back to the captured pre-order (same
  // append-host discipline as reorderOps), so members a later queued
  // action added stay put.
  const pre = model.teamMemberIds(a.team)
  model.setTeamMembers(a.team, [...a.ids])
  return () => {
    let roster = model.teamMemberIds(a.team)
    for (let i = 0; i < pre.length; i++) {
      const id = pre[i]!
      if (roster[i] === id) continue
      if (!roster.includes(id)) continue
      roster = roster.filter(x => x !== id)
      roster.push(id)
    }
    model.setTeamMembers(a.team, roster)
  }
}

/**
 * The minimal remove+add walk that turns `current` into `desired` on a
 * host whose add-member always APPENDS: walk desired positions in order;
 * whenever the working copy disagrees, remove+re-add the desired member
 * (host-side remove is positional, add appends, so the working copy mirrors
 * the host roster exactly). Bounded at 2*|desired| writes and converges;
 * an already-equal roster yields zero ops; desired ids absent from current
 * are skipped (adding members is never reorder's business).
 */
export function reorderOps(
  current: ReadonlyArray<string>,
  desired: ReadonlyArray<string>,
): Array<{ op: 'remove' | 'add'; id: string }> {
  const working = [...current]
  const ops: Array<{ op: 'remove' | 'add'; id: string }> = []
  for (let i = 0; i < desired.length; i++) {
    const id = desired[i]!
    if (working[i] === id) continue
    if (!working.includes(id)) continue // not a member: not reorder's business
    ops.push({ op: 'remove', id })
    ops.push({ op: 'add', id })
    working.splice(working.indexOf(id), 1)
    working.push(id)
  }
  return ops
}

/** That team's members ordered by card-center y (ties: current priority). */
export function yOrderedMembers(model: WorldModel, team: string): string[] {
  return model
    .teamMemberIds(team)
    .map(id => ({ id, y: model.getNode(id)?.y ?? 0 }))
    .sort((a, b) => a.y - b.y)
    .map(r => r.id)
}

/** Innermost (smallest-area) frame containing the world point, if any. */
export function innermostFrameAt(
  frames: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>,
  p: { x: number; y: number },
): string | undefined {
  let best: string | undefined
  let bestArea = Number.POSITIVE_INFINITY
  for (const [name, r] of frames) {
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue
    const area = r.w * r.h
    if (area < bestArea) { best = name; bestArea = area }
  }
  return best
}
