# @nelsonlongxiang/dsh-open-a2a-net

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/@nelsonlongxiang/dsh-open-a2a-net?label=npm)](https://www.npmjs.com/package/@nelsonlongxiang/dsh-open-a2a-net)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的开放 A2A 网络插件：把一个 DSH 部署变成去中心化 agent 网络中的一个节点——没有中心服务器，没有注册中心。

每个节点在 `/.well-known/agent-card.json` 发布**带签名、会过期**的 agent 卡片，通过**种子 URL 与相互引荐**发现 peers（每张卡片列出它认识的节点），通过**区域委托**解析名字（GNUnet GNS 风格：卡片可把一个名字委托给另一个 zone），并**直连**路由到 peer 的团队、在可达半数候选间故障切换。每个主会话还可以作为**会话节点**暴露，供其他宿主从 Web 侧栏发现并加入。

| 侧栏网络面板 | 上下文消息展示 |
| --- | --- |
| ![侧栏网络面板](images/image-01.png) | ![上下文消息展示](images/image-02.png) |

## 安装

```sh
dsh plugin --profile web add @nelsonlongxiang/dsh-open-a2a-net
```

重启 `dsh web`，打开侧栏网络面板（底部入口）。

（支持包名、本地路径或 Git URL；包内 `prepare` 会在安装时执行 `pnpm build`。注意：脱离 DSH profile 的独立 Git 安装目前无法构建——官方 `@deepseek-ai/*` npm 快照落后于本插件编译所对照的 harness 源码，请从 registry 安装，或在由 harness 提供当前 `@deepseek-ai` peers 的 profile 内安装。）插件组合在标准 webserver 行旁边：在共享监听器上注册卡片、状态与控制路由，在共享工具运行时上注册模型工具。

## 你能得到什么

- **模型工具** —— `a2a_teams` 列出本节点可见的团队（自有、peers 的、已加入会话的）；`a2a_route` 向一个团队发送消息，用 `context_id` 继续远端会话，peer 不可达时在候选间故障切换。
- **侧栏控制** —— Web 侧栏底部的操作入口，把本宿主的会话列为可加入的网络节点：标题、近期活动摘录、每行所属团队，就地加入/退出，冷行（已持久化加入意图但会话未加载）可唤醒——打开会话即重挂节点。会话团队名为 `<team>/<id8>`；Web 会话取 id 前 8 位，导入会话（`import-<uuid>`）保留 `import-` 前缀加 uuid 前 8 位十六进制，避免导入 id 塌缩成少数几个团队。
- **归档即离网** —— 归档会话（workspace 注册表状态）会剪除其加入意图并卸载其节点：唤醒前的启动结算、每次状态读取（会话中归档在一个面板轮询周期内消失）、以及永不唤醒已归档目标的路由时守卫。
- **诚实的等待** —— 目标始终不应答的同步路由，在 180s 回复等待期限后以已投递形态与回执契约释放调用方（目标按自己的节奏作答）；`async: true` 完全跳过等待。网络面板对超过 120s 的在途行降亮度标记为过期等待而非暗示活跃进度，标题带包版本徽标。
- **A2A 工作台** —— `/__dsh_a2a_nexus/` 全页 DOM 工作台（0.6.0 取代 Three.js 3D 观测；0.6.2 合并：规划板即主舞台，目录/台账/活动/规划乘可折叠侧栏，响应式三档——窄屏侧栏变抽屉、详情变底部浮层；canvas 面掉线时面板自动回落主区）：目录（本机现场/冷启动、canvas 队、peers、远端节点）、台账（待回执/死信+就地清账）、活动环、规划（衍生行动清单+催办/派单起草）、空间规划板（canvas 队组建/成员编排/网络加入退出，布局持久化，`?mode=plan` 直达）。
- **通告** —— `announce: true` 发布本节点卡片（团队、能力、引荐、已加入会话团队），peers 无需任何目录即可发现它。

## 画布队伍（任意组队，v0.5.25）

画布队伍是用户自建的有名多成员路由组：**一个原子会话节点可同时属于多个队伍**，路由到 `<team>/canvas/<name>` 解析**第一个活成员**（成员顺序即路由优先级），无活成员则唤醒**第一个冷 joined 成员**（wake-on-route）。`canvas/` 路径段与节点别名（`<team>/<id8>`）结构性无冲突，两个命名空间互不干扰。

- 存储：`<dsh-home>/a2a/canvas.json`（有序队伍条目；上限：64 队 × 32 成员）
- 控制 API：`POST /__dsh_a2a/canvas`，`action: create | remove | add-member | remove-member`
- 成员必须是 joined 会话（活节点或已记意图）——未加入会话没有路由后门；退出网络（leave/archive）自动清空全部画布成员关系
- `a2a_teams` 以本地行列出画布队伍（含成员数/活数）；`/__dsh_a2a/state` 提供每成员 `joined`/`live` 标记

## Native-teams 桥（节点统一，P1）

通往 `@nelsonlongxiang/dsh-native-teams` 的两条半桥（结构契约镜像：`src/teams-bridge.ts`；冻结契约原文在该包 `src/a2a-face.ts`）：

- **出站传输面**——本插件挂载 `nativeTeamsA2a` 服务：`resolve` 与 `submit` 复用同一次目录遍历（单一匹配器，无漂移风险），`submit` 走直连路由派发器（逐候选 async 门禁，镜像 `a2a_route`；对端幂等 409 回放判为终态 accepted，绝不转投造成重复执行；accepted 提交进欠账账本；提交会话为 joined 节点时，其节点地址随 wire `callback` 字段携带——对端回执据此路由回发起会话，冷会话由 wake-on-route 物化；父会话未 joined 时不携带 callback，回执回落 caller label），`cancel` 经 wire 向持有团队投递协作式 `[A2A cancel]` 停止通知（对端不跟踪入站任务 id，走其账本路由必然 unknown）并清除本端欠账行。它不暴露任何新东西——只有 peer 网络已发布的团队可解析。
- **入站分发**（配置 `nativeTeamsInbound`，默认 `false`）——兄弟注册表判定为无歧义本地主张的团队名，经其权威路由缝（`describeTarget`/`startRound`）发起一轮路由，由本节点活 initiator 会话担任 parent，A2A 信封随轮消息携带。注册表存在本身绝不是暴露：操作者显式开启才算。仅分发到 dispatcher 层——入站调用方寻址团队，不能寻址成员（成员保持可见不可寻）。轮与 steer 路径同样有界：180s 回复死线（`nativeRoundWaitMs`）以诚实的 delivered-unsettled 形态应答，轮自身继续运行；调用方 abort（存在时）经其 signal 取消轮。`wait: false` 在 prepare-first 检查（主张/seam/initiator——幻影派发绝不回应成功）之后脱离派发；本切片 native-teams 轮不发 A2A 回执，其结果携带 `bridge` 标记且绝不记为欠回执行（回 `callbackTarget` 的回执回流属 P2 切片）。

完整映射与范围说明见 `docs/native-teams-bridge.md`。

## 配置

行配置叠加在 profile 的 patch 层；每个键都有 schema 默认值。

| 键 | 默认值 | 用途 |
| --- | --- | --- |
| `announce` | `false` | 发布本节点 agent 卡片供 peer 发现。 |
| `peers` | `[]` | 种子 base URL；被引荐的 peers 从其卡片学习。 |
| `delegates` | `[]` | 区域委托：`{ name, url, publicKey }` 发布在卡片上。 |
| `team` | `'dsh'` | 本节点暴露给直连路由的团队名。 |
| `session` | `''` | 调用方标签；`''` 为每个 home 派生稳定的 `dsh-host-<8hex>`。 |
| `agentName` | `'DeepSeek Harness A2A node'` | 卡片上的人类可读名称。 |
| `apiKey` | `''` | peer 请求携带的 `X-API-Key`；非空时同时门禁控制路由。 |
| `sessionNodes` | `true` | 把主会话暴露为可加入的网络节点。 |
| `nativeTeamsInbound` | `false` | 把入站直连路由（及出站 A2A 工具的本地候选）经 native-teams 路由缝分发到其注册表团队；需兄弟插件已组合。 |
| `nativeRoundWaitMs` | `180000` | 单轮 native-teams 路由的回复等待预算（桥的死线，对齐 steer 路径的 180s）。超时轮以诚实的 delivered-unsettled 形态应答并继续运行。 |
| `wakeJoinedOnBoot` | `false` | 挂载后预热冷加入会话的 agent（需要 session controller 唤醒面；无它时路由唤醒与侧栏唤醒按钮仍可用）。预热是延迟启动、前台让路、可取消的——不会阻塞启动窗口（见下方两个参数）。 |
| `wakePrewarmDelayMs` | `10000` | loader 树就绪到第一次预热唤醒之间的空闲延迟；`0` 恢复就绪即唤醒的旧行为。 |
| `wakePrewarmQuietMs` | `5000` | 前台静默窗口：窗口内有唤醒/路由需求（或有出站路由在途）则推迟下一步预热；`0` 关闭让路。 |
| `cardTtlMs` / `flushTimeoutMs` / `routeTimeoutMs` | 见 schema | 卡片生命周期与路由时序预算。 |

示例——一个带种子的通告节点：

```yaml
- id: a2a
  name: '@nelsonlongxiang/dsh-open-a2a-net'
  config:
    announce: true
    peers: ['http://127.0.0.1:41243']
```

## 信任模型

卡片经 Ed25519 签名且会过期；卡片上的 `peers` 引荐与 `sessionTeams` 列表未签名、每次现读。`/__dsh_a2a/join` 与 `/__dsh_a2a/leave` 控制路由在配置了 `apiKey` 时要求之（常数时间比较）；密钥为空时仅信任同源浏览器与 loopback 调用方。把监听器暴露到 loopback 之外前请先设置 `apiKey`。

## 协作 SOP（网络实践，v0.1）

由网络研究节点从 0.1.x–0.5.x 交付周期蒸馏；维护者采纳。

- **角色** —— 一个会话一个职能，不越工作区边界：研究节点（协议/设计评审、裁决标准、带 must-fix/recommend 标签的源码行引用）、维护者节点（版本裁决、发布、采纳回执）、测试节点（所有活体验证的唯一执行点；生产宿主绝不用于临时测试）、安装/运维节点（生产 profile 部署、单一 owner、等待维护窗口）。
- **派发纪律** —— 测试任务发测试节点，带版本 + 提交 + 可判定标准 + 回执目标；评审任务发研究节点，带源码指针而非转述。
- **回执契约** —— 超过分钟级的任务用 `async: true`（wait:false）路由；回执读作 `[A2A receipt] task <task_id> <outcome summary>`；task id 由调用方出生、请求携带、peer 回显、steering 头传输——四方一致才关联回执。
- **升级链** —— 测试节点绿 → 维护者回执 → 运维节点申请窗口 → 生产升级 → 维护者浏览器面终检 → 全网通告。
- **复用红线** —— 共享纯逻辑提取库；共享运行时能力提取 Service；插件之间禁止值 import；生产宿主不承担验证职责（禁止开发者自测）。

## 验证

测试按深度分层（契约见 `docs/testing-layers.md`）：每层独立目录 + 独立脚本，可按层迭代。

```sh
pnpm install       # auto-install-peers 从 npm 拉取 DSH peer 线
pnpm verify        # typecheck + 构建 + 下列全部 vitest 层 + 布局门禁 + nexus-stage 子套件
pnpm test:unit     # L0 —— 纯逻辑，无 fiber、无 socket（store/codec/jsdom 组件）
pnpm test:wire     # L1 —— 单个真实插件实例 + 真实 HTTP，对端 peer 为 fake
pnpm test:mesh     # L2 —— ≥2 个真实节点（独立 home/密钥/peers.json）走真实 HTTP：
                   #      跨机器等价层，含故障注入（时钟偏差卡片、篡改卡片、分区/重启、
                   #      别名塌缩、zone 委托、referral 冻结）与回执重放——故障矩阵见
                   #      docs/testing-layers.md
pnpm test:live     # L4 —— 真实远端机器，env 门控（DSH_A2A_LIVE_MESH=...），默认跳过、
                   #      不进 CI——运行手册见 docs/testing-layers.md
pnpm build         # host lib（含 lib/a2a-client.js）、client 类型与浏览器 bundle（lib/client.js）
```

## 非 DSH 节点互通（协议模块）

不运行 DeepSeek Harness 的节点也能接入本协议。四个零依赖的协议模块以子路径导出（gh#13），引入时不会拉起 DSH 的 peer 依赖：

```js
import { signCard, verifyCard } from '@nelsonlongxiang/dsh-open-a2a-net/card'
import { formatReceipt, parseReceipt } from '@nelsonlongxiang/dsh-open-a2a-net/receipt'
import { withinRouteBodyCap } from '@nelsonlongxiang/dsh-open-a2a-net/transport-caps'
import { A2aClient } from '@nelsonlongxiang/dsh-open-a2a-net/a2a-client'
```

外部节点需要自己实现三样东西：签名卡片、`GET /.well-known/agent-card.json` 和 `POST /a2a/direct`，这些模块编码的线上格式就是契约。匿名取卡只能拿到最小发现面。要拿完整卡片，必须带上通过验证的 OriginClaim 信封，即用你自己的卡片密钥签名的 `X-A2A-Caller` / `-Url` / `-Ts` / `-Sig`，细节见 `docs/protocol/delivery-origin-auth.md` 及 `docs/protocol/` 下其余文档。

**按哪个产物实现。** npm 直装已含四个子路径：自 0.6.25 起（徽章 `latest`）的正式版带齐这批导出，`npm install @nelsonlongxiang/dsh-open-a2a-net` 开箱即用——`examples/external-node/` 有一个可对内嵌 mock peer 跑通全部四个子路径的外部节点参考实现。子路径导出随提交 `9cb3852` 落地；更早的版本（含公开 0.5.15）早于这批导出，也早于上述准入规则和 OriginClaim 信封，从它们引入会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`——历史上的做法（钉提交、`pnpm build`、`npm pack`、依赖 tarball）仅留作 0.6.25 之前部署的历史注：

```bash
# 历史做法（0.5.15 及更早）：从钉住的提交自行构建
git clone https://github.com/NelsonLongxiang/dsh-open-a2a-net && cd dsh-open-a2a-net
git checkout <commit>              # 钉一个提交；9cb3852 及之后的提交都导出这四个子路径
pnpm install --frozen-lockfile     # pnpm 版本以 package.json 的 "packageManager" 为准
pnpm build
npm pack                           # → nelsonlongxiang-dsh-open-a2a-net-<version>.tgz
# 在你的项目里：
npm install /path/to/nelsonlongxiang-dsh-open-a2a-net-<version>.tgz
```

安装这个包（npm 或历史 tarball）不会拉入任何 `@deepseek-ai/*` 包：DSH peer 依赖都是可选的，四个子路径只互相引用，外加 `node:crypto`。

## 许可证

MIT
