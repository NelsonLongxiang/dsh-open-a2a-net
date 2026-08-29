# Protocol: Delivery Origin Authentication — Minimal OriginClaim Envelope

- **Status**: proposed (work-order P5 / ROUND-2 Cluster C1); field evidence
  2026-08-30 confirms tier three is still unenforced (see below)
- **Owner**: dsh-open-a2a-net (protocol face)
- **Gate**: hub-strategy GA precondition — see §6

> **Field evidence (2026-08-30, defect card F4).** An unjoined session on a
> production home hand-POSTed `wait:false` deliveries — no credentials — to a
> loopback bind and across hosts to `192.168.3.157:13080`; both answered
> `routed/delivered/consumed:true`. Until the envelope lands, the honest
> mitigations are: set `apiKey` (header-authenticates control **and** direct
> routes), or bind to loopback only. Nodes seeded with non-loopback peers and
> an empty key now log a boot warning (`directDeliveryExposure`).

## 1. Motivation

The governance model (round-trip: captain-mediated teams, exposure grants,
visible-not-addressable members) rests on three enforcement tiers:

| Tier | Mechanism | Strength |
|---|---|---|
| Discovery | internal member names never published as routable | structural |
| Resolution | member names are team-private; zone walk fails closed (`not-found`, no existence leak) | structural |
| Delivery | `/a2a/direct` validates caller ∈ inbound-edge set of verified cards | **best-effort today** |

Tiers one and two cannot be bypassed remotely by construction. Tier three is
honest debt: there is no out-of-band caller identity on the wire, so a
network-positioned sender can claim any granted URL. This document closes
that debt with the smallest envelope that composes with existing primitives.

## 2. Object

```ts
/** Rides every cross-host delivery payload. Absent ⇒ legacy behavior. */
interface OriginClaim {
  readonly url: string        // claiming base URL (the granted anchor)
  readonly publicKey: string  // base64 SPKI of that node's card key
  readonly nonce: string      // ≥16 bytes random hex, unique per delivery
  readonly ts: number         // epoch ms at send time
}
```

## 3. Verification flow (verification against published keys, not handshakes)

1. Receiver consults its card cache for `claim.url`
   (60 s positive / 30 s negative TTLs already deployed).
2. Cache hit with a verified card ⇒ require `claim.publicKey === card.publicKey`;
   mismatch ⇒ reject `untrusted-origin`, **fail closed**.
3. Cache miss ⇒ one verified-card fetch, then rule 2; negative outcomes reject
   `untrusted-origin`.
4. Replayed nonce within the receiver's dedup window (§7) ⇒ reject
   `replayed-claim`.

No second round trip is added in steady state. A full challenge–response
(receiver-issued nonce) is reserved for the v2 escalation path and triggers
only when a claim verification is inconclusive but the source is plausible.

## 4. Fail-closed matrix

| Condition | Outcome |
|---|---|
| claim absent, node policy `requireOriginClaim=true` | reject `untrusted-origin` |
| claim absent, legacy window (policy off) | accept + flag `legacyInbound:true` in state facts |
| claim present, key mismatch / unreachable / rejected card | reject `untrusted-origin` |
| claim present, fresh cache hit, keys equal | accept |

## 5. Caller-side construction

Senders already hold the peer's verified card before routing (card cache);
claim fields are read from that cached object. No new secrets are exchanged:
the Ed25519 card key remains the single identity anchor, matching the
delegation model's key-pinning semantics.

## 6. Hub gating rule

Hub-strategy groups whose members span more than one host MUST run behind an
origin-claim-enforcing receiver (policy `requireOriginClaim=true`) to leave
same-host-only status. Same-host membership needs no wire identity and is
explicitly allowed without this document's machinery.

## 7. State and TTLs

- Nonce dedup window: 10 minutes in-memory ring per receiver.
- `ts` skew tolerance: ±120 s against receiver clock.
- Both values are protocol constants here; implementation knobs only widen
  them for tests.

## 8. Acceptance criteria

1. Forged origin URL delivery rejected at cache-hit speed with machine-checkable code; zero additional HTTP requests in the cache-hit path (cache metrics comparison).
2. Legacy peers (no claim) keep flowing during the transition window and their deliveries appear flagged in `/__dsh_a2a/state`.
3. Cancellation route (`/a2a/cancel`) reuses this exact verification — no separate auth story.
4. Zone walk and discovery tiers are untouched (structural tiers stand alone).

## 9. Explicit non-goals

- Mutual TLS or key rotation ceremony.
- Federation-wide PKI beyond the existing signed-card web.
- Per-user identity: the unit of trust stays the node.
