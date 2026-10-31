/**
 * Task authorization (gh#114, design docs/design/114-task-authorization.md).
 *
 * S1: the inbound admission rules as ONE pure decision over this host's own
 * records. It answers not only "is this caller admissible?" (the refusal text
 * the faces have always shown, byte for byte) but also WHICH rule admitted it
 * and on which shared teams — the facts the immutable per-task authorization
 * record (S2) freezes at birth. The host's closures (`a2aCallerRefusal`,
 * `sameZoneSharedTeamRefusal`, `joinedFaceAdmissionRefusal`) are thin
 * wrappers over this module, so the faces and the record can never disagree.
 *
 * Also here, as the single implementation: the allowlist version hash (§2.3).
 * @module @nelsonlongxiang/dsh-open-a2a-net/task-auth
 */
import { createHash } from 'node:crypto'

/** The admission basis (closed set, design §2.2). */
export type Via = 'host-face' | 'joined-session' | 'canvas-member' | 'peer-org' | 'cli-deposit' | 'open'

/** The exact rule that admitted a caller (closed set, design §2.2). */
export type AdmissionRule =
  | 'scope-off'
  | 'host-face'
  | 'local-exempt'
  | 'roster-shared'
  | 'canvas-shared'
  | 'remote-ref-samezone'
  | 'remote-ref-foreign'
  | 'peer-org'
  | 'node-fact'
  | 'cli-deposit'

/** Every rule's basis — the mapping the authorization record stores beside the rule. */
export const VIA_OF: Readonly<Record<AdmissionRule, Via>> = {
  'scope-off': 'open',
  'host-face': 'host-face',
  'local-exempt': 'host-face',
  'roster-shared': 'joined-session',
  'canvas-shared': 'canvas-member',
  'remote-ref-samezone': 'canvas-member',
  'remote-ref-foreign': 'canvas-member',
  'peer-org': 'peer-org',
  'node-fact': 'joined-session',
  'cli-deposit': 'cli-deposit',
}

/**
 * One admission decision. `basis` lists every shared team that held; `rule`
 * is the first branch of the decision that hit (deterministic, so a record
 * built from it is reproducible).
 */
export type Admission =
  | { readonly ok: true; readonly via: Via; readonly rule: AdmissionRule; readonly basis: readonly string[] }
  | { readonly ok: false; readonly refusal: string }

/** The refusal text of a decision, or undefined when admitted — the shape the faces have always read. */
export const refusalOf = (admission: Admission): string | undefined => (admission.ok ? undefined : admission.refusal)

const admitted = (rule: AdmissionRule, basis: readonly string[] = []): Admission => ({ ok: true, via: VIA_OF[rule], rule, basis })
const refused = (refusal: string): Admission => ({ ok: false, refusal })

/** One cached peer card's published canvas org (gh#71). */
export interface PeerOrgEntry { readonly team?: unknown; readonly members?: unknown }

/**
 * This host's records, read at decision time. Every field the admission
 * rules consult and nothing else — the caller's self-description never
 * appears here (gh#7 N3, V5).
 */
export interface AdmissionRecords {
  readonly zone: string
  readonly teamScopeRouting: boolean
  id8(id: string): string
  canvasTeamOf(name: string): string
  memberships(): readonly { readonly session: string; readonly teams: readonly string[] }[]
  joined(): readonly string[]
  canvasNames(): readonly string[]
  /** Canvas names the session sits in. */
  canvasTeamsOf(sessionId: string): readonly string[]
  canvasMembersOf(name: string): readonly string[]
  canvasRemoteMembersOf(name: string): readonly string[]
  /** The canvasOrg lists of the warm peer-card cache. */
  peerOrgs(): Iterable<readonly PeerOrgEntry[]>
  liveNodeIds(): readonly string[]
  cliDeposited(handle: string): boolean
}

const ZONE_ID8 = /^[a-z0-9-]+\/[0-9a-f]{8}$/i

const teamlessText = (caller: string): string =>
  `caller "${caller}" declares no team membership on this host's roster — a teamless node has no network (S3 phase-3 admission). Declare a shared team on both ends, or route through a teamed member.`

/**
 * W1/W2 shared-team admission core: a same-zone zone/id8 caller passes when
 * it holds a team this host's records also hold. The caller's basis is its
 * roster declarations UNION its canvas memberships (W2②); a handle that
 * resolves to no local session is a cross-host member whose basis is this
 * host's remote member refs (#43) and the warm cache's two-way canvasOrg
 * (gh#71 ②). F5: with a target, the intersection is at target level.
 */
