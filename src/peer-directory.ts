/**
 * Project a verified peer card into directory rows and identify its own
 * advertised canvas teams (#159). The card's core is signed; sessionTeams,
 * teamMemberships, and canvasOrg are unsigned, serve-fresh claims. Nothing
 * here grants admission: the caller must still apply its existing scope and
 * the receiver must still enforce OriginClaim and target-level membership.
 *
 * @module src/peer-directory
 */
import { CANVAS_MEMBER_CAP, CANVAS_NAME_MAX, CANVAS_TEAM_CAP } from './canvas-store.ts'
import type { A2aPeerCard } from './types.ts'
import type { DirectoryTeamRow } from './tools/info.ts'

type CanvasEntry = NonNullable<A2aPeerCard['canvasOrg']>[number]

/** Only this card's own valid canvas namespace may name its teams. */
export function advertisedCanvasTeams(card: A2aPeerCard): CanvasEntry[] {
  const found: CanvasEntry[] = []
  const seen = new Set<string>()
  for (const entry of (card.canvasOrg ?? []).slice(0, CANVAS_TEAM_CAP)) {
    const name = entry.name
    if (name === '' || name !== name.trim() || name.length > CANVAS_NAME_MAX || name.includes('/') || /^\d+$/.test(name)) continue
    if (entry.team !== card.team + '/canvas/' + name || entry.members.length > CANVAS_MEMBER_CAP) continue
    if (seen.has(entry.team)) continue
    seen.add(entry.team)
    found.push(entry)
  }
  return found
}

/** A nested zone may itself end in /canvas; preserve its own session alias. */
function sessionAliasAllowed(card: A2aPeerCard, team: string): boolean {
  if (!/^.+\/canvas\/[^/]+$/.test(team)) return true
  const prefix = card.team + '/'
  const suffix = team.startsWith(prefix) ? team.slice(prefix.length) : ''
  return suffix !== '' && !suffix.includes('/')
}

/** Match a session claim without treating another zone's canvas as a session. */
export function sessionCandidateMatches(card: A2aPeerCard, team: string): boolean {
  return sessionAliasAllowed(card, team) && (card.sessionTeams ?? []).some(entry => entry.team === team)
}

/** A member the publisher also serves as its own session is not ours. */
function peerPublishesSession(card: A2aPeerCard, handle: string): boolean {
  return (card.sessionTeams ?? []).some(entry => entry.team === handle)
}

/** Match a scoped caller to this peer's canvas before sending the payload. */
export function canvasCandidateMatches(
  card: A2aPeerCard,
  team: string,
  caller?: { id: string; handle: string },
  resolveLocal?: (ref: string) => string | undefined,
): boolean {
  if (caller !== undefined && (resolveLocal?.(caller.handle) !== caller.id || peerPublishesSession(card, caller.handle))) return false
  return advertisedCanvasTeams(card).some(entry => entry.team === team && (caller === undefined || entry.members.includes(caller.handle)))
}

/** A naked team string is unsafe when both a canvas and another face claim it. */
export function canvasTargetAmbiguous(
  cards: readonly (A2aPeerCard | undefined)[],
  team: string,
  caller: { id: string; handle: string } | undefined,
  resolveLocal: ((ref: string) => string | undefined) | undefined,
  hasDelegation: boolean,
): boolean {
  const owners = cards.filter((card): card is A2aPeerCard => card !== undefined && advertisedCanvasTeams(card).some(entry => entry.team === team))
  if (owners.length === 0) return false
  if (caller !== undefined) {
    if (resolveLocal?.(caller.handle) !== caller.id) return true
    const ownerCollision = owners.some(card => peerPublishesSession(card, caller.handle)
      && advertisedCanvasTeams(card).some(entry => entry.team === team && entry.members.includes(caller.handle)))
    if (ownerCollision) return true
  }
  // Distinct signed publishers with the same qualified group name cannot be
  // selected by the team-only API. URL aliases of one signed card are one.
  const eligible = owners.filter(card => canvasCandidateMatches(card, team, caller, resolveLocal))
  const identities = new Set(eligible.map(card => JSON.stringify([card.publicKey, card.session])))
  return identities.size > 1 || hasDelegation || cards.some(card => card !== undefined && (card.team === team || sessionCandidateMatches(card, team)))
}

