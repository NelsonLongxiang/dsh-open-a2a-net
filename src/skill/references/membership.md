# Membership: join, leave, teaming

## Joining

- GUI: the workbench planning board (`/__dsh_a2a_nexus/`, the session row's
  network join/leave action — the panel-slim move took join/leave out of the
  sidebar). The join writes the session into `a2a/joined.json` (node home) —
  this is the discovery + admission membership layer.
- API-created sessions do NOT materialize a consumable agent; open the
  session in the GUI once (a queued prompt is then consumed) or create the
  session through the GUI.

## Teaming

- A team is a canvas team (owner ruling 2026-11-18). There is no tool that
  joins or leaves one: the owner composes it on the workbench board, or the
  team builder (组队顾问) drafts a blueprint the owner agrees to.
- Roster teams (`a2a/teams.json`) are retired: no session can declare one
  any more. A roster declared before still counts for one version, and the
  owner can still remove a member from it or dissolve it on the board.
- Canvas teams (`<zone>/canvas/<name>`) are user-composed groups created in
  the planning view (建队) — any joined node can be a member; a node may sit
  in multiple teams.

## Admission (S3, default on)

- Outbound: a session with no declared team has no network
  (`teamScope`, default true; explicit false opens routing and information together).
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
  (`teamScope`, default true; the union of this host's roster
  declarations): `a2a_teams` lists `[this host]` rows plus peer rows
  serving a joined team (own name or roster declaration — the `note`
  field explains the scope), `a2a_status` narrows peers/routes/activity
  to that scope (local traffic stays), `a2a_probe` sweeps serving peers
  and refuses a single URL whose card cannot prove service.
- `a2a_tasks` (this host's own dispatch ledger) stays unscoped — it is
  the receipt-reconciliation surface for this host's own dispatches.
- A host whose nodes declare no teams keeps host-internal facts only;
  explicit `teamScope: false` restores the open plane (routing too).

## Exposure tiers (#19)

- `a2a_exposure` sets a session's own tier: `linked` (the default floor) or
  `fleet` (a voluntary opt-up). There is no tier below linked in v1. **As it
  stands today the tier is only persisted (`a2a/exposure.json`) and shown in
  the state face — no card or directory code reads it** (owner ruling on
  #449, 2026-11-08: document it as it is), and "a group's visibility derives
  from its strictest member" is a written rule with no group-level API or
  enforcement point in v1.
- On the card face, member listings go to LINKED callers only (see
  [discovery.md](discovery.md)); the fleet tier is recorded but does not
  widen the card face.

## Leaving

- A canvas team member leaves when the owner removes it on the board (or
  through a builder blueprint); the network-level leave (退网) removes the
  session from discovery and the join gate grants. Rejoining later is cheap —
  there is no penalty for cycling membership around task boundaries.
