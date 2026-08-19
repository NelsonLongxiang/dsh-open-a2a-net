# 公共会话物化能力设计

## 结论

把现有核心补丁中的 `apiProxy.materializeSession(sessionId)` 公共化为 **host-only 的 `sessionMaterializer` 服务**。A2A 只消费该服务，不进入核心；归档状态由核心统一拒绝，任何消费者都不能唤醒已归档会话。

本设计先沉淀，不修改 DeepSeek Harness 核心代码。

## 现状与问题

现有实现位于 `@deepseek-ai/dsh-host-apiproxy`：

```ts
apiProxy.materializeSession(sessionId): Promise<Agent>
```

它复用浏览器打开会话时的 `ensureSession` 路径：读取持久化会话、取得记录的 `cwd`、沿用持久化 preset、构建或复用 Agent。

这项能力最初由 A2A 冷节点唤醒驱动，但本质是通用会话生命周期能力。继续把它挂在 API gateway 上有三个问题：

1. **归属错误**：会话物化不是 HTTP/RPC API 的职责。
2. **契约不清**：host 插件只能猜测 `apiProxy` 是否存在，无法表达“可物化但已归档”这类状态。
3. **归档不闭合**：归档是 workspace registry 状态；物化能力应当把它作为硬拒绝条件，而不是让每个插件自己补过滤。

## 边界

### 核心应拥有

- 校验 session 是否持久化存在。
- 校验会话有可验证的记录 `cwd`。
- 读取归档权威源 `workspaceRegistry.archivedSessionIds`。
- 幂等物化：已存在的 root Agent 直接返回；不存在则沿标准 `ensureSession` 路径恢复。
- 返回精确、可分支处理的失败类型。

### 插件应拥有

- 是否、何时请求物化。
- A2A 的 join/leave、冷节点、boot wake、按路由 wake、peer、卡片、回执与网络策略。
- 归档后退网、UI 隐藏、请求拒绝等 A2A 语义。

核心 **不得** 知道 A2A、peer、task id、receipt、网络卡片或 A2A 配置。

## 目标公共契约

### 服务名与可见性

`ctx.sessionMaterializer`：仅 host context 可见；不进入浏览器 RPC/FETCH wire contract，不暴露给远程调用方。

```ts
export interface SessionMaterializer {
  /**
   * Restore one non-archived persisted session through the canonical host path.
   * Idempotent: returns the existing root Agent when it is already materialized.
   */
  materialize(sessionId: SessionId): Promise<Agent>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionMaterializer: SessionMaterializer
  }
}
```

不增加 `force`、`ignoreArchive` 或调用方自报 reason 参数。归档是关闭，不是可被插件绕过的“睡眠状态”。用户若要恢复，应显式取消归档后再打开会话。

### 失败契约

公共错误应是可识别的类型/稳定 code，而不是插件解析字符串：

| 错误 | 条件 | 消费者动作 |
| --- | --- | --- |
| `SessionMaterializationUnavailableError` | 服务依赖未 compose | 降级，不唤醒 |
| `SessionNotPersistedError` | session 不存在/已删除 | 清理自己的引用 |
| `SessionArchivedError` | 在 `archivedSessionIds` 中 | 关闭自身引用；绝不重试唤醒 |
| `SessionMissingCwdError` | 旧日志无 cwd | 说明不可恢复，不猜测 cwd |
| 原始 ensure/preset 错误 | 正常恢复流程失败 | 记录并交给调用方策略重试/报告 |

### 归档语义

`archiveSession` 的权威结果是 registry 的 `archivedSessionIds`，不是文件是否存在。归档不会删除 session persistence，因此任何“文件仍在”都不能当作可唤醒依据。

`sessionMaterializer.materialize()` 必须先检查归档集并拒绝。这样 A2A、定时任务、深链接或其他 host 插件不会重新激活已关闭会话。

## 服务归属与生命周期

### 推荐终态

新增核心 host 包 `@deepseek-ai/dsh-host-session-materializer`：

