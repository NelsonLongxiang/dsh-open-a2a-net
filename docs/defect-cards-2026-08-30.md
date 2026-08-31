# 缺陷卡：async 冷会话滞留残留缺口 + 交付源鉴权（2026-08-30 登记）

> 母缺陷卡 t-mt6nd0sq-hxuhj6（async 冷会话滞留）的后续拆分。
> 08-26 实证与分层设计见 `docs/async-cold-session-stall-analysis.md`。
> 08-30 新实证（cli-manager a2a-collab 委托链实测）：**全新会话在激活/maintenance
> 窗口内连 sync steer 也静默**（latch 不重放、账本零记录）；唯一可靠唤醒通道是
> `POST /api/session/prompt`（mode queue，90s 内活跃）。据此对 F1/F2 重新评估：
> 原设计已落地部分（consumed 字段、armAsyncNudge）不再重复立项，本文件登记
> **残留缺口**，并新增边界缺陷 F4。

## F1'（插件侧，PR-1，低风险）——consumed 探测在激活窗假阳性

- **现象**：目标会话本就 running（激活 turn / maintenance）时，`probeConsumption()`
  读一次 `status === 'running'` 即误判已消费 → 响应 `consumed:true`、
  `armAsyncNudge` 不武装 → latch 永久静默且无任何 NOT_CONSUMED 表现。
- **根因锚点**：`src/index.ts` probeConsumption（v0.5.23 async-stall 线）；
  noWait 分支仅 `!consumedProbe` 才 arm nudge。docstring 自述只防了
  false-negative 方向，**假阳性方向未设防**。
- **修复**：① steer 前记录先验 status；was-running 目标不采信单次即时读——
  一律 `consumed:false` + 武装 nudge（保守方向错只多一次无害 nudge）；
  ② 宿主 turn 标识可用后升级 turn 身份关联探测（依赖 F3）；③ 单测：
  fake agent 激活窗场景（steer 时已 running → 必须报 consumed:false 并武装）。

## F2'（插件侧，PR-2，中风险）——asyncNudge 三缺口

- **缺口 1 未武装**：nudge 仅在 probe=false 时挂（随 F1' 假阳性整体失效）。
- **缺口 2 账本盲区**：触发前置 `taskLedger.isPending(taskId)`——08-30
  「账本零记录」的任务永不复查；sync wait=true 路径不落账本时整套 stall
  检测全盲。
- **缺口 3 通道单一**：nudge 只再 steerRelay——激活窗内 steer 正是被 latch
  的失效通道，等于用失效通道救失效。
- **修复**：① 武装与探测解耦，消费判定移入 nudge 回调（per-session 单飞 +
  全局上限保留）；② 投递时无条件先落账本（team 解析未 settle 也先记
  DELIVERED）；③ nudge 升级链：首次 steer nudge 失败 →
  `POST /api/session/prompt`（mode queue）兜底；④ 3081 回归：装包任务链 +
  全新会话激活窗注入。

## F3（宿主侧，deepseek-harness 仓）——latch 重放无硬保证

- **现象**：08-26 七条 async delivered 零消费；08-30 升级为**新会话激活窗内
  sync steer 也静默**。
- **机制**：agent-loop `src/agent.ts` steer→send(wakeup=true) 在
  maintenance/abort 窗被 latch，重放条件 `wakeRequested && inbox.hasPending`
  ——maintenance 不结束或判定失效则永不重放。
- **修复（宿主 PR）**：① maintenance 结束 finally 无条件检查
  `inbox.hasPending → wakeDriver()`（不依赖 wakeRequested）；② turn/end→idle
  kick finally 同样兜底；③ 新会话激活期 steer 持久排队、激活完成必重放；
  ④ agent-loop 单测两场景。**归属 deepseek-harness 仓，实施时在该仓另开 PR。**

## F4（插件侧，PR-3，安全）——交付源鉴权 best-effort 未强制

- **现象（08-30 边界上报，源头 192.168.3.156 / dsh-host-d733c7a7（3081 测试
  home 所在机）的未加入会话实测；初报误标 .88——.88 为内部 Gitea 服务器，
  上报方已更正）**：
  1. 未加入会话可调用宿主级模型工具（a2a_teams/route/probe/status）并出站
     路由——本席初判"设计内"已被**系统所有者
     推翻（08-30 二次上报 direct-1168c27f 转达裁定）**：所有者预期边界为
     "未加入网络的会话不应能执行任何 A2A 连接，含出站"。现状与预期不符 =
     需求级缺陷，改判立项为 **F6**（本条处置从"文档明示"改为"F6 修复"）。
  2. wire 层：无鉴权 curl 向回环与非回环（192.168.3.157:13080）
     `/a2a/direct` POST wait:false 均 routed/delivered/consumed:true——
     跨宿主被无条件接受。与 `docs/protocol/delivery-origin-auth.md` 自述
     "best-effort today" 一致：**确证缺陷，交付源鉴权实际未强制**。
  3. apiKey 为空且绑定非回环时 `/a2a/direct` 无闸（控制路由有回环/同源闸，
     direct 没有）。
