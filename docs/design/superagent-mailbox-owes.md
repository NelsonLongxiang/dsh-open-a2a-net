# p1-mailbox-owes：信箱欠回执声明（设计稿第 1.3 版：重发原样回已投递）

依据：属主 2026-11-07 的裁定 S33。CLI 身份在签名名片里声明「接活信箱、欠回执」；家宿主对它的投递回「已投递」，不回终态；调用方记欠账，并受 3 笔名额和 -32009 背压约束。只有 superagent Source 身份做这个声明。经宿主转发的路径一并改。档位为高档，作为 p3 的前置，不挡 p2b。要修复的问题是 S32。

## 上下文

next/0.8（f96cd46）上的现状，核对过代码：

- **投递即终态**（S29）：
  - 向 CLI 户口投递时，`src/faces/wire.ts:820–842` 写入信箱，回复 `task_status: TASK_STATE_COMPLETED` 加 `receipt: 'mailbox'`，并记录幂等结局 `completed`。
  - 进程内路径 `src/index.ts:3917–3930` 做法相同，按 `localSettler` 结算。
- **调用方不记欠账**：
  - `trackOwedTask`（`src/index.ts:3558`）遇到「COMPLETED 且 receipt 为 mailbox」直接返回。
  - 转发路径 `src/direct-forward.ts:95` 对这种结果改记 `trackReceiptless`，即只留可见行，不算欠账。
- **不受背压**（S30）：
  - `queueFullRefusal(rows, team, message, cap, mailbox, ownTask)`（`src/queue-guard.ts:43`）在 `mailbox` 为真时直接放行。
  - 名额只数家宿主账本里 `direction: 'inbound'`、`receiptExpected !== false`、尚未答复的行（`queuedFor`，第 36 行）。信箱投递不调用 `trackInbound`，所以名额总是 0。
- **挤出不留账**（S31）：信箱上限 64 行（`MAILBOX_CAP`）。超出的行被挤掉，只给 `dropped` 计数加一，不通知调用方。
- **名片能力**：CLI 的 `publish` 签发的名片能力是 `{ route: true, async: true }`（`cli/a2a.mjs:686`）。签名覆盖 capabilities（`src/card.ts`）。

后果（S32）：坐席派给 superagent 的请求，调用方账本里没有欠账，#351 的空闲提醒不会触发，也不受名额约束。信箱挤出时，两边都不留账。这违背「强制对账」和「拥堵即背压」两条原则。

## 决策

### D-1 声明：签名名片能力 `owes: true`
- `a2a-net publish --owes` 签发的名片 capabilities 为 `{ route: true, async: true, owes: true }`。字段在签名覆盖范围内，宿主不信任未签名的声明。
- 这个声明只由 superagent Source 身份做：a2a-watch 的 `renewDeposit` 改为执行 `publish --owes`。其他 CLI 身份不变。
- 声明跟随户口：重新 publish 时不带 `--owes`，就撤回声明。撤回之前已经投递、已经记账的行照常等回执，或者等过期。

### D-2 家宿主：声明了的户口，投递回「已投递」并记入站行
在 wire 面（`wire.ts:820` 一带）和进程内面（`index.ts:3917` 一带），当 `cliDeposits.get(team)?.owes === true` 时：
- 信箱照常写入，信箱行的格式不变（采集器和 a2a-watch 都不受影响）。
- 调用 `taskLedger.trackInbound(taskId, team, receiptTarget, contextId, true, brief, …)`，记一行欠回执的入站。
- 回复改为 `task_status: TASK_STATE_DELIVERED`，仍带 `receipt: 'mailbox'`。幂等结局记 `delivered`，不记 `completed`：重发同一个 id 时读到的是「已投递、待回执」。
- 名额守卫对它生效：调用 `queueFullRefusal(..., mailbox = !owes, ...)`。达到上限 3 笔时，用现有的 `-32009`（`WIRE_ERROR_QUEUE_FULL`）拒绝，什么都不投。
- 回执自身（`[A2A receipt] …`，属于 ownTask）照常放行。
- 没有声明的户口，行为完全不变。

### D-3 结清：户口的正式回执结清它的入站行
- CLI `receipt <task_id>` 经家宿主 `/a2a/direct` 发出时，家宿主按 `receipt-<id>` 解析出 task id。如果本账本里有这个户口对应的入站行，就记 `answeredAt`，名额随之释放。这和会话的回执释放名额的方式相同。
- 回执继续送到调用方。调用方按现有的结算规则结清欠账，结算方须是该任务的目标，也就是这个户口。

