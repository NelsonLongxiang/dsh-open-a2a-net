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
 * other than `this_session` would open new sessions outside the team, so the guard refuses it. Two generations of the tool are
 * in use: DSH 0.2.2 has create/edit/list/view and a required `target`; DSH 0.2.1 has create/list/update/delete, no `target`
 * at all, and binds every task to the calling session (a 0.2.1 host, 2026-11-11). Both sets are listed; a session sees the
 * ones its DSH registers.
 */
export const SCHEDULE_TOOLS: readonly string[] = ['schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view', 'schedule_update', 'schedule_delete']

/** Read-only and about the session itself: which identity and team it is (owner 2026-11-10). */
export const SELF_TOOLS: readonly string[] = ['a2a_whoami']

/**
 * ygl-trees, the team's memory, through its MCP server (the presets mount it as `ygl`; the server runs outside the session's
 * sandbox, which keeps the CLI from opening the shared workspace). Its MCP face has no delete or admin action. The router
 * only reads; members and observers read, write, verify and check health (owner 2026-11-10).
 */
export const YGL_READ_TOOLS: readonly string[] = ['mcp__ygl__read']
export const YGL_WORK_TOOLS: readonly string[] = [...YGL_READ_TOOLS, 'mcp__ygl__write', 'mcp__ygl__verify', 'mcp__ygl__doctor']

export const ROUTER_TOOLS: readonly string[] = [...SCHEDULE_TOOLS, ...SELF_TOOLS, ...YGL_READ_TOOLS, 'a2a_tool_request', 'a2a_outbound_request', 'superagent_route', 'superagent_split', 'superagent_read', 'superagent_reply', 'superagent_status', 'superagent_note', 'superagent_request', 'superagent_assign', 'superagent_rules_propose', 'superagent_rules_apply', 'superagent_decision_propose']

/** Upstream `WORK_TOOLS` (src/app/sessions.ts) without the tools that start, list, message or interrupt other sessions. */
export const MEMBER_WORK_TOOLS: readonly string[] = ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list',
  'job_kill', 'web_search', 'web_fetch', 'skill', 'todo_write']

/** A member's tools: its work tools, its report, and the file channel for inputs it was handed. */
export const MEMBER_TOOLS: readonly string[] = [...MEMBER_WORK_TOOLS, ...SCHEDULE_TOOLS, ...SELF_TOOLS, ...YGL_WORK_TOOLS, 'a2a_tool_request', 'a2a_outbound_request', 'a2a_decision_decide', 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_file_fetch']

/** An observer's tools: a member's, and opening a ticket (design D15). */
export const OBSERVER_TOOLS: readonly string[] = [...MEMBER_TOOLS, 'a2a_ticket_request', 'a2a_decision_propose']

/** The tools only a team's sessions have: a session with no role is not offered them. */
export const TEAM_TOOLS: readonly string[] = [...ROUTER_TOOLS.filter(name => !SCHEDULE_TOOLS.includes(name) && !SELF_TOOLS.includes(name) && !YGL_READ_TOOLS.includes(name)), 'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_ticket_request', 'a2a_decision_propose', 'a2a_decision_decide']

/**
 * Design tool-requests T6 (owner 2026-11-11: granting tools one by one was too much to operate). A member or an observer may
 * use every tool its host offers, the owner's MCP servers and plugins included, except these, which leave the team: other
 * sessions and subagents, the host's plugins, a question that waits on a person in the UI (a team asks on a decision card),
 * and the A2A network's own sending, joining and settings. The router keeps its list.
 */
export const MEMBER_DENY: readonly string[] = ['subagent', 'subagent_fork', 'list_subagent_models', 'interrupt_agent', 'list_agents', 'send_message', 'workflow',
  'plugin_manager', 'ask_user_question', 'a2a_route', 'a2a_file_send', 'a2a_team_join', 'a2a_team_leave', 'a2a_exposure', 'a2a_report']
/** Names that start or reach other sessions, whatever plugin brings them: refused at the call even when not hidden. */
export const BOUNDARY_NAME = /subagent|^task$|^agents?$|^session[_/]|^sessions?$/i

/** Whether a tool leaves the team for a member or an observer (T6): the boundary list, another role's team tools, or ygl-trees beyond its own. */
export function memberBoundary(role: Role, name: string): boolean {
  if (roleTools(role).includes(name)) return false
  return MEMBER_DENY.includes(name) || BOUNDARY_NAME.test(name) || TEAM_TOOLS.includes(name) || name.startsWith('mcp__ygl__')
}

/** The tool runtime's own transport (programmatic tool calling); never restricted, every inner call is guarded. */
const TRANSPORT = new Set(['run_code'])

export function roleTools(role: Role): readonly string[] {
  return role === 'router' ? ROUTER_TOOLS : role === 'observer' ? OBSERVER_TOOLS : MEMBER_TOOLS
}

/** Why a schedule call would reach beyond the calling session, or undefined when it stays in it. */
export function scheduleTargetRefusal(name: string, args: unknown): string | undefined {
  if (!name.startsWith('schedule_')) return undefined
  const target = args !== null && typeof args === 'object' ? (args as { target?: unknown }).target : undefined
  // No target: DSH 0.2.1 has none and binds the task to the calling session; on 0.2.2 create requires one, so DSH refuses the
  // call itself; an edit without one keeps the task's, which a team session could only have made this_session.
  if (target === undefined || target === 'this_session') return undefined
  return `[superagent-role-tools] a team session schedules only for itself: target must be this_session, not ${String(target)} (a new session would sit outside the team)`
}

/** Why a role session may not call a tool, or undefined when it may. */
/**
 * Whether a tool outside a role's list may be asked for (design tool-requests T2): never the team's own protocol tools, a
 * route out of the team, team membership, subagents or other sessions, nor the ygl-trees tools each role is narrowed to.
 */
export function grantableTool(role: Role, name: string): boolean {
  if (roleTools(role).includes(name) || TEAM_TOOLS.includes(name) || TRANSPORT.has(name)) return false
  if (['a2a_route', 'a2a_file_send', 'a2a_team_join', 'a2a_team_leave'].includes(name) || name.startsWith('mcp__ygl__') || name.startsWith('schedule_')) return false
  return !/subagent|^task$|^agent$|^session[_/]|^sessions?$/i.test(name) && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name)
}

