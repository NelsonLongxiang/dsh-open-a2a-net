# superagent a2a Source 插件（a2a-watch）接入说明

状态：p2a-source-code 已在 p2b 冒烟中运行；p3-source-explicit（本节以下标「p3」的各项）在本仓 next/0.8 实现，尚未上节点。reply 模式上线前，属主须提供 superagent 的 GitHub 部署配置。

## 是什么

`@nelsonlongxiang/dsh-open-a2a-net/a2a-watch` 是一个 superagent Source 插件，独立导出，本插件自身不加载它。它读取一个专用 a2a-net CLI 身份的信箱，把每条消息翻译成 superagent 的 Trigger。有两种模式：

- `observe`（默认，影子模式）：Channel 拒绝所有地址，从不回发。
- `reply`（p3）：只回给触发这条消息的原调用方。每个任务的第一条外发是它唯一的正式回执，之后的外发作为同一 context 里的新任务发出。

## superagent 一侧的启用片段（文档片段，本仓不改 superagent）

superagent 包的 `cordis.patch.yml` 里插入一条，默认禁用：

```yaml
    - id: dsh-superagent-a2a
      name: '@nelsonlongxiang/dsh-open-a2a-net/a2a-watch'
      disabled: true
```

在选定节点的 profile 里把它改成 `disabled: false`，然后重启。这一步是上节点运行，属于 p2b，须先有属主选定节点和全局放行。

## 运行前提

- 节点上能执行 `a2a-net`（本包 cli/a2a.mjs），且 superagent 进程的环境里有 `A2A_CLI_HOME`，指向这个 Source 专用身份的目录（S5）。凭证只放在部署环境里，不写进 Source 配置。
- 该身份的家宿主须运行 next/0.8 及以上版本：信箱行的 `proof`、`receipt_for`（p1-mail-proof）和 `admission`（p1-mail-admission）字段都是 0.8 才有的，`a2a-net admission` 复查入口也是。老宿主投递的行没有 proof，按 unverified 处理；没有 admission，按 unlinked 处理。
- **p3 接单还要 superagent 的 bot 名单**（设计 v1.2，属主 2026-11-07 采纳）：A2A 调用方都是 agent（D7，`human: false`），superagent 只按 Source policy 里的 `bots` 名单接收这类触发（上游 policy.ts machineGate），名单外一律 not_human。所以属主要在 superagent 的 a2a policy 里列出可接单的调用方句柄。宿主链接集（由 scope 判定）和 bots 名单两层都要满足，任一层不满足就拒。走 bot 语义：只能成为 inferred 候选，不能叫停工单，也不能唤醒已结束的工单。Policy 设为 auto，只启用一条规则（S21）。

## 行为要点

- Trigger id：`key('a2a', 调用方句柄, task_id)`。Thread 取 `context_id`，没有就用 `task_id`。
- **scope（p3，S36、S27）**：一行要被接收，以下四条必须同时满足，否则按列出的先后顺序给出第一个不满足的过滤码：
  - `unverified`：`proof` 不属于 {origin-claim, in-process, cli-identity}；
  - `unlinked`：`admission` 不属于 LINK_RULES {canvas-shared, remote-ref-samezone, remote-ref-foreign, remote-ref-cli, cli-deposit}，或者没有这个字段；
  - `loop`：task id 以 `a2a-` 开头，即本 Source 自己发出的任务；
  - `receipt`：这一行是回执。
- `dup: 'sync-answered'` 的行算重复副本，没有 `task_id` 的行算 unreadable，两者都不生成 Trigger。
- superagent 还在等 setup 时，observe 模式照常读信，其他模式等 setup（见下节）。
- `human: false`。`meta.s13Strength` 只是观察字段（见 D7，p3 由属主裁定）。
- `lost > 0`、`lost === null`、`cursorAhead`、`epochChanged` 都会报 `a2a` health error，并写出具体数字；宿主重启时文案会写明。
- 游标在一轮全部 receive 之后才前移；重放靠稳定 id 去重。每隔 `renewMinutes` 执行一次 `a2a-net publish` 续户口，连续失败 3 次报 `a2a-deposit` error。

## superagent 等待 setup 时：observe 模式照常读信（有意偏离 Cookbook 第 9 步）

