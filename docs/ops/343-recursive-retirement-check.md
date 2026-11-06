# #343 递归驱动退场实施验收（未获合并授权）

授权direct-2b4fd364b1da，设计/操作清单精确e09761e9f74c59c7c4af98bd2bbe3f64ffddb8ae已PASS；独立分支基于该SHA。**只实施和开高档PR，不合并**。合并仍待五门逐门上报与.88/.43确认。正式v3材料/规格未冻结，本次meta准入通过不替代最终VU表精确SHA PASS和#232。

## 实际diff与批准清单逐项对账

| 操作 | 实际路径 | 与批准清单一致 |
|---|---|---|
| D（唯一删除） | scripts/verify-recursive.mjs | 是；删除115行自判汇总驱动，含latest-zip选档；不移动、不留可执行副本 |
| M | AGENTS.md | 仅验证器家族递归入口改为三份同候选CLI产物；五铁律正文未改 |
| M | docs/validator.md | 直接CLI/唯一submission/精确当前run归档、三产物缺一不可；旧结论保留历史时态；不借meta根 |
| M | src/skill/references/router.md | 唯一submission绑定提示迁到直接CLI，不回落固定TEMP目录 |
| M | tests/unit/verify-submission.spec.ts | 前两例行为保留，第三例从读旧脚本迁为新指引绑定/三产物检查，仍3例，不删断言面求绿 |
| M | verify/meta.json | 只更新该测试hash+追加一条reregister reason/actor，原锚链保留；没有假注册旧递归脚本 |
| A（唯一新增） | docs/ops/343-recursive-retirement-check.md | 本验收记录 |

移动0；tracked总计D1/M5/A1。不改.gitattributes、package.json、.gitignore、probe/collector/helper/S层脚本，旧v2材料/candidates/reviews/spec/run/archive不改。产品构建正常再生gitignored lib/skill镜像，tracked dist零差异。出现本清单外tracked修改必须停报，不在本PR顺手扩范围。

## v2门不断：真实0.6.43复跑与逐VU比较

使用原发布候选490809b48817330201638b3831b3b8f285daa5f0的原留存目录tmp/release-0.6.43-490809b，不用probe-only实验树。包与原记录SHA1=332a84d1d9cb43dcb91dd3271d0c454dbb6a81a5，SHA256=a94bf3ed71fda27cd00010f0eb51e710e94a88dd96433f2af9824f223a655aff。

退场后现行原项目路径：未改的scripts/verify-probe.mjs --release-audit真实留存目录 --out全新tmp/343-retirement-acceptance/audit-0643.sqlite，直接本项目精确pin0.120 CLI verify run既有spec_5723ba8259bb。新正式run_153f3b9e65adafdb **PASS8/8**；不重prepare旧规格、不覆盖旧snapshot、没有借--meta-repo/--no-meta。

| VU/义务 | 原run_485bcba5a6e68286 | 新run_153f3b9e65adafdb | clause/checker/witness/evidence |
|---|---|---|---|
| V1/A1候选身份 | PASS | PASS | 逐字段完全一致 |
| V2/A2包大小双hash | PASS | PASS | 逐字段完全一致 |
| V3/A3清单/版本/路径 | PASS | PASS | 逐字段完全一致 |
| V4/A4 3081验收 | PASS | PASS | 逐字段完全一致 |
| V5/A5 serve验收 | PASS | PASS | 逐字段完全一致 |
| V6/A6 npmjs回读 | PASS | PASS | 逐字段完全一致 |
| V7/A7 Gitea回读 | PASS | PASS | 逐字段完全一致 |
| V8/A8独立包文件清单 | PASS | PASS | 逐字段完全一致 |

CLI原报告原样存tmp/343-retirement-acceptance/{original-report,new-report}.json，对比清单per-vu-comparison.json仅是两个正式CLI产物的工程对账，不另造spec verdict。每项witness rows_scanned8/rows_matched1、table8行、schema指纹与evidence count均一致，报告run_id/时点等身份字段不要求同一。

新archive arc_f7985520c635验包ok/5items，zipSHA2564f61e5feb3304733b9ac4d2be804206e98a0f5312065eee92c4a81ef9ee79d47。原archive arc_0da46bc9e205验包ok/5items，旧zipSHA256仍ff43c64854fceb7b761ed23e9e69e5bb9d684dda1ad4710871b926e7befe0293，不改字节。两份CLI archive verify问题/告警均0，原文new-archive-check.json/original-archive-check.json。

## 项目根meta与工程门禁

