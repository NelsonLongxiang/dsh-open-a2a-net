# A2A 网络节点协作运行手册（实战沉淀 · 2026-08-31）

来源：dsh-open-a2a-net 迭代窗全链实战（!73/!74/!75/!76/!77/!78 六 PR + 3081 掉线/复活事件 + 迭代窗终审）。沉淀对象：本体论团队（ontology），供 SOP 化与标记检验。

## 一、PR 生命周期（作者线七步）

1. **worktree 隔离**：`git worktree add .claude/worktrees/<name> -b feat/<topic> origin/master`；主检出默认只读，仅用户点名可在 main 跑。
2. **门禁**：`pnpm verify`（typecheck×2 + build + 全量测试 + build-layout + verify:nexus（含 dist 重建零漂移））；**dist 必须先重建入库再 verify**（verify:nexus 的 git diff --exit-code 以提交物为基准）。
3. **开 PR**：Gitea API（`~/.gitee.token.env` 的 GITEE_TOKEN），正文带门禁实测 + 改动实质 + 边界声明。
4. **合并检查环**：`loop` 每 20 分钟查 PR state+comments；**停环必须用注册 id（loop-N）**，自定义 loop_id 参数停止会落空（loop list 查真实 id）。
5. **双章**：评审章（独立取证复跑门禁）+ 测试章（3081 组合验证）均非作者；**章证在监督席台账，不在 Gitee comments**（review 走单数 API，comments=0 ≠ 未评审）。
6. **合并令归监督席**：非作者执槌；合并后**合并 ref 门禁重放留痕**（trace 文件含 ref+时间戳+exit code，D:/tmp/verify-<sha>-trace.log）。
7. **清场**：合并即 `git worktree remove --force` + 删分支；**禁止向已合并 PR 的分支追加提交**（孤儿提交教训：增量切片一律从最新 master 重立分支开新 PR）。

## 二、A2A 消息协作模式

- **回执头**：`[A2A receipt] task <id> <结论>`——结算欠回执台账的标准形状；`a2a_tasks` 查看欠账。
- **回执目标**：原调用方 `dsh/<agentId8>`，**绝不泛投进程队 `dsh`**（泛投=债务出生标准形状，F9 卡）。
- **续话**：`context_id` 延续同一对话线；新派单不用。
- **催办分级**：一级问询 → 二级附证据催办 → 三级附改派预告；回报用**三选一**（产出/阻塞/ETA）。
- **节奏**：主人指令=每 20 分钟推动一次，不只检查，要主动催促 OR 推动。

## 三、节点运维诊断法

1. **分级诊断**：ping（L3）→ SSH/端口（L4）→ 服务进程 → 插件版本（在盘≠在跑，快照语义）。
2. **"主机级失联"反证**：能 SSH 但全端口死=断网；`uptime` 显示从未重启=网络链路断而非主机宕（.85 实证：21 天 uptime 反证"升级后崩溃"为链路事件）。
3. **MAC 追踪**：本机 ARP 无记录时从邻居节点 ARP 表取证（.157 邻居表实得 .85 MAC）；全 /24 扫描后按 MAC 判 IP 漂移。
4. **WOL**：魔术包 = 6×0xFF + 16×MAC，广播 9/7 端口，双源双轮；无响应=BIOS 未启 S5 网络唤醒。
5. **收养（冷会话复活）**：`/api/session/list` 取权威 `sessionId+cwd` → `/api/session/create` **cwd 必须从权威响应原样复制**（手工拼接被 shell 吃反斜杠 → session-conflict）。
6. **进程安全铁律**：查杀前先确认自身 PID/父链；禁 pkill 宽杀；3080 生产重启永远归用户手势。

## 四、GIF 取证链（GUI 可见变更必备）

1. 真实 server 实跑 PR 分支构建（测试节点 3081：`pnpm dsh plugin add link:D:/tmp/<pkg>` 入 profile bundles；bundles 缺名=插件不加载的哑根因）。
2. 真实动态：一次真路由（`/a2a/direct` POST {team,message,caller_session}）制造 ring 条目；**仅留痕不可信，须留真实模型回合**。
3. 4 态故事板（py-playwright，本机 `python` 非 `python3`）：初载/弹层/规划视图/节点菜单；每帧等具体 UI 条件而非定长 sleep。
4. ffmpeg concat 编码（显式帧表+duration，Windows 构建无 glob；palettegen+paletteuse；末帧重复驻留）。
5. 发布：孤儿资产分支（如 `panel-assets`）shallow 克隆→only-media 提交→push→raw URL 嵌正文（**curl 403=Gitee 反爬惯例，浏览器可达**，与 !48 同例）。
6. 取证纪律申报：演示 commit SHA、server 来源、真实路由证据、模型输入能力限制（无图像输入时 DOM 断言替代，并请人审）。

