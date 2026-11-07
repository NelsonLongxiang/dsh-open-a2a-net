# p2-source-shadow 设计：a2a Source（影子模式）

配套：[接入规格](superagent-a2a-spec.md) · [实施计划](superagent-a2a-plan.md) · [断言与证据](superagent-a2a-evidence.md)

状态：设计稿第 2 版。全局设计评审（PR #385 @ 355f5fe）已批 G1、G2、D4，D7 不批；本版按评审改稿：D7 移进 p3 推迟项，并收入三条非阻断意见。不写代码；代码等属主选定运行节点（S15）、全局放行后再写。

## 上下文

- 目标：按 superagent Cookbook「Add a Source」的 11 步，在本仓 `next/0.8` 实现 a2a Source 插件包（属主裁定 S13 ①，导出名 `a2a-watch`），先以影子模式运行：只登记 Trigger 和研判记录，不开工单、不回发，使用专用 CLI 身份（S5）。
- 已具备的 a2a-net 能力（p1 全部完成）：`inbox --after` 可重放读取并报告挤出数（S2）、`route --json` 的 `class`（S3）、`thread <context_id>` 读取往来、`receipt <task_id>` 正式回执与 `disposition`（S14）。
- 本设计在读代码时发现两处 p2 之前必须处理的缺口（G1、G2）。全局已裁定：G1 实现为 p1-mail-proof；G2 用最小结构类型加契约测试；D4 可信集合只认 origin-claim 和 in-process；D7 不批，移进 p3。

## 决策：Cookbook 11 步的 a2a 落法

### 1. 领域映射

| 概念 | a2a Source |
|---|---|
| Trigger | 信箱里一条入站消息 |
| Trigger id | `key('a2a', from, task_id)`。task id 由调用方生成，只在宿主的幂等窗口内唯一，窗口过后不同调用方可能撞号，所以带上调用方句柄；也不用信箱 seq，因为 seq 在宿主存储重启（新 epoch）后会从 1 重来 |
| Thread | `context_id`；没有时用 `task_id`。完整键 `a2a:<id>` |
| Actor | 信箱行的 `from`（调用方句柄），只在来源校验通过时使用（S4，见 G1）；`human: false`，Agent 调用方按事实是 bot（见 D7） |
| Channel 地址 | `{caller: from, task: task_id, context: context_id}` |
| 接收范围 | 一个：这个 CLI 身份的信箱，行 id `mailbox` |

### 2. 配置、字段与健康

- 配置：`{ mode: 'observe', pollSeconds: 30, renewMinutes: 60 }`。p2 只接受 `observe`；`reply` 留给 p3。默认什么都不回发。
- 凭证与身份不进配置：`A2A_CLI_HOME`、`A2A_HOME`、`A2A_KEY` 由部署环境提供，与 superagent 的其他 CLI 凭证一样（S5）。
- 健康项：`a2a`（读取与游标）、`a2a-deposit`（户口）。只在需要人处理时报 `error`。

### 3. 消息 → Trigger

- 输入：`a2a-net inbox --after <cursor>` 的 `mail` 行，最旧在前。
- 没有 `task_id` 的行（老宿主投递）计入 unreadable，不生成 Trigger，不猜。
- 带 `dup: 'sync-answered'` 的行是同步应答的重复副本：计入 duplicateCopies，不生成 Trigger，避免同一回执产生第二个 Trigger。
- 回执行（宿主标出它回答的是哪个 task，见 G1）生成 Trigger，但在 scope 里以 `receipt` 理由过滤，让面板解释得清；影子模式本身不发起任务，所以不应出现回执，出现就是可见的异常。
- `addressed: 'direct'`：A2A 消息总是点名路由到本身份。
- `human: false`；`addressed: 'direct'`。
- `meta`：`taskId`、`contextId`、`seq`、`epoch`、`proof`、`receiptFor`，以及观察字段 `s13Strength`（按 S13 ② 本应得到的强度：调用方经校验且在 allowed 名单内时为 `explicit`，否则不写）。这个字段只记录，不参与判定，供 p3 裁定 D7 时使用。`text` 与 `meta` 都只当数据（S9）。

