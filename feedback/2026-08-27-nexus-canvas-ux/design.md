# Nexus 规划模式 · 无限画布节点交互设计 v0.1

> 设计席交付 · 2026-08-27 · 状态：已实施（2026-08-29，A–D 四步全部落地；偏离与实施期修复见同目录 implementation-notes.md）
> 依据：`docs/canvas-stage-design-system.md`（Swiss 极简 + 三层令牌 + 点阵世界层 + 零缓动）、`docs/canvas-ui-contract.md`（锁定 v1）、`src/layout-store.ts`（布局持久化契约 v2）、`nexus-stage/src/main.ts` 现状。
> 线框实证：同目录 `prototype-v1.html` + `shots/prototype-v1.1.png`。

## 0. 与 dsh-ecom 仓的本质差异（边界自动澄清）

在 dsh-ecom 仓，连线/组队会撞「编排面归他线」红线；**本仓不存在该问题**——canvas team 就是本仓的一等功能（v0.5.25，契约锁定 v1），画布上的组队/成员操作直接对应既有写面 `POST /__dsh_a2a/canvas`，布局持久化对应既有 `/__dsh_a2a/canvas-layout`。**本设计不新增任何 host API**，全部交互落在两个已锁定契约内。

## 1. 形态裁决：双模，不做「3D 里塞编辑器」

| 模式 | 载体 | 职责 |
|---|---|---|
| 观测模式（现状保留） | Three.js 3D（`nexus-stage` main.ts 路线） | 拓扑观赏、态势总览——轨道相机、球体节点、雾效氛围是它的正当语言 |
| **规划模式（本设计新增）** | 2D 俯视无限画布 | 拖拽排布、框选组队、成员管理、标签/HUD——点阵工程坐标纸、LayoutStore 的 `{x,y}` 坐标与 `frames` 矩形都是 2D 语义 |

理由：教义文档的点阵世界层、零缓动拖拽、卡片拾起 120ms 全部是 2D 语言；3D 轨道相机下精确框选/文字标签/队框矩形都不成立。`LayoutStore` 的 `viewport{x,y,scale}` + `LayoutPoint` + `LayoutRect` 证明 host 侧早就按 2D 画布建的模。两模共享同一 `GET /__dsh_a2a/state` 数据源，tab 切换。

## 2. 实体模型（全部映射既有数据形状）

| 视觉实体 | 数据来源 | 视觉规格（三层令牌） |
|---|---|---|
| SessionNode 单节点 | `state.sessions[ joined=true ]` | 172px 卡片：live=实心绿点 `--edge-live` + 左 3px 色条；cold=空心点 + `--edge-cold` 色条；名称 + mono 路由别名 `<team>/<id8>`；选中=accent 外描边；focus-visible=accent 环 |
| TeamFrame 团队框 | `state.canvas.teams[]` + `LayoutSnapshot.frames` | 圆角矩形包裹成员：色相取 `FRAME_HUES` 按队名哈希；标题栏=队名 + 成员计数 + mono 线名 `<team>/canvas/<name>`；底色 hue×0.05 透明度 |
| PeerBadge 对等点 | `state.peers[]` | 菱形徽章 + 虚线边框 `--uupm-edge-federal` + score 标注（对应 3D 死代码 `scene.ts addPeer` 的 2D 落位） |
| 成员边 | teams[].members 派生 | **星形：队框标题栏锚点 → 各成员**，替代现状 O(n²) 两两全连接（实证：opacity 0.15 两两线在深色底上不可见且无信息增量）；跨队多属成员的第二及以上成员边用虚线（契约不变量 2 多对多的可视化） |
| 活动边 | `state.inFlight[]` 派生 | accent 色 2px 虚线流动（`stroke-dashoffset` 动画），瞬时存在；reduced-motion 时静止 + 保留文字标签 `a2a_route · task <id8> · <elapsed>` |
| 联邦线 | peers 派生 | indigo 虚线 本机原点→peer，标签 `gns referral` |
| 优先级徽标 | members 数组序 | 卡角 `P0/P1/P2…` = 成员序=路由优先级（契约不变量 4：只承诺序，不承诺"下一个投给谁"） |

