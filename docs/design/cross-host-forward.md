# Design: Cross-Host Direct Delivery (#57) — Host Forwarding (Plan A)

- **Status**: proposed (roadmap P2; supervisor order direct-fd54f7da item ③)
- **Owner**: dsh-open-a2a-net (dev seat), decision by the review seat + owner
- **Hard boundaries**: chief-engineer constraints from direct-256f74e5
  (recorded on issue #57) are binding on this design.

## 1. Problem and current state

`/a2a/direct` delivers only to THIS host's teams. A target team on another
host answers `No live DSH session node accepts team` (reproduced 2026-10-25:
.156 → .157 `dsh/c1e25ac2`). CLI deposits are single-host. Direct delivery
across hosts is the missing prerequisite for the "remote collaboration goes
through a2a first" rule.

What already exists and can be extended:

- **canvas remote failover** (dispatchLocalCandidate → remoteMembersOf →
  directoryPeerCandidates → dispatchPeerCandidate): the full chain —
  directory resolution, signed cross-host delivery, receipt return — already
  runs for canvas members (#41/#43/#71). Plan A generalizes its target set.
- **OriginClaim envelope**: signature verification, freshness window.
- **Recursion guard protocol** (docs/protocol/recursion-guard.md) —
  hopBudget / visited / deadlineAt / budget-exhausted, fully specified,
  not yet implemented (#60).

## 2. Three options

| | A. Host forwarding (recommended) | B. Multi-host deposits | C. Zone-direct |
|---|---|---|---|
| Client burden | none (one handle) | publish per host, TTL ×N | must reach every host |
| NAT/firewall | one reachable face per host | same | **fails** (VM 29.136: only .156's portproxy reaches it) |
| Identity | one authored identity | N identities to rotate | one |
| Receipts | return path recorded in the envelope | per-host mailbox | direct |
| Complexity | forward loop + guard (bounded) | none | none |
| Verdict | **adopt** | fallback only for CLI | rejected |

## 3. Plan A — host forwarding

### 3.1 Trigger and resolution

When `dispatchLocalCandidate` misses (the echo of today's
"not a local team"), the dispatcher walks `directoryPeerCandidates(target)`
— the SAME directory walk the canvas failover uses — and POSTs the signed
envelope to the first candidate that accepts. No new resolution machinery:
the directory already resolves a team to its publishing host.

### 3.2 Envelope additions

```
X-A2A-Origin-Caller: <zone>/<id8>        # the ORIGINAL caller (immutable)
X-A2A-Origin-Caller-Url: <url>          # its card face
X-A2A-Hop: <n>                          # hops consumed (0 at origin)
X-A2A-Via: <url>,<url>                  # transport chain, oldest first
X-A2A-Guard: <base64(RecursionGuard)>   # recursion-guard.md payload
```

The per-hop OriginClaim signature (X-A2A-Sig) stays what it is: proof of
**the sending hop's** key possession. The forwarding host signs its own
claim; the original claim travels inside the guard payload.

### 3.3 Admission — the chief's constraint (a), binding

**Transfer of trust is forbidden.** At the receiving host:

1. The admission core (`sameZoneSharedTeamRefusal` / `a2aCallerRefusal`)
   judges the **ORIGINAL caller** — its declared roster (via its card's
   canvasOrg, #71's bidirectional rule: own handles ∧ caller on both sides)
   — exactly as today. Forwarding NEVER widens the declared set.
2. The **forwarding hop** is judged separately as legal transport: it must
   prove possession of its key (OriginClaim ✓) and be **linked to this
   host** (`callerLinkedToThisHost`) — an unlinked host cannot relay
   traffic through us. Failure ⇒ `untrusted-origin` and no steering.
3. The ledger row records `via` (the transport chain) so the caller/origin
   distinction is auditable, never conflated.

Consequence: a linked-but-unrelated peer relaying a stranger's message gets
the stranger judged on the stranger's own links. Forwarding is a postman,
not a sponsor.

### 3.4 Receipts

The receiving host's receipt targets the **origin caller** (the existing
`callback` field already carries a routable address; a forwarded delivery
sets it to the origin caller's handle when absent). If the origin caller's
host is itself unreachable from the receiver, the receipt rides the reverse
of `X-A2A-Via` — each returning hop delivers to the next address in the
chain. Receipt failure falls back to the existing three-tier ledger
(pending → dead-letter → archive).

### 3.5 Hop budget — the chief's constraint (b), binding

- `hopBudget` from recursion-guard.md, `DEFAULT_HOP_BUDGET = 4` (protocol
  §6); each forwarding leg decrements; `hopBudget === 0` ⇒
  `budget-exhausted`, nothing executes, row records
  `hopsConsumed`/`hopsRemaining`.
- **TTL linkage**: every hop resolves independently against its own warm
  cache (cardCacheTtl governs freshness only — it never extends trust or
  budget). The guard is a payload constant, not a cache-derived value; a
  stale directory can cost a retry but can never amplify the traversal.
- Self/cycle: `visited` (own base URL at ingress) per protocol §4.3;
  #60 lands hop accounting first, the visited set second (roadmap
  sequencing).

### 3.6 Change surface (implementation sketch)

| File | Change |
|---|---|
| `src/recursion-guard.ts` (new) | guard payload build/parse/validate; O(len) parse per protocol §7.4 |
| `src/index.ts` dispatch seam | local miss → directory walk → forward with guard + origin fields |
| `src/index.ts` ingress | origin-caller admission + hop check + transport-link check |
| `src/index.ts` receipt | origin-caller callback default; reverse-via fallback |
| `src/task-ledger.ts` | `hopsConsumed` / `hopsRemaining` / `via` row fields |
| `tests/mesh/cross-host-forward.spec.ts` (new) | A→B direct; A→B→C two-hop; cycle terminates; budget-exhausted; unlinked relay refused; receipt returns |

### 3.7 Acceptance (issue #57, machine-checkable)

1. A CLI identity deposited on .156 runs `a2a-net route <a .157 team> --sync`
   and receives a reply; the receipt lands in the sender's mailbox.
2. A new mesh test proves cross-host direct delivery, the cycle terminating
   at the budget, and the unlinked-relay refusal.
3. The recursion-guard status banner flips to "implemented (first step)"
   only after #60's hop accounting lands.

## 4. Risks and fallbacks

- **Relay abuse** → §3.3: transport legality is checked every hop; the
  budget bounds cost.
- **Receipt churn** on reverse paths → existing ledger tiers absorb it; the
  `via` field makes failures diagnosable.
- **Rollback**: forwarding is opt-in via config (`forwardEnabled`, default
  false until the review seat's pass); with it off, behavior is exactly
  today's.
