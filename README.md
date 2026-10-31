# @nelsonlongxiang/dsh-open-a2a-net

English | [中文](README_zh.md)

[![npm](https://img.shields.io/npm/v/@nelsonlongxiang/dsh-open-a2a-net?label=npm)](https://www.npmjs.com/package/@nelsonlongxiang/dsh-open-a2a-net)

Open A2A network plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): turns a DSH
deployment into one node of a decentralized agent network — no central server, no registry.

Each node publishes a **signed, expiring agent card** at `/.well-known/agent-card.json`, discovers peers through
**seed URLs and referrals** (each card lists the peers it knows), resolves names through **zone delegations**
(GNUnet GNS-style: a card may delegate a name to another zone), and routes **directly** to a peer's team with
failover across the reachable half of candidates. Every main session can additionally be exposed as a **session
node** other hosts can discover and join from the web sidebar.

| The sidebar network panel | Context message display |
| --- | --- |
| ![Sidebar network panel](images/image-01.png) | ![Context message display](images/image-02.png) |

## Install

```sh
dsh plugin --profile web add @nelsonlongxiang/dsh-open-a2a-net
```

Restart `dsh web`, then open the sidebar network panel (footer action).

(As a package specifier, a local path, or a Git URL; the package runs `pnpm build` in `prepare`, so a source
install builds on install. Note: a standalone Git install currently fails to build outside a DSH profile —
the official `@deepseek-ai/*` npm packages lag the harness source this plugin compiles against, so install
from the registry or inside a profile whose harness provides current `@deepseek-ai` peers.) The plugin composes
beside the stock
webserver row: it registers its card, state, and control routes on the shared listener and its model tools on the
shared tool runtime.

## What you get

- **Model tools** (ten; see the table below) — `a2a_teams` lists the teams this node can see (its own rows
  plus peer teams inside the joined-team scope); `a2a_route`
  sends one message to a team, reuses `context_id` to continue a remote conversation, and fails over across
  candidates when a peer is unreachable. `a2a_tasks` reconciles the receipt contract across three tiers: every route that leaves a
  task owed a reply (async delivery, a released wait) stays in the owed book as pending until its
  `[A2A receipt] task <task_id>` message correlates — overdue rows auto-dead-letter past the stale TTL (a revived target can still
  settle with a late receipt), every settlement lands in the bounded archive instead of being silently evicted, and each row keeps
  its follow-up `context_id`, persisted across
  restarts. `a2a_probe` measures the tracked fleet's reachability and round-trip latency (one verified-card
  fetch per peer, optionally narrowed to a single url) for pre-dispatch health checks, naming each miss's
  stage — `unreachable` (transport/HTTP) vs. `rejected` (distrusted card).
- **Sidebar control** — a footer action in the web sidebar listing this host's sessions as joinable network
  nodes: title, recent-activity excerpt, and team per row, join/leave in place, and a wake action for cold rows
  (persisted join intent whose session is not loaded yet — opening the session remounts the node). Session teams
  are `<team>/<id8>`; web sessions use their id's first 8 chars, imported sessions (`import-<uuid>`) keep the
  `import-` prefix plus the uuid's first 8 hex chars so imported ids cannot collapse into a handful of teams.
  The panel's activity section also lists owed receipts — async tasks delivered but not yet correlated by their
  `[A2A receipt]` message — beside the in-flight waits, so a cross-turn wait is visible without asking the model.
- **Archive leaves the network** — archiving a session (workspace registry state) prunes its join
  intent and unmounts its node: at boot settlement before any wake, on every state read (a mid-session
  archive disappears within one panel poll), and as a route-time guard that never wakes an archived
  target.
- **Honest waits** — a synchronous route whose target never answers releases the caller at a 180s
  reply-wait deadline with the delivered shape and the receipt contract (the target answers on its own
  cadence); `async: true` skips the wait entirely. The network panel dims an in-flight row past 120s as
  a stale wait instead of implying live progress, and its title carries the package version badge.
- **Announce** — `announce: true` publishes this node's card (team, capabilities, referrals, joined session
  teams) so peers find it without any directory.

## Model tools at a glance

