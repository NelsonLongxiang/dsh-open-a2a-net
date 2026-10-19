# A2A join-gate initiator exemption "can-send-can't-receive" fix (target 0.5.57)

## Decision
Four-fix plan dispatched for the join-gate initiator exemption asymmetry defect in
dsh-open-a2a-net (taskboard card `t-muartz66-te04rz`, branch
`fix/a2a-outbound-receivability`, base 5c57ce8 = 0.5.56 content):

1. Caller fallback to node team (bare `dsh`) when the initiator/host face routes
   while unjoined — restores "whoever can send can receive".
2. Async dispatches with `callbackAddress === undefined` registered as
   `receiptExpected:false / settleable:false` + reconcile-via-context note
   (ledger stops minting ghost debts).
3. Agent-undefined a2a calls land in the S4 audit ring + new
   `gateAgentLessCalls: 'audit' (default) | 'refuse'` config.
4. `a2a_report` same-session same-body loop breaker (>=3 in 10min window →
   refuse + audit; first copy still effective).

## Why (root cause)
The gate at `src/index.ts:3224` (`a2aJoinGateRefusal`) works for ordinary
unjoined sessions, but the initiator exemption (`:3233`,
`requireInitiator() === agent`) survived a broken premise: after session-node
labeling landed, the initiator's callerSession resolves via `sessionLabelOf`
(`:3747`) to an unroutable `dsh-host-<node>-<id8>` label, so
`routableCallerLabel()` = false → `callbackAddress = undefined` (`:3752`).
Deliveries succeed (activity visible) but receipts can never route back —
guaranteed dead letters. The 57-entry dead-letter pile is half this shape; live
case `direct-14ababf9`.

## Supervision constraints (in force)
- Merge order single exit: dispatcher seat `66abc2cf` (goal-622ad282); author
  (`1ce629a2`) never merges; dual-chapter seats independent — review
  `74555a36` (JG-R1), test `6e7441b6` (JG-T1); `15648149` acknowledged
  organizer/relay-only role in writing on the card.
- Dispatcher caller is network-unroutable (the very defect being fixed): A2A
  receipts cannot return → reconcile via taskboard comments + context_id
  follow-ups (ctx-dc047312 author line, ctx-93f84903 review, ctx-b6db9514 test).
- Worker sessions must never restart the host process (task-suicide loop);
  worktree + PR only, no direct pushes to master, version bump 0.5.57.
