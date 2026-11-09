# superagent: who sets the rules, how work is dispatched, and what the router does for the owner

Status: revised after the owner's ruling, on next/0.8, design review pending. The vendored engine is unchanged.

Owner, 2026-11-09: 「每个 work 成员有自己的接单规则，总工负责团队的接单规则和派单规则，根据 work 成员的角色和接单规则派发。每个成员只能修改自己的接单规则，总工能修改团队的接单规则，规则修改必须获得用户批准才可。」 Earlier the same day: 「我期望总工能够帮我创建工单和优化接单规则。」

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
| A member's own | that member only | the owner |
| The team's and the dispatch rules | the router only | the owner |
| Accept mode, sender list, sources, review address | nobody | the owner, directly on the page |

The owner can also edit any rule directly on the team page. The last row decides who may ask at all, so no session can propose it.

### Dispatch

- **D4 The router chooses.** The candidate card lists each member with its name, role, rules, repository and whether it is free, and the dispatch rules. `superagent_route`'s accept gains `member`, by name or id. An unknown member is refused with the list.
- **D5 A named member keeps the ticket.** The ticket waits for that member and goes to nobody else. Without `member` it goes to the first free member, as today, and within `repo` when one is named. If any member has a role or rules, the router must name a member.
- **D6 The member sees why it has the ticket.** The assignment card carries the member's own rules and the team rules the ticket was accepted on. A ticket that does not fit the member's rules is reported `blocked` with the reason, and the router or the owner re-dispatches it.
- **D7 Re-dispatch keeps the member.** A ticket whose assignment is replaced goes back to the same member unless the member has left the team.

### Changing rules

- **D8 A change is a proposal.** `superagent_rules_propose` (router: `team` or `dispatch`) and `a2a_member_rules_propose` (member: its own rules and role, the member taken from the calling session, never from an argument) file the whole proposed text, the reason, and the revision it was based on. Nothing changes.
- **D9 Only the owner approves.** Proposals appear under 待你处理 with the old and new text and 批准 / 拒绝. Approving applies the text through the same validation as the page. A proposal whose base revision has moved cannot be approved and says so. A changed team rule moves the policy version and tells affected open tickets, as today.
- **D10 What approval has to withstand.** Approval means nothing if a team session can perform it. The approve action must need a proof of the owner that a team session does not hold. Before implementing, measure what a member's shell can reach on the host; the implementation follows from that and the acceptance covers it.

### The router working for the owner

- **D11 Only the person's own words.** `superagent_request` acts only while the router's turn answers a message the person typed: the latest message in its session that is not host context has `source.kind === 'user'`. The host sets that field; a model or a relayed message cannot. A candidate card, report or note is `a2a-relay` and closes the door until the person speaks again; a compaction checkpoint has its own kind. Otherwise it is refused with `not-the-owner`.
- **D12 Opening a ticket is a request made for the person.** `superagent_request` takes no text. The host files that message verbatim as a workbench Trigger from the owner (`human: true`, explicit) on a new thread, once per message id. It reaches the router as an ordinary candidate and is accepted as any other, so there is no second way to create a ticket, and the router cannot restate or widen the request.
- **D13 Reading what happened.** `superagent_read` gains kind `decisions`: recent inferred candidates with text, decision, rules named and reason. A proposal to improve the rules is drawn from it.
- **D14 Nothing proactive.** No session opens a ticket on its own initiative; a member still hands back what is beyond its ticket.

## Consequences

- With profiles set, every accept names a member, so a poor choice is the router's and shows on the decision.
- A named member that is busy delays its ticket even when another is free. That is the owner's model: work goes to the member it fits.
- Remote members propose through the same forward as their reports, and the proposal lands on the team host.
- Deferred: applying a proposal from the router's session by the owner's words, and rules that gate automatically without the router's judgement.

## Acceptance

Live, on a fresh router, under its own frozen spec: a ticket goes to the member the rules fit while another is free; a named busy member keeps its ticket; a member proposes only its own rules; a member or the router cannot apply a proposal; an approved proposal shows on the page and in the next card; a stale proposal cannot be approved; a request typed in the router's session opens a ticket whose origin is that message, and the same text arriving as a candidate cannot.
