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
import { LOCAL_ROUTE, peerContentMeta } from '../node-self.ts'
import type { ExposureStore } from '../exposure-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import type { TeamMembershipStore } from '../team-store.ts'

// JsonValue is declared locally instead of imported (same reason as
// src/index.ts / src/tools/info.ts: the d.ts re-export chain noted there).
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

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
  // Live-read: owner-settings hot-applies REBINDS the apply-scope let; the
  // join gate reads it through `deps.ownerAllowlist` at call time.
  readonly ownerAllowlist: readonly string[]
  readonly sessionNodes: Map<string, Agent>
  readonly joinedSessions: JoinedSessions
  readonly teamMemberships: TeamMembershipStore
  readonly exposureStore: ExposureStore
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
    ctx, config, logger, sessionNodes, joinedSessions,
    exposureStore, reportRing, recordTeamAudit,
    a2aJoinGateRefusal, id8, routeTrunk,
  } = deps
  const reportLastAt = new Map<string, number>()
  /** Fix ④ loop circuit-breaker: session+text-hash → accepted-report timestamps (10min window). */
  const reportLoopRing = new Map<string, number[]>()

  // Roster self-join (a2a_team_join / a2a_team_leave) is retired (owner ruling 2026-11-18): a team is a canvas team, composed by
  // the owner on the board or by the team builder's blueprints. Rosters declared before stay readable for one version.

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
        // gh#198: the host's own verdict on whether this result came from outside this host, persisted on tool/result.
        presentationMeta: peerContentMeta('a2a_route'),
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
            peer_content: false,
            ok: false,
            error: `the process face "${config.team}" is the host's own mailbox — model tools must target a member face. Route to a session team handle ("${config.team}/<id8>" from a2a_teams) or a canvas team; receipts and quick dispatch reach the host face on their own paths.`,
            code: -32000,
          }
        }
        // gh#198: the host's own flag, written last so a peer's reply fields cannot set it — a result
        // routeTrunk built on this host alone carries the LOCAL_ROUTE symbol; everything else reached a peer.
        const { [LOCAL_ROUTE]: local, ...result } = await routeTrunk(args, exec.agent, exec.signal) as Record<string, JsonValue> & { [LOCAL_ROUTE]?: true }
        return { ...result, peer_content: local !== true }
      },
    }))
  }

  return { registerExposure, registerReport, registerRoute }
}
