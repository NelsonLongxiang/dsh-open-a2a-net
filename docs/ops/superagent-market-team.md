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
4. **把市场列进团队的 bot 名单**：在团队设置的 `bots.a2a` 里加入市场的会话句柄 `<market-zone>/<id8>`。A2A 调用方都按 agent 算；不在名单上的 agent 来信判为 `botNotListed`，宿主回一条 `rejected` 回执。只列在 `allowed.a2a` 不够。列在 bot 名单上的远端成员是调用方，不是工人：宿主不会把工单派给它（市场挂在画布上只是为了建链）。
5. **给一条接单规则，并把接单模式设为 `auto`**：agent 的请求是「推断」出来的候选，总工接单时必须写明它匹配团队的哪条已启用规则（`rules`），否则报 `notExplicit`；`acceptMode` 为 `observe` 时只记「本会接下」，不真的开单。最小可用的规则：

   ```json
   { "name": "market-dispatch", "text": "工作台市场派来的工作：按派工里写的要求去做；产出经市场的 MCP 落到市场；需要人决定的先提问。", "enabled": true }
   ```

   市场「打回重做」时，会在同一 context 里发一条新任务，正文第一行是「[打回重做] 原事项《…》（原任务 <task>）：理由」。再加一条规则，让总工把它接成新工单，而不是挂回已结束的原工单（挂回的话，新任务收不到进展和结果回执）：

   ```json
   { "name": "market-rework", "text": "市场打回的事项（正文以「[打回重做]」开头）：接成新工单重做，范围以打回理由为准；不要挂回已结束的原工单。", "enabled": true }
   ```

   这仍是总工按规则做的判断，不是宿主的硬保证；由宿主直接把打回接成新工单（市场名片声明 `reworkReturns`）要属主另行决定。

   这条规则放宽的是：总工可以不经人确认，就接下列在 bot 名单上的调用方（这里是市场）发来的、它判断属于这条规则的请求。谁能给这个团队派工、能派什么，由市场自己的权限判定把关；团队的工具边界、提问和审批照旧。只想接市场的部分工作时，把规则文字写窄（例如只写某个仓库或某类事项）。
6. **核对准入**：在团队宿主上，用团队的 CLI 身份执行：

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
- **来信的身份**：确认、回执、跟进都从团队宿主的 process face 发出。签名（Sig2/Sig3）里的调用方是宿主的区和名片地址，密钥是宿主名片密钥；请求体里的 `caller_session` 是宿主自己的会话标签（不带区，形如 `dsh-host-<8 位>`），只作说明。认身份看签名：签名方必须是登记过的这台宿主的名片密钥；它代表哪个团队说话看信封的 `onBehalfOf`（就是市场派工时用的画布地址，已被 Sig3 签进正文）。
- **画布变更通知 `POST /a2a/canvas-changed`**：宿主的画布有变化时，会给链接的对端发一个空正文、带签名的 ping，意思是「请重新读我的名片」。它不带内容、不欠回执、不占槽，发送方收不到 `{"ok":true}` 只记一条调试日志，不重试，也不影响成员状态。市场可以回 `200 {"ok":true}`，并在验签后重新拉取这台宿主的名片（例如刷新成员和名册）；回 404 也无害，只是名片要等缓存过期才会更新。
- **校验来信**：只认已登记对端的宿主密钥；要求 Sig3；回执的任务号必须由市场自己发出过的 `<task>` 派生（`ack-`、`receipt-`），跟进按 context 对应。

## 5. 检查清单

| 项 | 判据 |
|---|---|
| 名片能力 | 市场名片的 `capabilities.canvasMemberProvenance` 为 `true` |
| 互为 seed | 团队宿主的工作台里，市场所在宿主显示为已确认对端 |
| 成员已钉 | 团队画布成员里，市场一项带 `@<8 位指纹>`，没有「来源未确认」 |
| 准入 | `a2a-net admission <market-zone>/<id8> --json` 得到 `admitted: true`，规则是 `remote-ref-*` |
| bot 名单与规则 | 团队设置 `bots.a2a` 含市场句柄；已启用接单规则（`market-dispatch`）和打回规则（`market-rework`）；`acceptMode` 为 `auto` |
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
