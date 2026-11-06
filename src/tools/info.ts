/**
 * The information-plane model tools (gh#77 B3-R): whoami / teams / status /
 * tasks / probe moved verbatim out of apply() in src/index.ts. Registration
 * order is preserved by the caller invoking each registrar at the original
 * tool position; the joined-team scope helpers and describeAge moved with the
 * tools because only these tools use them. SWEEP_CONCURRENCY arrives through
 * a getter so the deps object can be built before the const is declared.
 * @module src/tools/info
 */
import { reminderView, type ReminderView } from '../reconciliation-state.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../index.ts'
import type { CardCacheEntry, InFlightRoute, RouteActivityEntry } from '../runtime.ts'
import type { A2aPeerCard } from '../types.ts'
import { splitQualifiedMember } from '../canvas-member.ts'
import { peerDirectoryRows } from '../peer-directory.ts'
import { canvasMemberships, canvasOwners } from '../canvas-discovery.ts'
import { peerContentMeta } from '../node-self.ts'
import type { ZoneCardFetch } from '../zone.ts'
import type { A2aClient, CardFetchOutcome } from '../a2a-client.ts'
import type { CanvasStore } from '../canvas-store.ts'
import type { ExposureStore } from '../exposure-store.ts'
import type { IdempotencyStore, IdempotencyStats } from '../idempotency-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import type { PeerStore } from '../peer-store.ts'
import type { TaskLedger, Sender } from '../task-ledger.ts'
import type { TeamMembershipStore } from '../team-store.ts'

// JsonValue is declared locally instead of imported from @deepseek-ai/dsh-tools
// for the same reason as src/index.ts: keeping this module free of the d.ts
// re-export chain noted there.
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One directory row shared with listDirectoryTeams (which stays in index.ts). */
export type DirectoryTeamRow = { memberRef?: string; team: string; session: string; name: string; seatName?: string; kind?: 'canvas'; owner?: string; memberCount?: number; description: string; local?: boolean; origin?: string; workspace?: string; via?: string; legacy?: boolean; /** gh#106: the peer's last card fetch missed — this row is its kept card, not a live answer. */ unreachable?: boolean; teams?: string[]; /** Internal S5 scope hint, stripped before the tool's public output. */ canvasMembers?: readonly string[] }

/** Everything the information-plane tools capture from apply(). */
export interface InfoToolsDeps {
  readonly ctx: Context
  readonly config: Config
  readonly logger: ReturnType<Context['logger']>
  readonly session: string
  readonly lanIp: string
  readonly ownCardUrl: string
  readonly peerStore: PeerStore
  readonly taskLedger: TaskLedger
  readonly joinedSessions: JoinedSessions
  readonly teamMemberships: TeamMembershipStore
  readonly canvasStore: CanvasStore
  readonly canvasMigrationState: () => Record<string, unknown>
  readonly exposureStore: ExposureStore
  readonly idempotencyStore: IdempotencyStore
  readonly cardCache: Map<string, CardCacheEntry>
  readonly inFlightRoutes: Map<number, InFlightRoute>
  readonly recentActivity: RouteActivityEntry[]
  readonly teamAuditRing: { at: number; action: 'join' | 'leave' | 'archive-prune' | 'agent-less'; team: string; id: string; ok: boolean; reason?: string }[]
  readonly reportRing: { at: number; level: 'info' | 'warning' | 'error'; message: string; session: string; task?: string }[]
  readonly sessionNodes: Map<string, Agent>
  // Hot-applied owner settings: the caller passes these as getters over the
  // apply-scope lets, so every call-time read must go through `deps.X` — a
  // destructured copy would freeze the boot value.
  readonly ownerAllowlist: readonly string[]
  readonly ownerTeamScopeInfo: boolean
  readonly id8: (id: string) => string
  readonly sessionTeamOf: (agent: Agent) => string
  readonly nodeMetadataOf: (agent: Agent) => { name: string; seatName?: string; description: string; workspace?: string }
  readonly canvasTeamOf: (name: string) => string
  /** gh#152: the session's canvas teams read through the local lens — a handle-stored membership of this session counts. */
  readonly canvasTeamsOfSession: (id: string) => string[]
  /** Resolve a handle against the current local/seeded-peer collision snapshot. */
  readonly localHandleResolver: () => (ref: string) => string | undefined
  readonly memoizedCardFetch: () => ZoneCardFetch
  readonly mapBounded: <T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>) => Promise<R[]>
  readonly SWEEP_CONCURRENCY: number
  readonly a2aJoinGateRefusal: (exec: { agent?: { id: unknown } } | undefined) => void
  readonly observeAuthorization: (cause: string) => void
  readonly settlePeerCard: (peer: string, outcome: CardFetchOutcome) => A2aPeerCard | undefined
  readonly client: A2aClient
  readonly listDirectoryTeams: (expand: boolean, includeCanvas?: boolean) => Promise<DirectoryTeamRow[]>
}

/**
 * Build the five registrars. Call createInfoTools after its deps exist, then
 * invoke each registrar at the tool's original registration position — the
 * registry order the model sees must not change.
 */
