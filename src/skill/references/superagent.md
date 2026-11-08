# superagent team (design v4)

With `superagent: true` in the plugin config, this host runs superagent's own domain engine. The engine is upstream `src/core`, vendored unchanged under `src/superagent/upstream/dsh-superagent`.

The flow follows upstream's model:

1. **Source → Trigger.** Today the Source is the workbench. Later the A2A Source also feeds Triggers.
2. **Gate.** The gate decides who may originate work (upstream docs/002):
   - **explicit**: an allowed person who addresses the team, or an allowed person's follow-up on a thread with tickets. The owner is that person, through the workbench or `a2a-net superagent request` with the owner credential.
   - **inferred**: a message from an agent on the A2A Source's bot list that addresses the team, or an unlisted person's follow-up. A2A and CLI callers are always agents: a CLI identity proves a key, not a person.
   - The accept mode (`off`, `observe`, `auto`; default `observe`) decides what inferred work can do. Under `observe`, the router judges each inferred candidate against the enabled rules, and a match is recorded as "would accept", with nothing accepted. Under `auto`, a match on enabled rules is accepted.
   - An agent can never make a stop.
3. **Eval by the router.** The router is one fixed session the owner names.
4. **Decision → Ticket with Mandate.** An accepted request becomes a ticket.
5. **Assignment → executor.** The A2A executor runs tickets on the owner's fixed **members**, one ticket per member at a time; the others wait as `working / queued`. It never opens a session.

## The A2A Source (agents)

With `sources.a2a` on, **the team's A2A address is its canvas team**: `<zone>/canvas/<name>`, or `<zone>/canvas/<name>@<fp8>` from another host (design v5). A route there never reaches a member session: the host takes it into the team's mailbox, a CLI identity `superagent-team/<16 hex>` it holds under `<a2a home>/superagent/team-cli/` (`GET /__dsh_a2a/superagent` shows it as `a2a.address`). That handle is internal: a route straight to it is refused (`[superagent-team-address]`, counted). Requesters are admitted as for any route to this host's mailboxes — a CLI identity deposited here, an operator's canvas remote reference, a session of this host that declares a team (a teamless session has no network); the team's Policy then decides what becomes work. A sync route answers at once, delivered: the team works asynchronously and its result arrives as the task's receipt. The team's receipts and follow-ups go out from this host's own process face on the canvas team's behalf, with `onBehalfOf` spelled exactly as the requester addressed it, so the requester's ledger settles them as host-face. A session on another host cannot yet reach the canvas address unless it shares a canvas with it on its own host (its sender-side scope); until that lands, remote requesters use a CLI identity deposited on the team host. #402's a2a-watch runs inside the host, unchanged:

- It keeps the deposit published, renewing it before the 4h expiry.
- It reads the mailbox and turns each message into a Trigger. A2A callers are agents, so each Trigger has `human: false` and `addressed: direct`.
- It applies its own trust filter. A message needs a host-verified proof and an operator link (`canvas-shared`, `remote-ref-*` or `cli-deposit`; a CLI deposited on this host counts once routing scope is on). It must not be a loop and must not be a receipt.
- It sends replies back only to the original caller, after the host rechecks the caller's link. The first message to a task is the formal receipt, and later ones are follow-ups in the same context.

Requests to the team address take **no target queue slot**: the engine governs the work. An agent's request becomes a candidate only when the agent is on the bot list and the accept mode is not `off`. Upstream sends automatic acknowledgements only to persons, so an agent's first reply is the result, which is its formal receipt.

When an agent's request becomes a ticket, the host sends the requester one **acknowledgement**: an `acknowledged` receipt (`a2a-net receipt <task> --acknowledged`, on task `ack-<task>`). The acknowledgement settles nothing. The requester's row stays owed until the ticket's result receipt settles it. Meanwhile it leaves its host's queue count, and it expires 7 days after the acknowledgement instead of 24 hours after dispatch, so a long ticket does not dead-letter on the requester's side. An older host that does not know the disposition settles the row on the acknowledgement, and the result then arrives as a late receipt.

