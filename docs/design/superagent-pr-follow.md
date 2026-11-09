# superagent: a ticket follows its pull request, and asks for review

Status: proposed on next/0.8 (owner 2026-11-08: the spec audit's ticket-follows-PR and review-channel items go into one design). It builds on the v5 canvas team and on the executor's parked Assignments. The vendored engine is unchanged.

## Context

Upstream's definition: a ticket that opens a pull request follows it. `ready` hands the result to a person; the ticket ends when the pull request merges or closes, and review comments reach the worker in between. In a2a a member's `ready` ends the ticket at once, so:

- the requester's outcome is "completed" while the change is only proposed;
- a review comment reaches nobody, and the fix is a new ticket with no history;
- the review a high-tier change needs is arranged by hand (spec section 4, the plan's `p4-review-request`, never built).

The engine already has what this needs: `bindThread(ticket, thread, own)`, `threadClosed(thread, outcome, at)`, and a `ready` that ends a ticket only once `followsDone` holds. Nothing calls them.

## Decisions

- **D1 The member names its pull request.** `a2a_ticket_report` gains `pull_request` (a URL). With `ready`, the host checks it is a pull request of the ticket's repository and calls `bindThread(ticket, { source: 'github', id: '<owner>/<repo>#<n>' }, true)` before the report. A ticket with no pull request ends at `ready`, as today.
- **D2 The ticket waits without a member.** The member's `ready` parks the Assignment, so a change under review holds no slot. Page and receipts read 待你查看 / acknowledged until the pull request ends.
- **D3 The host reads the pull request.** For tickets that follow one, a poll (default 60 seconds, only while such a ticket is open) runs `gh api` on the team host, under the `gh` login its operator set up. The plugin stores no token. Merged or closed calls `threadClosed` with GitHub's time, and the engine ends the ticket `merged` or `closed`. A failed poll is retried and shown on the team page; it never ends a ticket.
- **D4 Review comments come back.** Each new review or comment becomes a Trigger on that thread, so it fans out to the ticket and brings its member back first. A person's comment counts as a person only if the login is in `allowed.github`, which is empty by default; the rest are context. Bot comments and CI are context in this version: they inform and cannot resume, stop or widen the ticket.
- **D5 Asking for review.** `settings.reviewer` names one A2A address, set by the owner and required to be in the owner's link set; empty means no request is sent. When a ticket binds a pull request and a reviewer is set, the host routes one review request naming the repository, the number and the exact head SHA. A new head after the request supersedes it and a new request goes out.
- **D6 The verdict.** The reviewer's formal receipt is the verdict: `completed` with `PASS` at that SHA, or anything else as not passed. It reaches the ticket as a note and shows on the team page. It is advice to the person who merges: **no member or host merges**.
- **D7 Everything is reviewed in this version.** With a reviewer set, every pull request from the team gets a request. Tiering by path or label comes later if volume needs it.

## Outbound boundary

Spec S25 allows the team to send only to the sender that triggered it. D5 is the first exception, and it is narrow: one address the owner configured, in the owner's link set, carrying a public pull request reference and no ticket content. The spec's section 4 anticipated this and leaves it for the owner to confirm.

## Not in this design

- GitHub as a Source of new work (an issue or mention opening a ticket).
- `markUnrelated` and `followForContext`, until a thread can drift from its ticket.
- Merging, and any change to who may merge.

## Questions for the owner

1. D3 and D4 run `gh` on the team host under its operator's login. Is that the account to use? (Recommended: yes for now.)
2. D5 is an exception to S25. Confirm it. (Recommended: yes, one owner-set address.)
3. D4's `allowed.github`: which logins count as a person? (Recommended: the owner's only.)

## Consequences

- A ticket's outcome says whether the change actually landed.
- Review comments reach the member that wrote the change, with its history.
- A ticket can stay open for days: it holds no slot, but the team page lists it until the pull request ends.
- Deferred: tiering, CI as an Input, and a person's review requested from GitHub itself.
