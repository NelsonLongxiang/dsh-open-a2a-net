/**
 * Role canvas direction admission (superagent design v3.1, PR-1).
 *
 * A canvas team becomes a ROLE canvas when the owner names one member its
 * router. Every other member of that canvas is a member. The host then
 * admits exactly two directions between role holders and nothing else:
 *
 *   - router → member of the same canvas: a dispatch (any non-receipt);
 *   - member → router of the same canvas: a receipt for a task that router
 *     dispatched to that member (this host's ledger row is the proof).
 *
 * Everything else that touches a role holder is refused with a named rule:
 * a member never initiates, the router takes no inbound but its members'
 * receipts, and no traffic crosses the role canvas boundary in either
 * direction (outsiders, CLI identities and the host face included). The
 * rules are the host's, not a prompt's.
 *
 * Multi-host (several physical nodes, or several DSH instances on one
 * machine that may even share a zone label): every host enforces its OWN
 * record of the role canvas over the parties it can see. A party is
 *   - local: a session of this host, by session id;
 *   - remote: a session of another host, by handle AND that host's full
 *     public key — proven by OriginClaim on the wire face, or pinned by the
 *     owner on the qualified member ref (`<zone>/<id8>@<fp8>` + owner key);
 *   - other: the host face, a CLI identity, an unproven caller.
 * A remote party matches a role seat only when the key matches the key the
 * owner pinned for that member; a bare `<zone>/<id8>` never identifies a
 * remote role holder (two instances may share a zone). An unproven caller
 * therefore reaches no role holder (fail closed). A session found in two
 * role canvases is refused outright rather than guessed.
 * @module @nelsonlongxiang/dsh-open-a2a-net/role-direction
 */

export type CanvasRole = 'router' | 'member'

/** Admitting rules (closed set). */
export type RoleRule = 'role-dispatch' | 'role-receipt'

/** Refusing rules (closed set): the name rides every refusal so the workbench can count it. */
export type RoleRefusalRule =
  | 'role-canvas-address'
  | 'role-ambiguous'
  | 'role-member-initiates'
  | 'role-router-inbound'
  | 'role-boundary'
  | 'role-receipt-unowed'

export const ROLE_REFUSAL_RULES: readonly RoleRefusalRule[] = ['role-canvas-address', 'role-ambiguous', 'role-member-initiates', 'role-router-inbound', 'role-boundary', 'role-receipt-unowed']

export type Party =
  | { readonly kind: 'local'; readonly session: string }
  | { readonly kind: 'remote'; readonly handle: string; readonly key?: string }
  | { readonly kind: 'other'; readonly label: string }

/** This host's records the rules read, and nothing else. */
export interface RoleRecords {
  readonly zone: string
  /** This host's canvas owner fingerprint (fp8): a qualified ref carrying it names a local session. */
  readonly ownFingerprint: string
  id8(id: string): string
  /** Stored router ref per role canvas (a canvas absent here is not a role canvas). */
  routers(): readonly (readonly [canvas: string, router: string])[]
  /** The canvas's routable member refs (suspended and unconfirmed slots already left out). */
  canvasMembersOf(name: string): readonly string[]
  canvasTeamOf(name: string): string
  /** The full owner key the owner pinned for a qualified member ref. */
  ownerKeyOf(ref: string): string | undefined
  /** Local session ids this host knows (joined or session nodes). */
  localSessions(): readonly string[]
}

/** The ledger facts of the task a receipt settles, read from this host's row for it. */
export interface ReceiptFacts {
  readonly taskId: string
  /** Who dispatched the task (an outbound row's session sender, or an inbound row's admitted caller). */
  readonly from?: string
  /** Who received it (`deliveredTo ?? team`). */
  readonly to?: string
}

export interface RoleQuery {
  readonly caller: Party
  /** The target team exactly as addressed. */
  readonly target: string
  /** Present when the message is a receipt. */
  readonly receipt?: ReceiptFacts
  /** The host itself carries a receipt for its local member (receipt autosend): the author is the ledger's member. */
  readonly courier?: boolean
}

export type RoleVerdict =
  | { readonly governed: false }
  | { readonly governed: true; readonly ok: true; readonly rule: RoleRule; readonly canvas: string }
  | { readonly governed: true; readonly ok: false; readonly rule: RoleRefusalRule; readonly refusal: string; readonly next: string }

