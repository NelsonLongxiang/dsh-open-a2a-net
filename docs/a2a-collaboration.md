# A2A 协作规范（指引）

全文在 `src/skill/references/collaboration.md`（当前 v1.13）。那是唯一可写的源头，本页只做指引，不放第二份正文。

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
