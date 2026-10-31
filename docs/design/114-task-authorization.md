# 设计卡：任务授权记录（#114）——入站记不可变授权、出站记真实发送方、结算前校验授权链

> **状态（2026-10-31）：方案稿，待评审席复核。** 只定方案，不含代码。核对基线：
> master 4cf7c7e（0.6.31 候选）。文中 `file:line` 均按该提交。
> 评审通过后按 §7 拆成子 issue；其中台账字段（§2、§3）与结算判定（§4）属**协议/台账
> 变更，高档**。
>
> 关联：#61（回执串号实例 direct-bb27ec94）、#91（flood-guard）、#65（路线图）、
> #112（CLI `route` 不带 task id）、#113（CLI 信箱 64 行无 id）。
> 参照：deepseek-ai/dsh-superagent-prototype `docs/002-authorization.md`（Mandate /
> Policy version / observe）。

## 0. 一句话

今天，**谁发来一句 `[A2A receipt] task <id> …`，谁就能结算 `<id>`**。台账不记"凭什么接下这条任务"，
出站行不记"是谁发的"，结算也不问"是谁结的"。本设计给每条入站任务在出生时记一份**不可变授权**，
给出站行记**真实发送方**，并在结算前**按授权链比对结算方**。名单或画布变化时，只产出"受影响任务"
清单，**不取消**任何任务（observe）。

## 1. 现状（file:line 按 4cf7c7e）

### 1.1 任务从哪里进来

| 入口 | 位置 | 准入判定 | 台账落点 |
|---|---|---|---|
| `/a2a/direct`（HTTP 入站，跨主机 peer 与本机 CLI 都走这里） | `src/faces/wire.ts:415` | apiKey（`:478`）→ `a2aCallerRefusal(caller, team)`（`:521`）→ OriginClaim（`:535`）→ 递归预算（`:546`）→ 幂等认领（`:551-552`）→ flood-guard（`:567`） | `taskLedger.trackInbound(...)`（`:651`），`peer = local:<receiptTarget>` |
| `a2a_route` 本机进程内候选 | `src/index.ts:4484` `dispatchLocalCandidate` | 仅对 joined 面（`<zone>/<id8>`）跑 `joinedFaceAdmissionRefusal`（`:4493` → `:2781`）；initiator 面与外域标签不在此闸（F1b） | **无入站行**；调用方出站行由 `trackOwedTask(taskId, team, 'local', …)`（`:4404`）写入同一本台账 |
| `a2a_route` 跨主机候选（含画布远端成员 failover） | `src/index.ts:4417-4452` → `dispatchPeerCandidate`（`:4753`） | 发送侧 S3 团队范围检查（`routeTrunk` `:4319` 起）；接收侧走对端的 `/a2a/direct` | 出站行 `trackOwedTask(taskId, args.team, candidate, …)`（`:4452`），`peer` = 对端 URL |
| native-teams 传输面提交 | `src/index.ts:4955` | 同上（走 peer 候选） | 出站行，`team = request.handle` |
| CLI 户口信箱（目标是已登记 CLI 句柄） | wire 面 `src/faces/wire.ts:577-585`；本机候选 `src/index.ts:4516-4521` | 同所在入口 | **无台账行**；只写 `cliDeposits.mail(team, from, text)`（`src/cli-deposit.ts:159`，`MAILBOX_CAP = 64`，`:63`） |
| CLI `a2a route` | `cli/a2a.mjs:516-529` | POST 到户口宿主的 `/a2a/direct`，`caller_session = CLI 句柄`，**不带 `task_id`**（`:524`，即 #112），由宿主铸 `direct-<8hex>`（`wire.ts:501`） | 宿主侧入站行 |

join gate（`a2aJoinGateRefusal`，`src/index.ts:3465`）只管**本会话能不能用出站工具**，不进入台账，也不参与入站准入。

### 1.2 准入判定今天给出的"凭据"——只有一句拒绝文本

`a2aCallerRefusal`（`src/index.ts:2788`）返回 `string | undefined`：通过时**不说是哪条规则放行的**。
实际放行分支（下文 §2.2 的 `via` 与 `admission_rule` 由此逐条导出）：

| 分支 | 位置 | 依据 |
|---|---|---|
| 关闭团队范围路由 | `:2789` | `config.teamScopeRouting === false`（默认 true，`:425`） |
| 宿主面 | `:2795` | `caller === config.team` |
| 同域 `<zone>/<id8>` | `:2805` → `sameZoneSharedTeamRefusal`（`:2660`） | 名册声明（`teamMemberships`）∪ 本机画布成员（W2②）；目标级交集（F5，`:2715` 起） |
| 同域但不在本机（#43 跨主机同名域） | `:2679-2689` | 本机画布的**远端成员引用** |
| 同域、名片缓存的 `canvasOrg` 双向识别（gh#71） | `:2690-2702`、目标级 `:2738-2747` | 远端名片自述，**随缓存冷热变化** |
| 外域句柄 | `:2807-2817` | 本机画布远端成员引用（N3/N4） |
| 自由标签 | `:2819-2830` | joined 会话 id / 本机伪句柄 / 在线节点 label |
| CLI 户口 | `:2836` | `cliDeposits.get(caller)`（gh#45） |

