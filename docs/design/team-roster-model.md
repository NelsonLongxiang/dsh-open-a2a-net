# 设计卡：节点平铺 + 多队成员制（allowlist 准入）+ F8 期望态对账

日期：2026-08-31。状态：迭代窗实现中。裁定：allowlist 起步（代决策席 2026-08-31 裁决，依据主人既有指令"未加入的节点不能自主加入，且拒绝一切 a2a 相关 tools 访问"的制度化）。

## 一、现状三处碎片化（2026-08-31 代码取证 @ f6c777b）

1. **节点身份碎片化**：无统一节点概念——本地是 `sessions[]`，远端是各 peer card 的
   `sessionTeams[]`；队名按 zone 前缀（`dsh/<id8>`）命名，跨主机同 id8 会撞名。
2. **队伍形态异构**：进程队（`dsh`）、会话队（与会话 1:1）、canvas 队（唯一有成员表，
   但成员表是宿主本地的、由"队"声明成员）、native-teams 桥（opt-in 入站）。
3. **加入语义错位**：加入 = 会话加入**网络**（joined.json 意图 + 侧边栏/a2a-collab CLI），
   不是加入队伍；模型工具面无任何 join/leave 工具。

## 二、目标模型

### R1 节点平铺（S1）

- 统一节点视图 `nodes[]`：本地会话 + 远端 card 节点一张表，含 `id / zone / host /
  live / teams[] / workspace / label`。
- 节点稳定 ID：zone 限定 `dsh-host-<node>/<id8>`（card key 派生），本地节点同样以
  zone 限定形态呈现，消除跨主机撞名。

### R2 多队成员制（S2）

- 成员关系**反转**：从"队声明成员"（canvas 现状）变为"**节点声明自己属于哪些队**"
  （`teamMemberships[]`，随 card 发布、跨主机可对账）。
- 队花名册 = 成员声明的并集；canvas 队泛化为网络级 team store 的种子实现。

### R3 队内协作边界（S3）

- 路由 admission：调用方与目标须**共享 ≥1 队**；无队节点不可路由、不可发现。
- 政策：`teamJoinPolicy: 'allowlist'`（起步，默认）；宿主配置 `teamJoinAllowlist`。
- enforcement 默认关（`teamScopeRouting: false`）；开启前须经代决策席报备。

### R4 团队工具（S4）

- `a2a_teams` 升级：花名册感知（每队成员数/成员节点摘要）。
- 新增 `a2a_team_join` / `a2a_team_leave`：模型可自主调用，受 allowlist 政策闸门，
  state 面审计留痕（谁、何时、加入/退出、政策判定）。

## 三、F8 期望态对账器（与本迭代同窗实现）

消除自动唤醒的三个结构硬伤（2026-08-31 根因定案）：

1. 单次快照（boot 后才冷/才加入的会话永无覆盖）→ 对账器周期 diff（默认 60s）。
2. 失败无重试 → 指数退避 + `lastWakeError/attempts` 落 state 面。
3. `materializer-unavailable` 静默停摆（`return` 不再调度）→ 修复为记录后续跑。
4. corrupt log → 标 `needs-repair`（停退避，暴露修复入口），不无限重试。
5. boot prewarm 降级为对账器首轮；wake-on-route 保持不变。
   - **并存关系（评审 nit 对齐，6e7441b6 留痕）**：对账器对 prewarm 是**吸收式替换**，
     非叠加降级——boot 预热保留为"首轮快速排空"（大舰队一次性批量物化的分期节奏），
     其后常驻收敛只由对账器承担；两教科书式语义不再各自为政。
   - **字段命名约定**：state 面新观测字段统一 `reconcile.*` 前缀
     （state/lastTickAt/lastChecked/woken/rows[].{id,error,attempts,nextRetryAt,needsRepair}），
     不与 prewarm.* 旧字段混用——旧字段保留只读，待下个大版本再议合并。

## 四、切片与验收

| 切片 | 内容 | 验收 |
|---|---|---|
| S1 | 节点注册表 state 面 | 重启后 T+60s 内 state.nodes[] 覆盖本地+远端全部节点 |
| S2 | team store + card 发布 memberships | 双节点互见花名册一致 |
| S3 | 队内路由准入（默认关） | 开启后非共享队路由被拒且错误码可读 |
| S4 | join/leave 工具 | allowlist 外 join 被拒且提示入册路径；审计留痕 |
| F8 | 对账器 + prewarm 加固 | 重启后 T+N 分钟全部非 archived 意图物化或带原因码；corrupt 行标 needs-repair |

## 五、非目标

- 不改 native-teams 桥语义；不引入中心化目录服务器；不做跨 zone 队联邦（后续卡）。
