# superagent ↔ market: progress, sub-tickets, the light path, and the roster

Status: agreed with the workbench market on 2026-11-11; P1, P2 and P3 implemented (its items N2a, N2b, the "light path" of its chat design, and N3). This builds on [receipt-envelope-fields](receipt-envelope-fields.md) (`by`, `artifacts`, `question`, the `attention-<task>-<id>` question) and on the node-side checklist [superagent-market-team](../ops/superagent-market-team.md).

The market's goal: people use only the market, and the nodes work headless. The market therefore needs to see:

- what a team is doing between the acknowledgement and the result;
- how the router split the work;
- which AI staff each node has and how loaded they are.

It also needs a conversation with a seat that does not cost a router judgement per sentence.

## Context

- **A ticket is silent until its result.** A requester sees `ack-<task>`, perhaps a question, then `receipt-<task>`. A member's `progress` reports, the router's assignment and the queue stay inside the host.
- **Every bot message is judged by the router.** In the engine's intake, a message from an agent caller (`human: false`, which is every A2A caller including the market) that reaches an open ticket is added to the ticket as an input. It is also queued for the router's judgement. So each sentence of a conversation costs a member turn plus a router turn, and the router may set aside what the member already took (the case fixed in #601).
- **Nobody outside a host sees its roster.** The market will not hold each host's control credential to read `/__dsh_a2a/state`.

## Decisions

### P1. Progress is a receipt-form message that settles nothing

- **Task id and header.** It rides task id `progress-<task>-<n>` (`n` counts from 1 per task, and the host keeps the counter) under the header `[A2A receipt] task <task> <one line>`, like `ack-` and `attention-`.
- **Envelope.**

  ```json
  {"idempotencyKey":"<task>","onBehalfOf":"<canvas address>","disposition":"progress",
   "by":{"seat":"…","name":"…"},
   "progress":{"n":3,"state":"working","summary":"…","at":"<ISO>"},
   "tickets":[{"id":"…","title":"…","seat":"…","state":"queued|working|waiting|blocked|ended","outcome":"…"}]}
  ```

  - `progress.state` is one of `queued` (waiting for a member, with `ahead`, the number of tickets before it), `working`, `waiting` (on a person or on a pull request), and `blocked`.
  - `tickets` lists the tickets the request became or was fanned into: what the router split and to whom (N2b), at most 16.
- **On the receiving ledger,** a `progress` receipt marks the owed row exactly as an acknowledgement does, and settles nothing. The row's acknowledged TTL restarts, so a long ticket that keeps reporting never dead-letters on the requester's side.
- **When it is sent.** In each case only while the request has no formal receipt:
  - a member takes the ticket up: `working`, with `by`;
  - the ticket waits for a member: `queued`, with `ahead`;
  - a member's report changes state or summary (`progress`, `waiting`, `blocked`);
  - a ticket the request fanned into changes its member or state.
- **Rate.** At most one per task per minute. Repeated same-state reports within 10 minutes are folded into the next change. A state change to `blocked` goes out at once.
- **Gated by capability.** A receiver that predates `progress` would drop the unknown disposition and settle the row on it. So the host sends progress only to a caller whose verified card declares `capabilities.progressReceipts: true`. The market declares it; a CLI identity never gets one.
- **Team setting.** `progress` is on by default and off for the whole team with one switch.

### P2. The light path: a message in an open ticket's own conversation from the caller it serves is decided

- **What is skipped.** An agent caller's message is not queued for the router when all of these hold:
  - it reaches a live ticket through that ticket's own thread, not a context-only thread;
  - the caller is the one the ticket was accepted from;
  - the caller is linked (a pinned remote canvas member, `canvas-shared` or `cli-deposit`).
- **What stays the same.** The member gets the message as an input as before, and the message's formal receipt is the ticket's ending receipt (#601).
- **Where it changes.** In the host, not the vendored engine (which stays byte for byte its pinned upstream). The engine's `trigger.received` event calls the host inside the intake's unit of work. For such a message the host makes the router's own `attach` to that ticket: the message leaves the router's queue before any pass can hand it over, and is recorded as routed to the ticket.
- **What still goes to the router:**
  - messages from other callers into the same conversation;
  - a message that reaches only an ended ticket;
  - any message that reaches no ticket.

This is also what a market conversation needs (a conversation is a conversation ticket). After the first sentence, each sentence costs one member turn.

### P3. The roster report

Each host with a superagent team reports its seats to every **canvas remote member whose verified card declares `capabilities.teamRoster: true`**. It needs no configuration, and the host keeps no other address.

- **Form.** A plain direct message the sender books as fire-and-forget (`receiptExpected: false`: no debt, no queue slot, no receipt owed), on task id `roster-<host fp8>-<epoch ms>`. Text:

  ```text
  [A2A roster] <host fp8> <ISO time>
  {"host":"<host card key fingerprint>","at":"<ISO>","seats":[
    {"seat":"<zone>/<id8>","name":"…","team":"<zone>/canvas/<name>","role":"router|member|observer",
     "online":true,"active":1,"queued":2,"lastActiveAt":"<ISO>"}]}
  ```

  - `seat` is the seat's A2A handle, the same id `by` uses.
  - `active` is the tickets the seat holds now; `queued` is the tickets waiting for it.
- **When.** Every 5 minutes, and 30 seconds after a change: a seat joins or leaves, goes on or off line, or its load changes. Each report is a full snapshot, not a diff.
- **What it is trusted for.** The market accepts it only from a registered peer, only with Sig3, and only for seats the signing host serves. It is information for people, never authority: nothing a node reports can grant itself work.

### P4. Order

- **First PR: P1 and P2.** Mid tier: receipt semantics plus the host's light path.
- **Then P3.** Mid tier: a new outbound message and a timer.

Each needs a non-self review PASS. The market's side follows the shapes above; field names are fixed here.

## Consequences

- **The requester's view.** A requester that declares `progressReceipts` sees the work move, and a long ticket never expires on its side. One that does not sees exactly what it sees today.
- **The router's view.** The router no longer sees the requester's own messages inside an open ticket's conversation. It sees them only if the member hands them back. A requester that wants the router to re-judge opens a new conversation.
- **Roster load.** The roster is one small message per host every 5 minutes per market. Seats are named by handles that change when a member session is replaced; the next report carries the new mapping.
- **Deferred:**
  - the speaker and `for: <seat>` (B);
  - streaming status and tool events (C);
  - token streaming (D);
  - a member's `artifacts` (it comes with P1's report field, or later).
