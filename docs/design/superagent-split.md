# superagent: the router splits a request into parts when the request asks for it

Status: implemented, 2026-11-11.

- **Owner ruling (via the session, 2026-11-11):** the router may split a request **only when the request explicitly asks for parts**.
- **Recommendations the owner left to the review seat, adopted here:**
  - the parent ticket only coordinates;
  - the host writes the combined result;
  - a part that fails makes the whole a failure, part by part.
- **Asked for by** the workbench market: one item is one dispatch; the node decides how to split it. In the trial, a dispatch that asked for "two parts, one per member" ran as one ticket. The router followed its rule "never split a request".

## Context

- **The engine settles a request once.** `engine.decide` takes one decision per request, and an `accept` opens one ticket. The vendored engine must stay byte-identical to its pin.
- **So splitting is the host's.** The host must make the extra tickets itself and keep the parent–child link.
- **The requester sees one task.** It expects one formal result at the end, questions on `attention-<task>-<qid>`, and progress steps that list the tickets the request became (`tickets`, with each `seat` and `state`).

## Decisions

### S1. When and how the router splits

- **The persona changes.** "You never split a request" becomes: "You split a request only when it explicitly asks for separate parts. Then accept it, and split its ticket with `superagent_split`."
- **The new router tool** is `superagent_split {ticket_id, asked, parts: [{title, scope, member?}] (2–6), reason}`.
  - `asked` is the request's own words that ask for parts, copied exactly. The host refuses the split (`not-asked`) unless `asked` is in the text of the request the ticket was accepted from. This is how "only when asked" is checked rather than trusted.
  - The host also refuses a ticket that has started work (its member reported or took input), a child, and an ended ticket.
- **Members cannot split.** A member that sees the work needs parts reports a question; the router may then split if the request asks for it.

### S2. What a split does

- **Parent.** The ticket stays as the parent. The executor takes it back from its member: an assignment not started is never launched, and one that started is stopped with a note. It assigns the parent to nobody after that: the parent only coordinates.
- **Children.**
  - For each part, the host files an internal request: source `workbench`, actor `split:<parent>`, text = the part's scope, on the parent's thread. It decides that request `accept` at once, with the part's title and scope and the parent's rules. The router's split is the decision, so no router turn is spent per part.
  - The child is assigned like any ticket (to `member` when named).
  - The host records `parent → children`, persisted next to the executor's state.
- **Progress.** The parent's progress steps list the children in `tickets`: each child's title, seat and state, then `ended` with its outcome. While children run, the parent's own state is `working`.

### S3. Questions, follow-ups and receipts

- **A child's question** reaches the requester the way a ticket's question does: an attention receipt on the requester's task (`attention-<task>-<qid>`), with the part named in the text and its options.
- **The answer** comes as a new task in the same context, as any answer does. The host attaches it to the child that asked: the open question's ticket on that context. The light path applies.
- **A child never sends the formal receipt.** Its replies are held like an open ticket's (follow-ups), and only the parent's end sends `receipt-<task>`.

### S4. How the parent ends

- **When.** When every child has ended, the host ends the parent with a combined report: it marks the parent's assignment started and reports on it, as a member would.
  - **Every child completed:** a `ready` report whose summary lists each part (title, the seat that did it, its result line).
  - **Any child failed, was dropped or was stopped:** a `failed` report that lists every part with its outcome ("部分完成").
- **The requester's receipt.** `receipt-<task>` carries that summary, the outcome (`completed` or `failed`), `by` (the router, role `router`, since the parent coordinated) and `tickets` (each child with its seat and outcome).
- **A redo** is a new dispatch from the requester. The host does not retry a failed part on its own.

## Consequences

- **The requester sees one task throughout:** its children in progress, their questions, and one result. Nothing changes in the market's fields.
- **The router's boundary moves only as far as the owner ruled.** It splits, it does not plan or do the work, and the host checks that the request asked for parts.
- **Not in this design:**
  - splitting at a member's initiative;
  - nested splits (a child cannot be split);
  - moving work between parts;
  - per-part results sent separately (a part's result is in the combined one).
- **Order.** One PR, high tier (the router's boundary and the receipt path): persona + `superagent_split` + executor hold + children + combined end. Then the trial runs an item that asks for two parts.
