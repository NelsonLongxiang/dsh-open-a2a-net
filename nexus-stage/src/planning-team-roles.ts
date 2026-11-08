/**
 * Design v5 (D6): the planning view shows which canvas is the superagent team and who plays which role in it.
 *
 * The planning view stays unaware of superagent: it hands its frame and card elements to `decorate` after each render,
 * and the 团队 poll hands the team's state to `update`. The bound canvas's frame is marked `superagent 团队`; the router's
 * card says 总工, each member's card says 成员 (and its repository). Only this host's own sessions carry a role badge.
 * @module nexus-stage/planning-team-roles
 */
import type { SaState } from './wb-superagent'

/** Who plays which role in the bound team canvas, read from the team's state. */
export interface TeamRoles {
  readonly canvas: string
  readonly router?: string
  /** Each local member's session id, with its repository when the owner named one. */
  readonly members: ReadonlyMap<string, string | undefined>
}

export function teamRolesOf(state: SaState | null): TeamRoles | undefined {
  const s = state?.settings
  if (s === undefined || s.canvas === undefined) return undefined
  return { canvas: s.canvas, ...(s.router !== undefined ? { router: s.router } : {}), members: new Map(s.members.map(id => [id, s.repos?.[id]])) }
}

/** The role badge a card shows, if any. */
export function roleText(roles: TeamRoles | undefined, id: string): string | undefined {
  if (roles === undefined) return undefined
  if (roles.router === id) return '总工'
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
  const badge = (host: Element, cls: string, text: string | undefined): void => {
    let el = host.querySelector<HTMLElement>(`:scope > .${cls}`)
    if (text === undefined) { el?.remove(); return }
    if (el === null) { el = document.createElement('span'); el.className = cls; host.appendChild(el) }
    if (el.textContent !== text) el.textContent = text
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
      const line = el.querySelector('.nm')
      if (line !== null) badge(line, 'sa-role', text)
    }
  }
  return {
    update(state) { roles = teamRolesOf(state); apply() },
    decorate(f, n) { frames = f; nodes = n; apply() },
  }
}
