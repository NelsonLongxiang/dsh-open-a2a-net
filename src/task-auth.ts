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
  if (callerSessionId !== undefined) {
    for (const name of r.canvasTeamsOf(callerSessionId)) declare(r.canvasTeamOf(name), 'canvas-shared')
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
    const targetId8 = targetTeam.startsWith(`${r.zone}/`) ? targetTeam.slice(r.zone.length + 1) : undefined
    if (targetId8 !== undefined) {
      const targetSession = r.joined().find(sessionId => r.id8(sessionId) === targetId8)
        ?? r.memberships().find(entry => r.id8(entry.session) === targetId8)?.session
      if (targetSession !== undefined) {
        targetLinks = new Set<string>()
        for (const entry of r.memberships()) {
          if (entry.session === targetSession) for (const t of entry.teams) targetLinks.add(t)
        }
        for (const name of r.canvasTeamsOf(targetSession)) targetLinks.add(r.canvasTeamOf(name))
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
      const canvasName = r.canvasNames().find(name => r.canvasTeamOf(name) === targetTeam)
      if (canvasName !== undefined) {
        targetLinks = new Set<string>([targetTeam])
        for (const memberId of r.canvasMembersOf(canvasName)) {
          for (const entry of r.memberships()) if (entry.session === memberId) for (const t of entry.teams) targetLinks.add(t)
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
