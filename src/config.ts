/** The plugin row's configuration: the `Config` interface and its Schemastery schema (moved out of index.ts, #77). */
import s from '@deepseek-ai/schemastery'
import { TASK_STALE_TTL_MS } from './task-ledger.ts'
import { DEFAULT_TARGET_QUEUE_CAP } from './queue-guard.ts'
import type { SettlementMode } from './task-auth.ts'

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
  /**
   * gh#193: send nothing to any peer. Every outbound peer request — card
   * reads, directory sweeps, routes, log reads, canvas pings and canvas-op
   * relays — goes through one fetch that refuses while this is on, so a
   * test host stays dark even with learned peers in `a2a/peers.json`
   * (which is left untouched). Inbound faces keep answering. Default false.
   */
  readonly isolated: boolean
  /** Forward online local CLI deliveries one hop after a local miss. Default on from 0.6.38; explicit false opts out. */
  readonly forwardDirect: boolean
  /**
   * superagent design v4: run superagent's domain engine in this host (router, Sources, tickets). Off by default; the
   * owner turns it on, then names the router and the allowed senders in the workbench.
   */
  readonly superagent?: boolean
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
  /** #335: preserve unsuspended legacy bare member inference until the owner closes the window. */
  readonly canvasLegacyBareMembers: boolean
  /**
   * Extra origins this host answers to as an OriginClaim audience, beyond
   * its card URL and the address a request arrives on (port-mapped or
   * proxied hosts name the URL peers dial).
   */
  readonly originClaimAudiences: string[]
  /**
   * #317: per-peer `X-API-Key`, keyed by the peer's origin. Sent instead of `apiKey` on requests to that peer,
   * and accepted on this host's peer faces only from a caller whose verified OriginClaim names that origin.
   * Never accepted on the control routes. Lets a public node link without holding the fleet key.
   */
  readonly linkKeys: Record<string, string>
  /**
   * #19 D2: card-face sessionTeams excerpt exposure — 'full' | 'masked'
   * | 'off' (owner-level; default full). See the schema comment.
   */
  readonly exposureExcerpt: 'full' | 'masked' | 'off'
  /**
   * Override for the OriginClaim callerUrl anchor. Loopback-bound hosts
   * behind a pocket tunnel must name the card URL peers can actually
   * fetch (e.g. http://10.20.30.11:13080); empty uses the web server's
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
  /** Human-owned stable display labels keyed by full local session id; never a routing identity. */
  readonly seatNames: Record<string, unknown>
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
  /** gh#224: receipt-owing tasks one target may queue on this host before new deliveries are refused (0 = off). */
  readonly targetQueueCap: number
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
  isolated: s.boolean().default(false),
  forwardDirect: s.boolean().default(true),
  superagent: s.boolean().default(false),
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
  seatNames: s.dict(s.any()).default({}),
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
  canvasLegacyBareMembers: s.boolean().default(true),
  /** Extra OriginClaim audience origins (port-mapped/proxied hosts). */
  originClaimAudiences: s.array(s.string()).default([]),
  linkKeys: s.dict(s.string()).default({}),
  /** OriginClaim callerUrl override for pocket-tunneled hosts; '' = auto. */
  originClaimUrl: s.string().default(''),

  /**
   * v0.5.23 (async-stall): delay before a delivered-but-unconsumed async
   * route re-wakes its target with a one-line nudge (defect
   * t-mt6nd0sq-hxuhj6). 0 disables the nudge entirely.
   */
  asyncNudgeDelayMs: s.number().default(120_000),
  /** gh#224: at most this many receipt-owing tasks queue for one target; the next is refused (-32009). 0 disables. */
  targetQueueCap: s.number().default(DEFAULT_TARGET_QUEUE_CAP),
  stateColdRowsTtlMs: s.number().default(5_000),
  cardCacheTtlMs: s.number().default(60_000),
  cardCacheNegativeTtlMs: s.number().default(30_000),
  remoteRowsTtlMs: s.number().default(15_000),
  cardTtlMs: s.number().default(172_800_000),
  flushTimeoutMs: s.number().default(300_000),
  routeTimeoutMs: s.number().default(1_800_000),
  taskStaleTtlMs: s.number().default(TASK_STALE_TTL_MS),
})