/**
 * Existing peer rows plus optional canvas rows for the model-tool directory.
 * The GUI's remote-node rows call with includeCanvas=false, so a group is
 * never rendered as an extra session node. Membership is carried only as an
 * internal scope hint and stripped before the tool's public result.
 */
export function peerDirectoryRows(card: A2aPeerCard, peer: string, includeCanvas: boolean): DirectoryTeamRow[] {
  // The origin fields (publisher session label + LAN IP) are natural
  // grouping dimensions: a fleet's rows cluster by the host that owns
  // them, no manual grouping required.
  const origin = card.lanIp !== undefined ? card.session + ' (' + card.lanIp + ')' : card.session
  // via = the peer URL the card was fetched from: the panel shows which
  // host:port each remote row came from, so an unknown node is traceable
  // to its publishing endpoint at a glance.
  // legacy: the publisher's card carries no roster capability — a
  // pre-roster node (0.5.43-). Rows from it are marked so the fleet
  // audit (and the phase-2 teamed-only default flip) knows which peers
  // never grow the roster face.
  const legacy = (card.capabilities as { roster?: unknown } | undefined)?.roster !== true
  const rows: DirectoryTeamRow[] = [
    { team: card.team, session: card.session, name: card.name, description: '', origin, via: peer, ...(legacy ? { legacy } : {}) },
  ]
  // Roster reader half: the card's unsigned teamMemberships map each
  // published session team to its declared roster teams, so a remote
  // node's teamed/teamless state is visible without visiting its host.
  const rosterOf = new Map<string, string[]>()
  for (const membership of card.teamMemberships ?? []) {
    const list = rosterOf.get(membership.node) ?? []
    list.push(membership.team)
    rosterOf.set(membership.node, list)
  }
  for (const entry of card.sessionTeams ?? []) {
    // A foreign canvas-shaped claim cannot masquerade as a session. A valid
    // own-zone session stays visible even if its zone ends in /canvas.
    if (!sessionAliasAllowed(card, entry.team)) continue
    const declared = rosterOf.get(entry.team)
    rows.push({ team: entry.team, session: card.session, name: entry.name, description: entry.description, origin, via: peer, ...(entry.workspace !== undefined ? { workspace: entry.workspace } : {}), ...(legacy ? { legacy } : {}), ...(declared !== undefined && declared.length > 0 ? { teams: declared } : {}) })
  }
  const publishedSessions = new Set((card.sessionTeams ?? []).map(entry => entry.team))
  if (includeCanvas) for (const entry of advertisedCanvasTeams(card)) {
    const declared = rosterOf.get(entry.team)
    rows.push({ team: entry.team, session: card.session, name: entry.name, description: 'canvas team', origin, via: peer, ...(legacy ? { legacy } : {}), ...(declared !== undefined && declared.length > 0 ? { teams: declared } : {}), canvasMembers: entry.members.filter(ref => !publishedSessions.has(ref)) })
  }
  return rows
}

/**
 * Whether one caller label can receive network traffic back. Composite
 * `<zone>/<id>` shapes route anywhere (N1); bare zone names resolve to a
 * live initiator per host, so cross-host they would steer whichever node
 * shares the name — treated as unroutable everywhere.
 */
export function routableCallerLabel(callerSession: string | undefined): boolean {
  return callerSession !== undefined &&
    (/[a-z0-9-]+\/[0-9a-f]{8}$/i.test(callerSession) || /[a-z0-9-]+\/[a-z0-9]{4,}$/i.test(callerSession))
}

/**
 * Why an async route from such a caller cannot expect its receipt: the
 * autosend arm skips it and the steered hint is omitted, so the debt has
 * no paying path — say so at dispatch time instead of silently stranding
 * a pending row.
 */
export function unroutableCallerNote(label: string): string {
  return `\n(Note: caller label "${label}" is not network-routable, so the target cannot auto-send a receipt back to you — reconcile via context_id follow-ups instead.)`
}