**成员资格渲染纪律（直接抄契约不变量）**：加成员交互只列 joined 行（同意不变量）；leave/archive 后成员关系随轮询自然消失，UI 不做本地缓存挽留；64 队 × 32 成员上限不做前端预校验，以 host `ok:false` 为准。

## 3. 交互规格

### 3.1 视口（教义零缓动：操作=身体延伸）
- 平移：空白拖拽 / Space+拖拽 / 中键；缩放：Ctrl+滚轮 0.25×–3×（对齐 LayoutStore clamp）以指针为锚；`0`=适配视图
- 点阵世界层随内容平移缩放（radial-gradient dot grid，`background-position/size` 跟随 viewport 变换）
- 视口状态（x,y,scale）随布局一起持久化——重开回到离开时的位置

### 3.2 选择与拖拽
- 单击选 / Shift 加选 / 空白拖出框选 / Tab 键盘遍历 / Esc 清空
- 节点拖拽：零缓动跟随指针；拾起 scale 1→1.02 + 边框亮起 120ms bezier（教义 §四原样）；松手 → 防抖 800ms `POST /__dsh_a2a/canvas-layout {action:"save"}`；保存指示灯颜色插值 140ms（绿=已存 / 琥珀=待存 / 红=存失败可重试）
- 队框拖拽=整组移动（成员相对坐标不变）；拖标题栏空白区亦然

### 3.3 组队 / 成员管理（连线诉求的落点——见 §4 裁决）
| 动作 | 交互 | 写面 |
|---|---|---|
| 建队 | 框选 ≥2 joined 节点 → 右键「组成团队」/ `G` → 命名（host 校验 1..40 拒 `/` 纯数字） | `create` + 逐成员 `add-member`（按框选顺序=优先级序） |
| 入队 | 拖节点入队框 → 框边框亮起 → 松手 | `add-member`（重复幂等 ok:true，UI 无错态噪音） |
| 离队 | 拖节点出框到空白 | `remove-member` |
| 调优先级 | 队内拖节点上下排序 / 右键「置顶路由」 | `remove-member` + `add-member` 重排（契约无 reorder action，用既有动作组合，成员序即优先级） |
| 散队 | 右键队框 →「解散团队」 | `remove`（连成员关系消失；节点卡片保留在画布原位） |
| 无拖拽等价路径 | 右键节点 →「加入团队 ▸」列出队名菜单（WCAG 2.2 Dragging Movements） | 同上 |

### 3.4 反馈闭环
- 每个写操作：乐观更新 → host 回 `ok:false` 时回滚 + Toast 带 host error 原文（不吞错——吸取 `cycle()` 空 catch 教训）
- 顶部状态条：`● n live · ● n cold · n inFlight · n peer`，点击计数飞行定位
- 数据增量：5s 轮询只动变化节点（新增淡入/消失淡出 250ms，reduced-motion 时直接替换）

## 4. 关键裁决：不支持自由手画边

用户诉求含「连线」交互，本仓裁决为：**边全部派生，不允许自由绘制**。理由：
1. 契约里不存在「任意两节点连边」的写面——成员边、活动边、联邦线各有 host 语义归属（路由组/在途任务/对等发现），自由边无对应领域语义，画了就是装饰性假数据；
2. 「把 A 和 B 连起来」的真实意图 = 让它们同队可路由 = 拖 B 进 A 的队框（`add-member`），已有精确对应；
3. 若未来需要「跨队依赖编排」语义，那是 host 契约 v2 的事，先改 `canvas-ui-contract.md` 再走 PR，UI 不抢跑。

## 5. 键盘与无障碍（教义硬性基线）

| 键 | 动作 | 键 | 动作 |
|---|---|---|---|
| `G` | 选中节点组成团队 | `0` | 适配视图 |
| `Delete` | 离队/散队（按焦点对象） | `Tab`/`Shift+Tab` | 焦点遍历 |
| `Enter` | 打开节点详情 | 方向键 | 微移选中节点 8px（Shift=40px） |
| `Esc` | 清空选择/关浮层 | `?` | 快捷键速查 |

- 对比全对 ≥4.5:1（深色优先）；焦点环统一 accent；四态齐备（default/hover/active/focus-visible）；零 emoji（SVG 或纯字符 ×＋－）；reduced-motion 全动画置 none、状态以文字保留；内网离线禁外部字体 @import（Avenir Next/Segoe UI + ui-monospace/Cascadia 本地栈）。

