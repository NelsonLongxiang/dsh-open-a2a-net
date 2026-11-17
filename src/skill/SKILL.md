---
name: a2a-network
description: Use when a task needs cross-session or cross-node collaboration over the DSH A2A network — setting it up (install, config, apiKey, peers, canvas links for one host, two peers, or hosts that cannot reach each other), joining and teaming, routing work to remote teams and agents, reconciling receipts and the task ledger, and reading the A2A workbench (/__dsh_a2a_nexus/). Covers admission rules, the receipt contract, superagent router communication (same-team remote members, controlled outbound requests and registered child teams), and the failure shapes that look like bugs but are contract semantics.
---

# DSH A2A Network

Use ordinary A2A for bounded session-to-session collaboration. Use a
**superagent team** when work needs a stable intake policy, a fixed router and
member pool, durable tickets, dispatch, progress and result follow-up. It is a
canvas bound to that engine, not every canvas or peer connection. The same
plugin (`@nelsonlongxiang/dsh-open-a2a-net`) provides both; they have different
role and communication boundaries.

## Choose the communication path first

First identify your actual host role and the relationship, not merely the other machine or its display name. The generic cross-project coordinator in `references/router.md` is **not** the `superagent-router` preset.

| Need / relationship | Entry and responsibility |
|---|---|
| Ordinary sessions collaborate | An authorized non-team caller uses ordinary A2A discovery, `a2a_route` and its task receipt. |
| A person or external agent asks a superagent team for work | Use the team workbench, or its qualified canvas address for A2A; Source → gate/policy → router → ticket. Reaching the address does not mean acceptance. |
| A worker belongs to the same superagent team but runs remotely | Verify both team-side membership and member-host `serve`; the host assigns and forwards `a2a_ticket_report`, not an outbound card or ordinary member-to-member route. |
| A ticket needs an external team or ordinary seat | `a2a_outbound_request` → P0 decision by owner/designated approver → host sends exact approved text → trusted receipt becomes a note on that ticket. The receiver retains its own admission and intake policy. |
| A root assigns an already registered child team | Select that child as `member`; the host maps the child request and result to the root ticket. Registration is the standing permission for this path, not for arbitrary external targets. |

**Host-managed CLI is transport, not a session permission.** A team may send through its dedicated `superagent-team/<16 hex>` CLI mailbox identity. A router/member must not create or borrow a CLI identity, use shell/HTTP, or impersonate a person to bypass team tools, approval or admission. A CLI key proves an agent identity, not owner consent. A peer/canvas link alone is not remote-member `serve` or root/child registration.

Core decisions are inline in the generated role personas because the router need not have `read` or `skill`. Read [the communication guide](references/superagent-communication.md) for scenarios and [superagent.md](references/superagent.md) for setup and role details. Missing role tools stop that operation; do not apply the ordinary routing example below to a restricted team session.

## Objects

- **Node** — one DSH host process exposing `/.well-known/agent-card.json` and
  the `__dsh_a2a/state` face. Peers discover each other through cards.
- **Session node** — a DSH session. Joining provides network presence and
  inbound routability; an unjoined session is not advertised to peers. The
  originating face exception is described below and does not override roles
  or receiver admission.
- **Address and team** — a session handle is `<zone>/<id8>`; a canvas address
  is `<zone>/canvas/<name>` (qualified by `@<fp8>` across owners). A plain canvas
  is a routing group. A superagent canvas is bound to a router, member pool and
  ticket engine; those sessions have team-specific role restrictions.
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
- **hosts that cannot reach each other**: an online CLI deposited on a home
  host gets one-hop forwarding (shipped 0.6.34, on by default from 0.6.38 via
  `forwardDirect`, links required on both sides); sessions still tunnel or
  delegate per hop. See setup.md §3.

The owner does the gestures (install, config, join, allowlist, canvas). The
agent prepares the exact config and verifies each step with `a2a_whoami`,
`a2a_probe`, `a2a_teams` and one round with a receipt.

## Idle reconciliation reminders

A sourced `[A2A reconciliation reminder]` lists **existing** tasks you still owe. It is not a task, receipt, or acknowledgement, and does not release queue capacity. Reconcile each original task yourself; do not reply to the reminder as a new task or fake completion to clear a queue. Busy sessions are skipped; idle reminders persist and back off without exhausting. See [routing.md](references/routing.md#idle-reconciliation-reminders-351-sourced-followup).

## Routing (a2a_route)

This is for ordinary authorized callers, not a superagent router/member
sending work itself. An external caller may address a superagent canvas,
but the host and team policy decide whether a ticket is created.

```text
a2a_route { team: "<zone>/<id8 or canvas name>", message, context_id?, async? }
```

- Tasks use sourced `Agent.followup` (one task per next turn), not human queue prompts. Missing capability fails explicitly. Unclaimed cancellation removes the queued MessageId; claimed cancellation still uses immediate sourced steer. `consumed:false` / `delivered-unconsumed` is visible debt, not acknowledgement or completion; do not resend blindly.
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

- Join provides presence and makes a session discoverable/routable. The
  originating face is exempt from outbound join admission; that exception
  does not grant team-role tools, receiver admission or acceptance of work.
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
  direct delivery is not relayed, except the one-hop forward for an
  authenticated online CLI deposited on that home (`forwardDirect`, links on
  both sides; setup.md §3) — `a2a_route` from a session routes to peers itself.
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
- [collaboration.md](references/collaboration.md) — collaboration norm (Chinese): single-seat first, decide-then-report with no pre-authorization (a high-tier change needs one non-self node's review PASS on the same SHA), release tiers, stuck gates, credentials, receipts
- [intake.md](references/intake.md) — intake node (Chinese): handling `workbench-event` deliveries from workbench-market — accept/decline/ask with a reason, open a GitHub issue on accept, write the decision back with the reply token
- [router.md](references/router.md) — generic cross-project coordination router, not the `superagent-router` preset; owner-controlled immutable layer
- [superagent-communication.md](references/superagent-communication.md) — router communication decision guide: external requesters, signed remote-member work, approved outbound requests and registered child teams
- [superagent.md](references/superagent.md) — the superagent team (design v4, on by default): workbench Source, gate, the router's superagent_* tools and its A2A isolation, the owner control route
