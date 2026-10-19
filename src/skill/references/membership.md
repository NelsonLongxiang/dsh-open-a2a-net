# Membership: join, leave, teaming

## Joining

- GUI: sidebar → A2A 网络 → join toggle. The join writes the session into
  `a2a/joined.json` (node home) — this is the discovery + admission
  membership layer.
- API-created sessions do NOT materialize a consumable agent; open the
  session in the GUI once (a queued prompt is then consumed) or create the
  session through the GUI.

## Teaming

- `a2a_team_join { team }` — declare a membership in `a2a/teams.json`
  (roster store, restored at construction). Subject to the owner's
  `teamJoinAllowlist` (empty list denies every join; entries are exact names
  or trailing-`*` prefixes).
- `a2a_team_leave { team }` — retract one declaration.
- Canvas teams (`<zone>/canvas/<name>`) are user-composed groups created in
  the planning view (建队) — any joined node can be a member; a node may sit
  in multiple teams.

## Admission (S3, default on)

- Outbound: a session with no declared team has no network
  (`teamScopeRouting`, default true; explicit false restores the open seam).
- Inbound: `/a2a/direct` requires a SHARED team between caller and target —
  the caller's declared teams (roster store) must intersect the target's
  routable set. Refusal text names the missing membership.
- Anonymous deliveries (no `caller_session`) are refused outright.

## Information-plane scoping (S5, default on)

- The read-only fleet tools answer from the joined-team scope only
  (`teamScopeInfo`, default true; the union of this host's roster
  declarations): `a2a_teams` lists `[this host]` rows plus peer rows
  serving a joined team (own name or roster declaration — the `note`
  field explains the scope), `a2a_status` narrows peers/routes/activity
  to that scope (local traffic stays), `a2a_probe` sweeps serving peers
  and refuses a single URL whose card cannot prove service.
- `a2a_tasks` (this host's own dispatch ledger) stays unscoped — it is
  the receipt-reconciliation surface for this host's own dispatches.
- A host whose nodes declare no teams keeps host-internal facts only;
  explicit `teamScopeInfo: false` restores the open plane.

## Leaving

- `a2a_team_leave` per team; the network-level leave (退网) removes the
  session from discovery and the join gate grants. Rejoining later is cheap —
  there is no penalty for cycling membership around task boundaries.
