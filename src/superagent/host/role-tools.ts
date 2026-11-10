/**
 * superagent design v4, PR-D: what the router and the members may call, enforced by the host.
 *
 * Upstream gives its main Session and its Executor Sessions their own agent presets (`dsh-superagent-router`,
 * `dsh-superagent-worker`) and restricts a worker to `WORK_TOOLS`. Here the router and the members are existing sessions
 * the owner named (S39: no new sessions), so a preset chosen at creation cannot carry the rule. The host carries it:
 * - a global tool guard refuses every call outside the role's list, whatever preset the session runs under, including
 *   calls from a subagent of a role session (it inherits the role);
 * - each live role session's visible tools are restricted to the same list, so its model is not offered the rest.
 * - every other session is not offered the team's tools at all: the engine is on by default, and a session outside a team
 *   has no use for them.
 *
 * The router decides only through `superagent_*`. A member keeps upstream's work tools without the ones that reach other
 * sessions (`subagent`, `send_message`, `list_agents`, `interrupt_agent`), plus `a2a_ticket_report` and `a2a_file_fetch`:
 * no `a2a_route` or `a2a_report`, so no A2A side channel exists at the tool layer either (the route seams refuse it too).
 * `run_code` is the tool runtime's transport: each call it makes is guarded on its own.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/role-tools
 */

export type Role = 'router' | 'member' | 'observer'

/** The router's tools: upstream orchestrator_route / _read / _reply / _ticket_request_status. */
/**
 * The agent presets a team's sessions run under (shipped in this package's bundle layer, cordis.patch.yml): the router's
 * composition is read-only routing, a member's is the work tools; the persona carries the role. The host refuses a router
 * or member on any other preset, so the role's boundary is the composition, not instructions in cards.
 */
export const ROUTER_PRESET = 'superagent-router'
export const MEMBER_PRESET = 'superagent-member'
/** A member who may also open tickets (design D15): the preset is what makes a session one. */
export const OBSERVER_PRESET = 'superagent-observer'

/**
 * DSH's schedule tools, for each role's own session (owner 2026-11-10): reminders and follow-ups it keeps for itself. A target
 * other than `this_session` would open new sessions outside the team, so the guard refuses it.
 */
export const SCHEDULE_TOOLS: readonly string[] = ['schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view']

/** Read-only and about the session itself: which identity and team it is (owner 2026-11-10). */
export const SELF_TOOLS: readonly string[] = ['a2a_whoami']

export const ROUTER_TOOLS: readonly string[] = [...SCHEDULE_TOOLS, ...SELF_TOOLS, 'superagent_route', 'superagent_read', 'superagent_reply', 'superagent_status', 'superagent_note', 'superagent_request', 'superagent_assign', 'superagent_rules_propose', 'superagent_rules_apply', 'superagent_decision_propose']

/** Upstream `WORK_TOOLS` (src/app/sessions.ts) without the tools that start, list, message or interrupt other sessions. */
export const MEMBER_WORK_TOOLS: readonly string[] = ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list',
  'job_kill', 'web_search', 'web_fetch', 'skill', 'todo_write']

