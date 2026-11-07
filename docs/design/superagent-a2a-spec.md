# superagent × a2a-net 接入规格（草案）

配套：[ADR](superagent-a2a-adr.md) · [实施计划](superagent-a2a-plan.md) · [p2 Source 设计稿](superagent-a2a-p2-source-design.md) · [断言与证据](superagent-a2a-evidence.md)

状态：属主已定方向（第 6 节），全局生产评估已 PASS；计划第 1 阶段（p1）的四个节点已全部交付（PR #379–#384），p2 设计稿第 2 版待全局抽查（第 1 版评审已批 G1、G2、D4，D7 不批并移进 p3）。依据断言 S1–S20，每条都挂有原文证据（ygl-trees 项目 superagent-a2a-spec-r7）。修订经过：按全局 PR #376 @ a537c5a 的评审意见修订；按 PR #381 的评审条件对齐 3.4 节与实现；按全局 p1-receipt-cmd 开工前裁定，把回执观察字段定名为 `disposition`；补入 p2 设计时发现的来源校验缺口（S18）和类型依赖缺口（S19）；本版按全局对 p2 设计稿的裁定（S20）改 Trigger id 与 actor 的翻译。

## 1. 目标与非目标

**目标**：让运行在某个节点上的 dsh-superagent，通过 a2a-net 跨节点接活和派工，并复用 a2a-net 已有的签名身份、入站校验、正式回执、强制对账与背压。（S1）

**非目标**
- 不改 superagent 的领域模型，不新增它的领域概念；只实现它已经开放的两个端口。
- 不新增 a2a-net 的任务状态，不改准入、回执和结清契约，不放宽每目标 3 笔的欠账上限。（S7、S9）
- 第一阶段不替换现有的评审席、开发席人工协作流程。

## 2. 分层与角色

| 层 | 负责 | 不负责 |
|---|---|---|
| superagent（单节点） | 研判是否接活、开工单、派给执行器、对人说话、少打扰人 | 节点发现、调用方身份真伪、跨主机投递与回执 |
| a2a-net（跨节点基础设施） | 签名身份与入站校验、跨主机投递、正式回执、账本守恒、空闲提醒、背压 | 判断要不要做、怎么做 |

角色对照与职责边界（S8）：

| superagent 角色 | 本网络对应 | 边界 |
|---|---|---|
| Operator / People | 属主 | 喊停、重试、改策略只来自人 |
| 合并账号、评审批准 | 全局生产评估 + 属主 | 智能体不以自身账号合并或放行 |
| 主 Session（路由） | 路由席（现由评审席兼任） | 只转原始请求与路由事实，不追加实现方案 |
| 执行器 | 开发席等远端席位 | 自判范围、自判跟进，超出范围交还 |
| 非作者评审 | 评审席 | superagent 无此角色，本规格保留它为放行前置 |

反复出现的派单约束，沉淀进常设规范（协同规范、AGENTS.md、团队提示段），不再每单由路由席追加。

## 3. 接入点 A：a2a Source（入站）

### 3.1 领域映射

| superagent 概念 | a2a 映射 |
|---|---|
| Source 实例 | 一个专用 a2a-net CLI 身份（独立 A2A_CLI_HOME）的信箱（S5） |
| Trigger | 信箱中一条入站消息；id = key('a2a', 调用方句柄, task id)。task id 只在宿主幂等窗口内唯一，带上调用方句柄防止窗口过后撞号；不用信箱 seq（新 epoch 会从 1 重来） |
| Thread | context_id；没有 context_id 时用 task id |
| Actor | 来源校验通过的调用方句柄（S4）：信箱行 `proof` 为 origin-claim 或 in-process（S20）；按事实翻译为 `human: false` |
| addressed | direct：A2A 消息总是点名路由到本身份 |
| Channel 地址 | {调用方句柄, task_id, context_id} |
| Policy 的 Source 部分 | allowed = 允许发起工作的调用方句柄名单；bots 为空 |

### 3.2 信任（S4）

