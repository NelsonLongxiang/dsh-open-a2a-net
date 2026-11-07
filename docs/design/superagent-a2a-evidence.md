# superagent-a2a-spec-r7

_generated 2026-11-07 08:16:25 UTC by ygl-trees_

**研究问题**：superagent × a2a-net 接入规格与计划（p2 设计稿第 2 版：按全局设计评审改稿，S20，单次生产）

## 摘要

共 39 条断言（38 条已证实、0 条存争议、1 条待验证），基于 104 条证据、47 个来源。

## 主要结论

1. ✓ S1 定位：a2a-net 作为 superagent 的跨节点基础设施层接入，只走两个已有端口：a2a Source（入站请求）与 A2A Executor（出站派工），不改 superagent 领域模型。  [2][1]  
   _置信度 B，状态 supported_
2. ✓ S2 读取面：a2a Source 需要调用方自持游标、可重放的只读拉取。现有 inbox --new 用本机共享游标，且主机信箱只留 64 行，所以必须新增 inbox --after <seq> --json，并显式报告被挤出的未读数；被挤出的消息无法恢复，只能如实暴露。  [2][13][4][14]  
   _置信度 A，状态 supported_
3. ✓ S3 回发面：A2A task id 由 Outbox message.id 确定性派生；发送结果按 route --json 的 class 字段映射为 sent / gone / retry，判定只看结构化字段（#381）。gone 只用于原样重发注定失败的情况：-32001（报文过大）、-32002（同一 id 对应不同报文）、重放时 prior failed。目标身份不存在、名片已撤销、身份冲突以及其余错误都归 retry：用同一 task id 有界重试，超过消费方上限才转 dropped 并留下记录。将来主机若为这些情况补上专用错误码，再单独评估是否改判 gone。  [5][15][10][28][31][18][30][3]  
   _置信度 A，状态 supported_
4. ✓ S4 信任：只有入站校验通过（bound）的调用方身份才能成为 Trigger actor；未验证或校验失败的消息在 scope 阶段记为 filtered，只当数据。这正好回答了 superagent 列为开放问题的 Trust。  [6][19]  
   _置信度 A，状态 supported_
5. ✓ S5 账号：a2a Source 与 A2A Executor 使用专用的 a2a-net CLI 身份（独立 A2A_CLI_HOME），等同 superagent 的专用 agent CLI 包装，不复用任何席位或属主身份。  [12]  
   _置信度 B，状态 supported_
6. ✓ S6 执行器映射：Assignment 启动对应带固定 task id 的派单；Input 交付对应在同一 context 里追加；inputsDelivered/inputsRead 对应 delivered/consumed 观察；Report 只来自正式回执，不从自由文本推断“等人”或“完成”。  [1][11][20][22]  
   _置信度 B，状态 supported_
7. ✓ S7 背压：目标每方 3 笔欠账上限不放宽；执行器派单遇到 queue-full 时延后（Later），不换 id，也不改投其他目标。  [21][16]  
   _置信度 A，状态 supported_
8. ✓ S8 角色分离：路由席只转原始请求和路由事实；反复出现的约束沉淀为常设规范；执行席自判范围、自判跟进，超出范围的交还。  [8][9][7]  
   _置信度 B，状态 supported_
9. ✓ S9 契约不变量：不新增任务状态，不读到即确认，不自动 ack，欠账只由正式回执结清；新增的只能是观察字段。consumed 只是主机层面的观察，不代表会话做出了承诺，也不能结清欠账。  [27][17][11][16]  
   _置信度 A，状态 supported_
10. ✓ S10 可靠性：所有外发先存后发、有界退避，与 #357 回执退避一致；dropped 只在目标永久不可达时出现，并留记录。  [10][3]  
   _置信度 B，状态 supported_
11. ✓ S11 版本线：开发前以 v0.7.0 为基线，不新打 tag；superagent 接入开发在 next/0.8 分支进行。  [23]  
   _置信度 A，状态 supported_
12. ✓ S12 执行方式：所有工作都不派发，由评审席独自开发完成；非自我评审由全局生产评估在 exact head 上进行（全局 2026-11-06 裁定）。  [24]  
   _置信度 A，状态 supported_
13. ✓ S13 属主裁定（采用评审席建议）：① 代码放在本仓 next/0.8，做成独立导出的插件包，不 fork superagent；② 校验通过、且在 allowed 名单内的 Agent 调用方给 explicit 强度；③ attention 走“正式回执 + 同 context 新任务答复”；④ 路由席暂不拆出。  [25]  
   _置信度 A，状态 supported_
