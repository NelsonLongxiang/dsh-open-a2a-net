# superagent × a2a-net 接入规格（草案）

配套：[ADR](superagent-a2a-adr.md) · [实施计划](superagent-a2a-plan.md) · [p2 Source 设计稿](superagent-a2a-p2-source-design.md) · [断言与证据](superagent-a2a-evidence.md) · [a2a-watch 接入说明](superagent-a2a-watch.md) · [信箱欠回执](superagent-mailbox-owes.md) · [信箱行准入规则](superagent-mail-admission.md)

**状态**：
- 属主已定方向（第 6 节），全局生产评估已对本规格给出 PASS。
- 计划第 1 阶段（p1）全部交付：#379–#384、#396–#398。
- p2a 插件代码已合入（#390、#391、#395）；p2b 影子冒烟正在评审席本机运行。
- p3 设计稿 v1.1 已过全局 design_pass，实现等冒烟验收完成后再开。

**依据**：断言 S1–S38，每条都挂有原文证据（ygl-trees 项目 superagent-a2a-spec-r7）。

**本版（r8）的改动**：
- 写入 2026-11-07 的属主裁定：
  - S21：D7 规则化 inferred；
  - S25：出站边界；
  - S26：回执结局；
  - S27：防回环；
  - S33：信箱欠回执；
  - S36：D4 修订；
  - S38：p4 收窄为送审。
- 更正 S17 的措辞（S29–S32）。
- 按 S37、S38 重写第 4 节和角色表。

## 1. 目标与非目标

**目标**：让运行在某个节点上的 dsh-superagent 通过 a2a-net 跨节点接活，并复用 a2a-net 已有的签名身份、入站校验、正式回执、强制对账和背压（S1）。superagent 用本地执行器自己做工作，不经 A2A 派工给远端席位（S38）。

**非目标**：
- 不改 superagent 的领域模型，也不新增领域概念。只实现它已开放的 Source 端口；送审与上报通道另见第 4 节。
- 不新增 a2a-net 的任务状态，也不放宽每个目标 3 笔欠账的上限（S7、S9）。准入、回执和结清方面新增的只有观察字段和由宿主强制执行的声明，例如 `owes`。
- 不替换现有的评审席、开发席人工协作流程。

## 2. 分层与角色

| 层 | 负责 | 不负责 |
|---|---|---|
| superagent（单节点） | 研判是否接活、开工单、用本地执行器做工作、对人说话、少打扰人 | 节点发现、调用方身份真伪、跨主机投递与回执 |
| a2a-net（跨节点基础设施） | 签名身份与入站校验、准入事实、跨主机投递、正式回执、账本守恒、空闲提醒、背压 | 判断要不要做、怎么做 |

角色对照与职责边界（S8，按 S38 重写）：

| superagent 角色 | 本网络对应 | 边界 |
|---|---|---|
| Operator / People | 属主 | 喊停、重试、改策略只来自人；部署配置（GitHub 仓库与 agent 账户）由属主提供 |
| 合并账号、评审批准 | 全局生产评估 + 属主 | 智能体不以自身账号合并或放行 |
| 主 Session | superagent 本地主 Session | 只做研判与工单编排，不经 A2A 派工 |
| 执行器 | superagent 本地 worker | 在本地完成工作；高档改动经 A2A 送审（第 4 节） |
| 非作者评审 | 评审席 | superagent 没有这个角色，本规格保留它作为放行前置 |

按协作规范 v1.18，一个项目最多只有开发、评审两个角色；需要并行时，由开发自己拉起子 agent。项目内 A2A 的外发只有三种：回执与 attention、送审、上报（S37、S38）。总工席不拆，r1-role-split 关闭。

## 3. 接入点：a2a Source（入站与回发）

### 3.1 领域映射

| superagent 概念 | a2a 映射 |
|---|---|
| Source 实例 | 一个专用 a2a-net CLI 身份的信箱，有独立的 A2A_CLI_HOME（S5） |
| Trigger | 信箱中的一条入站消息。id = key('a2a', 调用方句柄, task id)：task id 只在宿主的幂等窗口内唯一，带上调用方句柄，防止窗口过后撞号；不用信箱 seq，因为换 epoch 后 seq 会从 1 重新开始（S20） |
| Thread | context_id；没有 context_id 时用 task id |
| Actor | 调用方句柄。按事实翻译为 `human: false`（S21） |
| addressed | direct：A2A 消息总是点名路由到本身份 |
| Channel 地址 | {调用方句柄, task_id, context_id} |
| Policy 的 Source 部分 | `allowed` 名单不用来表示链接集，因为名单内的 addressed 触发会拿到 explicit 强度，与 S21 冲突；接单门禁见 3.2 |

