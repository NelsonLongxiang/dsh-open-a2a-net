# Protocol: 工作台事件信封 v1（workbench-event）

> **状态（2026-11-02）：提议，高档，等独立复核。** 这是跨项目接口：发送方是
> workbench-market，接收方是 dsh-open-a2a-net 主机上的接单节点。属主
> 2026-11-02 原话授权推进：「那你建议开始吧，我们已经讨论结束了，剩下的都交给你吧」。
>
> - **发送方实现**：NelsonLongxiang/workbench-market 仓的 workbench-events 模块（PR 号待补）。
> - **接收方操作说明**：[`src/skill/references/intake.md`](../../src/skill/references/intake.md)。
> - **本仓代码改动**：无。信封走现有的 `/a2a/direct` 送达面和 OriginClaim 来源签名，本仓不新增字段解析。

## 1. 动机

需求目前靠属主手动注入到各团队的指定节点。workbench-market 是外部输入面，已经有「表单提交即推送」，但还缺三样：

- 推送只发一次，没有重试，丢了也没有记录；
- 没有线程号，同一事项的后续提交各推各的；
- 分不出提交的是人还是 agent。

本协议给这一层定一个信封：人提交的事件可靠地送到对应团队的接单节点，由接单节点做出决定，决定有记录。

## 2. 责任划分

| 判定 | 由谁判 | 依据 |
|---|---|---|
| 是不是人提交的 | **market** | 写在 `submitter_kind` 里 |
| 送没送到、来源是谁 | **a2a**（本仓） | `/a2a/direct` 准入 + OriginClaim 验签 |
| 接不接 | **接单节点** | 回写 market 的决定端点 |
| 工作记录 | **GitHub** | 接单后开的 issue |

**a2a 这一侧只负责送达和验来源，不判断是不是人提交的。** 主机把 `submitter_kind` 当作 market 的声明原样交给会话，不解析，也不据此放行或拒绝。准入仍是现有规则：market 的句柄必须是目标画布队的远程成员（或有组织关系），没有成员关系就拒绝。这些都没有变化。

## 3. 两种来源

| source | submitter_kind | dispatch | reply |
|---|---|---|---|
| `task-center`（任务中心人工发布，管理口令把关） | `human` | `true` | 有 |
| `app-data`（自产台表单提交，匿名面） | `unverified` | `false` | 无 |

- agent、MCP、CLI 发起的提交，`submitter_kind` 永远不会是 `human`。
- SSO v2（market #221）覆盖到表单提交之前，`app-data` 一律标 `unverified`，只作数据通知，不触发派发。

## 4. 信封字段（task-center）

```json
{
  "type": "workbench-event",
  "v": 1,
  "event_id": "wbe-<16 hex>",
  "source": "task-center",
  "workbench": "<目标 SOP 台 slug，解析不到时为 task-center>",
  "item": "task:<task id>",
  "context_id": "wb:task-center:<task id>",
  "submitter_kind": "human",
  "submitter": "human:<published_by>",
  "form_version": 1,
  "data_sha256": "<tasks.material_sha256>",
  "created_at": "<ISO>",
  "dispatch": true,
  "task": { "id": 1, "title": "…", "intent": "…", "references": "…", "deliverable": "…", "target": "…", "due": "…" },
  "reply": {
    "url": "<MARKET_PUBLIC_URL>/api/workbench-events/<event_id>/decision",
    "token": "<每个投递目标各一枚，明文只出现在这一次投递里>",
    "decisions": ["accept", "decline", "ask"]
  }
}
```

`app-data` 来源保留旧的 `type: "app-data-submitted"` 及 `slug / id / data / created_at / hint` 字段，兼容现有接收方。在此基础上增加下列同名字段，不带 `reply`：

- `v`
- `event_id`
- `source`
- `workbench`
- `item`
- `context_id`
- `submitter_kind`
- `submitter`
- `data_sha256`
- `dispatch: false`

## 5. 传输

- **送达面**：a2a `/a2a/direct`，异步（`wait:false`）。
- **路由字段**：
  - `task_id = event_id`；
  - `context_id` 同第 4 节；
  - `caller_session = market/<来源台 node8>`。
- **线程**：同一事项（同一 `context_id`）的后续事件进入同一线程，不新开任务。
- **重试**：
  - 退避间隔依次为 1m、5m、15m、1h，失败 5 次记 `dead`；
  - 对端返回 -32003（同 task_id 重放，见 [routing.md](../../src/skill/references/routing.md) 幂等一节）时，按已送达处理。
- **来源签名（OriginClaim）**：
  - 主签名用绑定形式，即 `X-A2A-Caller-Sig2` 加 `X-A2A-Caller-Aud`，见 [delivery-origin-auth.md](delivery-origin-auth.md) §2.1；
  - 未关窗期间，同时带 v1 的 `X-A2A-Caller-Sig`；
  - #64 关窗后只认绑定形式。

## 6. 投递状态（market 侧，每个目标一行）

- `held`：派发开关没开（任务级或中心级）。这一行只记录「本来会派给谁」，管理员 release 后转为 `pending`。这是「先观察、后自动」的观察态。
- `pending` → `sent` | `dead`。
- 事件没有任何目标绑定时，事件记为 `unrouted`。这也是终态，不会静默消失。

## 7. 决定（接单节点 → market）

```
POST /api/workbench-events/<event_id>/decision
{ "token": "…", "decision": "accept|decline|ask", "reason": "≤500 字，必填", "ref": "可选，如 GitHub issue URL", "by": "可选，节点名" }
```

- **鉴权**：用投递里的 token，不需要额外绑定。拿到这枚 token 的只有被投递的节点。
- **状态**：
  - `ask` 不是终态，之后还可以改为 `accept` 或 `decline`；
  - `accept` 和 `decline` 是终态，再写返回 409。
- **日志**：每次决定都追加进只增日志。
- **token 管理**：token 只用在这次回写，不进 GitHub issue，不进公开评论，不转发给第三方。

## 8. 映射（哪个工作台到哪个团队）

- 用 market 现有的 `bindings` 表：取目标 SOP 台上 direction 为 `notify` 或 `both` 的绑定，`agent_node` 写画布队名（`<zone>/canvas/<name>`），`notify_url` 写该主机地址。
- 目标 SOP 台没有通知绑定时，退回 `task-center` 自己的通知绑定，作为默认接单团队。
- 对端主机把 market 加为画布远程成员，这是投递准入的另一半（见 [membership.md](../../src/skill/references/membership.md) 画布队）。
- 画布队以 a2a 画布为准，market 绑定只写画布队名，不在两边重复维护成员。

## 9. 终态判据

- **事件终态**：每个 `human` 事件最终必须落到以下之一，不允许没有下文：
  - `unrouted`；
  - 所有投递都处于 `sent`、`dead` 或 `held`。
- **决定**：对 `sent` 的投递再看决定，取值为 `accept` 或 `decline`，或者超时仍未决定。超时未决定可以看到，但不算违约。

这条判据由验证器判定（market 侧快照上的叶判据），不在本仓的运行时代码里强制。

## 10. 不在本版范围

- 节点身份（会话之外的稳定节点名）：见 `docs/design/node-identity.md`（另案，高档）。在它落地之前，接单节点就是一个已加入画布队的现有会话。
- 表单提交的人类会话：等 market SSO v2。
- 接单节点自动开 issue 的工具化：本版靠节点按 intake.md 手动执行。