superagent 的 setup 必须先绑定一个 GitHub 仓库和 agent 账户（上游 8c32a9d：src/app/setup.ts:77–79 无条件调用 resolveDeployment；src/deployment.ts:87–105）。Cookbook 第 9 步的做法是：Source 在 setup 完成前什么都不读，直接返回，等 setup 完成、superagent 重启后再由插件重新加载。github-watch 就是这样做的（src/sources/github.ts:132）。

a2a-watch 在 `mode: observe` 时有意不照这一步：setup 未完成也照常读信。其他任何模式（目前 schema 只接受 observe，这条规则是防将来扩模式）仍然等 setup，报 `setupPending` 后返回。依据是上游自身的语义：等待 setup 时 Engine 照常登记 Source 送来的东西，只是不评估、不派工、不外发，这正是影子模式要的状态。

- src/app/runtime.ts，paused() 的注释原文：「Hold evaluation, dispatch, and outbound delivery while paused or awaiting setup; sources still record incoming triggers.」
- src/app/passes.ts，pump() 的注释原文：「Do not assess, dispatch, or send while waiting for setup; queued work waits for the restart that completes setup.」
- src/core/intake.ts receive()：整段不判断 setup；被 scope 过滤的写 trigger 和 disposition{filtered:{code}}，其余写 trigger 和 thread。

已在一台未完成 setup 的真实 superagent（0.2.1-rc.3 + 8c32a9d）上实测：三类信箱行（in-process 可信、in-process 可信回执、cli-identity 不可信）分别落成 stored、filtered:receipt、filtered:unverified；trigger 3 行、disposition 3 行，outbox、ticket、decision、effect 都是 0 行；runtime 仍是 paused。

**退场约束**：未被过滤的 trigger 会排进评估队列，等 setup 完成后才处理。所以跑影子的这台实例，在影子期间和之后都不得完成 setup；影子结束后按卸载清单删掉 stateDir 或整个实例。只要哪天完成了 setup，排队的评估就会开始跑。

## 回发（p3，reply 模式）

- **地址**：取自 Trigger 的 channel.address：caller、task、context；proof 为 in-process 的行另带 `ingress: local`。caller 为空或为 `unknown`（宿主自身没有会话的面）时，`allowed` 返回 false，Outbox 记为 channelIgnored，不猜地址。
- **先复查链接（O1）**：每次外发之前，先在 Source 所在的家宿主上执行 `a2a-net admission <caller> [--local] --json`。只要复查结果不在 LINK_RULES 内，就判 gone，并报 `a2a-reply` error，什么也不发。不依赖对端宿主拒绝。
- **首条外发**：`a2a-net receipt <task> --to <caller> (--attention | --outcome O) --json --exit-class -- <正文>`。消息 id 以 `attention-reply:` 开头的用 `--attention`。结局按工单的 `ended` 映射：
  - completed、merged → completed；
  - dropped → rejected；
  - closed → abandoned；
  - stopped 由人结束 → abandoned，由执行器结束 → failed；
  - 工单未结束 → completed。
  CLI 成功后，才把这个 task 记进 KV `a2a-answered`。
- **之后的外发**：`a2a-net route <caller> --task a2a-<key(消息 id)> --context <context 或 task> --json --exit-class -- <正文>`。task id 用消息 id 的哈希，保证在 80 个字符之内，而且是确定的。
- **`--exit-class` 的退出码**：
  - 4（gone）→ 判 gone；
  - 5（这个 task 已有另一张回执），且是首条外发 → 按 sent 处理，并补写记录；
  - 其他失败 → 抛错，由 Outbox 重试。KV `a2a-send-failed` 记下第一次失败的时间，满 24 小时就判 gone，并报 `a2a-reply` error（S25 O5）。
- **task id 不合规**：task id 无法承载回执（不是 CLI 的 task id 字符，或者 `receipt-<id>` 超过 80 个字符）时，立即判 gone，不会重试一整天。
- **KV 上限**：`a2a-answered` 最多 2000 条，`a2a-send-failed` 最多 1000 条，都是 7 天过期，写入时清理。
- **续户口**：reply 模式下执行 `publish --owes`（S33）；切回 observe 后，下一次续户口执行 `publish`，声明随之撤回。
- **已知局限**（设计 v1.1 方案甲）：result 由 ready 报告触发时，工单还没结束，回执按 completed 发出。之后工单如果又以 dropped 或 closed 结束，这个结局用同一 context 里的新任务告知，回执本身不改。回执正文由 CLI 折成一行。

## health 怎么报

