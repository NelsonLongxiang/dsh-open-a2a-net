# 宿主接纳观察（下一版本候选）

Refs #373

选择失败形状上的观察字段 `acceptance:"unknown"`，不采用 -32005：无法证明插入不能表述为已落地继续执行。此为非生命周期观察，不新增任务状态；响应仍为失败，明文“接纳状态未知，请用原 task id 对账，不要换 id 重派”。新 CLI / a2a_route 保留并显示该提示，不按此结果继续候选 failover，reserved 身份保留防重投。旧客户端仍读失败及同一明文提示，不能承诺其已实现新字段的停 failover 规则，建议升级，不将未知当可安全重派。

仅在本次调用抛异常后，以调用前已 reserve 的精确 sessionId / MessageId，在同一会话的 inbox 或已接受 spliced/claim 事件中找到时才标记 `acceptance:"inserted"` 并返回已有 DELIVERED：“已送达、后续处理未确认，请按原 task id 对账，不要重派”；这是第一层宿主接纳，不证明消费、业务完成或磁盘 fsync。不得按时序/异常文字/任务摘要推断；当前 inbox 未找到不是未插入证明。已知调用前缺能力、重复 MessageId 或输入构造校验失败保持原失败，不送出 DELIVERED。

可证接纳仍按既有出生提交规则处理；出生失败继续 receiverBookkeeping:failed，不伪造自动回执。抛异常后恢复的接纳不启动自动回执或 nudges，保留原 task 对账；不因异常同步失败重派输入。plain sync 不新增出生，仍按 receipt:none；已有出生的路径保债。未知观察不改成 completed 的幂等 outcome，不清 reserved 对应。

标准 Agent/Loop 0.2.1-rc.4 的隔离证据私交，复现脚本不进入公开仓。0.2.2-rc.1 仅有精确发布包源码判断，未运行验证。高档 exact 非作者评审后报全局，回复后才能合并；不进0.7.0、不tag/publish/部署。
