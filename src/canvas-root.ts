/**
 * docs/design/superagent-root-team.md R7: the owner's canvas operations for a root team — mark a team as a root, add or
 * remove a child team, set a child's slots — and the proof that a child is a superagent team its host owns. Kept out of
 * faces/admin.ts (module cap); the canvas route dispatches here.
 * @module @nelsonlongxiang/dsh-open-a2a-net/canvas-root
 */
import { canvasOwnerFingerprint } from './canvas-id.ts'
import { splitTeamRef, validTeamOwner } from './canvas-member.ts'
import { CHILD_SLOTS_DEFAULT, type CanvasStore } from './canvas-store.ts'
import { cliHomeOrigin } from './cli-home.ts'

export const ROOT_ACTIONS = ['set-root', 'add-team', 'remove-team', 'set-team-slots'] as const
export type RootAction = typeof ROOT_ACTIONS[number]
export const isRootAction = (action: unknown): action is RootAction => typeof action === 'string' && (ROOT_ACTIONS as readonly string[]).includes(action)

/** A peer's verified card, as far as a child proof reads it. */
export interface ChildCard { readonly publicKey?: string; readonly canvasOrg?: ReadonlyArray<{ readonly name: string; readonly team: string; readonly superagentTeam?: true; readonly root?: true; readonly identity?: string }> }

export interface CanvasRootDeps {
  readonly store: Pick<CanvasStore, 'hasTeam' | 'isRoot' | 'setRoot' | 'addChild' | 'removeChild' | 'setChildSlots' | 'childrenOf' | 'rootNames' | 'addRequester' | 'removeRequester'>
  /** This host's zone (the `<zone>` of its addresses) and its public key. */
  readonly zone: string
  readonly ownKey: string
  /** Whether a local canvas is bound to a superagent team whose A2A Source is on (it takes requests at its address). */
  readonly localSuperagentCanvas: (name: string) => boolean
  /** The linked peers' verified cards, fetched fresh enough to trust their canvas listing. */
  readonly peerCards: () => Promise<ReadonlyArray<{ readonly url: string; readonly card: ChildCard; readonly linked: boolean }>>
}

/** A child on another host also gives its team identity and its host's origin: the root's canvas links it as a requester. */
export type ChildProof = { ok: true; key: string; identity?: string; home?: string } | { ok: false; error: string }

/**
 * A child must be a superagent team that takes requests, owned by the host whose key the ref's fingerprint names: this
 * host, or a linked peer whose signed card lists that canvas as a superagent team. A root cannot be a child (depth one),
 * and a root cannot be its own child.
 */
export async function childProof(root: string, ref: string, d: CanvasRootDeps): Promise<ChildProof> {
  const team = splitTeamRef(ref)
  if (team === undefined) return { ok: false, error: 'a child is a team address with its host fingerprint: <zone>/canvas/<name>@<8 hex>' }
  if (team.fingerprint === canvasOwnerFingerprint(d.ownKey)) {
    if (team.zone !== d.zone || !d.store.hasTeam(team.name)) return { ok: false, error: `${team.team} is not a canvas team on this host` }
    if (team.name === root) return { ok: false, error: 'a root cannot be its own child' }
    if (d.store.isRoot(team.name)) return { ok: false, error: `${team.team} is a root itself: a root has one level of children` }
    if (!d.localSuperagentCanvas(team.name)) return { ok: false, error: `${team.team} is not a superagent team taking requests (bind it to a team and turn its A2A Source on)` }
    return { ok: true, key: d.ownKey }
  }
  const cards = await d.peerCards()
  const host = cards.find(row => typeof row.card.publicKey === 'string' && canvasOwnerFingerprint(row.card.publicKey) === team.fingerprint)
  if (host === undefined) return { ok: false, error: `no linked peer has the key ${team.fingerprint}: add its host as a seed on both sides first` }
  if (!host.linked) return { ok: false, error: `the host of ${team.team} is not a linked peer yet` }
  const entry = host.card.canvasOrg?.find(row => row.team === team.team && row.name === team.name)
  if (entry === undefined) return { ok: false, error: `${host.url} does not list ${team.team} on its card` }
  if (entry.root === true) return { ok: false, error: `${team.team} is a root itself: a root has one level of children` }
  if (entry.superagentTeam !== true) return { ok: false, error: `${team.team} is not a superagent team taking requests on its host` }
  if (!validTeamOwner(ref, host.card.publicKey!)) return { ok: false, error: 'the host key does not match the fingerprint' }
  const home = cliHomeOrigin(host.url)
  return { ok: true, key: host.card.publicKey!, ...(entry.identity !== undefined && home !== undefined ? { identity: entry.identity, home } : {}) }
}

