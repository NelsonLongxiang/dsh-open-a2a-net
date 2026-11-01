/**
 * The action-plane model tools (gh#77 B3-W): team_join / team_leave /
 * exposure / report / route-shell moved verbatim out of apply() in
 * src/index.ts. Registration order is preserved by the caller invoking each
 * registrar at the original tool position; routeTrunk stays in index.ts (the
 * quick-dispatch control route shares it) and arrives as a dep, and so do
 * recordTeamAudit and a2aJoinGateRefusal (other faces use them). renderRoute
 * moved with the route shell because only it renders there.
 * @module src/tools/act
 */
import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../index.ts'
import type { A2aRouteResult } from '../types.ts'
import type { ExposureStore } from '../exposure-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import type { TeamMembershipStore } from '../team-store.ts'

// JsonValue is declared locally instead of imported (same reason as
// src/index.ts / src/tools/info.ts: the d.ts re-export chain noted there).
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

// A bounded per-client ring of recent report timestamps keeps a chatty peer
// from flooding the mesh (reportLastAt itself is per-apply state, in the
// factory below). Keyed by client address.
const reportLoopRing = new Map<string, number[]>()

/** Model-facing text for one route result. */
function renderRoute(_args: unknown, value: Record<string, JsonValue>): { type: 'text'; text: string }[] {
  const result = value as unknown as A2aRouteResult
  const text = result.ok
    ? [
      `Team ${result.team} replied (task ${result.task_id}, status ${result.task_status}, context ${result.context_id}):`,
      result.reply,
    ].join('\n')
    : `A2A route failed${result.code === undefined ? '' : ` (code ${String(result.code)})`}: ${result.error}`
  return [{ type: 'text', text }]
}

/** Everything the action-plane tools capture from apply(). */
export interface ActToolsDeps {
  readonly ctx: Context
  readonly config: Config
  readonly logger: ReturnType<Context['logger']>
  readonly session: string
  // Live-read: owner-settings hot-applies REBINDS the apply-scope let; the
  // join gate reads it through `deps.ownerAllowlist` at call time.
  readonly ownerAllowlist: readonly string[]
  readonly sessionNodes: Map<string, Agent>
  readonly joinedSessions: JoinedSessions
  readonly teamMemberships: TeamMembershipStore
  readonly exposureStore: ExposureStore
  readonly teamAuditRing: { at: number; action: 'join' | 'leave' | 'archive-prune' | 'agent-less'; team: string; id: string; ok: boolean; reason?: string }[]
  readonly reportRing: { at: number; level: 'info' | 'warning' | 'error'; message: string; session: string; task?: string }[]
  readonly recordTeamAudit: (action: 'join' | 'leave' | 'archive-prune' | 'agent-less', team: string, id: string, ok: boolean, reason?: string) => void
  readonly a2aJoinGateRefusal: (exec: { agent?: { id: unknown } } | undefined) => void
  readonly id8: (id: string) => string
  readonly routeTrunk: (args: { team: string; message: string; context_id?: string; async?: boolean }, agent: Agent | undefined, signal: AbortSignal, hostCaller?: string) => Promise<Record<string, JsonValue>>
}

/**
 * Build the five registrars. Invoke each at the tool's original registration
 * position — the registry order the model sees must not change.
 */
