# Protocol: Receipt Envelope v2 — Structured Body over the Immutable Header

> **Implementation status (2026-10-27, as of ae7e24d / 0.6.28): partly implemented.**
> The §1 wire format and its parser/formatter shipped in 3555f8b
> (`src/receipt.ts`: `formatReceipt` / `parseReceipt`). The codec carries
> `outcome`, `idempotencyKey`, `sessionKey` and `elapsedMs`.
> **Not implemented:** the envelope `taskId` field (the id rides only the
> header line), `artifacts`, the §3 4096-byte overflow rule, and the §5
> T1/T2 liveness ladder. The ledger never writes the `expired` outcome.
> The §4 table is annotated below with what the ledger records today
> (`archived[].endedBy`, `late`).
> **Next version (next/0.8, superagent p1-receipt-cmd):** the codec also
> carries `disposition` (§2a), and the CLI gains `a2a-net receipt`, the one
> formal-receipt command for a CLI identity.
>
> **Update (2026-11-13, checked against `src/receipt.ts`):** the codec now also
> carries `disposition`, `onBehalfOf`, `authRef`, `by`, `artifacts`, `question`,
> `progress` and `tickets` (the who/what/question fields are designed in
> [receipt-envelope-fields](../design/receipt-envelope-fields.md)), so `artifacts`
> is no longer missing. Still not implemented: the envelope `taskId` field, the
> §3 4096-byte overflow rule, the §5 T1/T2 liveness ladder; the ledger still
> never writes the `expired` outcome.

- **Status**: design frozen with the orchestration face (co-design round, pure-spec slice ahead of implementation) — codec since shipped; see the status note above
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
  taskId: string   // [2026-10-27: not implemented — not parsed or emitted; the header carries the id]
  /**
   * Idempotency key. v1 equivalence: identical to taskId (caller-born,
   * single-use). P3 (W4) may widen its lifetime independently WITHOUT any
   * wire-format change.
   */
  idempotencyKey: string
  /** Tool-face conversation identity echo. */
  sessionKey?: string
  /** B5 artifact references; REQUIRED once any field overflows (see §3). */
  artifacts?: Array<{ kind: string; ref: string; digest: string }>   // [2026-10-27: not implemented — tolerated as an unknown key]
  /** Telemetry slot #4: wall-clock cost of the remote turn. */
  elapsedMs?: number
  /** §2a (next/0.8): what the receipt hands back. Closed set; other values are dropped. */
  disposition?: 'result' | 'attention'
}
```

## 2a. Two branchable fields: `outcome` and `disposition`

*(next/0.8, superagent p1-receipt-cmd, spec S14.)*

A receipt now has two branchable fields, and they answer different questions:

- `outcome` — **how the work ended** (the §4 enum). Unchanged.
- `disposition` — **what the receipt hands back**: `"result"` (the work's
  result) or `"attention"` (a concrete question that needs the caller). It is
  a closed set; any other value is dropped, as for `outcome`.

An `attention` receipt settles the task's debt like any receipt, but it is
**not a completion**: it carries no `outcome`, and every view keeps that
absence (the state face shows `outcome: "unclassified"` with
`disposition: "attention"`, never `completed`). The answer to the question
comes back as a **new task in the same context**; the original task is not
answered twice.

`disposition` is a new key, not new values of `outcome`: a host that predates
it ignores the key (§1 rule 3), while new `outcome` values would be dropped
silently by older parsers and their meaning lost. An attention envelope still
carries `idempotencyKey`, so an older host recognizes the envelope and settles
by the header as before.

Where it shows up:

- the ledger's archived row and `tasks --json` (`archived[].disposition`);
- `a2a_tasks` (its archive rows, and an `[attention: …]` marker in the text);
- a CLI mailbox row that holds a receipt (`mail[].disposition`), so a CLI
  caller branches on the field instead of reading the text.

The CLI's `a2a-net receipt <task_id> [--attention] <one line…>` composes
exactly these shapes:

```
[A2A receipt] task <id> <one line>
{"outcome":"completed","idempotencyKey":"<id>","disposition":"result"}

[A2A receipt] task <id> <one line>
{"idempotencyKey":"<id>","disposition":"attention"}
```

It sends them on task id `receipt-<id>`. The host runs one task id at most
once, so a task gets one receipt: resending the same receipt is a replay, and
a different one (for example `result` after `attention`) is refused.

A task delivered into a CLI mailbox is final from the caller's side (the
mailbox answers `receipt: "mailbox"`, and the caller books no debt for it).
A receipt for such a task settles nothing on the caller's ledger, because
there is no owed row; it still reaches the caller with its `disposition`. A
receipt settles a debt only where the caller tracked an owed row.

## 3. Atomic overflow rule (no illegal tails, ever)

*[2026-10-27: not implemented — `formatReceipt` serializes the four known
fields inline with no size budget.]*

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

Migration law: consumers branch ONLY on this enum and, from next/0.8, on
`disposition` (§2a). Free-text `summary` is display material, never a
dispatch predicate.

*[2026-10-27 note — what the ledger actually records (`src/task-ledger.ts`,
state face in `src/index.ts`):*
- *Natural expiry never yields `expired`: a past-TTL row turns `dead` with
  reason `fire-forget` (no receipt was expected) or `unconsumed`, and stays
  in the owed book, still settleable (`tasksDead[]`).*
- *Archived rows carry `endedBy`: `receipt` | `echo` | `abandoned` |
  `cancelled` (gh#31). A caller cancel archives with outcome `abandoned`
  and `endedBy: 'cancelled'`, so `endedBy` is what tells abandon from
  cancel.*
- *The state face projects a receipt that lands after the caller ended the
  row as `late: true`; the stored record keeps `lateReceiptAt`.]*

## 5. Target-liveness ladder (three tiers, upgrade not replace)

*[2026-10-27: not implemented as a ladder. `a2a_probe` takes only `url` and
returns `reachable: boolean` (plus `ms`, `team`, `error`), with no
thresholds and no four-value verdict. T2 is not wired. Only the T3 signal
exists: the `/a2a/direct` response carries `consumed`.]*

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
