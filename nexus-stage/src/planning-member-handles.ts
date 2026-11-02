/** Pure joined-local-handle projection for remote organization members. */
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
