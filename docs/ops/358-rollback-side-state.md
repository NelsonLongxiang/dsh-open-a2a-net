# #358③：账本回滚与内存附带状态核对清单

## 范围和结论状态

核对基线：master 4306979（包含 #354、#351、#356、#362、#355/#358②、#357）。本次只提交核对材料及 status 工具测试；**不修改运行行为**。清单是代码审阅和工程故障测试的索引，不是业务验证器 spec-run，也不是“全部附带状态已随账本回滚”的声明。

**结论待非作者逐项确认。** 跨组件提交边界仍有需另案裁定的审查项，详细材料已经指定协作链私交评审席；这里不展开未处置场景或故障注入步骤。不能据本清单、或 status 测试通过，关闭 #358 整单。需要改变行为的项先由评审席判档、另行授权实现；本低档 PR 不代决。

术语：
- **已围栏**：现有代码把动作放在成功提交之后，或失败会保留原回调/欠账。无需把独立组件机械恢复到旧内存快照。
- **保守降级**：观察值或通知可能暂时陈旧/延迟/重复，但不据此伪造任务完成；边界必须明示。
- **独立状态**：有自己的寿命/权威源，不应因账本提交失败撤销真实发生的外部动作。
- **另案核对**：不能证明整体一致，尚未授权行为修复；不写成“无需修复”。

## 一、回滚的实际边界

