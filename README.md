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

- **Model tools** — `a2a_teams` lists the teams this node can see (own, peers', joined sessions'); `a2a_route`
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

| Tool | Answers | Notes |
| --- | --- | --- |
| `a2a_teams` | Which teams can I route to? | Own, peers', and joined sessions' teams, with activity excerpts. |
| `a2a_route` | Send a message to a team. | `context_id` continues a conversation; `async: true` delivers without waiting; fails over across candidates. |
| `a2a_tasks` | Which async tasks still owe a receipt? | Three tiers: owed rows keep the follow-up `context_id`; past-TTL rows auto-dead-letter (still settleable); outcomes land in the bounded archive; persisted across restarts. |
| `a2a_probe` | Is the fleet healthy? | One verified-card fetch per peer (or one given url); `N reachable, M down`; misses classified `unreachable` vs `rejected`. |
| `a2a_status` | What is this node doing right now? | Tracked peers with quality scores, in-flight routes, recent routing activity, and the idempotency window aggregate (occupancy + claim/replay/conflict counters). |

## Canvas teams (arbitrary grouping, v0.5.25)

A canvas team is a user-composed, named, multi-member routing group: **one atomic session node may sit in many teams**, and a route to `<team>/canvas/<name>` resolves the **first live member** (member order is the routing priority) or wakes the **first cold joined member** (wake-on-route). The `canvas/` path segment can never collide with a node alias (`<team>/<id8>`), so both namespaces coexist untouched.

- Storage: `<dsh-home>/a2a/canvas.json` (ordered team entries; caps: 64 teams × 32 members)
- Control API: `POST /__dsh_a2a/canvas` with `action: create | remove | add-member | remove-member`
- Membership requires a joined session (live node or remembered intent) — no routing backdoor over unjoined sessions; leaving the network (leave/archive) drops every canvas membership
- `a2a_teams` lists canvas teams as local rows with member/live counts; `/__dsh_a2a/state` serves per-member `joined`/`live` flags

## Native-teams bridge (node unification, P1)

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
| `wakeJoinedOnBoot` | `false` | Prewarm cold joined sessions' agents after mount (needs the api gateway; wake-on-route and the sidebar wake button stay available without it). The prewarm is deferred, foreground-yielding, and cancellable — it never blocks the boot window (see the two knobs below). |
| `wakePrewarmDelayMs` | `10000` | Idle delay between loader settlement and the first prewarm wake; `0` restores fire-at-settle. |
| `wakePrewarmQuietMs` | `5000` | Foreground quiet window: a wake/route demand (or any outbound route in flight) inside this window postpones the next prewarm step; `0` disables the yield. |
| `cardTtlMs` / `flushTimeoutMs` / `routeTimeoutMs` | see schema | Card lifetime and route timing budgets. |

Example — one announcing node with a seed:

```yaml
- id: a2a
  name: '@nelsonlongxiang/dsh-open-a2a-net'
  config:
    announce: true
    peers: ['http://127.0.0.1:41243']
```

## Leave semantics (bounded staleness)

`leave` is a per-session, per-host gesture: it removes the join intent locally and unmounts the node. There is **no network-wide revocation broadcast** — peer directories keep publishing the team until their card TTL expires, and inbound deliveries during that window fail honestly (the host no longer resolves the team). Remote targets that already implemented the receipt contract are unaffected. A formal revocation-broadcast protocol is tracked in upstream note `2026-08-27-a2a-leave-no-revocation-broadcast.md` (proposed).

## Trust model

Cards are Ed25519-signed and expire; `peers` referrals, `sessionTeams` listings, `lanIp`, and `version` on a card
are unsigned and read fresh — the last two exist so operators can audit which build every fleet node actually runs
without visiting each host. A referral URL whose own fetch just proved it serves this node's card is remembered,
and re-offers of it within a suppression window are ignored instead of flickering in and out of the peer store.
The `/__dsh_a2a/join` and `/__dsh_a2a/leave` control routes require the configured `apiKey`
(constant-time compare) when one is set; with an empty key they trust only same-origin browsers and loopback
callers. Set an `apiKey` before exposing the listener beyond loopback.

## Stages (visualization surfaces)

Two full-page stages mount beside the model tools: `/__dsh_a2a_nexus` (the
Three.js topology viewer) and `/__dsh_a2a_canvas`. A bare mount path
redirects (301) onto its trailing-slash form, so both spellings render and
the shell's relative assets always resolve inside the served tree. For
offline development, `nexus-stage/scripts/mockhost.py [port]` serves the
built stage with canned state; open `/?fault=500` on it to exercise the
on-page fault badge. The planning canvas persists its layout document
**last-write-wins** — two browsers (or tabs) arranging the same fleet
will overwrite each other's arrangements; one planner at a time (see
`feedback/2026-08-27-nexus-canvas-ux/multi-tab-analysis.md`). `pnpm verify` needs no manual bootstrap on a fresh
checkout: its `verify:nexus` step installs the subpackage dependencies
itself before building.

## Collaboration SOP (network practice, v0.1)

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

```sh
pnpm install   # auto-install-peers pulls the DSH peer train from npm
pnpm verify    # typecheck, build, source tests, and built-artifact layout guard
pnpm build     # host lib (including lib/a2a-client.js), client types, and browser bundle (lib/client.js)
```

## License

MIT
