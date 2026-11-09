# 发布候选验证器（ygl-trees M13 snapshot 模式）

> 2026-10-20 立项（用户令：为本项目构建一个全面覆盖的验证器）。
> 复用 ygl-trees 的 M13 spec-validator 引擎（立项时 0.97.x；0.113+ 起材料须重冻，见下方「引擎迁移注记」）：
> 材料 → spec（冻结）→ 报告（可重放、无时间函数、fail-closed）。
>
> **现行 id 速查（2026-11-03）**：隔离候选版 RC 判据在 0.119 引擎上冻结为 `spec_bdf9df9d3851`（15 单元）。旧 `spec_2b4fb653a3b2` 属 0.114 时期且当前机未安装，不可拿历史运行作现行 PASS；`spec_c8b6350c5034` / `spec_bae507ea0520` 仅留台账。
> 监督域 S 层现行 spec 为 `spec_4de5f3b9d48d`（S1–S19，19 单元，见文末）。

## 架构（三层分工）

```
scripts/verify-probe.mjs          证据采集面（验证器之外，真命令/真探针）
   ├─ 质量门禁：pnpm run typecheck / verify:docs / test:unit / test:wire / verify:nexus（退出码+用例计数）
   ├─ 运行时：3081 /__dsh_a2a_nexus/ 与 /__dsh_a2a/state 探针
   ├─ 闸门推导：candidate_on_3081 / unpublished_in_registry / worktree_clean
   ├─ 产出：verify/snapshot.sqlite（快照）+ 提交树导出（os tmpdir/dsh-a2a-submission-<唯一后缀>，
   │   仓库外——放 repo 的 tmp/ 会被 vitest 收进测试树，实测踩坑 0.6.14）
   └─ 产出：verify/probe-summary.json（人读摘要，含 snapshot/submission 路径与 git_head 绑定）

verify/material-isolated.md        隔离候选版 15 条冻结判据源（旧 material.md 不改写）
verify/candidates-isolated.json  与新判据逐字匹配的候选 AST
verify/reviews-isolated.json     三问盲审（旧 candidates/reviews 不改写）

ygl-trees verify prepare          P1 逐字→P2 谓词形状→P3 盲审→P4 红队→P5 冻版
ygl-trees verify run              确定性判定（只在快照+提交树上，不出网、不跑命令）
   └─ 报告：tmp/ygl-verify/verify/reports/run_*.json（overall + 每 VU 判定 + witness）
```

**快照模式是关键**：判定期零命令执行——命令证据（门禁退出码、HTTP 探针、公网 npmjs 精确版本直连元数据）
全部由探针先冻结进 snapshot.sqlite，验证器只对冻结数据做 SQL 谓词判定。
同一份 spec 可以反复重跑新快照（候选期每轮重新 probe → run），判定可重放。

## 覆盖面（隔离候选版 `spec_bdf9df9d3851`，15 单元；历史版本冻结不回写）

| 面 | 单元 | 检查 |
|---|---|---|
| 质量门禁 | V1–V4、V15 | typecheck / verify:docs / test:unit / test:wire / verify:nexus（含 dist 门禁）退出码 |
| 发布闸门 | V5–V7 | 3081 候选就位、公网 npmjs 精确版本不存在（404=未发布，其余未知=FAIL）、工作树干净 |
| 运行时 | V8–V10 | nexus 页 200、隔离标记或非隔离 peer ≥4、state 200 且死信 0–30 |
| 提交物 | V11–V14 | nexusDist bundle 在库、release-gate.md 在库、无 tmp-* 散落、spec 文件 ≥15 |

severity：V1–V6、V15=S1（闸门面）V7–V10=S2（运行时）V11–V14=S3（提交物）。

## 用法

