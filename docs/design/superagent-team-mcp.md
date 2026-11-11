# superagent team MCP: the host calls an MCP server for its members, the token stays with the host

Status: proposed, 2026-11-11, after the local market trial. In that trial a team member found no market tool, read another session's token file and called the market's MCP with it. The owner then decided that team sessions run as a separate system user ([superagent-team-user](../ops/superagent-team-user.md)). Agreed with the workbench market: a team's MCP token goes only to the host, is scoped to the team, short-lived and revocable, and the host learns when it is revoked. Until this is built, no team gets an MCP token.

## Context

- **A token in a file is a token for every session of that user.** A team session's sandbox limits writes, not reads. Whatever a member's system user can read, the member can read and use.
- **A host-level MCP server does not reach the team.** A team preset carries its own plugin list, so a host-level `dsh-mcp-client` row does not reach a team session. A profile overlay also takes no `!!js`, so a token cannot come from the environment there. Both were met in the trial; [superagent-mcp](../ops/superagent-mcp.md) 1.4 is wrong on both.
- **The topology.** Per the separate-user guide, the router and the team's A2A face run in the team host instance (`dsh-team`). Members run in the member host instance (`dsh-member`), which serves the team host. Members cannot read `dsh-team`'s files.

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
- **On a member host,** the call travels to the team host as a signed host-to-host request: `/a2a/superagent-team`, `op: 'mcp-call'`, the existing signed face, which counts only under the pinned key.
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

- **Members get market tools without any file they could read holding a credential.** With the two-user topology the token sits only in `dsh-team`'s process.
- **The router is in that process's user.** If the router were driven to read process memory, it could reach the token. On macOS and Linux a process cannot read another process's memory without debugger rights, and the credential-access audit records attempts at it. Accepted for now.
- **After a team host restart,** tools are unavailable until the owner re-enters the token. The team page says so and members are told `token-needed`.
- **Not in this design:**
  - an MCP server that needs the member's own identity (per-seat tokens);
  - stdio MCP servers;
  - streaming results.
- **Order:** M1+M2 in one PR (high tier: a new path for a credential), then M3. [superagent-mcp](../ops/superagent-mcp.md) 1.4 is corrected in the same PR.