export function sameZoneAdmission(r: AdmissionRecords, caller: string, targetTeam?: string): Admission {
  // Declared team → the rule that declared it, in first-hit order.
  const declared = new Map<string, AdmissionRule>()
  const declare = (team: string, rule: AdmissionRule): void => { if (!declared.has(team)) declared.set(team, rule) }
  let callerSessionId: string | undefined
  for (const entry of r.memberships()) {
    if (`${r.zone}/${r.id8(entry.session)}` === caller) {
      callerSessionId = entry.session
      for (const t of entry.teams) declare(t, 'roster-shared')
    }
  }
  if (callerSessionId === undefined) {
    for (const id of r.joined()) {
      if (`${r.zone}/${r.id8(id)}` === caller) { callerSessionId = id; break }
    }
  }
  // Canvas members mix two shapes: a local session sits by session id, but a
  // member added across hosts (gh#41 fleet editing) is stored by its
  // zone/id8 handle even when the session is local here. Match either — the
  // sending side's gate already does (review of PR #129).
  if (callerSessionId !== undefined) {
    for (const name of r.canvasTeamsOf(callerSessionId)) declare(r.canvasTeamOf(name), 'canvas-shared')
    for (const name of r.canvasNames()) {
      if (r.canvasMembersOf(name).includes(caller)) declare(r.canvasTeamOf(name), 'canvas-shared')
    }
  } else {
    for (const name of r.canvasNames()) {
      if (r.canvasRemoteMembersOf(name).includes(caller)) declare(r.canvasTeamOf(name), 'remote-ref-samezone')
    }
    const ownHandles = new Set<string>([r.zone, ...r.joined().map(id => `${r.zone}/${r.id8(id)}`)])
    for (const org of r.peerOrgs()) {
      for (const e of org) {
        if (typeof e.team !== 'string' || e.team === '' || !Array.isArray(e.members)) continue
        if (e.members.includes(caller) && e.members.some(m => typeof m === 'string' && ownHandles.has(m))) declare(e.team, 'peer-org')
      }
    }
  }
  // Target links → whether only the warm peer-card cache supplied them.
  const viaCacheOnly = new Map<string, boolean>()
  /**
   * Admit on the declared teams that `holds`. A team the decision owes to the
   * peer-card cache alone (declared from a cached org, or linked to the
   * target only by one) is basis `peer-org:<team>`, and an admission that
   * would vanish without the cache is labelled `peer-org` — the record (S2)
   * must re-judge it on every change, since the cache is not in the
   * allowlist version (design §2.3; review of PR #126 P2).
   */
  const pass = (holds: (team: string) => boolean): Admission | undefined => {
    const hits = [...declared.keys()].filter(holds)
    if (hits.length === 0) return undefined
    const cached = (team: string): boolean => declared.get(team) === 'peer-org' || viaCacheOnly.get(team) === true
    const firm = hits.find(team => !cached(team))
    return admitted(firm === undefined ? 'peer-org' : declared.get(firm)!, hits.map(team => (cached(team) ? `peer-org:${team}` : team)))
  }
  const routable = new Set<string>([r.zone])
  for (const id of r.joined()) routable.add(`${r.zone}/${r.id8(id)}`)
  for (const name of r.canvasNames()) routable.add(r.canvasTeamOf(name))
  const otherLocalDeclarations = new Set<string>()
  for (const entry of r.memberships()) {
    if (`${r.zone}/${r.id8(entry.session)}` === caller) continue
    for (const t of entry.teams) otherLocalDeclarations.add(t)
  }
  if (targetTeam !== undefined && targetTeam !== r.zone) {
    let targetLinks: Set<string> | undefined
    // gh#128: a canvas team (`<zone>/canvas/<name>`) also starts with
    // `<zone>/`. Resolve it as a canvas FIRST — read as a session id8 it
    // matched no session, the canvas branch below was unreachable, and a
    // canvas target fell back to the host-level basis (any shared link
    // opened every canvas team).
    const targetCanvas = r.canvasNames().find(name => r.canvasTeamOf(name) === targetTeam)
    const targetId8 = targetCanvas === undefined && targetTeam.startsWith(`${r.zone}/`) ? targetTeam.slice(r.zone.length + 1) : undefined
    if (targetId8 !== undefined) {
      const targetSession = r.joined().find(sessionId => r.id8(sessionId) === targetId8)
        ?? r.memberships().find(entry => r.id8(entry.session) === targetId8)?.session
      if (targetSession !== undefined) {
        targetLinks = new Set<string>()
        for (const entry of r.memberships()) {
          if (entry.session === targetSession) for (const t of entry.teams) targetLinks.add(t)
        }
        for (const name of r.canvasTeamsOf(targetSession)) targetLinks.add(r.canvasTeamOf(name))
        for (const name of r.canvasNames()) {
          if (r.canvasMembersOf(name).includes(targetTeam)) targetLinks.add(r.canvasTeamOf(name))
        }
        for (const org of r.peerOrgs()) {
          for (const e of org) {
            if (typeof e.team !== 'string' || e.team === '' || !Array.isArray(e.members)) continue
            if (e.members.includes(caller) && e.members.includes(targetTeam) && !targetLinks.has(e.team)) {
              targetLinks.add(e.team)
              viaCacheOnly.set(e.team, true)
            }
          }
        }
      }
    } else {
      const canvasName = targetCanvas
      if (canvasName !== undefined) {
        targetLinks = new Set<string>([targetTeam])
        for (const memberId of r.canvasMembersOf(canvasName)) {
          for (const entry of r.memberships()) {
            if (entry.session === memberId || `${r.zone}/${r.id8(entry.session)}` === memberId) for (const t of entry.teams) targetLinks.add(t)
          }
        }
      }
    }
    if (targetLinks !== undefined) {
      const links = targetLinks
      const hit = pass(t => links.has(t))
      if (hit !== undefined) return hit
      return refused(declared.size === 0
        ? teamlessText(caller)
        : `caller "${caller}" shares no team with target "${targetTeam}" — declared [${[...declared.keys()].join(', ')}], target links [${[...links].join(', ')}] (F5 target-level admission: a host-level link alone does not open every session team).`)
    }
  }
  const hit = pass(t => routable.has(t) || otherLocalDeclarations.has(t))
  if (hit !== undefined) return hit
  return refused(declared.size === 0
    ? teamlessText(caller)
    : `caller "${caller}" declares teams [${[...declared.keys()].join(', ')}] — none is routable on this node (shared-team admission). Declare a shared team on both ends, or route through a teamed member.`)
}

