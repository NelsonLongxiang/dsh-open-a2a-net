# 网络成员展示与管理设计——组队节点画布 + 单节点列表

> 状态：设计稿（待龙翔批准后进 worktree+PR 实现）
> 日期：2026-08-31 · 基于 master 2e11b6f（!73–!80 全部合并后）
> 关联：docs/design/team-roster-model.md（S1–S4）、docs/design/panel-activity-feed.md（面板瘦身）

## 1. 需求（龙翔原话拆解）

1. 会话如何加入网络、如何管理——展示与手势设计。
2. **仅展示组队节点就够了**——画布（3D 场景 + 规划视图）只放有队伍的节点。
3. **单一节点**（未组队的）**根据选择不同的 host 或 对等节点展示在 list 中**——列表 + host/peer 选择器。
4. **再次确认：非组队的对等节点不具备网络连接能力，状态等同于未加入网络。**

## 2. 现状取证（代码级）

### 2.1 能力边界——三道闸的真实现状

| 闸 | 位置 | 管什么 | 现状 |
|---|---|---|---|
| Join gate（v0.5.24） | `a2aJoinGateRefusal`（src/index.ts:2890） | 本机**未 joined** 会话禁用全部 a2a 出站工具（initiator 豁免） | ✅ 默认生效 |
| S3 队伍域路由 | `teamScopeRouting`（src/index.ts:3276） | 开启后：无 roster 队伍的会话 caller = 无网络；路由目标必须在已声明队伍内 | ⚠️ **默认 OFF**，只管出站、只管道具调用方 |
| 入站解析 | `/a2a/direct` 派发（src/index.ts:2091–2123） | 按 team 名解析：进程 team / 会话 team / canvas team / native-teams 桥 | ❌ **roster 不参与入站** |

### 2.2 对龙翔断言的核对结论

**"非组队的对等节点不具备网络连接能力，状态等同于未加入网络"——今天不成立（默认配置下）。**

- 一个 `announce: true` 但零 roster 队伍声明的对等节点：它的进程 team 和全部 joined 会话 team 依然被 `a2a_teams` 发现、依然可被 `a2a_route` 路由（目录解析是 card-based，不是 roster-based）。
- S3 的语义正是这个断言（"a teamless node has no network"，src/index.ts:3288 错误文本原文），但它是 **opt-in** 且只管本机会话的出站。
- 卡片已经发布 `teamMemberships`（serve-fresh，src/index.ts:1824–1830），但**读取侧不解析**——`collectPeer`（src/index.ts:3166–3182）只取 `card.team` + `card.sessionTeams`，远端节点的队伍归属在本机不可见（S2 只完成了本地 half）。

### 2.3 展示现状

- **3D 场景 / 规划视图画布**：joined 会话节点 + `peer-*` 节点（按 peer URL 一个节点，无队伍概念）+ canvas team 框。
- **规划视图工具栏**：`未入网(N)` chip + 下拉 → `join-network`（本机未 joined 会话的唯一 GUI 入网口）。
- **节点右键**：组成团队 / 加入团队 / 置顶路由 / 离队 / **退网**（remote 节点只读，无退网）。
- **双轨并存**：canvas teams（GUI 组队，框的成员）与 roster teams（`a2a/teams.json` 声明式，S3 的作用域）是两套队伍概念；规划视图 frames 只用 canvas teams，roster（`registry.teams`）已进 state 面但未进画布。

## 3. 设计

### 3.1 状态语义（三态，先统一词汇）

| 状态 | 定义 | 网络能力 | 展示位 |
|---|---|---|---|
| **未入网** | 无 join 意图（joined:false） | 无（join gate 已保证） | 列表「未入网」组 + 入网手势 |
| **未组队** | joined:true 但零队伍（canvas ∪ roster 皆空） | 今天有 → 目标态无（§3.4） | 列表「未组队」组，标记"无网络能力" |
| **已组队** | 至少一个队伍成员（canvas frame 成员 ∪ roster 声明） | 有 | **画布**（唯一画布入场券） |

「组队」判定取 canvas 成员与 roster 声明的**并集**——canvas 是可视化编排层，roster 是网络声明层，任一成立即算组队。

### 3.2 D1 数据面补齐（host 侧）

1. **解析远端队伍归属**：`collectPeer` 增读 `card.teamMemberships`（已在卡片上，零发布侧成本）→ `DirectoryTeamRow` 与 `remoteRowsCache` 行带 `teams: string[]`；`registry.nodes` 的 remote half 同样携带。
2. **state 面 additions**（全部增量、向后兼容）：
   - `sessions[]` 行已带 joined/live；补 `teams`（roster 声明，registry.nodes 已有，sessions 行对齐）。
   - `remote[]` 行补 `teams`。
   - `registry.teams` 已有本地 roster；远端 roster 由各 card 的 memberships 按 team 聚合（`registry.remoteTeams`，增量键）。