/** The role class a granted tool is kept under: an observer shares the members' grants (design tool-requests T1). */
export const grantClass = (role: Role): 'router' | 'member' => role === 'router' ? 'router' : 'member'

export function roleToolRefusal(role: Role, name: string, args?: unknown, granted: readonly string[] = [], blocked: readonly string[] = []): string | undefined {
  if (TRANSPORT.has(name)) return undefined
  if (role !== 'router') {
    // T6: a member or an observer has everything but the boundary and what the owner blocked.
    if (blocked.includes(name) && !roleTools(role).includes(name)) return `[superagent-role-tools] the owner has blocked ${name} for this team's members`
    if (memberBoundary(role, name)) return `[superagent-role-tools] a team member works with its host's tools and reports with a2a_ticket_report; ${name} leaves the team (other sessions, subagents, A2A sending or another role's tools)`
    return scheduleTargetRefusal(name, args)
  }
  if (roleTools(role).includes(name) || (granted.includes(name) && grantableTool(role, name))) return scheduleTargetRefusal(name, args)
  return `[superagent-role-tools] the team router acts only through ${ROUTER_TOOLS.join(', ')}; ${name} is not one of them`
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
  /** Tools the owner granted this session's team for its role (design tool-requests T1). */
  readonly grantedOf?: (sessionId: string) => readonly string[]
  /** The tools the owner blocked for this team's members and observers (T6). */
  readonly blockedOf?: (sessionId: string) => readonly string[]
  /** A grantable tool was refused: the host may raise a request and say so in the refusal (T3). */
  readonly onRefused?: (sessionId: string, role: Role, name: string) => string | undefined
  /** A loaded agent by session id (for a subagent's parents). */
  readonly agentOf: (sessionId: string) => RoleAgent | undefined
  readonly logger: { warn(format: string, ...args: unknown[]): void }
}

/** How far up a subagent's parents the role is looked for (upstream climbs 8). */
const PARENT_DEPTH = 8

export class RoleTools {
  /** Restrictions in force, by session id: the role they were made for and their disposer. */
  private readonly applied = new Map<string, { role: Role | undefined; key: string; dispose: () => void; allow?: readonly string[] }>()
  private readonly warnedShort = new Set<string>()

  constructor(private readonly d: RoleToolsDeps) {}

  /** The role an agent acts in: its own, or the nearest parent session's (a subagent inherits it). */
  roleOfAgent(agent: RoleAgent | undefined): Role | undefined { return this.roleSessionOf(agent)?.role }
  /** The team session an agent belongs to (itself, or the session a subagent descends from), with its role. */
  heldBy(agent: RoleAgent | undefined): { role: Role; session: string } | undefined { return this.roleSessionOf(agent) }

  /** The role an agent acts in and the session that holds it (its own, or the nearest parent's). */
  private roleSessionOf(agent: RoleAgent | undefined): { role: Role; session: string } | undefined {
    let current = agent
    for (let depth = 0; current !== undefined && depth <= PARENT_DEPTH; depth++) {
      const role = this.d.roleOf(String(current.id))
      if (role !== undefined) return { role, session: String(current.id) }
      const parent = current.session?.header?.parentSession
      if (parent === undefined || parent === null) return undefined
      current = this.d.agentOf(String(parent))
    }
    return undefined
  }

  /** The global guard: a role session (or its subagent) calls only its role's tools. */
  guard(name: string, agent: RoleAgent | undefined, args?: unknown): string | undefined {
    const held = this.roleSessionOf(agent)
    if (held === undefined) return undefined
    const refusal = roleToolRefusal(held.role, name, args, this.d.grantedOf?.(held.session) ?? [], this.d.blockedOf?.(held.session) ?? [])
    // T6: a member's refusal is the boundary or the owner's block, which a card would only ask about again.
    if (refusal === undefined || held.role !== 'router' || !grantableTool(held.role, name)) return refusal
    const asked = this.d.onRefused?.(held.session, held.role, name)
    return asked === undefined ? refusal : `${refusal}. ${asked}`
  }