[TaskLedger.persist:843–864](../../src/task-ledger.ts#L843-L864) 用最近成功的 committed 快照恢复 tasks、archived、refusals/refusalsTotal、conservation counters、reminders、reminderSessions、deliveries 及 deliveryRestoreError。writeFailure 留作安全诊断，不回滚为健康；下一次成功提交清除它。原异常继续抛出。

这不是跨 Agent inbox、HTTP、幂等存储、缓存与计时器的事务。其他组件不在 snapshot 中，不能把“账本已回滚”解释为“网络请求或会话输入未发生”。[snapshot:868–883](../../src/task-ledger.ts#L868-L883) 是本地事务范围的唯一清单。

## 二、逐项清单

| 项目 / 源码证据 | 与账本回滚后的关系、可能后果 | 当前处理与本轮处置 |
|---|---|---|
| final waiter、pendingFinals；[注册:2296–2305](../../src/index.ts#L2296-L2305)、[flush:4488–4564](../../src/index.ts#L4488-L4564) | 回调删除/重入与 commit 有时序关系；失败后若丢回调，会漏发正式回执。消费 floor/scannedTo/consumedAt 是会话日志事实，不等于已答提交。 | **已围栏（已出生行的答复提交）**：逐个移除再调用，answerFinalSafely 捕获同步异常，失败把原 waiter 放回，保留原消费轮；成功才清 timeout。参见故障用例 A。birth 边界与已存在回调的关系列为下方另案核对，不能从 A 推广为所有注册路径。 |
| 同步 HTTP waiter / Promise resolve；[routeIntoAgentFor:2372–2415](../../src/index.ts#L2372-L2415) | 已发出的会话输入与 HTTP 回答不是同一提交；回调异常可能使两种观察不同。 | **部分已围栏 / 另案核对**：投递入口异常会清该 waiter 与 timer，失败答复明确返回；对外语义的跨组件边界已私报评审，不在本 PR 扩实现。不把此项归为全面一致。 |
| idempotencyStore 的 claim / fingerprint / outcome；[claim:204–229](../../src/idempotency-store.ts#L204-L229)、[outcome:272–284](../../src/idempotency-store.ts#L272-L284) | 幂等键先于会话投递建立；它描述尝试身份，不等于任务账本行。保留键可阻止重复执行；完成 outcome 则会影响查询对外答复。 | **已围栏（正式结算）**：[settleAndAnnounce:764–800](../../src/index.ts#L764-L800) 先提交结算，再记 outcome/发事件；[settleOwnInbound:823–833](../../src/index.ts#L823-L833) 同序。**独立降级**：[幂等写盘:373–384](../../src/idempotency-store.ts#L373-L384) 允许 memory-only，不提供双存储原子性或跨重启无限去重保证。任务出生/失败结果的整体协调列另案核对，不能靠删除所有 claim“修复”。 |
| 正式回执的 uncompleted claim / completed replay；[wire:689–694](../../src/faces/wire.ts#L689-L694)、[失败围栏:793–804](../../src/faces/wire.ts#L793-L804)、[release:265–270](../../src/idempotency-store.ts#L265-L270) | 结算写失败后若把 transport 当已完成，会漏结；无条件删 completed 键又可能重复投递。 | **已围栏**：失败只释放相同 fingerprint 且未完成的尝试；已完成重放需要当前校验与冻结关联授权，不重新送入会话。参见故障用例 B；本清单不扩大该授权。 |
| nudgeBudget / nudge timer；[2101–2165](../../src/index.ts#L2101-L2165) | 运行时提醒预算不是 receipt debt。账本失败后保留/消耗预算可能延后提醒，但不能当已答或释放执行名额。 | **独立状态 / 保守降级**：定时回调检查当前 isPending；真实 nudge 只唤醒，先花预算不证明消费；缺接口/失败有 #355 计数。无需随账本回滚重置预算，重置反会扩大提醒次数。未对所有定时器寿命作新的资源合规声明。 |
| idleReminders.active；[18–50](../../src/reconciliation-reminders.ts#L18-L50) | 它是同步重入锁。失败后若不删会永久阻止同会话提醒。 | **已围栏**：scan 对每会话 add，finally delete；无论 persist / followup / notify 异常均清。无需账本事务参与。参见用例 C 的重入/失败恢复。 |
| idleReminders.failedUntil；[20–50](../../src/reconciliation-reminders.ts#L20-L50) | 写失败后留在内存会推迟下一次提醒；与旧 reminder snapshot 不完全一致，但代表实际失败退避。 | **保守降级**：保留最小失败冷却，避免不可写盘上重复轰击；不记成功、不改任务终态。无需回滚；重启不保证保留此运行时冷却，持久化 reminderSessions 单独管理。 |
| idleReminders.nudgeAt / diagnostics；[22–33](../../src/reconciliation-reminders.ts#L22-L33)、[54–56](../../src/reconciliation-reminders.ts#L54-L56) | nudge 已尝试时节流与错误诊断可比账本旧；回滚它们会抹去失败痕迹或增发提示。 | **独立观察**：不参与任务授权/支付；noteNudge 与 scan 调用各有原调度语义，不因账本回滚伪记成功。 |
| remind / notify 的 reservation 和实际 followup；[76–90](../../src/reconciliation-reminders.ts#L76-L90)、[102–108](../../src/reconciliation-reminders.ts#L102-L108) | 先存 reservation 再发送，发送后再存 delivered/notified；最后一次观察提交失败不能“收回”已发提示。可能有观察不确定或后续重复提醒，不是任务重复执行的承诺。 | **保守降级**：reserve 写失败不发送；发送后的失败进入 failedUntil/诊断，保留最近成功的 reservation，不把提醒当 ack/settlement。notify 的 attempted 标记不是 notified 证明，不能据此声称送达。无需在本低档把已经发出的提醒逆操作；不宣称 exactly-once 提醒。 |
| followupDelivery、Agent inbox、taint；[15–37](../../src/followup-delivery.ts#L15-L37) | reserve 前失败未投递；Agent 接纳后无法靠账本回滚撤销真实输入，claim 提交失败也不能说 Agent 尚未消费。 | **已围栏 / 保守降级**：先原子 MessageId 对应再送；post-accept 状态写失败保留已有 reserved/unknown，拒盲重发；claim catch 不击穿宿主。taint 保守保留，不因账本回滚“洗白”。deliveries 本身属于 ledger snapshot，不另建平行权威。参见用例 D。业务任务出生协调仍另案核对。 |
| followup withdraw / stop notice；[39–61](../../src/followup-delivery.ts#L39-L61)、[2006–2024](../../src/index.ts#L2006-L2024) | 已执行的 queue remove / steer 不可能随观察写盘回滚；把观察回滚解释成从未撤回会造成重复控制尝试。 | **已围栏（终态优先）/ 保守观察**：取消终态先提交，撤回失败仍发 stop notice；withdrawalResult 只记录实际观察，写失败不能复活已取消债。此为已裁既定边界，不在本 PR 改写。 |
| receipt 重试 closure、transport id、wait/effect；[2220–2281](../../src/index.ts#L2220-L2281)、[receipt-retry:3–29](../../src/receipt-retry.ts#L3-L29) | caller 结算失败时重试状态仍在；若当失败结清就会漏回执。已发 receipt 的成功与本地提交也可能分离。 | **已围栏（已有 inbound 行）**：每轮查 isPending，固定正文/id，暂时失败保债，最多六次补发；正常 wait 到期注销 effect，卸载清 timer。重启不恢复运行时定时器是已披露限制。失败后留 retry 是恢复机制，不应回滚成“已经投递”。参见用例 B、E。 |
| cardCache / cardCacheInFlight / signedDiscoveryPeers；[2471–2508](../../src/index.ts#L2471-L2508)、[3264–3299](../../src/index.ts#L3264-L3299) | 缓存与网络时序独立；可以比账本新/旧，但不是某任务已答证明。把它回滚到旧 key 反会制造更陈旧输入。 | **独立状态**：不回滚发现缓存。当前入站要求 freshCard、完成校验后才准入；出生时冻结 peerKey 归账本管理。缓存与成员变化另有权限规则，不据本审计授予例外。 |
| localBirths；[3501–3508](../../src/index.ts#L3501-L3508)、[3753–3759](../../src/index.ts#L3753-L3759)、[3994](../../src/index.ts#L3994)、[4190](../../src/index.ts#L4190) | 临时拼装的出生事实不在 ledger snapshot；与已完成本地投递的提交边界不同。 | **另案核对**：不能证明删除/移交暂存事实与账本提交在所有失败窗口中原子一致；细节已私报评审请求判档，本 PR 不修行为、不标“无需处理”。不得靠重投原工作来补回这张表。 |
| ForwardBirths / in-flight birth barrier；[direct-forward:18–36](../../src/direct-forward.ts#L18-L36)、[81–102](../../src/direct-forward.ts#L81-L102) | barrier 只表示转发出生操作尚在进行，不保证 birth 成功。过早把 release 解释成任务已建会错误放行。 | **已围栏（barrier）/ 另案核对（跨提交）**：finally release，等待有上限，放行仍检查实际行/冻结 key；不因等待结束凭空授权。跨组件出生提交边界已另报，不将 barrier 正确性扩称整个转发事务正确。 |
| SyncAnswered / CLI mailbox duplicate fold；[wire:190–209](../../src/faces/wire.ts#L190-L209)、[847–849](../../src/faces/wire.ts#L847-L849) | 去重折叠标记与完整 HTTP reply 事实有关，不是 receipt debt；回滚账本不应声称已经发出的 final 未到达。 | **独立呈现状态**：仅实际完成 reply 且 finish 后 note、匹配 task/CLI/member 一次 take；完整 mail 仍保留，不据折叠标记结算。不得在失败 birth 审查中把它当恢复账本依据。 |
| idempotency query outcome / a2a receipt-resolved 事件；[748–804](../../src/index.ts#L748-L804) | 外部消费者若在账本失败前收到 completed，会误判支付。 | **已围栏**：账本 resolve 成功后再 outcome/emit，失败不发；监听者异常与外部异步消费者由各自边界负责，不能反向撤回已提交账本。参见用例 A/B。 |
| inFlight/activity、nudgeObservations、writeFailure、receiptWarnAt；[nudge-observability](../../src/nudge-observability.ts)、[status projection:503–568](../../src/tools/info.ts#L503-L568) | 真实请求/失败的观察可以继续增长，不与 ledger 计数守恒一一对应；若回滚会隐藏发生过的失败。 | **独立观察**：不恢复为旧快照。不能由 activity ok、queued 计数、已答时间推出正式回执到达；status 显示的是来源状态而非并入业务交易。 |

## 三、可复核的现有工程用例

- **A：提交失败后 waiter 保留、后续 idle 重试，outcome 不先记完成**：[ledger-write-failure](../../tests/mesh/ledger-write-failure.spec.ts#L16-L126)。
- **B：正式 receipt 失败恢复与确认丢失**：[gh357-receipt-retry](../../tests/mesh/gh357-receipt-retry.spec.ts)，含真实写失败、固定身份重发、无重复投递、预算耗尽/永久对照。
- **C：提醒 reservation、重入和失败恢复**：[gh351-reminder-state](../../tests/unit/gh351-reminder-state.spec.ts#L17-L39)、[idle reminder 真实写失败](../../tests/mesh/gh351-idle-reminders.spec.ts#L121-L123)。
- **D：投递映射先提交、claim 回滚和不确定接纳拒盲重放**：[gh356-followup-delivery](../../tests/unit/gh356-followup-delivery.spec.ts#L37-L78)。
- **E：wait 正常完成/卸载无 effect 或 timer 残留**：[receipt-retry 单测](../../tests/unit/receipt-retry.spec.ts#L6-L14)。
- 基础原子提交/rename 重试、失败恢复与守恒：[task-ledger-persistence](../../tests/unit/task-ledger-persistence.spec.ts)。

这些用例各自有边界，不能以一组已有绿测试证明所有表格行在所有故障时序一致；尤其“已有行的答复提交”不等于“投递与任务出生跨组件提交”。另案核对项未获得非作者关闭前，维持待确认。

## 四、本 PR 的 status 工具测试补缺

[status-observability](../../tests/mesh/status-observability.spec.ts) 覆盖 scoped=false / true 两条 a2a_status execute 分支：

1. 实际 ledger 失败态的完整 ok/lastError 与 state/CLI 观察一致，恢复成功提交后变回 ok=true。
2. 实际 nudge queued / unavailable / failed 三种非零结果与初始全零状态，包含 lastAt 与相应安全 lastError；不是仅测 /state，也不是只测 CLI。
3. 四个固定值替换反向突变：ledger 固定健康、固定失败；nudge 固定零、固定非零。分别令两条 scope 分支失败，均恢复。

本次不增加调度，不触发生产操作；故障注入只在隔离工程测试中，生产源码无改动。最终完整默认门禁 root1648passed/8skip、layout4、Nexus332、临时根entries0，真实exit0；此为工程回归证据，不是业务spec-run结论。首轮未改动的旧用例出现端口占用冲突，原样隔离通过后完整重跑通过，未改旧断言/预算/worker/skip。非作者需逐项核对清单，并对另案项明确去向后再认定 #358③ 的完成状态。
