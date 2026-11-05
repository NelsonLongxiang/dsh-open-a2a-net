# ADR：验证器 consumer 治理与原始测量迁移（第38轮）

状态：**设计待确认，不含实施授权**。依据 direct-94a024de5a1f；一期一PR，二期另PR。不混#338/#339/PR340，不代裁舰队M2/M7。基线e6c9163；已发布0.6.43的历史结论不重写。

## 上下文

最新已读取规范为ygl-trees validator-charter v1.4、meta规则1.4/索引3，现行contract1.2。第38轮实测CLI与npm latest均0.120.0；0.121正在发版的通知不是已发布实测，不预装未公开版本。升级应精确钉已发布版本，保留可复核工具链。

项目verify/meta.json仍v1/specs[]，直接project-root verify meta为FAIL R3；引擎自身PASS不能替代项目准入。release collector生成name/ok/detail，现有AST数ok=1；RC探针还生成holds，recursive脚本驱动并汇总结果。跟踪过的代码不等于已遵守“编排不判定”。

旧A1-A8已冻结，构造入口历史用--meta-repo引擎根取得的是该根meta结果，不是产品仓全面合规。新run/archive消费已冻结规格合法，但新维护报告必须明示旧规格语义与项目meta失败分开，不把8/8当charter准入PASS。

## 决策

### 一期：独立一个迁移PR，确认后才编码

1. **consumer准入**：索引升meta_index_version:3/kind:consumer；按实施时已发布稳定版精确pin ygl-trees（当前候选0.120.0），与lockfile一致。具名产品source_roots只声明真实产品源码根（如src与nexus-stage/src），不能用它遮住验证驱动/整个verify目录。assets、cli、lib等产品文件按真实角色逐件登记tooling哈希；根配置、产品门禁、测试与采集也逐文件分类登记，不用通配豁免。生成lib受gitignore时与tracked源码区别说明，不为过门临时取消ignore。
2. **登记不是改目录求绿**：不自动rehash漂移条目；重登记按规范CLI显式reason/append-only审计。consumer不得借invoke驱动run/prepare/submit/archive（R6⑥）；不能把verify-recursive简单登记成普通tooling过关。新的collect只生产原始数据，不调用引擎API、不判定、不写整体status。可用采集接入受引擎#232边界确认约束，缺能力不能假完成。
3. **采集只含原始测量**：删除新管线的ok/holds/changed/invalid/符合标准布尔；不把它们换名成observed_ok。输入错误记录path/read_errno/JSON解析异常/原始类型字段；缺测值NULL并保留该输入域，不伪造0、空串、假hash或删掉整行。原始结构、观察值与记录自报值分表/分列；允许可追溯的提取、哈希计算、时间规范化，但其生产方式必须经批准的采集体系，不能暗藏比较。解码异常须有原始offset/异常证据，安全解压边界仍需明确CLI路径。
4. **新材料/新v3规格**：A1-A8业务判据逐字保留，八项义务不增不减；去除材料内旧“ok事实”机制描述，换成原始测量与判定边界后重新submit。构造候选与独立reviews、lint/prepare、schema/as-of冻结，正式run+archive。可拆成多个机械VU共同覆盖同一A条款，仍须逐条覆盖；绝不以只实现部分A8就当该条完成。任何需要增删业务判据的变化另列交评审。
5. **保留历史**：旧material/spec/snapshot/report/archive不编辑、不覆盖；新表与新输出目录/文件名版本化。v1/v2旧入口只作显式legacy回放，不再冒充新管线合规。新管线不得静默回落旧ok表，未迁完时整体不宣称准入或全PASS。

### 原始测量模型与逐项表达对账

键一律来自原始输入定位，先保留raw path/序号，避免规范化把非法或重复输入丢失。每个域有固定来源标识和读取事件，缺域不会因空表省略必检。提取presence是原始观察；规则要求哪些必检域/行数在spec中，不写入采集器。

