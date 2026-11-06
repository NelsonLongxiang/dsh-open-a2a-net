# superagent-a2a-spec

_generated 2026-11-06 17:44:51 UTC by ygl-trees_

## 摘要

共 10 条断言（10 条已证实、0 条存争议、0 条待验证），基于 22 条证据、16 个来源。

## 主要结论

1. ✓ S1 定位：a2a-net 作为 superagent 的跨节点基础设施层接入，只走两个已有端口：a2a Source（入站请求）与 A2A Executor（出站派工），不改 superagent 领域模型。  [1][2]  
   _置信度 B，状态 supported_
2. ✓ S2 读取面：a2a Source 需要调用方自持游标、可重放的只读拉取；现有 inbox --new 用本机共享游标且主机信箱只留 64 行，必须新增 inbox --after <seq> --json 并显式报告被挤出的未读数。  [14][13][4][2]  
   _置信度 A，状态 supported_
3. ✓ S3 回发面：A2A task id 由 Outbox message.id 确定性派生；发送结果按表映射为 sent / gone / 重试，接纳未知或暂时失败一律用同一 task id 重试，不换 id。  [18][3][15][10][5]  
   _置信度 A，状态 supported_
4. ✓ S4 信任：只有入站校验通过（bound）的调用方身份才能成为 Trigger actor；未验证、校验失败的消息在 scope 阶段记为 filtered，只当数据。这正是 superagent 列为开放问题的 Trust。  [19][6]  
   _置信度 A，状态 supported_
5. ✓ S5 账号：a2a Source 与 A2A Executor 使用专用的 a2a-net CLI 身份（独立 A2A_CLI_HOME），等同 superagent 的专用 agent CLI 包装，不复用任何席位或属主身份。  [12]  
   _置信度 B，状态 supported_
6. ✓ S6 执行器映射：Assignment 启动对应带固定 task id 的派单；Input 交付对应同 context 追加；inputsDelivered/inputsRead 对应 delivered/consumed 观察；Report 只来自正式回执，不从自由文本推断等人或完成。  [22][1][20][11]  
   _置信度 B，状态 supported_
7. ✓ S7 背压：目标每方 3 笔欠账上限不放宽；执行器派单遇 queue-full 时延后（Later），不换 id、不改投其他目标。  [16][21]  
   _置信度 A，状态 supported_
8. ✓ S8 角色分离：路由席只转原始请求和路由事实；反复出现的约束沉淀为常设规范，执行席自判范围、自判跟进，超出范围交还。  [9][7][8]  
   _置信度 B，状态 supported_
9. ✓ S9 契约不变量：不新增任务状态，不读到即确认，不自动 ack，不用 receipt 以外的方式结清欠账；新增的只有观察字段。  [17][16][11]  
   _置信度 A，状态 supported_
10. ✓ S10 可靠性：所有外发先存后发、有界退避，与 #357 回执退避一致；dropped 只在目标永久不可达时出现，并留记录。  [3][10]  
   _置信度 B，状态 supported_

## 实施计划（科技树 superagent-a2a）

计划由 ygl-trees 科技树 `superagent-a2a` 生成：节点就是阶段，边就是前置，条件就是放行闸门。顺序取自 `node path p4-a2a-executor`。每完成一个节点，执行 `node unlock` 并挂上证据，不在本文就地改状态。

