# superagent: the team builder, a session that drafts teams with the owner

Status: **proposed, 2026-11-12.** Not implemented. The owner asked for it on 2026-11-12, and the direction was agreed in the review seat's session the same day (「写设计稿」). The four points that change a boundary are listed at the end; they need the owner's ruling before BS2.

- **Asked for by** the owner (2026-11-12): a new preset whose job is to create teams and organize their members. It gives the owner convenient tools, including the initial router intake and dispatch rules and each member's intake rules. It takes no tickets and dispatches nothing. It only aligns with the owner on what they need, and gives them decisions and advice on how to build the team, so that a team, and then an organization, can be put together quickly.
- **Discussed with** the review seat's main session (2026-11-12). Its conclusion, kept here: the builder is the **local, owner-facing entry into the staffing changes** of [superagent-staffing-changes](superagent-staffing-changes.md) (#626), not a second way to build a team. A team the builder drafts and a team the market asks for are the same thing (#626 W5).
- **Why host behavior, not persona text:** the same lesson as #558 and #620. What the builder may do is fixed by the role-tools guard and checked by the staffing executor. The persona only describes the job.

## Context: what exists today

- **A team is a canvas team bound to a router** (design v5). The owner composes it on the canvas (`POST /__dsh_a2a/canvas`, actions `create`, `add-member`, `remove-member`) and binds it on the team page (`POST /__dsh_a2a/superagent/teams`). No agent tool composes a canvas or binds a team.
- **Rule sets** ([superagent-router-owner-asks](superagent-router-owner-asks.md) D8–D10a). There are three scopes: `team` (the router's intake rules), `dispatch` (how the router picks a member) and `member:<id>` (one member's role and intake rules). A session proposes the whole new text of a set it owns. It applies the text only after the owner's own typed message agrees (D10). The owner can also edit any set on the team page, behind the GUI login.
- **Roles and presets.** `superagent-router`, `superagent-member` and `superagent-observer` fix what each role may call (`role-tools.ts`). A session holds at most one team role. The credential-access audit (#612) watches every role session.
- **Sessions are never created by the host** (S39, 2026-11-07: no new sessions, only existing members). #626 allows a node to start sessions from job templates within quotas, but that is #626 S2, which is not built.
- **Staffing changes (#626, approved 2026-11-12, not built).** Six operations: `team.create`, `team.retire`, `member.add`, `member.retire`, `member.retemplate` and `team.rules.set`. Each has an owner-set policy (`auto | confirm | off`). Changes go to a ledger, `confirm` raises a decision card, and there are quotas and a list of things that can never be changed (W3).

## Decisions

### TB1. One preset, `superagent-builder` (组队顾问), outside every team

- The builder is a session the owner creates under a new preset, `superagent-builder`, shipped in `cordis.patch.yml` beside the other three.
- It holds **no team role**. It is never a router, member or observer, and never sits on a team's canvas. The host refuses to put it on one, in the same way it refuses a session that already holds a role.
- It takes no tickets, dispatches nothing, sends nothing over A2A and answers no candidates. The owner is the only person it works for. A relayed A2A message or an agent's message in its session is context only. It is never a request and never an agreement (D10).
- A host may have more than one builder session. They share the ledger, so one blueprint is applied once.

### TB2. What the builder may call: inventory, proposals, nothing that writes

The role-tools guard gets a fourth role, `builder`. Its list is:

| Tool | What it does |
|---|---|
| `superagent_org_read` | Read-only inventory of this instance: teams with their canvas, router and members (by `seatId`), each member's preset, role and intake rules, the team and dispatch rules with their revisions, the root team and its child teams, the local sessions that are on no team and their presets (the candidates), quotas, and the staffing ledger's recent and pending changes. It never returns anything in #626 W3's list (credentials, MCP servers, tool grants and blocks, bots, the A2A allow-list, GitHub settings, file paths, system users). |
| `superagent_rule_templates` | The built-in rule templates (TB5), to start a draft from. |
| `superagent_blueprint_propose` | Records a blueprint (TB3) as a pending staffing change. Nothing changes. The tool returns the diff to show the owner. |
| `superagent_blueprint_apply` | Lets the host carry out the builder's own pending blueprint, only after the owner's own typed message in this session agreed to it (TB4). |
| `superagent_blueprint_withdraw` | Withdraws its own pending blueprint. |
| `a2a_whoami`, the schedule tools for itself | As every role. |
| `read`, `glob`, `grep` | Read-only files, to look at a repository before recommending who works on it. |

- Everything else is refused at the call: `bash`, `write`, `edit`, subagents and other sessions, A2A sending, the canvas and team routes, ygl-trees writes. The guard enforces this whatever the preset says.
- The credential-access audit covers the builder like any role session. Since the owner withdrew separate system users (2026-11-12), the builder can read what the host's user can read, so `read` is in the audit's scope.
- The builder's recommendations go to the owner in its own conversation. They are not prose questions spread across turns: each choice the owner must make is put with options and the one it recommends, as the team norms ask of the router.

### TB3. A blueprint is one batch of staffing changes

A blueprint is a #626 staffing change with a source of `owner-local`. It is one parent ledger entry with ordered child operations:

```text
{ id, source: 'owner-local', by: { session: <builder session> }, summary,
  ops: [ { op: 'team.create',     params: { canvas, router: <existing session> } },
         { op: 'member.add',      params: { team, session: <existing session>, profile?: { role, rules[], repo? } } },
         { op: 'team.rules.set',  params: { team, scope: 'team' | 'dispatch' | 'member:<seatId>', value } }, … ] }
```

- **Only existing sessions.** Until #626 S2 ships, `member.add` and `team.create` accept only a session that already exists, under the role's preset. A template is refused. This keeps S39. Once S2 ships, `member.add` may name a job template like the market does. The node starts the session within the owner's quotas, and the builder still holds no power to start one.
- **Two operations are extended, no new ones are added** (one concept, one name):
  - `team.rules.set` gains a `scope` matching the rule sets' three scopes: `team`, `dispatch` and `member:<seatId>`. A scope of `team` is #626's original meaning.
  - `member.add` gains an optional `profile` (role, intake rules, repository). It defaults to the template's rules once templates exist.
  - These two extensions apply to the market's entry too.
- **A team in the same blueprint** is named by its canvas. A team that exists is named by its `teamId`. Members are named by `seatId` (named dispatch B1), never by session id, except in the `session` that `member.add` puts on the team.
- **Never in a blueprint:** anything in #626 W3's list, approvers, models, prompt supplements, sources, root-team links across hosts, and `team.retire` or `member.retire`. The executor refuses a body that names any of them with `not-allowed`. Retiring, approvers and the rest stay on the team page in this version.

### TB4. The owner agrees in the builder's conversation; the host carries it out

- **The gate is D10's.** The owner's own typed message in the builder session agrees to the blueprint. The host marks that message, and no shell can produce it. The message must be newer than the proposal and the same proposal must still be pending, as for `superagent_rules_apply`.
- **The builder never holds the owner's proof.** It has no GUI login and no control key. After the owner agrees, the **host's staffing executor** (#626 S1a) carries out each operation with the host's own authority. It calls the same internal checks the canvas and team routes run: the preset check, one role per session, the canvas member checks and quotas. Nothing is skipped because the source is local.
- **New teams and existing teams:**
  - A blueprint that **only builds new teams** is agreed in the conversation. There is no team yet to hang a card on.
  - A blueprint that **changes a team that exists** also puts a confirmation card on that team: one card per team, listing its changes. The owner, or an approver of that team, confirms it on the team page. The builder says 「已提交到团队 X，等你确认」 and nothing else. The team's operations run once its card is confirmed. A blueprint's agreement in conversation does not stand in for that card.
  - No card is ever raised outside a team.
- **Record.** The ledger keeps the blueprint, the builder session that drafted it and the owner's message that agreed. Each team it built or changed gets one line in its rule-set history: 「由组队顾问蓝图 <id> 起草，主人确认于 <time>」.
- **Failure.** The executor runs the operations in order. If one fails, it stops, undoes the completed ones in reverse (remove the members it added, unbind and remove a team it created, restore a rule set to its previous revision), and records why. An undo that fails leaves the ledger entry in `partial` with each step's state. A team that exists gets a P1 card that says what is left. The builder reads this and tells the owner. It does not retry by itself.

### TB5. Built-in rule templates

- The package ships three to five starting texts for each of the three rule sets: the router's intake rules (`team`), dispatch (`dispatch`) and a member's intake rules (`member`). Examples are a single-repository dev team, a research team with an observer, and a finance-approval team.
- They are data in the package, read through `superagent_rule_templates`. The builder starts from one and edits it with the owner. The owner sees the whole final text in the diff before agreeing.
- **Naming:** these are **rule templates (规则模板)**, text only. #626's **job templates (岗位模板)** are node records that carry a preset, a model, a checkout and a member host. Once job templates exist, a job template's `defaultRules` may name a rule template. The two are not merged and not called by each other's name.

### TB6. Order

1. **S1a, the staffing core with no source attached** (review seat line, high tier):
   - the staffing executor, run by the host and never an agent tool;
   - the ledger (`staffing.json`, idempotent by id, with a parent and child entries);
   - the `auto | confirm | off` policy per operation, and the confirmation cards;
   - `source` as a field (`owner-local | market:<handle>`), and the two extensions in TB3.

   This is the first half of #626 S1.
2. **BS1, the builder preset and inventory** (mid tier): the preset, the `builder` role in the guard, `superagent_org_read`, `superagent_rule_templates` and the built-in templates. Nothing writes yet. It can be built beside S1a.
3. **BS2, blueprints** (high tier, after S1a): `superagent_blueprint_propose`, `_apply` and `_withdraw`, the D10 gate, per-team cards for existing teams, rollback, and the history line.
4. **S1b, the market's entry** (#626 S1's second half): `staffing.sources`, Sig3, `staffingChanges`, receipts and `rosterSeq`. The market loses nothing by waiting: until then, teams are built on the node and the market claims them (#626 §8.5).
5. **Later:** `member.add` from job templates (#626 S2), child teams across hosts in a blueprint, and retiring through the builder.

Each high-tier step needs a non-self review PASS.

## Points that change a boundary: for the owner's ruling

1. **Agreement in a conversation causes a team to be built.** Until now, composing a canvas and binding a team were the owner's acts on the page or the control route. With BS2, the owner's typed message in the builder session lets the host do both. This is the gate the router's rule changes already use (D10), applied to staffing.
2. **A session other than the member drafts a member's rules.** D10a says a member's rules change only on the page or by that member's own proposal. The builder adds a third way, always owner-confirmed. For a new member, the agreement is in the blueprint conversation. For an existing member, it is on that team's card.
3. **The source `owner-local` uses no `auto`.** #626's defaults let the market add members within quota without confirmation. A blueprint is always agreed as a whole, so nothing in it runs on `auto`.
4. **The builder reads files** (`read`/`glob`/`grep`), so that its advice can name who should work on which repository. Without them, it can still read the inventory and ask the owner. The credential audit covers it either way.

## Out of scope

- Starting sessions (until #626 S2), child teams across hosts, retiring teams or members, approvers, models, prompt supplements, and the market's side.
- Changing what a router, member or observer may do. The builder only puts existing roles together.