```bash
# 1. 采集证据（≈3–6 分钟：五道门禁全真跑 + 3081 探针 + 提交树导出）
node scripts/verify-probe.mjs

# 2. 判定（YGL_HOME 指向仓库内自包含工作区；路径按本机替换，下例为开发席 Windows 机）
export YGL_HOME=D:/workspace/dsh-open-a2a-net/tmp/ygl-verify
# 使用本项目精确钉版的 pnpm exec ygl-trees；不依赖邻仓引擎路径
# 现行隔离候选版 RC spec：spec_bdf9df9d3851；--submission 必须取本轮 probe 输出的唯一目录
pnpm exec ygl-trees verify run spec_bdf9df9d3851 --db verify/snapshot.sqlite --submission "<本轮 probe 的 submission exported 路径>" --json
# （submission 路径以本轮 probe-summary.json.submission 为准；缺失或与 snapshot/HEAD 不匹配即拒绝）
# overall 在报告 JSON 里；rc=0 只表示「跑完出报告」，FAIL 也是有效结论
```

新环境没有 `spec_bdf9df9d3851` 时，不得借用旧 spec 的 PASS：先由 CLI 按 `verify/material-isolated.md`、`verify/candidates-isolated.json`、`verify/reviews-isolated.json` 提交/准备，file 检查器必须以本轮仓库真实 nexusDist bundle、`docs/release-gate.md` 和一份已跟踪的 `tests/**/*.spec.ts` 作为 `--attach` 样本。新构造必须在项目根执行 `pnpm exec ygl-trees verify meta .` 并通过，不能用 `--meta-repo` 指向引擎根或 `--no-meta` 求绿；历史借引擎根的构造记录仅保留为事实，不证明本产品准入。未通过时停止 submit/prepare，不改旧冻结 spec。冻结后记新 spec id 与材料 hash，正式判定只认 `verify run` 的报告和归档。

`scripts/verify-probe.mjs` 直连 npmjs **候选精确版本**：404 才记未发布，200 记已发布，网络错误/其他状态记未核且 V6 FAIL；不以 `latest` 标签或项目 `.npmrc` 证明精确版本不存在。3081 state 在 isolated 模式可保留持久化 peer 列表，V9 看显式 `isolated=true` 而不要求 peer 数为 0；V10 必须 state HTTP 200 且死信计数非空、处于 0–30。probe 的提交物目录每轮新建，写进摘要并打印路径；直接 CLI RC 入口只接受同一 snapshot/HEAD 下的该目录，缺摘要、路径异常、旧固定 TEMP 目录都拒绝，不回落旧目录。运行前以保留的 submissionFromProbe 绑定 helper 核对本轮摘要；不得只复制一条旧路径。

**本机正式CLI运行（2026-11-03，非发布PASS）**：现行 `spec_bdf9df9d3851` 的 `run_b67ca23c44bee3a7` 判 `FAIL`（9 PASS、6 FAIL，V15 文档漂移闸 PASS），红项 V2/V5/V6/V7/V9/V10：仓库仍是已发布的 0.6.31、Windows unit 红、工作树在途且 3081 state 返回 401，不能宣称候选通过。该报告归档 `archive verify` **169 项通过**；把现行规格跑在旧四门禁快照得到 `run_c3de2aebeb915040`，V15 明确 FAIL，缺门禁不会空洞通过。历史 14 单元 `run_b927977dbea7a8b9` 在 3081 v0.6.32 `isolated=true` 且 state 报 9 个持久化 peer 时，V8/V9/V10 PASS，但其快照仍使用旧 latest 探针，不证明精确版本的 V6；整体仍 FAIL。两份报告均不对应 90c7d4c 的完整正式候选 PASS。

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

0.6.18/0.6.19（2026-10-21，台账补行）：master 线直推（无 npm 候选），无 RC 周期——
覆盖证据引用合并门禁输出：PR #107（REVIEW-66abc2cf-d31a6a1-PASS + TEST-ea2aad88 零回归
归因，575/4/0 逐字）与 PR #108（REVIEW-74555a36-957dcfa-PASS + TEST-ea2aad88-PASS，
577/4/0 逐字）双章合入；触发条件=npm 发布候选时恢复周期。

