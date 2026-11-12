# superagent: a root team whose workers are other teams

Status: **design, for the owner's review.** Not implemented. 2026-11-12.

- **Asked by the owner (2026-11-12):** with about ten superagent teams, a layer above them is needed to take work in and dispatch it to the teams. The owner's first idea was a root team with its own router, whose members are the routers of the teams.
- **What this document proposes instead:** a root team whose members are the teams themselves, reached by their canvas addresses. Each team's router stays in its own team and keeps judging what that team takes.

## Context

### What a team is today

- **The pieces.** A superagent team is a canvas team bound to a router. Every other session on the canvas is a member with one worker slot, and members may sit on other DSH instances (signed host to host). Several teams can run on one instance (`superagent-multi-team.md`).
- **One session, one team role** (M4, `[superagent-team-canvas]`). A team session sits in no other canvas. The host refuses to put a team's router on another canvas.
- **Roles are fixed by preset.**
  - The router only decides: accept, attach, ignore, stop. It names a member and may split a request into parts (`superagent-split.md`). It never does the work.
  - A member works its ticket and reports with `a2a_ticket_report`. It sends no A2A itself. A team asks another team only through an outbound request, one approved P0 card per message (`superagent-outbound-requests.md`).
- **A team is reachable at its canvas address** `<zone>/canvas/<name>`. A request there becomes a trigger the team's router judges.
- **What the team sends back to a requester** whose pinned card declares the capabilities:
  - an acknowledgement (`ack-<task>`);
  - progress steps with the tickets the request became (`progress-<task>-<n>`);
  - questions with fixed options (`attention-<task>-<id>`);
  - one formal result (`receipt-<task>`), whose `by` carries the seat, its `seatId` and its role;
  - a roster of its seats every 5 minutes.

  The workbench market already uses all of this as a requester.

### Why the routers cannot be the root's members

1. **The host refuses it.** A team's router would have to sit on the root's canvas too, and one session holds one team role.
2. **The roles contradict.** A router never does the work, while a member must work its ticket and report on it. A router holding a root ticket would have to turn it into its own team's request. It has no way to: no member sends A2A, except one approved card per message.
3. **One slot per member is wrong for a team.** The root's executor gives each member one ticket at a time, but a team has as many slots as members. The root would hold work back that the team could take.

### Is a root needed at all?

It depends on where work enters.

- **The workbench market as the entry.** The market already chooses the team: a person or a team lead picks it, with departments, teams and named seats (`superagent-named-dispatch.md`). A root there would repeat that choice, and add a second router judgement, with its delay and model cost, to every item.
- **When a root earns its place:**
  - work arrives at one entry (one A2A address, a GitHub repository, people asking in a chat) with nobody choosing the team;
  - one request often needs several teams, and someone has to split it, send the parts out and put the result together.

## Decisions

### R1. The root is an ordinary team with team members

- **Its own router and settings.** The root is a superagent team like any other: its own canvas, router, rules, dispatch rules and A2A address.
- **Its members are teams.** A root member is a team member ref: another team's canvas address, `<zone>/canvas/<name>@<fp8>`, pinned to its host's key.
  - The canvas accepts such a ref only on a team the owner marks as a root (`settings.root: true`).
  - Only the owner adds one, on the root host.
  - The child team's host must also admit the root (R5).
- **Slots.** A team member is not one slot. Its capacity is the child team's own (`slots`, default 3, owner-set). The root's executor counts open tickets per child team against it.
- **Choosing a child.** The root router names the child with `member`, as it names a member today. The child's description and rules come from the owner, as members' roles and rules do (D5/D6).
  - Each child's roster can be shown on the root router's card: its seats, how many are online, its load. That helps the router choose.
  - The roster is information only, and never decides on its own.

### R2. Dispatch to a child team is an A2A request from the root host

- **Who sends it.** When the root's executor gives a ticket to a team member, the host does not assign a session. It sends the child team a request at its canvas address. The sender is the root host's process face, the way the roster goes out, not the team's CLI identity, so the request carries a pinned, signed card.
- **What it carries.** The text is the ticket's title and scope, under one header line naming the root team and its ticket.
  - With `for:<seatId>` when the root names a seat in the child (named dispatch).
  - With `rework.of` when the root returns a child's result (R4).