OriginClaim（`verifyOriginClaim`，`:2518`）证明的是**密钥持有**，验证失败时在窗口期内（`originClaimWindow`）
"缺信封"只计数放行（`wire.ts:535-545`）。`callerLinkedToThisHost`（`:2596`）是名片全量面的链接判定
（同源、joined、画布远端引用、双向 peers 种子），**不参与投递准入**，但它定义了本机承认的"链接"集合。

flood-guard（`src/flood-guard.ts:51`、`:86`）在准入、OriginClaim、幂等认领**之后**、结算**之前**运行，
按 `caller` 限速——它限的是频率，不是授权。

### 1.3 台账今天记什么

`TaskRecord`（`src/task-ledger.ts:91`）：`taskId, team, peer, startedAt, direction?, receiptExpected?,
contextId?, brief?, status, deadAt?, reason?`。`ArchivedRecord`（`:130`）再加 `resolvedAt, summary,
outcome, elapsedMs, lateReceiptAt, endedBy`。

- **入站行**：`peer = 'local:' + from`（`:369`），`from` 是回执目标（callback 或 caller 标签），
  **不是准入时判定的 caller**，也不记准入路径和名单版本。
- **出站行**：`track` / `trackReceiptless`（`:329` / `:309`）只记 `team` 与 `peer`（`'local'` 或
  对端 URL）。`routeTrunk` 手里有 `callerSession`（`src/index.ts:4371` 起），但没传进台账——所以团队
  验证器 L9 只能把出站发送方一律记成 "home"。
- 持久化：整文件写 `<dsh-home>/a2a/tasks.json`（`:747`），`restore()` 逐字段白名单解析（`:662`），
  **未知字段在下一次写盘时丢弃**。

### 1.4 回执怎样结算任务

唯一结算入口 `settleAndAnnounce(message)`（`src/index.ts:1003`），被两处调用：

- wire 面：`src/faces/wire.ts:572`——**在准入之后、CLI 信箱分流之前**，对每条入站消息都跑；
- 本机候选：`src/index.ts:4531`——**在 CLI 信箱分流（`:4516-4521`）之后**，所以投进本机 CLI 信箱的
  回执**根本不经过结算**（两条路径顺序不一致，见 §4.5）。

它做三件事，**三件都只看消息文本，不看是谁发的**：

1. `idempotencyStore.recordOutcome(taskId, {status:'completed', reply})`（`:1017`）——把回执首行记成
   该 task id 认领的结果；`/a2a/query`（`wire.ts:336`、`:383` → `idempotency-store.ts` `query()`）
   随后向持有原始载荷指纹（`peerPayloadFingerprint`，`idempotency-store.ts:57`）的调用方返回它；
   调用方用 `A2aClient.queryOutcome`（`src/a2a-client.ts:374`）读取。`recordOutcome` 先写者赢（`:265`）。
2. `taskLedger.resolveFromMessage(message)`（`:1020` → `task-ledger.ts:497`）——按头部 `task <id>`
   找行即结算，`endedBy: 'receipt'`。
3. 头部没对上时 `resolveEcho(message)`（`:1026` → `task-ledger.ts:586`）——正文里出现
   `task <id>` 即按"内容回声"结算。

回执由谁发：目标会话的模型可以自己 `a2a_route` 一条回执；更常见的是宿主**自动回执**
`armReceiptAutosend`（`src/index.ts:2162`）：在目标的"下一条 final 文本"上合成
`[A2A receipt] task <id> <摘要> (auto)` + `{"outcome":"completed","idempotencyKey":<id>}`，
以**宿主进程标签 `session`** 为 caller，经 `runReceiptLadder`（`src/receipt-ladder.ts:27`）
先投 caller、失败再投宿主信箱。

"下一条 final" 的取法在 `flushFinals`（`src/index.ts:5440`）：取**所有挂起 waiter 中最小
`sinceEvents`** 之后的最新一条 assistant 消息，**一次性回答全部 waiter**（`:5453-5468`）。
wire 面已经知道目标在投递前是否正在跑别的 turn（`runningBeforeSteer`，`wire.ts:620`），但这个事实
只用于 `consumed` 探针（`:643`），**没有传给自动回执**。

### 1.5 #61 实例按代码复盘（direct-bb27ec94）

材料：#61 评论（2026-10-29，宿主 .156 · 0.6.29）。

