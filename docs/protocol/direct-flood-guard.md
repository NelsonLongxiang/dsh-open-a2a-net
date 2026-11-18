# Direct flood guard — #91 ingress brake

Status: final form (2026-11-18). File-channel F1–F4 shipped from 0.6.32 on and the fleet runs 0.8 previews, so the transitional 16-part allowance is gone: every JPFILE-PART message is refused. Files go through the file channel (`a2a_file_send` / `a2a-net file send`).

## Wire contract

Each plugin instance owns a FloodGuard (not a module-global singleton).
The guard runs after caller admission, OriginClaim checks and a FRESH
idempotency claim, before receipt correlation, CLI mailbox delivery or steer.
Existing replay/conflict requests keep their 409 result and do not consume
fresh-delivery quota. No allowlist, membership, exposure or signature rule is
weakened. The guard uses the admitted caller label; it does not add a new
cryptographic binding between caller_session and the envelope.

- At most 16 accepted fresh wire deliveries per caller in a sliding minute,
  aggregated across all targets. This is stricter than L9's caller-target
  criterion. 16/min is the current review-seat L9 threshold, not a hidden
  configurable value. Refusals do not extend the window.
- Any message containing `[JPFILE-PART` (well-formed or not, any version) is
  refused with reason `file-channel-required`. A refused part spends no
  sender quota and leaves no per-transfer state.
- The sender map is capped at 1024 entries. Active entries are never
  discarded to admit another key; full state refuses visibly. Sender history
  expires after a minute. State is boot-local and resets at restart.

Refusal retains the existing structured-error HTTP 200 path and returns
code -32008, task_id, delivered:false, TASK_STATE_FAILED and reason:
sender-rate-limited / file-channel-required / flood-state-full. The same fresh idempotency key gets
a failed outcome for /a2a/query, and activity records a failed inbound event.
It never becomes an owed receipt or a false delivered result.

Every JPFILE-PART message reaching the guard (including malformed variants) adds a structured `advice` field to its response:

```json
{ "advice": { "reason": "use-file-channel", "message": "Files must use the file channel, not session messages: a2a_file_send { paths, team }; CLI: a2a-net file send <path…> <team>." } }
```

The refusal of a part keeps code `-32008` and reason `file-channel-required`; its error text also includes `use-file-channel` and both send commands. Ordinary messages acquire no advice. Admission/budget/idempotency refusals that occur before the guard keep their existing responses. Before 2026-11-18 up to 16 parts per transfer were accepted with this advice; that allowance is removed.

## Boundaries and incident evidence

This candidate guards wire ingress only. Same-host in-process steering,
quick dispatch, already-queued inbox work, automatic nudges and ongoing
model turns do not pass through it; those are NOT claimed as fixed here.
Other file-part formats are not parsed as JPFILE, but still face sender
rate limiting. Raw file data must move to the independent channel, with
one session reference (sha256, size, location) and one final receipt.

The earlier incident report's 200/sec estimate is WITHDRAWN: it used an
absent at field instead of ts. Matching log-line counts are not unique
part counts. Fixed ring length/pending length cannot prove traffic stopped.
A later pre-freeze sample had changing ring hashes and timestamps plus
local-seat outbound traffic; that is not proof all ongoing activity is
JPFILE. The existing-evidence summary is at
tmp/storm-existing-evidence-20261029.json (SHA256
06427f147e1f74fc0f27f2c1af08ef2897c6127ea221f142eb94e527ee466243).
This summary is not the raw session log. Sender stop order
 direct-8497106d was accepted for delivery; stop execution remains unconfirmed.

## Verification / release gate

Real HTTP tests pin sync/async pre-steer refusal, failed query visibility,
activity records, independent host budgets, admission unchanged, replay 409,
and the refusal of every JPFILE-PART form (well-formed, oversized, malformed,
repeated) with no quota spent. A signed cancellation whose text carries a part
still stops the task, but the session gets the host's own stop notice, never
the part. Injected-clock unit tests pin minute rollover and state-cap refusal.
Run pnpm verify with its real exit code captured (never the exit of tail).
Merge, review/test stamps, deployment authorization, restart consent and
post-deployment behavioral verification are separate gates. No restart or
production deployment is performed by this patch.
