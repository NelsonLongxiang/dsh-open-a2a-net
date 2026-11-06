# superagent × a2a-net 实施计划（草案）

配套 [接入规格](superagent-a2a-spec.md)。

计划由 ygl-trees 科技树 `superagent-a2a` 生成：节点就是阶段，边就是前置，条件就是放行闸门。顺序取自 `node path p4-a2a-executor`，最前面加上已经完成的版本分支节点。每完成一个节点，就执行 `node unlock` 并挂上证据，不在本文就地改状态。

| 顺序 | 节点 | 状态 | 内容 | 前置 | 放行条件 | 执行 | 档位 |
|---|---|---|---|---|---|---|---|
| 1 | `p0-version-branch` 新版本分支 next/0.8 | 已完成 | 属主指示：以 v0.7.0（c12c299）为基线，不新打 tag；从 master a510152 开分支 next/0.8，接入开发都在这条线上进行。 | — | owner_instruction | 评审席 | — |
| 2 | `p0-spec-review` 规格与计划评审 | 待办 | 本文、ADR 和计划树经属主定方向、全局生产评估 PASS。只做设计，不改代码。 | — | global_pass、owner_direction | 评审席起草 | — |
| 3 | `p1-send-classes` 发送结果分类 | 待办 | route --json 输出稳定的结果类别 sent / gone / retry，并在契约文档写出映射表（规格 3.4）。不改投递语义。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现；非自我节点评审 | 中档 |
| 4 | `p1-context-read` 按 context 读取往来 | 待办 | 只读命令：按 context_id 列出本身份参与的往来，分页，给研判提供 threadContext。可选前置，没有它影子模式也能跑。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现；非自我节点评审 | 中档 |
| 5 | `p1-inbox-after` 可重放读取 inbox --after | 待办 | CLI 新增 `inbox --after <seq> --json`：只读、最旧在前、给出 next 游标和挤出未读数，不推进本地游标。带真实主机测试和反向突变。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现；非自我节点评审 | 中档 |
| 6 | `p1-receipt-cmd` CLI 身份正式回执命令定型 | 待办 | 确认并文档化 CLI 身份发正式回执的唯一命令形状（task id、结果一句话），补测试，保证结清只走正式回执。 | p0-spec-review、p0-version-branch | nonauthor_pass | 评审席独自实现；非自我节点评审 | 中档 |
| 7 | `p2-source-shadow` a2a Source 影子模式 | 待办 | 按 Cookbook 11 步实现 a2a Source，在一个节点以 observe 模式运行：只登记 Trigger 和研判记录，不开工单、不回发。使用专用 CLI 身份。 | p1-inbox-after、p1-send-classes、p1-receipt-cmd、p1-context-read（可选） | code_location_ruled、global_pass | 代码位置裁定后，评审席独自实现；非自我节点评审 | 高档 |
| 8 | `p3-source-explicit` 明确请求转工单 | 待办 | 允许名单内、校验通过的调用方，其明确请求转为工单；结果与问题按规格 3.4 用正式回执回发。影子运行满 7 天无异常后才放行。 | p2-source-shadow | global_pass、shadow_clean_days >= 7 | 评审席独自实现；非自我节点评审 | 高档 |
| 9 | `r1-role-split` 席位职责与派单约束沉淀 | 待办 | 把反复出现的派单约束沉淀为常设规范；裁定路由席是否从评审席拆出。只改文档与规范。 | p0-spec-review | owner_ruling | 属主裁定，评审席起草 | 低档（文档） |
| 10 | `p4-a2a-executor` A2A Executor 适配器 | 待办 | 实现 Executor 端口：派工、追加、回执映射为报告；queue-full 时延后；重启按原 id 对账。先单独交设计稿评审。 | p3-source-explicit、p1-send-classes、r1-role-split（可选） | executor_design_pass、global_pass | 设计稿评审后，评审席独自实现；非自我节点评审 | 高档 |

通用规则：
- 本接入任务由评审席独自完成，开发席不参与实现。按协同规范 v1.18，评审席自己写的中档、高档改动，必须由另一个节点（非自我，不能是评审席派生的子代理）在 exact head 上评审 PASS；高档另须报全局，等回复后再合。
- 接入 PR 的 base 都是 `next/0.8`，正文只写 Refs，不带任何关闭关键字（包括 do not close）。
- master 上的修复照常合入 master，再以普通 merge 并入 `next/0.8`，不 rebase、不改写历史。
- 不 tag、不 publish、不部署，除非另有发版单。
- 影子模式和真实请求阶段的验收结论，按验证器规范只认 spec run 产物。
