# 路由契约：接纳与接收方记账的独立观察

## 兼容字段，不新增任务生命周期状态

正常已记账的响应维持原契约。Agent 已接纳输入但接收方任务出生行未提交时，响应是 HTTP 200，并明确包含：

```json
{
  "routed": true,
  "delivered": true,
  "task_status": "TASK_STATE_DELIVERED",
  "receiverBookkeeping": "failed",
  "receipt": "routed",
  "note": "已送达、接收方记账失败，请对账，不要重派。Delivered, but receiver bookkeeping failed; reconcile the original task, do not redispatch."
}
```

还保留原 task_id、team、context_id；转发节点保留 forwarded 标记及该观察。receiverBookkeeping 目前唯一合法值是 failed；缺省仍是旧契约，不能据字段缺省承诺端到端事务性。这个字段只说明已接纳输入后的出生提交观察，不是新的 task_status、不是失败任务的完成状态，也不是普通重试建议。

接收方不承诺已消费，不发 reply_final，不按本次同步 final 结清调用方；即使读取本任务的 final 在提交前重入产生，也不能覆盖该观察。接纳前的拒绝、验签、权限/容量门及正常同步 final 语义不变。

## 调用面与对账纪律

- a2a_route client 将观察透传，显示相同的中英文对账提示，不显示为普通已完成。
- a2a-net route 文本显示“已送达、接收方记账失败，请对账，不要重派”；--json 保留原字段。CLI 以已送达语义退出 0，不走网络失败重发。
- 调用方原有欠账仍是 pending，receiptExpected 保持 true；同步转发不得当作 receiptless 成果归档。字段不伪造回执、不替会话确认、不结算。
- 不因修复磁盘、重启、重复同一请求而自动重投工作或补正式回执。应围绕原 task 对账，不能换 task id 盲重派。

## 投递映射与孤儿诊断

既有 taskDeliveries 对应仍用于定位同一 Session inbox occurrence，沿用既有 reserved/enqueued/claimed/cancelled/failed；**不增加状态枚举或平行持久队列**。可选元数据 taskExpected:true 表示该 occurrence 的用途需要业务任务出生行。它在首次投递前随原映射提交，唯一用途是把业务任务映射与 receipt-only、没有 birth 的同步投递区分开；不能作为新的任务或授权事实。

没有该元数据的旧映射用途未知，不能在升级时逆造其用途或把全部历史映射判作缺账。新元数据只接受 true 或缺省；用途未知仍保留原映射防重/撤回能力，但不计入确定孤儿数。

对用途明确、已 enqueued/claimed、且既没有任务行也没有归档行的映射：

- deliveryBookkeeping.orphaned 每次由既有集合差实时计算，重启从原映射恢复后仍可看到。receipt-only / 用途未知 / 已取消 / 正常任务及归档不计为孤儿。
- 映射不是业务任务：不进入 tasks/archived，不制造 receipt debt、不改变守恒统计；提醒遍历任务集合，不把映射当待办。
- claim 只更新对应观察，不补 task；withdraw 通过原 MessageId 定位队列项，或按已 claim 的既有停止通知处理，不把动作解释成结清原业务。
- 同一权威/同一指纹重放已有孤儿 occurrence，返回同一明确观察，不再次 followup。不能利用这个观察绕过原验签/准入或改正文复用标识。

## 状态面

state、a2a_status 和 CLI status 可见 deliveryBookkeeping：

- orphaned：当前明确孤儿映射数；持久来源为原映射，不额外落诊断表。
- failures：当前插件实例接纳后出生提交失败观察次数，重启归零。
- lastError（可选）：当前实例最近一次的 at 与 safeObservationCode 允许的 code，无路径、正文或异常原文。诊断不是业务提交，也不据此产生任务。

## 明确限制与非目标

本修订不选择“磁盘恢复后自动补记出生行”的可选方案：不新增持久保存原任务/授权/body 的恢复队列，现有映射不足以无损重建完整任务出生事实。修复磁盘不等于自动恢复债权一致性；接收方孤儿可能仍需基于原 task 的人工对账。调用方债保留，不能以此限制为由伪结清。

保持既有映射容量和保留窗口，不提供无限历史去重。超出窗口后的归档/回收不被表述成 task 已完成。旧 #351 提醒最后一次送达观察提交失败的保守降级不在本修订内。

## 工程验收索引

[双路径与真实调用方故障用例](../../tests/mesh/admitted-bookkeeping.spec.ts) 覆盖异步、同步 CLI 转发（含读取轮 final 重入）、调用方 pending、孤儿恢复、独立 claim/withdraw、idle reminder 空任务集合、相同请求不再投递。故障由隔离的真实账本写入口抛出，不使用生产数据。

[client 用例](../../tests/unit/client.spec.ts)、[CLI 用例](../../tests/unit/cli-args.spec.ts)、[映射恢复用例](../../tests/unit/gh356-followup-delivery.spec.ts) 分别守文案/标记、用途恢复、防盲重放。反向变更逐项检查响应观察、caller 债、恢复计数、防重放与显示。这些是工程测试，不是业务验证器 spec-run。高档非作者精确头确认后，仍须全局回复才能合并；不部署、不改生产配置、不补历史积压。