export interface Seat { readonly canvas: string; readonly role: CanvasRole }

const QUALIFIED = /^([^/\s@]+\/[0-9a-f]{8})@([0-9a-f]{8})$/
const BARE_HANDLE = /^[^/\s@]+\/[0-9a-f]{8}$/
const handleOf = (ref: string): string => ref.replace(/@[0-9a-f]{8}$/, '')

/**
 * A ref → local session id: a session id, this host's `<zone>/<id8>`, or a
 * qualified ref carrying THIS host's fingerprint. A foreign fingerprint is never local.
 */
export function localSessionOf(r: RoleRecords, ref: string | undefined): string | undefined {
  if (ref === undefined || ref === '') return undefined
  const sessions = r.localSessions()
  if (!ref.includes('/')) return sessions.includes(ref) ? ref : undefined
  const qualified = QUALIFIED.exec(ref)
  if (qualified !== null && qualified[2] !== r.ownFingerprint) return undefined
  const handle = handleOf(ref)
  const prefix = `${r.zone}/`
  if (!handle.startsWith(prefix)) return undefined
  const id8 = handle.slice(prefix.length)
  const hits = sessions.filter(id => r.id8(id) === id8)
  return hits.length === 1 ? hits[0] : undefined
}

/** Whether a stored member ref names the party. */
export function refNames(r: RoleRecords, ref: string, party: Party): boolean {
  if (party.kind === 'local') return localSessionOf(r, ref) === party.session
  if (party.kind === 'other') return false
  const qualified = QUALIFIED.exec(ref)
  if (qualified === null || qualified[2] === r.ownFingerprint) return false
  const key = r.ownerKeyOf(ref)
  return qualified[1] === party.handle && party.key !== undefined && key !== undefined && key === party.key
}

/** Every role seat the party holds on this host's records. */
export function seatsOf(r: RoleRecords, party: Party): readonly Seat[] {
  if (party.kind === 'other') return []
  const seats: Seat[] = []
  for (const [canvas, routerRef] of r.routers()) {
    if (!r.canvasMembersOf(canvas).some(ref => refNames(r, ref, party))) continue
    seats.push({ canvas, role: refNames(r, routerRef, party) ? 'router' : 'member' })
  }
  return seats
}

/**
 * The party an address names: a local session, or a remote session whose
 * key the owner pinned on a role canvas member ref. A bare remote handle
 * borrows the key only when the role canvases pin exactly one key for it
 * (the directory's own owner selection resolves it the same way).
 */
export function addressParty(r: RoleRecords, address: string): Party {
  const local = localSessionOf(r, address)
  if (local !== undefined) return { kind: 'local', session: local }
  const qualified = QUALIFIED.exec(address)
  if (qualified !== null) {
    const key = r.ownerKeyOf(address)
    return { kind: 'remote', handle: qualified[1]!, ...(key !== undefined ? { key } : {}) }
  }
  if (!BARE_HANDLE.test(address)) return { kind: 'other', label: address }
  const keys = new Set<string>()
  for (const [canvas] of r.routers()) {
    for (const ref of r.canvasMembersOf(canvas)) {
      const m = QUALIFIED.exec(ref)
      if (m === null || m[1] !== address || m[2] === r.ownFingerprint) continue
      const key = r.ownerKeyOf(ref)
      if (key !== undefined) keys.add(key)
    }
  }
  return keys.size === 1 ? { kind: 'remote', handle: address, key: [...keys][0]! } : { kind: 'remote', handle: address }
}

/** Whether a ledger handle names the party (a remote party by handle: the row was born under a key-checked admission). */
function handleNames(r: RoleRecords, handle: string | undefined, party: Party): boolean {
  if (handle === undefined || handle === '') return false
  if (party.kind === 'local') return localSessionOf(r, handle) === party.session
  if (party.kind === 'remote') return handleOf(handle) === party.handle && localSessionOf(r, handle) === undefined
  return false
}

export function partyLabel(party: Party): string {
  return party.kind === 'local' ? party.session : party.kind === 'remote' ? party.handle : party.label
}

/** The role canvas a team address names, if it names one. */
function roleCanvasAddressed(r: RoleRecords, target: string): string | undefined {
  const bare = handleOf(target)
  return r.routers().map(([canvas]) => canvas).find(canvas => r.canvasTeamOf(canvas) === bare)
}

