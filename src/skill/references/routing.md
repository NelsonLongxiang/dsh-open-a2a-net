# Routing deep-dive

## Files use the file channel

Files do not go through session messages. Send with `a2a_file_send { paths, team }` (up to 16 files, 64 MiB each), not `a2a_route` with file bytes or JPFILE-PART chunks. The receiver uses `a2a_file_fetch { ref }` with the `[A2A file] v1 …` line. CLI: `a2a-net file send <path…> <team>` / `a2a-net file fetch "<reference line>"`. One reference message carries the transfer; ordinary routing and receipt rules below apply to that message. Legacy parts still allowed by the transitional cap receive `advice.reason: use-file-channel`; this hint is not a refusal or a completion receipt.

## The receipt contract

Every async route (`wait:false`) registers the task on the peer and returns
immediately. The peer's target session steers the message into its turn; when
the turn settles, the peer routes a receipt envelope back to the caller's
team:

```text
[A2A receipt] task <task_id> <one-line outcome>
```

Correlated receipts also carry `{"outcome":"completed","idempotencyKey":"..."}`
on a following line. Receipts are the ONLY completion signal for async work —
polling `a2a_teams` cannot see another host's ledger.

## The ledger

`__dsh_a2a/state` splits the ledger into separate fields:

- **`tasks`** — pending rows: routed, receipt still owed. An owed task with a
  delivered marker is waiting on the target's turn, not lost. Each row
  carries `settleable` (young, expected and answerable).
- **`tasksStaleCount`** — how many pending rows are past the one-hour
  settleable window or expect no receipt: conversational tail, not debt.
- **`tasksDead`** — past the stale TTL (`taskStaleTtlMs`, 24h), auto-dead-
  lettered, with `reason` and `direction` when known. A dead task that
  actually completed at the peer is a reconciliation candidate, not a rerun;
  a late receipt still settles it.
- **`archived`** — rows that left the ledger, newest 64, newest first. Each
  has `outcome` and `endedBy`: `receipt` (a correlated receipt), `echo`,
  `abandoned` or `cancelled` (the caller ended it through
  `/__dsh_a2a/tasks/abandon` or `/tasks/cancel`). `late: true` marks a
  receipt that arrived after the caller ended the row; `direction` appears
  when known. `archivedCount` and `archivedSplit` (count per outcome) cover
  the whole archive.

## Queue capacity is not receipt debt

A pending row with `answeredAt` records that its actual local target produced a task-attributed final or attempted its own formal receipt. It no longer occupies the `targetQueueCap` limit, even if the caller CLI expired and receipt delivery failed. It is **still pending receipt debt**: do not abandon it just to free capacity, or claim the sender received it. Dead-letter expiry, late receipts and lifetime conservation continue unchanged. State session `queued` and the board both use the same unanswered-row count; unfinished work still counts against the default cap of three. Unrelated agents, unrelated finals and host timeout placeholders cannot mark an answer.

## Idempotency

A route carries a fingerprint (caller + message + team + wait-mode). Re-
submitting the same fingerprint inside the idempotency window returns the
original verdict (-32002/-32003 shapes) instead of executing twice. Never
work around a duplicate verdict by mutating the message — reconcile instead.

## -32005 (DELIVERED-UNSETTLED) procedure

1. Note the task id from the result.
2. Wait for the receipt envelope; or
3. Re-check via the coordinating surface (`a2a_status` activity ring, the
   peer's state `tasks` face) for the task id's settled outcome.
4. Only re-dispatch when BOTH the receipt is absent AND the peer's ledger
   shows the task unknown — otherwise you risk duplicate execution.

## Owner-qualified canvas ids (#282)

`<zone>/canvas/<name>@<fp8>` names the canvas owned by the host whose signed card key fingerprints to `<fp8>` (sha256 over the SPKI DER, first 8 hex). The suffix only selects among owners: scope, the peer request, receivers and the ledger all use the plain `<zone>/canvas/<name>`. A foreign suffix never lands on a same-named local canvas; this host's own suffix is its local canvas. `a2a-net teams` and the state face (`canvas.teams[].id`, `peerOrg[].org[].id`) print the ids. The suffix names a signing key, not a URL: a seeded peer serving that key's signed card core counts as an alias of the same owner, as before, and the card's `canvasOrg` is not part of the signed core. A canvas name may not end in `@<8 hex>`; a request carrying our own suffix never leaves this host, on the trunk or the forward path.