只有入站校验通过的调用方才能成为 actor。被标为“未验证”或校验失败的消息，在 scope 阶段记为 filtered（reason: unverified），只当数据，不进入 Eval。这回答了 superagent 架构文档中列为开放问题的 Trust。

现状缺口（S18）：校验结论目前只写在信箱行正文的头部（wire 面写“已验证来源 …”或“未验证（…）”，本地面不写），信箱行没有结构化字段。Source 不能靠解析正文判断 actor，所以宿主要先把已算出的校验结论写成信箱行的 `proof` 字段，回执行另写 `receipt_for`。这是计划节点 p1-mail-proof，作为 p2 的必检前置。

### 3.3 读取面（S2）

Cookbook 要求的是调用方自持游标的拉取。现状有两处不满足：
- `a2a-net inbox --new` 用本机共享游标（~/.a2a/inbox.cursor），多个消费者会互相推进；
- 主机信箱只保留最新 64 行，超出的未读会被挤出。

所以新增了 `a2a-net inbox --after <seq> --json`（PR #379、#380 已交付）：
- 只读，不推进任何游标；
- 输出最旧在前，并给出 next 游标；
- 显式给出这次窗口内被挤出的未读数。

Source 的游标保存在 superagent 自己的状态里，按 Cookbook 规则：全部 Trigger 落库后才推进。挤出数大于 0 时上报 health error，如实暴露缺口，不假装完整。

### 3.4 回发面（S3、S10）

| 用途（purpose） | A2A 动作 |
|---|---|
| acknowledgement | 不单独发送，遵守“不发礼节性路由”的约定。注意：delivered 和 consumed 只是主机层面的观察，不代表会话做出了承诺，也不能结清欠账（读到≠确认，S9） |
| result | 正式回执 `[A2A receipt] task <id> <结果一句话>`，信封带 `outcome:"completed"` 和 `disposition:"result"`，结清该任务欠账 |
| attention | 正式回执，信封带 `disposition:"attention"`，不带 outcome，正文是一个具体问题。它会结清原任务欠账，但**不代表工作完成**；调用方按 disposition 字段区分，不解析正文（S6、S14）。后续工作作为同一 context 的新任务另派，人的答复也以同一 context 的新任务到达，经订阅恢复工单 |
| answer | 同 result，`disposition:"result"` |

`disposition` 是回执 v2 信封里的新键，取值只有 `"result"` 和 `"attention"`，其他值丢弃；它是观察字段，不是新的任务状态（S9）。没有沿用 `outcome` 这个名字，是因为回执 v2 信封已有 `outcome`，表示工作如何结束（completed、failed 等），旧解析器会丢弃不认识的取值；新键则会被旧主机忽略，属于纯增量。attention 回执的信封仍带 `idempotencyKey`，旧主机照常认它为有效信封，并按头行结清。它改变了回执语义，归入计划节点 p1-receipt-cmd 实现，须全局 PASS 并报属主知会（S14）。

CLI 身份发正式回执只用一个命令：`a2a-net receipt <task_id> [--attention] <一句话>`。回执走固定 task id `receipt-<task_id>`，主机对同一 task id 只执行一次，所以一个任务只有一张回执：同一回执重发是幂等重放，先 attention 后 result 这类不同回执会被拒绝。

投递进 CLI 信箱的任务，在调用方是终态（信箱应答 `receipt:"mailbox"`，调用方不记欠账）。这类任务的回执在调用方没有可结清的欠账行，只把 `disposition` 送到调用方（CLI 调用方在信箱行上读这个字段）；回执只在调用方确实记了欠账的地方结清（S17）。

发送结果映射：直接使用 `a2a route --json` 输出的观察字段 `class`（PR #381）。判定只看结构化字段，不解析错误文本（S3）。