export function createInfoTools(deps: InfoToolsDeps) {
  const {
    ctx, config, logger, session, lanIp, peerStore, taskLedger,
    joinedSessions, teamMemberships, canvasStore, exposureStore, idempotencyStore,
    cardCache, inFlightRoutes, recentActivity, teamAuditRing, reportRing,
    sessionNodes,
    id8, sessionTeamOf, nodeMetadataOf, canvasTeamOf, canvasTeamsOfSession, localHandleResolver, memoizedCardFetch,
    mapBounded, SWEEP_CONCURRENCY, a2aJoinGateRefusal, observeAuthorization,
    settlePeerCard, client, listDirectoryTeams,
  } = deps

  // S5 (owner directive 2026-10-20): information-plane scoping. The host's
  // joined-team scope is the union of every local node's roster
  // declarations — a host-level set, not per-session: supervisor seats need
  // the cross-team overview, and 「加入的团队」 reads as the teams this
  // host's nodes joined. The information-plane tools (a2a_teams /
  // a2a_status / a2a_probe) disclose remote facts only inside that scope;
  // a2a_tasks — this host's own dispatch ledger and receipt-reconciliation
  // surface, including initiator-exempt dispatches — stays unscoped by
  // ruling (its rows name teams this host itself routed to, never a fleet
  // census).
  const joinedTeamScope = (): ReadonlySet<string> => {
    const joined = new Set<string>()
    for (const entry of teamMemberships.list()) {
      for (const team of entry.teams) joined.add(team)
    }
    // G4 (review artifact 688c0354d3 v2): canvas membership is join intent
    // too. This host's canvas teams — and every member handle they name
    // (remote zone-qualified handles as-is, local session ids as their
    // session-team handle) — belong to the scope, so canvas teammates stay
    // visible to each other under teamScopeInfo instead of the roster-only
    // reading splitting them apart.
    for (const name of canvasStore.list()) {
      joined.add(canvasTeamOf(name))
      for (const member of canvasStore.membersOf(name)) {
        joined.add(member.includes('/') ? member : `${config.team}/${id8(member)}`)
      }
    }
    return joined
  }
  /**
   * Match exactly the sanitized rows the directory would expose: process/session
   * and roster teams use their joined names; canvas rows need an explicitly
   * joined local member resolved by the same local-first handle rules.
   */
  const cardServesJoined = (card: A2aPeerCard, joined: ReadonlySet<string>, resolveLocal: (ref: string) => string | undefined): boolean =>
    peerDirectoryRows(card, '', true).some(row => {
      if (row.canvasMembers !== undefined) {
        return row.canvasMembers.some(ref => {
          const id = resolveLocal(ref)
          return id !== undefined && joinedSessions.has(id)
        })
      }
      return joined.has(row.team) || [...joined].some(ref => splitQualifiedMember(ref)?.handle === row.team && canvasStore.ownerKeyOf(ref) === card.publicKey) || (row.teams ?? []).some(team => joined.has(team))
    })



  /** Human duration for a ledger row: how long a task has been owed or took. */
  const describeAge = (ms: number): string => {
    const minutes = Math.floor(ms / 60_000)
    if (minutes < 1) return 'under a minute'
    if (minutes < 60) return `${String(minutes)}m`
    return `${String(Math.floor(minutes / 60))}h${minutes % 60 === 0 ? '' : `${String(minutes % 60)}m`}`
  }

  // S5 ruling: a2a_tasks stays unscoped — it is this host's own dispatch
  // ledger (pending / dead / archived), the receipt-reconciliation surface
  // for work this host itself routed, initiator-exempt dispatches included.
  // Its rows name teams this host already talked to; reading them back is
  // bookkeeping, not fleet disclosure.

  function registerWhoami(): void {
    // K3 feedback P0 (2026-10-20): a session could appear in a2a_teams, route
    // fine, and still be refused by a2a_team_join — with no way to ask "what am
    // I, actually?". whoami is that one-call answer. Deliberately NOT gated by
    // a2aJoinGateRefusal: the unjoined session is precisely the caller that
    // needs it.
    ctx.tools.register(defineTool({
      name: 'a2a_whoami',
      description:
        'One-call self-introspection on this host\'s A2A network: the calling session\'s node id, joined/live '
        + 'state, routable team handle, declared team memberships (roster + canvas), the owner\'s teamJoinAllowlist, '
        + 'the teamScopeRouting switch, and this node\'s most recent refused join/leave attempts with reasons. '
        + 'Note: outbound routing never requires join — the originating session is always exempt (initiator face); '
        + 'join buys presence, discovery, and being routed to.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            face: { type: 'string', required: true, description: 'session | host' },
            node: {
              type: 'object',
              additionalProperties: true,
              description: 'id, joined, live, and the routable team handle (zone/id8) once joined.',
            },
            teams: {
              type: 'object',
              additionalProperties: true,
              description: 'roster: allowlisted teams declared via a2a_team_join; canvas: local workbench-assigned names (compatibility); canvasDetails: local/remote membership with qualified team, owner URL and memberCount.',
            },
            allowlist: {
              type: 'object',
              additionalProperties: true,
              description: 'The owner-curated teamJoinAllowlist: exact entries (the only join authority, gh#11) plus pattern entries kept readable but carrying no mint rights (deny-all / curated; allow-all only via explicit exact entries).',
            },
            teamScopeRouting: { type: 'boolean' },
            note: { type: 'string', description: 'What join does and does not gate, in one sentence.' },
            lastRefusals: {
              type: 'array',
              description: 'Most recent refused join/leave attempts for this node (newest first, ≤3), with reason codes.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.face === 'host'
            ? `Host face on team ${String((value.node as Record<string, unknown> | undefined)?.team ?? '?')}: routing rides the bare node team (能发即能收)`
            : `Node ${String((value.node as Record<string, unknown> | undefined)?.name ?? '')} ${String((value.node as Record<string, unknown> | undefined)?.id ?? '?')}: joined=${String((value.node as Record<string, unknown> | undefined)?.joined)}, live=${String((value.node as Record<string, unknown> | undefined)?.live)}; roster teams: ${((value.teams as Record<string, unknown> | undefined)?.roster as string[] | undefined ?? []).join(', ') || 'none'}; canvas: ${((value.teams as Record<string, unknown> | undefined)?.canvas as string[] | undefined ?? []).join(', ') || 'none'}; canvas owners: ${JSON.stringify((value.teams as Record<string, unknown> | undefined)?.canvasDetails ?? [])}; allowlist effect: ${String((value.allowlist as Record<string, unknown> | undefined)?.effect ?? '?')}`,
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A whoami', kind: 'other', rawInput: null }),
      execute: async (_args, exec): Promise<{
        ok: boolean
        face: string
        node?: Record<string, JsonValue>
        teams?: Record<string, JsonValue>
        allowlist?: Record<string, JsonValue>
        teamScopeRouting?: boolean
        lastRefusals?: Array<Record<string, JsonValue>>
        note?: string
      }> => {
        const agentId = exec?.agent !== undefined ? String(exec.agent.id) : ''
        if (agentId === '') {
          return {
            ok: true,
            face: 'host',
            node: { team: config.team },
            note: 'host face — routing rides the bare node team (能发即能收); joins are session-node concerns',
          }
        }
        const joined = joinedSessions.has(agentId)
        const live = sessionNodes.has(agentId)
        await listDirectoryTeams(false, true) // refresh through the existing bounded directory, not a second discovery path
        const canvasDetails = canvasMemberships(canvasOwners(canvasStore.list().map(name => ({ name, team: canvasTeamOf(name), members: canvasStore.membersOf(name) })), deps.ownCardUrl, [...cardCache.entries()].flatMap(([url, entry]) => entry.card === undefined ? [] : [{ url, card: entry.card }])), `${config.team}/${id8(agentId)}`, agentId, localHandleResolver())
        const refusals = teamAuditRing
          .filter(entry => entry.id === agentId && !entry.ok)
          .slice(-3)
          .reverse()
          .map(entry => ({ at: entry.at, action: entry.action, team: entry.team, reason: entry.reason ?? '' }))
        const patterns = [...deps.ownerAllowlist]
        return {
          ok: true,
          face: 'session',
          node: {
            id: agentId,
            ...(exec.agent !== undefined ? { name: nodeMetadataOf(exec.agent).name, ...(nodeMetadataOf(exec.agent).seatName !== undefined ? { seatName: nodeMetadataOf(exec.agent).seatName! } : {}) } : {}),
            ...(joined ? { team: `${config.team}/${id8(agentId)}` } : {}),
            joined,
            live,
          },
          teams: {
            roster: [...teamMemberships.teamsOf(agentId)],
            canvas: [...canvasTeamsOfSession(agentId)],
            canvasDetails,
            canvasMigration: (() => { const s=deps.canvasMigrationState(); return Object.fromEntries(['canvasLegacyBareMembers','epoch','legacyBareMembers','legacyInferredMembers','legacyInferenceResolutions','legacyCollisionWarnings','suspendedMembersCount'].map(key=>[key,s[key] as JsonValue])) })(),
          },
          allowlist: {
            patterns,
            effect: patterns.length === 0 ? 'deny-all (empty allowlist refuses every join)' : patterns.includes('*') ? 'allow-all' : 'curated',
          },
          teamScopeRouting: config.teamScopeRouting === true,
          ...(refusals.length > 0 ? { lastRefusals: refusals } : {}),
          note: joined
            ? 'join buys presence + being routed to; outbound routing needs no join (initiator face is exempt)'
            : 'NOT joined: no presence/discovery and cannot be routed to; outbound routing still works (initiator face), and joining is a host-side human control (GUI sidebar A2A panel)',
        }
      },
    }))
  }

  function registerTeams(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_teams',
      description:
        'List or search reachable A2A teams: this host\'s own process team and joined session nodes first (marked [this host], '
        + 'routable over loopback — same-host collaboration needs no peers), then teams across the tracked peer network '
        + 'with owner label, a recent-activity excerpt, the publishing host (origin: node label + LAN IP — the natural '
        + 'grouping when a fleet spans machines), and the session\'s working directory when shared. Pass query to filter '
        + 'by keyword (case-insensitive substring over team name, title, excerpt, origin, or workspace) — searching '
        + 'discovers one extra referral hop within the call. Canvas teams (<team>/canvas/<name>, user-composed multi-member groups) '
        + 'list as local rows and as remote rows when a peer publishes them (origin/via identify their owner). Local routing resolves '
        + 'the first live member or wakes the first cold one; the dispatching session itself is skipped on the local tiers '
        + '(issue #41: routing to its own group never loops home). Remote candidates still require the existing peer-link and '
        + 'receiver admission checks; a served-fresh canvasOrg is not itself a signature over membership. '
        + 'While teamScopeInfo is on (default), the listing follows YOUR collaboration circle: remote canvas rows name a joined session of this host, remote roster rows serve a joined team, and [this host] session rows show only your own row, your canvas teams, and sessions sharing a team with you — an exposed node id invites mis-routing, so the directory does not advertise strangers. The owner\'s GUI panel keeps the full plane; teamScopeInfo: false opens it for tools too. '
        + 'Call this before a2a_route to pick a target team.',
      parameters: {
        query: { type: 'string', description: 'Optional keyword filter (case-insensitive substring over team/name/description).' },
      },
      output: {
        // gh#198: the host's own verdict on whether this result came from outside this host, persisted on tool/result.
        presentationMeta: peerContentMeta('a2a_teams'),
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            query: { type: 'string', description: 'The filter applied, empty when unfiltered.' },
            teams: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  team: { type: 'string', required: true },
                  memberRef: { type: 'string', description: 'Owner-qualified session selector, bound to the verified publishing host key; not an independent authority.' },
                  session: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  seatName: { type: 'string', description: 'Human-owned stable display label, never a route identity.' },
                  kind: { type: 'string', enum: ['canvas'] },
                  owner: { type: 'string', description: 'Canvas owner host URL; discovery metadata, not a --home requirement.' },
                  memberCount: { type: 'number' },
                  description: { type: 'string', required: true },
                  local: { type: 'boolean', description: 'true when the team is served by this host (loopback candidate).' },
                  origin: { type: 'string', description: 'The publishing host (node session label, LAN IP when known) — the natural grouping for fleet rows.' },
                  via: { type: 'string', description: 'The peer URL this row was discovered through (host:port), when it came from a peer card.' },
                  workspace: { type: 'string', description: 'The session\'s working directory, when shared.' },
                  legacy: { type: 'boolean', description: 'true when the publishing node advertises no roster capability (pre-roster peer).' },
                  teams: { type: 'array', items: { type: 'string' }, description: 'Roster teams the node declared for this handle (card teamMemberships).' },
                },
              },
            },
            note: { type: 'string', description: 'Present while teamScopeInfo scoping is on: the joined-team scope plus how many rows outside YOUR collaboration circle were withheld (remote/local split; the process team, your own row, and your canvas teams always show).' },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: (value.teams.length === 0
            ? `No A2A teams${(value.query ?? '') === '' ? '' : ` matching "${String(args.query)}"`} are currently reachable.`
            : value.teams.map(team => `- ${team.team}${team.local === true ? ' [this host]' : ''}${team.name === '' ? '' : ` (${team.name})`}${team.kind === 'canvas' ? ` [canvas owner=${team.owner ?? '?'} members=${String(team.memberCount ?? '?')}]` : ''}${team.description === '' ? '' : ` — ${team.description}`}${typeof team.origin === 'string' && team.origin !== '' && team.local !== true ? ` @ ${team.origin}` : ''}${typeof team.workspace === 'string' && team.workspace !== '' ? ` [${team.workspace}]` : ''}`).join('\n'))
            + (value.note === undefined ? '' : `\n${value.note}`),
        }],
      },
      presentCall: args => ({ card: 'generic', title: args.query === undefined || args.query === '' ? 'List reachable A2A teams' : `Search A2A teams: ${args.query}`, kind: 'other', rawInput: args }),
      execute: async (args: { query?: string }, exec): Promise<{ ok: boolean; query: string; teams: DirectoryTeamRow[]; note?: string }> => {
        a2aJoinGateRefusal(exec)
        const query = args.query?.trim().toLowerCase() ?? ''
        let teams = await listDirectoryTeams(query !== '', true)
        // S5: remote rows survive only when they serve a joined team (the
        // row's own name or any roster declaration it carries); local rows
        // are host-internal facts and always survive. The note keeps the
        // model from reading a scoped listing as an empty fleet.
        let note: string | undefined
        if (deps.ownerTeamScopeInfo) {
          const joined = joinedTeamScope()
          const resolveLocal = localHandleResolver()
          const remoteBefore = teams.filter(row => row.local !== true).length
          teams = teams.filter(row => {
            if (row.local === true) return true
            // A same-zone canvas NAME can exist on two hosts: a local team
            // with that name does not prove membership in the remote one.
            if (row.canvasMembers !== undefined) return row.canvasMembers.some(ref => {
              const id = resolveLocal(ref)
              return id !== undefined && joinedSessions.has(id)
            })
            const card = row.via ? cardCache.get(row.via)?.card : undefined
            return joined.has(row.team) || [...joined].some(ref=>splitQualifiedMember(ref)?.handle===row.team && canvasStore.ownerKeyOf(ref)===card?.publicKey) || (row.teams ?? []).some(name => joined.has(name))
          })
          const hiddenRemote = remoteBefore - teams.filter(row => row.local !== true).length
          // gh#39 (owner ruling: the listing ADVERTISES targets — an exposed
          // node id invites a session with no collaboration relationship to
          // route at it): [this host] session rows follow the CALLER's
          // collaboration circle. The host's own GUI/panel keeps the full
          // plane (the owner's eyes); the model-tool face is scoped.
          let hiddenLocal = 0
          const callerAgent = exec.agent
          if (callerAgent !== undefined) {
            const callerId = String(callerAgent.id)
            const ownHandle = sessionTeamOf(callerAgent)
            const myCanvas = new Set(canvasTeamsOfSession(callerId))
            const myRoster = new Set(teamMemberships.teamsOf(callerId))
            const before = teams.length
            teams = teams.filter(row => {
              if (row.local !== true) return true
              if (row.team === config.team || row.team === ownHandle) return true
              if (row.team.startsWith(`${config.team}/canvas/`)) return myCanvas.has(row.name)
              // Another session's team row: visible only when we share a
              // canvas or a declared team with that session.
              const targetId8 = row.team.slice(config.team.length + 1)
              const target = [...sessionNodes.values()].find(agent => id8(String(agent.id)) === targetId8)
              if (target === undefined) return true // unresolvable: keep (host fact)
              const targetId = String(target.id)
              const shares = [...canvasTeamsOfSession(targetId)].some(name => myCanvas.has(name))
                || [...teamMemberships.teamsOf(targetId)].some(name => myRoster.has(name))
              return shares
            })
            hiddenLocal = before - teams.length
          }
          const hidden = hiddenRemote + hiddenLocal
          note = `teamScopeInfo on: ${String(joined.size)} joined team${joined.size === 1 ? '' : 's'} on this host — ${String(hidden)} row${hidden === 1 ? '' : 's'} outside your collaboration circle withheld (${String(hiddenRemote)} remote, ${String(hiddenLocal)} local [this host] session rows; the process team, your own row, and your canvas teams always show). To widen the scope: a human composes the shared canvas team (the board drag), the owner adds the EXACT team name to teamJoinAllowlist (patterns carry no mint rights, gh#11), or the owner sets teamScopeInfo: false for the open plane`
        }
        // Canvas members are a private scope hint, not part of the tool schema.
        teams = teams.map(({ canvasMembers: _canvasMembers, ...row }) => row)
        if (query === '') return { ok: true, query: '', teams, ...(note !== undefined ? { note } : {}) }
        const matches = (team: DirectoryTeamRow): boolean =>
          team.team.toLowerCase().includes(query) || team.name.toLowerCase().includes(query) || team.description.toLowerCase().includes(query)
          || team.session.toLowerCase().includes(query)
          || (team.owner ?? '').toLowerCase().includes(query) || (team.origin ?? '').toLowerCase().includes(query) || (team.workspace ?? '').toLowerCase().includes(query) || (team.via ?? '').toLowerCase().includes(query)
        return { ok: true, query, teams: teams.filter(matches), ...(note !== undefined ? { note } : {}) }
      },
    }))
  }

  function registerStatus(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_status',
      description:
        'Read-only A2A network health: the tracked peer fleet with quality scores, routes currently in flight '
        + '(who is waiting on whom), and the recent routing activity ring (inbound and outbound outcomes). '
        + 'Includes the idempotency window occupancy (claims, replays, conflicts) behind the UNIQUE-ization '
        + 'traffic watch. '
        + 'While teamScopeInfo is on (default), peers / in-flight / activity narrow to the joined-team scope — local traffic and idempotency aggregates stay. '
        + 'Use it to observe an ongoing collaboration or diagnose delivery instead of re-routing.',
      parameters: {},
      output: {
        // gh#198: the host's own verdict on whether this result came from outside this host, persisted on tool/result.
        presentationMeta: peerContentMeta('a2a_status'),
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            peers: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  url: { type: 'string', required: true },
                  score: { type: 'number' },
                },
              },
            },
            inFlight: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  team: { type: 'string', required: true },
                  peer: { type: 'string', required: true },
                  startedAt: { type: 'number', required: true },
                },
              },
            },
            activity: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  ts: { type: 'number', required: true },
                  dir: { type: 'string', required: true },
                  team: { type: 'string', required: true },
                  peer: { type: 'string', required: true },
                  ok: { type: 'boolean', required: true },
                },
              },
            },
            reconciliationReminders: {type:'object',additionalProperties:false,required:true,properties:{observed:{type:'number',required:true},repeatedlyUnreconciled:{type:'number',required:true}}},
            idempotency: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                window: { type: 'number', required: true },
                cap: { type: 'number', required: true },
                pending: { type: 'number', required: true },
                settled: { type: 'number', required: true },
                claimsFresh: { type: 'number', required: true },
                replays: { type: 'number', required: true },
                conflicts: { type: 'number', required: true },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: [
            ...(value.inFlight.length === 0 ? [] : ['In flight:']),
            ...value.inFlight.map((route: { team: string; peer: string }) => `  → ${route.team} via ${route.peer === 'local' ? 'this host' : route.peer}`),
            `Peers (${String(value.peers.length)}):`,
            ...value.peers.map((peer: { url: string; score?: number }) => `  ${peer.url}${typeof peer.score === 'number' ? ` (score ${String(Math.round(peer.score))})` : ''}`),
            `Idempotency window: ${String(value.idempotency.window)}/${String(value.idempotency.cap)} (pending ${String(value.idempotency.pending)}, settled ${String(value.idempotency.settled)}) — claims ${String(value.idempotency.claimsFresh)}, replays ${String(value.idempotency.replays)}, conflicts ${String(value.idempotency.conflicts)}`,
            ...(value.activity.length === 0 ? [] : ['Recent routes:']),
            ...[...value.activity].reverse().slice(0, 10).map((entry: { dir: string; team: string; ok: boolean }) => `  ${entry.dir === 'in' ? '←' : '→'} ${entry.team} ${entry.ok ? 'ok' : 'failed'}`),
          ].join('\n'),
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A network status', kind: 'other', rawInput: null }),
      execute: async (_args, exec): Promise<{
        ok: boolean
        peers: { url: string; score?: number }[]
        inFlight: { team: string; peer: string; startedAt: number }[]
        activity: RouteActivityEntry[]
        idempotency: IdempotencyStats
        reconciliationReminders: {observed:number;repeatedlyUnreconciled:number}
      }> => {
        a2aJoinGateRefusal(exec)
        // S5 open plane: the unscoped snapshot, as before.
        if (!config.teamScopeInfo) {
          return {
            ok: true,
            peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),
            inFlight: [...inFlightRoutes.values()].map(route => ({ team: route.team, peer: route.peer, startedAt: route.startedAt })),
            activity: recentActivity.slice(),
            idempotency: idempotencyStore.stats(),
            reconciliationReminders: reminderSummary(),
          }
        }
        // S5 scoped plane: the tracked fleet narrows to peers whose verified
        // card serves a joined team (bounded-concurrency memoized fetch — a
        // warm sweep costs no extra round trips); routing facts keep
        // host-internal traffic (peer 'local') and drop remote rows whose
        // team is outside the scope, so cross-fleet collaborations stay
        // unread here. The idempotency aggregate is host machinery, not
        // attribution — it stays unscoped like the ledger it serves.
        const joined = joinedTeamScope()
        const resolveLocal = localHandleResolver()
        const visibleTeams = new Set(joined)
        for (const agent of sessionNodes.values()) {
          if (teamMemberships.teamsOf(String(agent.id)).some(team => joined.has(team))) visibleTeams.add(sessionTeamOf(agent))
        }
        // The host's own process-team face is host-internal ALWAYS — a
        // zero-roster host must still see inbound deliveries and outbound
        // attempts addressed to itself (review M2: gating this on
        // joined.size > 0 self-blinded exactly that traffic).
        visibleTeams.add(config.team)
        // G2 (review artifact 688c0354d3 v2): the host-synthetic face rows —
        // the /a2a/log telemetry records under the synthetic team label
        // 'log' (recordActivity('in', 'log', caller) on both admission
        // outcomes) — are THIS host's own face facts, not fleet observation.
        // Scoping filtered them like foreign traffic and hid the host's own
        // inbound log-face telemetry from its own supervisor; they pass.
        visibleTeams.add('log')
        const fetch = memoizedCardFetch()
        const peerRows = await mapBounded(peerStore.list(), SWEEP_CONCURRENCY, async (url: string): Promise<{ url: string; score?: number } | undefined> => {
          const card = await fetch(url)
          return card !== undefined && cardServesJoined(card, joined, resolveLocal) ? { url, score: peerStore.score(url) } : undefined
        })
        const peers = peerRows.filter((row): row is { url: string; score?: number } => row !== undefined)
        const inScope = (entry: { team: string; peer: string }): boolean => entry.peer === 'local' || visibleTeams.has(entry.team)
        return {
          ok: true,
          peers,
          inFlight: [...inFlightRoutes.values()].map(route => ({ team: route.team, peer: route.peer, startedAt: route.startedAt })).filter(inScope),
          activity: recentActivity.filter(inScope),
          idempotency: idempotencyStore.stats(),
          reconciliationReminders: reminderSummary(),
        }
      },
    }))
  }

  function reminderSummary(): {observed:number;repeatedlyUnreconciled:number} {
    const seen=taskLedger.list().filter(row=>row.status==='pending').map(row=>reminderView(taskLedger.reminderState(row.taskId)))
    return {observed:seen.filter(v=>v.reminderAttempts!==undefined).length,repeatedlyUnreconciled:seen.filter(v=>v.repeatedlyUnreconciled).length}
  }

  function registerTasks(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_tasks',
      description:
        'Read-only three-tier ledger of routed A2A tasks: pending rows still owed a receipt, rows '
        + 'auto-dead-lettered past the stale TTL, and the bounded archive of correlated '
        + '`[A2A receipt] task <task_id>` outcomes. Use it to reconcile dispatched async work instead of '
        + 're-routing to ask for progress. answeredAt means the local target answered, not that the receipt arrived; that row stays owed but no longer occupies target queue capacity.',
      parameters: {},
      output: {
        // gh#198: the host's own verdict on whether this result came from outside this host, persisted on tool/result.
        presentationMeta: peerContentMeta('a2a_tasks'),
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            tasks: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  taskId: { type: 'string', required: true },
                  team: { type: 'string', required: true },
                  peer: { type: 'string', required: true },
                  startedAt: { type: 'number', required: true },
                  contextId: { type: 'string' },
                  brief: { type: 'string' },
                  status: { type: 'string', required: true },
                  deadAt: { type: 'number' },
                  answeredAt: { type: 'number' },
                  reminderAttempts: {type:'number'}, reminderDelivered:{type:'number'}, reminderLastAt:{type:'number'}, reminderNextAt:{type:'number'}, reminderResult:{type:'string'}, reminderDiagnostic:{type:'string',enum:['metadata-reset']}, repeatedlyUnreconciled:{type:'boolean'},
                  direction: { type: 'string', enum: ['inbound', 'outbound'] },
                  receiptExpected: { type: 'boolean' },
                  forwarded: { type: 'boolean' },
                  deliveredTo: { type: 'string' },
                  reason: { type: 'string', enum: ['fire-forget', 'unconsumed'] },
                  sender: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      kind: { type: 'string', required: true, enum: ['session', 'host', 'bridge', 'cli'] },
                      id: { type: 'string', required: true },
                      face: { type: 'string' },
                    },
                  },
                },
              },
            },
            archive: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  taskId: { type: 'string', required: true },
                  team: { type: 'string', required: true },
                  startedAt: { type: 'number', required: true },
                  resolvedAt: { type: 'number', required: true },
                  summary: { type: 'string' },
                  brief: { type: 'string' },
                  forwarded: { type: 'boolean' },
                  sender: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      kind: { type: 'string', required: true, enum: ['session', 'host', 'bridge', 'cli'] },
                      id: { type: 'string', required: true },
                      face: { type: 'string' },
                    },
                  },
                },
              },
            },
            archivedTotal: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.tasks.length === 0 && value.archivedTotal === 0
            ? 'No routed tasks are owed a receipt.'
            : [
              ...(() => {
                // C-ruling split (2026-09-01 decision seat): only young,
                // receipt-expected pending rows are settleable debt — the
                // stale tail is conversational noise waiting on the dead
                // TTL; count it, don't list it.
                const pending = value.tasks.filter((task: { status: string }) => task.status === 'pending')
                const settleable = pending.filter((task: { receiptExpected?: boolean; startedAt: number }) => task.receiptExpected !== false && Date.now() - task.startedAt < 60 * 60_000)
                const staleCount = pending.length - settleable.length
                return [
                  ...(settleable.length > 0 ? ['Owed receipts:'] : []),
                  ...settleable.map((task: { taskId: string; team: string; peer: string; startedAt: number; contextId?: string; brief?: string } & Partial<ReminderView>) => {
                    const context = task.contextId === undefined || task.contextId === '' ? '' : `, follow-up context ${task.contextId}`
                    const brief = task.brief === undefined || task.brief === '' ? '' : ` — "${task.brief}"`
                    return `  - ${task.taskId}${brief} → ${task.team} (via ${task.peer === 'local' ? 'this host' : task.peer}), waiting ${describeAge(Date.now() - task.startedAt)}${context}${task.reminderAttempts===undefined?'':` — reminders ${task.reminderDelivered??0}/${task.reminderAttempts}, next ${task.reminderNextAt??0}${task.repeatedlyUnreconciled?' (多次提醒未对账)':''}`}`
                  }),
                  ...(staleCount > 0 ? [`Delivered conversationally without a formal receipt (${String(staleCount)}) — not debts; they auto-dead-letter at the stale TTL.`] : []),
                ]
              })(),
              ...(value.tasks.some((task: { status: string }) => task.status === 'dead') ? ['Dead-lettered (auto-flagged past the stale TTL; a revived target can still settle with a late receipt):'] : []),
              ...value.tasks.filter((task: { status: string }) => task.status === 'dead').map((task: { taskId: string; team: string; peer: string; startedAt: number; contextId?: string; brief?: string }) => {
                const context = task.contextId === undefined || task.contextId === '' ? '' : `, follow-up context ${task.contextId}`
                const brief = task.brief === undefined || task.brief === '' ? '' : ` — "${task.brief}"`
                return `  - ${task.taskId}${brief} → ${task.team} (via ${task.peer === 'local' ? 'this host' : task.peer}), dispatched ${describeAge(Date.now() - task.startedAt)} ago${context}`
              }),
              ...(value.archivedTotal > 0 ? [`Archived (${String(value.archivedTotal)}), most recent first:`] : []),
              ...value.archive.map((entry: { taskId: string; team: string; startedAt: number; resolvedAt: number; summary?: string; brief?: string }) => {
                const brief = entry.brief === undefined || entry.brief === '' ? '' : ` — "${entry.brief}"`
                return `  - ${entry.taskId}${brief} → ${entry.team}: after ${describeAge(entry.resolvedAt - entry.startedAt)}, ${entry.summary === undefined || entry.summary === '' ? 'resolved' : entry.summary}`
              }),
              ...(value.archivedTotal > value.archive.length ? [`  (+${String(value.archivedTotal - value.archive.length)} older not shown)`] : []),
            ].join('\n'),
        }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A task ledger', kind: 'other', rawInput: null }),
      execute: async (_args, exec): Promise<{ ok: boolean; tasks: ({ taskId: string; team: string; peer: string; startedAt: number; contextId?: string; brief?: string; status: 'pending' | 'dead'; deadAt?: number; answeredAt?: number; reason?: 'fire-forget' | 'unconsumed'; direction?: 'inbound' | 'outbound'; receiptExpected?: boolean; forwarded?: true; deliveredTo?: string; sender?: Sender } & Partial<ReminderView>)[]; archive: { taskId: string; team: string; startedAt: number; resolvedAt: number; summary?: string; brief?: string; sender?: Sender }[]; archivedTotal: number }> => {
        a2aJoinGateRefusal(exec)
        observeAuthorization('lazy')
        const archiveAll = taskLedger.archive()
        return {
          ok: true,
          // Project the declared fields only: ledger rows also carry internal audit facts (the #114 auth record,
          // #139 peerKey/peerHost) the output schema does not admit — spreading the row failed every call (0.6.32+).
          tasks: taskLedger.list().map(({ taskId, team, peer, startedAt, contextId, brief, status, deadAt, answeredAt, direction, receiptExpected, forwarded, deliveredTo, reason, sender }) => ({
            taskId, team, peer, startedAt, status, ...reminderView(taskLedger.reminderState(taskId)),
            ...(contextId !== undefined ? { contextId } : {}),
            ...(brief !== undefined ? { brief } : {}),
            ...(deadAt !== undefined ? { deadAt } : {}),
            ...(answeredAt !== undefined ? { answeredAt } : {}),
            ...(direction !== undefined ? { direction } : {}),
            ...(receiptExpected !== undefined ? { receiptExpected } : {}),
            ...(forwarded !== undefined ? { forwarded } : {}),
            ...(deliveredTo !== undefined ? { deliveredTo } : {}),
            ...(reason !== undefined ? { reason } : {}),
            ...(sender !== undefined ? { sender } : {}),
          })),
          archive: archiveAll.slice(0, 5).map(({ taskId, team, startedAt, resolvedAt, summary, brief, sender }) => ({ taskId, team, startedAt, resolvedAt, ...(summary !== undefined && summary !== '' ? { summary } : {}), ...(brief !== undefined ? { brief } : {}), ...(sender !== undefined ? { sender } : {}) })),
          archivedTotal: archiveAll.length,
        }
      },
    }))
  }

  function registerProbe(): void {

    ctx.tools.register(defineTool({
      name: 'a2a_probe',
      description:
        'Probe the tracked peer fleet for reachability and round-trip latency: one verified-card fetch per peer '
        + '(the same fetch discovery uses), reporting reachable peers with their team and latency and unreachable '
        + 'ones with the failure reason. Pass url to probe one target instead of the whole fleet. '
        + 'While teamScopeInfo is on (default), the sweep covers only peers serving a joined team, and a single URL is refused unless its verified card proves service. '
        + 'Use it before dispatching verification work or when routes fail over, instead of guessing which node is down.',
      parameters: {
        url: { type: 'string', description: 'Optional single peer base URL to probe; empty probes every tracked peer.' },
      },
      output: {
        // gh#198: the host's own verdict on whether this result came from outside this host, persisted on tool/result.
        presentationMeta: peerContentMeta('a2a_probe'),
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            results: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  url: { type: 'string', required: true },
                  reachable: { type: 'boolean', required: true },
                  ms: { type: 'number', description: 'Round-trip of the card fetch, reachable or not.' },
                  team: { type: 'string', description: 'The team the peer publishes, when reachable.' },
                  error: { type: 'string', description: 'Why the peer is unreachable.' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.results.length === 0
            ? 'No peers are tracked; add seeds or let referrals arrive.'
            : [
              `Fleet probe (${String(value.results.length)}): ${String(value.results.filter((row: { reachable: boolean }) => row.reachable).length)} reachable, ${String(value.results.filter((row: { reachable: boolean }) => !row.reachable).length)} down`,
              ...value.results.map((row: { url: string; reachable: boolean; ms?: number; team?: string; error?: string }) =>
                `  ${row.reachable ? '✓' : '✗'} ${row.url}${row.reachable ? ` (team ${String(row.team)}, ${String(row.ms)}ms)` : ` (${String(row.error)})`}`),
            ].join('\n'),
        }],
      },
      presentCall: args => ({ card: 'generic', title: args.url === undefined || args.url === '' ? 'Probe the A2A fleet' : `Probe A2A peer: ${args.url}`, kind: 'other', rawInput: args }),
      execute: async (args: { url?: string }, exec): Promise<{ ok: boolean; results: { url: string; reachable: boolean; ms: number; team?: string; error?: string }[] }> => {
        a2aJoinGateRefusal(exec)
        const probeOne = async (url: string): Promise<{ url: string; reachable: boolean; ms: number; team?: string; error?: string }> => {
          const startedAt = Date.now()
          const outcome = await client.fetchCardDetail(url)
          const ms = Date.now() - startedAt
          // The fetch is the probe: settling it moves the peer's quality score
          // and learns its referrals, exactly like a discovery sweep would,
          // while the outcome's stage names the failure for the report.
          const card = settlePeerCard(url, outcome)
          if (card !== undefined) {
            // gh#71 fix ①: a successful full-face fetch persists into the warm
            // cache — the probe is often the FIRST contact (no directory sweep
            // has run), and the state face's peerOrg reads exactly this cache.
            cardCache.set(url, { at: Date.now(), card })
            return { url, reachable: true, ms, team: card.team }
          }
          if (outcome.ok) return { url, reachable: false, ms, error: 'dropped: the card lists this node back as its own referral' }
          return outcome.stage === 'unreachable'
            ? { url, reachable: false, ms, error: `unreachable: ${outcome.detail}` }
            : { url, reachable: false, ms, error: `rejected: ${outcome.reason} card` }
        }
        // S5: a reachability report is fleet disclosure too. The sweep probes
        // only peers whose verified card serves a joined team (memoized —
        // warm cards cost nothing); a single-URL probe needs proof of service
        // — a FRESH card, or a stale cached one: a peer that once served a
        // joined team and is now down gets the normal down report (that
        // reachability fact belongs to the team), while a URL that never
        // proved service is refused without a probe (its reachability is
        // exactly the fact scoping withholds).
        const joined = joinedTeamScope()
        const resolveLocal = localHandleResolver()
        const fetch = memoizedCardFetch()
        const serves = async (url: string): Promise<boolean> => {
          const card = await fetch(url)
          return card !== undefined && cardServesJoined(card, joined, resolveLocal)
        }
        if (args.url !== undefined && args.url !== '') {
          if (config.teamScopeInfo && !(await serves(args.url))) {
            const stale = cardCache.get(args.url)?.card
            if (stale !== undefined && cardServesJoined(stale, joined, resolveLocal)) {
              // Was serving, now unverifiable fresh — probe and report the
              // down state through the normal path.
              return { ok: true, results: await Promise.all([args.url].map(probeOne)) }
            }
            return { ok: true, results: [{ url: args.url, reachable: false, ms: 0, error: stale === undefined
              ? 'refused (not probed): teamScopeInfo on — no verified card for this URL proves service to a joined team'
              : 'refused (not probed): teamScopeInfo on — this URL\'s verified card shows no team joined by this host\'s nodes' }] }
          }
          return { ok: true, results: await Promise.all([args.url].map(probeOne)) }
        }
        const targets = config.teamScopeInfo
          ? await mapBounded(peerStore.list(), SWEEP_CONCURRENCY, async (url: string) => await serves(url) ? url : undefined).then(rows => rows.filter((url): url is string => url !== undefined))
          : peerStore.list()
        // Promise.all keeps the report in the store's preference order.
        return { ok: true, results: await Promise.all(targets.map(probeOne)) }
      },
    }))
  }

  return { registerWhoami, registerTeams, registerStatus, registerTasks, registerProbe }
}
