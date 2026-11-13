# The a2a-net CLI

A transient caller that is not a DSH session — a script, a terminal, another
agent harness — joins the network through the `a2a-net` command (bin of
`@nelsonlongxiang/dsh-open-a2a-net`, 0.6.27+). It has its own key, deposits
itself on ONE home host, and receives through a mailbox; nothing wakes.
`a2a-net help` prints the command map, `a2a-net tools` the alignment with the
model tools.

## Identity and home host

- `a2a-net init <name> [--uuid 16hex] [--home URL] [--force]` creates an
  Ed25519 identity: handle `<name>/<16 hex>` (the name must match
  `[a-z0-9-]{1,32}`, else a usage error, exit 2; the 16 hex is random unless
  `--uuid` gives it), stored in `$A2A_CLI_HOME/cli.json` (default
  `~/.a2a/cli.json`; the file is mode 0600). `--home` is saved with the
  identity, a trailing `/` stripped. An existing identity is never replaced
  without `--force`. `--force` writes a fresh identity file: a new key, a new
  random uuid unless `--uuid` is given, and the saved home is dropped unless
  `--home` is passed again. The old key is gone for good, so nothing can sign
  for the old handle any more; its deposit stays on the home host until it
  expires (4h at most).
- Home host: `--home` > `$A2A_HOME` > the home saved by `init --home` >
  `http://127.0.0.1:3080`. An environment variable set to the empty string
  counts as unset.
- Keyed hosts: `--key` > `$A2A_KEY` (prefer the variable; a flag value stays
  in shell history). A host behind dsh-pocket also wants its session token as
  the `dsh_pocket_token` cookie: set `$A2A_POCKET_TOKEN` (or `$A2A_TOKEN`).

## Deposit (户口)

