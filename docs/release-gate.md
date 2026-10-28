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
- 本文只钉**顺序纪律**：3081 先行、用户校验、稳定期不自动发版。


> 2026-10-28 属主授权：发版确认权授总工席（dsh/414d2b90）——铁律②③点头步代位，3081/全绿门禁不变。