| 顺序 | 节点 | 内容 | 前置 | 放行条件 | 执行 | 档位 |
|---|---|---|---|---|---|---|
| 1 | `p0-spec-review` 规格与计划评审 | 本文、ADR 和计划树经属主定方向、全局生产评估 PASS。仅设计，不改代码。 | — | global_pass、owner_direction | 评审席 | — |
| 2 | `p1-send-classes` 发送结果分类 | route --json 输出稳定的结果类别 sent / gone / retry，并在契约文档里写出映射表（规格 3.4）。不改任何投递语义。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 3 | `p1-context-read` 按 context 读取往来 | 只读命令：按 context_id 列出本身份参与的往来，分页，给研判提供 threadContext。可选前置，没有它影子模式也能跑。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 4 | `p1-inbox-after` 可重放读取 inbox --after | CLI 新增 `inbox --after <seq> --json`：只读、最旧在前、给出 next 游标和挤出未读数，不推进本地游标。带真实主机测试和反向突变。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 5 | `p1-receipt-cmd` CLI 身份正式回执命令定型 | 确认并文档化 CLI 身份发送正式回执的唯一命令形状（task id、结果一句话），补测试，保证结清只走正式回执。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 6 | `p2-source-shadow` a2a Source 影子模式 | 按 Cookbook 11 步实现 a2a Source，在一个节点以 observe 模式运行：只登记 Trigger 和研判记录，不开工单、不回发。使用专用 CLI 身份。 | p1-inbox-after、p1-send-classes、p1-receipt-cmd、p1-context-read | code_location_ruled、global_pass | 代码位置裁定后由开发席实现 | 高档 |
| 7 | `p3-source-explicit` 明确请求转工单 | 允许名单内且校验通过的调用方，其明确请求转为工单；结果、问题按规格 3.4 用正式回执回发。影子运行满 7 天无异常后才放行。 | p2-source-shadow | global_pass、shadow_clean_days >= 7 | 开发席实现，评审席非作者评审 | 高档 |
| 8 | `r1-role-split` 席位职责与派单约束沉淀 | 把反复出现的派单约束沉淀为常设规范；裁定路由席是否从评审席拆出。只改文档与规范。 | p0-spec-review | owner_ruling | 属主裁定，评审席起草 | 低档（文档） |
| 9 | `p4-a2a-executor` A2A Executor 适配器 | 实现 Executor 端口：派工、追加、回执映射为报告，queue-full 时延后，重启按原 id 对账。先单独提交设计稿评审。 | p3-source-explicit、p1-send-classes、r1-role-split | executor_design_pass、global_pass | 设计稿评审后由开发席实现 | 高档 |

通用规则：
- 每个节点各开一个 PR，正文只写 Refs，不带任何关闭关键字；高档在 exact head 上由非作者 PASS，报全局，等回复后再合。
- 不 tag、不 publish、不部署，除非另有发版单。
- 影子模式与真实请求阶段的验收结论，按验证器规范只认 spec run 产物。


## 实施计划（科技树 superagent-a2a）

计划由 ygl-trees 科技树 `superagent-a2a` 生成：节点就是阶段，边就是前置，条件就是放行闸门。顺序取自 `node path p4-a2a-executor`。每完成一个节点，执行 `node unlock` 并挂上证据，不在本文就地改状态。

| 顺序 | 节点 | 内容 | 前置 | 放行条件 | 执行 | 档位 |
|---|---|---|---|---|---|---|
| 1 | `p0-spec-review` 规格与计划评审 | 本文、ADR 和计划树经属主定方向、全局生产评估 PASS。仅设计，不改代码。 | — | global_pass、owner_direction | 评审席 | — |
| 2 | `p1-send-classes` 发送结果分类 | route --json 输出稳定的结果类别 sent / gone / retry，并在契约文档里写出映射表（规格 3.4）。不改任何投递语义。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 3 | `p1-context-read` 按 context 读取往来 | 只读命令：按 context_id 列出本身份参与的往来，分页，给研判提供 threadContext。可选前置，没有它影子模式也能跑。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 4 | `p1-inbox-after` 可重放读取 inbox --after | CLI 新增 `inbox --after <seq> --json`：只读、最旧在前、给出 next 游标和挤出未读数，不推进本地游标。带真实主机测试和反向突变。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 5 | `p1-receipt-cmd` CLI 身份正式回执命令定型 | 确认并文档化 CLI 身份发送正式回执的唯一命令形状（task id、结果一句话），补测试，保证结清只走正式回执。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 6 | `p2-source-shadow` a2a Source 影子模式 | 按 Cookbook 11 步实现 a2a Source，在一个节点以 observe 模式运行：只登记 Trigger 和研判记录，不开工单、不回发。使用专用 CLI 身份。 | p1-inbox-after、p1-send-classes、p1-receipt-cmd、p1-context-read（可选） | code_location_ruled、global_pass | 代码位置裁定后由开发席实现 | 高档 |
| 7 | `p3-source-explicit` 明确请求转工单 | 允许名单内且校验通过的调用方，其明确请求转为工单；结果、问题按规格 3.4 用正式回执回发。影子运行满 7 天无异常后才放行。 | p2-source-shadow | global_pass、shadow_clean_days >= 7 | 开发席实现，评审席非作者评审 | 高档 |
| 8 | `r1-role-split` 席位职责与派单约束沉淀 | 把反复出现的派单约束沉淀为常设规范；裁定路由席是否从评审席拆出。只改文档与规范。 | p0-spec-review | owner_ruling | 属主裁定，评审席起草 | 低档（文档） |
| 9 | `p4-a2a-executor` A2A Executor 适配器 | 实现 Executor 端口：派工、追加、回执映射为报告，queue-full 时延后，重启按原 id 对账。先单独提交设计稿评审。 | p3-source-explicit、p1-send-classes、r1-role-split（可选） | executor_design_pass、global_pass | 设计稿评审后由开发席实现 | 高档 |

