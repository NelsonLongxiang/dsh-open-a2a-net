# #343 一期冻结前覆盖对账（送全局生产评估，尚未 prepare）

状态：**待精确提交SHA覆盖PASS，禁止prepare**；依据authz-343-phase1 / issue343 comment6662148732 与 direct-686f05bf0fdc 的全局生产评估裁定。ISO时间格式、回环地址、basename、整数四守卫均为既有v2 PASS前提，**全部保留为v3义务**；不可表达处known-gap/NEEDS-MATERIAL，不能删除、降级或改为恒PASS。一期高档单PR，二期不实施。业务义务源为material-artifact-audit-v2.md的A1–A8逐字文本，**不增不减**。下列VU是规划标识，不是已冻结spec；最终形状/数量若改变覆盖，须重交对账，不以构造代码自动确认。

## 公共域（不是新增业务义务）

每次快照写audit_inputs：固定输入slot、实际read_errno、raw字节大小/hash、JSON语法错误文本、JSON根类型；所有被比较的值原文与类型保存。字段NULL不会被伪造为0/空串，input不存在也保留slot。快照是新文件，禁止覆盖。collector不写ok/holds/matched/invalid_count/changed_count/通过布尔；原始枚举序号/计数、IO errno/child exit属测量，但“应几个/该相等/哪些路径禁用”只在spec。各A条款的存在性/类型要求须在其VU内体现，缺测域不能空洞PASS。

known-gap用**缺相应可判定原料→NEEDS-MATERIAL**的真实引擎结果呈现；不创建恒PASS/VU排除，也不写gap=0伪事实。报告伴随固定A→gap映射，不能把NM当PASS。真FAIL（值矛盾/不相等/已有机械反例）与能力缺料分开，v3真FAIL/v2PASS必暂停发布上报；NM不阻断过渡发布但必须附完整结果。

## A1–A8 ↔ 拟新VU

| A与逐字义务 | 拟VU与原始列比较 | 未解覆盖 / 非PASS状态 | #232能力项 |
|---|---|---|---|
| **A1** 发布物证据必须记录可读取 package.json 的完整候选提交 SHA 与有效打包时间。 | A1-I：provenance输入读取/JSON形状及candidate/at字段非NULL；A1-G：实际git show exit=0，解出的package name/version字段及类型存在；A1-S：完整candidate SHA形状；A1-T：ISO带时区+有效时间 | A1-S/T不把JS regex或Date.parse有效布尔当原料；原文有但表达未确定时该子覆盖NM，整A1不得全PASS | #232-2 完整SHA/ISO语法与解析证据表达；#232-1 git/JSON采集方式 |
| **A2** 本地 tgz 实际大小、SHA-1 与 SHA-256 必须同时等于发布物记录。 | A2-I：本地blob与记录输入存在、记录类型；A2-F：provenance.filename为basename且.tgz，目录/绝对路径/上跳不准；A2-B：actual.bytes=recorded.size；A2-H1/H256：actual digest=recorded原文digest（各自sql-pair exact），非NULL必检 | hash文本精确比较已支持，非能力缺口；损坏/缺blob按I/O错误非PASS，不归类“gap”回避真数据错误 | #232-1 安全取数/哈希生产接入；比较本身无缺口 |
| **A3** tgz 必须可枚举且文件数与记录一致，包内名称版本等于候选，且不得包含 pycache、pyc、临时目录或越界路径。 | A3-I：实际tar枚举事件/原始headers与package JSON域存在；A3-C：原始枚举条目数与recorded.files比较（沿v2含目录枚举口径，不偷换成仅regular数）；A3-N/V：archive package.name/version=git object package.name/version；A3-P：每个raw header路径的禁用/越界检查 | 枚举/包内JSON错误须保留offset/type/原始error，不用空表替成功；禁路径与tar解码完整性未解时NM，不只核name/version就PASS。A3不额外扩大为必须与评审清单逐文件一致（那是A8） | #232-1 原始tar/JSON采集；#232-2 path grammar/header/PAX/安全解压证据 |
| **A4** 3081 隔离验收记录必须绑定同一候选与实际 tgz 哈希，验收时间不早于打包，名片版本、隔离 state 与完整工作台 HTML 均通过。 | A4-I：acceptance原文/字段类型；A4-C/H：candidate=provenance、shasum=actual.sha1；A4-R：kind=dsh3081、普通card/state/page各1次、status=200；A4-E：base同一loopback origin且3081端口；A4-V：card/state版本=git package，state.isolated=true、page.html=true/bytes正整数；A4-T：ISO有效且at>=packAt | forwarded=true观察不代替普通端点；base/ISO语法未解为NM；已有值矛盾真FAIL。保留v2“记录HTML bool+正bytes”的范围，不新增网页DOM语义/截图/现场重启动义务 | #232-2 URL/ISO/string结构；其余scalar/count已有 |
| **A5** 独立 serve 验收记录必须绑定同一候选与实际 tgz 哈希，验收时间不早于打包，名片版本、隔离 state 与完整工作台 HTML 均通过。 | A5-I/C/H/R/E/V/T同A4，仅kind=cleanServe、loopback不限制3081端口 | 不拿3081行补serve域；不新增特定依赖版本业务判据。缺serve字段是真缺测非PASS，不因A4绿消掉A5 | 同A4 |
| **A6** npmjs 下载回读包的实际双哈希必须与本地验收 tgz 一致，记录的版本、大小及双哈希必须与下载包一致。 | A6-I：npmjs实际download文件及readback JSON域；A6-H1/H256：download实际digest=local actual digest；A6-MV/MB/MH：元数据version=候选、bytes=实际download、recorded双hash=actual digest；A6-T：readback记录有效时间（沿v2） | 无下载文件是缺测而非复制local；hash文本比较已有；ISO字段未解NM，错hash/size/版本真FAIL。元数据tarballURL源审计只留原文，不新增原A6未要求的访问入口限制 | #232-1 下载后取数；#232-2 ISO结构；比较无缺口 |
| **A7** Gitea 下载回读包的实际双哈希必须与本地验收 tgz 一致。 | A7-I：mirror实际blob域；A7-H1/H256：actual download digest=local actual digest | 不新增Gitea元数据/时间/版本判据；没有记录也不能假造同包回读。I/O错误/缺测非PASS，真实digest不等为FAIL | #232-1；hash比较已有 |
| **A8** 必须存在评审席提供的非空包内清单，清单候选 SHA 与发布候选相同；发布 tgz 的普通文件路径集合、每项字节大小和 SHA-256 必须与清单逐项完全相等，缺清单、重复或越界路径、非普通文件、缺项、多项或任一差异均失败；不比较 tgz 容器元数据。 | A8-I：独立manifest输入/envelope字段类型、files数组非空；A8-C：manifest.sha=provenance候选；A8-K：reviewer与actual按文件key并集完整对齐且重复键拒绝；A8-B/H：逐key size/hash exact；A8-P/F：原始manifest raw_path/ordinal/size/type/hash形状与所有tar header path/type规范；A8-Z：size为非负安全整数，不把string/float/overflow转作合法大小 | 单package/前缀可规范化，但raw序号/路径必须保留以判重复/非法，不先Map吞掉；P/F未解NM不抹掉；非普通类型按A8不准当普通文件。容器mtime/uid/gzip差异不比较。身份真实性仍协作交付审计，不增加“清单自签名证明身份”义务 | #232-1 原始归档输入；#232-2 路径/类型/摘要文本shape；keyunion/hash比较已有 |

