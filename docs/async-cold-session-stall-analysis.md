# async 冷会话滞留——根因实证与修复设计（缺陷卡 t-mt6nd0sq-hxuhj6 素材）

> 2026-08-26 实证会话：3081 装包验证任务 7 条 async 催促全部 delivered:true 但零消费；
> 同步探针（wait 模式）46 秒获真实回复。本文固化证据链与修复设计。

## 一、证据链（时间线）

| 时间（本地） | 事件 | 证据 |
|---|---|---|
| 08-25 12:02 | 3080 生产进程启动（PID 142132） | 进程列表 |
| 01:44-01:47 | async 催促 steer 成功入队并被消费 | session.jsonl spliced→user/message→turn |
| 01:50:10 | 目标会话最后 turn/end，之后安静 | 日志尾部 turn/end @17:50:10Z |
| 01:52 | 3081 测试进程重启（PID 185060） | 进程列表（与滞留无直接因果，但混入排查噪声） |
| 01:55-02:25 | 6 条 async 催促全部 delivered:true、**日志零新增** | a2a_tasks pending ×6 + session.jsonl mtime 停在 01:50 |
| 02:31 | 同步探针（默认 wait）→ **46s 真实回复 "ok"** | direct-c686b0b6 TASK_STATE_COMPLETED + 节点主动补发 direct-840827c1 |

## 二、机制定位（代码级）

投递链（dsh-open-a2a-net/src/index.ts）：
```
async(wait:false) → /a2a/direct noWait 分支(1263) → resolveAgentForTeam → deliver(agent) → steerRelay → agent.steer
sync(wait)        → routeIntoAgent(1125) → registerFinalWaiter + steerRelay → agent.steer
```

宿主语义（deepseek-harness agent-loop/src/agent.ts:126）：
```
steer(input) { this.send(input, 'next-step', true) }  // wakeup=true → idle driver starts a turn
```

**两分支最终都调 agent.steer，机制上等价**——但实证上 async 滞留、sync 消费。差异不在分支代码，而在**到达时机与实例状态**：

### 嫌疑矩阵（按证据强度排序）

1. **【已排除】宿主 steer 语义缺陷**：sync 探针消费成功，steer→wakeDriver→kick 链路健全。
2. **【主嫌】滞留窗口的实例状态**：01:50 turn/end 后 agent 进入 idle；后续 async steer 到达时
   wakeDriver 未生效的可能路径：
   a. agent 处于 **maintenance phase**（如 persistence 快照/压缩任务持有 agent）→ send 的 wake 被 latch
      （agent.ts:173-181 "Maintenance and aborted drivers cannot deliver the wake: latch it for replay"），
      latch 重放条件是 maintenance 结束时 `wakeRequested && inbox.hasPending`——若 maintenance 长期不结束
      或 hasPending 判定失效，wake 永不重放 → 滞留。**01:50 正是大 turn（290）结束点，压缩/快照高发窗口！**
   b. agent 在 steer 前已被 dispose 且 agent/disposed 清理竞态（sessionNodes 残留死引用）——但 sync 探针
      成功说明当前 sessionNodes 条目是活的；不排除当时曾短暂死过、后被 sync 的 wakeColdTeam 重新物化。
3. **【次嫌】noWait 分支的 delivered 语义过宽**：deliver() 只验证 steerRelay 未抛错即回 delivered:true，
   不验证驱动真的醒来。**"送达 inbox" ≠ "回合已启动"**——这是 API 语义层面的诚实性缺口。

## 三、修复设计（分层，按 ROI 排序）

### F1（插件侧，低风险）：delivered 语义增证
noWait deliver() 成功后追加一步**驱动状态探测**：读 agent.status（idle→steer 后应翻 running，若
50ms 内仍 idle 则说明 wake 被 latch/丢弃）→ 在响应中附 `consumed: true/false` 字段。调用方（与
a2a_tasks 台账）据此把"delivered-but-not-consumed"显式化，监督 loop 可对 consumed:false 自动重发或升级。
- 改动点：index.ts noWait deliver() + a2a-client delivered 解析 + task-ledger 状态机（新增 NOT_CONSUMED 中间态）
- 验证：单测（fake agent latch 场景）+ 3081 实测（装包任务链）

### F2（插件侧，中风险）：async 投递的唤醒兜底
noWait 投递后调度一个**延迟复查**（如 90s）：若目标会话日志无新 turn/start（经 peers 的 card 活动
或本机 sessionNodes 观测），自动执行一次 sync 探针式 followup（短消息"消费你的 inbox 积压"）——
即把本次人工救活动作产品化。幂等：复查只在 ledger 仍 pending 时触发。
- 改动点：index.ts 投递尾部 + 定时器（effect 清理）；复用 wakeColdTeam 物化路径
- 风险：重入风暴（多任务并发复查）→ 用 per-session 单飞 + 全局上限

### F3（宿主侧，根治）：maintenance latch 重放审计
agent-loop 的 latch 重放条件 `maintenance.wakeRequested && this.inbox.hasPending`（agent.ts:158）
补硬保证：maintenance 结束的 finally **无条件**检查 hasPending（不依赖 wakeRequested——steer 排队的
消息本身就是 pending 的证据）；另在 turn/end→idle 的 kick finally（agent.ts:220）同样加
`inbox.hasPending → wakeDriver()` 无条件兜底。
- 归属：deepseek-harness 仓（非本插件）→ 需宿主 PR；本插件侧先落 F1/F2
- 验证：agent-loop 单测（maintenance 中 steer → maintenance 结束必开回合）

## 四、行动项

1. [插件] F1+F2 走 worktree PR（本仓 dsh-open-a2a-net）——下一步执行
2. [宿主] F3 提 deepseek-harness 缺陷+PR（借 0.5.x 线）
3. [缺陷卡] t-mt6nd0sq-hxuhj6 更新：根因实证补充（latch 窗口 + delivered 语义过宽），修复拆 F1/F2/F3
4. [观察] loop-97 继续盯 3081 验证回执；若再滞留，人工救活路径已验证（sync 探针即触发）
