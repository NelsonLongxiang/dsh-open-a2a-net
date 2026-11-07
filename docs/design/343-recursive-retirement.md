# ADR：#343 递归驱动退场提前（仅设计，未获实施授权）

状态：**设计待全局生产评估确认；不删除、不移动、不修改入口**。授权direct-1d07385faccf仅设计；基线一期ffc156a97a3f6ab91899a182684e2c3b83ab3d47，调查代码bb481b9与已发布候选490809b中递归脚本的git blob均为5dcc5238d73b28543bca51ec81a612cc1bc840cd。实施前须对本设计的精确SHA及删除/移动清单另行放行，不把本PR合并当实施授权。

## 上下文

一期项目根meta仍R3FAIL，唯一点名scripts/verify-recursive.mjs。将它登记为tooling或挪入source_root/tmp以求绿都不是退场。本设计只处理该驱动及必要调用入口，不扩大到完整二期、新判据、舰队M2/M7或生产部署。退场不免除v3最终VU表精确SHA PASS和#232能力确认两道门。

### 1. 脚本实际做什么

| 职能/位置 | 实际行为 | 风险与处理 |
|---|---|---|
| 配置L21–26、29–36 | 默认邻仓引擎bin、tmp/ygl-verify、RC spec_bdf9df9d3851；spawnSync执行CLI，解析JSON | 不精确绑定当前consumer依赖；新路径只用本项目pin CLI与显式workspace/spec |
| L41–54 | verify self-check --corpus，按items/status计ok/skip/fail并形成layer.ok | 自检由CLI正式输出承担，不再二次计算“层PASS”；缺corpus照CLI实际显示，不自动把skip当合格 |
| --fresh L56–65 | 先执行scripts/verify-probe.mjs（默认RC采集），非release-audit参数；子命令非零后拼summary并退出 | 这是递归脚本对probe的出边，不是probe依赖recursive。退场不删除probe，不把fresh隐式步骤丢掉：RC使用者手动显式先采集 |
| L67–85 | 读取verify/snapshot.sqlite与probe-summary；submissionFromProbe核本轮HEAD/路径，CLI run默认15VU RC规格并传--submission；overall===PASS才layer.ok | 此处不是A1–A8 release-audit门。绑定逻辑需保留到新RC入口，不准用旧固定目录兜底；RC手工步骤与helper单元测试继续 |
| L87–105 | archives目录按文件名字典排序取最后zip，archive verify，然后看ok | 不是按本次run返回精确archive，可能验到其他规格。新流程只验当前CLI返回的明确archive路径，不用latest选择 |
| L107–115 | layers.every(ok)→summary.ok、写recursive-summary.json、总rc | 自定义聚合判定退场；唯一聚合转engine tree/group，不再自写overall或从FAIL/NEEDS-MATERIAL计算“绿” |

### 2. v2（A1–A8过渡门）是否依赖它：具体调用点

**不直接依赖**，由代码调用边而非名字相似推断：

1. scripts/verify-probe.mjs L34–51的--release-audit分支，直接import collectReleaseArtifactFacts（scripts/verify-release-artifact.mjs），写新的release_artifact_facts后process.exit(0)。不会进入默认RC采集，也不调用verify-recursive或submissionFromProbe。
2. collector A1–A8只读取真实tgz/git candidate/acceptance/双仓readback/reviewer清单；A8调用release-file-manifest.mjs。无recursive import/exec/summary读取。旧三个材料/候选/reviews不引用recursive-summary。
3. 操作链为release-audit采集→本项目pin CLI verify run spec_5723ba8259bb --db NEW.sqlite→CLI report与明确返回archive verify。0.6.43原正式run_485bcba5a6e68286为8/8；该链本次设计未重跑，不冒称退场后已复验。
4. package.json scripts L78–92没有verify-recursive入口；pnpm verify是产品工程gate，不执行业务v2 run。test全量包含verify-submission.spec对脚本源码的断言，是**测试依赖**，删除时必须改，不等于v2运行依赖。
5. AGENTS入口及docs标准三件套可使人/agent走旧脚本，是操作文档调用方，要同实施PR修正。src/skill/references/router.md含旧调用路径说明，随实施更新；其构建产物lib/skill镜像由既有build生成，不改历史发布包。

## 决策

### 3. 每项职能由谁接替