/**
 * W1: the joined-face gate for the LOCAL dispatch candidate — only a
 * zone/id8 label of THIS zone is judged (the shared-team core); every other
 * label is outside this gate.
 */
export function joinedFaceAdmission(r: AdmissionRecords, callerSession: string | undefined, targetTeam?: string): Admission | undefined {
  if (callerSession === undefined || callerSession === '') return undefined
  if (!ZONE_ID8.test(callerSession)) return undefined
  if (callerSession.slice(0, callerSession.indexOf('/')) !== r.zone) return undefined
  return sameZoneAdmission(r, callerSession, targetTeam)
}

/** Inbound admission for the peer faces (/a2a/direct, /a2a/log): caller_session is the contract. */
export function callerAdmission(r: AdmissionRecords, caller: string, targetTeam?: string): Admission {
  if (!r.teamScopeRouting) return admitted('scope-off')
  if (caller === '') {
    return refused('caller_session is required — anonymous deliveries are refused (S3 phase-3b). Pass caller_session as <zone>/<id8>.')
  }
  if (caller === r.zone) return admitted('host-face')
  if (ZONE_ID8.test(caller)) {
    const callerZone = caller.slice(0, caller.indexOf('/'))
    if (callerZone === r.zone) return sameZoneAdmission(r, caller, targetTeam)
    // Foreign-zone handle (N3/N4): only this host's operator-added remote member refs.
    const basis = r.canvasNames().filter(name => r.canvasRemoteMembersOf(name).includes(caller)).map(name => r.canvasTeamOf(name))
    if (basis.length > 0) return admitted('remote-ref-foreign', basis)
    return refused(`caller "${caller}" has no operator-established link on this node — cross-host admission requires a canvas remote membership this host's operator added (N3/N4: the caller's own card claims are self-description, not links). Ask this host's operator to add the member in the A2A workbench, or route through a linked member.`)
  }
  // Free-form label: only this host's own node facts (V3).
  if (r.joined().includes(caller)) return admitted('node-fact')
  for (const id of r.joined()) {
    if (`${r.zone}/${r.id8(id)}` === caller) return admitted('node-fact')
  }
  if (r.liveNodeIds().includes(caller)) return admitted('node-fact')
  // gh#45: a deposited CLI handle is a published node fact of this host.
  if (r.cliDeposited(caller)) return admitted('cli-deposit')
  return refused(`caller_session "${caller}" matches no node fact on this host (joined session id, live node label, or deposited CLI handle) — free-form caller labels are self-description and are not admissible (N3). Pass caller_session as <zone>/<id8> with an operator-established link.`)
}

