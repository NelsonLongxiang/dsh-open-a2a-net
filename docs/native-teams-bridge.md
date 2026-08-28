# Native-teams 桥：映射、边界与切片范围

> 状态：implemented slice P1（出站传输面 + 入站分发，`nativeTeamsInbound` 门禁）。
> 契约权威：`@nelsonlongxiang/dsh-native-teams/src/a2a-face.ts`（0.14.0，冻结）；
> 本仓结构镜像：`src/teams-bridge.ts`（常量/形状逐字镜像，争议按协议文档仲裁）。
> 设计底稿：`D:\workspace\A2A-NODE-UNIFICATION.md`（节点统一架构，P1/P2 分片）。

## 1. 出站传输面（`nativeTeamsA2a` 服务键）

face 契约到本仓既有机制的映射（无新暴露面——只重排 a2a_route 已有的出站机器）：

| face 契约 | 本仓实现 | 备注 |
|---|---|---|
| `resolve(handle)` | **复用 `directoryPeerCandidates` 单次目录遍历**（与 submit 同一匹配器，无双重实现漂移）；命中 → `{kind:'node', hops:1, url}`；全不中 → `undefined` | resolve+submit 组合的第二次遍历走共享卡缓存，零额外网络 |
| `submit{delivery:'sync'}` | `dispatchPeerCandidate`（wait 语义），`TASK_STATE_COMPLETED` → `{kind:'completed', text}`；DELIVERED/ABORTED_WAIT → `{kind:'accepted'}` | 对端 HTTP 预算 15s（`a2a-client` 既有约束）；跨宿主长同步等待是 P2 预算议题 |
| `submit{delivery:'async'}` | **逐候选**能力闸门（镜像 a2a_route 的 failover 循环——转投的下一个候选同样只拨声明 async 的 peer）；`wait:false` 派发 → `{kind:'accepted', taskId, acceptedAt}` | accepted 提交按既有规则进欠账账本（`a2a_tasks` 可见） |
| `idempotencyKey` | 即 wire `task_id`（B3：编排方铸造的 dedup 键 = 线上任务 id，对端幂等闸门沿用）；缺省时本端铸 `direct-<8hex>` | **对端 409 判决是终态非 failover**：`-32003` 回放 → `accepted`（先前尝试在对端仍权威，转投=重复执行）；`-32002` 冲突 → 抛错（调用方 bug，同键异载荷） |
| `contextId` / `sessionKey` | `context_id` 直通；`sessionKey` 由调用方（native-teams registry）持有，face 不解释 | |
| `callbackTarget` | **P2a 已接**——映射为提交会话自身的节点地址 `<team>/<id8(parentSessionId)>`（父会话是 joined 节点时；否则回落 bare team），经 wire 新增 `callback` 字段携带；对端把回执提示与宿主代发回执都指向该地址，冷父会话由 wake-on-route 物化 | wire 字段对旧 peer 无感（多余 body 字段被忽略） |
| `cancel(ref)` | 欠账行定位 → 本地：镜像控制路由（目标解析横跨会话节点/canvas/bare 团队，与派发侧同集，对活目标 steer `[A2A cancel]`）；远端：**经 wire 向该团队投递停止通知**（对端不跟踪入站任务 id，其账本路由必然 `unknown`）→ 清除本端欠账行 | 协作式，best-effort；通知措辞单一来源 `cancelNoticeText`；**通知刻意不带原 task_id**——原 id 已在对端幂等账本以不同载荷 claim，复用必 409 冲突在 steer 之前被拒（原 id 随通知文本携带） |

挂载方式：`ctx.reflect.provide('nativeTeamsA2a', face)`（fiber effect-scoped，随卸载回收）；
native-teams 侧 presence-guarded probe（`mountedA2AFace`）——未挂载时对端降级纯本地路由，永不 crash。

## 2. 入站分发（`nativeTeamsInbound`，默认 `false`）

判定与派发链（`/a2a/direct`、出站工具的本地候选、目录列行三处共用）：

```
team 名 → 会话节点精确解析 → canvas 团队 → 冷 joined 唤醒
  →【新增】teamsRegistry probe（claim 判定 memo 5s，仅在同步快速检查全失时才支付 await）
  → describeTarget(team)：plane==='local' 且非 ambiguous 且有 localLabel → 命中
  → startRound({team, message: A2A信封}, parent=本节点活 initiator, signal)
→ bare team 兜底（次序在桥之后）
```

