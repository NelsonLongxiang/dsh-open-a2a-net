# 发布候选验证器（ygl-trees M13 snapshot 模式）

> 2026-10-20 立项（用户令：为本项目构建一个全面覆盖的验证器）。
> 复用 [ygl-trees](https://gitee.com/) 0.97.x 的 M13 spec-validator 引擎：
> 材料 → spec（冻结）→ 报告（可重放、无时间函数、fail-closed）。

## 架构（三层分工）

```
scripts/verify-probe.mjs          证据采集面（验证器之外，真命令/真探针）
   ├─ 质量门禁：pnpm run typecheck / test:unit / test:wire / verify:nexus（退出码+用例计数）
   ├─ 运行时：3081 /__dsh_a2a_nexus/ 与 /__dsh_a2a/state 探针
   ├─ 闸门推导：candidate_on_3081 / unpublished_in_registry / worktree_clean
   ├─ 产出：verify/snapshot.sqlite（快照）+ 提交树导出（os tmpdir/dsh-a2a-submission，
   │   仓库外——放 repo 的 tmp/ 会被 vitest 收进测试树，实测踩坑 0.6.14）
   └─ 产出：verify/probe-summary.json（人读摘要）

verify/material.md                判据源（14 条判据句，逐字被验证单元引用）
verify/candidates.json            候选验证单元（谓词 AST / file 检查器）
verify/reviews.json               盲审结论（三问：faithful / decidable / not-vacuous）

ygl-trees verify prepare          P1 逐字→P2 谓词形状→P3 盲审→P4 红队→P5 冻版
ygl-trees verify run              确定性判定（只在快照+提交树上，不出网、不跑命令）
   └─ 报告：tmp/ygl-verify/verify/reports/run_*.json（overall + 每 VU 判定 + witness）
```

**快照模式是关键**：判定期零命令执行——命令证据（门禁退出码、HTTP 探针、npm view）
全部由探针先冻结进 snapshot.sqlite，验证器只对冻结数据做 SQL 谓词判定。
同一份 spec 可以反复重跑新快照（候选期每轮重新 probe → run），判定可重放。

## 覆盖面（baseline 1 = spec_c8b6350c5034，14 单元；1.0 时代 spec_bae507ea0520 同判据）

| 面 | 单元 | 检查 |
|---|---|---|
| 质量门禁 | V1–V4 | typecheck / test:unit / test:wire / verify:nexus（含 dist 门禁）退出码 |
| 发布闸门 | V5–V7 | 3081 候选就位、私仓未发版（稳定期不自动发版）、工作树干净 |
| 运行时 | V8–V10 | nexus 页 200、peer ≥4、死信 ≤30 |
| 提交物 | V11–V14 | nexusDist bundle 在库、release-gate.md 在库、无 tmp-* 散落、spec 文件 ≥15 |

severity：V1–V6=S1（闸门面）V7–V10=S2（运行时）V11–V14=S3（提交物）。

## 用法

```bash
# 1. 采集证据（≈3–6 分钟：四道门禁全真跑 + 3081 探针 + 提交树导出）
node scripts/verify-probe.mjs

# 2. 判定（YGL_HOME 指向仓库内自包含工作区）
export YGL_HOME=D:/workspace/dsh-open-a2a-net/tmp/ygl-verify
YGL=D:/workspace/ygl-trees/dist/apps/cli/src/bin.js
node $YGL verify run spec_c8b6350c5034 --db verify/snapshot.sqlite --submission "$(node -p "require('os').tmpdir()")/dsh-a2a-submission" --json
# （submission 路径以 probe 日志行「submission exported: N tracked files -> <path>」为准）
# overall 在报告 JSON 里；rc=0 只表示「跑完出报告」，FAIL 也是有效结论
```

首轮结果（2026-10-20，0.6.13 候选）：10 PASS + V7 FAIL（验证器自身未提交，判据如实拒绝）
+ V11–V14 ERROR（工作树 .claude/worktrees 的 pnpm junction 环致 walk ELOOP）——
后者促成 submission 面改为 **git ls-files 提交树导出**（语义也更对：提交物≠工作树）。

提交验证器（72c43d2）并重采证据后：**14/14 overall PASS**
（run_695a106d18d6ca61：四门禁 exit 0、3081 探针 0.6.13 peers 7、
candidate_on_3081 ✓ unpublished ✓ worktree_clean ✓、提交树 249 文件全过）。

0.6.14 周期（2026-10-20）：ygl-trees 引擎升 contract 1.1，冻结的 1.0 spec 被拒
（run 报 `unsupported contract_version 1.0 — this engine implements 1.1`）——
按维护路径重新 submit（mat_c08af0de2907）→ prepare → **spec_c8b6350c5034**；
同材料同判据在新引擎下 14/14 overall PASS（run_62d3da86d0444a26，0.6.14 快照：
四门禁 exit 0、3081 v0.6.14 peers 6、三闸门 ✓）。判据与单元数不变（14），
spec id 更替属引擎版本驱动，非语义变更。

0.6.15 周期（2026-10-20）：判据面不变，spec_c8b6350c5034 直接重放新快照——
**14/14 overall PASS**（run_79c48f54b257b0b3，head 252504d4：unit 300/wire 290/
nexus 116 全 exit 0、3081 v0.6.15 peers 6 dead 14、三闸门 ✓、工作树净）。
注：probe 计数与本地手跑（564+4/111）口径不同（探针分别跑 test:unit 与 verify:nexus，
后者含 dist 门禁前置构建），以探针快照为准。

0.6.16 周期（2026-10-21）：k3 席修复幻影 'HTTP 200'（team 柄读取解析实会话 + 成功响应不再涂 error），glm 席验收——
**14/14 overall PASS**（run_e39265222ce7a807，head eedf3ca6：unit 300/wire 291/nexus 116 全 exit 0、
3081 v0.6.16 peers 6 dead 18、candidate ✓ unpublished ✓ clean ✓）。
插曲：首探针撞上 k3 遗留冒烟脚本 tmp-0616-fixcheck.py 致 worktree_clean=false——清掉重采后过；
纪律提醒：冒烟脚本一律放 tmp/（已 gitignore），不要落仓库根。

0.6.17 周期（2026-10-21）：chat 惯例修复（焦点/滚动跨轮询保持、Enter 发送、Esc 关抽屉），
amend 进单一 rc 提交（24513c2）——**14/14 overall PASS**（run_6e15cf91fb1dbc4e：
unit 300/wire 291/nexus 120 全 exit 0、3081 v0.6.17、三闸门 ✓）。
部署坑：同版本号 file: tgz 重装会被 pnpm 缓存吞掉（3081 一直跑旧 bundle）——
候选修订重装必须 `pnpm remove` + `pnpm add`，并以 index.html 引用的 bundle hash 为准核验。

## 何时跑

- 每个候选版本完成 `pnpm verify` 并部署 3081 之后、报给用户校验之前——
  验证器报告是「候选就绪」的机器可读证据（probe-summary.json + run 报告双件套）。
- 用户点头后 publish 时，V6（unpublished_in_registry）会翻成 FAIL——那是**发版后的正确行为**，
  baseline 1 的判据面是「候选期」；发版后请升 spec_version 重出材料（见下）。

## 维护

- **调阈值/加判据**：改 verify/material.md（判据句必须逐字可引用）+ candidates/reviews，
  `verify submit`（新材料）→ `verify prepare`（新 spec_version 冻版）→ 后续 run 用新 spec id。
  语料纪律：材料只增不改语义；改语义必须升版本，不静默改内文。
- **探针改采集面**（新门禁、新探针端点、新推导）：scripts/verify-probe.mjs + material 同步升版。
- 快照/报告/提交树导出均为再生产物（gitignore），不入库；material/candidates/reviews/文档入库。

## 已知边界（如实声明）

- 快照内的推导列（release_gate.holds）由探针脚本计算——脚本本身入库受评审；
  验证器信任边界 = 探针脚本 + ygl-trees 引擎 + 冻结 spec 三者。
- command/agent 检查器在 M13-1 fact-only 边界内（CLI prepare 拒 command、run 无 allowlist），
  本项目全部走快照模式，不依赖执行型检查器。
- peer 下限 4 / 死信上限 30 为 2026-10-20 基线值，随环境漂移须升版调整。