/**
 * The inputs of the allowlist version (design §2.3): only operator-controlled
 * records the admission rules really read. The peer-card canvasOrg is left
 * out on purpose — it is the remote's self-description and churns with the
 * cache; a peer-org record carries its org entry in `basis` instead.
 */
export interface AllowlistInputs {
  readonly zone: string
  readonly scope: readonly [teamScopeRouting: boolean, originClaimWindow: boolean]
  readonly joined: readonly string[]
  readonly roster: readonly (readonly [handle: string, team: string])[]
  readonly canvas: readonly (readonly [team: string, members: readonly string[]])[]
  readonly cli: readonly string[]
  readonly links: readonly string[]
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort()
const pairKey = (pair: readonly [string, string]): string => JSON.stringify(pair)

/**
 * The canonical JSON the version hashes: fixed key order, arrays sorted and
 * deduplicated, no whitespace. Strings sort by UTF-16 code unit (JavaScript's
 * default `sort`) and are NOT Unicode-normalized: another implementation must
 * do the same to reproduce a version.
 */
export function canonicalAllowlist(inputs: AllowlistInputs): string {
  const roster = [...new Map(inputs.roster.map(p => [pairKey(p), [p[0], p[1]] as const])).values()]
    .sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0))
  // A canvas team listed twice is one team: union its members, so input order never matters.
  const members = new Map<string, string[]>()
  for (const [team, list] of inputs.canvas) members.set(team, [...(members.get(team) ?? []), ...list])
  const canvas = [...members.entries()].map(([team, list]) => [team, sortedUnique(list)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify({
    zone: inputs.zone,
    scope: [inputs.scope[0], inputs.scope[1]],
    joined: sortedUnique(inputs.joined),
    roster,
    canvas,
    cli: sortedUnique(inputs.cli),
    links: sortedUnique(inputs.links),
  })
}

/** `al1:` + the first 16 hex of sha256 over the canonical inputs. */
export function allowlistVersion(inputs: AllowlistInputs): string {
  return `al1:${createHash('sha256').update(canonicalAllowlist(inputs)).digest('hex').slice(0, 16)}`
}

// ── S2: the immutable per-task authorization record (design §2.1, §2.4, §2.5) ──

/**
 * How strongly the caller's identity was proven at birth:
 * - `origin-claim`: an OriginClaim verified AND its signed zone covers the
 *   judged caller (the same name, or `<zone>/…`). It proves possession of a
 *   key whose card names that zone — not that the zone is who it says.
 * - `claim-mismatch`: an OriginClaim verified, but for a zone that does not
 *   cover the judged caller (the claim is kept for audit; review of PR #134 P1).
 * - `legacy-window`: no envelope, admitted inside the OriginClaim window.
 * - `in-process`: a local delivery inside this host (S4).
 * - `none`: no identity evidence at all.
 */
export type AuthProof = 'origin-claim' | 'claim-mismatch' | 'legacy-window' | 'in-process' | 'none'

/**
 * Frozen on an inbound ledger row when it is born, archived with it, never
 * mutated: the answer to "on what authority did this host take this task".
 */
export interface TaskAuthorization {
  readonly v: 1
  /** The caller_session the admission rules judged. */
  readonly caller: string
  readonly proof: AuthProof
  /** proof = origin-claim: the name the signed card derived, and its card URL's origin. */
  readonly claim?: { readonly caller: string; readonly origin: string }
  readonly ingress: 'wire' | 'local'
  readonly via: Via
  readonly admission_rule: AdmissionRule
  /** Every shared team that held (cache-owed ones as `peer-org:<team>`). */
  readonly basis: readonly string[]
  readonly allowlist_version: string
  /** The team the task was delivered to. */
  readonly target: string
  /** Where the receipt is owed. */
  readonly receipt_target: string
  readonly received_at: number
  /** Audit only: the target was running another turn when the task arrived (never used to attribute turns). */
  readonly target_busy?: true
}

/** Bounds a persisted record must respect; anything outside them is malformed, not truncated. */
export const AUTH_STRING_CAP = 256
export const AUTH_BASIS_CAP = 64

const PROOFS: readonly string[] = ['origin-claim', 'claim-mismatch', 'legacy-window', 'in-process', 'none']
const RULES = Object.keys(VIA_OF)
/** Rules that admit on shared teams: their basis lists at least one, each once. Every other rule has an empty basis. */
const SHARED_RULES: readonly AdmissionRule[] = ['roster-shared', 'canvas-shared', 'remote-ref-samezone', 'remote-ref-foreign', 'peer-org']
/** A record born more than this far in the future is a forgery or a broken clock, not a birth. */
export const AUTH_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

/** Does a verified claim's signed zone cover the judged caller (the same name, or `<zone>/…`)? */
export const claimCovers = (caller: string, claimCaller: string): boolean =>
  claimCaller !== '' && (caller === claimCaller || caller.startsWith(`${claimCaller}/`))

/** The facts of one delivery that the admission decision does not carry. */
export interface AuthorizationFacts {
  readonly caller: string
  readonly proof: AuthProof
  readonly claim?: { readonly caller: string; readonly origin: string }
  readonly ingress: 'wire' | 'local'
  readonly allowlistVersion: string
  readonly target: string
  readonly receiptTarget: string
  readonly receivedAt: number
  readonly targetBusy?: boolean
}

/** The one constructor of a record: from an admitted decision and the delivery's facts. Frozen. */
export function buildAuthorization(admission: Extract<Admission, { ok: true }>, facts: AuthorizationFacts): TaskAuthorization {
  return Object.freeze({
    v: 1 as const,
    caller: facts.caller,
    proof: facts.proof,
    ...(facts.claim !== undefined ? { claim: Object.freeze({ caller: facts.claim.caller, origin: facts.claim.origin }) } : {}),
    ingress: facts.ingress,
    via: admission.via,
    admission_rule: admission.rule,
    basis: Object.freeze([...admission.basis]),
    allowlist_version: facts.allowlistVersion,
    target: facts.target,
    receipt_target: facts.receiptTarget,
    received_at: facts.receivedAt,
    ...(facts.targetBusy === true ? { target_busy: true as const } : {}),
  })
}

/**
 * #114 S5: the canonical JSON of one authorization record — the single
 * implementation `authRef` hashes. Fixed key order (the {@link
 * TaskAuthorization} declaration order), absent optional fields omitted,
 * `basis` sorted and deduplicated (it is a set: the order admission found its
 * teams in is not part of the authority), no whitespace. Persisted key order
 * never matters, so a restored record yields the same ref as its original.
 */
export function canonicalAuthorization(auth: TaskAuthorization): string {
  return JSON.stringify({
    v: auth.v,
    caller: auth.caller,
    proof: auth.proof,
    ...(auth.claim !== undefined ? { claim: { caller: auth.claim.caller, origin: auth.claim.origin } } : {}),
    ingress: auth.ingress,
    via: auth.via,
    admission_rule: auth.admission_rule,
    basis: sortedUnique(auth.basis),
    allowlist_version: auth.allowlist_version,
    target: auth.target,
    receipt_target: auth.receipt_target,
    received_at: auth.received_at,
    ...(auth.target_busy === true ? { target_busy: true } : {}),
  })
}

/**
 * #114 S5: the auto-receipt envelope's `authRef` — the first 16 hex of
 * sha256 over {@link canonicalAuthorization}. Pins which inbound record a
 * host-synthesized receipt answers; recorded for audit, judged by S4.
 */
export function authorizationRef(auth: TaskAuthorization): string {
  return createHash('sha256').update(canonicalAuthorization(auth)).digest('hex').slice(0, 16)
}

const boundedString = (v: unknown, allowEmpty = false): v is string =>
  typeof v === 'string' && (allowEmpty || v !== '') && v.length <= AUTH_STRING_CAP

/**
 * Restore-side allowlist for one persisted record (design §2.5): all of it or
 * none of it — a record with any field outside its closed set or bounds, or
 * any combination admission could never have produced, is dropped whole (the
 * row is kept, as a pre-S2 row), never partially adopted. Later slices (S4
 * settlement) trust what survives, so a corrupt or hand-edited tasks.json
 * must not be able to plant a plausible record.
 * @param now - the restore clock, for the future-birth bound.
 */
export function parseAuthorization(raw: unknown, now: number = Date.now()): TaskAuthorization | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (r.v !== 1) return undefined
  // Admission always refuses an anonymous caller, and a receipt is always owed to someone.
  if (!boundedString(r.caller) || !boundedString(r.target) || !boundedString(r.receipt_target)) return undefined
  if (typeof r.proof !== 'string' || !PROOFS.includes(r.proof)) return undefined
  if (r.ingress !== 'wire' && r.ingress !== 'local') return undefined
  if (typeof r.admission_rule !== 'string' || !RULES.includes(r.admission_rule)) return undefined
  const rule = r.admission_rule as AdmissionRule
  if (r.via !== VIA_OF[rule]) return undefined
  if (!Array.isArray(r.basis) || r.basis.length > AUTH_BASIS_CAP || !r.basis.every(b => boundedString(b))) return undefined
  if (new Set(r.basis).size !== r.basis.length) return undefined
  if (SHARED_RULES.includes(rule) ? r.basis.length === 0 : r.basis.length !== 0) return undefined
  // The wire proves identity by envelope or not at all; an in-process birth is local, and local-exempt only exists there.
  if (r.ingress === 'wire' ? !['origin-claim', 'claim-mismatch', 'legacy-window'].includes(r.proof) : r.proof !== 'in-process') return undefined
  if (rule === 'local-exempt' && r.ingress !== 'local') return undefined
  if (typeof r.allowlist_version !== 'string' || !/^al1:[0-9a-f]{16}$/.test(r.allowlist_version)) return undefined
  if (typeof r.received_at !== 'number' || !Number.isInteger(r.received_at) || r.received_at < 0 || r.received_at > now + AUTH_CLOCK_SKEW_MS) return undefined
  if (r.target_busy !== undefined && r.target_busy !== true) return undefined
  let claim: { caller: string; origin: string } | undefined
  if (r.claim !== undefined) {
    const c = r.claim as Record<string, unknown> | null
    if (c === null || typeof c !== 'object' || !boundedString(c.caller) || !boundedString(c.origin)) return undefined
    claim = { caller: c.caller as string, origin: c.origin as string }
  }
  // A claim rides exactly the two claim proofs, and which one is decided by coverage — never by the record's say-so.
  if ((claim !== undefined) !== (r.proof === 'origin-claim' || r.proof === 'claim-mismatch')) return undefined
  if (claim !== undefined && claimCovers(r.caller as string, claim.caller) !== (r.proof === 'origin-claim')) return undefined
  return buildAuthorization(
    { ok: true, via: VIA_OF[rule], rule, basis: r.basis as string[] },
    {
      caller: r.caller as string, proof: r.proof as AuthProof, ...(claim !== undefined ? { claim } : {}),
      ingress: r.ingress, allowlistVersion: r.allowlist_version, target: r.target as string,
      receiptTarget: r.receipt_target as string, receivedAt: r.received_at, targetBusy: r.target_busy === true,
    },
  )
}

