# 设计卡：节点身份（第 3 段）：身份脱离会话，提示词分层，可变层自我更新

> **状态（2026-11-02）：方案稿，高档，待独立复核。** 只定方案，不含代码。
>
> - **核对基线**：本仓 master cf48961；DSH 为 `~/workspace/deepseek-harness` 687f282e86。下文的 `file:line` 都以这两个提交为准。
> - **档位**：身份类和跨项目接口（名片形状）都在先授权五类之内，需要独立复核，涉及命名和名片形状的点由属主拍板（§8）。
> - **授权**：属主 2026-11-02 原话：「那你建议开始吧，我们已经讨论结束了，剩下的都交给你吧」。
>
> **关联**
> - #58：会话身份可识别，人设的展示名与席位，模型不可自命名；
> - #65：路线图；
> - #114：任务授权记录；
> - `docs/protocol/workbench-event.md`：事件层（第 1、2 段）。
>
> **参照**：deepseek-ai/dsh-superagent-prototype（per-ticket worker、Mandate）、ai-native-expert-agents 的四层提示词和 `update_self`。

## 0. 一句话

今天，**节点就是会话**：会话没了，身份、职责和积累下来的经验都跟着消失。本设计把三样东西挂到一个由人起名、长期存在的**节点**上：身份、任务状态、分层的系统提示词。会话退化为节点的执行载体。节点可以按规则更新自己提示词中的可变层，每次更新都冻结成版本，可以归因，也可以回退。

## 1. 现状

| 事实 | 锚点 |
|---|---|
| 会话团队名取自 agent id 的前 8 位，所以身份就是会话 | `src/index.ts:1437`（`sessionTeamOf`）、`src/index.ts:1427`（`agentId8`） |
| 插件只注册了一个静态提示词段 `a2a:lifecycle`，order 为 150 | `src/index.ts:607-608` |
| 插件自有存储是 a2a home 下的一组 JSON 文件 | `src/index.ts:838`（peers.json）到 `:982`（canvas.json） |
| DSH：同名段注册在 `agent.ctx` 上会覆盖全局段（per-agent override） | `packages/core/system-prompt/src/index.ts:404-415`、`:471-478` |
| DSH：段的 `text` 可以是函数，每次组装时求值 | `packages/core/system-prompt/src/index.ts:66` |
| DSH：order 槽位从 −1000（HARNESS_IDENTITY）到 10200（DEPLOYMENT_PERSONA_SUFFIX），按升序拼接 | `packages/core/system-prompt/src/index.ts:131-165` |
| DSH：runtime context 以 user 角色快照的形式进入，不进系统提示词 | `packages/core/system-prompt/src/index.ts:78-90`、`:513` |
| DSH：程序化建会话和续会话，`setup` 在发布前组合 scoped 世界，在这里注册的段先于首次组装存在 | `packages/core/agent/src/index.ts:63-118`、`:187-202` |
| DSH：`agent/created` 带 `source: 'startup' \| 'resume' \| 'clear' \| 'compact'`，续会话时插件段要重新注册 | `packages/core/agent/src/runtime-types.ts:125`、`:261` |
| DSH：`turn/start {turn}`、`turn/end {turn, reason}` | `packages/core/session/src/types.ts:289`、`:298` |
| DSH：投递方式 `followup` / `steer` | `packages/core/agent/src/runtime-types.ts:222`、`:231` |
| DSH：`appendPluginRecord` 是实验接口，只有 `packages/experimental/` 下的代码可以调用；记录跟着单个会话的日志走，格式迁移时可能丢失 | `packages/core/session/src/index.ts:469-498` |

最后一条决定了节点存储**不能**放进会话记录：节点要跨会话存在，会话日志里的插件记录既只能由实验代码调用，又跟着单个会话走。

## 2. 节点存储

位置：插件自有存储 `<a2a home>/a2a/nodes.json`，与 peers.json、canvas.json 同级，写法沿用现有 Store 类的模式。提示词版本单独存放，路径为 `<a2a home>/a2a/nodes/<name>/prompt-v<n>.json`，只增不改。

