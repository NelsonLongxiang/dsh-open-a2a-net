# @nelsonlongxiang/dsh-open-a2a-net

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的开放 A2A 网络插件：把一个 DSH 部署变成去中心化 agent 网络中的一个节点——没有中心服务器，没有注册中心。

每个节点在 `/.well-known/agent-card.json` 发布**带签名、会过期**的 agent 卡片，通过**种子 URL 与相互引荐**发现 peers（每张卡片列出它认识的节点），通过**区域委托**解析名字（GNUnet GNS 风格：卡片可把一个名字委托给另一个 zone），并**直连**路由到 peer 的团队、在可达半数候选间故障切换。每个主会话还可以作为**会话节点**暴露，供其他宿主从 Web 侧栏发现并加入。

| 侧栏网络面板 | 网络面板总览 |
| --- | --- |
| ![侧栏网络面板](images/image-01.png) | ![网络面板总览](images/image-02.png) |

## 安装

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add @nelsonlongxiang/dsh-open-a2a-net
```

（支持包名、本地路径或 Git URL；包内 `prepare` 会在安装时执行 `pnpm build`。注意：脱离 DSH profile 的独立 Git 安装目前无法构建——官方 `@deepseek-ai/*` npm 快照落后于本插件编译所对照的 harness 源码，请从 registry 安装，或在由 harness 提供当前 `@deepseek-ai` peers 的 profile 内安装。）然后重启 profile。插件组合在标准 webserver 行旁边：在共享监听器上注册卡片、状态与控制路由，在共享工具运行时上注册模型工具。

## 你能得到什么

- **模型工具** —— `a2a_teams` 列出本节点可见的团队（自有、peers 的、已加入会话的）；`a2a_route` 向一个团队发送消息，用 `context_id` 继续远端会话，peer 不可达时在候选间故障切换。
- **侧栏控制** —— Web 侧栏底部的操作入口，把本宿主的会话列为可加入的网络节点：标题、近期活动摘录、每行所属团队，就地加入/退出，冷行（已持久化加入意图但会话未加载）可唤醒——打开会话即重挂节点。会话团队名为 `<team>/<id8>`；Web 会话取 id 前 8 位，导入会话（`import-<uuid>`）保留 `import-` 前缀加 uuid 前 8 位十六进制，避免导入 id 塌缩成少数几个团队。
- **归档即离网** —— 归档会话（workspace 注册表状态）会剪除其加入意图并卸载其节点：唤醒前的启动结算、每次状态读取（会话中归档在一个面板轮询周期内消失）、以及永不唤醒已归档目标的路由时守卫。
- **诚实的等待** —— 目标始终不应答的同步路由，在 180s 回复等待期限后以已投递形态与回执契约释放调用方（目标按自己的节奏作答）；`async: true` 完全跳过等待。网络面板对超过 120s 的在途行降亮度标记为过期等待而非暗示活跃进度，标题带包版本徽标。
- **通告** —— `announce: true` 发布本节点卡片（团队、能力、引荐、已加入会话团队），peers 无需任何目录即可发现它。

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
| `wakeJoinedOnBoot` | `false` | 挂载时物化所有冷加入会话的 agent（需要 api gateway；无它时路由唤醒与侧栏唤醒按钮仍可用）。 |
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

```sh
pnpm install   # auto-install-peers 从 npm 拉取 DSH peer 线
pnpm verify    # typecheck、构建、源码测试与构建产物布局守卫
pnpm build     # host lib（含 lib/a2a-client.js）、client 类型与浏览器 bundle（lib/client.js）
```

## 许可证

MIT
