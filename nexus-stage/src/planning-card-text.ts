/**
 * Board card text (review 2026-10-27): what a card's title, second line and
 * tooltip say. Extracted from planning-view so the card rules read in one
 * place (and the view stays under its M1 module-size cap).
 *
 * - Session cards used to read `dsh/11111111 · scout-01` on the second line:
 *   the title repeated, the handle truncated on every card. The line now
 *   carries what the session is FOR (its description) and falls back to the
 *   handle; the handle always rides the tooltip.
 * - Peer cards titled `192.168.3.157:13080`, clipped by the peer badge with no
 *   break point. When the host publishes exactly one named team (its host
 *   row), that name is the title and the address moves to the second line.
 * @module nexus-stage/planning-card-text
 */
import { displayName } from './stage-name'
import type { RemoteTeamRow } from './federation'
import type { WorldNode } from './world'

export interface CardText { readonly title: string; readonly sub: string; readonly tip: string }

/** The remote-team summary a peer card carries: score + count + first names. */
function remoteSummary(rows: ReadonlyArray<RemoteTeamRow>, score: number | undefined): string {
  const names = rows.map(r => r.name !== undefined && r.name !== '' ? r.name : r.team)
  const head = names.slice(0, 2).join('、')
  const more = names.length > 2 ? ` +${names.length - 2}` : ''
  return (score !== undefined ? `score ${score} · ` : '') + `${rows.length} 远端团队` + (head !== '' ? `：${head}${more}` : '')
}

export function cardText(n: WorldNode, remoteRows: ReadonlyArray<RemoteTeamRow>, score: number | undefined): CardText {
  // gh#38: member cards show their display NAME as the title (the whole
  // point is picking a person).
  if (n.id.startsWith('member-')) {
    const title = n.name !== undefined && n.name !== '' ? n.name : n.team
    return { title, sub: n.team, tip: n.team }
  }
  if (n.remote === true) {
    const host = n.id.slice('peer-'.length)
    const named = remoteRows.length === 1 && remoteRows[0]!.name !== undefined && remoteRows[0]!.name !== '' ? remoteRows[0]!.name : undefined
    const summary = remoteSummary(remoteRows, score)
    return named !== undefined
      ? { title: named, sub: `${host} · ${summary}`, tip: `${named}\n${host}\n${summary}` }
      : { title: host, sub: summary, tip: `${host}\n${summary}` }
  }
  const title = displayName(n)
  const handle = n.team + (n.name !== undefined && n.name !== '' ? ' · ' + n.name : '')
  const desc = n.description?.trim() ?? ''
  // When the title fell back to the team label the handle would repeat it
  // verbatim; then only the suffixes remain.
  const base = desc !== '' ? desc : handle === title ? '' : n.team
  const suffix = (n.memberships.length > 1 ? ` · 跨队×${n.memberships.length}` : '')
    + (n.teams !== undefined && n.teams.length > 0 ? ` · 网络队×${n.teams.length}` : '')
  return { title, sub: base + suffix, tip: desc !== '' ? `${handle}\n${desc}` : handle }
}