- **No per-message card.** The owner registered the children, so dispatch to them is the root's normal work. The owner's approval is the registration itself (R5). Outbound requests to anyone else still need their card.
- **The child decides as it always does.** Its router judges the request against its rules and accept mode, names its member, and may split. The root never reaches inside a child.

### R3. What comes back maps onto the root ticket

The child's receipts arrive at the root host on the task it sent, and the root ticket follows them:

| From the child | On the root ticket |
|---|---|
| acknowledgement | the assignment is started; the child team holds it |
| progress (`queued/working/waiting/blocked`, `tickets`) | the root ticket's progress; its own progress to its requester lists the child and the child's tickets |
| question (`attention-…`, options) | becomes the root ticket's question to its requester, with the same options; the answer goes back to the child in the same conversation (light path) |
| result `completed` / `failed` / `dropped` | a `ready` / `failed` / `dropped` report on the root ticket, with the child's summary, `by` and `artifacts` |
| no answer (the child refused, was unreachable, or its receipt expired) | the assignment fails; the root router is told, and chooses another child or reports blocked |

- **Bookkeeping.** The host records task → root ticket, as outbound requests do (O4). Only receipts with a trusted proof count (O5).
- **One formal result to the requester.** A root ticket split across several children ends with one combined result, as a split ends today (S4). The parts are the children's tickets.

### R4. Rework and changes

- **Returning a child's result.** A root requester's rework return to the root becomes a new root ticket (`reworkReturns`). If the root sends it back to the same child, it carries `rework.of` = the child task that was returned, so the child also opens a new ticket for it.
- **Stopping.** Stopping a root ticket sends the child the existing cancel notice for that task.

### R5. Trust and boundaries

- **The root is a requester to each child, like the market.** On the child's host, the root host is a canvas remote member of the child's canvas (pinned key) and on the child team's bot list. Its card declares the capabilities it can take:
  - `progressReceipts`
  - `teamRoster`
  - `directedSeats`
  - `reworkReturns`

  This is the market's setup (`docs/ops/superagent-market-team.md`), done once per child by that child's owner. Root and children are usually the same owner.
- **Nothing new crosses a boundary.**
  - The root's sessions do not send A2A. The root host does, only to registered children, and only the ticket text.
  - Children answer through receipts. Credentials, tools and members stay each team's own.
- **Depth is one.** A child cannot be a root of the root, so dispatch cannot loop. The host refuses a team member ref that names a root, and refuses a root as a child of itself.

### R6. Entry points

- **Any entry works.** The root takes work wherever any team does: its A2A address, the workbench request box, GitHub issues (when on), and the owner's chat with its router.
- **The market can use either.** It can send to the root and let it choose, or keep sending straight to a team. The roster tells it which teams exist.

## Consequences

- **Ten teams look like one.** A requester sends to one address and gets acknowledgement, progress, questions and one result. The work goes to the team the root router chooses, or to several when the request asks for parts.
- **Each team keeps its autonomy.** Its router judges what it takes. Its rules, members, sandbox and credentials do not change.
- **Cost.** Every root ticket costs one more router judgement: the root's, before the child's. Work the market already sends to the right team should keep going straight there.
- **Not in this design:**
  - roots of roots;
  - moving a ticket between children while it runs (a redo goes through the root);
  - the root reading a child's tickets beyond what the child's receipts say;
  - load balancing beyond slots and the roster's load numbers.

## Points for the owner

1. **Is the entry problem real?** Is there, or will there be, work arriving with nobody choosing the team? If the market stays the entry, this can wait.
2. **Registering a child replaces per-message approval** for dispatch from the root to that child (R2). It is a standing permission, revocable by removing the child.
3. **Capacity per child** (`slots`, default 3) is owner-set rather than read from the child's roster. The roster may suggest it but never sets it.
4. **A child's question goes up to the root's requester** (R3), not to the root's owner. A question meant for the owner is still a decision card on the child's own page.

## Order and size (if approved)

1. **Root flag, team member refs on the canvas, the executor's team slots, and dispatch by A2A from the host face.** High tier; about 2 days.
2. **Receipts mapped onto root tickets** (acknowledgement, progress, questions, result, failure), and combined results for split roots. High tier; about 2 days.
3. **Child rosters on the root router's card, rework and stop forwarding, and the team page for a root.** Mid tier; about 1.5 days.
4. **Live check** on the test host with two child teams on the same instance, then with one on another instance.