**引擎迁移注记（2026-10-22，0.113+ 破坏性变更）**：ygl-trees 0.113.0 起 verify meta 闸
默认硬化，0.110 时代冻结的材料/spec 在 0.114.x 引擎上掉档（预期行为，非缺陷）——
**重冻材料即正解**（监督席已代重冻 mat_39e6cb557daf 系列 + spec_2b4fb653a3b2 v1）。
引擎 510aaef 起 `--attach` 可重复（多文件检查器 spec 的 P4 红队门解锁）；RC 仓提交
双附件命令形：`verify submit --text verify/material.md --attach assets/nexusDist/assets/<bundle>.js
--attach docs/release-gate.md --no-meta`。运行态 file 检查器 scanned=0 的 4-ERROR 形态
为引擎运行面随访项（候选判定以 V1-V10 + 直连事实背书为准）。

0.6.24 发布周期（2026-10-22）：**公网 npmjs latest=0.6.24**（PUT 202，shasum 07142d55cf67
逐字节符）；候选期快照 10 PASS/0 FAIL/4 ERROR 为有效候选态判定；发布后 V6 翻红=预期
正确行为（下次候选升 spec_version 重出材料）。私仓 Gitea（latest=0.6.15）未同步——
双 registry 纪律下按属主指令补发。

## 引擎自检与 RC 证据链（旧自判递归驱动已退场）

当前入口是本项目钉版 CLI，不再生产 `recursive-summary.json` 或 JS 总体 ok，不再按最新 zip 名猜本轮归档。目标是引擎 `verify tree run`；self-check、附件 submission 与归档校验的树能力齐备、正式树规格获准入前，不伪造树 id 或“总体 PASS”。

树能力补齐前，以下**三份 CLI 产物缺一不可**，全部绑定同一候选完整 SHA、精确引擎版本和本轮证据目录。候选关联在交付记录中显式记下，不暗示 self-check JSON 自带候选：

1. `pnpm exec ygl-trees verify self-check --corpus <明确语料目录> --json` 的完整原始产物；缺语料或 skip 如实列出，不用历史自检替本轮。
2. 直接 CLI RC `verify run` 报告，使用本轮 snapshot/HEAD/唯一 submission 绑定，并保存本次 run 返回的精确 archive 路径。
3. `pnpm exec ygl-trees verify archive verify <该 run 返回的精确 zip> --json` 产物。不能用最新文件名、别的 spec 或旧候选归档代替。

缺任何一份或候选绑定不一致，不能声称 RC 证据链完整。rc=0只是过程完成，业务结论仍读各自 CLI verdict，不由新 shell/JS 汇总。原 --fresh 的效果改为先显式运行 verify-probe，再执行上述 CLI 步骤，采集 exit0 不是 PASS。唯一 submission 核查使用 scripts/verify-submission.mjs 的 submissionFromProbe；不回落固定 TEMP 目录。

**历史记录（非当前入口）**：2026-10-21 的 scripts/verify-recursive.mjs 首跑曾为引擎6ok、RC14/14（run_60ff8d9aa34e5a6e）、归档5items；旧结论不重写。源码可按旧精确490809b或bb481b9 git对象只读查看，blob为5dcc5238d73b28543bca51ec81a612cc1bc840cd。历史复核优先 CLI archive verify旧封包；不得重跑会写 summary 的旧脚本覆盖正式目录。旧摘要仍被 gitignore保留，不迁移成新报告。

**gh#5 交付格式更新**：交付上述三份 CLI 产物 + 本轮 probe-summary 的 snapshot/HEAD/submission绑定；具备正式引擎树后交 tree report及archive。文档不能把独立产物假称已组成树；0.6.43发布后v2（A1–A8）放行链不依赖旧递归脚本，见留存v2节。

## 监督席 S 层（scripts/supervisor-snapshot.mjs + ygl-trees verify run）

与上方 RC 验证器/递归验证器互补：RC 验证器面向**发布候选闸门**，递归验证器面向**引擎与
证据链自证**，S 层面向**监督台账与仓库事实的诚实性**。

