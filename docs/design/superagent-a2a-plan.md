# superagent × a2a-net 实施计划（草案）

配套：[接入规格](superagent-a2a-spec.md)、[ADR](superagent-a2a-adr.md)、[断言与证据](superagent-a2a-evidence.md)。

本版（r8）按 2026-11-07 的属主裁定修订，涉及 S21、S25–S27、S33、S36、S38：
- 原来的 p2 拆成 p2a（代码）和 p2b（上节点运行）；
- p3 新增三个前置节点；
- p4 从「A2A Executor」收窄为「送审」；
- r1-role-split 关闭。

本计划由 ygl-trees 科技树 `superagent-a2a` 生成：节点就是阶段，边就是前置，条件就是放行闸门。每完成一个节点，就执行 `node unlock` 并挂上证据，不在本文就地改状态。

| 顺序 | 节点 | 状态 | 内容 | 前置 | 放行条件 | 档位 |
|---|---|---|---|---|---|---|
| 1 | `p0-version-branch` 新版本分支 next/0.8 | 已完成 | 以 v0.7.0（c12c299）为基线，从 master 开出 next/0.8，不新打 tag。 | — | owner_instruction | — |
| 2 | `p0-spec-review` 规格与计划评审 | 已完成 | 属主定方向（S13），全局生产评估 PASS（#376）。 | — | global_pass、owner_direction | — |
| 3 | `p1-send-classes` 发送结果分类 | 已完成 | `route --json` 增加 class 字段（sent / gone / retry），#381。 | p0 | nonauthor_pass | 中档 |
| 4 | `p1-context-read` 按 context 读取往来 | 已完成 | `a2a-net thread`，#383。 | p0 | nonauthor_pass | 中档 |
| 5 | `p1-inbox-after` 可重放读取 | 已完成 | `inbox --after <cursor> --json`，#379、#380。 | p0 | nonauthor_pass | 中档 |
| 6 | `p1-receipt-cmd` 正式回执命令与 disposition | 已完成 | `a2a-net receipt`，增加 disposition 字段（S14），#384；属主已知会。 | p0 | nonauthor_pass、global_pass | 高档 |
| 7 | `p1-mail-proof` 信箱行来源校验字段 | 已完成 | 信箱行增加 `proof` 和 `receipt_for`（S18），#386。 | p0 | nonauthor_pass | 中档 |
| 8 | `p2a-source-code` a2a Source 插件代码 | 已完成 | `a2a-watch` 影子模式，#390；影子验收需要的记录，#391；observe 模式在 superagent 等待 setup 时也照常读信，#395。另有采集器 #392–#394。 | p1-inbox-after、p1-mail-proof、p1-receipt-cmd、p1-send-classes、p1-context-read（可选） | design_pass、global_pass | 高档 |
| 9 | `p2b-shadow-run` 影子模式上节点运行 | 进行中 | 属主选定评审席本机（S15）。冒烟窗口进行中，结束后用冻结的 spec 跑 run，结果交全局。 | p2a-source-code | owner_node_selected、global_pass | 高档 |
| 10 | `p1-receipt-outcome` 回执结局 | 已完成 | `receipt --outcome failed / rejected / abandoned`（S26），#396；属主已知会。 | p1-receipt-cmd | nonauthor_pass、global_pass、owner_notice | 高档 |
| 11 | `p1-mailbox-owes` 信箱欠回执声明 | 已完成 | `publish --owes`（S33），#397；属主已知会。 | p1-mail-proof | nonauthor_pass、global_pass、owner_notice | 高档 |
| 12 | `p1-mail-admission` 信箱行准入规则与复查入口 | 已完成 | 信箱行增加 `admission`；新增 `a2a-net admission`，签名后由宿主强制执行，#398。 | — | nonauthor_pass、global_pass | 中档 |
| 13 | `p3-source-explicit` 接单与回发 | 待办 | 用 D4 修订后的可信集合，并要求调用方在链接集内（S36）；规则化 inferred（S21）；回发遵守出站边界（S25），回执带结局（S26），并做防回环（S27）；reply 模式下声明 owes。设计稿 v1.1 已过 design_pass，实现等冒烟验收完成后再开；7 天影子验收要按新 D4 重新冻结。上线前属主须提供 GitHub 部署配置。 | p2b-shadow-run、p1-receipt-outcome、p1-mailbox-owes、p1-mail-admission | global_pass、owner_d7_ruling（已裁，S21）、shadow_clean_days >= 7、shadow_verify_pass | 高档 |
| 14 | `p4-review-request` 送审通道 | 待办 | superagent 用本地执行器完成工作；高档改动经 A2A 送到评审席，等同一 SHA 的非自我评审 PASS；另有上报通道（S38）。送审与上报的对象，由属主在部署配置里写死，并且须在链接集内。先单独交设计稿评审。 | p3-source-explicit、p1-send-classes | design_pass、global_pass | 高档 |

已关闭：`r1-role-split`。属主已裁定总工席不拆（S38），反复出现的约束直接沉淀进常设规范。

通用规则：
- 所有工作由评审席独自完成，不派发（S12、S28）。
- 中档和高档 PR 须由全局生产评估在 exact head 上作非自我评审，PASS 后才能合入。改对外契约、安全准入或回执语义的，PASS 后还要报属主知会。低档由评审席自验后合入。
- 接入 PR 的 base 都是 `next/0.8`，正文只写 Refs，不带任何关闭关键字。
- PR 分支推送后，只追加提交，不 force-push。提交前用测试的退出码挡住提交。
- 不打 tag、不 publish、不部署，除非另有发版单。
- 影子期和真实请求期的验收结论，按验证器规范只认 spec run 的产物。