```jsonc
{
  "name": "review-1",               // 稳定节点名：只能由人设定（#58），模型无写入路径
  "role": "review",                 // 职责：dev | review | supervise | ops | intake …（多值允许）
  "teams": ["dsh/canvas/core"],     // 所属团队（画布队名；成员关系仍以 canvas.json 为准，这里只是投影）
  "prompt": {
    "immutable_version": 3,         // 不可变层当前版本（只有人能改）
    "mutable_version": 17,          // 可变层当前版本
    "mutable_sha256": "…"
  },
  "tasks": [                         // 任务指针：只记编号与状态，不复制 GitHub 的内容
    { "ref": "NelsonLongxiang/dsh-open-a2a-net#160", "state": "open", "since": "…", "prompt_version": 17 }
  ],
  "sessions": ["<session id>"],     // 会话→节点绑定（反查索引见 §3）
  "created_by": "human:<who>",
  "created_at": "…"
}
```

- **命名**：由人通过管理面（工作台或 CLI 的 owner 面）创建和改名。节点名一经使用就不复用。模型调用的任何工具都不能写 `name`、`role`、`teams` 或不可变层。
- **任务指针**：状态取值为 `open`、`merged`、`closed`、`declined`。真实状态以 GitHub 为准，这里只是缓存，触发更新时（§5）再去核对。
- **容量**：任务指针只保留最近 64 条，更早的转存为 `tasks-archive`，与 `archived` 台账的思路相同。

## 3. 会话与节点的绑定

- **绑定由人发起**：在工作台把一个会话「挂到」某个节点；或者由投递路径（§4）自动新建会话时直接带上绑定。
- **索引**：`sessionId → nodeName` 是内存里的反查表，持久化在 nodes.json 的 `sessions` 字段中。会话结束时解绑，但节点保留。
- **约束**：一个会话最多绑定一个节点；一个节点可以同时有多个活会话，用于并行。未绑定节点的会话行为与今天完全一致。

## 4. 名片与投递

- **名片**：在 `sessionTeams` 旁边新增 `nodes` 列表，每项包含 `{name, role, teams, live}`。这是跨项目接口，具体形状待属主定（§8）。过渡期两种身份同时发布：
  - 绑定了节点的会话仍然以旧的 `<zone>/<id8>` 出现；
  - 节点另外以 `<zone>/node/<name>` 作为可路由团队。
- **路由到 `<zone>/node/<name>`**，按以下顺序找执行载体：
  1. 这个节点的活会话：投递方式沿用今天对会话团队的做法（`followup` 或 `steer`）；
  2. 没有活会话但有已持久化的会话时，用 `ctx.agents.resume({ sessionId, setup })` 续上；
  3. 都没有时，用 `ctx.agents.create({ sessionId: <新>, setup })` 新建，并写入绑定。
- **`setup` 里注册三部分提示词（§5）。** 由于 DSH 保证 setup 中的注册先于首次组装存在，新会话第一轮就带着节点身份。
- **准入不变**：`<zone>/node/<name>` 套用的准入规则，与该节点所属画布队一致（#114 的授权记录中，`via` 照旧取 `canvas-member` 等值）。节点身份不另开一条放行路径。

## 5. 提示词分层

在 `agent/created` 时注册，startup 和 resume 都要注册，因为续会话不会恢复插件段（§1）。走 `setup` 新建的会话已经在 setup 里注册过，这里按段名去重。

| 部分 | 载体 | order | 内容 | 谁能改 |
|---|---|---|---|---|
| 不可变层 | section `a2a:node:core` | 10300 | 身份（节点名、职责、团队）、先授权五类、项目红线、协作规范要点 | 只有人（管理面），每次修改冻结一个 immutable 版本 |
| 可变层 | section `a2a:node:mutable` | 10400 | 四段：**当前状态 / 执行要点 / 已知陷阱 / 当前重点** | 节点自己（§6），人也可以改 |
| 任务状态 | context `a2a:node:tasks` | runtime context 槽 | 任务指针清单、各自状态、最近一次事件 | 插件按台账和 GitHub 状态生成 |

- **order 取 10300 和 10400，都排在 DSH 最后一个首方槽位 DEPLOYMENT_PERSONA_SUFFIX（10200）之后。** 这样可变层改动时，前面的系统提示词前缀全部保持字节不变，前缀缓存损失最小。不可变层很少改，放在可变层之前。
- **文本函数从节点存储读取当前版本**（`text: (ctx) => …`）。文本没变时，组装结果逐字节相同。
- **任务状态不进系统提示词。** 它变化频繁，放进系统提示词会频繁打破缓存，所以走 runtime context，作为 user 角色快照（§1）。
- **字数配额**（字符数，参照 ai-native-expert-agents 的四层配额）：
  - 不可变层 ≤ 2000；
  - 可变层合计 ≤ 3000，每段 ≤ 1000；
  - 任务状态 ≤ 1500。
  - 超出配额时写入被拒绝，不做截断。