- 唯一拥有 `ensureSession` 所需的恢复编排。
- 依赖：`agents`、`sessions`、`sessionPersistence`、`workspaceRegistry`、preset/world 构建所需的现有 host 服务。
- 自身不注册 HTTP route、不依赖浏览器 UI、不导入 A2A。
- 在 host composition 中先于 A2A 插件完成挂载。

`@deepseek-ai/dsh-host-apiproxy` 仅注入并使用此服务；wire `ApiProxy` 仍保持浏览器安全，不新增 materialize RPC。

### 为什么不是继续放在 apiProxy

短期放在 apiProxy 的改动最少，但会把“核心会话生命周期”永久绑在“HTTP gateway 是否 compose”。新 host service 的边界更稳定，未来可被 scheduler、恢复工具、桌面深链接、工作流恢复直接使用。

## 迁移方案

### Phase 0：现状保持

- A2A 继续使用 `ctx.apiProxy?.materializeSession`。
- A2A 自己过滤归档 session，保证当前版本生产行为正确。

### Phase 1：上游最小公共 PR

1. 从 api proxy 抽出/复用 canonical `ensureSession` 路径。
2. 新增 `sessionMaterializer` host service 与上述错误类型。
3. 在 `materialize()` 内检查 registry archive set。
4. apiProxy 保留 `materializeSession`，实现为对 `sessionMaterializer.materialize` 的 deprecated host-only alias。
5. 完整单测、JSDoc、host API 文档；不引入任何 A2A 代码、配置、文案、依赖或测试夹具。

### Phase 2：插件兼容发布

A2A 的适配顺序：

```ts
ctx.sessionMaterializer?.materialize(sessionId)
  ?? ctx.apiProxy?.materializeSession(sessionId) // 旧核心兼容
```

- 新核心优先走公共服务。
- 老核心保持当前 apiProxy fallback。
- 两者都不存在时返回诚实 no-wake 结果，不崩溃。
- 收到 `SessionArchivedError` 时 A2A 立即 leave/prune，不再尝试路由唤醒。

### Phase 3：收敛

上游稳定发布并覆盖支持窗口后，移除 A2A 对 apiProxy alias 的 fallback；核心在一个明确的弃用周期后删除 alias。

## 上游 PR 最小范围

允许改动：

- 新 host session materializer 服务及其测试。
- api proxy 对新服务的兼容委托与弃用说明。
- composition/bundle 注册。
- 面向 host 插件的 API 文档与 type exports。

禁止进入该 PR：

- `packages/ext/a2a`、A2A 协议、peer、卡片、route、join、receipt。
- A2A UI、A2A 配置、A2A 测试。
- 任何网络权限放宽或 browser wire 暴露。

## 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 未加载、持久化、非归档会话 | 物化 root Agent；复用浏览器打开的 canonical 路径 |
| 已加载会话 | 返回同一 root Agent；不重复建世界 |
| 已归档会话 | `SessionArchivedError`；不创建 Agent |
| 不存在/已删除会话 | `SessionNotPersistedError` |
| 无 cwd 的遗留日志 | `SessionMissingCwdError` |
| host 未 compose materializer | A2A 优雅 no-wake，不改变已送达/回执语义 |
| browser / remote RPC | 无 materialize endpoint；不能远程唤醒任意 session |
| A2A archived node | 公共错误触发 leave；本地 state、card sessionTeams、远程发现均不再显示 |

## 发布门禁

1. 核心 PR 走特性分支 → PR → deal_pr → master，不直接写 master。
2. 先证明 public service 不含 A2A import，wire API 无新增 materialize 方法。
3. 跑新服务单测、apiProxy 回归、workspace archive 回归、类型检查。
4. 上游接受并发布版本后，A2A 另起独立 PR 做 feature-detect 适配。
5. 在 3081 做组合验证：冷 wake、归档拒绝、跨 profile A2A 正常、无 wire 暴露。

## 当前决策

- 不再向核心追加 A2A 专属补丁。
- 将 `materializeSession` 视为待公共化的通用 host 能力。
- 公共化前，A2A 维持现有 apiProxy fallback 与自身归档过滤，生产不中断。
