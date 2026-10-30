# A2A 协作规范（指引）

全文在 `src/skill/references/collaboration.md`（当前 v1.14）。那是唯一可写的源头，本页只做指引，不放第二份正文。

## 本项目 branch-cap 范围与只读盘点

规范第 3 节的上限作用于服务端 `refs/heads/*`；本项目纳入计数的可写 remote 是：

| 本地名称 | 目的仓库 | 独立计数要求 |
|---|---|---|
| `origin` | Gitee：NelsonLongXiang/dsh-open-a2a-net | 该端 heads ≤10 |
| `github` | GitHub：NelsonLongxiang/dsh-open-a2a-net | 该端 heads ≤10 |

不是只管 PR 所在的 GitHub，也不是把两个 remote 的 heads 相加。镜像同一
逻辑分支不跨端双算，但任一端仍须独立达标。核对方式为逐端只读
`git ls-remote --heads <remote>`；不能靠本地缓存数量或 remote 名字推断。

### PR#109 修订只读审计（2026-10-31，非清理完成声明）

- GitHub 的 `github` 端为 **4 条**：`master`、`fix/inbox-wait-transient-405`、
  `pr36`、`design/a2a-collaboration-norm-v1.14`（本 PR 分支）。
- Gitee 的 `origin` 端为 **98 条**，**超额、待逐支盘点分类**；本轮没有
  分类其可删性，不暗示这 98 条都是旧 refs 或都已合并，不据此删除任何分支。
- 两端同名交集仅 `master`（只证名称交集，不自动证明镜像或内容等价）；
  本 PR 分支只在 GitHub。本轮“4 条”仅代表 GitHub，不是双仓总量。
- 监督席两例与正文一致：双端镜像各 10 条，两端均 PASS，不相加为 20；
  Gitee>10、GitHub=4 时，仅 GitHub 合规，Gitee 独立 FAIL 且分类义务保留。
- 此快照只读结果会随后续推送/合并变化；再次执行前重读两端。原 PR 提到的
  “已删 40 条”是维护者对 GitHub 的历史操作陈述，并非本轮实做或 Gitee 的
  清理证明；维护者本机 `.git/` 文件不是其他坐席必须依赖的规范源。

## 怎么发到每个节点

`pnpm build` 的最后一步 `scripts/copy-skill.mjs` 会把 `src/skill/` 整个复制到 `lib/skill/`，随 npm 包发布。各节点安装或升级 `@nelsonlongxiang/dsh-open-a2a-net` 后：

- 插件自带的 A2A 技能会列出这份参考（`SKILL.md` 的 Details 一节）；
- 全文在插件包里的 `lib/skill/references/collaboration.md`。

新版本要等插件发版后，各节点升级插件才拿得到。

## 怎么更新

1. 改 `src/skill/references/collaboration.md`；
2. 更新文首的版本号和日期，在文末修订记录里加一行；
3. 走正常的 PR 和发版。

规范自成一体，不引用任何只在某台机器上才有的文件或工件；改的时候保持这一点。

## 和旧文档的关系

| 文档 | 处理 |
|---|---|
| `docs/a2a-workspace-collaboration.md`（2026-08-23） | 已被取代。它要求主工作区只读、开发一律在 worktree，与规范第 3 节“不用 git worktree”冲突 |
| `docs/a2a-node-collab-runbook.md`（2026-08-31） | 保留作实战记录，冲突处以规范为准 |
| README 的“协作 SOP（网络实践，v0.1）” | 保留作历史，冲突处以规范为准 |