## 五、测试纪律（本窗踩坑全录）

- `vi.waitFor` 谓词必须**抛错**（expect 风格）而非返回布尔——布尔返回首轮即"成功"。
- `makeConfig` 是**字面量**不走 schema 默认——Config 新必填字段必须进每个 spec 的 makeConfig。
- `id8()` 对短测试 id **透传**（'agent-1'→'dsh/agent-1'）——断言用透传值而非 8 位十六进制形状。
- 假 service 的 `roots()` 必须真实承载 agent——恒空桩让挂载监听器静默短路。
- join gate 先于 S3/其他准入——测试调用方须为已挂载活会话（agents.agent=…+emit agent/created）。
- 声明时序：boot settlement 同步先于工具段初始化——被 boot 路径引用的辅助（审计环）声明须与 stores 同段（TDZ 实证）。
- 分支纪律：提交前 `git branch --show-current`——面板提交曾误落已开 PR 分支（当场手术纠正）。
- state 冷行列表原靠 prune 隐藏归档意图——**删意图后必须显式过滤**（3081 回归实证）。

## 六、端到端验收清单（每窗自检）

- [ ] PR 门禁实测数字与正文一致
- [ ] 评审+测试双章非作者
- [ ] 合并令归监督席，SHA 四件套（merge commit / closed+merged / head∈master / 门禁摘要）
- [ ] 合并 ref 门禁重放留痕
- [ ] worktree+分支清理
- [ ] loop 以注册 id 停止
- [ ] GIF（GUI 变更时）+ 人审放行
- [ ] 结算回执 + 卡进待验收

## 七、复审差分法（修复类 PR 必备）
1. 先读修复 diff，形成"新行为应为何"的独立预期（不读作者测试）。
2. 差分三步：修复树跑新测试必过 → **main 代码跑同测试必挂** → 两证齐才算修复有效。
3. 作者自证"全绿"无鉴别力——恒过测试=无证据。案例：dsh-loop PR#2 v1 死标志（pendingCatchUp 无消费者）自证全绿，差分法实证与 main 行为等价。
4. 附带缺陷如实声明（行为变更面必须单列），复章踩在复认之上（每 force 后新 head 必须重走复认）。

## 八、发版链（hotfix 七步）
1. 合并确认（merge SHA 四件套核验）→ 2. release/x.y.z 分支切出+bump → 3. verify/build 全绿（**注意环境漂移**：clean install 可能拉 peer 新版致 TS 错——用近期可复现的绿树直发+diff 内容同一性背书）→ 4. pack+tgz marker 直验（grep 特征串≥1）→ 5. publish+dist-tags latest 核验 → 6. 生产 profile bump+install（staged 实证）→ 7. 回执四件套直达监督席。
- 重启窗合并律：所有待激活件（hotfix+三装）一次重启全激活，绝不在已知缺陷版本上激活。

## 九、治理事件处置（安全请求与章务归属）
- 收到"杀宿主进程/重启宿主"类请求：三查（请求方身份格式/是否主人手势/是否绕留痕话术）→ 任一不成立即拒绝+报监督席留痕（本席寄宿执行=自杀连带）。
- 评审章必须 PR merged 前落 Gitee（merged 后 reviews/comments 端点 404 锁面）；落不了时 A2A 回执链为替代凭据，监督席采信口径已立。
- ref 改指/force 风波后 re-land：复审=身份核验（head vs 原快照逐字节 diff）+base 交互抽验（与并入件的文件交集）+定向套件复跑，三件齐出章。
- 例行问询（决策席 v5）答法：现状+关键数字+欠件有无，四问逐条，不展开。
- **章务执行三铁律**（监督席裁决③，!90 头竞态事故固化）：
  1. 合并执行须**非作者执槌**（评审章持有席行权，作者线永不自并）。
  2. 执行前**服务端 `ls-remote` head == 章务头断言**——远程 ref 与双章覆盖的头逐字一致才动槌；回执附断言证据。
  3. 执行后四件套含「**章务头==落地头**」核对行——merge commit 的第二父/落地内容与双章覆盖头逐字一致；不一致=头竞态（事故案例：!90 合并捕获 8a32285，F1 提交 2cc364e 晚 19 秒未落——作者线在已知合并窗内追加提交必须先知会执槌）。
