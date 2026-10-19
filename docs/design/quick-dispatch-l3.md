# L3 Quick-Dispatch — 设计提案（0.6.8 候选，待评审）

状态：**设计稿，未实现**。L1/L2 已随 0.6.7 落地（点击即达：本机广播切会话 / 跨机开对端 GUI）。
L3 是第三档：不打开任何会话，从工作台直接把一句话任务派给某个队。

## 动机

- 目录/台账里看到某个队欠回执或处于待命，想立刻追问一句，而不必进会话里手敲 `a2a_route`。
- 面板侧的「派单起草」目前是复制粘贴流；L3 把它变成一键发送。

## 形态

工作台目录行 / 检查器内新增「快派」动作 → 弹出行内表单（目标队锁定为该行、正文一句话、发送）→
`POST /__dsh_a2a/dispatch`，body `{ team, message }`，响应 `{ ok, taskId?, reply?, error? }`。

后端实现即复用 `a2a_route` 工具的派发主干（dispatchLocalCandidate → failover 缝 → 目录派发），
以**宿主 initiator 面**为 caller。`async: true` 固定（fire-and-forget 语义），成功即返回 taskId。

## 需要评审的四个点（这是本档"单独评审"的原因）

1. **身份与授权**。L1/L2 只动浏览器内的导航，L3 花费的是宿主身份：消息以宿主 initiator 名义出网。
   现有控制路由（join/leave/canvas）的 apiKey 闸同样适用，但 dispatch 更敏感——apiKey 为空的内网
   节点等于无闸。提案：apiKey 为空时**拒发**（与 canvas 路由的宽松相反），并在响应中说明配置项。
2. **CSRF 面**。任何浏览器页面都能对本机控制路由发 POST。提案：要求 `Origin`/`Referer` 与宿主
   自身同源，否则 403（对 canvas 路由同样适用，可一并加固）。
3. **审计与限速**。每次 dispatch 记入活动环（已有）；另按 a2a_report 的同文窗口模式限速
   （同 team 同文 10min ≥3 次拒发）。账本照常记账（taskId/team/peer）。
4. **回执语义**。initiator 面无 callback address → 全部 `receiptExpected:false`（fire-and-forget），
   台账呈现为免回执行而非债务。若将来要同步答复，加 `wait:true` 变体再评。

## 不做的事

- 不绕过 teamScopeRouting / allowlist 之外的任何既有准入——派发主干与 a2a_route 完全同路。
- 不在远端节点上做任何本地唤醒（与 0.6.6 远端成员语义一致）。

## 验收草案（若批准）

- wire 测试：本机 live 队 / 远端-only canvas 队 / apiKey 空 → 拒 / 非同源 POST → 403 / 限速拒发。
- 工作台 DOM 测试：行内表单、发送成功态、错误态。
- 3081 候选 + 用户校验（发布闸门不变）。
