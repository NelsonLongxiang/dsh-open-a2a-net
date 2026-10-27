# Protocol: Delivery Origin Authentication — Minimal OriginClaim Envelope

> **Implementation status (2026-10-27, as of ae7e24d / 0.6.28): implemented** —
> shipped in 0.6.23. Code: `verifyOriginClaim` and `callerLinkedToThisHost`
> in `src/index.ts`; the client stamps the envelope in `src/a2a-client.ts`.
> Drift from the text below is marked inline as *[2026-10-27 note]*: R1
> (two cache forms) was superseded by the M2 third-round ruling, the
> "linked" basis is the three bases of `callerLinkedToThisHost`, and there
> is no `/a2a/cancel` route. The transition window is still open by default
> (`originClaimWindow: true`).

- **Status**: **adopted (review-seat R2+gh#10 ruling, 2026-10-21; claims 59038996d0/50162f7aa7)** —
  v1 shape below as ruled; implementation rode the gh#9+gh#10 release (0.6.23)
  (same version both sides + one fleet restart window; **no dual-track** —
  never "shape-valid OR signature-valid")
- **Owner**: dsh-open-a2a-net (protocol face)
- **Gate**: hub-strategy GA precondition — see §6

> **Provenance.** Field evidence 2026-08-30 (defect card F4): an unjoined
> session hand-POSTed credential-less `wait:false` deliveries to a loopback
> bind and across hosts; both answered delivered. Since then, three layers
> landed on this line — gh#7 V2 (apiKey gates `/a2a/direct` + `/a2a/log`),
> gh#7 V3 (N3 record-based admission), and G1 (two card faces: minimal for
> anonymous, full for "named"). G1's named face is self-asserted — exactly
> the hole this ruling closes. The ruling adopts this envelope with two
> refinements over the 2026-10 proposal: (i) the **timestamp window
> replaces nonce dedup** (§3/§7) — the receiver stays stateless; (ii) §10
> adds the CONTROL-face counterpart (gh#9) with its own mechanism — the two
> faces differ by who can hold a credential, and the ruling requires that
> difference be stated, never conflated.

## 1. Motivation

The governance model (round-trip: captain-mediated teams, exposure grants,
visible-not-addressable members) rests on three enforcement tiers:

| Tier | Mechanism | Strength |
|---|---|---|
| Discovery | internal member names never published as routable | structural |
| Resolution | member names are team-private; zone walk fails closed (`not-found`, no existence leak); team names bind only to operator-linked hosts (gh#8 N9) | structural |
| Delivery | the caller proves it is the host it names — this envelope | **signed-envelope (this doc)** |

Tiers one and two cannot be bypassed remotely by construction. Tier three
was honest debt: a network-positioned sender could claim any granted URL —
and, since G1, type any zone name to read the full card. This document
closes that debt with the smallest envelope that composes with existing
primitives.

## 2. Object

```ts
/** Rides every cross-host delivery payload and the full-card request. */
interface OriginClaim {
  readonly caller: string       // BARE ZONE only (third-round ruling: a
                                // zone/id8 envelope is bad-caller-shape —
                                // session-level identity rides the body's
                                // caller_session, judged by N3/S3 against
                                // the published roster; a same-zone foreign
                                // host must not be able to sign a session
                                // handle and prefix-match its way in)
  readonly callerUrl: string    // the caller's own card base URL
  readonly ts: number           // epoch ms at send time
}
/** HTTP headers carrying it (bodyless GETs need headers):
 *  X-A2A-Caller:     <caller>
 *  X-A2A-Caller-Url: <callerUrl>
 *  X-A2A-Caller-Ts:  <ts>
 *  X-A2A-Caller-Sig: base64(ed25519-sign(canonical(claim)))
 *  — canonical(claim) = JSON.stringify([caller, callerUrl, ts]) (R2:
 *  a structured canonical form, not naive '|' concatenation — delimiter
 *  ambiguity between fields is unforgeable by construction).
 * The signing key is the CALLER'S CARD KEY (single identity anchor).
 */
```

## 3. Verification flow (verification against published keys, not handshakes)

1. Receiver consults its card cache for `claim.callerUrl`
   (60 s positive / 30 s negative TTLs already deployed); cache miss ⇒ one
   verified-card fetch via `verifyCard` (existing infra, shared cache).
   **R1 — cache forms**: the cache stores BOTH card faces separately
   (minimal vs full, keyed by fetch-time envelope presence). Signature
   verification needs only the minimal face (publicKey is signed core);
   caller-derivation for a `zone/id8` shape needs the FULL face
   (sessionTeams is unsigned served-fresh). A cache hit on the minimal face
   during an envelope verification MUST trigger one re-fetch of the full
   card through our own envelope (warm cost: one round trip, cache-warm
   signature) — otherwise a legitimately named caller fails closed on a
   form mismatch that proves nothing.
   *[2026-10-27 note: superseded by the M2 third-round ruling. The envelope
   names a bare zone and derivation is the exact match `card.team ===
   caller`, which the minimal card's signed core already answers. The code
   fetches the caller card plain, with one URL-keyed card cache and no
   second cache form and no full-card re-fetch (`verifyOriginClaim`,
   `src/index.ts`).]*
2. Verified card ⇒ the envelope signature MUST verify against THAT card's
   `publicKey`, and `claim.caller` must equal `card.team` EXACTLY (bare
   zone; the third-round ruling narrowed the shape — see §2). Mismatch or
   unverifiable ⇒ **fail closed** — minimal card on the card face (G1 v1
   posture), `untrusted-origin` rejection on the delivery face.
3. `ts` within **±5 min** of the receiver clock (stateless window — the
   ruling's refinement over nonce dedup: no receiver-side replay ring; a
   replayed envelope inside the window is a re-authenticated same-caller
   retry, which the idempotency layer already dedups where it matters).
4. No second round trip in steady state. Challenge–response stays a v2
   escalation path only.

The caller's card at `callerUrl` is **self-proving**: it is signed by the
same key that must sign the envelope, so a fake URL serving a real key's
card is impossible without that key, and a fake key gains nothing — its card
certifies only itself, an unlinked nobody that N3/N9 already gate.

## 4. Fail-closed matrix

| Condition | Card face (gh#10) | Delivery face |
|---|---|---|
| envelope absent, transition window open | minimal card (G1 v1 posture) | N3 admission as today + `legacyInbound` warn metric |
| envelope absent, window CLOSED | minimal card | **reject `untrusted-origin`** — same code as signature failure (M1) |
| envelope present, key mismatch / unreachable / rejected card / bad `ts` | **minimal card** | reject `untrusted-origin` |
| envelope present, verified, caller linked (N3/N9 basis) | full card | accept |

*[2026-10-27 note: "linked" on the card face is `callerLinkedToThisHost`,
which has three bases: (1) same-host membership, meaning the caller's card
URL origin equals ours or the caller is one of our joined session handles;
(2) the caller is an exact remote ref on one of our canvas teams (#19 D1,
exact handle only); (3) bilateral seeding, meaning our `config.peers`
seeds the caller's origin and the caller's card lists ours. A verified
caller with none of these gets the minimal card.]*

No dual-track: a valid SHAPE never substitutes for a valid SIGNATURE
(ruling: "shape-valid or signature-valid" leaves m1's self-asserted zone
open — forbidden). **M1 closes the envelope-absent hole on the delivery
face**: N3 checks the LINKABILITY of a caller NAME, not possession of the
key behind it — after the window, an attacker who merely self-asserts an
already-linked name with no envelope must land on `untrusted-origin`,
exactly like a failed signature; during the window the legacy path stays
with a counted warn so operators can see the tail drain.

## 5. Caller-side construction

Senders already hold their own card key (the node keypair) and know their
base URL; claim fields cost one local signature. No new secrets are
exchanged: the Ed25519 card key remains the single identity anchor, matching
the delegation model's key-pinning semantics. The a2a client stamps the
envelope on card GETs and direct POSTs alike.

## 6. Hub gating rule

Hub-strategy groups whose members span more than one host MUST run behind
an origin-claim-verifying receiver to leave same-host-only status.
Same-host membership needs no wire identity and stays allowed without this
document's machinery.

## 7. State and TTLs

- `ts` skew tolerance: **±5 min** (protocol constant; test knobs may widen).
- No nonce ring, no receiver-side state (ruling refinement).

## 8. Acceptance criteria

1. Forged origin URL delivery rejected at cache-hit speed with a
   machine-checkable code; zero additional HTTP requests in the cache-hit
   path.
2. Card face: an anonymous or self-asserted name never reads
   sessionTeams/teamMemberships/lanIp; a verified linked caller always does.
   *[2026-10-27 note: the minimal face also withholds `canvasOrg` (gh#41).]*
3. Cancellation (`/a2a/cancel`) and the log face reuse this exact
   verification — no separate auth story.
   *[2026-10-27 note: no `/a2a/cancel` route exists. A remote cancel is a
   stop-notice delivered through `/a2a/direct` (`client.routeDirect`), so it
   rides the direct face's envelope check.]*
4. Zone walk and discovery tiers are untouched (structural tiers stand
   alone).
5. One restart window flips the whole fleet (same version both sides);
   before the flip, cross-version full-card reads degrade to minimal —
   never to open.
6. (M1) After the window closes, a delivery with a shape-valid,
   already-linked caller name but NO envelope rejects `untrusted-origin`
   (regression pin: the attacker-asserts-a-linked-name shape); during the
   window the same delivery passes N3 and increments the `legacyInbound`
   warn metric.
7. (R1) A minimal-face cache hit during envelope verification re-fetches
   the full card through the caller's own envelope — a legitimately named
   caller is never fail-closed on a cache-form mismatch.
   *[2026-10-27 note: superseded with R1, see §3.1; there is only one
   cache form.]*

## 9. Explicit non-goals

- Mutual TLS or key rotation ceremony.
- Federation-wide PKI beyond the existing signed-card web.

## 10. The CONTROL face is a DIFFERENT mechanism (gh#9) — never conflated

The ruling requires this section to exist. **Why the peer-face mechanism
cannot serve the control face:** `/__dsh_a2a/*` callers are the operator's
BROWSER and local operator tooling — neither holds the node's Ed25519 card
key (that key lives in the plugin's home, deliberately not extractable into
a browser), so an OriginClaim envelope is unsignable by exactly the parties
the control face must serve. And on a host that gives sessions a shell
(gh#9's threat), ANY static secret readable from the filesystem — including
`apiKey` in config — is readable by the model. Therefore:

| Face | Callers | Credential | Mechanism |
|---|---|---|---|
| Peer face (`/a2a/direct`, `/a2a/log`, card GET) | other NODES | card key (held by design) | OriginClaim envelope (this doc) |
| Control face (`/__dsh_a2a/*` writes) | operator browser + local tools | **apiKey, promoted from optional to the control-plane norm** | header secret; loopback demoted from "authentication" to **explicit leniency for keyless deployments** |
| Fleet canvas face (`/a2a/canvas-op`, gh#41) | linked peer NODES | card key | OriginClaim envelope **plus** `callerLinkedToThisHost`; unlinked → refused |
| Outcome query (`/a2a/query`, W7) | peer NODES | none | no envelope: the submit payload's fingerprint match is the authorization; read-only, constant-200 |

*[2026-10-27 note: the last two rows were added to match the code; the
control face is key-gated on reads too (e.g. GET `/__dsh_a2a/state`), not
only on writes.]*

Control-face design (gh#9 disposition — **implemented 0.6.23**):

1. `apiKey` is the documented control-plane norm for any host that also
   runs agent sessions: the boot warning fires when a keyless host enables
   session nodes, naming the loopback leniency for what it is.
2. Loopback-without-key remains functional (GUI on localhost, operator
   CLIs) as **leniency, not authentication** — on a shell-granting host it
   is a speed bump. The GUI ships key plumbing: the host injects the key
   into the served workbench shell (same-origin disclosure only; the gh#9
   threat reads it from disk regardless), and every `/__dsh_a2a` fetch the
   shell makes carries the `X-API-Key` header.
   *[2026-10-27 note (REVIEW M3 fix): the key is injected only when the
   shell is served on the loopback leniency face; a remote GET of the page
   gets the shell without the key.]*
3. The model's own tools never learn the key (not in any tool description,
   state face, or session-visible environment).

Sequencing note: peer-face envelope and control-face key norm ship as one
design (this document) but land as independent commits — the faces share
the threat model, not the code.
