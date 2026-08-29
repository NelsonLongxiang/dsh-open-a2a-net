# 交接文档 · 规划画布（PR B/C/D + 收尾）· 2026-08-29

> 基准 HEAD：`fa02172` @ 2026-08-29 深夜。本文档已提交并推送至 `origin/feat/nexus-planning-b`。**纪律：定稿后每再提交一次，必须同步追加 §0 增量或更新本基准行。**

## 0. 交接后增量（基准 efdf6b0 → fa02172 · 2026-08-29 深夜回填）

初稿以 `efdf6b0`（领先 42 commits）为基准；定稿提交 `66a57e8` 之后又落 5 个提交，接手者以本节为准：

| 提交 | 内容 |
|---|---|
| `66a57e8` | peer cards v1 —— peers 加入统一节点模型（本文档随此提交落库） |
| `5854a89` | 增量复审 P1/P2 —— peer drop/add-member 过滤、lastPlacements 存储、杂项 |
| `f5ac795` | 移除误入库的调试探针；dist 经 verify 工具链重建 |
| `d5a2071` | 二轮深审发现 —— inFlight 透传、重排守卫、README 边界 |
| `9f17d9b` | contextMenuAt 远端卡守卫 + federation spec ptr helper |
| `fa02172` | 右键按住拖拽平移 2D 画布；纯右击保留菜单 |

运行事实（2026-08-29 深夜实测）：8780 mockhost 仍在运行；生产宿主 `3080/__dsh_a2a_nexus/` 200 可用，`/__dsh_a2a_canvas/` 404——安装版未含画布（A 面冻结于 0.5.32），合并+解冻前画布只能经 8780 查看。

## 1. 分支与 PR 状态

| 项 | 值 |
|---|---|
| 分支 | `feat/nexus-planning-b`（已推送 Gitee，HEAD `fa02172`） |
| 领先 master | 48 commits（含 §0 增量 6 个） |
| 工作树 | 干净（4 个已知未跟踪项见 §6） |
| 门禁 | `pnpm verify` exit 0（typecheck×2 → build → 根套件 417 → build-layout 门禁 → verify:nexus 自举/构建/子包 66/dist diff 门禁） |
| 测试 | 根 417 passed + 2 skipped；子包 66/66 |
| 开 PR 直链 | https://gitee.com/NelsonLongXiang/dsh-open-a2a-net/pull/new/NelsonLongXiang:feat/nexus-planning-b...NelsonLongXiang:master |
| PR 正文 | 本目录 `pr-description.md`（直接粘贴） |

## 2. 交付内容（对照 design.md §6 路线图）

| 步 | 内容 | 关键提交 |
|---|---|---|
| A | 观测面修复（故障徽章/布局读路径/hub-star 成员边/CSS2D 标签/census/LOD） | 随此前 PR 先行合入 master；本分支仅携带后续修复 |
| B | 规划模式骨架：2D tab、点阵世界层、节点卡、队框、星形成员边、布局持久化回路、框选/拖拽/键盘全等 | `8ee2bd8` |
| C | 组队交互：建队/入队/离队/调优先级/散队、乐观更新+按队作用域回滚、右键菜单全键盘等价、host 错误原文 Toast | `fd151b6`/`624ab4f`/`67e7fac`/`e03e63e` |
| D | 活动/联邦层：peer 徽章列、inFlight 活动边（去重计数+整秒年龄）、联邦线、状态条飞行定位、`?demo=1` 演示数据 | `561aa64`/`711b486` |

四步**全部落地**；design.md §6 状态列与头部状态已回填（`36f5b6b`）。五项对设计文档字面的偏离及理由见 `implementation-notes.md`。

## 3. 用户反馈驱动的修复（本会话）

| 症状 | 根因 | 修复 |
|---|---|---|
| 接线异常/成员边偏移 | planning.css 丢失 border-box → 卡片实渲染 216×74 vs 常量 172×56 | 恢复 border-box |
| 联邦线横穿卡场 | 锚点在内容左中、徽章在右上 | 改侧沟短桩（maxX+20、Liang-Barsky 0 穿越） |
| 队框内卡片无法拖拽 | 队框元素赢下真实指针命中测试 | 稳定分层 + 框体 pointer-events:none（`aa455f5`） |
| 滚轮方向反 | panBy 对增量取负 | 跟随原生增量（`5d12f6e`） |
| 右键菜单不消失 | 无外点消失语义 | 外点关闭并吞掉、滚轮关闭、菜单期键盘独占（`5cbd502`） |
| 刷新重置/垂直不跟随 | 对照实验**未复现**（位置+视口均持久化）；疑似 8780 内存布局 + 协调席重启所致 | 见 §5 已知边界 |

