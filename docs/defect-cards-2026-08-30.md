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

## F6（插件侧，PR-5，需求级缺陷）——出站门控：未加入会话不得执行任何 A2A 连接

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