物理删除后**尚未stage**时meta按git tracked列表仍报原R3，保留这一过程观察，不倒写成当时PASS。窄stage唯一删除后，本项目根直接YGL_HOME正式工作区+pnpm exec ygl-trees verify meta . --json：**meta1.4、index3 consumer，R1/R2/R3/R5a/R6全部PASS，243tooling/3source_roots/pin0.120.0**。真实输出tmp/343-retirement-acceptance/project-meta.json；没有中立目录/改source_roots藏文件或登记tooling遮R3。

测试hash变更逐项官方meta-tooling reregister，actor=dsh/f49961b0、reason指批准e09761e清单和第三例迁移，原350条审计不动；登记check243/0drift。默认完整pnpm verify真实exit0（job bash-c4a5062c2a084031）：root1489passed/6原skip、layout4、nexus327、innerentries0、tracked dist零diff。定向submission3例通过，未改worker/timeout/skip。工程门禁不是v2/v3规范判定；本轮不宣称新v3存在或完整RC候选链通过。

## .127/.156本机调用核查与远端硬门

本会话A2A origin=100.75.181.127，本机Get-NetIPAddress同见LAN192.168.3.156/Tailscale127，满足属地核查。原始记录均位于tmp/343-retirement-acceptance/，只读且未停改任务：

- Windows Get-ScheduledTask共191tasks/193actions，Execute/Arguments/WorkingDirectory搜索目标脚本、summary、a2a仓、ygl/fleet关键字无相关动作；windows-scheduled-actions.json留原输出。
- DSH schedule_list本机0；治理独立YGL_HOME job list0。**默认用户YGL库不是空**：75jobs/启用25，SQL只读command列中目标脚本/summary精确引用0（user-job-audit.json）。若干历史“递归”标题实际是supervisor采集+CLI旧spec，不当目标调用、不顺手修改；不以标题猜无引用。
- Claude scheduled-tasks目录不存在；Git Bash没有crontab可执行与常见cron路径。用户目录泛glob曾超时，未冒称全用户HOME完成穷举；默认CLI不支持job show，用PRAGMA schema+SELECT替代，只读不执行job。
- WSL列表为Ubuntu-22.04/docker-desktop，原来均Running；分别--exec crontab -l返回0：Ubuntu为expert-teams通用启动/恢复/备份/清理与ops-investigate条目，docker为标准run-parts；未见目标script/summary直接引用。只列当前用户crontab，未递归审查所有间接脚本或其他Linux用户，wsl-observation.json记范围；没有启动停用/修改发行版或调度。

全局经direct-e14c85661684已裁**.127门PASS**，接受上述直接入口边界：没查到的间接调用可能报错暴露，可从旧git blob恢复；该风险接受不是“证明所有间接/未知HOME都无调用”。已向原评审补报WSL结果。

其他两席本机fleet/net/team/frontend/market验证器编排与cron/LaunchAgents/scheduled-tasks无直接执行或summary消费（原只读回执已列设计）；tracked.json清单会自然少旧脚本一行，不改冻结H1/H2。M2/M7判freshness/currentcommit，与脚本无直接依赖，不因此消红。

**.88/.43仍待属主看板第13项，合并硬门未闭**。不代替其确认，不跨机presence/改服务，不因本机PASS自行合并。

## 历史回放与当前三产物

旧驱动源码按490809b或bb481b9的git blob5dcc5238d73b28543bca51ec81a612cc1bc840cd只读查阅，当前脚本不保留可执行legacy副本。旧run/report/archive原字节不动；CLI archive verify复核，不对正式目录重跑会写summary的旧脚本。原ignored recursive-summary留原处，不移动删除。RC三份CLI产物（self-check、RC report、该run archive verify）缺一不可，需同候选SHA/引擎/证据目录显式绑定；树能力未齐不伪称tree已存在。

本次是0.6.43留存v2门连续性，不是把已发布候选当未发布RC候选，也未交付新的完整RC三件套，不能混为发布前RC PASS。任何probe-only实验的spec/run/report/archive均未引用作本PR、发布或准入证据。

## 五道合并门状态（仍未获合并授权）

1. 高档非作者精确实施head PASS：待评审。
2. 490809b v2逐8VU与原8/8：新正式run已完成，待独立复验。
3. 原发布归档复核：CLI验包已通过，待评审认收。
4. 项目根meta真实结果：本机直接PASS已贴，待精确提交后复验。
5. 实际删除/修改/新增清单逐项：本表与diff送全局核对，未以作者检查代放行。

push前原远端13分支超限已停推，评审经全局授权删除7条，本席读回现6；新增实施分支后预期7，提交前后会再次读回。未碰来历不明远端分支，保留一期含509145d祖先链。仅获实施/开PR授权，所有合并仍等待上述五门及.88/.43硬确认。
