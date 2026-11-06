# superagent × a2a-net 接入规格（草案）

配套：[ADR](superagent-a2a-adr.md) · [实施计划](superagent-a2a-plan.md) · [断言与证据](superagent-a2a-evidence.md)

状态：草案，仅设计，无实施授权。待属主定方向、全局生产评估 PASS 后才进入计划第 1 阶段。依据断言 S1–S10，每条都挂有原文证据（ygl-trees 项目 superagent-a2a-spec）。

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
| Trigger | 信箱中一条已验证的入站消息；id = key('a2a', 信箱 seq 与 task id) |
| Thread | context_id；没有 context_id 时用 task id |
| Actor | 入站校验通过（bound）的调用方句柄（S4） |
| addressed | direct：A2A 消息总是点名路由到本身份 |
| Channel 地址 | {调用方句柄, task_id, context_id} |
| Policy 的 Source 部分 | allowed = 允许发起工作的调用方句柄名单；bots 为空 |

### 3.2 信任（S4）

只有入站校验通过的调用方才能成为 actor。被标为“未验证”或校验失败的消息，在 scope 阶段记为 filtered（reason: unverified），只当数据，不进入 Eval。这回答了 superagent 架构文档中列为开放问题的 Trust。

### 3.3 读取面（S2）

Cookbook 要求的是调用方自持游标的拉取。现状有两处不满足：
- `a2a-net inbox --new` 用本机共享游标（~/.a2a/inbox.cursor），多个消费者会互相推进；
- 主机信箱只保留最新 64 行，超出的未读会被挤出。

所以需要新增 `a2a-net inbox --after <seq> --json`：
- 只读，不推进任何游标；
- 输出最旧在前，并给出 next 游标；
- 显式给出这次窗口内被挤出的未读数。

Source 的游标保存在 superagent 自己的状态里，按 Cookbook 规则：全部 Trigger 落库后才推进。挤出数大于 0 时上报 health error，如实暴露缺口，不假装完整。

### 3.4 回发面（S3、S10）

| 用途（purpose） | A2A 动作 |
|---|---|
| acknowledgement | 不单独发送。A2A 的送达与消费观察已承担这一层，也遵守“不发礼节性路由”的约定 |
| result | 正式回执 `[A2A receipt] task <id> <结果一句话>`，结清该任务欠账 |
| attention | 正式回执，结果为“需要决定：<一个具体问题>”；人的答复以同一 context 的新任务到达，经订阅恢复工单 |
| answer | 同 result |

发送结果映射：

| a2a 结果 | send 返回 |
|---|---|
| delivered:true（含 receiverBookkeeping:failed 观察） | sent（另记观察） |
| 目标身份不存在、名片已撤销、身份冲突 | gone |
| queue-full、校验暂时失败、超时、连接失败、5xx | 抛错，由 Outbox 退避重试 |
| acceptance:"unknown" | 抛错重试，仍用同一 task id（主机对同 id 至多执行一次） |

task id 由 Outbox 的 message.id 确定性派生；重试永不换 id。

### 3.5 对话上下文

为研判提供 threadContext，需要新增按 context_id 读取往来的只读命令。缺少时，研判只能看到 Trigger 本身。

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

## 6. 待属主或全局裁定

1. a2a Source 与 A2A Executor 的代码放在哪里：superagent 的分支、本仓导出的插件包（例如 `a2a-watch`），还是独立仓库。
2. 已验证的 A2A 调用方是智能体会话而不是人。是否按“名单内的人”给它们 explicit 强度？本稿的建议是：给，前提是句柄在 allowed 名单内且校验通过。
3. attention 走“正式回执 + 同 context 新任务答复”是否接受。
4. 路由席是否从评审席拆出，评审席只保留非作者评审。
