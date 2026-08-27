# dsh-open-a2a-net 性能瓶颈修复方案与验收标准

日期：2026-08-23。范围：大量节点（peerStore 接近 30 上限）时 DSH 单进程事件循环阻塞。

## 实施状态（2026-08-27 回填）

F1–F4 已全部落地并合入 master；单测级验收（A1/A2/A4 及行为回归）全绿。
集成级端到端度量（A3 的 30-peer 路由准备段延迟、A5 的事件循环 p99）尚未
执行——衔接 `handover-2026-08-24-session-scaling-research.md` 的 3081 实验
协议与 dsh-perf-analyzer P1 探针，属后续观测工作。

| 修复 | 落地提交 | 验收证据 |
|---|---|---|
| F1 PeerStore 防抖异步持久化 | `0243ec1` perf(peers) | `tests/peer-store.spec.ts`（防抖合并 + `flush()` 落盘语义） |
| F2 共享 TTL 卡片缓存（含负缓存） | `c339c01` perf(cards) | `tests/card-cache.spec.ts` |
| F2 附带 候选并发上限遍历（消 B2 串行等待） | `3cb2127` perf(route) | apply / canvas-routing 行为回归 |
| F3 remoteRows 单飞 + TTL 配置化 | `e95e635` perf(panel) | `remoteRowsTtlMs` 断言见 apply.spec.ts 等 4 个 spec |
| F4 摘录按事件长度缓存 | `8a64221` perf(state) | apply.spec.ts activity-excerpt 新鲜度用例 |

配置键落地：`cardCacheTtlMs=60_000`、`cardCacheNegativeTtlMs=30_000`、
`remoteRowsTtlMs=15_000` 入 Config schema；`persistDebounceMs=1_000` 保持
构造参数注入（便于测试），未入 schema——与本文 F1 设计一致。

## 背景与根因摘要

DSH 是单进程单事件循环（web server、agent 回放、工具执行共享）。本插件当前存在一条「轮询扇出 → 同步写盘」的放大链：

- **B1（主因）** 侧栏面板每 2s 轮询 `/__dsh_a2a/state`，`refreshRemoteRows()`（src/index.ts:692-705）每 5s 调 `listDirectoryTeams(false)`，对 peerStore 全部 peer（≤30）**无并发上限** `Promise.all` 并发 HTTP GET 卡片（src/index.ts:1287-1289）。每次 fetch 结束（成功/失败/每个 referral offer）都触发 `PeerStore.persist()` —— `mkdirSync` + `writeFileSync` 全量同步写（src/peer-store.ts:168-179），**无防抖无合并**。30 节点一轮 sweep 最坏 30+ 次同步写盘，约 6+ 次/s；Windows 上同步写 + 杀软扫描每次阻塞事件循环数毫秒到数十毫秒。且 N 个节点互相轮询为 O(N²) 卡片流量。
- **B2** `directoryPeerCandidates`（src/index.ts:1516-1533）在每次 `a2a_route` 前对全部 peer **串行** `await fetch`（HTTP 超时 15s，src/a2a-client.ts:36），多个死 peer 时最坏 30×15s = 7.5 分钟工具阻塞。
- **B3** `nodeMetadataOf` → `recentActivityOf`（src/index.ts:571-590）倒扫 `agent.session.events`，无文本会话全量扫完；被 state 轮询（每 live root × 2s）和 card GET（每 sessionNode × 每次 GET，且被所有 peer 的 B1 扫描放大）高频调用。
- **B4（次要）** `pruneArchivedJoins` 每次轮询重建 Set（src/index.ts:479-502），量小可忽略；`group-store`/`joined-store` 同为同步写但变更频率低。

## 修复方案

### F1. PeerStore.persist 防抖 + 异步化（最高优先级）

文件：`src/peer-store.ts`

- 变更 `persist()`：不再同步写。变更发生时标记 dirty，安排一个共享的 debounced timer（建议 1_000ms，构造参数 `persistDebounceMs` 可注入便于测试），到期后用 `fs.promises.writeFile` 异步写入（`mkdirSync` 可保留一次性，或用 `fs.promises.mkdir`，只在首次/失败后执行）。
- 防抖窗口内的多次 `noteSuccess`/`noteFailure`/`offer`/`drop` 合并为一次写。
- 崩溃窗口语义可接受：防抖期间进程死亡最多丢 1s 的 peer 评分增量（卡片与评分均可重建，seeds 每次启动由 config 重灌）。
- 保留 `path === ''` 时 no-op；写失败静默降级为内存态（维持现状语义）。
- 注意测试兼容：现有 vitest 若依赖「变更后同步读文件」需改为注入 `persistDebounceMs: 0` 并 await flush，或暴露 `flush()`（返回 Promise，写完落盘）供测试与进程退出钩子使用。

### F2. 共享 TTL 卡片缓存（消网络风暴 + B2 串行延迟）

文件：`src/index.ts`（`memoizedCardFetch` 改造，src/index.ts:1173-1179）

