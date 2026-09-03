---
name: a2a-network
description: Use when a task needs cross-session or cross-node collaboration over the DSH A2A network — joining and teaming, routing work to remote teams and agents, reconciling receipts and the task ledger, and reading the plan/nexus views. Covers admission rules, the receipt contract, and the failure shapes that look like bugs but are contract semantics.
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

## Routing (a2a_route)

```text
a2a_route { team: "<zone>/<id8 or canvas name>", message, context_id?, async? }
```

- `async: true` delivers without waiting (`delivered:true` + task id); the
  target routes a receipt — a message starting `[A2A receipt] task <id>` —
  back to your team.
- Sync (default) waits for the round's final answer. If the 15s transport
  budget fires first, the result is **-32005 DELIVERED-UNSETTLED**: the
  delivery landed and the peer keeps executing. **Never re-dispatch blindly**
  — reconcile via the task id (the receipt or `a2a_teams` coordinates) instead.
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

`__dsh_a2a/state` (per node) carries `sessions` (live/joined), `sessionTeams`,
`remote` (peer session rows with `origin` = node label + LAN IP and `via` =
the peer URL), `activity` (routing ring), `tasks` (the ledger: pending /
stale / archived). The nexus `?mode=plan` view renders the same data as the
planning canvas.

## Failure shapes that are contract semantics

- `-32000` with "declares no team membership" — the admission gate working
  as designed; join (or route through a teamed member).
- `-32000` with "caller_session is required" — the delivery had no caller
  identity; the protocol contract requires it.
- `-32005` — sync wait budget fired; delivery landed, reconcile the task id.
- "No live DSH session node accepts team X" — the team resolved but no
  session node accepted the round; check whether the target session is live.

## Details

- [routing.md](references/routing.md) — receipts, idempotency, ledger anatomy
- [discovery.md](references/discovery.md) — cards, peer boundary model, invisibility
- [membership.md](references/membership.md) — join/leave, allowlist, canvas teams
- [pitfalls.md](references/pitfalls.md) — operational pitfalls observed in production
