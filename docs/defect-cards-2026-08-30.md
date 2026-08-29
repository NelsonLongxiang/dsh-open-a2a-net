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

- **现象（08-30 边界上报，.88 生产 home 未加入会话实测）**：
  1. 未加入会话可调用宿主级模型工具（a2a_teams/route/probe/status）并出站
     路由——**裁定为设计内**：join 门控的是入网可见性/派发表（card
     sessionTeams），不门控宿主级出站工具；caller 进程标签回执不回流为已知
     局限。处置：文档明示。
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

## 节奏

0.5.38 重启验收闭环后，F1'→PR-1、F2'→PR-2、F4→PR-3 依序走 worktree PR
（3081 测试线验证）；F3 由 harness 仓实施时另开 PR。登记渠道说明：gitee
issues 写端点对本 token 异常（401/404，pulls 端点三种姿势均正常——已实测
分离），故以本文件 + PR 为登记载体。
