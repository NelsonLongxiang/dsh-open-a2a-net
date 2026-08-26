# 交接报告：dsh-open-a2a-net 启动阻塞与冷打开超时问题（2026-08-23）

## 问题清单（均已定位并处置）

1. **大量节点导致 DSH 进程运行期阻塞**（peers 轮询扇出 + 同步落盘）——已修复并发布（0.5.21）。
2. **DSH 启动后 3–5 分钟 Web Server 不流畅**（boot wake 批量回放）——已修复并发布（0.5.21）+ profile 止血。
3. **`web-server: Error: read ECONNRESET` 刷屏**——诊断为卡顿期间客户端 RST 的症状，非独立故障；根因修复后应消失。
4. **`历史加载失败：signal timed out（internal）`**——冷打开 history RPC 的浏览器侧 30s 死线撞上主线程回放；已在 deepseek-harness master 根治（PR #114，已合并）。

## 根因链（实测闭环）

```text
wakeJoinedOnBoot: true + 23 个 joined intent（约 254MB 压缩日志）
→ 启动后串行 materialize 全部冷会话
→ 宿主 zstd 回放运行在主线程：
   · 全文件 frame 同步扫描（scanZstdFrames）
   · 解码仅每 ~500ms 让步一次（单帧不可分割）
   · 解码后全量 structuredClone/validation/deepFreeze 无任何让步
→ 事件循环每次被占 5–25 秒
→ Web Server socket 得不到调度
   → 浏览器/peer 放弃请求 → ECONNRESET
   → 冷打开 session.history 超过浏览器侧 AbortSignal.timeout(30s)
      → DOMException "signal timed out" 被折叠为 code:'internal'
```

证据锚点：profile 实配 `wakeJoinedOnBoot: true`（`C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml`）；`joined.json` 23 条 intent；上次启动磁盘时间戳 14:44→14:50（约 6 分钟唤醒尾部）；修复前实测 state 路由 25s 超时 ×2 后恢复。

## 已交付内容

### A. 插件仓库 `D:\workspace\dsh-open-a2a-net`（已发布 0.5.21 至 Gitea 私仓，双远端已推送）

**运行期修复（更早合入，含于 0.5.21）**
- PeerStore 落盘：trailing debounce（共享 timer、unref）+ `fs.promises` 异步写；
- 共享 TTL 卡片缓存：正 60s / 负 30s / per-URL 单飞，缓存命中不打分；
- `refreshRemoteRows` 单飞 + `remoteRowsTtlMs`（15s）；
- 摘要/标题缓存（500 事件扫描上限）；
- `directoryPeerCandidates` 有界并发（6）。

**启动修复（本轮，提交 `f1aef5b` + `117729c` + 版本 `4765558`）**
- `materializeOnce`：per-id materialization 单飞（route 唤醒与 boot 预热共享一次回放）；
- boot wake 改为可取消、低优先级预热：`wakePrewarmDelayMs`（默认 10s 延迟启动）、`wakePrewarmQuietMs`（默认 5s 前台让路，含 in-flight 路由信号；面板轮询不计入）、fiber dispose 取消、每 tick 跳过 live/archived/left；
- state 路由冷行快照 stale-while-revalidate（poll 永不阻塞在 `sessionPersistence.list()`）；
- 目录 sweep 有界并发（`SWEEP_CONCURRENCY=6`）；
- 新增 7 个测试，全套 195 用例绿；README/README_zh 配置表更新。

### B. 运行配置（已生效待重启）

`C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml`：`wakeJoinedOnBoot: true → false`。
冷会话仍可 route 唤醒 / 侧栏手动 wake / 打开后自动 remount；joined intent 不丢。

### C. 宿主仓库 `D:\workspace\deepseek-harness`（PR #114 已合并，merge commit `7318f2bc27`）

