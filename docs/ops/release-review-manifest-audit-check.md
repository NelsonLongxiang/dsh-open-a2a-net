# release-audit v2 / A8 交付记录

基线d0655ed，中档以下的采集/判据补充；无发布/部署。旧material-artifact-audit.md、candidates-artifact-audit.json、reviews-artifact-audit.json完全不改；新v2材料先冻结后构造run。

## 冻结与最终正式产物

- mat_c73696766f43，正文SHA25694a0952f65ce181dcfe4d2dca6f4c24d214a41439287ed8fd7c8c78d08617be1。
- spec_5723ba8259bb v1，8单元，P1覆盖8/8，as-of2026-11-05T09:48:00Z；candidates/reviews同作者构造自检，trace如实记录，PR独立复核另行进行。
- 最终采集实现来自已跟踪commit c0a63b5；构造数据生产器tests/fixtures/release-audit-case.mjs同样git跟踪。其正例、验收及“reviewer”清单全部显著标注constructedSelfTest，不冒充真实独立评审或历史HTTP观察。
- 新快照final-positive.sqlite，正式run_065638a476a2f844：PASS8/8，归档arc_6c21da658eb3验包ok/5items，无问题告警；zipSHA25638ac9c0f5abef3304bb32f3b8354e7f90fcd63e0c083190327cf7660fe2f1adb。
- 实际0.6.42没有同候选独立清单，v2 run_f5fad4a34102b47f如实7PASS/1FAIL；旧v1同一8行快照仍由run_bd854c3b62ad6f4c PASS7/7，证旧冻结判据无偷改。

## 最终真实输入反例（每项7PASS/1FAIL）

缺清单run_290c728d0abc81fc；错SHA run_83aade7a389e525b；空清单run_5123f877f5816d31；错size run_84143561c29c2026；错hash run_259ae8f99d9cb5d1；重复run_7a755f6512737821；越界run_4e4626edbcf599eb；少文件run_b0667a05b32f4f64；多文件run_80fbc7e86fdbddad。所有归档逐个verify均ok。明细tmp/validator-review-manifest/final-negative-runs.json。

新单测27项含普通文件内容、压缩容器mtime变化不影响A8、包前缀规范化、缺失/候选错/空/size/hash/重复/越界/绝对及drive路径、tar校验和/截断/link/device/nonregular拒绝。只读内存解析不执行解包写盘，解压256MiB上限；PAX path/size处理，稀疏扩展失败关闭。

真实#331评审席macOS清单经新解析器对当时Windows包：208/208 path/size/SHA256一致，结果actual331-comparison.json；它不是0.6.42同候选清单，不移花接木补旧发布的A8。

工程门禁最终默认pnpm verify真exit0：root1456passed/6原skip，layout4，nexus326，tracked dist零diff。采集exit0不是验证PASS；所有正式验证结论以上述CLI run产物为准。

## #152同派单调查交接

P3-b/c已#153、g已#269。P3-d单边seed/minimal名片下同id8读成本机，以及leave后成员位持久化消失，两者当前基线真实HTTP可复现。分别拆#334（未知所有权读法）、#335（历史来源与破坏性清理），给出验收与需裁方向；关闭#152历史汇总表示已拆分，不代表两项已修。未在本PR改画布协议/隐私/consent门。
