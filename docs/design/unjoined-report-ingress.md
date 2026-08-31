# 设计卡：未加入节点的 A2A 上报入口（a2a_report）

日期：2026-09-01。主人指令：「给未加入节点的一个 a2a task 上报入口，调查和分析」。

## 调查（现状入口面盘点）

| 入口 | 鉴权 | 未加入节点可用？ |
|---|---|---|
| 模型工具（a2a_route/teams/…） | join gate（未加入=禁） | 否——闸门即此用途 |
| `__dsh_a2a/join|leave|canvas|groups` 控制路由 | control key（controlRoute） | 否——模型不持 key |
| `/a2a/direct`（签名 peer 入站） | 签名卡 | 否——未入网=无卡=不可见 |
| 结论 | — | **未加入节点全暗：连"我还活着/我有事"都无法上报**——今日掉线事件中，离册席位无任何信号通道 |

## 设计

**单向上报，永不授予网络存在**——上报≠入网，治理零破窗：

- 新工具 `a2a_report`（join gate 豁免，文档化豁免理由：单向写、无网络存在、无路由权）
- 入参 `{ message, level?: info|warning|error, task?: string }`；消息上限 2000 字；每会话 30s 限频
- 上报落 **reports 环**（内存，cap 64）+ state 面 `reports` 块（监督席/面板读）
- 携带报告者身份（调用会话 id+label）——离册席位的报告自带"请收养我"信号
- error 级入 logger.warn

## 生命周期

未加入节点 → a2a_report → reports 环 → 监督席 state 面巡查 → 收养/重join 动作（GUI 手势）。

## 后置

- 远端未入网节点上报：无卡不可达，需弱信任入站面——另卡。
- 面板 feed 渲染 reports：另窗（面板=动态 only 的边界内评估）。
- 与 S4 审计环关系：reports 是业务信号，teamAudit 是准入治理——两环不混。