14. ✓ S14 回执观察字段：正式回执的 v2 信封附带观察字段 disposition，取值只有 "result" 和 "attention"，其他值丢弃。不沿用 outcome 这个名字，因为信封已有 outcome 表示工作如何结束；新键会被旧主机忽略。attention 回执不写 outcome，会结清原任务欠账，但不代表工作完成，调用方按 disposition 字段区分，不解析正文；后续工作作为同一 context 的新任务另派，一个任务只有一张回执（回执走固定 task id receipt-<task_id>）。这个字段不新增任务状态，纳入 p1-receipt-cmd 的范围，属于回执语义变化，须全局 PASS 并报属主知会。  [33][17][34][11][35][26]  
   _置信度 A，状态 supported_
15. ✓ S15 影子节点放行：p2 影子模式在哪个节点、何时上线属于生产变更，由属主选定节点，报全局放行；这两项都是计划树里 p2 的放行条件。  [29]  
   _置信度 A，状态 supported_
16. ✓ S16 -32002 告警：发送结果为 -32002（同一 id 对应不同报文）而被判为 gone 时，a2a Source 必须上报 health error。这种情况说明 task id 派生出了 bug，不能悄悄丢掉。这是 p2 的实现要求。  [32]  
   _置信度 A，状态 supported_
17. ✓ S17 信箱投递不记欠账：投递进 CLI 信箱的任务在调用方是终态（应答 receipt:"mailbox"，调用方不记欠账），所以它的回执在调用方没有欠账行可结清，只把 disposition 送达调用方；回执只在调用方确实记了欠账的地方结清。  [37][36]  
   _置信度 A，状态 supported_
18. ✓ S18 来源校验只在正文：宿主对入站调用方的校验结论目前只写进 CLI 信箱行正文的头部（wire 面），本地面不写，信箱行没有结构化的校验字段；Source 判断 actor 不能解析正文，所以 p2 之前要先让宿主把结论写成信箱行字段（计划节点 p1-mail-proof）。  [39][38][40]  
   _置信度 A，状态 supported_
19. ✓ S19 superagent 以源码部署：superagent 的部署方式是克隆仓库后 pnpm install && pnpm build，不以 npm 包分发，所以本仓插件包在编译期拿不到它的 Source 接口类型，需要自声明结构类型或钉住源码提交。  [41]  
   _置信度 B，状态 supported_
20. ✓ S20 全局对 p2 设计稿的裁定：G1 实现为 p1-mail-proof；G2 用最小结构类型加类型快照契约测试；D4 可信来源集合只认 origin-claim 和 in-process；D7 不批——p2 把 Agent 调用方按事实翻译为 human:false，S13 ② 与 Cookbook「名单内的 bot 只能当 inferred」的冲突移进 p3，由属主裁定；Trigger id 带上调用方句柄。  [44][43][45][46][42]  
   _置信度 A，状态 supported_
21. ? L1 未决：0.2.2-rc.1 的 followup “先插入后 throw”的判断只依据精确发布包的源码，尚未经实际运行验证。 _（无证据支撑）_  
   _置信度 C，状态 unverified_
22. ✓ S21 D7 属主裁定（2026-11-07）：规则化 inferred——a2a Source 保持 human:false；superagent 以 auto 接单模式运行，唯一规则为「来源 ∈ D4 可信集合且调用方在属主建立的链接集内」；Mandate 记命中规则与 s13Strength；不改、不 fork superagent；S13② 的 explicit 强度不再实现  [56][54][55]  
   _置信度 A，状态 supported_
23. ✓ S22 上游对 human:false 的触发不发接单确认：自动确认只在 trigger.human 时排队，执行器手动确认对非人触发被拒（ackNotPerson）。a2a Source 不需要另设静默规则  [58][59]  
   _置信度 A，状态 supported_
24. ✓ S23 上游的 attention 与 result 到 Channel 时同为 kind:'reply'；能区分两者的只有消息 id：attention 用 key('attention-reply', attention.id)  [62][61][60]  
   _置信度 A，状态 supported_
25. ✓ S24 缺口：a2a-net receipt 命令只能写 outcome completed（disposition result）或 attention；工单 dropped、failed 或被人停止时，若映射到它会被报成 completed  [57]  
   _置信度 A，状态 supported_
