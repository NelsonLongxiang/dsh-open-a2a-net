# superagent: preparing a ticket's directory, a cap on running tickets, and a health check

Status: agreed with the owner on 2026-11-10 (category one of the upstream comparison).

## Context

Upstream superagent prepares each ticket's directory with a command, caps how many tickets run at once, and checks the service every hour. Here a member is told to make its own worktree, nothing caps the team, and problems show only on the team page.

## Decisions

### Preparing a ticket's directory

- **R1 One command per team.** The team may set a prepare command. Before a local member gets a ticket's assignment card, the host runs it once with `sh` in that member's workspace, with a ten-minute limit by default. A ticket is prepared once: a later assignment of the same ticket does not run it again.
- **R2 What it is told.** The command gets `SUPERAGENT_TICKET_ID`, `SUPERAGENT_TICKET_NAME` (the name the ticket's directory or worktree takes), `SUPERAGENT_REPO` and `SUPERAGENT_MEMBER` in its environment. A typical command makes a `git worktree` under `.worktrees/$SUPERAGENT_TICKET_NAME`.
- **R3 A failure is visible and retried by the owner.** A failed or timed-out command records its exit and the end of its output on the ticket as a delivery failure, frees the member, and leaves the ticket waiting for a person. A retry runs it again.
- **R4 Only the owner sets it.** The command runs as this host's user, outside any sandbox, so writing it needs the GUI login as rule edits do. A member on another host does not run it: its host is not this one.

### A cap on running tickets

- **R5 New tickets wait at the cap.** The team may cap how many tickets run at once; 0 means no cap beyond one ticket per member. At the cap a new ticket waits as queued. A ticket coming back to its member because a person answered it is not held back by the cap, so a person's message is never stuck behind new work.

### The health check

- **R6 Problems are computed on the host.** The host lists the team's problems, among them a router or member session that is not loaded and a ticket with no activity for an hour. The team page and both right-bar views show them, so a problem is seen from the conversation too.
  - **The router's failed turn (2026-11-12).** When the router's turn fails (its model refused: a used-up quota, an outage), requests wait unjudged and nothing else shows why. The host keeps the latest failure in memory and lists `router-turn-failed` with the error and how long ago. The router's next routing call clears it, and so does a restart. *Found live:* two child teams' routers hit their model quota (429), and the root team saw nothing.
- **R6a Queued tickets say what they wait for (field report 2026-11-19).** A queued ticket has no binding, so the hour-quiet check never saw it: on one host eleven tickets sat queued for days beside four idle members, with health empty. The host now names tickets queued longer than the quiet time, one problem per thing they wait for: the member a ticket is kept for (busy, or no longer on the team), a repository none of whose members is free or present, every member busy, or the team's concurrency cap. A free member whose delivery was refused is named with that member (`delivery-refused`, the last refusal kept in memory); a ticket with a free member that has still not gone out after the quiet time is `launch-stalled`, cause unknown, so a refusal the host did not see cannot hide it either (#744 review R1). A paused team reports its queue as `paused` and raises nothing for it: the page already shows the pause. The problem carries how many tickets and the oldest one, so a busy member behind eleven tickets raises one reminder card. A member that left or a repository nobody works in is shown as danger, since waiting does not clear it. The state lists each queued ticket with its reason, member or repository and since when; `superagent_read` (router) and `a2a_ticket_read` (observers) show the same under `queue`. `superagent_assign` says what the host already did: a ticket that has not started can go to any member at any time.
- **R7 A problem that stays tells the owner (2026-11-10, 对照上游「每小时检查，出问题才告诉你」).** Every 15 minutes the host looks at its health and raises one decision card (P2, 去处理 or 先忽略 24 小时) for a problem that is new; the same problem while it lasts raises nothing more, and a problem that goes away takes its undecided card back. A decision holds its reminder off — a day for 忽略, an hour otherwise. The boot grace period raises nothing (R6 keeps health quiet then, so nothing reaches the cards either). Each team's host keeps its own reminders; no session is started and no A2A route is sent. A health card's decision opens no ticket: both options only dismiss it. The 忽略 hold-off lives in memory only: after a restart a still-present problem raises its card again before the 24 hours are up, which reads as an early reminder rather than a lost one. The card's question uses the banner's own words, not the internal codes.

## Consequences

The prepare command is as powerful as a shell on this host. Nothing checks what it does beyond its exit status.

A host that has just started wakes its joined sessions one by one; until that is done, or for its first two minutes, a session not loaded yet is not reported.
