# 发布闸门（Release Gate）：3081 先行 + 用户校验

> 2026-10-19 立。原因：**稳定期的运维不需要自动发版**——版本线已部署到生产三机后，
> 任何改动都先落测试环境给用户校验，校验通过才发版、才上生产。
> （背景：0.6.2 曾在闸门立规当天未经校验直接发布三机，属流程违例，已补校验。）

## 铁律

1. **稳定期不自动发版**。改完代码 ≠ 发布。`npm publish` 永远是最后一步，且只在用户校验通过后执行。
2. **3081 先行**。一切候选版本（含 UI/host 改动）先装进 3081 测试环境，由用户在
   http://127.0.0.1:3081 亲自校验（工作台入口 `/__dsh_a2a_nexus/`）。
3. **校验通过 → 用户点头 → 才发版**（`npm publish`，见下「发布面」）→ 才部署生产（.156 / .157 / .85）。

## 标准流程

```
改代码 → pnpm verify（typecheck → build → test → test:build-layout → verify:nexus 全绿）
       → 本地构建即候选（必要时 npm pack 供 3081 file: 安装）
       → 3081 部署：DSH_HOME=D:/dsh-test-homes/3081 dsh plugin --profile web add <pkg>@<ver>
                   → 重启 3081（/__dsh_restart 或重启进程）
       → 用户在 3081 校验 ………… 【闸门：用户明确通过】
       → npm publish（公网 npmjs；私仓按双 registry 纪律补发） → 生产部署 .157/.85（.156 预装等用户重启 GUI）→ 跨机 probe 验证
       → ygl-trees 落库（source/evidence/claim/task/kb）
```

违反顺序（先 publish 后校验）= 流程事故，须交底并补校验。

**打包源头钉死候选 SHA**（0.6.39 事故）：在候选 PR 合并之前、从冻结 SHA 的干净检出打包，不在合并后的 master 或工作树上打包。
1. `git checkout <候选 SHA>`；
2. 确认 `git rev-parse HEAD` 就是候选 SHA，且 `git status --porcelain --ignored -- nexus-stage/scripts` 为空；
3. build，再 `npm pack`；
4. `tar -tzf` 列一遍文件，确认不含 `__pycache__`、`.pyc` 和临时件；
5. 拿这个 tgz 去验收，publish 的也是同一个 tgz。

0.6.39 的 npm 包实际打自合并后的 a2389ba，比 tag 的 bc8f423 多了 #300，另外混进了一个 `.pyc`。

**发布只发钉定的那个 tgz，不在本地重新打包**（2026-11-23 补。0.8.1-preview.29 发布出去的包与发版 PR 钉定的 tgz 字节不同、429 个文件内容相同，只能事后做文件级等价核对；原因待查，疑为发布时重新打包，未确认，见 master 分支上 `docs/release.md` 的 preview.29 一节。preview.28 是先发布、后补发版 PR 与记录，当时没有钉定 tgz，只在「只有事后的文件级等价核对」这一点上同类，见 master 分支上同一文件的 preview.28 一节）。由属主或任何人发布，都按下面做：

1. **发版 PR 给出钉定值和发布命令**：写明钉定 tgz 的文件名、路径、字节数、sha256 和 sha1，并给一条可以直接复制的命令：`npm publish "<钉定 tgz 路径>" --tag preview --registry=https://registry.npmjs.org --@<包作用域>:registry=https://registry.npmjs.org/`（`<包作用域>` 是 `package.json` 里包名 `@` 后、`/` 前的部分；写好的完整命令见 [0.8.1 升级核对](ops/0.8.1-upgrade-check.md) §6）。它与 §6 的发布命令一致，显式带标签和作用域 registry，免得在配了私仓镜像的环境里发到别处；命令的参数必须是 tgz 文件，不是目录。
2. **直接发布这个 tgz 文件**：发布前先 `shasum -a 256 <钉定 tgz 路径>` 与 PR 里的 sha256 比对，不一致就不发。不在本地重新 `npm pack`，不按目录发布（`npm publish <目录>` 或在包目录里直接跑 `npm publish` 会重跑 `prepare` 并重新打包），也不从别的检出重新构建。
3. **发布后读回**：`npm view <包名>@<版本> dist.shasum dist.integrity`，并下载已发布的 tgz 计算 sha256。shasum 应与钉定 sha1 相同，integrity 应与 `sha512-$(openssl dgst -sha512 -binary <钉定 tgz 路径> | base64)` 相同（macOS 的 `base64` 输出一行；GNU coreutils 默认每 76 列换行，Linux 上用 `base64 -w0`），下载件的 sha256 应与钉定 sha256 相同，即与钉定 tgz 逐字节一致。
4. **读回不一致时如实记录，不放宽**：在「记录已发布」里写出读回值、钉定值和不一致的原因（查得到的话），不写成一致，也不因此放宽本条。可以补做文件级等价核对（解包后逐文件比 sha256）作为附加证据，但它只说明内容等价、不替代字节一致，并在记录里单列「与往常的出入」。

## 发布面（双 registry）

- **公网 npmjs 为主发布面**：0.6.24（2026-10-22）起有发布记录，README 徽章即指向它；
  2026-10-27 复核 `latest=0.6.28`。生产与外部节点按 npmjs 版本安装。
- **Gitea 私仓**：立规时的唯一发布面；现为双 registry 纪律下的镜像，按属主指令补发
  （0.6.24 发布时私仓仍停在 0.6.15，见 docs/validator.md）。

## 3081 测试环境事实（2026-10-19 修复后）

- `DSH_HOME=D:\dsh-test-homes\3081`，GUI 端口 3081，profile `profiles/web`。
- 启动：`DSH_HOME=D:/dsh-test-homes/3081 dsh web --port 3081 --no-open`（后台）。
- profile 已现代化：核心 `@deepseek-ai/*` 不再 pin 在 dependencies（由宿主提供，仅列 bundles，
  对齐生产 profile 形态）；`dsh-prompt-templates` 由 Temp tgz 死指针改私仓 `0.11.5`；
  `pnpm-workspace.yaml` 移除孤儿 fs-ext patch；`dsh-tool-gitbash`（peer 不兼容）已移除。
- 老插件 `dsh-loop@0.4.4`、`dsh-cli-manager@0.11.0` 与 dsh 0.2.0-rc.2 peer 不兼容：装后跳过
  （与生产 .157/.85 的 cli-manager 同款处置），不影响 a2a-net 校验。
- 会话/数据全隔离于生产 3080，测试产物不污染生产。

## 与既有文档的关系

- 环境机制（hoisted 快照、junction、HMR 边界）见技能 `dsh-plugin-dev-test`（本机权威）。
- 发布到 Gitea 私仓（镜像面）的操作细节见 `gitea-npm-publishing` / `tea-npm-registry` 技能。
- 本文钉**顺序纪律**（3081 先行、用户校验、稳定期不自动发版），以及「打包源头钉死候选 SHA」与「发布只发钉定的那个 tgz」两段里的打包、发布和读回操作。打包与发布证据的总体原则见 [release-provenance.md](release-provenance.md) §2 B.5 与 §3 C2（该文仍是 proposed）。


> 2026-10-28 属主授权：发版确认权授总工席（dsh/414d2b90）——铁律②③点头步代位，3081/全绿门禁不变。
> **2026-11-03 规范 v1.18 取消上述代位与点头步**：发版不再需要任何人（属主/总工/用户）点头；发版属高档，放行 = 一个非自我节点对候选提交 SHA 的评审 PASS。3081 先行部署与全绿门禁是验证步骤，照做，由评审来验。