export function createActTools(deps: ActToolsDeps) {
  const {
    ctx, config, logger, session, sessionNodes, joinedSessions,
    teamMemberships, exposureStore, teamAuditRing, reportRing, recordTeamAudit,
    a2aJoinGateRefusal, id8, routeTrunk,
  } = deps
  const reportLastAt = new Map<string, number>()

  // S4: team-membership tools — node-declared rosters under the owner's
  // allowlist curation. Joining is a network-visible declaration (the card
  // publishes it), so the default allowlist denies everything: a refused
  // join says why and names the curation surface instead of failing
  // silently. Leaving is always allowed — it only shrinks exposure.
  // S4 audit: every join/leave attempt — allowed or refused — lands in
  // a bounded ring the state route serves (the ring itself is declared with
  // the stores: the boot-settlement prune records before this section
  // initializes). Refusals are the audit-worthy half (each one is widening
  // pressure on the allowlist); log lines rotate away, this face is queryable.
  // gh#11 (N7, operator directive: team creation is a human act): only an
  // EXACT allowlist entry authorizes a join — each exact name is a
  // deliberate operator act of creation. Wildcard/prefix patterns match
  // nothing at join time: a pattern pre-authorizing every future name
  // under it would let a model mint teams nobody created. Pattern entries
  // remain readable (whoami shows them) but carry no mint rights.
  const teamJoinExactAllowed = (team: string): boolean =>
    deps.ownerAllowlist.includes(team)
  const teamJoinPatternMatches = (team: string): boolean =>
    deps.ownerAllowlist.some(pattern => {
      if (pattern === '*') return true
      if (pattern.endsWith('*')) {
        // Boundary: the wildcard consumes at most the remainder of one
        // '/'-delimited segment — `dsh*` matches `dsh/agent-1`, never
        // `dshield`; `dsh/canvas/*` matches the canvas subtree only.
        const prefix = pattern.slice(0, -1)
        return team.startsWith(prefix) && (prefix.endsWith('/') || (team.length > prefix.length && team[prefix.length] === '/'))
      }
      return team === pattern
    })
  const joinedNodeOrNone = (id: string): string | undefined =>
    joinedSessions.has(id) || sessionNodes.has(id) ? id : undefined


  function registerTeamJoin(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_team_join',
      description:
        'Declare one of this host\'s joined session nodes a member of a routable team '
        + '(node-declared roster; the host card publishes it and peers rebuild team rosters as the union of '
        + 'member declarations). Gated by the owner\'s teamJoinAllowlist — an empty list denies every join; '
        + 'patterns are exact names or trailing-`*` prefixes. Canvas teams are out of scope here: their '
        + 'membership is assigned by hand in the A2A workbench, and the tool refuses `/canvas/` names. '
        + 'Collaboration itself stays within teams (team-scoped routing is the separate teamScopeRouting switch).',
      parameters: {
        team: { type: 'string', description: 'The routable team to join (full form, e.g. dsh/review-gate).' },
        id: { type: 'string', description: 'The joined session node id on this host that declares the membership.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            team: { type: 'string' },
            id: { type: 'string' },
            teams: { type: 'array', items: { type: 'string' } },
            error: { type: 'string', description: 'Refusal reason when ok is false: unknown node or team not allowlisted.' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok === true
            ? `Node ${String(value.id)} joined team ${String(value.team)}; its teams: ${Array.isArray(value.teams) ? value.teams.join(', ') : String(value.team)}`
            : `Join refused: ${String(value.error)}`,
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A team join', kind: 'other', rawInput: null }),
      execute: async (args, exec): Promise<{ ok: boolean; team?: string; id?: string; teams?: string[]; error?: string }> => {
        a2aJoinGateRefusal(exec)
        const team = String(args.team ?? '').trim()
        const id = String(args.id ?? '').trim()
        if (team === '' || id === '') {
          const reason = '[BAD_ARGUMENTS] both team and id are required'
          recordTeamAudit('join', team, id, false, reason)
          return { ok: false, error: reason }
        }
        if (joinedNodeOrNone(id) === undefined) {
          // K3 feedback (2026-10-20): reason code + a step the MODEL can take.
          // The old text pointed at a sidebar control and a CLI — neither is
          // executable by a session agent. Joining is a host-side human
          // control; the model's executable step is to ask its operator and
          // to self-check state with a2a_whoami.
          const reason = `[NOT_JOINED] session ${id} is not a joined node on this host — network joining is a host-side human control (the GUI sidebar A2A panel), so relay the request to your human operator; once the node is joined, retry this declaration. Your current state (joined/live, teams, allowlist) is one a2a_whoami call away`
          recordTeamAudit('join', team, id, false, reason)
          return { ok: false, error: reason }
        }
        // V4 (gh#7, N2): a model tool changes membership for the CALLING
        // session only — agent-1 declaring agent-2 into a team was an agent
        // creating a link for another node, published to the whole fleet via
        // the card. The host face (agent-less, operator surface) may still
        // act for any joined node.
        if (exec?.agent !== undefined && String(exec.agent.id) !== id) {
          const reason = `[NOT_SELF] a model tool may only declare membership for its own session node (${String(exec.agent.id)}) — membership for other nodes is your operator's gesture (the workbench or the host face); N2: agents use links, they do not create them for others`
          recordTeamAudit('join', team, id, false, reason)
          return { ok: false, error: reason }
        }
        // Unified teaming (0.6.6): canvas teams are the human-composed surface.
        // A session may not self-join one through the roster tool — membership
        // there is assigned by hand, so the refusal names the surface where the
        // assignment happens. Any `/canvas/` name (this zone's or a peer's) is
        // refused: remote canvas membership is the owning host's store, and a
        // roster declaration here would neither feed it nor be read by it.
        if (team.includes('/canvas/')) {
          const reason = `[CANVAS_TEAM] team "${team}" is a canvas team — canvas membership is assigned by hand in the A2A workbench (open /__dsh_a2a_nexus/, pick the team, add or remove members there); the roster tool manages allowlisted teams only. If this membership must change now, relay the request to your human operator`
          recordTeamAudit('join', team, id, false, reason)
          return { ok: false, error: reason }
        }
        if (!teamJoinExactAllowed(team)) {
          const reason = teamJoinPatternMatches(team)
            ? `[PATTERN_NO_MINT] team "${team}" matches only a wildcard/pattern entry of this host's teamJoinAllowlist — patterns carry no mint rights (gh#11/N7: team creation is a human act); ask the owner to add the EXACT team name, which is the act of creating it`
            : `[ALLOWLIST_DENY] team "${team}" is not in this host's teamJoinAllowlist — the owner curates joinable teams with exact names (patterns match nothing at join time; human-composed groups live in the workbench's canvas teams); ask them to add the exact name. The live list is visible in a2a_whoami`
          recordTeamAudit('join', team, id, false, reason)
          return { ok: false, error: reason }
        }
        teamMemberships.add(id, team)
        recordTeamAudit('join', team, id, true)
        logger.info(`a2a: ${id8(id)} declared membership in ${team}`)
        return { ok: true, team, id, teams: [...teamMemberships.teamsOf(id)] }
      },
    }))
  }

  function registerTeamLeave(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_team_leave',
      description:
        'Retract one team-membership declaration previously made by a2a_team_join. Always allowed — leaving only '
        + 'shrinks the node\'s visible collaboration surface.',
      parameters: {
        team: { type: 'string', description: 'The routable team to leave.' },
        id: { type: 'string', description: 'The session node id retracting the membership.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            team: { type: 'string' },
            id: { type: 'string' },
            teams: { type: 'array', items: { type: 'string' } },
            error: { type: 'string', description: 'Refusal reason when ok is false: node unknown or membership absent.' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok === true
            ? `Node ${String(value.id)} left team ${String(value.team)}; remaining teams: ${Array.isArray(value.teams) && value.teams.length > 0 ? value.teams.join(', ') : 'none'}`
            : `Leave refused: ${String(value.error)}`,
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A team leave', kind: 'other', rawInput: null }),
      execute: async (args, exec): Promise<{ ok: boolean; team?: string; id?: string; teams?: string[]; error?: string }> => {
        a2aJoinGateRefusal(exec)
        const team = String(args.team ?? '').trim()
        const id = String(args.id ?? '').trim()
        if (team === '' || id === '') {
          recordTeamAudit('leave', team, id, false, 'both team and id are required')
          return { ok: false, error: 'both team and id are required' }
        }
        if (joinedNodeOrNone(id) === undefined) {
          const reason = `[NOT_JOINED] session ${id} is not a joined node on this host — check current state with a2a_whoami`
          recordTeamAudit('leave', team, id, false, reason)
          return { ok: false, error: reason }
        }
        // V4 (gh#7, N2): same self-only rule as join — narrowing another
        // node's surface is still a link change by a third party.
        if (exec?.agent !== undefined && String(exec.agent.id) !== id) {
          const reason = `[NOT_SELF] a model tool may only retract membership for its own session node (${String(exec.agent.id)}); N2 — use links, do not reshape another node's`
          recordTeamAudit('leave', team, id, false, reason)
          return { ok: false, error: reason }
        }
        if (!teamMemberships.teamsOf(id).includes(team)) {
          const reason = `session ${id} declares no membership in "${team}" — nothing to leave`
          recordTeamAudit('leave', team, id, false, reason)
          return { ok: false, error: reason }
        }
        teamMemberships.remove(id, team)
        recordTeamAudit('leave', team, id, true)
        logger.info(`a2a: ${id8(id)} retracted membership in ${team}`)
        return { ok: true, team, id, teams: [...teamMemberships.teamsOf(id)] }
      },
    }))
  }

  function registerExposure(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_exposure',
      description:
        '#19 exposure tiers: set THIS session\'s network visibility. \'linked\' (the default '
        + 'floor) — visible to linked callers per the card-face link gate; \'fleet\' — a voluntary '
        + 'opt-UP making the session\'s team visible to any fleet peer. Members may raise and lower '
        + 'their own tier freely; nothing exists below linked (no private tier in v1), and group '
        + 'visibility always derives from the strictest member (no group knobs). Requires the '
        + 'session to be joined to the network.',
      parameters: {
        tier: { type: 'string', enum: ['linked', 'fleet'], required: true, description: 'The exposure tier to set for this session.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            id: { type: 'string' },
            tier: { type: 'string' },
            error: { type: 'string', description: 'Refusal reason when ok is false (not joined, or no agent context).' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok === true
            ? `Session ${String(value.id)} exposure tier set to ${String(value.tier)}`
            : `Exposure refused: ${String(value.error)}`,
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A exposure tier', kind: 'other', rawInput: null }),
      execute: async (args, exec): Promise<{ ok: boolean; id?: string; tier?: string; error?: string }> => {
        const agent = exec.agent
        if (agent === undefined) {
          return { ok: false, error: 'no agent context — the exposure tier is a per-session fact; call from a session' }
        }
        const id = String(agent.id)
        if (!joinedSessions.has(id)) {
          return { ok: false, error: 'session is not joined to the A2A network — join first (the sidebar control or the host join route)' }
        }
        const tier = args.tier === 'fleet' ? 'fleet' : 'linked'
        exposureStore.setTier(id, tier)
        logger.info(`a2a: ${id8(id)} exposure tier -> ${tier}`)
        return { ok: true, id, tier }
      },
    }))
  }

  function registerReport(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_report',
      description:
        'Report a task or status to this host\'s A2A network — the ONE ingress a session WITHOUT network '
        + 'membership may use (deliberately exempt from the join gate: one-way reporting grants no presence, '
        + 'no discovery, no routing rights; the report lands in the state face\'s reports ring for '
        + 'supervision to read and act on, e.g. adopt or re-join the reporter). Use when you are off the '
        + 'mesh and need to say so. Rate limited to one report per 30s per session; messages cap at 4000 chars.',
      parameters: {
        message: { type: 'string', required: true, description: 'The report text (≤4000 chars).' },
        level: { type: 'string', enum: ['info', 'warning', 'error'], description: 'Severity; error also warns the host log.' },
        task: { type: 'string', description: 'Optional task reference (id/link).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            reportId: { type: 'string' },
            error: { type: 'string', description: 'Refusal reason when ok is false (empty message, over-cap, or rate limited).' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok === true ? `Report registered (${String(value.reportId)})` : `Report refused: ${String(value.error)}`,
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A report', kind: 'other', rawInput: null }),
      execute: async (args, exec): Promise<{ ok: boolean; reportId?: string; error?: string }> => {
        // Deliberately NO a2aJoinGateRefusal: reporting is the one thing an
        // unjoined session may do — that is the tool's entire purpose.
        const message = String(args.message ?? '').trim()
        if (message === '') return { ok: false, error: 'message is required' }
        if (message.length > 4000) return { ok: false, error: 'message exceeds the 4000-char cap' }
        const session = exec?.agent !== undefined ? String(exec.agent.id) : 'host'
        const now = Date.now()
        const last = reportLastAt.get(session) ?? 0
        if (now - last < 30_000) return { ok: false, error: 'rate limited: one report per 30s per session' }
        // Fix ④ (loop circuit-breaker, d44efa9f pattern): the SAME session
        // reporting the SAME text ≥3 times inside a 10-minute window is a
        // loop, not a situation — refuse with a named reason and audit the
        // ring (the first copies go through; the bounded ring self-expires).
        const loopKey = `${session}:${createHash('sha256').update(message).digest('hex').slice(0, 16)}`
        const loopWindow = (reportLoopRing.get(loopKey) ?? []).filter(at => now - at < 600_000)
        if (loopWindow.length >= 3) {
          recordTeamAudit('agent-less', 'a2a_report', session, false, 'loop detected: 3 identical reports in 10min')
          return { ok: false, error: '循环检测：同会话同文 10 分钟内已上报 3 次，本 report 熔断拒绝。若确需再报请变更内容或等窗口滑出' }
        }
        loopWindow.push(now)
        reportLoopRing.set(loopKey, loopWindow)
        reportLastAt.set(session, now)
        const level = args.level === 'error' || args.level === 'warning' ? args.level : 'info'
        const reportId = `report-${Math.random().toString(16).slice(2, 10)}`
        reportRing.push({
          at: now,
          level,
          message: message.slice(0, 4000),
          session,
          ...(typeof args.task === 'string' && args.task.trim() !== '' ? { task: args.task.trim() } : {}),
        })
        if (reportRing.length > 64) reportRing.splice(0, reportRing.length - 64)
        if (level === 'error') logger.warn(`a2a report (${id8(session)}): ${message.slice(0, 200)}`)
        return { ok: true, reportId }
      },
    }))
  }

  function registerRoute(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_route',
      description:
        'Route a message to a remote A2A team on the peer network and await its reply. '
        + 'Pick the team with a2a_teams first. Team names also resolve through peers\' signed zone '
        + 'delegation records (zone-relative, at most 5 hops). Reuse context_id from a previous reply '
        + 'to continue that conversation. The call blocks until the remote team responds, which may take minutes — '
        + 'pass async for long-running tasks: delivery returns immediately and the target routes a receipt '
        + '(message starting "[A2A receipt] task <task_id> <outcome summary>") back to your team.',
      parameters: {
        team: { type: 'string', required: true, description: 'Target team name, from a2a_teams.' },
        message: { type: 'string', required: true, description: 'The request text to send. For long verdict-style payloads, split into parts and label each "1/N", "2/N"… so the receiver can reassemble.' },
        context_id: { type: 'string', description: 'Context id from a previous a2a_route reply, to continue that conversation.' },
        async: { type: 'boolean', description: 'Fire-and-forget: deliver and return immediately (delivered:true + task_id) without waiting for the target\'s reply. The target answers by routing a receipt — a message starting "[A2A receipt] task <task_id> <outcome summary>" — back to your team (visible in a2a_status activity), or follow up with the context_id. Prefer async for long-running tasks (minutes to hours).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
        },
        render: renderRoute,
      },
      timeoutMs: config.routeTimeoutMs,
      presentCall: args => ({ card: 'generic', title: `A2A route → ${args.team}`, kind: 'other', rawInput: args }),
      execute: async (args: { team: string; message: string; context_id?: string; async?: boolean }, exec): Promise<Record<string, JsonValue>> => {
        // Owner ruling (tool-layer interception): the PROCESS face (bare
        // zone === config.team) keeps its host-level EXEMPTION on the network
        // admission layer — receipts, quick dispatch and host-side routing
        // still target it internally — but a MODEL TOOL call must not address
        // it: the machine's own mailbox is not a member face, and letting a
        // session route there would turn the host entrance into a group-free
        // hop. Host-face entry (agent-less control routes, receipt ladders)
        // never passes through this tool and stays untouched.
        const requestedTeam = String(args.team ?? '').trim()
        if (exec.agent !== undefined && requestedTeam === config.team) {
          return {
            ok: false,
            error: `the process face "${config.team}" is the host's own mailbox — model tools must target a member face. Route to a session team handle ("${config.team}/<id8>" from a2a_teams) or a canvas team; receipts and quick dispatch reach the host face on their own paths.`,
            code: -32000,
          }
        }
        return routeTrunk(args, exec.agent, exec.signal)
      },
    }))
  }

  return { registerTeamJoin, registerTeamLeave, registerExposure, registerReport, registerRoute }
}