const refuse = (rule: RoleRefusalRule, refusal: string, next: string): RoleVerdict => ({ governed: true, ok: false, rule, refusal: `[${rule}] ${refusal}`, next })

/**
 * The one direction decision. `governed: false` means no role holder is
 * involved and the ordinary admission rules alone decide.
 */
export function roleDirection(r: RoleRecords, q: RoleQuery): RoleVerdict {
  if (r.routers().length === 0) return { governed: false }
  const addressed = roleCanvasAddressed(r, q.target)
  if (addressed !== undefined) {
    return refuse('role-canvas-address', `"${q.target}" is a role canvas; it is addressed one member at a time, never as a team.`, 'route to the member handle the router chose')
  }
  const targetParty = addressParty(r, q.target)
  const callerParty: Party = q.courier === true ? { kind: 'other', label: 'host' } : q.caller
  const targetSeats = seatsOf(r, targetParty)
  const callerSeats = seatsOf(r, callerParty)
  if (targetSeats.length === 0 && callerSeats.length === 0) {
    // A bare handle of a remote role holder whose key is not unique is not a free pass: refuse instead of guessing.
    if (targetParty.kind === 'remote' && targetParty.key === undefined && r.routers().some(([canvas]) => r.canvasMembersOf(canvas).some(ref => QUALIFIED.exec(ref)?.[1] === targetParty.handle))) {
      return refuse('role-ambiguous', `"${q.target}" names more than one role canvas member key; address the owner-qualified handle.`, 'route to the member\'s <zone>/<id8>@<fp8> handle')
    }
    return { governed: false }
  }
  if (targetSeats.length > 1 || callerSeats.length > 1) {
    return refuse('role-ambiguous', `a session sits in more than one role canvas (${[...targetSeats, ...callerSeats].map(s => s.canvas).join(', ')}); the host does not guess which role applies.`, 'ask the owner to keep each session in one role canvas')
  }
  const target = targetSeats[0]
  const caller = callerSeats[0]
  const callerLabel = q.courier === true ? 'host' : partyLabel(q.caller)

  if (q.receipt !== undefined) {
    // A receipt is admitted on this host's ledger: the router dispatched this
    // task to this member, and it goes back to that router.
    if (target?.role !== 'router') {
      return refuse(caller?.role === 'member' ? 'role-member-initiates' : 'role-boundary',
        `a receipt from "${callerLabel}" to "${q.target}" is not a member answering its router.`, 'members answer only their router; the router takes receipts only from its members')
    }
    const routerParty = targetParty
    const fromRouter = handleNames(r, q.receipt.from, routerParty)
    const author: Party | undefined = q.courier === true
      ? (() => { const local = localSessionOf(r, q.receipt?.to); return local === undefined ? undefined : { kind: 'local', session: local } as const })()
      : callerParty
    const toAuthor = author !== undefined && handleNames(r, q.receipt.to, author)
    const authorSeat = author === undefined ? [] : seatsOf(r, author)
    const owed = fromRouter && toAuthor && authorSeat.length === 1 && authorSeat[0]!.canvas === target.canvas && authorSeat[0]!.role === 'member'
    if (!owed) {
      return refuse('role-receipt-unowed', `receipt for task ${q.receipt.taskId} does not settle a task router "${q.target}" dispatched to "${callerLabel}".`, 'only the member a task went to answers it, with that task id')
    }
    return { governed: true, ok: true, rule: 'role-receipt', canvas: target.canvas }
  }

  if (caller?.role === 'router' && target?.role === 'member' && caller.canvas === target.canvas) {
    return { governed: true, ok: true, rule: 'role-dispatch', canvas: caller.canvas }
  }
  if (caller?.role === 'member') {
    return refuse('role-member-initiates', `member "${callerLabel}" of role canvas ${caller.canvas} never initiates; it answers its router with a receipt.`, 'finish the task and let the receipt go back to the router')
  }
  if (target?.role === 'router') {
    return refuse('role-router-inbound', `router "${q.target}" of role canvas ${target.canvas} takes no A2A work; requirements reach it from the owner in its own session.`, 'tell the owner; the owner talks to the router directly')
  }
  return refuse('role-boundary', `"${callerLabel}" → "${q.target}" crosses the role canvas boundary${caller !== undefined ? ` (the router of ${caller.canvas} dispatches only to its members)` : ` (${target!.canvas} members take work only from their router)`}.`, 'role canvas traffic stays between the router and its members')
}