- **opt-in 纪律**：注册表存在本身绝不是暴露——清单列行、路由派发都只在
  `nativeTeamsInbound: true` 时生效（exposure-grants 治理姿态：授予是显式的，从不是环境的）。
- **仅 dispatcher 层**：入站调用方寻址团队，不能寻址成员——成员保持
  visible-not-addressable（T3 `routable:false` 的结构对应物）。
- **次序纪律**：registry 主张**绝不遮蔽**活的本地会话团队——所有路径先会话/canvas/
  唤醒，桥只在 miss 时介入（与上方链序一致）。
- **parent-of-record**：P1 用本节点活 initiator（与 bare-team 兜底同一身份语义；
  入站轮在谱系上等价于操作者从 main 发起的一轮）。专用 broker 单节点留 P2。
- **B4 保持**：ambiguous 声明由桥拒收（`ERR_TARGET_AMBIGUOUS` 语义归属 native-teams，
  桥只做到"不抢"）；桥对 registry 缺席/seam 未挂载/describeTarget 抛错一律视为不主张。
- **prepare-first（幻影禁令）**：脱离派发（`wait:false` 与 async 工具路径）先做
  prepare（主张+seam+initiator——全部可快速失败的项），prepare 过关才应答
  delivered；任何 fast-fail 如实报错并记失败活动环。派发后的迟到失败纠正活动环 + warn。
- **有界等待**：轮等待有 180s 死线（`nativeRoundWaitMs` 可调，对齐 steer 路径），
  超时应答诚实的 delivered-unsettled 形态（**不承诺回执**——steer 死线文案的
  回执承诺对本桥是假的）；调用方 abort（存在时）经 signal 贯通取消轮本身。
- **无回执 ⇒ 不记账**：本切片 native-teams 轮不发 A2A 回执，其结果携带
  `bridge: 'native-teams'` 标记，`trackOwedTask` 据此跳过——不可兑付的行绝不
  占据 64 格欠账账本（回执回流 callbackTarget 消费端是 P2）。

## 3. 错误与守卫继承

| 形态 | 行为 |
|---|---|
| resolve 全不中 | `undefined`（调用方 seam 报 `faceUnmounted`/不可达，文案归属 native-teams） |
| submit 无候选 / 全候选失败 | 抛错（native-teams 包装为 `submitFailed`）；候选取尽即止，逐候选 failover |
| submit 对端 409 回放（-32003） | 终态 `accepted`——先前尝试在对端仍权威；绝不转投其他 peer |
| submit 对端 409 冲突（-32002） | 抛错（同键异载荷是调用方 bug，重定向只会扩散错误） |
| submit async 对非 async peer | 不静默降级为分钟级阻塞：该候选按同步语义拨号（逐候选判定） |
| 入站桥 off / registry 缺席 / 声明歧义 | 标准解析链裁决（标准 no-live 错误），桥零痕迹 |
| 入站轮失败（等待式） | 诚实错误（含 sibling 错误文本），活动环记失败 |
| 入站轮超时（`nativeRoundWaitMs`） | delivered-unsettled 形态（不承诺回执），轮继续运行 |
| 入站轮失败（脱离式） | prepare 阶段失败：如实报错、绝不回答 delivered；派发后失败：活动环纠正 + warn 日志 |
| 调用方 abort | 存在 signal 的路径贯通取消轮本身；无 signal 的 HTTP 入站仅释放等待者 |

## 4. P2 待办锚点（本文件的后续章节位）

1. ~~callbackTarget 消费端（回执回流提交会话）~~ → **P2a 已落**：wire `callback` 字段（入站 noWait 的回执提示 + 宿主代发回执地址；出站 `routeDirect`/face.submit 携带）。剩余半段：native-teams 侧对 startRoundAsync 调用方的回执-轮关联（依赖 sessionKey 语义）。
2. sessionKey durable 化（触 native-teams 写保护红线，需运营者裁定）。
3. 专用 inbound broker 单节点（替换 initiator 兜底 parent）。
4. 跨宿主同步提交的 HTTP 预算扩展（现 15s，`a2a-client` 既有）。
5. wire `sessionTeams[].kind: 'session'|'team'` 类型字段（卡片增量，老 peer 未知键忽略）。
