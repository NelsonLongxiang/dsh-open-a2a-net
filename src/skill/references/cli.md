# The a2a-net CLI

A transient caller that is not a DSH session — a script, a terminal, another
agent harness — joins the network through the `a2a-net` command (bin of
`@nelsonlongxiang/dsh-open-a2a-net`, 0.6.27+). It has its own key, deposits
itself on ONE home host, and receives through a mailbox; nothing wakes.
`a2a-net help` prints the command map, `a2a-net tools` the alignment with the
ten model tools.

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
- While deposited, the host serves the card at
  `<home>/a2a/cli/<handle>/.well-known/agent-card.json` and lists the handle
  in its directory as "cli — deposited identity (no wake; mailbox)".
- `whoami` / `status` show ONLINE with the hours left, OFFLINE, or UNKNOWN
  when the deposit face cannot be read (e.g. a host build without it).
- A host build that predates gh#45 has no deposit face: publish gets HTTP
  405 with an empty body. The fix is a host upgrade, not a retry.
- `a2a-net revoke` deregisters early.

## Sending

- `a2a-net route <team> <message…>` delivers a round with a signed
  OriginClaim envelope to the HOME host's `/a2a/direct`. It is async by
  default: the receipt comes back to `a2a-net inbox`.
- `--sync` waits for the target's reply and prints it:
  `reply from <team> · task <id> · context <ctx>` followed by the reply text.
  When the round has not settled (status other than completed) a warning
  goes to stderr: reconcile by task id before re-sending.
- `--context ID` continues that conversation (sends it as `context_id`).
- Direct delivery does not relay: only teams on the home host are reachable.
  A team on another host answers "No live DSH session node accepts team".
- Admission: a deposited handle is a node fact of its home host (N3). It
  carries no roster or canvas membership of its own.
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

`whoami`, `teams [query]`, `status`, `tasks`, `probe` read the home host's
state face (key-gated on a keyed host). `--json` prints raw rows for
`teams`, `tasks`, `probe`, `route`, `report`, `inbox` and `skills`.

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
