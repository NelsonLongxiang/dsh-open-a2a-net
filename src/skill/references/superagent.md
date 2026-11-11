# superagent team (design v4)

Unless the plugin config says `superagent: false`, this host runs superagent's own domain engine, idle until a team is bound. Sessions outside a team are not offered the team's tools. The engine is upstream `src/core`, vendored unchanged under `src/superagent/upstream/dsh-superagent`.

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

With `sources.a2a` on, **the team's A2A address is its canvas team**: `<zone>/canvas/<name>`, or `<zone>/canvas/<name>@<fp8>` from another host (design v5). A route there never reaches a member session: the host takes it into the team's mailbox, a CLI identity `superagent-team/<16 hex>` it holds under `<a2a home>/superagent/team-cli/` (`GET /__dsh_a2a/superagent` shows it as `a2a.address`). That handle is internal: a route straight to it is refused (`[superagent-team-address]`, counted). Requesters are admitted as for any route to this host's mailboxes — a CLI identity deposited here, an operator's canvas remote reference, a session of this host that declares a team (a teamless session has no network); the team's Policy then decides what becomes work. A sync route answers at once, delivered: the team works asynchronously and its result arrives as the task's receipt. The team's receipts and follow-ups go out from this host's own process face on the canvas team's behalf, with `onBehalfOf` spelled exactly as the requester addressed it, so the requester's ledger settles them as host-face. The team host's card marks the bound canvas as its superagent team (`canvasOrg[].superagentTeam`), so a session on another host that declares a team of its own may route there without a seat on it; the team host still admits it only through an operator link (the owner adds it as a canvas remote reference), and the team's receipt lands on the requester's host as the answer to that one request — its sender, its canvas, the peer key and process label the request was born on. #402's a2a-watch runs inside the host, unchanged:

- It keeps the deposit published, renewing it before the 4h expiry.
- It reads the mailbox and turns each message into a Trigger. A2A callers are agents, so each Trigger has `human: false` and `addressed: direct`.
- It applies its own trust filter. A message needs a host-verified proof and an operator link (`canvas-shared`, `remote-ref-*` or `cli-deposit`; a CLI deposited on this host counts once routing scope is on). It must not be a loop and must not be a receipt.
- It sends replies back only to the original caller, after the host rechecks the caller's link. The first message to a task is the formal receipt, and later ones are follow-ups in the same context.

Requests to the team address take **no target queue slot**: the engine governs the work. An agent's request becomes a candidate only when the agent is on the bot list and the accept mode is not `off`. Upstream sends automatic acknowledgements only to persons, so an agent's first reply is the result, which is its formal receipt.

When an agent's request becomes a ticket, the host sends the requester one **acknowledgement**: an `acknowledged` receipt (`a2a-net receipt <task> --acknowledged`, on task `ack-<task>`). The acknowledgement settles nothing. The requester's row stays owed until the ticket's result receipt settles it. Meanwhile it leaves its host's queue count, and it expires 7 days after the acknowledgement instead of 24 hours after dispatch, so a long ticket does not dead-letter on the requester's side. An older host that does not know the disposition settles the row on the acknowledgement, and the result then arrives as a late receipt.

