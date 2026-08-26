# Canvas UI 契约（锁定 v1）

> 目的：PR A 合并后、PR B 开发期，host 面不得破坏本契约；UI 以本契约为准，防裸 API 路径依赖与地基漂移。变更须走 PR 并双侧同步。

## 读面：`GET /__dsh_a2a/state` → `canvas` 载荷

存在性：host 实现 canvas face 时才下发 `canvas` 字段——**client 以 `state.canvas !== undefined` 为整个画布区的显隐开关**。

```ts
canvas?: {
  teams: Array<{
    name: string                       // 队伍名（创建时的原始名）
    team: string                       // 线名 <host-team>/canvas/<name>
    members: Array<{
      id: string                       // 成员 session id
      team: string                     // 成员节点别名 <host-team>/<id8>
      joined: boolean                  // 在网上（活节点或已记 join 意图）
      live: boolean                    // agent 当前挂载
    }>
  }>
}
```

## 写面：`POST /__dsh_a2a/canvas`

| action | 入参 | 返回 |
|---|---|---|
| `create` | `{ action, name }`（trim 后 1..40，拒 `/` 与纯数字） | `{ ok, name, teams }`；拒绝时 `{ ok:false, error }` |
| `remove` | `{ action, name }` | `{ ok, teams }`（连成员一起消失） |
| `add-member` | `{ action, name, id }`（id 必须 joined：live 节点或已记意图；否则 `ok:false`） | `{ ok, teams, members }`（重复添加幂等 ok:true） |
| `remove-member` | `{ action, name, id }` | `{ ok, teams, members }` |

## 不变量（双侧共同遵守）

1. **同意不变量**：成员资格必须绑定 joined 会话——UI 的加成员选择器只列 joined 行；leave/archive/host 清扫会移除成员关系，UI 随轮询自然反映。
2. **多对多**：一个 session 可出现在任意多队的 members 中；UI 以队行为主视图（成员 chip 在每个所属队行内重复出现），不做单属假设。
3. **上限**：64 队 × 32 成员/队；超限 host 拒绝且 `ok:false`——UI 不预校验上限数字，以 host 判定为准。
4. **确定性路由语义**：成员序=优先级；路由解析活成员优先→冷 joined 唤醒。UI 用 live 标记着色（实心=活，空心=cold），不承诺"下一个投给谁"之外的语义。
5. **锁版本**：本文档对应 host 实现 PR #13（6534a0a）。任何 shape 变更 = 破坏性契约变更，需单独评审。
