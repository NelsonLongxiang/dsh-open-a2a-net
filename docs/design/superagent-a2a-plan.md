# superagent × a2a-net 实施计划（草案）

配套 [接入规格](superagent-a2a-spec.md)、[ADR](superagent-a2a-adr.md)、[断言与证据](superagent-a2a-evidence.md)。本版按全局 PR #376 @ a537c5a 的评审意见修订，按 PR #381 的评审条件更新，并补入 p2 设计时发现的前置节点 p1-mail-proof。

计划由 ygl-trees 科技树 `superagent-a2a` 生成：节点就是阶段，边就是前置，条件就是放行闸门。顺序取自 `node path p4-a2a-executor`，最前面加上已经完成的版本分支节点。每完成一个节点，就执行 `node unlock` 并挂上证据，不在本文就地改状态。

| 顺序 | 节点 | 状态 | 内容 | 前置 | 放行条件 | 执行 | 档位 |
|---|---|---|---|---|---|---|---|
| 1 | `p0-version-branch` 新版本分支 next/0.8 | 已完成 | 属主指示：以 v0.7.0（c12c299）为基线，不新打 tag；从 master 开分支 next/0.8，接入开发都在这条线上进行。 | — | owner_instruction | 评审席 | — |
| 2 | `p0-spec-review` 规格与计划评审 | 已完成 | 规格、ADR 和计划树经属主定方向（已定，S13）、全局生产评估 PASS。只做设计，不改代码。 | — | global_pass、owner_direction | 评审席起草 | — |
| 3 | `p1-send-classes` 发送结果分类 | 已完成 | route --json 输出发送结果分类 class（sent / gone / retry），只看结构化字段，映射见规格 3.4。不改投递语义。已由 PR #381 交付。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现，全局作非自我评审 | 中档 |
| 4 | `p1-context-read` 按 context 读取往来 | 已完成 | 只读命令：按 context_id 列出本身份参与的往来，分页，给研判提供 threadContext。可选前置，没有它影子模式也能跑。已由 PR #383 交付（`a2a-net thread`）。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现，全局作非自我评审 | 中档 |
| 5 | `p1-inbox-after` 可重放读取 inbox --after | 已完成 | CLI 新增 `inbox --after <seq> --json`：只读、最旧在前、给出 next 游标和挤出未读数，不推进本地游标。带真实主机测试和反向突变。 已由 PR #379、#380 交付。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现，全局作非自我评审 | 中档 |
| 6 | `p1-receipt-cmd` 正式回执命令与 disposition 字段 | 已完成 | 定型 CLI 身份发正式回执的唯一命令形状 `a2a-net receipt <task_id> [--attention] <一句话>`，并在回执 v2 信封加观察字段 disposition，取值 result 或 attention（S14）；回执走固定 task id `receipt-<task_id>`，一个任务只有一张回执；补测试，保证结清只走正式回执。回执语义有变，须全局 PASS 并报属主知会。已由 PR #384 交付（全局 PASS，属主已知会）。 | p0-spec-review、p0-version-branch | nonauthor_pass、global_pass | 评审席独自实现，全局作非自我评审 | 高档 |
| 7 | `p1-mail-proof` 信箱行来源校验字段 | 进行中 | p2 设计时发现的前置缺口（S18）：宿主写 CLI 信箱时，把已算出的入站校验结论写成行字段 `proof`，回执行另写 `receipt_for`。只把已有判定原样写出，不改准入。全局已批方向（PR #385 设计评审），实现见 PR #386。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现，全局作非自我评审 | 中档 |
| 8 | `p2-source-shadow` a2a Source 影子模式 | 待办 | 按 Cookbook 11 步在本仓 next/0.8 实现 a2a Source 插件包，在一个节点以 observe 模式运行：只登记 Trigger 和研判记录，不开工单、不回发，使用专用 CLI 身份。运行节点和上线时间由属主选定、报全局放行（S15）。 发送结果为 -32002 被判 gone 时，必须上报 health error（S16）。开工前，规格 3.4 与 S3 须已与 #381 的实现对齐（spec_s3_aligned）；实现方案见 p2 设计稿，须先过全局设计评审（design_pass）。 | p1-inbox-after、p1-send-classes、p1-receipt-cmd、p1-mail-proof、p1-context-read（可选） | code_location_ruled、design_pass、global_pass、owner_node_selected、spec_s3_aligned | 评审席独自实现，全局作非自我评审 | 高档 |
| 9 | `p3-source-explicit` 明确请求转工单 | 待办 | 允许名单内、校验通过的调用方，其明确请求转为工单；结果与问题按规格 3.4 用正式回执回发。影子运行满 7 天无异常，且影子验收的 verify spec run PASS 后才放行；放行前属主须裁定 D7（S13 ② 与 Cookbook 的 bot 规则冲突）。 | p2-source-shadow | global_pass、owner_d7_ruling、shadow_clean_days >= 7、shadow_verify_pass | 评审席独自实现，全局作非自我评审 | 高档 |
| 10 | `r1-role-split` 席位职责与派单约束沉淀 | 暂缓 | 属主已裁定路由席暂不拆出（S13），本节点暂缓；只保留“把反复出现的约束沉淀为常设规范”这一项，以后视需要再做。 | p0-spec-review | owner_ruling | 评审席起草 | 低档（文档） |
| 11 | `p4-a2a-executor` A2A Executor 适配器 | 待办 | 实现 Executor 端口：派工、追加、回执映射为报告；queue-full 时延后；重启按原 id 对账。先单独交设计稿评审。 | p3-source-explicit、p1-send-classes、r1-role-split（可选） | executor_design_pass、global_pass | 设计稿评审后，评审席独自实现，全局作非自我评审 | 高档 |

通用规则：
- 所有工作由评审席独自完成，不派发（S12）。评审席所写的中档、高档 PR，由全局生产评估在 exact head 上作非自我评审，PASS 后才合；改对外契约、安全准入或回执语义的，PASS 后还要报属主知会。低档自验合入，在每日清单里单列。
- 接入 PR 的 base 都是 `next/0.8`，正文只写 Refs，不带任何关闭关键字（包括 do not close）。
- master 上的修复照常合入 master，再以普通 merge（或快进）并入 `next/0.8`，不 rebase、不改写历史。
- 不 tag、不 publish、不部署，除非另有发版单。
- 影子模式和真实请求阶段的验收结论，按验证器规范只认 spec run 产物。