- **修复**：① 交付源鉴权强制化：caller ∈ inbound-edge（已验证 card 的
  sessionTeams/process team）或 per-peer apiKey；失败 401/403 且不落账本；
  ② 绑定非回环 + apiKey 空 → 启动 loud warning；③ 文档：明示「未加入会话
  可作 caller 出站」为预期，delivery-origin-auth.md 状态 best-effort →
  enforced + 验证步骤；④ 即刻缓解（配置面）：非回环绑定的宿主立即设 apiKey。
- **证据**：上报方 a2a_status 活动环三条 failed（同步等待中止：dsh/28609c07、
  dsh/bdf3218e、dsh/830b15fd）+ probe-88-nowait-01（→3081/dsh/830b15fd）、
  probe-88-nowait-02（→.157/dsh/bdf3218e）手工 POST delivered+consumed。

## F5（插件侧，PR-4，中风险）——回执债常态化：结算完整性（08-30 待办，龙翔点名根治）

- **现象（08-30 台账实况）**：欠回执常态化——26 条 owed，其中 6 条收款方为
  本会话（0a70e9fc）本身；author 席 0.5.38/0.5.39 发版请求已获完整答复，
  回执却 1h+ 未结算（caller 标签 `dsh-host-9c53bf95-*` 不可路由）；另一类
  "内容已答、回执形式件未走"（target 经 direct 通道答复，无
  `[A2A receipt]` 前缀路由，账本无法关联结算）。存量死信 40h+ 自动归档
  正常，但**新生债务持续大于结算速率**——问题不是回执慢，是债务可以
  无限制生出且缺乏结算通路。

- **三层根治设计（结算完整性）**：
  1. **生债闸（dispatch-time gate）**：投递时即解析 receiptTarget
     （callback || caller）——当前不可路由且不可物化（wake/adopt 均失败）时，
     响应附 `receipt: "none"`，账本落 `DELIVERED_NO_RECEIPT` 终态。
     **不制造无法结算的债**；要回执的调用方必须提供可路由 callback
     （a2a_route 对自身标签不可路由的调用方当场告警）。
  2. **证据即结算（settle-on-echo）**：回执提示已使每条委派消息自带
     `task <taskId>` 标记——入站 direct/relay 处理器扫描命中已知 pending
     taskId 的任何来文即结算（`RECEIVED_VIA_DIRECT`），不再依赖
     `[A2A receipt]` 前缀形式件；armReceiptAutosend 的 final-waiter 合成
     继续作为兜底通道。解决"内容已答、形式件未走"类。
  3. **过期降级（debt TTL）**：owed 回执超过 `receiptDebtTtlMs`（默认 2h）
     降级为 `EXPIRED_UNSETTLED`（终态 + 原因码：unroutable-caller /
     unconsumed / target-gone），监督循环停止催收，a2a_tasks 按原因码分类
     展示。死信侧 TTL 归档已正常，本条补的是**回执侧**的镜像机制。

- **与 F1'/F2'/F3 的关系**：F1'/F2'/F3 治"投了没人消费"（无最终回复 →
  无论怎么改都无回执）；本卡治"消费了但债收不回/债不该生"。两者合起来
  才是回执链闭环。

- **验收**：① 不可路由 caller 的 async 投递 → 响应 receipt:"none"、账本
  终态、零新增债务；② target 经 direct 答复（含 task id）→ 账本即时
  结算；③ 2h 未结算 → EXPIRED_UNSETTLED + 原因码；④ 3081 双会话回归
  （本 host + 跨 host 各一轮）。

## F6（需求级缺陷）——出站门控：未加入会话不得执行任何 A2A 连接

