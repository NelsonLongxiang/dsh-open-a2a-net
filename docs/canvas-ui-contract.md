# Canvas UI 契约（锁定 v1）

> 目的：PR A 合并后、PR B 开发期，host 面不得破坏本契约；UI 以本契约为准，防裸 API 路径依赖与地基漂移。变更须走 PR 并双侧同步。
>
> **v1.1 对齐注记（2026-10-27，按 master ae7e24d 代码复核）**：v1 锁定后 host 已做两处 shape 扩展而未升文档版本——
> ① 成员数组为**双形**：本机成员 `{id, team, joined, live}`，远端成员 `{id, team, remote: true}`（0.6.6 c858050 统一画布队模型引入）；
> ② `canvas` 字段由 host **恒下发**（不再以存在性作开关）。下文 shape 已按现状改写；按本文第 5 条，这属于事后补登的契约变更。

## 读面：`GET /__dsh_a2a/state` → `canvas` 载荷

存在性：v1 时 host 实现 canvas face 才下发 `canvas` 字段，client 以 `state.canvas !== undefined` 为画布区显隐开关；现行 host 恒下发该字段（client 的存在性判断保留作旧 host 兼容）。

```ts
canvas?: {
  teams: Array<{
    name: string                       // 队伍名（创建时的原始名）
    team: string                       // 线名 <host-team>/canvas/<name>
    members: Array<
      | {                              // 本机成员
          id: string                   // 成员 session id
          team: string                 // 成员节点别名 <host-team>/<id8>
          joined: boolean              // 在网上（活节点或已记 join 意图）
          live: boolean                // agent 当前挂载
        }
      | {                              // 远端成员（v1.1）
          id: string                   // zone 限定的远端队句柄，如 zone/a1b2c3d4
          team: string                 // 同 id（不透明句柄，host 原样透传）
          remote: true                 // 无 joined/live：远端事实不在本机
        }
    >
  }>
}
```

## 写面：`POST /__dsh_a2a/canvas`

| action | 入参 | 返回 |
|---|---|---|
| `create` | `{ action, name }`（trim 后 1..40，拒 `/` 与纯数字） | `{ ok, name, teams }`；拒绝时 `{ ok:false, error }` |
| `remove` | `{ action, name }` | `{ ok, teams }`（连成员一起消失） |
| `add-member` | `{ action, name, id }`（id 为本机 session 时必须 joined：live 节点或已记意图；id 含 `/` 时视为远端句柄，只做形状校验：无首尾 `/`、无 `//`、无空白；否则 `ok:false`） | `{ ok, teams, members }`（重复添加幂等 ok:true） |
| `remove-member` | `{ action, name, id }` | `{ ok, teams, members }` |

## 不变量（双侧共同遵守）

1. **同意不变量**：本机成员资格必须绑定 joined 会话——UI 的加成员选择器只列 joined 行（远端句柄由目录行背书）；leave/archive/host 清扫会移除本机成员关系，UI 随轮询自然反映。
2. **多对多**：一个 session 可出现在任意多队的 members 中；UI 以队行为主视图（成员 chip 在每个所属队行内重复出现），不做单属假设。
3. **上限**：64 队 × 32 成员/队；超限 host 拒绝且 `ok:false`——UI 不预校验上限数字，以 host 判定为准。
4. **确定性路由语义**：成员序=优先级；路由解析活成员优先→冷 joined 唤醒。UI 用 live 标记着色（实心=活，空心=cold），不承诺"下一个投给谁"之外的语义。
5. **锁版本**：本文档对应 host 实现基线 PR #13（6534a0a）及其后画布微补丁（最近对齐 master 画布域复核 2026-09-02）。任何 shape 变更 = 破坏性契约变更，需单独评审。
6. **`{x,y}` 的量纲语义**（2026-08-28 评审裁决，`feedback/2026-08-27-nexus-canvas-ux/review-node-position.md` 方向 A）：布局文档（`/__dsh_a2a/canvas-layout`）中的 `nodes.{x,y}` 是 **2D 规划画布的卡片中心，px 计**；`frames.{x,y,w,h}` 同量纲。其它消费方（如 3D 观测视角）**不得按绝对量纲消费**，须自行重投影（质心归零 + 等比缩放进自身包络）。shape 不变，本条为语义澄清。

## v1 设计系统对齐（ui-ux-pro-max 审计，2026-08-26）

技能检索命中风格：Data-Dense Dashboard（密度优先、网格布局、最大数据可见性；低成本，无障碍硬性三项 contrast-text-4.5 / keyboard / visible-focus / reduced-motion）。

**采纳（硬性要求，逐项已验）**

- 文本对比 ≥4.5:1：依赖宿主 --dsh-color-* 变量达成；字面色仅作宿主缺变量时的近似 fallback
- 键盘焦点可见：focus-visible 外描边环已加（移除钮）；宿主 Button 自带
- reduced-motion 尊重：新增媒体查询关闭 chip 过渡；面板本身无动画依赖
- 无 emoji 作图标：SVG 图标或纯字符（×、#）
- 可点击元素 cursor-pointer：原生 button 默认 + 移除钮显式声明
- Compact label 单行契约：chip nowrap+ellipsis，完整值经 aria-label 非视觉披露

**拒绝（记录理由）**

- 推荐配色板与 Fira 字体对：DSH 插件组件渲染在宿主主题树内，令牌主权归宿主（--dsh-color-*）；引入独立调色板或 Google Fonts @import 会撕裂主题一致性并违反客户端 bundle 纪律。
- 落地页模式（Enterprise Gateway）为检索误配的面板外原型，不适用于侧栏面板场景。

再审计节奏：本文档版本每次 bump 时重跑该技能三条域检索（chip 溢出 / 焦点可见 / 小型移除钮）。
