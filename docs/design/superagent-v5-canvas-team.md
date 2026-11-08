# superagent v5: the team is a canvas team

Status: implemented on next/0.8 (#441, #442, #443, #444, #445, and the upgrade-path fixes found in acceptance). It builds on design v4 ([superagent-a2a-adr](superagent-a2a-adr.md), [superagent-a2a-spec](superagent-a2a-spec.md)); v4's domain model, its two-layer split and its role isolation are unchanged.

## Context

Acceptance found that the superagent team was never composed on the canvas: one concept, "team", had two forms.

| | A2A canvas team | superagent team (v4) |
|---|---|---|
| Composed | by the owner in the planning view (建队) | by naming a router and members in the team settings |
| Address | `<zone>/canvas/<name>` | a CLI identity `superagent-team/<16 hex>` the host held |
| Members on other hosts | canvas remote references, keys pinned | a separate `add-remote-member` |
| Member host side | — | a separate `serve-team { peer }` |

## Unchanged from v4

1. a2a is the transport layer, superagent the domain layer. Canvas admission answers who may deliver bytes to this host; the team's Policy (allowed persons, bot list, accept mode and rules) alone answers who may make the team work.
2. Only the engine reaches role sessions: a direct route to the router or a member is refused.
3. One request is one ticket; a fixed member pool, one slot per member; the router and members run their own agent presets.

## Decisions

- **D1 The team is one canvas team on the team host.** The owner composes it on the canvas and binds it in the settings (`canvas`, `router` — one of its local sessions). The members are the canvas's other local sessions and its remote slots, derived on every read and never stored; `add-remote-member` is gone. A canvas change is a pool change.
- **D2 The team's address is its canvas address.** A route to the bound canvas (bare, or qualified with the owner's fingerprint) lands in the team's mailbox, never in a member session. The team's receipts and follow-ups go out from the team host's process face with `onBehalfOf` spelled exactly as the requester addressed it, so the requester's ledger settles them as host-face. The identity that holds the mailbox is internal: a route straight to it is refused. A sync route answers at once, delivered.
- **D3 Transport admission** (owner ruling Q1): the bound canvas takes requests from callers linked to the host (a CLI identity deposited there, an operator's canvas remote reference, a session of the host that declares a team); the Policy decides what becomes work. A teamless session still has no network.
- **D4 Member hosts serve a team by its canvas id** `<zone>/canvas/<name>@<fp8>`: the fingerprint picks the linked peer whose signed card has that key and advertises that canvas; that key is pinned. It is the member host owner's consent.
- **D5 A member removed mid-ticket** (owner ruling Q2) loses its assignment — stop notice, then a new assignment on another member. A member that already reported ready is only let go.
- **D6 The planning view** marks the bound canvas frame `superagent 团队` and the router's and members' cards with their role (and repository).
- **D7 One name:** "team" means the canvas team everywhere — settings, address, member hosts, documentation.

## Review points folded in

- R1 `onBehalfOf` is the requester's own spelling of the address; R2 the canvas address is resolved before any member is chosen or a remote member is tried, on the wire face and the same-host dispatch; R3 one session, one team role — the team canvas takes no session holding another role, a team session joins no other canvas; R4 the team canvas takes no CLI handle; R5 sync routes answer at once; R6 a mid-ticket removal stops and re-assigns through the engine's public calls; R7 the mailbox cap is v4's.
- Requesters on other hosts: the team host's card marks the bound canvas `superagentTeam`, a requester host's sender scope lets a session that declares a team route there, the team identity's admission recheck treats a confirmed, key-pinned canvas reference as the link for its bare handle, and a requester host admits the team's host-face receipt as the answer to that one request only (its sender, its canvas, the peer key and process label the request was born on).

## Acceptance findings fixed

- F1 after an upgrade the stored router could not join the canvas meant to become the team (the one-role check refused it while nothing was bound);
- F3 while unbound the derived pool reads empty and the first canvas write moved running tickets off their members — now nothing moves until a canvas is bound;
- F4 a serve stored before agent presets kept assigning work to a session on another preset — now refused (a stop still reaches it) and reported.

## Upgrading

A host that ran a superagent team before v5 starts unbound: the stored router stays, the stored pool is dropped, and running work stays where it is. The owner composes the team on the canvas (router and members on their presets) and binds it; requesters then use the canvas address. Member hosts serve the team again with `serve { team: <canvas id> }`.

## Consequences

- One concept, one address, one way to manage members; the team is visible on the canvas; acceptance covers composing the team for real.
- The team's replies moved from a CLI identity to the host face, with a narrow receipt admission on requester hosts.
- Deferred: a canvas team co-owned by several hosts (the team always belongs to its team host).
