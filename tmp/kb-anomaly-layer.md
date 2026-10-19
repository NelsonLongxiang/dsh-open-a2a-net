# 跨机异常形态学测试层方法（dsh-open-a2a-net，2026-10-18 实证）

## 模式
线上战役捕获的异常形态（4 端点 3 形态 + 同机结算怪象）不留在报告里，落成 mesh 层可回归的场景——每个场景一个被捕获的真实故障 + 一条闭合可观测断言。测试即异常档案。

## 七形态（mesh-anomalies.spec.ts，6 用例，全绿）
1. 挂死对端（accept-never-answer）：真实 15s HTTP 预算切断，abort 细节进 probe 行，ms≥15000。
2. 混合舰队一次诊断：单 probe 报告分形——live+team / expired card / unreachable(ECONNREFUSED 层，与卡片裁决不混层)。
3. 非可路由 caller fire-and-forget：行可见不欠债（receiptExpected:false settleable:false），迟到正式回执仍结算。
4. 孤儿回执：不崩溃不落 archive，账本前后一致。
5. 回声结算 F5：消息点名 task id 即结算，archive 带 '(settled by content echo)' 审计标记——钉为契约防回退成幽灵债务。
6/7. 死信+复活：taskStaleTtlMs（新 config 旋钮，默认 24h，测试注入亚秒）到期翻 dead+reason unconsumed+deadAt；迟到回执复活进 archive。

## 工程要点
- config 缝先行：把墙钟常量（如 stale TTL）提成可注入旋钮，生命周期测试才不必等 24h。
- 慢测诚实预算：挂死用例独占 ~20s 是验证真超时的必要代价，it 显式 25s，文档标注。
- 默认值清单测试（materializes every default）会钉住每个新旋钮——加旋钮必须同步补清单。
- 幽灵/挂死节点不入被测舰队时，用 probe 的单 URL 契约（url 参数）避免 boot gossip 旁路污染与 dispose 拖尾。