/** A member's tools: its work tools, its report, and the file channel for inputs it was handed. */
export const MEMBER_TOOLS: readonly string[] = [...MEMBER_WORK_TOOLS, ...SCHEDULE_TOOLS, ...SELF_TOOLS, 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_file_fetch']

/** An observer's tools: a member's, and opening a ticket (design D15). */
export const OBSERVER_TOOLS: readonly string[] = [...MEMBER_TOOLS, 'a2a_ticket_request', 'a2a_decision_propose']

/** The tools only a team's sessions have: a session with no role is not offered them. */
export const TEAM_TOOLS: readonly string[] = [...ROUTER_TOOLS.filter(name => !SCHEDULE_TOOLS.includes(name) && !SELF_TOOLS.includes(name)), 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_ticket_request', 'a2a_decision_propose']

/** The tool runtime's own transport (programmatic tool calling); never restricted, every inner call is guarded. */
const TRANSPORT = new Set(['run_code'])

export function roleTools(role: Role): readonly string[] {
  return role === 'router' ? ROUTER_TOOLS : role === 'observer' ? OBSERVER_TOOLS : MEMBER_TOOLS
}

/** Why a schedule call would reach beyond the calling session, or undefined when it stays in it. */
export function scheduleTargetRefusal(name: string, args: unknown): string | undefined {
  if (name !== 'schedule_create' && name !== 'schedule_edit') return undefined
  const target = args !== null && typeof args === 'object' ? (args as { target?: unknown }).target : undefined
  // An edit without a target keeps the one the task has, which a team session could only have made this_session.
  if (name === 'schedule_edit' && target === undefined) return undefined
  return target === 'this_session' ? undefined : `[superagent-role-tools] a team session schedules only for itself: target must be this_session, not ${String(target)} (a new session would sit outside the team)`
}

/** Why a role session may not call a tool, or undefined when it may. */
export function roleToolRefusal(role: Role, name: string, args?: unknown): string | undefined {
  if (TRANSPORT.has(name)) return undefined
  if (roleTools(role).includes(name)) return scheduleTargetRefusal(name, args)
  return role === 'router'
    ? `[superagent-role-tools] the team router acts only through ${ROUTER_TOOLS.join(', ')}; ${name} is not one of them`
    : `[superagent-role-tools] a team member works with its work tools and reports with a2a_ticket_report; ${name} is not one of them (no sessions, subagents or A2A routes)`
}

/** The parts of an Agent the host reads: its id, its parent session (a subagent's), and its scoped tool registry. */
export interface RoleAgent {
  readonly id: unknown
  readonly session?: { readonly header?: { readonly parentSession?: unknown } }
  readonly ctx?: { readonly tools?: { get(name: string, scope?: object): unknown; restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void } }
}

/**
 * The agent's scope key (what `scopeOf(agent.ctx)` returns in DSH): the tool registry's view for that scope includes the
 * tools its preset contributes from an ancestor scope, which the global view does not. The key sits on the context under
 * dsh-scope's `Symbol("dsh.scope")`, possibly up the context's prototype chain (cordis `extend`). It is read by its
 * description because the plugin's own copy of dsh-scope would hold another symbol and another parent map.
 */
export function scopeKeyOf(ctx: unknown): object | undefined {
  for (let cursor = ctx, depth = 0; cursor !== null && typeof cursor === 'object' && depth < 32; cursor = Object.getPrototypeOf(cursor), depth++) {
    for (const symbol of Object.getOwnPropertySymbols(cursor)) {
      if (symbol.description !== 'dsh.scope') continue
      const key = (cursor as Record<symbol, unknown>)[symbol]
      if (key !== null && typeof key === 'object') return key
    }
  }
  return undefined
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
  private readonly applied = new Map<string, { role: Role | undefined; dispose: () => void }>()

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
  guard(name: string, agent: RoleAgent | undefined, args?: unknown): string | undefined {
    const role = this.roleOfAgent(agent)
    return role === undefined ? undefined : roleToolRefusal(role, name, args)
  }

  /**
   * Bring one live agent's visible tools in line with its role now: restrict a role session to its list, and keep the
   * team's tools from a session with no role. Visibility only; the guard is the rule.
   */
  sync(agent: RoleAgent): void {
    const id = String(agent.id)
    const role = this.d.roleOf(id)
    const current = this.applied.get(id)
    if (current !== undefined && current.role === role) return
    if (current !== undefined) { this.applied.delete(id); try { current.dispose() } catch { /* the scope is gone */ } }
    // Runs for every session now, in `agent/created`: a context that has not injected the tools service throws on the read.
    let tools: NonNullable<RoleAgent['ctx']>['tools']
    try { tools = agent.ctx?.tools } catch { return }
    if (tools === undefined) return
    if (role === undefined) { this.hideTeamTools(id, agent, tools); return }
    // The registry refuses names it does not know, so restrict to the role's tools this agent can see — through its own
    // scope, which includes its preset's tools (bash, read, edit…). The global view misses them, and restricting to it
    // would hide a member's work tools. Without the scope key, visibility stays as it is: the guard is the rule.
    const scope = scopeKeyOf(agent.ctx)
    if (scope === undefined) { this.d.logger.warn('superagent: no tool scope for %s; its tools are guarded, not hidden', id); return }
    const allow = roleTools(role).filter(name => { try { return tools.get(name, scope) !== undefined } catch { return false } })
    if (allow.length === 0) return
    try { this.applied.set(id, { role, dispose: tools.restrict({ allow }) }) } catch (error) { this.d.logger.warn('superagent: tools of %s not restricted: %s', id, String(error)) }
  }

  /** A session with no role: the names its scope has of the team's tools come off its list. */
  private hideTeamTools(id: string, agent: RoleAgent, tools: NonNullable<NonNullable<RoleAgent['ctx']>['tools']>): void {
    const scope = scopeKeyOf(agent.ctx)
    if (scope === undefined) return
    const deny = TEAM_TOOLS.filter(name => { try { return tools.get(name, scope) !== undefined } catch { return false } })
    if (deny.length === 0) return
    try { this.applied.set(id, { role: undefined, dispose: tools.restrict({ deny }) }) } catch (error) { this.d.logger.warn('superagent: team tools of %s not hidden: %s', id, String(error)) }
  }

  /** A disposed agent's restriction went with its scope. */
  forget(sessionId: string): void { this.applied.delete(sessionId) }

  /** Session ids whose visible tools are restricted now, with their role (for the state face and tests). */
  list(): Record<string, Role> { return Object.fromEntries([...this.applied].flatMap(([id, { role }]) => role === undefined ? [] : [[id, role]])) }
}
