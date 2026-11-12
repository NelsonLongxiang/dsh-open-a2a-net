# superagent: staffing changes the market proposes and the node carries out

Status: **approved by the owner, 2026-11-12** (「都交给你办吧，你都可以的」, handing the review seat the open owner items). Not implemented. Written 2026-11-11.

- **Rulings:** the five boundary points below are taken as proposed: the W2 defaults, rules proposed from the market and confirmed on the node, the node's approvers confirming, and a retired member's open ticket finishing.
- **Next:** S1 is queued behind the root-team work. Each step is high tier and needs a non-self review PASS.
- **2026-11-12, the team builder** ([superagent-builder](superagent-builder.md)): S1 is split into S1a (the core, with the source as a field) and S1b (the market's entry). The builder is a second source, `owner-local`, of the same changes. `team.rules.set` gains a `scope` and `member.add` a `profile`, for both sources (W2, W6).

- **Asked for by** the workbench market's design session, after the owner's direction (2026-11-11): building an A2A team should be possible from the market; the canvas is easy for the owner but does not suit management. The market's side is `docs/productization/14-team-and-assignment.md` §8 in the market repository: management sees a staffing table (department → team → members, members added from job templates), not a canvas.
- **The boundary the market proposes, kept here:** the market holds no node credential and changes nothing on a node directly. It **proposes** a staffing change. The node checks where it came from, carries it out with its own authority, and the roster it reports is what counts as done.
- **What this document changes:** until now, adding an AI member was the owner's act on the node. With this design, a registered market can cause a node to start a new session (which spends model budget) inside limits the node's owner set in advance.

## Context: what the node already has

- **Canvas teams** (design v5). A superagent team is a canvas team bound to a router. Every other session on the canvas is a member with one worker slot. Members can sit on another DSH instance, under another system user (`docs/ops/superagent-team-user.md`), pinned by card key.
- **Role presets.** `superagent-router`, `superagent-member` and `superagent-observer` (in `cordis.patch.yml`) fix what each role may do. Tool limits, credential audit (#612) and the outbound rules follow the preset, not the session's text.
- **Node identities** (`docs/design/node-identity.md`, `src/node-store.ts`). A node record is long-lived and human-named, its name is never reused, and it carries a session's workplace: checkout (`cwd`), agent preset and model. A session can carry a node, and a new session can be started for it. This is the natural place for a stable seat and for job templates.
- **Roster** (#606, `docs/design/superagent-market-progress-roster.md` P3). The node sends a full snapshot of its seats to peers that declare `teamRoster`, every 5 minutes and 30 s after a change.
- **Named dispatch (B1, implemented 2026-11-11, `superagent-named-dispatch.md`).** It gives each member slot a stable `seatId`. This design depends on it.

## Decisions

### W1. The entry: a staffing message over A2A

- **Shape.** A routed A2A message to the team host's process team. The text is human-readable; the envelope carries the change:
  ```json
  {"staffing":{"id":"<market change id>","op":"member.add","team":"<teamId or canvas>","params":{…},
               "by":{"person":"<market person id>","name":"…","role":"lead|manager|admin"}}}
  ```
- **Who is believed.** Every condition must hold:
  - the caller is on a new node setting **`staffing.sources`**, which the node owner writes on the node only (never through this entry). An entry is a handle plus the pinned card key;
  - the request carries a valid Sig3 signature from that key;
  - the caller's pinned card declares `staffingChanges`;
  - the node itself has `staffing.on` (off by default).
- **`by` is recorded, not trusted.** The node cannot check the market's people. It writes `by` into its log and the confirmation card so the owner can see who asked. It never grants anything because of `by`.
- **Idempotency.** `staffing.id` is the key, kept in a persisted ledger (`staffing.json`, capped). The same id with the same body returns the recorded answer again. The same id with a different body is refused (`conflict`) and raises a P1 card.
- **Answers.** Answers ride the existing receipt envelope on the A2A task. One task owes one formal receipt:
  - `ack-<task>`: received, with `state: queued | awaiting-owner`;
  - `attention-<task>-staffing`, if the owner asks a question back;
  - `receipt-<task>`: `done` (with the result, e.g. `seatId`, `teamId`), or `refused` (with `code` and a reason in words).
- **Matching it to the roster.** `done` carries `rosterSeq`, the sequence number of the first roster snapshot that contains the result. The roster gains a monotonic `seq`. The market counts the change as finished when it holds a roster with `seq ≥ rosterSeq`. "Done but no roster yet" shows as 「节点已办，名册未到」.

### W2. What the market may ask for, and the default policy

The market may ask for six operations. Each has a policy on the node, `auto | confirm | off`, set only by the node's owner.

| op | What the node does | Default |
|---|---|---|
| `team.create` {name, router template, rules template?} | creates a canvas team, starts a router session from the template, binds it as a superagent team | **confirm** |
| `team.retire` {team} | unbinds the team; its members take no new work; open tickets finish | **confirm** |
| `member.add` {team, template, name} | creates a node identity from the template, starts its session, puts it on the team's canvas | **auto**, within quota |
| `member.retire` {team, seatId} | the seat takes no new work, finishes its ticket, leaves the canvas; its node is archived, never deleted | **auto** |
| `member.retemplate` {team, seatId, template} | changes the seat's template; the next ticket starts on a session from the new template | **confirm** |
| `team.rules.set` {team, rules[]} | replaces the team's intake rules (text only) | **confirm** |

- **Extensions (2026-11-12, [superagent-builder](superagent-builder.md) TB3).** `team.rules.set` takes `scope`: `team` (the intake rules above, the default), `dispatch` or `member:<seatId>`, matching the rule sets' three scopes. `member.add` takes an optional `profile` (role, intake rules, repository); with a template it defaults to the template's rules. Both stay text only and `team.rules.set` stays **confirm** whatever its scope.

- **What `confirm` means.** The node puts a P0 decision card on its own workbench showing the change, the diff, and who asked (`by`). The owner, or an approver the owner named, accepts or refuses it there. The market sees `awaiting-owner` until then.
- **What the market can never change through this entry:**
  - credentials, MCP servers or tokens, and model API keys;
  - tool grants or blocks, the extra tools granted to the router, and the preparation command;
  - `staffing.sources`, `bots`, the A2A allow-list, and the GitHub settings;
  - which system user or DSH instance runs the members, and any file path.

  These stay owner-only on the node. A body that names any of them is refused with `code: not-allowed`.

### W3. Why a compromised market is not a compromised node

1. **Templates hold all the power, and they live on the node.** The market sends only a template id. The node's owner wrote the template: role preset, model, checkout, member host, default rules. A market request cannot widen a template or name a field outside it.
2. **The parameters are inert.**
   - `name` is a label (`NODE_NAME` charset, length-capped). It is never a path, URL, command or tool name.
   - `rules` are text. Rules cannot grant a tool, a credential or a destination: those are enforced by the preset, role tools, the credential audit and the outbound rules, whatever the text says.
   - That is also why `team.rules.set` defaults to **confirm**: text can still steer a team within what it is allowed to do.
3. **Isolation does not move.** A new member session starts on the member host the template names, inside whatever isolation that host already has.
   - *2026-11-12:* the owner withdrew separate system users for team sessions (`superagent-team-user.md`, not pursued). A member therefore runs under the host's user and can read what that user reads. The token rule ([superagent-team-mcp](superagent-team-mcp.md): in the host's memory only) and the credential-access audit carry this instead.
   - The node never creates a system user, never changes file permissions, and never copies a credential because of a staffing message. Creating OS users stays the owner's administrator act, done once.
   - A template that would start members under the owner's own user is marked `local-owner` in the catalogue, and `member.add` with it is always **confirm**, whatever the policy says.
4. **Quotas bound the damage.** These are owner-set limits on the node:
   - members per team (default 6);
   - market-created members per node (default 12);
   - changes per hour (default 20).

   Past a limit the change is refused (`quota`), or held for confirmation if the owner prefers.
5. **Everything is visible and reversible.**
   - Each change is listed on the node's workbench with its source and `by`.
   - `member.retire` archives and never deletes, so it can be undone on the node.
   - One switch (`staffing.on = false`) stops the entry. Turning it off refuses new changes and leaves done ones as they are.

What a fully compromised market can therefore do is limited:
- start up to the quota of members from templates the owner already approved, inside the existing isolation;
- retire members, which is disruptive but reversible;
- propose rules and teams that wait for the owner.

It cannot read or move credentials, widen tools, or reach the owner's user.

### W4. Job templates live on the node; the market keeps the id and the words

- **A template** is a node-side record:
  ```text
  {id, label, description, role: member|observer|router, preset, model, checkout,
   memberHost (this instance | a linked instance by pinned key), defaultRules?, local-owner?}
  ```
  It maps onto what already exists: the role presets, plus a node identity's carrier (`cwd`, `agentPreset`, `model`).
- **The catalogue.** The node publishes `{id, label, description, role}` for each template in its roster, as a new `templates` section that a market can list. It never publishes paths, models or hosts.
- **The market** stores only the template id and its own human wording. Yes: the configuration stays on the node, and this is what keeps W3 true.
- **Who maintains them.** The node owner, in the team settings (a new 岗位模板 block). The market's "system administrator maintains templates" becomes "the market's administrator chooses which of the node's templates to offer, and words them".

### W5. Canvas-built and market-built are the same thing

- Both are a canvas team bound as a superagent team, with members that are canvas members.
- A market-built member is also a node identity, so its `seatId` is the node name: stable, never reused, and it survives the session being replaced.
- For a canvas-built member, B1 assigns a `seatId` the same way. The owner can attach a node identity to it later.
- The roster reports them alike. One optional field, `origin: canvas | market:<change id>`, says where a seat came from. The market should not treat seats differently because of it.
- Edits made on the canvas show up in the next roster, as today. There is no second copy of the structure anywhere.

### W6. Order and size

1. **S1: entry, ledger, policy and confirmation cards**, with `member.retire` and `team.rules.set`. High tier. About 1.5 days. Split on 2026-11-12 ([superagent-builder](superagent-builder.md) TB6):
   - **S1a, the core:** the executor (host-run), the ledger with parent and child entries, the policy, the confirmation cards, `source` as a field (`owner-local | market:<handle>`), and the W2 extensions. The team builder's first real source.
   - **S1b, the market's entry:** `staffing.sources`, Sig3, `staffingChanges`, receipts and `rosterSeq`.
2. **S2: templates and `member.add`/`member.retemplate` on this instance**, with node identities as seats and the roster `templates` catalogue. High tier. About 2 days.
3. **S3: `member.add` on a member host under another system user, and `team.create`/`team.retire`.** High tier. About 2 days. The separate-user precondition is gone (2026-11-12); a linked member instance is still a valid member host.

**Place in the queue:** after B1 (named dispatch, which brings `seatId`) and `reworkReturns`, in parallel with or after C (streaming status). Each step needs a non-self review PASS. Until S1 ships, teams are built on the node and the market claims them, as §8.5 of the market document says.

## Points that change a boundary: the owner decided (2026-11-12, as proposed)

1. **A market may cause a node to start sessions** (and spend model budget), within quotas and templates the owner set. Until now only the owner added members.
2. **The defaults in W2:**
   - creating or retiring a team, changing a template and changing rules need the owner's confirmation;
   - adding and retiring members within quota do not.
3. **Team rules may be proposed from the market**, and confirmed on the node by default. This differs from the market document, which lets the team lead change rules directly.
4. **Who confirms on the node.** The owner, plus approvers named on the node (the same list as outbound requests). A market-side role never confirms.
5. **Retiring a member lets its open ticket finish** rather than stopping it. The alternative is stop-and-reassign, as removing a member from the canvas does today.

## Unknowns to check before S2/S3

- Starting a new session for a node identity from the team host, and on a linked member host through `serve`: the session-controller path is there for node identities, but not yet driven from superagent.
- `node-identity.md` §8 rulings still pending (#161): naming and archiving rules may shape `seatId`.