### D-4 调用方：「已投递」即记欠账
- `trackOwedTask` 原有的规则是「DELIVERED 记欠账」，对它直接成立，不用改。
- 转发路径 `direct-forward.ts:95`：结果是 `DELIVERED` 加 `receipt: 'mailbox'` 时，走 `trackOwedTask`，不走 `trackReceiptless`。

### D-5 挤出：欠回执的行被挤掉时
- 家宿主把对应的入站行标记为失败，原因写 `mailbox-evicted`，并释放名额；L14 的 evictions 计数里也加上它。
- 调用方的欠账留着，由 #351 的空闲提醒追。这一版不新增「挤出通知」报文。理由是：有背压以后，3 笔名额会先把这条路拦住，欠回执的户口不可能堆到 64 行。真正可能被挤出的，只剩没有声明 owes 的普通投递。

### D-6 兼容
- **老调用方（0.8 以前）** 收到 `DELIVERED`，按它们自己的老规则同样记欠账，行为自洽。
- **老家宿主** 不认 `owes`，照旧回终态，和今天一样。
- **老 CLI** 不带 `--owes`，和今天一样。

## v1.1 补充（全局 2026-11-07 design_pass 附带的 a–e，以及开工核对中的发现）

- **a 结清方核验**：家宿主在 wire 面结算回执之后，如果本次投递的调用方本身是本宿主上的 CLI 户口（`cliDeposits.get(caller)` 存在），并且消息是 `[A2A receipt] task <id>`，就调用 `taskLedger.markAnswered(id, caller)`。`markAnswered`（task-ledger.ts:280）本来就要求 `(row.deliveredTo ?? row.team) === target`，所以只有该户口自己发出的回执能把它名下的入站行标为已答。其他 CLI 即使知道 task id，也会被拒（返回 false），名额不释放。
- **b 重发幂等（v1.3 按全局评审改）**：wire 面在进入信箱分支之前，先用 `idempotencyStore.claim` 认领 task id。同指纹重发时，如果该户口声明了 owes，而且这个 task id 名下仍有 pending 的入站行，就原样回复 `TASK_STATE_DELIVERED` 加 `receipt: 'mailbox'`（context 取入站行上的那个），不再返回 409 replay。不会再写一行信箱，不会再记一行入站，也不会再占一笔名额。
  - 这样，首个应答丢失的调用方，在重试时也能把这笔欠账记上。转发路径的 `ledger.track` 按 task id 去重，所以调用方那边仍只有一笔欠账。
  - 不回「已投递」的情况：行已结清（归档）、已到期（dead）、指纹不同（conflict），或者户口没有声明 owes。这些仍是原来的 409。
  - 进程内面的 task id 由路由方现生成，不存在重发。
- **c 到期释放**：用的是现有的懒式死信清扫（task-ledger.ts:665）。pending 行超过 `taskStaleTtlMs`（`TASK_STALE_TTL_MS`）后转为 dead。`queuedFor` 只数 pending 的行，所以名额自动回来。调用方的欠账行用的是同一个 TTL，到期时间对齐。
- **d 重启持久**：
  - owes 不单独存，每次都从户口里保存的、已经验过签的 cardJson 读出（`capabilities.owes === true`）。cardJson 原样持久化在 deposits 快照里，重启后同样生效。
  - 欠回执的入站行在任务账本里，账本本身就会持久化。
  - 重启后既不会回到终态语义，名额也不会清零。
- **e 名额单位**：`queuedFor(rows, team)` 按目标 team 统计，也就是按户口统计，不分调用方，所有调用方合起来最多 `targetQueueCap`（默认 3）笔。这对 superagent 是有意为之的整体背压，p3 再评估要不要放宽。
- **挤出（D-5）的落点**：`CliDepositStore.mail()` 返回这一次被挤掉的行。家宿主对其中带 task_id、并且名下有 pending 入站行的，调用新增的 `taskLedger.evictInbound(taskId, team)`：归档时 `endedBy: 'evicted'`、summary 写 `mailbox-evicted`，名额随之释放。这和 `trimOwed` 用的是同一个归档终点，ledger-conservation 的 `archivedByEnd.evicted` 会计入它，即 L14。
- **转发路径（D-4）**：`direct-forward.ts:95` 只有「COMPLETED 且（replyFinal、native-teams 或 receipt 为 mailbox）」或者「receipt 为 none」时才记 receiptless。家宿主改回 DELIVERED 之后，这条路径自然落到 `d.ledger.track`，也就是记欠账，不需要改代码。用 mesh 用例和反向变异把它钉住。
- **发现（不在本 PR 范围）**：进程内面向同宿主 CLI 信箱投递时，回 `TASK_STATE_COMPLETED`，但不带 `receipt: 'mailbox'`（index.ts:3932）。按 `trackOwedTask` 的条件，同宿主会话调用方在今天就已经给普通（未声明）信箱记了欠账，这和 wire 面的终态语义不一致。本 PR 不改未声明户口的行为，只记下来，另外立项。