> 沿革：2026-10-21 监督席就任时为单脚本 `scripts/supervisor-verify.mjs`（九层 S1–S9，退出码即判定）。
> 同日按《验证器协同规范》铁律一（CLI 是唯一判定面）迁移：该脚本退役，改为
> **探针 `scripts/supervisor-snapshot.mjs` 只采集事实** → **`ygl-trees verify run` 出判定**。

两步用法：

```bash
node scripts/supervisor-snapshot.mjs [--snapshot <path>]   # 采集：写 snapshot.sqlite，恒 exit 0（不出判定）
ygl-trees verify run spec_4de5f3b9d48d --db <snapshot>      # 判定：overall 在报告 JSON 里
```

- 快照每表 `(name, ok, detail)`，`ok=0` 行即违例；判据材料与候选单元见
  `verify/candidates-supervision.json` / `verify/reviews-supervision.json`。
- 判据域已由 S1–S9 扩至 **S1–S19**（2026-10-27 v10，`spec_4de5f3b9d48d`，19 单元）：
  S1 validator-records / S2 repo-facts 血统断言 / S3 ygl-trees-health / S4 docs-crosscheck /
  S5 self-recursion / S6 public-triage / S7 deps-mirror（含 `package.json#pnpm` 镜像已退役的缺席断言）/
  S8 scope-fix-anchors / S9 layer-docs-contract，及其后增补的 OriginClaim 锚、控制面门禁、属主信号 UI、
  在跑宿主构建、remote-ref 准入、v8 锚（重排不变量 / CLI 墓碑 / 自环豁免）、warm-cache 双向识别、
  看板加固双锚（M1 棘轮 planning-view ≤1507 行 + flyer WorldBounds 签名）。逐条编号以 spec 材料为准。
- **本文档本身是 S1/S4 的被验对象**：S1 逐个核对文中 `run_<16hex>` 报告存在且 PASS，
  S4 核对文中 `head <8hex>` 均为真实提交、`spec_c8b6350c5034` 仍被提及——编辑本文时这三类锚只增不删。
- 已知限制：探针的 `REPO` / `YGL_BIN` 等路径常量写死开发席 Windows 机（`D:/…`），他机运行需改常量。

运行记录落 tmp/supervisor/runs/（gitignore，保留最新 200 条，审计轨迹而非判定面）。维护者：监督席
（open-a2a-net--监督席会话）；红项处置纪律见 kb《open-a2a-net 监督席 SOP 与递归验证器契约》。

## 何时跑

- 每个候选版本完成 `pnpm verify` 并部署 3081 之后、报给用户校验之前——
  验证器报告是「候选就绪」的机器可读证据（probe-summary.json + run 报告双件套）。
- 用户点头后 publish 时，V6（unpublished_in_registry）会翻成 FAIL——那是**发版后的正确行为**，
  baseline 1 的判据面是「候选期」；发版后请升 spec_version 重出材料（见下）。

## 发布物留存证据补充验证器（2026-11-05，独立于发布前 RC）

新增 material-artifact-audit.md / candidates-artifact-audit.json / reviews-artifact-audit.json，均在 verify/ 中；旧冻结材料不变。
既有 scripts/verify-probe.mjs 增加 --release-audit DIR --out NEW.sqlite 模式，读取实际 tgz、候选 git 对象、验收 JSON 和两端下载包，写独立 release_artifact_facts 表。不覆盖已有快照或原 RC summary；采集退出码不是判定。