1. CLI 户口 `review-seat/f62b3c7aa9f44276` 经 `a2a route` 向 `dsh/414d2b90` 投递；CLI 不带 id，宿主铸
   `direct-bb27ec94`。准入走 `cliDeposits.get(caller)`（`index.ts:2836`）。入站行
   `peer = local:review-seat/f62b…`。自动回执已挂上（`wire.ts:623`）。
2. 目标会话当时在做另一条工作线（采购 data 提交的通知钩子 / wm-audit 4a）。那条线的 final 文本
   被 `flushFinals` 当成 bb27ec94 的答复（§1.4 末段的机制；**这是按代码的推断，未对日志核实**）。
3. 宿主以 `dsh-host-9c53bf95`（宿主进程标签）为 caller 把 `(auto)` 回执投进 CLI 信箱，
   `{"outcome":"completed","idempotencyKey":"direct-bb27ec94"}`，正文与 bb27ec94 无关。
4. 事后无法回答"这条结算凭的是什么授权"：入站行没有授权记录；回执的 caller 是宿主标签而不是目标句柄；
   台账也不记结算方。

要点：**结算方 `dsh-host-9c53bf95` 恰是目标所在宿主的进程面**——单比对"结算方身份"拦不住这一例。
本设计用两道检查：§4.2 的授权链（拦"别人替你结"），§4.3 的 turn 归属（拦"宿主替你结、但拿错了 turn"）。
bb27ec94 由后者拦下。

## 2. 授权记录（入站，不可变）

### 2.1 字段

挂在入站行上的新字段 `auth`（出生即冻结，归档时原样带走）：

```ts
interface TaskAuthorization {
  readonly v: 1
  /** 准入时被判定的 caller（caller_session 原文，即 a2aCallerRefusal 的入参）。 */
  readonly caller: string
  /** caller 身份的证明强度。 */
  /** caller 身份的证明强度：OriginClaim 验过、且签名的 zone 覆盖 caller（同名或 `<zone>/…`）才是 origin-claim；验过但不覆盖记 claim-mismatch（claim 保留供审计）——S2 实现评审 PR #134 P1。 */
  readonly proof: 'origin-claim' | 'claim-mismatch' | 'legacy-window' | 'in-process' | 'none'
  /** proof = origin-claim 时：签名名片推导出的名字与名片 URL 的 origin。 */
  readonly claim?: { readonly caller: string; readonly origin: string }
  /** 入口面（封闭集，§2.2）。 */
  readonly ingress: 'wire' | 'local'
  /** 准入路径（封闭集，§2.2）。 */
  readonly via: Via
  /** 放行的具体规则（封闭集，§2.2）。 */
  readonly admission_rule: AdmissionRule
  /** 放行所依据的共享队（如 ["canvas:ops", "dsh/team-a"]）；host-face/open/cli-deposit 为空。 */
  readonly basis: readonly string[]
  /** 准入时本机名单版本（§2.3）。 */
  readonly allowlist_version: string
  /** 被投递的队（= 行的 team，冗余以便授权记录可独立校验）。 */
  readonly target: string
  /** 回执应送达处（callback 或 caller 标签，= 今天的 receiptTarget）。 */
  readonly receipt_target: string
  /** 出生时刻（epoch ms）。 */
  readonly received_at: number
  /** 投递时目标是否正在跑别的 turn（wire.ts:620 runningBeforeSteer）。仅审计事实，不参与 §4.3 判定。 */
  readonly target_busy?: true
}
```

与 issue 建议的 `{caller, via, admission_rule, allowlist_version, received_at}` 相比，多出的字段各有用途：
`proof`/`claim` 让结算判定分得清"签过名的身份"与"自报标签"；`basis` 让 §5 能判断哪一次名单变化
真正影响到这条任务；`target`/`receipt_target` 让 §4 的授权链不依赖行上其他可变字段；`target_busy`
留作审计：事后能看出投递时目标是否正忙（不参与 §4.3 判定，见评审 @8a961dc P2）。

### 2.2 `via` 与 `admission_rule`——由真实分支导出的封闭集

issue 建议的四类（`joined-session` / `canvas-member` / `cli-deposit` / `peer-relay`）混合了**入口**
和**依据**。代码里没有独立的"relay"准入：跨主机投递在接收侧就是一次 wire 入站，依据仍是画布远端
引用或 gh#71 名片组织。因此拆成两个正交字段：`ingress`（`wire` / `local`）+ `via`（依据），
`peer-relay` ≡ `ingress: 'wire'` 且 `via ∈ {canvas-member, peer-org}`。

