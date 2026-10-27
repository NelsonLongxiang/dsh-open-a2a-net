# A2A 工作台技术栈全景（含 3D 前史）

> 2026-10-19 整理。对象：`/__dsh_a2a_nexus/` 工作台页面 + GUI 侧边栏 A2aControl 面板。
> 一句话：**双面前端——独立页面零框架（原生 DOM + Vite），GUI 面板 React——共享同一个
> JSON 状态端点**。本文是选型档案，不是入门教程。
> 数字锚最近复核：2026-10-27，master ae7e24d（0.6.28）。

## 0. 演化前史（为什么长这样）

| 阶段 | 版本 | 形态 | 结束原因 |
|---|---|---|---|
| 2026-08 ~ 10-18 | ≤0.5.x | **nexus-stage 3D 观测**：Three.js 拓扑查看器（world/topology/edges/lod/reproject/viewport/seat/overlay 等 19 个模块）+ 2D 规划板（planning-view）+ `?mode=plan` 分视图 | 用户裁定「3D 观测不需要了，更换成更符合人类 AI 研究员的工作台」；Three.js MB 级依赖与低信息密度双亏 |
| 10-19 上午 | 0.6.0 | **DOM 工作台**（目录/台账/活动/规划四 tab），Three.js 全删，bundle 11.7KB | 误删了 2D 规划板（用户纠偏：「我只说了删 3D 观测」） |
| 10-19 中午 | 0.6.1 | 规划板 13 文件从 git 考古还原，成为工作台第四个 tab（board） | tab 切换割裂：看板与运营数据两世界 |
| 10-19 下午 | 0.6.2 | **合并响应式 shell**：规划板=舞台（canvas 模式默认），目录/台账/活动/规划入左侧 rail；<1024 抽屉布局 | footer 出现双按钮（工作台+规划板） |
| 10-19 晚 | 0.6.3 候选 | footer 单入口「打开工作台」（3081 闸门首个候选，用户校验中） | — |

## 1. 工作台页面（`nexus-stage/` 子包，独立构建）

| 维度 | 选型 | 事实锚点 |
|---|---|---|
| UI 框架 | **无。原生 DOM API**（`document.createElement` 手写组件树） | `src/workbench.ts` `createWorkbench(deps)` 返回 `{root,update,tab}`；纯函数式 update(state) 投影 |
| 语言 | TypeScript 5.6 strict | `build = tsc --noEmit && vite build` |
| 构建 | **Vite 5.4**（rollup 产物 hash 命名） | 产物 `assets/nexusDist/`（index-*.js/css），随插件 tarball 分发；bundle JS ≈122KB + CSS ≈40KB（0.6.28；0.6.0 时为 ~11.7KB） |
| runtime dependencies | **0 个** | `nexus-stage/package.json` dependencies: {} |
| 样式 | 手写 CSS + 自定义属性 token（`--n-*`） | `workbench.css`（shell/rail/抽屉）、`planning.css`（画布）；响应式断点 **1024 / 680** |
| 规划板图形 | **SVG**（星形边/团队框/节点卡），非 Canvas/WebGL | `planning-view.ts`（1507 行，M1 棘轮上限：单文件不得超 1507 行，只降不升）；dot-grid、marquee 框选、Space+drag 平移、Shift+wheel 纵深、Ctrl zoom |
| 状态管理 | 无库：**WorldModel keyed-diff** 跨轮询保留拖拽位移 | 轮询 3s（`main.ts`，visibilitychange 暂停）；`?mode=plan` 等待 canvas face（300ms×30s 上限） |
| 画布持久化 | LayoutDoc v1（JSON 快照，双侧 clamp） | 宿主路由 `GET/POST /__dsh_a2a/canvas-layout`；saveLoop 防抖 + lamp 状态 + pagehide flush |
| CanvasAction | 七种乐观写（create-team/add-member/remove-member/remove-team/reorder/join-network/leave-network） | `canvas-ops.ts`，team-scoped undo，串行 settle；前五种经 `canvas-wire.ts` 映射为 `POST /__dsh_a2a/canvas` 的四个 action（create/remove/add-member/remove-member），join/leave-network 走 `POST /__dsh_a2a/join` / `/leave` |
| 测试 | **Vitest 2.1 + jsdom 24** | 19 文件 201 测（`nexus-stage/tests/*.spec.ts`：workbench/rail/chat-drawer/owner-panel/keygate + planning-* 系列）；jsdom 不算样式 → 结构断言 |
| 布局门禁 | 构建产物真实存在 + dist 干净 | 根 `pnpm verify` → `verify:nexus`（npm ci + build + test + `git diff --exit-code -- assets/nexusDist`，新 hash 须先 git add 提交） |

### shell 结构（0.6.2+）

