# superagent: who sets the rules, how work is dispatched, and what the router does for the owner

Status: revised after the owner's ruling, on next/0.8, design review folded. The vendored engine is unchanged.

Owner, 2026-11-09: 「每个 work 成员有自己的接单规则，总工负责团队的接单规则和派单规则，根据 work 成员的角色和接单规则派发。每个成员只能修改自己的接单规则，总工能修改团队的接单规则，规则修改必须获得用户批准才可。」 Earlier the same day: 「我期望总工能够帮我创建工单和优化接单规则。」 And: 「做再多的 UI/UX 不如让大家自己动手。」

## Context

- A ticket goes to the first free member. The router cannot name one and is not told who the members are, so on a real team a ticket the owner addressed to one member ran on another.
- The owner cannot open a ticket from the router's session: a route needs a `trigger_id`.
- The team's rules exist, but nobody can improve them with the router's help, and a member has no rules of its own.
- The router reads text from outsiders all day, so nothing here may be reachable from that text.

## Decisions

### Three kinds of rule, each with one owner

- **D1 Member profile.** Each member has a `role` (one line: what it is for) and its own `rules` (what it takes). Stored per member in the team's settings, for local and remote members alike.
- **D2 Team rules** stay as they are: which inferred requests the team takes.
- **D3 Dispatch rules** are new, team-level, and free text: how the router chooses among members.

| Rules | May propose a change | Applies |
|---|---|---|
| A member's own | that member only | the owner's message |
| The team's and the dispatch rules | the router only | the owner's message |
| Accept mode, sender list, sources, review address | nobody | the owner, directly on the page |

The owner can also edit any rule on the team page. The last row decides who may ask at all, so no session can propose it.

### Dispatch

- **D4 The router chooses.** The candidate card lists each member with its name, role, rules, repository and whether it is free, and the dispatch rules. `superagent_route`'s accept gains `member`, by name or id. An unknown member is refused with the list.
- **D5 A named member keeps the ticket.** The ticket waits for that member and goes to nobody else. Without `member` it goes to the first free member, as today, and within `repo` when one is named. If any member has a role or rules, the router must name a member.
- **D6 The member sees why it has the ticket.** The assignment card carries the member's own rules and the team rules the ticket was accepted on. A ticket that does not fit the member's rules is reported `blocked` with the reason, and the router or the owner re-dispatches it.
- **D7 Re-dispatch keeps the member.** The named member is recorded with the ticket (`executor.json`, beside its repository). A ticket whose assignment is replaced goes back to the same member unless the member has left the team.
- **D7a A ticket waiting for a member who left.** When the member set changes, a waiting ticket whose named member is no longer on the team goes back to the router to choose again, so it cannot wait forever.

### Changing rules

