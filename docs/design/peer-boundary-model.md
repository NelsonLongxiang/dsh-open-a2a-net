# Peer Boundary Model — who may connect to peer nodes and pass messages

> Status: design ratified 2026-09-02 (owner directive). Implementation: this PR.
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

## Non-goals / follow-ups

- The `caller_session` field is still wire-declared, not signature-bound: a
  malicious peer can claim a session handle it does not own, and Layer 3 (not
  the signature) is what stops it. Binding the field to the verified card
  handle is the next slice (needs the OriginClaim envelope from
  docs/protocol/delivery-origin-auth.md).
- Peer-plane allowlist covers learning; fetching an already-tracked peer whose
  host later falls out of the allowlist is left to quality-score eviction.
