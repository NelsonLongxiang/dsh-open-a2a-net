/**
 * One canvas member write (#808): the checks the canvas route's add-member runs, shared with the team builder's blueprint
 * (`canvas.member.add`), so a member the owner agrees to in the builder session passes exactly the gate a member added in
 * the workbench does: a joined local session, or a zone-qualified remote ref with its owner proof, or a CLI handle with its
 * home pinned; the superagent team canvas refusal; the reserved-name check. Nothing here is a second admission path: the
 * member it writes is the explicit canvas record the cross-host admission already reads (src/task-auth.ts).
 * @module @nelsonlongxiang/dsh-open-a2a-net/canvas-member-write
 */
import { isRemoteMemberRef, legacyBareMember, validRemoteMemberRef, type CanvasStore } from './canvas-store.ts'
import type { CliHomeDecision } from './cli-home.ts'

export interface CanvasMemberWriteDeps {
  readonly canvasStore: Pick<CanvasStore, 'hasTeam' | 'create' | 'addMember' | 'rawMembersOf' | 'membersOf' | 'cliHomeOf'>
  readonly canvasNameReserved: (name: string) => boolean
  /** A local session id is a joined (or live) node here. */
  readonly localMember: (id: string) => boolean
  readonly memberForWrite: (ref: string, peer?: unknown) => Promise<{ ok: true; member: string; ownerKey?: string } | { ok: false; error: string }>
  readonly teamCanvasRefusal?: (canvas: string, member: string) => string | undefined
  readonly cliHomeForAdd: (handle: string, requested?: unknown) => Promise<CliHomeDecision>
}

/** `stored: false`: every check passed but the store refused the write (a full team, a pinned owner or home); the route answers that without an error text (gh108). */
export type CanvasMemberWrite = { ok: true; member: string; provenance?: 'unknown' } | { ok: false; error: string; stored?: false }

/** Add one member to a canvas (created when absent), after the same checks as the workbench route. */
export async function addCanvasMember(d: CanvasMemberWriteDeps, name: string, id: string, options: { peer?: unknown; home?: unknown } = {}): Promise<CanvasMemberWrite> {
  const memberValid = isRemoteMemberRef(id) ? validRemoteMemberRef(id) : id !== '' && d.localMember(id)
  if (!d.canvasStore.hasTeam(name) && d.canvasNameReserved(name)) return { ok: false, error: 'roster reserves this canvas name' }
  if (name === '' || !memberValid) return { ok: false, error: 'name and a member (joined session id, or a zone-qualified remote team handle like zone/a1b2c3d4) are required' }
  // Re-adding a retained legacy slot is a no-op, never provenance confirmation or restore.
  if (legacyBareMember(id) && d.canvasStore.rawMembersOf(name).includes(id)) return { ok: true, member: id, provenance: 'unknown' }
  const proof = await d.memberForWrite(id, options.peer)
  if (!proof.ok) return proof
  const teamRefusal = d.teamCanvasRefusal?.(name, proof.member)
  if (teamRefusal !== undefined) return { ok: false, error: teamRefusal }
  const pin = await d.cliHomeForAdd(proof.member, options.home).catch(() => ({ ok: false as const, error: 'linked home card lookup failed' }))
  if (!pin.ok) return { ok: false, error: pin.error }
  d.canvasStore.create(name)
  const explicitHome = options.home !== undefined
  const home = explicitHome ? pin.home : d.canvasStore.cliHomeOf(id) ?? pin.home
  return d.canvasStore.addMember(name, proof.member, home, { replaceHome: explicitHome, ...(proof.ownerKey !== undefined ? { ownerKey: proof.ownerKey } : {}) })
    ? { ok: true, member: proof.member } : { ok: false, error: `${id} was not added to canvas ${name}`, stored: false }
}
