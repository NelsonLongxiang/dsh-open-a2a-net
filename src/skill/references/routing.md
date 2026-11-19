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

A delivery that reached a busy session and was never consumed (`delivered-unconsumed`, the brief only in `a2a_tasks`) can be read back by that session with `a2a_task_read { task_id }`: its full original text, kept 72 hours (64 KiB each). Only the receiving session reads it; reading consumes the delivery, and the text is the sender's request, not the owner's instruction. A delivery the host never tracked (a lost steer) is also redelivered when the session is idle, as a queued delivery of the original task: its reservation, claim, withdrawal and an unknown outcome follow the ordinary correspondence, and nothing is ever resent blindly.

Cancellation removes the persisted MessageId through `updateQueue remove` if still unclaimed; a claim/removal race becomes the claimed path. Claimed tasks retain an immediate sourced `steer` stop notice, never a queued stop that would wait behind the work. Cancellation bookkeeping keeps priority: commit the original caller cancellation first, then attempt the stop notification. Cross-host peers with the signed queued-cancellation capability receive the body-bound control field tied to the original verified caller key; older peers receive the legacy `[A2A cancel]` text without a task id, best-effort. An unavailable target or failed notification does not undo cancellation, and `removed`/`steered` only report what actually happened. This is stop-notice compatibility, never permission to fall back to steer for task delivery when followup is missing. A reserved/uncertain mapping is not blindly redelivered. Resolve that existing occurrence instead of changing ids to force a second execution.

## Receipt delivery observation (#362)

A formal receipt for your own pending inbound task may return only along that task's frozen receipt target; it does not grant permission to send unrelated traffic. The receiver still completes current source verification and checks the frozen task authority. Do not join extra teams merely to return that correlated receipt.

`answeredAt` means the receiving session has answered locally, not that its receipt arrived. A pending row with `receiptDelivery:receipt-undelivered` explicitly records that delivery is not confirmed; tasks, state and CLI JSON preserve this across restart. The row remains owed even though answered work no longer occupies an execution slot. A successful formal receipt settles the original row; a rejected or failed send must not be reported as completed.

## Temporary receipt delivery failures (#357)

Since #708 every task-correlated receipt, automatic or authored, goes through the host's durable receipt outbox described under the blocked-return rules below; this section only summarises it. A temporary failure keeps the original task pending with `receiptDelivery:receipt-undelivered`. The host sends again only the same frozen receipt body and transport id, with short then long backoff inside a bounded replay window, and restores this state after a restart. Its owner gets a notice, never a substitute receipt or an owner fallback. A new POST of the same transport is allowed only after a definite non-insertion: a connection refused before it opened, or the receiver's structured `receipt_delivery: not-inserted` refusal. Everything else (timeout, reset, `-32005`, an idempotency replay `-32003`, a malformed or contradictory success) is resolved only by asking the receiver's `/a2a/query` for that transport id. Only an explicit persisted `receipt_delivery: delivered` there counts as delivery; a bare replay, a generic `completed`, a missing or expired answer, or a receiver without the query surface stays unknown and is never read as delivered. A conflict (`-32002`) is permanent. Reconciliation reminders still ask the session to reconcile; host retransmissions do not count as reminder attempts or new work.