## 6. 自我更新：`node_update_self`

- **工具**：只有绑定了节点的会话才看得到这个工具，注册在 `agent.ctx` 上，其他会话不可见。参数为 `{section: '当前状态'|'执行要点'|'已知陷阱'|'当前重点', text, reason}`。
- **只写可变层。** 没有写名字、职责、团队或不可变层的参数，因为这条路径在设计上就不存在，而不是靠运行时拦截。
- **每次写入**：
  1. 检查配额，配额外直接拒绝；
  2. 生成 `prompt-v<n+1>.json`，内容为 `{version, sha256, parent_version, section, text_before_sha, text, reason, by_session, at}`，只增不改；
  3. 更新 `nodes.json` 中的 `mutable_version` 和 `mutable_sha256`。
- **触发时机**：
  - **主触发**：一件事结束，即节点任务指针上的 issue 关闭或 PR 合并。这由插件在核对 GitHub 状态时发现，再通过 `followup` 提醒节点做一次复盘更新。
  - **上限触发**：节点累计 N 轮（由 `turn/end` 计数，N 默认 40，可配置）没有更新时，提醒一次。
  - 提醒只是消息，**更新与否由节点判断**，不强制写入。
- **归因**：每条任务指针在开始时记下当时的 `prompt_version`（§2）。复盘时就能看出某一版之后接手的任务结果变好还是变坏。
- **回退**：人在管理面把 `mutable_version` 指回旧版本，此操作本身也追加一条记录。节点没有回退工具。

## 7. 不做的事

- 不另建任务状态系统：状态以 GitHub 为准，节点只存指针。
- 不做重隔离：同一主机上的模型与主机属主同等可信，不为节点另建沙箱。
- 不让模型给自己或别的节点起名，不让模型改职责和红线（#58）。
- 不依赖 DSH 的实验接口：既不用 `appendPluginRecord`，也不改 DSH 本身。

## 8. 待属主拍板

1. **命名规则**：节点名的字符集和长度，比如 `^[a-z][a-z0-9-]{1,31}$`；路由名用 `<zone>/node/<name>`，还是直接 `<zone>/<name>`。后者会与 `<zone>/<id8>` 在形状上撞车，本稿推荐前者。
2. **名片形状**：`nodes` 列表是否签名；`live` 是否对外公开。本稿推荐 `nodes` 进签名载荷，`live` 只在 full card 中出现。
3. **N 的默认值**和配额数值。
4. **旧身份 `<zone>/<id8>` 什么时候停发**：本稿建议沿用关窗思路，舰队全部升级并观察 7 天后，由属主决定。

## 9. 实现切片

每一片单独开 PR。新增模块受 S24 约束（每个 .ts 不超过 1200 行），不往 index.ts 里堆代码（S23）。

| 片 | 内容 | 档位 | 验收（由验证器判定） |
|---|---|---|---|
| N1 | `src/node-store.ts`：nodes.json 和 prompt 版本文件的读写；管理面增删改节点（人用）；单元测试覆盖「模型无写名路径」 | 中 | 单测，以及 S24 |
| N2 | 绑定：工作台和 CLI 把会话挂到节点；内存反查表；会话结束时解绑 | 中 | 单测，以及 mesh 中的绑定和解绑 |
| N3 | 提示词三部分：在 `agent/created`（startup 和 resume）注册；配额检查；同文本组装逐字节相同 | 中 | mesh：resume 后段仍在；前缀不变 |
| N4 | `node_update_self` 工具和版本链；触发提醒（issue 关闭、PR 合并、N 轮）；回退管理面 | 高（模型写自身提示词） | 单测验版本链只增不改；反例：写不可变层必须失败 |
| N5 | 名片 `nodes` 列表，以及 `<zone>/node/<name>` 路由（活会话、resume、create 三选一） | 高（跨项目接口） | mesh：跨主机投递到节点；team-verifier 新增节点叶判据 |
| N6 | 任务指针与 GitHub 状态核对；任务记录写入 `prompt_version` | 中 | 单测，以及 team-verifier |

推荐顺序为 N1 → N2 → N3 → N6 → N4 → N5。理由是先让现有会话挂上节点、带上分层提示词，跑通「身份脱离会话」；再开自我更新；最后对外公开节点路由，因为它要等名片形状定下来。
