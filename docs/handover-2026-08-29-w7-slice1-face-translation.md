# 交接报告：W7 协议面——slice 1 回放翻译 + slice 2 查询面 + 幂等窗口可观测（2026-08-29/30）

> 交接范围：本仓 W7 三片均已合并发版——slice 1 回放翻译（!39，0.5.34）、slice 2 查询面（!41，0.5.35）与幂等窗口可观测（!43，0.5.36）；本文交付契约语义、回归面与下一位维护者的注意项。
> 设计权威：dsh-graph-loop `docs/w7-remote-recovery-table.md`（slice 1）与 `docs/w7-slice2-outcome-retrieval.md`（slice 2，其 master d29e080）；本仓配套文档 `docs/native-teams-bridge.md`（随两片回写，§3.1 检索面小节）。

## 一、结论速览

| 维度 | 状态 |
|---|---|
| master | `5363041`（!43 合并提交；仓 tip `d08476c` 另含并行线 !44–!58——control-routes 修复、nexus 功能及 0.5.37–0.5.39 发版，非仅文档） |
| 版本 | **0.5.36 = 本文所述发版**（08-29 时为 latest，tarball 直验过）；08-30 并行线已续发 0.5.37–0.5.39，现 latest=0.5.39 |
| 本日落库 | !39 回放翻译（R1 APPROVE）；!40 交接文档；!41 slice 2 查询面（两 BLOCKING → R2 APPROVE）；!43 幂等窗口可观测（R1 REQUEST CHANGES 一 BLOCKING → 闭环 → R2 APPROVE）；另有并行线 !56-!58 文档件 |
| 门禁基线 | typecheck×2 / vitest 369 / build 全绿（!43 净增 6 测试：观测 e2e ×2 + store 断言 ×2 + R1 回归 ×2） |

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
- 行为变化影响面：翻转时点全 workspace **生产代码无显式供键调用方**（评审 grep 证实）；此后 graph-loop 0.5.1 起透传引擎键（`runId:nodeId:ordinal`，与 `direct-<8hex>` 键空间不相交），分岔面自此**可达**（引擎键真实上行；回放/冲突命中按设计仍应近零）。
- 测试钉位：`tests/teams-bridge.spec.ts`——sync 回放 throw 正则 + async 回放 accepted 回归 + conflict 字断言，三案都以 `peer.seen` 长度 1 钉死"判决终态不 failover"。

## 三·五、slice 2（!41）：S1 结果检索面

- **wire**：`POST /a2a/query`，体只携 `{task_id, fingerprint}`，语义层恒 200 四态应答（unknown-task / payload-mismatch / pending / completed|failed）；不可解析体 / 超大体同 `/a2a/direct` 答 400 / 413，不涉冻结词汇。畸形字段恒 unknown-task；不 claim、不 steer、不入会话、**语义应答不产 wire 错误码**——闸门冻结面（409 形态字节级钉住）零触碰。
- **产物滞留**：`IdempotencyStore` 行扩展 `{taskId, fingerprint, at, outcome?, settledAt?}`——`recordOutcome` **首写定终身**；`OUTCOME_TEXT_CAP = 65536` 截断带 flag；v2 快照（v1 快照恢复为 pending）；产物随认领行生死（TTL 24h / cap 256）。
- **三挂钩**（首写定终身，占位散文两条通道都封死）：sync 应答（非 `TASK_STATE_COMPLETED` 的 status 不记 + `placeholder` 标志的 flush 超时/死会话应答不记）；桥 detached 轮（`settled:true` 才记）；回执关联（`settleAndAnnounce` 内直接 `parseReceipt`——在 ledger 早退之前，只记 summary 人类文本，envelope 受控词表永不入账）。
- **`peerPayloadFingerprint` 单一实现**：闸门 claim、查询端点复核、bridgeFace 重组三方共用一处导出（字段序即 wire 格式，勿动）。
- **`bridgeFace.queryOutcome`**：只读 fan-out（mismatch > unknown > 无应答聚合），循环头 abort 检查，transport 败恒 `undefined`——`undefined` ≠ `found:false`（前者无增量信息，后者是对端的诚实否定）。
- **R-2-1 封源**：`armReceiptAutosend` 对 placeholder 应答不合成完成回执（同宿回执环回曾是占位入账的最后一条窄通道）。
- **已知负债（登记不设防）**：入站 noWait 活代理任务的产物对端不可知（回执直达 caller）→ 认领行滞留 pending；回执关联的信任面 = 能投递回执者即可记产物（与既有 taskLedger 关联同暴露面）；async 交付的 fingerprint 再现依赖 card cache（graph-loop 全 sync 不经过）。

