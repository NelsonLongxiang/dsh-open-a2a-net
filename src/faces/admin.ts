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
import { CanvasStore, canvasNameReserved as reservedCanvasName, isRemoteMemberRef, validRemoteMemberRef } from '../canvas-store.ts'
import { qualifiedCanvasId } from '../canvas-id.ts'
import { refreshPeerCard, registerCanvasNotify, type CanvasNotifyDeps } from './canvas-notify.ts'
import { CLI_HANDLE_RE, type CliDepositStore } from '../cli-deposit.ts'
import type { ExposureStore } from '../exposure-store.ts'
import type { GroupStore } from '../group-store.ts'
import type { IdempotencyStore } from '../idempotency-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import type { LayoutStore } from '../layout-store.ts'
import { applyOwnerSettings, parseSeatNames, type OwnerSettings } from '../owner-settings.ts'
import { rosterOp } from '../roster-op.ts'
import type { CliHomeDecision } from '../cli-home.ts'
import type { PeerStore } from '../peer-store.ts'
import { resolveStageMount } from '../stage-mount.ts'
import { ARCHIVE_CAP, archivedEndedBy, type TaskLedger } from '../task-ledger.ts'
import type { TeamMembershipStore } from '../team-store.ts'
import { MAX_LAYOUT_BODY_BYTES } from '../transport-caps.ts'
import type { OriginClaimTarget } from '../origin-claim.ts'
import { queuedFor } from '../queue-guard.ts'

/** Remote-team rows cached for the state face (see refreshRemoteRows). */
export type RemoteRowsCache = { at: number; rows: { team: string; name: string; origin?: string; via?: string; workspace?: string; legacy?: boolean; unreachable?: boolean; teams?: readonly string[] }[] } | undefined