- **D8 A change is agreed in conversation.** The owner talks to the member or the router in its own session. It writes the proposed text with `superagent_rules_propose` (router: `team` or `dispatch`) or `a2a_member_rules_propose` (member: its own rules and role, the member taken from the calling session, never from an argument), and shows it to the owner. Nothing changes yet.
- **D9 Only the owner's next message approves.** `superagent_rules_apply` applies a pending proposal only under D11, and only if the person's message came after the proposal was filed, so the person has seen it. It goes through the same validation as the page. A proposal whose base revision has moved is refused and must be proposed again. A changed team rule moves the policy version and tells affected open tickets, as today. The tool cannot tell a yes from a no: it proves the person spoke after seeing the text, and the session decides what they said. Every applied change is recorded with the proposal and the person's message, and shows on the page.
- **D10 No approval screen, and page edits need the owner's proof.** Approval in conversation is the person's own typed message, which the host marks and a shell cannot produce. The page has no proposal queue. The owner can also edit rules directly on the page (D10a), and that write goes through the control route. A member's shell runs on the same machine, and without an API key the control route trusts loopback, so loopback alone is not enough for this write. An API key is not enough either, because the workbench shell hands it to a loopback caller. A settings write that touches a rule, a role or the dispatch rules needs the host's GUI login, which the browser holds: the host is asked whether the request's cookie is a live login. On a host with no login, the page says so and the write is refused; changing rules in conversation still works there. A process running as the same OS user that can read the login's stored cookie is out of reach of this check.
- **D10a Everything is on show and editable by the owner.** The team page's member cards show each member's role and rules, the team page shows the team and dispatch rules, and a proposal still waiting shows beside what it would change. Each rule set shows its last change: when, by whom, and for a proposal the person's message. The owner can edit all of these on the page, under D10; each member's rules can be edited only there or by that member's own proposal. On the planning canvas a member's tooltip carries its role and rules.
- **D10b Revisions.** Each rule set (a member's profile, the team rules, the dispatch rules) has its own revision, because the policy version does not cover members. A proposal names the revision it was based on. A member's profile goes when the member leaves the team, as its repository does.

### The router working for the owner

- **D11 Only the person's own words.** `superagent_request` and `superagent_rules_apply` (and the member's apply) act only while the router's turn answers a message the person typed: the latest message in its session that is not host context has `source.kind === 'user'`. The host sets that field; a model or a relayed message cannot. A candidate card, report or note is `a2a-relay` and closes the door until the person speaks again; a compaction checkpoint has its own kind. Otherwise it is refused with `not-the-owner`.
- **D12 Opening a ticket is a request made for the person.** A message of the owner's in the router's session that asks for work is enough; the router does not ask first whether to open a ticket (owner 2026-11-09). `superagent_request` takes no text. The host files that message verbatim as a workbench Trigger from the owner (`human: true`, explicit) on a new thread, once per message id. It reaches the router as an ordinary candidate and is accepted as any other, so there is no second way to create a ticket, and the router cannot restate or widen the request.
- **D13 Reading what happened.** `superagent_read` gains kind `decisions`: recent inferred candidates with text, decision, rules named and reason. A proposal to improve the rules is drawn from it.
- **D14 Nothing proactive, except an observer.** Apart from D15, no session opens a ticket on its own initiative; a member still hands back what is beyond its ticket.

### The observer

- **D15 A member who may open tickets (owner 2026-11-09).** An observer is a session the owner creates under the `superagent-observer` preset and adds to the canvas team; the preset alone makes it one, and nothing else is set. It has a member's tools and takes tickets like one; the one difference is `a2a_ticket_request`. The tool files the observer's own words as a workbench Trigger on a new thread, with the actor `observer:<session>` and `human: false`. It reaches the router as an ordinary candidate, so D12's single way of creating a ticket holds and the router still accepts and dispatches.
- **D16 What the observer's request is worth.** The gate admits it as explicit, because the owner created the observer for this; no accept mode or rule holds it back. It stays an agent's request: the candidate card says so, `superagent_route` refuses a stop on it, and no person's question or acknowledgement is answered on it. Creating a session needs the owner's GUI login, and a session's preset does not change, so a member's shell cannot make itself an observer. The host checks the preset when the request is filed; from then on the gate and revalidation ask only whether the session is still in the pool, because a preset can be read only while its session is loaded. Once an observer leaves the team, its open tickets cannot be resumed. A session under this preset cannot serve another host's team: the tool files on the host it sits on.
- **D17 A loop cannot fill the queue.** The observer acts on its own judgement, so the host keeps at most five of its requests open and returns the existing one for an identical text.

## Consequences

- With profiles set, every accept names a member, so a poor choice is the router's and shows on the decision.
- A named member that is busy delays its ticket even when another is free. That is the owner's model: work goes to the member it fits.
- Remote members propose through the same forward as their reports, and the proposal lands on the team host.
- A person's change happens where they are already talking; a remote member's session proves the person spoke on its own host, and the team host trusts that pinned peer as it trusts its reports.
- Deferred: rules that gate automatically without the router's judgement.

## Acceptance

Live, on a fresh router, under its own frozen spec: a ticket goes to the member the rules fit while another is free; a named busy member keeps its ticket; a named member who leaves the team sends its waiting ticket back to the router; a member's shell cannot write a rule through the control route; the owner's page can; a member proposes only its own rules; a proposal is not applied until the person speaks after it, and a candidate or relayed message cannot apply it; an applied proposal shows on the page with its last change, and in the next card; a member's role and rules show on its card; a stale proposal cannot be applied; a request typed in the router's session opens a ticket whose origin is that message, and the same text arriving as a candidate cannot.