正式 CLI 实测：
- 材料 mat_dc0b5d804dd6；正文 SHA256 03a8ca80a786a2ca35c55dcb60fa45e7a2b3d5f4e209be232cc43c55ec93880e。
- 规格 spec_71ef5a1de108 v1，7 单元，as-of=2026-11-05T04:25:18.635Z（快照采集时间）。trace 如实记录 candidates/reviews 同作者，这是构造自检，不冒称独立盲审；PR 仍请非自我节点复核。
- 实际 0.6.40 留存证据 run_722d0e677b6d2f3e：overall=PASS，7 PASS / 0 FAIL，仅针对本补充规格。最终采集器重采后 run_22edf609ace647f8 仍为 7 PASS / 0 FAIL。
- 七项成功事实逐个改为失败后的 7 次 CLI run 全部 FAIL（各 6 PASS / 1 FAIL）；空表 run_609b897555970fe2 为 0 PASS / 7 FAIL。实际缺输入经采集器产生的 run_b749732c43c12b01 同样 0 PASS / 7 FAIL；验收早于打包 run_52f112f508e2aa76 判 2 FAIL；实际公网回读字节被改 run_a00014b20a089341 判 1 FAIL。对账明细 tmp/validator-artifact-audit/{counterexamples,input-counterexamples}.json。
- 正例自动归档路径 tmp/validator-artifact-audit/workspace/verify/archives/yglverify-prepared-prepared-spec-v1-20261105T042813Z-r722d0e67.yglverify.zip；verify archive verify 返回 ok=true、5 items、无问题/告警。archive SHA256=1c37ebf0618be6cee57d94a1dca3f85375f4bea3663c4069a7bd9bd072a547fa。

留存目录约定：provenance.json（candidate/at/filename/size/files/shasum/sha256）、该 filename 的 tgz、acceptance.json（candidate/at/shasum/results，每行 kind/base/path/status 及端点字段）、npmjs-readback.json 与 npmjs-readback.tgz，以及 mirror-readback/<filename>。kind 为 dsh3081 或 cleanServe；样本是本机留存的 tmp/release-0.6.40-1af9266/，输入从参数指定，脚本不写死机器路径。

调用（YGL_HOME 选择独立工作区，不触动旧规格）：

    node scripts/verify-probe.mjs --release-audit <留存目录> --out <新快照.sqlite>
    ygl-trees verify lint-candidates verify/candidates-artifact-audit.json --text verify/material-artifact-audit.md --reviews verify/reviews-artifact-audit.json --db <新快照.sqlite> --json
    # 新构造仅在项目根 meta PASS 且获对应材料冻结授权后执行；历史spec不重写
    pnpm exec ygl-trees verify meta . --json
    pnpm exec ygl-trees verify submit --title "发布物留存证据 v1" --text verify/material-artifact-audit.md
    pnpm exec ygl-trees verify prepare <材料ID> --candidates verify/candidates-artifact-audit.json --reviews verify/reviews-artifact-audit.json --db <新快照.sqlite> --as-of <采集ISO时间>
    ygl-trees verify run <规格ID> --db <新快照.sqlite> --json
    ygl-trees verify archive verify <run返回的zip> --json

**边界**：这是发布后留存证据核对，不是发布前候选 PASS。不能从 tgz 反推出历史 HEAD、干净构建或评审身份；同版本但不同提交的构建还需独立血统核对。不替代原 15 条 RC、不新增人工门或发布阻断条件。

## 发布物留存 v2：评审包内清单一致（A8，2026-11-05）

新材料/构造输入为 verify/material-artifact-audit-v2.md、candidates-artifact-audit-v2.json、reviews-artifact-audit-v2.json；旧v1三份冻结输入及spec_71ef5a1de108不改写。采集器仍用原 --release-audit 入口，现在固定输出第8事实 reviewer_file_identity；旧规格只读它原来7项，新v2缺评审清单必失败。

评审席交付 reviewer-manifest.json，格式为 {sha:<完整候选SHA>,platform:<非空环境描述>,files:[{path,size,sha256}]}，须保留独立交付来源。path可带单个package/前缀或相对包根；裸数组不能自补造SHA/评审身份。采集器只核声明候选及实际包内文件身份，不凭JSON证明评审者身份或干净构建过程。

实际tgz在内存只读展开（256MiB解压上限），不把成员路径解到磁盘；校验tar header、普通文件、重复/越界/控制字符、完整路径集合、size与SHA256。正常目录不算包内文件，PAX path/size按明文处理，link/device/sparse等失败关闭。比较忽略容器mtime/uid/gzip元数据，保留文件内容原字节，不做LF改写。