3. 无新持久化、无新配置——纯读取侧解析 + state 面增字段。

### 3.3 D2 展示模型（规划视图为主面）

**画布过滤（B1）**：`reconcile` 只 upsert `memberships.length > 0` 的节点（含 peer 节点有队伍声明时）。无队伍节点从画布移除——不是隐藏，是**没有画布入场券**。

**节点列表（B2，新面板）**：工具栏新增「节点」按钮，开 drawer/popover：

```
┌ 节点 ──────────────────────────────┐
│ host: [本机 ▾]  ← 选择器：本机 + 每个 peer origin │
│ ── 未组队 (2) ── 无网络能力 ──       │
│  ● skills-manager  dsh/50b344c2   [入队▸][退网] │
│  ○ 冷·watch-dog    dsh/c166695d   [入队▸][退网] │
│ ── 未入网 (1) ─────────────────────  │
│  ◌ ontology-parser  —             [入网]      │
│ ── 已组队 (3) ── 画布展示 ──         │
│  ● main-chat     dsh/2e11…  队×2  [定位]      │
└─────────────────────────────────────┘
```

- **host 选择器**：选项 = 本机 + 每个 peer origin（origin 已带 `session (lanIp)`，天然分组维）；切换即切换列表内容。远端行只读（无入网/退网手势，入队手势仅本机）。
- 已组队行仅作清单与「定位」（画布聚焦），管理手势留给画布右键。
- `未入网(N)` chip 并入此列表（同一面板的一组），chip 保留作快捷入口。

**3D 场景**：同过滤规则（组队节点 + peer 信标），保持与规划视图同一数据契约。

### 3.4 D3 能力规则——让断言成真（分阶段）

断言今天不成立（§2.2），使其成立的三步：

- **阶段一（本 PR 范围）**：展示等价 + 明示。未组队节点在列表标记"无网络能力"；`teamScopeRouting` 文档化为 teamed-only 网络的开关。不动默认。
- **阶段二（独立 PR，需决策）**：`teamScopeRouting` 默认翻 ON（teamed-only 出站）。配套旧节点能力旗标（backlog 已有 P2 卡片"旧节点能力旗标"）——无 roster 面的旧版本节点在目录中标记降级。
- **阶段三（独立 PR，依赖硬化）**：入站校验——`/a2a/direct` 拒投与本机任何队伍无交集的 caller。前置：caller 身份可信化（docs/protocol/delivery-origin-auth.md 今天仍是 best-effort；无身份硬化的入站队伍校验只能挡自报 label，如实告知）。

### 3.5 管理手势总表（贯通画布与列表）

| 手势 | 入口 | 目标 | 落点 |
|---|---|---|---|
| 入网 | 列表「未入网」行 / 工具栏 chip | 本机未 joined 会话 | `POST /__dsh_a2a/join`（现有） |
| 退网 | 列表「未组队」行 / 画布节点右键 | 本机 joined 会话 | `POST /__dsh_a2a/leave`（现有） |
| 入队 | 列表行 / 画布右键「加入团队▸」 | 本机 joined 会话 | canvas `add-member` 或 `a2a_team_join`（allowlist 闸） |
| 离队 | 画布右键「离队▸」 | 队成员 | 现有 |
| 建队 | 框选 ≥2 节点 →「建队」 | 画布已组队节点 | 现有 |

远端节点：全程只读（其入网/组队由各节点自治——去中心化铁律）。

## 4. 实施切分（建议两个 PR）

- **PR-A（数据面 + 展示）**：D1 全部 + D2 全部 + D3 阶段一。
  验收：① 单测——collectPeer 解析 memberships、state 面 teams 字段、reconcile 组队过滤；② 3081 双节点实测——无队伍会话不进画布、列表三态分组正确、host 选择器切换、入网/退网手势闭环；③ 面板回归（activity feed 不动）。
- **PR-B（能力默认翻转，独立决策）**：D3 阶段二 + 能力旗标。阶段三另立。

## 5. 风险与开放问题

1. **双轨队伍长期统一**：canvas team（可视化）与 roster team（网络声明）并存是有意的（编排层 vs 声明层），但"组队"并集判定要在文档与 UI 文案中保持一致，避免"在框里但没声明"的认知差。开放：是否给 canvas 建队手势联动 roster 声明（默认否——声明是网络可见动作，过 allowlist 闸，不该被画布手势隐式触发）。
2. **阶段二的行为破坏**：翻默认后，现网所有未声明队伍的 joined 会话立即失去出站能力。需要版本旗标 + 发版说明 + 龙翔批准。
3. **远端 memberships 的时效**：card 读取有 TTL 缓存（remoteRowsTtlMs 15s），远端退队的展示延迟 ≤ 一个 TTL，可接受。
4. **peer-* 节点的队伍归属**：peer 信标节点本身不是会话节点，其"队伍"来自该 peer card 的 memberships 聚合展示，不参与画布组队过滤的入场券判定（信标恒定展示）。