  /**
   * Bring one live agent's visible tools in line with its role now: restrict a role session to its list, and keep the
   * team's tools from a session with no role. Visibility only; the guard is the rule.
   */
  sync(agent: RoleAgent): void {
    const id = String(agent.id)
    const role = this.d.roleOf(id)
    const granted = role === undefined ? [] : (this.d.grantedOf?.(id) ?? []).filter(name => grantableTool(role, name))
    const blocked = role === undefined || role === 'router' ? [] : this.d.blockedOf?.(id) ?? []
    const key = `${granted.join(',')}|${blocked.join(',')}`
    const current = this.applied.get(id)
    // A restriction made while some of this plugin's own tools were not yet visible in the session's scope (a session restored
    // as the host starts) would hide them for good, since nothing about the role changed (a router left without superagent_*
    // after a restart, 2026-11-11). Such a restriction is made again on the next sync, which every turn start asks for.
    if (current !== undefined && current.role === role && current.key === key && !this.short(role, current.allow)) return
    if (current !== undefined) { this.applied.delete(id); try { current.dispose() } catch { /* the scope is gone */ } }
    // Runs for every session now, in `agent/created`: a context that has not injected the tools service throws on the read.
    let tools: NonNullable<RoleAgent['ctx']>['tools']
    try { tools = agent.ctx?.tools } catch { return }
    if (tools === undefined) return
    if (role === undefined) { this.hideTeamTools(id, agent, tools, key); return }
    // The registry refuses names it does not know, so restrict to the role's tools this agent can see — through its own
    // scope, which includes its preset's tools (bash, read, edit…). The global view misses them, and restricting to it
    // would hide a member's work tools. Without the scope key, visibility stays as it is: the guard is the rule.
    const scope = scopeKeyOf(agent.ctx)
    if (scope === undefined) { this.d.logger.warn('superagent: no tool scope for %s; its tools are guarded, not hidden', id); return }
    const has = (name: string): boolean => { try { return tools.get(name, scope) !== undefined } catch { return false } }
    if (role !== 'router') {
      // T6: a member or an observer sees everything its scope has but the boundary and the owner's blocks.
      const deny = [...new Set([...MEMBER_DENY, ...TEAM_TOOLS, ...YGL_WORK_TOOLS, ...blocked])].filter(name => (memberBoundary(role, name) || (blocked.includes(name) && !roleTools(role).includes(name))) && has(name))
      try { this.applied.set(id, { role, key, dispose: deny.length === 0 ? () => {} : tools.restrict({ deny }) }) } catch (error) { this.d.logger.warn('superagent: tools of %s not restricted: %s', id, String(error)) }
      return
    }
    const allow = [...roleTools(role), ...granted].filter(name => { try { return tools.get(name, scope) !== undefined } catch { return false } })
    if (allow.length === 0) return
    if (this.short(role, allow)) { if (!this.warnedShort.has(id)) { this.warnedShort.add(id); this.d.logger.warn('superagent: %s (%s) does not see %s yet; its tools are made again at its next turn', id, role, roleTools(role).filter(name => TEAM_TOOLS.includes(name) && !allow.includes(name)).join(',')) } } else this.warnedShort.delete(id)
    try { this.applied.set(id, { role, key, allow, dispose: tools.restrict({ allow }) }) } catch (error) { this.d.logger.warn('superagent: tools of %s not restricted: %s', id, String(error)) }
  }

  /** Whether a role's restriction leaves out any of this plugin's own team tools, which every role session must see. */
  private short(role: Role | undefined, allow: readonly string[] | undefined): boolean {
    return role !== undefined && allow !== undefined && roleTools(role).some(name => TEAM_TOOLS.includes(name) && !allow.includes(name))
  }

  /** A session with no role: the names its scope has of the team's tools come off its list. */
  private hideTeamTools(id: string, agent: RoleAgent, tools: NonNullable<NonNullable<RoleAgent['ctx']>['tools']>, key: string): void {
    const scope = scopeKeyOf(agent.ctx)
    if (scope === undefined) return
    const deny = TEAM_TOOLS.filter(name => { try { return tools.get(name, scope) !== undefined } catch { return false } })
    if (deny.length === 0) return
    try { this.applied.set(id, { role: undefined, key, dispose: tools.restrict({ deny }) }) } catch (error) { this.d.logger.warn('superagent: team tools of %s not hidden: %s', id, String(error)) }
  }

  /** A disposed agent's restriction went with its scope. */
  forget(sessionId: string): void { this.applied.delete(sessionId) }

  /** Session ids whose visible tools are restricted now, with their role (for the state face and tests). */
  list(): Record<string, Role> { return Object.fromEntries([...this.applied].flatMap(([id, { role }]) => role === undefined ? [] : [[id, role]])) }
}