```ts
type Via = 'host-face' | 'joined-session' | 'canvas-member' | 'peer-org' | 'cli-deposit' | 'open'

type AdmissionRule =
  | 'scope-off'            // index.ts:2789 teamScopeRouting=false          → via open
  | 'host-face'            // index.ts:2795 caller === config.team           → via host-face
  | 'local-exempt'         // dispatchLocalCandidate 不设闸的 initiator / 外域 / 无 agent 调用 → via host-face
  | 'roster-shared'        // sameZoneSharedTeamRefusal：名册声明交集（W1）    → via joined-session
  | 'canvas-shared'        // 同上：本机画布成员交集（W2②）                    → via canvas-member
  | 'remote-ref-samezone'  // index.ts:2679-2689（#43）                       → via canvas-member
  | 'remote-ref-foreign'   // index.ts:2807-2817（N3/N4）                     → via canvas-member
  | 'peer-org'             // index.ts:2690-2702 / 2738-2747（gh#71）          → via peer-org
  | 'node-fact'            // index.ts:2819-2830 自由标签命中本机节点事实       → via joined-session
  | 'cli-deposit'          // index.ts:2836（gh#45）                          → via cli-deposit
```

同一次准入可能有多条依据同时成立（例如既在名册又在画布）。取**判定代码第一条命中的分支**，
`basis` 记全部命中的共享队——这样 `admission_rule` 是确定的，`basis` 不丢信息。

实现方式（§7 S1）：把 `a2aCallerRefusal` / `sameZoneSharedTeamRefusal` / `joinedFaceAdmissionRefusal`
改写成返回结构化判定的 `a2aCallerAdmission(caller, target) → {ok:true, via, rule, basis} | {ok:false, refusal}`，
原函数保留为它的薄包装，**拒绝文本逐字不变**。

### 2.3 `allowlist_version` 的哈希

```
allowlist_version = "al1:" + sha256(canonicalJSON(inputs)).slice(0, 16)
```

`inputs` 只取**本机运营者可控、且在准入代码里真被读到的**记录，全部排序去重：

| 键 | 内容 | 来源 |
|---|---|---|
| `zone` | `config.team` | 配置 |
| `scope` | `[teamScopeRouting, originClaimWindow]` | 配置（`:425`、`:478`） |
| `joined` | joined 会话的 `<zone>/<id8>` 句柄 | `joinedSessions` |
| `roster` | `[<zone>/<id8>, team]` 对 | `teamMemberships` |
| `canvas` | `[canvasTeamOf(name), [本地成员句柄…, 远端引用…]]` | `canvasStore.list/membersOf/remoteMembersOf` |
| `cli` | **未过期**的 CLI 户口句柄 | `cliDeposits`（过期即移出，`cli-deposit.ts` sweep） |
| `links` | OriginClaim 链接面：`config.peers` 双向种子的 origin | `callerLinkedToThisHost` 基础 3（`:2619` 起） |

**不进版本的**：名片缓存里的 `canvasOrg`（gh#71）。它是远端自述，缓存每次冷热交替都会变，计入会让
版本无意义地抖动。代价由记录本身承担：`via: 'peer-org'` 的记录把命中的组织条目写进 `basis`
（`peer-org:<team>`），§5 对这类记录总是重新判定。

规范化 JSON：键按上表固定顺序、数组排序、无空白，规则写成 `src/task-auth.ts` 里的唯一实现，
并用黄金向量单测钉死（同 `peerPayloadFingerprint` "一处实现" 的纪律）。

**`cli` 带来的版本抖动在预期之内**：CLI 户口最长 4h 一续（`CLI_DEPOSIT_TTL_MS`，`cli-deposit.ts:22`），
过期与重新上线都会改变集合，从而改变版本、触发 §5。这是有意为之：户口下线正是"发送方是否仍在名单上"的事实变化。
两条约束保证它不成为噪声：**同一句柄在过期前续期不改变集合**（集合只含句柄，不含 `expiresAt`），版本不变；
**版本未变时 §5 零产出**。

### 2.4 写入点（唯一写者）与不可变性

- **构造只有一处**：新纯模块 `src/task-auth.ts` 的 `buildAuthorization(verdict, facts)`。
- **挂载只在行出生时**：
  - wire 面：`trackInbound(taskId, team, from, contextId, receiptExpected, brief, auth)`（今天 `wire.ts:651`）；
  - 本机候选（**移入 S4 #122**，S2 只做 wire 面；S4 是它唯一的消费方）：本机投递在同一本台账里只有调用方的出站行（§1.1），`auth`（`ingress: 'local'`）由
    `dispatchLocalCandidate` 算出、随结果交给 `trackOwedTask` 挂在**那一行**上。一行一个 task id，不新增行。
- `TaskLedger` 不提供任何修改 `auth` 的方法；`Object.freeze` 后入行；`abandon/cancel/resolve*/trimOwed`
  归档时原样复制。task id 已存在时 `track*` 本来就保持首条记录不变（`task-ledger.ts:332-333`），
  所以**重放无法覆盖授权**。
- 名单版本历史（**移入 S6 #124**，它是唯一的消费方）：新文件 `<dsh-home>/a2a/auth-versions.json`，环形 32 条
  `{version, at, cause, inputs}`，供 §5 解释"变了什么"。

