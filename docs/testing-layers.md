# 测试分层模型（testing layers）

> 2026-09 重构：原 `tests/` 平铺 50 个 spec，`apply.spec.ts` 一个文件承担全部"集成"职责，
> 且没有一层能看见**跨机器节点**的交互。本文件是现行分层契约：每个目录是一个深度层，
> 每层有自己的脚本、运行预算与准入判据。新测试先进层判据再写文件。

## 分层总览

| 层 | 目录 | 脚本 | 判据（什么测试属于这一层） | 运行预算 |
|---|---|---|---|---|
| L0 unit | `tests/unit/` | `pnpm test:unit` | 不挂 cordis fiber、不开真实 socket：纯逻辑（store/codec/几何）、stub 掉 fetch 的客户端缝隙、jsdom 组件 | 秒级 |
| L1 wire | `tests/wire/` | `pnpm test:wire` | **一个**真实插件实例挂在真实 web server 上（fake agents/loader 服务），对端 peer 可以是 fake 的 | ~30s |
| L2 mesh | `tests/mesh/` | `pnpm test:mesh` | **≥2 个真实插件实例**，各自独立 DSH home / Ed25519 节点密钥 / peers.json，实例间走真实 HTTP——回环上的跨机器等价物 | ~10s |
| L3 gates | `tests/gates/` | `pnpm test:build-layout` | 产物契约（exports 指向的构建布局存在性），不是行为测试 | 秒级 |
| L4 live | `tests/live/` | `pnpm test:live` + env | **真实远端机器**（env 门控，默认跳过）：真实 RTT、真实防火墙路径、真实 NTP 偏差 | 分钟级，人工触发 |

`pnpm test` 跑 L0–L3 全部（L4 无 env 时自动跳过）；`pnpm verify` 另含 typecheck、build、
build-layout 门禁与 nexus-stage 子套件。分层脚本供人按深度迭代；不要为了"快"把 L2 场景
降级写成 L1 的 fake-peer 形态——那正是本次重构要消灭的盲区。

## L2 mesh 层契约（本次新增的核心）

**为什么它是跨机器的等价物**：跨机协议路径的全部要素——独立节点身份（独立签名密钥）、
真实卡片交换、真实 socket、独立 peers.json 状态机——在回环上逐一保真。它不能保真的
（真实网络延迟/丢包、真实 NTP 偏差、真实防火墙）归 L4。

**装配**：`tests/mesh/harness.ts` 是唯一装配入口。

- `bootNode({ name, session, team, peers?, host?, port?, home?, reply?, ...Partial<Config> })`
  —— 挂真实 fiber + web server + announce；`session` 必须全 mesh 唯一（gossip 身份判据）；
  agent id 固定为 `session-0123456789abcdef` 形态（id8 → `01234567`，满足可路由正则）。
- `reservePort()` —— 互相做种子的节点需要预留端口（种子是 config 期输入，端口未知就没法互指）。
- `ghostNode(card)` / `craftCard(...)` —— 幽灵节点：裸 HTTP 服务一个手工卡片，注入
  真签名但已过期（时钟偏差替身）、签名后被篡改（bad-signature 路径）等线上故障。
- `preseedNodeKey(home)` —— 预置节点密钥并返回公钥，让委托节点的 `delegates` 配置能绑目标密钥。
- 时间旋钮：mesh 默认 `cardCacheTtlMs: 60` / `cardCacheNegativeTtlMs: 40` / `remoteRowsTtlMs: 100`，
  故障与恢复窗口保持在百毫秒级。

**写新 mesh 场景的准入**：场景必须涉及 ≥2 个真实实例的**交互**（单实例能测的归 L1）；
故障场景必须断言**失败是闭合的且可观测的**（精确原因串、无 gossip 污染、故障清除后恢复）。

## 故障矩阵（异常发现清单）

每个"跨机才会出现的异常"落到一个具体场景与断言。新故障先查表，表没有再补场景。

| 故障 | 场景（spec） | 可观测断言 |
|---|---|---|
| 时钟偏差：签名者时钟落后，卡片在验证方已过期 | mesh-faults「clock-skew surrogate」 | 发现不列队；probe 报 `expired` |
| 中间人篡改卡片字段 | mesh-faults「tampered card」 | 不列队；probe 报 `bad-signature` |
| 目标机器宕机（分区） | mesh-faults「killing the target node」 | 路由闭合失败（`no route` / `failed on every candidate`）；probe 报不可达 |
| 宕机后同端口重启（home 保留，身份不变） | 同上场景后半 | 负缓存窗口后重新发现，路由恢复绿 |
| 一个节点多种写法（loopback vs 别名 IP） | mesh-faults「two loopback spellings」 | 学到的别名塌缩为单条目（种子不塌缩——属主配置） |
| zone 委托链正常解析 | mesh-faults「delegated team name」 | 三真实节点链路上路由成功送达目标 |
| zone 委托绑错密钥 | mesh-faults「wrong key」 | 闭合失败且原因可读；目标零打扰 |
| referralLearning 关闭（连接层冻结） | mesh-faults「freezes the seed set」 | 不学习不外传；种子自身仍可见 |
| 回执网络重放 | mesh-baseline「replayed receipt」 | 账本恰好结算一次，不复活债务 |
| 回环闭环（基线健康） | mesh-baseline 全部 | 互发现 / gossip 扩散 / 同步往返 / 异步回执 / 跨机会话节点可见可路由 |

## L4 live 层运行手册

**门控**：不设 env 时整个套件跳过，永远不进默认门禁。

```powershell
# 观察者节点只探测不发布（announce: false），对远端零副作用
$env:DSH_A2A_LIVE_MESH = 'http://192.168.3.156:3080,http://192.168.3.157:3080'
# 可选：向某个真实 team 发一条自包含探针消息（分钟级，等待真实回合）
$env:DSH_A2A_LIVE_TARGET_TEAM = 'dsh'
pnpm test:live
```

- **前置**：远端节点装本插件且 a2a 行 `announce: true`；出回环暴露必须已设 `apiKey` 时，
  探测走的 `/.well-known/agent-card.json` 与 `/a2a/direct` 仍按各自路由的鉴权规则——观察者
  当前不带密钥，keyed 部署只验 probe 的失败原因可读性。
- **安全边界**：live 套件**绝不**包含"重启/杀远端进程"类步骤（委派铁律）；探针消息必须
  自包含且声明是自动测试；单请求 ≤512KiB。
- **判读**：probe 失败行必须带原因串（unreachable / expired / bad-signature）——真实机器上
  `expired` 首先怀疑 NTP 偏差（签名卡片带 `expiresAt`，跨机偏差大会被整体拒绝）。

## 与既有验证金字塔的对应

dsh-plugin-dev-test §4 的五层（单元组合 / 构建布局 / 配置面 / 从零安装 / 真实任务）
是**插件发布**的金字塔；本文件是**本仓库行为测试**的深度分层。交叉点：L3 gates 即其
"构建布局"层；其"从零安装/真实任务"仍按该 skill 在隔离测试 home（3081）执行，不入本套件。
