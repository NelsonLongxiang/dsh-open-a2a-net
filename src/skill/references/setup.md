# Setup: one host, two peers, and beyond

A step-by-step path from a fresh install to a working round on three shapes
of network. Each step says WHO acts (owner or agent) and how to CHECK it
before moving on: most "it doesn't route" reports are a skipped check.

**Owner acts vs agent acts.** Installing the plugin, writing config,
restarting, joining a session to the network, adding exact names to
`teamJoinAllowlist`, and building canvas teams are human acts (the network
is human-established, gh#7 N1 / gh#11 N7). An agent prepares the exact
config, asks the owner to apply it, then verifies with the model tools. Never
drive the loopback control routes from a shell to do the owner's part:
presenting the operator's gesture on the operator's behalf is exactly the
#9 hole.

## 0. Preflight

| Check | How | Expect |
|---|---|---|
| Plugin present | `a2a_whoami` | `ok: true`. `face: session` inside a session, `host` otherwise |
| Version | `/__dsh_a2a/state` `version`, or the workbench header badge | the same version on every host you will link (0.6.28+) |
| Clock | `date` on each host | NTP-synced: card signatures carry `expiresAt`, and the OriginClaim envelope allows ±5 min |

## Human seat names

The owner can open the workbench header ⚙, select a local session under “会话席位名”, and explicitly save a stable display name (up to 64 characters; a name shaped like a route address such as `dsh/66abc2cf` is refused so it cannot pass for another session). Empty input clears the label. The `seatNames` map is stored in the home patch layer and hot-applies; cards and the board prefer it over the session title, and `a2a_whoami` / `a2a-net teams <name>` expose it. It never changes the route handle, join state or admission. Agents must ask the owner rather than self-name: A2A tool arguments containing `seatName`/`seatNames` are refused; no naming model tool exists. The owner control API keeps its existing apiKey/loopback trust model, not a sandbox against local shell or config-file writers.

## 1. One host: sessions talking to each other

**Owner:**
1. Install, then restart `dsh web`:
   `dsh plugin --profile web add @nelsonlongxiang/dsh-open-a2a-net`
2. Leave the config at its defaults. `sessionNodes: true` exposes main
   sessions as joinable nodes; no `apiKey` is needed while the listener is
   bound to loopback.
3. Join each session that should collaborate: sidebar → A2A 网络 → toggle.
   An unjoined session is invisible and refused (see
   [membership.md](membership.md)).
4. Give the sessions a shared team (`teamScopeRouting` is on by default, so a
   teamless session has no network). Pick ONE of:
   - **Canvas team (recommended):** workbench `/__dsh_a2a_nexus/` → select
     the session cards → 建队. Canvas membership is assigned by hand.
   - **Roster team:** add the EXACT name (for example `dsh/review`) to
     `teamJoinAllowlist` in the workbench owner panel (header ⚙). Each
     session then declares it with `a2a_team_join { team: "dsh/review" }`.
     A `*`/prefix entry authorizes nothing (`[PATTERN_NO_MINT]`).

**Agent, verify:**
- `a2a_whoami`: `node.joined: true`, the handle `<zone>/<id8>`, and the
  team under `teams.roster` or `teams.canvas`.
- `a2a_teams`: the other session's handle is listed.
- One sync round:
  `a2a_route { team: "<other handle>", message: "ping: reply 'pong'" }`.
  A local target gets up to 180 s. Continue the conversation with the
  returned `context_id`.

## 2. Two hosts that can reach each other (peers)

Do section 1 on both hosts first. Then the **owner**, on BOTH hosts:

1. **Reachability, both ways.** Each host must open the other's web
   listener (LAN, VPN or tunnel). There is no built-in NAT traversal.
2. **One shared `apiKey`.** Bind beyond loopback only with a key. The
   delivery face `/a2a/direct` and the log face require `X-API-Key` when a
   key is set, and a host sends ITS OWN `apiKey` on every peer request. So
   keyed hosts that talk to each other must carry the SAME key (or both
   none, loopback-only). A mismatch shows up as HTTP 401
   `X-API-Key required on the delivery face`. To link a host that must NOT
   hold the fleet key (a public node), give that one link its own key instead:
   `linkKeys: { '<other host origin>': '<link key>' }` on BOTH ends (#317).
   A link key is accepted only on the peer faces, only from the verified
   peer it names, and never on the control routes.
3. **Announce and seed each other.** Seeding BOTH ways is what makes the
   hosts linked: each side then reads the other's full card. One-sided
   seeding does not link.

   ```yaml
   - id: a2a
     name: '@nelsonlongxiang/dsh-open-a2a-net'
     config:
       announce: true
       apiKey: '<same secret on every linked host>'
       peers: ['http://<other-host>:<port>']   # the other side lists this host
   ```

   Restart. `announce` toggled from the owner panel applies on the next
   restart.
4. **Link the sessions across hosts with a canvas team.** Hosts default to
   the same zone name (`team: 'dsh'`), so a remote caller `dsh/<id8>`
   resolves to no local session. A roster declaration cannot admit it,
   because the roster holds this host's own sessions only. The record that
   admits it is a **canvas team naming both exact handles**. Build it in the
   workbench (建队 with the local session, then add the remote handle):
   - on the host that receives rounds, or
   - on either host, once they are linked (step 3).

   The other side then reads that board's `canvasOrg` from the peer's full
   card it has cached (gh#71, recognized both ways). `a2a_probe` warms that
   cache. Receipts flowing back are admitted the same way.

   Admission is target-scoped (F5): the remote member reaches only the
   sessions inside that canvas team. A linked peer can also edit your canvas
   (add or remove members, dissolve a team) through
   `/__dsh_a2a/fleet-canvas-op`; your host's link gate decides.

**Agent, verify on each host:**
- `a2a_probe`: the peer is reachable. A miss is classified as `unreachable`
  (network, port, tunnel) or `rejected` (key, signature, clock).
- State face `remote` rows: the peer's sessions appear, with `via` set to
  the peer URL. `a2a_teams` shows peer rows only for teams in this host's
  joined scope (S5, `teamScopeInfo`), so an empty list is not proof that the
  link failed.
- One async round with a receipt:
  `a2a_route { team: "<remote handle>", message: "...", async: true }`,
  then check `a2a_tasks` until the row lands in `archived` with
  `endedBy: receipt`. A peer delivery rides a 15 s transport budget:
  `-32005` means it was delivered and is still running. Reconcile; never
  resend.

## 3. Beyond direct peers (A cannot reach C)

Home-host one-hop forwarding shipped in 0.6.34 and defaults **on from 0.6.38**. Explicit `forwardDirect: false` restores local-only CLI delivery. It only follows a local miss for a bound-signed, online CLI deposited on that home, inside the unchanged sender scope. A must directly link B's receiving member (all advertised potential receivers for a canvas), and B must link the CLI and pin A as home. The home must not be isolated and any inbound Guard prevents a second forward. The outbound hop budget remains DEFAULT-1. No links are auto-created or relaxed.

Long forwarded work should use async `route` plus `inbox --wait --renew`, not expect a 15s `--sync` transport window to cover an entire model turn. A late final still produces the original task's receipt, and the forwarded row keeps selected-peer receiver facts for enforced settlement.

Other connectivity options (not authority bypasses):

1. **Make it a peer pair.** Open a tunnel or port-forward so A reaches C,
   then do section 2 for A↔C. This is the simplest and keeps receipts
   end-to-end.
2. **Delegate through B.** Route the task to a session on B, the host both
   sides reach, and have that session route on to C and report back. Each
   hop is its own task with its own receipt: B's ledger owns the B→C leg.
   Keep messages self-contained and use `async: true` per hop.
3. **Names across zones.** `delegates` publishes signed name records, so a
   name can resolve through other zones (≤5 hops, loops fail closed). That
   is name resolution, not message forwarding: the final delivery still
   goes straight to the resolved host, so that host must be reachable.

## 4. Callers outside a session

For an always-on CLI home that survives DSH restarts, run the network layer without a DSH instance: `a2a-net serve` — deployment, service files, linking and the public-internet caveats are in `docs/guides/standalone-node.md` of the repository.


Scripts and terminals use the `a2a-net` CLI: deposit on ONE home host, read
a mailbox, no wake. The home can forward eligible requests one hop under section 3; an online deposit alone grants no remote scope. See [cli.md](cli.md).

## 5. Symptom → step

| Symptom | Go back to |
|---|---|
| `declares no team membership` / `shares no team` | §1.4 (same host) or §2.4 (cross-host canvas ref on the target) |
| `caller_session is required` | the caller is not a joined session (§1.3) or an external client omitted it |
| HTTP 401 `X-API-Key required` | §2.2: keys differ between the hosts |
| `a2a_probe` → `rejected` | §2.2 key, or §0 clock; also card signature/expiry |
| `a2a_probe` → `unreachable` | §2.1 reachability (bind address, firewall, tunnel) |
| peer reachable but its sessions never appear | §2.3: seeding is one-sided, or the peer did not `announce` |
| `No live DSH session node accepts team X` | X is on another host and nothing forwards (§3), or X is not joined/live there |
| `[PATTERN_NO_MINT]` / `[ALLOWLIST_DENY]` | §1.4: add the EXACT team name to the allowlist |
| `[CANVAS_TEAM]` from `a2a_team_join` | canvas teams are built in the workbench, not joined by tool |