### 2.5 持久化与迁移

- `tasks.json` 行上新增可选字段 `auth`（与 gh#31 的 `direction`/`endedBy` 同一先例：加字段、不升文件版本）。
- `restore()` 增加 `auth` 的白名单解析：`v === 1`、枚举值在封闭集内、字符串长度有上限；不合格则**整块丢弃**
  （行照常恢复，按旧行处理），绝不部分采纳。
- 旧行无 `auth`：S2 在 `/state` 上直接省略该字段；`legacy` 投影随 S4 的兼容判定一起做。旧行最多 24h（`TASK_STALE_TTL_MS`）离开欠账簿，
  归档 64 条上限内自然淘汰——**升级后约一天，遗留尾巴排空**，无需迁移脚本。
- 降级：旧版 `restore()` 逐字段白名单，会在下一次写盘时丢掉 `auth`。可接受，文档写明。

## 3. 出站行：记真实发送方

新增可选字段 `sender`（出站行与归档行）：

```ts
type Sender =
  | { kind: 'session'; id: string }   // <zone>/<id8>，routeTrunk 的 callerSession（有 agent）
  | { kind: 'host'; id: string; face?: string }  // 无 agent 的宿主面：quick-dispatch / 宿主工具调用 → 宿主进程标签；
                                                  // face = 线面上借用的句柄（quick-dispatch 借活跃 joined 会话的队），只作展示
  | { kind: 'bridge'; id: string }    // native-teams 传输面提交（index.ts:4955），id = 提交方句柄
```

- 写入点：`trackOwedTask`（`index.ts:4172`）多收一个 `sender`，三处调用（`:4404`、`:4452`、`:4955`）
  传入各自已在手的 caller 身份。`routeTrunk` 已经算好 `callerSession`（`:4371` 起），无需新判定。
- CLI 不在宿主上产生出站行：CLI 的发送在宿主侧是一条**入站**行，其发送方就是 `auth.caller`（CLI 句柄）。
  所以 L9 的分桶键统一为：**出站行用 `sender.kind:sender.id`，入站行用 `auth.caller`，两者都缺才落 `legacy`**——
  不再有 "home"。分桶必须带上 `kind`：运营者手设的宿主标签可能长得像 `<zone>/<id8>`，只按 `id` 会与该会话的席位混桶。
  `face` 永不参与分桶。（S3 实现评审，PR #127；quick-dispatch 记宿主标签 + `face` 为任务属主裁定。）
- `/state`（`src/faces/admin.ts:277` 起的 `tasks/tasksDead/archived` 投影）与 `a2a_tasks` 工具
  （`index.ts:5300`）追加 `sender`；CLI `a2a tasks`（`cli/a2a.mjs:566` 起）在行尾显示。均为追加字段。

## 4. 结算前校验授权链

### 4.1 结算方从哪里来

`settleAndAnnounce(message)` 改为 `settleAndAnnounce(message, settler)`：

```ts
interface Settler {
  readonly caller: string                          // 送来这条消息的 caller_session
  readonly proof: TaskAuthorization['proof']       // wire 面：OriginClaim 结果；本机：'in-process'
  readonly claimOrigin?: string                    // OriginClaim 验证通过时名片 URL 的 origin
  readonly ingress: 'wire' | 'local'
}
```

两处调用（`wire.ts:572`、`index.ts:4531`）都已在手这些事实，只需透传。

### 4.2 谁可以结算（授权链）

对 task id 命中的行 R，结算方 S 合格当且仅当满足以下之一（`chain_role` 记入归档）：

| chain_role | 条件 |
|---|---|
| `target` | `S.caller === R.team`（出站行：我们派给谁；入站行：`R.auth.target`） |
| `target-member` | R.team 是画布队，且 S.caller 是**派发时实际投中的成员**（出站行新增 `deliveredTo`，由 `dispatchPeerCandidate` 的 `target` / 本机 canvas tier 的 agent 句柄填入） |
| `host-face` | S 是目标所在宿主的进程面**代目标结算**：自动回执（§4.3 的 `onBehalfOf` 等于 R.team / `deliveredTo`），且（跨主机时）`S.claimOrigin` 等于 R.peer 的 origin，（本机时）`S.caller === session` 且 `S.ingress === 'local'` |
| `legacy` | R 无 `auth`/`deliveredTo`（旧行）——兼容放行，单独计数 |

其余一律 **`off-chain`**。三条结算路径都过同一判定：

