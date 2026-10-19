# dsh-open-a2a-net 发布候选验证材料（baseline 1）

> 本材料是验证器的判据源：下列「判据」节的每一行都会被一个验证单元逐字引用并翻译成
> 确定性检查（SQL 谓词跑 verify/snapshot.sqlite，或文件检查跑仓库提交物）。
> 证据由 scripts/verify-probe.mjs 采集（质量门禁真命令退出码 + 3081 运行时探针 + 闸门推导），
> 快照口径、可重放。冻结于 0.6.13 候选（8814fef）。

## 引用铁律（逐字引自 docs/release-gate.md，2026-10-19 立）

1. **稳定期不自动发版**。改完代码 ≠ 发布。`npm publish` 永远是最后一步，且只在用户校验通过后执行。
2. **3081 先行**。一切候选版本（含 UI/host 改动）先装进 3081 测试环境，由用户亲自校验。
3. **校验通过 → 用户点头 → 才发版**（`npm publish` → Gitea 私仓）→ 才部署生产。

## 判据（每行一条，验证单元逐字引用）

V1 质量门禁 typecheck 的退出码必须为 0。
V2 质量门禁 test:unit 必须退出码 0 且通过用例数大于 0。
V3 质量门禁 test:wire 必须退出码 0 且通过用例数大于 0。
V4 质量门禁 verify:nexus（含 dist 门禁）必须退出码 0。
V5 3081 测试面 state.version 必须等于仓库 package.json 版本（candidate_on_3081 成立）。
V6 私仓 latest 版本必须不等于候选版本（unpublished_in_registry 成立，稳定期不自动发版）。
V7 提交验证时工作树必须干净（worktree_clean 成立）。
V8 3081 的 nexus 工作台页面必须返回 HTTP 200。
V9 3081 的 state 面必须报告至少 4 个 peer。
V10 3081 台账死信数不得超过 30。
V11 仓库必须跟踪至少 1 个 nexusDist 前端 bundle（assets/nexusDist/assets/*.js）。
V12 提交物必须包含发布闸门文档 release-gate.md。
V13 仓库根不得有 tmp- 开头的散落临时文件。
V14 测试套件规模不得低于 15 个 spec 文件（tests/**/*.spec.ts）。

## 边界（如实声明）

- 快照内的推导列（release_gate.holds 等）由探针脚本计算，脚本本身在提交物内受评审；
  验证器只对冻结快照做确定性判定，不在判定期执行命令。
- 死信上限 30 与 peer 下限 4 为 2026-10-20 基线值（3081 实测死信 14、peer 6），
  调整阈值须升 spec_version 重出材料。
