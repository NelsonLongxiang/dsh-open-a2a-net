# superagent: re-evaluate a message, and the router's note to a ticket

Status: proposed on next/0.8 (owner 2026-11-08: "是的，那么开始吧" after the router acceptance). It exposes two operations of
the vendored upstream engine that a2a had no entry for. The engine itself is unchanged.

## Context

The router acceptance (RJ1–RJ8) showed the router can misjudge, as it did before #456. Today a person who sees a wrong
`ignore` can only ask the requester to send the message again, and the router has no way to hand a member a fact it learned
after accepting a ticket except by attaching a whole message. Upstream's engine has both: `Engine.reevaluate(triggerId)` ("a
person's replay") and `Engine.note(ticketId, text)` ("a fact the main Session gives an open ticket's Executor").

## Decisions

- **D1 Re-evaluate is the owner's.** The superagent control route takes `{ action: 'reevaluate', trigger_id }` (owner
  credential, as `stop` and `retry`). It calls `engine.reevaluate`: the stored trigger is queued for a fresh Eval on its
  thread; while an Eval still holds it the answer is `queued: false`; an unknown trigger is refused. Upstream's semantics are
  kept for a person's own messages (the workbench Source): any judged one may be re-evaluated, and the router decides again
  with the thread's tickets on its card (an accepted request re-evaluated is a duplicate the router attaches or ignores).
  An A2A message whose sender already has its formal outcome (#431's `rejected` or `completed` receipt, or the ticket's
  result) is refused (`answered`): its task is settled, and a later decision could not be its outcome. The sender sends it
  again. In practice that is every A2A message the router ignored, since the rejected receipt goes out within a pass.
- **D2 The router is told it is a second look.** A candidate whose trigger a person requeued says so on its card ("a person
  asked for a fresh judgement of this message"), so the router does not treat it as new traffic.
- **D3 Where the owner does it.** The 团队 page offers 「重新判断」 on a thread's `ignore` and `unavailable` decisions (the
  common case: the router turned down something it should have taken); the CLI has `a2a-net superagent reevaluate
  <trigger_id>` beside `request` and `state`.
- **D4 The router's note.** A new router tool `superagent_note { ticket_id, text }` calls `engine.note`: an open ticket gets a
  `note` input, delivered to its member as "note from the router: …". It informs and grants nothing (upstream marks a note an
  automatic input: it cannot end, stop or widen the ticket). An ended or unknown ticket is refused. It joins `ROUTER_TOOLS`;
  the router preset's persona and the candidate card mention it.
- **D5 Not exposed:** `dismiss` (a2a lists no `unavailable` decision as a standing problem, so there is nothing to dismiss)
  and `unsubscribe` (rare with a2a's Sources). They stay engine-only until a surface needs them.

## Also fixed here

The router preset's persona still said `attach` is only for "the ticket a message explicitly points at"; since #456 the card
says a request that asks again for work under way is attached. The persona now says the same.

## Consequences

- A person's misjudged message is corrected in place; the person writes nothing again.
- An A2A requester whose message was turned down still has to send it again: re-evaluation never reopens a settled task.
- The router can keep a running ticket's member informed without opening work.
- Deferred: `dismiss` and `unsubscribe`; a person-side note (a person writes on the ticket's thread instead).
