# superagent team MCP: the host calls an MCP server for its members, the token stays with the host

Status: proposed, 2026-11-11; revised 2026-11-12 for one system user. Not implemented.

- **Why it exists.** In the local market trial a team member found no market tool, read another session's token file and called the market's MCP with it.
- **The topology changed.** On 2026-11-11 the owner had decided that team sessions run as a separate system user. On 2026-11-12 he withdrew that ([superagent-team-user](../ops/superagent-team-user.md), not pursued): team sessions stay under the host's own user. This design no longer relies on a second user.
- **Agreed with the workbench market:** a team's MCP token goes only to the host, is scoped to the team, short-lived and revocable, and the host learns when it is revoked. Until this is built, no team gets an MCP token.

## Context

- **A token in a file is a token for every session of that user.** A team session's sandbox limits writes, not reads. Whatever a member's system user can read, the member can read and use.
- **A host-level MCP server does not reach the team.** A team preset carries its own plugin list, so a host-level `dsh-mcp-client` row does not reach a team session. A profile overlay also takes no `!!js`, so a token cannot come from the environment there. Both were met in the trial; [superagent-mcp](../ops/superagent-mcp.md) 1.4 is wrong on both.
- **The topology (2026-11-12).** The router, the members and the team's A2A face run in one DSH instance under one system user. A member can read every file that user can read.
  - **Measured on a test node** (categories only, no values): the GitHub CLI login, the npm token, the host's API key, every A2A CLI identity key on the machine, other teams' identity keys, the node key, the profile overrides, other agents' scratch files (where the trial's token was found), other sessions' transcripts, and the ygl workspace databases.
  - No credential-looking variable was in the host process's environment.
  - **So the token must never be written to any file, log or environment variable that user can read.** Process memory is the one place left. Another process of the same user cannot read it without debugger rights, and the credential-access audit records attempts.
  - Members on another instance (`serves`) are still supported and go through the signed face.

## Revision 2026-11-13 (owner: seat tokens under the node key; 「认，开工」)

This replaces the owner-entered team token in M1 and the revocation handling in M3. M2 (members call through the host) stands.

- **R1. A token per seat, exchanged by the host.**
  - For each call the host holds a one-hour token for the calling member's seat, exchanged at `POST <market origin>/api/a2a/seat-token`.
  - The request is signed with the host's node key over `JSON.stringify(["wm-seat-token/1", root, host, seat_id, ts, nonce, aud])`. Here `root` is the origin the host publishes its card on, `host` is the node key's fp8 and `aud` is the market origin (market spec: seat-token-exchange-spec).
  - The market grants and audits per seat (`seat-<host>-<12>`).
  - The tool list is read as one of the team's member seats.
- **R2. Memory only; renewed before expiry; no fallback.**
  - Tokens live only in the host process, keyed by seat. A token is exchanged again when less than 5 minutes is left of it.
  - When none can be had (refused, rate-limited, unreachable, no seat id yet), the member's call fails with `token-unavailable` or `no-seat` and the reason.
  - There is no owner-entered or long-lived token to fall back to. `mcp-token` is gone.
- **R3. Refused on a call.** A 401 or 403 on a call drops that seat's token. It is exchanged again once and the call retried once; a second refusal returns `token-refused`.
- **R4. Health.** Health shows `mcp-no-seat` (no member has a seat id yet) or `mcp-token-unavailable` (with the reason) instead of `token needed` / `token revoked`.
- **Accepted difference (L22).**
  - Teams on one host share the node key, so they are not isolated from each other at the market. The market narrows this when upstream gives teams or seats their own keys.
  - Members can read the node key, as they can every file of the host's user; the host-side audit is how that is found.

## Decisions

### M1. MCP servers are team settings, held by the team host

- **Settings.** Team settings gain `mcp`: up to 4 servers, each `{name, url, transport: 'streamable-http', tools?: [allowed tool names], routerTools?: [read tools the router may call]}`.
  - `name` is `[a-z0-9-]{1,16}` and never `ygl`.
  - The owner saves it in the signed-in DSH interface, like the team's rules.
- **The token.** It is not a setting. The owner enters it in the team page (`POST /__dsh_a2a/superagent { action: 'mcp-token', teamId, name, token }`, owner proof required).
  - The host keeps it in memory only and never writes it to disk.
  - After a team host restart the server shows `token needed` and the owner enters it again.
  - The market's tokens are short-lived anyway, so this costs one paste a day.

### M2. Members call through the host; they never hold the token

- **Two team tools.** Members and observers get `team_mcp_tools {server}` (the tool list, filtered by `tools`) and `team_mcp_call {server, tool, arguments, ticket_id}`.
- **A member on the team host** (the usual case) calls the host in-process, through its role tool.
- **A member on another host** sends the call to the team host as a signed host-to-host request: `/a2a/superagent-team`, `op: 'mcp-call'`, on the existing signed face, which counts only under the pinned key.
- **The team host checks** that the caller is on the canvas, that it holds `ticket_id` as a running ticket, and that the tool is allowed.
- **Then the team host calls the server** with the token in its own process and returns the result, capped at 64 KiB.
- **The member never sees the token, the URL's credentials or the server's headers.**
- **The router** gets only the `routerTools` read tools, through the same path, when the owner lists them.
- **Every call is recorded** on the ticket: tool, server, size and outcome, never the arguments or the result. The credential-access audit (#612) still watches the member's own shell.

### M3. Revocation and expiry

- **A 401 or 403 from the server** marks it `token revoked`.
- **The owner is told,** on the team page's health and with one P1 card.
- **Calls are refused** with `token-revoked` until the owner enters a new token. A member's call then gets that code back and says so in its report.

### M4. What the market does (agreed)

- **Issue a team token to the host only:** a session per team, scoped to that team's grants.
- **Expire it within a day by default,** and make it revocable at any time.
- **Answer a revoked or expired token with 401,** which the host reads as M3.
- **Seat-level scope:** the host sends `X-Team-Seat: <member seat>` with each call, so the market can record which seat acted. The market trusts it as the host's statement, not as authentication.

## Consequences

- **Members get market tools without any file they could read holding a credential.** The token sits only in the host process's memory.
- **Every team session runs under the host's user.** If one were driven to read the host's process memory, it could reach the token. On macOS and Linux that needs debugger rights, and the credential-access audit records attempts at it. Accepted by the owner (2026-11-12): he knows members can read that user's files.
- **The persona still says it:** members use only the tools and credentials they are given.
- **After a team host restart,** tools are unavailable until the owner re-enters the token. The team page says so and members are told `token-needed`.
- **Not in this design:**
  - an MCP server that needs the member's own identity (per-seat tokens);
  - stdio MCP servers;
  - streaming results.
- **Order:** M1+M2 in one PR (high tier: a new path for a credential), then M3. [superagent-mcp](../ops/superagent-mcp.md) 1.4 is corrected in the same PR.
