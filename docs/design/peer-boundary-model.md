# Peer Boundary Model — who may connect to peer nodes and pass messages

> **Implementation status (2026-10-27, as of ae7e24d / 0.6.28): implemented,
> with Layer 3 since tightened.** Layers 1–2 shipped in 2c46a20
> (2026-09-02) and still hold. Layer 3's remote-zone card-cache basis and
> its fail-open-once window were removed by gh#7 (14bcce1, 0.6.20). The
> caller-signature follow-up shipped as OriginClaim (0.6.23) in a narrower
> form than this doc anticipated. Both are marked inline as
> *[2026-10-27 note]*.
>
> Status: design ratified 2026-09-02 (owner directive). Implementation: this PR (2c46a20).
> Scope: the three layers of the peer plane (connection / identity / delivery),
> each independently gated, defaulting to the historical open posture unless
> the operator tightens it.

## The question this model answers

"谁能连接对等节点传递消息" — who can connect to peer nodes and pass messages.
The answer has three layers with three different gates; conflating them is how
the anonymous-injection hole (2026-09-02, probed four times live) happened.

## Layer 1 — Connection (who enters the peer store)

- **Seeds** (`peers` config): owner-configured, always trusted, unaffected by
  every gate below.
- **Referral learning**: a fetched card's referral URLs join the bounded
  quality-scored store. Two gates, both owner-set:
  - `referralLearning: false` — referrals are neither learned nor offered; the
    tracked set stays the seed set for the config's lifetime.
  - `peerAllowlist: [...]` (non-empty) — a referral is learnable only when its
    host matches an entry: exact host[:port], bare domain suffix, or the full
    URL. Empty list = the historical open posture.
- Enforcement point: the single referral-offer site in the discovery settle
  path (`peerStore.offer` is not called for a non-admissible URL).
- *[2026-10-27 note: gh#46 (db48ec2) added an eviction cooldown. A
  non-seed peer that scores down to the floor and is evicted is refused by
  `peerStore.offer` for 24 h, so a linked card's referral cannot bring it
  straight back. The ledger keeps the newest 64 evictions
  (`src/peer-store.ts`).]*

## Layer 2 — Identity (who may address anything)

- When `teamScopeRouting: true` (the default), EVERY inbound direct delivery
  MUST carry a non-empty `caller_session`. Anonymous deliveries — missing or
  empty field, session-node target or bare process team — are refused up front
  (`caller_session is required — anonymous deliveries are refused`, -32000,
  S3 phase-3b). This closes the anonymous-injection hole where a missing field
  skipped the whole admission gate (probed live four times on 2026-09-02).
- A present caller_session is then judged by Layer 3.

## Layer 3 — Delivery admission (S3, pre-existing)

- `teamScopeRouting: true` (default): the caller and the target must share a
  team. Local-zone callers are judged from this host's roster synchronously;
  remote-zone callers from the card cache, with a fail-open-once miss-learning
  window (pinned by tests).
- Teamless callers are refused with the phase-3 admission text.

*[2026-10-27 note — Layer 3 as implemented (`a2aCallerRefusal`,
`sameZoneSharedTeamRefusal` in `src/index.ts`):*
- *Same-zone handle (`<zone>/<id8>`): declared teams are the union of
  roster declarations and canvas memberships. Admission requires an
  intersection with the routed **target** team, not just any shared team
  (F5).*
- *Foreign-zone handle: admitted **only** through a canvas remote member
  ref that this host's operator added by hand. The card cache is no longer
  a basis, since a card is the caller's own claim. First-contact
  learn-and-admit and its fail-open window were removed in gh#7
  (14bcce1).*
- *Free-form label: admitted only as this host's own node fact: a joined
  session, a live node label, or a deposited CLI handle (gh#45). It skips
  the team intersection.]*

## Non-goals / follow-ups

- The `caller_session` field is still wire-declared, not signature-bound: a
  malicious peer can claim a session handle it does not own, and Layer 3 (not
  the signature) is what stops it. Binding the field to the verified card
  handle is the next slice (needs the OriginClaim envelope from
  docs/protocol/delivery-origin-auth.md).
  *[2026-10-27 note: the envelope shipped in 0.6.23, but the M2
  third-round ruling deliberately does **not** bind `caller_session` to
  the signature. The envelope names a bare zone only, and the session
  handle stays in the body, judged by N3/S3 against this host's records.
  The prefix-binding variant opened an impersonation chain. So this item
  is closed by ruling, not pending.]*
- Peer-plane allowlist covers learning; fetching an already-tracked peer whose
  host later falls out of the allowlist is left to quality-score eviction.
