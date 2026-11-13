# superagent pi platform：Pi 席位成为正式成员（设计稿 v2）

> 状态：设计稿 v2。属主 2026-11-13 已同意 R4 修订（P1）；v2 按 PR #676 评审意见改了
> B1–B3（声明进签名 core、回报鉴权接 CLI claim 与 pin key、home 限团队宿主）。档位**高档**，
> 按 [superagent-a2a-plan](superagent-a2a-plan.md) 通用规则须 design_pass，实现 PR 须在 exact
> head 非自我评审。本文只提案，不改任何行为。

配套：[superagent-v5-canvas-team](superagent-v5-canvas-team.md)（R4 被本文修订）、
[superagent-a2a-spec](superagent-a2a-spec.md)。

## Context

Pi（`@earendil-works/pi-coding-agent` 一类的外部 coding harness）目前只能以"野生桥"参与
superagent 团队：工作区本地扩展轮询 CLI 邮箱、唤醒固定会话（生产验证：fleet-ops-pi 席位，
cursor 制 v2 桥已运行），席位 init、publish、canvas 建链全部手工。目标是让 Pi 成为**受支持
的成员平台**：随包发行、一条命令安装、以正式成员身份接单/回报。

现有积木（全部已在主干）：

- 成员派发三路（`host/index.ts` `deliverToMember`）：子队 `root.send`；远程成员
  `signedPost /a2a/superagent-member`（PR-C2）；否则本地 `deliverToSession`。返回 false 时
  executor 记 `engine.deliveryFailed`（既有重试/改派语义）。
- `CliDepositStore.mail(handle, from, text, dup?, thread?)` 可写成员邮箱，`thread` 即
  p1-context-read 的任务/上下文元数据。
- `remoteEvent` 已有成员侧操作词表 `report / ack / handback / read / idle / error`，按
  属主 pin 的 key 鉴权（PR-C2，`settings.remoteMembers[].key`）。`/a2a/superagent-team`
  面要求签名且 body-bound 的 OriginClaim，目前按**节点卡**验签（未开 `cli`）。
- 卡片签名只覆盖 core：`name / session / team / capabilities / expiresAt / records`
  （`src/card.ts` `canonicalPayload`）。CLI 身份已有在**自己签名卡的 `capabilities`** 上
  声明布尔能力的先例（superagent-root-team S5，`index.ts` `callerCapability`）。
- canvas 行可 pin key（`canvasStore.addMember(..., { ownerKey })`，v5 D1/D4）；但今天 CLI
  handle 入 canvas 时 `canvasMemberForWrite` 不带 `ownerKey`。
- v5 **R4：队 canvas 不收 CLI handle**——CLI 定位是 Source/请求方，不是成员。

## 提案（Decisions）

- **P1 pi 席位＝带平台声明的 CLI 身份；声明在签名 core 里。** 席位在自己的 deposit 卡上
  声明 `capabilities.piSeat === true`。`capabilities` 在签名 core 内，宿主或中间人加不上、
  改不掉；顶层新字段不在签名内，**不采用**。也不扩 `canonicalPayload`（那会改 wire 契约，
  旧宿主会把新卡判 `bad-signature`）。读取沿用 S5 `callerCapability` 的本机 deposit 读法。
  R4 修订为：**canvas 不收未声明 `piSeat` 的 CLI handle**。普通 CLI 仍被拒，现有语义不变。
  （属主 2026-11-13 已同意。）
- **P2 入队即 pin key；home 必须是团队宿主。** pi handle 入 canvas 时，`canvasMemberForWrite`
  要求它在**本机**有 live deposit 且卡声明 `piSeat`，并返回 `ownerKey = deposit 卡
  publicKey`，写进 canvas 行（与远程 ref 的 `ownerKey` 同构）。不满足就拒，原因写明：
  未声明 → "CLI handle 不是 pi 席位"；deposit 不在本机 → "pi 席位须 deposit 在团队宿主上
  （home=本机）；异机 home 本版不支持"。异机 home 经 host forwarding 是后续非目标，不在本版。
- **P3 派发＝邮箱写入（第四路）。** `deliverToMember` 在落到 `deliverToSession` 之前识别
  pi 席位（canvas 行为 CLI handle 且带 pin key）：本机 deposit 仍在、且其 publicKey 等于
  pin key → `CliDepositStore.mail(handle, 'superagent', 卡片, undefined, { task: ticketId })`
  并返回 true；deposit 过期、被删或换 key → 返回 false，走既有 `engine.deliveryFailed`
  （不新增重试逻辑）。换 key 的席位须属主重新入 canvas 才会再 pin。`assignmentCard` 出 pi
  变体：报告方式写 CLI 命令，不写 `a2a_ticket_report` 模型工具。
