# 无限画布 Stage · 设计系统记录

> 八技能会诊产物：ui-ux-pro-max（主裁）、design-system、minimalist-ui、premium-visual-design、frontend-design、frontend-designer、ui-styling、anti-slop-frontend。
> 生效对象：`/__dsh_a2a_canvas` 全页应用。更新须走 PR 并在本文档留痕。

## 一、风格裁定（ui-ux-pro-max 生成器）

- 输入意图：infinite canvas / node graph editor / pan zoom / dark / developer collaboration
- 命中风格：**Minimalism & Swiss Style**（清爽、留白、功能至上、高对比、几何网格；亮暗双模；无障碍四硬性：contrast-4.5 / keyboard / visible-focus / reduced-motion）
- 同轮生成的前次 Data-Dense Dashboard 判定（面板 lite 版）与本风格共存：列表=密度呈现，画布=空间操作，共享无障碍基线
- Pattern 段（Product Demo landing archetype）两轮均判误配，拒用；只取 Style 层

## 二、令牌架构（design-system 三层制）

页面自有主题（脱离宿主 slot 树，token 主权在本页），严格三层：

```css
/* Primitive */ --uupm-ink-0..3; --uupm-bg-0..2; --uupm-accent (#8B5CF6 族)
/* Semantic  */ --surface / --ink / --ink-muted / --accent / --edge-live / --edge-cold
/* Component */ --card-* / --frame-* / --toolbar-* （一律引用 semantic）
```

- 字面色零散值禁止直接进组件规则，必须先入层
- 深色优先（dev-tool 场景），对比全对 ≥4.5:1

## 三、各技能管辖条款

| 技能 | 本页执行条款 |
|---|---|
| minimalist-ui | 阴影透明度 <0.05 或无边框阴影；零渐变零霓虹；组件级超扁平；emoji 禁用 |
| premium-visual-design | 禁 1px 死灰边框→rgba(alpha) 细线；过渡禁 linear/ease-in-out→cubic-bezier(0.2,0,0,1)；微交互必须插值 |
| frontend-design | 主体接地：画布世界层铺**工程坐标纸点阵**（radial-gradient dot grid，随内容一起缩放平移）——拓扑编排的本体语言 |
| frontend-designer | WCAG 2.1 AA：语义 button/input、键盘可达工具栏、焦点环统一 accent |
| ui-styling | 交互件四态齐备（default/hover/active-disabled/focus-visible） |
| anti-slop-frontend | 其自约束 excludes 产品型 UI——仅取「先读房间」纪律与推送前反模板清单；不做风格表演 |
| ui-styling/字体注记 | 内网离线部署禁外部字体 @import；本地栈 `Avenir Next/Segoe UI Variable/Segoe UI` + 等宽 `ui-monospace/Cascadia/Consolas`（坐标、team id） |

## 四、运动规范

- 平移/缩放/拖拽：零缓动跟随指针（操作=身体延伸）
- 卡片拾起：scale 1→1.02 + 边框亮起，120ms bezier；落回反向
- 保存指示灯：颜色插值 140ms；reduced-motion 时全部动画置 none，状态以文字保留

## 五、交付前门（本文件 bump 时重跑）

[ ] 三层令牌无越层引用　[ ] 对比抽查 4 处文本 ≥4.5　[ ] 焦点遍历工具栏全可达　[ ] reduced-motion 关闭后零动画　[ ] 无 emoji　[ ] 反模板清单过一遍