- **状态：✅ 已实施**（作者席 commit `e4bc635`，2026-08-26 成文、用户裁定口径
  一致，已在 master）。实施形态与卡片设计的差异及裁决：
  - **五工具闸门**：a2a_teams / a2a_route / a2a_status / a2a_tasks / a2a_probe
    全部在 execute 入口过 `a2aJoinGateRefusal(exec)`——未加入会话（guest）
    拒绝，错误文案指引用户经侧边栏 join。
  - **进程白名单 = 发起人豁免**：宿主进程自身的 initiator 会话即节点本体，
    豁免门控；agent-less 的宿主服务面调用（账本/回执/唤醒）同样直通。
  - **`allowUnjoinedOutbound` 开关：刻意不设**。发起人豁免已覆盖 headless
    组合（无侧边栏的宿主经 initiator 面操作即可），少一个常开旁路 = 更严
    的默认边界。若未来出现真实的"guest 会话需出站"需求，再议开关。
  - **上报方二次证据的定性**：其"全链出站"复测走的是 wire 直投（curl
    `/a2a/direct`），不属工具闸门辖区——该面由 F4 交付源鉴权强制核心裁决
    （不可路由 caller 入站投递的拒收口径与 F5 生债闸统筹，随 F4 兼容矩阵
    落地）。工具面与本面合计后，F6 的所有者预期边界方完整闭合。
- **残余项**：① F4 强制核心（wire 层拒收口径）——随 OriginClaim 兼容矩阵
  裁决；② a2a-nodes 技能/README 的"已知局限"措辞随下次文档批同步。

- **所有者裁定（08-30，二次上报转达）**：预期边界 = "未加入网络的会话不应
  能执行任何 A2A 连接，含出站"。推翻本席初判"工具面设计内"，本卡据此立项。
- **新证据（首次上报后复测）**：未加入会话零鉴权完成全链出站——
  probe-88-e2e-01（→3081/dsh/830b15fd）、probe-88-e2e-02（→.157/dsh/bdf3218e）
  均 delivered+consumed；.157 经 /a2a/query 查得 completed + 真实回复原文
  （settled 01:20:03Z）——投递→消费→处理→结算→结果可查全链通。附带实证：
  对端回复原样复述了上报方消息里一条未经验证的声明（错误源头 IP）——
  未鉴权出站还会污染远端会话世界观。
- **修复设计**：
  1. **出站门控**：a2a_route / a2a_teams / a2a_probe / a2a_status 按调用方
     会话 join 状态拒绝（callerSession ∈ joined 集，否）。错误信息指引
     "先在侧边栏加入"。宿主级配置开关 `allowUnjoinedOutbound`（默认
     false=拒绝）保留逃生口径，供无侧边栏的 headless 组合显式开启。
  2. **进程 team 白名单**：宿主进程自身的 A2A 操作（账本、receipt 回流、
     唤醒）不走会话门控——门控只针对"会话身份的工具调用"。
  3. **与 F4 统筹**：wire 层对不可路由 caller（进程标签形态）的入站投递
     评估拒收口径——与 F5 生债闸合并设计（不可路由 caller 本就不该生回执
     债；若所有者裁定其也不该被投递，则 F4 强制核心直接覆盖），随 F4 的
     兼容矩阵一并裁决。
  4. **文档**：本卡 F4 第 1 条已同步改判；a2a-nodes 技能与仓 README 的
     "已知局限"措辞在 F6 落地时同步更新。
- **验收**：① 未加入会话调四工具 → 拒绝 + 指引加入；② 加入后立即可用；
  ③ `allowUnjoinedOutbound: true` 恢复旧行为；④ 进程 team 操作不受影响；
  ⑤ 3081 回归（未加入/已加入/开关三态）。

## 节奏

0.5.39 重启验收闭环后，F1'→PR-1、F2'→PR-2、F4→PR-3、F5→PR-4 依序走
worktree PR（3081 测试线验证）；F3 由 harness 仓实施时另开 PR。登记渠道
说明：gitee issues 写端点对本 token 异常（401/404，pulls 端点三种姿势均
正常——已实测分离），故以本文件 + PR 为登记载体。

## F7（插件侧，缺陷）——join 意图内存丢失：boot 期 prune 误剪导致 wake-on-route 永久 no-match

- **活体复现（0.5.40，0830 深夜）**：冷加入会话 `dsh/b5acc5eb` 路由报
  "No live DSH session node accepts team … and no cold joined session
  matches it"；同时刻三重事实互相矛盾——① join 意图文件
  `<home>/a2a/joined.json` 仍含该会话；② state 路由（sessionPersistence
  投影）仍把它列为 cold row；③ `a2a_route` 的 wakeColdTeam find 却
  no-match。④ 另一冷行 `dsh/d781fa5e` 同形状。
- **根因指向**：boot 期 `pruneArchivedJoins()` 依赖 workspace registry 的
  archived 集合——registry 在树早启动窗口可能暂报 archived（或暂时缺
  席），intent 被从内存 `joinedSessions` 剪除且**未回写/或回写时序错位**，
  此后 registry 恢复正常也无法自愈（内存与文件分叉，直到下次重启）。