26. ✓ S25 出站边界属主裁定（2026-11-07，全部按推荐）：外发只回触发它的发送方并在发送前复查属主链接集（O1）；每任务首条外发是唯一正式回执，之后为同 context 新任务、task id a2a-<message.id>（O2）；不发接单确认，attention 按 attention-reply id 判别（O3）；首次失败 24 小时未发出判 gone 并报 health error（O5）  [64][63][65][68][66]  
   _置信度 A，状态 supported_
27. ✓ S26 回执结局属主裁定（2026-11-07）：receipt 加 --outcome failed|rejected|abandoned，dropped→rejected、failed→failed、被人叫停→abandoned，立为 p3 前置节点 p1-receipt-outcome（高档）；唯一接单规则写明 dropped 时发一句原因  [63][67]  
   _置信度 A，状态 supported_
28. ✓ S27 防回环属主裁定（2026-11-07）：task id 以 a2a- 开头的入站永不匹配自动接单规则（L1）；p4 主动派工的回环防护留到 p4 设计（L2）；不加 attention 次数或对话轮数状态  [63][69][70]  
   _置信度 A，状态 supported_
29. ✓ S28 p1-receipt-outcome 由评审席会话实现，评估侧会话只做评估和设计（全局 2026-11-07：两席位上限、禁 worktree 共用检出）；需求交接见任务 58121c78d2  [72][71]  
   _置信度 A，状态 supported_
30. ✓ S29 投给 CLI 身份的任务，宿主回 TASK_STATE_COMPLETED 加 receipt:'mailbox'，调用方 trackOwedTask 因此提前返回，不记欠账（next/0.8 ee92712f081e）  [73][74][75]  
   _置信度 A，状态 supported_
31. ✓ S30 投给 CLI 信箱的任务不受每目标 3 笔名额约束：queueFullRefusal 对 mailbox 直接放行，不会出现 -32009  [76]  
   _置信度 A，状态 supported_
32. ✓ S31 CLI 信箱上限 64 行，超出时挤出最旧的行，只计数（dropped），不通知调用方  [78][77]  
   _置信度 A，状态 supported_
33. ✓ S32 合起来：调用方派给 superagent（CLI 身份）的请求，调用方既不记欠账、也不受背压；信箱挤出时这笔请求在任何一方的账本上都不存在，与属主「强制对账」「拥堵是背压」两条原则冲突  [73][75][78][76]  
   _置信度 A，状态 supported_
34. ✓ S33 信箱欠回执属主裁定（2026-11-07）：CLI 身份在签名名片里声明「接活信箱、欠回执」，家宿主对它的投递回已投递而非终态，调用方记欠账并受 3 笔名额与 -32009 背压；仅 superagent Source 身份声明；经宿主转发路径一并改；高档，作为 p3 前置，不挡 p2b；修复 S32  [79][82][81][80][84][83]  
   _置信度 A，状态 supported_
35. ✓ S34 cli-identity 只出现在「CLI 用自己的户口密钥签名、直接投到本宿主」的情形；外主机的 CLI 经其家宿主转发、且本宿主运营者链接过该句柄并钉住 home（remote-ref-cli）时，记为 origin-claim  [88][85][86]  
   _置信度 A，状态 supported_
36. ✓ S35 cli-identity 证明的是本机户口密钥的持有，户口只能经本机控制路由建立；D4 不认它，于是同宿主的 CLI 调用方反而比经转发的外主机 CLI 调用方更不受信（倒挂）  [85][86][87][89]  
   _置信度 A，状态 supported_
37. ✓ S36 D4 修订属主裁定（2026-11-07）：可信来源集合扩为 {origin-claim, in-process, cli-identity}，三类都须调用方在属主建立的链接集内（D7 唯一规则），信任锚统一为属主建链；消除 S35 的倒挂；修订全局 #385 的 D4；p3 设计改动，不挡 p2b  [92][93][90][91]  
   _置信度 A，状态 supported_
38. ✓ S37 现行 p4 设计（规格 §4、S8）让 superagent 把工单 route 给开发席等远端席位执行；这与协作规范 v1.18 冲突：一个项目至多开发、评审两个角色，要并行由开发自己拉子 agent，项目内 A2A 只有送审和上报  [99][95][96][97][94][98]  
   _置信度 A，状态 supported_
39. ✓ S38 p4 属主裁定（2026-11-07）：收窄为送审——superagent 用本地执行器自己做，不经 A2A 派工给远端席位；A2A 外发只剩回执与 attention、送审、上报三种；总工席不拆、r1-role-split 关闭；L2 回环风险基本消失；规格 §4 与 S8 在 r8 重写；解决 S37  [103][101][102][100][104]  
   _置信度 A，状态 supported_

## 已知局限（设计代价）

