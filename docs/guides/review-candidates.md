# 固定提交评审候选的导出与核验

正式入口是 `node scripts/review-candidates.mjs`，属于本项目评审维护工具，不是验证器 verdict、发布器、安装器或 A2A 调度入口。它从 GitHub 的不可变对象导出候选，不切换共享检出、不安装依赖、不触发评审/合并/部署，也不查找凭据或其他会话的文件。

## 对象与落点

- **稳定能力**：`scripts/review-candidates.mjs`；测试是 `tests/unit/review-candidates.spec.ts`。不得继续从旧任务临时目录调用其历史原型作为跨任务入口。
- **任务输入/导出/证据**：所属项目的 `tmp/<任务标识>/`，每个 PR 使用独占 `pr<编号>/`。计划只是本轮参数，不是新的工作台账。
- **已发布评审**：仍以原 PR 评论及固定提交引用为准；导出和核验不会替代、改写或重发评论。
- **历史原型及旧任务证据**：原位保留，不因正式入口建立就自动删除、移动或改写。收件文件继续由 `a2a-inbox/` 工具管理。

根目录职责与保留政策沿用[仓库目录与产物归位](repository-layout.md)。本工具不声称整个工作区已治理，也不清理缓存、运行态或系统临时文件。

## 显式输入计划

在核对任务归属和无覆盖冲突后，创建本任务的 `tmp/<任务标识>/plan.json`：

```json
{
  "root": "tmp/review-example",
  "plans": [
    {
      "n": 123,
      "head": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "previous": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
```

以上 SHA 仅为格式示例，执行时须替换为真实完整 SHA。`previous` 是明确选定的对比基线，不能以浮动分支或“上一个差不多的版本”替代。仓库固定为本项目 `NelsonLongxiang/dsh-open-a2a-net`；不扩成通用远端拉取器。

已有且确属当前执行者的候选可以显式列为 `reuse`，例如 `"reuse": ["tmp/my-prior-review/pr123/candidate"]`。只有 Git blob 摘要完全相同的字节会被复用。不填时不会扫描项目 tmp、其他任务、会话私有目录或宿主安装目录找缓存。显式路径不是读取别人的产物或凭据的授权。

## 导出

```bash
node scripts/review-candidates.mjs --plan tmp/review-example/plan.json
```

需要现有 `gh api` 访问能力及该仓库的读取权限。工具仅使用宿主已提供的 GitHub CLI 身份，不读取或配置凭据。请求失败或权限拒绝时停止，不自动切换身份、工具或获取途径。

工具检查计划、当前精确头、按 Git 对象编码重建的 commit/tree 摘要、非截断树、普通文件路径和每个 blob 摘要，保存元数据、对比摘要及候选源码。多页 PR 文件清单按页收集；对比摘要触及 GitHub 的 300 文件上限时明确拒绝，需先选定更窄的显式基线，不将可能截断的 diff 冒称完整。源码符号链接、子模块、路径逃逸、Windows 路径别名与大小写碰撞不被猜测展开，而是明确拒绝。

每个 `pr<编号>/` 必须不存在。导出途中失败时保留已有部分，返回非零，不覆盖重跑、不自动删除“半成品”。先对账失败点，再用新的独占运行位置或经明确授权的恢复流程处理；不要把目录存在称为成功。

候选中不自动建立依赖 junction、不安装包。需要执行项目测试时，按项目既有构建/依赖及隔离契约另行核对，仍使用 `pnpm verify` 或其已有生命周期入口。导出成功只证明该次覆盖的来源/字节事实，不证明代码、权限或业务安全通过。

## 只读核验

```bash
node scripts/review-candidates.mjs --plan tmp/review-example/plan.json --verify-only
```

核对已保存的候选与固定树、在线检查当前 PR 头及远端不可变提交的根树见证仍一致，并计算该 PR 目录直接子项 `.log` 文件的 SHA256；结构化 JSON 写 stdout。日志必须已执行结束，工具不会替你判读测试成功、隐藏非零结果或等待作业。

`--verify-only` 不写回候选、元数据或结果清单，不覆盖以前的交付。若确需保存这次结果，应在本任务选取未占用的新文件名，使用明确重定向，先遵守项目写入与保全规则。

无法或无需访问远端时，可显式离线核验：

```bash
node scripts/review-candidates.mjs --plan tmp/review-example/plan.json --verify-only --offline
```

离线使用已保存的来源见证与本地候选；`currentHead` 明确为 `not-checked`，不证明远端 PR 现在仍是该头，不构成新的精确头批准。工具不自行猜测“网络失败等于离线许可”，在线失败不会自动降级。

## 退出与验收

- 成功：退出 0，stdout 为带 `ok`、执行模式和每个候选结果的 JSON。
- 输入、路径、来源、摘要、远端头或 I/O 失败：非零，stderr 给出失败原因；不执行自动修复或清理。
- `--help` 仅显示命令说明。
- 工具本身的正反例可经现有项目生命周期运行：

```bash
node scripts/verify-temp-clean.mjs node node_modules/vitest/vitest.mjs run tests/unit/review-candidates.spec.ts
```

测试覆盖显式复用、旧交付不覆盖、离线零远端请求、读前链接拒绝、错误 blob、树绑定、路径逃逸、源漂移与远端头推进。它不模拟 GitHub 权限批准或生产验收，也不替代项目完整门禁、正式 spec run、独立评审和发布授权。