- **业务v2门维持原链**：collector与spec_5723ba8259bb原件不改、旧snapshot/run/archive保留；CLI直接运行。它不必为了删除旧RC驱动而改判据或prepare新v2。v3只并行，真FAIL/v2PASS暂停发布报全局的规则保持。
- **候选RC判定/提交树绑定**：保留verify-probe与verify-submission。由人工/agent按文档显式调用采集、核当前HEAD+唯一submission，然后直接CLI verify run现行已准入RC规格；不新增驱动JS、不在consumer登记invoke来绕R6。若helper需CLI化，先报引擎能力/审阅范围，不临时把helper.ok作为新规格的最终判据。
- **组/树聚合目标**：engine verify tree run是首选，所有叶明确spec版本、repo/commit、target、数据源与archive引用，由引擎后序生产report/archive。不得把self-check/档案验证的JSON先JS汇总成ok再包树。现0.120对RC的file submission传递以及self-check/archive-check如何作为原生树叶还未确认；设计不编造tree id或承诺新树已可用，依附#232/后续引擎答复。正式树材料另经批准的构造面生产。
- **暂不能纳入树的自检/归档职能**：直接独立CLI self-check与archive verify，输出各自原始结果，不再生产“六环+候选+归档总体绿”JS摘要。暂时没有“总体结论”，就如实多份CLI产物，不能将少一份折成PASS。不新造跨库/跨target伪同源树。若有调用编排，只允许受审的逐条CLI调用、不汇总、不判定；consumer R6对驱动禁用的限制仍适用，最小退场方案不新增这种脚本。
- **RC证据链①**：最终改为正式tree report+archive引用；树能力未齐时明确列出独立self-check、RC run report、该run archive verify三份CLI产物与同候选绑定，不把临时多份输出称作已完成的tree run。原docs“recursive-summary不可缺”的要求需改为“CLI产物不可缺”，这个操作格式变化随退场设计一起请求全局批准，不变更A1–A8业务判据。

### 4. 调用方清单与处置（搜索不是全局不存在证明）

| 位置/调查范围 | 依赖性质 | 拟处置/确认状态 |
|---|---|---|
| AGENTS.md:16 | agent推荐入口 | 实施PR同改为CLI self-check/tree/精确archive入口，删除对退场脚本的当前执行推荐；五铁律原文不改 |
| docs/validator.md:117–141及关联现行说明 | 人工入口/RC证据链① | 改为新CLI逐步链及tree目标；旧历史run与旧命令加历史标签，不重写既有结论；移除借引擎--meta-repo求产品绿的当前建议，原历史使用事实仍保留 |
| src/skill/references/router.md:90 | agent提示唯一submission绑定 | 改为直接CLI RC路径继续唯一导出绑定，不能改回固定TEMP目录；同实施build复制派生lib，不改旧包 |
| tests/unit/verify-submission.spec.ts:51–55 | 直接read旧脚本源码 | 前两例行为测试保留；第三例改为检查新文档/入口的唯一submission约束及无固定目录回退，不把删除断言当补测试；若新增机器入口须另列文件清单 |
| scripts/verify-probe.mjs | 被--fresh调用，而非上游调用者 | **保留原文件、不移动、不改v2分支**；文档保留先采后run的RC操作顺序 |
| scripts/verify-submission.mjs | 被旧脚本调用的绑定helper | 保留及测试，不在退场时顺手删除；retirement不改变旧snapshot绑定口径 |
| package.json scripts与.github | 本机已读scripts无入口；.github仅PR模板无调用 | 不改scripts/CI；将来发现新引用重新报清单，不能称所有历史外部调用不存在 |
| .gitignore:32 | 忽略旧再生产物 | 保留verify/recursive-summary.json ignore，避免历史产物意外进仓；不删除或改写现存本地summary |
| docs/design/validator-charter-v14-migration.md:18、ops343历史记录 | 历史治理缺口说明 | 原文保留历史语境；新退场记录引用它，不重写当时R3事实 |
| scripts/supervisor-snapshot.mjs | 搜索无recursive引用；自有S层采集/判据 | 不动；其他治理问题另单，不能扩大退场范围 |
| DSH schedule_list本机/当前隔离YGL_HOME job list | 可见列表均0 | 无本机可见任务可改，不据此推断全机/远端/所有workspace无调度 |
| 监督席本机fleet及A2A检查（direct-de597aa84ee0） | ygl-fleet-verifier、a2a-net-verifier、a2a-frontend-verifier、workbench-market-review-verifier编排无执行或summary消费；fleet M2/M7是freshness/currentcommit叶 | 无脚本替代工作；M2/M7继续归原a2a-net评审链，不因删脚本消红 |
| a2a-net评审席本机检查（direct-4eab583788ca） | net/team/frontend编排、scheduled-tasks review-cycle/team-cycle/frontend-hourly、crontab/LaunchAgents零执行消费引用；仅collected测试名/outbox历史审计/文件清单命中 | 不改验证器规格/任务。a2a-net tracked.json当前489行中有旧脚本1行，删除后下一轮重采少1；spec_5a3f8e476a18 H1/H2未点名旧脚本，不改冻结规格来追清单 |
| .88/.43/.127远端cron/job/巡检与未知个人workspace | 监督/评审席目前不可见 | **待确认，实施合并前owner答复**；未停用/删除/改调度。已由原评审转属地核查，本席不跨机presence/执行 |

### 5. v2不断门的实施前后验收（现在只设计，未执行）

实施PR合并前必须在**最近已发布候选490809b48817330201638b3831b3b8f285daa5f0**的原保留证据上，用退场后的原项目路径：

