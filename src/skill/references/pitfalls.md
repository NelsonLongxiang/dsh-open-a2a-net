# Operational pitfalls (production-observed)

## Sessions

- **API-created sessions do not materialize.** `session/create` registers an
  in-memory record; the sessions directory never appears and queued prompts
  are never consumed. Create sessions through the GUI, or open the session in
  the GUI once after creating via API.
- **adopt-style revive only works for previously materialized sessions** —
  it is an idempotent revive, not a creation path.

## Routing

- **Do not blindly re-dispatch after a sync timeout.** -32005 means the
  delivery landed; the peer may still be executing. Reconcile the task id
  first (receipt or query), or you will double-execute.
- **Unroutable caller labels** (e.g. CLI-initiated `cli-manager/...`) cannot
  receive receipts — use the initiating session's own node team, or expect
  the receipt to be dropped. Deliveries still land.
- A sync route's 15s transport budget is shorter than most model turns. For
  anything that runs long, prefer `async: true` and the receipt contract.

## Names and prefixes

- Python-tool registrations come in two families: shared `py__<name>` and
  dispatcher-exclusive `py__dispatch__<name>`. A route resolving a member
  tool against the wrong family fails with "cannot read properties of
  undefined (reading 'find')" — check which wave registered the tool before
  blaming the route.
- alpha.4 harness sessions have no `.events` accessor — integrations must
  use `session.snapshotEvents()` (or guard), or they crash new-session turns
  with "Cannot read properties of undefined (reading 'length')".

## Configuration

- `teams-scan` roots are resolved against the process CWD when relative. A
  bare `disabled: true` row hides whole team mounts; pointing `roots` at
  per-team `.agents/teams` directories is the reliable form. Do not add a
  second scan source alongside packaged team bundles — double registration
  crashes alpha.4's strict NamedEntries loader.
- The "Set TEAMS_ROOT" hint in the dir-degraded error is misleading: there is
  no such env var; the scan reads its `roots` from config.