1. 账簿结算 `resolveFromMessage`（`task-ledger.ts:497`）与回声结算 `resolveEcho`（`:586`）；
2. 幂等结果写入 `recordOutcome`（`index.ts:1017`）——**只在本机台账有该 id 的行且判定合格时写**；
   没有行（纯认领侧）时不写，`/a2a/query` 继续如实答 `pending`。这堵住"任何人发一句回执就改写别人
   `queryOutcome` 答案"的口子。`queryOutcome` / `/a2a/query` 的线协议不变。
   **此门控只管"回执钩子"这一个写入方**（`settleAndAnnounce` 里的 `recordOutcome`）。宿主自己在认领侧的
   结果写入不经过回执路径，不受此门控：flood-guard 拒绝时记 `failed`（`flood-guard.ts:95`），以及 #115 新增的
   `refuseNoWait` 对异步拒绝记 `failed`。它们的写入方就是本机，没有"结算方"可比对。
3. CLI 信箱分流（§4.5）。

### 4.3 自动回执的 turn 归属（#61 的直接成因）

授权链只回答"谁有资格结"。#61 里结算方本身有资格（目标宿主的进程面），错在**拿错了 turn 的文本**。
补两条规则：

- **归属锚点 = steer 被消费的事件**，而不是"投递时目标忙不忙"。DSH 把 steer 投给正在运行的 turn 时，
  会在该 turn 的**下一步**消费它，未必排到下一个 turn；所以"目标忙 → 跳过当前 final"会吞掉真正的答复。
  如果之后再没有 final，就会走 flush 超时的占位路径（`index.ts:2178`），**不产出回执**。（评审 @8a961dc P2）
  - 消费点：steer 落成目标 Session 的一条 `user/message` 事件（`src/invariant.ts:15-17`：relay 消息即普通
    `user/message`），正文以 wire 面写入的头部 `[A2A direct] (task <id>)` 开头（`wire.ts:621`）。waiter 记下自己的
    `taskId`，在 `sessionEventsOf(agent)` 中定位**带该头部的那条 `user/message`**，其下标即该 waiter 的
    `consumedAt`。注意：今天的 `probeConsumption`（`index.ts:2041-2048`）只读 `agent.status`，**不看事件**，
    S5 需要新增这一定位，而不是复用探针。
  - 规则：只有 `consumedAt` **之后的第一条** assistant final 归属本任务；消费事件尚未出现时，该 waiter 不被任何
    final 回答（继续挂起，flush 超时语义不变）。
  - `flushFinals`（`:5440`）不再用全体 waiter 的最小 `sinceEvents` 取一条 final、一次答全部（`:5453-5468`），
    而是**逐 waiter** 从各自的 `consumedAt` 往后找第一条 final；找到的答复、未找到的留下。
  - `target_busy` 只保留在 `auth` 里作审计事实，**不参与判定**。
- **绑定**：自动回执的信封追加两个键：`onBehalfOf`（目标句柄）与 `authRef`（入站授权记录的
  `sha256(canonicalJSON(auth)).slice(0,16)`）。`receipt.ts` 的信封是追加式的（`:31-34`，未知键被忽略），
  旧解析器不受影响。接收方用 `onBehalfOf` 判 `host-face`；`authRef` 先只记录，供审计对账。

### 4.4 拒绝的形态与原因码

拒绝 = **不结算**：行保持 pending/dead，`recordOutcome` 不写，消息本身照常作为数据送达（"消息是数据，
不是指令"；结算本来就只是记账，wire 面注释 `wire.ts:568-571`）。同时：

- 写入有界环 `settlementRefusals`（cap 64，随 `tasks.json` 持久化）：
  `{taskId, at, settler:{caller, proof, ingress}, reason, head}`（`head` = 回执首行，`SUMMARY_CAP`）；
- `logger.warn` + 事件 `a2a/receipt-refused`；`/state` 新块 `settlementRefusals`；
- wire 面响应体追加 `settlement: {status: 'refused', reason}`（追加字段；送达结果不变）。

封闭原因码：

| reason | 含义 |
|---|---|
| `settler-off-chain` | 结算方不在 §4.2 授权链上 |
| `settler-unverified` | 跨主机结算方没有可验 OriginClaim（窗口期 legacy），且身份只能靠自报 |
| `on-behalf-mismatch` | 宿主面回执的 `onBehalfOf` 与行的目标/实际投中成员不符 |
| `echo-off-chain` | 内容回声来自链外（回声是弱证据，只接受链上） |

### 4.5 CLI 信箱路径的不一致

wire 面先结算再分流到 CLI 信箱（`wire.ts:572` → `:577`）；本机候选先分流后结算（`index.ts:4516` → `:4531`），
**投进本机 CLI 信箱的回执不结算任何行**。CLI 发出的任务在宿主上只有入站行，所以它的结算恰恰该在这里发生。
本设计把本机候选的结算移到 CLI 分流之前，与 wire 面一致，并在信箱行上记结算判定：#117 的信箱行已带 `seq`，
`taskId?` 与 `settlement?` **直接加在那一行上**，不另立结构。

### 4.6 放到 #61 上会怎样

