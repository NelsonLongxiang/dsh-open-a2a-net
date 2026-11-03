# Direct flood guard — #91 transitional brake

Status: transitional guard with F4 file-channel migration advice. File-channel F1–F3 shipped in 0.6.32; this change does not claim a fleet upgrade or that the WSL incident has stopped. Unconditional JPFILE-PART rejection remains a separate, high-grade rollout after the fleet upgrades.

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
- A recognized JPFILE-PART v1 body must have bounded nonempty transfer_id and
  file_id plus integer part_i/part_n. Declared part_n above 16 is refused.
  Accepted unique (file_id, part_i) coordinates also count cumulatively by
  (caller, transfer_id), across files; the 17th is refused even after a
  minute or with a dishonest per-file total. Duplicate coordinates carried
  under a fresh task id are refused, not reinjected.
- Sender and transfer maps are each capped at 1024 entries. Active entries
  are never discarded to admit another key; full state refuses visibly.
  Sender history expires after a minute; transfer history after 24h from
  first acceptance. State is boot-local and resets at restart. This is not
  a durable per-transfer accounting guarantee across restarts.

Refusal retains the existing structured-error HTTP 200 path and returns
code -32008, task_id, delivered:false, TASK_STATE_FAILED and reason:
sender-rate-limited / file-parts-exceeded / file-part-invalid /
file-part-duplicate / flood-state-full. The same fresh idempotency key gets
a failed outcome for /a2a/query, and activity records a failed inbound event.
It never becomes an owed receipt or a false delivered result.

Every JPFILE-PART message reaching the guard (including malformed variants) adds a structured `advice` field to its response:

```json
{ "advice": { "reason": "use-file-channel", "message": "Files must use the file channel, not session messages: a2a_file_send { paths, team }; CLI: a2a-net file send <path…> <team>." } }
```

`use-file-channel` is migration advice, not a new refusal code: accepted parts within the existing 16-part and sender budgets remain accepted with the same success fields. Refusals retain their original `reason` (for example `file-parts-exceeded`) and code `-32008`; their error text also includes `use-file-channel` and both send commands. All later response exits, including CLI mailbox, sync, async and target-queue refusal, carry the advice without changing their verdict. Ordinary messages acquire no advice. Admission/budget/idempotency refusals that occur before the guard keep their existing responses. This does not make all JPFILE-PART messages invalid yet.

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
malformed parts, duplicate coordinates and cross-file limits. Injected-clock
unit tests pin minute rollover, 24h transfer lifetime and state-cap refusal.
Run pnpm verify with its real exit code captured (never the exit of tail).
Merge, review/test stamps, deployment authorization, restart consent and
post-deployment behavioral verification are separate gates. No restart or
production deployment is performed by this patch.
