# 同步回复：完成归属与等待用途（下一版本候选）

实现前规则边界：普通 Agent 回复直接复用 #306 / #114 S5 的 readingTurnReply、consumptionIndex 与 ownTurn 判定，不新增另一套 final 判别器。flush 超时、dead session、aborted/failed reading turn、textless 等 placeholder 在线上只表示 TASK_STATE_DELIVERED，不带 reply_final；已有出生与自动回执的 forwarded sync 带 receipt:routed，调用方保原 receiptExpected 欠账。plain sync 原无出生与自动回执，带 receipt:none，调用方记可见但非欠债的 receiptless 行，不制造幽灵债。除上述显式 receipt:none 非债路径外，只有真实且可归属到该任务的 ownTurn final 才可把普通同步答复记为已付。

native-teams 使用原有权威 round 的 settled/bridge 语义，不在本变更引入 Agent 归属判断；未 settled 的 round 仍明确 bridge 且不承诺本片段 A2A receipt。CLI mailbox 是完整邮件的接纳确认，不是 Agent final；原 mailbox 路径保持原语义，不由普通 COMPLETED 文本冒充阅读轮 final。普通转发节点不得把缺 reply_final 的 session COMPLETED 回答当已付。

HTTP waiter 的窗口只结束 HTTP 答复。自动 receipt 用途沿原 FinalWaiter 保存消费 floor 与既有阅读轮归属，等待原任务终态/取消/原 TTL 或插件卸载清理；不会靠调大全局 flushTimeout 来延长所有 HTTP 等待，不给 placeholder 或未消费消息合成正式回执，不新增任务生命周期状态。

本候选只修完成编码与等待寿命；followup 泛化 throw 后接纳未知、#369 已覆盖出生提交失败/重入 final、自动补出生、跨重启恢复 retry 定时器、验证器 meta R3 均不混入。高档 exact 非作者 PASS 后报全局，回复才能合并；不 tag/publish/部署。
