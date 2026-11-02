/**
 * A2A node extension (decentralized topology): registers the `a2a_teams` and
 * `a2a_route` model tools over verified peer agent cards and direct peer
 * routes, publishes this node's card and joined session teams, and dispatches
 * inbound direct routes into live agent sessions.
 * @module @nelsonlongxiang/dsh-open-a2a-net
 */

import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// The package own version, read from package.json at load time so the
// panel never drifts from the manifest the installer actually resolved.
const PLUGIN_VERSION: string = String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)

/**
 * Fix 1 (能发即能收): resolve the caller's routable label for one routed
 * dispatch. Priority: the joined session's node team > the exempt initiator
 * face (the NODE team — bare, team-name routable) > the session label (not
 * routable; the dispatch registers receiptless per fix 2).
 */
export function resolveCallerLabel(input: {
  joined: boolean
  initiatorFace: boolean
  nodeTeam: string
  joinedTeam?: string
  sessionLabel?: string
}): string | undefined {
  if (input.joined && input.joinedTeam !== undefined) return input.joinedTeam
  if (input.initiatorFace) return input.nodeTeam
  return input.sessionLabel
}
import { signCard, verifyCard, type CardCore } from './card.ts'
import { GroupStore } from './group-store.ts'
import { CanvasStore, isRemoteMemberRef } from './canvas-store.ts'
import { decodeSessionLog, extractTranscript, TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_FILE_BYTES, TRANSCRIPT_MAX_LIMIT } from './session-transcript.ts'
import { LayoutStore } from './layout-store.ts'
import { fileURLToPath } from 'node:url'
import { JoinedSessions } from './joined-store.ts'
import { ExposureStore } from './exposure-store.ts'
import { applyOwnerSettings, type OwnerSettings } from './owner-settings.ts'
import { CLI_HANDLE_RE, CliDepositStore } from './cli-deposit.ts'
import { TeamMembershipStore } from './team-store.ts'
import { PeerStore } from './peer-store.ts'
import { SelfReferralFilter } from './self-suppress.ts'
import { resolveStageMount } from './stage-mount.ts'
import { TaskLedger, TASK_STALE_TTL_MS, SUMMARY_CAP, ARCHIVE_CAP, archivedEndedBy, briefOf, type OutboundBirth, type ReceiptResolvedInfo, type Sender, type SettlementJudge, type TaskRecord } from './task-ledger.ts'
import { formatReceipt, parseReceipt, taskIdRefusal } from './receipt.ts'
import { runReceiptLadder } from './receipt-ladder.ts'
import { IdempotencyStore, WIRE_ERROR_IDEMPOTENCY_CONFLICT, WIRE_ERROR_REPLAY_REJECTED, peerPayloadFingerprint, type IdempotencyStats } from './idempotency-store.ts'
import { refuseIfBudgetExhausted } from './recursion-guard.ts'
import { createFloodGuard } from './flood-guard.ts'
import { resolveZone, type ZoneCardFetch } from './zone.ts'
import { registerA2aNetworkSkill } from './skill-registration.ts'
import { signOriginClaim, verifyOriginClaim as verifyOriginClaimOf, type CliDepositCard, type OriginClaimTarget, type OriginClaimVerdict } from './origin-claim.ts'
import { AuthObserver, type AffectedEntry } from './auth-observer.ts'
import { allowlistVersion, authorizationRef, buildAuthorization, type SettlementRefusal, callerAdmission, localCandidateAdmission, canonicalAllowlist, judgeSettlement, type SettlementMode, type Settler, joinedFaceAdmission, refusalOf, sameZoneAdmission, type Admission, type AdmissionRecords, type AllowlistInputs, type PeerOrgEntry } from './task-auth.ts'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the vendored timer plugin's declaration merging is what puts
// `ctx.timer` on Context; the runtime service is mounted by app compositions.
import type { } from '@deepseek-ai/cordis-plugin-timer'
// Type-only: the vendored loader plugin's declaration merging is what puts
// `ctx.loader` on Context; the loader is mounted by app compositions.
import type { } from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the web server package's declaration merging puts `ctx.webServer`
// on Context; the listener is mounted by the composition.
import type WebServer from '@deepseek-ai/dsh-host-webserver'
// Type-only: the session-title service's declaration merging puts
// `ctx.sessionTitle` on Context; the service is mounted by app compositions.
import type { } from '@deepseek-ai/dsh-session-title'
// Type-only: the session-persistence service's declaration merging puts
// `ctx.sessionPersistence` on Context; the provider is mounted by app
// compositions and stays optional here (cold listing degrades without it).
import type { } from '@deepseek-ai/dsh-session-persistence'
// Type-only: the session controller's declaration merging puts
// `ctx.sessionController` on Context; the service is mounted by app
// compositions and stays optional here (boot wake and wake-on-route
// degrade without it). It is the successor wake face after core removed
// the api gateway package (4f00a8b82a).
import type { } from '@deepseek-ai/dsh-api-session-controller'
import type { IncomingMessage, ServerResponse } from 'node:http'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// JsonValue is declared locally instead of imported from @deepseek-ai/dsh-tools
// or dsh-session: those packages re-export the type through a dsh-session
// index.d.ts `export type { JsonValue } from './json.ts'` chain that breaks
// intermittently in fresh installs (TS2614 flip-flopping under concurrent
// store mutation, 2026-09-01, f2daa7b passed gates 15:0x and failed on the
// same tree 60 minutes later). The only consumer in this repo is this file —
// inlining removes the cross-package resolution race surface entirely.
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
import { MessageId } from '@deepseek-ai/dsh-llm'

// The a2a relay producer's own message-source kind: upstream 0.1.7 removed the
// shared catch-all 'plugin' kind, so producers declare their own. Historical
// sessions carrying the old 'plugin' kind still deserialize (unknown kinds
// pass through) — only this producer's new writes use the owned kind.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'a2a-relay': { kind: 'a2a-relay' } & import('@deepseek-ai/dsh-llm').ContextFormed & {
      /** The sending peer's routable label (team or session), when known.
       * ui-chat's relay context body renders "来自 X" + the full text from
       * this field; without it the row falls back to an opaque body. */
      senderSessionId?: string
    }
  }
}
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { A2aClient, type A2aFetch, type A2aSchedule, type CardFetchOutcome } from './a2a-client.ts'
import { MAX_LAYOUT_BODY_BYTES, WIRE_ERROR_PAYLOAD_TOO_LARGE, withinRouteBodyCap } from './transport-caps.ts'
import type { CardCacheEntry, InFlightRoute, RouteActivityEntry } from './runtime.ts'
import { registerAdminFaces } from './faces/admin.ts'
import { registerNodeFaces } from './faces/nodes.ts'
import { NodeStore } from './node-store.ts'
import { createNodeBinder, NodeBindings } from './node-bind.ts'
import { NodeTasks, settledReminder } from './node-tasks.ts'
import { githubProbe } from './node-github.ts'
import { registerWireFaces } from './faces/wire.ts'
import { createInfoTools, type DirectoryTeamRow } from './tools/info.ts'
import { canvasCandidateMatches, canvasTargetAmbiguous, peerDirectoryRows, routableCallerLabel, sessionCandidateMatches, unroutableCallerNote } from './peer-directory.ts'
import { createTeamsBridgeInbound } from './legacy/teams-bridge-inbound.ts'
import { createActTools } from './tools/act.ts'
import type { A2aPeerCard, A2aRouteResult, ZoneRecord } from './types.ts'
import { NATIVE_TEAMS_A2A_FACE_KEY, type NativeTeamsBridgeFace } from './teams-bridge.ts'

export type * from './types.ts'
export { A2aClient } from './a2a-client.ts'
export type { A2aClientOptions, A2aFetch, A2aSchedule } from './a2a-client.ts'
export { NATIVE_TEAMS_A2A_FACE_KEY } from './teams-bridge.ts'
export type { NativeTeamsBridgeFace, TeamsBridgeResolveInfo, TeamsBridgeSubmitOutcome, TeamsBridgeSubmitRequest } from './teams-bridge.ts'
export type { ReceiptResolvedInfo } from './task-ledger.ts'

// P2 seam: every correlated receipt is announced on this event for peer
// plugins that track async submissions natively (native-teams settles its
// outstanding `startRoundAsync` rounds from it). Payload vocabulary lives in
// ReceiptResolvedInfo; emission is fire-and-forget at both receipt arrival
// points (the direct endpoint and the local dispatch relay).
declare module '@deepseek-ai/cordis' {
  interface Events {
    'a2a/receipt-resolved'(payload: ReceiptResolvedInfo): void
    /** #114 S6: an allowlist change left unsettled tasks on another footing (observe mode — nothing is cancelled). */
    'a2a/authorization-affected'(payload: AffectedEntry): void
  }
}

export const name = 'a2a'

export const inject = ['tools', 'timer', 'systemPrompt']

/** One signed zone delegation published on this node's agent card. */
export interface DelegateConfig {
  /** The delegated name; resolves zone-relatively at route time. */
  readonly name: string
  /** Base URL of the zone the name resolves in. */
  readonly url: string
  /** Base64 SPKI DER binding to the target zone's card key; `''` leaves the delegation unbound. */
  readonly publicKey: string
}

/** Deployment-varying A2A node facts; every field has a declared default. */
export interface Config {
  /** `X-API-Key` value sent on peer requests and required by the control routes; empty disables the header. */
  readonly apiKey: string
  /**
   * This node's caller label. `''` (the default) derives `dsh-host-<8 hex>`
   * from a per-home node id created on first use, so two deployments mounting
   * defaults do not collide while a persisted home keeps the label stable
   * across restarts.
   */
  readonly session: string
  /** Team name this node exposes for direct routing. */
  readonly team: string
  /** S4 fix 3: audit (default) or refuse host-side (agent-less) routing calls. */
  readonly gateAgentLessCalls: 'audit' | 'refuse'
  /** #114 S4: settlement authorization — off, observe (record would-refuse, settle as before), enforce. */
  readonly settlementAuth: SettlementMode
  /**
   * Publish this node's `/.well-known/agent-card.json` on the shared web
   * server (peer discovery). Requires the web server in the composition;
   * the card carries this node's team, capabilities, referral list, and
   * joined session teams so peers find it without a central directory.
   */
  readonly announce: boolean
  /** Human-facing name published on the agent card. */
  readonly agentName: string
  /**
   * Base URLs of seed peer nodes. `a2a_teams` lists teams discovered from
   * the peers' agent cards and `a2a_route` connects to the owning peer's
   * `/a2a/direct` endpoint. The list is a seed set: referral URLs learned
   * from fetched cards join a bounded, quality-scored peer store persisted
   * at `<dsh-home>/a2a/peers.json`.
   */
  readonly peers: string[]
  /**
   * Zone delegation records published (signed) on this node's agent card:
   * each entry publishes `name` as resolvable in the zone at `url`, so a
   * route for `name` walks the delegation chain (at most 5 hops, cycles
   * fail closed).
   */
  readonly delegates: DelegateConfig[]
  /**
   * gh#9+gh#10 OriginClaim window (docs/protocol/delivery-origin-auth.md §4):
   * while true (default), a delivery/log request with NO envelope still
   * walks N3 admission and increments the legacyInbound warn metric; when
   * the operator closes it (post fleet flip), an absent envelope rejects
   * `untrusted-origin` — same code as a failed signature (M1: a
   * self-asserted already-linked name must not pass on shape alone).
   */
  readonly originClaimWindow: boolean
  /**
   * OriginClaim unbound window (docs/protocol/delivery-origin-auth.md §2.1):
   * while true (default), this host also signs the legacy unbound form and
   * accepts a peer's unbound-only envelope (counted as unboundInbound);
   * closed, it signs and accepts the audience-bound form only.
   */
  readonly originClaimUnboundWindow: boolean
  /**
   * Extra origins this host answers to as an OriginClaim audience, beyond
   * its card URL and the address a request arrives on (port-mapped or
   * proxied hosts name the URL peers dial).
   */
  readonly originClaimAudiences: string[]
  /**
   * #19 D2: card-face sessionTeams excerpt exposure — 'full' | 'masked'
   * | 'off' (owner-level; default full). See the schema comment.
   */
  readonly exposureExcerpt: 'full' | 'masked' | 'off'
  /**
   * Override for the OriginClaim callerUrl anchor. Loopback-bound hosts
   * behind a pocket tunnel must name the card URL peers can actually
   * fetch (e.g. http://192.168.3.157:13080); empty uses the web server's
   * own address.
   */
  readonly originClaimUrl: string
  /**
   * gh#8 (N9) escape hatch: when true, team-name resolution also considers
   * the referral-learned peer tail (the legacy whole-store basis) instead
   * of the seeded/delegate subset only. Default false — a team name binds
   * to hosts the operator linked; fleets relying on referral discovery for
   * routing migrate by adding explicit seeds, then leave this off.
   */
  readonly referralTeamResolution: boolean
  /**
   * Harness home slice for the node keypair and peer store; `''` (the
   * default) uses the process DSH home. The Ed25519 key lives at
   * `<home>/a2a/node-key.pem` and is generated on first announce; a
   * persisted key keeps the node's card identity stable across restarts.
   */
  readonly dshHome: string
  /**
   * Agent-card validity. Announce re-signs at TTL/4 so three lost refreshes
   * still leave a live card; a node silent for one TTL disappears from every
   * peer's discovery without manual eviction.
   */
  readonly cardTtlMs: number
  /**
   * Enable per-session A2A nodes: each live top-level session can join the
   * network explicitly — label `<session>-<agentId8>`, team
   * `<team>/<agentId8>`, node facts carrying the session title and a
   * recent-activity excerpt. Joining is opt-in through the sidebar control's
   * host routes; joined teams ride this node's card and dispatch through
   * its `/a2a/direct` endpoint.
   */
  readonly sessionNodes: boolean
  /**
   * Prewarm every cold joined session's agent after the plugin mounts (dev
   * boxes and always-on collaboration hosts that restart often: the network
   * state returns without opening each session). Each wake materializes a
   * full agent — a main-thread log replay — so the prewarm is deferred,
   * foreground-yielding, and cancellable (see `wakePrewarmDelayMs` /
   * `wakePrewarmQuietMs`); the default stays off for deployments that would
   * rather pay on demand (wake-on-route and the sidebar's wake button remain
   * available either way).
   */
  readonly wakeJoinedOnBoot: boolean
  /**
   * Idle delay between loader settlement and the first boot prewarm wake:
   * boot traffic gets a clear window before any log replay starts. `0`
   * restores the old fire-at-settle behavior.
   */
  readonly wakePrewarmDelayMs: number
  /**
   * Foreground quiet window: a wake/route demand inside this window (or any
   * outbound route still in flight) postpones the next prewarm step. Panel
   * polls never count. `0` disables the yield.
   */
  readonly wakePrewarmQuietMs: number
  /**
   * Pause between consecutive boot prewarm wakes. Each wake replays a full
   * session log — the zstd decode yields the event loop only every 500ms —
   * so unbounded concurrent wakes of several huge logs starve every request
   * for tens of seconds after a restart. The serial queue with this pause
   * keeps the preheat while capping decode saturation, and wake-on-route
   * never waits on this queue.
   */
  readonly wakeBootStaggerMs: number
  /**
   * F8: continuous desired-state reconciliation. The boot prewarm is a
   * one-shot queue; the reconciler re-derives the due set every tick and
   * wakes one cold intent per pass — covering post-boot drift, failed
   * wakes, and gateways that mounted late. Default on.
   */
  readonly wakeReconcile: boolean
  /** Cadence between reconciliation ticks (floored at 50ms). */
  readonly wakeReconcileIntervalMs: number
  /** First-retry delay after a failed reconcile wake; doubles per attempt. */
  readonly wakeReconcileBackoffBaseMs: number
  /** Backoff ceiling; corrupt-log rows park as needs-repair and never retry. */
  readonly wakeReconcileMaxBackoffMs: number
  /**
   * S4 (gh#11 N7, operator directive: team creation is a human act): the
   * joinable-team curation list for a2a_team_join. ONLY an EXACT entry
   * authorizes a join; trailing-`*` pattern entries stay readable here
   * (whoami shows them) but carry no mint rights — a pattern that
   * pre-authorized every future name under it would let a model mint teams
   * nobody created. Empty list denies every join (default).
   */
  readonly teamJoinAllowlist: string[]
  /**
   * S3 (phase-2 default-ON, owner ruling 2026-09-01): route dispatch checks
   * caller↔target shared team membership before addressing; set false to
   * restore the open outbound seam. (Kept in sync with the schema comment.)
   */
  readonly teamScopeRouting: boolean
  /**
   * S5 (owner directive 2026-10-20): information-plane scoping — the
   * read-only fleet tools (a2a_teams / a2a_status / a2a_probe) disclose
   * only teams joined by this host's nodes (the union of local roster
   * declarations). [this host] rows stay visible; a2a_tasks (this host's
   * own ledger) stays unscoped. Set false for the open plane.
   */
  readonly teamScopeInfo: boolean
  /**
   * Peer boundary model (docs/design/peer-boundary-model.md) — connection
   * layer: an empty list keeps the historical open-referral posture; a
   * non-empty list admits a referral only when its host matches an entry
   * (exact host[:port], bare domain suffix, or full URL). Seeds from
   * `peers` are owner-configured and unaffected.
   */
  readonly peerAllowlist: string[]
  /**
   * Peer boundary model — connection layer: when false, referral URLs are
   * neither learned nor offered; the tracked set stays the configured seed
   * set for the lifetime of the config that named them.
   */
  readonly referralLearning: boolean

  /**
   * v0.5.23 (async-stall): see the schema comment on asyncNudgeDelayMs.
   */
  readonly asyncNudgeDelayMs: number
  /**
   * How long the state route serves the cold-row id set from cache before
   * re-enumerating the persistence layer. The panel polls every 2s; the
   * default keeps one full enumeration per 5s instead of one per poll.
   */
  readonly stateColdRowsTtlMs: number
  /**
   * Serve window for a verified peer card from the shared cache. Cards are
   * signed for days and re-signed at TTL/4, so 60s is semantically safe; a
   * peer that restarts with a fresh card is picked up on the next window.
   */
  readonly cardCacheTtlMs: number
  /** Shorter window for unreachable/invalid cards, so a revived peer reappears quickly. */
  readonly cardCacheNegativeTtlMs: number
  /**
   * Serve window for the panel\x27s remote rows. The refresh itself rides the
   * shared card cache, so this is pure sweep cadence: how often real
   * network activity happens while the panel polls every 2s.
   */
  readonly remoteRowsTtlMs: number
  /**
   * `final` reply budget: how long an inbound direct route waits for the
   * session's next assistant message before answering with a timeout
   * notice. Without it a session that never idles (or never produces text)
   * leaves the caller hanging until `routeTimeoutMs` expires.
   */
  readonly flushTimeoutMs: number
  /**
   * `a2a_route` execution budget: how long a call may plausibly wait for a
   * remote session's reply (default 30 minutes).
   */
  readonly routeTimeoutMs: number
  /**
   * Age at which an unsettled async task auto-dead-letters (exits the owed
   * view, disarms the nudge, still settles on a late receipt). Default
   * 24h; the mesh anomaly suite injects sub-second windows to exercise the
   * dead-letter → revival lifecycle without wall-clock waits.
   */
  readonly taskStaleTtlMs: number
  /**
   * Opt-in native-teams inbound bridge: when composed with
   * `@nelsonlongxiang/dsh-native-teams`, a routed team name that its
   * registry classifies as an unambiguous local claim dispatches through
   * its authoritative routing seam (`/a2a/direct`, the outbound A2A tools,
   * and the directory listing). Off by default — exposing every registered
   * team to the network is an operator decision (exposure-grants
   * governance: grants are deliberate, never ambient). Dispatcher-level
   * only: inbound callers address the team, never its individual members
   * (members stay visible-not-addressable).
   */
  readonly nativeTeamsInbound?: boolean
  /**
   * Reply-wait budget for one native-teams round (the bridge's answer
   * deadline, mirroring the steer path's 180s deadline). A round still
   * running past it answers the honest delivered-unsettled shape instead
   * of parking the caller; the round itself keeps going.
   */
  readonly nativeRoundWaitMs?: number
}

/** Schemastery configuration for the A2A client plugin row. */
export const Config: s<Config> = s.object({
  apiKey: s.string().default(''),
  session: s.string().default(''),
  team: s.string().default('dsh'),
  /** S4 fix ③: host-side (agent-less) routing calls — audit them (default) or refuse outright. */
  gateAgentLessCalls: s.union(['audit', 'refuse'] as const).default('audit'),
  settlementAuth: s.union(['off', 'observe', 'enforce'] as const).default('observe'),
  announce: s.boolean().default(false),
  agentName: s.string().default('DeepSeek Harness A2A node'),
  peers: s.array(s.string()).default([]),
  delegates: s.array(s.object({ name: s.string(), url: s.string(), publicKey: s.string().default('') })).default([]),
  dshHome: s.string().default(''),
  sessionNodes: s.boolean().default(true),
  wakeJoinedOnBoot: s.boolean().default(false),
  wakePrewarmDelayMs: s.number().default(10_000),
  wakePrewarmQuietMs: s.number().default(5_000),
  wakeBootStaggerMs: s.number().default(3_000),
  wakeReconcile: s.boolean().default(true),
  wakeReconcileIntervalMs: s.number().default(60_000),
  wakeReconcileBackoffBaseMs: s.number().default(5_000),
  wakeReconcileMaxBackoffMs: s.number().default(600_000),
  /**
   * S4 (gh#11 N7): the joinable-team curation list. A model calling
   * a2a_team_join may only declare membership in a team with an EXACT
   * entry here — trailing-`*` patterns are readable but authorize nothing
   * (no mint rights: a pattern pre-authorizing every future name under it
   * would let a model mint teams nobody created). Default empty: the
   * owner's no-self-join ruling, institutionalized as default-deny; a
   * refused join carries guidance instead of failing silently.
   */
  teamJoinAllowlist: s.array(s.string()).default([]),
  /**
   * S3 (phase-2 default, owner ruling 2026-09-01): route dispatch checks
   * caller↔target shared team membership before addressing — a session
   * with no declared team has no network (the unteamed-peer defect the
   * owner reproduced on 4080 and locally). Fleet compatibility rides the
   * roster capability flag (0.5.44 cards advertise roster:true; older
   * peers read as legacy). Set false to restore the open outbound seam.
   */
  teamScopeRouting: s.boolean().default(true),
  /**
   * S5 (default-on, owner directive 2026-10-20): the information-plane
   * tools answer from the joined-team scope only — a2a_teams lists
   * [this host] rows plus peer rows serving a joined team (note field
   * explains the scope); a2a_status narrows peers / in-flight / activity
   * to that scope (local traffic and idempotency aggregates stay);
   * a2a_probe sweeps serving peers and refuses a single URL whose
   * verified card cannot prove service. A host whose nodes declare no
   * teams keeps host-internal facts only. Set false to restore
   * fleet-wide disclosure.
   */
  teamScopeInfo: s.boolean().default(true),

  /**
   * Peer boundary model — connection layer: an empty list keeps the
   * historical open-referral posture; a non-empty list admits a referral
   * only when its host matches an entry (exact host[:port], bare domain
   * suffix, or full URL). Seeds from `peers` are owner-configured and
   * unaffected.
   */
  peerAllowlist: s.array(s.string()).default([]),

  /**
   * Peer boundary model — connection layer: when false, referral URLs are
   * neither learned nor offered; the tracked set stays the configured seed
   * set for the lifetime of the config that named them.
   */
  referralLearning: s.boolean().default(true),

  /**
   * gh#8 (N9): team-name resolution rides the operator-established peer
   * basis (config seeds + delegates) only; the referral-learned tail's
   * self-published card claims do not bind team names. Set true to restore
   * the legacy whole-store basis (fleet migration window).
   */
  referralTeamResolution: s.boolean().default(false),

  /**
   * #19 D2 (ruling final, owner-level knob): how much of a session team's
   * activity EXCERPT the card face publishes in sessionTeams descriptions.
   * 'full' (default) keeps the verbatim tail excerpt; 'masked' truncates
   * to a shape-only prefix; 'off' omits the description field entirely.
   * Titles and team handles stay in every tier — the knob is the excerpt,
   * not the listing.
   */
  exposureExcerpt: s.union(['full', 'masked', 'off'] as const).default('full'),

  /**
   * gh#9+gh#10 OriginClaim window: absent envelopes still walk N3 during
   * the window (counted as legacyInbound); closing it rejects them like
   * failed signatures. See docs/protocol/delivery-origin-auth.md §4.
   */
  originClaimWindow: s.boolean().default(true),
  /**
   * OriginClaim unbound window: also sign/accept the legacy envelope that
   * names no audience (counted as unboundInbound); closing it leaves the
   * audience-bound form only. See docs/protocol/delivery-origin-auth.md §2.1.
   */
  originClaimUnboundWindow: s.boolean().default(true),
  /** Extra OriginClaim audience origins (port-mapped/proxied hosts). */
  originClaimAudiences: s.array(s.string()).default([]),
  /** OriginClaim callerUrl override for pocket-tunneled hosts; '' = auto. */
  originClaimUrl: s.string().default(''),

  /**
   * v0.5.23 (async-stall): delay before a delivered-but-unconsumed async
   * route re-wakes its target with a one-line nudge (defect
   * t-mt6nd0sq-hxuhj6). 0 disables the nudge entirely.
   */
  asyncNudgeDelayMs: s.number().default(120_000),
  stateColdRowsTtlMs: s.number().default(5_000),
  cardCacheTtlMs: s.number().default(60_000),
  cardCacheNegativeTtlMs: s.number().default(30_000),
  remoteRowsTtlMs: s.number().default(15_000),
  cardTtlMs: s.number().default(172_800_000),
  flushTimeoutMs: s.number().default(300_000),
  routeTimeoutMs: s.number().default(1_800_000),
  taskStaleTtlMs: s.number().default(TASK_STALE_TTL_MS),
  nativeTeamsInbound: s.boolean().default(false),
  nativeRoundWaitMs: s.number().default(180_000),
})


/**
 * Register the outbound peer tools, the direct-route endpoint, and (when
 * composed) the announced card and session-node control surface.
 * @param ctx - registrant context carrying the tool registry and timer.
 * @param config - deployment's A2A node facts.
 */
/**
 * gh#9 control-face leniency audit (docs/protocol/delivery-origin-auth.md
 * §10): a keyless host that runs session nodes rides loopback leniency for
 * every control write — on a host that grants sessions a shell that is a
 * speed bump, not authentication. Pure logic so the boot warning is
 * testable without a mount.
 * @param apiKey - the configured API key ('' disables header auth).
 * @param sessionNodes - whether session nodes are enabled.
 * @returns the warning to log, or undefined.
 */
export function controlFaceLeniencyWarning(apiKey: string, sessionNodes: boolean): string | undefined {
  return apiKey === '' && sessionNodes
    ? 'a2a: control-face leniency — apiKey is empty and session nodes are enabled: on a host that grants sessions a shell, loopback trust is a speed bump, not authentication (gh#9 N7). Set apiKey for the control-plane norm; see docs/protocol/delivery-origin-auth.md §10'
    : undefined
}

/**
 * Exposure audit for unauthenticated direct deliveries (defect card F4, the
 * zero-risk slice). `/a2a/direct` carries no per-call caller identity yet
 * (docs/protocol/delivery-origin-auth.md stays best-effort until the
 * OriginClaim envelope lands), so with an empty `apiKey` every process that
 * can reach this host's ports can steer every joined session. A node that
 * only talks to loopback peers (same-host collaboration) is not exposed;
 * one seeded with non-loopback peers is, and the operator should either set
 * `apiKey` or accept the exposure deliberately.
 * @param peers - the configured seed peer URLs.
 * @param apiKey - the configured API key ('' disables header auth).
 * @returns the non-loopback seed peers and, when they coincide with an
 *   empty key, the boot warning to log.
 */