## 三·六、幂等窗口可观测（!43，0.5.36）

立项依据（调研证实）：幂等窗口 today **零可观测**——409 早退处无日志、无计数、无 activity，连 idempotency.json 都不留痕；而 idem_key UNIQUE 化（W8 §7 负债行"欠账单待 face 流量"）押在 face 流量数据上，闸门键 0.5.1 起上行而采集点为零。

- **store 计数器（持久化）**：`claim()` 三分支自增 fresh/replay/conflict，persist 进快照 `stats` 段——**跨重启累积**（易失计数会毁掉 UNIQUE 决策需要的跨日证据）；v1/v2 旧快照恢复补零，绝不伪造数字。
- **`stats()` 只读聚合**：`{window, cap, pending, settled, claimsFresh, replays, conflicts}`。
- **state 路由 `idempotency` 段**（controlRoute 鉴权内）：UNIQUE 化的观测点。**隐私裁定：无指纹**——指纹是 /a2a/query 唯一鉴权物，入 state 即向 control-authorized 查看者交出离线字典攻击验证面。
- **a2a_status 加段**：sessionNodes:false 下 initiator 仍可读——补上该形态的观测退化。
- **conflict 分支一行 warn**：caller bug 路防误读；replay 按设计纵深保持静默。
- **B-1 教训（R1 BLOCKING）**：restore() 内 `prune()` 曾先于 stats 恢复——TTL 过期 entry 触发 prune→persist 时内存计数还是 0，**把磁盘累积证据静默清成 {0,0,0}**，且恰好在切片的目标场景（低流量节点静默重启）触发。修法：stats 恢复前移；回归测试直查磁盘跨双重启断言。**通则：恢复序列里，任何可能触发 persist 的步骤必须在恢复完成之后。**
- **登记（裁定维持现状）**：conflict warn 的 taskId 80 字符窗口内换行注入残留（与既有 sink 同款类债务）；replay/conflict 409 全量写盘（设计稳态≈0 可接受）；面板 UI 节降级可选二期（为稳态恒零的计数建类型+双语+组件测试性价比低）。
- **UNIQUE 化数据源就此就绪**：凭 state 路由 / a2a_status 的窗口计数立项即可。

## 四、主检出现状（接手者必读）

主检出停在 **`feat/nexus-planning-b`**——另一会话的 WIP 分支（未合 master；WIP 推进中，tip 随时漂移——撰写时为 `baf51a1`，已前进至 `efdf6b0`，接手时以 `git rev-parse` 实时为准），**不要动它**。需要在 master 上构建/发版时：`git worktree add .claude/worktrees/<name> origin/master` 从 worktree 执行（本日 0.5.34 即如此发布；worktree 依赖经目录上行解析主检出 node_modules，无需重装；`verify:nexus` 可跳过仅当未触 nexus 面——nexusDist 以 master 提交态打包）。

## 五、待办队列

1. ~~slice 2 查询面~~ **已落地**（!41，0.5.35）——bridgeFace 增方法 + `/a2a/query` 端点均按 RF-1 append-only 落库，冻结面零触碰（409 字节级钉住）。
2. idem_key UNIQUE 化（W8 §7 欠账；face 流量已真实开始；部分索引，odoo-dev）。**数据源已就绪**（0.5.36）：state 路由 `idempotency` 段 / a2a_status 窗口计数——replay/conflict 累计有真实流量即立项。
3. 既有非阻断注记：emit 围栏 parallel 化（随手收口项）。
4. P2 遗留锚点照旧（callbackTarget 消费端链路已在、sessionKey durable 已裁定落地于 native-teams !72）。
