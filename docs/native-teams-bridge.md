# Native-teams 桥：映射、边界与切片范围

> 状态：implemented slice P1（出站传输面 + 入站分发，`nativeTeamsInbound` 门禁）。
> 契约权威：`@nelsonlongxiang/dsh-native-teams/src/a2a-face.ts`（0.14.0，冻结）；
> 本仓结构镜像：`src/teams-bridge.ts`（常量/形状逐字镜像，争议按协议文档仲裁）。
> 设计底稿：`D:\workspace\A2A-NODE-UNIFICATION.md`（节点统一架构，P1/P2 分片）。

## 1. 出站传输面（`nativeTeamsA2a` 服务键）

face 契约到本仓既有机制的映射（无新暴露面——只重排 a2a_route 已有的出站机器）：

| face 契约 | 本仓实现 | 备注 |
|---|---|---|
| `resolve(handle)` | peer 卡直查（`card.team` / `sessionTeams[].team`）→ `kind:'node', hops:1`；zone 委托解析 → `kind:'zone'`；全不中 → `undefined` | 只应答 peer 网络已发布的名字 |
| `submit{delivery:'sync'}` | `dispatchPeerCandidate`（wait 语义），`TASK_STATE_COMPLETED` → `{kind:'completed', text}`；DELIVERED/ABORTED_WAIT → `{kind:'accepted'}` | 对端 HTTP 预算 15s（`a2a-client` 既有约束）；跨宿主长同步等待是 P2 预算议题 |
| `submit{delivery:'async'}` | 能力闸门：仅拨签名卡声明 `capabilities.async` 的 peer（镜像 a2a_route）；`wait:false` 派发 → `{kind:'accepted', taskId, acceptedAt}` | accepted 提交按既有规则进欠账账本（`a2a_tasks` 可见） |
| `idempotencyKey` | 即 wire `task_id`（B3：编排方铸造的 dedup 键 = 线上任务 id，对端幂等闸门沿用） | 缺省时本端铸 `direct-<8hex>` |
| `contextId` / `sessionKey` | `context_id` 直通；`sessionKey` 由调用方（native-teams registry）持有，face 不解释 | |
| `callbackTarget` | **P1 不消费**——wire caller label 为本节点标签，回执暂落本端 bare team（initiator），由欠账账本对账 | 回执回流到轮 = **P2 切片** |
| `cancel(ref)` | 账本行定位 → `peer === 'local'` 本端 `taskLedger.cancel`；远端走对端 `/__dsh_a2a/tasks/cancel` 控制路由（共享 api key 守卫） | 协作式，best-effort |

挂载方式：`ctx.reflect.provide('nativeTeamsA2a', face)`（fiber effect-scoped，随卸载回收）；
native-teams 侧 presence-guarded probe（`mountedA2AFace`）——未挂载时对端降级纯本地路由，永不 crash。

## 2. 入站分发（`nativeTeamsInbound`，默认 `false`）

判定与派发链（`/a2a/direct`、出站工具的本地候选、目录列行三处共用）：

```
team 名 → 会话节点精确解析 → canvas 团队 →【新增】teamsRegistry probe
  → describeTarget(team)：plane==='local' 且非 ambiguous 且有 localLabel → 命中
  → startRound({team, message: A2A信封}, parent=本节点活 initiator, signal)
→ bare team 兜底（次序在桥之后）
```

- **opt-in 纪律**：注册表存在本身绝不是暴露——清单列行、路由派发都只在
  `nativeTeamsInbound: true` 时生效（exposure-grants 治理姿态：授予是显式的，从不是环境的）。
- **仅 dispatcher 层**：入站调用方寻址团队，不能寻址成员——成员保持
  visible-not-addressable（T3 `routable:false` 的结构对应物）。
- **parent-of-record**：P1 用本节点活 initiator（与 bare-team 兜底同一身份语义；
  入站轮在谱系上等价于操作者从 main 发起的一轮）。专用 broker 单节点留 P2。
- **B4 保持**：ambiguous 声明由桥拒收（`ERR_TARGET_AMBIGUOUS` 语义归属 native-teams，
  桥只做到"不抢"）；桥对 registry 缺席/seam 未挂载/describeTarget 抛错一律视为不主张。
- **noWait 语义**：轮脱离派发，应答 delivered（`consumed:false` + `bridge:'native-teams'`）。
  **本切片 native-teams 轮不发 A2A 回执**——脱离轮的结果经其自身链结算，调用方以
  context_id 续查；回执回流（callbackTarget 消费端）是 P2。

## 3. 错误与守卫继承

| 形态 | 行为 |
|---|---|
| resolve 全不中 | `undefined`（调用方 seam 报 `faceUnmounted`/不可达，文案归属 native-teams） |
| submit 无候选 / 全候选失败 | 抛错（native-teams 包装为 `submitFailed`）；候选取尽即止，逐候选 failover |
| submit async 对非 async peer | 不静默降级为分钟级阻塞：按同步语义拨号，如实回 completed |
| 入站桥 off / registry 缺席 / 声明歧义 | 标准解析链裁决（标准 no-live 错误），桥零痕迹 |
| 入站轮失败 | 同步：诚实错误（含 sibling 错误文本）；脱离：活动环记失败 + warn 日志 |

## 4. P2 待办锚点（本文件的后续章节位）

1. callbackTarget 消费端：入站 receipt → sessionKey 匹配在途轮 → 唤醒 parent-of-record → 轮结算。
2. sessionKey durable 化（触 native-teams 写保护红线，需运营者裁定）。
3. 专用 inbound broker 单节点（替换 initiator 兜底 parent）。
4. 跨宿主同步提交的 HTTP 预算扩展（现 15s，`a2a-client` 既有）。
5. wire `sessionTeams[].kind: 'session'|'team'` 类型字段（卡片增量，老 peer 未知键忽略）。
