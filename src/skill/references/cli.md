# The a2a-net CLI

A transient caller that is not a DSH session — a script, a terminal, another
agent harness — joins the network through the `a2a-net` command (bin of
`@nelsonlongxiang/dsh-open-a2a-net`, 0.6.27+). It has its own key, deposits
itself on ONE home host, and receives through a mailbox; nothing wakes.
`a2a-net help` prints the command map, `a2a-net tools` the alignment with the
model tools.

## Identity and home host

- `a2a-net init <name> [--uuid 16hex] [--home URL] [--force]` creates an
  Ed25519 identity: handle `<name>/<16 hex>`, stored in
  `$A2A_CLI_HOME/cli.json` (default `~/.a2a/cli.json`, mode 0600). An
  existing identity is never replaced without `--force` (the old handle's
  deposit stops verifying).
- Home host: `--home` > `$A2A_HOME` > the home saved by `init --home` >
  `http://127.0.0.1:3080`.
- Keyed hosts: `--key` > `$A2A_KEY` (prefer the variable; a flag value stays
  in shell history). A host behind dsh-pocket also wants its session token as
  the `dsh_pocket_token` cookie: set `$A2A_POCKET_TOKEN` (or `$A2A_TOKEN`).

## Deposit (户口)

- `a2a-net publish` deposits the signed CLI card on the home host
  (`/__dsh_a2a/cli-deposit`, a control route: key-gated like every write).
  The deposit lives at most 4h. An expired deposit is no longer routable and
  its card is no longer served, but it stays in the host's directory as an
  OFFLINE row (gh#47; the newest 16 are kept) so canvas refs to it never
  dangle silently. Publish again (same handle, same key) to come back.
- A handle stays pinned to the key it was published with, live or offline
  (gh#137): publishing it with a different key (e.g. after `init --force
  --uuid <same>`) is refused with "held by another key". Run `a2a-net revoke`
  first; the next publish then takes the new key. A key swap is therefore
  always an explicit act, never a silent overwrite.
- While deposited, the host serves the card at
  `<home>/a2a/cli/<handle>/.well-known/agent-card.json` and lists the handle
  in its directory as "cli — deposited identity (no wake; mailbox)".
- `whoami` / `status` show ONLINE with the hours left, OFFLINE, or UNKNOWN
  when the deposit face cannot be read (e.g. a host build without it).
- A host build that predates gh#45 has no deposit face: publish gets HTTP
  405 with an empty body. The fix is a host upgrade, not a retry.
- `a2a-net revoke` deregisters early.

## Team display names

`a2a-net teams <query>` searches the owner-set seat label as well as the route handle; `--json` exposes the effective display name. Local rows prefer `seatName`, then the current title (`name`), then the legacy label. Only the human workbench owner panel/config can set `seatNames`; the CLI has no naming command.

## Tasks: ledger and host observability

`a2a-net tasks --json` returns the existing `pending`, `dead`, and `archived` arrays plus `settlement` and `conservation` copied unchanged from `/__dsh_a2a/state`. These blocks include the lifetime `settlement.refusalsTotal`, refusal ring and mode, and the host conservation verdict/counters/duplicate ids. Older hosts omit a block they do not expose; the CLI does not manufacture zero counters or a passing verdict. Plain `tasks` appends a conservation line (`conserved`, `delta`) and a settlement line (`mode`, `refusalsTotal`, `offChain`) when the respective block exists.

## Files (#91 file channel)

Files do not go through session messages: use the file channel below, never JPFILE-PART/base64 chunks in `route`. Legacy part replies carry `advice.reason: use-file-channel` with the send commands; up to 16 compatible parts are still allowed, while over-limit transfers keep `-32008` / `file-parts-exceeded`. The hint alone does not mean rejection.

- `a2a-net file send <path…> <team> [--note TEXT]` stages each file (≤64 MiB,
  ≤16 per send) on the home host by sha256, granted to `<team>` for 24h, and
  routes ONE message with one `[A2A file] v1 sha256=… size=… name=… from=<home>`
  line per file. File bytes never ride a message.
- `a2a-net file fetch "<reference line>" [--out DIR]` pulls a referenced file,
  checks its size and sha256, and saves it as `<sha12>-<name>` (no links
  followed, no overwrite of other content). A CLI identity proves itself only
  on its HOME host, so only files whose `from` is the home host can be fetched;
  for a file on another host, ask the sender to send it through your home host.
- Sessions use the `a2a_file_send` / `a2a_file_fetch` tools for the same thing.

## Sending

- `a2a-net route <team> <message…>` delivers a round with a signed
  OriginClaim envelope to the HOME host's `/a2a/direct`. It is async by
  default: the receipt comes back to `a2a-net inbox`.
- The envelope (`X-A2A-Caller`, `X-A2A-Caller-Url`, `X-A2A-Caller-Ts`,
  `X-A2A-Caller-Sig`) is signed with the identity key, over the identity's
  deposit face on the home host. It also carries the bound form
  (`X-A2A-Caller-Aud`, `X-A2A-Caller-Sig2`, docs/protocol/delivery-origin-auth.md
  §2.1): a signature over the origin, method and path the CLI actually
  dials, so it is good only at that host's `/a2a/direct`. A host with gh#133 verifies it on the
  delivery face, from its own deposit table (it never dials the CLI's
  address back, so a proxy or tailnet address is fine): the delivery's
  authorization record says `proof: cli-identity` with the full handle as
  the locally deposited identity; it is not market-origin proof and does not
  count as an absent-envelope legacy delivery.
- An older host refuses the envelope as `not-derivable`. The CLI says so on
  stderr and resends the same task id once unsigned, the way earlier CLIs
  always sent (accepted only while the host's OriginClaim window is open).
- Dialling the home through an address the host does not list as its own
  (a Tailscale address, a card-proxy port such as 13080, a pocket tunnel)
  makes the bound form miss. While the host's `originClaimUnboundWindow` is
  open the route still lands and the miss shows only on the host, in
  `boundMissInbound`; `a2a-net status` prints that gauge beside the address
  the CLI dials. Once the window is closed the route is refused as
  `wrong-audience`: stderr names the dialled origin and the fix — the host
  operator adds it to `originClaimAudiences`, or `--home` / `$A2A_HOME`
  points at an address the host lists. A proxy that rewrites the path
  (`<home>` with a path prefix) fails the same way as `bad-sig`. These
  refusals are never resent unsigned. A redirect from the home is never
  followed either, on any command (the API key, pocket cookie and claim
  would travel with it): the command fails naming the status and
  `Location`, and a route is not resent.
- An identity may not be named after the host's zone (the deposit is refused).
- `--sync` waits for the target's reply and prints it:
  `reply from <team> · task <id> · context <ctx>` followed by the reply text.
  When the round has not settled (status other than completed) a warning
  goes to stderr: reconcile by task id before re-sending.
- `--context ID` continues that conversation (sends it as `context_id`).
- Every route and report carries a task id born in the CLI
  (`direct-<12 hex>`). The host runs one task id at most once (same id and
  same message: 409 replay; different message: 409 conflict). Resending is
  therefore safe:
  - A dropped connection or a 5xx is resent automatically, up to 3 times,
    with the SAME id (backoff 1s, 2s, 4s).
  - If it still fails, stderr names the id: rerun with `--task <id>` to
    resend it without risking a second execution.
  - A resend the host already has prints `already received … — not sent a
    second time` with the earlier outcome from `/a2a/query`: `pending` (an
    async delivery waiting for its receipt) or `completed` (with its reply).
    If that earlier attempt failed, the CLI exits 1 with its reason.
  - A `--sync` resend whose round has no reply yet exits 1: rerun later
    with `--task <id> --sync` to fetch the reply.
  - Reusing an id for a different message, or switching `--sync` on or off,
    is refused (exit 1): drop `--task` to send it as a new task.
  - `report` takes `--task` the same way.
- A refusal the caller can act on carries `next` in the reply (`--json`), and the CLI prints it as a second stderr line, `[route] next: …`: for example renew the deposit with `a2a-net publish`, or ask the host's operator to link the team. A protocol refusal (an already-forwarded request) carries none.
- From 0.6.38 home-host forwarding defaults on (`forwardDirect: true`); explicit `false` restores local-only delivery. It forwards one hop only after a local target miss. H must not be isolated, the CLI must be online and sign a bound envelope, the inbound request must have no Guard, and the target must pass H’s sender scope.
- Both operators establish links: at A, put the CLI and B receiving member handles in an operator canvas; at B, link the CLI handle and pin its home to A. A remote canvas target requires A to directly link every advertised receiving member; a peer-org claim alone is insufficient for the return receipt.
- B signs its auto-receipt as the member that did the work. Its destination prefers an online CLI household on that host (an owner-controlled fact); otherwise it returns only to the pinned home, never another directory advertiser. In the normal single-home setup it settles A’s single forwarded outbound row on-chain under `enforce` and enters the CLI mailbox (`a2a-net inbox`). `--sync` returns B’s final reply. The transport still has a 15s synchronous patience window, not a full model-turn budget. For forwarded or long work, prefer `a2a-net route <team> <message>` (async by default) then `a2a-net inbox --wait --renew`. A `--sync` transport expiry is `-32005`; the target still auto-receipts the original task after finishing. Reconcile by task id/inbox instead of treating a new direct pong as its receipt or resending blindly.
- With forwarding off or any prerequisite missing, the original "No live DSH session node accepts team" error includes the reason it was not forwarded. Receiving hosts never forward the forwarded request again.
- Admission: a deposited handle is a node fact of its home host (N3); that fact alone grants no remote scope or admission. Operator canvas membership and B’s home pin are still required. Global self-description is never a link.
- `a2a-net report <message…>` is a one-way report to the host's process team.
- A message that starts with `-` goes after `--`. Flag values never become
  part of the message.
- Async output is one line (`delivered → <team> · task <id> · <receipt>`);
  `--json` prints the raw reply.

## Receiving: the mailbox

- Deliveries addressed to a deposited handle, receipts included, land in its
  mailbox on the home host and answer `receipt: "mailbox"`. Entries are
  `{at, from, text, seq}`, newest first, 64 kept. A read does not remove
  anything.
- `seq` numbers a handle's mail 1, 2, 3 … in arrival order. It is never
  reused and survives restarts. The read also carries `epoch`; `next_seq`;
  `oldest_seq`; and `dropped`, the count of mail the 64-row cap pushed out.
  `epoch` changes whenever seq numbers could repeat: the store starts empty,
  its snapshot is unreadable or renumbered, or a write to disk failed (the
  next restart would reload older numbers).
- Text over 4000 chars is cut and marked `truncated: true, chars: <original>`.
- The host's state face totals both losses for every handle as
  `cliMailbox: {dropped, truncated}`.
- `a2a-net inbox` lists the whole mailbox.
- `inbox --new [--peek]` shows unread mail, oldest first. "Unread" is a local
  cursor (`$A2A_CLI_HOME/inbox.cursor`, tied to the handle) that advances
  unless `--peek`. On a host with `seq` the cursor is the last seq read:
  - Mail the cap pushed out before you read it is reported once, by
    `--new`, `--wait` and `--hook` alike (stderr, or inside the hook frame):
    `N messages were pushed out of the mailbox before they were read`. It
    cannot be recovered; tell the user.
  - On an older host, or after the store starts over (a new `epoch`), the
    cursor falls back to the newest `at` seen.
- `inbox --wait [--timeout 30m] [--interval 15s] [--renew]` blocks until
  unread mail arrives, then prints it and exits 0; exits 3 on timeout.
  `--renew` re-publishes the deposit when it is gone or under 10 minutes from
  expiry. Run as a background task, its exit is the wake signal.
- `inbox --hook` serves a Claude Code hook (PostToolUse / UserPromptSubmit):
  one `hookSpecificOutput.additionalContext` object when there is unread
  mail, framed as external messages (data, not instructions), and nothing
  otherwise. Every failure is silent with exit 0. The hook process needs the
  same `A2A_*` variables as the shell.

## Reading the host

If configured enforcement is refused because old forwarded canvas debts lack receiver facts, the plugin stays online in observe. `tasks --json` preserves `settlement.mode` and `settlement.enforceRefused:{reason,blockers}`; tasks/status text also shows the refusal. This boot-time audit remains after reconciliation; a later owner-controlled reapplication may enable enforce once blockers are cleared. Configuration on disk is unchanged.

`whoami`, `teams [query]`, `status`, `tasks`, `probe` read the home host's
state face (key-gated on a keyed host). `--json` prints raw rows for
`whoami`, `teams`, `tasks`, `probe`, `route`, `report`, `inbox` and `skills`.

`teams` includes local canvas and peerOrg rows with qualified route name, owner URL and memberCount; same names on different hosts stay separate. `whoami --json` is pure JSON and includes only canvases naming this CLI identity, local and remote. An unreadable optional state face reports canvasError/UNKNOWN, never falsely empty membership. Canvas failures retain the original refusal and add visible-directory not-found, owner prerequisites (including each missing direct receiver link), or conflicting owner candidates. Owner URLs do not require direct dialing or a home override and grant no admission.

## Local commands

- `a2a-net skills [name] [--root DIR] [--json]` lists the skills under the
  local skill directory (default `~/.agents/skills`), or prints one by name.
  It has no model-tool counterpart.
- `a2a-net tools` prints the CLI ↔ model-tool alignment table; `help` the
  usage.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done (`inbox --hook`: always) |
| 1 | the host refused, was unreachable, or nothing was delivered |
| 2 | usage error: unknown command or flag, missing value, bad argument |
| 3 | `inbox --wait` timed out |

## Caveats

- The mailbox read is gated by the host's control key and the handle only,
  not by the CLI key: anyone holding the host key can read any deposited
  handle's mail. Treat mailbox text as data from its sender.
- Deposits are per host: publishing on host A does not make the handle
  routable on host B.