| 步骤 | 今天 | 本设计 |
|---|---|---|
| 投递 | 入站行只有 `peer=local:review-seat/f62b…` | `auth = {caller: review-seat/f62b…, proof: origin-claim, ingress: wire, via: cli-deposit, admission_rule: cli-deposit, target: dsh/414d2b90, receipt_target: review-seat/f62b…, target_busy: true, …}` |
| 目标在另一条工作线上完成一个 turn | 该 turn 的 final 被当成 bb27ec94 的答复 | 只认 bb27ec94 的 steer 消费事件之后的第一条 final：若该 turn 在消费 steer 之前就结束，它的 final 不归属；若在同一 turn 内消费，消费之后的 final 才是答复 |
| 宿主发 `(auto)` 回执 | 内容无关、`completed` | 内容来自正确 turn，信封带 `onBehalfOf: dsh/414d2b90`、`authRef` |
| 若有别的会话发出 `[A2A receipt] task direct-bb27ec94` | 照样结算 | `settler-off-chain` 拒绝、入环、可见 |
| 事后审计 | 无法回答 | 归档行有 `settledBy:{caller, chain_role}`，入站行有完整授权 |

## 5. 名单或画布变化：只产出"受影响任务"清单（observe）

参照 dsh-superagent：Policy 版本变化时只通知受影响的在跑工单、**不直接撤销**；撤销只在"恢复前重新校验"时发生。
本仓第一阶段只做前半段，且连"通知会话"也不做——**只记录**。

- **触发**：惰性。每次台账入口（与 `sweep` 同一纪律，不用定时器）和每次 `/state` 读取时算当前
  `allowlist_version`；与上次记录不同即触发。另外在已知变更点立即触发一次：`joinedSessions.add/remove`
  （`src/faces/admin.ts:446`/`:460`）、画布 `create/remove/addMember/removeMember/dropMember`
  （`admin.ts:674/689/697`、`wire.ts:226/228`、`index.ts:1243`；或直接挂 `canvasStore.onChange`，
  `canvas-store.ts:92`）、`teamMemberships.add/remove`（`index.ts:3694`/`:3755`）。CLI 户口过期本来就是惰性
  sweep，靠惰性触发覆盖。
- **判定**：对每条带 `auth` 的未结算行（pending 与 dead），用 S1 的纯函数 `a2aCallerAdmission(auth.caller,
  auth.target)` 在**当前**名单上重判（无副作用）：
  - 仍通过且 `basis` 有交集 → 不列出；
  - 仍通过但依据换了 → `basis-changed`；
  - 不再通过 → `would-revoke`，带当前拒绝文本。
  `via: 'peer-org'` 的行每次都重判（其依据不在版本里，§2.3）。
- **产出**：有界环 `affectedTasks`（cap 32，持久化于 `auth-versions.json`），每条
  `{at, from_version, to_version, cause, tasks:[{taskId, direction, caller, target, verdict, reason}]}`；
  `/state` 新块、`logger.info`、事件 `a2a/authorization-affected`。
- **不做**：不取消、不改行状态、不 nudge、不阻止回执。`enforce`（恢复/结算前按当前名单重校验）
  需要单独的属主裁定，不在本 issue 范围。

## 6. 兼容

- **旧台账行**：无 `auth` → 结算判 `legacy`，放行并计数（`/state.settlement.legacy`）。约 24h 排空（§2.5）。
- **混合版本机群（.156 / .157 / .85 各跑不同构建）**：
  - 新增信封键 `onBehalfOf` / `authRef` 是追加式，旧接收方忽略；
  - 新接收方收到旧发送方的 `(auto)` 回执（无 `onBehalfOf`）：跨主机时若 `claimOrigin` 等于 R.peer 的 origin，
    按 `host-face` 兼容放行并标 `compat`；否则 `settler-off-chain`。本机路径不跨版本；
  - OriginClaim 窗口期内无信封的跨主机结算方 → `settler-unverified`。
  - 因此**判定开关分三档** `settlementAuth: 'off' | 'observe' | 'enforce'`（与 `gateAgentLessCalls` 的
    `audit`/`refuse` 同风格）。首个版本默认 `observe`：照常结算，但把本应拒绝的记为 `would-refuse`
    （同一个环、同一套原因码）。三台主机都升到含 S4 的版本、且验证器判据连续达标后，才另行裁定切 `enforce`。
- **`/state` 与面板**：全部是追加字段/新块，旧面板忽略。
- **`queryOutcome` / `idempotency-store`**：线协议、指纹、`ClaimVerdict` 词表都不变；唯一的行为变化是
  `recordOutcome` 的回执钩子在 `enforce` 下多一道判定（§4.2 第 2 点），`observe` 下照写并计 `would-refuse`。
