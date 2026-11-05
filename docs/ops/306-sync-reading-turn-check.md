# #306 同步答复任务归属修复记录

档位：高；未合并、未发布、未改现网。基线 fd29f27。
本记录为工程测试证据，不代替正式 RC spec/run 发布验收。

## 生产代码边界

routeIntoAgentFor 在注册同步等待前读取 floorAtRegistration；有非空 taskId 时，将 {taskId, steerFloor: floorAtRegistration} 传给 registerFinalWaiter。
注册至 steer 是同步代码，没有新增 await。归属等待沿既有 consumptionIndex 和 readingTurnReply，读取该 task id 的 user/message 后、其自身 turn/end 前的完成答复。没有 taskId 的旧调用保持原回落路径。

保留 #305 的 ownTurn/reply_final 复核：只有本任务自己的完成答复可标为最终；自动回执依旧完整保留并由原逻辑标记重复。未消费、失败/中止轮次和 placeholder 不成为本任务完成证据。

## 夹具修复不是放宽判据

原 wire/mesh 假会话只追加 assistant/message、不记录带 steer 头的 user/message。它们不满足真实会话消费日志契约。改造为先记消费，再给原 canned 答复。

共享 mesh harness 新增 silent 选项，显式记录 steer 而不消费或回答，给 queue-cap、work-status、未结账恢复等测试使用。已有安全/准入/持久化断言保留；OriginClaim header 测试按原 task 头查原始投递，不把之后的自动回执当成被测入站。

## 可复跑证据

- pnpm verify：真实 exit 0（set -o pipefail，未用 tail 掩盖退出码）。root 1395 passed / 6 skipped，build-layout 4 passed，nexus 326 passed；tracked dist 零差异。
- tests/mesh/gh306-sync-attribution.spec.ts：3 passed。旧同号历史、无关轮次、前缀相似但不同任务编号都不能抢答；本任务完成轮次后即使紧跟下一轮，也只回本轮文字；failed/aborted 消费轮次不给部分或后续文字冒充完成。
- tests/mesh/cli-forward-receipt.spec.ts：F4 从断言 unrelated other work finished 翻转为真答案；F5 紧接下一轮场景也必须拿本轮真答案。同步真答后的原回执按既有规则标 sync-answered、完整保留。
- 判别性回退探针（2026-11-05 11:32 +08）：只临时删除同步 waiter 的 attribution 参数，F4 与 nextTurn=true 的 F5 立刻各 FAIL，分别重现无关工作文字和下一轮文字。随后原样恢复参数，F4/F5 与新增 3 例共 6 passed。探针无提交残留。
- typecheck、diff --check 通过；架构锚按 fd29f27 重锚（4 moved，0 misses/problems）。

## 升级影响

见 docs/release.md 的 0.6.41 候选节。0.6.40 已独立冻结并发布，不含本修复。忙碌目标更可能超过既有 15 秒同步传输等待，得到 -32005/DELIVERED-UNSETTLED，而不是错误文字；用原 task id 对账，async + inbox 收真回执，不重派新任务。

## 未声称完成的内容

生产实例未替换或重启；高档放行等待评审席对送审 SHA 的非自我 PASS。本 PR 不附带放宽准入、改超时默认值或修改宿主 DSH 源码。
