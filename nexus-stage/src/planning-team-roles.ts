/**
 * Design v5 (D6): the planning view shows which canvas is the superagent team and who plays which role in it.
 *
 * The planning view stays unaware of superagent: it hands its frame and card elements to `decorate` after each render,
 * and the 团队 poll hands the team's state to `update`. The bound canvas's frame is marked `superagent 团队`; the router's
 * card says 总工, each member's card says 成员 (and its repository), a member on another host adding （远端）.
 * The role has a line of its own between the name and the description, so neither crowds the other out of the 172px card.
 * @module nexus-stage/planning-team-roles
 */
import type { SaState } from './wb-superagent'

/** Who plays which role in the bound team canvas, read from the team's state. */
export interface TeamRoles {
  readonly canvas: string
  readonly router?: string
  /** Each local member's session id, with its repository when the owner named one. */
  readonly members: ReadonlyMap<string, string | undefined>
  /** Each remote member by its planning card id, with its repository when the owner named one. */
  readonly remote: ReadonlyMap<string, string | undefined>
}

/** The planning card id of a remote member ref (see planning-member-handles). */
const remoteCardId = (ref: string): string => `member-${ref.replace(/[^a-z0-9-]/gi, '-')}`

export function teamRolesOf(state: SaState | null): TeamRoles | undefined {
  const s = state?.settings
  if (s === undefined || s.canvas === undefined) return undefined
  return { canvas: s.canvas, ...(s.router !== undefined ? { router: s.router } : {}), members: new Map(s.members.map(id => [id, s.repos?.[id]])), remote: new Map(s.remoteMembers.map(r => [remoteCardId(r.ref), s.repos?.[r.ref]])) }
}

/** What the badge shows of a role: the repository without its owner. The tooltip has it whole. */
export const roleLabel = (text: string): string => text.replace(/ · [^/（]+\//, ' · ')

/** The role badge a card shows, if any. */
export function roleText(roles: TeamRoles | undefined, id: string): string | undefined {
  if (roles === undefined) return undefined
  if (roles.router === id) return '总工'
  if (roles.remote.has(id)) { const repo = roles.remote.get(id); return repo !== undefined ? `成员 · ${repo}（远端）` : '成员（远端）' }
  if (!roles.members.has(id)) return undefined
  const repo = roles.members.get(id)
  return repo !== undefined ? `成员 · ${repo}` : '成员'
}

export interface TeamRoleDecorator {
  /** The team's latest state (null: this host runs no team). */
  update(state: SaState | null): void
  /** The planning view rendered: mark its frames and cards. */
  decorate(frames: ReadonlyMap<string, HTMLElement>, nodes: ReadonlyMap<string, HTMLElement>): void
}

export function createTeamRoleDecorator(): TeamRoleDecorator {
  let roles: TeamRoles | undefined
  let frames: ReadonlyMap<string, HTMLElement> | undefined
  let nodes: ReadonlyMap<string, HTMLElement> | undefined
  const badge = (host: Element, cls: string, text: string | undefined, tip?: string): void => {
    let el = host.querySelector<HTMLElement>(`:scope > .${cls}`)
    if (text === undefined) { el?.remove(); return }
    if (el === null) { el = document.createElement('span'); el.className = cls; host.appendChild(el) }
    if (el.textContent !== text) el.textContent = text
    if (tip !== undefined && el.title !== tip) el.title = tip
  }
  const apply = (): void => {
    for (const [name, el] of frames ?? []) {
      const team = roles?.canvas === name
      el.classList.toggle('is-superagent-team', team)
      const head = el.querySelector('.p-frame-head')
      if (head !== null) badge(head, 'sa-team', team ? 'superagent 团队' : undefined)
    }
    for (const [id, el] of nodes ?? []) {
      const text = roleText(roles, id)
      el.classList.toggle('is-superagent-router', text === '总工')
      el.classList.toggle('is-superagent-member', text?.startsWith('成员') === true)
      badge(el, 'sa-role', text === undefined ? undefined : roleLabel(text), text)
    }
  }
  return {
    update(state) { roles = teamRolesOf(state); apply() },
    decorate(f, n) { frames = f; nodes = n; apply() },
  }
}
