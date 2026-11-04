# 发布纪律（release discipline）

> 2026-10-21 立，源自 K3 测试章前瞻（cordis 事故线收尾）：两项与「锁重生成 × 环境策略」
> 交互的坑，已实测咬人，故入档为纪律。

## 0. 0.6.39 升级提示（#282 做减法 S1–S3）

- **canvas 带属主指纹的 id**（S2）：`a2a-net teams` 以及状态面的 `canvas.teams[].id`、`peerOrg[].org[].id`，现在把 canvas 行显示为 `<zone>/canvas/<name>@<fp8>`（属主名片公钥的指纹）。`teams --json` 的 `team` 字段也是这个 id，读这个字段的脚本请按需取 `@` 之前的部分。不带后缀的旧写法路由行为不变。新建 canvas 不能再以 `@<8 位十六进制>` 结尾；已存在的同名 canvas 照常加载，用完整 id 访问。
- **同队即授权**（S3）：CLI 转发到远端 canvas 时，home 只需链接 canvas 的**属主主机**，不再要求逐个链接接收成员。成员回执只有满足以下全部条件才放行进 CLI 信箱并结算：来自转发出生时冻结的接收成员；由选中对端的名片公钥签名；签名为绑定请求体的 Sig3。因此**属主主机须 ≥ 0.6.37**，否则回执退回旧规则，需要链接成员。未链接成员发来的自由消息照旧需要链接。
- **拒绝给下一步**（S1）：转发、排队已满、准入、防刷屏的拒绝新增 `next` 字段，CLI 打印为 `[route] next: …`。拒绝原文与错误码不变；幂等 409 的响应体是冻结接口，未改。
- **独立网络节点 `a2a-net serve`**（#295）：不依赖 DSH 实例运行网络层，包括名片、对端目录、CLI 户口与信箱、一跳转发、canvas 归属、任务账本、状态面和工作台。它不托管 AI 会话，投递会话仍转发给 DSH 宿主。安装需要一组固定版本的运行时依赖，`installLine` 给出完整的 `npm i` 行（npm 上的 `latest` 标签较旧，不能用）。绑定 `0.0.0.0` 时必须配 `apiKey`。用法见 `references/cli.md`。
- **#291 兼容 harness ≥0.2.2-rc**：宿主的 `AgentRegistry` 没有 `roots()` 时，改用 `list()` 按委托深度过滤，会话发布和恢复不再因 TypeError 回滚（历史会话从列表消失的事故）。旧宿主语义不变。
- 本版无配置默认值变化，无需回滚预案。

## 0. 0.6.38 转发默认值升级提示

- **状态面 `boundMissRecent`**（#273，#64 关窗前置，0.6.38 起）：列出谁的绑定签名对不上、拨的是哪个 origin，`a2a-net status` 的 `claims` 下显示 `miss` 行。把列出的 origin 加进对应主机的 `originClaimAudiences`。

从 0.6.38 起，未显式配置 `forwardDirect` 的宿主会默认启用已实现的一跳 CLI 转发。0.6.37 及以前默认关闭；已有显式 `false` 保持关闭。升级不会新建链接或扩大作用域，仍须已验签、在线的本机 CLI 户口、发送作用域、双方运营者链接、DEFAULT-1 跳数预算；入站带 Guard 或 isolated 主机不转发。

**回滚默认行为**：属主在相同配置层显式设 `forwardDirect: false`，再按宿主既有的安全生效流程应用；无需倒退发行包或删除队成员。升级和配置生效由属主安排，不由会话自重启生产。不要随此升级把 settlementAuth 默认切 enforce；#272 必须先经独立评审。长转发任务推荐 async + inbox，15 秒 sync 超时不代表未投递。#275：启用 enforce 前先核对状态面的 `settlement.enforceBlockers` 为空；0.6.34–0.6.37 的旧转发 canvas 欠账缺接收成员事实时，拒绝的是 enforce 模式而非插件启动：运行态退回 observe 保持在线并记 error，状态面 settlement.mode=observe、enforceRefused:{reason,blockers} 列启动拒因和 task id，CLI tasks --json 原样带回（tasks/status 文本也可见）；保持 observe 对账处理（含 dead 未结行），不写回持久配置且清账后不自动升档，不得用当前画布成员补造旧授权。

## 1. cordis 归一 override 的单一归属纪律

overrides **只在 `pnpm-workspace.yaml#overrides`**（pnpm ≥11.24 读取）：

```yaml
'@deepseek-ai/cordis': 4.0.5
'@deepseek-ai/cordis-plugin-loader': 1.0.5
```

动机：图内 102 个 dsh-\* 包 peer 钉死 cordis 精确 4.0.1、61 个插件线 peer 要求 ~4.0.4，
范围互斥——无 override 的任何锁重生成都会双实例回潮（类型增广裂解 → 干净检出必红，
事故 0e32ae1）。锁重生成后以
`grep -cE "^@deepseek-ai\+cordis@4" node_modules/.pnpm`（期望 1）复核。

沿革：2026-10-21 立规时为「`package.json#pnpm.overrides`（pnpm <11.24 读取）+ workspace.yaml 双文件同值」。
**2026-10-25 起 `package.json#pnpm` 镜像退役**（gh#46 修复轮 a3a57b8）：pnpm 11.28 的 verify-deps
在该字段存在时拒跑一切 pnpm 脚本，且舰队三机已归一 pnpm 11.28.5、无 pre-11.24 读者。
现行约束（监督 S7 机器核对）：`package.json` **不得**再出现 `pnpm` 字段；`packageManager`
钉 `pnpm@11.28.5`，`engines.pnpm` 为 `>=11.24 <12`。

## 2. minimumReleaseAge × 锁重生成发布窗口

锁重生成会把「窗口期内的新版包」写进锁（如 fast-uri@3.1.9）；此后**所有**干净检出
`pnpm install --frozen-lockfile` 都被 minimum-release-age 策略拦死——不是缓存问题，
是策略按锁内版本的发布时间判定。

纪律：
- 候选期/发布窗口内做干净检出安装，统一带 `--config.minimum-release-age=0`；
- 无法带 flag 的环境（CI 模板等）：把窗口期新包加进 `pnpm-workspace.yaml`
  的 `minimumReleaseAgeExclude` 列表（现列 dsh-\* 0.1.2-alpha.3 六件）；
- 锁重生成提交前，本机跑一次干净检出 frozen install 复核（gold standard）。
