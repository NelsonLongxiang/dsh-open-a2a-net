# Protocol Face Ruling Dossier — ROUND-2 Clusters A/C

- **Status**: submitted for chair adjudication ledger (work-order direct-dc3f67d6 wave, canonical archive of the ROUND-2 submission)
- **Author**: dsh-open-a2a-net protocol face
- **Format**: one-line ruling sentence + breaking-change marker per item; acceptance criteria and rationale live in §3 and the sibling protocol documents

## 1. Cluster A — Governance topology

| ID | Ruling sentence (决议句) | Breaking |
|---|---|---|
| A1 | 双轨共存：`strategy ∈ {'hub','anycast'}` 为必检枚举，新建组默认 `'hub'`；`'anycast'` 冻结维护不强迁，连续两个发布周期零新建消费方可议移除；`add-member`/grant 对卡片无 `protoVersion≥约定值` 的成员一律拒绝 | 无 |
| A2 | 固化 C4 最小暴露面为唯一开箱姿态；组级 `visibility: 'public'\|'private'`（private=花名册事实走任务消息面、永不落持久公开卡）；`grantsOnly` 与请求签名层捆绑列为 v2 候选不作承诺 | 无 |
| A3 | v1 仅冻结：卡片过期 ∧ probe 连败 ⇒ 组入口 fail-fast 错误枚举 `captain-frozen` + 画布红帧告警，队长卡重现自动幂等解冻；晋升全留 v2 且 `autoPromoteOnLoss` 默认 false —— 无请求签名层前的自动晋升等于向全网开放夺权接口 | 无 |
| A4 | 有条件接受主席初裁主干（声明源住 harness 层 / 他端持投影 / 画布仅渲染），附加两条修正：① 引用必须是复合锚 `(originHostAnchor, declarationId, contentHash)`；② 内容哈希算法与截断长度升格为协议常量（sha256 前 16 hex）——满足即撤回反驳 | 无 |

## 2. Cluster C — Security boundaries

| ID | Ruling sentence (决议句) | Breaking |
|---|---|---|
| C1 | 立项但从债务改写为门禁条件：《投递来源鉴别最低封套》OriginClaim `{url, publicKey, nonce, ts}` 经既有 60s/30s 卡缓存验证、失败 fail-closed 拒 `untrusted-origin`；**hub GA 强制前置 = 跨宿主成员必须启用 claim 级校验**；legacy 过渡窗投递放行并在 state 观测面标 `legacyInbound:true` | 无 |
| C2 | sender-gossip 三维一体：`hopBudget` 转发即扣（**队长的对内分发计入转发跳**）、归零拒 `budget-exhausted`；`visited[]` 随载荷自携、容量 16 满员即 `cycle-detected`（永不截断列表）；绝对截止期 epoch ms 各跳只许提前、按 min() 合成 ±5s 容差；台账行记 `hopsConsumed/hopsRemaining` 供对账 | 无（缺省载荷按 DEFAULT_HOP_BUDGET=4 一次性授予并标记 `guardMode:'default'`） |
| C3 | 治理套件上线后残余整体 LOW-MEDIUM：F1 授信对手方见 internalFacts=L1 可接受；**F2 excerpt 明文=MEDIUM 主险**（处置：增 `excerptMode:'off'\|'redacted'\|'full'` 开关、默认 full 保兼容、文档披露，不阻断排期）；F3 句柄长期追踪 L2 低（rotation 钩子入 exposure 附注）；义务条款：未来任何新卡字段必须按 F1-F3 同表自评，未评估=评审阻断 | 无 |

## 3. Acceptance-criteria index

Full four-element cases (决议句/适用对象/破坏性/验收标准) were delivered in-session; the normative AC lists live here:

- **A1**: anycast 行为与 0.5.31 逐字节回归一致；未知 strategy 值读取侧拒绝载入；protoVersion 闸门拒绝并报 reason。
- **A2**: 默认配置卡片 JSON 断言无 internalFacts；private 组远端画布只渲队框+队长。
- **A3**: 杀队长进程集成场景 ≤probe 阈值内路由收结构化 `captain-frozen`（非超时悬挂）；复活一轮 poll 内解冻。
- **C1**: 伪造来源在缓存命中级被拒且可断言错误码；真实常态往返请求数零增加；cancel 复用同一验证。
- **C2**: 环构造 ≤2 跳双侧终止；16 深畅通第 17 跳拒；头部解析 O(list length ≤16)。
- **C3**: redacted/off 下摘录不含用户文本子串的模式断言；默认档行为回归不变。

## 4. Tool-face asks (responses condensed)

1. **cancel/dead-letter** → 不对称双原语：`abandon(task_id)` 调用方即时清账转 archive `'cancelled-by-caller'`（零协议依赖、可先行供货 interrupt 需求）；`cancel(task_id)` 目标端协同式（依赖 C1 验源；agent-loop 无硬中断为诚实边界，v1 = 协作旗标 + 台账即转死信 + 迟到结算降级 `ignored`），硬中断列入该件 v2 里程碑。
2. **名称解析谓词 + 阈值探活** → `resolve(name,{scope:'local'|'network',wantKind?})` 候选集带 kind 分类，歧义硬错遵循 B4 初裁、显式触网；`a2a_probe` 增 `thresholds {maxLatencyMs,minScore}` 输入与四值机器判定 `reachable|slow|rejected|unreachable`。均为工具参数扩展，无新端点。

## 5. Alignment confirmation (chair-named)

*出现在可寻面（sessionTeams 收窄后的队长地址、GroupRecord routable 成员地址）的名字，按构造即可路由；出现在 internalFacts 的条目一律 `routable:false`，是纯展示元数据，永不构成路由实参。* 我侧护栏：解析器对内部句柄返回专用错误码 `internal-not-routable`；建议 graph_loop 固化消费律「路由实参取值域 = 可寻面」双向闭合。

## 6. Cross references

- [[delivery-origin-auth]] · [[recursion-guard]] · [[fingerprint-aggregation-criteria]]
- Devivery vehicle: gitee PR !20 (`feat/payload-cap-protocol-docs`)
