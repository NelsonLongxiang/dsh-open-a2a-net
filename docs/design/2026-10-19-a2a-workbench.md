# 2026-10-19 — nexus 3D 观测 → A2A 工作台（client UI 统一）

## 决策

用户裁决（2026-10-19，m02050/m02055）：3D 观测视图（Three.js scene）不再需要；
把规划（原 `?mode=plan` 2D 空间画板）与观测**统一成一个 client UI 工作台**，
面向「人类 AI 研究员 + agent」的工作与业务操作，而非观赏性拓扑。

## 立场

- 挂载点 `/__dsh_a2a_nexus/` URL 保持稳定（书签/入口不变），应用内容整体更换。
- 工作台是 DOM 优先（无 WebGL、无 three 依赖）：面板=数据操作面，不是空间画布。
- 数据全部来自既有 GET `/__dsh_a2a/state`（sessions/canvas/peers/remote/activity/
  inFlight/tasks 三段/idempotency/registry S1/S2/reconcile/prewarm），服务端零改动。
- 台账可操作化：dead 行接既有控制路由 POST `/__dsh_a2a/tasks/abandon`。
- 规划=衍生行动清单（催办/abandon/冷唤醒/修复提示）+ 派单起草（生成可粘贴任务书，
  不伪造发送能力——本 stage 无本地派发 POST 面）。
- 删除：world/topology/edges/lod/reproject/viewport/seat/overlay/interaction/
  layout-wire/layout-doc/planning-view/canvas-wire/canvas-ops/census/stage-mode/
  dispose/federation 及其 7 个 spec；three 从依赖移除。
- 保留可复用件：fault.ts（故障徽章纪律）、stage-name.ts（displayName）、tokens.ts。

## 验收

1. 工作台四区可用：目录（本机/远端/canvas/peers）、台账（pending/dead+abandon）、
   活动、规划（行动清单+派单起草）。
2. tests/workbench-dom.spec.ts 通过（jsdom，走生产 seam）。
3. `pnpm verify`（含 verify:nexus dist 一致性）全绿。
4. 版本 0.6.0 发布 Gitea，.157/.85 部署核验。