// ── S4: who may settle a task (design §4.1, §4.2, §4.4) ──────────────────────

/** `off`: no judgement. `observe` (default): judge and record, settle as before. `enforce`: an off-chain settlement is refused. */
export type SettlementMode = 'off' | 'observe' | 'enforce'

/** How a settler stands on the task's authorization chain. */
export type ChainRole = 'target' | 'target-member' | 'host-face' | 'compat' | 'legacy'

/** Why a settlement is (or would be) refused — closed set (design §4.4). */
export type SettlementReason = 'settler-off-chain' | 'settler-unverified' | 'on-behalf-mismatch' | 'echo-off-chain'

/** Who carried the receipt to this host (design §4.1). */
export interface Settler {
  /** The caller_session of the message that carries the receipt. */
  readonly caller: string
  readonly proof: AuthProof
  /** The origin of a VERIFIED OriginClaim's card URL (claim-mismatch included), absent without one. */
  readonly claimOrigin?: string
  readonly ingress: 'wire' | 'local'
}

/** The ledger row a receipt correlates, as far as the judgement reads it. */
export interface SettlementRow {
  readonly team: string
  readonly peer: string
  readonly direction?: 'inbound' | 'outbound'
  readonly auth?: TaskAuthorization
}

/** Facts from outside the row. */
export interface SettlementFacts {
  /** This host's process label: the caller its own auto-receipts carry. */
  readonly hostLabel: string
  /** A canvas team's members (session ids and handles), undefined for any other team. */
  membersOf(team: string): readonly string[] | undefined
  /** The receipt envelope's onBehalfOf (S5), when present. */
  readonly onBehalfOf?: string
  /** The row was matched by a content echo, not a receipt header (weak evidence). */
  readonly echo?: boolean
}

