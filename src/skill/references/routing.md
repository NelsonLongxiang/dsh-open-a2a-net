# Routing deep-dive

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
