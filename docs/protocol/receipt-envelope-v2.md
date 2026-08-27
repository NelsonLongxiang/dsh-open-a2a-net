# Protocol: Receipt Envelope v2 — Structured Body over the Immutable Header

- **Status**: design frozen with the orchestration face (co-design round, pure-spec slice ahead of implementation)
- **Owner**: dsh-open-a2a-net (protocol face) · Co-signer: graph_loop orchestration face (pending_remote W3 consumer)
- **Depends on**: transport cap (docs pairing: 512 KiB body limit, B5); P3 idempotency keys (W4) for the key's distinct life; abandon primitive (PR !21) for the `abandoned` outcome

## 0. Doctrine

**The receipt message is TEXT forever; the write-ahead ledger is the only truth.**
The envelope is a projection for consumers who cannot query the control plane,
never a second authority. Free-text remains for humans; branching logic reads
only the structured layer.

## 1. Wire format (b+c dual track)

```
[A2A receipt] task <id> <human summary…>      ← immutable correlation anchor, case-sensitive, unchanged
{ …complete single-line JSON object… }        ← the ONLY machine line; starts with `{`
<any further lines>                           ← human continuation; every consumer ignores them
```

Parsing disciplines (normative):

1. Exactly ONE subsequent line may start with `{`; it must parse as one
   complete JSON value. Anything after it is continuation prose.
2. A missing `{` line = legacy v1 receipt — fully supported forever.
3. **Unknown-key tolerance, append-only**: consumers MUST ignore keys they do
   not know. Adding fields is never breaking (aligned with RF-1).

## 2. Schema

```ts
interface ReceiptEnvelopeV2 {
  outcome:
    | 'completed' | 'failed' | 'abandoned'
    | 'expired' | 'rejected' | 'sync_completed' | 'unknown'
  /** Correlation triple echoed back — crash-storm rehydration skips N ledger lookups. */
  taskId: string
  /**
   * Idempotency key. v1 equivalence: identical to taskId (caller-born,
   * single-use). P3 (W4) may widen its lifetime independently WITHOUT any
   * wire-format change.
   */
  idempotencyKey: string
  /** Tool-face conversation identity echo. */
  sessionKey?: string
  /** B5 artifact references; REQUIRED once any field overflows (see §3). */
  artifacts?: Array<{ kind: string; ref: string; digest: string }>
  /** Telemetry slot #4: wall-clock cost of the remote turn. */
  elapsedMs?: number
}
```

## 3. Atomic overflow rule (no illegal tails, ever)

Threshold: **4096 bytes** total structured payload.

- Per-field fits ⇒ serialize inline.
- ANY field exceeds its budget ⇒ **the entire `{…}` segment vacates** to an
  artifacts[] entry (`kind:'envelope', ref:<opaque URI>, digest:<sha256-16>`),
  leaving on the wire only the header + a minimal envelope carrying
  outcome/triple/pointer.
- The first line and the correlation triple are NEVER truncated, split, or
  elided. Truncating into illegal JSON is forbidden outright.

## 4. Outcome enum ↔ legacy summaries

| v2 outcome | Legacy surface |
|---|---|
| `abandoned` | rows archived by `TaskLedger.abandon` (`summary:'caller-abandoned…'`) |
| `completed` / `sync_completed` | ordinary `[A2A receipt]` correlations (async vs awaited-in-round) |
| `failed` · `expired` · `rejected` · `unknown` | new distinctions; ledger dead-letter sweep maps natural expiry to `expired` |

Migration law: consumers branch ONLY on this enum. Free-text `summary` is
display material, never a dispatch predicate.

## 5. Target-liveness ladder (three tiers, upgrade not replace)

| Tier | Signal | Source | Meaning |
|---|---|---|---|
| T1 TCP | probe verdict `reachable/slow/rejected/unreachable` (+ thresholds: `maxLatencyMs=2000`; **two consecutive degradations ⇒ dead**, D2 fast-fail philosophy; `minScore` floor = fleet-median × 0.1 relative) | `a2a_probe` | socket answerable |
| T2 thread | session routed a turn within TTL (`lastUsedAt`) — app-level consumption fact | tool-face `SessionRecord` seam | the agent actually breathed |
| T3 explicit | `consumed:true` from the direct-route response probe | ledger/delivery half | the wake was truly consumed |

Selection policy for senders: use the highest tier available; a healthy T1
with stale T2/T3 counts as suspect, not alive — the observed failure class
(process up, socket open, routing plane dead) must fail budget checks
honestly instead of eating waits.

### 5.1 Diagnostic verdict before tear-down (incident-derived, 2026-08-27)

Observed asymmetry: a sender-side wait abort (`AbortError` inside the reply
window) coexisting with SUCCESSFUL delivery and content-level replies landing
on the busy target afterwards. Classification law:

> **wait-aborted ≠ delivery-failed.** An abort ends the *caller's patience*,
> never the *task's life*. Before issuing any failure verdict, the sender MUST
> reconcile its owed book / ledger row — the row remains pending and may
> settle minutes later through the ordinary receipt correlation.

Misreading the former as the latter would aim dead-letter governance in the
exact opposite direction (host-ingress forensics where only await-window
bookkeeping is due). Sample credit: graph_loop orchestration face, live
consultation round-trip with pong double-confirmation.

## 6. Acceptance criteria

1. v1 receipts correlate byte-for-byte unchanged through old consumers while v2 consumers read envelopes off the same stream (dual-parser fixture).
2. Overflowed payloads always leave well-formed JSON or none at all; fuzzing random oversize strings never yields a partial `{` line.
3. `abandoned` receipts arriving against PR-!21 archived rows keep `lateReceiptAt` isolation AND now carry outcome `abandoned` without rewriting stored summaries.
4. T2 unavailability (older peer) silently degrades the ladder to T1∪T3 with no false-dead verdicts in the soak run.
5. All four verifier questions from the alliance TEST-VERDICT lane remain green after implementation lands.
