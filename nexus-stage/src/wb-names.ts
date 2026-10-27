/**
 * Readable names for routing team ids, shared by the activity and plan
 * panes and the 台账 tab (review 2026-10-27: rows read bare `dsh/1111…` ids;
 * the ledger kept doing so after #72 fixed the other two panes).
 * Names are attacker-shaped data: textContent only.
 * @module nexus-stage/wb-names
 */
import type { StateBody } from './workbench'
import { displayName } from './stage-name'

/** The name behind a team id — a session, a remote node or a canvas team —
 *  or undefined when none matches. An empty name counts as no match:
 *  displayName's `??` keeps '', and a peer can publish one. `remote` marks a
 *  name the PEER chose — it can collide with a local session's, so callers
 *  must show where it is from. */
export function teamName(state: StateBody, team: string): { name: string; remote: boolean } | undefined {
  const named = (name: string | undefined, remote: boolean) => name !== undefined && name.trim() !== '' ? { name, remote } : undefined
  const s = (state.sessions ?? []).find(r => r.team === team)
  if (s !== undefined) return named(displayName(s), false)
  const r = (state.remote ?? []).find(x => x.team === team)
  if (r !== undefined) return named(displayName(r), true)
  return named((state.canvas?.teams ?? []).find(t => t.team === team)?.name, false)
}

/** A name for plain text: a peer-published one says it is remote. */
export function teamLabel(state: StateBody, team: string): string {
  const n = teamName(state, team)
  return n === undefined ? team : n.remote ? `${n.name}（远端）` : n.name
}

/** Fill `target` with `prefix` + the name (the id rides the tooltip; an
 *  unknown team stays its id); a peer-published name gets a visible 远端 chip. */
export function nameInto(target: HTMLElement, state: StateBody, team: string, prefix = ''): void {
  const n = teamName(state, team)
  target.textContent = `${prefix}${n?.name ?? team}`
  target.title = team
  if (n?.remote === true) {
    const chip = target.appendChild(document.createElement('span'))
    chip.className = 'wb-row-remote'
    chip.textContent = '远端'
    chip.title = '名字由对端自行发布'
  }
}
