/**
 * The `/__dsh_a2a/*` admin faces and the two workbench pages (gh#77 batch B1).
 *
 * Moved verbatim out of `apply()` in `src/index.ts`: the routes register
 * when the web server settles, exactly as before. What used to be closure
 * captures now arrives through {@link AdminFaceDeps}:
 * - stable bindings (stores, helpers, config) are destructured once below, so
 *   the route bodies read as they did in index.ts;
 * - the six `let` bindings the routes read or write go through accessors on
 *   `d` (`d.ownerAllowlist = …` writes back into index.ts), keeping the live
 *   binding semantics of the closure; so does `cardCache`, which apply()
 *   declares after this registration (a destructure would hit its TDZ);
 * - `indexUrl` is index.ts's `import.meta.url`: the asset roots
 *   (`../assets/stageDist`, `../assets/nexusDist`) resolve against the
 *   entry module, not this file (tsc mirrors src/ under lib/).
 * @module src/faces/admin
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Config } from '../index.ts'
import type { CardCacheEntry, InFlightRoute, RouteActivityEntry } from '../runtime.ts'
import { CanvasStore, isRemoteMemberRef, validRemoteMemberRef } from '../canvas-store.ts'
import { refreshPeerCard, registerCanvasNotify, type CanvasNotifyDeps } from './canvas-notify.ts'
import type { CliDepositStore } from '../cli-deposit.ts'
import type { ExposureStore } from '../exposure-store.ts'
import type { GroupStore } from '../group-store.ts'
import type { IdempotencyStore } from '../idempotency-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import type { LayoutStore } from '../layout-store.ts'
import { applyOwnerSettings, type OwnerSettings } from '../owner-settings.ts'
import type { PeerStore } from '../peer-store.ts'
import { resolveStageMount } from '../stage-mount.ts'
import { ARCHIVE_CAP, archivedEndedBy, type TaskLedger } from '../task-ledger.ts'
import type { TeamMembershipStore } from '../team-store.ts'
import { MAX_LAYOUT_BODY_BYTES } from '../transport-caps.ts'

/** Remote-team rows cached for the state face (see refreshRemoteRows). */
export type RemoteRowsCache = { at: number; rows: { team: string; name: string; origin?: string; via?: string; workspace?: string; legacy?: boolean; teams?: readonly string[] }[] } | undefined

/** Everything the admin faces used to capture from `apply()`. */
export interface AdminFaceDeps extends Pick<CanvasNotifyDeps, 'verifyOriginClaim' | 'callerLinkedToThisHost' | 'cachedCardFetch'> {
  readonly ctx: Context
  readonly config: Config
  readonly logger: ReturnType<Context['logger']>
  readonly home: string
  readonly session: string
  readonly lanIp: string
  readonly PLUGIN_VERSION: string
  /** index.ts's `import.meta.url` — the base the asset roots resolve against. */
  readonly indexUrl: string
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly controlTrustedWithoutKey: (req: IncomingMessage) => boolean
  readonly readJsonBody: (req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void, maxBytes?: number) => void
  readonly peerStore: PeerStore
  readonly peerLinkState: (peerUrl: string) => { link: 'linked' | 'stranger'; verified: boolean }
  readonly originClaimHeaders: () => Record<string, string>
  readonly refreshRemoteRows: () => void
  readonly joinedSessions: JoinedSessions
  readonly exposureStore: ExposureStore
  readonly teamMemberships: TeamMembershipStore
  readonly cliDeposits: CliDepositStore
  readonly groupStore: GroupStore
  readonly canvasStore: CanvasStore
  readonly layoutStore: LayoutStore
  readonly taskLedger: TaskLedger
  /** #114 S6: observe (lazily) and return the /state `authorization` block. */
  readonly authorizationView: () => unknown
  readonly idempotencyStore: IdempotencyStore
  readonly inFlightRoutes: Map<number, InFlightRoute>
  readonly recentActivity: RouteActivityEntry[]
  readonly teamAuditRing: { at: number; action: 'join' | 'leave' | 'archive-prune' | 'agent-less'; team: string; id: string; ok: boolean; reason?: string }[]
  readonly reportRing: { at: number; level: 'info' | 'warning' | 'error'; message: string; session: string; task?: string }[]
  readonly sessionNodes: Map<string, Agent>
  readonly liveRoots: Map<string, Agent>
  readonly mountSessionNode: (agent: Agent) => void
  readonly coldJoinedIds: () => Promise<Set<string>>
  readonly prewarmStatus: { state: 'off' | 'skipped:no-wake-face' | 'draining' | 'done' | 'cancelled'; attempted: number; woken: number; failed: Array<{ id: string; error: string }> }
  readonly reconcileStatus: { state: 'off' | 'idle' | 'draining'; lastTickAt: number; lastChecked: number; woken: number; rows: Array<{ id: string; error: string; attempts: number; nextRetryAt: number; needsRepair: boolean }> }
  readonly id8: (id: string) => string
  readonly sessionLabelOf: (agent: Agent) => string
  readonly sessionTeamOf: (agent: Agent) => string
  readonly nodeMetadataOf: (agent: Agent) => { name: string; description: string; workspace?: string }
  readonly canvasTeamOf: (name: string) => string
  readonly archivedSessionFilter: () => ((id: string) => boolean) | undefined
  readonly pruneArchivedJoins: () => void
  readonly pruneCanvasMemberships: () => void
  // Read at use time through `d` (accessors onto index.ts's bindings).
  readonly cardCache: Map<string, CardCacheEntry>
  readonly remoteRowsCache: RemoteRowsCache
  readonly legacyInboundCount: number
  readonly ownCardUrl: string
  ownerAllowlist: string[]
  ownerTeamScopeInfo: boolean
  ownerAnnounceRestartPending: boolean
}

