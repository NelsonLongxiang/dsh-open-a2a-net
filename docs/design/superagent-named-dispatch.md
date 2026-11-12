# superagent: a dispatch that names a seat, and rework the market returns

Status: implemented, 2026-11-11.

- **Owner approval:** given in the review seat's session on 2026-11-11 (「Approve both」), on the proposal and three rulings the market's design session relayed:
  - (a) a named dispatch does not skip the router's accept judgement;
  - (b) a busy named seat queues, and progress says how many tickets are ahead;
  - (c) a split of a named ticket gives its parts to the named seat unless a part names another member.
- **Asked for by** the workbench market (`docs/productization/14-team-and-assignment.md` in the market repository): a team member can be assigned to a person on the market side, and that person's work goes to that member. The market also returns work for rework and needs it to arrive as a new ticket every time.
- **Why host behavior, not rule text:** the same lesson as #558 and #620. A rule written only in the persona or the card is not reliably followed.

## Context

- **Inbound requests carry only text.** A request reaches the team as a mailbox row: caller, task id, context, how the caller was proven, and the text. There is no metadata channel. Receipts already solve the same problem with one JSON machine line inside the signed text (`src/receipt.ts`). Requests do the same here.
- **Naming a member already exists for the router.** `superagent_route` accept takes `member`. The executor then keeps the ticket for that member: it waits while the member is busy and goes to nobody else (design D5). So ruling (b) is already the executor's behavior.
- **Members are sessions.** A member's handle changes when its session is replaced. The market keeps assignments, so it needs a seat id that outlives the session.

## Decisions

### N1. The dispatch line

- **Shape.** A request whose first line is `[A2A dispatch] ` followed by one JSON object:
  ```text
  [A2A dispatch] {"for":"<seatId | handle | member name>"}
  <the request, as before>
  ```
  `{"rework":{"of":"<the task id of the request being returned>"}}` marks a rework return. Both keys may appear together.
- **Who is believed.** All of these must hold:
  - the request came over the wire with a verified OriginClaim (proof `origin-claim`, Sig3);
  - the caller is a canvas remote member whose key this host pinned (a registered peer);
  - its verified card declares the capability: `directedSeats` for `for`, `reworkReturns` for `rework`.
- **Anything else is plain text.** Any other caller's dispatch line is only text. Nothing acts on it, and the router reads it as part of the request.
- **The router sees the line**, and the candidate card says what it means: "this request names a seat; if you accept it, the host gives it to that seat; do not name a member".

### N2. Seats

- **A seat id per member slot.** The host keeps one: `seat-<8 hex>`, created the first time a member is in the team's pool. It is kept in `seats.json` beside the executor's state.
- **Replacement keeps the seat.** A member that leaves keeps its id for 30 days, marked as left, so a dispatch naming it gets the "not on the team" question rather than an unknown name.
- **The owner moves a seat to a new session** with `POST /__dsh_a2a/superagent { action: 'move-seat', from, to }`. The new session must be a member of the same team.
- **The roster carries `seatId`** beside `seat` (the current handle). The market keys its assignments on `seatId`.
- **`for` resolves** a seat id first, then a handle, then a member name: the router's own `resolveMember`.

### N3. Accept of a named dispatch

- **The router still judges** accept, attach or ignore (ruling a). On accept, the host sets the ticket's member to the named seat and ignores the router's `member`. The router is not required to name one, even on a team with member profiles.
- **When the seat is in the pool and its session is loaded:** the ticket is named for it. A busy seat makes the ticket wait for it (ruling b). The progress step's `ahead` already counts the tickets waiting for that member.
- **Otherwise** (not on the team, left, its session not loaded, or an unknown seat) the ticket is **seat-held** (N4).
- **Splitting a named ticket** (ruling c): a part without its own `member` goes to the parent's named seat.

### N4. Seat-held: the question back to the requester

- **The question.** The host holds the ticket from members and reports on it as the split parent does: it marks the assignment started, then reports `blocked` with the question 「指名的成员 <seat> 现在接不了（<why>）。等这个成员，还是换人（不指名重派）？」. It files the question's card with the options 「等」 and 「换人」, recommending 「等」, and sends it as an attention receipt (`attention-<task>-<qid>`, `question.options` fixed).
- **The answer** arrives as a follow-up in the same conversation. The light path attaches it to the ticket, and the host reads it:
  - **「换人」:** the naming is dropped and the hold is released. A team whose members have profiles gets the router asked to choose with `superagent_assign`. Otherwise the ticket is retried and the next free member takes it.
  - **「等」:** the ticket stays held, and the question is cleared.
  - **Anything else:** the question stays open.
- **The seat comes back** (in the pool, session loaded) while the ticket is held, whether or not the requester answered: the host releases the hold, names the seat and retries the ticket. That is what the requester asked for.
- **A named seat that leaves the team later**, while its ticket is still waiting for it, is seat-held the same way. The router is not asked to choose: ruling (no reassignment by the host or router).

### N5. Rework returns

- **Accepted at once.** A believed `rework` request is accepted by the host without a router turn, as a split part is:
  - title 「打回重做：<the first request's title>」. `of` is the delivery that was returned: after a rework, that is the rework ticket (market's choice, so the work goes back to whoever did it last). The title follows the chain to the first request instead of nesting 「打回重做：打回重做：…」;
  - scope = the request's text (the dispatch line removed);
  - the returned ticket's rules.
- **It is always a new ticket.** It never reopens or attaches to the returned one.
- **Its member:**
  - the `for` seat, if the request names one (N3, N4);
  - else the member that last worked the returned ticket, if it is still in the pool;
  - else whoever the executor gives it to.
- **Not found.** A `rework.of` the host does not know (another host's, or too old) still opens a new ticket, titled 「打回重做」.

## Consequences

- **The requester controls who works.** It sees the named seat work the ticket, or one question it can answer with a click. The router decides only whether the team takes the work.
- **Rework no longer depends on the router reading a rule.** The `market-rework` rule text stays for callers that do not declare `reworkReturns`.
- **Not in this design:**
  - a market-side reassignment while the ticket runs;
  - naming more than one seat;
  - staffing changes (`docs/design/superagent-staffing-changes.md`, which needs the owner's review).