另有四轮子代理评审的修复约 10 项（pendingTeams 引用计数竞态、对话框焦点陷阱、灯键盘化、节点退役 GPU 释放、幽灵队补偿、NUL 字节 ×2、GFM 表格、多标签分析文档等），全过程见各轮评审报告与提交信息。

## 4. 验证

- `pnpm verify` exit 0（多轮）；根套件 417 + 子包 66 全绿
- 浏览器实测（trusted 指针）：框内拖拽 0px 端点偏差、重投影后 5/5 节点在视口、键盘全等建队→入队→重排→散队、失败注入回滚（host 原文 Toast）、未移动多选点击零写入
- 评审：三席深审 + 合并审查 + 增量复审×2 + 猎虫席 + 最终判定（APPROVE-WITH-NITS→nits 已清）；第三/四轮发现已收敛至 P3

## 5. 已知边界与运行环境

| 项 | 说明 |
|---|---|
| **C:\tmp 误删事故** | 猎虫席子代理清理时误删用户既有 `C:\tmp`（8/4–23 工作产物）。恢复窗口：提权 `vssadmin list shadows /for=c:` 或 Recuva/winfr；尽量减少 C 盘写入。恢复决策树与命令备于本目录 `ctmp-recovery.md`。预防纪律：清理只碰本会话自建路径，共享根目录禁 `rm -rf`；删除两段式——先移隔离区（如 `D:\tmp-quarantine\<日期>`）观察后再清。协调席已披露 |
| 8780 mockhost | 协调席启动的测试服务（后台任务 `bp3ndi2f8`）仍在运行；布局存**内存**，重启即清；`LAYOUT_FILE` 环境变量可持久化（卡3）。生产验证请用真宿主 |
| 多标签页布局并发 | last-write-wins，互相覆盖——场景分析与候选方案见 `multi-tab-analysis.md`（rev 乐观锁为契约 v2 候选） |
| 10KB 请求体上限 | 布局文档 256 节点 ≈ 23KB > host readJsonBody 10KB 上限——约 147 joined 会话后保存永久失败。**host 侧问题**，需与 readJsonBody 上限同源裁定，非画布侧可修 |
| Alt+↑/↓ 多队卡静默 | 设计内（单队快捷路径）；多队走右键菜单离队/置顶 |

## 6. 未跟踪文件（.gitignore 已覆盖）

- `feedback/.../shots/planning-live-01/02.png`（含真实会话文本的实拍截图）
- `nexus-stage/pnpm-lock.yaml`、`nexus-stage/pnpm-workspace.yaml`（本地残留）
- `.claude-*.py`（一次性补丁脚本，已随用随删，ignore 兜底）

## 7. 交接后的建议动作

1. **创建 PR**（直链见 §1），正文粘贴 `pr-description.md`；评审意见可直接引用四轮评审结论（implementation-notes + 本文档 §3/§5）
2. 按四角色流程合并（作者不自合并）
3. 空闲 Claude 可派发 `idle-claude-task-cards.md` 的任务卡——**注意：卡1/2/3/4 已由本会话执行完毕（见提交 36f5b6b/d923af4/791d5e6/711b486），仅卡5（多标签调研）以 `multi-tab-analysis.md` 落地；新卡候选：10KB 上限同源裁定、resize 后 viewSize 缓存刷新、活动边跨 scheme 合并**
4. 合并后可删分支；`multi-tab-analysis.md` 方案 1（rev 乐观锁）留待真实多端需求触发

## 8. 关键文件索引（接手者速查）

| 文件 | 职责 |
|---|---|
| `nexus-stage/src/planning-view.ts` | 2D 规划画布 DOM 层（手势/菜单/对话框/notice/keyed diff） |
| `nexus-stage/src/world.ts` | 2D 世界模型（座位/成员关系/组拖/marquee） |
| `nexus-stage/src/canvas-ops.ts` / `canvas-wire.ts` | 写面动作代数 + 按队串行队列传输层 |
| `nexus-stage/src/layout-wire.ts` / `layout-doc.ts` | 保存回路状态机 + host 契约镜像 |
| `nexus-stage/src/federation.ts` / `reproject.ts` | 联邦层几何 / 3D 重投影 |
| `nexus-stage/src/topology.ts` / `main.ts` | 3D 观测面（hub-star 成员边/inFlight 路线/peers） |
| `feedback/2026-08-27-nexus-canvas-ux/` | 设计/评审/实施记录/PR 材料全档案 |