通用规则：
- 每个节点各开一个 PR，正文只写 Refs，不带任何关闭关键字；高档在 exact head 上由非作者 PASS，报全局，等回复后再合。
- 不 tag、不 publish、不部署，除非另有发版单。
- 影子模式与真实请求阶段的验收结论，按验证器规范只认 spec run 产物。


## 实施计划（科技树 superagent-a2a）

# superagent × a2a-net 实施计划（草案）

配套 [接入规格](superagent-a2a-spec.md)。

计划由 ygl-trees 科技树 `superagent-a2a` 生成：节点就是阶段，边就是前置，条件就是放行闸门。顺序取自 `node path p4-a2a-executor`。每完成一个节点，执行 `node unlock` 并挂上证据，不在本文就地改状态。

| 顺序 | 节点 | 内容 | 前置 | 放行条件 | 执行 | 档位 |
|---|---|---|---|---|---|---|
| 1 | `p0-spec-review` 规格与计划评审 | 本文、ADR 和计划树经属主定方向、全局生产评估 PASS。仅设计，不改代码。 | — | global_pass、owner_direction | 评审席 | — |
| 2 | `p1-send-classes` 发送结果分类 | route --json 输出稳定的结果类别 sent / gone / retry，并在契约文档里写出映射表（规格 3.4）。不改任何投递语义。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 3 | `p1-context-read` 按 context 读取往来 | 只读命令：按 context_id 列出本身份参与的往来，分页，给研判提供 threadContext。可选前置，没有它影子模式也能跑。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 4 | `p1-inbox-after` 可重放读取 inbox --after | CLI 新增 `inbox --after <seq> --json`：只读、最旧在前、给出 next 游标和挤出未读数，不推进本地游标。带真实主机测试和反向突变。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 5 | `p1-receipt-cmd` CLI 身份正式回执命令定型 | 确认并文档化 CLI 身份发送正式回执的唯一命令形状（task id、结果一句话），补测试，保证结清只走正式回执。 | p0-spec-review | nonauthor_pass | 开发席实现，评审席非作者评审 | 中档 |
| 6 | `p2-source-shadow` a2a Source 影子模式 | 按 Cookbook 11 步实现 a2a Source，在一个节点以 observe 模式运行：只登记 Trigger 和研判记录，不开工单、不回发。使用专用 CLI 身份。 | p1-inbox-after、p1-send-classes、p1-receipt-cmd、p1-context-read（可选） | code_location_ruled、global_pass | 代码位置裁定后由开发席实现 | 高档 |
| 7 | `p3-source-explicit` 明确请求转工单 | 允许名单内且校验通过的调用方，其明确请求转为工单；结果、问题按规格 3.4 用正式回执回发。影子运行满 7 天无异常后才放行。 | p2-source-shadow | global_pass、shadow_clean_days >= 7 | 开发席实现，评审席非作者评审 | 高档 |
| 8 | `r1-role-split` 席位职责与派单约束沉淀 | 把反复出现的派单约束沉淀为常设规范；裁定路由席是否从评审席拆出。只改文档与规范。 | p0-spec-review | owner_ruling | 属主裁定，评审席起草 | 低档（文档） |
| 9 | `p4-a2a-executor` A2A Executor 适配器 | 实现 Executor 端口：派工、追加、回执映射为报告，queue-full 时延后，重启按原 id 对账。先单独提交设计稿评审。 | p3-source-explicit、p1-send-classes、r1-role-split（可选） | executor_design_pass、global_pass | 设计稿评审后由开发席实现 | 高档 |

通用规则：
- 每个节点各开一个 PR，正文只写 Refs，不带任何关闭关键字；高档在 exact head 上由非作者 PASS，报全局，等回复后再合。
- 不 tag、不 publish、不部署，除非另有发版单。
- 影子模式与真实请求阶段的验收结论，按验证器规范只认 spec run 产物。


## 证据清单

