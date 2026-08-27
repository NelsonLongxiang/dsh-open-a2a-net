# Protocol: Cross-Machine Recursion Guard — Sender-Gossip Hop Accounting

- **Status**: proposed (work-order P5 / ROUND-2 Cluster C2)
- **Owner**: dsh-open-a2a-net (protocol face)

## 1. Problem

Captain-mediated dispatch introduces hub cascades: a routed task may traverse
captain → sub-team captain → … across hosts. Nothing on today's wire bounds
that traversal, so a misconfigured cycle burns CPU on both ends until wall
clocks give up. The local-only defenses that exist (zone walk: depth cap 5 +
URL visited set) do not travel with the payload.

## 2. Design principle

**State rides the payload** ("sender gossip"): every hop carries the full
consumption ledger with it. No central coordinator, no per-hop storage,
fail-closed at every check — a guard that cannot be evaluated must reject.

## 3. Envelope additions

```ts
interface RecursionGuard {
  visitToken: string          // 128-bit random hex, born at origin
  originSentAt: number        // absolute epoch ms deadline basis
  deadlineAt: number          // absolute epoch ms; hops may tighten, never extend
  hopBudget: number           // uint8, decremented per forwarded hop
  visited: string[]           // base URLs, oldest first, capacity 16
}
```

## 4. Rules

1. **Forwarding counts.** A captain dispatching inward IS a forwarded hop:
   decrement once per captain relay and once per node-to-node transport leg.
   Only the original caller creates the envelope with full budget.
2. **Budget exhaustion rejects.** `hopBudget === 0` at ingress ⇒ structured
   error `budget-exhausted`. Silent swallow is forbidden everywhere.
3. **Cycle detection.** At ingress, if own base URL ∈ `visited` ⇒ error
   `cycle-detected`; otherwise append self. Capacity breach ⇒ `cycle-detected`
   (the list never truncates — truncation would reopen the loop it exists to
   close).
4. **Deadline synthesis.** Ingress compares `deadlineAt` against local now;
   tolerance ±5 s for clock skew; expired ⇒ `deadline-exceeded`. A hop MAY
   lower `deadlineAt` to honor a local smaller budget; raising it is ignored
   (defensive clamp) and reported via ledger meters.
5. **Metering.** The task ledger row records `hopsConsumed`,
   `hopsRemaining`, so reconciliation sees numbers instead of vibes.

## 5. Relationship to the zone walk

Unchanged. The GNS walk keeps `ZONE_DEPTH_CAP = 5` and its URL cycle set;
this envelope governs *task forwarding*, the walk governs *name resolution*.
They compose (a resolution inside a forward consumes budget like anything
else).

## 6. Compatibility

Absent `RecursionGuard` ⇒ receiver grants a default one-shot budget
(`hopBudget = DEFAULT_HOP_BUDGET`, constant 4) and records the row as
`guardMode:'default'`. Old peers are constrained, not broken.

## 7. Acceptance criteria

1. Two hosts configured as each other's captains terminate within ≤ 2 hops with assertable error enums on both sides.
2. A legal 16-deep chain completes; the 17th leg receives `cycle-detected` from the capacity breach.
3. `hopBudget = 0` chains die at the first guarded ingress with `budget-exhausted`; nothing executes.
4. Header parse/validate cost measured O(list length) ≤ 16; overhead regression asserts under the suite's timing guards.
