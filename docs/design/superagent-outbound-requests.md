# superagent: asking another team, on an approved card

Status: agreed with the owner on 2026-11-11. The owner asked for the channel: 「加一个受控的对外通道……由主机代为发出，对方的回执再作为跟进消息回到原工单」. The owner also asked that 「需要允许 superagent 成员审批角色可以帮忙审批」.

## Context

A team session holds one team role. It sits in no other canvas, and its sessions neither send nor receive A2A work themselves (role-tools; `[superagent-team-canvas]`). Other teams reach a superagent team at its canvas address, but the team itself had no way to ask another team for anything. A member that needed another team's help could only hand the ticket back, or put the need to the owner, who then had to send it by hand from a session of their own.

## Decisions

- **O1 Asking.** Every team session has `a2a_outbound_request { ticket_id, address, text, why }`. The router may ask on any open ticket. A member or an observer may ask only on a ticket it holds. The address is another team's: `<zone>/<id8>`, or `<zone>/canvas/<name>`, optionally followed by `@<fp8>`. The team's own address and its own sessions are refused, and the team's A2A Source must be on, since its identity is what sends.
- **O2 A P0 card.** The request becomes a P0 decision card with source `outbound`. The card shows who asks, the ticket, the address, the exact text and the reason. Its options are `批准：以团队名义发出` and `拒绝`. P0 cannot be approved with one click. A ticket has at most three outbound requests waiting or in flight.
- **O3 Who decides.** The owner decides on the team page, as for any card. Team settings also carry `approvers`: members or observers of this team whom the owner lets decide outbound cards. The setting is owner-only, like a rule change (D10), and the router cannot be an approver. An approver decides with `a2a_decision_decide { card_id, option, reason }`. It can decide only outbound cards, never a card it proposed itself, and only with a reason. The decision records who decided.
- **O4 Sending.** On approval the host sends the approved text and nothing else. It goes from the team's A2A identity, under a header line naming the team and the ticket. It is an ordinary route, so the receiving host's admission and the receiving team's policy apply. The host records which task belongs to which ticket. If the send fails (the address is not reachable or not admitted), the failure is added to the ticket as a note. *Sender scope (owner ruling 2026-11-12):* the team's A2A identity sits in no canvas team, so it declares no scope of its own; an approved card is its scope for the card's exact address while the host sends that card, and for nothing else. Signature, deposit and the receiving host's admission still apply.
- **O5 The answer.** The other team's formal receipt on that task reaches the original ticket as a note, the same way a review verdict does. Only receipts with a trusted proof count. The task then counts as answered.

## Consequences

An approver is an agent: letting it decide trades the owner's attention for speed. The owner chooses who it is, can take the role away in settings, and sees every decision with its reason. The text that leaves is the text on the card; no ticket content goes with it. A reply that arrives as a message rather than a receipt starts a thread of its own, as any message to the team address does. Remote members are not approvers: an approver must be a session on this host.