### 3.2 信任与建链（S4、S18、S21、S36）

**可信来源集合**是 {origin-claim, in-process, cli-identity}（S36 修订 D4）。三类来源都必须同时满足一个条件：调用方在属主建立的链接集内。这样信任的锚点统一落在属主建链上，也消除了 S35 指出的倒挂。

**判定靠宿主写下的事实，不靠解析正文**：
- `proof`：宿主证明调用方身份的方式（p1-mail-proof，#382）。
- `admission`：宿主准入时命中的规则名（p1-mail-admission，#398）。
- 链接集对应的规则集合 LINK_RULES = {canvas-shared, remote-ref-samezone, remote-ref-foreign, remote-ref-cli, cli-deposit}。
- `roster-shared` 不在其中：白名单团队里的成员是会话自己加入的，属主并没有选定具体的调用方。失败按关闭处理。

**scope 是确定性过滤**，按下面的顺序判定，任一项不通过就记为 filtered、只当数据：

| 顺序 | 不通过的情形 | 过滤码 |
|---|---|---|
| 1 | proof 不可信 | unverified |
| 2 | admission 不属于 LINK_RULES；老宿主的行没有这个字段，也算 | unlinked |
| 3 | task id 以 `a2a-` 开头 | loop（S27 L1，防回环） |
| 4 | 是回执 | receipt |

**接单（S21）**：superagent 以 auto 模式运行，只有一条规则：「来源属于可信集合，且调用方在属主建立的链接集内」，放弃时用一句话说明原因（S26）。门禁由 scope 执行，这条规则用来把门禁记入 Mandate。Mandate 会记下命中的规则和 `s13Strength`。S13② 的 explicit 强度不再实现。

### 3.3 读取面（S2）

读取用 `a2a-net inbox --after <cursor> --json`（#379、#380）：只读，不推进任何本机游标；最旧的在前；返回 next 游标；显式给出被挤出的未读数（lost）。

Source 的游标存在 superagent 自己的状态里，按 Cookbook 的规则，全部 Trigger 落库后才推进。lost 大于 0、epoch 变化、游标超前，都上报 health error（S2）。

在 observe 模式下，superagent 还在等 setup 时 Source 也照常读信。superagent 在等待 setup 期间仍会登记收到的消息，只是暂停评估、派工和外发（#395）。

### 3.4 回发面（S3、S10、S22–S26）

回发只在 reply 模式下开启（p3）；observe 模式下 `allowed` 一律返回 false。

**出站边界（S25）**：
- **O1**：回发只送给触发这条消息的发送方。每次外发之前，用 `a2a-net admission <caller>` 复查对方当前是否仍在链接集内（#398）。
  - 必须由我们自己复查：本机户口的外发，家宿主按 `cli-deposit` 规则放行，不会检查目标和链接。
  - 复查不通过就判为 gone，并上报 health。
  - `from` 为 `"unknown"`，即进程内调用、没有会话的情况，不发送，记 channelIgnored。
- **O2**：一个任务的首条外发就是它唯一的正式回执，用 `a2a-net receipt <task_id> --to <from>`。之后的外发是同一 context 下的新任务，task id 为 `a2a-<message.id>`。
- **O3**：不发接单确认。上游只会对 `human` 的触发发 ack（S22）。attention 和 result 到达 Channel 时都是 kind:'reply'，只能按消息 id `attention-reply:<id>` 判别（S23）；attention 回执加 `--attention`。
- **O5**：一条消息首次发送失败后，如果 24 小时内仍未发出，就判为 gone，并上报 health error。

**回执结局（S24、S26）**：`receipt --outcome` 按工单结局（`Ticket.ended`）映射：

| 工单结局 | 回执 outcome |
|---|---|
| completed、merged | completed |
| dropped | rejected |
| stopped（由人叫停）、closed | abandoned |
| stopped（执行器自停） | failed |
| 尚未结束（由 ready 报告触发） | completed |

最后一行是已知局限：之后如果工单又以 dropped 结束，这个结局会作为同一 context 的新任务告知调用方。详见 p3 设计稿。

**回执语义（S14）**：
- `disposition` 是回执 v2 信封中的观察字段，取值只有 `"result"` 和 `"attention"`。
- attention 回执不带 outcome。它会结清原任务的欠账，但不代表工作完成。
- 回执走固定的 task id `receipt-<task_id>`，所以一个任务只有一张回执。