## v1.2 实现修订（实现与测试中发现，交全局随 PR 评审）

- **a 的落点改了**：不再另加 markAnswered 钩子。原因是户口自己的回执经家宿主时，`settleAndAnnounce → resolveFromMessage` 本来就会把它名下的行按 receipt 结清并归档，observe 和 enforce 两种模式下都是这样，变异实测过。v1.1 的钩子成了死代码，已删除。
  - 守卫加在 `settleAndAnnounce` 开头：回执头点名的是本宿主上属于 CLI 句柄（`CLI_HANDLE_RE`）的行（入站行，或 `peer: 'local'` 的同宿主行），而发件人不是该句柄时，直接不结算，也不做回显判定、不写结局。
  - 守卫按「行的 team 是 CLI 句柄」判断，不按「户口当前是否声明了 owes」判断。这样户口过期或被撤销之后，欠它的行也不会被外人结清。
- **同宿主（进程内）面不另记入站行**：同一台宿主上，调用方和目标共用一本账本，一个 task id 只有一行。调用方的欠账行（`peer: 'local'`，由 trackOwedTask 记）本身就被 `queuedFor` 计入名额，所以进程内面只回 DELIVERED 加 receipt:'mailbox'，不再 trackInbound。名额上限和 -32009 对同宿主调用方同样生效，有 mesh 用例。
- **挤出（D-5）覆盖两种行**：远程调用方对应的入站行，以及同宿主调用方的 local 行。对同宿主来说，这一行就是调用方的欠账本身：归档为 evicted 之后，在调用方自己的宿主上可以看到（结束原因为 evicted），但 #351 不会再追。远程调用方的欠账留在它自己的宿主上，照常由 #351 去追。
- **一处收紧，影响未声明的户口，请全局裁定**：上述守卫也作用于今天已经存在的「同宿主会话 → 未声明的 CLI 信箱」的 local 行（见 v1.1 的发现）。改过之后，只有该 CLI 自己的回执能结清这些行，而原先在 observe 模式下任何回执头都能结清。全量测试没有变化，1812 例通过。如果要严格保持「未声明户口行为不变」，可以把守卫再限定为入站行，或者限定为声明了 owes 的户口，代价是户口过期后外人能结清欠它的行。我建议保留收紧。

## 后果

- **正面**：派给 superagent 的请求进入强制对账，并受背压约束（修复 S32）。superagent 的回执能真正结清调用方的欠账。
- **负面**：
  - superagent 在冒烟和影子期间不发回执（observe 模式）。所以声明了 owes 的户口，会在调用方那边留下要等过期的欠账。因此 **p2b 冒烟和 7 天影子期都不启用 `--owes`**，a2a-watch 的变更随 p3 上线。
  - 另外，影子期的流量最多只有 3 笔会被放进来。
- **推迟项**：
  - 挤出通知报文（D-5）。
  - 撤回 owes 时未结行的处置（目前沿用过期机制）。
  - 多家宿主（户口迁家）时入站行的归属。
  - a2a-watch 启用 `--owes` 的时间，与 p3 的回发一并定。

## 测试计划（实现 PR）
- **单元**：名片签名覆盖 owes；`publish --owes` 的参数；`queueFullRefusal` 在 owes 时生效。
- **mesh**：
  - 会话派给声明了 owes 的户口：调用方记欠账；第 4 笔得 -32009；户口发 `receipt` 后名额释放、欠账结清。
  - 没有声明的户口，行为不变。
  - 转发路径同样记欠账。
  - 欠回执的行被挤出时，入站行标为 `mailbox-evicted`。
  - 老调用方的兼容，用不认 `receipt: 'mailbox'` 的结果形状模拟。
- 反向变异覆盖 D-1 到 D-5 每一条。