- 把 per-call 的 memo 提升为 apply 作用域的共享缓存：`Map<url, { at: number; card: A2aPeerCard | undefined }>`。
- TTL 建议 `cardCacheTtlMs`，默认 60_000（纳入 Config schema，可配）。命中期内同 URL 不发网络请求——卡片本身签名有效期 2 天、重签周期 TTL/4，60s 缓存语义安全。
- **负结果也缓存**（不可达/验证失败），TTL 可与正结果一致或取 30s，避免死 peer 被 5s 一轮持续重打。
- `listDirectoryTeams`、`directoryPeerCandidates`、`refreshRemoteRows`、`a2a_route` 的 capability 查询全部走共享缓存；`memoizedCardFetch`（per-call 保证「每次工具调用打分一次」的旧语义）可删除或退化为共享缓存的直读。
- 评分语义调整：缓存命中不再重复 `noteSuccess`（否则防抖也救不住写频率）。评分只在实际网络 fetch 结算时发生——这本来就更正确。
- 可选（若实施则 B2 彻底消除）：`directoryPeerCandidates` 的两个串行循环改为 `Promise.all` 并发 + 并发上限 6。

### F3. refreshRemoteRows 单飞 + 拉长 TTL

文件：`src/index.ts`（src/index.ts:691-705）

- 加 in-flight guard：已有一次后台刷新未完成时，后续轮询直接返回旧缓存，不再叠加发起。
- 缓存 TTL 从硬编码 5_000 提为配置 `remoteRowsTtlMs`，默认 15_000（配合 F2 后每 15s 才有一次真实网络活动）。
- sweep 内部对 peer 列表分批并发（上限 6）。

### F4. recentActivityOf 按事件长度缓存

文件：`src/index.ts`（src/index.ts:571-590）

- apply 作用域 `Map<agentId, { events: number; excerpt: string }>`：`agent.session.events.length` 未变则复用摘录；变更后重算并覆盖。agent disposed 时清除（已有 `agent/disposed` 监听可挂）。
- 收益：state 轮询与 card GET 对 idle 会话的开销从 O(events) 降为 O(1)。

## 实施顺序

F1 → F2 → F3 → F4（F1 独立可先行；F2 是 F3 收益的前提；F4 独立）。

## 不做的事

- 不改 `PEER_CAP`、协议格式、路由语义。
- 不引入后台定时全量扫描（维持现有按需 + 轮询驱动模型，仅加缓存/防抖）。
- 不动 `group-store`/`joined-store`（频率低，非热点；如顺手可同样防抖，非验收项）。

## 验收标准

### A1. 写盘频率（F1）

- 单测：对 PeerStore 连续调用 50 次 `noteSuccess`（不同 url mix），注入 `persistDebounceMs` 后 await flush，断言 `writeFile` seam **恰好被调用 1 次**，内容为最终状态。
- 单测：防抖窗口内 `offer` + `noteFailure` + `drop` 混合，flush 后文件内容与内存态一致。
- 集成观测：30 peer 满 store、面板持续轮询 60s，进程全程 `writeFileSync`/同步 fs 调用次数为 0（可用 `node --trace-sync-io` 或 monkey-patch 断言）；写盘频率 ≤ 1 次/s。

### A2. 卡片缓存（F2）

- 单测：注入 fetch seam，同一 url 在 TTL 内的两次 `fetchCard` 只发生 1 次网络调用；TTL 过期后再次调用发生第 2 次。
- 单测：不可达 peer（fetch 抛错）在负缓存 TTL 内不重试。
- 单测：缓存命中路径不调用 `peerStore.noteSuccess`（评分只在真实 fetch 结算）。
- 行为回归：`a2a_teams` / `a2a_route` 现有测试全部通过（结果内容不变）。

### A3. 路由延迟（F2/F3）

- 集成场景：peerStore 含 30 个不可达 peer，缓存预热后 `a2a_route` 从发起（本地 team miss 后）到进入候选 dial 的准备段耗时 < 200ms（原先串行 30×15s）。
- `refreshRemoteRows`：面板 2s 轮询 × 60s，实际发起的后台刷新次数 ≤ ceil(60/remoteRowsTtlMs) + 1，且任一时刻至多 1 个 in-flight。

### A4. 元数据缓存（F4）

- 单测：同一 agent 连续多次 `nodeMetadataOf`，events 未变时 `session.events` 只被扫描 1 次（以访问计数或缓存命中断言）；append 一条事件后摘录更新。

### A5. 进程健康（端到端，对应原始症状）

环境：DSH 单进程挂载本插件，peerStore 满 30 个真实/模拟 peer（其中 ≥10 个慢或不可达），≥5 个大会话（事件数 ≥ 20k）加入 sessionNodes，侧栏面板持续打开轮询。

- 60s 观测期内事件循环延迟（`monitorEventLoopDelay` 采样，p99）< 50ms，无 > 200ms 的连续卡顿段；对照修复前基线应有数量级改善。
- 对比指标同时记录：出站 card GET 频率（修复前 ≈ N×(1/5s)，修复后 ≈ N×(1/remoteRowsTtlMs) 且含负缓存抑制）、peers.json 写次数（修复后 ≤ 1/s）。
- 回归：join/leave/wake/archive-prune、`a2a_teams`/`a2a_route`/`a2a_status` 全部现有 vitest 通过；手动冒烟：面板分组、冷行 wake、路由 receipts 正常。

## 风险与回滚

- F2 缓存可能让「peer 刚上线但 60s 内不可见」——可接受（原语义也是下一次轮询才发现），配置项可调小。
- F1 防抖丢崩溃前 1s 评分——可接受（见上文语义说明）。
- 各修复相互独立，可单独回滚；均不改 wire 协议，新旧节点互操作不受影响。
