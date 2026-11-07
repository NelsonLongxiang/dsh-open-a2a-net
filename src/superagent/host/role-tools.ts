/**
 * superagent design v4, PR-D: what the router and the members may call, enforced by the host.
 *
 * Upstream gives its main Session and its Executor Sessions their own agent presets (`dsh-superagent-router`,
 * `dsh-superagent-worker`) and restricts a worker to `WORK_TOOLS`. Here the router and the members are existing sessions
 * the owner named (S39: no new sessions), so a preset chosen at creation cannot carry the rule. The host carries it:
 * - a global tool guard refuses every call outside the role's list, whatever preset the session runs under, including
 *   calls from a subagent of a role session (it inherits the role);
 * - each live role session's visible tools are restricted to the same list, so its model is not offered the rest.
 *
 * The router decides only through `superagent_*`. A member keeps upstream's work tools without the ones that reach other
 * sessions (`subagent`, `send_message`, `list_agents`, `interrupt_agent`), plus `a2a_ticket_report` and `a2a_file_fetch`:
 * no `a2a_route` or `a2a_report`, so no A2A side channel exists at the tool layer either (the route seams refuse it too).
 * `run_code` is the tool runtime's transport: each call it makes is guarded on its own.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/role-tools
 */

export type Role = 'router' | 'member'

/** The router's tools: upstream orchestrator_route / _read / _reply / _ticket_request_status. */
export const ROUTER_TOOLS: readonly string[] = ['superagent_route', 'superagent_read', 'superagent_reply', 'superagent_status']

/** Upstream `WORK_TOOLS` (src/app/sessions.ts) without the tools that start, list, message or interrupt other sessions. */
export const MEMBER_WORK_TOOLS: readonly string[] = ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list',
  'job_kill', 'web_search', 'web_fetch', 'skill', 'todo_write']

/** A member's tools: its work tools, its report, and the file channel for inputs it was handed. */
export const MEMBER_TOOLS: readonly string[] = [...MEMBER_WORK_TOOLS, 'a2a_ticket_report', 'a2a_file_fetch']

/** The tool runtime's own transport (programmatic tool calling); never restricted, every inner call is guarded. */
const TRANSPORT = new Set(['run_code'])

export function roleTools(role: Role): readonly string[] {
  return role === 'router' ? ROUTER_TOOLS : MEMBER_TOOLS
}

/** Why a role session may not call a tool, or undefined when it may. */
export function roleToolRefusal(role: Role, name: string): string | undefined {
  if (TRANSPORT.has(name) || roleTools(role).includes(name)) return undefined
  return role === 'router'
    ? `[superagent-role-tools] the team router acts only through ${ROUTER_TOOLS.join(', ')}; ${name} is not one of them`
    : `[superagent-role-tools] a team member works with its work tools and reports with a2a_ticket_report; ${name} is not one of them (no sessions, subagents or A2A routes)`
}

/** The parts of an Agent the host reads: its id, its parent session (a subagent's), and its scoped tool registry. */
export interface RoleAgent {
  readonly id: unknown
  readonly session?: { readonly header?: { readonly parentSession?: unknown } }
  readonly ctx?: { readonly tools?: { get(name: string): unknown; restrict(filter: { allow: readonly string[] }): () => void } }
}

export interface RoleToolsDeps {
  /** A local session's role in the team (or the team this host serves). */
  readonly roleOf: (sessionId: string) => Role | undefined
  /** A loaded agent by session id (for a subagent's parents). */
  readonly agentOf: (sessionId: string) => RoleAgent | undefined
  readonly logger: { warn(format: string, ...args: unknown[]): void }
}

/** How far up a subagent's parents the role is looked for (upstream climbs 8). */
const PARENT_DEPTH = 8

export class RoleTools {
  /** Restrictions in force, by session id: the role they were made for and their disposer. */
  private readonly applied = new Map<string, { role: Role; dispose: () => void }>()

  constructor(private readonly d: RoleToolsDeps) {}

  /** The role an agent acts in: its own, or the nearest parent session's (a subagent inherits it). */
  roleOfAgent(agent: RoleAgent | undefined): Role | undefined {
    let current = agent
    for (let depth = 0; current !== undefined && depth <= PARENT_DEPTH; depth++) {
      const role = this.d.roleOf(String(current.id))
      if (role !== undefined) return role
      const parent = current.session?.header?.parentSession
      if (parent === undefined || parent === null) return undefined
      current = this.d.agentOf(String(parent))
    }
    return undefined
  }

  /** The global guard: a role session (or its subagent) calls only its role's tools. */
  guard(name: string, agent: RoleAgent | undefined): string | undefined {
    const role = this.roleOfAgent(agent)
    return role === undefined ? undefined : roleToolRefusal(role, name)
  }

  /**
   * Bring one live agent's visible tools in line with its role now: restrict a role session to its list, lift the
   * restriction of a session that no longer has one. Visibility only; the guard is the rule.
   */
  sync(agent: RoleAgent): void {
    const id = String(agent.id)
    const role = this.d.roleOf(id)
    const current = this.applied.get(id)
    if (current?.role === role) return
    if (current !== undefined) { this.applied.delete(id); try { current.dispose() } catch { /* the scope is gone */ } }
    const tools = agent.ctx?.tools
    if (role === undefined || tools === undefined) return
    // The registry refuses names it does not know; restrict to the role's tools this scope actually has.
    const allow = roleTools(role).filter(name => { try { return tools.get(name) !== undefined } catch { return false } })
    if (allow.length === 0) return
    try { this.applied.set(id, { role, dispose: tools.restrict({ allow }) }) } catch (error) { this.d.logger.warn('superagent: tools of %s not restricted: %s', id, String(error)) }
  }

  /** A disposed agent's restriction went with its scope. */
  forget(sessionId: string): void { this.applied.delete(sessionId) }

  /** Session ids whose visible tools are restricted now, with their role (for the state face and tests). */
  list(): Record<string, Role> { return Object.fromEntries([...this.applied].map(([id, { role }]) => [id, role])) }
}