```
header（☰ 菜单钮 / 标题+版本徽章 / 幂等计数 / reconcile 态 / ◧ rail 折叠钮）
body grid = rail（四个 accordion 分区：目录/台账/活动/规划，带计数）| stage
stage = wb-stage-board（planning root，绝对定位填满）+ wb-data 数据栈（data 模式）
inspector = overlay 卡（wb-inspector is-open；<1024 变底部浮层）
WorkbenchMode = 'canvas' | 'data'（依 board.available() 每 poll 派生；canvas 掉线自动回 data）
```

## 2. GUI 侧边栏面板（`src/client/`，宿主 bundle）

| 维度 | 选型 | 事实锚点 |
|---|---|---|
| UI 框架 | **React 18**（peer `^18.2.0`） | `A2aControl.tsx`（316 行）函数组件 + hooks |
| 样式 | CSS Modules | `A2aControl.module.css` |
| 图标 | `@deepseek-ai/dsh-client-ui-primitives`（`IconGlobeOutlineRegular`，与 `Button` 同源） | footer 按钮 + unread badge |
| 构建 | tsdown → `lib/client.js` | 宿主 cordis bundle 体系；hoisted profile 下改动=rebuild+重装+重启 |
| 轮询 | 开面板 2s / 关面板 10s；SSE 无关（无 watcher 时 build 后 `curl /__dsh_webui_reload`） | `fetch('/__dsh_a2a/state')` |
| 国际化 | 自带 `locales.ts`（zh/en 双字典，ChatKey=zh 键的 keyof） | 0.6.3 删 `a2a.stageBoard` 键即改三处 |
| 测试 | Vitest + @testing-library/react | `tests/unit/a2a-control.client.spec.tsx` 15 测 |

## 3. 共享后端契约（两面唯一耦合点）

| 端点 | 方法 | 消费方 |
|---|---|---|
| `/__dsh_a2a/state` | GET | 两面全量：sessions（live/cold）/canvas/peers（分数）/remote/activity 环/inFlight/tasks（pending+settleable+stale 计数）/tasksDead（带 direction）/archived（≤64 条、最新在前：outcome + endedBy receipt·echo·abandoned·cancelled + late，gh#31）/idempotency（claims/replays/conflicts）/reconcile/registry/version |
| `/__dsh_a2a/tasks/abandon` | POST `{task_id,reason}` | 工作台台账死信清账 seam |
| `/__dsh_a2a/canvas-layout` | GET/POST | 规划板布局持久化 |
| `/__dsh_a2a/tasks/cancel` | POST `{task_id,reason}` | 台账在途任务取消：账面结算为 `archived[].endedBy=cancelled`，并尽力向持有该任务的本机活会话注入停止通知（返回 `steered`） |
| `/__dsh_a2a/canvas` | POST | CanvasAction 中的队伍写（create/remove/add-member/remove-member；成员可为本机 joined 会话或 `zone/id8` 远端句柄） |
| `/__dsh_a2a/join` · `/leave` | POST | 节点入网/退网（规划视图节点菜单） |
| `/__dsh_a2a/groups` | POST | 会话分组标签（0.6.6 起已弃用，画布队取代；为旧面板保留） |
| `/__dsh_a2a/dispatch` | POST | 工作台快速派单（L3） |
| `/__dsh_a2a/owner-settings` | GET/POST | 属主设置面板（`teamJoinAllowlist` / `teamScopeInfo` / `announce`） |
| `/__dsh_a2a/session-log` · `/remote-session-log` | GET | 聊天抽屉会话日志（本机 / 远端） |
| `/__dsh_a2a/fleet-canvas-op` | POST | 舰队级画布编排：中继到对端 `/a2a/canvas-op`（gh#41） |
| `/__dsh_a2a/cli-deposit` | POST | a2a-net CLI 身份寄存（非工作台消费，同属控制面） |

以上 `/__dsh_a2a/*` 控制面路由（含 GET 读面）在配置了 `apiKey` 时一律验 key；未配 key 时仅信任 loopback 套接字。

## 4. 环境与流程约束（影响前端生效路径的事实）

- **hoisted 快照**：DSH profile 的 `file:`/`link:` 都是真实副本——host/client 面改动必须 rebuild + profile 重装 + 重启（技能 `dsh-plugin-dev-test` 为权威）。
- **发布闸门**（docs/release-gate.md）：候选先上 3081 测试环境（本地 tgz 装稳定路径），用户校验通过才 `npm publish` 与生产部署；稳定期不自动发版。
- 设计决策档案：`intent/2026-10-19-a2a-workbench.md`（0.6.0 决策）、`intent/2026-10-19-release-gate-3081.md`（闸门）、`docs/canvas-stage-design-system.md`（更早的画布设计系统）。