## 6. 实施路线（每步独立 PR，走 worktree 四角色流程）

> 实施状态（2026-08-29）：四步全部完成；偏离裁决见同目录 implementation-notes.md。

| PR | 内容 | 复用/依据 | 状态 |
|---|---|---|---|
| A. 取证修复先行 | `cycle()` 空 catch 改显式离线态卡；`fetchLayout` 接线（布局加载→定位→保存回路）；成员边改星形 + opacity 提到可见 | main.ts 现状；本交付 review.md P0 三条 | ✅ 已实施 |
| B. 规划模式骨架 | 2D 画布 tab：点阵世界层 + 节点卡 + 队框 + 星形边 + 布局持久化回路 + 拖拽/框选 | `LayoutSnapshot.frames` 首次有消费者 | ✅ 已实施 |
| C. 组队交互 | 建队/入队/离队/调优先级/散队全动作 + 乐观更新回滚 + 右键菜单等价路径 | 契约写面四 action；A2aControl.tsx 列表版是参照实现 | ✅ 已实施 |
| D. 活动/联邦层 | inFlight 活动边 + peer 徽章 + 联邦线 + 状态条飞行定位 | `state.inFlight/activity/peers` 已下发未消费 | ✅ 已实施 |

验收门：教义 §五交付前门六条 + 契约不变量四条逐条 + `tests/canvas-stage.spec.ts` in-process harness 范式补规划模式用例 + 三缩放抽查对比度。


## 7. 对等节点卡 v1（设计方向：用户裁决 2026-08-29）

> 裁决原文："对等节点事实上跟会话节点没什么区别，他是团队节点的一种展现形式，只是只保留了一个节点入口。"
> 协议依据：目录实现（index.ts listDirectoryTeams）对每个 peer 抓签名卡片，卡片携带该宿主全部会话团队，行标 origin（宿主聚类）/ via（对端端点）——**对等节点就是一组远端团队行的折叠分组入口**，数据模型已按此组织，画布此前未消费。

### 7.1 统一节点模型

节点 = 联邦图中的入口。两类：

| | 本地会话节点 | 对等节点（远端组节点） |
|---|---|---|
| 入口指向 | 本地团队成员 | 经由该对端可达的远端团队（卡片 sessionTeams，state.remote 行） |
| 状态徽标 | live ● / cold ○ | 可达性 score（a2a_probe 数据） |
| 可操作性 | 拖拽排布、加入/离队、路由目标 | 拖拽排布、展开远端团队清单；**无 join/leave**（不引入"加入对端宿主"假语义） |
| 布局持久化 | nodes{id:{x,y}} | **同表**：节点键 `peer-<host>:<port>`（≤128 不透明字符串，v1 契约无 schema 变更） |

保留的唯一类型差异：peer 不可入本地队（成员必须 joined session——契约不变量 1）。

### 7.2 交互规格

- 卡面：172px 卡（同 chrome），靛蓝远端徽标替代 live 点，host:port 替代路由别名，`score N` 替代 P 徽标，展开区列远端团队行（team + workspace，来自 state.remote 按 via 聚合）
- 拖拽：与本地卡同管线，位置随布局文档持久化（save/adopt round-trip）
- 右键菜单：v1 无操作项（不提供加入本地队/路由）；Ctrl+滚轮缩放、框选、Esc 全适用
- 建队：选择集里的对等卡**不参与**（ids 过滤 remote；全 remote → info 提示）
- 联邦线/活动边：不变（hub/badge → 保留现有锚定）

### 7.3 验收门

1. 布局文档含 `peer-*` 键，clampDoc 通过（键 ≤128 无约束冲突），save/adopt round-trip 位置保持
2. 拖拽对等卡 → 0px 端点偏差的边随动（活动边锚定到对端卡）
3. demo=1 下 2 张远端卡渲染远端团队清单；XSS：url/name 纯 textContent
4. 选择集全为对等卡时 G → info 提示；混合选择 → 仅本地会话入 ids
5. 设计系统门（四态/令牌/reduced-motion/无 emoji）逐项过