### 4. scope（只依赖 meta 与配置）

- `proof` 不在可信集合 {`origin-claim`, `in-process`}（D4，全局已批）→ `{listened: false, reason: 'unverified'}`（S4、规格 3.2）。没有 `proof` 字段的老行同样按 unverified 处理，失败时关闭。
- 回执行 → `{listened: false, reason: 'receipt'}`。
- 其余 → `{listened: true, observed: false, row: 'mailbox'}`。

### 5. Channel

- p2 影子模式：`allowed()` 在 `mode === 'observe'` 时对所有地址返回 false。Engine 即使产出外发消息，也只会作为 dropped 留在 Outbox，永远不发出。这是“不回发”的硬保证，不依赖策略配置。
- p3 起（不在本节点实现，只定形状）：同一任务的第一条外发用 `a2a-net receipt <task_id> [--attention] --to <caller> --json`；之后的外发作为同一 context 的新任务，用 `route <caller> <text> --context <ctx> --task a2a-<message.id> --json`（S13 ③、S14）。结果按 `class` 映射：sent → `sent`，gone → `gone`（`-32002` 另报 health error，S16），retry → 抛错交 Outbox 退避重试（规格 3.4）。CLI 以非零码退出时，仍读取 stdout 的 JSON。

### 6. threadContext

- `read`：`a2a-net thread <context_id> --limit 20 [--before <next_before>]`。`in` 行映射为 `{id: task_id, from, at, text}`，`out` 行映射为 `{id: task_id, from: 本身份, at, text}`；`next` 取 `next_before`。
- A2A 往来是平的：`root` 与 `parent` 两种 part 读同一页。
- `messageId(trigger)` = `meta.taskId`。
- 时钟说明：`in` 行时间来自宿主，`out` 行来自本机，交错顺序可能有偏差（cli.md 已写明）。

### 7. Policy

- `allowed`：允许发起工作的调用方句柄名单。p2 默认空。
- `explicit`：「名单里的调用方经校验后路由到本身份」。
- `rows`：一行 `mailbox`，三格全关（`listedUnaddressed`、`unlistedAddressed`、`unlistedUnaddressed` 都为 false）。
- `bots`：p2 留空，Agent 调用方按 Cookbook 默认处理（名单内的 bot 只能成为 inferred 候选）。p2 不开工单，这一点不影响影子模式。

### 8. Executor 变量

`DSH_SUPERAGENT_A2A_CALLER`、`DSH_SUPERAGENT_A2A_CONTEXT`；工单不是从本 Source 来的时为空；不含凭证。

### 9. 插件入口与轮询

- 等 `ctx.ready`；`configured()` 为假时报 `setupPending`；每轮读 `ctx.config('a2a')`，未启用报 `sourceOff`。
- 每轮：
  1. 户口：距上次 `a2a-net publish` 超过 `renewMinutes` 就重新发布；连续 3 次失败报 `a2a-deposit` error。户口过期会让路由被拒（2026-11-07 评审席自己的 CLI 身份就因此被拒过一次）。
  2. `inbox --after <cursor>`。游标存 `KV.a2a.cursor`，初值 `start`。
  3. `lost > 0`、`cursorAhead` 出现时报 `a2a` error，写出数字（S2）。`epochChanged` 或 `lost === null` 出现时也报 error，但文案写明“宿主存储已重启，期间的邮件可能丢失”，让值班的人知道这不是 Source 坏了。
  4. 逐行翻译、`receive`、`threads.describe`；单行坏了计数后继续。
  5. 全部落库后才写游标 `next`；被中断的一轮不动游标，重放靠稳定 id 去重。
  6. 连续 3 轮失败报 error。所有 CLI 调用都带 abort signal。

### 10. 注册

- 本仓 `tsdown.config.ts` 增加入口 `a2a-watch`，`package.json` exports 增加 `./a2a-watch`。
- superagent 一侧的 `cordis.patch.yml` 插入项（默认 disabled）由属主在选定节点上启用（S15）；本仓只提供包，不改那一侧的部署。

