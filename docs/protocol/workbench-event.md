# Protocol: 工作台事件信封 v1（workbench-event）

> **状态（2026-11-02，r2.1 + #172）：r2.1 已合入（#160）；接收侧来源信任与回写校验由 #172 修订。** r1 经独立复核，r2 已吸收：task_id 每次尝试唯一、-32003 不再算已送达、撤回取消、held 不算终态、token 时限与暴露面如实描述。这是跨项目接口：发送方是
> workbench-market，接收方是 dsh-open-a2a-net 主机上的接单节点。属主
> 2026-11-02 原话授权推进：「那你建议开始吧，我们已经讨论结束了，剩下的都交给你吧」。
>
> - **发送方实现**：NelsonLongxiang/workbench-market 仓 `server/src/workbench-events.ts`（[workbench-market#348](https://github.com/NelsonLongxiang/workbench-market/pull/348)，依赖 OriginClaim 绑定形式签名 [workbench-market#347](https://github.com/NelsonLongxiang/workbench-market/pull/347)）。
> - **接收方操作说明**：[`src/skill/references/intake.md`](../../src/skill/references/intake.md)。
> - **本仓接收侧**：信封仍走现有 `/a2a/direct`。宿主头部会显示其验证的 caller-origin 证明；接单节点另按本团队配置的 market origin 过滤事件，再校验回写 URL。

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

- **`human` 的准确含义**：持有 market 管理口令的人（或替他操作的本机 CLI）在任务中心的发布。匿名面和 MCP 都造不出 `human`；但口令持有者在本机用 curl 发布，同样记为 `human`。`submitter` 里的 `published_by` 是发布请求自报的，不是核实过的身份。
- 匿名表单、MCP 工具发起的提交，`submitter_kind` 永远不会是 `human`。
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

`event_id` 的线上格式必须匹配 `^wbe-[0-9a-f]{16}$`。接单方在将它用于回写路径前先校验该格式，禁止把信封中的任意值直接拼接进URL。

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

### 接收来源校验（#172）

- 本机在 `[A2A direct]` 宿主生成的首行标注来源证明：仅在非CLI、`claim.bound === true`、callerUrl的path为`/`且卡未重定向时写`已验证来源 <origin>`；非根路径、v1/unbound、CLI、claim mismatch均不获得此标记。路径前缀callerUrl仍可能按有效签名完成低信任投递，并会写`未验证（claim-mismatch）`；卡取回3xx仍拒绝。首行不包含第三方display metadata，正文自称不是证明。
- 接单节点仅在首行有bound/root-card证明且 origin 与本画布团队由属主/运维配置的 market origin 精确一致时处理为 market 事件；不符或未验证不创建issue、不回写。
- `reply.url` 是请求体字段，必须恰好匹配 `<已验证 origin>/api/workbench-events/<event_id>/decision`，且不含 userinfo、query、fragment。回写不得跟随重定向；内网明文 HTTP 仅在部署方确认后使用。
- 按 `event_id` 去重；先搜索issue，没有再创建并回写。若market回写返回accept/decline已有终态的409，响应不包含ref，接单方按event_id重新搜索GitHub issue，保留数字编号最小的一张，其余关闭为duplicate并相互引用；所有并发处理方使用同一排序判据。`context_id`只是关联标记，不保证投递至同一会话。
- token 已在投递正文和会话记录中，代入命令文本也会留下记录。`jq -n --arg` 和临时文件只减少额外留存，不是“不进历史/进程列表”的保证。

- **送达面**：a2a `/a2a/direct`，异步（`wait:false`）。
- **路由字段**：
  - `task_id = <event_id>.d<投递序号>.a<第几次尝试>`。每次尝试一个 id，原因有两个：上游的幂等键按 task_id 在整台主机范围内唯一，而且登记发生在「判定能否投递」之前。如果复用同一个 id，同一事件发给同机的两个团队会撞 -32002，被拒投后重试得到的 -32003 也不能证明上次真的送到了；
  - `context_id` 同第 4 节；
  - `caller_session = market/<来源台 node8>`。
- **去重**：代价是同一个事件可能送到两次。触发条件包括：对端超过 15 秒才应答（冷唤醒就是这样，上游在超时之后仍会把投递完成），以及响应丢失。**接单方按 `event_id` 去重。**
- **线程**：`context_id` 按事项唯一，本版里每个事项只发一个事件；以后同一事项的后续事件（如撤回、修改通知）会复用同一个 `context_id`。它只供事项关联，不选择或固定某个agent会话，也不保证投递路由落入同一会话。
- **重试**：
  - 退避间隔依次为 1m、5m、15m、1h，失败 5 次记 `dead`；
  - 对端返回 -32001（载荷超限）、-32002、-32003（幂等冲突，见 [routing.md](../../src/skill/references/routing.md) 幂等一节）时，直接记 `dead`，不重试。每次尝试的 id 唯一，所以后两者一旦出现就是异常；
  - 发送前按实际请求体计算大小，超过 `/a2a/direct` 的传输上限时一次即记 `dead`。
- **来源签名（OriginClaim）**：
  - 接单节点只有宿主首行标记满足 `claim.bound === true`、callerUrl path 为 `/`，且该 origin 与团队配置的 market origin 完全一致时，才处理为market event。path-prefixed CLI/deployment claim仅作为低信任delivery，不能获得origin marker；第三方显示名不进入header。首行不是对 `submitter_kind` 或body contents的背书。详情见[intake.md](../../src/skill/references/intake.md)；
  - 主签名用绑定形式，即 `X-A2A-Caller-Sig2` 加 `X-A2A-Caller-Aud`，见 [delivery-origin-auth.md](delivery-origin-auth.md) §2.1；
  - 默认同时带 v1 的 `X-A2A-Caller-Sig`，以兼容未升级的对端。全舰队关窗后，market 设 `A2A_ORIGIN_CLAIM_UNBOUND=off` 停发；
  - #64 关窗后只认绑定形式。

## 6. 投递状态（market 侧，每个目标一行）

- `held`：派发开关没开（任务级或中心级）。这一行只记录「本来会派给谁」，管理员 release 后转为 `pending`。这是「先观察、后自动」的观察态。
- `pending` → `sent` | `dead`。
- `cancelled`：任务撤回时，还没发出的投递（`held` 或 `pending`）与撤回在同一事务里取消；撤回后 release 返回 409。**正在发送的那次不取消**，因为它可能已经到了对端。撤回接口会如实返回 `in_flight_deliveries`；这次投递落定时记为 `sent`，并另记一条 `sent-after-withdraw`。本版不向接单方发撤回通知。
- 同一节点同时有 `notify` 和 `both` 两条绑定时，按节点去重，只投一次。
- task-center 事件没有任何目标绑定时，事件记为 `unrouted`。这也是终态，不会静默消失。app-data 没有通知绑定时不建事件：它不是人类事件，数据真源在 `app_data`。

## 7. 决定（接单节点 → market）

```
POST /api/workbench-events/<event_id>/decision
{ "token": "…", "decision": "accept|decline|ask", "reason": "≤500 字，必填", "ref": "可选，如 GitHub issue URL", "by": "可选，节点名" }
```

- **鉴权**：用投递里的 token，不需要额外绑定。
- **暴露面（如实描述）**：token 会以投递正文的形式进入接单会话记录；同主机可读该会话日志的成员（例如经 `/a2a/log`）也能看到它。token 是本次投递回写凭证，不是身份证明。HTTP 部署会在传输中明文暴露token及claim，不提供防被动监听的强证明；应优先使用HTTPS，内网HTTP须由部署方明确接受这一边界。约束如下：
  - token 不对或事件不存在一律返回 404，不泄露事件是否存在；
  - 只对 `sent` 的投递有效：`pending` 的投递回写返回 409，可以稍后重试；`dead`、`cancelled` 的投递也返回 409，但不会再变；
  - 自送达起 7 天有效，之后返回 410；
  - `decided_by` 是自报的。
  - `accept`/`decline`已有终态时再写返回409，响应为`{error, decision}`且不返回ref；接单方按`event_id`重新搜索issue，保留数字编号最小的一张，其余标记duplicate并互相引用。不要依赖管理员专有事件GET或本地created_at。
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
  - 所有投递都处于 `sent`、`dead` 或 `cancelled`。
- **`held` 不是终态**，它表示等人确认。从投递行的创建时刻（`created_at`）算起超过 72 小时仍是 `held`，判为不通过，免得被遗忘的 release 永远满足判据。
- **决定**：对 `sent` 的投递再看决定，取值为 `accept` 或 `decline`，或者超时仍未决定。超时未决定可以看到，但不算违约。

这条判据由验证器判定（market 侧快照上的叶判据），不在本仓的运行时代码里强制。

## 10. 不在本版范围

- 节点身份（会话之外的稳定节点名）：见 `docs/design/node-identity.md`（另案，高档）。在它落地之前，接单节点就是一个已加入画布队的现有会话。
- 表单提交的人类会话：等 market SSO v2。
- 接单节点自动开 issue 的工具化：本版靠节点按 intake.md 手动执行。