| 原判据 | 拟原始数据（示意列） | AST判定与缺口 |
|---|---|---|
| A1 SHA对象、package身份、打包时间 | evidence_input(path,read_errno,json_type)、provenance(candidate_text,pack_at_text)、git_object(requested_sha,exit_code,pkg_name,pkg_version)、时间原文/明确epoch | 存在/读取exit、非空与同列比较可用count/exists/sql；完整SHA语法/ISO有效性不能靠collector boolean，需现有CLI表达或#232确认；未解部分非PASS |
| A2 tgz大小、双hash等记录 | artifact_actual(kind,bytes,sha1,sha256)、artifact_recorded对应原字段，保持两侧独立 | sql-pair按kind精确比较size/hash，或同一事实行两列value:{col}；缺测/NULL必须先必检，不能null-equal通过 |
| A3包清单/数目/名称版本/禁用路径 | archive_headers(ordinal,raw_name,typeflag,size,offset,checksum原值)、archive_payload(path,bytes,hash)、package_json原字段、recorded_count | count与count.against、scalar比较已有；路径语法、header/checksum/截断/PAX等解码/取证表达见#232，未获能力不藏ok/预算bad_count |
| A4 3081验收 | acceptance_raw(kind,ordinal,base,path,status,version,isolated,html,bytes,candidate,hash,at_text)、解析原始类型/错误 | 精确数量、版本/hash/状态/隔离、时间顺序可用sql/count/列对列；loopback URL及ISO结构表达待CLI/AST确认，不增加新HTTP重探义务 |
| A5独立serve验收 | 同A4、kind不同 | 同上，不把构造fixture冒充实际serve观察 |
| A6 npmjs回读 | downloaded_blob(registry,bytes,sha1,sha256)、download_recorded(version,bytes,sha1,sha256,at_text)、本地artifact独立行 | 已采集hash文本比较可用sql-pair exact/列对列，不是缺口；格式/读取/时间缺测门同A1，actual来自真实下载而非复制本地 |
| A7 Gitea回读 | downloaded_blob的Gitea行、本地artifact行 | 同A6，保持旧义务范围，不新增Gitea元数据判据 |
| A8同候选reviewer包文件身份 | reviewer_envelope(sha,platform原文)、reviewer_rows(ordinal,raw_path,bytes,sha256)、archive_payload对应原行 | sql-pair按path键并集、size/hash exact及重复键拒绝已存在；不能笼统说hash/集合比较做不到。真实tar原始读取、路径规范化/grammar/非普通成员和空输入还需安全采集/语法能力确认。raw ordinal保重复，不能先Map去重 |

missing-case必须经prepare红队与正式CLI run证明非PASS：缺输入域、NULL、空表/空清单、错SHA、类型错误、只剩一端path、重复键、错size/hash、畸形路径/文件类型、截断/孤悬PAX。读取失败可过程ERROR，但“缺证据”叶至少FAIL/NEEDS-MATERIAL，绝不PASS；不得通过except/隐藏字段把不可表达条款排出断言集合。具体叶数与五类checker配合由P0-P5确认后冻结。

**已知能力边界**：[引擎#232](https://github.com/NelsonLongxiang/ygl-trees/issues/232)请求原始archive采集、path grammar/解码证据支持。现predicate无regex表达式/任意SQL；file checker能比较静态附件hash，不等于动态tgz清单。上述是设计读码勘察，未提供新prepare拒绝case，不能把它当正式能力失败产物。实施前先用CLI最小prepare/run探针确认可用方案；若仍不能表达，则对应条款记已知缺口/non-PASS，先交能力裁定，不以新版本默认具备能力为假设。hash文本相等与两表key-union无需新特权，应优先复用。

### 二期：递归编排退场

停止自定义layers/ok总判定，改为引擎verify tree run或正式组执行，子run与archive引用由引擎后序生产。兼容目标/版本/归档hash/同轮次与source-root provenance规则由冻结树材料表达。引擎未能代替的步骤只保留经过治理确认的CLI调用（不汇总overall、不做if-PASS裁判）；consumer中驱动verifier的编排放置/登记须符合R6，不把“只invoke”偷作豁免。能力限制已请求引擎裁定，必要时由宿主命令手工顺序调用而不生产第二层结论。二期不阻塞一期原始表设计，但新项目meta PASS要求先处理所有现存驱动文件，不能说二期未做却忽略当前准入红。

### 实施顺序与验收

1. 先确认本设计及#232回复，明确consumer采集/驱动归属；若一期与二期现存文件准入相互阻塞，先裁可接受退役/迁移方式，不降索引版本求绿。
2. 一期PR只改治理索引/pin/原始collector和新v3材料/规格生产入口、固定原料/自检；旧成品不可改。正例与每条缺陷CLI run归档、缺证据非PASS、同一事实跨机复跑。
3. 项目**根目录**直接verify meta必须PASS，不能--meta-repo引擎根或--no-meta；空索引只说明无仓内spec文件，不能证明历史外部workspace规格已获项目准入。
4. 断言覆盖与v2语义逐项对账，8条义务全保持。工程tests/types/docs与产品默认门禁仍独立完成；这些不替代规范run。独立评审后方可推广；新材料尚未prepare就不得声称v3已存在。
5. 精确工具版本、官方latest查询时点、lock digest、运行报告、archive identity与元闸输出留本轮记录，doctor/brief保持持久任务状态；不新增定时任务。

## 后果

优点：真实测量与判据分离、同项目准入可核、缺能力不被ok遮蔽。代价：现有产品/验证混合仓登记繁琐，采集/字符串结构能力不齐可能暂停新v3全PASS；旧v2数值绿不能消除治理差距。旧发布按当时冻结规格的事实结果保留，但此记录明确收窄其合规承诺。

本PR仅文档，不改meta/pin/collector/spec，也不消除project meta FAIL。实施需评审确认；M2/M7仍归a2a-net评审链，生产与凭据/跨机presence不动。