### 11. 测试

- 单元：按 Cookbook 清单逐项测，包括翻译、一轮读取、中断保留游标、observe 下 `allowed` 为假、threadContext 分页、插件注册与 setupPending、Policy 行，另加挤出 / epoch / cursorAhead 的 health error。
- 真实宿主：起一个 a2a-net 宿主和两个 CLI 身份，Source 读真实信箱，覆盖已验证与未验证消息、回执行、挤出。
- 反向变异：每个分支都要有测试能杀掉它的变异。

## 本设计发现的缺口

- **G1 信箱行没有结构化的来源校验字段。** wire 面只把校验结论写进正文头（`已验证来源 …` 或 `未验证（…）`），本地面连正文头都没有。Source 若靠解析正文判断 actor，就违反 S3、S4。需要宿主在写信箱时，把它已经算出的校验结论写成 `proof` 字段（`origin-claim` / `cli-identity` / `claim-mismatch` / … / `in-process`）；回执行同时写 `receipt_for`（它回答的 task id）。这只是把已有判定原样写出，不改准入。建议新增计划节点 `p1-mail-proof`（中档），作为 p2 的必检前置。
- **G2 superagent 没有以 npm 包发布。** 部署文档的做法是克隆后 `pnpm install && pnpm build`，`@deepseek-ai/dsh-superagent` 在 npm 上查不到，所以插件包在编译期拿不到 `SourceKind`、`SourceContext` 等类型。全局裁定选 (b)：本仓声明最小结构类型，运行时由 cordis 注入；本仓另放一份 superagent 类型快照，注明 superagent 的提交 SHA 和来源路径，契约测试只拿这份快照对照，测试和构建都不拉取 superagent。快照更新单独提交，PR 里写明新旧 SHA。不引入 superagent 的构建链，不 npm install 它。

## 全局裁定（PR #385 设计评审）

- **D4 可信来源集合**：批。只认 `origin-claim`（宿主已验证来源）和 `in-process`（同宿主本地面）。`cli-identity` 暂不认，以后要放开另立议题。
- **D7 Agent 调用方的 human 标志**：不批。把 Agent 调用方翻译成 `human: true` 是用一个假标签绕过 Cookbook「名单内的 bot 只能当 inferred」的规则，会让 superagent 里按“人”与“bot”区分的逻辑失真，最危险的是 bot 之间的回环防护；而且 p2 用不到 explicit 强度。p2 按事实翻译为 `human: false`，只把 `s13Strength` 记为观察字段。D7 移进 p3 推迟项。

## 影子模式的验收

按本仓验证器规范，验收只认 spec run 产物（AGENTS.md）。影子窗口结束时，对 superagent 存储的快照跑一份 ygl-trees verify spec，判据至少包括：

- 影子期内本 Source 实际发出的外发为 0；
- 每条已验证入站消息恰好对应一个 Trigger；
- 未验证消息全部以 `unverified` 理由过滤；
- 挤出或游标异常都留下了 health 记录。

PASS 记为计划节点 p3 的放行条件 `shadow_verify_pass`，与 `shadow_clean_days >= 7` 并列。

## 后果

- 正：影子期内“不回发”由 Channel 的 `allowed` 硬性保证；读取完全复用 p1 的命令，宿主只需补 G1 一处。
- 负：多一个前置节点（G1）；类型依赖（G2）在实现前要定；时钟交错与信箱 64 行上限仍是已知代价（S2）。
- 推迟项：
  - **D7（p3）**：属主裁定 S13 ② 与 Cookbook「名单内的 bot 只能当 inferred」相冲突。p3 设计时由属主在两条路里定：在 superagent 一侧加正当扩展，或接受 inferred。全局会报属主；
  - p3 的回发实现与 S17 缺口：调用方是会话时，`disposition` 只以正文到达，不进它的账本，p3 设计时再处理；
  - 多身份、多节点 Source；
  - 图片与附件（A2A 文件通道另行映射）。