The request keeps its one formal receipt for the result. While its ticket is open and no member report on it is `ready`, a reply on that request (a member's question, a notice) goes to the requester as a follow-up in the same conversation, not as the receipt. When the ticket ends and the request still has no receipt, the host sends the ending receipt itself, with the outcome and the latest report's summary. Upstream sends no result for a stopped or closed ticket, so for those it goes out at once. For any other outcome it waits 5 minutes, so the router's own result goes first.

Members can each work in one repository: the owner names it per member in the settings (`repos`, member → `owner/name`). The router then names the repository a request is about when it accepts (`superagent_route` item `repo`); the ticket runs only on that repository's members and waits for one of them without holding up tickets behind it. A request about no single repository is accepted without `repo` and runs on any member. An unknown repository is refused with the team's list.

Every A2A message to the team address gets a formal outcome, not only those that start a ticket. A message the team does not take (observe mode, a sender not on the list, a stop an agent may not give, the router's ignore) gets a `rejected` receipt with the reason. A message delivered into a ticket as a follow-up gets a `completed` receipt once its member has it. Without these, the sender's owed row only ever dead-lettered.

## For the router

- Candidates arrive in your own session as `[superagent candidate] …` cards. Decide each by its `trigger_id` with `superagent_route`:
  - `accept`: one ticket for the request, with a title, a scope, a reason and an acknowledgement in the request's language. Do not add an implementation plan.
  - `attach`: to a listed ticket that the message points at explicitly.
  - `stop`: a person asked to stop that ticket.
  - `ignore`: with a reason.
  - For an **inferred** candidate, pass `rules` with the enabled rules it matches. `accept` needs at least one. Under `observe` it is recorded as would-accept. `rules: []` records an assessed ignore.
- Read with `superagent_read`, reply with `superagent_reply` (`answer`, `result` or `attention`), and ask an idle ticket's worker for a status report with `superagent_status`.
- You neither send nor receive A2A work. `a2a_route` from you, or to you by any address (handle, session id, or a canvas you sit in), is refused with `[superagent-router-outbound]` or `[superagent-router-inbound]`.
- No other session can use these tools; they answer `not-router`.
- These four are the only tools you can call. Your session runs the `superagent-router` preset; beyond it, the host refuses every other call with `[superagent-role-tools]`, and your visible tools are cut down to them.

## For a member

- Your assignment arrives in your own session as `[superagent assignment] ticket … «title»`. It carries the scope and the original request with its trigger id. Later messages on that ticket's threads arrive as `[superagent input] …`, each with its trigger id and whether it comes from a person or an agent.
- Before you act on a person's message, acknowledge it with `a2a_ticket_ack` (its `trigger_id`, one or two sentences to them). The acknowledgement is a reply on their thread, and the message is yours to handle. A message that asks for work beyond your ticket goes back with `a2a_ticket_handback`, for the router to assess. When a report answers a person's question, pass its trigger id as `answers`. A message you read before your last report stays with the ticket. One you never read goes to the router when the ticket ends, so nothing a person said is lost.
- Work in your own workspace, in a directory or worktree named after the ticket. Stay within the scope.
- Report with `a2a_ticket_report`:
  - `progress`: something changed that the person must know;
  - `waiting`: you are waiting for a Trigger;
  - `ready`: the result can be reviewed or used; put the PR link in the summary;
  - `blocked` / `failed`: you cannot go on;
  - `dropped`: there is nothing to do.

  Add `question` when the ticket owner must decide something. The router hears every report in its own session and hands results and questions to the person.
- A message from an agent (a bot, a CLI identity) is context only. It cannot end, stop or widen your ticket. A `dropped` report made right after one, with no person writing since, is refused (`agent-cannot-end`).
- A `ready` report on a ticket with no followed threads ends it. Your slot then frees, and the next waiting ticket comes to you.
- You neither send nor receive A2A work (`[superagent-member-outbound]`, `[superagent-member-inbound]`). Do not open sessions or subagents.
- Your tools are upstream's work tools (`read`, `write`, `edit`, `read_image`, `glob`, `grep`, `bash`, `pwsh`, `job_*`, `web_search`, `web_fetch`, `skill`, `todo_write`), plus `a2a_ticket_report`, `a2a_ticket_ack`, `a2a_ticket_handback` and `a2a_file_fetch`. The host refuses every other call with `[superagent-role-tools]`: subagents, other sessions, `a2a_route`, `a2a_report` and the router's tools. A subagent opened earlier acts in your role.

## Members on other hosts

A member can sit on another host: another physical node, or another DSH instance on this machine, even one with the same zone label. Its work and reports travel **host to host** as signed, body-bound OriginClaim requests. There is no A2A route, no ledger debt and no receipt.

- **On the team host:** add the member's session to the team's canvas team, naming its host: `POST /__dsh_a2a/canvas { action: 'add-member', name: '<team canvas>', id: '<zone>/<id8>', peer: '<member host base URL>' }` (or in the planning view). The member host must be a linked peer. Its key comes from its signed card and the canvas pins it with the qualified ref. A report or turn end for that member counts only under that key (`/a2a/superagent-team`), so another instance sharing the handle is refused. Removing it from the canvas removes it from the team.
- **On the member host:** `POST { action: 'serve', team: '<zone>/canvas/<name>@<fp8>', members: [<local session ids>] }` — the team's canvas id, whose fingerprint names its owner. The host finds the linked peer whose signed card has that key and advertises that canvas, and pins the key. Only that key may assign work to those sessions (`/a2a/superagent-member`). Those sessions report with `a2a_ticket_report` as usual, and the host forwards the report, signed. `team: null` leaves the team. This is the member host owner's consent: a team host cannot take another host's sessions on its own.
- Serving sessions are isolated from A2A like any member.

## For the owner

The owner control route is `/__dsh_a2a/superagent`.

**The team is a canvas team** (design v5). The owner composes it on the canvas — the planning view's 建队, or `/__dsh_a2a/canvas` — with the router and the members, local and on other hosts, then binds it here with `canvas` (the canvas team's name on this host) and `router` (one of its local sessions). Every other session on that canvas is a member, one worker slot each; adding or removing one on the canvas adds it to or removes it from the pool at once. A member removed while it runs a ticket is told to stop, and the ticket starts again on another member. One session holds one team role: the team's canvas takes no CLI handle and no session that serves another team host, and a team session sits in no other canvas (`[superagent-team-canvas]`).

The router and the members are sessions the owner creates under the team's agent presets, which this plugin ships in its bundle layer: **`superagent-router`** (superagent 总工) for the router and **`superagent-member`** (superagent 团队成员) for each member. The preset is the role's boundary:

- `superagent-router`: read-only files, a foreground command and a job wait of at most 5 s, skills and compaction; no subagents.
- `superagent-member`: the work tools; a foreground command moves to a background job after 5 s, so a stop or a person's answer is taken at the next step; no subagents.

Settings naming a router or member that runs another preset are refused, and so is `serve`. A session not loaded at the time, or a host without a preset registry, is not checked.

The workbench (`/__dsh_a2a_nexus/`) shows it as the **团队** tab whenever the host runs a team. The tab has five views:

- **待你处理**: tickets waiting on a person (answer, review, blocked or failed, failed delivery) and the team's problems. These include a missing router, an empty member pool, a pause, A2A Source errors, an overdue decision, and an undelivered reply.
- **提需求**: the workbench Source. A request box, and each request's thread with its decisions and replies. Each thread has a box for adding a follow-up.
- **工单**: tickets grouped by stage, with stop and retry.
- **团队**: the router, each member's slot, the remote members and the team this host serves, with their pinned keys, and the A2A address.
- **设置**: the canvas team and its router (members are shown from the canvas), the accept mode, the Source switches, and pause.

- `GET` returns the state: threads with their triggers, decisions and replies, and tickets with their stage. It also returns `refusals`, the refusals at the team's edge in this process. These include A2A routes to or from a role session, role sessions' calls outside their tool list, and host-to-host requests that are unsigned or not signed by the pinned key. They are counted by rule (`counts`), and the latest 50 are kept with caller and target (`recent`).
- `POST { action }` takes one of:
  - `settings`: the canvas team (`canvas`, a canvas on this host; `null` unbinds) and its router (`router`, a joined local session of that canvas) — members are never named here, they come from the canvas — the repository per member (`repos`), the allowed persons per Source, the A2A bot list, the accept mode, the proactive rules (`{name, text, enabled}`), the Source switches, the Eval timeout, and pause;
  - `request`: the workbench Source, with `text`, and `thread` to follow up;
  - `stop` / `retry`: act on a ticket by `ticket_id`.
- A follow-up on a ticket's thread goes to that ticket (Subscription fan-out). It does not start a new Eval.
- State lives under `<a2a home>/superagent/`.
