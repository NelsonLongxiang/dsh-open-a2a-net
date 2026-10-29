---
name: a2a-network
description: Use when a task needs cross-session or cross-node collaboration over the DSH A2A network — setting it up (install, config, apiKey, peers, canvas links for one host, two peers, or hosts that cannot reach each other), joining and teaming, routing work to remote teams and agents, reconciling receipts and the task ledger, and reading the A2A workbench (/__dsh_a2a_nexus/). Covers admission rules, the receipt contract, and the failure shapes that look like bugs but are contract semantics.
---

# DSH A2A Network

Drive the decentralized A2A network: sessions publish agent cards, join a
membership layer, form canvas teams, and route work to each other through
`a2a_route`. One plugin (`@nelsonlongxiang/dsh-open-a2a-net`) owns the whole
surface on every node.

## Objects

- **Node** — one DSH host process exposing `/.well-known/agent-card.json` and
  the `__dsh_a2a/state` face. Peers discover each other through cards.
- **Session node** — a live DSH session on a node. Visibility follows
  membership: an unjoined session is invisible to peer discovery AND refused
  at the routing admission gate.
- **Team** — a routable identity. Two kinds: the node's process team
  (`<zone>/<id8>` from the session id) and canvas teams
  (`<zone>/canvas/<name>`, user-composed multi-member groups).
- **Task** — one routed round. Carries a task id, an idempotency fingerprint,
  and a receipt contract.
- **CLI identity** — a transient caller outside any session (the `a2a-net`
  command, 0.6.27+): its own Ed25519 key and a handle `<name>/<16 hex>`,
  deposited on ONE home host for up to 4h, with a mailbox instead of a
  wakeable session. See [cli.md](references/cli.md).

## Setting up

Start with [setup.md](references/setup.md). It is a checked path for three
network shapes:
- **one host**: install, join the sessions, give them a shared team;
- **two hosts that reach each other**: one shared `apiKey`, `announce` plus
  peers seeded both ways, and a canvas team naming both handles;
- **hosts that cannot reach each other**: host forwarding is not shipped
  yet (#57), so tunnel or delegate per hop.

The owner does the gestures (install, config, join, allowlist, canvas). The
agent prepares the exact config and verifies each step with `a2a_whoami`,
`a2a_probe`, `a2a_teams` and one round with a receipt.

## Routing (a2a_route)

```text
a2a_route { team: "<zone>/<id8 or canvas name>", message, context_id?, async? }
```

- `async: true` delivers without waiting (`delivered:true` + task id); the
  target routes a receipt — a message starting `[A2A receipt] task <id>` —
  back to your team.
- Sync (default) waits for the round's final answer. A target on this host
  gets up to 180s; past that the tool answers the delivered shape
  (`TASK_STATE_DELIVERED`) and the receipt contract carries the rest. A
  remote peer's delivery rides a 15s transport budget; if it fires first, the
  result is **-32005 DELIVERED-UNSETTLED**: the delivery landed and the peer
  keeps executing. Either way, **never re-dispatch blindly** — reconcile via
  the task id (the receipt, `a2a_status` activity, or `a2a_tasks`) instead.
- Model tools cannot route to the bare process team (`<zone>` alone, the
  host's own mailbox): target a session handle or a canvas team.
- `context_id` from a previous reply continues that conversation.

## Membership rules

- An unjoined session has NO network: `a2a_route` and `a2a_teams` refuse it
  (join gate), and discovery does not list it. The session that originates a
  task is exempt from the gate.
- Join through the GUI sidebar (A2A 网络) or the join gate prompt; leave
  through the same surface. Membership is visible; leaving removes you from
  discovery too.
- Inbound deliveries from a caller with no `caller_session` are refused
  (anonymous injection is a closed hole).

## Reading the state

`__dsh_a2a/state` (per node, key-gated like every control route) carries
`sessions` (live/joined, with their teams), `canvas` (canvas teams; remote
members show `remote: true`), `remote` (peer session rows with `origin` =
node label + LAN IP and `via` = the peer URL), `activity` (routing ring),
and the ledger: `tasks` (pending, each with `settleable`),
`tasksStaleCount`, `tasksDead`, and `archived` (newest 64 settled rows, each
with `outcome`, `endedBy` and `late`) plus `archivedCount` /
`archivedSplit`. `sessionTeams` is a card field, not a state field. The A2A
workbench (`/__dsh_a2a_nexus/`, merged responsive
shell since 0.6.2 — the 2D planning board is the stage, directory / ledger /
activity / plan ride a collapsible rail, narrow screens get a drawer)
renders the same data for humans.

## Failure shapes that are contract semantics

- `-32000` with "declares no team membership" — the admission gate working
  as designed; join (or route through a teamed member).
- `-32000` with "caller_session is required" — the delivery had no caller
  identity; the protocol contract requires it.
- `-32005` — sync wait budget fired; delivery landed, reconcile the task id.
- "No live DSH session node accepts team X" — no session node on the host
  that received the delivery accepted the round. Either the target session is
  not live/joined there, or X lives on ANOTHER host and the caller delivered
  straight to this host's `/a2a/direct` (the `a2a-net` CLI does this):
  direct delivery never relays to peers — `a2a_route` from a session does.
- `[PATTERN_NO_MINT]` / `[ALLOWLIST_DENY]` on `a2a_team_join` — only an EXACT
  allowlisted name joins; adding that name is the owner's act of creating
  the team. `[CANVAS_TEAM]` — canvas membership is assigned in the workbench,
  never by the roster tool.

## Details

- [setup.md](references/setup.md) — setup and checks: one host, two peers, beyond direct peers
- [routing.md](references/routing.md) — receipts, idempotency, ledger anatomy
- [discovery.md](references/discovery.md) — cards, peer boundary model, invisibility
- [membership.md](references/membership.md) — join/leave, allowlist, canvas teams
- [pitfalls.md](references/pitfalls.md) — operational pitfalls observed in production
- [cli.md](references/cli.md) — the `a2a-net` CLI: deposit, mailbox, inbox hooks, limits
- [collaboration.md](references/collaboration.md) — collaboration norm (Chinese): single-seat first, decide-then-report, release tiers, stuck gates, credentials, receipts
