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
  (roster store, restored at construction). Gated by the owner's
  `teamJoinAllowlist`: an empty list denies every join, and only an EXACT
  name joins. A wildcard or prefix entry matches nothing at join time
  (`[PATTERN_NO_MINT]`, gh#11/N7) — adding the exact name IS the act of
  creating the team, which is a human act. The owner edits the list in the
  workbench owner panel (header ⚙, gh#34) or in the profile patch.
- A canvas team (`/canvas/` in the name) cannot be joined through the roster
  tool (`[CANVAS_TEAM]`): canvas membership is assigned by hand.
- `a2a_team_leave { team }` — retract one declaration.
- Canvas teams (`<zone>/canvas/<name>`) are user-composed groups created in
  the planning view (建队) — any joined node can be a member; a node may sit
  in multiple teams.

## Admission (S3, default on)

- Outbound: a session with no declared team has no network
  (`teamScopeRouting`, default true; explicit false restores the open seam).
- Inbound, same-zone caller (`<this zone>/<id8>`): `/a2a/direct` requires a
  SHARED team, judged at the TARGET level (F5, gh#26) — the caller's declared
  set (roster ∪ canvas memberships) must intersect the target session's own
  link set (its roster ∪ its canvas teams); a host-level link alone does not
  open every session team. The process face (target = the bare zone) keeps
  the host-level exemption. Refusal text names declared vs target links.
- Inbound, foreign-zone caller: admitted only through a canvas remote member
  ref this host's operator added by hand (N3/N4); the caller's own card
  claims are self-description, not links.
- Inbound, free-form caller label: only this host's own node facts — a joined
  session id, a live node label, or a deposited CLI handle (see
  [cli.md](cli.md)).
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

## Exposure tiers (#19)

- `a2a_exposure` sets a session's own tier: `linked` (the default floor) or
  `fleet` (a voluntary opt-up). There is no tier below linked in v1, and a
  group's visibility derives from its strictest member (no group knob).
- On the card face, member listings go to LINKED callers only (see
  [discovery.md](discovery.md)); as of 0.6.27 the fleet tier is recorded but
  does not widen the card face.

## Leaving

- `a2a_team_leave` per team; the network-level leave (退网) removes the
  session from discovery and the join gate grants. Rejoining later is cheap —
  there is no penalty for cycling membership around task boundaries.