- **`tests/`**：
  - 纯台账单测（`tests/unit/task-ledger.spec.ts`、`task-cancel.spec.ts`、`gh86-eviction.spec.ts`、
    `receipt-envelope-v2.spec.ts`、`gh31-state-face.spec.ts`、`join-gate-fix12.spec.ts`）与 wire 测试
    （`tests/wire/task-abandon.spec.ts`）：`resolveFromMessage(message)` 保持原签名（`settler` 可选），
    默认 `observe` 下行为不变，应全部原样通过；
  - 新增：黄金向量（版本哈希、`authRef`）、`restore` 往返与坏块丢弃、每条 `admission_rule` 一例、
    #61 形态回归（目标忙 → 跳过首个 final）、`enforce` 下各原因码、affected-tasks 不改行状态。
- **架构锚点** `docs/arch/a2a-architecture.anchors.json`：`sources` 钉了 `src/index.ts`、`src/faces/wire.ts`、
  `src/task-ledger.ts`、`src/flood-guard.ts`、`src/cli-deposit.ts` 的 sha256（当前与 4cf7c7e 一致），
  并有行锚 `index.ts:2660`（b5，`sameZoneSharedTeamRefusal`）、`wire.ts:336/415/567`（c4/c2/f6）、
  `task-ledger.ts:623`（d10，`trimOwed`）、`cli-deposit.ts:22`（d9）。**每个改到这些文件的切片都要在同一 PR
  里重锚**（`scripts/verify-architecture.mjs` 摘要不符即退出 1）。S1 新增的 `src/task-auth.ts` 建议在 S4
  合入后补一个锚格（结算判定入口），不单独开 PR。

## 7. 实现切片（有序，各自可独立合入）

| # | 切片 | 档位 | 完成判据 |
|---|---|---|---|
| S1 | `src/task-auth.ts` 纯模块：类型、封闭枚举、`allowlistVersion()`；准入三函数改为返回结构化判定的 `a2aCallerAdmission`，旧函数做包装 | 中 | 现有拒绝文本逐字不变（全量测试绿）；版本哈希黄金向量；§2.2 每条规则一例单测；锚点重锚、`verify-architecture` 通过 |
| S2 | 入站授权记录：wire 面在出生时挂 `auth`（本机候选移入 S4，`auth-versions.json` 移入 S6）；台账持久化/恢复/归档带 `auth`；`/state` 投影 | **高**（台账） | 升级后新生入站行 `auth` 覆盖率 100%；`restore` 往返与坏块丢弃测试；旧 `tasks.json` 原样加载 |
| S3 | 出站 `sender`：`trackOwedTask` 三处调用传入；`/state`、`a2a_tasks`、CLI `a2a tasks` 显示 | **高**（台账） | 升级后新生出站行 `sender` 覆盖率 100%；团队验证器 L9 改按 `sender.kind:sender.id`/`auth.caller` 分桶，**"home" 桶 = 0**（`legacy` 桶单列，24h 后为 0） |
| S4 | 结算判定（`observe` 默认）：`settleAndAnnounce(message, settler)`；授权链；`settledBy` 入归档；`settlementRefusals` 环；`recordOutcome` 门控；本机 CLI 信箱路径结算顺序对齐 | **高**（协议+台账） | 各原因码单测；`observe` 下现有测试零改动通过；**评审席团队验证器新判据："结算方不在授权链上的结算数 = 0"**（数据源：`/state` 归档行 `settledBy.chain_role === 'off-chain'` 计数 + `settlementRefusals` 中 `would-refuse` 计数，两者均为 0 才算通过） |
| S5 | 自动回执 turn 归属与绑定：waiter 按 steer 头部定位自己的消费事件（`consumedAt`）；`flushFinals` 逐 waiter 从 `consumedAt` 之后取第一条 final；信封 `onBehalfOf`/`authRef`；`target_busy` 仅审计 | **高**（协议） | 两条回归：**(a)** 目标正忙、steer 在同一 turn 内被消费 → 该 turn 的 final 产出回执；**(b)** 目标正忙、steer 到下一 turn 才被消费 → 当前 turn 的 final 不产出回执，下一 turn 的 final 产出。另：新键对旧解析器无影响（`receipt-envelope-v2.spec.ts` 扩例） |
| S6 | 受影响任务清单（observe）：惰性 + 变更点触发；重判；`affectedTasks` 环 | 中 | 移除画布成员 → 出现 `would-revoke` 条目；断言**无任何行状态变化**；版本未变时零产出 |
| S7 | `settlementAuth` 默认切 `enforce` | **高**，需属主裁定 | 三台主机均 ≥ S4/S5 版本；S4 判据连续 7 天为 0；`legacy` 计数为 0 |

S1 与 S3 互不依赖、可并行；S2 依赖 S1；S4 依赖 S2+S3；S5 只依赖 S2（`onBehalfOf`/`authRef` 取自 `auth`），可与 S4 并行；
S6 依赖 S1+S2。S3/S4 的 CLI 部分与 #112/#113 同改 `cli/a2a.mjs`，排在协调席的 #112/#113 以及 #115、#117 合入之后。
