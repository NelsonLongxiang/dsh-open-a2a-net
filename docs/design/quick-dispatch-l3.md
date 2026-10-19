# L3 Quick-Dispatch — 设计与实现记录（0.6.9；0.6.10 裁决更新）

状态：**已实现**（0.6.9 候选，在 3081 等用户校验，发布闸门不变）。前史：L1/L2 随 0.6.7
落地（点击即达），0.6.8 把 L2 的 window.open+postMessage 重试改为 `?dsh-a2a-open=<句柄>`
深链（响应式正确形态）。L3 是第三档：不打开任何会话，从工作台直接把一句话任务派给某个队。

## 0.6.10 裁决：跳转全面禁止，快派为唯一到达原语

用户令（2026-10-20）：「禁止任何跳转，全部使用响应式布局」。L1（BroadcastChannel 广播
GUI 开会话）与 L2（深链开对端 GUI）连同接收面一并撤除——工作台内一切交互内联完成：
行点击 = 选择检查器，检查器里的「快派」= 唯一跨面到达原语（本地会话队 / canvas 队 /
远端队句柄统一走 dispatch 派发链，零导航）。GUI 面板内 FeedRow 的 openSession 保留
（面板原生、GUI 内原地切会话，非跳转）。「打开工作台」入口按钮保留（进入工作台本身的
唯一 deliberate 导航；工作台内无任何跳转）。

## 动机

- 目录/台账里看到某个队欠回执或处于待命，想立刻追问一句，而不必进会话里手敲 `a2a_route`。
- 面板侧的「派单起草」目前是复制粘贴流；L3 把它变成一键发送。

## 形态（已落地）

检查器（canvas 队、远端行）新增「快派」表单（目标队锁定、正文一句话、发送）→
`POST /__dsh_a2a/dispatch`，body `{ team, message }`，响应即 a2a_route 的规范形状
（`{ ok, task_id, task_status, team, reply?, error? }`）。表单走 draftForm 技巧：
草稿与结果行跨 3s poll 存活；`deps.dispatchQuick` 缺省时整块隐藏（优雅降级）。

后端实现是**共享主干**而非复制：`routeTrunk(args, agent, signal)` 承载 a2a_route 工具与
dispatch 路由的同一套闸与派发序（agent-less 审计 → join gate → teamScopeRouting →
caller 解析 → 本机派发 → canvas 远端缝 → 目录派发 → routeVerdict）。宿主面
（agent === undefined）caller label 回落裸节点队——「能发即能收」不变量（0.5.57 修复 #1
同族）。`async: true` 固定（fire-and-forget 语义），成功即返回 taskId。

## 四个评审点的裁决（与原提案的差异）

1. **身份与授权**。原提案「apiKey 为空时拒发」**被否**——既有控制面信任模型
   （`controlAuthorized`：apiKey 非空则常时比较 X-API-Key；空则同源或 loopback 放行）
   已覆盖 join/leave/canvas 全部控制路由，dispatch 单独更严只会造成事实上的双标准。
   dispatch 照走 `controlRoute` 包装：与 canvas 同姿态。agent-less 面**有审计**
   （`recordTeamAudit('agent-less', …)`），且 owner 可用 `gateAgentLessCalls:'refuse'`
   一键关停宿主面路由——比 apiKey 拒发更精准（拒的是身份面，不是整个控制面）。
2. **CSRF 面**。原提案的同源检查**已在既有实现里**（`controlTrustedWithoutKey`：
   Origin 必须等于 `http://<host>`，loopback 客户端豁免）——无需新代码，canvas 路由
   同样早已受益。apiKey 非空时浏览器须带 X-API-Key（同源页面无钥仍拒）。
3. **审计与限速**。限速取简：**同客户端 5s 窗口一条**（`dispatchLastAt`，镜像
   a2a_report 的 reportLastAt 模式）——本面是人类手势，防的是失控页面而非会话循环，
   故未搬 10min 同文熔断。消息上限 4000 字符。账本照常记账（taskId/team/peer），
   活动环照常记录。
4. **回执语义**。宿主面 caller=裸节点队 → callbackAddress 生效、receiptExpected 正常
   ——回执可路由回节点队面。原提案「全免回执」作废：0.5.57 修复 #1 之后宿主面
   本就有可路由回宿。

## 不做的事（维持）

- 不绕过 teamScopeRouting / allowlist 之外的任何既有准入——派发主干与 a2a_route 完全同路。
- 不在远端节点上做任何本地唤醒（与 0.6.6 远端成员语义一致）。
- HTTP 等待上限 20s（`AbortSignal.timeout`），远低于 routeTimeoutMs——本面要的是送达
  确认，不是答案。

## 验收（已过）

- wire 测试 `tests/wire/quick-dispatch.spec.ts` 5 例：本机 live 送达+台账 keyed canvas 队 /
  远端成员 failover（线上带成员句柄、caller_session=裸队）/ apiKey 闸（错钥 401 对钥过闸）/
  必填+4000 上限+5s 限速 / gateAgentLessCalls=refuse 拒发。
- 工作台 DOM 测试 `nexus-stage/tests/workbench-dom.spec.ts` 4 例（28/28 内）：canvas 队
  表单按键队派发+note 报 taskId+草稿跨 poll / 远端行表单 / 拒绝态显因 / dep 缺省隐藏。
- 3081 候选 + 用户校验（发布闸门不变）。