**VU预计约40–60个机械子单元**（可表达路径与类型的引擎方案尚未确认，暂不捏造精确冻结数量）。每个VU在候选文件里必须携带对应A逐字source_clause；单条A拆多VU不是新增业务判据，缺任一覆盖不得称A通过。最终准备表将逐个列真实id/where/scan/null/重复/空洞规则，必须在prepare前再交具体定稿表。本表是先行义务对账，尚不请求绕过条件②提前prepare。

## 缺口与语义风险单列（需明确复核）

1. #232目前无回复；0.120未提供raw归档/语法闭集落地承诺。保留known-gap/NM，不用command checker、手写SQL或自定义bool规避。若引擎可用现有原语，应先CLI最小lint/prepare/run证明，不凭读码假判可表达。
2. 已裁保留全部四守卫：ISO/有效时间→A1-T/A4-T/A5-T/A6-T；loopback/http/同origin（3081端口要求只在A4）→A4-E/A5-E；basename.tgz→A2-F（阻止从记录任意路径取包，同时作为A1所指发布物定位）；整数/安全范围→A4-V/A5-V的page.bytes与A8-Z等旧v2已有字段。它们在v2机制中已决定PASS，删除即放宽，故不再作为“是否保留”的开放问题。basename义务同时关联A1/A2，不是新加第九条。表达未具备前相应VU为NM/非PASS，挂#232-2；base同origin与所有原v2实现守卫亦维持原口径。
3. old tar枚举计数与A8 regular文件计数有意分开；新v3不能用同一个计数列偷换历史A3语义。采集实值必须携原始工具/类型口径，不以数据归一化改义务。
4. 缺测FAIL/NM与真FAIL区别以引擎正式run为准；不能把普通反例失败重命名known-gap。v2 PASS/v3真FAIL→暂停发布→上报全局生产评估，M2/M7仍原评审链。

## 转报门

请原评审将本表的**精确GitHub提交SHA**转全局生产评估取得覆盖PASS。四守卫保留裁定已生效，但不是该SHA覆盖表已PASS；取得后若最终真实VU形状/数量/义务覆盖变更须再报，不可自认许可prepare。当前无v3材料冻结、无v3规格、无v3PASS结论；旧v2作为过渡发布门及历史成品完全保留。覆盖确认不自动豁免项目根meta真实FAIL，高档实施PR仍需非作者精确头PASS。
