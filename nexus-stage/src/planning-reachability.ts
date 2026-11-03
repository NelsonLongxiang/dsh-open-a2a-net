/** Project the peer's last missed card read onto existing remote cards and frames. */
import { peerHostOf, type RemoteTeamRow } from './federation'

export const UNREACHABLE_HINT = '对端未应答（显示的是最后已知状态）'

export function unreachableRefs(input: {
  remoteTeams?: ReadonlyArray<RemoteTeamRow>
  peerOrg?: ReadonlyArray<{ url: string; unreachable?: boolean }>
}): { hosts: ReadonlySet<string>; members: ReadonlySet<string> } {
  const hosts = new Set<string>()
  for (const row of input.remoteTeams ?? []) if (row.unreachable === true && row.via) hosts.add(peerHostOf(row.via))
  for (const row of input.peerOrg ?? []) if (row.unreachable === true) hosts.add(peerHostOf(row.url))
  const members = new Set<string>()
  for (const row of input.remoteTeams ?? []) if (row.via && hosts.has(peerHostOf(row.via))) members.add(`member-${row.team.replace(/[^a-z0-9-]/gi, '-')}`)
  return { hosts, members }
}

/** A mirror keeps its last known contents visible but warns until its owner responds again. */
export function showFrameReachability(frame: HTMLElement, lost: boolean): void {
  frame.classList.toggle('is-unreachable', lost)
  const existing = frame.querySelector('.p-frame-unreachable')
  if (lost && existing === null) {
    const hint = document.createElement('span')
    hint.className = 'p-frame-unreachable'
    hint.textContent = UNREACHABLE_HINT
    frame.appendChild(hint)
  } else if (!lost) existing?.remove()
}
