# 一个 superagent 团队接工作台市场（节点侧清单）

**交付对象**：给 superagent 团队所在宿主做部署的属主或运维
**适用版本**：`@nelsonlongxiang/dsh-open-a2a-net` 0.8.1-preview.13 起（包含 PR #601：答复被转进工单后，不再另收一条「团队未接」回执）；市场一侧需要声明 `canvasMemberProvenance` 的版本
**范围**：市场在 A2A 网上派工给一个团队、并收回确认、回执和跟进。团队会话怎么用市场的 MCP 工具，见 [superagent-mcp.md](superagent-mcp.md)。

> 本页的地址、名字和密钥都是占位符：`<team-host>`、`<market-url>`、`<zone>/<id8>` 等，按本机替换。不要把真实地址或密钥写进提交到仓库的文件。

---

## 1. 拓扑：市场是团队画布的远端成员

superagent 只接收运维已经建了链的调用方。宿主给来信判出的准入规则必须是下面几种之一：`canvas-shared`、`remote-ref-samezone`、`remote-ref-foreign`、`remote-ref-cli`、`cli-deposit`。只是互相加了 seed 的对端，即使调用了团队的 canvas 地址，也会被 superagent 判为 `unlinked`，不会进入团队。

所以要由运维**把市场的团队身份加成团队画布的远端成员**。市场的 zone 和本宿主不同时，准入规则是 `remote-ref-foreign`；相同时是 `remote-ref-samezone`。写入成员时，宿主会读市场的已验名片，钉住它的完整公钥（#334）。这要求市场的名片声明 `capabilities.canvasMemberProvenance: true`；没有声明，就加不进去。

| 方向 | 从 | 到 | 签名 |
|---|---|---|---|
| 派工 | 市场的名片身份 | `<team-host>` 的 `/a2a/direct`，目标 `<zone>/canvas/<name>` | Sig2 + Sig3，市场名片密钥 |
| 确认、回执、跟进 | `<team-host>` 的 process face，`onBehalfOf` = 市场派工时用的 canvas 地址 | 市场名片上的 `/a2a/direct` | Sig2 + Sig3，团队宿主名片密钥 |

## 2. 配置步骤

1. **两边互加 seed**：团队宿主的配置里加 `<market-url>`；市场一侧也加上 `<team-host>`。团队宿主要能拿到市场的已验名片，才能钉公钥，也才能把回执发出去。
2. **加远端成员**：在工作台（`/__dsh_a2a_nexus/`）打开团队画布，从成员选择器里**显式选中市场所在的宿主**，加入市场的团队身份 `<market-zone>/<id8>`。写入后它显示为 `<market-zone>/<id8>@<8 位指纹>`。如果显示「来源未确认」，说明名片没取到或没有声明能力，先回到第 1 步检查。
3. **团队绑定画布并开启回复**：在 superagent 团队设置里，把团队绑定到这个画布；a2a 来源用 `reply` 模式（`observe` 模式只看不回）。
4. **核对准入**：在团队宿主上，用团队的 CLI 身份执行：

   ```bash
   a2a-net admission <market-zone>/<id8> --json
   ```

   期望看到 `admitted: true`，`rule` 是 `remote-ref-foreign` 或 `remote-ref-samezone`。

## 3. 市场会收到什么（任务号规则）

`<task>` 指市场派工时的任务号。除跟进外，每条消息信封里的 `idempotencyKey` 都等于 `<task>`。context 沿用派工时的 `context_id`；派工没带 `context_id` 时，context 用 `<task>` 本身。

| 消息 | 任务号 | 信封 `disposition` | 结清派工那一行吗 |
|---|---|---|---|
| 确认（工单已接） | `ack-<task>` | `acknowledged` | 不结清，行保持欠账，7 天后过期 |
| 正式回执（结果） | `receipt-<task>` | `result`，带 `outcome` | 结清 |
| 正式回执（未成工单时，总工直接提问） | `receipt-<task>` | `attention`，不带 `outcome` | 结清，但不算完成 |
| 提问（成员的问题，带结构化 `question`） | `attention-<task>-<提问 id>` | `attention`，带 `question` | 不结清，行保持欠账；之后结果仍在 `receipt-<task>` |
| 跟进（通知；任务号放不下提问 id 时的提问） | `a2a-<hash>`，与 `<task>` 没有字面关系 | 无（普通路由） | 不结清；它自己欠市场一条回执 |

跟进只能靠 context 对回原派工。所以市场**每次派工都带 `context_id`，一件事项只用一个 context**。

## 4. 市场要履行的义务

- **对每条跟进回一条回执**：任务号 `receipt-<跟进任务号>`，信封 `{"outcome":"completed","idempotencyKey":"<跟进任务号>","disposition":"result"}`，正文一行（如「已转给人」）。这条回执只结清那条跟进，不动原工单。不回的话，那条跟进会一直占着团队宿主发往市场的一个排队槽，每个目标只有 3 个。
- **人的答复作为同一 context 里的新任务发出**，不要写在回执里。superagent 从不把回执当消息读，回执里的答复会被丢掉。答复会转进在办工单，交给成员；工单结束时，这个答复任务会收到一条 `completed` 回执。
- **校验来信**：只认已登记对端的宿主密钥；要求 Sig3；回执的任务号必须由市场自己发出过的 `<task>` 派生（`ack-`、`receipt-`），跟进按 context 对应。

## 5. 检查清单

| 项 | 判据 |
|---|---|
| 名片能力 | 市场名片的 `capabilities.canvasMemberProvenance` 为 `true` |
| 互为 seed | 团队宿主的工作台里，市场所在宿主显示为已确认对端 |
| 成员已钉 | 团队画布成员里，市场一项带 `@<8 位指纹>`，没有「来源未确认」 |
| 准入 | `a2a-net admission <market-zone>/<id8> --json` 得到 `admitted: true`，规则是 `remote-ref-*` |
| 端到端 | 市场派一单：先收到 `ack-<task>`，工单结束时收到 `receipt-<task>`，`outcome` 为 `completed` |
| 跟进闭环 | 成员提问时，市场收到 `a2a-…` 跟进并回执；答复作为新任务发回后，工单继续往下走 |

## 6. 之后会变的

已和市场约定、还没实现的部分（实现时以本仓库的评审结论为准）：

- 成员的产出 `artifacts` 由 superagent 填写。

已实现（[superagent-market-progress-roster](../design/superagent-market-progress-roster.md) P3）：团队宿主每 5 分钟、以及席位变化 30 秒后，给画布上名片声明 `capabilities.teamRoster: true` 的远端成员发一份名册（`[A2A roster]`，任务号 `roster-<宿主指纹前 8 位>-<毫秒>`，不欠回执、不占槽）。

已实现（[superagent-market-progress-roster](../design/superagent-market-progress-roster.md) P1/P2）：名片声明 `capabilities.progressReceipts: true` 的市场会收到进展消息 `progress-<task>-<n>`（带 `progress` 与子任务 `tickets`，不结清原派工，团队设置 `progressOff` 可关）；市场在自己那张工单的对话里接着发的话直接交给成员，不再经总工判定。

已实现（[receipt-envelope-fields](../design/receipt-envelope-fields.md)）：提问走自己的任务号 `attention-<task>-<提问 id>`，不欠回执，也不结清原派工；回执带接手人 `by`；`artifacts` 和结构化 `question` 的字段已可用。
- 节点名册：任务号 `roster-<指纹>-<at>`，同样经 `/a2a/direct` 发送。

这些落地后，第 3、4 节里关于跟进的过渡做法会随之更新。