The request keeps its one formal receipt for the result. While its ticket is open and no member report on it is `ready`, a reply on that request (a member's question, a notice) goes to the requester as a follow-up in the same conversation, not as the receipt. When the ticket ends and the request still has no receipt, the host sends the ending receipt itself, with the outcome and the latest report's summary. Upstream sends no result for a stopped or closed ticket, so for those it goes out at once. For any other outcome it waits 5 minutes, so the router's own result goes first.

Members can each work in one repository: the owner names it per member in the settings (`repos`, member → `owner/name`). The router then names the repository a request is about when it accepts (`superagent_route` item `repo`); the ticket runs only on that repository's members and waits for one of them without holding up tickets behind it. A request about no single repository is accepted without `repo` and runs on any member. An unknown repository is refused with the team's list.

Every A2A message to the team address gets a formal outcome, not only those that start a ticket. A message the team does not take (observe mode, a sender not on the list, a stop an agent may not give, the router's ignore) gets a `rejected` receipt with the reason. A message delivered into a ticket as a follow-up gets a `completed` receipt once its member has it. Without these, the sender's owed row only ever dead-lettered.

## Rules and dispatch

Each member has a `role` and its own rules; the router holds the team's rules and the dispatch rules. The candidate card lists the members with their roles, rules and whether they are free, and when any member has a profile an accept must name one as `member`. The ticket then waits for that member, and goes to nobody else. A member who leaves sends such a ticket back to the router (`superagent_assign`).

A change to a rule set is agreed in conversation. The owner talks to the member or the router in its own session; it proposes the whole new text (`a2a_member_rules_propose`, `superagent_rules_propose`), shows it, and applies it (`a2a_member_rules_apply`, `superagent_rules_apply`) after the owner replies. A member can change only its own. The host lets an apply through only when the turn answers the owner's own typed message, sent after the proposal. The accept mode, sender list, sources and review address are the owner's alone. Asked in its session to open a ticket, the router calls `superagent_request`: the host files the owner's words verbatim as a request, once per message.

The team page shows all of it and lets the owner edit the rules directly; that write needs the host's GUI login.

## Sending a request from the right bar

DSH's right bar has a **提需求** view in its guide. It sends the text to this instance's team the way the team page does, as the owner's request, without leaving the conversation. Files you add go through the file channel, granted to the team's canvas for 24 hours, and the request carries a `[A2A file]` line for each; the member pulls them with `a2a_file_fetch`.

## For the router

- Candidates arrive in your own session as `[superagent candidate] …` cards. Decide each by its `trigger_id` with `superagent_route`:
  - `accept`: one ticket for the request, with a title, a scope, a reason and an acknowledgement in the request's language. Do not add an implementation plan.
  - `attach`: to a listed open ticket that the message points at or asks for again. A duplicate is attached, never accepted twice. The card lists this thread's tickets and up to 20 of the team's other open tickets, newest first.
  - `stop`: a person asked to stop that ticket.
  - `ignore`: with a reason.
  - For an **inferred** candidate, pass `rules` with the enabled rules it matches. `accept` needs at least one. Under `observe` it is recorded as would-accept. `rules: []` records an assessed ignore.
  - A person's question that asks for no work: answer it with `superagent_reply` (`answer`, its `trigger_id`), then still decide it with `ignore`. Every candidate ends with a `superagent_route` item; an undecided one expires and comes back.
- Read with `superagent_read`, reply with `superagent_reply` (`answer`, `result` or `attention`), and ask an idle ticket's worker for a status report with `superagent_status`. Give an open ticket's member a fact you learned after accepting it with `superagent_note` (`ticket_id`, `text`); it reaches the member as "note from the router" and grants nothing — new work is a new request. A candidate marked "judged before" is a message a person asked you to judge again. An `attention` reply relays the ticket's open question (`question`, copied exactly); when your text does not already carry it, the host puts the question in front, since only the text reaches the person. Each tool shows you what it returned (tickets, a candidate, a decision's ticket id, a refused item's code), clipped at 12,000 characters.
- You neither send nor receive A2A work. `a2a_route` from you, or to you by any address (handle, session id, or a canvas you sit in), is refused with `[superagent-router-outbound]` or `[superagent-router-inbound]`.
- No other session can use these tools; they answer `not-router`.
- These four are the only tools you can call. Your session runs the `superagent-router` preset; beyond it, the host refuses every other call with `[superagent-role-tools]`, and your visible tools are cut down to them.

## For a member

- Your assignment arrives in your own session as `[superagent assignment] ticket … «title»`. It carries the scope and the original request with its trigger id. Later messages on that ticket's threads arrive as `[superagent input] …`, each with its trigger id and whether it comes from a person or an agent.
- Before you act on a person's message, acknowledge it with `a2a_ticket_ack` (its `trigger_id`, one or two sentences to them). The acknowledgement is a reply on their thread, and the message is yours to handle (for a comment on your pull request it is only recorded; nothing is posted). A message that asks for work beyond your ticket goes back with `a2a_ticket_handback`, for the router to assess. When a report answers a person's question, pass its trigger id as `answers`. A message you read before your last report stays with the ticket. One you never read goes to the router when the ticket ends, so nothing a person said is lost.
- Work in your own workspace, in a directory or worktree named after the ticket. Stay within the scope.
- Report with `a2a_ticket_report`, naming the `ticket_id` on the assignment card (a report for a ticket that is no longer yours is refused):
  - `progress`: something changed that the person must know;
  - `waiting`: you are waiting for a Trigger;
  - `ready`: the result can be reviewed or used. Name a pull request in `pull_request`: the ticket then stays open until it merges or closes, and review comments come back to you as `[superagent input]`;
  - `blocked` / `failed`: you cannot go on;
  - `dropped`: there is nothing to do.

  Add `question` only for what a person alone can decide; choose reasonable defaults for routine steps and say which you chose. The router hears every report in its own session and hands results and questions to the person.
- A message from an agent (a bot, a CLI identity) is context only. It cannot end, stop or widen your ticket. A `dropped` report made right after one, with no person writing since, is refused (`agent-cannot-end`).
- When you hand off (a result, a question, `waiting`, `blocked` or `failed`), the host may give you another ticket; a later `[superagent input]` brings the first one back, before any new ticket. A turn that ends with no report counts as `waiting`, with your last words as its summary.
- When the owner changes the team settings in a way that touches your ticket, you get a `[superagent input]` saying what changed for it: a rule it was accepted on now reads differently or is off, the team no longer takes agent-started work (accept mode is not `auto`), or its requester may no longer start work. It informs you; it neither stops nor widens the ticket. If it changes what you can do, say so with `a2a_ticket_report`.
- A `ready` report on a ticket with no followed threads ends it. Your slot then frees, and the next waiting ticket comes to you.
- You neither send nor receive A2A work (`[superagent-member-outbound]`, `[superagent-member-inbound]`). Do not open sessions or subagents.
- Your tools are upstream's work tools (`read`, `write`, `edit`, `read_image`, `glob`, `grep`, `bash`, `pwsh`, `job_*`, `web_search`, `web_fetch`, `skill`, `todo_write`), plus `a2a_ticket_report`, `a2a_ticket_ack`, `a2a_ticket_handback` and `a2a_file_fetch`. The host refuses every other call with `[superagent-role-tools]`: subagents, other sessions, `a2a_route`, `a2a_report` and the router's tools. A subagent opened earlier acts in your role.

## When the owner talks to you

The owner can talk to a member or an observer directly in its own session. Treat that as a normal conversation: answer and do what they ask. It needs no ticket and no `a2a_ticket_report`. A ticket you hold goes on after it.

## Preparing tickets, a cap, and health

- The owner can set a team **prepare command** (team page → 设置 → 执行). Before a local member gets a ticket's card, the host runs it once with `sh` in the member's workspace, with `SUPERAGENT_TICKET_ID`, `SUPERAGENT_TICKET_NAME`, `SUPERAGENT_REPO` and `SUPERAGENT_MEMBER` set; the card then says it ran. A failure frees the member and leaves the ticket waiting for a retry. Writing it needs the GUI login.
- **同时进行的工单上限** caps how many tickets run at once (0: one per member, no other cap). A ticket coming back for a person's message is not held by it.
- The host lists what keeps a team from working (a router or member session not loaded, a working ticket quiet for an hour). The team page and the right-bar views show it.

## Schedules

The router, members and observers have DSH's schedule tools for reminders and follow-ups in their own session: `schedule_create`, `schedule_edit`, `schedule_list`, `schedule_view` on DSH 0.2.2, and `schedule_create`, `schedule_list`, `schedule_update`, `schedule_delete` on DSH 0.2.1. On 0.2.2, only `target: this_session` is allowed; `new_once` and `new` are refused, because they would open sessions outside the team. On 0.2.1 there is no target: a task always belongs to the session that made it. A scheduled prompt is the session's own text, never the owner's: it cannot open a ticket for the owner or approve a rule change.

## Reading where work stands

Every role has `a2a_whoami` (which session and team it is). A member reads its own open tickets with `a2a_ticket_read` (kind `mine`, or `ticket` with an id it holds); an observer can also read kind `team` and kind `decisions`. It is read-only: candidates, dispatch, stopping and rules stay the router's and the owner's.

## ygl-trees, the team's memory

The three presets mount the ygl-trees MCP server as `ygl` (`ygl-trees mcp`, found on the host's PATH) and tell the team to keep what it learns there: a2a carries the work and its receipts, ygl-trees keeps the evidence, the judgements and the reusable notes. The MCP server runs outside the session's sandbox, so every team session reaches one shared workspace (the team's own: `SUPERAGENT_YGL_HOME`, or `~/.ygl-trees-superagent`; create it once with `ygl-trees db init`); the CLI in a session's shell reaches only its own directory. The router has `mcp__ygl__read` only and looks up earlier work before deciding; members and observers also have `mcp__ygl__write`, `mcp__ygl__verify` and `mcp__ygl__doctor`: they open a ticket with agent brief and a kb search, record evidence and claims as they go, kb add the reusable lesson before ready, and name the ids in their report. A check passes only from a verify run or the project's tests. Without ygl-trees on the host's PATH the tools do not appear; the session says so and installs nothing.

## Asking another team

A team session does not message other teams itself. When a ticket needs another team, it calls `a2a_outbound_request { ticket_id, address, text, why }`. The router may ask on any open ticket; a member or an observer only on the ticket it holds. The address is another team's: `<zone>/<id8>`, or `<zone>/canvas/<name>`, optionally with `@<fp8>`. The team's A2A Source must be on.

The request becomes a P0 card with source `outbound`. It is decided by the owner on the team page, or by an approver: a member or observer the owner lists in the team setting `approvers` (owner-only). An approver lists the waiting outbound cards with `a2a_ticket_read` kind `outbound` and decides with `a2a_decision_decide { card_id, option, reason }`. It can decide only outbound cards, never one it raised itself, and always with a reason.

On approval, the host sends exactly the card's text from the team's A2A identity, under a header naming the team and the ticket. The other team's formal receipt comes back to the ticket as a note. A ticket has at most three outbound requests waiting or unanswered. Design: `docs/design/superagent-outbound-requests.md`.

## Decision cards

What the owner has to decide is a card: a question, 2 to 6 options, the option you recommend, and a level (P0 irreversible or production, P1 significant, P2 routine and easy to undo, P3 trivial; no level counts as P1). The cards wait in the right bar's **待决策** view. P2 and P3 can be approved with one click; P0 and P1 need an option chosen.

What reaches the owner follows the team norms (design owner-reporting), which every team persona carries: only an executable proposal or a decision card, never an open question, background or a request for more information; a proposal names the action, its object and its entry, and says whether it is proposed, authorized or done; names, not hash ids; progress only when it changes an action or a decision. A card needs its `reason`. A decision is final: a router's or observer's card whose question the owner already decided is refused with that decision (`decided`).

- A member's question in `a2a_ticket_report` is a card: `question` needs `options` and `recommended`, and the decision comes back on that ticket.
- The router puts every recommendation of its own to the owner with `superagent_decision_propose`. An observer can use `a2a_decision_propose`. Once decided, these reach the router as a request from the owner beginning `[决策卡]`, to accept as any request.

## For an observer

An observer is a session the owner creates under the `superagent-observer` preset and adds to the canvas team. You join through the canvas, have a member's tools and take tickets like any member. You also have `a2a_ticket_request` (`text`: what needs doing and why): when you notice work nobody has asked for, file it there. The host files it in your name as an agent's request, and the router accepts and assigns it like any other. It cannot stop or change a ticket. An identical text still open returns the same request, and at most five of yours can be open at once (`too-many-open`).

## Members on other hosts

A member can sit on another host: another physical node, or another DSH instance on this machine, even one with the same zone label. Its work and reports travel **host to host** as signed, body-bound OriginClaim requests. There is no A2A route, no ledger debt and no receipt.

- **On the team host:** add the member's session to the team's canvas team, naming its host: `POST /__dsh_a2a/canvas { action: 'add-member', name: '<team canvas>', id: '<zone>/<id8>', peer: '<member host base URL>' }` (or in the planning view). The member host must be a linked peer. Its key comes from its signed card and the canvas pins it with the qualified ref. A report or turn end for that member counts only under that key (`/a2a/superagent-team`), so another instance sharing the handle is refused. Removing it from the canvas removes it from the team.
- **On the member host:** `POST { action: 'serve', team: '<zone>/canvas/<name>@<fp8>', members: [<local session ids>] }` — the team's canvas id, whose fingerprint names its owner. The host finds the linked peer whose signed card has that key and advertises that canvas, and pins the key. Only that key may assign work to those sessions (`/a2a/superagent-member`). Those sessions report with `a2a_ticket_report` as usual, and the host forwards the report, signed. `team: null` leaves the team. This is the member host owner's consent: a team host cannot take another host's sessions on its own. A served session on another preset than `superagent-member` (a serve stored before presets) takes no new work — a stop still reaches it — and the state reports it as `servesProblem` until it is served from a member-preset session.
- Serving sessions are isolated from A2A like any member.

## For the owner

The owner control route is `/__dsh_a2a/superagent`. One DSH instance can run several teams: `GET /__dsh_a2a/superagent/teams` lists them and `POST { canvas, router }` there adds one. On the control route, `teamId` in a POST body or `?teamId=` on a GET picks a team by id; without it the route means the instance's primary team. Each team has its own settings, rules, tickets and A2A address, and a session has one role across all of them. The list also has the teams linked instances advertise (a team advertises itself only while its A2A Source is on), and `POST { action: 'send', address, session, text }` there sends one a request as that session. It goes through the ordinary route, and the receiving team treats it as any A2A message.

**The team is a canvas team** (design v5). The owner composes it on the canvas — the planning view's 建队, or `/__dsh_a2a/canvas` — with the router and the members, local and on other hosts, then binds it here with `canvas` (the canvas team's name on this host) and `router` (one of its local sessions). Every other session on that canvas is a member, one worker slot each; adding or removing one on the canvas adds it to or removes it from the pool at once. A member removed while it runs a ticket is told to stop, and the ticket starts again on another member. While the team is bound to no canvas (as right after upgrading from a version before canvas teams, which keeps the router and drops the stored pool) or its canvas is gone, nothing is moved: running work stays with its member until the owner binds a canvas again, and the stored router may join the canvas that becomes the team. One session holds one team role: the team's canvas takes no CLI handle and no session that serves another team host, and a team session sits in no other canvas (`[superagent-team-canvas]`).

The router and the members are sessions the owner creates under the team's agent presets, which this plugin ships in its bundle layer: **`superagent-router`** (superagent 总工) for the router and **`superagent-member`** (superagent 团队成员) for each member, or **`superagent-observer`** (superagent 团队观察者) for a member who may also open tickets. The preset is the role's boundary:

- `superagent-router`: read-only files, a foreground command and a job wait of at most 5 s, skills and compaction; no subagents.
- `superagent-member`: the work tools; a foreground command moves to a background job after 5 s, so a stop or a person's answer is taken at the next step; no subagents. A member or an observer may also use every other tool the host offers (the owner's MCP servers and plugins), except what leaves the team: other sessions and subagents, `plugin_manager`, `ask_user_question`, A2A sending and joining, another role's team tools. The owner can block more in the team settings (`blockedTools`). The router keeps its own list.
- `superagent-observer`: the same as `superagent-member`, on the team's own host only.

Settings naming a router or member that runs another preset are refused, and so is `serve`. A session not loaded at the time, or a host without a preset registry, is not checked.

The workbench (`/__dsh_a2a_nexus/`) shows it as the **团队** tab whenever the host runs a team. The tab has five views:

- **待你处理**: tickets waiting on a person (answer, review, blocked or failed, failed delivery) and the team's problems. These include a missing router, an empty member pool, a pause, A2A Source errors, an overdue decision, and an undelivered reply.
- **提需求**: the workbench Source. A request box, and each request's thread with its decisions and replies. Each thread has a box for adding a follow-up. A request the router turned down (`ignore`, or `unavailable` when it did not decide in time) offers 「重新判断」: the router gets it again, marked as a second look.
- **工单**: tickets grouped by stage, with stop and retry.
- **团队**: the router, each member's slot, the remote members and the team this host serves, with their pinned keys, and the A2A address.
- **设置**: the canvas team and its router (members are shown from the canvas), the accept mode, the Source switches, and pause.

- `GET` returns the state: threads with their triggers, decisions and replies, and tickets with their stage. It also returns `refusals`, the refusals at the team's edge in this process. These include A2A routes to or from a role session, role sessions' calls outside their tool list, and host-to-host requests that are unsigned or not signed by the pinned key. They are counted by rule (`counts`), and the latest 50 are kept with caller and target (`recent`).
- `POST { action }` takes one of:
  - `settings`: the canvas team (`canvas`, a canvas on this host; `null` unbinds) and its router (`router`, a joined local session of that canvas) — members are never named here, they come from the canvas — the repository per member (`repos`), the allowed persons per Source, the A2A bot list, the accept mode, the proactive rules (`{name, text, enabled}`), the Source switches, the Eval timeout, and pause;
  - `request`: the workbench Source, with `text`, and `thread` to follow up;
  - `stop` / `retry`: act on a ticket by `ticket_id`;
  - `reevaluate`: a fresh judgement of a stored message by `trigger_id` (`queued: false` while one is under way). A person's message may be judged again; an A2A message whose sender already has its formal outcome is refused (`answered`) — its task is settled, so the sender sends it again. The CLI's `a2a-net superagent reevaluate <trigger id>` does the same.
- A follow-up on a ticket's thread goes to that ticket (Subscription fan-out). It does not start a new Eval.
- State lives under `<a2a home>/superagent/`.