| class | 何时出现 | Outbox 动作 |
|---|---|---|
| sent | `delivered:true`（含 `receiverBookkeeping:"failed"`、`acceptance:"inserted"`）、带 result 的同步回复、`-32005`；重放时主机已持有该 id 且 prior 不是 failed | `sent`，另记观察字段 |
| gone | 只有三种：`-32001`（报文过大）、`-32002`（同一 id 对应不同报文）、重放时 prior failed。原样重发注定失败 | `gone`，留记录；`-32002` 另须上报 health error，因为它说明 id 派生有 bug（S16） |
| retry | 其余全部，包括 `acceptance:"unknown"`、目标身份不存在、名片已撤销、身份冲突、queue-full、校验失败、超时、401/403、5xx、通用 -32000，以及 CLI 没有输出 JSON | 抛错，由 Outbox 用同一 task id 有界退避重试；超过消费方上限才转 dropped 并留下记录，等人核查 |

目标身份不存在、名片已撤销、身份冲突目前都没有专用的结构化错误码，所以归入 retry，由消费方的上限兜底。将来主机若为它们补上专用错误码，再单独评估是否改判 gone。

task id 由 Outbox 的 message.id 确定性派生；重试永不换 id。

### 3.5 对话上下文

为研判提供 threadContext，需要按 context_id 读取往来的只读命令。已由 PR #383 交付：`a2a-net thread <context_id>`，合并信箱里同一 context 的入向消息与本身份发出的路由，分页、只读。

### 3.6 影子运行的节点

影子模式（计划节点 p2）在哪个节点运行、什么时候上线，属于生产变更：由属主选定节点，报全局放行（S15）。这两项是 p2 的放行条件。p2 的实现方案见 [p2 Source 设计稿](superagent-a2a-p2-source-design.md)，它要先过全局设计评审（design_pass）。

## 4. 接入点 B：A2A Executor（出站，后置）（S6、S7）

| Executor 端口 | A2A 映射 |
|---|---|
| launch（Assignment 启动） | `a2a-net route <席位> <派工卡> --task <确定性 id> --context <工单 id>` |
| deliver（Input 交付） | 同一 context 追加消息，task id 由 Input id 派生 |
| inputsDelivered | delivered:true |
| inputsRead | consumed / claimed 观察 |
| report | 只来自正式回执的结果；不从自由文本推断“等人”或“完成” |
| stop | 现有撤单（队列内移除，已消费则停止通知） |
| 背压 | 目标 queue-full 时 launch 抛 Later 延后；不换 id，不改投其他目标 |
| 重启恢复 | 按原 task id 对账；接纳未知不改 id 重派 |

A2A 的回执是终态。progress 一类中间报告不经 A2A 传输，执行席的过程记录留在它自己的工单或 PR 里。

## 5. 契约不变量（S9）

- 不新增任务状态；新增的只能是观察字段。
- 不读到即确认，不自动 ack；欠账只由正式回执结清。
- 每目标 3 笔欠账上限与 queuedFor 计法不变。
- 未验证消息只当数据。
- 公开仓库文本不含地址、端口、主机名、本机路径和凭证。

## 6. 属主裁定（2026-11-06，采用评审席建议，断言 S13）

1. 代码位置：本仓 `next/0.8`，做成独立导出的插件包（例如 `a2a-watch`），不 fork superagent。
2. 校验通过、且句柄在 allowed 名单内的 Agent 调用方，给 explicit 强度。注意：这与 superagent Cookbook「名单内的 bot 只能当 inferred」相冲突；p2 按事实翻译为 `human: false`，只把按本条应得的强度记为观察字段，冲突留到 p3 设计时由属主裁定（D7，S20）。
3. attention 走“正式回执 + 同 context 新任务答复”。
4. 路由席暂不从评审席拆出，由评审席独自完成全部工作（S12），r1 节点暂缓。

全局生产评估已对本规格给出 PASS（计划节点 p0-spec-review 已解锁）。已知局限与未决问题见[断言与证据](superagent-a2a-evidence.md)。

插件包的类型依赖（S19）：superagent 没有以 npm 包发布，`SourceKind`、`SourceContext` 等类型在编译期拿不到。p2 设计稿推荐在本仓声明最小结构类型，并用契约测试对照钉住的 superagent 提交；最后由全局定。
