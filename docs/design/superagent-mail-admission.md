# p1-mail-admission：信箱行带准入规则，加一个准入复查入口（设计稿第 1 版，中档）

依据：全局 2026-11-07 对 p3 设计 v1 的裁定（Q4 另立前置，以及 v1.1 第 4 条「O1 复查必须落在我们这边」），属主裁定 S36（三类可信来源都须在属主链接集内）。

这一节点只交付宿主事实，不改变任何准入结论：
- 宿主已经算出的准入规则，原样写进信箱行；
- 给 CLI 身份加一个只读入口，按当前链接重算某个调用方投给自己时会命中哪条规则。

a2a-watch 不在本节点改动，Source 怎么用这两项见 p3。

## 上下文（next/0.8 ＠ f5380c2，代码已核对）

- **wire 面**：信箱分支之前已经有本次投递的 `admission`（wire.ts:698，结构为 `{ ok, rule, basis }`）。规则是闭集 `AdmissionRule`（task-auth.ts:23）。
- **进程内面**：准入为 `localCandidateAdmission(records, callerSession, team)`（index.ts:3534）。结果要么是 joined-face 的规则，要么是 `local-exempt`。
- **结算复查**：已有现成的判定（index.ts:2779）。`remote-ref-cli` 走 `recheckRemoteCliAuthorization`；local 入口走 `localCandidateAdmission`；其余走 `callerAdmission`。
- **信箱行**：现有 `proof`、`receipt_for`、`disposition` 三个字段。从快照恢复时，会用 `MAIL_PROOFS` 白名单清洗 proof（cli-deposit.ts:93）。
- **外发准入**：本机户口发起的外发，按 `cli-deposit` 直接放行（task-auth.ts:293），不看目标，也不看链接。所以「撤链之后外发被拒」只能靠 Source 自己复查，这也是本节点要提供复查入口的原因。

## 决策

### M-1 信箱行加 `admission`
- wire 面写信箱时，带上 `admission: admission.rule`；只写规则名，basis 不写进信箱行。
- 进程内面带上 `localCandidateAdmission(...).rule`。
- 恢复快照时，用 `MAIL_RULES`（即 AdmissionRule 的全集）白名单清洗；不认识的值直接丢弃，不会把某一行升格。
- `inbox --after` 和 `inbox --json` 按原样输出这个字段。
- 不写 basis（canvas 团队名），是为了不把运营者的拓扑扩散给 CLI 读者。复查入口需要的信息由 M-2 现算，不靠这里存的值。

### M-2 复查入口（只读）
- **控制动作**：在 cli-deposit 面加 `{ action: 'admission', handle, caller, ingress }`。
  - handle 是本机的已存户口，否则回 `{ ok:false }`。
  - 按 index.ts:2779 的同一套判定，重算「caller 投给 handle 时」的准入：
    - ingress 为 `local` 时，用 `localCandidateAdmission(records, caller, handle)`；
    - 其他情况用 `callerAdmission(records, caller, handle)`；
    - caller 是远程 CLI 时，只认该 caller 的 operator 链接和钉住的 home 这两项，在线状态与签名属于出生时的验证，复查不再要求。这与 `recheckRemoteCliAuthorization` 的取舍一致。
  - 返回 `{ ok: true, admitted: boolean, rule?: AdmissionRule }`。不返回 basis 和拒绝原因的正文，以免泄露拓扑。
- **CLI 命令**：`a2a-net admission <caller> [--local] --json`。以本身份的 handle 发出控制动作，打印单个 JSON 对象 `{ caller, admitted, rule }`；退出码 0 表示问到了结果（不论是否准入），1 表示运行错误，2 表示用法错误。
- **权限**：控制面照旧需要 key。这个入口只回答「某个 caller 投给我」的问题，不能拿来查别人的户口。

### M-3 兼容
- 老宿主的行没有 `admission` 字段，在 p3 里按 unlinked 处理（失败关闭）。
- 老宿主不认识 `admission` 这个控制动作，回 `{ ok:false }`，CLI 报运行错误（退出码 1）。
- 本节点对任何现有调用方都没有可见的行为变化，只是多了一个字段和一个只读入口。

## 后果
- **正面**：
  - p3 的 scope 可以按宿主事实，确定性地判定是否建链；
  - 外发之前的复查有了落点，而且就在 Source 所在的家宿主上，与对端宿主是否拒绝无关。
- **负面**：
  - 信箱行多一个字段；
  - 控制面多一个只读动作；
  - 复查会比收信时晚，链接在两次之间变了，结论也会变。这正是复查的用意。
- **推迟项**：basis 是否以摘要的形式提供给属主看板，另议。

## 测试计划
- **单元**：
  - `sanitizeMail` 丢弃未知的 admission 值；
  - 控制动作的参数校验，handle 不是本机户口时回 `{ ok:false }`。
- **mesh**：
  - canvas 成员投信，行带 `canvas-shared`；
  - 本机 CLI 投信，行带 `cli-deposit`；
  - 进程内会话投信，行带 joined-face 的规则或 `local-exempt`；
  - 复查：先在 canvas 内，得到 admitted:true 和 rule；属主从 canvas 里移除成员后再复查，变为 admitted:false；
  - 老格式快照恢复后没有这个字段，伪造的值被清洗掉。
- **反向变异**：
  - 不写字段；
  - 写成 basis；
  - 不清洗；
  - 复查用了收信时的旧值，而不是现算；
  - local 和 wire 两种判定用反。
