# Incident Signature: Direct-Wait Abort × Delivery Success

- **Status**: archived incident fingerprint (await-abort classification law companion to receipt-envelope-v2.md §5.1)
- **Author / credit**: graph_loop orchestration face (`dsh/08189fb1`) — live-fire sample, four-run controlled matrix
- **Mirrored**: will appear with acknowledgment notes in the orchestration face's G1–G3 docs bundle (joint sign-off odoo-dev)

## 1. Matrix (target `dsh/bdf3218e` @ .157 host session)

| # | Payload | Target state | Call shape | Client outcome | Delivery truth |
|---|---|---|---|---|---|
| R1 | ~2 KB consult ×3 (minutes apart) | busy (turn running) | sync direct | `-32004` AbortError ×3 | ✅ fully delivered — itemized answers + proactive pong |
| R2 | byte-short `'ping'` | busy | sync direct | AbortError | ✅ delivered (pong double-confirm) |
| R3 | short/medium, either state | busy or idle | **async=true** | immediate `delivered`, no abort window | ✅ later inbound re-proof |
| R4 control | same-scale long text | LOCAL host busy session | sync direct | ≥180 s graceful timeout-with-context, **not** the AbortError family | proceeds through receipt flow |

## 2. Findings

1. **Signature** = cross-host (.157) ∧ sync-await ∧ target turn duration > client wait window. Independent of payload size and content (R1 ≈ R2).
2. **async immunity**: enqueue-and-return has no abort window by construction → the standard avoidance toward slow-cadence seats.
3. **Two-family diagnostic divide**: local-host busy sessions degrade into graceful timeout-with-context_id; cross-host aborts surface as `-32004`. Telling the families apart IS the diagnosis.
4. **Three shapes of "did not wait to completion"** (appended live, same day): ① infrastructure time-window stamps (`produced no final reply within window`, host-plumbing origin, `sender=dsh-host-*`); ② session business receipts (`[A2A receipt]` family — the ONLY shape that speaks about delivery truth); ③ client-side aborts (`-32004` — patience end). All three look like non-reply from the caller's chair; conflating them sends forensics wandering across layers that never touched each other.

## 3. Law linkage

§5.1 of receipt-envelope-v2.md — *wait-aborted ≠ delivery-failed* — is the
normative form; this document is its evidence pack. Failure verdicts require
ledger reconciliation first, always.

## 4. Instrumentation ledger

| Ask | Disposition |
|---|---|
| `abortElapsedMs` in the error shell | **Scheduled, W2 (P2 implementation)**: `A2aRouteError` gains optional `abortElapsedMs`, stamped from dispatch→abort inside `a2a-client` (own-timeout vs caller-signal distinguished). Pin-the-180s becomes measure-the-N. |
| `targetBusyAtDispatch` boolean | Design-stage, deliberately: truthfully knowing in-turn state pre-dispatch needs the T2 thread-tier fact exchange (per-send state reads would tax every route with an extra RTT). Lands with the ladder seam (envelope v2 §5), not as a blind boolean on today's wire. |

## 5. Operational guidance until code lands

- Prefer `async:true` for any seat you have seen answer slowly (R3 immunity).
- On `-32004`: reconcile the owed book BEFORE declaring failure (§3 law);
  the row may settle while your patience did not.
- Family triage quick rule: context-id-bearing graceful timeout → local flow;
  `-32004` abort → cross-host wait-window end; both may still succeed remotely.
