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

### R7. On the canvas: the data and the operations

- **The canvas holds the hierarchy.** A root is a canvas team flagged `root: true` in the canvas store, with no separate registry. Its children are canvas members of a third kind, team refs (`<zone>/canvas/<name>@<fp8>`), next to local sessions and remote session refs.
  - A team ref is confirmed the way a remote session ref is: the child host's signed card advertises that canvas in `canvasOrg`, under the pinned key.
  - It shows `confirmed-remote` / `unconfirmed` as remote members do today.
- **Operations on the owner's canvas route** (`POST /__dsh_a2a/canvas`), each with the store's revision check:
  - `set-root {name, root}`;
  - `add-team {name, team}` and `remove-team {name, team}`;
  - `set-team-slots {name, team, slots}`.

  Mirrors of a remote root are edited through the existing fleet relay, as other mirrored edits are.
- **Both sides in one step where the owner owns both.** `add-team` checks the child side: is the root registered on the child's canvas (remote member, bot list, capabilities, R5)?
  - When the child team is on this host, or on a linked host whose card has the same owner key, the host does the child side too: it adds the root as a remote member of the child's canvas and puts it on the child's bot list, through the fleet relay.
  - When the owner keys differ, the child side is left to the child's owner. The child shows as 「待子团队登记」 until its card says the root is admitted.
- **Removing.** Removing a child, or turning a root back into a plain team, never touches the child's own team. Open root tickets on that child are told to stop (R4), and the child's side registration stays until its owner removes it.

### R8. On the canvas: the board, made quick to use

The planning board is where the owner builds teams today: 建队 from a selection, dragging sessions into frames, mirrors of other hosts' teams. The root uses the same gestures, with the team frame as the unit:

- **Making a root.**
  - Select two or more team frames (local or mirrored) and press 建队 (G). The board offers 「组成 root 团队」: it creates a root frame, asks for its router (a free local session, picked in the same picker as today), and adds the selected teams as its children.
  - On a single team frame, the menu has 「设为 root 团队」.
- **Adding and removing a child.**
  - Drag a team frame onto a root frame. While dragging, the root frame shows a drop preview: 「加入为子团队」, or the reason it cannot, such as 「这是一个 root」 or 「已是子团队」.
  - The frame menu has 「加入 root…」 with the roots listed.
  - Dragging a child chip out of the root, or 「移出 root」, removes it after a one-line confirmation. As with membership changes today, it is not on the layout undo stack.
- **What a root frame shows.** A child appears as a compact chip, not as its sessions:
  - its name and host;
  - its router;
  - seats online out of total;
  - open root tickets out of `slots`, with a small stepper to change `slots` in place;
  - the age of its last roster.

  A click opens the chip into the child's seats from its roster, read-only; a double click focuses the child's own frame. One status badge per child: 已就绪 / 待子团队登记 / 不可达 / 满载.
- **Work in flight.** An edge runs from the root router to each child carrying root tickets, labelled with their count. Hovering lists them, and a click opens the root's 工单 tab filtered to that child.
- **Errors where they happen.** Every refusal of a canvas operation shows on the frame it concerns, in words, with the next step: 「子团队宿主未互加 seed」, 「子团队所有者不同：请对方在其画布上登记本 root」. A refusal never appears only in a toast or the console.
- **Size and modules.** `planning-view.ts` is at its line cap (1500 of 1507, frontend verifier M1). The root UI goes into new modules (`planning-root.ts` for the frame, chips and badges; `planning-root-drop.ts` for drag and drop), and `planning-view.ts` gets only the hooks. If even the hooks do not fit, a block is moved out first in its own PR.

### R9. An SDK, for the market and for owner tools

- **Why two parts.** The market holds no node credential and changes nothing on a node directly (the boundary in `superagent-staffing-changes.md`). So the SDK has two parts with different trust, and the market gets only the first.
- **`@nelsonlongxiang/dsh-open-a2a-net/sdk/wire`: for any requester, the market included.** Pure functions and types, with no network and no credentials:
  - `formatDispatch({ for?, rework? }, text)` and `parseDispatch` (the `[A2A dispatch]` line);
  - `parseReceipt` and the envelope types (`by` with `seatId`, `artifacts`, `question`, `progress`, `tickets`), plus the task id helpers (`ack-` / `progress-` / `attention-` / `receipt-`);
  - `parseRoster(text)` returning typed seats `{ seat, seatId, name, team, role, online, active, queued }`;
  - the capability names (`progressReceipts`, `teamRoster`, `directedSeats`, `reworkReturns`) and a helper that reads them from a verified card;
  - for a root, the same: the market sends to the root's address and reads the root's receipts, whose `tickets` name the children.
- **`@nelsonlongxiang/dsh-open-a2a-net/sdk/owner`: for the node's owner, with the owner's API key.** A typed client for the control routes:
  - `canvas.*`: create, add or remove members, `setRoot`, `addTeam`, `setTeamSlots`;
  - `superagent.*`: list teams, add a team, read state, settings, `moveSeat`;
  - the node's state and roster reads.

  Uses: the nexus board (which hand-writes these fetches today, and would then share one implementation), the owner's scripts, and on the node the executor of staffing changes. It is never given to the market.
- **Contract.**
  - Both parts are exported from the package and versioned with it. Their shapes are pinned by tests.
  - A breaking change waits for a minor version and is called out in the release notes.
  - `docs/sdk.md` gives worked examples: the market building a named dispatch and reading a roster; an owner script making a root and adding two children.
- **The wire part is useful before any root exists.** The market writes dispatch lines and reads rosters and receipts today, by hand. The SDK's wire part can ship first.

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
5. **Registering the child side automatically when the owner owns both hosts** (R7). Otherwise each child's owner registers the root by hand.
6. **The SDK split** (R9): the market gets only the wire part, never the owner part. This matches the staffing-change boundary.

## Order and size (if approved)

0. **SDK wire part.** `sdk/wire` with its tests and `docs/sdk.md`, useful to the market now and independent of the root. Mid tier; about 1 day.
1. **Canvas model and operations** (R7): root flag, team refs, `slots`, child-side registration for same-owner hosts. Plus `sdk/owner` for them. High tier; about 2 days.
2. **Root dispatch and receipts** (R2, R3, R4): the executor's team slots, the A2A send from the host face, the child's acknowledgement / progress / question / result / failure mapped onto root tickets, and combined results. High tier; about 2.5 days.
3. **The board** (R8): root frames, child chips with roster and capacity, drag and drop, menus, in-flight edges, refusals on the frame; nexus switched to `sdk/owner`. Mid tier; about 2 days, plus a module move first if `planning-view.ts` needs room.
4. **Live check** on the test host with two child teams on the same instance, then one on another instance, then the market sending to the root.
