# superagent a2a Source 插件（a2a-watch）接入说明

状态：p2a-source-code。代码在本仓 next/0.8；还没有在任何节点上运行。上节点（p2b-shadow-run）须由属主选定节点（S15），并经全局放行。

## 是什么

`@nelsonlongxiang/dsh-open-a2a-net/a2a-watch` 是一个 superagent Source 插件，独立导出，本插件自身不加载它。它读取一个专用 a2a-net CLI 身份的信箱，把每条消息翻译成 superagent 的 Trigger。只有影子模式（`mode: observe`）：Channel 拒绝所有地址，所以从不回发。

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
- 该身份的家宿主须运行 next/0.8 及以上版本：信箱行的 `proof` 和 `receipt_for` 字段（p1-mail-proof）是 0.8 才有的。老宿主投递的行没有 proof，一律按 unverified 处理。

## 行为要点

- Trigger id：`key('a2a', 调用方句柄, task_id)`。Thread 取 `context_id`，没有就用 `task_id`。
- 可信来源只认 `proof ∈ {origin-claim, in-process}`，其余都判为 unverified，按 unverified 理由过滤。可信的回执行按 receipt 理由过滤。
- `dup: 'sync-answered'` 的行算重复副本，没有 `task_id` 的行算 unreadable，两者都不生成 Trigger。
- `human: false`。`meta.s13Strength` 只是观察字段（见 D7，p3 由属主裁定）。
- `lost > 0`、`lost === null`、`cursorAhead`、`epochChanged` 都会报 `a2a` health error，并写出具体数字；宿主重启时文案会写明。
- 游标在一轮全部 receive 之后才前移；重放靠稳定 id 去重。每隔 `renewMinutes` 执行一次 `a2a-net publish` 续户口，连续失败 3 次报 `a2a-deposit` error。

## health 怎么报

- 出现挤出或游标异常（lost > 0、lost === null、cursorAhead、epochChanged）的那一轮，`a2a` 条目以 error 结束，同一轮不再报 ready，不会被覆盖（全局对 PR #390 的评审）。
- 下一轮读取干净时，`a2a` 条目重新报 ready。所以 error 至少在一个轮询间隔（`pollSeconds`）内可见；要留存全部异常，靠影子验收判据 A7 采集 health 历史。
- 连续 3 轮读取失败时，报 `pollFailures` error；户口续期连续失败 3 次时，报 `a2a-deposit` error。

## 已知限制

- **毒行**：某一行的 `ctx.receive` 如果一直抛错，游标会停在那一行，之后每轮都重读、反复报 error。p2 接受这一点，因为它会显示出来。处理要靠人：查明并修好这一行的问题后重启；或者经全局同意，人工把游标越过这一行。
- **还没配置完成时**：`configured()` 为假时，Source 报 `setupPending` 后直接返回，不轮询。superagent 在账户配置完成后会重启，重启时插件会重新 apply（superagent docs/008-cookbook.md 第 9 步）。所以不需要循环等待。
