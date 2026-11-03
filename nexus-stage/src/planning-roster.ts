/** Roster frames use an independent layout namespace beside canvas frames. */
import type { PlanningTeam } from './planning-types'

export const ROSTER_PREFIX = 'roster:'
export const rosterNameOf = (frame: string): string | undefined => frame.startsWith(ROSTER_PREFIX) ? frame.slice(ROSTER_PREFIX.length) : undefined
export const rosterFrameName = (name: string): string => ROSTER_PREFIX + name
export const rosterFrameTitle = (frame: string): string => { const name = rosterNameOf(frame); return name === undefined ? frame : `网络队 · roster · ${name}` }
export function rosterFrames(rows: readonly { team: string; members: readonly string[] }[]): PlanningTeam[] {
  return rows.flatMap(row => {
    const slash = row.team.indexOf("/")
    if (slash < 1 || slash === row.team.length - 1 || !Array.isArray(row.members)) return []
    return [{ name: rosterFrameName(row.team.slice(slash + 1)), team: row.team, kind: 'roster' as const, members: row.members.filter(id => typeof id === "string" && id !== "").map(id => ({ id })) }]
  })
}
