# #343 一期实施进度（未达到冻结/合并条件）

授权authz-343-phase1；监督放行渠道与原评审转达见issue343 comment6662148732。独立分支base4ee0e5d，不混#340、二期或生产部署。本文件是阶段记录，不宣称一期已完成。

## 冻结前覆盖门

覆盖表docs/design/343-phase1-vu-coverage.md已在GitHub精确commit d20b364c54e2c747acc9e960e26fd1d3fe02bb07送全局生产评估，issue343 comment6662307302留痕。四守卫ISO/loopback/basename/整数均已裁保留，缺口NM/非PASS；A3枚举含目录与A8普通文件数分开。**现已通过direct-427035177c9a转达收到d20b364义务映射层PASS**；只放行prepare --draft的形状探针，最终真实VU定稿表仍须精确SHA再交全局PASS才可正式prepare。没有v3 submit、正式prepare、冻结spec或run，更无v3放行结论。

## 已实施且可独立复核的基础

- 官方latest及0.121精确版本查询：latest0.120.0、0.121.0 E404，故devDependency ygl-trees精确0.120.0及lock同步。pnpm frozen install正常；本地pnpm exec ygl-trees实际0.120.0。原ignore-scripts导致better-sqlite3缺binding，pnpm-workspace仅允许better-sqlite3 build并成功rebuild，不批准任意依赖scripts。
- meta_index_version3/kindconsumer，具名产品source_roots为src、nexus-stage/src、stage/src。其他产品/测试/工具逐文件通过官方meta-tooling显式add登记243项，审计anchor带actor；原始collector一次字节变更走reregister+reason，非自动rehash，244条审计链无break/future。旧递归驱动scripts/verify-recursive.mjs明确不伪装tooling，仍留二期。
- **项目根本地钉版CLI直接verify meta真实FAIL，仅R3点名verify-recursive.mjs**；R1/R2/R5a/R6通过，未--meta-repo/--no-meta求绿。源码根未覆盖scripts/verify或整仓，lib受gitignore故不进tracked扫描，与产品产物登记区别说明。剩二期红不当“全治理合规”。
- 新入口scripts/collect-release-measurements.mjs仅原始观察：固定input slot/读取errno、JSON pointer/值/类型/顺序、文件bytes/SHA1/SHA256、实际child argv/exit/stderr、tar-t原始逐行path。显式--artifact选择物理包路径，不用未验证的provenance.filename拨文件。无ok/holds/valid/invalid_count/changed_count、无整体verdict；不改旧v2 collector及门材料，过渡期继续旧v2。
- 数据库wx排他创建，拒绝覆盖旧快照；缺blob保留NULL哈希/bytes与error input，不伪造零；JSON错误保留parse-error文本，Infinity数值保留number_text但REAL=NULL。原始tar headers/PAX/path语法/per-file payload测量仍待#232能力，当前tar-t不能冒充它们（AppleDouble隐藏、平台列目录差异等仍缺口）。无合规v3判定就不据观测声称A3/A8 PASS。

## 工程自测（不是spec判定）

新collector3例：矛盾/原始类型、重复路径、缺文件NULL、option token拒执行、不可覆盖快照、schema无判定列；全部通过。实际0643证据运行新collector产生1280字段、208条tar路径；此前Windows tar绝对drive-colon调用失败记录保留，改basename+cwd后能枚举。它们是采集原料/工程检查，非正式v3结论。

首轮默认完整verify因旧single-flight30ms墙钟断言失败，inner0；该用例隔离原预算通过。未改此无关断言/worker/timeout/skip。第二轮默认完整verify真实exit0：root1489passed/6原skip、layout4、nexus327、innerentries0、tracked dist零diff。原门禁1430等历史数不挪作本树结论；新增3例如实计入。

## draft-only CLI 实测与未解接缝

verify/draft-shapes-phase1.json只含8个最小子义务checker形状（其中1项aggregate sql-pair，其余input presence）；不声称完整覆盖，即使lint条款计数8/8也不能替语义覆盖。draft-reviews明确faithful=revise以说明子覆盖不足，不能直接拿作正式prepare。所用material是原已存在v2，仅测形状/准入，不submit新v3材料。

本地0.120 CLI lint-candidates rc0，checked8/schema/coverage均未skip；项目根prepare --draft实际rc1 meta_failed，唯一R3是明确二期的verify-recursive.mjs，没有进入P0-P5，不能声称draft ready。输出tmp/phase1-343/minimal-shape-lint.json与draft-admission.json。没有--meta-repo/--no-meta/中立目录避门。

读0.120实现另见：draft仅回拟id/record:null，不落spec/prepare/trace；普通run需要已有冻结spec。尚未找到合法的“不冻结draft直接run”入口，**不手工将draft写入specs目录，不偷偷freeze为探针**。这两项实际接缝已上报原评审，追加上游#232 comment6662688951；需引擎/全局裁可用路径后补真实定稿VU/运行报告。当前无NEEDS-MATERIAL报告，只有形状lint与meta拒绝，不能把拒绝重新命名NM。

## 下一步与发布硬边界

1. 义务映射PASS已收到；等#232能力及draft/run接缝裁定，完成最终真实VU表，再交精确SHA覆盖PASS；不能先正式prepare再补审批。
2. 同一期高档PR继续补原始数据与获批v3材料/spec生产接口，不增减A1-A8；旧spec/run/snapshot/archive都不改，不把原v2改得无法继续发布门。
3. v3未全PASS前发布使用v2，附v3结果；若v3真FAIL而v2PASS，**暂停发布并上报全局生产评估**，不能把矛盾当known-gap。当前尚无v3规格，因此只能标尚未生产，不伪造NM报告。
4. 合并前贴项目根真实meta结果；二期未授权不动。非作者PASS绑最终exact head。M2/M7原a2a-net评审链不代裁。
