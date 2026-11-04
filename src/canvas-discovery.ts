/** Read-only canvas ownership projection; never authorizes or selects a dispatch candidate. */
import { advertisedCanvasTeams } from './peer-directory.ts'
import type { A2aPeerCard } from './types.ts'
export interface CanvasOwner { team: string; name: string; owner: string; memberCount: number; local: boolean; members: readonly string[]; scopeMembers?: readonly string[] }
export function canvasOwners(local: readonly { name: string; team: string; members: readonly string[] }[], ownUrl: string, peers: readonly { url: string; card: A2aPeerCard }[]): CanvasOwner[] {
  const rows: CanvasOwner[] = local.map(row => ({ ...row, owner: ownUrl, memberCount: row.members.length, local: true }))
  const seen = new Set<string>()
  for (const { url, card } of peers) for (const entry of card.expiresAt > Date.now() ? advertisedCanvasTeams(card) : []) {
    const key = JSON.stringify([card.publicKey, card.session, entry.team])
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ team: entry.team, name: entry.name, owner: url, memberCount: entry.members.length, local: false, members: entry.members, scopeMembers: entry.members.filter(ref => !(card.sessionTeams ?? []).some(session => session.team === ref)) })
  }
  return rows
}
export function canvasMemberships(owners: readonly CanvasOwner[], handle: string, localId?: string, resolveLocal?: (ref: string) => string | undefined): Omit<CanvasOwner, 'members' | 'scopeMembers'>[] {
  return owners.filter(row => ((row.scopeMembers ?? row.members).includes(handle) && (row.local || resolveLocal === undefined || resolveLocal(handle) === localId)) || (row.local && localId !== undefined && row.members.includes(localId))).map(({ members: _members, scopeMembers: _scopeMembers, ...row }) => row)
}
export function canvasFailure(team: string, owners: readonly CanvasOwner[], reason: string): string {
  if (!new RegExp('^.+/canvas/[^/]+$').test(team)) return reason
  const matches = owners.filter(row => row.team === team)
  if (matches.length === 0) return reason + ' — canvas-not-found: no matching team in the currently visible verified canvas directory (may be absent or outside your information scope; not proof of fleet-wide absence)'
  const list = matches.map(row => row.owner + ' (' + row.team + ', members=' + row.memberCount + ')').join('; ')
  if (matches.length > 1) return reason + ' — canvas-multiple-owners: ' + list + ' — use an unambiguous operator-established team; do not guess a host'
  return reason + ' — canvas-owner: ' + list + ' — existing refusal/prerequisite above still applies; an owner URL is discovery, not a direct-connect requirement or permission to bypass home'
}
