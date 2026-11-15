# superagent: requesting a tool outside the role's list

Status: agreed with the owner on 2026-11-10 ("能否做成可申请使用工具的方案？如果拒绝了，用 p0 决策单创建和批准"; "这样动态的也方便").

## Context

A team session may call only its role's tools (role-tools.ts). An observer on Windows called `gitbash`, a shell from a community DSH plugin that is not in the member preset (whose Windows shell is the sandboxed `pwsh`), and was refused. Hard-coding each such tool would grant it on every host whether or not the owner trusts the plugin behind it; refusing it forever blocks work the owner may want.

## Decisions

- **T1 The owner grants, per team.** Team settings carry `extraTools: { router?: string[], member?: string[] }` (an observer follows the member list). Changing it needs the owner's logged-in browser, as a rule change does (D10). A granted tool joins the role's list for that team only.
- **T2 Some tools are never grantable.** Tools that would cross the team's boundary stay refused without a card: `a2a_route`, `a2a_file_send`, team joining and leaving, subagents, starting or steering other sessions, and the router's `superagent_*` tools for a member. A role's own list is never a request.
- **T3 A refusal becomes a request.** When the guard refuses a grantable tool to a team session, the host raises a P0 decision card: who asked, which tool, options 批准 (this team's members and observers, or its router) or 拒绝. P0 cannot be approved with one click: the owner picks. The refusal the session sees says that a request is waiting and to try again after approval. One open card per team, role and tool.
- **T3a Asking by name.** The guard also hides what a role may not call, so a session often cannot see the tool it needs (live check on the test host: a member never saw `a2a_teams`). Every team session has `a2a_tool_request { name, why }`, which raises the same P0 card (the reason it gives is on the card), refuses a tool that is never grantable, and says when the tool is already allowed.
- **T4 The decision is applied, not ticketed.** Approving adds the tool to `extraTools` (recorded in the settings history as the owner's save) and the sessions' tool lists are recomputed at once; declining records the decision. A declined tool is not asked about again for 24 hours; the refusal says so.
- **T5 The owner can take it back.** The team page's 设置 lists the granted tools; removing one is an ordinary owner save.

- **T6 Members and observers keep everything but the boundary (2026-11-11).** The owner found granting tools one by one, and every MCP server the host was given, too much to operate. A member or an observer now sees and may call every tool its host offers, except what leaves the team: other sessions and subagents (`subagent`, `send_message`, `list_agents`, `interrupt_agent`, `workflow`, any name with `subagent` or `session_`), the host's plugins (`plugin_manager`), a question that waits on a person in the UI (`ask_user_question`; a team asks on a decision card), A2A sending, joining and settings (`a2a_route`, `a2a_file_send`, `a2a_team_join`, `a2a_team_leave`, `a2a_exposure`, `a2a_report`), another role's team tools, and ygl-trees beyond its own. Team settings carry `blockedTools`: tools the owner keeps from members and observers on top of that (owner-only). Such a refusal raises no card. The router keeps its list, its grants and T3's cards. The plugins and MCP servers on the host are the owner's to choose: what is installed, members can use.

## Consequences

The plugin behind a granted tool is the owner's to trust: the host cannot tell whether it is sandboxed. The card says so and recommends declining unless the owner trusts it. A tool that two roles ask for raises two cards.