1. 确认tgz/reviewer/两readback字节仍是0.6.43原验收记录，读候选git对象；不从probe-only树拷数据、不重打新包伪造原发布。
2. 用未改的scripts/verify-probe.mjs --release-audit <0.6.43留存目录> --out <全新retirement-0643.sqlite>采集，不能覆盖audit-final.sqlite/旧run。采集exit0非判定。
3. 用本项目pin CLI和正式业务workspace运行spec_5723ba8259bb --db新快照，获得新run/report/archive；与run_485bcba5a6e68286的8个单元逐项映射、scope/witness与8/8一致，不只比overall字符串。
4. archive verify新归档，并复核原run_485bcba5a6e68286旧归档仍可验；若结果不足8/8、字段/原料丢失、错候选或依赖仍指旧脚本，**不合并**。原spec/id不改，不用--meta-repo/--no-meta；run/archive消费已冻结规格不借此证明新construct准入。
5. 工程门禁typecheck/docs/build/unit/layout/nexus全跑，第三个源码绑定测试按新入口迁移，不能简单删失败测试。项目根meta实测须写明消除了哪一R3，不将剩红隐藏；若新错误出现先返工/报裁。

### 6. 历史可复核、legacy只读回放

- 删除当前入口不会修改任何旧archive内部字节。历史报告规范性复核首选CLI archive verify，保留material/spec/report/snapshot/附件原hash；逐项原archive id与zip SHA核对，不能重生成后覆盖。
- 旧脚本源码由git精确对象保留：490809b与bb481b9下blob相同5dcc5238d73b28543bca51ec81a612cc1bc840cd，最后源码变更commit f63aa918ee0bfc9c4c1b1f693ddd3ed866aebdb3。可用git show精确SHA:path只读查看，或git archive精确旧候选至ignored隔离目录；无clone/worktree/stash、不checkout当前共享树回退。
- “legacy只读回放”指**读旧归档/报告并验链**，不是直接重跑旧脚本：旧脚本会写recursive-summary且可能fresh采集，故不得对正式证据目录执行。若需重演执行流程，先单独批准隔离workspace与复制快照，结果标历史实验、不覆盖旧成品、不当当前候选PASS。
- verify/recursive-summary.json旧再生产物保持原字节与ignore，不迁移为新树证据，不删本地历史目录。scope相同与时序同源必须由新run显式绑定，不能“最新zip”代历史正确来源。

### 7. 精确删除、移动、修改清单（实施必须再次按本表报批）

**拟删除文件恰1个**：scripts/verify-recursive.mjs。

**拟移动文件：0个**。尤其不挪到tmp、legacy、src或source_roots；不造可执行legacy副本规避meta。

**拟修改tracked文件恰5个**：

1. AGENTS.md：仅验证器家族中递归入口说明；不得改五铁律正文。
2. docs/validator.md：现行递归/RC证据操作指引和元闸借根建议改为新合法流程，历史事实加清晰时态，不改旧冻结材料。
3. src/skill/references/router.md：唯一submission约束的新入口说明。
4. tests/unit/verify-submission.spec.ts：第三例绑定断言迁移，保留前两例保护。
5. verify/meta.json：仅对修改的该测试逐项reregister附reason/actor、沿原锚链追加；删除文件本来未登记，不制造假“移除登记”条目。若实际新驱动/新树必须新增文件，**本清单不授权**，需单独报全局后扩清单。

**拟新增tracked文件**：实施结果只新增docs/ops/343-recursive-retirement-check.md一份审计记录（正式新v2 run/归档指针、meta与远端确认、精确source）；不新增驱动脚本/正式树材料直到能力方案另批。

**明确不删除/移动/修改**：verify-probe.mjs、verify-release-artifact.mjs、release-file-manifest.mjs、verify-submission.mjs、supervisor-snapshot.mjs、package.json scripts、.gitignore、v2材料/候选/reviews/spec及所有旧run/archive/snapshot、远端cron/job配置。lib/skill镜像为gitignored构建结果，可正常build再生，不直接编辑/提交；若出现tracked构建物差异须暂停并扩清单申请。

### 8. 设计与实施分步门

本设计精确SHA→原评审转全局评估→批准范围后才能提交删除/移动实施。远端调用确认与tree能力不足须先如实记录；不假装已有tree替代PASS。实施PR高档、非作者精确head PASS、v2对齐490809b原8/8及旧归档复核、根meta真实输出才可合。只清R3仍不授权v3冻结，最终VU定稿表精确SHA与#232另门不变。

## 后果

正面：去掉consumer自判汇总与latest归档选择，保留v2连续性和历史可验证性。代价：树的self-check/附件入口能力未齐时没有单一三层summary，必须提交独立CLI产物并明示未聚合；远端任务调查未齐可阻止实施，不能为赶一期求绿。推迟项：完整二期树/组规格、能力原语、M2/M7与其他collector判定列治理均不在本设计实施清单内；生产部署/调度更改/跨机presence均不授权。