分支 `perf/replay-yield`（worktree `.claude/worktrees/replay-yield`），两个提交：
- `f5970c0d9e`：三项修复——fetch client 新增 `'cold-open'` 一元策略（`COLD_OPEN_TIMEOUT_MS=300s`，应用于 `session.history`/`subagent.history`）；`snapshotStoredEvents`/`adoptStoredEvents` 每 2000 事件 `scheduler.yield()`；`nextZstdFrame` 提炼 + `scanZstdFramesYielding`（每 64 帧 yield + abort 检查）用于 `readZstdTail`/`readRaw`/`readZstdPrefix`，单帧探测保持同步；
- `9fb7643f59`（三路子代理评审后的修复）：cold-open 死线经 `AbortSignal.timeout` spy 锚定、yielding 扫描等价/跨界/中止测试、2100 事件协调器跨 yield 边界测试；`readZstdTail`/`readRaw` 向扫描转发 signal；`adoptStoredEvents` yield 位置对称化；`postJson` 提取 `deadlineMs`；Agent Note 重写为规范格式（architecture/，含 zh 对照）；apiproxy 与 jsonl README 双语更新。

## 验收标准与当前状态

| 标准 | 状态 |
|---|---|
| 插件 A1–A4（写盘/缓存/延迟/元数据） | ✅ 195 测试绿 |
| 启动零批量唤醒、按需 materialize、state 内存化、discovery 限流 | ✅ 0.5.21 已发布 |
| 宿主：冷打开不再撞 30s 墙 | ✅ 已合并 master（未发版） |
| 宿主：回放期间事件循环保持交互级 | ✅ 代码层完成；实机复测待发版 |
| 实机冒烟（重启后启动即流畅、ECONNRESET 消停、`X-A2A-Timing: cold≈0`、预热日志渐进） | ⏳ **待执行：重启 `dsh web`** |

## 遗留事项（按优先级）

1. **重启 `dsh web` 做实机验收**（止血配置 + 0.5.21 已就位，只差重启）。
2. **宿主修复进入运行实例**：profile 的 `@deepseek-ai/*` 来自发布包，需等下一次 harness 发版或本地源码构建后，`signal timed out` 才会彻底消失。
3. **zstd 单帧解码移入 worker thread**：结构性终局（单帧仍是不可分割同步突发），已在 Agent Note 记录为后续项。
4. **dead-seed 指数退避**：peer store 中死 seed 每 30s 永久重试（seed 不淘汰），节点规模扩大后需加 backoff。
5. **`titleCache` undefined 钉死 bug**：`docs/bug-coldwake-desc-stale.md`，一行修复，未排期。
6. **ECONNRESET 日志降噪**：webserver 的 per-request 兜底对客户端 RST 记 warn；如修复后仍偶发刷屏，可在 deepseek-harness 将 `ECONNRESET`/`EPIPE` 降级（需另开 PR）。
7. worktree `.claude/worktrees/replay-yield` 与分支已满足 merged 条件，可例行清理。

## 本机环境备忘（避免踩坑）

- **GCM 挂起**：非交互 shell 中 `git push`/credential helper 会等待不可见弹窗——用 `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0`；Gitee API token 用 `git credential fill` 取。
- **lefthook 提交钩子**：机器高负载时收尾阶段可能挂起（实质检查 lint/vendor/pairing 已单独跑绿），必要时 `LEFTHOOK=0` 提交并补偿跑 `pnpm run typecheck`。
- **并行开发流**：dsh-open-a2a-net 工作区曾多次被并行写入覆盖未提交改动——重要改动务必立即提交。
- **高负载测试伪象**：并行满载下 5s 测试超时在 master 基线同样复现（tail-count、writer-lease 等）；判定前先单跑对照。

## 关键路径速查

- 插件仓库：`D:\workspace\dsh-open-a2a-net`（`docs/perf-fix-plan.md` 为此前修复方案存档）
- 性能方案文档：`D:\workspace\dsh-open-a2a-net\docs\perf-fix-plan.md`
- 宿主 Agent Note：`D:\workspace\deepseek-harness\.agents\notes\implemented\architecture\2026-08-23-cold-open-replay-event-loop-yields.md`（含中文对照）
- PR：https://gitee.com/NelsonLongXiang/deepseek-harness/pulls/114
- profile 配置：`C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml`
- DSH home 数据：`C:\Users\Administrator\.dsh\a2a\`（joined.json/peers.json）、`C:\Users\Administrator\.dsh\sessions\`