构造自检：材料mat_c73696766f43（SHA25694a0952f65ce181dcfe4d2dca6f4c24d214a41439287ed8fd7c8c78d08617be1）先submit冻结；规格spec_5723ba8259bb v1，8单元，as-of2026-11-05T09:48:00Z。候选/评审同作者构造自检如实在trace记录，独立PR评审另行完成。新的tests/fixtures/release-audit-case.mjs明确生成的是constructedSelfTest，不是历史HTTP验收/真实发布证据。

正式run_859a74b82468739e为8/8PASS；归档arc_0efe913dd418验包ok=true/5items，zipSHA256482f7d39821d1e17ad40f446a5788a05363d239723b2d5dec719126bab7dc7fd。9种实际输入反例（缺清单/错候选/空/错size/hash/重复/越界/缺文件/多文件）全部7PASS/1FAIL；负例归档全链均验包通过。明细tmp/validator-review-manifest/negative-runs.json与archive-checks.json。

真实旧0.6.42因无同候选评审清单，新v2 run_f5fad4a34102b47f如实7PASS/1FAIL；不倒填伪造清单。#331真实macOS清单另经新比对器与当时Windows包解析对账208/208，无差异（tmp/validator-review-manifest/actual331-comparison.json），此不是宣称该候选曾正式发布。旧v1历史发布结论仍限旧规格。

既有v2放行仍是probe --release-audit采集→verify run既有spec_5723ba8259bb→archive verify（不依赖旧递归脚本）。新材料/规格必须先项目根meta PASS并获对应冻结授权；不使用--meta-repo借引擎根或--no-meta绕过。历史曾借引擎根的构造行为仍如实保留，不能当本仓准入证明。采集exit0不是PASS，所有结论只认spec run。v3未全PASS前仍以v2放行并附v3结果；v3真FAIL而v2PASS时暂停发布报全局评估。

## 产品仓根目录 `verify meta` 的 R3 现状与原因（2026-11-06）

**现状**：在本仓根目录运行 `verify meta .`，结果为 R1 PASS、R2 PASS、R3 FAIL。引擎 0.119.0 和 0.120.0 实测结果相同，meta_version 都是 1.4。用 v0.6.40、v0.6.43 的干净导出复测，R3 同样 FAIL，所以这不是 0.7.0 引入的退化。

**原因**：本仓根目录有 `AGENTS.md` 和 `verify/`，meta 按验证器仓的严格模式扫描，把产品自身的可执行文件判为“工具目录之外的游离执行工件”。被报的对象有三类：产品 CLI（`cli/a2a.mjs`、`cli/serve.mjs`）、构建产物 bundle（`assets/nexusDist/`、`assets/stageDist/`），以及工程测试用的 `.mjs` fixture（`tests/fixtures/` 下的文件；v0.6.43 时已有的 fixture 也一直被报）。`lib/` 已被 gitignore，干净检出里没有它，只有本地构建后才会被扫到。

**闸门口径**：meta 闸门只认 `--meta-repo` 指向的验证器引擎源码根（见本文发布物留存 v2 一节），不对产品仓根目录下判定。产品代码不登记进 `verify/meta.json` 的 tooling[]，因为它们是产品，不是验证器工具。判定规则和 `verify/` 目录本身不改。

**处置记录**：0.7.0 曾在 `docs/ops/fixtures/` 新增两个回退 fixture，因此多了两条“docs/ 下的执行工件”。按全局 2026-11-06 的裁定，这两个文件已原字节移到 `tests/fixtures/`。移动后复测（引擎 0.119.0 和 0.120.0，meta 1.4），docs/ 下已不再被报，R3 共 9 条：产品 CLI 2 条、bundle 2 条、`tests/fixtures/` 5 条，其中包括移过来的这两个。这三类都按上面的原因保留为 FAIL 现状：移动解决的是“文档目录下有执行工件”，并没有让这两个文件从 R3 里消失。

## superagent p2 影子验收采集器（2026-11-07）

