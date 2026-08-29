# 空闲 Claude 任务卡（可直接整卡粘贴给任一空闲 Claude 终端）

> 通用前置（每张卡都已含）：仓库 `D:\workspace\dsh-open-a2a-net`，分支 `feat/nexus-planning-b`。
> 纪律：Conventional Commits；纯逻辑进 `nexus-stage/src` + 根套件直测；jsdom 走 seam；不新增 host API；不动 `pnpm verify` 门禁；完成后跑 `pnpm verify` 并报告 exit code。**不要推送**——由协调席统一 push。

---

## 卡 1 · design.md 路线图状态回填（文档，低风险）

```
仓库 D:\workspace\dsh-open-a2a-net，分支 feat/nexus-planning-b。
任务：feedback/2026-08-27-nexus-canvas-ux/design.md 的 §6 实施路线表格中，为 PR A/B/C/D 四行追加"状态"列标注（A/B/C/D 已实施，2026-08-29），并在文件头部的"状态：评审中"改为"状态：已实施（见 implementation-notes.md）"。
依据：feedback/2026-08-27-nexus-canvas-ux/implementation-notes.md（偏离与修复记录）。
验收：git diff 只含 design.md；不改动任何代码；pnpm verify 不需要（纯文档）。
提交：docs(nexus): mark the nexus canvas roadmap implemented (A–D)
禁项：不要改 §1–§5 的任何设计裁决原文。
```

## 卡 2 · 活动边去重（小功能，中风险）

```
仓库 D:\workspace\dsh-open-a2a-net，分支 feat/nexus-planning-b。
任务：同一 (team, peer) 存在多条 inFlight 路由时，2D 画布的活动边会完全重叠（nexus-stage/src/federation.ts activityEdges）。为重复路由合并为一条边并在标签中计数，如 "a2a_route · 10.0.0.5:8787 · 12s ×3"。
验收：tests/federation.spec.ts 新增用例——两条同 team+peer 路由 → 1 条边、标签含 ×2；不同 peer 不合并；现有 13 用例不回归。同步更新 nexus-stage/tests/planning-federation-dom.spec.ts 如有受断。
提交：feat(nexus): dedupe identical in-flight activity edges with a count label
禁项：不改 activityEdges 的现有签名（planning-view.ts 已按此消费）；不做 host API 改动。
```

## 卡 3 · mockhost 布局持久化到磁盘（工具，低风险）

```
仓库 D:\workspace\dsh-open-a2a-net，分支 feat/nexus-planning-b。
任务：nexus-stage/scripts/mockhost.py 的 layout_store 目前只在内存（重启即清）。增加可选磁盘持久化：环境变量 LAYOUT_FILE 设置时，save/reset 写读该 JSON 文件（mode 0600，损坏按不存在处理）。
验收：py_compile 通过；手动 curl 两轮（save → 重启进程 → GET 仍在）；未设环境变量时行为与现在完全一致。
提交：feat(nexus): mockhost optional on-disk layout store (LAYOUT_FILE)
禁项：不要改默认行为；不要引入第三方依赖。
```

## 卡 4 · 3D 观测面接真实 inFlight（中功能，中风险）

```
仓库 D:\workspace\dsh-open-a2a-net，分支 feat/nexus-planning-b。
任务：nexus-stage/src/main.ts 的 cycle() 目前只在 useMock 分支调用 drawActivity（topology.ts）。真实路径接通：用 topology.inFlightPairs(sessions)（session.inFlight 标记）在有配对时调用 drawActivity，接入 disposeGeometries 生命周期（参照 drawMembership 的重建纪律）。
验收：nexus-stage/tests 新增用例钉 inFlightPairs 的配对规则（奇数个忽略最后一个）；useMock 与真实路径行为一致；pnpm verify 全绿（含 dist 重建提交）。
提交：feat(nexus): wire real in-flight activity edges into the observation scene
禁项：不动 drawPeers 的现有行为；不新增 host API；reduced-motion 下不引入逐帧动画。
```

## 卡 5 · 多标签页布局并发（调研卡，先调研后动）

```
仓库 D:\workspace\dsh-open-a2a-net，分支 feat/nexus-planning-b。
任务（两段式）：先调研——两个标签页同时打开规划画布时的写写冲突面（布局文档 last-write-wins + 各自 5s poll 采纳启发式），产出一份 ≤1 页的冲突场景清单（feedback/2026-08-27-nexus-canvas-ux/multi-tab-analysis.md）。清单经确认后再讨论是否值得做版本号乐观锁（契约 v2 候选，需单独评审）。
验收：调研文档列出 ≥4 个具体冲突时间线（含"保存回包 vs 轮询采纳"、"A 删队 B 存帧"）；不改任何生产代码。
提交：docs(nexus): multi-tab layout concurrency scenario analysis
禁项：本卡只调研不实现；不修改 canvas-ui-contract.md（v1 锁定）。
```

---

## 协调席备注

- 卡 1/3/5 相互独立可并行分派；卡 2/4 各自独立。全部完成后由协调席统一 verify + push。
- 若空闲 Claude 完成质量存疑：贴回它的 diff，由协调席复审后合并。