/**
 * Register the admin faces on a settled web server.
 * @param webServer - the settled host web server.
 * @param d - the captures listed on {@link AdminFaceDeps}.
 */
export function registerAdminFaces(webServer: WebServer, d: AdminFaceDeps): void {
  const {
    ctx,
    config,
    logger,
    home,
    session,
    lanIp,
    PLUGIN_VERSION,
    indexUrl,
    controlRoute,
    controlTrustedWithoutKey,
    readJsonBody,
    peerStore,
    peerLinkState,
    originClaimHeaders,
    refreshRemoteRows,
    joinedSessions,
    exposureStore,
    teamMemberships,
    cliDeposits,
    groupStore,
    canvasStore,
    layoutStore,
    taskLedger,
    authorizationView,
    idempotencyStore,
    inFlightRoutes,
    recentActivity,
    teamAuditRing,
    reportRing,
    sessionNodes,
    liveRoots,
    mountSessionNode,
    coldJoinedIds,
    prewarmStatus,
    reconcileStatus,
    id8,
    sessionLabelOf,
    sessionTeamOf,
    nodeMetadataOf,
    canvasTeamOf,
    archivedSessionFilter,
    pruneArchivedJoins,
    pruneCanvasMemberships,
  } = d
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/state',
    handler: controlRoute((_req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const t0 = Date.now()
        // The panel polls this route: pruning here makes a mid-session
        // archive leave the network within one poll interval, no restart
        // required.
        pruneArchivedJoins()
        pruneCanvasMemberships()
        const tPrune = Date.now()
        const assignments = groupStore.all()
        const groupOf = (id: string): string | undefined => {
          const name = assignments[id]
          return name === undefined ? undefined : name
        }
        // Archived sessions are closed: the GUI hides them everywhere, so
        // the panel must not re-list them as join surface rows — joined
        // or not. (The prune above already took their join intents; this
        // covers never-joined live roots and any intent a restart left.)
        const isArchived = archivedSessionFilter()
        const tFacts0 = Date.now()
        const sessions: Array<Record<string, unknown>> = [...liveRoots.values()]
          .filter(agent => isArchived?.(String(agent.id)) !== true)
          .map(agent => ({
            id: String(agent.id),
            label: sessionLabelOf(agent),
            team: sessionTeamOf(agent),
            ...nodeMetadataOf(agent),
            joined: sessionNodes.has(String(agent.id)),
            live: true,
            teams: [...teamMemberships.teamsOf(String(agent.id))],
            // #19 D3: the session's exposure tier (linked floor /
            // fleet opt-up) — readable on the state face.
            exposure: exposureStore.tierOf(String(agent.id)),
            ...(canvasStore.teamsOf(String(agent.id)).length > 0 ? { canvasTeams: [...canvasStore.teamsOf(String(agent.id))] } : {}),
            ...(groupOf(String(agent.id)) !== undefined ? { group: groupOf(String(agent.id)) } : {}),
          }))
        // Cold joined sessions: a remembered intent whose Agent is not
        // back yet (host restarted, session not opened). The row carries
        // no facts — the Web client merges the session title from its
        // own list — and wakes through the normal session-open path,
        // after which the remount above joins it automatically.
        // Cold rows only exist when a joined intent lacks a live agent;
        // with all intents live (or none) the persistence layer is never
        // asked and the handler stays synchronous to its response.
        const tFacts1 = Date.now()
        const coldCandidates = joinedSessions.list().filter(id => !liveRoots.has(id))
        const persistence = ctx.get('sessionPersistence')
        const persisted = persistence !== undefined && coldCandidates.length > 0 ? await coldJoinedIds() : new Set<string>()
        const tCold = Date.now()
        for (const id of coldCandidates) {
          // Archived intents are retained on disk (an archived window is
          // transient; the 3081 wake defect came from deleting them), so
          // the join surface must skip them here instead.
          if (!persisted.has(id) || isArchived?.(id) === true) continue
          sessions.push({
            id,
            label: `${session}-${id8(id)}`,
            team: `${config.team}/${id8(id)}`,
            joined: true,
            live: false,
            teams: [...teamMemberships.teamsOf(id)],
            ...(canvasStore.teamsOf(id).length > 0 ? { canvasTeams: [...canvasStore.teamsOf(id)] } : {}),
            ...(groupOf(id) !== undefined ? { group: groupOf(id) } : {}),
          })
        }
        const body = JSON.stringify({
          nodes: true,
          version: PLUGIN_VERSION,
          sessions,
          groups: groupStore.list(),
          canvas: {
            teams: canvasStore.list().map(name => ({
              name,
              team: canvasTeamOf(name),
              members: canvasStore.membersOf(name).map(id => {
                // Dual shape: local members report this zone's join/live
                // facts; remote refs are opaque team handles — the state
                // face passes them through with remote:true for the
                // workbench's member chips and pickers.
                if (isRemoteMemberRef(id)) {
                  return { id, team: id, remote: true }
                }
                return {
                  id,
                  team: `${config.team}/${id8(id)}`,
                  joined: sessionNodes.has(id) || joinedSessions.has(id),
                  live: sessionNodes.has(id),
                }
              }),
            })),
          },
          host: lanIp === '' ? {} : { lanIp },
          // gh#20 W-C (host rail): each peer row also carries its display
          // name and version from the warm card (absent until a fetch),
          // and the last-contact timestamp for the health lamp. W-A's
          // link/verified ride along for the badge.
          peers: peerStore.list().map(url => {
            const card = d.cardCache.get(url)?.card
            const lastContact = peerStore.lastContact(url)
            const lastContactOk = peerStore.lastContactOk(url)
            return {
              url,
              score: peerStore.score(url),
              ...(card?.name !== undefined && card.name !== '' ? { name: card.name } : {}),
              ...(typeof card?.version === 'string' && card.version !== '' ? { version: card.version } : {}),
              ...(lastContact !== undefined ? { lastContactAt: lastContact } : {}),
              ...(lastContactOk !== undefined ? { lastContactOk } : {}),
              ...peerLinkState(url),
            }
          }),
          remote: (refreshRemoteRows(), (d.remoteRowsCache?.rows ?? []).map(row => {
            const canvasTeams = canvasStore.teamsOf(row.team)
            return canvasTeams.length > 0 ? { ...row, canvasTeams: [...canvasTeams] } : row
          })),
          activity: recentActivity.slice(),
          inFlight: [...inFlightRoutes.values()].map(route => ({
            team: route.team,
            peer: route.peer,
            startedAt: route.startedAt,
          })),
          // Owed receipts: pending rows only — the cross-turn waits the
          // in-flight ring cannot show. Dead-lettered rows ride their own
          // list and settled ones just a count, all additive so the panel
          // keeps rendering plain owed rows until it learns the tiers.
          tasks: taskLedger.list()
            .filter(task => task.status === 'pending')
            .map(task => ({
              taskId: task.taskId, team: task.team, peer: task.peer, startedAt: task.startedAt, status: task.status,
              direction: task.direction ?? 'outbound', receiptExpected: task.receiptExpected !== false,
              // The dispatch brief rides every row: a task id and a team
              // say nothing about WHAT is owed — supervision cannot tell
              // a nudge from an abandon without it.
              ...(task.brief !== undefined ? { brief: task.brief } : {}),
              // #114 S3: the real sender, so supervision buckets by seat, not "home".
              ...(task.sender !== undefined ? { sender: task.sender } : {}),
              // #114 S2: the authority an inbound row was born with.
              ...(task.auth !== undefined ? { auth: task.auth } : {}),
              // C-ruling bucket split: a pending row is settleable while
              // it is young, expected, and answerable; past the stale
              // hour it is conversational noise waiting on the dead TTL.
              settleable: task.receiptExpected !== false && Date.now() - task.startedAt < 60 * 60_000,
            })),
          // C face: the stale/conversational tail as a count, so the
          // panel can render only truly settleable debt.
          tasksStaleCount: taskLedger.list().filter(task => task.status === 'pending' && (task.receiptExpected === false || Date.now() - task.startedAt >= 60 * 60_000)).length,
          tasksDead: taskLedger.list()
            .filter(task => task.status === 'dead')
            .map(task => ({ taskId: task.taskId, team: task.team, peer: task.peer, startedAt: task.startedAt, deadAt: task.deadAt ?? task.startedAt, reason: task.reason ?? 'unspecified', ...(task.brief !== undefined ? { brief: task.brief } : {}), ...(task.direction !== undefined ? { direction: task.direction } : {}), ...(task.sender !== undefined ? { sender: task.sender } : {}), ...(task.auth !== undefined ? { auth: task.auth } : {}) })),
          // gh#31: per-task outcomes for rows that LEFT the ledger — the
          // chat drawer used to guess (settled, abandoned or cancelled).
          // Bounded to the archive (≤64), newest first, with the
          // controlled-vocabulary verdict each row settled by.
          // gh#31 follow-up: archive() is already newest first (settles
          // prepend), so the projection keeps that order — the earlier
          // .reverse() served it oldest first. Each row also says HOW it
          // ended (endedBy: abandon and cancel both record outcome
          // 'abandoned', and so does a peer's own 'abandoned' receipt),
          // whether a receipt came after the caller ended it (late), and
          // its direction when known.
          archived: taskLedger.archive().slice(0, ARCHIVE_CAP).map(row => ({
            taskId: row.taskId,
            team: row.team,
            peer: row.peer,
            startedAt: row.startedAt,
            resolvedAt: row.resolvedAt,
            outcome: row.outcome ?? 'unclassified',
            endedBy: archivedEndedBy(row),
            ...(row.direction !== undefined ? { direction: row.direction } : {}),
            // gh#68: present only when the row awaited no receipt.
            ...(row.receiptExpected === false ? { receiptExpected: false } : {}),
            ...(row.lateReceiptAt !== undefined ? { late: true } : {}),
            ...(row.brief !== undefined ? { brief: row.brief } : {}),
            ...(row.summary !== undefined && row.summary !== '' ? { summary: row.summary.slice(0, 160) } : {}),
            ...(row.sender !== undefined ? { sender: row.sender } : {}),
            ...(row.auth !== undefined ? { auth: row.auth } : {}),
          })),
          archivedCount: taskLedger.archive().length,
          // #114 S6: allowlist version history and the affected-task entries
          // (observe mode: a record of what an allowlist change put on another
          // footing — nothing was cancelled).
          authorization: authorizationView(),
          // Ledger density face: the settled archive split by verdict, so
          // the workbench can say WHICH way those rows settled instead of
          // just how many. Additive and bounded (outcome vocabulary is a
          // closed set); rows without an envelope outcome count as
          // 'unclassified' rather than being dropped.
          archivedSplit: (() => {
            const split: Record<string, number> = {}
            for (const row of taskLedger.archive()) {
              const key = row.outcome ?? 'unclassified'
              split[key] = (split[key] ?? 0) + 1
            }
            return split
          })(),
          // 0.5.36 observability: the idempotency window aggregate —
          // window occupancy, outcome split, and cumulative claim-verdict
          // counters (the data the UNIQUE-ization decision waits on).
          // Read-only; no fingerprints cross here (they are /a2a/query's
          // only auth material).
          idempotency: idempotencyStore.stats(),
          // gh#41 fleet planning: each tracked peer's published canvas
          // org (full-card canvasOrg) from the warm card cache — the
          // board renders REMOTE team frames from this. Absent until a
          // linked fetch warmed the card.
          peerOrg: peerStore.list().map(url => {
            const card = d.cardCache.get(url)?.card
            const org = (card as { canvasOrg?: unknown } | undefined)?.canvasOrg
            return Array.isArray(org)
              ? { url, org: org.filter((e): e is { name: unknown; team: unknown; members: unknown } => e !== null && typeof e === 'object')
                  .map(e => ({ name: typeof e.name === 'string' ? e.name : '', team: typeof e.team === 'string' ? e.team : '', members: Array.isArray(e.members) ? e.members.filter((m): m is string => typeof m === 'string') : [] }))
                  .filter(e => e.team !== '') }
              : { url, org: [] }
          }),
          // gh#9+gh#10 M1: envelope-absent deliveries during the
          // OriginClaim window — the operator watches this drain to
          // zero before closing the window.
          legacyInbound: d.legacyInboundCount,
          // gh#113: CLI mailbox loss, all handles — mail the 64-row cap
          // pushed out, and mail cut at 4000 chars. The team verifier
          // holds `dropped` to zero.
          cliMailbox: cliDeposits.mailStats(),
          // F-observability: the boot prewarm's lifecycle — a dead or
          // skipped prewarm is the root shape behind "cold rows pile up
          // after restart" and must be readable, not a console rumor.
          prewarm: { ...prewarmStatus, failed: [...prewarmStatus.failed] },
          // F8 observability: reconciliation cadence, wake outcomes,
          // and per-row failure reasons with backoff and the parked
          // needs-repair state — the cold row's "why am I still cold".
          reconcile: { ...reconcileStatus, rows: [...reconcileStatus.rows] },
          // S1: flat node registry — local sessions and remote card
          // nodes in one table, zone-qualified team handles as the
          // stable cross-host addresses. Local ids are the session
          // UUIDs; remote ids are the publishing team handles. (The
          // `nodes` boolean above is the capability flag the panel
          // already consumes; this face rides its own key.)
          registry: {
            nodes: [
              ...sessions.map(row => ({
                id: String(row.id),
                label: String(row.label ?? ''),
                team: String(row.team ?? ''),
                zone: config.team,
                live: row.live === true,
                joined: row.joined === true,
                ...(typeof row.workspace === 'string' && row.workspace !== '' ? { workspace: row.workspace } : {}),
                teams: [...teamMemberships.teamsOf(String(row.id))],
              })),
              ...(d.remoteRowsCache?.rows ?? []).map(row => ({
                id: String(row.team),
                label: String(row.name ?? ''),
                team: String(row.team),
                zone: String(row.team).split('/')[0] ?? config.team,
                host: String(row.origin ?? ''),
                ...(row.workspace !== undefined && row.workspace !== '' ? { workspace: row.workspace } : {}),
                ...(row.legacy === true ? { legacy: true } : {}),
                teams: [...(row.teams ?? [])],
                remote: true,
              })),
            ],
            // S2: local team rosters rebuilt from member declarations.
            teams: (() => {
              const roster = new Map<string, string[]>()
              for (const entry of teamMemberships.list()) {
                for (const team of entry.teams) {
                  const members = roster.get(team) ?? []
                  members.push(entry.session)
                  roster.set(team, members)
                }
              }
              return [...roster.entries()].map(([team, members]) => ({
                team,
                members,
                live: members.filter(member => liveRoots.has(member)).length,
              }))
            })(),
            // S4 audit face: join/leave attempts with outcomes — the
            // queryable half that rotating log lines cannot be.
            teamAudit: [...teamAuditRing],
          },
          // Unjoined-node reports: the one-way signal ring (design:
          // docs/design/unjoined-report-ingress.md), newest first.
          reports: [...reportRing].reverse(),
        })
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          // Phase timing (ms since request start): prune / live-row facts /
          // cold-rows enumeration. Diagnostic for the poll-latency question.
          'X-A2A-Timing': `prune=${tPrune - t0};facts=${tFacts1 - tFacts0};cold=${tCold - tFacts1};total=${Date.now() - t0}`,
        })
        res.end(body)
      })()
    }),
  }), 'a2a: session-node state route')
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/join',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, (body) => {
        const agent = typeof body.id === 'string' ? liveRoots.get(body.id) : undefined
        if (agent === undefined) {
          const payload = JSON.stringify({ error: 'no live session with that id' })
          res.writeHead(404, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
          return
        }
        mountSessionNode(agent)
        joinedSessions.add(String(agent.id))
        const payload = JSON.stringify({ id: body.id, label: sessionLabelOf(agent), team: sessionTeamOf(agent) })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    }),
  }), 'a2a: session-node join route')
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/leave',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, (body) => {
        const id = typeof body.id === 'string' ? body.id : ''
        if (id !== '') sessionNodes.delete(id)
        joinedSessions.remove(id)
        // Leaving the network leaves every canvas team too: membership
        // without join consent would be a routing backdoor. Team
        // roster declarations die the same way (S2 consistency).
        canvasStore.dropMember(id)
        teamMemberships.dropSession(id)
        const payload = JSON.stringify({ id })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    }),
  }), 'a2a: session-node leave route')
  // gh#45 CLI 户口 control face (loopback/key gated like every write):
  // publish (deposit a signed CLI card, ≤4h by ruling), revoke, list,
  // and mailbox readout — the CLI polls this while alive.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/cli-deposit',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, (body) => {
        const action = (body as { action?: unknown }).action
        let payload: string
        if (action === 'publish') {
          const card = typeof (body as { card?: unknown }).card === 'string' ? (body as { card: string }).card : ''
          // Review of PR #135: a CLI may not be named after this host's zone —
          // its handle would read as one of the zone's own faces.
          const name = (() => { try { const team = (JSON.parse(card) as { team?: unknown }).team; return typeof team === 'string' ? team.split('/')[0] : '' } catch { return '' } })()
          const out = name === config.team ? { ok: false as const, error: `a CLI identity may not be named after this host's zone "${config.team}" — choose another agent name` } : cliDeposits.deposit(card)
          payload = JSON.stringify(out.ok
            ? { ok: true, handle: out.handle, expiresAt: out.expiresAt, cardUrl: `${d.ownCardUrl}/a2a/cli/${encodeURIComponent(out.handle)}` }
            : { ok: false, error: out.error })
        } else if (action === 'revoke') {
          payload = JSON.stringify({ ok: cliDeposits.revoke(typeof (body as { handle?: unknown }).handle === 'string' ? (body as { handle: string }).handle : '') })
        } else if (action === 'inbox') {
          const handle = typeof (body as { handle?: unknown }).handle === 'string' ? (body as { handle: string }).handle : ''
          // gh#113: seq bounds and the loss counter ride beside the rows; after_seq trims to newer rows.
          const after = (body as { after_seq?: unknown }).after_seq
          const box = cliDeposits.readMailbox(handle, typeof after === 'number' && Number.isInteger(after) && after >= 0 ? after : undefined)
          payload = JSON.stringify({ ok: true, ...box })
        } else {
          payload = JSON.stringify({ ok: true, deposits: cliDeposits.list().map(row => ({ handle: row.handle, name: row.name, depositedAt: row.depositedAt, expiresAt: row.expiresAt })) })
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    }),
  }), 'a2a: cli-deposit route')
  // gh#41 fleet planning relay: the GUI asks THIS host to regulate a
  // REMOTE peer's canvas team. The node key never leaves the server —
  // the relay stamps the OriginClaim envelope and forwards to the
  // peer's /a2a/canvas-op face; the peer's link gate authorizes.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/fleet-canvas-op',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, async (body) => {
        const { peer, op, name, id } = body as { peer?: unknown; op?: unknown; name?: unknown; id?: unknown }
        const peerUrl = typeof peer === 'string' ? peer : ''
        const opV = typeof op === 'string' ? op : ''
        const nameV = typeof name === 'string' ? name : ''
        const idV = typeof id === 'string' ? id : ''
        const send = (payload: string): void => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        }
        if (peerUrl === '' || !/^https?:\/\//.test(peerUrl) || !['create', 'add-member', 'remove-member', 'remove'].includes(opV) || (opV !== 'create' && nameV === '')) {
          send(JSON.stringify({ ok: false, error: 'peer (http url), op (create | add-member | remove-member | remove), and name are required' }))
          return
        }
        if (!peerStore.list().includes(peerUrl)) {
          send(JSON.stringify({ ok: false, error: `peer ${peerUrl} is not tracked — regulate tracked peers only` }))
          return
        }
        try {
          const target = peerUrl.replace(/\/$/, '') + '/a2a/canvas-op'
          const reply = await globalThis.fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...originClaimHeaders() },
            // A local session id means nothing on the peer: send its zone/id8 handle (the workbench
            // drops a local card into a remote frame with its raw session id, which the peer refused).
            body: JSON.stringify({ op: opV, name: nameV, ...(opV === 'add-member' || opV === 'remove-member' ? { id: idV !== '' && !isRemoteMemberRef(idV) && (sessionNodes.has(idV) || joinedSessions.has(idV)) ? `${config.team}/${id8(idV)}` : idV } : {}) }),
            signal: AbortSignal.timeout(15_000),
          })
          const raw = await reply.text()
          try {
            const out = JSON.parse(raw) as Record<string, unknown>
            // Single owner + mirror: the op landed on the owner — re-read its
            // card, but never gate the reply on it (two serial card fetches can
            // hang the workbench ~30s past a landed op; the owner's own
            // canvas-changed ping is the freshness backstop). PR#96 review P2-1.
            if (out.ok === true) void refreshPeerCard(d, peerUrl)
            send(JSON.stringify(out))
          } catch {
            // A non-JSON reply is a peer WITHOUT the canvas-op face (a
            // pre-gh41 build) or a proxy page — name the shape honestly.
            send(JSON.stringify({ ok: false, error: `peer ${peerUrl} answered HTTP ${String(reply.status)} without JSON — it likely runs a build without the fleet canvas-op face (pre gh#41); upgrade it, or regulate its teams on that host directly` }))
          }
        } catch (error) {
          send(JSON.stringify({ ok: false, error: `fleet op failed: ${error instanceof Error ? error.message : String(error)}` }))
        }
      })
    }),
  }), 'a2a: fleet-canvas-op relay route')
  // Owner ruling 2026-10-29 (single owner + mirror): tell linked peers to re-read this host's card on any canvas change.
  registerCanvasNotify(webServer, d)
  // gh#34 owner three-key panel: the remote build-out unlock knobs,
  // surfaced as a control face instead of "翻配置文件". GET reads the
  // effective values; POST writes the HOME patch layer (the
  // authoritative surface) AND hot-applies the two call-time keys
  // (teamJoinAllowlist / teamScopeInfo); announce is boot-time
  // publishing, so its change lands on the next host restart and the
  // reply says so. Same key gate as every write face.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/owner-settings',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        const payload = JSON.stringify({
          ok: true,
          teamJoinAllowlist: [...d.ownerAllowlist],
          teamScopeInfo: d.ownerTeamScopeInfo,
          announce: config.announce === true,
          announceRestartPending: d.ownerAnnounceRestartPending,
        })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }
      readJsonBody(req, res, (rawBody) => {
        const body = rawBody as Record<string, unknown>
        const changes: OwnerSettings = {}
        if (Array.isArray(body.teamJoinAllowlist)) {
          const list = (body.teamJoinAllowlist as unknown[]).filter((name): name is string => typeof name === 'string' && name !== '' && name.length <= 128)
          changes.teamJoinAllowlist = [...new Set(list)]
        }
        if (typeof body.teamScopeInfo === 'boolean') changes.teamScopeInfo = body.teamScopeInfo
        if (typeof body.announce === 'boolean') changes.announce = body.announce
        if (Object.keys(changes).length === 0) {
          const payload = JSON.stringify({ ok: false, error: 'no recognized keys: teamJoinAllowlist (string[]), teamScopeInfo (bool), announce (bool)' })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
          return
        }
        try {
          const patchPath = join(home, 'cordis.patch.yml')
          const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
          const { yaml, restartNeeded } = applyOwnerSettings(current, changes)
          mkdirSync(home, { recursive: true })
          writeFileSync(patchPath, yaml, 'utf8')
          // Hot-apply the two call-time keys.
          if (changes.teamJoinAllowlist !== undefined) d.ownerAllowlist = [...changes.teamJoinAllowlist]
          if (changes.teamScopeInfo !== undefined) d.ownerTeamScopeInfo = changes.teamScopeInfo
          if (changes.announce !== undefined && changes.announce !== (config.announce === true)) d.ownerAnnounceRestartPending = true
          if (changes.announce !== undefined && changes.announce === (config.announce === true)) d.ownerAnnounceRestartPending = false
          logger.info(`a2a: owner settings updated (${Object.keys(changes).join(', ')}${restartNeeded ? ' — restart pending for announce' : ''})`)
          const payload = JSON.stringify({ ok: true, restartNeeded, keys: Object.keys(changes) })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        } catch (error) {
          const payload = JSON.stringify({ ok: false, error: `patch-layer write failed: ${error instanceof Error ? error.message : String(error)}` })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        }
      })
    }),
  }), 'a2a: owner-settings route')
  // Groups control: create/remove named groups and assign sessions to
  // them (an empty name unassigns). Same guard as join/leave — the
  // group taxonomy enumerates session ids, so it stays behind the key.
  // Deprecated as of 0.6.6 (canvas teams supersede manual grouping);
  // kept working for old panels.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/groups',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, (body) => {
        const action = body.action
        let payload: string
        if (action === 'create') {
          const name = typeof body.name === 'string' ? body.name : ''
          const stored = groupStore.create(name)
          payload = JSON.stringify(stored === undefined ? { ok: false, error: 'invalid name or group cap reached' } : { ok: true, name: stored, groups: groupStore.list() })
        } else if (action === 'remove') {
          const name = typeof body.name === 'string' ? body.name : ''
          payload = JSON.stringify({ ok: groupStore.remove(name), groups: groupStore.list() })
        } else if (action === 'assign') {
          const id = typeof body.id === 'string' ? body.id : ''
          const name = typeof body.name === 'string' ? body.name : undefined
          if (id === '' || name === undefined) {
            payload = JSON.stringify({ ok: false, error: 'id and name are required' })
          } else {
            payload = JSON.stringify({ ok: groupStore.assign(id, name), groups: groupStore.list() })
          }
        } else {
          payload = JSON.stringify({ ok: false, error: 'unknown action' })
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    }),
  }), 'a2a: session-group route')
  // Canvas control: create/remove named multi-member teams and manage
  // membership. Same key guard as join/leave — membership enumerates
  // session ids. A member must be a joined session (live node or
  // remembered intent): canvas routing only reaches sessions the user
  // put on the network by gesture — no routing backdoor over unjoined
  // sessions.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/canvas',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, (body) => {
        const action = body.action
        let payload: string
        if (action === 'create') {
          const name = typeof body.name === 'string' ? body.name : ''
          const stored = canvasStore.create(name)
          payload = JSON.stringify(stored === undefined ? { ok: false, error: 'invalid name or team cap reached' } : { ok: true, name: stored, teams: canvasStore.list() })
        } else if (action === 'remove') {
          const name = typeof body.name === 'string' ? body.name : ''
          payload = JSON.stringify({ ok: canvasStore.remove(name), teams: canvasStore.list() })
        } else if (action === 'add-member') {
          const name = typeof body.name === 'string' ? body.name : ''
          const id = typeof body.id === 'string' ? body.id : ''
          // Dual member shape: a local session id must be a joined node;
          // a remote ref is a zone-qualified team handle whose shape this
          // gate checks and whose existence the UI picker (directory
          // rows) vouches for. Humans compose both via the workbench.
          const memberValid = isRemoteMemberRef(id)
            ? validRemoteMemberRef(id)
            : id !== '' && (sessionNodes.has(id) || joinedSessions.has(id))
          if (name === '' || !memberValid) {
            payload = JSON.stringify({ ok: false, error: 'name and a member (joined session id, or a zone-qualified remote team handle like zone/a1b2c3d4) are required' })
          } else {
            canvasStore.create(name)
            payload = JSON.stringify({ ok: canvasStore.addMember(name, id), teams: canvasStore.list(), members: canvasStore.membersOf(name) })
          }
        } else if (action === 'remove-member') {
          const name = typeof body.name === 'string' ? body.name : ''
          const id = typeof body.id === 'string' ? body.id : ''
          if (name === '' || id === '') {
            payload = JSON.stringify({ ok: false, error: 'name and id are required' })
          } else {
            payload = JSON.stringify({ ok: canvasStore.removeMember(name, id), teams: canvasStore.list(), members: canvasStore.membersOf(name) })
          }
        } else {
          payload = JSON.stringify({ ok: false, error: 'unknown action' })
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    }),
  }), 'a2a: session-canvas route')
  // Layout face (contract v2): whole-document GET + save/reset for the
  // stage's spatial presentation state. Validated/clamped server-side by
  // LayoutStore so a buggy client cannot poison persisted geometry.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/canvas-layout',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        const payload = JSON.stringify({ ok: true, layout: layoutStore.get() })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }
      readJsonBody(req, res, (body) => {
        const action = (body as { action?: unknown }).action
        if (action === 'reset') {
          layoutStore.reset()
          const payload = JSON.stringify({ ok: true, layout: null })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
          return
        }
        if (action === 'save') {
          const accepted = layoutStore.save((body as { layout?: unknown }).layout)
          const payload = JSON.stringify(accepted ? { ok: true, layout: layoutStore.get() } : { ok: false, error: 'payload is not a version-1 layout document' })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
          return
        }
        const payload = JSON.stringify({ ok: false, error: 'unknown action' })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }, MAX_LAYOUT_BODY_BYTES)
    }),
  }), 'a2a: canvas-layout route')
  // The dsh-a2a-munder-difflin floor stage: a same-origin full-page
  // surface adapted from the Munder Difflin office renderer (stage/,
  // NOTICE). Serves the built Vite tree with a traversal-guarded map.
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/__dsh_a2a_canvas',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const rootDir = fileURLToPath(new URL('../assets/stageDist', indexUrl))
      // Directory-classic resolution: the bare mount 301s onto itself
      // with a slash, so the shell's `./assets` references resolve
      // inside this tree instead of 404ing against the web root.
      const MOUNT = '/__dsh_a2a_canvas'
      const resolved = resolveStageMount(req.url ?? '/', MOUNT)
      if (resolved.redirectTo !== undefined) {
        res.writeHead(301, { Location: resolved.redirectTo, 'Cache-Control': 'no-store', 'X-A2A-Stage': 'redirect' })
        res.end()
        return
      }
      const rel = decodeURIComponent(resolved.rel).replace(/\\/g, '/')
      if (rel.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'text/plain', 'X-A2A-Stage': 'traversal' })
        res.end()
        return
      }
      try {
        const file = readFileSync(join(rootDir, rel))
        const ext = rel.slice(rel.lastIndexOf('.') + 1)
        const types: Record<string, string> = {
          html: 'text/html; charset=utf-8',
          js: 'text/javascript; charset=utf-8',
          mjs: 'text/javascript; charset=utf-8',
          css: 'text/css; charset=utf-8',
          png: 'image/png',
          json: 'application/json; charset=utf-8',
          svg: 'image/svg+xml',
        }
        res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-A2A-Stage': 'ok:' + ext })
        res.end(file)
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'X-A2A-Stage': 'miss' })
        res.end('stage-miss rel=' + rel + ' rootDir=' + rootDir + ' err=' + String(err))
      }
    },
  }), 'a2a: canvas-stage page')
  // The dsh-a2a-nexus stage: Three.js infinite-canvas topology viewer.
  // Serves the built Vite tree from assets/nexusDist with a traversal-
  // guarded file map (same discipline as canvas-stage).
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/__dsh_a2a_nexus',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const rootDirNexus = fileURLToPath(new URL('../assets/nexusDist', indexUrl))
      // Same directory-classic resolution as the canvas mount: the bare
      // `/__dsh_a2a_nexus` form used to serve the shell verbatim, whose
      // `./assets` then 404'd at the web root — a silent black viewer.
      const MOUNT = '/__dsh_a2a_nexus'
      const resolved = resolveStageMount(req.url ?? '/', MOUNT)
      if (resolved.redirectTo !== undefined) {
        res.writeHead(301, { Location: resolved.redirectTo, 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      const rel = decodeURIComponent(resolved.rel).replace(/\\/g, '/')
      if (rel.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end()
        return
      }
      try {
        const file = readFileSync(join(rootDirNexus, rel))
        const ext = rel.slice(rel.lastIndexOf('.') + 1)
        const types: Record<string, string> = {
          html: 'text/html; charset=utf-8',
          js: 'text/javascript; charset=utf-8',
          mjs: 'text/javascript; charset=utf-8',
          css: 'text/css; charset=utf-8',
          png: 'image/png',
          json: 'application/json; charset=utf-8',
          svg: 'image/svg+xml',
        }
        res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
        // gh#9 §10 GUI key plumbing (REVIEW M3 fix): the shell learns
        // the control-plane key ONLY on the loopback leniency face —
        // a remote bare GET of the page serves the shell WITHOUT the
        // key (the reviewer proved the pre-fix shape leaked the
        // credential to any network-reachable fetcher on a
        // 0.0.0.0-bound host, contradicting §10's purpose). Loopback
        // localhost is exactly §10.2's stated leniency posture; keyed
        // hosts behind tunnels use originClaimUrl-style operator
        // plumbing instead.
        if (ext === 'html' && config.apiKey !== '' && controlTrustedWithoutKey(req)) {
          const injected = file.toString('utf8').replace('</head>', `<script>window.__DSH_A2A_KEY__=${JSON.stringify(config.apiKey)};</script></head>`)
          res.end(Buffer.from(injected, 'utf8'))
          return
        }
        res.end(file)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end()
      }
    },
  }), 'a2a: nexus-stage page')
}