- **P4 回报＝CLI 签名 ops，同一张面、同一词表。** 新 CLI 子命令 `a2a-net ticket report|ack|
  handback|idle|read|error`，用席位 key 做**签名且 body-bound** 的 OriginClaim，POST 团队宿主
  `/a2a/superagent-team`。宿主侧三处改动：
  1. 该面验签时开 `cli: true`（`verifyOriginClaim(req, { rawBody, cli: true })`）。CLI claim
     只能对**本机 deposit** 验出（与 P2 的 home 限制一致），`bound`/`bodyBound` 要求不变。
  2. `claimCovers(body.member, claim.caller)` 不变：CLI claim 的 `caller` 就是完整 handle，
     须与 `member` 完全相等（CLI handle 无 `/` 子路径）。
  3. 成员查找：`remoteEvent` 先查 `remoteMembers`（不变），未命中时查 pi 席位——canvas 行
     handle == `member`、pin key == `claim.card.publicKey`、且 `claim.cli === true`。命中后
     映射到同一组 `executor.memberIdle / memberRead / memberError / report / takeUp`；
     未命中返回既有 `not-member`（照常记 refusal）。节点 claim 不能冒充 pi 席位，CLI claim
     也不能冒充远程 ref：两路各自要求 claim 形状。
- **P5 生命周期完全复用 `MemberExecutor`。** 槽位、停靠、重试、中断恢复不变——它由事实
  驱动，与传输无关；`outlivesRestart` 对 pi 席位为 false。唤醒延迟＝邮箱轮询（v2 桥实测
  15s 级）。`kind: 'stop' | 'input'` 同样走邮箱，席位在一轮中途读不到：R6（中途移除即停止）
  对 pi 席位在**下一次轮询**生效，期间的 report 按既有规则（已非成员 → `not-member`）拒收。
  常驻 serve 节点/长连接优化为后续非目标。
- **P6 发行与安装。** 扩展文件随 npm 包（`pi/extension/`），`a2a-net pi install` 一条命令：
  复制扩展到 `~/.pi/extensions/`（或 `--dir`）→ 校验 node ≥ 22 → 引导席位 `init`/`publish`
  （卡上 `capabilities.piSeat: true`，deposit 到团队宿主）→ 打印 canvas 建链步骤。**准入仍是
  属主 canvas 动作**（N3 不变：安装不等于入队）。
- **P7 代码落位：新建 `src/superagent/platforms/`。** 该目录在 `next/0.8` 上尚不存在，由
  PR-B 新建：成员平台适配（派发谓词＋卡片变体＋成员查找）独立成模块（`platforms/pi.ts`＋
  目录 README），`host/index.ts` 只留路由；为后续其他 harness 平台立样板。

## 验收（按实现 PR）

- unit：
  - P1/R4：无 `piSeat` 的 CLI handle 入 canvas 仍拒；顶层 `platform` 字段（不在签名内）
    不算声明。
  - P2：deposit 不在本机 → 入 canvas 拒且原因写明；入队成功后 canvas 行 `ownerKey` ＝
    deposit publicKey。
  - P3：派发第四路（pi handle → `mail` 带 `thread.task`）；deposit 消失或换 key →
    返回 false 并记 `deliveryFailed`。
  - P4：`/a2a/superagent-team` 收 CLI claim。pin key 对 → 映射到 executor；pin key 错、
    节点 claim 冒充 pi handle、CLI claim 冒充远程 ref → `not-member`/`not-signer`；
    非 body-bound → `untrusted-origin`。
- wire：`publish`（带 `piSeat`）→ canvas 加席（pin key）→ assignment → `inbox --after` 读到
  `thread.task`；`a2a-net ticket report` 往返落到 executor.report。
- 安装冒烟：`pi install` 装到临时目录＋扩展 tsc 严格类型检查通过。

## PR 拆分

| PR | 内容 | 档位 |
|---|---|---|
| PR-A | 本设计稿 | 高档（design_pass） |
| PR-B | host：`platforms/`＋入队 pin key＋派发第四路＋`superagent-team` 面开 CLI claim＋pi 卡片＋unit/wire。实现：席位 key 存 canvas 的 `seatKeys`（不进 `memberOwners`，那里只收限定会话 ref）；队成员里 pi 席位是带 `platform: 'pi'` 的远程成员行；卡片里的 CLI 命令名以 PR-C 落地为准 | 高档（准入语义变更） |
| PR-C | CLI `ticket` 子命令＋扩展打包＋`pi install`＋README 安装节。实现：`publish --pi-seat` 声明；`ticket` 六词走 body-bound CLI claim；扩展 `pi/extension/a2a-seat.ts` 装到 Pi 文档规定的 `~/.pi/agent/extensions/`（P6 原写 `~/.pi/extensions/`，以 Pi 1.5 文档为准），用自己的 `inbox --after` 游标；严格类型检查对照本仓 `pi-api.d.ts`（按 Pi 1.5.2 的类型声明摘取的子集） | 高档（评审席可酌情降中档） |

全部 base＝`next/0.8`；正文只写 Refs；不 force-push；测试退出码挡提交。

## 非目标

- 不改 A2A 回执/任务语义（成员 report ≠ task receipt；`receipt --tickets` 不动）。
- 不做常驻连接/websocket 唤醒。
- 不支持 home 在异机的 pi 席位（不走 host forwarding）。
- 不改卡片签名 core 与 wire 契约。
- 不放松 N3 准入；不给安装过程任何入阈权限。
