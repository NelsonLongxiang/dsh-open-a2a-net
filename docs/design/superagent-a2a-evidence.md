# superagent-a2a-spec-r3

_generated 2026-11-06 18:00:55 UTC by ygl-trees_

**研究问题**：superagent × a2a-net 接入规格与计划（全局 #376 评审意见修订版，单次生产）

## 摘要

共 16 条断言（15 条已证实、0 条存争议、1 条待验证），基于 29 条证据、19 个来源。

## 主要结论

1. ✓ S1 定位：a2a-net 作为 superagent 的跨节点基础设施层接入，只走两个已有端口：a2a Source（入站请求）与 A2A Executor（出站派工），不改 superagent 领域模型。  [1][2]  
   _置信度 B，状态 supported_
2. ✓ S2 读取面：a2a Source 需要调用方自持游标、可重放的只读拉取。现有 inbox --new 用本机共享游标，且主机信箱只留 64 行，所以必须新增 inbox --after <seq> --json，并显式报告被挤出的未读数；被挤出的消息无法恢复，只能如实暴露。  [4][14][2][13]  
   _置信度 A，状态 supported_
3. ✓ S3 回发面：A2A task id 由 Outbox message.id 确定性派生。发送结果按表映射为 sent / gone / 重试；接纳未知或暂时失败一律用同一 task id 重试，不换 id。身份冲突先按重试处理，超过上限才转 gone 并留记录；只有身份不存在或名片已撤销才直接 gone。  [15][5][18][28][10][3]  
   _置信度 A，状态 supported_
4. ✓ S4 信任：只有入站校验通过（bound）的调用方身份才能成为 Trigger actor；未验证或校验失败的消息在 scope 阶段记为 filtered，只当数据。这正好回答了 superagent 列为开放问题的 Trust。  [19][6]  
   _置信度 A，状态 supported_
5. ✓ S5 账号：a2a Source 与 A2A Executor 使用专用的 a2a-net CLI 身份（独立 A2A_CLI_HOME），等同 superagent 的专用 agent CLI 包装，不复用任何席位或属主身份。  [12]  
   _置信度 B，状态 supported_
6. ✓ S6 执行器映射：Assignment 启动对应带固定 task id 的派单；Input 交付对应在同一 context 里追加；inputsDelivered/inputsRead 对应 delivered/consumed 观察；Report 只来自正式回执，不从自由文本推断“等人”或“完成”。  [22][1][11][20]  
   _置信度 B，状态 supported_
7. ✓ S7 背压：目标每方 3 笔欠账上限不放宽；执行器派单遇到 queue-full 时延后（Later），不换 id，也不改投其他目标。  [21][16]  
   _置信度 A，状态 supported_
8. ✓ S8 角色分离：路由席只转原始请求和路由事实；反复出现的约束沉淀为常设规范；执行席自判范围、自判跟进，超出范围的交还。  [8][9][7]  
   _置信度 B，状态 supported_
9. ✓ S9 契约不变量：不新增任务状态，不读到即确认，不自动 ack，欠账只由正式回执结清；新增的只能是观察字段。consumed 只是主机层面的观察，不代表会话做出了承诺，也不能结清欠账。  [17][27][11][16]  
   _置信度 A，状态 supported_
10. ✓ S10 可靠性：所有外发先存后发、有界退避，与 #357 回执退避一致；dropped 只在目标永久不可达时出现，并留记录。  [10][3]  
   _置信度 B，状态 supported_
11. ✓ S11 版本线：开发前以 v0.7.0 为基线，不新打 tag；superagent 接入开发在 next/0.8 分支进行。  [23]  
   _置信度 A，状态 supported_
12. ✓ S12 执行方式：所有工作都不派发，由评审席独自开发完成；非自我评审由全局生产评估在 exact head 上进行（全局 2026-11-06 裁定）。  [24]  
   _置信度 A，状态 supported_
13. ✓ S13 属主裁定（采用评审席建议）：① 代码放在本仓 next/0.8，做成独立导出的插件包，不 fork superagent；② 校验通过、且在 allowed 名单内的 Agent 调用方给 explicit 强度；③ attention 走“正式回执 + 同 context 新任务答复”；④ 路由席暂不拆出。  [25]  
   _置信度 A，状态 supported_