On the receiving side a receipt is settled only after it is in its destination: the CLI mailbox journals it first, and a session receipt settles only once the session has taken it. If the session cannot take it (for example its queue capability is unavailable), nothing is settled, the original task stays owed, and the answer is `receipt_delivery: not-inserted`, so the sender's retained receipt stays retryable on the same transport until the session can take it again. If the session did take it but the local settlement write then fails, the answer is `-32011` with `acceptance: unknown`; the host journals that receipt's settlement (with the original task's identity) and finishes only that step once its store recovers, after a restart too, or when the sender's `/a2a/query` asks. The receipt is never inserted again; the query answers `pending` until the settlement commits, then `receipt_delivery: delivered` (or `refused` if the original was cancelled or abandoned meanwhile).

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

Reminder attempts are persisted before injection, merged per session, skipped without counting while busy, and backed off after three attempts to about two hours without stopping. Unanswered work continues to be reminded while pending. Once the actual receiver has authored a terminal receipt, ordinary work reminders stop: delivery failure becomes receipt-delivery debt, not an instruction to redo work. Cancellation/expiry and receipt settlement still use their existing terminal paths. Counters do not prove the model read a reminder. Local senders may receive one warning; remote push notifications are not shipped. Tasks/state and CLI show attempts, last/next times and “多次提醒未对账”.

#356 queues both idle reminders and local sender notices through `agent.followup`, preserving the declared `a2a-relay` source and lineage. Busy sessions are still skipped by the reminder scheduler; this does not make a reminder an acknowledgement or a new debt. There is no unlabelled human `kind:user` prompt and no fallback to `steer` when `followup` is missing. Receipt authorization, queue counting and synchronous reply ownership do not change. An unwritable ledger fails closed; the host does not invent completion or settle production backlog for you.

## Answered work with a blocked receipt return

An already-answered `receipt-undelivered` row stays owed, but is not an ordinary task reminder. The original live idle receiver gets one persisted, sourced `[A2A receipt delivery blocked]` notice. It is not a task or a receipt and owes no reply. Do not rerun business work, publish again, create another business card, change the transport id, route the receipt to the host owner instead, or self-change presence/permissions to silence it. The current `a2a_tasks`/owner state exposes bounded `receiptRecovery` state, code, attempts and next time; private full receipt bytes/keys are not projected.

New task-correlated terminal receipts are atomically retained with `answeredAt` in the existing private task ledger before any delivery. The record freezes the full authored text and payload digest, original task birth/context, receiver SessionId, local key, exact target, one transport id and original return lane. Manual and task-attributed automatic receipts use the same store; an explicit authored receipt is not replaced by a later automatic summary. Acknowledged/progress/question receipts keep the original result debt and its work reminders.

The host rechecks current authority, original identity and the exact return lane before each effect. It uses short same-receipt retry delays, then long backoff, within a bounded replay window. A missing/expired CLI or temporarily unreachable original home is delivery-blocked, not a reason to execute work again or choose another owner. An authenticated structured pre-insertion refusal permits the same receipt transport to be tried again. A timeout, malformed/contradictory success, `-32005`, pending/missing query, claim conflict or post-insertion bookkeeping failure never permits a blind new POST: query only that original transport and payload. Confirmed query delivery requires explicit persisted `receipt_delivery: delivered`; generic completed status or prose is not proof. Only confirmed original delivery plus the existing settlement judge ends the debt.

One host is the ledger writer (the existing composition assumption). Atomic file replacement/fsync failure refuses transport; a post-send save failure leaves the sending checkpoint for reconciliation. Restart restores the private outbox without replaying work or waking cold/archived sessions for it. Stop cancels host-owned scans/timers, not the debt. Ordinary raw routing and non-task-correlated receipts retain their existing gates; no new model tools or admission exemption are added.

The private outbox also hashes the full return lane (kind, URL, host/CLI key or full local SessionId) and the birth-time delivery key. Restore compares those values to the original admitted task rather than trusting a currently valid but unrelated peer. Remote CLI admission retains the original CLI card key separately from its carrier host key; same-home/same-handle key replacement blocks the return. Missing reliable original key is unknown, never permission to trust a later card.

An undelivered full receipt protects its task slot from ordinary TASK_CAP eviction. The existing durable task-delivery correspondence reserves the eventual task slot at the actual enqueue boundary, including after cold materialization waits. That reservation survives restart and cannot be stolen by reentrant unrelated work. The caller separately persists a bounded dispatch-slot reservation before any local/remote request can be admitted, including CLI forwarding; the receiving host cannot reserve that caller slot for it. A confirmed dispatch consumes its original slot, definite non-admission releases it, and unknown delivery or failed post-admission bookkeeping retains the original task id/reservation for reconciliation. A retained reservation never authorizes replay, and receipts themselves reserve no new business debt. If all slots are protected or reserved, new work is refused before delivery; no unbounded queue or silent result loss is introduced. Dead/expired debts retain private full evidence but cannot auto-send past the replay window. Explicit cancellation/abandonment stops delivery without claiming success.

On the receiving CLI home, receipt mailbox insertion and original-debt settlement are ordered by a bounded private write-ahead journal. Full mailbox acceptance is atomically saved first; only then may the existing settlement judge commit the original task. A mailbox write failure cannot settle the debt. If the receipt is durable but settlement fails or the process restarts between commits, recovery finishes only the same receipt settlement and publishes that exact transport query fact; it does not execute work or insert another receipt. The journal completion phase is included in its integrity digest and is rehashed only by the atomic completion update; phase-only damage cannot become a delivered query fact. An acknowledged/progress receipt still holds the result debt.
Legacy `answeredAt`/`receipt-undelivered` rows without the full retained original receipt are `legacy-unknown`. They are not reconstructed from the capped brief, stale final output or error summary, and are not automatically resent. The four pre-repair incident debts are untouched by this change; authoritative manual reconciliation and any actual delivery require separate operational authorization. Code delivery does not deploy or clear production backlog. Rolling back code keeps ordinary task rows, but older writers may discard the new private extension: back up the complete home before any later version switch.
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
4. Unknown or absent ledger/query data does not prove non-delivery. Keep the
   original task/transport and reconcile; do not blindly re-dispatch the work.
   Task-correlated receipt delivery uses the bounded retained return flow above.

## Owner-qualified canvas ids (#282)

`<zone>/canvas/<name>@<fp8>` names the canvas owned by the host whose signed card key fingerprints to `<fp8>` (sha256 over the SPKI DER, first 8 hex). The suffix only selects among owners: scope, the peer request, receivers and the ledger all use the plain `<zone>/canvas/<name>`. A foreign suffix never lands on a same-named local canvas; this host's own suffix is its local canvas. `a2a-net teams` and the state face (`canvas.teams[].id`, `peerOrg[].org[].id`) print the ids. The suffix names a signing key, not a URL: a seeded peer serving that key's signed card core counts as an alias of the same owner, as before, and the card's `canvasOrg` is not part of the signed core. A canvas name may not end in `@<8 hex>`; a request carrying our own suffix never leaves this host, on the trunk or the forward path.