- `a2a-net publish` deposits the signed CLI card on the home host
  (`/__dsh_a2a/cli-deposit`, a control route: key-gated like every write).
  The deposit lives 4h from each publish (both the default and the maximum;
  there is no flag to change it). An expired deposit is no longer routable and
  its card is no longer served, but it stays in the host's directory as an
  OFFLINE row (gh#47; the newest 16 are kept) so canvas refs to it never
  dangle silently. Publish again (same handle, same key) to come back.
- `a2a-net publish --owes` (superagent p1-mailbox-owes) declares in the
  signed card that this identity owes a receipt for what its mailbox takes.
  A home host that knows the declaration answers a delivery to it
  `delivered` instead of final: the caller books a debt, the per-target cap
  (`targetQueueCap`, default 3, `0` disables; counted per identity across all
  callers) applies and refuses with
  `-32009` when full, and the identity's own `receipt <task_id>` frees the
  slot. An owed row the 64-row cap pushes out is archived as evicted. Every
  publish states it afresh — `publish` or `inbox --renew` without `--owes`
  withdraws it — so only an identity that does answer every task (the
  superagent Source) should declare it. A host that predates it ignores the
  field and keeps the mailbox final.
- `a2a-net publish --declare progressReceipts,directedSeats,reworkReturns,teamRoster` (or the same list in
  `A2A_DECLARE`) declares what this identity takes as a requester (superagent-root-team S5): only these four names. A
  team host on its bot list then sends it progress steps and believes its `[A2A dispatch]` lines. A superagent root
  team's Source sets it while the team is a root. Like `--owes`, every publish states it afresh.
- A handle stays pinned to the key it was published with, live or offline
  (gh#137): publishing it with a different key (e.g. after `init --force
  --uuid <same>`) is refused with "held by another key". Run `a2a-net revoke`
  first (it acts on the current identity's handle, so with the same `--uuid`
  it removes the old deposit, live or offline); the next publish then takes
  the new key. A key swap is therefore
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

Canvas rows in `a2a-net teams` carry an owner-qualified id, `<zone>/canvas/<name>@<fp8>` (the first 8 hex of sha256 over the owner card's public key; #282; a host that does not send an `id`, or an owner card without a key, shows the bare `<zone>/canvas/<name>`). Route to that id to pick one owner when several hosts have a canvas of the same name; a bare `<zone>/canvas/<name>` still routes as before (this host's own canvas first, refused as ambiguous when several remote owners match). Your own fingerprint names your own canvas; an id nobody's key matches reaches no one. The id survives a change of the owner's address. It names a signing key, not a host: a seeded peer serving that key's signed card core is treated as an alias of the same owner (as before), and a card's canvas list is not itself signed. Canvas names may not end in `@<8 hex>`.

`a2a-net teams <query>` is a case-insensitive substring search over the route handle and the display name (the owner-set seat label included); `--json` exposes the effective display name. Local rows prefer `seatName`, then the current title (`name`), then the legacy label. Only the human workbench owner panel/config can set `seatNames`; the CLI has no naming command.

## Tasks: ledger and host observability

`a2a-net tasks --json` returns the existing `pending`, `dead`, and `archived` arrays plus `settlement` and `conservation` copied unchanged from `/__dsh_a2a/state`. These blocks include the lifetime `settlement.refusalsTotal`, refusal ring and mode, and the host conservation verdict/counters/duplicate ids. Older hosts omit a block they do not expose; the CLI does not manufacture zero counters or a passing verdict. Plain `tasks` appends a conservation line (`conserved`, `delta`) and a settlement line (`mode`, `refusalsTotal`, `offChain`) when the respective block exists, and a further `enforce refused` line (reason and blockers) when the settlement block carries `enforceRefused`; plain lists cap at 20 rows per section.

## Files (#91 file channel)

Files do not go through session messages: use the file channel below, never JPFILE-PART/base64 chunks in `route`. Legacy part replies carry `advice.reason: use-file-channel` with the send commands; up to 16 compatible parts are still allowed, while over-limit transfers keep `-32008` / `file-parts-exceeded`. The hint alone does not mean rejection.

- `a2a-net file send <path…> <team> [--note TEXT]` stages each file (≤64 MiB,
  ≤16 per send) on the home host by sha256, granted to `<team>` for 24h, and
  routes ONE message with one `[A2A file] v1 sha256=… size=… name=… from=<home>`
  line per file (`--note`, when given, rides as the message's first line). File bytes never ride a message.
- `a2a-net file fetch "<reference line>" [--out DIR]` pulls a referenced file,
  checks its size and sha256, and saves it as `<sha12>-<name>` (no links
  followed, no overwrite of other content). A CLI identity proves itself only
  on its HOME host, so only files whose `from` is the home host — or one of the
  home's advertised aliases (`ownerHost` / `originClaimAudiences` from the state
  face, #332) — can be fetched; the alias lookup asks only the configured home,
  and old/denied/malformed/redirected metadata fails closed. For a file on any
  other host, ask the sender to send it through your home host.
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
  the CLI dials. It also prints `reject` rows from the host's
  `claimRejectsRecent`: envelopes that were present but failed verification,
  by claimed caller and reason. `bad-ts` means that sender's clock is off by
  more than ±5 min (fix its NTP); the caller fields are the sender's own claim. Once the window is closed the route is refused as
  `wrong-audience`: stderr names the dialled origin and the fix — the host
  operator adds it to `originClaimAudiences`, or `--home` / `$A2A_HOME`
  points at an address the host lists. `$A2A_CLAIM_AUDIENCE` (an origin)
  makes the bound form name that origin instead of the one dialled: a host
  that runs the CLI against itself on loopback (the superagent team
  identity) sets it to its own card URL's origin, which it always lists.
  `a2a-net status` then prints `signed for <origin>`. A proxy that rewrites the path
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
    with the SAME id (backoff 1s, 2s, 4s; the 1s base is overridable with
    `$A2A_RETRY_BASE_MS`).
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
- Both operators establish links: at A, put the CLI and B receiving member handles in an operator canvas; at B, link the CLI handle and pin its home to A. For a remote canvas target A links only the canvas owner host (#282 S3, same team authorizes): the receivers are frozen from the owner's signed card when the row is born, and a receipt is admitted to the CLI mailbox and settles only from one of those receivers, signed by that owner's key with a body-bound (Sig3) envelope — so the owner host must run 0.6.37 or later. Free-form replies from members A has not linked still need a link. The owner host is trusted to describe its own canvas honestly.
- B signs its auto-receipt as the member that did the work. Its destination prefers an online CLI household on that host (an owner-controlled fact); otherwise it returns only to the pinned home, never another directory advertiser. In the normal single-home setup it settles A’s single forwarded outbound row on-chain under `enforce` and enters the CLI mailbox (`a2a-net inbox`). `--sync` returns B’s final reply. The transport still has a 15s synchronous patience window, not a full model-turn budget. For forwarded or long work, prefer `a2a-net route <team> <message>` (async by default) then `a2a-net inbox --wait --renew`. A `--sync` transport expiry is `-32005`; the target still auto-receipts the original task after finishing. Reconcile by task id/inbox instead of treating a new direct pong as its receipt or resending blindly.
- With forwarding off or any prerequisite missing, the original "No live DSH session node accepts team" error includes the reason it was not forwarded. Receiving hosts never forward the forwarded request again.
- Admission: a deposited handle is a node fact of its home host (N3); that fact alone grants no remote scope or admission. Operator canvas membership and B’s home pin are still required. Global self-description is never a link.
- `a2a-net report <message…>` is a one-way report to the host's process team
  (addressed to the zone the home's state face names, `dsh` if it names none).
- A message that starts with `-` goes after `--`. Flag values never become
  part of the message.
- Async output is one line (`delivered → <team> · task <id> · <receipt>`);
  delivery-uncertainty outcomes (acceptance `unknown`/`inserted`, receiver
  bookkeeping failed, a sync wait released without a final reply) print a
  reconciliation-hint line instead. `--json` prints the raw reply plus the
  `class` field below.
- `route --json` adds an observation field `class`, judged from structured
  fields only (HTTP status, `delivered`, `code`, `acceptance`, a sync
  `result`, a replay's `prior`) and never from error text:
  - `sent`: delivered, including `receiverBookkeeping: "failed"`,
    `acceptance: "inserted"` and `-32005` (landed, not settled); also a replay
    whose task the host already holds, unless it failed.
  - `gone`: resending the same task can never succeed: `-32001` payload too
    large, `-32002` the id is bound to a different message, or a replay whose
    task already failed.
  - `retry`: everything else, including `acceptance: "unknown"`, 401/403, 5xx,
    `-32003/-32007/-32008/-32009/-32011` and generic `-32000`. Retry with the
    SAME task id. A consumer counts retries and only drops (with a record)
    past its own bound. No JSON at all (e.g. the network failed) also means
    retry. `class` changes no host semantics, and no exit code by default; the opt-in
  `--exit-class` switch (see the receipt section) makes the exit code carry it.

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
- Rows mailed by a host from next/0.8 on also carry structured fields, so a
  reader branches on fields and never parses the text:
  - `task_id` and `context_id` of the delivery;
  - `proof`, how the host proved the caller when it took the delivery. On
    the wire face it is the same verdict the text header states:
    `origin-claim` for 已验证来源, otherwise the value in 未验证（…）, such as
    `cli-identity`, `claim-mismatch` or `unbound`. A delivery from a session
    on the home host itself is `in-process` and has no header;
  - `receipt_for`, the task id a receipt row answers, and `disposition` when
    its envelope carried one;
  - `admission`, the admission rule the host matched when it took the
    delivery (`canvas-shared`, `remote-ref-cli`, `cli-deposit`,
    `local-exempt`, …) — the rule name only, never which canvas or team.
  Older rows carry none of these. Which `proof` values a consumer trusts is
  that consumer's decision (the superagent Source takes it from its design).
- The host's state face totals both losses for every handle as
  `cliMailbox: {dropped, truncated}`.
- `a2a-net inbox` lists the whole mailbox.
- A `--sync` route whose reply reached the CLI still gets the target's receipt later. The home keeps it in full but marks it `dup: "sync-answered"`; `inbox` and the hook fold it to one line, and `--json` shows the whole row. Only a reply the target host itself declares final (`reply_final`, sent from 0.6.40) counts — the text of the turn that read the request: a host placeholder such as a flush timeout never does, nor a busy target's other turn, and a target on an older version never sets it, so its receipts arrive unmarked. The mark lives in the home's memory for an hour; after a home restart the receipt arrives unmarked (#298).
- `inbox --new [--peek]` shows unread mail, oldest first. "Unread" is a local
  cursor (`$A2A_CLI_HOME/inbox.cursor`, tied to the handle) that advances
  unless `--peek`. On a host with `seq` the cursor is the last seq read:
  - Mail the cap pushed out before you read it is reported once, by
    `--new`, `--wait` and `--hook` alike (stderr, or inside the hook frame):
    `N messages were pushed out of the mailbox before they were read`. It
    cannot be recovered; tell the user.
  - On an older host, or after the store starts over (a new `epoch`), the
    cursor falls back to the newest `at` seen.
- `inbox --after <cursor>` is a replayable read for a consumer that keeps its
  own position, such as a superagent a2a Source. Start with `start`, then pass
  back the `next` you received. It prints one JSON object
  `{handle, epoch, after, next, mail, lost, epochChanged}` with `mail` oldest
  first, and never reads or moves the local `inbox.cursor`:
  - `lost` counts mail the cap pushed out before this window. It is `null`,
    meaning unknown, when the host's store restarted (`epochChanged: true`);
    the read then returns every row it still has.
  - A cursor past the newest seq the host issued is not one it handed out
    (forged or mixed up). The read flags it with `cursorAhead: true`, returns
    no mail, keeps `next` equal to the cursor, reports `lost: null` (unknown,
    as across an epoch change), and warns on stderr.
  - A consumer such as the superagent a2a Source reports a health error
    whenever `lost > 0`, `lost` is `null`, or `cursorAhead` is set. Lost mail
    cannot be recovered; the error makes the gap visible instead of hiding it.
  - A host without `seq` is refused (exit 1); there is no time-based
    fallback. `--after` does not combine with `--new`, `--peek`, `--wait` or
    `--hook` (exit 2).
- `thread <context_id> [--limit N] [--before <cursor>]` reads one
  conversation back, newest first, as one JSON object
  `{handle, epoch, context_id, entries, more, next_before, unscoped, mail_lost}`
  (superagent p1-context-read). It is read-only: it never reads or moves the
  local `inbox.cursor`.
  - Entries with `dir: "in"` are mailbox rows the home host tagged with that
    `context_id` (`seq`, `from`, `task_id`, `text`, and `proof` /
    `receipt_for` when the row has them). The host tags every
    mailbox delivery from this version on; `unscoped` counts the rows that
    carry no `context_id` (mailed by an older host) and cannot be placed.
  - Entries with `dir: "out"` are this identity's own routes the host took
    (`route --json` class `sent`), read from `sent.jsonl` in the identity
    home: `team`, `task_id`, `text`, and `reply` when `--sync` got one. A route
    is journaled under the context the host named in its reply, or the
    explicit `--context`; a `-32005` reply names none, so only `--context`
    covers it. Texts over 4000 characters are cut (`truncated`, `chars`). Past
    1 MiB the journal rolls into `sent.1.jsonl` (one older generation, read
    too). The journal lives on this machine only; a failed journal write
    warns on stderr and never fails the send.
  - `--limit` is 1-200 (default 20). When `more` is true, pass `next_before`
    back as `--before` for the next page. Within one millisecond the journal
    side is newer than the mailbox side.
  - `mail_lost` counts earlier mailbox rows the 64-row cap already pushed
    off the host, whatever their context; they cannot be recovered.
  - The two sides keep time on different machines: an `in` row's `at` is the
    home host's clock, an `out` row's `at` is this machine's. When the CLI
    talks to a home on another machine whose clock is off, the two sides can
    interleave in the wrong order. Paging stays complete either way.
- `receipt <task_id> [--attention | --acknowledged | --outcome O] [--to TEAM] <one line…>` is the one formal
  receipt for a task this identity received:
  - It sends `[A2A receipt] task <task_id> <one line>` plus the v2 envelope
    line. The default is a result,
    `{"outcome":"completed","idempotencyKey":<id>,"disposition":"result"}`.
    `--outcome` says how the work ended instead: `failed`, `rejected`
    (declined, never taken up) or `abandoned` (stopped before it finished);
    `completed` is the default. Any other value, or `--outcome` together with
    `--attention`, exits 2 and sends nothing; `expired`, `sync_completed` and
    `unknown` are outcomes the host derives, not ones a sender claims.
    With `--attention` it is a question for the caller,
    `{"idempotencyKey":<id>,"disposition":"attention"}`, with no outcome:
    it settles the task but is not a completion. The caller's answer comes
    back as a new task in the same context.
  - The target is the sender of that task's mailbox row; `--to` names one
    when the mailbox has none (or several). With neither, it exits 2 and
    sends nothing. The receipt rides the task's own `context_id`, so it also
    shows in `thread`.
  - It rides task id `receipt-<task_id>`. The host runs a task id once, so a
    task gets one receipt: the same receipt again is a replay ("already
    received"), and a different one, such as a result after an attention,
    is refused (exit 1).
  - The task id must be letters, digits, `.`, `_`, `:` or `-`, and at most
    72 characters, so `receipt-<task_id>` fits the 80-character task id. A
    longer id exits 2; it is never cut short. The line is folded to one
    line.
  - `--json --exit-class` (on `route` and `receipt`) makes the exit code
    carry the class too, for callers whose command runner keeps the exit
    code and drops stdout (superagent's a2a Source): 0 sent (or the same
    receipt replayed), 4 gone, 5 the task already carries a different receipt
    (`receipt` only), 1 retry or any other failure. `--exit-class` without
    `--json` exits 2. Without the switch no exit code changes.
  - A task delivered into a CLI mailbox is final on the caller's side (no
    debt is booked for it), so its receipt settles nothing there; the
    caller still gets it, with `disposition` on its mailbox row. A receipt
    settles a debt only where the caller tracked one.
  - Added fields (market N1c/N1d, [receipt-envelope-fields](../../../docs/design/receipt-envelope-fields.md)):
    `--by SEAT [--by-name N] [--by-team T] [--by-role router|member|observer] [--by-seat-id ID]`
    says who took the work up (the router until a member holds the work; `--by-seat-id`
    is the seat's stable id, the roster's `seatId`, which outlives its session), and
    `--artifacts KIND:ID[,KIND:ID…]` names what it produced, as ids in the
    caller's system (or a JSON array `[{"kind","id","title"}]`, where `title`
    is display text for people, at most 200 characters). With `--attention`, `--question-id ID [--options 'A|B']
    [--default X]` makes it a structured question, whose text is the one line.
    Such a question rides task id `attention-<task_id>-<ID>` and marks the
    caller's row the way `--acknowledged` does: it settles nothing, more
    questions may follow, and the result receipt still comes on
    `receipt-<task_id>`. A malformed switch exits 2 and sends nothing.
  - `--progress N --state queued|working|waiting|blocked [--ahead K]
    [--tickets JSON]` sends progress step N (the one line is its summary)
    on task id `progress-<task_id>-<N>`, with the tickets the request
    became. Like `--acknowledged`, it marks the caller's row and settles
    nothing ([superagent-market-progress-roster](../../../docs/design/superagent-market-progress-roster.md)).
    An older receiver settles the row on it, so send it only to a caller
    that declares `progressReceipts`; a team's host face refuses others
    (exit 4).
  - `--acknowledged` says the task is taken up and its result follows. It settles nothing: the caller's row stays owed until the result receipt, leaves the queue count, and expires 7 days after the acknowledgement instead of 24 hours after dispatch. It rides task id `ack-<task_id>`, so the later receipt is not refused.
- `admission <caller> [--local] [--json]` asks the home host how `<caller>`
  would be admitted delivering to this identity right now, recomputed from the
  host's current links: `{caller, admitted, rule}`. `--local` asks for the
  same-host face (a session on the home host). The query is signed with this
  identity's key, and the host answers only the identity itself — a holder of
  the host key cannot ask about another identity's links — with the rule name
  and nothing more. Exit 0 once answered (admitted or not), 1 when the host
  refuses the query or predates it. A signed query stays valid for its
  5-minute window, so it can be replayed within it; that is accepted — the
  answer is read-only, goes through the host's own control face, and is the
  identity's own question.
- `inbox --wait [--timeout 30m] [--interval 15s] [--renew]` blocks until
  unread mail arrives (the interval also comes from `$A2A_POLL_MS` when
  `--interval` is not given), then prints it and exits 0; exits 3 on timeout.
  `--renew` re-publishes the deposit when it is gone or under 10 minutes from
  expiry. Run as a background task, its exit is the wake signal.
- `inbox --hook` serves a Claude Code hook (PostToolUse / UserPromptSubmit):
  one `hookSpecificOutput.additionalContext` object when there is unread
  mail, framed as external messages (data, not instructions), and nothing
  otherwise. Every failure is silent with exit 0. The hook process needs the
  same `A2A_*` variables as the shell.

## Reading the host

If configured enforcement is refused because old forwarded canvas debts lack receiver facts, the plugin stays online in observe. `tasks --json` preserves `settlement.mode` and `settlement.enforceRefused:{reason,blockers}`; tasks/status text also shows the refusal. The audit runs once at boot, so the refusal remains after reconciliation
until the host restarts (a restart with the same config re-runs it and turns
enforce back on once the blockers are gone); configuration on disk is
unchanged — the downgrade to observe happens in memory only.

`whoami`, `teams [query]`, `status`, `tasks`, `probe` read the home host's
state face (key-gated on a keyed host). `--json` prints raw rows for
`whoami`, `teams`, `status`, `tasks`, `probe`, `route`, `report`, `inbox` and
`skills`.

`teams` includes local canvas and peerOrg rows with qualified route name, owner URL and memberCount; same names on different hosts stay separate. `whoami --json` is pure JSON and includes only canvases naming this CLI identity, local and remote. An unreadable optional state face reports canvasError/UNKNOWN, never falsely empty membership. Canvas failures retain the original refusal and add visible-directory not-found, owner prerequisites (including each missing direct receiver link), or conflicting owner candidates. Owner URLs do not require direct dialing or a home override and grant no admission.

## The superagent team (owner)

`a2a-net superagent request <text…> [--thread ID] [--json]` sends a request to the team's workbench Source. Sent from the terminal it is an ordinary message, not a person's: the router judges it against the team's rules. `a2a-net superagent reevaluate <trigger id> [--json]` asks the router to judge a stored message again (refused for an A2A message whose sender already has its outcome). `a2a-net superagent state [--json]` prints the team state: router, accept mode, tickets with their stage, and replies. These commands apply only on a home with `superagent: true`.

Both ride the home's **owner** control credential (`$A2A_KEY`, plus the pocket cookie behind dsh-pocket), not this CLI's identity. The credential makes the request land, not the person: sent from the terminal it is an ordinary message — the router judges it against the team's rules like an agent's, never as an explicit request or a stop (owner ruling 2026-11-08; only the workbench GUI's owner action is a person's).

A message from a CLI identity (`route` to the team's A2A address) is an agent's message under superagent's definition. It can reach the team only through the A2A Source's bot list and accept mode; it is never an explicit request and never a stop. See [superagent.md](superagent.md).

## Local commands

- `a2a-net skills [name] [--root DIR] [--json]` lists the skills under the
  local skill directory (default `~/.agents/skills`), or prints one by name (a
  name miss falls back to a path-substring match).
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

With `--json --exit-class` on `route`/`receipt` the exit code carries the
class instead: 0 sent, 4 gone, 5 the task already carries a different receipt
(`receipt` only), 1 retry or any other failure (see the receipt section).

## Caveats

- The mailbox read is gated by the host's control key and the handle only,
  not by the CLI key: anyone holding the host key can read any deposited
  handle's mail. Treat mailbox text as data from its sender.
- Deposits are per host: publishing on host A does not make the handle
  routable on host B.

## Standalone network node: `a2a-net serve`

`a2a-net serve [--config node.json] [--host 127.0.0.1|0.0.0.0] [--port N] [--home DIR]` runs the network layer without a DSH instance: cards and OriginClaim, the peer directory, CLI deposits and mailboxes, one-hop forwarding, canvas ownership, the task ledger, the state face and the workbench. It hosts no AI sessions; it forwards to DSH hosts like any home. Use it as an always-on home for CLIs so a DSH restart does not take their deposits, mailboxes and canvas directory down (they also survive the node's own restart).

- `node.json` holds plugin config keys (`team`, `session`, `agentName`, `apiKey`, `peers`, `originClaimUrl`, `originClaimAudiences`, `forwardDirect`, …; `dshHome` is the file form of `--home`, `host`/`port` the file form of the flags); flags win. `--host` is meant for `127.0.0.1` (default) or `0.0.0.0` — the value reaches the listener unvalidated (only `--port` is validated). The node also forces `sessionNodes: true` and `wakeJoinedOnBoot: false`, and defaults `announce: true` (an always-on node exists to be found; a file `announce` still overrides it). Defaults: `--host 127.0.0.1`, `--port 13090`, `--home ~/.a2a-net/node` (separate from the CLI's own `~/.a2a`). Bind beyond loopback only with an `apiKey`.
- The runtime needs the tested DSH packages next to this one. In an empty folder: `npm i @nelsonlongxiang/dsh-open-a2a-net@<version>` plus the pinned set `serve` prints when one is missing (npm's `latest` tags of those packages are older and do not work), then `npx a2a-net serve --config node.json`.
- Link it like any host: list the DSH hosts in its `peers` and add the node's URL to theirs; put CLIs and the DSH sessions they work with in a canvas team on the node (or rely on #282 S3 for canvases owned elsewhere).

## Pi seats (`publish --pi-seat`, `ticket`, `pi install`)

A Pi seat is a CLI identity that declares `piSeat` on its own signed card (`a2a-net publish --pi-seat`), deposited on
the superagent team's host. Once the team's owner adds it to the team canvas (its key is pinned there), its work arrives
in its mailbox with the ticket id as `task_id`, and it answers on the team host with signed, body-bound ops:

- `a2a-net ticket read` · `ticket idle [--text T]` · `ticket error [--transient] -- <what failed>` — each with `--ticket <id> --event <id>`: a Pi seat's turn facts name their ticket and carry an event id made once; the host acknowledges a replayed event without acting on it, and ignores a fact for a ticket that is no longer the seat's current one
- `a2a-net ticket ack|handback --trigger <trigger id> -- <text>`
- `a2a-net ticket report --ticket <id> --state progress|waiting|ready|blocked|failed|dropped [--question Q --options A|B|… --recommended A [--level P0..P3]] [--answers <trigger id>] [--pull-request <url>] -- <summary>` — a question is a decision card for the owner: 2–6 options and the one the seat recommends, checked before it is sent

A seat's turn end (`ticket idle`, sent by the extension) carries no text: report what changed with `ticket report`, as the work card asks.

Refusals keep the host's code: `not-member` (not this team's seat under the pinned key), `op` (a seat has only these
six ops: no rule changes), `untrusted-origin` (unsigned or not body-bound). `a2a-net pi install [--dir DIR] [--force]`
copies the `a2a-seat` Pi extension (default `~/.pi/agent/extensions/`), which polls the mailbox with its own cursor and
reports read and turn end. Installing never joins a team. Design: docs/design/superagent-pi-platform.md.