[1] superagent 001 Domain model · docs/001-domain.md#Concepts — The Executor, with its Sessions and directories, is outside the domain and connects through Assignments.
[2] superagent 008 Cookbook: Add a Source · docs/008-cookbook.md#Add a Source — `hookq pull --after <n> --json` prints the messages after position `n`, oldest first
[3] superagent 008 Cookbook: Add a Source · docs/008-cookbook.md#5. Replies: the Channel — Return `sent` on success and `gone` only when delivery is permanently impossible
[4] superagent 008 Cookbook: Add a Source · docs/008-cookbook.md#9 — Advance a cursor only after every covered Trigger has been stored.
[5] superagent 008 Cookbook: Add a Source · docs/008-cookbook.md#3 — Derive the Trigger id from the queue id through `key`.
[6] superagent 007 Architecture · docs/007-architecture.md#Open questions — Trust: which Trigger fields are trusted, such as the Source's actor and Thread membership, and which are not, such as the body and quotes.
[7] superagent 004 Prompts · docs/004-prompts.md#Principles of the built-in text — The main Session only routes: it forwards the original Trigger and the routing facts, and makes no technical decisions
[8] superagent prompts/dispatch.md · prompts/dispatch.md — Do not paraphrase a short request into a work plan, pick examples or categories, invent requirements
[9] superagent prompts/work.md · prompts/work.md — Decide every person's message on this ticket's own threads yourself
[10] superagent 003 Execution · docs/003-execution.md#Channel failure — Outgoing messages are stored and sent as stored work, retried with backoff from 5 seconds, doubling up to 300.
[11] superagent 001 Domain model · docs/001-domain.md#Rejected concepts — Inferring "waiting on a person" from a report's free text
[12] superagent 006 Deployment · docs/006-deployment.md#Agent GitHub account — Give it a GitHub CLI that uses only its own credentials
[13] a2a-net CLI help (cli/a2a.mjs) · cli/a2a.mjs:62 — the host keeps 64; mail it pushed out is counted
[14] a2a-net CLI help (cli/a2a.mjs) · cli/a2a.mjs help inbox --new — only mail newer than the local cursor (~/.a2a/inbox.cursor), then advance it
[15] a2a-net CLI help (cli/a2a.mjs) · cli/a2a.mjs help route — the host runs one task id at most once
[16] a2a-net design 351 durable reconciliation · docs/design/351-durable-inbound-reconciliation.md#上下文 — 属主认定拥堵是背压正常工作；去中心化协作要求会话本人强制对账。
[17] a2a-net protocol route-bookkeeping-observation · docs/protocol/route-bookkeeping-observation.md — receiverBookkeeping 目前唯一合法值是 failed
[18] a2a-net PR #375 followup admission · docs/protocol/followup-admission.md (PR #375) — 选择失败形状上的观察字段 `acceptance:"unknown"`，不采用 -32005
[19] a2a-net PR #364 inbound admission fail closed · docs/release.md#0.7.0 #364 — 带任一 OriginClaim 字段必须在本请求内完成有界校验
[20] a2a-net PR #372 synchronous reply contract · docs/release.md 下一版本候选 (PR #372) — 返回已有 `TASK_STATE_DELIVERED` 且不带 `reply_final`
[21] superagent 003 Execution · docs/003-execution.md#Concurrency — The configured concurrency limit applies to these slots, with one extra slot for a person's message or a status request.
[22] superagent 001 Domain model · docs/001-domain.md#Concepts (Assignment) — A Ticket has several over time. Goes pending → running → ended independently of the Ticket.

## 来源

- a2a-net protocol route-bookkeeping-observation — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/docs/protocol/route-bookkeeping-observation.md （置信度 B）
- a2a-net PR #372 synchronous reply contract — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/372 （置信度 B）
- a2a-net PR #375 followup admission — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/375 （置信度 B）
- a2a-net PR #364 inbound admission fail closed — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/364 （置信度 B）
- superagent prompts/work.md — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/prompts/work.md （置信度 B）
- a2a-net CLI help (cli/a2a.mjs) — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/cli/a2a.mjs （置信度 B）
- a2a-net design 351 durable reconciliation — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/docs/design/351-durable-inbound-reconciliation.md （置信度 B）
- superagent 007 Architecture — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/007-architecture.md （置信度 B）
- superagent 008 Cookbook: Add a Source — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/008-cookbook.md （置信度 B）
- superagent prompts/dispatch.md — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/prompts/dispatch.md （置信度 B）
- superagent 004 Prompts — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/004-prompts.md （置信度 B）
- superagent 006 Deployment — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/006-deployment.md （置信度 B）
- superagent 002 Authorization — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/002-authorization.md （置信度 B）
- superagent 003 Execution — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/003-execution.md （置信度 B）
- superagent 001 Domain model — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/001-domain.md （置信度 B）
- superagent 000 Philosophy — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/000-philosophy.md （置信度 B）

## 局限与未决问题

_无_