- **修复方向**：① prune 前置双源核对（registry archived ∧ 持久层确无）；
  ② 内存剪除必须同步持久化；③ 增加自愈——wakeColdTeam no-match 时对照
  joined.json 回填内存意图；④ 单测：boot 期 registry 暂报 archived →
  稳定后 wake-on-route 必须命中。
- **影响**：被误剪会话的 wake-on-route / 冷唤醒全链失效（join 状态在
  GUI 面仍显示已加入），直到宿主重启。08-30 评审席 fd99deeb 唤醒失败
  即此形状（预热情列饿死是另一层，勿混淆）。

## F8（插件侧，系统性）——自动唤醒缺持续对账：恢复机制是"一次性事件"而非"期望状态收敛"

- **现象（0830 深夜重启后调查）**：`wakeJoinedOnBoot: true` 已生效、join 意图
  文件完整，但 5 个已加入会话数小时保持冷态（24c861fb、fa7947a3、b5acc5eb、
  d781fa5e、08189fb1），无任何失败原因可见。逐个 adopt 探测分类：
  - 1 例 corrupt session log（seq gap，物化必然失败，无修复路径）
  - 4 例 workspace 上下文错配（"belongs to X, not Y"——物化需会话自身
    记录的 cwd，调用方缺省上下文即拒）
- **系统性根因**：自动唤醒是**一次性事件**（boot 预热单轮 + 路由按需），
  不是**期望状态收敛**——
  1. boot 后才变冷的会话无任何恢复覆盖（预热只在启动时跑一轮）
  2. 预热对单会话失败 = warn 后跳过，无重试、无原因落面（面板冷行不带
     失败原因，监督无法区分"排队中/暂时失败/永久失败"）
  3. workspace 上下文耦合：物化校验 cwd，跨 workspace 会话对缺省上下文
     必拒（"belongs to"实证 ×4）
  4. 数据级阻断：corrupt log 无修复路径，该会话永久不可物化
- **修复设计（F8 对账器）**：
  - 周期性（或事件触发）diff join 意图 vs live agents；冷意图逐个尝试
    物化，**cwd 取自 persistence 的会话记录**（"belongs to"错误证明宿主
    侧记录了每个会话的 workspace——对账器按记录传参即可消掉错配）
  - 失败 → 记原因 + 指数退避（上限），行面携带 lastWakeError/attempts
  - corrupt log → 标 'needs-repair'（不重试），暴露修复入口
  - 吸收既有机制：boot 预热 = 对账器首轮；wake-on-route 自愈（PR #63）
    = 意图重同步；F5 原因码 = 行面标注
- **验收**：重启后 T+N 分钟内全部非 archived 意图物化或带原因码；corrupt
  行标 needs-repair；面板/监督可按原因过滤。

## F9（应答侧+接收侧，双向修复）——应答误投进程 team = 债务出生的标准形状

- **活体标本（0830 深夜）**：open-a2a-net 线向 skills-manager（dsh/50b344c2）
  发组队设计讨论（task direct-814655e6，outbound receiptExpected:true）。
  对方完成答复后，应答经 a2a_route 投给 **team "dsh"**（进程 team，本地
  优先解析截留——两节点进程 team 同名），而非回给原始 caller
  dsh/0a70e9fc。结果：应答内容进了进程 team 信箱蒸发，**调用方债挂着
  不结算**（答复文本甚至含 "task direct-814655e6" 字样，回显结算本可
  命中，但该投递从未进入任何被观测会话）。用户手工中转才让内容到达。
- **机制链**：应答方路由目标错（同名 team 本地截留）→ 应答进进程 team
  信箱 → 进程 team 无活会话消费或消费不被对方账本观测 → 债挂死。

### 修复（三层）
1. **应答方（skills-manager 线）**：回复路由目标必须取原始 caller team
   （投递时的 receipt hint 已写明），不得默认回投节点 team。
2. **接收侧自愈（open-a2a-net，本卡主体）**：direct 投递目标是本节点
   进程 team 且无活 initiator 消费时——不得静默丢弃：落"无主应答"暂存
   （按 task id 关联 pending 行结算 + 内容转投原 caller 的可路由地址，
   或至少 state 面可见 + 原因码 `reply-no-consumer`）。
3. **同名 team 消歧**（协议面）：a2a_route 对与本地 config.team 同名的
   目标，本地解析失败时**必须**尝试 peer 解析（现状：本地截留即弃，
   跨节点同名 team 永远不可达——中转 receipt 时实测）。跨节点同名 team
   的可达性是 F8 对账器的前置。
