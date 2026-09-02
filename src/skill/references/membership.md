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

## Leaving

- `a2a_team_leave` per team; the network-level leave (退网) removes the
  session from discovery and the join gate grants. Rejoining later is cheap —
  there is no penalty for cycling membership around task boundaries.