14. ✓ S14 回执观察字段：正式回执附带观察字段 outcome，取值 "result" 或 "attention"。attention 回执会结清原任务欠账，但它不代表工作完成，调用方按 outcome 字段区分，不解析正文里的提示文字。这个字段不新增任务状态，纳入 p1-receipt-cmd 的范围，属于回执语义变化，须全局 PASS 并报属主知会。  [17][26][11]  
   _置信度 A，状态 supported_
15. ✓ S15 影子节点放行：p2 影子模式在哪个节点、何时上线属于生产变更，由属主选定节点，报全局放行；这两项都是计划树里 p2 的放行条件。  [29]  
   _置信度 A，状态 supported_
16. ? L1 未决：0.2.2-rc.1 的 followup “先插入后 throw”的判断只依据精确发布包的源码，尚未经实际运行验证。 _（无证据支撑）_  
   _置信度 C，状态 unverified_

## 已知局限（设计代价）

以下是本设计明确接受的代价，不是缺少证据的待办；它们都写在规格或 ADR 里。真正还没验证的项，由下面“局限与未决问题”一节按未验证断言自动列出。

- **远端执行器没有 progress**：A2A 的回执是终态，执行席的过程报告不经 A2A 传输，只在它自己的工单或 PR 里（S6）。
- **信箱上限 64 行**：主机只保留最新 64 行，被挤出的未读消息不可恢复。Source 只能如实报告挤出数，并上报 health error（S2）。
- **attention 多一次往返**：问题通过回执发出，答复要作为同一 context 的新任务回来（S13、S14）。
- **专用 CLI 身份需要运维**：要按时续户口，信箱容量要有人看（S5）。


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
[23] a2a-net 新版本分支 next/0.8 · git ls-remote origin refs/heads/next/0.8 — refs/heads/next/0.8 = a510152435fd410676cf979507037470ed473e4d（v0.7.0 tag 1d5513557c67 → c12c299 是其祖先）
[24] 属主在评审席会话中的裁定（2026-11-06） · 属主原话，评审席会话，2026-11-06 — 所有工作你都不能派发，由你独自开发完成
[25] 属主在评审席会话中的裁定（2026-11-06） · 属主针对规格第 6 节 4 个问题的答复，2026-11-06 — Use your recommendations
[26] 全局生产评估 PR #376 规格评审意见 @ a537c5a · 全局评审意见第 4 条 — 要求加一个观察字段，比如回执附带 outcome:"attention"、"result"
[27] 全局生产评估 PR #376 规格评审意见 @ a537c5a · 全局评审意见第 5 条 — consumed 只是主机层面的观察，不代表会话做出了承诺，也不能结清欠账
[28] 全局生产评估 PR #376 规格评审意见 @ a537c5a · 全局评审意见第 6 条 — 身份冲突也可能是暂时的（比如名片轮换），也可能是有人冒充
[29] 全局生产评估 PR #376 规格评审意见 @ a537c5a · 全局评审意见第 7 条 — 选哪个节点、什么时候上线，属于生产变更，由属主选节点、报我放行

## 来源

- 全局生产评估 PR #376 规格评审意见 @ a537c5a — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/376#global-review-a537c5a （置信度 B）
- a2a-net PR #364 inbound admission fail closed — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/364 （置信度 B）
- a2a-net 新版本分支 next/0.8 — https://github.com/NelsonLongxiang/dsh-open-a2a-net/tree/next/0.8 （置信度 B）
- 属主在评审席会话中的裁定（2026-11-06） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/376 （置信度 B）
- a2a-net protocol route-bookkeeping-observation — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/docs/protocol/route-bookkeeping-observation.md （置信度 B）
- a2a-net PR #372 synchronous reply contract — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/372 （置信度 B）
- a2a-net PR #375 followup admission — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/375 （置信度 B）
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

- 待补证据：L1 未决：0.2.2-rc.1 的 followup “先插入后 throw”的判断只依据精确发布包的源码，尚未经实际运行验证。