const str = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

/** One root operation from the canvas route's body; the result is the route's JSON payload. */
export async function rootAction(action: RootAction, body: Record<string, unknown>, d: CanvasRootDeps): Promise<Record<string, unknown>> {
  const name = str(body.name)
  if (name === '') return { ok: false, error: 'name (the root canvas team) is required' }
  const view = (): Record<string, unknown> => ({ roots: d.store.rootNames(), children: d.store.childrenOf(name) })
  if (action === 'set-root') {
    if (typeof body.root !== 'boolean') return { ok: false, error: 'root must be true or false' }
    const out = d.store.setRoot(name, body.root)
    return { ...out, ...view() }
  }
  const ref = str(body.team)
  if (ref === '') return { ok: false, error: 'team (the child team address <zone>/canvas/<name>@<8 hex>) is required' }
  if (action === 'remove-team') {
    const identity = d.store.childrenOf(name).find(c => c.ref === ref)?.identity
    const removed = d.store.removeChild(name, ref)
    if (removed && identity !== undefined && !d.store.childrenOf(name).some(c => c.identity === identity)) d.store.removeRequester(name, identity)
    return { ok: removed, ...view() }
  }
  const slots = body.slots === undefined ? undefined : Number(body.slots)
  if (action === 'set-team-slots') {
    if (slots === undefined) return { ok: false, error: 'slots is required' }
    return { ...d.store.setChildSlots(name, ref, slots), ...view() }
  }
  if (!d.store.isRoot(name)) return { ok: false, error: `${name} is not a root team: mark it first (set-root)` }
  const proof = await childProof(name, ref, d)
  if (!proof.ok) return { ...proof, ...view() }
  const added = d.store.addChild(name, ref, proof.key, slots ?? CHILD_SLOTS_DEFAULT, proof.identity)
  // S5: the child's answers come from its team identity on its host; the root's canvas links it there as a requester.
  // A child host that does not name its identity yet (an older build) is added all the same; its answers wait for it.
  const linked = added.ok && proof.identity !== undefined && proof.home !== undefined ? d.store.addRequester(name, proof.identity, proof.home) : undefined
  return { ...added, ...(linked !== undefined ? { identity: proof.identity, identityLinked: linked } : {}), ...view() }
}

/**
 * superagent-root-team S5: the wire's half of admitting a root team on another host. Its identity becomes a requester of
 * the child team's canvas, pinned to its home host (a requested home must be a linked host listing it; without one, the
 * only such host). An identity deposited on this host is admitted as a deposit and needs no link.
 */
export async function linkRootRequester(
  d: { readonly store: Pick<CanvasStore, 'addRequester'>; readonly deposited: (handle: string) => boolean; readonly pinHome: (handle: string, requested?: unknown) => Promise<{ ok: true; home?: string } | { ok: false; error: string }> },
  canvas: string, handle: string, home: unknown,
): Promise<{ ok: true; home?: string } | { ok: false; error: string }> {
  if (d.deposited(handle)) return home === undefined ? { ok: true } : { ok: false, error: 'the root identity is deposited on this host: it needs no home' }
  const pin = await d.pinHome(handle, home)
  if (!pin.ok) return pin
  if (pin.home === undefined) return { ok: false, error: 'no single linked host lists this root identity: pass home (the root host it is deposited on)' }
  return d.store.addRequester(canvas, handle, pin.home) ? { ok: true, home: pin.home } : { ok: false, error: `the root identity cannot be linked to ${canvas}: it is a member there, or pinned to another home` }
}
