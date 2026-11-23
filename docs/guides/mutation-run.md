# 评审变异运行器（scripts/mutation-run.mjs）

评审要证明「某条测试守着某行代码」，做法是改那一行、看测试变红。以前每张评审单各写一个一次性脚本；这个工具把它做成一份数据加一个固定入口。它是评审时手动跑的工具，不是门禁，不接入 `pnpm verify`，也不进发布包（`scripts/` 不在 `package.json` 的 `files` 里）。

## 用法

```
pnpm mutate <spec.json> [--root DIR] [--out DIR] [--json]
node scripts/mutation-run.mjs <spec.json> [--root DIR] [--out DIR] [--json]
```

- `--root`：要变异的仓库根，默认当前目录所在 git 仓库的顶层。
- `--out`：每次测试的完整输出写到这里；默认 `<root>/tmp/mutation-run/<时间>/`（`tmp/` 已被 git 忽略）。放在仓库里时必须是被忽略的目录，否则拒绝。
- `--json`：最后一行再打印一个 JSON 汇总（每条结果、已跑个数、定义个数）。

规格文件本身是评审单的实例输入，放在本项目 `tmp/<任务标识>/`，不提交。

## 规格（spec.json）

```json
{
  "version": 1,
  "command": ["node_modules/.bin/vitest", "run"],
  "narrow": ["tests/wire/apply.spec.ts"],
  "wide": ["tests/wire"],
  "oldTests": { "rev": "<PR 之前的提交>", "files": ["tests/wire/apply.spec.ts"] },
  "mutations": [
    { "id": "D1", "file": "src/index.ts", "find": "4 * TIMER_MAX_DELAY_MS + 3", "replace": "4 * TIMER_MAX_DELAY_MS + 7" },
    { "id": "M9b", "file": "src/x.ts", "find": "a ?? b", "replace": "b ?? a", "occurrence": 2, "expect": "survived" }
  ],
  "probes": [
    { "id": "P1", "from": "tests/wire/apply.spec.ts", "append": "it('probe', () => { /* ... */ })", "expect": "pass" }
  ]
}
```

- `command`：数组，不经 shell；测试路径追加在后面。相对路径按仓库根解析。
- `find`：字面原文，不是正则。没写 `occurrence` 时必须恰好命中 1 次；写了 `occurrence: n` 时至少命中 n 次，只换第 n 处。
- `expect`：变异为 `killed`（默认）或 `survived`（已知等价、记录在案的存活）；探针为 `pass` 或 `fail`。
- `wide`：只对在 `narrow` 下存活的变异再跑。
- `oldTests`：只对被 `narrow` 打红的变异，把这些测试文件临时换成 `rev` 时的版本再跑一次 `narrow`：仍红记 `old-also-kills`，变绿记 `only-new-kills`（只有新用例能抓住）。只被 `wide` 打红的变异记 `killed-by-wide`，不跑旧测试（新的 `narrow` 都没抓住它，谈不上「只有新用例能抓住」）。
- `timeoutMs`（可选）：每次测试运行的时限。超时就停掉这次运行（连同它启动的进程），记为打红并在结果里标 `timeout`；看日志确认是不是变异造成的死循环。
- `probes`：在未变异的代码上，复制 `from` 为同目录的 `zz-probe-<id>.<原后缀>`，末尾追加 `append`，单跑一次后删除。

## 运行顺序与保证

1. 工作树（含未跟踪文件）必须干净，否则列出文件并拒绝。
2. 先检查全部锚点、路径（不得离开仓库）、被改文件已被 git 跟踪、`oldTests.rev` 与文件存在、探针文件不存在；任何一条不过就整体拒绝，什么都不改。
3. `narrow` 基线必须全绿。
4. 逐条变异：保存原字节，替换并读回确认确实改了；跑测试；在 `finally` 里写回原字节、再 `git checkout -- <文件>`，然后确认工作树干净，才进入下一条。
5. 收尾断言「已跑个数 = 定义个数」且工作树干净。

只改规格列出的文件，不碰 git 索引，不提交、不推送、不 stash；不读任何环境变量开关。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 每条结果都符合预期 |
| 1 | 有不符合预期的结果（通常是存活的变异） |
| 2 | 用法或预检错误（脏工作树、锚点未命中或多次命中、基线不绿等）；什么都没改 |
| 3 | 还原或计数失败（某次测试弄脏了工作树、跑完个数不对）；请人工查看工作树 |
| 130 | 被 SIGINT/SIGTERM 中断；先停掉测试、还原文件再退出 |

每次测试运行在独立的进程组里；SIGINT、SIGTERM、SIGHUP 和超时都会把 SIGTERM 发给整个进程组（5 秒后仍在就发 SIGKILL），所以经 `pnpm`、`npx` 包装的测试进程也会被停掉，不会在已还原的文件上继续跑。

SIGKILL 无法拦截：留下的改动会让下一次运行在第 1 步拒绝，并列出要 `git checkout --` 的文件；`--out` 下的 `current.json` 记着当时正在改的文件。

## 输出

每条变异一行：`id  narrow=RED|GREEN  wide=…  old=…  结论`，结论为 `killed`、`survived`、`killed, only by the new tests`、`killed, the old tests too` 或 `killed, only by the wide tests`；超时的标 `(timeout)`，不符合 `expect` 时末尾标 `(expected …)`。每次测试的完整日志在 `--out` 里（`baseline.log`、`<id>.narrow.log`、`<id>.wide.log`、`<id>.old.log`、`probe-<id>.log`）。

## 局限与注意

- **规格等同于代码。** `command` 会运行任意程序，规格里的变异会改写任意已跟踪文件；只运行自己写的或审过的规格，不运行来路不明的规格。
- **只看退出码。** 测试命令非 0 就算打红，不区分断言失败和编译失败。只造成语法错误的变异也会记成 killed；评审时打开 `<id>.narrow.log` 确认是断言失败。
- **符号链接一律拒绝。** 被改文件或 `oldTests` 文件是已跟踪的符号链接时预检拒绝：链接可能指向仓库外，运行器被 SIGKILL 时那边留下的改动 git 看不到。
- **没有默认时限。** 不写 `timeoutMs` 时测试运行不限时，变异造成死循环会一直等，只能中断。
- **Windows 未实测。** 进程组只在 macOS/Linux 上使用；Windows 上只停直接子进程。