**用途**：p2 影子运行结束时，把 a2a Source 自己记下的行记录、页头记录、health 记录，以及 superagent 库里的 Trigger、外发、Ticket，展平成一个新的快照，交给 `ygl-trees verify run` 按影子验收材料判定。采集器只产快照，不产判定，也不调用 verify 的 run、prepare、submit、archive。

    node scripts/verify-probe.mjs --a2a-shadow <superagent 库> --cli-home <Source 身份目录> --window <起>..<止> --out <新快照.sqlite>

- **源库只读**：以 readOnly 打开，并设 `PRAGMA query_only = ON`；测试断言采集前后源库字节不变。
- **只写新文件**：`--out` 已存在就拒绝（退出码 1），原文件不动；采集中途出错时删掉本次新建的文件，重跑不会被挡住。
- **输出与退出码**：stdout 只有一个 JSON 对象。0 表示采集完成，1 表示运行错误（源库或记录形状不对），2 表示用法错误（缺参数、窗口不是带时区的严格 ISO、起点不早于终点）。采集完成不等于 PASS。
- **展平规则**写在 `scripts/a2a-shadow-snapshot.mjs`，可复跑：同一输入写到另一个新文件，各表内容相同。
  - 按窗口（`at` 含起点、不含终点）截取：shadow_rows、shadow_pages、shadow_health、shadow_sent。
  - 不按窗口截取：shadow_triggers（只取 source 为 a2a 的）、shadow_outbox（只取 channel.source 为 a2a 的）、shadow_tickets。这几类记录没有窗口内的时间字段，检查范围只会更大，不会更小。
  - shadow_meta 按三类记录的全量计算，并带 window_from，供 A0 做同表列比较。
- **采集器自己计算的列**：
  - trigger_id = key('a2a', from, task_id)，与插件同一算法，测试中对照；
  - loss：A7 的定义，即 lost>0、lost 为 null、cursorAhead 或 epochChanged；
  - shadow_seq_gaps：同一 epoch 内、窗口首末 seq 之间缺失的 seq。covered 表示它落在同 epoch 某个 lost>0 页头的区间 (after_seq, after_seq+lost] 内（after 为 start 时 after_seq 取 0）。宿主的 lost 等于 oldest_seq − after_seq − 1，被挤出的正好是这个区间。真实宿主用例（tests/mesh/a2a-shadow-snapshot.spec.ts）按 64 行上限挤出 6 条，校准了这个区间。
- **查找列**（2026-11-07 全局裁定追加）：verify 的谓词 AST 只能查单表，sql-pair 只判断两侧键集合是否相等，因此「包含于」、计数、窗口限定都在采集器里算好。原始列一律保留，派生列只追加，每列定义如下：
  - shadow_rows.trigger_present：按全库 trigger 表计算（任何 source、不限窗口），存在 id = trigger_id 的记录为 1，否则为 0；trigger_id 为空时为 0。trigger.id 是主键（上游 superagent store.ts:72），一个 trigger_id 最多对应一条 Trigger。
  - shadow_rows.trigger_filtered_code：取上面那条 Trigger 的 disposition `$.filtered.code`；没有 Trigger 或未被过滤时为空。
  - shadow_rows.seq_records：按全量 a2a-rows 计算（不限窗口），同一 epoch、同一 seq 的记录条数；seq 为空时此列为空。
  - shadow_pages.health_error：按全量 a2a-health-log 计算（不限窗口），存在 at 与该页头相同、entry 为 a2a、state 为 error 的记录为 1，否则为 0。
  - shadow_triggers.in_window：按 trigger.at 和 --window 计算，左闭右开，落在窗口内为 1，否则为 0；trigger.at 读不出时间就整次采集失败（退出码 1），不猜。
  - p3 新增的列（影子验收 v5.1）：
    - shadow_rows.admission：信箱行上宿主准入规则的原值。
    - shadow_pages.heartbeat、rounds、rows：心跳页头自带的字段（方案 P）；不是心跳的页头分别为 0、空、空。心跳页头的 rounds 或 rows 不是非负整数，或者非心跳页头带了这两项，都整次失败。
    - shadow_pages.hb_gap_min：心跳与窗口内上一条心跳相隔的整分钟数，向上取整；窗口内第一条心跳，取它与窗口起点的间隔。
    - shadow_pages.hb_next_gap_min：心跳到下一条心跳的间隔；最后一条，取它到窗口终点的间隔。
    - A15 同时看这两个间隔，窗口两端的空白都查得出来。
  - 每列都有反向变异守着：只在窗口内的 Trigger 里查找、code 取错列、seq_records 只计窗口内、health_error 不比较 entry 或不比较 state、in_window 用闭区间，都会让测试变红。
