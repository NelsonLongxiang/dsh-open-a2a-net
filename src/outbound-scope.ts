/** One sender scope gate shared by model routing and home-host CLI forwarding. */
export interface OutboundScopeRecords {
  readonly zone: string
  teamsOf(id: string): readonly string[]
  membersOf(team: string): readonly string[]
  id8(id: string): string
  canvasNames(): readonly string[]
  canvasMembers(name: string): readonly string[]
  canvasTeam(name: string): string
  memberHandle?(ref: string): string
  peerOrgs(): Iterable<readonly { team?: unknown; members?: unknown; superagentTeam?: unknown }[]>
  warmPeers(): Promise<unknown>
}
export async function outboundScope(r: OutboundScopeRecords, id: string, handle: string, team: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const teams = r.teamsOf(id)
  const sharedRoster = teams.some(roster => r.membersOf(roster).some(member => r.zone + '/' + r.id8(member) === team))
  const sharedCanvas = r.canvasNames().some(name => {
    const raw = r.canvasMembers(name)
    const members = raw.map(ref => r.memberHandle?.(ref) ?? ref)
    const targetHeld = team.includes('@') ? raw.includes(team) : members.includes(team)
    return (members.includes(id) || members.includes(handle)) && (targetHeld || r.canvasTeam(name) === team)
  })
  if (team.includes('/canvas/') && !sharedCanvas && !teams.includes(team)) await r.warmPeers()
  let orgShared = false
  // Design v5 (v5-B2): a peer's superagent team canvas, named bare or with its owner's fingerprint.
  let openTeam = false
  const bareTarget = team.replace(/@[0-9a-f]{8}$/, '')
  for (const org of r.peerOrgs()) for (const row of org) {
    if (typeof row.team !== 'string' || row.team === '' || !Array.isArray(row.members)) continue
    if (row.superagentTeam === true && row.team === bareTarget) openTeam = true
    if ((row.members.includes(id) || row.members.includes(handle)) && (row.members.includes(team) || row.team === team)) { orgShared = true; break }
  }
  // A session that declares a team — a roster team or any canvas seat — may request a peer's superagent team; a
  // teamless one still has no network (S3).
  const declared = teams.length > 0 || r.canvasNames().some(name => r.canvasMembers(name).some(ref => ref === id || ref === handle || r.memberHandle?.(ref) === handle))
  if (openTeam && declared) return { ok: true }
  if (teams.length === 0 && !sharedRoster && !sharedCanvas && !orgShared) return { ok: false, error: `team-scoped routing is on and this session (${r.id8(id)}) has declared no team membership — a teamless node has no network. Declare one with a2a_team_join (subject to the owner's teamJoinAllowlist)` }
  if (!teams.includes(team) && !sharedRoster && !sharedCanvas && !orgShared) return { ok: false, error: `team-scoped routing is on: routing to "${team}" requires declared membership. This session's teams: ${teams.join(', ')}. a2a_team_join can declare it (subject to the owner's teamJoinAllowlist)` }
  return { ok: true }
}
