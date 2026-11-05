# 第38轮验证器维护（2026-11-05）

请求：用户定时“更新你的验证器”，加载ygl-trees-verify与ygl-trees-lifecycle；本记录是新维护产物，不覆盖旧report/archive。随后监督席direct-94a024de5a1f批准两期迁移方向，要求先设计后编码。

## 实测工具版本与规范

CLI0.120.0，官方npm latest实查0.120.0（本轮14:54Z后再次同值），无需重复安装；0.121正在发布仅通知，未宣称已安装。engine源码只读检查head5df95ab（其工作树有其他会话文档在途，未修改/构建），AGENTS/validator-charter v1.4、META_VERSION1.4/index支持1/2/3，实际contract/corpus1.2。引擎AGENTS示例仍写schema13，而本installed doctor为v12：这是所读源码/已发工具版本边界，未升级/重写数据库求齐，不以文档数字覆盖实测。

self-check显式corpus全6环ok：12canonical vectors、173 corpus files、2 shapes、44case，第二次27archives验链，非skip。engine metaPASS R1/R2/R3/R5a/R6，但**项目根直接metaFAIL R3**，索引仍v1/specs[]。原输出tmp/validator-maintenance-20261105-round38/{self-check,engine-meta,project-meta,doctor}.json；doctor所有实际检查pass，无脏树/孤儿，未添加schedule。self-check不替projectmeta。

## 冻结A8规格维护复跑

未修改材料mat_c73696766f43、spec_5723ba8259bb v1或任何旧快照。用已跟踪0.6.43候选采集器对真实保留证据新采release0643.sqlite，正式run_575ea528321ee610 PASS8/8，A8实际208/208；archive arc_3f5903d1d767验包ok5items，zipSHA256e2fecb2cb7d37e6fa799cfa28941e2c83a6566711f30c5b4406c8b91c9e124b7。lint-candidates8checked/8covered，无schema/coverage跳过。

重跑先前保留的缺reviewer负例快照：run_61ca57a7df8c7ce8 FAIL7/1，archive arc_1628536aa52f验包ok5items，zipSHA256da7938e9f48ffd2b6c5440b56f21dcab180708abb5bcd2703162fe3637683350。没有写脚本改report或用exit0解释FAIL为绿。正/负报告经CLI report另存本轮目录，trace保留构造同作者自检身份。

上述结论**仅限旧冻结规格**：它数采集器ok列，不能据8/8声称“符合charter1.4的P2不判定”或projectmeta准入通过。已向a2a-net评审报告并a2a_report warning report-8848284b上报属主监督面，未借--meta-repo引擎根冒充产品准入。本轮未生产新spec，因为先设计待确认。

## 治理缺口与下一步

1. projectmeta v1空索引/未登记产品脚本，R3FAIL；引擎未精确pin。
2. release/RC collector生产ok/holds等规则判定，递归脚本汇总判定；旧构造meta根不代表consumer合规。
3. 原始tar/key-set/hash等表达需逐项区分：sql-pair exact与key-union已支持hash文本/集合对账；原始安全采集/路径grammar支持仍请求引擎#232澄清，不笼统报不支持。未以临时读码探针当CLI能力证据。

按裁定先提交[两期迁移设计](../design/validator-charter-v14-migration.md)：一期consumer索引/精确pin/只原始测量/新冻结v3保持A1-A8，二期递归退场。设计确认前不改实现，未声称修复meta。引擎issue232已开；本地持久项目a2a-validator-governance(fc6fd79734)、设计任务e3890ee42f跟踪，不把“实施未完成”标done。

## 同轮 A2A 对账

监督席macOS集成PR340@e320605已PASS：1488/3skip总1491，layout4/nexus327，inner0，故意漏rc1entries1，断言失败rc1entries0；外层node-compile-cache边界已留档。结果转原合并链，不修改已审head。#339仍须合并后监督验证器一轮无新增才关，未代合并/代关；M2/M7红叶仍原评审链负责。

本轮只新增维护/迁移文档，不改验证器源码、冻结件或产品，不安装未发布版，不部署生产。
