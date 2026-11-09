# superagent: several teams, and a request box in the right bar

Status: agreed with the owner on 2026-11-09, not built yet.

## Context

The owner wants to send a request to a team without leaving the conversation, from a view in DSH's right bar, and to choose which team gets it. Teams can be on the same DSH instance or on another instance or host.

Today one DSH instance runs one team. `SuperagentHost` holds one settings file, one engine, one executor and one A2A address, and the control route `/__dsh_a2a/superagent` has no team in it.

## Decisions

### Several teams on one instance

- **M1 One host object per team.** `SuperagentHost` stays a single team. A new registry, `SuperagentTeams`, holds one per team, so each team keeps its own settings, rules, dispatch rules, accept mode, tickets, A2A address, repositories and reviewer.
- **M2 Existing data does not move.** `<a2a home>/superagent/` remains the primary team. A further team lives in `<a2a home>/superagent/teams/<id>/`, where `id` is a short hash of its canvas name.
- **M3 Old callers keep working.** The control route takes an optional team (`team` in a POST body, `?team=` on a GET). Without one it means the primary team, so the CLI and existing scripts are unchanged. `GET /__dsh_a2a/superagent/teams` lists the teams.
- **M4 One session, one role, across all teams.** The rule that a team session sits in no other canvas already gives this; the registry enforces it across teams as well. Tools, the role guard and turn events find the team from the calling session.
- **M5 A new team is a new binding.** The owner composes a canvas team and adds it on the team page by naming its canvas and router, as binding works today. The team page gets a team switcher.
- **M6 Remote members.** Signed host-to-host calls carry the member, so each one goes to the team that holds that member with that pinned key. A session serving another host's team stays one role.

### The right-bar view

- **M7 A tab of its own.** A tab type `a2a-team-request` in `sidebar.right.pane.tab`, opened from the right bar's guide. It has a team picker, a text box and a send button, and shows whether the request was taken.
- **M8 What the picker lists.** This instance's teams that have a router, then teams on linked instances. A linked instance advertises a team on its signed card only while that team's A2A Source is on, because otherwise nothing can reach it.

### Sending to another instance

- **M9 No new trust.** A request to another instance goes over A2A to that team's canvas address, sent as the session the tab is open in. The receiving team treats it as it treats any A2A message: an agent's, admitted only if the sender is on its bot list, and opened as a ticket only under `auto` with a matching rule. The view says so, and names the sender to add. The receipt comes back to that session.
- **M10 A team's own sessions cannot send.** A router or member has no A2A route today, and the view does not give it one.

## Not doing

Treating a request from another instance as the owner's own. That needs the receiving host to trust another host's login, which is a new authority and a separate decision.

## Order

1. The right-bar view, sending to this instance's team.
2. Several teams on one instance, with the team page switcher and the picker.
3. Linked instances in the picker, and sending over A2A.

Each step is its own pull request. Steps 2 and 3 touch authorization and need non-self review; the whole regression is rerun after step 2.
