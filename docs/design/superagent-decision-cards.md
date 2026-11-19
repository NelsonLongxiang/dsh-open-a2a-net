# superagent: decision cards

Status: agreed with the owner on 2026-11-09; C7 added on 2026-11-10.

## Context

The owner wants every decision a team needs from them in one place, in DSH's right bar, each with a recommended option, and to approve the routine ones with one click.

## Decisions

- **C1 A card has options and a recommendation.** A card is a question, two to six options, the option its proposer recommends, and a level from P0 to P3. A card without a recommendation among its options is refused. A card with no level counts as P1.
- **C2 Who raises one.** The router raises a card for any recommendation it has for the owner (`superagent_decision_propose`), and does not give it as prose. An observer can raise one (`a2a_decision_propose`). A member's question on a ticket must be a card: `a2a_ticket_report` refuses a question without options and a recommendation.
- **C3 How one is answered.** P2 and P3 can be approved with one click, which takes the recommended option. P0 and P1 cannot: the owner picks an option and confirms. The host enforces this, not only the page. The owner can also pick another option or write their own decision on any card.
- **C4 Every decision becomes the team's work.** A card raised by the router or an observer becomes, once decided, a request from the owner on a new thread. It says who raised the card, so the proposer's words are not read as the owner's own. It reaches the router as a candidate and is accepted and dispatched as any request. A member's card belongs to the ticket it was asked on, which is already the team's work: the decision goes back to that ticket. Opening a second ticket would leave the first waiting for an answer.
- **C5 Only the owner decides.** Deciding needs the host's GUI login, as rule edits do (router-owner-asks D10), so a member's shell cannot approve its own card. The host admits the original incoming request and it must name the authenticated browser-owner Peer. Domain/forwarded-port logins are not replayed against loopback. An unavailable/older Host Connection service fails closed with `owner-auth-unavailable`; a control-route key or an authenticated API Peer does not replace the browser owner's confirmation (owner-approved repair, 2026-11-14).
- **C6 A loop cannot bury the owner.** One proposer has at most ten cards open, and an identical open question returns the existing card.
- **C7 Decided cards are a record, not an archive.** A decided card is kept 30 days, and at most the newest 500. A member's card whose ticket has ended is dropped. A card still waiting for the owner is never dropped.
- **C8 Files on a card (owner 2026-11-10).** The router and an observer raising a card, and a member asking a question, may put up to 16 files from their workspace on it (`files`, paths). The host stages them on the file channel granted to the team's canvas, as `a2a_file_send` does, and the card lists them; the owner downloads one through `GET /__dsh_a2a/superagent/decisions/file`, which serves only a file a card names, behind the same owner proof as deciding. The owner may attach files when deciding: the right bar stages them for the card's team like a request's files, and their reference lines go below the decision to the router or the ticket's member, who pull them with `a2a_file_fetch`. The file channel keeps a file 24 hours; after that the card still lists it, and the download says it has expired.
- **C9 A waiting card is never hidden (feedback 2026-11-12).** The right bar's team view shows the decisions whether or not its team list can be read or has a team to send to; those only change the request box. Only a read that returns a `decisions` array counts as the list. A refused or failed read says so and keeps the last cards it read, marked as possibly out of date, until a later poll succeeds. Nothing there decides, retries a send or changes a card.

## Levels

The proposer sets the level:

- P0: irreversible, or touches production or other people's data.
- P1: significant and costly to undo.
- P2: routine, easy to undo.
- P3: trivial.

## Consequences

A proposer can mark a card lower than it deserves. The owner still sees the question and the recommendation before clicking, so this costs attention, not authority. Prose advice from the router cannot be blocked by the host; its persona requires the card.
