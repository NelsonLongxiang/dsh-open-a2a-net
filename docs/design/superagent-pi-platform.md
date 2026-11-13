# superagent pi platform：Pi 席位成为正式成员（设计稿 v1）

> 状态：设计稿，待属主评审。档位自评**高档**（改成员模型语义，v5 R4 修订），按
> [superagent-a2a-plan](superagent-a2a-plan.md) 通用规则须 design_pass，实现 PR 须全局
> 生产评估在 exact head 非自我评审。本文只提案，不改任何行为。

配套：[superagent-v5-canvas-team](superagent-v5-canvas-team.md)（R4 被本文修订）、
[superagent-a2a-spec](superagent-a2a-spec.md)。

## Context

Pi（`@earendil-works/pi-coding-agent` 一类的外部 coding harness）目前只能以"野生桥"参与
superagent 团队：工作区本地扩展轮询 CLI 邮箱、唤醒固定会话（生产验证：fleet-ops-pi 席位，
cursor 制 v2 桥已运行），席位 init、publish、canvas 建链全部手工。目标是让 Pi 成为**受支持
的成员平台**：随包发行、一条命令安装、以正式成员身份接单/回报。

现有积木（全部已在主干）：

- 成员派发三路（`host/index.ts` `deliverToMember`）：子队 `root.send`；远程成员
  `signedPost /a2a/superagent-member`（PR-C2）；否则本地 `deliverToSession`。
- `CliDepositStore.mail(handle, from, text, dup?, thread?)` 可写成员邮箱，`thread` 即
  p1-context-read 的任务/上下文元数据。
- `remoteEvent` 已有成员侧操作词表 `report / ack / handback / read / idle / error`，按
  属主 pin 的 key 鉴权（PR-C2，`settings.remoteMembers[].key`）。
- canvas 行本就 pin key（v5 D1/D4：远程引用＝pin 的 key）。
- v5 **R4：队 canvas 不收 CLI handle**——CLI 定位是 Source/请求方，不是成员。

## 提案（Decisions）

- **P1 pi 席位＝带平台声明的 CLI 身份。** deposit 卡新增 `platform: 'pi'` 声明（卡片是
  签名的，声明不可伪造）。R4 修订为：**canvas 不收无平台声明的 CLI handle**。普通 CLI
  仍被拒，现有语义不变。
- **P2 派发＝邮箱写入（第四路）。** `deliverToMember` 识别"canvas 行是 pi 声明的 CLI
  handle 且在本机有 deposit"→ `CliDepositStore.mail(handle, 'superagent', 卡片, undefined,
  { task: ticketId })`。`assignmentCard` 出 pi 变体：报告方式写 CLI 命令，不写
  `a2a_ticket_report` 模型工具。
- **P3 回报＝CLI 签名 ops 走既有词表。** 新 CLI 子命令 `a2a ticket report|ack|handback|
  idle|read|error`（席位 key 签名，POST 团队主机 `/a2a/superagent-team`）；宿主按 canvas
  行 pin 的 key 鉴权后映射到 `executor.memberIdle / memberRead / memberError / report /
  takeUp`（与 PR-C2 `remoteEvent` 同一规则，member ref＝handle）。
- **P4 生命周期完全复用 `MemberExecutor`。** 槽位、停靠、重试、中断恢复不变——它由事实
  驱动，与传输无关；`outlivesRestart` 对 pi 席位为 false。唤醒延迟＝邮箱轮询（v2 桥实测
  15s 级）；常驻 serve 节点/长连接优化为后续非目标。
- **P5 发行与安装。** 扩展文件随 npm 包（`pi/extension/`），`a2a pi install` 一条命令：
  复制扩展到 `~/.pi/extensions/`（或 `--dir`）→ 校验 node ≥ 22 → 引导席位 `init`/`publish`
  （`platform: 'pi'` 声明）→ 打印 canvas 建链步骤。**准入仍是属主 canvas 动作**（N3
  不变：安装不等于入队）。
- **P6 代码落位 `src/superagent/platforms/`。** 成员平台适配（派发谓词＋卡片变体＋鉴权）
  独立成模块（`platforms/pi.ts`＋目录 README），`host/index.ts` 只留路由；为后续其他
  harness 平台立样板。

## 验收（按实现 PR）

- unit：派发第四路（pi handle → `mail` 调用带 `thread.task`）；ops 鉴权（pin key 对/错
  两例）；pi 卡片文案；R4（无 `platform` 声明的 CLI handle 入 canvas 仍拒）。
- wire：`publish`（带声明）→ canvas 加席 → assignment → `inbox --after` 读到
  `thread.task`；`a2a ticket report` 往返落到 executor.report。
- 安装冒烟：`pi install` 装到临时目录＋扩展 tsc 严格类型检查通过。

## PR 拆分

| PR | 内容 | 档位 |
|---|---|---|
| PR-A | 本设计稿 | 高档（design_pass） |
| PR-B | host：`platforms/` ＋派发第四路＋ops 鉴权＋pi 卡片＋unit/wire | 高档（全局生产评估） |
| PR-C | CLI `ticket` 子命令＋扩展打包＋`pi install`＋README 安装节 | 高档（评审席可酌情降中档） |

全部 base＝`next/0.8`；正文只写 Refs；不 force-push；测试退出码挡提交。

## 非目标

- 不改 A2A 回执/任务语义（成员 report ≠ task receipt；`receipt --tickets` 不动）。
- 不做常驻连接/websocket 唤醒。
- 不放松 N3 准入；不给安装过程任何入阈权限。