export type SettlementVerdict =
  | { readonly ok: true; readonly role: ChainRole }
  | { readonly ok: false; readonly reason: SettlementReason }

const originOfUrl = (url: string): string | undefined => {
  try { return new URL(url).origin } catch { return undefined }
}

/**
 * Is this settler on the task's authorization chain? Pure. The chain:
 * - `target`: the settler IS the team the task went to (an inbound row: its
 *   record's target). Where that target lives decides how it may speak: a
 *   LOCAL row's target (an inbound row, or an outbound row delivered on this
 *   host) lives here, so it settles in-process only; a REMOTE row's target
 *   settles over the wire with an OriginClaim that covers it AND comes from
 *   the row's peer origin (a zone name alone is self-signable — review of
 *   PR #140 P1-1/P1-3);
 * - `target-member`: the team is a canvas and the settler one of its current
 *   members, under the same where-it-lives rule;
 * - `host-face`: the target's host settling on its behalf — an envelope
 *   `onBehalfOf` naming the target (a member, or for a bare zone team one of
 *   that zone's faces), carried locally by THIS host's process label, or
 *   across hosts by a verified claim from the row's peer origin;
 * - `compat`: an older host's auto-receipt (no onBehalfOf, its process label —
 *   never a session face) with a verified claim from the row's peer origin
 *   (design §6);
 * - `legacy`: an inbound row born before S2 (no record) — allowed, counted.
 * A remote target or member without a covering claim is `settler-unverified`;
 * an onBehalfOf for someone else is `on-behalf-mismatch`; anything else is
 * off-chain (`echo-off-chain` for an echo match).
 */
