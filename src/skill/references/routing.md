# Routing deep-dive

## Files use the file channel

Files do not go through session messages. Send with `a2a_file_send { paths, team }` (up to 16 files, 64 MiB each), not `a2a_route` with file bytes or JPFILE-PART chunks. The receiver uses `a2a_file_fetch { ref }` with the `[A2A file] v1 …` line. CLI: `a2a-net file send <path…> <team>` / `a2a-net file fetch "<reference line>"`. One reference message carries the transfer; ordinary routing and receipt rules below apply to that message. Legacy parts still allowed by the transitional cap receive `advice.reason: use-file-channel`; this hint is not a refusal or a completion receipt.

## The receipt contract

Every async route (`wait:false`) registers the task on the peer and returns
immediately. The peer's target session queues a sourced `agent.followup` as its own next turn; when
the turn settles, the peer routes a receipt envelope back to the caller's
team:

```text
[A2A receipt] task <task_id> <one-line outcome>
```

Correlated receipts also carry `{"outcome":"completed","idempotencyKey":"..."}`
on a following line. Receipts are the ONLY completion signal for async work —
polling `a2a_teams` cannot see another host's ledger.

## Delivery and cancellation (#356)

Task delivery (local/remote, sync/async) preserves A2A source metadata and queues a separate next turn. The host atomically stores the taskId → full SessionId + MessageId correspondence before submitting. A missing `Agent.followup` is an explicit refusal, never an instruction to use `steer`. Cold targets first pass the existing resolver. Admission, OriginClaim, team scope, taint and the default three-slot cap run before submission.

`delivered` means inbox acceptance, not consumption. Pending rows may expose `consumed:false` and `deliveryObservation:delivered-unconsumed`; CLI `tasks` and `tasks --json` show this. Inbound later claims can become true, while an outbound value is only the selected peer response snapshot, not live remote telemetry. Neither value is an acknowledgement or completion, and it never changes queue counting. Older peers omitting the field remain unknown, not falsely unconsumed.

Cancellation removes the persisted MessageId through `updateQueue remove` if still unclaimed; a claim/removal race becomes the claimed path. Claimed tasks retain an immediate sourced `steer` stop notice, never a queued stop that would wait behind the work. Cancellation bookkeeping keeps priority: commit the original caller cancellation first, then attempt the stop notification. Cross-host peers with the signed queued-cancellation capability receive the body-bound control field tied to the original verified caller key; older peers receive the legacy `[A2A cancel]` text without a task id, best-effort. An unavailable target or failed notification does not undo cancellation, and `removed`/`steered` only report what actually happened. This is stop-notice compatibility, never permission to fall back to steer for task delivery when followup is missing. A reserved/uncertain mapping is not blindly redelivered. Resolve that existing occurrence instead of changing ids to force a second execution.

## Receipt delivery observation (#362)

A formal receipt for your own pending inbound task may return only along that task's frozen receipt target; it does not grant permission to send unrelated traffic. The receiver still completes current source verification and checks the frozen task authority. Do not join extra teams merely to return that correlated receipt.

`answeredAt` means the receiving session has answered locally, not that its receipt arrived. A pending row with `receiptDelivery:receipt-undelivered` explicitly records that delivery is not confirmed; tasks, state and CLI JSON preserve this across restart. The row remains owed even though answered work no longer occupies an execution slot. A successful formal receipt settles the original row; a rejected or failed send must not be reported as completed.

## Status diagnostics (#355 / #358②)

`a2a-net status` and `status --json` show `ledgerPersistence` and `nudgeEscalations`. A persistence failure is prominently flagged; `lastError` contains only time/code, and a later successful commit clears it. Nudge counts distinguish a successful queue-call return, an unavailable prompt seam, and a failed call. They are host-local runtime counters, reset with the plugin instance, not receipt or consumption evidence. Missing seams and failures emit safe warnings without task text. These observations never change routing, settlement, retry budgets or capacity.

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

## Idle reconciliation reminders (#351, sourced followup)

The host may send a sourced `[A2A reconciliation reminder]` while the session is truly idle. It lists existing pending task ids, senders, bounded original-message briefs and ages. **It is not a new task, acknowledgement, or completion evidence**: no slot is released and no receipt is owed to the reminder itself. Check each original task and send your own formal receipt to its original sender when the outcome is known (completed / failed / rejected / abandoned). If still working, use an ordinary follow-up; do not use a terminal receipt header merely to mean “in progress”.

Reminder attempts are persisted before injection, merged per session, skipped without counting while busy, and backed off after three attempts to about two hours without stopping. They stop only when the original row leaves pending by a real receipt, cancellation, expiry or another existing terminal path. Counters do not prove the model read a reminder. Local senders may receive one warning; remote push notifications are not shipped. Tasks/state and CLI show attempts, last/next times and “多次提醒未对账”.

#356 queues both idle reminders and local sender notices through `agent.followup`, preserving the declared `a2a-relay` source and lineage. Busy sessions are still skipped by the reminder scheduler; this does not make a reminder an acknowledgement or a new debt. There is no unlabelled human `kind:user` prompt and no fallback to `steer` when `followup` is missing. Receipt authorization, queue counting and synchronous reply ownership do not change. An unwritable ledger fails closed; the host does not invent completion or settle production backlog for you.

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
