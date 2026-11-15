# superagent: what reaches the owner (default norms)

Status: agreed with the owner on 2026-11-11 (「这些是规范，看看怎么做成默认的规范」). Until now these lived in one member's own rules (`owner-reporting-contract`, applied to that member only); the other members had them as drafts.

## Context

The owner reads the team page and the decision cards, not the team's reasoning. A router or member that hands up an open question, background, or "need more information" makes the owner do the narrowing. A card without a reason, a choice put again after it was decided, or a ticket named by a hash id all cost the owner time. The decision card tool already enforced part of this (2–6 options, the recommendation copied from one, level P0–P3 defaulting to P1, at most 16 files); the rest was left to each session.

## Decisions

- **R1 Only actionable things reach the owner.** Every team session hands the owner only an executable proposal or a decision card — never an open question, background, or a request for more information. A gap is first narrowed by the session itself into an executable next step.
- **R2 A proposal says what, on what, through which entry, and how far it is.** An action, its object and the entry that carries it out, marked as 建议 (proposed), 已授权 (authorized) or 已执行 (done).
- **R3 A decision card is complete.** One concrete point to decide, 2–6 options, the recommended one (copied exactly) and **its reason**, a level, and the files the owner needs. The host now refuses a card without a reason.
- **R4 Names, not hash ids.** Tickets, members and teams are named by their titles and names in what the owner reads; an id is added only where a tool needs it.
- **R5 A decision is final.** A choice the owner decided is not put again: the host refuses a router's or observer's card whose question matches one of theirs already decided (it answers with that decision), within the decided cards it keeps (30 days, 500 cards). Health reminders, tool requests and outbound requests keep their own rules: a health problem that returns may be raised again.
- **R6 Progress only when it changes something.** Report progress to the owner only when it changes an action or a decision; no repeated reminders.
- **R7 The channel for a person's answer.** A member's question for a person goes out only through `a2a_ticket_report` with state `question` (or `blocked`) and its `question`; prose in a report does not become a waiting question. Anything else for the owner to decide goes on a decision card. The router relays a ticket's question with `superagent_reply` and puts its own recommendations on `superagent_decision_propose`.

R1, R2, R4, R6 and R7 are written into the three team personas, so every router, member and observer has them without a rule of its own; R3 and R5 are also enforced by the host.

## Consequences

A member's own rules can still add to these; they cannot take them away, since the persona carries them. The host cannot check R1, R2, R4 or R6: they are instructions, and the owner corrects a session that strays with a member rule. Refusing a repeated question matches by its text; a reworded question about the same choice still gets through, and the owner declines it.
