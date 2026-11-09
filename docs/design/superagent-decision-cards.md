# superagent: decision cards

Status: agreed with the owner on 2026-11-09.

## Context

The owner wants every decision a team needs from them in one place, in DSH's right bar, each with a recommended option, and to approve the routine ones with one click.

## Decisions

- **C1 A card has options and a recommendation.** A card is a question, two to six options, the option its proposer recommends, and a level from P0 to P3. A card without a recommendation among its options is refused. A card with no level counts as P1.
- **C2 Who raises one.** The router raises a card for any recommendation it has for the owner (`superagent_decision_propose`), and does not give it as prose. An observer can raise one (`a2a_decision_propose`). A member's question on a ticket must be a card: `a2a_ticket_report` refuses a question without options and a recommendation.
- **C3 How one is answered.** P2 and P3 can be approved with one click, which takes the recommended option. P0 and P1 cannot: the owner picks an option and confirms. The host enforces this, not only the page. The owner can also pick another option or write their own decision on any card.
- **C4 Every decision becomes the team's work.** A card raised by the router or an observer becomes, once decided, a request from the owner on a new thread. It reaches the router as a candidate and is accepted and dispatched as any request. A member's card belongs to the ticket it was asked on, which is already the team's work: the decision goes back to that ticket. Opening a second ticket would leave the first waiting for an answer.
- **C5 Only the owner decides.** Deciding needs the host's GUI login, as rule edits do (router-owner-asks D10), so a member's shell cannot approve its own card. A host with no login accepts the control route, as it does for answering a question today.
- **C6 A loop cannot bury the owner.** One proposer has at most ten cards open, and an identical open question returns the existing card.

## Levels

The proposer sets the level:

- P0: irreversible, or touches production or other people's data.
- P1: significant and costly to undo.
- P2: routine, easy to undo.
- P3: trivial.

## Consequences

A proposer can mark a card lower than it deserves. The owner still sees the question and the recommendation before clicking, so this costs attention, not authority. Prose advice from the router cannot be blocked by the host; its persona requires the card.