- 出现挤出或游标异常（lost > 0、lost === null、cursorAhead、epochChanged）的那一轮，`a2a` 条目以 error 结束，同一轮不再报 ready，不会被覆盖（全局对 PR #390 的评审）。
- 下一轮读取干净时，`a2a` 条目重新报 ready。所以 error 至少在一个轮询间隔（`pollSeconds`）内可见；要留存全部异常，靠影子验收判据 A7 采集 health 历史。
- 连续 3 轮读取失败时，报 `pollFailures` error；户口续期连续失败 3 次时，报 `a2a-deposit` error。
- 回发判 gone 时（链接已撤、宿主报 gone、24 小时仍未发出、task id 无法承载回执），报 `a2a-reply` error，values 只带 task。

## 验收记录（D1、D2）

影子验收需要三类记录，Source 写在自己的 KV 里，与 `a2a-cursor`、`a2a-renewed-at` 分开存放：

- `a2a-rows`：每一条信箱行一条记录，只有 `{epoch, seq, task_id, from, outcome, at, proof, receipt_for, dup, admission}` 这几个字段，不存正文。admission 只记宿主的闭集取值（p3）。proof 只记宿主的闭集取值，否则为 null；receipt_for 只记 task id；dup 只记已知的标记值（sync-answered）。有了这三项，验收就能以信箱行为全集和 Trigger 对账，查得出漏收的行，不只是用 Trigger 自证。`outcome` 取值为 stored、duplicate、filtered:unverified、filtered:unlinked、filtered:loop、filtered:receipt、duplicateCopy、unreadable 之一。同一行一处理完就写记录；**一轮所有行的记录都写完之后，游标才前移**。按稳定键 `epoch:seq` 去重，所以中断后重放不会记两次。例外：seq 为空的行（只会来自不编号的老宿主）没有稳定键，不去重，重放时可能重复记录；验收里“同一 (epoch, seq) 只出现一次”这条检查不包括 seq 为空的行。最多保留最新的 `ROW_RECORD_CAP = 1000` 条，旧的滚动淘汰。
- `a2a-pages`：页头原值 `{at, after, next, epoch, lost, epochChanged, cursorAhead}`。p3 起按方案 P 记录（冒烟实测每读一次都记一条时，约 8.3 小时就会写满上限）：
  - 读到行、或页头报了 loss 的那一轮，记一条，而且先于判断，所以即使 Source 漏判了 loss，验收也能独立查出来；
  - 另外每小时记一条心跳页头（`heartbeat: true`），带 `rounds`（自上一条心跳以来的读信轮数，含本轮）和 `rows`（同一区间新追加的行记录数）；
  - 进程启动后的第一轮必写一条心跳；
  - 中断的那一轮已写下的行记录，计入下一条心跳，重放不重复计数。
  验收判据 A15 用心跳证明 Source 持续在读（v5.1）。最多保留最新的 `PAGE_RECORD_CAP = 1000` 条。KV `a2a-heartbeat` 存心跳之间的累计值。
- `a2a-health-log`：Source 每报一次 error（读取挤出或游标异常、连续读取失败、户口续期失败、循环异常退出）就追加一条，只有 `{at, entry, state, code?, values?}`，不存 detail 文本。values 只保留结构化的几项：count、lost、after、epochChanged、task。CLI 错误原文这类自由文本只留在 ctx.report 的当前值里，不写进这份记录。最多保留最新的 `HEALTH_RECORD_CAP = 200` 条。

这三份记录都在 superagent 存储的 kv 表里。页头记录和同一轮的 health 记录用的是同一个 `at`，验收靠它把两者对上。验收采集器只读它们，展平后交 verify 判定（A5、A7、A10）。上限决定了影子窗口能回溯多远：按每轮的流量估算，窗口内的记录条数不能超过上限，否则最早的记录会被淘汰，验收会少看到一部分。

## 已知限制

- **毒行**：某一行的 `ctx.receive` 如果一直抛错，游标会停在那一行，之后每轮都重读、反复报 error。p2 接受这一点，因为它会显示出来。处理要靠人：查明并修好这一行的问题后重启；或者经全局同意，人工把游标越过这一行。
- **还没配置完成时**：`configured()` 为假时，Source 报 `setupPending` 后直接返回，不轮询。superagent 在账户配置完成后会重启，重启时插件会重新 apply（superagent docs/008-cookbook.md 第 9 步）。所以不需要循环等待。