- **计数表 shadow_tally**（2026-11-07 全局裁定追加）：verify 的检查器对扫描域为 0 行的表一律判 NEEDS-MATERIAL，而「必须为零」的 4 条判据，在健康运行下要扫的明细表本来就是空的。所以采集器另写一张固定行数的计数表，每个计数都由刚写入快照的同一批明细行算出，不再查一次源库：
  - outbox_sent：shadow_outbox 中 status 为 sent 的行数（这张表只收 a2a 的外发，不限窗口），对应 A1；
  - source_sent：shadow_sent 中 handle 等于 source_handle 的行数（按窗口），对应 A2；
  - tickets_a2a：shadow_tickets 中 basis_source 为 a2a 的行数（全库），对应 A9；
  - gaps_uncovered：shadow_seq_gaps 中 covered 为 0 的行数，对应 A7b。
  - p3 追加两行，不是「必须为零」的计数，放在这里是为了扫描域固定：
    - cli_identity_stored：窗口内 outcome 为 stored、proof 为 cli-identity、admission 在 LINK_RULES 内、不是回执、task id 不以 a2a- 开头的行数，对应 A14（应不少于 1）；
    - heartbeat_row_delta：窗口内第一条心跳之后各心跳的 rows 之和，减去 (第一条心跳, 最后一条心跳] 区间内的行记录数，对应 A15（应为 0）。
  - 自检：快照写完以后，在快照库里用 SQL 把每个计数重算一遍；行集合与 TALLY 的名字不完全一致、或者任何一项对不上，都整次失败（退出码 1），不留文件。
  - 检查器统一写成：scan 为 name='<计数名>'，where 为 n>0，fail_when 为 rows>0，这样扫描域固定是那一行。2026-11-07 用一次性工作区实测过：n=0 时 PASS（rows_scanned=1），n=1 时 FAIL，那一行被改名或缺失时 NEEDS-MATERIAL。不写 scan 时扫描域是整张表，改名会被静默判 PASS，所以不用那种写法。
- **不带正文**：快照里没有消息正文、Trigger 正文、外发正文和 health 的 detail，测试断言了这一点。
  - 反向用例：同一真实宿主数据删掉一条未报告挤出的行记录，对应的 seq 得到 covered=0。
- **登记口径**（全局 2026-11-07 裁定 (a)）：本仓 `verify/meta.json` 是 meta_index_version 1，scripts/ 按 v1 的目录白名单豁免，采集器不进 tooling[]（v1 没有这一登记形状）。升到 v2 是另一件治理改动，要做时单独提议。
- **身份钉住**（代替 tooling 登记）：输出 JSON 的 `collector` 字段带 git commit、两个采集脚本（verify-probe.mjs 和 a2a-shadow-snapshot.mjs）的 sha256，以及这两个文件相对该 commit 是否干净。验收回报必须写明这些值，并且要与最近一次采集器 PR 合入时的值一致，否则不能作为验收依据。每次采集器 PR 合入都会换一次身份，旧值随之作废：#392 的 796cccc、#393 的 bcf150c 都已作废，以最近一次合入为准。
- **机械检查**：单元测试去掉注释后断言两个脚本的代码里不出现 ygl-trees 调用，也不出现 verify 的 run、prepare、submit、archive 步骤；展平模块不引入 child_process。

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