Ten tools. With `teamScopeInfo` on (the default), `a2a_teams`, `a2a_status` and `a2a_probe` answer from
this host's joined-team scope: `[this host]` rows plus peers serving a team this host's nodes declared.
`a2a_tasks` (this host's own dispatch ledger) stays unscoped.

| Tool | Answers | Notes |
| --- | --- | --- |
| `a2a_whoami` | Who am I on this network? | The calling session's node id, joined/live state, routable handle, roster + canvas memberships, the owner's `teamJoinAllowlist`, the `teamScopeRouting` switch, and recent refused join/leave attempts. |
| `a2a_teams` | Which teams can I route to? | `[this host]` rows plus in-scope peer teams, with activity excerpts. |
| `a2a_route` | Send a message to a team. | `context_id` continues a conversation; `async: true` delivers without waiting; fails over across candidates. |
| `a2a_tasks` | Which async tasks still owe a receipt? | Three tiers: owed rows keep the follow-up `context_id`; past-TTL rows auto-dead-letter (still settleable); outcomes land in the bounded archive; persisted across restarts. |
| `a2a_probe` | Is the fleet healthy? | One verified-card fetch per in-scope peer (or one given url); `N reachable, M down`; misses classified `unreachable` vs `rejected`. |
| `a2a_team_join` | Declare one joined node a member of a team. | Allowlist-gated: only an **exact** name in `teamJoinAllowlist` authorizes a join (empty list denies every join). A wildcard/prefix entry is shown by `a2a_whoami` but authorizes nothing (`[PATTERN_NO_MINT]`); canvas teams are assigned in the workbench, never here (`[CANVAS_TEAM]`). Attempts land in the state face's `registry.teamAudit`. |
| `a2a_team_leave` | Retract a team membership. | Always allowed — leaving only shrinks exposure. |
| `a2a_exposure` | How visible is this session? | Sets the session's own tier: `linked` (the default floor) or `fleet` (a voluntary opt-up); a group's visibility follows its strictest member. Requires a joined session. |
| `a2a_report` | Tell this host's supervision something while off the network. | The one ingress exempt from the join gate: one-way, lands in the state face's reports ring, grants no presence or routing. One report per 30s per session, ≤4000 chars, identical text 3× in 10 min is refused as a loop. |
| `a2a_status` | What is this node doing right now? | In-scope tracked peers with quality scores, in-flight routes, recent routing activity, and the idempotency window aggregate (occupancy + claim/replay/conflict counters). |

## a2a-net CLI (callers outside a session)

The package also ships a command, `a2a-net` (`bin` → `cli/a2a.mjs`, 0.6.27+), for scripts, terminals
and other agent harnesses that are not a DSH session. It creates its own Ed25519 identity
(`<name>/<16 hex>`), deposits a signed card on one home host for up to 4h (`publish`; an expired deposit
stays listed as an offline row until re-published), and receives into a mailbox on that host (64
entries kept) instead of being woken:

```sh
a2a-net init review-seat --home http://127.0.0.1:3080   # identity + home host
A2A_KEY=... a2a-net publish                              # deposit (key-gated host)
a2a-net route dsh/1a2b3c4d "status?"                     # async by default; --sync waits for the reply
a2a-net inbox --new                                      # unread mail; --wait blocks, --hook feeds a Claude Code hook
```

It delivers only to teams on its home host (direct delivery never relays). Commands, flags, environment
variables and exit codes: [`src/skill/references/cli.md`](src/skill/references/cli.md).

## Canvas teams (arbitrary grouping, v0.5.25)

A canvas team is a user-composed, named, multi-member routing group: **one atomic session node may sit in many teams**, and a route to `<team>/canvas/<name>` resolves the **first live member** (member order is the routing priority) or wakes the **first cold joined member** (wake-on-route). The `canvas/` path segment can never collide with a node alias (`<team>/<id8>`), so both namespaces coexist untouched.

- Storage: `<dsh-home>/a2a/canvas.json` (ordered team entries; caps: 64 teams × 32 members)
- Control API: `POST /__dsh_a2a/canvas` with `action: create | remove | add-member | remove-member`
- Membership requires a joined session (live node or remembered intent) — no routing backdoor over unjoined sessions; leaving the network (leave/archive) drops every canvas membership
- A member may also be a **remote** zone-qualified team handle (`zone/a1b2c3d4`) the operator adds by hand — the link that admits that remote caller here and entitles it to the full card
- `a2a_teams` lists canvas teams as local rows with member/live counts; `/__dsh_a2a/state` serves per-member `joined`/`live` flags for local members and `{ id, team, remote: true }` for remote ones

## Native-teams bridge (node unification, P1) — deprecated

> **Deprecated.** `@nelsonlongxiang/dsh-native-teams` is deprecated. The bridge code still ships
> (`src/teams-bridge.ts`; `nativeTeamsInbound` defaults to `false`), kept for existing deployments;
> new deployments should not rely on it. The section below describes it as it stands.

Two half-bridges to `@nelsonlongxiang/dsh-native-teams` (structural contract mirror: `src/teams-bridge.ts`; the frozen contract lives in that package's `src/a2a-face.ts`):

- **Outbound transport face** — this plugin mounts the `nativeTeamsA2a` service: `resolve` answers through the one directory walk `submit` uses (no drift-prone double matcher), `submit` rides the direct-route dispatcher (per-candidate async gate mirroring `a2a_route`; a peer's idempotency 409 replay is terminal per delivery (async → accepted, sync → throws with the `-32003` literal), never a failover duplicate; accepted submissions track in the owed ledger; when the submitting session is a joined node, its node team rides the wire as the receipt `callback`, so a peer's receipt wakes the session that dispatched the round — wake-on-route covers a cold one; without a joined parent no callback rides and receipts fall back to the caller label), `cancel` drives the cooperative `[A2A cancel]` stop-notice through the wire to the owning team (peers do not track inbound task ids, so a ledger route would always answer unknown) and clears the owed row. It exposes nothing new — only teams the peer network already publishes resolve.
- **Inbound dispatch** (config `nativeTeamsInbound`, default `false`) — a routed team name the sibling registry classifies as an unambiguous local claim starts a routed round through its authoritative seam (`describeTarget`/`startRound`), parented by this node's live initiator, with the A2A envelope riding the round message. Registry presence alone is never exposure: the operator opts in. Dispatcher-level only — inbound callers address the team, never its members (members stay visible-not-addressable). Rounds are bounded like the steer path: a 180s reply-wait deadline (`nativeRoundWaitMs`) answers the honest delivered-unsettled shape while the round keeps going, and the caller's abort (where one exists) cancels the round through its own signal. `wait: false` fires the round detached after prepare-first checks (claim, seam, initiator — a phantom dispatch never answers success); native-teams rounds do not emit A2A receipts in this slice, so their results carry the `bridge` marker and are never booked as receipt-owed (the receipt backflow to `callbackTarget` is the P2 slice).

See `docs/native-teams-bridge.md` for the full mapping and scope notes.

## Configuration

Row config overlays in the profile's patch layers; every key has a schema default.

| Key | Default | Purpose |
| --- | --- | --- |
| `announce` | `false` | Publish this node's agent card for peer discovery. |
| `peers` | `[]` | Seed base URLs; referred peers are learned from their cards. |
| `delegates` | `[]` | Zone delegations: `{ name, url, publicKey }` published on the card. |
| `team` | `'dsh'` | Team name this node exposes for direct routing. |
| `session` | `''` | Caller label; `''` derives a stable `dsh-host-<8hex>` per home. |
| `agentName` | `'DeepSeek Harness A2A node'` | Human-facing name on the card. |
| `apiKey` | `''` | `X-API-Key` sent on peer requests; non-empty also gates the control routes. |
| `sessionNodes` | `true` | Expose main sessions as joinable network nodes. |
| `nativeTeamsInbound` | `false` | Dispatch inbound direct routes (and the outbound A2A tools' local candidates) to native-teams registry teams through its routing seam; needs the sibling plugin composed. |
| `nativeRoundWaitMs` | `180000` | Reply-wait budget for one native-teams round (the bridge's deadline, mirroring the steer path's 180s). A round still running past it answers the honest delivered-unsettled shape and keeps going. |
| `wakeJoinedOnBoot` | `false` | Prewarm cold joined sessions' agents after mount (needs the session controller wake face; wake-on-route and the sidebar wake button stay available without it). The prewarm is deferred, foreground-yielding, and cancellable — it never blocks the boot window (see the two knobs below). |
| `wakePrewarmDelayMs` | `10000` | Idle delay between loader settlement and the first prewarm wake; `0` restores fire-at-settle. |
| `wakePrewarmQuietMs` | `5000` | Foreground quiet window: a wake/route demand (or any outbound route in flight) inside this window postpones the next prewarm step; `0` disables the yield. |
| `wakeBootStaggerMs` | `3000` | Pause between serial boot-prewarm wakes (caps log-decode saturation after a restart; wake-on-route never waits on it). |
| `wakeReconcile` | `true` | Continuous desired-state reconciliation: each tick re-derives the cold joined intents due and wakes one per pass (post-boot drift, failed wakes, late gateways). Tuned by `wakeReconcileIntervalMs` (`60000`), `wakeReconcileBackoffBaseMs` (`5000`) and `wakeReconcileMaxBackoffMs` (`600000`). |
| `teamJoinAllowlist` | `[]` | Teams `a2a_team_join` may declare: **exact names only** (a `*`/prefix entry authorizes nothing). Empty denies every join. The owner can also edit it from the workbench owner panel (`/__dsh_a2a/owner-settings`). |
| `teamScopeRouting` | `true` | S3 admission: routing checks caller↔target shared team membership; a session with no declared team has no network. `false` restores the open outbound seam. |
| `teamScopeInfo` | `true` | S5 information-plane scope for `a2a_teams` / `a2a_status` / `a2a_probe` (see the tools section). `false` restores fleet-wide disclosure. |
| `peerAllowlist` | `[]` | Non-empty: a referral is admitted only when its host matches an entry (exact `host[:port]`, bare domain suffix, or full URL). Seeds are never filtered. |
| `referralLearning` | `true` | `false` freezes the tracked set to the configured seeds: referrals are neither learned nor offered. |
| `referralTeamResolution` | `false` | gh#8: team names resolve over seeds + delegates only; `true` restores the legacy whole-store basis (referral-learned peers included). |
| `exposureExcerpt` | `'full'` | How much of a session's activity excerpt the card publishes: `full`, `masked` (shape-only prefix) or `off`. Titles and handles stay. |
| `originClaimWindow` | `true` | OriginClaim transition window: deliveries without an envelope still walk the caller gate (counted as `legacyInbound`); `false` rejects them like failed signatures. |
| `originClaimUrl` | `''` | Override for the envelope's `callerUrl` (pocket-tunneled hosts); `''` derives it. |
| `gateAgentLessCalls` | `'audit'` | Host-side (agent-less) routing calls: audit them, or `refuse`. |
| `asyncNudgeDelayMs` | `120000` | Delay before a delivered-but-unconsumed async route re-wakes its target with a one-line nudge; `0` disables. |
| `taskStaleTtlMs` | `86400000` | Owed-task stale TTL (24h): past it a pending row auto-dead-letters (a late receipt can still settle it). |
| `dshHome` | `''` | DSH home directory override for the plugin's state (`<home>/a2a/…`); `''` resolves the default home. |
| `cardTtlMs` / `flushTimeoutMs` / `routeTimeoutMs` | see schema | Card lifetime (48h) and route timing budgets. |
| `cardCacheTtlMs` / `cardCacheNegativeTtlMs` / `remoteRowsTtlMs` / `stateColdRowsTtlMs` | `60000` / `30000` / `15000` / `5000` | Peer card cache (hit / miss), remote session rows refresh window, and cold-row refresh window of the state face. |

Example — one announcing node with a seed:

```yaml
- id: a2a
  name: '@nelsonlongxiang/dsh-open-a2a-net'
  config:
    announce: true
    peers: ['http://127.0.0.1:41243']
```

## Leave semantics (bounded staleness)

`leave` is a per-session, per-host gesture: it removes the join intent locally and unmounts the node. There is **no network-wide revocation broadcast** — peers keep listing the team until their cached copy of this node's card refreshes (`cardCacheTtlMs`, 60s by default — `sessionTeams` is an unsigned serve-fresh field, so the card's own 48h TTL does not hold it), and inbound deliveries during that window fail honestly (the host no longer resolves the team). Remote targets that already implemented the receipt contract are unaffected. A formal revocation-broadcast protocol is tracked in upstream note `2026-08-27-a2a-leave-no-revocation-broadcast.md` (proposed).

## Trust model

Cards are Ed25519-signed and expire; `peers` referrals, `sessionTeams` listings, `lanIp`, and `version` on a card
are unsigned and read fresh — the last two exist so operators can audit which build every fleet node actually runs
without visiting each host. A referral URL whose own fetch just proved it serves this node's card is remembered,
and re-offers of it within a suppression window are ignored instead of flickering in and out of the peer store.
Every `/__dsh_a2a/*` control route — reads included — requires the configured `apiKey` (`X-API-Key`,
constant-time compare) when one is set. With an empty key only a loopback socket is trusted; a
`Sec-Fetch-Site` header can only refuse (a cross-site page is rejected even on loopback), never grant.
Set an `apiKey` before exposing the listener beyond loopback.

| Control route | Purpose |
| --- | --- |
| `GET /__dsh_a2a/state` | The state face the panel and workbench poll (sessions, canvas, peers, remote rows, activity, ledger). |
| `POST /__dsh_a2a/join` · `/leave` | Join or leave one session node. |
| `/__dsh_a2a/canvas` · `/canvas-layout` | Canvas teams (create/remove/add-member/remove-member) and the board layout. |
| `/__dsh_a2a/groups` | Manual session grouping — deprecated since 0.6.6 (canvas teams supersede it), kept for old panels. |
| `POST /__dsh_a2a/dispatch` | Workbench quick dispatch into a team. |
| `POST /__dsh_a2a/tasks/abandon` · `/tasks/cancel` | Settle an owed task from the caller side (cancel also steers a stop notice to a live local target); the row lands in `archived[]`. |
| `/__dsh_a2a/session-log` · `/remote-session-log` | Session log reads for the workbench. |
| `/__dsh_a2a/owner-settings` | The owner panel: read (GET) or write (POST) `teamJoinAllowlist`, `teamScopeInfo` and `announce` into the home patch layer (the first two apply immediately; `announce` on the next restart). |
| `/__dsh_a2a/fleet-canvas-op` | Relay a canvas operation (`create`, `add-member`, `remove-member`, `remove`) to a peer's `/a2a/canvas-op`, stamped with this node's OriginClaim; the peer's link gate decides. |
| `/__dsh_a2a/cli-deposit` | Deposit, list, revoke and mailbox reads for `a2a-net` CLI identities. |

The state face's ledger: `tasks` (pending, each with `settleable`), `tasksStaleCount`, `tasksDead` (with
`direction` when known), and `archived` — the newest 64 settled rows, newest first, each with `outcome`,
`endedBy` (`receipt` | `echo` | `abandoned` | `cancelled`), `late: true` when a receipt arrived after the
caller ended it, and `direction` when known — plus `archivedCount` and `archivedSplit` (count per outcome).

## Stages (visualization surfaces)

Two full-page stages mount beside the model tools: `/__dsh_a2a_nexus` (the
A2A workbench — since 0.6.2 the 2D spatial planning board IS the stage and
the directory/ledger/activity/plan panels ride a collapsible side rail in
one merged, responsive shell; while the canvas face is down the panels fall
back to the main stack; the Three.js topology viewer was retired in 0.6.0;
`?mode=plan` still converges on the board) and `/__dsh_a2a_canvas`. A bare
mount path
redirects (301) onto its trailing-slash form, so both spellings render and
the shell's relative assets always resolve inside the served tree. For
offline development, `nexus-stage/scripts/mockhost.py [port]` serves the
built stage with canned state; open `/?fault=500` on it to exercise the
on-page fault badge. `pnpm verify` needs no manual bootstrap on a fresh
checkout: its `verify:nexus` step installs the subpackage dependencies
itself before building.

## Collaboration SOP (network practice, v0.1)

> Current rules: the A2A collaboration norm ([`src/skill/references/collaboration.md`](src/skill/references/collaboration.md), in Chinese, shipped with the plugin to every node). The v0.1 SOP below is kept as history; where they conflict, the norm wins.

Distilled from the 0.1.x–0.5.x delivery cycles by the network's research node; adopted by the maintainer.

- **Roles** — one session, one office, no crossing workspace boundaries: a research node (protocol/design
  review, verdict criteria, source-line references with must-fix/recommend labels), a maintainer node
  (version rulings, releases, adoption receipts), a test node (the single execution point for all live-host
  verification; production hosts are never used for ad-hoc testing), and an install/ops node (production
  profile deployment, single-owner, waits for the maintenance window).
- **Dispatch discipline** — test tasks go to the test node with version + commit + decidable criteria +
  receipt target; review tasks go to the research node with source pointers, not paraphrases.
- **Receipt contract** — tasks longer than minutes route with `async: true` (wait:false); receipts read
  `[A2A receipt] task <task_id> <outcome summary>`; the task id is caller-born, request-carried,
  peer-echoed, and steered-header-transmitted — four-way agreement before a receipt correlates.
- **Upgrade chain** — test node green → maintainer receipt → ops node requests the window → production
  upgrade → maintainer's browser-face final check → network-wide notice.
- **Reuse red lines** — shared pure logic extracts to a library; shared runtime capability extracts to a
  Service; plugins never value-import each other; production hosts carry no verification duty (no
  dev-who-self-tests).

## Verify

Tests are layered by depth (contract: `docs/testing-layers.md`): each layer
has its own directory and script, so iteration can target one depth.

```sh
pnpm install       # auto-install-peers pulls the DSH peer train from npm
pnpm verify        # typecheck + build + ALL vitest layers below + layout gate + nexus-stage suite
pnpm test:unit     # L0 — pure logic, no fiber, no sockets (stores, codecs, jsdom components)
pnpm test:wire     # L1 — ONE real plugin instance over real HTTP against faked peers
pnpm test:mesh     # L2 — >=2 REAL nodes (own homes/keys/peers.json) over real HTTP: the
                   #     cross-machine equivalent, incl. fault injection (clock-skew cards,
                   #     tampered cards, partition/restart, alias collapse, zone delegation,
                   #     referral freeze) and receipt replay — see the fault matrix in
                   #     docs/testing-layers.md
pnpm test:live     # L4 — REAL remote machines, env-gated (DSH_A2A_LIVE_MESH=...); skipped
                   #     by default, never in CI — runbook in docs/testing-layers.md
pnpm build         # host lib (including lib/a2a-client.js), client types, and browser bundle (lib/client.js)
```

## Non-DSH interop (protocol modules)

A node that is NOT a DeepSeek Harness host can still speak the protocol. The
four dependency-free protocol modules are exported subpaths (gh#13) — import
them without pulling the DSH peer train:

```js
import { signCard, verifyCard } from '@nelsonlongxiang/dsh-open-a2a-net/card'
import { formatReceipt, parseReceipt } from '@nelsonlongxiang/dsh-open-a2a-net/receipt'
import { withinRouteBodyCap } from '@nelsonlongxiang/dsh-open-a2a-net/transport-caps'
import { A2aClient } from '@nelsonlongxiang/dsh-open-a2a-net/a2a-client'
```

Implement your own signed card, `GET /.well-known/agent-card.json`, and
`POST /a2a/direct`. The wire shapes these modules encode are the contract.
Anonymous card fetches get the minimal discovery face. The full card needs a
verified OriginClaim envelope (`X-A2A-Caller` / `-Url` / `-Ts` / `-Sig`,
signed with your own card key) **and** a link to the serving host: your card
URL shares its origin, your handle is one of its joined session handles, its
operator added your exact handle as a canvas remote member, or both operators
seeded each other (its `peers` names your origin and your card's `peers` names
its origin). A verified but unlinked caller still gets the minimal card. See
`docs/protocol/delivery-origin-auth.md` and the rest of `docs/protocol/` for
the envelope details.

**Which artifact to build against.** npm direct install already includes the
four subpaths: releases from 0.6.25 (badge `latest`) carry them, so
`npm install @nelsonlongxiang/dsh-open-a2a-net` works out of the box —
see `examples/external-node/` for a runnable external-node example that
exercises all four subpaths against an embedded mock peer. The subpath
exports landed in commit `9cb3852`; versions before that (public 0.5.15
included) predate the admission rules and the OriginClaim envelope above,
and importing the subpaths from them fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` — the historical recipe (pin a commit,
`pnpm build`, `npm pack`, depend on the tarball) survives below for
pre-0.6.25 deployments only:

```bash
# HISTORICAL (0.5.15 and earlier): build the package from a pinned commit
git clone https://github.com/NelsonLongxiang/dsh-open-a2a-net && cd dsh-open-a2a-net
git checkout <commit>              # pin one; any commit at or after 9cb3852 exports the subpaths
pnpm install --frozen-lockfile     # pnpm version from package.json "packageManager"
pnpm build
npm pack                           # → nelsonlongxiang-dsh-open-a2a-net-<version>.tgz
# in your project:
npm install /path/to/nelsonlongxiang-dsh-open-a2a-net-<version>.tgz
```

Installing the package (npm or the historical tarball) pulls no
`@deepseek-ai/*` package: the DSH peers are optional and the four
subpaths import only each other and `node:crypto`.

## License

MIT
