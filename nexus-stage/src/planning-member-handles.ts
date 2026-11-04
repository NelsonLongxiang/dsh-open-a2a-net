/** Pure membership projections: joined-local handles for remote organization members, canvas team indexes, mirror-frame members. */
import type { RemoteTeamRow } from './federation'
import type { SessionLite } from './world'

type HandleSession = Pick<SessionLite, 'id' | 'team' | 'joined'>

/** Map only unique joined id8 handles that no remote directory row already owns. */
export function joinedLocalIdsByHandle(sessions: ReadonlyArray<HandleSession>, publishedHandles: ReadonlySet<string>): Map<string, string> {
  const localIds = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const session of sessions) {
    if (session.joined !== true) continue
    const slash = session.team.lastIndexOf('/')
    if (slash <= 0 || session.team.slice(slash + 1) !== session.id.replace(/^session-/, '').slice(0, 8)) continue
    const handle = session.team
    if (publishedHandles.has(handle) || ambiguous.has(handle)) continue
    if (localIds.has(handle)) {
      localIds.delete(handle)
      ambiguous.add(handle)
    } else {
      localIds.set(handle, session.id)
    }
  }
  return localIds
}

/** Project a remote canvas member to its local card or stable synthetic card id. */
export function remoteMemberBoardId(member: string, localIdsByHandle: ReadonlyMap<string, string>, remoteTeams: ReadonlyArray<RemoteTeamRow> | undefined, peerUrl: string): string {
  const localId = localIdsByHandle.get(member)
  if (localId !== undefined) return localId
  if (member.includes('/')) return `member-${member.replace(/[^a-z0-9-]/gi, '-')}`
  const peerZone = remoteTeams?.find(row => row.via === peerUrl)?.team.split('/')[0] ?? 'dsh'
  return `member-${peerZone}-${member.replace(/^session-/, '').slice(0, 8)}`
}

/** Each member id → the canvas teams it sits in, with its position in that team's member order. */
export function membershipIndex(teams: ReadonlyArray<{ name: string; members: ReadonlyArray<{ id: string }> }>): Map<string, Array<{ team: string; index: number }>> {
  const memberships = new Map<string, Array<{ team: string; index: number }>>()
  for (const team of teams) {
    for (let i = 0; i < team.members.length; i++) {
      const id = team.members[i]!.id
      const list = memberships.get(id) ?? []
      list.push({ team: team.name, index: i })
      memberships.set(id, list)
    }
  }
  return memberships
}

/** Local joined sessions that sit in a peer's org team (a mirror frame): they are teamed even with no local team. */
export function mirrorMemberIds(peerOrg: ReadonlyArray<{ org: ReadonlyArray<{ members: readonly string[] }> }>, sessions: ReadonlyArray<HandleSession>, remoteTeams: ReadonlyArray<RemoteTeamRow> | undefined): Set<string> {
  const byHandle = joinedLocalIdsByHandle(sessions, new Set((remoteTeams ?? []).map(session => session.team)))
  const ids = new Set<string>()
  for (const row of peerOrg) {
    for (const team of row.org) for (const member of team.members) {
      const id = byHandle.get(member)
      if (id !== undefined) ids.add(id)
    }
  }
  return ids
}
