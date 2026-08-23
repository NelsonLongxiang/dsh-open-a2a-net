# A2A 网络节点协作 · 工作区指导工作方式

日期：2026-08-23。适用：所有 A2A 网络节点的开发/运维/测试协作（跨仓库通用，以各仓实际工具链为准适配）。

## 一、工作区运行方式

### 主工作区（main checkout）

- **默认只读**：主工作区是共享面，仅做阅读、取证、构建验证。
- **例外**：用户明确要求在主工作区工作时，以 `main` 分支运行——且仅限用户点名授权的那一次任务。
- 主工作区不承载任何开发提交。

### worktrees 工作空间（一切开发任务的唯一运行面）

- 代码、plan、TDD、spec 等开发任务和代码编写，**必须**运行在 worktree 工作空间。
- **不主动合并到 main**：worktree 只以 **提交 PR** 的形式工作，合并由独立评审侧执行（作者永不自合）。

### worktree 目录规范（强制）

- 所有 worktree 必须建在 **仓库内** `.claude/worktrees/<name>`（.gitignore 已忽略该目录）。
- **禁止**散建到仓库外（如 `~/workspace/<repo>-wt-*`、`/tmp/<repo>-*`）——散落 worktree 残留后难发现难收拾（实战教训：`/d/tmp` 下曾积压 a2a-perf/perf2/f1/gui-* 等多枚，靠人工巡检才发现）。
- Claude 用 EnterWorktree（默认建在 `.claude/worktrees/`）；dev-agent / 手动 `git worktree add` 也必须用 `git worktree add .claude/worktrees/<name> <branch>`。
- 任务完成 PR 合并后，及时 `git worktree remove .claude/worktrees/<name>` 清理。

## 二、开发纪律

### 禁止临时脚本（强制）

- 可复现的数据操作（补全/归一/重算/提取）必须做成**正式 tool**（`teams/.../tools/*.py`，遵守工具铁律）或 CLI 子命令，进 git。
- 禁止 `/tmp` 临时脚本——不入 git、散落、会和正式工具 API drift（实战教训：Layer3 脚本 product_context 参数 drift 致全失败）。
- 一次性验证可 inline `python -c`，但可复现操作禁止。

### 企业内部版与开源版隔离

- 企业内部版使用 **Gitea** 完成 PR 提交，不参与开源版相关 PR 建设。
- 有异常写入 `feedback` 目录。

## 三、提交 PR 前门禁（强制）

- **Windows worktree**：`powershell -ExecutionPolicy Bypass -File scripts/check-core.ps1`（ruff check + format + tsc；加 `-WithPytest` 含测试）。
- **Linux/CI**：`npm run check` 全量。
- 实战教训（2026-08-14）：main.ts 悬空残留（bun build 全挂）、unused imports、16 文件 format drift 均因跳过门禁直接合入 main。
- **deal_pr 吸收 PR 后合入 main 前同样必须过门禁**。

## 四、PR 提交后流程

- 每次提交 PR 后，**立即设置一个一次性定时任务**（约 20 分钟后触发），自动检查该 PR 的合并状态与评审反馈。
- 任务指令带上 PR 号与链接；触发后汇报状态/评审意见；若仍未合并则再设一个 20 分钟后续任务。

## 五、与 A2A 网络结构的适配

A2A 网络节点天然跨会话、跨机器、并行多线。本规范利用其结构特性：

| 特性 | 适配 |
|---|---|
| 去中心化多节点并行 | worktree 隔离让多节点同时在同一仓库工作互不串扰（每节点独立 worktree 分支） |
| 节点会话可消失/重启 | 所有进度沉淀在 git（分支+PR），节点重启后从 PR 状态恢复，不依赖会话内存 |
| 跨节点评审（作者≠合并者） | PR 制度与 A2A 四角协作（实现/复审/流程/测试）天然对齐——作者节点提交，评审节点裁决 |
| 监督者看板调度 | 任务卡与 PR 一一对应，loop 跟踪到待验收 |
| 测试节点受控验证 | 3081/3082 只读+受控安装，PR 合并后由测试节点做组合验证 |

**节点职责速查**：实现节点（worktree→分支→PR）→ 复审节点（只读 diff 审查）→ 流程节点（worktree/基线/门禁核验）→ 评审合并（双章，非作者）→ 测试节点（3081/3082 组合验证）→ 监督者（看板 loop 跟踪）。

## 六、工作区优先工作准则

- 自己工作区的任务，自己优先执行：每个节点以本职工作区（own workspace）的任务为第一优先级。
- 其他工作区的任务，仅在无当前工作区待办任务时，协助完成：跨区协助是余力行为，不得挤占本区在途任务。
- 调度侧（监督者）派单时应遵循同准则：先派属地节点，属地繁忙才跨区改派。