export function directDeliveryExposure(
  peers: readonly string[],
  apiKey: string,
): { nonLoopbackPeers: string[]; warning: string | undefined } {  const nonLoopbackPeers = peers.filter((peer) => {
    try {
      const { hostname } = new URL(peer)
      const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
      return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host))
    } catch {
      return false // a malformed seed URL says nothing about exposure
    }
  })
  const warning =
    nonLoopbackPeers.length > 0 && apiKey === ''
      ? 'a2a: apiKey empty with non-loopback peers — the open posture is deliberate: /a2a/direct and /a2a/log admit by caller identity (N3 records), not by key, and any reachable peer can attempt delivery; set apiKey to require X-API-Key on BOTH the control routes and the peer faces (gh#7 V2 closed the delivery-face gap)'
      : undefined
  return { nonLoopbackPeers, warning }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('a2a')
  // Plugin-owned agent skill (obelisk pattern): the packaged SKILL.md rides
  // the standard DSH skill catalog through ctx.skills; uninstall is implicit
  // — the registration disposer unwinds with the fiber, so the skill lives
  // and dies with the plugin. Presence-guarded: hosts without the skills
  // service simply don't get the guidance surface.
  try {
    registerA2aNetworkSkill(ctx)
  } catch (error) {
    logger.warn('a2a skill surface unavailable: %s', String(error))
  }
  // Lifecycle guidance section (owner directive 2026-09-02): the network is
  // self-service — a session that needs cross-session or cross-node work may
  // join, team up (prefer joining an existing fitting team, create as
  // fallback), and is expected to leave both once the task is done and no
  // work is pending. Static section (tool-guidance band, 100-199): the rules
  // are stable for the fiber lifetime; current membership state belongs to
  // the a2a_teams tool, not the prompt.
  ctx.systemPrompt.section({
    name: 'a2a:lifecycle',
    order: 150,
    text: [
      '## A2A Network Lifecycle',
      '',
      'The A2A network is self-service. When a task needs cross-session or cross-node collaboration, you may join the network and team up:',
      '',
      '- **Joining**: call `a2a_teams` to discover reachable teams and nodes. Outbound routing NEVER requires join — the session that originates a task is always exempt (initiator face); join buys presence, discovery, and being routed to. Joining itself is a host-side human control (the GUI sidebar A2A panel); check your state anytime with `a2a_whoami`.',
      '- **Teaming**: prefer joining an existing team that fits the task (visible via `a2a_teams`); create a new team (canvas team) only as a fallback when no existing team fits. A node may participate in multiple teams; collaboration happens inside teams.',
      '- **Hygiene**: when your task is complete and no work is pending, leave your teams and the network — stale joined nodes and abandoned teams are network debt. Rejoining later is cheap.',
      '- **Boundaries**: an unjoined session can still route out (initiator face) and report (`a2a_report`), but has no presence — it is invisible to peer discovery and cannot be routed to. Membership is visible; leaving removes you from peer discovery too. Team-scoped admission (`teamScopeRouting`) applies to joined session callers, never to the originating face.',
    ].join('\n'),
  })
  // F4 slice: say the quiet part at boot instead of leaving the exposure to
  // be discovered from a ledger full of unexplained steering.
  const exposure = directDeliveryExposure(config.peers, config.apiKey)
  if (exposure.warning !== undefined) logger.warn(exposure.warning)
  // gh#9 control-face norm (docs/protocol/delivery-origin-auth.md §10): on a
  // host that runs agent sessions WITHOUT an apiKey, the loopback leniency
  // is a speed bump, not a gate — a session with a shell reaches every
  // control write. Name it at boot so the operator configures with eyes
  // open; the GUI key plumbing rides the same release.
  const leniencyWarning = controlFaceLeniencyWarning(config.apiKey ?? '', config.sessionNodes === true)
  if (leniencyWarning !== undefined) logger.warn(leniencyWarning)
  // The production seams: Node's globals. Tests inject their own A2aClient
  // seams through src/a2a-client.ts directly. During fiber teardown the timer
  // service is already gone; a timer armed then belongs to nobody, so the
  // arming fails closed (callback never fires).
  const schedule: A2aSchedule = (callback, delayMs) => {
    try {
      return ctx.timer.timeout(callback, delayMs)
    } catch {
      /* v8 ignore next 2 -- reachable only when the timer service is disposed
         mid-flight; the client owns no teardown-time arming site anymore, so
         no test can drive this without re-adding a teardown unregister. */
      return () => {}
    }
  }
  const fetchImpl: A2aFetch = (url, init) => globalThis.fetch(url, init)

  /** Constant-time secret comparison: hash both sides to equal-length digests. */
  function secretEqual(a: string, b: string): boolean {
    const digestA = createHash('sha256').update(a).digest()
    const digestB = createHash('sha256').update(b).digest()
    return timingSafeEqual(digestA, digestB)
  }

  /**
   * No-key trust for the control routes (gh#7 N1, V1): ONLY a loopback
   * socket — header-only trust (Sec-Fetch-Site, Origin) admitted any
   * reachable process that forged two headers. Deployments that must
   * drive control routes from off-host set apiKey; the local GUI and
   * operator CLIs ride loopback as before. A cross-site page is still
   * rejected even on loopback binds (the web-app restart-control rule).
   * @param req - the inbound control request.
   * @returns whether the caller is trusted without a key.
   */
  function controlTrustedWithoutKey(req: IncomingMessage): boolean {
    // gh#7 N1 (V1): header-only trust is NOT authentication — Sec-Fetch-Site
    // and Origin are attacker-written bytes. Without a key, only a loopback
    // socket is trusted (the local GUI and operator CLIs); a cross-site
    // page is still rejected even on loopback binds. Off-host control
    // callers must present apiKey.
    const site = req.headers['sec-fetch-site']
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
    const remote = req.socket.remoteAddress
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  }

  /**
   * Control-route authorization. With `apiKey` set, the `X-API-Key` header
   * (or `api_key` query, for non-browser clients) must match in constant
   * time. With no key, the same-origin/loopback trust applies — the explicit
   * exposure assumption: an empty-key deployment accepts control from its
   * own page and from loopback, and from nothing else.
   * @param req - the inbound control request.
   * @returns whether the request may drive the control routes.
   */
  function controlAuthorized(req: IncomingMessage): boolean {
    if (config.apiKey !== '') {
      const presented = String(req.headers['x-api-key'] ?? new URL(req.url ?? '/', 'http://x').searchParams.get('api_key') ?? '')
      return secretEqual(presented, config.apiKey)
    }
    return controlTrustedWithoutKey(req)
  }

  /**
   * Answer an unauthorized control request: 401 names the missing key,
   * 403 names the untrusted origin.
   * @param req - the inbound request.
   * @param res - the response.
   */
  function rejectControl(req: IncomingMessage, res: ServerResponse): void {
    void req
    const code = config.apiKey !== '' ? 401 : 403
    const payload = JSON.stringify({ error: config.apiKey !== '' ? 'unauthorized: X-API-Key required' : 'forbidden: untrusted origin' })
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  }

  /**
   * Wrap one control handler with the authorization guard.
   * @param handler - the route's inner handler.
   * @returns the guarded handler.
   */
  function controlRoute(handler: (req: IncomingMessage, res: ServerResponse) => void): (req: IncomingMessage, res: ServerResponse) => void {
    return (req: IncomingMessage, res: ServerResponse): void => {
      if (!controlAuthorized(req)) {
        rejectControl(req, res)
        return
      }
      handler(req, res)
    }
  }

  /**
   * Read one JSON object body and hand it to the handler; malformed input
   * answers 400. Bounded like the direct endpoint's reader.
   * @param req - the inbound request.
   * @param res - the response for the malformed-body rejection.
   * @param use - receives the parsed body.
   */
  // Wire code for boundary-refused corrupted text (cluster-C error-code
  // registry): -32004 belongs to the route verdict, -32005 to the client's
  // DELIVERED-UNSETTLED family, so the corrupted-text guard owns -32006.
  const WIRE_ERROR_TEXT_CORRUPTED = -32006

  /**
   * Boundary guard for undecodable text (consumed by the readJsonBody
   * guard): U+FFFD is produced by a lossy decoder upstream of us — the bytes
   * arrived already destroyed, so storing them would only immortalize
   * garbage names and excerpts.
   */
  function anyReplacementChar(value: unknown): boolean {
    if (typeof value === 'string') return value.includes('\uFFFD')
    if (Array.isArray(value)) return value.some(entry => anyReplacementChar(entry))
    if (value !== null && typeof value === 'object') {
      return Object.values(value).some(entry => anyReplacementChar(entry))
    }
    return false
  }

  function readJsonBody(req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void, maxBytes = 10_000): void {
    const chunks: Buffer[] = []
    let size = 0
    // Same contract as the direct endpoint's reader (B5 enforcement): an
    // oversized body is rejected, never truncated and never connection-
    // killed mid-read — buffering stops at the crossing chunk, the stream
    // drains to `end`, and the client receives one structured 413 (the old
    // behavior tore the socket down with no diagnosis at all). The default
    // keeps the historical 10 KiB control cap; the layout save route passes
    // MAX_LAYOUT_BODY_BYTES because a full-fleet document legitimately
    // exceeds it (LayoutStore still clamps every value server-side).
    let overflowed = false
    const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
    if (Number.isFinite(declared) && declared > maxBytes) overflowed = true
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return
      const next = size + chunk.length
      if (next > maxBytes) {
        overflowed = true
        chunks.length = 0
        return
      }
      size = next
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (overflowed) {
        if (!res.writableEnded && !res.headersSent) {
          const payload = JSON.stringify({ error: 'payload too large', code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
          res.writeHead(413, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        }
        return
      }
      let body: { readonly id?: unknown }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body; if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('control body must be a JSON object') // `null` crashed every route reading body.id
      } catch {
        const payload = JSON.stringify({ error: 'malformed body' })
        res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }
      // P0 garbled-text guard (panel mojibake report): U+FFFD means the
      // sender's encoder destroyed the text BEFORE the wire. Persisting it
      // immortalizes the loss and re-displays garbage forever — refuse at
      // the boundary so corruption never reaches any store.
      if (anyReplacementChar(body)) {
        const payload = JSON.stringify({
          error: 'text contains undecodable characters (U+FFFD) — fix the sender encoding and retry',
          code: WIRE_ERROR_TEXT_CORRUPTED,
        })
        res.writeHead(422, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }
      try { use(body) } catch (error) { logger.warn('control route failed: %s', String(error)); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"internal error"}') } else if (!res.writableEnded) res.end() } // runs in the reader's 'end' callback, outside the web server's guard: a throw here would exit the host
    })
  }

  /**
   * The web server is a sibling row, not a declared injection, so in a Loader
   * tree it can activate after this row: the optional read waits for the tree
   * to settle (immediate in a hand-built context with no Loader). The
   * callback runs at most once and never after this fiber's teardown.
   * @param use - receives the webServer service when the settled tree has one.
   * @param onAbsent - runs when the settled tree has no webServer.
   */
  function whenWebServerSettled(use: (webServer: WebServer) => void, onAbsent?: () => void): void {
    const read = (): void => {
      const webServer = ctx.get('webServer')
      if (webServer !== undefined) use(webServer)
      else onAbsent?.()
    }
    const settled = ctx.get('loader')?.await()
    if (settled === undefined) read()
    else void settled.then(() => {
      if (ctx.fiber.uid !== null) read()
    }, () => {
      // A failed boot never mounts the web server row; the absent path stays
      // silent so a dying tree logs its own failure once.
    })
  }

  // Slice 2: the configured peer list is a seed set; referral URLs learned
  // from fetched cards join a bounded, quality-scored store persisted under
  // the same home as the node key.
  const home = config.dshHome === '' ? resolveDshHome() : resolveDshHome(config.dshHome)
  const peerStore = new PeerStore(config.peers, join(home, 'a2a', 'peers.json'))
  // Node identity (docs/design/node-identity.md, N1): human-named nodes and their prompt versions.
  const nodeStore = new NodeStore(join(home, 'a2a'))
  // Peer boundary model (docs/design/peer-boundary-model.md) — connection
  // layer. referralLearning off freezes the seed set: referrals are neither
  // learned nor offered. A non-empty peerAllowlist admits a referral only
  // when its host matches an entry (exact host[:port], bare domain suffix,
  // or the full URL); the seeds are owner-configured and unaffected.
  const peerAdmissible = (url: string): boolean => {
    // `=== false` and the ?? [] tolerate compositions built without the
    // schema defaults (older hosts, test literals): an absent gate is open.
    if (config.referralLearning === false) return false
    if ((config.peerAllowlist ?? []).length === 0) return true
    let host = url
    try {
      host = new URL(url).host
    } catch {
      /* a non-URL string is judged raw against the entries */
    }
    return config.peerAllowlist.some((entry) => {
      if (entry === url || entry === host) return true
      const domain = entry.startsWith('.') ? entry : `.${entry}`
      return host.endsWith(domain)
    })
  }
  // Graceful disposal lands the debounced peer state on disk before a
  // restart reads it back (fiber teardown awaits effect disposers).
  ctx.effect(() => () => peerStore.flush())
  // Slice 3: an unset session derives from a per-home node id, and the
  // configured delegations become signed zone records on every card.
  const session = config.session === '' ? deriveSession(home) : config.session
  const records: ZoneRecord[] = config.delegates.map(delegate => ({
    type: 'delegate' as const,
    name: delegate.name,
    url: delegate.url,
    ...(delegate.publicKey !== '' ? { publicKey: delegate.publicKey } : {}),
  }))

  const nodePrivateKey = loadOrCreateNodeKey(join(home, 'a2a', 'node-key.pem'))
  /** Our own card URL once the web server settles — the OriginClaim anchor. */
  let ownCardUrl = ''
  /**
   * The OriginClaim envelope headers (gh#9+gh#10, src/origin-claim.ts): the
   * bound form names the target's origin, method and path; the unbound
   * legacy form rides along only while originClaimUnboundWindow is open.
   * Signed with the node card key; shared by the a2a client (every peer
   * request) and the relay/notify faces.
   */
  function originClaimHeaders(target: OriginClaimTarget): Record<string, string> {
    return signOriginClaim(target, { caller: config.team, callerUrl: ownCardUrl, privateKey: nodePrivateKey, unbound: config.originClaimUnboundWindow !== false, now: Date.now() })
  }
  const client = new A2aClient({
    apiKey: config.apiKey,
    sessionId: session,
    cardCaller: config.team,
    // gh#9+gh#10 OriginClaim (docs/protocol/delivery-origin-auth.md): every
    // peer request carries a verifiable origin bound to its target, signed
    // with the node card key (single identity anchor). Until the server
    // settles the URL is unknown; receivers read that as an absent claim.
    originClaim: originClaimHeaders,
    schedule,
    fetch: fetchImpl,
  })

  // Persisted join intent: a join is a user gesture over a durable session,
  // but the node it mounts dies with the session's Agent — page reloads and
  // host restarts silently dropped every join. The store remounts the node
  // whenever the Agent comes back, until the user leaves.
  const joinedSessions = new JoinedSessions(join(home, 'a2a', 'joined.json'))
  // #19 D3/D4: per-session exposure tiers — 'linked' floor (the absence
  // default, so existing members transfer automatically) with a voluntary
  // 'fleet' opt-up. D4 (成文): group visibility = strictest member tier;
  // v1 ships no group-level knob by design.
  const exposureStore = new ExposureStore(join(home, 'a2a', 'exposure.json'))
  // gh#34 owner three-key panel hot-apply state: allowlist and teamScopeInfo
  // are read at call time, so the panel's write applies WITHOUT a restart;
  // announce is boot-time publishing (restart pending flag for the UI).
  let ownerAllowlist: string[] = [...(config.teamJoinAllowlist ?? [])]
  // Truthiness matches the ORIGINAL read site (`if (config.teamScopeInfo)`):
  // literal compositions without the schema default carry undefined, which
  // reads as the OPEN plane — `!== false` would silently scope them.
  let ownerTeamScopeInfo = config.teamScopeInfo === true
  let ownerAnnounceRestartPending = false
  // S2: node-declared team memberships — the roster half of the
  // team-roster iteration. Joins ride the allowlist-gated tools; the store
  // is the durable declaration the card publishes and the state face reads.
  const teamMemberships = new TeamMembershipStore(join(home, 'a2a', 'teams.json'))
  // gh#45 CLI 户口: deposited CLI identities (one key, multiple registrations,
  // ≤4h online by owner ruling — expiry auto-deregisters).
  const cliDeposits = new CliDepositStore(join(home, 'a2a', 'cli-deposits.json'))
  // S4 audit ring, hoisted beside the stores: the boot-settlement prune runs
  // before the tools section initializes, and it records archive-prune events.
  const teamAuditRing: Array<{ at: number; action: 'join' | 'leave' | 'archive-prune' | 'agent-less'; team: string; id: string; ok: boolean; reason?: string }> = []
  const recordTeamAudit = (action: 'join' | 'leave' | 'archive-prune' | 'agent-less', team: string, id: string, ok: boolean, reason?: string): void => {
    teamAuditRing.push({ at: Date.now(), action, team, id, ok, ...(reason !== undefined ? { reason } : {}) })
    if (teamAuditRing.length > 32) teamAuditRing.splice(0, teamAuditRing.length - 32)
  }

  /**
   * Recent routing activity for the network panel: a bounded ring of the
   * latest inbound and outbound route outcomes, newest last. The state route
   * serves a copy; the panel derives unread badges from new entries.
   */
  const ACTIVITY_CAP = 20
  const recentActivity: RouteActivityEntry[] = []
  /**
   * In-flight outbound routes: a route registers on dial and unregisters on
   * settlement, so the panel can show collaboration in progress ("who is
   * waiting on whom") — the state route serves a snapshot.
   */
  const inFlightRoutes = new Map<number, InFlightRoute>()
  let inFlightSeq = 0
  const beginRoute = (team: string, peer: string): number => {
    const id = ++inFlightSeq
    inFlightRoutes.set(id, { id, team, peer, startedAt: Date.now() })
    return id
  }
  const endRoute = (id: number): void => { inFlightRoutes.delete(id) }
  const recordActivity = (dir: 'in' | 'out', team: string, peer: string, ok: boolean): void => {
    recentActivity.push({ ts: Date.now(), dir, team, peer, ok })
    if (recentActivity.length > ACTIVITY_CAP) recentActivity.splice(0, recentActivity.length - ACTIVITY_CAP)
  }

  /**
   * This host's primary LAN IPv4 (first non-internal address), computed once:
   * a node fact the card and state route publish so peers and operators can
   * tell machines apart in a same-team fleet. Empty when no external address
   * exists (loopback-only deployments).
   */
  const lanIp = (() => {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) return entry.address
      }
    }
    return ''
  })()

  // Session groups: user-named buckets for the panel's session listing,
  // persisted beside the join intents so they survive restarts.
  // Deprecated as of 0.6.6 — canvas teams are the grouping face now; this
  // store only stays readable for old panels.
  const groupStore = new GroupStore(join(home, 'a2a', 'groups.json'))
  // Canvas teams: user-composed multi-member routing groups. A session node
  // may sit in many teams; routing to <team>/canvas/<name> resolves the
  // first live member or wakes the first cold one (member order = priority).
  const canvasStore = new CanvasStore(join(home, 'a2a', 'canvas.json'))
  // Spatial presentation state for the full-page stage (contract v2).
  const layoutStore = new LayoutStore(join(home, 'a2a', 'canvas-layout.json'))

  // The async-task ledger: every route that leaves a task owed a receipt is
  // queryable here, and the correlating `[A2A receipt] task <id>` message
  // resolves it — the caller-side half of the receipt contract, persisted so
  // a restart does not orphan the reconciliation.
  const taskLedger = new TaskLedger(join(home, 'a2a', 'tasks.json'), { staleTtlMs: config.taskStaleTtlMs })
  // Unjoined-node reporting ingress (design: docs/design/unjoined-report-ingress.md):
  // a one-way signal channel for sessions with no network membership — a
  // fallen-off or never-joined session reports "I exist / I have a task"
  // here. It grants no presence: reports land in a bounded ring the state
  // route serves, never in any routable surface.
  const reportRing: Array<{ at: number; level: 'info' | 'warning' | 'error'; message: string; session: string; task?: string }> = []

  // Quick-dispatch face (0.6.9): the workbench POSTs /__dsh_a2a/dispatch as a
  // human gesture; the window keeps a runaway page (or a stuck autorefresh)
  // from flooding the mesh. Keyed by client address, mirror of reportLastAt.
  const dispatchLastAt = new Map<string, number>()

  /**
   * #114 S4: the judge of one settler against each correlated row's
   * authorization chain (design §4.2). `observe` records what enforce would
   * refuse and settles as before; `enforce` keeps a refused row owed. No
   * settler (a path that knows none), or settlementAuth off, judges nothing.
   */
  function settlementJudgeFor(settler: Settler | undefined, parsedForJudge: ReturnType<typeof parseReceipt>, alwaysEnforce = false): SettlementJudge | undefined {
    return settler === undefined || (config.settlementAuth === 'off' && !alwaysEnforce) ? undefined : {
      enforce: alwaysEnforce || config.settlementAuth === 'enforce',
      settler: { caller: settler.caller, proof: settler.proof, ingress: settler.ingress },
      check: (row: TaskRecord, echo: boolean) => judgeSettlement(row, settler, {
        hostLabel: session,
        membersOf: (team: string) => {
          const name = parseCanvasTeamName(team)
          if (name === undefined) return undefined
          // Canvas members by session id and by handle, as the faces store them.
          return canvasStore.membersOf(name).flatMap(m => (m.includes('/') ? [m] : [m, `${config.team}/${id8(m)}`]))
        },
        ...(parsedForJudge?.envelope?.onBehalfOf !== undefined ? { onBehalfOf: parsedForJudge.envelope.onBehalfOf } : {}),
        echo,
      }),
    }
  }

  /**
   * Settle one message through the ledger and announce what it correlated
   * on `a2a/receipt-resolved` — the seam peer plugins (native-teams)
   * consume to settle their outstanding async submissions. Fence honesty:
   * the try/catch contains SYNCHRONOUS listener throws (cordis dispatch is
   * synchronous, so a throw lands here and the routing path survives); an
   * ASYNC listener that rejects escapes as an unhandled rejection and is
   * the consumer's own discipline — keep seam listeners synchronous.
   * @param message - the inbound or relayed message text.
   */
  function settleAndAnnounce(message: string, settler?: Settler): SettlementRefusal | undefined {
    const parsedForJudge = parseReceipt(message)
    const judge = settlementJudgeFor(settler, parsedForJudge)
    // W7 slice-2 hook 3: a receipt that correlates an id THIS node's
    // idempotency ledger claimed records the receipt's human line as that
    // key's outcome. Parsed DIRECTLY off the receipt codec — a claimed key
    // usually is NOT in the owed book (the claim lives on the receiving
    // side, the owed book on the dispatcher side), so the ledger's own
    // correlation would never reach it. `summary` is the one-line text;
    // the envelope's controlled-vocabulary outcome is never a product and
    // must not be recorded as one. First-write wins inside the store, so a
    // late receipt never overwrites a precise sync-hook record.
    const parsed = parsedForJudge
    if (parsed !== null && parsed.taskId !== '') {
      const line = parsed.summary.trim()
      // #114 S4 (design §4.2.2): under enforce, the receipt hook writes the
      // outcome a /a2a/query answers only for a row THIS ledger owes and
      // whose settler is on the chain — anyone sending a receipt line could
      // otherwise rewrite another caller's answer.
      const row = judge?.enforce === true ? taskLedger.find(parsed.taskId) : undefined
      const allowed = judge?.enforce !== true || (row !== undefined && judge.check(row, false).ok)
      if (line !== '' && allowed) {
        idempotencyStore.recordOutcome(parsed.taskId, { status: 'completed', reply: line.slice(0, SUMMARY_CAP) })
      }
    }
    // A header that names an owed row and comes back unresolved was refused
    // (enforce): that is the verdict — the echo fallback must not judge the
    // same message a second time.
    const owedRow = parsed !== null && parsed.taskId !== '' ? taskLedger.find(parsed.taskId) : undefined
    const owedByHeader = owedRow !== undefined
    // #139 (design §4.4): an enforce refusal of the row the header names is
    // told to the sender on the wire response, not only in /state.
    const headerVerdict = judge?.enforce === true && owedRow !== undefined ? judge.check(owedRow, false) : undefined
    const resolved = taskLedger.resolveFromMessage(message, judge)
    if (resolved === undefined && owedByHeader) {
      return headerVerdict !== undefined && !headerVerdict.ok ? { status: 'refused', reason: headerVerdict.reason, task_id: parsed!.taskId } : undefined
    }
    if (resolved === undefined) {
      // F5 (settlement integrity): the formal envelope missed — an inbound
      // message that still echoes a pending task id means the peer
      // demonstrably responded to it, which settles the debt even when the
      // receipt formality never rode the reply.
      const echoed = taskLedger.resolveEcho(message, judge)
      if (echoed.length > 0) {
        logger.info(`a2a: ${String(echoed.length)} pending task(s) settled by content echo (${echoed.join(', ')})`)
      }
      return undefined
    }
    try {
      ctx.emit('a2a/receipt-resolved', resolved)
    } catch (error) {
      logger.warn(`a2a: receipt-resolved listener rejected: ${String(error)}`)
    }
    return undefined
  }

  /**
   * gh#141: a receipt this node sent across hosts pays its own debt — the
   * inbound row the answered delivery was born with (F2'). The same-host
   * path settles in settleAndAnnounce, as the receipt lands in-process; a
   * receipt that leaves over the wire never passed this ledger, so the row
   * stayed owed (and kept the async nudge armed) until its dead TTL. Only
   * an inbound row whose receipt target is the team the receipt reached
   * settles, and only for an on-chain payer, whatever settlementAuth says:
   * this path is new, so "observe settles as before" has no before to keep
   * (review of PR #149 P2-1) — another session on this host never pays a
   * row it was not delivered. A settled row records the receipt's line as
   * its claimed key's outcome, as the in-process path does (hook 3).
   * @param message - the receipt text as delivered.
   * @param creditor - the team the receipt was delivered to.
   * @param payer - who sent it on this host.
   */
  function settleOwnInbound(message: string, creditor: string, payer: Settler): void {
    const parsed = parseReceipt(message)
    if (parsed === null || parsed.taskId === '') return
    const settled = taskLedger.resolveFromMessage(message, settlementJudgeFor(payer, parsed, true), row => row.direction === 'inbound' && row.peer === `local:${creditor}`)
    const line = parsed.summary.trim()
    if (settled !== undefined && line !== '') idempotencyStore.recordOutcome(parsed.taskId, { status: 'completed', reply: line.slice(0, SUMMARY_CAP) })
  }

  // Server-side idempotency keys (work-order P3): a caller-born task id
  // executes at most once inside the 24h window — same-key replays answer
  // refused-but-idempotent, same-key different-payload answers conflict.
  const idempotencyStore = new IdempotencyStore(join(home, 'a2a', 'idempotency.json'))
  const refuseIfFlooded = createFloodGuard(idempotencyStore, recordActivity)

  // Unmasked-identity suppression: gossip mirrors peer lists back and forth,
  // so a URL whose fetch just proved it serves this node — or an already
  // tracked node (an alias spelling) — keeps coming home as an inbound
  // referral; see src/self-suppress.ts for the shape of the fix.
  const selfReferrals = new SelfReferralFilter()

  // Session nodes: every joined top-level session is its own addressable
  // team (label `<session>-<agentId8>`, team `<team>/<agentId8>`). Joining
  // is a local fact: the entry dispatches `/a2a/direct` routes and rides
  // the announced card's unsigned sessionTeams listing.
  const sessionNodes = new Map<string, Agent>()
  // Live top-level agents: the join surface's candidates and the cold-row
  // complement (apply scope — the direct-route wake below reads it too).
  const liveRoots = new Map<string, Agent>()
  // Node identity N2+N3: a joined session that carries a node gets that node's layers on its own scope.
  const nodeBindings = new NodeBindings(join(home, 'a2a'))
  const nodeTasks = new NodeTasks(join(home, 'a2a'), { probe: githubProbe(), logger, onSettled: (node, p) => nodeBinder.remind(node, settledReminder(p)) })
  nodeTasks.schedule(ctx)
  const nodeBinder = createNodeBinder({ store: nodeStore, bindings: nodeBindings, logger, joined: id => joinedSessions.has(id), joinedList: () => joinedSessions.list(), archived: id => archivedSessionFilter()?.(id) === true, live: id => liveRoots.get(id), tasksText: node => nodeTasks.render(node), pendingReminders: node => nodeTasks.takePending(node).map(settledReminder) })
  // No boot reconcile: a joined.json that failed to parse reads as empty, and ending every binding on that
  // reading would destroy them (the 3081 lesson). A stale row is harmless — mount checks joined itself.
  ctx.effect(() => joinedSessions.onChange(() => { nodeBinder.reconcile() }), 'a2a: node bindings follow join')
  ctx.effect(() => () => { nodeBinder.disposeAll() }, 'a2a: node mounts')
  // Last foreground wake/route demand (epoch ms): boot prewarm steps yield
  // while demand keeps arriving inside the quiet window. Panel polls never
  // touch this — they are constant and would starve warming forever.
  let lastWakeDemandAt = 0

  /**
   * The wake face, when composed: materializing a persisted session's agent
   * (log replay plus composed preset world) is web-app knowledge, so both
   * wake paths ride the one service that owns it. The successor of the
   * removed api gateway package (core 4f00a8b82a) is the session
   * controller's `resolveAgent` — resolve-or-resume, with failures
   * reported as a result value instead of a rejection.
   */
  interface WakeFace {
    resolveAgent(sessionId: SessionId): Promise<{ readonly agent?: Agent; readonly error?: { readonly message?: string } }>
  }
  const wakeFace = (): WakeFace | undefined => {
    const controller = ctx.get('sessionController') as { resolveAgent?: WakeFace['resolveAgent'] } | undefined
    return typeof controller?.resolveAgent === 'function' ? controller as WakeFace : undefined
  }
  const materialize = (id: string): Promise<Agent> | undefined => {
    const face = wakeFace()
    if (face === undefined) return undefined
    // The successor face reports failure as a result value; re-throw it so
    // every caller's rejection policy (reconciler backoff, route error)
    // keeps working unchanged.
    return face.resolveAgent(SessionId(id)).then(result => {
      if (result.agent !== undefined) return result.agent
      throw new Error(`materialize refused: ${result.error?.message ?? 'unknown session resolution failure'}`)
    })
  }

  // Per-id single-flight: a materialization is a full log replay (seconds of
  // main-thread decode for a large session), so two wake paths converging on
  // one cold id — a route arriving while boot prewarm is already replaying it —
  // must join the in-flight replay, not stack a second one. Rejections
  // propagate to every waiter (each caller keeps its own error policy); the
  // map entry clears in `finally` so a later wake can retry after a failure.
  const materializeInFlight = new Map<string, Promise<Agent>>()
  const materializeOnce = (id: string): Promise<Agent> | undefined => {
    const inFlight = materializeInFlight.get(id)
    if (inFlight !== undefined) return inFlight
    const started = materialize(id)
    if (started === undefined) return undefined
    const flight = started.finally(() => {
      if (materializeInFlight.get(id) === flight) materializeInFlight.delete(id)
    })
    materializeInFlight.set(id, flight)
    return flight
  }

  /**
   * Why a cold-team wake produced no flight — the failure shapes the
   * route error must tell apart (the misleading single text cost hours of
   * double-host diagnosis on 2026-08-31, and again on 2026-09-01 when the
   * archived shape read as "no cold match" across two hosts): `no-match`
   * means the team names no cold joined session; `no-face` means one
   * matched but this host composes no wake face, so the wake could never
   * have succeeded; `archived` means one matched but archive is closure —
   * the session restores from the workspace archive, the route does not.
   */
  type ColdWake =
    | { readonly kind: 'flight'; readonly flight: Promise<Agent> }
    | { readonly kind: 'no-face' }
    | { readonly kind: 'archived' }
    | { readonly kind: 'no-match' }

  /**
   * Wake one cold joined session on demand — the route-triggered half:
   * the join consented to network reachability, so a route addressed to
   * its team pays the wake rather than failing.
   * @param team - the routed team name.
   * @param skipId - the dispatching session's id (issue #41): a canvas
   * team's cold tier skips the initiator — waking the author would loop the
   * dispatch home. Bare session-team matches ignore it (an exact team match
   * is the addressed target by definition).
   * @returns the wake outcome: a flight, or the reason none was started.
   */
  const wakeColdTeam = (team: string, skipId?: string): ColdWake => {
    // F7 (wake-intent self-heal): a boot-time transient can prune the
    // in-memory intent while joined.json still holds it (memory/file
    // divergence — the live repro on 0.5.40). The persisted file is the
    // durable source of the user's gesture: if the in-memory match fails,
    // reload once and retry before giving up.
    const matchJoined = (): string | undefined =>
      joinedSessions.list().find(entry => !liveRoots.has(entry) && `${config.team}/${id8(entry)}` === team)
    let aliasId = matchJoined()
    if (aliasId === undefined) {
      joinedSessions.reload()
      aliasId = matchJoined()
    }
    // Canvas teams wake their first cold joined member (member order is
    // the routing priority; an archived member never wakes; the initiator
    // itself is skipped — issue #41, the self-route rule on canvas tiers).
    const id = aliasId ?? canvasColdMemberId(parseCanvasTeamName(team), skipId)
    // An archived session never wakes: archive is closure, not sleep — to
    // the caller the team simply has no wakeable match.
    if (id === undefined) return { kind: 'no-match' }
    // An archived match is its own honest signal: the intent and the session
    // both exist — archive closure is why the wake refuses (the archived
    // shape reading as "no cold match" cost a double-host diagnosis on
    // 2026-09-01). Restoring the session, not retrying the route, is the fix.
    if (archivedSessionFilter()?.(id) === true) return { kind: 'archived' }
    // Route demand is foreground: boot prewarm yields to it for a quiet window.
    lastWakeDemandAt = Date.now()
    const flight = materializeOnce(id)
    return flight === undefined ? { kind: 'no-face' } : { kind: 'flight', flight }
  }

  /** Route-error text for a team with no live node and no wakeable cold match. */
  const noColdMatchText = (team: string): string =>
    `No live DSH session node accepts team "${team}" and no cold joined session matches it.`
  /** Route-error text for the matched-but-archived shape: archive is
   *  closure, so the honest answer names the restore remedy instead of
   *  claiming "no cold match". */
  const archivedColdMatchText = (team: string): string =>
    `A cold joined session matches team "${team}" but it is archived — archive is closure, so archived sessions never wake. Restore the session from the workspace archive to make it routable.`
  /** Route-error text for the matched-but-unwakeable shape: names the missing
   *  face and the manual remedy instead of claiming "no cold match". */
  const noWakeFaceText = (team: string): string =>
    `No live DSH session node accepts team "${team}"; a cold joined session matches but this host composes no wake face (sessionController.resolveAgent) — open the session once to make it live.`

  /**
   * The workspace registry's archived set, when composed. Archiving is a
   * registry state — the session store stays — so this list is the one
   * authoritative archive signal. Read structurally: the registry is an
   * optional neighbor, not a dependency.
   */
  function archivedSessionFilter(): ((id: string) => boolean) | undefined {
    const registry = (ctx as unknown as { get(name: string): unknown }).get('workspaceRegistry') as { archivedSessionIds?: readonly unknown[] } | undefined
    if (registry === undefined || !Array.isArray(registry.archivedSessionIds)) return undefined
    const archived = new Set(registry.archivedSessionIds.map(String))
    return (id: string): boolean => archived.has(id)
  }

  /**
   * Archived sessions leave the node network: archive is closure, so the
   * persisted join intent goes, a mounted live node unmounts, and the next
   * listing stops advertising the team. Runs at boot settlement and on every
   * state read — the panel's poll makes a mid-session archive disappear
   * within one poll interval.
   */
  const pruneArchivedJoins = (): void => {
    const isArchived = archivedSessionFilter()
    if (isArchived === undefined) return
    for (const id of joinedSessions.list()) {
      if (!isArchived(id)) continue
      const ownHandle = ownCanvasHandleOf(id, true)
      sessionNodes.delete(id)
      // Sections come back at the next mount (re-publish) if this archived reading was transient; the row stays.
      nodeBinder.suspend(id)
      // The archived session's JOIN INTENT is retained: deleting it was the
      // 3081 wake-defect root cause (a transient archived-window reading
      // wiped intents at boot, and cold sessions then never woke — "no cold
      // joined session matches"). Safety without the deletion: wake refuses
      // archived intents (:804), card assembly and the state cold rows filter
      // them, the reconciler skips them, and JOIN_CAP bounds the file.
      canvasStore.dropMember(id)
      if (ownHandle !== undefined) canvasStore.dropMember(ownHandle)
      // S2 consistency: an archived node's roster declarations die with it
      // — a left node keeps no team membership.
      teamMemberships.dropSession(id)
      // S4 audit face: record the prune-visible event (silent intent
      // deletion is exactly what made this incident hard to evidence).
      recordTeamAudit('archive-prune', `archived node pruned from join surface: ${id8(id)}`, id, true)
      logger.info(`a2a: archived session ${id8(id)} left the node network (intent retained)`)
    }
  }

  /**
   * Lifecycle revalidation for canvas membership: a member is legitimate
   * only while it is live on the network (a mounted session node) or while
   * a join intent is remembered. The control route enforces this at write
   * time, but canvas.json is a plain file — an external edit (or a join
   * intent that vanished between restarts) can leave a stale id behind.
   * Routing is already safe by construction (live resolution needs a
   * mounted node; cold wake needs the remembered intent), so this sweep is
   * hygiene, not a security backstop: it drops dead ids at the same seams
   * the archive prune runs (boot settlement and the state poll).
   */
  const pruneCanvasMemberships = (): void => {
    for (const name of canvasStore.list()) {
      for (const id of canvasStore.membersOf(name)) {
        // Remote member refs (zone-qualified team handles) have no local
        // join intent by design — their liveness is the directory's question
        // at route time, so the prune never touches them.
        if (isRemoteMemberRef(id)) continue
        if (sessionNodes.has(id) || joinedSessions.has(id)) continue
        canvasStore.removeMember(name, id)
        logger.info(`a2a: canvas team "${name}" dropped stale member ${id8(id)} (no live node, no join intent)`)
      }
    }
  }

  /**
   * The short id suffix session-node labels and teams key on. Web agents
   * carry `SessionId`-branded ids whose first 8 characters are the literal
   * `session-` prefix — every node would share one team — so the brand
   * strips before the slice. Imported sessions (`import-<uuid>`) keep the
   * `import-` prefix plus the uuid's first 8 hex chars: a bare 8-char slice
   * would collapse the whole import family into 16 possible ids (the uuid's
   * 8th char), which collides as soon as several sessions are imported.
   */
  function id8(id: string): string {
    const bare = id.replace(/^session-/, '')
    const imported = bare.match(/^import-([0-9a-fA-F]+)/)
    if (imported !== null) return `import-${imported[1]!.slice(0, 8)}`
    return bare.slice(0, 8)
  }

  /**
   * gh#131: the local session one of this host's own handles names — the
   * `<zone>/<id8>` of a joined or live, unarchived session here — when that
   * is the only reading. An id8 shared by two local sessions names neither,
   * and a handle a configured peer's card also publishes (an id8 collision
   * across hosts: the operator may mean the peer's session) stays remote.
   * Only the peers the directory resolves through count (seeded and
   * delegates, review of PR #151 P3-1): a host learned by referral cannot
   * veto the local reading with an unsigned sessionTeams row.
   * @param ref - a remote-shaped member ref.
   * @returns the local session id, or undefined.
   */
  function localSessionOfHandle(ref: string): string | undefined {
    return localHandleResolver()(ref)
  }

  /**
   * One snapshot of {@link localSessionOfHandle} for many lookups: the
   * archived filter, the local id8 index and the seeded peers' cards are
   * read once (review of PR #151 P3-e).
   * @param includeArchived - count archived sessions too (the archive prune
   *   drops an archived session's own handle).
   */
  function localHandleResolver(includeArchived = false): (ref: string) => string | undefined {
    const isArchived = includeArchived ? undefined : archivedSessionFilter()
    const byHandle = new Map<string, string[]>()
    for (const id of new Set([...joinedSessions.list(), ...sessionNodes.keys()])) {
      if (isArchived?.(id) === true) continue
      const handle = `${config.team}/${id8(id)}`
      byHandle.set(handle, [...(byHandle.get(handle) ?? []), id])
    }
    const published = new Set<string>()
    for (const url of new Set([...peerStore.listSeeded(), ...config.delegates.map(delegate => delegate.url)])) {
      const card = cardCache.get(url)?.card
      if (card !== undefined && card.session !== session) for (const row of card.sessionTeams ?? []) published.add(row.team)
    }
    return (ref) => {
      const hits = byHandle.get(ref)
      return hits?.length === 1 && !published.has(ref) ? hits[0] : undefined
    }
  }

  /**
   * gh#131: the handle a canvas may hold for one local session — its own
   * `<zone>/<id8>` when that handle reads as this session — so leave,
   * archive and removal drop it with the id (review of PR #151 P2: a
   * handle-stored membership must not outlive the session's consent).
   * @param id - the local session id (still joined when this is read).
   */
  function ownCanvasHandleOf(id: string, includeArchived = false): string | undefined {
    const handle = `${config.team}/${id8(id)}`
    return localHandleResolver(includeArchived)(handle) === id ? handle : undefined
  }

  /**
   * gh#152: a local session's canvas teams as every READ face sees them — the
   * stored member id, or one of this host's own handles that reads as this
   * session (a fleet edit stored it by handle; routing has read that shape
   * through canvasLocalMembersOf since gh#131). Visibility now matches
   * routability: whoami, the scoped teams listing and the state face show the
   * canvas a handle-stored membership puts the session in.
   */
  function canvasTeamsOfSession(id: string): string[] {
    const teams = new Set(canvasStore.teamsOf(id))
    const own = ownCanvasHandleOf(id)
    if (own !== undefined) for (const name of canvasStore.teamsOf(own)) teams.add(name)
    return [...teams]
  }

  /**
   * gh#131: a canvas team's members as the local routing tiers read them —
   * one of this host's own handles stands for the session it names (a fleet
   * edit stored it by handle). Read at route time, never written back: a
   * reading that depends on which peer cards are cached must not rewrite
   * the store (review of PR #151 P2-2).
   */
  function canvasLocalMembersOf(name: string): string[] {
    const resolve = localHandleResolver()
    return canvasStore.membersOf(name).map(id => (isRemoteMemberRef(id) ? resolve(id) ?? id : id))
  }

  /** The 8-char suffix of one agent's id. */
  function agentId8(agent: Agent): string {
    return id8(String(agent.id))
  }

  /** The session node's wire label. */
  function sessionLabelOf(agent: Agent): string {
    return `${session}-${agentId8(agent)}`
  }

  /** The session node's team name. */
  function sessionTeamOf(agent: Agent): string {
    return `${config.team}/${agentId8(agent)}`
  }

  /**
   * Resolve the live agent a session-node team names, when that node exists.
   * @param team - the routed team name.
   * @returns the node's agent, or undefined for any other team.
   */
  function resolveAgentForTeam(team: string): Agent | undefined {
    const prefix = `${config.team}/`
    if (!team.startsWith(prefix)) return undefined
    const suffix = team.slice(prefix.length)
    return [...sessionNodes.values()].find(agent => agentId8(agent) === suffix)
  }

  /**
   * The canvas team's wire name: `<team>/canvas/<name>`. The extra path
   * segment can never collide with a node alias (`<team>/<id8>`), so the
   * two namespaces coexist without reservation tables.
   */
  const canvasTeamOf = (name: string): string => `${config.team}/canvas/${name}`

  /** The canvas team name a routed team string names, when it exists. */
  const parseCanvasTeamName = (team: string): string | undefined => {
    const prefix = `${config.team}/canvas/`
    if (!team.startsWith(prefix)) return undefined
    const name = team.slice(prefix.length)
    return canvasStore.hasTeam(name) ? name : undefined
  }

  /**
   * The canvas team's first live member agent (member order = priority).
   * `skipId` (issue #41, self-route rule on the canvas tiers): the
   * dispatching session's own id — a live initiator occupying a member slot
   * must not capture the dispatch, or the message only echoes home. Inbound
   * faces pass no skip (a remote caller never equals a local member id).
   */
  function canvasLiveAgent(name: string | undefined, skipId?: string): Agent | undefined {
    if (name === undefined) return undefined
    for (const id of canvasLocalMembersOf(name)) {
      if (id === skipId) continue
      const agent = sessionNodes.get(id)
      if (agent !== undefined) return agent
    }
    return undefined
  }

  /**
   * The canvas team's first cold joined member id — the wake candidate.
   * Cold means: joined intent remembered, no live root, not archived.
   * `skipId` skips the initiating session for the same self-route reason as
   * {@link canvasLiveAgent}: waking the initiator would only loop the
   * dispatch back to its author.
   */
  function canvasColdMemberId(name: string | undefined, skipId?: string): string | undefined {
    if (name === undefined) return undefined
    const isArchived = archivedSessionFilter()
    return canvasLocalMembersOf(name).find(id =>
      id !== skipId && joinedSessions.has(id) && !liveRoots.has(id) && isArchived?.(id) !== true)
  }

  /**
   * Human-facing node facts for one session: the session title (fallback:
   * the node label), a one-line recent-activity excerpt, and the session's
   * working directory (from the durable session header — a storage fact
   * read fresh, never baked into any prompt).
   * @param agent - the session the facts describe.
   * @returns the name/description/workspace triple the card and state route serve.
   */
  // The title service derives its answer from the session log, so calling
  // it per agent per panel poll re-derives 24 titles every 2s on a busy
  // host. Memoize per agent with the same fingerprint the excerpt cache
  // uses (event count + tail identity): a title only changes when the log
  // grows or its tail event object changes.
  const titleCache = new WeakMap<Agent, { length: number; tail: unknown; title: string | undefined }>()

  /**
   * Session events accessor, dual-API hardened (d42fe125 hot-fix finding on
   * 4080: alpha.4 removed the `.events` accessor — the null guard alone
   * kept the host alive but silently broke titles). Resolution order:
   * alpha.4 `snapshotEvents()` (argument-less full frozen snapshot) →
   * legacy `.events` array → empty. An unattached session yields empty.
   */
  /** Minimal event shape the title/activity/receipt-flush readers need. */
  type SessionEventLike = {
    readonly type?: string
    readonly data?: {
      readonly message?: { readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }> }
      /** user/message events carry their blocks here (session-transcript.ts). */
      readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
      /** turn/end: why the turn ended (dsh-session TurnEndReason; `completed` is success). */
      readonly reason?: { readonly kind?: string }
    }
  }

  function sessionEventsOf(agent: Agent): readonly (SessionEventLike | undefined)[] {
    // The cast widens to BOTH faces of the accessor: alpha.4 hosts expose
    // `snapshotEvents()`, legacy hosts the `.events` array — the ambient
    // `Session` type names whichever face its own package rev shipped, so
    // the legacy read below needs the widened member to stay type-honest
    // without a behavioural change.
    const session = agent.session as (typeof agent.session & { snapshotEvents?: () => readonly unknown[]; events?: readonly (SessionEventLike | undefined)[] }) | undefined
    if (session === undefined) return []
    if (typeof session.snapshotEvents === 'function') {
      try {
        const snapshot = session.snapshotEvents()
        if (Array.isArray(snapshot)) return snapshot as readonly (SessionEventLike | undefined)[]
      } catch { /* fall through to the legacy accessor */ }
    }
    return Array.isArray(session.events) ? (session.events as readonly (SessionEventLike | undefined)[]) : []
  }

  function sessionTitleOf(agent: Agent): string | undefined {
    const events = sessionEventsOf(agent)
    const length = events.length
    const tail = length > 0 ? events[length - 1] : undefined
    const cached = titleCache.get(agent)
    if (cached !== undefined && cached.length === length && cached.tail === tail) return cached.title
    const title = ctx.get('sessionTitle')?.get(agent.session)?.title
    // An undefined answer is transient (service not yet ready on a cold
    // wake) - caching it would pin the miss until the log grows again.
    // Read-through instead: the title service is cheap, and the next poll
    // picks up the real title as soon as the service can produce one.
    if (title !== undefined) titleCache.set(agent, { length, tail, title })
    return title
  }

  /**
   * Legacy prewarm probe title (frozen historical marker): the pre-0.5.45
   * prewarm steered this exact message into cold sessions to force their
   * first model call, and the session-title service derived those sessions'
   * titles from it — permanently, for seats that never chatted since. The
   * injector was removed at 6f13847 (the wake now rides
   * sessionController.resolveAgent with no message), so the string is a
   * frozen residue: exact-equality matching cannot drift and cannot mis-hit
   * a real user message (peer boundary model, docs/design/peer-boundary-
   * model.md §Layer 2 provenance).
   */
  const LEGACY_PREWARM_PROBE_TITLE = '[prewarm] 请回复 ok。'

  function nodeMetadataOf(agent: Agent): { name: string; description: string; workspace?: string } {
    const title = sessionTitleOf(agent)
    const cwd = (agent.session as { header?: { cwd?: string } }).header?.cwd
    // Display-layer fallback (pure presentation, zero data mutation): a title
    // that IS the legacy probe reads as machine junk in every directory and
    // card — surface the stable seat label instead. The session-title
    // service's stored value is untouched.
    const displayTitle =
      title !== undefined && title !== '' && title !== LEGACY_PREWARM_PROBE_TITLE ? title : undefined
    return {
      name: displayTitle !== undefined ? displayTitle : sessionLabelOf(agent),
      description: recentActivityOf(agent),
      ...(cwd !== undefined && cwd !== '' ? { workspace: cwd } : {}),
    }
  }

  /**
   * One line of recent activity: the newest user or assistant text,
   * whitespace-collapsed and truncated.
   * @param agent - the session whose event log is scanned.
   * @returns the excerpt, or a placeholder for a fresh session.
   */
  // Memoized per agent: quiet sessions with no text events would otherwise
  // rescan their whole (multi-MB) event arrays on every panel poll. The
  // cache invalidates when the log grows or its tail event object changes;
  // the backward scan itself stops after RECENT_ACTIVITY_SCAN_LIMIT events
  // so a textless log costs one bounded pass, not a full walk.
  const recentActivityCache = new WeakMap<Agent, { length: number; tail: unknown; value: string }>()
  const RECENT_ACTIVITY_SCAN_LIMIT = 500

  function recentActivityOf(agent: Agent): string {
    const events = sessionEventsOf(agent)
    const length = events.length
    const tail = length > 0 ? events[length - 1] : undefined
    const cached = recentActivityCache.get(agent)
    if (cached !== undefined && cached.length === length && cached.tail === tail) return cached.value
    const value = scanRecentActivity(events.filter((event): event is { type?: string } => event !== undefined))
    recentActivityCache.set(agent, { length, tail, value })
    return value
  }

  function scanRecentActivity(events: readonly ({ type?: string } | undefined)[]): string {
    const floor = Math.max(0, events.length - RECENT_ACTIVITY_SCAN_LIMIT)
    for (let index = events.length - 1; index >= floor; index -= 1) {
      const event = events[index]
      if (event === undefined) continue
      const blocks = event.type === 'user/message'
        ? (event as { data: { content: Array<{ type: string; text?: string }> } }).data.content
        : event.type === 'assistant/message'
          ? (event as { data: { message: { content: Array<{ type: string; text?: string }> } } }).data.message.content
          : undefined
      const text = blocks
        ?.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text !== undefined && text !== '') return text.slice(0, 160)
    }
    return 'no activity yet'
  }

  /**
   * #19 D2: apply the owner-level excerpt knob to a session-team
   * description at the card face. 'full' keeps the verbatim excerpt;
   * 'masked' reduces to a shape-only prefix (16 chars — enough to
   * recognize, not enough to read); 'off' omits the field entirely.
   */
  function exposureDescription(description: string): string | undefined {
    if (config.exposureExcerpt === 'off') return undefined
    if (config.exposureExcerpt === 'masked') return `${description.slice(0, 16)}${description.length > 16 ? '…' : ''}`
    return description
  }

  /**
   * Join one live top-level session: its team dispatches direct routes and
   * rides the announced card from this moment.
   * @param agent - the session to join.
   */
  function mountSessionNode(agent: Agent): void {
    sessionNodes.set(String(agent.id), agent)
  }

  if (config.sessionNodes) {
    // Track live top-level sessions for the join surface; joining is
    // explicit (the sidebar control), never automatic. A throwing
    // agent/created listener vetoes publication, so tracking is strictly
    // side-effect-only.
    ctx.on('agent/created', ({ agent }) => {
      const agents = ctx.get('agents')
      if (agents === undefined || !agents.roots().some(root => root.id === agent.id)) return undefined
      liveRoots.set(String(agent.id), agent)
      if (joinedSessions.has(String(agent.id))) mountSessionNode(agent)
      nodeBinder.mount(agent)
      return undefined
    })
    ctx.on('agent/disposed', ({ agent }) => {
      liveRoots.delete(String(agent.id))
      nodeBinder.forget(String(agent.id))
      // Disposal unmounts the runtime node; the persisted intent stays for
      // the remount above (leave is the only intent remover).
      sessionNodes.delete(String(agent.id))
    })
    for (const agent of ctx.get('agents')?.roots() ?? []) {
      liveRoots.set(String(agent.id), agent)
      if (joinedSessions.has(String(agent.id))) mountSessionNode(agent)
      nodeBinder.mount(agent, { atFrozen: true })
    }

    /** F-observability: the boot prewarm's lifecycle, surfaced on the state route (F: prewarm not running was invisible). */
    const prewarmStatus: {
      state: 'off' | 'skipped:no-wake-face' | 'draining' | 'done' | 'cancelled'
      attempted: number
      woken: number
      failed: Array<{ id: string; error: string }>
    } = { state: 'off', attempted: 0, woken: 0, failed: [] }

    // F8: continuous desired-state reconciliation. The boot prewarm is a
    // one-shot snapshot over a queue — a session that goes cold later, a
    // wake that failed once, or a gateway absent at that instant never got
    // a second look (the live shapes behind "auto-wake is crippled":
    // silent stalls, unretried failures, post-boot drift). The reconciler
    // re-derives the due set every tick from the join intents and wakes at
    // most one id per pass, with per-id exponential backoff and a parked
    // needs-repair state for corrupt logs. Scoped beside prewarmStatus:
    // the state route reads both, and its cancel flag is its own.
    const reconcileStatus: {
      state: 'off' | 'idle' | 'draining'
      lastTickAt: number
      lastChecked: number
      woken: number
      rows: Array<{ id: string; error: string; attempts: number; nextRetryAt: number; needsRepair: boolean }>
    } = { state: 'off', lastTickAt: 0, lastChecked: 0, woken: 0, rows: [] }
    const reconcileFailures = new Map<string, { attempts: number; nextRetryAt: number; error: string; needsRepair: boolean }>()
    const CORRUPT_LOG_SIGNATURE = /corrupt/i
    const RECONCILE_YIELD_MS = 1_000
    const recordWakeFailure = (id: string, error: string): void => {
      const attempts = (reconcileFailures.get(id)?.attempts ?? 0) + 1
      const needsRepair = CORRUPT_LOG_SIGNATURE.test(error)
      const backoff = needsRepair
        ? // Re-armable slow probe: corrupt rows re-check at the cap cadence
          // instead of parking forever — a repaired log re-materializes on
          // its own and clears the flag, and the row stays flagged until
          // then. The old never-retry park left repaired sessions cold
          // forever with no observable way back.
          Math.max(config.wakeReconcileMaxBackoffMs, config.wakeReconcileBackoffBaseMs)
        : Math.min(
          Math.max(config.wakeReconcileBackoffBaseMs, 1) * 2 ** Math.min(attempts - 1, 20),
          Math.max(config.wakeReconcileMaxBackoffMs, config.wakeReconcileBackoffBaseMs),
        )
      reconcileFailures.set(id, { attempts, nextRetryAt: Date.now() + backoff, error, needsRepair })
    }
    let reconcileCancelled = false
    ctx.effect(() => () => {
      reconcileCancelled = true
    })
    let reconcilePostponed = 0
    const reconcileTick = (): void => {
      if (reconcileCancelled || ctx.fiber.uid === null) return
      const interval = Math.max(50, config.wakeReconcileIntervalMs)
      if (!config.wakeReconcile || wakeFace() === undefined) {
        // Late-mounting wake face: keep the cadence so a session controller
        // that appears after apply still starts reconciling (the P3
        // apply-time snapshot lesson, on a loop instead of a one-shot).
        reconcileStatus.state = 'off'
        schedule(reconcileTick, interval)
        return
      }
      const now = Date.now()
      for (const id of reconcileFailures.keys()) {
        if (liveRoots.has(id) || !joinedSessions.has(id)) reconcileFailures.delete(id)
      }
      const due = joinedSessions.list().filter(id =>
        !liveRoots.has(id)
        && joinedSessions.has(id)
        && archivedSessionFilter()?.(id) !== true
        && !materializeInFlight.has(id)
        && (reconcileFailures.get(id)?.nextRetryAt ?? 0) <= now)
      reconcileStatus.lastTickAt = now
      reconcileStatus.lastChecked = due.length
      reconcileStatus.rows = [...reconcileFailures.entries()]
        .map(([rowId, row]) => ({ id: rowId, error: row.error, attempts: row.attempts, nextRetryAt: row.nextRetryAt, needsRepair: row.needsRepair }))
      if (due.length === 0) {
        reconcileStatus.state = 'idle'
        schedule(reconcileTick, interval)
        return
      }
      // Foreground demand postpones a pass — but at most five one-second
      // yields per pass, then the reconciler proceeds anyway. The boot
      // prewarm could starve forever under steady traffic; a convergence
      // loop must not.
      if ((Date.now() - lastWakeDemandAt < config.wakePrewarmQuietMs || inFlightRoutes.size > 0) && reconcilePostponed < 5) {
        reconcilePostponed += 1
        schedule(reconcileTick, RECONCILE_YIELD_MS)
        return
      }
      reconcilePostponed = 0
      reconcileStatus.state = 'draining'
      const id = due[0]!
      const flight = materializeOnce(id)
      if (flight === undefined) {
        // The shape that silently killed the boot prewarm mid-queue: here
        // it records a reason and the next pass re-derives the set.
        recordWakeFailure(id, 'materializer-unavailable')
        schedule(reconcileTick, Math.min(RECONCILE_YIELD_MS, interval))
        return
      }
      void flight
        .then(() => {
          reconcileFailures.delete(id)
          reconcileStatus.woken += 1
        })
        .catch(error => {
          recordWakeFailure(id, String(error).slice(0, 200))
          logger.warn(`reconcile wake of ${id} failed: ${String(error).slice(0, 200)}`)
        })
        .finally(() => {
          // A quick re-check after each attempt keeps a multi-id drain
          // moving at the yield cadence; the interval cadence resumes as
          // soon as a pass finds nothing due.
          if (!reconcileCancelled && ctx.fiber.uid !== null) schedule(reconcileTick, Math.min(RECONCILE_YIELD_MS, interval))
        })
    }

    {
      // Archive pruning and boot wake both ride the loader tree's
      // settlement: the workspace registry and the api gateway may activate
      // after this row in the same tree, and an apply-time snapshot would
      // see neither. Archived intents prune first — an archived session
      // must never wake — and pruning runs even with the wake off.
      // Prewarm lifecycle: cancelled at fiber teardown so a mid-queue reload
      // or dispose never lets the old instance's queue keep waking sessions.
      let prewarmCancelled = false
      /** Retry cadence while foreground demand holds the prewarm back. */
      const PREWARM_YIELD_RETRY_MS = 1_000
      const pruneThenWake = (): void => {
        pruneArchivedJoins()
        pruneCanvasMemberships()
        // F8: the reconciler runs regardless of the boot prewarm flag —
        // it is the durable convergence loop, not a boot-time courtesy.
        if (config.wakeReconcile) schedule(reconcileTick, Math.max(50, config.wakeReconcileIntervalMs))
        if (!config.wakeJoinedOnBoot) {
          prewarmStatus.state = 'off'
          return
        }
        if (wakeFace() === undefined) {
          // F-observability: this skip used to be console-only — the state
          // route now carries it so a dead prewarm is a reading, not a rumor.
          prewarmStatus.state = 'skipped:no-wake-face'
          logger.warn('wakeJoinedOnBoot is on but no wake face (sessionController) is composed; cold joined sessions stay asleep')
          return
        }
        // Low-priority prewarm instead of an eager serial chain: each wake
        // is a full main-thread log replay (the decode yields the loop only
        // every ~500ms), so waking every cold join at settlement starved
        // web requests for minutes on hosts with many large joined logs.
        // Three properties make the prewarm safe:
        //   deferred — nothing replays until wakePrewarmDelayMs after the
        //     tree settles, giving boot traffic a clear window;
        //   yielding — a foreground demand (a wake/route inside
        //     wakePrewarmQuietMs, or any outbound route in flight)
        //     postpones the next step; panel polls never count (they are
        //     constant and would starve warming forever);
        //   cancellable — disposal (reload, teardown) stops the queue; the
        //     timer seam itself fails closed after the timer service is gone.
        // Per-tick rechecks skip ids another path already woke, archived,
        // or left since queuing; the remount listener joins each node the
        // moment its woken agent publishes, and a failed wake keeps the cold
        // row and its intent. Wake-on-route and manual opens never queue.
        prewarmCancelled = false
        const ids = joinedSessions.list()
        prewarmStatus.state = 'draining'
        let index = 0
        const step = (): void => {
          if (prewarmCancelled || ctx.fiber.uid === null) {
            prewarmStatus.state = 'cancelled'
            return
          }
          while (index < ids.length
            && (liveRoots.has(ids[index]!) || !joinedSessions.has(ids[index]!) || archivedSessionFilter()?.(ids[index]!) === true)) index += 1
          if (index >= ids.length) {
            prewarmStatus.state = 'done'
            return
          }
          const foregroundBusy = Date.now() - lastWakeDemandAt < config.wakePrewarmQuietMs || inFlightRoutes.size > 0
          if (foregroundBusy) {
            schedule(step, PREWARM_YIELD_RETRY_MS)
            return
          }
          const id = ids[index++]!
          prewarmStatus.attempted += 1
          const startedAt = Date.now()
          const flight = materializeOnce(id)
          if (flight === undefined) {
            prewarmStatus.failed.push({ id, error: 'materializer-unavailable' })
            // F8 fix: a bare return here used to kill the drain mid-queue —
            // the remaining ids never got a pass and the state stayed
            // 'draining' forever (the silent-stall shape). Record the
            // failure, keep the queue moving.
            recordWakeFailure(id, 'materializer-unavailable')
            schedule(step, config.wakeBootStaggerMs)
            return
          }
          void flight
            .catch(error => {
              prewarmStatus.failed.push({ id, error: String(error).slice(0, 200) })
              // Feed the reconciler's backoff bookkeeping so a boot-time
              // failure does not get hammered again without a pause.
              recordWakeFailure(id, String(error).slice(0, 200))
              logger.warn(`boot wake of ${id} failed: ${String(error)}`)
            })
            .then(() => {
              prewarmStatus.woken += 1
              logger.info(`a2a: boot prewarm ${id8(id)} settled in ${String(Date.now() - startedAt)}ms (${String(ids.length - index)} left)`)
              if (!prewarmCancelled && ctx.fiber.uid !== null) schedule(step, config.wakeBootStaggerMs)
            })
        }
        schedule(step, config.wakePrewarmDelayMs)
      }
      ctx.effect(() => () => {
        prewarmCancelled = true
      })
      const settled = ctx.get('loader')?.await()
      if (settled === undefined) pruneThenWake()
      else void settled.then(() => {
        if (ctx.fiber.uid !== null) pruneThenWake()
      }, () => {
        // A failed boot never wakes anything; the dying tree logs its own
        // failure once.
      })
    }

    // Cold-row ids are the expensive half of the state read: enumerating
    // the persistence layer walks every stored session's metadata, and the
    // panel polls this route every 2s. Stale-while-revalidate: the first
    // read after boot pays one enumeration to seed the snapshot; every later
    // read serves the snapshot synchronously (fresh within the TTL, stale
    // past it while a single-flight background refresh runs) — the polled
    // handler never blocks on the persistence layer again. A rejecting list
    // degrades to the previous snapshot instead of an unhandled rejection.
    let coldRowsCache: { at: number; ids: Set<string> } | undefined
    let coldRowsRefresh: Promise<void> | undefined
    const refreshColdIds = (): Promise<void> => {
      if (coldRowsRefresh !== undefined) return coldRowsRefresh
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) return Promise.resolve()
      coldRowsRefresh = persistence.list()
        .then(headers => {
          // The header's `id` is a runtime fact of every generation; the
          // alpha.4 persistence type simply stopped naming it, so read it
          // through a widened shape instead of trusting the ambient type.
          coldRowsCache = { at: Date.now(), ids: new Set(headers.map(header => String((header as { id?: unknown }).id))) }
        })
        .catch(() => {
          // Keep serving the last snapshot; the next expiry retries.
        })
        .finally(() => {
          coldRowsRefresh = undefined
        })
      return coldRowsRefresh
    }
    const coldJoinedIds = async (): Promise<Set<string>> => {
      if (coldRowsCache === undefined) {
        await refreshColdIds()
        // The refresh assigns inside a closure, so the outer narrowing does
        // not follow it — re-read through an explicitly typed view.
        return (coldRowsCache as { ids: Set<string> } | undefined)?.ids ?? new Set<string>()
      }
      if (Date.now() - coldRowsCache.at >= config.stateColdRowsTtlMs) void refreshColdIds()
      return coldRowsCache.ids
    }

    // Peer-side rows for the panel, grouped there by origin: the sweep is
    // real network work, so a shared window serves the 2s panel poll without
    // hammering peers. The state read answers synchronously from the cache
    // (never awaiting inside the handler) and kicks a background refresh when
    // stale — the next poll picks the fresh rows up. With the shared card
    // cache serving the sweep\x27s fetches, the window length is pure cadence:
    // remoteRowsTtlMs (default 15s) spaces the real network activity while
    // staying well inside a peer restart\x27s noticeability. Single-flight: a
    // refresh already in flight serves every poll that arrives before it
    // settles — no stacked sweeps.
    let remoteRowsCache: { at: number; rows: { team: string; name: string; origin?: string; via?: string; workspace?: string; legacy?: boolean; teams?: readonly string[] }[] } | undefined
    let remoteRowsInFlight: Promise<void> | undefined
    const refreshRemoteRows = (): void => {
      const now = Date.now()
      if (remoteRowsCache !== undefined && now - remoteRowsCache.at < config.remoteRowsTtlMs) return
      if (remoteRowsInFlight !== undefined) return
      remoteRowsInFlight = listDirectoryTeams(false)
        .then(all => {
          remoteRowsCache = {
            at: now,
            rows: all
              .filter(row => row.local !== true)
              .map(row => ({ team: row.team, name: row.name, ...(row.origin !== undefined ? { origin: row.origin } : {}), ...(row.via !== undefined ? { via: row.via } : {}), ...(row.workspace !== undefined ? { workspace: row.workspace } : {}), ...(row.legacy === true ? { legacy: true } : {}), ...(row.teams !== undefined && row.teams.length > 0 ? { teams: [...row.teams] } : {}) })),
          }
        })
        .catch(() => {})
        .finally(() => {
          remoteRowsInFlight = undefined
        })
    }
    whenWebServerSettled((webServer) => {
      // gh#77 B1: the admin faces live in src/faces/admin.ts.
      registerAdminFaces(webServer, {
        ctx, config, logger, home, session, lanIp, PLUGIN_VERSION, controlRoute, controlTrustedWithoutKey, readJsonBody, peerStore, peerLinkState, originClaimHeaders, refreshRemoteRows, joinedSessions, exposureStore, teamMemberships, cliDeposits, groupStore, canvasStore, layoutStore, taskLedger, idempotencyStore, inFlightRoutes, recentActivity, teamAuditRing, reportRing, sessionNodes, liveRoots, mountSessionNode, coldJoinedIds, prewarmStatus, reconcileStatus, id8, sessionLabelOf, sessionTeamOf, ownCanvasHandleOf, localSessionOfHandle, canvasTeamsOfSession, nodeMetadataOf, canvasTeamOf, archivedSessionFilter, pruneArchivedJoins, pruneCanvasMemberships, verifyOriginClaim, callerLinkedToThisHost, cachedCardFetch, authorizationView,
        indexUrl: import.meta.url,
        get cardCache() { return cardCache },
        get remoteRowsCache() { return remoteRowsCache },
        get legacyInboundCount() { return legacyInboundCount },
        get unboundInboundCount() { return unboundInboundCount },
        get boundMissInboundCount() { return boundMissInboundCount },
        get ownCardUrl() { return ownCardUrl },
        get ownerAllowlist() { return ownerAllowlist },
        set ownerAllowlist(v) { ownerAllowlist = v },
        get ownerTeamScopeInfo() { return ownerTeamScopeInfo },
        set ownerTeamScopeInfo(v) { ownerTeamScopeInfo = v },
        get ownerAnnounceRestartPending() { return ownerAnnounceRestartPending },
        set ownerAnnounceRestartPending(v) { ownerAnnounceRestartPending = v },
      })
      registerNodeFaces(webServer, { ctx, logger, nodeStore, bindings: nodeBindings, binder: nodeBinder, tasks: nodeTasks, apiKey: () => config.apiKey, secretEqual, controlRoute, readJsonBody })
    })
  }

  if (config.announce) {
    whenWebServerSettled((webServer) => {
      const privateKey = nodePrivateKey
      // The OriginClaim anchor URL: explicit config wins (loopback-bound
      // hosts behind a pocket tunnel must name their reachable card URL),
      // else the web server's own address.
      const bound = (webServer as { host?: '127.0.0.1' | '0.0.0.0' }).host
      const urlOverride = config.originClaimUrl ?? ''
      const reachHost = urlOverride !== '' ? '' : bound === '0.0.0.0' && lanIp !== '' ? lanIp : '127.0.0.1'
      ownCardUrl = urlOverride !== '' ? urlOverride : `http://${reachHost}:${String((webServer as { port: number }).port)}`
      const cardCore = (): CardCore => ({
        name: config.agentName,
        session,
        team: config.team,
        // async: wait:false is honored (steer + delivered, no final hold);
        // the signed capability turns async dialing into a deterministic
        // check instead of a timeout race against pre-0.5.2 peers.
        // roster: the team-roster face (a2a_team_join/leave, card
        // teamMemberships, team-scope routing admission) ships — peers read
        // its absence as a pre-roster legacy node (0.5.43 and older).
        capabilities: { route: true, async: true, roster: true },
        expiresAt: Date.now() + config.cardTtlMs,
        ...(records.length > 0 ? { records: [...records] } : {}),
      })
      let currentCard = signCard(cardCore(), privateKey)
      // Re-sign at TTL/4: four publication opportunities per validity window
      // tolerate three lost refreshes (GNUnet zonemaster cadence).
      const refresh = ctx.timer.interval(() => {
        currentCard = signCard(cardCore(), privateKey)
      }, Math.max(1, Math.floor(config.cardTtlMs / 4)))
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/.well-known/agent-card.json',
        // gh#9+gh#10: the FULL card now requires a VERIFIED OriginClaim
        // envelope (four headers, card-key signature) — the v1 shape-only
        // named face (self-asserted zone via ?caller_session=/header)
        // closed with the envelope flip: shape NEVER substitutes for
        // signature (ruling's no-dual-track). Everything else gets the
        // MINIMAL discovery card.
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const send = (named: boolean, body_: string): void => {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body_) })
            res.end(body_)
            void named
          }
          const claim = await verifyOriginClaim(req)
          // W3 (#18 half-side, 0.6.25): a VERIFIED envelope proves the
          // caller holds a real node key — it does not prove a relationship
          // with THIS host. The full card (sessionTeams/rosters =
          // collaboration facts) additionally requires a LINK (same-host
          // membership, canvas remote ref, or the caller's own card seeding
          // us — see callerLinkedToThisHost). An unlinked-but-verified
          // stranger gets the MINIMAL discovery card, #18 X1's shape.
          // Interaction with the OriginClaim narrowing: the caller is a
          // bare zone; linkage judges that zone face against our canvas
          // remote refs, joined handles, and the caller card's peers.
          const named = claim.ok && callerLinkedToThisHost(claim.caller, claim.ok ? claim.callerUrl : '', claim.ok ? claim.card : undefined)
          // gh#7 G1 (review-seat R2 ruling): the card serves two faces.
          // A NAMED caller — ?caller_session= or the X-A2A-Caller header in
          // the zone or zone/id8 shape — gets the FULL card. An anonymous
          // fetcher (or an invalid shape, fail-closed) gets the MINIMAL
          // card: name/team/session/capabilities/records/peers/signature
          // stay (discovery, gossip, delegation, capability negotiation
          // unbroken), while sessionTeams/teamMemberships/lanIp are
          // omitted — session membership and rosters are collaboration
          // facts, not discovery facts. Named determination does NOT
          // require a shared team: demanding roster symmetry before the
          // roster exchange would self-lock (ruling text). The signature
          // covers the same signed core either way; only the unsigned
          // served-fresh fields differ.
          const cardUrl = new URL(req.url ?? '/', 'http://x')
          void cardUrl
          // The unsigned peers and sessionTeams fields carry this node's
          // current peer set and joined sessions at serve time (between
          // re-signs), so each card read spreads the publisher's latest
          // view of the network. `version` and `lanIp` are likewise
          // unsigned served-fresh facts: fleet auditability without SSH.
          // Cold joined teams (intent remembered, agent not loaded) are
          // advertised too: their routes are wake-on-route's to honor, and
          // without the listing a cross-node caller has no candidate and
          // the wake never fires.
          const isArchived = archivedSessionFilter()
          // Discovery invisibility for unjoined sessions (owner ruling B,
          // 2026-09-02): an unjoined session node is not advertised at all —
          // peers neither see it in the card's sessionTeams nor can address
          // it through the directory. Visibility follows membership: join
          // and the node appears; leave and it vanishes from discovery.
          const isJoinedNode = (agent: Agent): boolean => {
            try {
              return joinedSessions.list().includes(agent.id)
            } catch {
              return false
            }
          }
          // #19 D2: the excerpt knob rides the served-fresh rows at the
          // card face — live nodes (nodeMetadataOf description) and cold
          // rows alike. 'off' omits the field (undefined drops out).
          const exposureRow = (team: string, meta: Record<string, unknown>): Record<string, unknown> => {
            const { description, ...rest } = meta as { description?: string }
            const excerpt = exposureDescription(description ?? '')
            return { team, ...rest, ...(excerpt !== undefined ? { description: excerpt } : {}) }
          }
          const sessionTeams = [
            ...[...sessionNodes.values()].filter(isJoinedNode).map(agent => exposureRow(sessionTeamOf(agent), nodeMetadataOf(agent) as unknown as Record<string, unknown>)),
            ...joinedSessions.list()
              .filter(id => !liveRoots.has(id) && isArchived?.(id) !== true)
              .map(id => exposureRow(`${config.team}/${id8(id)}`, { name: `${session}-${id8(id)}`, description: 'cold — not loaded; routing here wakes the session' })),
            // gh#45/47: deposited CLI identities publish as directory rows —
            // the fleet sees them as member cards (draggable = the operator
            // link). Their "zone" is the agent-name. gh#47: an EXPIRED
            // deposit stays as an OFFLINE row (tombstone) so the board keeps
            // the member card grayed-but-present and canvas refs never
            // dangle silently; re-publish (same handle) un-tombstones.
            ...cliDeposits.directoryRows().map(row => exposureRow(row.team, { name: row.name, description: row.description })),
          ]
          const memberships = teamMemberships.list().flatMap(entry =>
            entry.teams.map(team => ({ node: `${config.team}/${id8(entry.session)}`, team })))
          const body = JSON.stringify({
            ...currentCard,
            peers: peerStore.list(),
            ...(named && sessionTeams.length > 0 ? { sessionTeams } : {}),
            ...(named && memberships.length > 0 ? { teamMemberships: memberships } : {}),
            // gh#41 fleet planning (owner ruling: any peer composes and
            // regulates): the host's own canvas org rides the FULL card as a
            // served-fresh unsigned field — linked peers render each other's
            // team structure on the planning board; the minimal face omits
            // it exactly like sessionTeams. Members are CANONICALIZED to
            // zone/id8 handles (local session ids translate to the node's
            // session-team handle) — one form on the wire, so readers never
            // mix id/handle shapes (owner: 数据对不上).
            // gh#152: members are read through the local tiers' lens — one of
            // this host's own handles resolves to the session it names, and
            // the two stored shapes of one session publish as ONE handle.
            ...(named ? { canvasOrg: canvasStore.list().map(name => ({ name, team: canvasTeamOf(name), members: [...new Set(canvasLocalMembersOf(name))].map(id => sessionNodes.has(id) || joinedSessions.has(id) ? `${config.team}/${id8(id)}` : id) })) } : {}),
            ...(named && lanIp !== '' ? { lanIp } : {}),
            ...(PLUGIN_VERSION !== '' ? { version: PLUGIN_VERSION } : {}),
            description: `A2A node exposing team ${config.team}${named ? '' : ' (minimal card — OriginClaim envelope required for the full card: X-A2A-Caller/-Url/-Ts/-Sig signed with your card key)'}`,
          })
          send(named, body)
        },
      }), 'a2a: agent card route')
      ctx.effect(() => refresh, 'a2a: card refresh timer')
    }, () => {
      logger.warn('announce is on but no web server is composed; the agent card is not published')
    })
  }
  /**
   * Resolve the live agent for inbound steering: the initiator when
   * recoverable, else the first root.
   * @returns the agent, or undefined when no agent is live.
   */
  function liveAgent(): Agent | undefined {
    const agents = ctx.get('agents')
    if (agents === undefined) return undefined
    try {
      return agents.requireInitiator()
    } catch {
      const roots = agents.roots()
      return roots.length > 0 ? roots[0] : undefined
    }
  }

  /** Whether `caller` names exactly this agent's own session team — the
   * self-route shape. The bare-team fallback must never deliver a session's
   * dispatch back into itself: the sender would watch its own message
   * arrive as an [A2A direct], and armReceiptAutosend would bounce its
   * confused "this is just an echo" reply back as a synthetic receipt —
   * delivered:true plus a receipt for work nobody did (defect 2026-10-18:
   * the ygl-trees monitor self-echo). */
  function callerIsAgent(agent: Agent, caller: string): boolean {
    return caller === `${config.team}/${agentId8(agent)}`
  }

  /** Honest refusal text for the self-route shape, shared by the sync and
   * transport faces so both failures read identically. */
  const selfRouteText = (team: string): string =>
    `Self-route refused: team "${team}" resolves to the issuing session itself — dispatching would loop your own message back to you (echo plus a synthetic auto-receipt). Route a concrete session team (e.g. ${team}/<id8>), a canvas team, or do the work inline.`

  /**
   * Steer one relay-form user message into the agent; the caller owns
   * rejection handling.
   * @param agent - the steering target.
   * @param text - the fully formatted relay message.
   * @param sender - the sending peer's routable label, recorded on the source
   * so ui-chat renders the relay body ("来自 X" + full text) instead of an
   * opaque row; omitted when the sender is not meaningfully addressable.
   */
  function steerRelay(agent: Agent, text: string, sender?: string): void {
    agent.steer({
      id: MessageId(`a2a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'a2a-relay', form: 'relay', ...(sender === undefined ? {} : { senderSessionId: sender }) },
    })
  }

  /** The cooperative stop-notice text, shared by the tasks/cancel control
   * route and the transport face's cancel half (one contract, one wording). */
  function cancelNoticeText(taskId: string, reason?: string): string {
    return `[A2A cancel] (task ${taskId}) the caller cancelled this task${reason !== undefined && reason !== '' ? `: ${reason}` : ''}. Stop any work tied to it and acknowledge via [A2A receipt] task ${taskId} cancelled.`
  }

  /**
   * v0.5.23 (async-stall): whether the steered agent actually left idle. A
   * steer on an idle driver flips status to running within the same tick
   * (wakeDriver sets the phase synchronously before kick); still-idle after
   * the steer means the wake was latched (maintenance/abort window) or the
   * driver never claimed it — the delivered-but-stalled shape the defect
   * ticket documented. The probe reads status once, immediately: a message
   * already consumed back to idle reads false-negative-conservative, which
   * only arms the harmless nudge below.
   * @param agent - the steered target.
   * @returns true when the driver shows running (or already errored past the
   * claim, which consumption also implies); false when it stayed idle.
   */
  function probeConsumption(agent: Agent, taskId: string): boolean {
    void taskId
    try {
      return agent.status === 'running'
    } catch {
      return false
    }
  }

  /**
   * F5 (settlement integrity): whether a receipt routed at this target can
   * actually land. A session team resolves locally (a joined live node) —
   * receipts flow. Anything else carrying the process-label shape
   * (`dsh-host-<8hex>-<rand>`, the node's own label form) resolves to no
   * session and appears in no card directory: every receipt routed at it
   * strands, which is exactly the 08-30 debt pile (six full replies given,
   * zero receipts settled). Those deliveries are born fire-and-forget.
   * Unknown labels stay receipt-expected (conservative — losing a receivable
   * receipt is worse than chasing a stranded one).
   * @param receiptTarget - the callback address or caller label.
   * @returns the expectation verdict for the delivery.
   */
  function receiptExpectationOf(receiptTarget: string): 'receivable' | 'process-label' {
    if (resolveAgentForTeam(receiptTarget) !== undefined) return 'receivable'
    if (/^dsh-host-[0-9a-f]{8}-/.test(receiptTarget)) return 'process-label'
    return 'receivable'
  }

  /**
   * v0.5.23 (async-stall): one delayed nudge per session while a task stays
   * unconsumed. The steer above parked the message; a latched wake replays
   * only at convergence, and a dropped one never does — the nudge re-steers
   * a one-line prompt after the delay, which productizes the manual
   * recovery this defect needed (a synchronous probe re-woke the session).
   * F2' (receipt-settlement): arming is unconditional and the per-session
   * single-flight is a bounded budget (initial delay + one re-arm) instead
   * of a one-shot — a target busy on its own turn at delay time used to
   * drop the shot entirely. At budget expiry the escalation climbs to the
   * host's queue-mode prompt seam when composed: queue-mode enqueues past
   * the maintenance latch that eats steers (08-30 evidence: queue woke a
   * session within 90s where steer stayed silent). No seam composed ⇒ the
   * escalation degrades to a no-op and the ledger row keeps the debt
   * visible for /a2a/query follow-ups.
   */
  const nudgeBudget = new Map<string, number>()
  const nudgeRef = (taskId: string): string => createHash('sha256').update(taskId, 'utf8').digest('hex').slice(0, 12)
  const escalateQueuePrompt = (agent: Agent, team: string, taskId: string): void => {
    // Queue-mode prompt seam (the session controller owns prompt admission); #183: it stamps kind:'user', so nudgeRef stands in for the caller's task id.
    const controller = ctx.get('sessionController') as
      | { prompt?: (request: {
          requestId: string
          sessionId: Agent['id']
          mode: 'queue' | 'steer'
          content: ReadonlyArray<{ type: 'text'; text: string }>
        }, signal: AbortSignal) => Promise<unknown> }
      | undefined
    if (typeof controller?.prompt !== 'function') return
    logger.info(`a2a: async nudge escalates to queue-mode prompt for ${team} (task ${taskId})`)
    try {
      void controller.prompt({
        requestId: `a2a-nudge-${nudgeRef(taskId)}`,
        sessionId: agent.id,
        mode: 'queue',
        content: [{ type: 'text', text: `[A2A nudge] (ref ${nudgeRef(taskId)}) an earlier A2A delivery reached this session while it could not start a turn — please consume the inbox backlog now (ignore if there is nothing pending).` }],
      }, new AbortController().signal).catch(() => {})
    } catch {
      /* queueing is best-effort: the ledger row keeps the debt visible */
    }
  }
  function armAsyncNudge(agent: Agent, team: string, taskId: string, delayMs: number): void {
    const key = String(agent.id)
    const spent = nudgeBudget.get(key)
    if (spent !== undefined && spent > 1) return
    nudgeBudget.set(key, spent ?? 0)
    const timer = setTimeout(() => {
      if (!taskLedger.isPending(taskId)) {
        nudgeBudget.delete(key)
        return
      }
      if (agent.status !== 'idle') {
        // Busy on its own turn (or wedged): spend the bounded re-arm, then
        // climb to the queue-mode seam. Re-resolve on the steer path below
        // only — a busy target needs the queue, not another steer.
        const spent = nudgeBudget.get(key) ?? 0
        if (spent < 1) {
          nudgeBudget.set(key, spent + 1)
          armAsyncNudge(agent, team, taskId, delayMs)
          return
        }
        nudgeBudget.delete(key)
        escalateQueuePrompt(agent, team, taskId)
        return
      }
      nudgeBudget.delete(key)
      // Re-resolve rather than reusing the delivered agent: a session-node
      // entry captured at delivery may have been disposed since (a stale
      // reference steers a dead object — no error, no log growth, exactly
      // the stall this nudge exists to recover). The registry lookup returns
      // the current live node, or the wake path materializes the session
      // afresh.
      const fresh = resolveAgentForTeam(team) ?? agent
      logger.info(`a2a: async nudge re-waking ${team} (task ${taskId} delivered but not consumed)`)
      steerRelay(fresh, `[A2A nudge] (ref ${nudgeRef(taskId)}) an earlier A2A delivery reached this session while it could not start a turn — please consume the inbox backlog now.`)
    }, delayMs)
    ctx.effect(() => () => clearTimeout(timer), `a2a: async nudge ${taskId}`)
  }

  /**
   * Receipt auto-synthesis (backlog root fix): an async delivery used to rely
   * on the target model choosing to route a "[A2A receipt] task <id>" message
   * back — a pure convention the models almost never honored, so the owed
   * book filled to TASK_CAP with receipts that would never come. The host
   * already owns the machinery to know when the steered turn produced a final
   * reply (the same final-waiter the sync wait uses), so the receipt is now
   * synthesized host-side: on the target's next final text, one loopback async
   * dispatch returns the receipt to the caller's routable team. Idempotent via
   * isPending (settled/archived/superseded tasks never double-send), and
   * receipts themselves are never tracked as new debts.
   */
  const receiptWarnAt = new Map<string, number>()

  function armReceiptAutosend(target: Agent, taskId: string, callerTeam: string | undefined, deliveredText: string, steerFloor: number): void {
    if (!callerTeam || callerTeam === '') return
    // Never synthesize a receipt for a receipt: answering an envelope by mail
    // would ping-pong both ledgers.
    if (deliveredText.startsWith('[A2A receipt] task ')) return
    // Belt and braces for the self-route shape: when the receipt target
    // names the steered agent itself, the waiter's reply would bounce back
    // to the sender as a synthetic receipt for its own task. The delivery
    // guards refuse that shape outright; this keeps the receipt half dead
    // even if a future path reopens it.
    if (callerTeam === `${config.team}/${agentId8(target)}`) return
    // #114 S5: the waiter is tied to THIS task's steer — only a final the
    // target produced after consuming `[A2A direct] (task <id>)` answers it
    // (flushFinals). A busy target's other work line can no longer settle
    // a task it has not read yet (the #61 direct-bb27ec94 shape).
    registerFinalWaiter(target, (finalText, placeholder) => {
      // W7 slice-2: a host-authored placeholder (flush timeout, dead
      // session) must not synthesize a COMPLETION receipt — a wedged
      // session has no product, and hook 3 would otherwise ledger the
      // placeholder as one on the same-node loop-back.
      if (placeholder === true) return
      // Idempotency: a row THIS ledger tracks must still be pending
      // (settled/dead rows never re-send). A foreign task id (an inbound
      // route the caller tracks on ITS node) has no local row — the final
      // waiter itself fires at most once per armed task, which is the dedup.
      const row = taskLedger.list().find(entry => entry.taskId === taskId)
      if (row !== undefined && row.status !== 'pending') return
      const summary = `${finalText.trim().replace(/\s+/g, ' ').slice(0, SUMMARY_CAP) || 'done'} (auto)`
      // v2 envelope projection: header stays byte-compatible for every
      // legacy correlator; the machine JSON rides exactly one following line.
      // #114 S5 binding: onBehalfOf names the session that did the work (the
      // host is only its courier); authRef pins the inbound authorization
      // record the delivery was born with — recorded for audit, judged by S4.
      const receipt = formatReceipt(taskId, summary, {
        outcome: 'completed',
        idempotencyKey: taskId,
        onBehalfOf: sessionTeamOf(target),
        ...(row?.auth !== undefined ? { authRef: authorizationRef(row.auth) } : {}),
      })
      // Three-tier hard order (work-order P2): caller lane first; on failure
      // escalate ONCE to the owner mailbox — the outcome never evaporates
      // just because the original waiter died. Archive holds truth regardless.
      // The deliver closure is a FULL dispatch (local first, then the
      // directory walk with failover, throwing when nothing delivers): the
      // callback address may be another node's team, and a local-only
      // closure would silently no-op there — runReceiptLadder reads a
      // settled undefined as tier-1 success, so the receipt would vanish
      // without a log.
      void runReceiptLadder(
        {
          deliver: async (team) => {
            const delivered = await dispatchAnywhere(team, receipt, session, undefined, new AbortController().signal, true)
            // gh#141: the caller lane pays this delivery's inbound row across hosts (a
            // same-host receipt already settled it in-process), unless the caller
            // refused it. The owner tier is no payment here — but an owner mailbox
            // on THIS host settles the row in-process, as it always has.
            if (team === callerTeam && delivered.settlementRefused !== true) settleOwnInbound(receipt, callerTeam, { caller: session, proof: 'in-process', ingress: 'local' })
          },
          ownerTeam: config.team,
          log: (stage, error) => {
            // N2 (observability): throttled per task to avoid ping-pong noise.
            const key = `receipt:${taskId}`
            if ((receiptWarnAt.get(key) ?? 0) + 60_000 > Date.now()) return
            receiptWarnAt.set(key, Date.now())
            logger.warn(`a2a: receipt autosend ${stage} for task ${taskId} failed: ${String(error).slice(0, 120)}`)
          },
        },
        callerTeam,
      ).catch(() => {
        // Ladder exhausted: the throttled breadcrumbs above already said why.
      })
    }, { taskId, steerFloor })
  }

  /**
   * Register one final-reply waiter for the agent and arm its flush timeout.
   * @param agent - the agent whose next assistant message answers the waiter.
   * @param answer - how the waiter's reply is delivered.
   * @param attribution - #114 S5: attribute by consumption — only the turn
   *   that consumed this task's `[A2A direct] (task <id>)` user message
   *   answers the waiter; the search starts at `steerFloor`, the log length
   *   read just before the steer, so an older steer of a reused id never
   *   anchors it.
   * @returns the registered waiter (for callers that may retract it).
   */
  function registerFinalWaiter(agent: Agent, answer: (text: string, placeholder?: boolean) => void, attribution?: { taskId: string; steerFloor: number }): FinalWaiter {
    const key = String(agent.id)
    const waiter: FinalWaiter = {
      answer,
      sinceEvents: sessionEventsOf(agent).length,
      ...(attribution !== undefined && attribution.taskId !== '' ? { taskId: attribution.taskId, scannedTo: attribution.steerFloor } : {}),
    }
    waiter.timeoutDisposer = armFlushTimeout(key, waiter)
    pendingFinals.set(key, [...(pendingFinals.get(key) ?? []), waiter])
    return waiter
  }

  /**
   * Steer one direct route request into a live agent and resolve with its
   * final reply (final semantics always: the HTTP caller has no other
   * channel to learn the reply). A bridge round that outlived the reply
   * window answers with `status: TASK_STATE_DELIVERED` + the `bridge`
   * marker instead of a (false) completion.
   * @param taskId - the correlation key the steered receipt header carries.
   */
  async function routeIntoAgent(team: string, message: string, caller: string, taskId?: string): Promise<
    { ok: true; reply: string; status?: string; bridge?: 'native-teams'; placeholder?: boolean } | { ok: false; error: string }
  > {
    const agent = resolveAgentForTeam(team) ?? canvasLiveAgent(parseCanvasTeamName(team))
    if (agent !== undefined) {
      return routeIntoAgentFor(agent, team, message, caller, taskId)
    }
    // Wake-on-route: a cold joined team materializes on demand, then steers.
    const wake = wakeColdTeam(team)
    if (wake.kind === 'flight') {
      return wake.flight.then(
        agent => routeIntoAgentFor(agent, team, message, caller, taskId),
        (error: unknown) => ({ ok: false, error: `waking the session for team "${team}" failed: ${String(error)}` }) as const,
      )
    }
    // Native-teams inbound bridge (opt-in): a registry team claims the
    // handle and dispatches through its authoritative seam. Checked before
    // the bare-team fallback — a team named exactly like this node's team
    // resolves to the registry's claim, not the initiator redirect.
    if (config.nativeTeamsInbound === true) {
      const prepared = await nativeTeamsPrepare(team)
      if (prepared.ok) {
        const bridged = await nativeTeamsRound(prepared, team, caller, message, taskId)
        if (bridged.ok) {
          if (bridged.settled) return { ok: true, reply: bridged.reply }
          return { ok: true, reply: bridged.reply, status: 'TASK_STATE_DELIVERED', bridge: 'native-teams' }
        }
        return { ok: false, error: bridged.error }
      }
    }
    // Only the bare process team falls back to the live (initiator) agent.
    // A session-node-shaped team that misses is an error, never a silent
    // redirect: a mistyped or stale short id must not reach another session
    // through the initiator fallback. A bare-team route whose caller IS the
    // resolved agent is refused outright: the initiator is the routing
    // session itself, so delivering would only loop the dispatch home.
    if (team === config.team) {
      const live = liveAgent()
      if (live !== undefined) {
        if (callerIsAgent(live, caller)) return { ok: false, error: selfRouteText(team) }
        return routeIntoAgentFor(live, team, message, caller, taskId)
      }
      return { ok: false, error: 'No live DSH agent is available to accept this message.' }
    }
    return { ok: false, error: wake.kind === 'no-face' ? noWakeFaceText(team) : wake.kind === 'archived' ? archivedColdMatchText(team) : noColdMatchText(team) }
  }

  /**
   * Steer one direct route request into one named agent and resolve with its
   * final reply.
   * @param agent - the session-node agent the request addresses.
   * @param team - team name the caller routed to (diagnostics).
   * @param message - request text.
   * @param caller - caller label for the steered prefix.
   * @returns the agent's final reply, or the explicit failure.
   */
  function routeIntoAgentFor(agent: Agent, team: string, message: string, caller: string, taskId?: string): Promise<
    { ok: true; reply: string; placeholder?: boolean } | { ok: false; error: string }
  > {
    return new Promise((resolve) => {
      const waiter = registerFinalWaiter(agent, (text, placeholder) => {
        resolve({ ok: true, reply: text, ...(placeholder === true ? { placeholder: true } : {}) })
      })
      // The header names the sender first: `caller` is the routing node's
      // own label (the session that issued the route), while `team` is this
      // request's target — showing the target as "remote team" hid the
      // actual origin behind the receiver's own team name. The task id, when
      // the caller supplied one, rides the header so an "[A2A receipt] task
      // <id>" answer correlates with the caller's own route result.
      const from = caller === '' ? 'an unknown node' : caller
      const taskPrefix = taskId === undefined ? '' : `(task ${taskId}) `
      const text = `[A2A direct] ${taskPrefix}${fromClause(from)} (routed to ${team}) sent:

${message}`
      try {
        steerRelay(agent, text, caller === '' ? undefined : caller)
      } catch (error) {
        // The waiter was registered above, so the key always holds it; the
        // map-of-arrays stays a plain read.
        const key = String(agent.id)
        const entries = pendingFinals.get(key) as FinalWaiter[]
        const kept = entries.filter(entry => entry !== waiter)
        if (kept.length === 0) pendingFinals.delete(key)
        else pendingFinals.set(key, kept)
        waiter.timeoutDisposer?.()
        resolve({ ok: false, error: `The DSH session rejected the message: ${String(error)}` })
      }
    })
  }

  // gh#77 G-in (S23 repayment): the native-teams inbound bridge moved verbatim
  // to src/legacy/teams-bridge-inbound.ts — the registry probe, claim memo,
  // prepare and the bounded round. The outbound bridgeFace stays here until
  // the G-out slice (it submits through the dispatch trunk).
  const { teamsRegistry, nativeTeamsClaims, nativeTeamsPrepare, nativeTeamsRound } = createTeamsBridgeInbound({ ctx, config, liveAgent, fromClause })

  /* ── gh#9+gh#10 OriginClaim (docs/protocol/delivery-origin-auth.md,
     src/origin-claim.ts): the caller's card key signs the envelope; the
     bound form must name one of OUR origins and the route it hits. ts skew
     ±5 min, no receiver-side state. Fail-closed everywhere. */
  /** legacyInbound warn metric (M1): envelope-absent deliveries during the
   *  window — the operator watches the tail drain before closing it. */
  let legacyInboundCount = 0
  /** unboundInbound: accepted unbound (v1) envelopes — the drain gauge for
   *  closing originClaimUnboundWindow; boundMissInbound: those of them whose
   *  bound form missed (a peer dials us by a name not in our audiences). */
  let unboundInboundCount = 0, boundMissInboundCount = 0
  function verifyOriginClaim(req: IncomingMessage, options?: { readonly cli?: boolean }): Promise<OriginClaimVerdict> {
    return verifyOriginClaimOf(req, {
      cardCache,
      fetch: fetchImpl,
      audiences: [ownCardUrl, ...config.originClaimAudiences ?? []],
      unboundOpen: config.originClaimUnboundWindow !== false,
      onUnbound: () => { unboundInboundCount += 1 },
      onBoundMiss: () => { boundMissInboundCount += 1 },
      loopbackArrival: (config.originClaimUrl ?? '') === '',
      now: Date.now(),
      ...(options?.cli === true ? { cliDeposit: cliDepositCard } : {}),
    })
  }

  /**
   * gh#133: the deposited card a CLI claim is judged by, or undefined when
   * the claim URL is not a deposit face of a handle held here (the ordinary
   * zone path then decides). The URL's last path segments must be
   * `/a2a/cli/<handle>` (any prefix or origin: the CLI dials its home under
   * whatever address it can — the deposited key, not the address, is the
   * proof). origin-claim.ts verifies the signature under that card and the
   * signed name against the handle's own; the claim's caller is the full
   * HANDLE, so it covers exactly that handle — never a namesake CLI, a zone
   * session, or the host face (review of PR #135 P1).
   */
  function cliDepositCard(callerUrl: string): CliDepositCard | undefined {
    let path: string
    try { path = new URL(callerUrl).pathname } catch { return undefined }
    const segment = /\/a2a\/cli\/([^/]+)\/?$/.exec(path)?.[1]
    if (segment === undefined) return undefined
    let handle: string
    try { handle = decodeURIComponent(segment) } catch { return undefined }
    const shape = CLI_HANDLE_RE.exec(handle)
    const deposit = shape === null ? undefined : cliDeposits.get(handle)
    if (shape === null || deposit === undefined) return undefined
    try {
      const verdict = verifyCard(JSON.parse(deposit.cardJson), Date.now())
      return { handle, name: shape[1]!, card: verdict.ok && verdict.card.team === handle ? verdict.card : undefined }
    } catch {
      return { handle, name: shape[1]!, card: undefined }
    }
  }

  /**
   * W3 (#18 half-side): is a VERIFIED caller LINKED to this host? Key
   * possession proves the caller is a real host; it says nothing about a
   * relationship with US. The full card carries collaboration facts
   * (sessionTeams/rosters), so it additionally requires a link:
   *   1. same-host membership — the caller's card URL origin equals OUR
   *      card URL origin (the loopback self-fetch face: true self is an
   *      ORIGIN equality; zone-name equality carries no identity in a
   *      single-zone fleet), or one of our session pseudo-handles;
   *   2. a canvas remote ref — the EXACT handle only (#19 D1, ruling
   *      final: the zone-sibling variant was a blanket fallback that any
   *      one ref opened to a whole zone's hosts in single-zone fleets; the
   *      operator names THAT node, that node links);
   *   3. BILATERAL seeding (review M1 fix): our config.peers contains the
   *      caller's URL **and** the caller's card (fetched fresh during
   *      verification) carries our origin among its peers — both
   *      operators made the gesture, each on their own side. The single-
   *      sided card-claims variant was a hole the reviewer's adversarial
   *      probe walked through (one config.peers line → full card with
   *      zero commitment from us): peers is an unsigned served-fresh
   *      field, exactly the self-description trust class N3/V5 abolished.
   *      Our operator's config anchors; the card shadow corroborates.
   */
  function callerLinkedToThisHost(caller: string, callerUrl: string, callerCard: A2aPeerCard | undefined): boolean {
    // gh#133 review: a CLI identity's card (team = its handle) is never a host link, whatever face asks.
    if (callerCard !== undefined && CLI_HANDLE_RE.test(callerCard.team)) return false
    // Basis 1, same-host membership (review second-round M-fix): "self" is
    // an ORIGIN equality, not a zone-name equality. `caller === config.team`
    // granted unconditionally in a single-zone fleet (the deployment
    // reality: every host named 'dsh') — any verified caller naming the
    // shared zone string was "us". True self is the loopback self-fetch
    // face: the caller's card URL origin equals OUR card URL origin.
    try {
      if (callerUrl !== '' && new URL(callerUrl).origin === new URL(ownCardUrl).origin) return true
    } catch { /* malformed callerUrl — falls through to the record bases */ }
    for (const id of joinedSessions.list()) {
      if (`${config.team}/${id8(id)}` === caller) return true
    }
    // #19 D1 (ruling final): canvas remote refs admit by EXACT HANDLE only.
    // The zone-sibling variant (`refZone === zone`) was a blanket fallback —
    // in a single-zone fleet any one ref linked the whole zone face, the
    // exact trust shape the exposure ruling removed. Exact handle in, the
    // operator named THAT node.
    for (const name of canvasStore.list()) {
      for (const ref of canvasStore.remoteMembersOf(name)) {
        if (ref === caller) return true
      }
    }
    // Basis 3, BILATERAL (review M1 fix): OUR config.peers seeds a URL
    // whose origin matches the caller's card URL, AND the caller's card
    // reciprocates by carrying OUR origin among its peers — both
    // operators made the gesture, each on their own side. The single-
    // sided card-claims variant was a hole the reviewer's adversarial
    // probe walked through (one config.peers line on the CALLER → full
    // card with zero commitment from us): peers is an unsigned
    // served-fresh field, exactly the self-description trust class
    // N3/V5 abolished. Our operator's own config anchors; the card
    // shadow only corroborates.
    if (callerCard !== undefined && ownCardUrl !== '') {
      const ourOrigin = new URL(ownCardUrl).origin
      const callerOrigin = new URL(callerUrl).origin
      const weSeedThem = config.peers.some(peer => {
        try { return new URL(peer).origin === callerOrigin } catch { return false }
      })
      const theySeedUs = (callerCard.peers ?? []).some(peer => {
        try { return new URL(peer).origin === ourOrigin } catch { return false }
      })
      if (weSeedThem && theySeedUs) return true
    }
    return false
  }

  /* ── Inbound admission shared by the peer faces (/a2a/direct,
     /a2a/log) and — since the boundary-hardening wave (W1) — the LOCAL
     dispatch candidate: caller_session is the protocol contract.
     Anonymous is refused, and admission is decided by THIS host's own
     records — never by the caller's self-description (gh#7 N3, V3/V5).
     Returns the refusal detail, or undefined when admissible. */

  /**
   * W1/W2 shared-team admission core (pure over the host's stores): a
   * same-zone zone/id8 caller passes when it holds a team this host's
   * records also hold. The caller's basis is its roster declarations UNION
   * its canvas memberships (W2②: canvas teammates share a team by being in
   * the team — the roster is not the only link record); the host's basis is
   * the routable set (bare zone, joined handles, canvas names) union other
   * sessions' declarations. Used by both the inbound faces and the local
   * dispatch candidate so the two paths can never diverge.
   */
  // gh#114 S1: the admission rules live in src/task-auth.ts as one pure
  // decision over these records; the closures below are thin wrappers, so
  // the faces' refusal texts and the authorization record (S2) can never
  // disagree. Records are read at decision time, never copied.
  const admissionRecords: AdmissionRecords = {
    zone: config.team,
    get teamScopeRouting() { return config.teamScopeRouting },
    id8,
    canvasTeamOf,
    memberships: () => teamMemberships.list(),
    joined: () => joinedSessions.list(),
    canvasNames: () => canvasStore.list(),
    canvasTeamsOf: sessionId => canvasStore.teamsOf(sessionId),
    canvasMembersOf: name => canvasStore.membersOf(name),
    canvasRemoteMembersOf: name => canvasStore.remoteMembersOf(name),
    peerOrgs: function * () {
      for (const cached of cardCache.values()) {
        const org = (cached.card as { canvasOrg?: PeerOrgEntry[] } | undefined)?.canvasOrg
        if (Array.isArray(org)) yield org
      }
    },
    liveNodeIds: () => [...sessionNodes.values()].map(agent => String(agent.id)),
    cliDeposited: handle => cliDeposits.get(handle) !== undefined,
  }

  /** W1/W2 shared-team admission (see sameZoneAdmission in src/task-auth.ts). */
  function sameZoneSharedTeamRefusal(caller: string, targetTeam?: string): string | undefined {
    return refusalOf(sameZoneAdmission(admissionRecords, caller, targetTeam))
  }

  /** W1: the joined-face gate of the local dispatch candidate (see joinedFaceAdmission). */
  function joinedFaceAdmissionRefusal(callerSession: string | undefined, targetTeam?: string): string | undefined {
    const verdict = joinedFaceAdmission(admissionRecords, callerSession, targetTeam)
    return verdict === undefined ? undefined : refusalOf(verdict)
  }

  /** Inbound admission with the rule and shared teams that admitted the caller (gh#114 S1). */
  function a2aCallerAdmission(caller: string, targetTeam?: string): Admission {
    return callerAdmission(admissionRecords, caller, targetTeam)
  }

  function a2aCallerRefusal(caller: string, targetTeam?: string): string | undefined {
    return refusalOf(a2aCallerAdmission(caller, targetTeam))
  }

  /**
   * #114 S2: the allowlist version over the operator-controlled records the
   * admission rules read (design §2.3). The peer-card canvasOrg is left out:
   * a record admitted by it carries `peer-org:<team>` in its basis instead.
   */
  function allowlistVersionNow(): string {
    return allowlistVersion(allowlistInputsNow())
  }

  /** The records allowlistVersionNow hashes (design §2.3), read live. */
  function allowlistInputsNow(): AllowlistInputs {
    const handle = (session: string): string => `${config.team}/${id8(session)}`
    return {
      zone: config.team,
      scope: [config.teamScopeRouting, config.originClaimWindow !== false],
      joined: joinedSessions.list().map(handle),
      roster: teamMemberships.list().flatMap(entry => entry.teams.map(team => [handle(entry.session), team] as const)),
      // Local members by their handle (design §2.3), remote refs as they are stored.
      canvas: canvasStore.list().map(name => [canvasTeamOf(name), canvasStore.membersOf(name).map(m => (m.includes('/') ? m : handle(m)))] as const),
      cli: cliDeposits.list().map(row => row.handle),
      links: config.peers.map(peer => { try { return new URL(peer).origin } catch { return peer } }),
    }
  }

  /*
   * #114 S6 (design §5): when the version moves, the unsettled tasks born
   * under another one are re-judged against today's records and the
   * affected ones recorded — OBSERVE ONLY: nothing is cancelled, no row's
   * state changes, no session is nudged, no receipt is blocked. Called
   * lazily (state/tasks reads, inbound admission) and at the known change
   * points (the stores' onChange hooks below); never on a timer.
   */
  const authObserver = new AuthObserver(join(home, 'a2a', 'auth-versions.json'))

  function observeAuthorization(cause: string): void {
    const inputs = allowlistInputsNow()
    const entry = authObserver.observe({
      version: allowlistVersion(inputs),
      inputs: () => JSON.parse(canonicalAllowlist(inputs)) as unknown,
      cause,
      rows: () => taskLedger.list(),
      // A local-candidate record (#139) is judged as the local candidate admits; every other one by the wire face.
      judge: (caller, target, ingress) => (ingress === 'local' ? localCandidateAdmission(admissionRecords, caller, target) : callerAdmission(admissionRecords, caller, target)),
    })
    if (entry === undefined) return
    const revoke = entry.tasks.filter(task => task.verdict === 'would-revoke').length
    logger.info(`a2a: allowlist ${entry.from_version ?? '(none)'} → ${entry.to_version} (${entry.cause}): ${String(entry.tasks.length)} affected task(s), ${String(revoke)} would-revoke — observe only, nothing cancelled`)
    try {
      ctx.emit('a2a/authorization-affected', entry)
    } catch (error) {
      logger.warn(`a2a: authorization-affected listener rejected: ${String(error)}`)
    }
  }

  /** The /state `authorization` block: the version history (newest first, inputs omitted) and the affected entries. */
  function authorizationView(): { version: string; history: Array<{ version: string; at: number; cause: string }>; affected: readonly AffectedEntry[] } {
    observeAuthorization('lazy')
    return {
      version: allowlistVersionNow(),
      history: authObserver.history().map(({ version, at, cause }) => ({ version, at, cause })),
      affected: authObserver.entries(),
    }
  }


  /* ── Session-log read faces (shared by the local control route and the
     peer /a2a/log face): both answer from <dshHome>/sessions with
     identical semantics — artifact existence is the only gate (archived
     and never-joined sessions stay readable), caps mirror
     session-transcript.ts. */
  function scanSessionLogList(): Array<{ id: string; mtimeMs: number; sizeBytes: number }> {
    const rows: Array<{ id: string; mtimeMs: number; sizeBytes: number }> = []
    const sessionsRoot = join(home, 'sessions')
    if (!existsSync(sessionsRoot)) return rows
    for (const bucket of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue
      for (const child of readdirSync(join(sessionsRoot, bucket.name), { withFileTypes: true })) {
        if (!child.isDirectory()) continue
        const dir = join(sessionsRoot, bucket.name, child.name)
        const files = readdirSync(dir).filter(name => name.startsWith('session.') && (name.endsWith('.jsonl.zstd') || name.endsWith('.jsonl')))
        if (files.length === 0) continue
        let newest: { mtimeMs: number; sizeBytes: number } | undefined
        for (const name of files) {
          const st = statSync(join(dir, name))
          if (newest === undefined || st.mtimeMs > newest.mtimeMs) newest = { mtimeMs: st.mtimeMs, sizeBytes: st.size }
        }
        if (newest !== undefined) rows.push({ id: child.name, ...newest })
      }
    }
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return rows
  }

  function readSessionLogTail(id: string, limit: number): { ok: true; id: string; messages: Array<{ role: string; text: string; time?: number }> } | { ok: false; error: string } {
    const sessionsRoot = join(home, 'sessions')
    let logPath: string | undefined
    if (existsSync(sessionsRoot)) {
      for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = join(sessionsRoot, entry.name, id)
        if (!existsSync(candidate)) continue
        const files = readdirSync(candidate).filter(name => name.startsWith('session.') && (name.endsWith('.jsonl.zstd') || name.endsWith('.jsonl')))
        // Generation artifacts: session.v{N}.jsonl[.zstd] is the newest
        // format generation — read the highest N, preferring zstd at the
        // same generation.
        const generation = (name: string): number => Number(name.match(/\.v(\d+)\./)?.[1] ?? 0)
        const rank = (name: string): number => generation(name) * 2 + (name.endsWith('.zstd') ? 1 : 0)
        files.sort((a, b) => rank(b) - rank(a))
        logPath = files[0] !== undefined ? join(candidate, files[0]) : undefined
        break
      }
    }
    if (logPath === undefined) return { ok: false, error: 'no log artifact for this session' }
    const stat = statSync(logPath)
    if (stat.size > TRANSCRIPT_MAX_FILE_BYTES) return { ok: false, error: 'session log exceeds the size cap' }
    const entries = extractTranscript(decodeSessionLog(readFileSync(logPath)), limit)
    return { ok: true, id, messages: entries.map(entry => ({ role: entry.role, text: entry.text, ...(entry.time !== undefined ? { time: entry.time } : {}) })) }
  }

  whenWebServerSettled((webServer) => {
    registerWireFaces(webServer, {
      ctx,
      logger,
      config,
      cliDeposits,
      canvasStore,
      sessionNodes,
      joinedSessions,
      idempotencyStore,
      verifyOriginClaim,
      callerLinkedToThisHost, get ownCardUrl() { return ownCardUrl },
      recordActivity,
      bumpLegacyInbound: () => { legacyInboundCount += 1 },
      secretEqual,
      a2aCallerRefusal,
      a2aCallerAdmission,
      allowlistVersionNow,
      observeAuthorization,
      scanSessionLogList,
      readSessionLogTail,
      taskLedger,
      refuseIfFlooded,
      settleAndAnnounce,
      touchWakeDemand: () => { lastWakeDemandAt = Date.now() },
      session,
      resolveAgentForTeam,
      parseCanvasTeamName,
      canvasLiveAgent,
      wakeColdTeam,
      probeConsumption,
      sessionTeamOf,
      localSessionOfHandle,
      steerRelay,
      fromClause,
      armReceiptAutosend,
      eventCountOf: (agent: Agent) => sessionEventsOf(agent).length,
      receiptExpectationOf,
      armAsyncNudge,
      liveAgent,
      callerIsAgent,
      selfRouteText,
      noWakeFaceText,
      archivedColdMatchText,
      noColdMatchText,
      nativeTeamsPrepare,
      nativeTeamsRound,
      routeIntoAgent,
    })


  })

  whenWebServerSettled((webServer) => {
    // Task-ledger control: explicit caller-side abandonment of one owed
    // async task — the orchestrator's give-up path (work-order P1a).
    // Deliberately OUTSIDE the sessionNodes gate: every async route tracks
    // its task whether or not this node exposes joinable sessions. Rides the
    // standard control guard; structured outcome vocabulary
    // {cleared|already-terminal|unknown}; idempotent; never throws.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/tasks/abandon',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        readJsonBody(req, res, (body) => {
          const fields = body as Record<string, unknown>
          const taskId = typeof fields.task_id === 'string' ? fields.task_id : ''
          const reason = typeof fields.reason === 'string' ? fields.reason : undefined
          const result = taskLedger.abandon(taskId, reason)
          const payload = JSON.stringify(result)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        })
      }),
    }), 'a2a: task abandon route')
  })

  whenWebServerSettled((webServer) => {
    // Cooperative cancellation (work-order P1b): end the owed row AND, when
    // it pointed at a live local target, steer a stop notice so a running
    // turn wraps up instead of burning budget on an orphaned task. Standard
    // control guard; total outcome vocabulary like the abandon sibling.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/tasks/cancel',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        readJsonBody(req, res, (body) => {
          const fields = body as Record<string, unknown>
          const taskId = typeof fields.task_id === 'string' ? fields.task_id : ''
          const reason = typeof fields.reason === 'string' ? fields.reason : undefined
          const result = taskLedger.cancel(taskId, reason)
          let steered = false
          if (result.outcome === 'cleared' && result.team !== undefined) {
            const live = resolveAgentForTeam(result.team)
              ?? canvasLiveAgent(parseCanvasTeamName(result.team))
              ?? (result.team === config.team ? liveAgent() : undefined)
            if (live !== undefined) {
              try {
                steerRelay(live, cancelNoticeText(taskId, reason))
                steered = true
              } catch {
                // Bookkeeping already settled; steering is best-effort only.
              }
            }
          }
          const payload = JSON.stringify({ ...result, steered })
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        })
      }),
    }), 'a2a: task cancel route')

    // Quick dispatch (0.6.9, design docs/design/quick-dispatch-l3.md): a
    // human at the workbench sends one message to a team without opening a
    // session. Host face by construction — it rides the same routing trunk
    // as a2a_route with no agent: the agent-less audit gate applies, the
    // join gate exempts it (a human gesture, not a session), and the caller
    // label is the bare node team so the target can answer. Async is fixed
    // (fire-and-forget with the receipt contract); the HTTP wait is bounded
    // well under routeTimeoutMs because delivery, not the answer, is what
    // this face returns. Guards: the standard control-plane trust (same
    // origin / loopback / apiKey), a 4000-char message cap, and a 5s
    // per-client window — a human cannot click faster than that.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/dispatch',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        readJsonBody(req, res, async (body) => {
          const fields = body as Record<string, unknown>
          const message = typeof fields.message === 'string' ? fields.message.trim() : ''
          const target = typeof fields.team === 'string' ? fields.team.trim() : ''
          const client = req.socket.remoteAddress ?? 'unknown'
          const now = Date.now()
          let result: Record<string, JsonValue>
          if (target === '' || message === '') {
            result = { ok: false, error: 'team and message are required' }
          } else if (message.length > 4000) {
            result = { ok: false, error: 'message exceeds the 4000-char cap' }
          } else if (now - (dispatchLastAt.get(client) ?? 0) < 5_000) {
            result = { ok: false, error: 'rate limited: one quick dispatch per 5s per client' }
          } else {
            dispatchLastAt.set(client, now)
            try {
              // gh#36: a quick dispatch rides a LIVE joined session's node
              // team as its caller face when one exists — receipts then
              // route back to that session and the owner SEES the answer in
              // its chat drawer. Bare-zone callers (the old shape) cannot
              // receive: the receipt ladder failed every lane and the owner
              // read it as 派发异常没有收信. No live session keeps the
              // host face (the reply's reconciliation note still applies).
              const liveJoined = joinedSessions.list().find(id => liveRoots.has(id))
              const hostFace = liveJoined !== undefined ? `${config.team}/${id8(liveJoined)}` : config.team
              result = await routeTrunk({ team: target, message, async: true }, undefined, AbortSignal.timeout(20_000), hostFace)
            } catch (error) {
              result = { ok: false, error: `dispatch failed: ${error instanceof Error ? error.message : String(error)}` }
            }
          }
          const payload = JSON.stringify(result)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        })
      }),
    }), 'a2a: quick-dispatch route')

    // Session transcript reader (0.6.11): the workbench inspector shows the
    // tail of a LOCAL node's own conversation log inline — owner ruling
    // 2026-10-20 banned navigation, and reading is the need jumps used to
    // serve. The id gate is artifact existence under this host's sessions
    // tree — reading is a host-workbench concern, not a network-membership
    // concern, so archived and never-joined sessions stay readable while the
    // network faces keep their own visibility rules. Path shape is still
    // checked (no '/', '\', '..') and the tree never leaves <dshHome>/sessions.
    // Without an id the same face lists readable sessions (newest activity
    // first, capped) so the workbench directory can offer log rows even when
    // the network directory shows none. Caps mirror session-transcript.ts.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/session-log',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const id = url.searchParams.get('id') ?? ''
        const limitArg = Number(url.searchParams.get('limit') ?? TRANSCRIPT_DEFAULT_LIMIT)
        const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(TRANSCRIPT_MAX_LIMIT, Math.floor(limitArg))) : TRANSCRIPT_DEFAULT_LIMIT
        let result: Record<string, JsonValue>
        if (id.includes('/') || id.includes('\\') || id.includes('..')) {
          result = { ok: false, error: 'id is required' }
        } else if (id === '') {
          // Listing face: every session directory holding a log artifact.
          try {
            const rows = scanSessionLogList()
            result = { ok: true, count: rows.length, sessions: rows.slice(0, 50) }
          } catch (error) {
            result = { ok: false, error: `transcript list failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        } else {
          try {
            const tail = readSessionLogTail(id, limit)
            if (!tail.ok) result = { ok: false, error: tail.error }
            else result = { ok: true, id: tail.id, count: tail.messages.length, messages: tail.messages }
          } catch (error) {
            result = { ok: false, error: `transcript failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        }
        const payload = JSON.stringify(result)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }),
    }), 'a2a: session-log route')

    // 0.6.15: the local proxy for REMOTE session logs. The workbench runs
    // in this host's browser page, so cross-host reads must originate from
    // this host (no CORS, one trust boundary). ?team=<zone/id8> resolves
    // directory candidates that publish that team (same walk as routing);
    // ?peer=<base-url> targets one tracked peer directly and MUST name a
    // URL already in the peer store — the proxy never fetches an
    // arbitrary address. The caller label we present is config.team (this
    // node's own zone handle, the same host face quick-dispatch uses).
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/remote-session-log',
      handler: controlRoute(async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const team = url.searchParams.get('team') ?? ''
        const peer = url.searchParams.get('peer') ?? ''
        const id = url.searchParams.get('id') ?? ''
        const limitArg = Number(url.searchParams.get('limit') ?? TRANSCRIPT_DEFAULT_LIMIT)
        const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(TRANSCRIPT_MAX_LIMIT, Math.floor(limitArg))) : TRANSCRIPT_DEFAULT_LIMIT
        const finish = (body: Record<string, JsonValue>): void => {
          const payload = JSON.stringify(body)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
          res.end(payload)
        }
        if (id.includes('/') || id.includes('\\') || id.includes('..')) {
          finish({ ok: false, error: 'id is required' })
          return
        }
        const trackedPeers = new Set(peerStore.list().map(entry => entry.replace(/\/+$/, '')))
        let targets: string[]
        if (peer !== '') {
          const normalized = peer.replace(/\/+$/, '')
          if (!trackedPeers.has(normalized)) {
            finish({ ok: false, error: 'unknown peer on this node — the proxy only reads tracked peers' })
            return
          }
          targets = [normalized]
        } else if (team !== '') {
          const failures: string[] = []
          targets = await directoryPeerCandidates(memoizedCardFetch(), team, failures)
          if (targets.length === 0) {
            finish({ ok: false, error: `no directory candidate publishes team "${team}"${failures.length > 0 ? ` (${failures.slice(0, 3).join('; ')})` : ''}` })
            return
          }
        } else {
          finish({ ok: false, error: 'team or peer is required' })
          return
        }
        // 0.6.16: a team-handle read without an explicit id names a NODE, not
        // a session. The handle suffix (zone/<id8>) is the first 8 hex of the
        // peer-side session id (sessionTeamOf), so resolve the listing once
        // and pick that session — bare zone teams fall back to the newest.
        // An explicit id (peer drill) short-circuits this.
        let resolvedId = id
        if (resolvedId === '' && team !== '') {
          const suffix = team.includes('/') ? team.slice(team.lastIndexOf('/') + 1) : ''
          for (const base of targets) {
            const listUrl = new URL('/a2a/log', base)
            listUrl.searchParams.set('caller_session', config.team)
            try {
              const listResponse = await globalThis.fetch(listUrl, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
              const listBody = await listResponse.json().catch(() => ({ ok: false, error: `peer answered HTTP ${listResponse.status}` })) as { ok?: boolean; error?: string; sessions?: Array<{ id: string }> }
              if (listResponse.ok && listBody.ok === true && Array.isArray(listBody.sessions)) {
                const picked = suffix !== '' ? listBody.sessions.find(row => row.id.includes(suffix)) : listBody.sessions[0]
                if (picked !== undefined) {
                  resolvedId = picked.id
                  break
                }
              }
            } catch {
              // listing failed on this candidate — the tail attempt below
              // will surface the honest error for the same base
            }
          }
          if (resolvedId === '') {
            finish({ ok: false, error: `no readable session on this peer matches "${team}"` })
            return
          }
        }
        const attempts: string[] = []
        for (const base of targets) {
          const target = new URL('/a2a/log', base)
          target.searchParams.set('caller_session', config.team)
          if (resolvedId !== '') target.searchParams.set('id', resolvedId)
          target.searchParams.set('limit', String(limit))
          try {
            const response = await globalThis.fetch(target, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
            const body = await response.json().catch(() => ({ ok: false, error: `peer answered HTTP ${response.status}` })) as { ok?: boolean; error?: string }
            if (response.ok && body.ok === true) {
              finish({ ...body, via: base } as Record<string, JsonValue>)
              return
            }
            attempts.push(`${base}: ${body.error ?? `HTTP ${response.status}`}`)
          } catch (error) {
            attempts.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        finish({ ok: false, error: `remote log unavailable — ${attempts.join(' | ')}` })
      }),
    }), 'a2a: remote-session-log proxy route')
  })

  /**
   * Settle one card-fetch outcome into the peer store and the plain card:
   * the fetch is itself the reachability check — a miss degrades the peer, a
   * verified card raises it and offers its referral list to the store. A
   * peer offered mid-iteration is fetched on a later tool call, so gossip
   * converges across calls.
   * @param peer - base URL of the peer the outcome belongs to.
   * @param outcome - the detailed fetch outcome (probe and discovery share it).
   * @returns the verified card, or undefined when the peer is unreachable, rejected, a self-referral, or a dropped alias.
   */
  function settlePeerCard(peer: string, outcome: CardFetchOutcome): A2aPeerCard | undefined {
    if (!outcome.ok) {
      peerStore.noteFailure(peer)
      return undefined
    }
    // A self-referral learned from a peer's card (the peer lists this node's
    // URL back at it) must not track the node as its own peer: the node would
    // list its own teams as remote rows and offer its own URL onward. The
    // signed card session is the identity check — no URL guessing.
    if (outcome.card.session === session) {
      // Remember the alias so mirrored referral lists stop re-offering it
      // between fetches (the drop alone flickers in and out of the store).
      selfReferrals.remember(peer)
      peerStore.drop(peer)
      return undefined
    }
    // Alias collapse (same-node dedup): one node reaches the fleet under
    // several spellings — loopback vs LAN IP vs hostname — and different
    // gossip sources list different ones, so the store accumulates several
    // peers for one node and the plan canvas renders one card per spelling.
    // The signed card session is the node identity: when another tracked
    // peer already serves it, keep the stronger entry (seed, then score),
    // learn the identity on it, and forget the alias. The suppression
    // window stops the dropped spelling from riding the next gossip round
    // straight back in. A seed alias is config-owned: drop() refuses it and
    // both spellings stay, exactly as the owner configured.
    const known = peerStore.bySession(outcome.card.session)
    if (known !== undefined && known !== peer) {
      const keep = (peerStore.score(known) ?? 0) >= (peerStore.score(peer) ?? 0) ? known : peer
      const alias = keep === known ? peer : known
      peerStore.drop(alias)
      selfReferrals.remember(alias)
      peerStore.learnSession(keep, outcome.card.session)
      peerStore.noteSuccess(keep)
      return outcome.card
    }
    peerStore.noteSuccess(peer)
    peerStore.learnSession(peer, outcome.card.session)
    for (const referral of outcome.card.peers ?? []) {
      if (!selfReferrals.shouldOffer(referral)) continue
      if (!peerAdmissible(referral)) continue
      peerStore.offer(referral)
    }
    return outcome.card
  }

  /**
   * Fetch one peer's card and settle it into the store (discovery path).
   * @param peer - base URL of the peer to visit.
   * @returns the verified card, or undefined when the peer is unreachable or serves an invalid card.
   */
  async function fetchPeerCard(peer: string): Promise<A2aPeerCard | undefined> {
    return settlePeerCard(peer, await client.fetchCardDetail(peer))
  }

  /**
   * Apply-scope shared card cache: every caller (teams listing, route
   * candidate walks, panel sweeps) shares one TTL window per URL, so a
   * poll-happy consumer cannot re-fetch a peer's card — or re-punish a dead
   * one — more than once per window. Cards live for days and re-sign at
   * TTL/4, so a 60s serve window is semantically safe. Negative results
   * (unreachable/invalid) cache for a shorter window so a restarting peer
   * reappears quickly. Scoring stays with the real network fetch only: a
   * cache hit never re-scores, which is what keeps the debounced peer-store
   * writes rare. Concurrent callers for one URL join a single in-flight
   * fetch (single-flight) instead of racing N requests.
   */
  const cardCache = new Map<string, CardCacheEntry>()
  const cardCacheInFlight = new Map<string, Promise<A2aPeerCard | undefined>>()
  // #114 S6: the change hooks and the boot observation start only once every
  // record admission reads exists (the peer-org basis reads cardCache above).
  // The cache is still empty here, so the observer skips cache-resting rows
  // on 'boot' (#138 R1); the first lazy read rechecks them.
  ctx.effect(() => canvasStore.onChange(() => observeAuthorization('canvas')), 'a2a: S6 canvas observer')
  ctx.effect(() => joinedSessions.onChange(() => observeAuthorization('joined')), 'a2a: S6 joined observer')
  ctx.effect(() => teamMemberships.onChange(() => observeAuthorization('roster')), 'a2a: S6 roster observer')
  observeAuthorization('boot')

  /**
   * The from-line display name (owner ruling, claim 8ea4150f94): a bare
   * routing handle (`dsh/74555a36`) carries zero semantics for the reader.
   * Resolve what the handle NAMES, cheaply and read-only:
   *   1. a local handle — a joined/live session id, its zone/id8 pseudo-team,
   *      or a live node label → nodeMetadataOf(agent).name (the session-title
   *      product, exactly what the directory shows);
   *   2. a remote bare-zone caller → the warmest cached card whose team
   *      equals the zone (the publisher's own card NAME is the display name);
   *   3. a remote zone/id8 caller → the cached card whose sessionTeams row
   *      matches the handle → that row's name;
   *   4. nothing resolves → '' (the from line stays bare — no false names).
   * Read-only over warm caches: never fetches, so a cold cache degrades to
   * the bare handle, never to a stall.
   */
  function callerDisplayName(caller: string): string {
    if (caller === '' || caller === 'an unknown node') return ''
    // Local: joined/live session facts on THIS host.
    for (const [id, agent] of sessionNodes) {
      if (id === caller || sessionLabelOf(agent) === caller || `${config.team}/${id8(id)}` === caller) {
        return nodeMetadataOf(agent).name
      }
    }
    for (const [id, agent] of liveRoots) {
      if (id === caller || sessionLabelOf(agent) === caller || `${config.team}/${id8(id)}` === caller) {
        return nodeMetadataOf(agent).name
      }
    }
    // Remote: warm card cache only.
    const zone = caller.includes('/') ? caller.slice(0, caller.indexOf('/')) : caller
    let zoneName = ''
    for (const entry of cardCache.values()) {
      const card = entry.card
      if (card === undefined) continue
      if (card.team === zone && zoneName === '') zoneName = card.name
      if (caller.includes('/')) {
        const row = (card.sessionTeams ?? []).find(item => item.team === caller)
        if (row !== undefined && row.name !== '') return row.name
      }
    }
    if (!caller.includes('/') && zoneName !== '') return zoneName
    return ''
  }

  /** The from clause with the display name in full-width parens when resolved. */
  function fromClause(from: string): string {
    const display = callerDisplayName(from)
    return `from "${from}"${display !== '' ? `（${display}）` : ''}`
  }

  /**
   * gh#20 W-A: THIS host's view of one tracked peer's link state (the
   * mirror of callerLinkedToThisHost, judged from our side about THEM):
   *   · linked — bilateral seeding (our config.peers carries a URL of the
   *     peer's origin AND the peer's card carries ours), or a canvas remote
   *     ref naming the peer's zone or one of its session teams;
   *   · stranger — no operator-established basis (a verified key is not a
   *     relationship);
   *   · verified — we hold a signature-valid cached card (the badge's
   *     tick/cross: reachable-and-authentic vs unknown/bad).
   * NOTE (gh#20 review observation, ruling-accepted): the UI's third
   * colour — fleet blue — has no v1 data source: a peer's #19 exposure
   * tier is that host's state-face private fact and is NOT published on
   * its card, so we cannot classify a peer as fleet-visible. The badge
   * renders two colours (linked green / stranger gray) and the blue slot
   * lights up the day the card face carries a tier field (or an
   * a2a_exposure state query is added to fetch it).
   * Pure over warm caches and config; never fetches.
   */
  function peerLinkState(peerUrl: string): { link: 'linked' | 'stranger'; verified: boolean } {
    const cached = cardCache.get(peerUrl)?.card
    const verified = cached !== undefined
    const zone = cached?.team ?? ''
    const handles = new Set<string>()
    if (zone !== '') handles.add(zone)
    for (const row of cached?.sessionTeams ?? []) handles.add(row.team)
    let linked = false
    // Basis 1: bilateral seeds (origin match both ways).
    if (cached !== undefined && ownCardUrl !== '') {
      try {
        const peerOrigin = new URL(peerUrl).origin
        const ourOrigin = new URL(ownCardUrl).origin
        const weSeedThem = config.peers.some(peer => {
          try { return new URL(peer).origin === peerOrigin } catch { return false }
        })
        const theySeedUs = (cached.peers ?? []).some(peer => {
          try { return new URL(peer).origin === ourOrigin } catch { return false }
        })
        if (weSeedThem && theySeedUs) linked = true
      } catch { /* malformed peer URL — falls through to the canvas basis */ }
    }
    // Basis 2: a canvas remote ref names the peer's zone or one of its
    // session teams. Exact-handle match first (the admission basis); the
    // ref's ZONE prefix against card.team accepts the common compose form
    // (the operator added the peer's session-team handle; we see the
    // minimal card without sessionTeams until linked — display-level
    // zone matching is exact-host here: the ref names a handle of THAT
    // zone, and the tracked peer IS that zone's card).
    if (!linked && handles.size > 0 && zone !== '') {
      outer: for (const name of canvasStore.list()) {
        for (const ref of canvasStore.remoteMembersOf(name)) {
          if (handles.has(ref)) { linked = true; break outer }
          const refZone = ref.includes('/') ? ref.slice(0, ref.indexOf('/')) : ref
          if (refZone === zone) { linked = true; break outer }
        }
      }
    }
    return { link: linked ? 'linked' : 'stranger', verified }
  }

  function cachedCardFetch(url: string): Promise<A2aPeerCard | undefined> {
    const hit = cardCache.get(url)
    const now = Date.now()
    if (hit !== undefined && hit.card !== undefined && hit.missAt !== undefined) {
      // Kept through a miss (PR#96 review P2-2 round 2): serve the old card
      // for the negative window — a dead peer is refetched once per window,
      // the same cadence as a peer that never had a card — and never past the
      // card's own expiresAt: an old key gets no extra trust, and a dead peer
      // leaves the directory when its card lapses.
      if (now - hit.missAt < config.cardCacheNegativeTtlMs && hit.card.expiresAt > now) return Promise.resolve(hit.card)
    } else if (hit !== undefined && now - hit.at < (hit.card !== undefined ? config.cardCacheTtlMs : config.cardCacheNegativeTtlMs)) {
      return Promise.resolve(hit.card)
    }
    const inFlight = cardCacheInFlight.get(url)
    if (inFlight !== undefined) return inFlight
    const fetch = fetchPeerCard(url)
      .then(card => {
        // P2-2: a miss must not blank the mirror for callers joining this
        // single flight nor for later readers — keep the last good entry,
        // stamped missAt so the window above bounds the retries; a card past
        // its own expiresAt is not kept (undefined, honest exit).
        if (card === undefined) {
          const old = cardCache.get(url)
          if (old !== undefined && old.card !== undefined && old.card.expiresAt > Date.now()) {
            cardCache.set(url, { at: old.at, card: old.card, missAt: Date.now() })
            return old.card
          }
        }
        cardCache.set(url, { at: Date.now(), card })
        return card
      })
      .finally(() => {
        cardCacheInFlight.delete(url)
      })
    cardCacheInFlight.set(url, fetch)
    return fetch
  }

  /**
   * Kept for the per-call semantics the route tool documents (one fetch per
   * zone per call): it now reads through the shared cache, so a second call
   * within the window is free but the first always reflects live state.
   */
  function memoizedCardFetch(): ZoneCardFetch {
    const seen = new Set<string>()
    return async (url: string) => {
      if (seen.has(url)) return cardCache.get(url)?.card
      seen.add(url)
      return cachedCardFetch(url)
    }
  }

  /**
   * v0.5.24 (join-gate): a session that has not joined the A2A network may
   * not use its outbound tools. Joining is a user gesture (the sidebar
   * control) — never automatic, never proxied — so an unjoined session's
   * model must be told plainly instead of silently failing routes. The gate
   * only applies to in-session calls (an agent context exists); host-side
   * service invocations without an agent (e.g. the taskboard marquee's
   * joined-caller identity) pass through untouched, and a joined session
   * (sessionNodes carries its id) is exempt. appliesToA2aTools returns the
   * refusal error object, or undefined when the call may proceed.
   */
  /**
   * Whether this agent is the process's own initiator session — the face the
   * join gate exempts (it IS the node: its team is config.team, so anything
   * it can send, this node can receive). Shared by the join gate and the
   * route's caller-label resolution (fix ①, 能发即能收).
   */
  const exemptInitiatorFace = (agent: { id: unknown }): boolean => {
    if (sessionNodes.has(String(agent.id))) return false
    try {
      return ctx.get('agents')?.requireInitiator() === agent
    } catch { /* no initiator in this fiber — a guest stays gated */ }
    return false
  }

  const a2aJoinGateRefusal = (exec: { agent?: { id: unknown } } | undefined): void => {
    const agent = exec?.agent
    if (agent === undefined) return
    if (sessionNodes.has(String(agent.id))) return
    if (exemptInitiatorFace(agent)) return
    // A thrown tool error renders as the model-visible failure surface —
    // loud, structured, and schema-free (no success shape is produced).
    throw new Error('你被禁止使用 a2a 网络：本会话未加入 A2A 网络（join 是用户手势）。Join via the sidebar control to enable, then retry.')
  }

  const SWEEP_CONCURRENCY = 6


  const infoTools = createInfoTools({
    ctx, config, logger, session, lanIp, ownCardUrl, peerStore, taskLedger,
    inFlightRoutes, recentActivity, joinedSessions, sessionNodes, canvasStore,
    teamMemberships, exposureStore, idempotencyStore, cardCache,
    id8, sessionTeamOf,
    nodeMetadataOf, canvasTeamOf, memoizedCardFetch, mapBounded,
    // Hot-applied owner settings: getters keep the tools' call-time read live.
    // Passing these by value snapshots the apply-scope lets and silently
    // disables owner-settings hot-apply (whoami allowlist / teams scoping).
    get ownerAllowlist() { return ownerAllowlist },
    get ownerTeamScopeInfo() { return ownerTeamScopeInfo },
    teamAuditRing, reportRing, a2aJoinGateRefusal, observeAuthorization,
    settlePeerCard, client, listDirectoryTeams, canvasTeamsOfSession, localHandleResolver,
    SWEEP_CONCURRENCY,
  })
  infoTools.registerWhoami()

  const actTools = createActTools({
    ctx, config, logger, sessionNodes, joinedSessions,
    teamMemberships, exposureStore, reportRing, recordTeamAudit,
    a2aJoinGateRefusal, id8, routeTrunk,
    // Owner-settings hot-apply REBINDS this let: the getter keeps the tool
    // module's call-time read live instead of snapshotting at construction.
    get ownerAllowlist() { return ownerAllowlist },
  })
  actTools.registerTeamJoin()

  actTools.registerTeamLeave()

  actTools.registerExposure()

  actTools.registerReport()

  infoTools.registerTeams()

  /**
   * The directory's listing: this host's own teams lead (the loopback
   * candidates a2a_route dials first) — the process team, then every joined
   * live session node with its title and activity facts; then every tracked
   * peer card's own team plus its joined session teams. Delegated names are
   * not listed — only names a tracked zone publishes directly appear;
   * delegations resolve at route time (a resolvable delegation always
   * aliases a listed team, so rows for them would repeat).
   *
   * Discovery is gossip: each fetch offers the card's referrals to the
   * store, and mid-iteration offers are normally fetched on the next call.
   * A search pass chases one extra hop within the call — after the first
   * sweep, peers that were newly offered get their own card fetched — so a
   * keyword hunt reaches sessions the previous call had not yet gossiped,
   * while staying bounded (one extra sweep, still under the store cap).
   * @param expand - chase one referral hop beyond the current store walk.
   */
  async function listDirectoryTeams(expand: boolean, includeCanvas = false): Promise<DirectoryTeamRow[]> {
    const localOrigin = lanIp === '' ? `${session} [this host]` : `${session} [this host, ${lanIp}]`
    const teams: DirectoryTeamRow[] = [
      { team: config.team, session, name: config.agentName, description: '', local: true, origin: localOrigin },
      ...[...sessionNodes.values()].map(agent => ({
        team: sessionTeamOf(agent),
        session,
        ...nodeMetadataOf(agent),
        local: true,
        origin: localOrigin,
      })),
      // Canvas teams: user-composed multi-member rows. Member count and live
      // count are the facts a caller needs before routing — resolution picks
      // the first live member at route time.
      ...canvasStore.list().map(name => {
        // gh#152: members as the local tiers read them (gh#131) — a handle
        // naming one of this host's own sessions counts as that member, and
        // the two stored shapes of one session collapse to one.
        const members = [...new Set(canvasLocalMembersOf(name))]
        const live = members.filter(id => sessionNodes.has(id)).length
        return {
          team: canvasTeamOf(name),
          session,
          name,
          description: `canvas team — ${members.length} member${members.length === 1 ? '' : 's'}, ${live} live`,
          local: true,
          origin: localOrigin,
        }
      }),
      // Native-teams registry rows (opt-in bridge): local teams this node
      // can dispatch inbound. They list only when the operator opted in —
      // registry presence alone is never network exposure.
      ...(config.nativeTeamsInbound === true
        ? (teamsRegistry()?.listTeams() ?? []).map(entry => ({
          team: entry.name,
          session,
          name: entry.name,
          description: entry.description,
          local: true,
          origin: localOrigin,
        }))
        : []),
    ]
    const fetch = memoizedCardFetch()
    // Collect per peer in store order (concurrent fetches, ordered merge):
    // the listing's row order follows the peer store's preference order,
    // independent of fetch completion timing.
    const collectPeer = async (peer: string): Promise<DirectoryTeamRow[]> => {
      const card = await fetch(peer)
      if (card === undefined) return []
      // Keep the GUI's remote node projection session-only; the model tool
      // opts into the additional canvas-team rows (#159).
      return peerDirectoryRows(card, peer, includeCanvas)
    }
    // Bounded-concurrency sweep (mapBounded keeps row order by index, so the
    // listing still follows the peer store's preference order): a cold cache
    // must not open up to PEER_CAP simultaneous card fetches at once.
    const sweep = async (peers: readonly string[]): Promise<void> => {
      const collected = await mapBounded(peers, SWEEP_CONCURRENCY, collectPeer)
      for (const rows of collected) teams.push(...rows)
    }
    const before = peerStore.list()
    await sweep(before)
    if (expand) {
      // One extra hop: only peers the first sweep's referrals newly offered,
      // collected once each — the memo keeps already-fetched URLs free.
      const fresh = peerStore.list().filter(peer => !before.includes(peer))
      if (fresh.length > 0) await sweep(fresh)
    }
    return teams
  }


  /**
   * Track one routed task in the ledger when its result leaves it owed a
   * receipt: ONLY an explicitly async dispatch (fire-and-forget) owes one —
   * a synchronous wait released early (TASK_STATE_ABORTED_WAIT) is a
   * conversational exchange, and booking it as owed filled the ledger with
   * conversation noise no receipt can ever settle (A-ruling, 2026-09-01
   * decision seat: sync Q&A must not enter pending; only real
   * receipt-awaiting rows stay on the book). A synchronous completion
   * already carries its answer and owes nothing.
   * #114 S3: `sender` is the real originator the row is attributed to.
   */
  /**
   * #139: what an in-process async delivery learned about its own birth —
   * the admission it ran under (design §2.4) and the member that received it
   * — handed from dispatchLocalCandidate to the caller's outbound row, keyed
   * by task id and taken (deleted) by whoever dispatched.
   */
  const localBirths = new Map<string, OutboundBirth>()
  const localBirthOf = (team: string, callerSession: string | undefined, receiptTarget: string | undefined, deliveredTo: string): OutboundBirth => {
    const admission = localCandidateAdmission(admissionRecords, callerSession, team)
    const caller = callerSession ?? session
    const auth = admission.ok && caller !== ''
      ? buildAuthorization(admission, { caller, proof: 'in-process', ingress: 'local', allowlistVersion: allowlistVersionNow(), target: team, receiptTarget: receiptTarget ?? caller, receivedAt: Date.now() })
      : undefined
    return { ...(auth !== undefined ? { auth } : {}), ...(deliveredTo !== team ? { deliveredTo } : {}) }
  }
  /**
   * #139: the peer facts a remote outbound row is born with — the signed
   * card's key and session label (the host identity whatever spelling of its
   * address dialed it) and, for a canvas row, the member handle the request
   * carried. The memo makes the card read free after the directory walk.
   */
  const peerBirth = async (fetch: ZoneCardFetch, candidate: string, member: string | undefined): Promise<OutboundBirth> => {
    const card = await fetch(candidate).catch(() => undefined)
    return {
      ...(card !== undefined && card.publicKey !== '' ? { peerKey: card.publicKey } : {}),
      ...(card !== undefined && card.session !== '' ? { peerHost: card.session } : {}),
      ...(member !== undefined ? { deliveredTo: member } : {}),
    }
  }
  const trackOwedTask = (taskId: string, team: string, peer: string, result: A2aRouteResult, callbackAddress: string | undefined, brief: string | undefined, sender: Sender, birth?: OutboundBirth): void => {
    if (!result.ok) return
    // Native-teams bridge rounds emit no A2A receipt in this slice: booking
    // them as receipt-owed would fill the owed book with rows no receipt can
    // ever settle (evicting genuinely receivable peer rows past TASK_CAP).
    if (result.bridge !== undefined) return
    if (result.task_status !== 'TASK_STATE_DELIVERED') return
    // Fix ② (ghost-debt stop): a delivered async dispatch with no routable
    // callback address can never be settled — register it receiptless
    // (visible, non-debt; reconcile via context_id) instead of stranding a
    // row whose only exit was the dead-letter sweep (57 dead letters, half
    // this shape).
    if (callbackAddress === undefined) {
      taskLedger.trackReceiptless(taskId, team, peer, result.context_id === '' ? undefined : result.context_id, brief, sender, birth)
      return
    }
    taskLedger.track(taskId, team, peer, result.context_id === '' ? undefined : result.context_id, brief, sender, birth)
  }

  /**
   * Build the -32004 verdict. The error string is the calling model's ONLY
   * context for its next decision, so it must carry the failure class, the
   * local reason (the most diagnostic fact: "not joined" vs "no live node"
   * vs a wake failure), nearby advertised teams for typo/wrong-seat catches,
   * and actions the CALLING model can actually take. Joining is the target
   * session's own gesture — the verdict relays that request instead of
   * instructing the caller to perform it (and never cites tooling the
   * caller does not have).
   */
/**
 * Fix 1 (能发即能收): resolve the caller's routable label for one routed
 * dispatch. Priority: the joined session's node team > the exempt initiator
 * face (the NODE team — bare, team-name routable) > the session label (not
 * routable; the dispatch registers receiptless per fix 2).
 */
const routeVerdict = (team: string, failures: readonly string[], candidateCount: number): { ok: false; error: string; code: number } => {
    const ambiguous = failures.find(failure => failure.startsWith('ambiguous: '))
    if (candidateCount === 0 && ambiguous !== undefined) return { ok: false, error: ambiguous, code: -32004 }
    if (candidateCount > 0) {
      return {
        ok: false,
        error: `team "${team}" failed on every candidate: ${failures.join('; ')} — enumerate live alternatives with a2a_teams instead of retrying unchanged`,
        code: -32004,
      }
    }
    const remote = failures.filter(entry => !entry.startsWith('local: '))
    const suffix = team.slice(team.indexOf('/') + 1)
    const near = [...new Set([
      ...joinedSessions.list().map(id => `${config.team}/${id8(id)}`),
      ...[...sessionNodes.values()].map(agent => sessionTeamOf(agent)),
      ...canvasStore.list().map(name => `${config.team}/canvas/${name}`),
      config.team,
    ])].filter(candidate => {
      if (candidate === team) return false
      const candidateSuffix = candidate.slice(candidate.indexOf('/') + 1)
      return candidate.includes(suffix) || suffix.includes(candidateSuffix) || candidateSuffix.startsWith(suffix.slice(0, 4))
    }).slice(0, 3)
    const lines = [
      `team "${team}" is not published by any configured peer${remote.length > 0 ? ` (unresolved delegations: ${remote.join('; ')})` : ''}`,
      ...failures.filter(entry => entry.startsWith('local: ')).map(entry => `local reason: ${entry.slice('local: '.length)}`),
      near.length > 0 ? `nearby advertised teams: ${near.join(', ')}` : undefined,
      'next: enumerate live alternatives with a2a_teams; do not retry unchanged; joining is the target session\'s own gesture (its sidebar) — relay that request to the human',
    ].filter((line): line is string => line !== undefined)
    return { ok: false, error: lines.join(' — '), code: -32004 }
  }

  actTools.registerRoute()

  /**
   * The routing trunk (0.6.9): the one failover sequence behind both the
   * a2a_route tool (agent face) and the quick-dispatch control route (host
   * face, no agent). Gates — agent-less audit, join gate, team-scoped
   * routing — then caller-label resolution, local dispatch, the canvas
   * remote-member seam, and the directory walk. Faces differ only in who
   * the caller is; the delivery semantics stay identical by construction.
   * The host face (agent === undefined) rides the bare node team as its
   * caller label — the "能发即能收" invariant: whatever it addresses can
   * answer it with one route.
   */
  async function routeTrunk(args: { team: string; message: string; context_id?: string; async?: boolean }, agent: Agent | undefined, signal: AbortSignal, hostCaller?: string): Promise<Record<string, JsonValue>> {
      // Fix ③ (S4 audit): host-side calls carry no agent identity — every one
      // lands in the team audit ring, and the owner can flip the gate from
      // 'audit' to 'refuse' (config gateAgentLessCalls) when the operator
      // face should not be a routing principal at all.
      if (agent === undefined) {
        recordTeamAudit('agent-less', String(args.team ?? ''), 'host', true,
          config.gateAgentLessCalls === 'refuse' ? 'refused by gateAgentLessCalls' : 'audited (default)')
        if (config.gateAgentLessCalls === 'refuse') {
          return {
            ok: false,
            error: 'gateAgentLessCalls=refuse: host-side (agent-less) routing is disabled by configuration — route from a joined session instead',
          }
        }
      }
      // The caller identity travels as a routable team (the calling session's
      // node team when it has joined, else the node label), so the receiver
      // can answer with one a2a_route instead of an unroutable display label.
      a2aJoinGateRefusal(agent === undefined ? undefined : { agent })
      // S3 (team-scoped routing, phase-2 default ON per the 2026-09-01 owner
      // ruling; set false to restore the open outbound seam): a session
      // caller must have declared membership in the target team before it
      // may address it, and a caller with no teams at all has no network —
      // a teamless node is, by the same ruling, an unjoined one. Host-side
      // calls (no agent)
      // and the initiator face stay exempt, like the join gate; discovery
      // (a2a_teams) stays open so a teamless node can still see what to join.
      let scopedCanvasCaller: { id: string; handle: string } | undefined
      if (config.teamScopeRouting && agent !== undefined) {
        const scopeCaller = String(agent.id)
        let initiator = false
        try {
          initiator = ctx.get('agents')?.requireInitiator() === agent
        } catch { /* no initiator in this fiber */ }
        if (!initiator) {
          const callerTeams = teamMemberships.teamsOf(scopeCaller)
          const team = String(args.team ?? '').trim()
          // gh#71: the SHARED-CANVAS basis and the warm cache's peer-org
          // basis (an org entry naming BOTH the caller and the target
          // handle) count as declared here too — the same link the
          // admission core honors on the receiving side; without this the
          // tool face refused routes the canvas itself had authorized.
          // Canvas members mix two shapes: LOCAL sessions sit by session
          // id, cross-host members by zone/id8 handle — match either.
          const callerHandle = `${config.team}/${id8(scopeCaller)}`
          scopedCanvasCaller = { id: scopeCaller, handle: callerHandle }
          // gh#45 末修 (66abc2cf defect): a CANVAS GROUP NAME target
          // (`<team>/canvas/<name>`) never matches member handles — a
          // whole-group dispatch from a group member was refused. The
          // group's own team handle (canvasTeamOf(name)) is the match
          // (the caller sits in the very group being addressed).
          const sharedCanvas = canvasStore.list().some(name => {
            const members = canvasStore.membersOf(name)
            const inGroup = members.includes(scopeCaller) || members.includes(callerHandle)
            return inGroup ? members.includes(team) || canvasTeamOf(name) === team : false
          })
          // A direct group route must not require a prior directory call. Fetch
          // only the same eligible peers as resolution; then apply the
          // unchanged sender/receiver admission rules to their verified cards.
          if (team.includes('/canvas/') && !sharedCanvas && !callerTeams.includes(team)) await mapBounded(resolutionPeers(), SWEEP_CONCURRENCY, cachedCardFetch)
          let orgShared = false
          for (const cached of cardCache.values()) {
            const org = (cached.card as { canvasOrg?: Array<{ team?: unknown; members?: unknown }> } | undefined)?.canvasOrg
            if (!Array.isArray(org)) continue
            for (const e of org) {
              if (typeof e.team !== 'string' || e.team === '' || !Array.isArray(e.members)) continue
              const inOrg = e.members.includes(scopeCaller) || e.members.includes(callerHandle)
              if (inOrg && (e.members.includes(team) || e.team === team)) { orgShared = true; break }
            }
            if (orgShared) break
          }
          if (callerTeams.length === 0 && !sharedCanvas && !orgShared) {
            return {
              ok: false,
              error: `team-scoped routing is on and this session (${id8(scopeCaller)}) has declared no team membership — a teamless node has no network. Declare one with a2a_team_join (subject to the owner's teamJoinAllowlist)`,
            }
          }
          if (!callerTeams.includes(team) && !sharedCanvas && !orgShared) {
            return {
              ok: false,
              error: `team-scoped routing is on: routing to "${team}" requires declared membership. This session's teams: ${callerTeams.join(', ')}. a2a_team_join can declare it (subject to the owner's teamJoinAllowlist)`,
            }
          }
        }
      }
      let callerSession = resolveCallerLabel({
        joined: agent !== undefined && sessionNodes.has(String(agent.id)),
        initiatorFace: agent !== undefined && exemptInitiatorFace(agent),
        nodeTeam: config.team,
        joinedTeam: agent === undefined ? undefined : sessionTeamOf(agent),
        sessionLabel: agent === undefined ? undefined : sessionLabelOf(agent),
      })
      // The quick-dispatch control face (0.6.9) passes the bare node team
      // explicitly: receipts address it and land on the team face (the
      // "能发即能收" invariant). Agent-less TOOL calls keep the legacy
      // fallback (the node session label) — apply.spec pins it.
      if (agent === undefined && hostCaller !== undefined) callerSession = hostCaller
      // P2 receipt-callback: the caller's routable address rides the wire so
      // a peer routes its receipt to THIS session's node team (not to
      // wherever its caller-label heuristics land). The bare node team is
      // team-name routable on the target even though it lacks the /hash
      // suffix the regex demands — accepted explicitly here.
      const callbackAddress = routableCallerLabel(callerSession) || callerSession === config.team
        ? callerSession
        : undefined
      // #114 S3: the outbound row records who really sent it instead of
      // every row reading as "home". A session is always its own node team
      // (<zone>/<id8>) — joined or not, initiator or not — so one seat keeps
      // one bucket. An agent-less call is the host process itself; the label
      // it borrowed on the wire (quick dispatch rides a live joined session's
      // team) is kept apart as `face`, so a human's workbench gesture never
      // lands in that session's seat.
      const sender: Sender = agent !== undefined
        ? { kind: 'session', id: sessionTeamOf(agent) }
        : { kind: 'host', id: session, ...(callerSession !== undefined && callerSession !== session ? { face: callerSession } : {}) }
      const fetch = memoizedCardFetch()
      // The task id is born at the caller (idempotency key semantics): both
      // dispatchers carry the one id, the peer request echoes it, and the
      // steered receipt header names it — so "[A2A receipt] task <id>" from
      // the target correlates with the route's own result verbatim.
      const taskId = `direct-${Math.random().toString(16).slice(2, 10)}`
      const routedReceipt = parseReceipt(args.message) !== null
      // Candidate order: this host's own teams first (an in-process steer —
      // cheapest possible and immune to nested-signal aborts), then direct
      // publishers, then zone delegations, deduplicated by URL.
      const failures: string[] = []
      if (signal?.aborted) return { ok: false, error: 'route aborted before dispatch', code: -32000 }
      const outcome = await dispatchLocalCandidate(args.team, args.message, callerSession, args.context_id, signal, args.async === true, taskId, callbackAddress, agent === undefined ? undefined : String(agent.id))
      const localBirth = localBirths.get(taskId)
      localBirths.delete(taskId)
      if (outcome !== undefined) {
        if (outcome.ok) {
          // gh#141: a receipt owes no receipt — booking it would strand a row nothing settles.
          if (!routedReceipt) trackOwedTask(taskId, args.team, 'local', outcome, callbackAddress, briefOf(args.message), sender, localBirth)
          return outcome as unknown as Record<string, JsonValue>
        }
        failures.push(`local: ${outcome.error}`)
      }
      // Failover seam for canvas teams: after the local tiers miss, the
      // canvas team's remote members (zone-qualified team handles) are dialed
      // in member order — the same priority rule the local live/cold tiers
      // follow. Each remote handle is a routable team name on its own host,
      // so the directory walk runs per target and the candidate pool is the
      // union in member order. Non-canvas teams keep the single-walk shape
      // unchanged. The ledger stays keyed to the canvas team the caller
      // named; the peer request carries the member handle it must resolve.
      const canvasName = parseCanvasTeamName(args.team)
      // gh#131: one of this host's own handles is a local member, never a directory target.
      const remoteTargets = canvasName !== undefined ? ((resolve) => canvasStore.remoteMembersOf(canvasName).filter(ref => resolve(ref) === undefined))(localHandleResolver()) : []
      const targets = remoteTargets.length > 0 ? [...remoteTargets] : [args.team]
      if (remoteTargets.length > 0) {
        failures.push(`local: canvas team "${args.team}" has no live or wakeable local member`)
      } else if (canvasName !== undefined && canvasStore.hasTeam(canvasName)) {
        // Issue #41: no remote members and no usable local tier — the only
        // remaining candidate shape is the initiator itself, and routing
        // there would loop. Name it instead of letting the directory walk
        // report an unrelated miss.
        failures.push(`local: canvas team "${args.team}" has no live or wakeable member besides the initiating session — routing to a canvas team whose only member is the caller itself would loop; target another member's team handle directly`)
      }
      const candidatePool: Array<{ candidate: string; target: string }> = []
      for (const target of targets) {
        for (const candidate of await directoryPeerCandidates(fetch, target, failures, scopedCanvasCaller)) {
          candidatePool.push({ candidate, target })
        }
      }
      // Failover: try every candidate in order — an offline path falls back
      // to the next alternate without a caller-visible error; only
      // exhaustion surfaces, with each candidate's reason.
      for (const { candidate, target } of candidatePool) {
        // Capability gate: wait:false only dials peers whose signed card
        // declares async — against a pre-0.5.2 peer the flag would silently
        // degrade into a minutes-long blocking hold (an async intent must
        // never turn into a surprise wait). The memo keeps the card fetch
        // free after the directory walk.
        let peerAsync = false
        if (args.async === true) {
          const card = await fetch(candidate)
          const caps = card?.capabilities as { async?: unknown } | undefined
          peerAsync = card !== undefined && caps?.async === true
        }
        const result = await dispatchPeerCandidate(candidate, target, args.message, args.context_id, signal, callerSession, peerAsync, taskId, callbackAddress)
        if (result.ok || signal.aborted) {
          // A receipt the creditor refused (its enforce verdict) pays nothing here either (review of PR #149 P2-2).
          if (result.ok && routedReceipt) { if (result.settlementRefused !== true) settleOwnInbound(args.message, args.team, { caller: callerSession ?? '', proof: 'in-process', ingress: 'local' }) }
          else if (result.ok) trackOwedTask(taskId, args.team, candidate, result, callbackAddress, briefOf(args.message), sender, await peerBirth(fetch, candidate, target === args.team ? undefined : target))
          const notes: string[] = []
          if (result.ok && args.async === true && result.task_status === 'TASK_STATE_DELIVERED' && !routableCallerLabel(callerSession)) {
            notes.push(unroutableCallerNote(String(callerSession ?? session)))
          }
          if (result.ok && args.async === true && !peerAsync) {
            notes.push('\n(Note: the peer does not advertise async; the call waited synchronously.)')
          }
          if (result.ok && notes.length > 0) {
            return { ...result, team: args.team, reply: `${result.reply}${notes.join('')}` } as unknown as Record<string, JsonValue>
          }
          return { ...result, ...(result.ok ? { team: args.team } : {}) } as unknown as Record<string, JsonValue>
        }
        failures.push(`${candidate}: ${result.error}`)
      }
      if (failures.length > 0) logger.warn(`route to team "${args.team}" exhausted its candidates: ${failures.join('; ')}`)
      return routeVerdict(args.team, failures, candidatePool.length)
  }

  /**
   * The route dispatcher's local half: same-host candidates dial in-process,
   * not over loopback HTTP — a loopback fetch nests the final wait inside the
   * caller's own tool signal, and when that turn budget aborts, the abort
   * surfaces as the peer's failure even though delivery succeeded. The turn
   * signal still races the wait; on abort the honest result reports delivery
   * without a reply. Results use the canonical A2aRouteOk shape — the wire
   * route shape renders as "failed: undefined" through the tool renderer.
   * @param asyncMode - deliver without waiting: the steer fires, the
   * registered waiter still flushes (harmlessly) into the settled promise,
   * and the caller gets the delivered shape with the receipt contract.
   * @returns the canonical result, or undefined when the team is not local.
   */
  async function dispatchLocalCandidate(team: string, message: string, callerSession: string | undefined, contextId: string | undefined, signal: AbortSignal, asyncMode = false, taskIdFromCaller?: string, callbackAddress?: string, originAgentId?: string): Promise<A2aRouteResult | undefined> {
    const webServer = ctx.get('webServer')
    // W1 (boundary hardening): the local in-process candidate is an
    // admission seam like any other — a JOINED session (zone/id8 caller
    // face) must clear the same shared-team admission /a2a/direct applies,
    // or a teamless local node could route to any session team by riding
    // the cheapest path. The initiator face (bare node team) and
    // foreign-zone labels are NOT gated here (F1b host-face rules, R-C
    // pending) — only the joined face closes.
    const joinedRefusal = joinedFaceAdmissionRefusal(callerSession, team)
    if (joinedRefusal !== undefined) {
      recordActivity('out', team, callerSession ?? 'local', false)
      return { ok: false, error: joinedRefusal, code: -32000 }
    }
    // #114 S5: the same header-safe id rule the wire face enforces.
    const idRefusal = taskIdFromCaller === undefined ? undefined : taskIdRefusal(taskIdFromCaller)
    if (idRefusal !== undefined) {
      recordActivity('out', team, callerSession ?? 'local', false)
      return { ok: false, error: idRefusal, code: -32000 }
    }
    const canvasName = parseCanvasTeamName(team)
    // Issue #41 shape note: the caller label is the WIRE form (<zone>/<id8>
    // or a session label) and quick-dispatch BORROWS a live session's team
    // as its host face — so the label alone cannot tell an initiating agent
    // from a borrowed one. The exemption keys on the ORIGINATING agent's id
    // (same shape as a member slot) passed down by routeTrunk; the host face
    // passes none and never exempts.
    const callerNodeId = originAgentId
    let teamIsLocal = team === config.team
      || resolveAgentForTeam(team) !== undefined
      || joinedSessions.list().some(id => `${config.team}/${id8(id)}` === team)
      // Issue #41 (self-route rule on canvas tiers): the initiator's own
      // member slot never makes the team local — an exempt local tier must
      // fall through to the remote members instead of echoing home.
      || (canvasName !== undefined && (canvasLiveAgent(canvasName, callerNodeId) !== undefined || canvasColdMemberId(canvasName, callerNodeId) !== undefined))
    // gh#45 CLI mailbox: a delivery targeting a DEPOSITED CLI handle is
    // local by definition — it lands in the deposit's mailbox (the CLI
    // polls while alive; receipts and messages never wake anything).
    // The settler of any receipt on this path: this host's own caller (in-process).
    const localSettler: Settler = { caller: callerSession ?? '', proof: 'in-process', ingress: 'local' }
    const cliRow = cliDeposits.get(team)
    if (cliRow !== undefined) {
      // #114 S4 (design §4.5): a receipt dropped into a local CLI mailbox is
      // exactly the settlement a CLI-originated task waits for — settle it,
      // as the wire face settles before ITS mailbox split.
      settleAndAnnounce(message, localSettler)
      cliDeposits.mail(team, callerSession ?? 'unknown', message)
      recordActivity('in', team, callerSession ?? 'peer', true)
      logger.info(`a2a: cli mailbox delivery for ${team} (from ${callerSession ?? 'unknown'})`)
      return { ok: true, team, reply: `delivered to the mailbox of ${team} — the CLI polls while online`, task_id: taskIdFromCaller ?? '', context_id: contextId ?? '', task_status: 'TASK_STATE_COMPLETED' }
    }
    // The native-teams claim probe is an await: pay it only when the four
    // cheap synchronous locality checks missed (a registry team is a local
    // candidate even though no session node backs it).
    if (!teamIsLocal && team !== config.team) teamIsLocal = await nativeTeamsClaims(team)
    if (!teamIsLocal || webServer === undefined) return undefined
    // A receipt relayed between same-host sessions (the answering session
    // routing its `[A2A receipt]` back over the in-process candidate)
    // correlates here too — same contract, no HTTP on the path.
    settleAndAnnounce(message, localSettler)
    const taskId = taskIdFromCaller ?? `direct-${Math.random().toString(16).slice(2, 10)}`
    const flight = beginRoute(team, 'local')
    if (asyncMode) {
      // Delivery means the message is IN, not merely enqueued: a cold team
      // materializes first (the wake settles, or fails honestly), then the
      // steer fires, then delivered answers. The receipt header carries the
      // task id so the target can echo it back verbatim.
      // Issue #41: the canvas live tier skips the initiating session, so a
      // dispatch from a member never resolves back to its author.
      const agent = resolveAgentForTeam(team) ?? canvasLiveAgent(canvasName, callerNodeId)
      const wake = agent !== undefined ? undefined : wakeColdTeam(team, callerNodeId)
      let woken: Promise<Agent> | undefined = agent !== undefined
        ? Promise.resolve(agent)
        : wake?.kind === 'flight' ? wake.flight : undefined
      if (woken === undefined) {
        // Bridge BEFORE the bare-team fallback — claim beats the initiator
        // redirect, the same rule routeIntoAgent follows (a bare team name
        // claimed by the registry must not fork its destination by wait
        // semantics). Prepare-first: claim, seam, and parent initiator are
        // everything that can fail fast, so a phantom delivery never answers
        // success. The fire is truly detached (no caller signal — the turn
        // ending must not silently retract an already-announced delivery);
        // rounds emit no receipt in this slice (the `bridge` marker keeps
        // the caller's ledger honest).
        const prepared = await nativeTeamsPrepare(team)
        if (prepared.ok) {
          endRoute(flight)
          recordActivity('out', team, 'local', true)
          void nativeTeamsRound(prepared, team, callerSession ?? session, message, taskId)
            .then(outcome => {
              if (!outcome.ok) {
                recordActivity('out', team, 'local', false)
                logger.warn(`a2a: detached native-teams round for "${team}" failed: ${outcome.error}`)
              }
            })
          return {
            ok: true,
            team,
            reply: `Delivered to ${team} (async native-teams round dispatched). The round settles through the team's own routing chain; it routes no A2A receipt in this slice — reconcile via context_id follow-ups.`,
            task_id: taskId,
            context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
            task_status: 'TASK_STATE_DELIVERED',
            bridge: 'native-teams',
          }
        }
        if (prepared.reason === 'error') {
          endRoute(flight)
          recordActivity('out', team, 'local', false)
          return { ok: false, error: prepared.error, code: -32000 }
        }
        // Claim declined: the bare process team still steers the live initiator.
        const live = team === config.team ? liveAgent() : undefined
        if (live !== undefined && callerIsAgent(live, callerSession ?? session)) {
          // Self-route refusal (same rule as the sync faces): the initiator
          // resolving to the routing session itself means the dispatch would
          // only echo home and arm a synthetic receipt for work nobody does.
          endRoute(flight)
          recordActivity('out', team, 'local', false)
          return { ok: false, error: selfRouteText(team), code: -32000 }
        }
        if (live === undefined) {
          endRoute(flight)
          return { ok: false, error: wake?.kind === 'no-face' ? noWakeFaceText(team) : wake?.kind === 'archived' ? archivedColdMatchText(team) : noColdMatchText(team), code: -32000 }
        }
        woken = Promise.resolve(live)
      }
      try {
        const target = await woken
        // N1 (review seat 7e4cf94a): dashed composite labels are NOT routable;
        // accept only <zone>/<short-id> shapes so envelopes stop bouncing -32004.
        // An explicit callback address (P2) wins over the caller-label
        // derivation: it is the submitting session's own node team.
        const routable = routableCallerLabel(callerSession)
        const callerTeam = callbackAddress !== undefined && callbackAddress !== ''
          ? callbackAddress
          : routable ? callerSession : undefined
        const receiptHint = callerTeam === undefined ? '' : `\n\n(When done, route your outcome back with one call — a2a_route { team: "${callerTeam}", message: "[A2A receipt] task ${taskId} <one-line outcome>" }.)`
        // #114 S5: the consumption search starts at the pre-steer log length.
        const steerFloor = sessionEventsOf(target).length
        steerRelay(target, `[A2A direct] (task ${taskId}) ${fromClause(callerSession ?? session)} (routed to ${team}) sent:\n\n${message}${receiptHint}`, callerTeam)
        armReceiptAutosend(target, taskId, callerTeam, message, steerFloor)
        // #139: the caller's outbound row is born with this admission and the member that received it.
        if (taskIdFromCaller !== undefined) localBirths.set(taskIdFromCaller, localBirthOf(team, callerSession, callerTeam, sessionTeamOf(target)))
        endRoute(flight)
        recordActivity('out', team, 'local', true)
        return {
          ok: true,
          team,
          reply: `Delivered to ${team} (async). The target routes a receipt — a message starting "[A2A receipt] task ${taskId} <outcome summary>" — back to your team when done; watch a2a_status activity or follow up with the context id.${routable ? '' : unroutableCallerNote(String(callerSession ?? session))}`,
          task_id: taskId,
          context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
          task_status: 'TASK_STATE_DELIVERED',
        }
      } catch (error) {
        endRoute(flight)
        recordActivity('out', team, 'local', false)
        return { ok: false, error: `waking or steering the session for team "${team}" failed: ${String(error)}`, code: -32000 }
      }
    }
    if (!asyncMode) {
      // Bridge only on a steer-path miss, matching the documented chain
      // (session node → canvas → cold wake → native-teams claim → bare): a
      // registry claim must never shadow a live local session team. The
      // caller's abort cancels the round through its own signal; the 180s
      // deadline restores the bound the steer machinery observes.
      // Issue #41: same initiator exemption on the sync path — the canvas
      // live/cold tiers skip the dispatching session before steerable is
      // decided, so a self-member falls through to remote members.
      const steerable = resolveAgentForTeam(team) !== undefined
        || canvasLiveAgent(canvasName, callerNodeId) !== undefined
        || joinedSessions.list().some(id => `${config.team}/${id8(id)}` === team)
        || wakeColdTeam(team, callerNodeId).kind === 'flight'
      if (!steerable && team !== config.team) {
        const prepared = await nativeTeamsPrepare(team)
        if (prepared.ok) {
          const outcome = await nativeTeamsRound(prepared, team, callerSession ?? session, message, taskId, signal)
          endRoute(flight)
          if (!outcome.ok) {
            // The aborted-wait shape is earned only by an actual round
            // cancellation (the caller's abort reached the seam). A
            // pre-dispatch abort means the message never left the node, and
            // a failed round means it never answered — both answer the
            // honest error instead of claiming a delivery.
            if (outcome.aborted === true) {
              recordActivity('out', team, 'local', true)
              return {
                ok: true,
                team,
                reply: `The message was delivered to ${team} (native-teams round), but the wait was aborted (the round was cancelled with it).`,
                task_id: taskId,
                context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
                task_status: 'TASK_STATE_ABORTED_WAIT',
                bridge: 'native-teams',
              }
            }
            recordActivity('out', team, 'local', false)
            return { ok: false, error: outcome.error, code: -32000 }
          }
          recordActivity('out', team, 'local', true)
          return {
            ok: true,
            team,
            reply: outcome.reply,
            task_id: taskId,
            context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
            task_status: outcome.settled ? 'TASK_STATE_COMPLETED' : 'TASK_STATE_DELIVERED',
            ...(outcome.settled ? {} : { bridge: 'native-teams' as const }),
          }
        }
        if (prepared.reason === 'error') {
          endRoute(flight)
          recordActivity('out', team, 'local', false)
          return { ok: false, error: prepared.error, code: -32000 }
        }
      }
    }
    const wait = routeIntoAgent(team, message, callerSession ?? session, taskId)
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
    // A reply wait without a deadline parks the caller's whole turn forever
    // when the target session answers on its own (slow or never) cadence. The
    // deadline turns that into the same honest delivered shape the abort path
    // returns: the receipt contract carries the follow-up, the caller keeps
    // moving.
    const REPLY_WAIT_MS = 180_000
    const expired = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => { reject(new Error('reply-wait-timeout')) }, REPLY_WAIT_MS)
      timer.unref?.()
      const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
      const onAbort = (): void => done()
      signal.addEventListener('abort', onAbort, { once: true })
      wait.then(done, done)
    })
    let outcome: Awaited<ReturnType<typeof routeIntoAgent>>
    try {
      outcome = await Promise.race([wait, aborted, expired])
    } catch (error) {
      if (String(error).includes('reply-wait-timeout')) {
        endRoute(flight)
        recordActivity('out', team, 'local', true)
        return {
          ok: true,
          team,
          reply: `The message was delivered to ${team}, but no reply arrived within ${Math.round(REPLY_WAIT_MS / 1000)}s (the target session answers on its own cadence). It routes a receipt, a message starting "[A2A receipt] task ${taskId}", back to your team when done; check a2a_status activity or follow up with the context id.`,
          task_id: taskId,
          context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
          task_status: 'TASK_STATE_DELIVERED',
        }
      }
      endRoute(flight)
      recordActivity('out', team, 'local', true)
      return {
        ok: true,
        team,
        reply: `The message was delivered to ${team}, but the wait for its reply was aborted (the target session answers on its own cadence; route again with the context id).`,
        task_id: taskId,
        context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
        task_status: 'TASK_STATE_ABORTED_WAIT',
      }
    }
    endRoute(flight)
    recordActivity('out', team, 'local', outcome.ok)
    if (outcome.ok) {
      return {
        ok: true,
        team,
        reply: outcome.reply,
        task_id: taskId,
        context_id: contextId ?? `ctx-${Math.random().toString(16).slice(2, 10)}`,
        task_status: outcome.status ?? 'TASK_STATE_COMPLETED',
        ...(outcome.bridge !== undefined ? { bridge: outcome.bridge } : {}),
      }
    }
    return { ok: false, error: outcome.error, code: -32000 }
  }

  /**
   * The route dispatcher's peer half: one candidate dial with the in-flight
   * registration and activity-ring record the panel reads. Async mode sends
   * wait:false — the peer steers and answers delivered immediately (its
   * 0.5.2+ handler), so cross-host long tasks ride the receipt contract
   * exactly like same-host ones; older peers that ignore the flag simply
   * keep the blocking wait (graceful degradation).
   */
  async function dispatchPeerCandidate(url: string, team: string, message: string, contextId: string | undefined, signal: AbortSignal, callerSession: string | undefined, asyncMode = false, taskIdFromCaller?: string, callbackAddress?: string): Promise<A2aRouteResult> {
    const flight = beginRoute(team, url)
    const result = await client.routeDirect(url, team, message, contextId, signal, callerSession, asyncMode, taskIdFromCaller, callbackAddress)
    endRoute(flight)
    recordActivity('out', team, url, result.ok)
    // F1 half-transaction compensation (t-mth5gmxy): the client's 15s budget
    // firing on a SYNC route leaves the transaction half-done — the delivery
    // landed and the peer keeps executing. One query round-trip asks the
    // peer for the real state; completed upgrades to the honest result,
    // failed becomes the real failure, anything else stays the honest
    // DELIVERED-UNSETTLED (-32005) with the query instruction.
    if (!asyncMode && !result.ok && result.code === -32005 && taskIdFromCaller !== undefined && taskIdFromCaller !== '') {
      const fingerprint = peerPayloadFingerprint({ caller: callerSession ?? session, message, noWait: false, team })
      const answer = await client.queryOutcome(url, taskIdFromCaller, fingerprint, signal)
      if (answer?.found === true && answer.status === 'completed') {
        return {
          ok: true,
          team,
          reply: `${answer.reply}\n\n(The direct wait hit its ${'15s'} transport budget; this answer is the peer's settled outcome, recovered through the task query.)`,
          task_id: taskIdFromCaller,
          context_id: contextId ?? '',
          task_status: 'TASK_STATE_COMPLETED',
        }
      }
      if (answer?.found === true && answer.status === 'failed') {
        return { ok: false, error: answer.error, code: -32000, task_id: taskIdFromCaller }
      }
    }
    return result
  }

  /**
   * Full dispatch for background senders (the receipt autosend): local
   * first, then the directory walk with per-candidate failover. Unlike
   * {@link dispatchLocalCandidate}, a team that is not ours is NOT treated
   * as a silent non-route — the walk either delivers or THROWS, so the
   * receipt ladder can distinguish "delivered" from "no route" and its
   * owner escalation actually fires for cross-node callback addresses.
   */
  async function dispatchAnywhere(team: string, message: string, callerSession: string | undefined, contextId: string | undefined, signal: AbortSignal, asyncMode: boolean, taskId?: string): Promise<A2aRouteResult & { ok: true }> {
    const local = await dispatchLocalCandidate(team, message, callerSession, contextId, signal, asyncMode, taskId)
    // A background send books no outbound row: its birth facts have no row to go on.
    if (taskId !== undefined) localBirths.delete(taskId)
    if (local !== undefined) {
      if (!local.ok) throw new Error(local.error)
      return local
    }
    const failures: string[] = []
    const candidates = await directoryPeerCandidates(memoizedCardFetch(), team, failures)
    if (candidates.length === 0) {
      throw new Error(`no route to "${team}": not a local team and not published by any tracked peer`)
    }
    let lastError = 'no candidate delivered'
    for (const candidate of candidates) {
      const result = await dispatchPeerCandidate(candidate, team, message, contextId, signal, callerSession, asyncMode, taskId)
      if (result.ok) return result
      lastError = result.error
      if (signal.aborted) break
    }
    throw new Error(`delivery to "${team}" failed on every candidate: ${lastError}`)
  }

  /**
   * The directory's candidate walk for one team: direct publishers first,
   * then every tracked zone's delegation resolutions (cycle/depth/key-binding
   * failures are configuration bugs: closed, logged, and surfaced into
   * {@link failures}), deduplicated by URL. Both passes run their per-peer
   * fetches concurrently under a small cap: a serial walk of a store full of
   * cold-cache dead peers pays their HTTP timeouts one after another (worst
   * case cap × 15s), while a bounded concurrent walk pays one timeout window.
   */
  const CANDIDATE_CONCURRENCY = 6
  /** Concurrent card fetches in one directory sweep (cold-cache burst bound). */
  async function mapBounded<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await task(items[index] as T)
      }
    })
    await Promise.all(workers)
    return results
  }

  function resolutionPeers(): readonly string[] {
    return config.referralTeamResolution === true ? peerStore.list() : [...new Set([...peerStore.listSeeded(), ...config.delegates.map(delegate => delegate.url)])]
  }
  async function directoryPeerCandidates(fetch: (url: string) => Promise<A2aPeerCard | undefined>, team: string, failures: string[], scopedCanvasCaller?: { id: string; handle: string }): Promise<string[]> {
    // gh#8 (N9): a team name resolves only to hosts an operator linked —
    // the seeded subset of the peer store (config seeds, eviction-immune)
    // plus the delegate records (config-time operator acts). The
    // referral-learned tail stays in the store for probing and visibility,
    // but its self-published card claims no longer bind team names
    // (gh#8: a squatter two gossip hops away captured routes by naming
    // itself after the target). referralTeamResolution restores the legacy
    // whole-store basis for fleets mid-migration.
    const peers = resolutionPeers()
    const candidates: string[] = []
    const cards = await mapBounded(peers, CANDIDATE_CONCURRENCY, async peer => ({ peer, card: await fetch(peer) }))
    // Check after fetching all cards: a seeded peer publishing the same id8
    // makes the caller handle ambiguous, so do not send a canvas payload.
    const resolveLocal = scopedCanvasCaller === undefined ? undefined : localHandleResolver()
    const resolutions = await mapBounded(peers, CANDIDATE_CONCURRENCY, async peer => ({ peer, outcome: await resolveZone(fetch, peer, team) }))
    if (canvasTargetAmbiguous(cards.map(entry => entry.card), team, scopedCanvasCaller, resolveLocal, resolutions.some(entry => entry.outcome.ok))) {
      failures.push(`ambiguous: team "${team}" has conflicting owners, identities, or a colliding caller; no payload sent`)
      return []
    }
    for (const entry of cards) {
      if (entry.card === undefined) continue
      if (entry.card.team === team || sessionCandidateMatches(entry.card, team) || canvasCandidateMatches(entry.card, team, scopedCanvasCaller, resolveLocal)) candidates.push(entry.peer)
    }
    for (const { peer, outcome } of resolutions) {
      if (outcome.ok) {
        if (!candidates.includes(outcome.url)) candidates.push(outcome.url)
        continue
      }
      if (outcome.reason === 'not-found' || outcome.reason === 'unreachable') continue
      failures.push(`${peer} ${outcome.reason}: ${outcome.detail}`)
    }
    return candidates
  }

  // ── Outbound transport face: the `nativeTeamsA2a` bridge ─────────────
  //
  // Contract: @nelsonlongxiang/dsh-native-teams/src/a2a-face.ts (0.14.0,
  // structural mirror in src/teams-bridge.ts). This plugin mounts the
  // implementation under the face's frozen service key — protocol
  // primitives live on the protocol face (three-party consensus), and
  // native-teams probes it presence-guarded (unmounted ⇒ local-only
  // routing, never a crash). The face ships only what this plugin already
  // does for a2a_route: resolve via the ONE directory walk (same matcher
  // submit uses — no drift-prone double implementation), submit via the
  // direct-route dispatcher (per-candidate async gate, failover included),
  // cancel via the cooperative stop-notice. It exposes nothing new — only
  // teams the tracked peer network already publishes resolve here.
  const bridgeFace: NativeTeamsBridgeFace = {
    resolve: async (handle) => {
      const failures: string[] = []
      const candidates = await directoryPeerCandidates(memoizedCardFetch(), handle, failures)
      if (candidates.length === 0) return undefined
      return { kind: 'node', hops: 1, url: candidates[0] }
    },
    submit: async (request, signal) => {
      const abort = signal ?? new AbortController().signal
      const failures: string[] = []
      const fetch = memoizedCardFetch()
      const candidates = await directoryPeerCandidates(fetch, request.handle, failures)
      if (candidates.length === 0) {
        throw new Error(`team "${request.handle}" is not published by any tracked peer${failures.length === 0 ? '' : ` (unresolved delegations: ${failures.join('; ')})`}`)
      }
      // The caller-born task id (B3): the orchestrator's dedup key IS the
      // wire task id, so the peer's echo correlates with the caller's ledger.
      const taskId = request.idempotencyKey !== undefined && request.idempotencyKey !== ''
        ? request.idempotencyKey
        : `direct-${Math.random().toString(16).slice(2, 10)}`
      // P2 receipt-callback: the receipt routes back to the submitting
      // session's own node team, but ONLY when that session is a joined
      // node. Without a joined parent there is no routable address that
      // means "this session" on the peer — omitting the callback keeps the
      // P1 behavior (the caller label cannot resolve on the peer, so the
      // receipt is lost honestly); falling back to `config.team` would be
      // actively harmful: a same-named peer resolves it LOCAL-first and the
      // receipt steers the peer's own initiator, never leaving that host.
      let callbackAddress: string | undefined
      if (request.callbackTarget) {
        const parent = request.callbackTarget.parentSessionId
        if (sessionNodes.has(parent) || joinedSessions.has(parent)) callbackAddress = `${config.team}/${id8(parent)}`
      }
      // #114 S3: the submitting session's node team, but only when the
      // transport names a session this host knows (a node, a join, or a live
      // root) — an unchecked id would let any submitter mint a seat. Anything
      // else (absent, unknown, non-string) is attributed to the host label.
      const parentSession: unknown = request.callbackTarget?.parentSessionId
      const knownParent = typeof parentSession === 'string' && parentSession !== ''
        && (sessionNodes.has(parentSession) || joinedSessions.has(parentSession) || liveRoots.has(parentSession))
      const sender: Sender = { kind: 'bridge', id: knownParent ? `${config.team}/${id8(parentSession)}` : session }
      for (const candidate of candidates) {
        // Capability gate per candidate, like a2a_route's loop: a
        // delivery:async submit never dials a peer whose signed card does
        // not declare async — failover must not silently degrade into the
        // minutes-long blocking wait the gate exists to prevent.
        let peerAsync = false
        if (request.delivery === 'async') {
          const card = await fetch(candidate)
          peerAsync = (card?.capabilities as { async?: unknown } | undefined)?.async === true
        }
        const result = await dispatchPeerCandidate(candidate, request.handle, request.message, request.contextId, abort, session, request.delivery === 'async' && peerAsync, taskId, callbackAddress)
        if (!result.ok) {
          // Idempotency verdicts (B3) are terminal, not failover: a replay
          // says the prior attempt at THIS peer stays authoritative —
          // re-dispatching the same dedup key at another peer would execute
          // the task twice; a conflict is a caller bug (same key, different
          // payload) and must surface as a failure, not a redirect.
          if (result.code === WIRE_ERROR_REPLAY_REJECTED) {
            // async: acceptance IS the honest outcome — the submission is
            // fire-and-forget and the prior attempt settles via the receipt
            // contract.
            if (request.delivery === 'async') {
              return { kind: 'accepted', taskId, acceptedAt: new Date().toISOString(), contextId: request.contextId ?? '' }
            }
            // sync (W7 recovery table, S1): a sync caller cannot consume an
            // acceptance — its verdict contract needs round text, and the
            // handle-ack prose would settle a null verdict as a normal node.
            // Throw instead, and the frozen -32003 literal MUST ride the
            // message: structured codes have no survival channel through the
            // downstream submitFailedError wrap (message-only), so the
            // graph-loop classifier's probeText match on the code value is
            // the only programmatic channel (adjudicated exception to
            // "message 禁止下游解析").
            throw new Error(`A2A submit for "${request.handle}" replayed at the peer's idempotency ledger (task ${taskId} duplicate within the idempotency window, -32003: the prior attempt stays authoritative — fail-closed; outcome retrieval needs a query face)`)
          }
          if (result.code === WIRE_ERROR_IDEMPOTENCY_CONFLICT) {
            // -32002 literal on the message: same classification channel as the sync replay above.
            throw new Error(`A2A submit for "${request.handle}" conflicts at the peer's idempotency ledger (task ${taskId} reused with a different payload, -32002)`)
          }
          if (abort.aborted) break
          continue
        }
        trackOwedTask(taskId, request.handle, candidate, result, callbackAddress, briefOf(request.message), sender, await peerBirth(fetch, candidate, undefined))
        const contextId = request.contextId ?? (result.context_id !== '' ? result.context_id : `ctx-${Math.random().toString(16).slice(2, 10)}`)
        if (result.task_status === 'TASK_STATE_COMPLETED') {
          return { kind: 'completed', text: result.reply, taskId, contextId }
        }
        // DELIVERED / ABORTED_WAIT: the message is in and the receipt
        // contract carries the outcome — the face maps both to the
        // accepted shape (the submission stays visible in a2a_tasks).
        return { kind: 'accepted', taskId, acceptedAt: new Date().toISOString(), contextId }
      }
      throw new Error(`A2A submit for "${request.handle}" failed on every candidate`)
    },
    queryOutcome: async (request, signal) => {
      const abort = signal ?? new AbortController().signal
      if (request.taskId === '') return undefined
      const failures: string[] = []
      const fetch = memoizedCardFetch()
      const candidates = await directoryPeerCandidates(fetch, request.handle, failures)
      // No candidate to ask: no increment of information — undefined, never
      // a synthetic verdict.
      if (candidates.length === 0) return undefined
      let mismatch = false
      let answeredUnknown = false
      for (const candidate of candidates) {
        // A caller cancel mid-fan-out ends the probe: answers collected
        // before the abort must not aggregate into a verdict the caller
        // already walked away from.
        if (abort.aborted) return undefined
        // Recompute the fingerprint EXACTLY as the submit pass computed it:
        // the same shared implementation, and the same per-candidate async
        // gate (delivery async × that peer's declared capability). Sync
        // delivery — every graph-loop dispatch — is noWait:false throughout.
        let peerAsync = false
        if (request.delivery === 'async') {
          const card = await fetch(candidate)
          peerAsync = (card?.capabilities as { async?: unknown } | undefined)?.async === true
        }
        const fingerprint = peerPayloadFingerprint({ caller: session, message: request.message, noWait: request.delivery === 'async' && peerAsync, team: request.handle })
        const answer = await client.queryOutcome(candidate, request.taskId, fingerprint, abort)
        if (answer === undefined) continue // transport miss — probe the next candidate (read-only fan-out)
        if (!answer.found) {
          if (answer.reason === 'payload-mismatch') mismatch = true
          else answeredUnknown = true
          continue
        }
        return answer
      }
      // A mismatch anywhere wins the aggregation: the key exists at a peer
      // with a different payload — the most diagnostic negative there is.
      if (mismatch) return { found: false, reason: 'payload-mismatch' }
      if (answeredUnknown) return { found: false, reason: 'unknown-task' }
      return undefined
    },
    cancel: async (ref, reason) => {
      const taskId = ref.taskId
      if (taskId === undefined || taskId === '') return false
      const row = taskLedger.list().find(entry => entry.taskId === taskId)
      if (row === undefined) return false
      const notice = cancelNoticeText(taskId, reason)
      if (row.peer === 'local') {
        // Mirror the tasks/cancel control route: the cooperative stop-notice
        // steers the live local target, not just the ledger row. The target
        // resolution spans every kind the dispatcher can book — session
        // node, canvas team, bare process team — a row's team is whatever
        // the dispatch accepted, so the cancel must accept the same set.
        const live = resolveAgentForTeam(row.team)
          ?? canvasLiveAgent(parseCanvasTeamName(row.team))
          ?? (row.team === config.team ? liveAgent() : undefined)
        if (live !== undefined) {
          try {
            steerRelay(live, notice)
          } catch {
            // Bookkeeping below settles regardless; steering is best-effort.
          }
        }
      } else {
        // Peers do NOT track inbound task ids (the owed ledger's writer runs
        // on the dispatcher side), so the peer's ledger-cancel route would
        // deterministically answer 'unknown'. Drive the stop-notice through
        // the wire to the team itself instead. The notice deliberately
        // carries NO task_id: the original id is already claimed at the
        // peer's idempotency ledger with a different payload, so reusing it
        // would 409-conflict before any steer happens (a bodyless key is
        // always fresh there). The original id rides the notice text.
        const result = await client.routeDirect(row.peer, row.team, notice, undefined, undefined, session, true)
        if (!result.ok) {
          logger.warn(`a2a: cancel stop-notice for task ${taskId} failed to deliver to ${row.team}: ${result.error}`)
        }
      }
      return taskLedger.cancel(taskId, reason).outcome === 'cleared'
    },
  }
  ctx.reflect.provide(NATIVE_TEAMS_A2A_FACE_KEY, bridgeFace)

  infoTools.registerStatus()
  infoTools.registerTasks()
  infoTools.registerProbe()

  /**
   * Steering targets awaiting a final reply, keyed by agent session id. Each
   * entry remembers the request id to answer and the log length when the
   * message was steered, so the flush reads only fresh assistant output.
   */
  interface FinalWaiter {
    /** @param placeholder - true when the text is a host-authored
     * stand-in (flush timeout, dead session), NOT the session's product. */
    readonly answer: (text: string, placeholder?: boolean) => void
    readonly sinceEvents: number
    /** #114 S5: set ⇒ attributed by the consumption of this task's steer, not by {@link sinceEvents}. */
    readonly taskId?: string
    /** #114 S5: index of the user/message that consumed the steer, once seen. */
    consumedAt?: number
    /** #114 S5: events below this index were already searched for the consumption. */
    scannedTo?: number
    timeoutDisposer?: () => void
  }
  const pendingFinals = new Map<string, FinalWaiter[]>()
  const armFlushTimeout = (agentId: string, waiter: FinalWaiter): (() => void) => {
    return ctx.timer.timeout(() => {
      const entries = pendingFinals.get(agentId)
      // An already-answered waiter is gone from the list: never answer twice.
      if (entries === undefined || !entries.includes(waiter)) return
      const kept = entries.filter(entry => entry !== waiter)
      if (kept.length === 0) pendingFinals.delete(agentId)
      else pendingFinals.set(agentId, kept)
      waiter.answer('The DSH session produced no final reply within the configured window.', true)
    }, config.flushTimeoutMs)
  }

  function flushFinals(agentId: string): void {
    const entries = pendingFinals.get(agentId)
    if (entries === undefined || entries.length === 0) return
    const agent = ctx.get('agents')?.get(SessionId(agentId))
    if (agent === undefined) {
      for (const entry of entries) {
        entry.timeoutDisposer?.()
        entry.answer('The target DSH session is no longer live.', true)
      }
      pendingFinals.delete(agentId)
      return
    }
    // #114 S5: each waiter is answered from its OWN floor. The old shared
    // floor (the minimum sinceEvents) answered every waiter with one text, so
    // a busy target's other work line settled tasks it had not read yet.
    const events = sessionEventsOf(agent)
    const answered: Array<{ entry: FinalWaiter; reply: string; placeholder?: true }> = []
    // Logs that record turn boundaries bound each waiter to its consuming
    // turn; a log without any marker falls back to "this idle ends it".
    const turnMarked = events.some(event => event?.type === 'turn/start' || event?.type === 'turn/end')
    for (const entry of entries) {
      if (entry.taskId !== undefined) {
        entry.consumedAt ??= consumptionIndex(events, entry.taskId, entry.scannedTo ?? entry.sinceEvents)
        if (entry.consumedAt === undefined) {
          // Not consumed yet (the steer waits for the running turn's next
          // step, or the next turn): no final belongs to it — keep waiting.
          entry.scannedTo = events.length
          continue
        }
        // The consuming turn's window: up to its own `turn/end`, never into a
        // following turn (back-to-back turns can run with no idle between).
        // Without turn markers, this idle is the turn's end.
        let end = events.length
        let completed = true
        if (turnMarked) {
          const close = turnEndIndex(events, entry.consumedAt + 1)
          if (close === undefined) {
            // The consuming turn is still open: wait for its turn/end.
            continue
          }
          end = close
          completed = events[close]?.data?.reason?.kind === 'completed'
        }
        // The waiter closes HERE with that turn's last text. A turn that said
        // nothing, or ended aborted/failed/blocked, did no work this host can
        // vouch for: close as a placeholder — no receipt, the row stays owed.
        const reply = latestAssistantText(events, entry.consumedAt + 1, end)
        answered.push(reply !== '' && completed ? { entry, reply } : { entry, reply: '', placeholder: true })
        continue
      }
      const reply = latestAssistantText(events, entry.sinceEvents)
      if (reply !== '') answered.push({ entry, reply })
    }
    if (answered.length === 0) return
    const kept = entries.filter(entry => !answered.some(done => done.entry === entry))
    if (kept.length === 0) pendingFinals.delete(agentId)
    else pendingFinals.set(agentId, kept)
    for (const { entry, reply, placeholder } of answered) {
      entry.timeoutDisposer?.()
      if (placeholder === true) entry.answer('The consuming turn produced no completed reply.', true)
      else entry.answer(reply)
    }
  }

  /** #114 S5: the index of the first `turn/end` at or after `from`, or undefined while the turn is open. */
  function turnEndIndex(events: readonly (SessionEventLike | undefined)[], from: number): number | undefined {
    for (let index = from; index < events.length; index++) {
      if (events[index]?.type === 'turn/end') return index
    }
    return undefined
  }

  /** #114 S5: the steer header both delivery paths write; the id is captured whole, never prefix-matched. */
  const STEER_HEADER = /^\[A2A direct\] \(task ([^\s)]+)\) /

  /**
   * #114 S5: the index of the user/message that consumed one task's steer —
   * the first at or after `from` whose first text block opens with the
   * `[A2A direct] (task <id>)` header for exactly this id.
   * @param from - first index not yet searched (starts at the pre-steer log length).
   * @returns the index, or undefined while the steer is still unconsumed.
   */
  function consumptionIndex(events: readonly (SessionEventLike | undefined)[], taskId: string, from: number): number | undefined {
    for (let index = from; index < events.length; index++) {
      const event = events[index]
      if (event?.type !== 'user/message') continue
      const first = event.data?.content?.find(block => block.type === 'text' && typeof block.text === 'string')
      if (STEER_HEADER.exec(first?.text ?? '')?.[1] === taskId) return index
    }
    return undefined
  }

  /**
   * The newest assistant text at or after `floor`: at an idle flush that is
   * the final of the turn that just ended. Textless messages (tool-only, or
   * empty/whitespace text) are skipped, so a turn ending on a tool call still
   * answers with the last thing it said. '' when no message has text.
   * @param end - exclusive upper bound (default: the whole log).
   */
  function latestAssistantText(events: readonly (SessionEventLike | undefined)[], floor: number, end: number = events.length): string {
    for (let index = end - 1; index >= floor; index--) {
      const event = events[index]
      if (event === undefined || event.type !== 'assistant/message') continue
      const content = event.data?.message?.content
      if (content === undefined) continue
      const text = content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      if (text.trim() !== '') return text
    }
    return ''
  }

  // Every inbound route is a direct route (final semantics), so the idle
  // flush listens unconditionally — an empty pendingFinals map makes it a
  // no-op. Node facts need no refresh here: the card serves them fresh at
  // read time.
  ctx.on('agent/status', (payload) => {
    if (payload.status === 'idle') flushFinals(String(payload.agent.id))
  })
}

/**
 * Load the node's Ed25519 private key, generating and persisting it on first
 * use. The key IS the node's card identity: a persisted key keeps signatures
 * verifiable across restarts, which is why storage lands with the announce
 * config surface rather than after it.
 * @param path - absolute PEM path (`<dsh-home>/a2a/node-key.pem`).
 * @returns the private key used to sign every published card.
 */
function loadOrCreateNodeKey(path: string): ReturnType<typeof generateKeyPairSync>['privateKey'] {
  if (existsSync(path)) {
    return createPrivateKey(readFileSync(path, 'utf8'))
  }
  const { privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  return privateKey
}

/**
 * Derive the default wire session label from a per-home node id: eight hex
 * characters generated once, so two deployments mounting defaults do not
 * collide while a persisted home keeps the label stable across restarts.
 * @param home - resolved harness home.
 * @returns the derived session label (`dsh-host-<8 hex>`).
 */
function deriveSession(home: string): string {
  const path = join(home, 'a2a', 'node-id')
  if (existsSync(path)) return `dsh-host-${readFileSync(path, 'utf8').trim()}`
  const id = randomBytes(4).toString('hex')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${id}\n`, { mode: 0o600 })
  return `dsh-host-${id}`
}