以下是本设计明确接受的代价，不是缺少证据的待办；它们都写在规格或 ADR 里。真正还没验证的项，由下面“局限与未决问题”一节按未验证断言自动列出。

- **远端执行器没有 progress**：A2A 的回执是终态，执行席的过程报告不经 A2A 传输，只在它自己的工单或 PR 里（S6）。
- **信箱上限 64 行**：主机只保留最新 64 行，被挤出的未读消息不可恢复。Source 只能如实报告挤出数，并上报 health error（S2）。
- **attention 多一次往返**：问题通过回执发出，答复要作为同一 context 的新任务回来（S13、S14）。
- **专用 CLI 身份需要运维**：要按时续户口，信箱容量要有人看（S5）。
- **信箱投递不记欠账**：投递进 CLI 信箱的任务在调用方是终态，它的回执没有欠账可结清，只把 disposition 送达调用方（S17）。
- **类型依赖靠契约测试兜底**：superagent 没有 npm 包，插件包按 Cookbook 自声明最小结构类型，与真实 superagent 的一致性只能靠对照钉住提交的契约测试（S19）。


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
[30] PR #381 发送结果分类 class 与全局评审条件 · cli/a2a.mjs sendClass（next/0.8 @ 8402af80） — if (out?.code === -32001 || out?.code === -32002) return 'gone'
[31] PR #381 发送结果分类 class 与全局评审条件 · 全局 PR #381 评审条件，2026-11-06 — 所以改规格，不改实现：gone 只用于 -32001、-32002 和 prior failed；身份不存在、名片撤销、身份冲突都归 retry
[32] PR #381 发送结果分类 class 与全局评审条件 · 全局 PR #381 评审意见，2026-11-06 — -32002（同一个 id 对应不同报文）判为 gone 时，Source 要上报 health error
[33] next/0.8 @ 23b7ebf 回执信封与信箱欠账代码 · src/receipt.ts:37 @ 23b7ebf — Controlled outcome vocabulary — the ONLY branchable field of an envelope.
[34] 全局生产评估 p1-receipt-cmd 开工前裁定（2026-11-07） · 全局 p1-receipt-cmd 开工前裁定 a，2026-11-07 — 用新键 `disposition`，不扩展 outcome 的取值
[35] 全局生产评估 p1-receipt-cmd 开工前裁定（2026-11-07） · 全局 p1-receipt-cmd 开工前裁定 a.3，2026-11-07 — attention 回执会结清原任务，后续工作作为同一 context 下的新任务另派。所以同一个 task 不会再收到第二张回执
[36] next/0.8 @ 23b7ebf 回执信封与信箱欠账代码 · src/index.ts:3558 trackOwedTask @ 23b7ebf — if (result.task_status !== 'TASK_STATE_DELIVERED'&&result.receiverBookkeeping!=='failed'&&!(result.task_status==='TASK_STATE_COMPLETED'&&result.replyFinal!==true&&result.receipt!=='mailbox')) return
[37] next/0.8 @ 23b7ebf 回执信封与信箱欠账代码 · src/faces/wire.ts:832 @ 23b7ebf — a mailbox delivery is final from this host's
[38] next/0.8 @ 9ac5fc2 信箱来源校验代码 · src/faces/wire.ts:750 @ 9ac5fc2 — const proofClause = callerProof === 'origin-claim' && claim.ok ? `已验证来源 ${originOf(claim.callerUrl)}`
[39] next/0.8 @ 9ac5fc2 信箱来源校验代码 · src/faces/wire.ts:752 @ 9ac5fc2 — const directHeader = (from: string): string => `[A2A direct] (task ${taskId}) ${proofClause} ${sanitizeFromClause(from)} (routed to ${team}) sent:`
[40] next/0.8 @ 9ac5fc2 信箱来源校验代码 · src/index.ts:3928 @ 9ac5fc2 — cliDeposits.mail(team, callerSession ?? 'unknown', message, undefined, { taskId: taskIdFromCaller, contextId, ...(disposition !== undefined ? { disposition } : {}) })
[41] superagent 006 Deployment · docs/006-deployment.md:78 — pnpm install && pnpm build
[42] 全局生产评估 PR #385 p2 设计评审（2026-11-07） · 全局 PR #385 设计评审结论 — G1、G2、D4 给 design_pass；D7 不批，要改稿
[43] 全局生产评估 PR #385 p2 设计评审（2026-11-07） · 全局 PR #385 设计评审 D4 — 可信集合只认 origin-claim 和 in-process；cli-identity 暂不认
[44] 全局生产评估 PR #385 p2 设计评审（2026-11-07） · 全局 PR #385 设计评审 D7 — p2 按事实翻译，human:false
[45] 全局生产评估 PR #385 p2 设计评审（2026-11-07） · 全局 PR #385 设计评审非阻断 a — Trigger id 建议用 key('a2a', from, task_id)
[46] superagent 008 Cookbook: Add a Source · docs/008-cookbook.md:122 — Listed bots can only become inferred candidates.
[47] p1-mail-proof 实现 PR #386（base next/0.8） · tests/mesh/cli-mail-proof.spec.ts — 两台真实宿主：wire 面每行 proof 等于其正文头判定；CLI 调用方 cli-identity；本地面 in-process 无头；两面回执带 receipt_for、非回执不带；thread 带出 proof；反向变异 13/13 变红
[48] p1-mail-proof 实现 PR #386（base next/0.8） · 全局生产评估评审消息，2026-11-07 — PR #386 全局非自我评审 PASS @ a1d55a658e0b，合入 next/0.8 merge 040a7dfb10b8；中档不需属主知会
[49] p2 设计稿 PR #385 全局 design_pass · 全局生产评估评审消息，2026-11-07 — PR #385 全局设计评审 design_pass @ b56028ec8999（G1/G2/D4 批；D7 改为 human:false 并移入 p3），合入 next/0.8 merge d10afc5cab3c
[50] G2 类型快照 PR #387（base next/0.8） · 全局生产评估评审消息，2026-11-07 — PR #387 全局非自我评审 PASS @ fd61fb324150（快照逐字抽查一致、MIT 内联、G3 属实、契约方向正确），合入 next/0.8 merge a62b6b034c24；反向变异 18/18 变红
[51] 属主选定 p2b 影子运行节点（2026-11-07） · 属主答复，评审席会话 2026-11-07 — 就放本机
[52] p2a-source-code PR #390（base next/0.8） · 全局生产评估复核消息，2026-11-07 — PR #390 全局 global_pass @ 15888ab12065（阻断项 loss 轮以 error 收尾已修；九条语义均有用例；30+2 个反向变异变红），合入 next/0.8 merge 3f5131fc3ff2
[53] 影子验收 D1/D2 PR #391 · 全局生产评估评审消息，2026-11-07 — PR #391 全局 global_pass @ e7525818a3a8（行记录含 proof/receipt_for/dup、页头无条件记录、health 日志只留结构化值；19 个反向变异变红），合入 next/0.8 merge ee92712f081e
[54] 属主 2026-11-07 在评审席会话中裁定 D7：「按推荐：规则化 inferred」。采纳的推荐内容：a2a So · owner ruling — 裁定 D7：「按推荐：规则化 inferred」
[55] 属主 2026-11-07 在评审席会话中裁定 D7：「按推荐：规则化 inferred」。采纳的推荐内容：a2a So · rule — 只设一条窄规则——来源属于 D4 可信集合（origin-claim、in-process）且调用方在属主建立的链接集内的请求可以接单
[56] 属主 2026-11-07 在评审席会话中裁定 D7：「按推荐：规则化 inferred」。采纳的推荐内容：a2a So · S13② — S13② 的 explicit 强度不再实现，改由这条规则达成同样的接单效果。
[57] a2a-net cli/a2a.mjs（next/0.8 ee92712f081e） · receipt envelope — : { outcome: 'completed', idempotencyKey: taskId, disposition: 'result' }
[58] superagent src/core/replies.ts（8c32a9d） · acknowledgeAccepted — if (trigger.channel && trigger.human) this.options.outbox.send
[59] superagent src/core/replies.ts（8c32a9d） · acknowledge — if (!existing && !trigger.human) throw new UserError('ackNotPerson')
[60] superagent src/core/replies.ts（8c32a9d） · answer id — const id = attention ? key('attention-reply', attention.id) : key('reply', trigger?.id ?? ticket?.id ?? '', request.text)
[61] superagent src/core/replies.ts（8c32a9d） · answer send — this.options.outbox.send({ id, channel, text: request.text, kind: 'reply'
[62] superagent src/core/ports.ts（8c32a9d） · OutboundMessage — kind: 'acknowledgement' | 'reply' | 'notice'
[63] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · ruling — 裁定出站边界与防回环：「全部按推荐」
[64] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · O1 — O1：每条外发只发给触发它的那条入站消息的发送方，不向第三方开新对话
[65] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · O2 — O2：每个入站任务的第一条外发是它的正式回执（一张），之后的外发作为同一 context 的新任务，task id 为 a2a-<message.id>
[66] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · O3 — O3：接单确认不发
[67] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · O4 — O4：给 receipt 加 --outcome failed|rejected|abandoned，dropped→rejected、failed→failed、被人叫停→abandoned，立为 p3 前置节点，高档
[68] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · O5 — O5：首次发送失败起 24 小时仍未发出则判 gone 并报 health error
[69] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · L1 — L1：task id 以 a2a- 开头的入站永不匹配自动接单规则
[70] 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 · L2 — L2：p4 主动派工的回环防护留到 p4 设计
[71] 全局生产评估 2026-11-07 要求：p1-receipt-outcome 的实现不由评估侧会话来做，交评审席（lo · owner — 交评审席（local_bb38fac4）排进 next/0.8 队列
[72] 全局生产评估 2026-11-07 要求：p1-receipt-outcome 的实现不由评估侧会话来做，交评审席（lo · scope — 评估侧会话只做评估和设计，不写代码、不改检出。
[73] a2a-net src/faces/wire.ts（next/0.8 b1a72570d090） · wire mailbox answer — const payload = JSON.stringify({ routed: true, delivered: true, receipt: 'mailbox', team, task_id: taskId, context_id: contextId, task_status: 'TASK_STATE_COMPLETED', note })
[74] a2a-net src/faces/wire.ts（next/0.8 b1a72570d090） · wire comment — a mailbox delivery is final from this host's
[75] a2a-net src/index.ts（next/0.8 b1a72570d090） · trackOwedTask — if (result.task_status !== 'TASK_STATE_DELIVERED'&&result.receiverBookkeeping!=='failed'&&!(result.task_status==='TASK_STATE_COMPLETED'&&result.replyFinal!==true&&result.receipt!=='mailbox')) return
[76] a2a-net src/queue-guard.ts（next/0.8 b1a72570d090） · queueFullRefusal — if (limit <= 0 || mailbox) return undefined
[77] a2a-net src/cli-deposit.ts（next/0.8 b1a72570d090） · cap — export const MAILBOX_CAP = 64
[78] a2a-net src/cli-deposit.ts（next/0.8 b1a72570d090） · evict — this.mailbox.set(handle, list.slice(0, MAILBOX_CAP))
[79] 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 · ruling — 裁定 S32 缺口：「按推荐：身份声明欠回执」
[80] 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 · declare — CLI 身份可在签名名片里声明自己是接活信箱（欠回执）
[81] 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 · deliver — 家宿主对声明了的身份，投递改回「已投递、欠回执」而不是终态，调用方照常记欠账
[82] 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 · cap — 每目标 3 笔名额对它生效、拥堵时调用方可见 -32009
[83] 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 · scope — 只有 superagent 的 Source 身份声明，人用的 CLI 身份不变。声明是身份属性，不是新的任务状态。经宿主转发的路径一并改。
[84] 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 · gate — 作为 p3 前置，不挡 p2b。
[85] a2a-net src/faces/wire.ts（next/0.8 b1a72570d090） · callerProof — : admission.rule === 'remote-ref-cli' ? 'origin-claim'
[86] a2a-net src/faces/wire.ts（next/0.8 b1a72570d090） · callerProof — : claim.cli === true ? (claimCovers(caller, claim.caller) ? 'cli-identity' : 'claim-mismatch')
[87] a2a-net src/task-auth.ts（next/0.8 b1a72570d090） · AuthProof doc — `cli-identity`: a deposited CLI key proves the local CLI handle, not market issuer origin.
[88] a2a-net docs/design/cross-host-forward.md（next/0.8 b1a72570d090） · 2.3 cond 1 — **H2 的运营者链接过这个句柄**：它在 H2 某个画布队的远端成员引用里。
[89] a2a-net docs/design/cross-host-forward.md（next/0.8 b1a72570d090） · 2.3 pin — 本机户口只能经本机控制路由建立，是运营者认可的节点事实
[90] 属主 2026-11-07 在评审席侧会话中裁定 D4 修订：「按新推荐：认但要链接」。内容：a2a Source 的可 · ruling — 裁定 D4 修订：「按新推荐：认但要链接」
[91] 属主 2026-11-07 在评审席侧会话中裁定 D4 修订：「按新推荐：认但要链接」。内容：a2a Source 的可 · set — 由 {origin-claim, in-process} 扩为 {origin-claim, in-process, cli-identity}
[92] 属主 2026-11-07 在评审席侧会话中裁定 D4 修订：「按新推荐：认但要链接」。内容：a2a Source 的可 · anchor — 信任锚统一为属主亲手建立的链接
[93] 属主 2026-11-07 在评审席侧会话中裁定 D4 修订：「按新推荐：认但要链接」。内容：a2a Source 的可 · gate — 属 p3 设计改动，不挡 p2b
[94] superagent-a2a-spec.md（next/0.8 f96cd467f9ec） · §4 — | launch（Assignment 启动） | `a2a-net route <席位> <派工卡> --task <确定性 id> --context <工单 id>` |
[95] superagent-a2a-spec.md（next/0.8 f96cd467f9ec） · S8 — | 执行器 | 开发席等远端席位 | 自判范围、自判跟进，超出范围交还 |
[96] 协作规范 collaboration.md v1.18（next/0.8 f96cd467f9ec） · §1 — 一个项目，或者单独交办的一件任务，至多两个角色：**开发**和**评审**。
[97] 协作规范 collaboration.md v1.18（next/0.8 f96cd467f9ec） · §1 — 要并行，开发自己拉子 agent 分段做，结果收回来自己合，不另开开发坐席。
[98] 协作规范 collaboration.md v1.18（next/0.8 f96cd467f9ec） · §2 — 别的都自己做：改别的仓库，自己改（下一节）；要并行，拉子 agent；要定的事，自己定（第 4 节）。
[99] 协作规范 collaboration.md v1.18（next/0.8 f96cd467f9ec） · §2 — | 送审 | 开发发给评审。中档异步通知，不等；高档等评审 PASS（第 6、7 节） |
[100] 属主 2026-11-07 在评审席侧会话中裁定 p4：「按推荐：收窄为送审」。内容：superagent 在它负责的项 · ruling — 裁定 p4：「按推荐：收窄为送审」
[101] 属主 2026-11-07 在评审席侧会话中裁定 p4：「按推荐：收窄为送审」。内容：superagent 在它负责的项 · scope — 不再用 A2A Executor 把工单派给开发席等远端席位
[102] 属主 2026-11-07 在评审席侧会话中裁定 p4：「按推荐：收窄为送审」。内容：superagent 在它负责的项 · outbound — superagent 的 A2A 外发只剩三种：回执与 attention（p3）、送审（高档改动发给评审席，等非自我评审 PASS）、上报（要凭证或要属主拍板时找能解决的人）
[103] 属主 2026-11-07 在评审席侧会话中裁定 p4：「按推荐：收窄为送审」。内容：superagent 在它负责的项 · r1 — 总工席不拆，r1-role-split 按不拆关闭
[104] 属主 2026-11-07 在评审席侧会话中裁定 p4：「按推荐：收窄为送审」。内容：superagent 在它负责的项 · L2 — 原 L2 回环风险随之基本消失

## 来源

- 协作规范 collaboration.md v1.18（next/0.8 f96cd467f9ec） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/f96cd467f9ec/src/skill/references/collaboration.md （置信度 B）
- superagent-a2a-spec.md（next/0.8 f96cd467f9ec） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/f96cd467f9ec/docs/design/superagent-a2a-spec.md （置信度 B）
- a2a-net docs/design/cross-host-forward.md（next/0.8 b1a72570d090） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/b1a72570d090/docs/design/cross-host-forward.md （置信度 B）
- a2a-net src/task-auth.ts（next/0.8 b1a72570d090） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/b1a72570d090/src/task-auth.ts （置信度 B）
- a2a-net src/cli-deposit.ts（next/0.8 b1a72570d090） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/b1a72570d090/src/cli-deposit.ts （置信度 B）
- a2a-net src/queue-guard.ts（next/0.8 b1a72570d090） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/b1a72570d090/src/queue-guard.ts （置信度 B）
- a2a-net src/index.ts（next/0.8 b1a72570d090） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/b1a72570d090/src/index.ts （置信度 B）
- a2a-net src/faces/wire.ts（next/0.8 b1a72570d090） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/b1a72570d090/src/faces/wire.ts （置信度 B）
- superagent src/core/replies.ts（8c32a9d） — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/src/core/replies.ts （置信度 B）
- a2a-net cli/a2a.mjs（next/0.8 ee92712f081e） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/ee92712f081e/cli/a2a.mjs （置信度 B）
- 影子验收 D1/D2 PR #391 （置信度 B）
- p2a-source-code PR #390（base next/0.8） （置信度 B）
- 属主选定 p2b 影子运行节点（2026-11-07） （置信度 B）
- G2 类型快照 PR #387（base next/0.8） （置信度 B）
- p2 设计稿 PR #385 全局 design_pass （置信度 B）
- p1-mail-proof 实现 PR #386（base next/0.8） （置信度 B）
- next/0.8 @ 23b7ebf 回执信封与信箱欠账代码 — https://github.com/NelsonLongxiang/dsh-open-a2a-net/tree/23b7ebfe735f5427fabea4f78e6ed9d227a69d79#receipt-envelope-and-mailbox-debt （置信度 B）
- next/0.8 @ 9ac5fc2 信箱来源校验代码 — https://github.com/NelsonLongxiang/dsh-open-a2a-net/tree/9ac5fc28286809ca3f398084379cc726cdade172#mailbox-proof （置信度 B）
- 全局生产评估 PR #385 p2 设计评审（2026-11-07） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/385#global-design-review-355f5fe （置信度 B）
- 全局生产评估 PR #376 规格评审意见 @ a537c5a — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/376#global-review-a537c5a （置信度 B）
- PR #381 发送结果分类 class 与全局评审条件 — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/381 （置信度 B）
- 全局生产评估 p1-receipt-cmd 开工前裁定（2026-11-07） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/tree/next/0.8#global-ruling-p1-receipt-cmd （置信度 B）
- a2a-net PR #372 synchronous reply contract — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/372 （置信度 B）
- a2a-net PR #375 followup admission — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/375 （置信度 B）
- a2a-net PR #364 inbound admission fail closed — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/364 （置信度 B）
- a2a-net 新版本分支 next/0.8 — https://github.com/NelsonLongxiang/dsh-open-a2a-net/tree/next/0.8 （置信度 B）
- 属主在评审席会话中的裁定（2026-11-06） — https://github.com/NelsonLongxiang/dsh-open-a2a-net/pull/376 （置信度 B）
- superagent prompts/work.md — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/prompts/work.md （置信度 B）
- a2a-net CLI help (cli/a2a.mjs) — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/cli/a2a.mjs （置信度 B）
- a2a-net design 351 durable reconciliation — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/docs/design/351-durable-inbound-reconciliation.md （置信度 B）
- a2a-net protocol route-bookkeeping-observation — https://github.com/NelsonLongxiang/dsh-open-a2a-net/blob/c12c299/docs/protocol/route-bookkeeping-observation.md （置信度 B）
- superagent 006 Deployment — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/006-deployment.md （置信度 B）
- superagent 007 Architecture — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/007-architecture.md （置信度 B）
- superagent 008 Cookbook: Add a Source — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/008-cookbook.md （置信度 B）
- superagent prompts/dispatch.md — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/prompts/dispatch.md （置信度 B）
- superagent 003 Execution — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/003-execution.md （置信度 B）
- superagent 004 Prompts — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/004-prompts.md （置信度 B）
- superagent 001 Domain model — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/001-domain.md （置信度 B）
- superagent 002 Authorization — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/002-authorization.md （置信度 B）
- superagent 000 Philosophy — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/docs/000-philosophy.md （置信度 B）
- superagent src/core/ports.ts（8c32a9d） — https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72/src/core/ports.ts （置信度 B）
- 属主 2026-11-07 在评审席侧会话中裁定 p4：「按推荐：收窄为送审」。内容：superagent 在它负责的项 — session://adjudication/202611070620 （置信度 B）
- 属主 2026-11-07 在评审席侧会话中裁定 D4 修订：「按新推荐：认但要链接」。内容：a2a Source 的可 — session://adjudication/202611070611 （置信度 B）
- 属主 2026-11-07 在评审席会话中裁定 S32 缺口：「按推荐：身份声明欠回执」。内容：CLI 身份可在签名名片 — session://adjudication/202611070602 （置信度 B）
- 全局生产评估 2026-11-07 要求：p1-receipt-outcome 的实现不由评估侧会话来做，交评审席（lo — session://adjudication/202611070526 （置信度 B）
- 属主 2026-11-07 在评审席会话中裁定出站边界与防回环：「全部按推荐」。O1：每条外发只发给触发它的那条入站消息 — session://adjudication/202611070524 （置信度 B）
- 属主 2026-11-07 在评审席会话中裁定 D7：「按推荐：规则化 inferred」。采纳的推荐内容：a2a So — session://adjudication/202611070514 （置信度 B）

## 局限与未决问题

- 待补证据：L1 未决：0.2.2-rc.1 的 followup “先插入后 throw”的判断只依据精确发布包的源码，尚未经实际运行验证。