**信箱欠回执（S29–S33，更正 S17）**：
- **现状**：投给普通 CLI 信箱的任务在调用方那里是终态（`receipt:"mailbox"`），调用方不记欠账，也不受 3 笔名额的约束（S29、S30）。信箱满 64 行后会挤出最旧的行，只计数（S31）。所以派给 superagent 的请求，在任何一方的账本上都可能不存在，这和「强制对账」「拥堵即背压」两条原则冲突（S32）。
- **修复（S33，#397）**：
  - superagent 的 Source 身份用 `publish --owes`，在签名名片里声明「欠回执」。p3 的 reply 模式启用这个声明。
  - 家宿主对声明了欠回执的身份，回复「已投递」而不是终态。调用方因此记欠账，并受每个身份 3 笔的名额约束（所有调用方合计），超出时返回 -32009。
  - 欠它的行只有它自己的回执能结清。被挤出的行归档为 evicted 并释放名额。

**发送结果映射（S3）**：沿用 `a2a route --json` 的观察字段 `class`（#381），判定只看结构化字段。

| class | 何时出现 | Outbox 动作 |
|---|---|---|
| sent | `delivered:true`；带 result 的同步回复；-32005；重放时 prior 不是 failed | sent |
| gone | 只有三种：-32001、-32002、重放时 prior 为 failed | gone；-32002 另外上报 health error（S16） |
| retry | 其余全部 | 抛错，由 Outbox 用同一个 task id 退避重试；24 小时后判为 gone（O5） |

superagent 的 `Commands.run` 失败时会丢掉 stdout（G3），所以 a2a-watch 要带上调用方显式开启的 `--exit-class` 来调用。这个开关下的退出码含义：

| 退出码 | 含义 |
|---|---|
| 0 | sent，或者是同一张回执的重放 |
| 4 | gone |
| 5 | 该任务已有另一张回执 |
| 1 | retry |

不带这个开关时，所有调用方看到的 CLI 退出码语义不变。

### 3.5 对话上下文

`a2a-net thread <context_id>`（#383）：合并信箱里同一个 context 的入向消息和本身份发出的路由，分页、只读。

### 3.6 运行节点与部署

- 影子运行的节点由属主选定，经全局放行（S15）。属主已选定评审席本机；冒烟用的是 loopback 流量。
- reply 模式要求 superagent 已完成 setup，而 setup 需要 GitHub 仓库和 agent 账户。这项部署配置由属主提供，不由我们代办。

## 4. 送审与上报通道（S38，取代原「A2A Executor」）

superagent 用本地执行器完成工作，不再经 A2A 把工单派给远端席位。原第 4 节 A2A Executor 的端口映射作废（S37）。A2A 外发只剩三种：

| 外发 | 何时 | 约束 |
|---|---|---|
| 回执与 attention | 回应触发它的调用方 | 3.4 节的出站边界 |
| 送审 | 高档改动需要非自我评审（同一 SHA 的非自我 PASS） | 发给属主在部署配置里写死、并且在属主链接集内的评审席（p4 设计时由属主确认） |
| 上报 | 需要人或全局知会的事项 | 对象同样由属主写死，并且在链接集内 |

送审与上报通道的设计属于 p4，要先过全局的 design_pass。S27 的 L2（主动派工的回环防护）随着 S38 基本消失，这一点在 p4 设计里复核。

## 5. 契约不变量（S9）

- 不新增任务状态；新增的只能是观察字段，或由宿主强制执行的声明。
- 读到消息不等于确认，不自动 ack；欠账只由正式回执结清。
- 每个目标 3 笔欠账的上限和 queuedFor 的计法不变；声明了欠回执的身份同样计入，按身份合计。
- 未验证、未建链的消息只当数据。
- 公开仓库的文本里不出现地址、端口、主机名、本机路径或凭证。

## 6. 属主裁定

**2026-11-06（采用评审席建议，S13）**：
1. 代码位置：放在本仓 `next/0.8`，做成独立导出的插件包（`a2a-watch`），不 fork superagent。
2. ~~校验通过、并且在 allowed 名单内的调用方给 explicit 强度~~：已被 2026-11-07 的 S21 取代。
3. attention 走「正式回执，加同一 context 的新任务答复」。
4. 路由席不拆分（后被 S38 进一步收窄：不经 A2A 派工）。

**2026-11-07**：
- **S21**（D7）：规则化 inferred，见 3.2 节。
- **S25**：出站边界，见 3.4 节。
- **S26**：回执结局，见 3.4 节。
- **S27**：防回环。L1 见 3.2 节；L2 留给 p4。
- **S33**：信箱欠回执，见 3.4 节。
- **S36**：D4 修订，见 3.2 节。
- **S38**：p4 收窄为送审，见第 1、2、4 节。

**插件包的类型依赖（S19）**：在本仓声明最小结构类型，用 G2 快照和契约测试对照钉住的 superagent 提交 8c32a9d。

已知局限与未决问题见[断言与证据](superagent-a2a-evidence.md)。