/** Everything the admin faces used to capture from `apply()`. */
export interface AdminFaceDeps extends Pick<CanvasNotifyDeps, 'verifyOriginClaim' | 'callerLinkedToThisHost' | 'cachedCardFetch' | 'peerFetch'> {
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
  readonly originClaimHeaders: (target: OriginClaimTarget) => Record<string, string>
  readonly refreshRemoteRows: () => void
  readonly joinedSessions: JoinedSessions
  readonly exposureStore: ExposureStore
  readonly teamMemberships: TeamMembershipStore
  readonly cliDeposits: CliDepositStore
  readonly groupStore: GroupStore
  readonly canvasStore: CanvasStore
  readonly cliHomeForAdd: (handle: string, requested?: unknown) => Promise<CliHomeDecision>
  readonly cliHomeOptions: (handle: string) => Promise<{ homes: string[]; unreadable: number; held?: true }>
  readonly layoutStore: LayoutStore
  readonly taskLedger: TaskLedger
  readonly enforceRefused?: { reason: string; blockers: readonly string[] }
  /** #114 S6: observe (lazily) and return the /state `authorization` block. */
  readonly authorizationView: () => unknown
  readonly idempotencyStore: IdempotencyStore
  readonly inFlightRoutes: Map<number, InFlightRoute>
  readonly recentActivity: RouteActivityEntry[]
  readonly teamAuditRing: { at: number; action: 'join' | 'leave' | 'archive-prune' | 'agent-less'; team: string; id: string; ok: boolean; actor?: string; reason?: string }[]
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
  /** gh#131: the `<zone>/<id8>` handle a canvas may hold for this local session, if it reads as this session. */
  readonly ownCanvasHandleOf: (id: string) => string | undefined
  /** gh#131: the local session a remote-shaped member ref reads as, if unambiguous. */
  readonly localSessionOfHandle: (ref: string) => string | undefined
  /** gh#152: the session's canvas teams read through the local lens — a handle-stored membership of this session counts. */
  readonly canvasTeamsOfSession: (id: string) => string[]
  readonly nodeMetadataOf: (agent: Agent) => { name: string; description: string; workspace?: string }
  readonly canvasTeamOf: (name: string) => string
  readonly archivedSessionFilter: () => ((id: string) => boolean) | undefined
  readonly pruneArchivedJoins: () => void
  readonly pruneCanvasMemberships: () => void
  // Read at use time through `d` (accessors onto index.ts's bindings).
  readonly cardCache: Map<string, CardCacheEntry>
  readonly remoteRowsCache: RemoteRowsCache
  readonly legacyInboundCount: number
  readonly unboundInboundCount: number
  readonly boundMissInboundCount: number
  readonly boundMissRecent: ReadonlyArray<{ caller: string; audience: string; count: number; lastAt: number }>
  readonly ownCardUrl: string
  /** #282 S2: this host's canvas owner fingerprint. */
  readonly ownCanvasFingerprint: string
  ownerSeatNames: Record<string, string>
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
    ownCanvasHandleOf,
    localSessionOfHandle,
    canvasTeamsOfSession,
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
        const liveStatusOf = (agent: { status?: unknown }): 'running' | 'idle' | undefined => {
          try { return agent.status === 'running' ? 'running' : agent.status === 'idle' ? 'idle' : undefined } catch { return undefined }
        }
        const tFacts0 = Date.now()
        const sessions: Array<Record<string, unknown>> = [...liveRoots.values()]
          .filter(agent => isArchived?.(String(agent.id)) !== true)
          .map(agent => {
            // gh#152: canvas teams through the local lens — a handle-stored
            // membership (gh#131) shows here exactly as routing reads it.
            const canvasTeams = canvasTeamsOfSession(String(agent.id))
            return {
              id: String(agent.id),
              label: sessionLabelOf(agent),
              team: sessionTeamOf(agent),
              ...nodeMetadataOf(agent),
              joined: sessionNodes.has(String(agent.id)),
              live: true,
              // Owner 2026-11-03: whether the session is mid-turn right now, and how many
              // receipt-owing tasks wait on it (the gh#224 queue count) — the board's 工作中/空闲.
              status: liveStatusOf(agent),
              queued: queuedFor(taskLedger.list(), sessionTeamOf(agent)),
              teams: [...teamMemberships.teamsOf(String(agent.id))],
              // #19 D3: the session's exposure tier (linked floor /
              // fleet opt-up) — readable on the state face.
              exposure: exposureStore.tierOf(String(agent.id)),
              ...(canvasTeams.length > 0 ? { canvasTeams } : {}),
              ...(groupOf(String(agent.id)) !== undefined ? { group: groupOf(String(agent.id)) } : {}),
            }
          })
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
            ...(d.ownerSeatNames[id] !== undefined ? { name: d.ownerSeatNames[id], seatName: d.ownerSeatNames[id] } : {}),
            team: `${config.team}/${id8(id)}`,
            joined: true,
            live: false,
            teams: [...teamMemberships.teamsOf(id)],
            // gh#152: same local lens as the live rows (handle-stored counts).
            ...(canvasTeamsOfSession(id).length > 0 ? { canvasTeams: canvasTeamsOfSession(id) } : {}),
            ...(groupOf(id) !== undefined ? { group: groupOf(id) } : {}),
          })
        }
        const body = JSON.stringify({
          nodes: true,
          zone: config.team,
          ownerHost: d.ownCardUrl,
          version: PLUGIN_VERSION,
          // gh#193: a dark host says so — an empty remote list is not an outage.
          ...(config.isolated ? { isolated: true } : {}),
          sessions,
          groups: groupStore.list(),
          canvas: {
            teams: canvasStore.list().map(name => ({
              name,
              team: canvasTeamOf(name),
              // #282 S2: the owner-qualified routing id.
              id: `${canvasTeamOf(name)}@${d.ownCanvasFingerprint}`,
              // gh#152: members as the local tiers read them (gh#131). One
              // of this host's own handles renders as the local session it
              // names — join/live facts instead of an opaque remote chip — and
              // the two stored shapes of one session collapse to ONE row (the
              // store keeps both). Genuinely remote refs pass through with
              // remote:true for the workbench's member chips and pickers.
              members: (() => {
                const rows: Array<{ id: string; team: string; joined?: boolean; live?: boolean; remote?: boolean; cliHome?: string | null; cliHeld?: boolean; cliHomeCleared?: boolean }> = []
                const seenLocal = new Set<string>()
                for (const id of canvasStore.membersOf(name)) {
                  if (isRemoteMemberRef(id)) {
                    const localId = localSessionOfHandle(id)
                    if (localId !== undefined) {
                      if (seenLocal.has(localId)) continue
                      seenLocal.add(localId)
                      rows.push({ id: localId, team: `${config.team}/${id8(localId)}`, joined: sessionNodes.has(localId) || joinedSessions.has(localId), live: sessionNodes.has(localId) })
                      continue
                    }
                    rows.push({ id, team: id, remote: true, ...(CLI_HANDLE_RE.test(id) ? { cliHome: canvasStore.cliHomeOf(id) ?? null, cliHeld: cliDeposits.directoryRows().some(row => row.team === id), ...(canvasStore.wasCliHomeCleared(id) ? { cliHomeCleared: true } : {}) } : {}) })
                    continue
                  }
                  if (seenLocal.has(id)) continue
                  seenLocal.add(id)
                  rows.push({ id, team: `${config.team}/${id8(id)}`, joined: sessionNodes.has(id) || joinedSessions.has(id), live: sessionNodes.has(id) })
                }
                return rows
              })(),
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
              ...(task.answeredAt !== undefined ? { answeredAt: task.answeredAt } : {}),
              ...(task.forwarded === true ? { forwarded: true } : {}),
              ...(task.deliveredTo !== undefined ? { deliveredTo: task.deliveredTo } : {}),
              ...(task.receiverMembers !== undefined ? { receiverMembers: task.receiverMembers } : {}),
              // The dispatch brief rides every row: a task id and a team
              // say nothing about WHAT is owed — supervision cannot tell
              // a nudge from an abandon without it.
              ...(task.brief !== undefined ? { brief: task.brief } : {}),
              // #114 S3: the real sender, so supervision buckets by seat, not "home".
              ...(task.sender !== undefined ? { sender: task.sender } : {}),
              // #114 S2: the authority an inbound row was born with; a pre-S2 inbound row says so (S4).
              ...(task.auth !== undefined ? { auth: task.auth } : task.direction === 'inbound' ? { authLegacy: true } : {}),
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
            .map(task => ({ taskId: task.taskId, team: task.team, peer: task.peer, startedAt: task.startedAt, deadAt: task.deadAt ?? task.startedAt, reason: task.reason ?? 'unspecified', ...(task.answeredAt !== undefined ? { answeredAt: task.answeredAt } : {}), ...(task.brief !== undefined ? { brief: task.brief } : {}), ...(task.direction !== undefined ? { direction: task.direction } : {}), ...(task.sender !== undefined ? { sender: task.sender } : {}), ...(task.auth !== undefined ? { auth: task.auth } : task.direction === 'inbound' ? { authLegacy: true } : {}) })),
          // gh#31: per-task outcomes for rows that LEFT the ledger — the
          // chat drawer used to guess (settled, abandoned or cancelled).
          // Bounded to the archive (≤64), newest first, with the
          // controlled-vocabulary verdict each row settled by.
          // gh#31 follow-up: archive() is already newest first (settles
          // prepend), so the projection keeps that order — the earlier
          // gh#154: the conservation verdict rides the state face — lifetime
          // counters (restart-safe), duplicates checked before the count
          // identity, delta naming any gap. L8 can read this directly instead
          // of cross-round bookkeeping.
          conservation: taskLedger.conservation(),
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
            ...(row.answeredAt !== undefined ? { answeredAt: row.answeredAt } : {}),
            outcome: row.outcome ?? 'unclassified',
            endedBy: archivedEndedBy(row),
            ...(row.direction !== undefined ? { direction: row.direction } : {}),
            // gh#68: present only when the row awaited no receipt.
            ...(row.receiptExpected === false ? { receiptExpected: false } : {}),
            ...(row.lateReceiptAt !== undefined ? { late: true } : {}),
            ...(row.brief !== undefined ? { brief: row.brief } : {}),
            ...(row.summary !== undefined && row.summary !== '' ? { summary: row.summary.slice(0, 160) } : {}),
            ...(row.sender !== undefined ? { sender: row.sender } : {}),
            ...(row.forwarded === true ? { forwarded: true } : {}),
            ...(row.deliveredTo !== undefined ? { deliveredTo: row.deliveredTo } : {}),
            ...(row.receiverMembers !== undefined ? { receiverMembers: row.receiverMembers } : {}),
            ...(row.auth !== undefined ? { auth: row.auth } : {}),
            // #114 S4: who settled it and how they stood on the chain.
            ...(row.settledBy !== undefined ? { settledBy: row.settledBy } : {}),
          })),
          archivedCount: taskLedger.archive().length,
          // #114 S4: settlement authorization. The team verifier holds
          // `refusalsTotal` (monotonic) to zero; `offChain`, `legacy` and
          // `compat` count the bounded archive window (ARCHIVE_CAP rows), so
          // they are a window, not a lifetime total.
          settlement: (() => {
            const archive = taskLedger.archive()
            const roles = archive.flatMap(row => (row.settledBy !== undefined ? [row.settledBy.chain_role] : []))
            return {
              mode: config.settlementAuth,
              ...(d.enforceRefused !== undefined ? { enforceRefused: d.enforceRefused } : {}),
              enforceBlockers: taskLedger.settlementEnforceBlockers(),
              offChain: roles.filter(r => r === 'off-chain').length,
              legacy: roles.filter(r => r === 'legacy').length,
              compat: roles.filter(r => r === 'compat').length,
              refusals: taskLedger.settlementRefusals(),
              // Monotonic: every refusal noted, including repeats folded into one ring entry.
              refusalsTotal: taskLedger.settlementRefusalsTotal(),
            }
          })(),
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
            const entry = d.cardCache.get(url)
            const card = entry?.card
            const org = (card as { canvasOrg?: unknown } | undefined)?.canvasOrg
            // gh#106: a kept card's org is the peer's last known plan, not a live one.
            const unreachable = card !== undefined && entry?.missAt !== undefined ? { unreachable: true } : {}
            return Array.isArray(org)
              ? { url, ...unreachable, org: org.filter((e): e is { name: unknown; team: unknown; members: unknown } => e !== null && typeof e === 'object')
                  .map(e => ({ name: typeof e.name === 'string' ? e.name : '', team: typeof e.team === 'string' ? e.team : '', id: typeof e.team === 'string' ? qualifiedCanvasId(e.team, card?.publicKey) : '', members: Array.isArray(e.members) ? e.members.filter((m): m is string => typeof m === 'string') : [] }))
                  .filter(e => e.team !== '') }
              : { url, ...unreachable, org: [] }
          }),
          // gh#9+gh#10 M1: envelope-absent deliveries during the
          // OriginClaim window — the operator watches this drain to
          // zero before closing the window.
          legacyInbound: d.legacyInboundCount,
          // Accepted unbound (no-audience) OriginClaim envelopes — the
          // drain gauge for closing originClaimUnboundWindow.
          unboundInbound: d.unboundInboundCount,
          // Of those, envelopes whose bound form missed here: the sender
          // dials an origin missing from originClaimAudiences.
          boundMissInbound: d.boundMissInboundCount,
          // Who missed, by verified caller and the origin it dialled (newest first, ≤16).
          boundMissRecent: d.boundMissRecent,
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
                ...(row.unreachable === true ? { unreachable: true } : {}),
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
        // gh#131: read while the session is still joined — its own handle reads as it only then.
        const ownHandle = id !== '' ? ownCanvasHandleOf(id) : undefined
        if (id !== '') sessionNodes.delete(id)
        joinedSessions.remove(id)
        // Leaving the network leaves every canvas team too: membership
        // without join consent would be a routing backdoor. Team
        // roster declarations die the same way (S2 consistency) — and so
        // does a membership a fleet edit stored by the session's handle.
        canvasStore.dropMember(id)
        if (ownHandle !== undefined) canvasStore.dropMember(ownHandle)
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
          const homeCleared = out.ok && canvasStore.clearCliHomeForLocal(out.handle)
          payload = JSON.stringify(out.ok
            ? { ok: true, handle: out.handle, expiresAt: out.expiresAt, ...(homeCleared ? { homeCleared: true } : {}), cardUrl: `${d.ownCardUrl}/a2a/cli/${encodeURIComponent(out.handle)}` }
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
          const body = JSON.stringify({ op: opV, name: nameV, ...(opV === 'add-member' || opV === 'remove-member' ? { id: idV !== '' && !isRemoteMemberRef(idV) && (sessionNodes.has(idV) || joinedSessions.has(idV)) ? `${config.team}/${id8(idV)}` : idV } : {}) })
          const reply = await d.peerFetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...originClaimHeaders({ url: target, method: 'POST', body }) },
            // A local session id means nothing on the peer: send its zone/id8 handle (the workbench
            // drops a local card into a remote frame with its raw session id, which the peer refused).
            body,
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
  // A roster owner gesture writes the same teams.json declarations as a2a_team_join; it cannot admit remote or unjoined ids.
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/__dsh_a2a/roster-op',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      const send = (payload: Record<string, unknown>): void => {
        const text = JSON.stringify(payload)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }); res.end(text)
      }
      if (req.method !== 'POST') { send({ ok: false, error: 'POST required' }); return }
      readJsonBody(req, res, body => {
        try {
          send(rosterOp({
            zone: config.team, home, store: teamMemberships, joined: id => joinedSessions.has(id),
            canvasExists: name => canvasStore.hasTeam(name) || canvasStore.hasTeam('roster:' + name),
            allowlist: () => d.ownerAllowlist, setAllowlist: list => { d.ownerAllowlist = list },
            audit: (action, team, id, ok, reason) => {
              teamAuditRing.push({ at: Date.now(), action, team, id, ok, reason, actor: 'human:owner' })
              if (teamAuditRing.length > 32) teamAuditRing.splice(0, teamAuditRing.length - 32)
            },
          }, body))
        } catch (error) { d.logger.warn('roster-op failed: %s', String(error)); send({ ok: false, error: 'roster operation unavailable' }) }
      })
    }),
  }), 'a2a: owner roster route')
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
          seatNames: { ...d.ownerSeatNames },
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
        if (Object.hasOwn(body, 'seatName') || Object.hasOwn(body, 'seatNames')) {
          const names = body.seatNames
          const parsedNames = parseSeatNames(names)
          if (Object.hasOwn(body, 'seatName') || parsedNames === undefined) {
            const payload = JSON.stringify({ ok: false, error: 'seatNames must map full local session ids to nonempty display names (max 64 characters, no controls); clear by omitting the id' })
            res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(payload); return
          }
          changes.seatNames = parsedNames
        }
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
          // Hot-apply the call-time owner keys.
          if (changes.seatNames !== undefined) d.ownerSeatNames = changes.seatNames
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
  const canvasNameReserved = (name: string): boolean => reservedCanvasName(name, config.team, d.ownerAllowlist, teamMemberships)
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/canvas',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      readJsonBody(req, res, async (body) => {
        const action = body.action
        let payload: string
        if (action === 'cli-home-options') {
          const name = typeof body.name === 'string' ? body.name : ''
          const id = typeof body.id === 'string' ? body.id : ''
          if (!CLI_HANDLE_RE.test(id) || !canvasStore.membersOf(name).includes(id)) payload = JSON.stringify({ ok: false, error: 'an existing canvas CLI member is required' })
          else {
            try { payload = JSON.stringify({ ok: true, ...await d.cliHomeOptions(id) }) }
            catch { payload = JSON.stringify({ ok: false, error: 'fresh home card lookup failed' }) }
          }
        } else if (action === 'create') {
          const name = typeof body.name === 'string' ? body.name : ''
          const stored = canvasNameReserved(name) ? undefined : canvasStore.create(name)
          payload = JSON.stringify(stored === undefined ? { ok: false, error: 'invalid, roster-reserved name or team cap reached' } : { ok: true, name: stored, teams: canvasStore.list() })
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
          if (!canvasStore.hasTeam(name) && canvasNameReserved(name)) {
            payload = JSON.stringify({ ok: false, error: 'roster reserves this canvas name' })
          } else if (name === '' || !memberValid) {
            payload = JSON.stringify({ ok: false, error: 'name and a member (joined session id, or a zone-qualified remote team handle like zone/a1b2c3d4) are required' })
          } else {
            const pin = await d.cliHomeForAdd(id, (body as { home?: unknown }).home).catch(() => ({ ok: false as const, error: 'linked home card lookup failed' }))
            if (!pin.ok) payload = JSON.stringify({ ok: false, error: pin.error })
            else {
              canvasStore.create(name)
              const explicitHome = (body as { home?: unknown }).home !== undefined
              const home = explicitHome ? pin.home : canvasStore.cliHomeOf(id) ?? pin.home
              payload = JSON.stringify({ ok: canvasStore.addMember(name, id, home, { replaceHome: explicitHome }), teams: canvasStore.list(), members: canvasStore.membersOf(name) })
            }
          }
        } else if (action === 'remove-member') {
          const name = typeof body.name === 'string' ? body.name : ''
          const id = typeof body.id === 'string' ? body.id : ''
          if (name === '' || id === '') {
            payload = JSON.stringify({ ok: false, error: 'name and id are required' })
          } else {
            // gh#131: removing a local session removes its handle-stored slot too.
            const ownHandle = isRemoteMemberRef(id) ? undefined : ownCanvasHandleOf(id)
            const removed = [id, ...(ownHandle !== undefined ? [ownHandle] : [])].map(each => canvasStore.removeMember(name, each)).some(Boolean)
            payload = JSON.stringify({ ok: removed, teams: canvasStore.list(), members: canvasStore.membersOf(name) })
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
