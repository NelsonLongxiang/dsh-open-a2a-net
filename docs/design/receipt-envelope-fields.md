# Receipt envelope: who, what, and a question that does not end the task

Status: agreed with the workbench market on 2026-11-11 (its items N1c, N1d and N2c). The market's goal: people use only the market, and the nodes do the work headless. The market needs a receipt to say who took the work up and what it produced. It also needs a question to come back in a form it can read, and the result after the question still to arrive with a machine outcome.

## Context

A receipt is `[A2A receipt] task <id> <one line>` plus one JSON envelope line ([receipt-envelope-v2](receipt-envelope-v2.md)). Today the envelope can say `outcome`, `disposition` (`result`, `attention`, `acknowledged`) and a few audit keys. Every reader ignores keys it does not know.

The gaps:

- A result names nobody. The requester cannot tell which seat did the work or where the products are.
- An `attention` receipt rides `receipt-<task>`, the task's one formal receipt, and settles the task. After that, the result can only come as prose. superagent works around this by sending a ticket's question as a follow-up route (`a2a-<hash>`). That route owes a receipt of its own, holds one of the requester's three queue slots, and is tied to the request only by context.
- A question is a paragraph of text. The requester cannot offer the person a choice.

## Decisions

### D1. Three added envelope keys

All three are additive: every older reader ignores them.

| Key | Shape | On |
|---|---|---|
| `by` | `{seat, seatId?, name?, team?, role?}` | any receipt; superagent sets it on acknowledgements, questions, progress and results |
| `artifacts` | `[{kind, id, title?}]`, at most 16; `title` is display text for people (added 2026-11-11) | any receipt; `kind` such as `table`, `file`, `sop-run`, `id` in the requester's system |
| `question` | `{id, text, options?, default?}` | `attention` only; dropped on any other disposition |

- **`seat`** is the seat's A2A handle (`<zone>/<id8>`), or its session id where the host has none. `name` is its display name.
- **`seatId`** is the seat's stable id (superagent's `seat-<8 hex>`, the same as the roster's `seatId`; added 2026-11-12 for the market, which keys its assignments on it). It outlives the session behind the seat, which `seat` does not. 1 to 64 of `A-Z a-z 0-9 . _ : -`; `--by-seat-id`.
- **`role`** is `router`, `member` or `observer` (added 2026-11-11 for the market, which shows only the seat that does the work). superagent names the router until a member holds the work: on an acknowledgement and on a `queued` progress step it is the router.
- **Limits.** Strings are at most 200 characters, a question's text at most 2000, a question has at most 6 options, and a question id is at most 24 characters of `[A-Za-z0-9._:-]`.
- **Malformed values** are dropped key by key, never the whole envelope.
- **`artifacts`** are ids the work wrote into the requester's system (through its MCP, for the market). The node does not check that they exist.

### D2. An attention with a question rides its own task id and settles nothing

- **Task id.** It rides `attention-<task>-<question id>`, as an acknowledgement rides `ack-<task>`.
- **On the requester's ledger** it marks the owed row exactly as an acknowledgement does: no waiter is answered, no outcome is recorded, the row leaves the queue count, and it expires 7 days after the mark.
- **More questions** may follow, each with its own id. The task's `receipt-<task>` still carries the result, with its outcome.
- **An attention without a question** keeps its old meaning: it is the formal receipt and settles the task.

### D3. Switches

`a2a-net receipt` and the host's team face (the canvas path superagent uses) read the same switches:

- `--by SEAT [--by-name N] [--by-team T]`
- `--artifacts KIND:ID[,…]`
- with `--attention`: `--question-id ID [--options 'A|B'] [--default X]`; the receipt's one line is the question's text.

A malformed switch exits 2 and sends nothing.

### D4. superagent uses it

- A ticket's question goes out as an attention receipt with `question.id` cut from the ticket's attention id (12 characters). It no longer goes as a follow-up route.
- When the task id leaves no room under 80 characters, or the formal receipt already went out, it goes the old way.
- Acknowledgements and receipts carry `by`: the ticket's member once one holds it, otherwise the router.
- superagent sets no `artifacts` yet. A member's report has no field for them; that comes with the progress work (N2a/b).

## Consequences

- **Older receivers** settle the row on the question, as they did before. The result then arrives as a late receipt that updates the settled row: the same fallback an acknowledgement has.
- **The market** answers a question as a new task in the same context, as before. The question no longer owes a receipt.
- **Not in this change** (deferred):
  - progress messages (`progress-<task>-<n>`, N2a/b);
  - a member's artifacts;
  - the roster report (N3).