export function judgeSettlement(row: SettlementRow, settler: Settler, facts: SettlementFacts): SettlementVerdict {
  const inbound = row.direction === 'inbound'
  if (inbound && row.auth === undefined) return { ok: true, role: 'legacy' }
  const target = inbound ? row.auth!.target : row.team
  const members = facts.membersOf(target) ?? []
  const local = inbound || row.peer === 'local' || row.peer.startsWith('local:')
  const peerOrigin = local ? undefined : originOfUrl(row.peer)
  const fromPeerOrigin = settler.ingress === 'wire' && peerOrigin !== undefined && settler.claimOrigin === peerOrigin
  const offChain = (): SettlementVerdict => ({ ok: false, reason: facts.echo === true ? 'echo-off-chain' : 'settler-off-chain' })
  if (facts.onBehalfOf !== undefined) {
    // A bare zone team (the process face) is answered by one of that zone's session faces.
    const forTarget = facts.onBehalfOf === target || members.includes(facts.onBehalfOf) ||
      (!target.includes('/') && facts.onBehalfOf.startsWith(`${target}/`))
    // Across hosts the peer signs for ALL its sessions with one zone claim, so the
    // origin alone cannot tell its host from another session on it: the host face
    // is a process label, never a session face (review of PR #140 round 2, N1).
    const asHost = local ? settler.ingress === 'local' && settler.caller === facts.hostLabel : fromPeerOrigin && !settler.caller.includes('/')
    if (forTarget && asHost) return { ok: true, role: 'host-face' }
    if (!forTarget && asHost) return { ok: false, reason: 'on-behalf-mismatch' }
  }
  const isTarget = settler.caller === target
  const isMember = !isTarget && members.includes(settler.caller)
  if (isTarget || isMember) {
    const role: ChainRole = isTarget ? 'target' : 'target-member'
    if (local) return settler.ingress === 'local' ? { ok: true, role } : offChain()
    if (settler.ingress !== 'wire') return offChain()
    if (settler.proof !== 'origin-claim') return { ok: false, reason: 'settler-unverified' }
    return fromPeerOrigin ? { ok: true, role } : offChain()
  }
  // compat is an older HOST's own auto-receipt: its process label, never a
  // session face (another session on the peer host is not the target).
  if (facts.onBehalfOf === undefined && fromPeerOrigin && !settler.caller.includes('/')) return { ok: true, role: 'compat' }
  return offChain()
}
