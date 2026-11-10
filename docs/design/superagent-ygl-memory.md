# superagent: ygl-trees as the team's memory

Status: agreed with the owner on 2026-11-10.

## Context

A2A carries a team's work and its receipts. What the team learns, the evidence behind it and the decisions it made should outlive one session, so the owner asked the team presets to make ygl-trees part of the work. A live ticket on the test host showed that a persona line alone is not enough: the router looked up earlier work before deciding, but the member did the research without reading or writing ygl-trees at all.

## Decisions

- **Y1 Reach: the MCP server, narrowed per role.** The three presets mount `dsh-mcp-client` with `ygl-trees mcp` as server `ygl` (#556). The server runs outside the session's sandbox, so every team session reaches one shared workspace: the team's own (`YGL_HOME`, from `SUPERAGENT_YGL_HOME` or `~/.ygl-trees-superagent`), apart from the owner's personal one and created once with `ygl-trees db init`; the CLI in a session's shell reaches only its own directory. The router gets `mcp__ygl__read` only; members and observers also get `mcp__ygl__write`, `mcp__ygl__verify` and `mcp__ygl__doctor`. Without `ygl-trees` on the host's PATH the tools do not appear, and the plugin installs nothing.
- **Y1a One ygl-trees session per team session (2026-11-10).** DSH starts an MCP server with `DSH_*` removed from its environment, and a preset's config is the same for every session, so without more every team session shared ygl-trees' default session and its project selection (found on the owner's host). The mount starts the server through a shell that sets `YGL_SESSION` to `superagent-<pid>` (on Windows, `cmd` with a random number), so each process has its own; the personas pass `project` on every read and write rather than rely on a selection. The id is per process, not the DSH session id: binding it to the session needs DSH to hand the session to an MCP server, which it does not.
- **Y1b The host creates the workspace (2026-11-10).** `db init` is an administration command the MCP server does not offer, the router has no shell and a member's shell reaches only its own directory, so on a host where nobody ran it every ygl tool answered `no database` (owner's Windows host). At start the host runs `ygl-trees db init` with `YGL_HOME` set to the team's workspace when it has no `ygl-trees.db`; without the command it does nothing. The personas say that `ygl` is only the MCP server's name, the command is `ygl-trees`, and a missing database is the host's to fix, not a session's.
- **Y2 The steps are on the assignment card.** A member that has `mcp__ygl__write` finds the steps in the card it acts on: read `agent brief` and `kb search` first, record evidence and claims as it goes, `kb add` before ready, and pass the ids it wrote in `ygl` on `a2a_ticket_report`. The ids are added to the report's summary, so the router and the owner see them.
- **Y3 One reminder at ready.** A ready report from such a member with no `ygl` ids is sent back once (`code: ygl-record`). The next ready goes through with or without ids, so a ticket with nothing worth keeping is never held, and the reminder is not a gate the member can get stuck on.

## Consequences

The host cannot tell whether what a member wrote is worth keeping; it only makes the step hard to forget. The reminder is kept in memory, so after a host restart a member may be reminded once more. A member serving another host's team is not reminded: its report goes to that host.
