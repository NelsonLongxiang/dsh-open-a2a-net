# Assignment-card delivery and a turn that ends before the answer (#751)

Status: implementation candidate; isolated project tests, not live acceptance or permission to publish/deploy.

## Contract

The executor keeps one member slot before it calls the assignment-card delivery adapter. The assignment itself remains pending until the adapter confirms acceptance. The durable binding carries `card: sending`; the binding's existing `run` identifies this particular send.

A claim takes a causal number after the send boundary. A turn end arriving while that exact send is pending is kept in memory, together with its claim number, rather than lost or settled prematurely. Only an accepted card, the unchanged binding and the latest claim may replay that idle. A later claim supersedes it. The assignment is marked running and its inputs are recorded delivered before the normal settle path decides whether the member should park or retain background work.

A member can report against its tentative binding while the card answer is pending. A terminal result removes it normally and a late transport answer cannot revive it. The new guard prevents reassignment while the original card answer is pending. Refused delivery releases the tentative hold; the assignment stays pending and the original retry policy still applies. The prepare path keeps its prior behavior and is covered by the existing regression set.

## Persistence and restart

The sending marker is saved before calling the delivery adapter and is not cleared on disk until the running-assignment fact has been saved. A failed reservation commit sends nothing. A later failed commit retains the sending marker and member hold rather than automatically posting another card.

A restored `sending` record becomes `unknown`. The member remains held, no card or follow-up input is automatically sent, and the original ticket is exposed for reconciliation. When no worker report exists, the executor writes a failed report explicitly saying that card delivery is unknown, not that the business work failed. If a genuine report or question already exists, it is preserved and the uncertainty is recorded as a note instead. A repeated restart does not resend the assignment.

After checking the original member, task and external effects, the authorized operator may use the existing explicit stop/retry/reassignment actions. Retry creates a new run and respects the existing queue order; it is not proof the earlier run never executed. A waiting report that already contains a question is not silently replaced just to make retry possible.

Stopping a host closes its executor. A late promise from that stopped instance does not save bindings over the replacement host's state.

## Downgrade and limitations

An older executor does not enforce the `card` marker and may resume or retry pending work. Do not downgrade an active home carrying `sending`/`unknown` card records. First stop all writers, preserve the failure state and reconcile the original requests. Restore a coherent version-matched home/queues only through the existing approved rollback procedure; a surviving JSON field is not a downgrade safety guarantee.

This change does not introduce a cryptographic acceptance proof, change the delivery adapter's boolean contract, or make unkeyed local idle events identify arbitrary concurrent work. Claims and idle are still supplied by the existing authenticated host/seat path. A delivery adapter that reports `false` after committing an effect violates its existing refusal contract; this change does not silently convert that into permission for blind replay. It also does not retrofit unknown-send protection into other delivery kinds or grant publication/deployment authority.

## Checks

The regression set covers immediate and held-card idle, claim order, refused delivery, stop, member reports before the delivery answer, nonquiet background work, crash/restart and explicit post-reconciliation retry. Separate injected commit failures cover reservation, accepted-result persistence and clearing the marker after `assignmentStarted`. Those are project tests in an isolated home; no real ticket, queue, host session, permission or credential is modified.
