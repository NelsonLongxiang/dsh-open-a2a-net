# 交接报告：W7 slice 1——face 回放翻译按 delivery 分岔（2026-08-29）

> 交接范围：本仓在 W7 战役中的先行片（!39）已合并发版；本文交付其契约语义、回归面与下一位维护者的注意项。
> 设计权威：dsh-graph-loop `docs/w7-remote-recovery-table.md`（!35，其 master `46e1475`）；本仓配套文档 `docs/native-teams-bridge.md`（已随 !39 回写）。

## 一、结论速览

| 维度 | 状态 |
|---|---|
| master | `9ec0a20`（!39 合并提交） |
| 版本 | **0.5.34**（已发 jf-tech 私仓 latest，tarball 直验过） |
| 本日落库 | !39：bridgeFace 回放翻译 delivery 分岔 + conflict 字面 + 测试翻转 + 双文档回写（R1 APPROVE + README 补一行后合） |
| 门禁基线 | typecheck×2 / vitest 333 / build 全绿 |

## 二、契约语义（本 PR 的产品本体）

`bridgeFace.submit`（`nativeTeamsA2a` 服务键）对对端 409 幂等判决的翻译**按 delivery 分岔**：

| 形态 | 行为 | 理由 |
|---|---|---|
| `sync` + `-32003` 回放 | **throw**，文案携带 `-32003` 字面 | sync 调用方（graph-loop 的轮、tool-route 同步路）消费不了 acceptance——句柄确认文本会让 null-verdict 节点被结算成"正常完成"（误结算窗口，本 PR 闭合） |
| `async` + `-32003` 回放 | `accepted`（不变） | fire-and-forget 语义下"先前尝试仍权威"即接受，诚实 |
| `-32002` 冲突 | throw，文案携带 `-32002` 字面 | 同键异载荷是调用方 bug，任何 delivery 都终态 |

**为什么是"文案字面"而不是结构化 code**：下游 native-teams 的 `submitFailedError` 只拼 cause 的 message（结构化 `.code` 被剥）、`RoutePlaneError` 类身份过不去（零值导入律）、`ROUTE_ERROR_CODES` 全字符串而消费端 `extractCode` 只认数值——**throw 文案内的冻结码值字面是唯一活着跨越包装层的分类通道**。这是对"message 禁止下游解析"的已裁定例外（W7 设计稿 §4.4），round-trip 测试是唯一护栏，动包装层前先读它。

## 三、回归面与兼容

- 合法性：@!23 协议冻结面管 wire 码值/409 形态/闸门次序，**face 翻译层不在内**——本 PR 未触冻结契约。
- 行为变化影响面：翻转时点全 workspace **生产代码无显式供键调用方**（评审 grep 证实）；此后 graph-loop 0.5.1 起透传引擎键（`runId:nodeId:ordinal`，与 `direct-<8hex>` 键空间不相交），本 face 的分岔自此有真实流量。
- 测试钉位：`tests/teams-bridge.spec.ts`——sync 回放 throw 正则 + async 回放 accepted 回归 + conflict 字断言，三案都以 `peer.seen` 长度 1 钉死"判决终态不 failover"。

## 四、主检出现状（接手者必读）

主检出停在 **`feat/nexus-planning-b`**（另一会话的 WIP，含未提交脏文件）——**不要动它**。需要在 master 上构建/发版时：`git worktree add .claude/worktrees/<name> origin/master` 从 worktree 执行（本日 0.5.34 即如此发布；worktree 依赖经目录上行解析主检出 node_modules，无需重装；`verify:nexus` 可跳过仅当未触 nexus 面——nexusDist 以 master 提交态打包）。

## 五、待办队列

1. **本仓 W7 义务已清**——slice 2（S1 产物取回）若立项，查询面（按 taskId 查对端产物）的协议侧落点在本仓：bridgeFace 增方法属 RF-1 append-only 增补，需与 native-teams 契约镜像同步。
2. 既有非阻断注记：emit 围栏 parallel 化（随手收口项）。
3. P2 遗留锚点照旧（callbackTarget 消费端链路已在、sessionKey durable 已裁定落地于 native-teams !72）。
