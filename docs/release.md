# 发布纪律（release discipline）

> 2026-10-21 立，源自 K3 测试章前瞻（cordis 事故线收尾）：两项与「锁重生成 × 环境策略」
> 交互的坑，已实测咬人，故入档为纪律。

## 下一 minor 候选：#356 sourced followup 投递切换（待高档评审/未发布）

- 任务同机/跨机、同步/异步均通过 `Agent.followup` 保来源排到独立下一轮；冷会话先走原 resolver。缺方法明确拒绝，不退回 steer、不排裸 kind:user。空闲对账提醒及本机发送方警示一并切换 sourced followup；提醒原空闲门/计数规则不变。
- 原子保存 taskId/MessageId/完整SessionId 对应，写失败不投递；已入队但最后记账未确认时保 reserved/unknown，不盲重发。未消费撤单用 updateQueue remove；竞态已claim与已消费任务仍即时steer停工。撤单保持结账优先：原cancel提交后通知尽力而为。新对端用原caller/key/body绑定控制，旧对端发原无task_id文本通知；目标消失或通知失败仍清caller行，但不假称消息已移除。任务投递缺followup仍明确拒绝，绝非steer兜底。
- 双端账本保存 consumed 观察，state/tasks/CLI 显 consumed 或 delivered-unconsumed。发送方只是本次peer答复快照，接收方可在确切claim后更新；未提供字段的旧peer仍未知。3条名额、receipt授权、15秒同步预算/-32005、S5/305/306归属不放宽。
- 旧reminder lastResult blocked不再是可写类型，旧盘按metadata-reset第3次/2h长退避恢复；只在业务终态停止。该候选属于对外投递语义变化，发布需minor，生产部署和存量操作另报；本PR不发布/不部署/不补现网积压。

## 下一候选：#351 持久空闲对账提醒（待高档评审/未发布）

- 主机仅在真实空闲时以带 A2A 来源/血缘的 steer 提醒会话本人逐条对账；忙时不注入、不计次。每会话多条欠账合并一条，原文 brief 最多160字符；不读日志代补、不发 ack、不自动撤单或结算。
- 次数/接纳观察、最近时间与下次提醒持久保存，前几次退避，第三次后长间隔约2小时持续提醒；直到原pending进入既有终态才结束。多次未对账可见并给本机发送方一次警示，不新增远端推送端点。
- 提醒不是任务、不产生欠账/不释放名额；3条上限、queuedFor计法、回执格式/授权、同步预算及消费轮归属不变。#356跟进独立投递迁移，提醒当前明确选定idle-only steer，不裸排kind:user。
- 提醒reserve先原子提交，写盘失败内部catch、不发送，状态显安全时间/错误码。元数据兼容旧账但无法唯一定位目标时只诊断；不触碰现有生产积压。代码合并/候选不代表生产部署授权。

## 下一候选：#334 画布来源确认（待评审/未发布）

- 新增普通会话成员 `zone/id8@fp8` 来源选择器与完整 SPKI 公钥锚；本机会话 picker 仍存完整 id，跨主机编辑不再新写未确认裸句柄。远端必须是已有可路由 seed/delegate 且当前有效名片能证明所选 host 的成员；minimal/离线/第三方无法验证时可见拒绝，不强取隐藏字段。
- 工作台逐槽位“确认来源”带 revision/原成员/原 owner CAS，原子替换保顺序并迁移暂停原因；确认不等于恢复，rejoin/普通重复 add 不确权也不恢复。已钉来源不能静默换 key；需要操作者检查后显式删除旧槽位，再添加有证明的新来源。
- 来源不明的历史裸成员在默认兼容窗口内保留旧读法，显示“来源未确认/兼容推断中”与统计；窗口关闭时不路由不授权，暂停始终无效。默认值仍 true，不按时间自动关闭、不替属主翻转。
- qualified 路由先选完整 owner key，再把 plain handle 发给选中且声明来源能力的 host；旧 host 可见拒绝并提示升级，不剥后缀向任意候选回退。CLI deposit/home、canvas-team @fp8 与旧债规则保持独立。
- 已有远端 `zone/id8@fp8` 槽位若没有 `memberOwners` 完整公钥锚，升级后即使兼容窗口开启也不算有效成员；它不会自动获来源，须由操作者逐槽确认。兼容窗口只保留历史裸 handle，不覆盖这类缺锚 qualified 记录。
- 不从升级回溯修复已丢成员；持久化仍用 v2/首次备份/磁盘 CAS。回滚须停写恢复备份，不准降级覆写。生产未部署。

## 0. 0.6.43 升级提示

**画布成员暂停（#335 / #338，数据安全修复）**：

- 本机 leave、archive 与按 session id 移除成员，不再根据卡片缓存推断删除裸句柄：只删本机精确 id / 无歧义的本机 @fp8；推断裸槽位保留并持久暂停。暂停后不路由、不授权、不计有效成员，也不经 rejoin/重复 add/重启恢复，须在工作台检查队伍后由操作者显式恢复或删除。
- #334 上线前，对端用裸 handle 删除属主按完整 session id 存的本机成员会可见失败（`ok:false`、成员保留），需要到属主本机明确删除；不再根据缓存推断连带删另一个槽位。
- `canvasLegacyBareMembers` 默认 `true` 保持未暂停裸成员的旧推断；state 有存量、实际解析、碰撞告警、暂停数与 epoch。当前不自动翻默认，不完成 #334 的来源确认或 qualified 路由。
- 首次写入 canvas formatVersion=2 前留 `.pre-v2` 备份；暂停与成员同文件原子提交、磁盘版本冲突拒写。暂停写失败会拒绝撤销成功回报，并暂时关闭本进程画布有效成员服务；修复文件后重启再检查。回滚旧版本须停写恢复备份，不能直接降级覆写。

**其他**：

- **fleet-canvas-op 非 2xx 一律按失败**（#320 / #326）：对端回 3xx/5xx 时，即使 JSON 体写着 `ok:true`，本机也报告失败并带状态码。
- **file fetch 认 home 声明的别名**（#332 / #333）：文件引用的来源若命中 home 自己声明的地址（`ownerHost` 或 `originClaimAudiences`），CLI 改从 home 的 URL 拉取，不再因同一主机的局域网 / Tailscale 双地址而拒绝；CLI 身份校验不放宽。
- **构建可复现**（#330 / #331）：浏览器 bundle 与 sourcemap 不再嵌入机器绝对路径；Windows 与 macOS 打出的包内文件 208/208 逐字节一致。
- **测试稳定性**（#325 / #329）：Windows 默认并发下的计时与 I/O 用例改为不依赖墙钟。
- 验证器：release-audit v2 新增 A8 判据（#336），评审席在同一候选上本地打的包与发布包的包内文件必须逐字节一致；本版起正式使用。

## 0. 0.6.42 升级提示

- **#312 名片隐藏内网引荐拓扑**：匿名、无效/过期签名以及与本机无关系的自签名陌生人均拿不到 `peers`。提供引荐须 OriginClaim 验签通过，且调用方是本机 `config.peers` 的显式 seed（根地址按 origin、挂载地址精确匹配），或既有 operator link 已成立；完整会话/组织字段仍须原完整名片链接门。现代签名取卡与双seed自举保留；仅匿名爬卡或未被对端seed/link的客户端须显式配置所需seed或建立链接，不提供恢复匿名拓扑的开关。签名 `discovery=1` 只减信息，有限回拨核同key/team，拓扑缓存不覆盖完整名片。
- **主机 team 兼容边界**：主机 `team` 必须满足 `^[a-z0-9-]+$`，不支持含斜杠的 `zone/canvas` 身份。启动会 warn，但不改配置、不拒启动或放宽签名形状；此类主机应迁到例如 `zone-canvas`。合法会话/画布路由名不因此改写，委派与签名核心不变。
- **打包换行一致**（#321）：新增 `.gitattributes`，文本一律检出为 LF，二进制资源不做换行转换。从这一版起，Windows 与其他平台打出的包应逐字节一致（构建时嵌入的源码路径注释除外）。打包机若是 Windows 上的旧工作树，需要先刷新检出，新规则才会生效。

## 0. 0.6.41 升级提示

- **安全（尽快升级）：对端请求不再跟随重定向**（#318 评审 R4）。以前所有对端请求都会跟随 3xx，`X-API-Key`（舰队 key 或链路 key）和签名头会被带到 `Location` 指向的主机；任何一个对端回一个跨源 302，就能把 key 引到第三方。0.6.40 及更早版本都有这个问题。现在所有对端请求都在 `peerFetch` 统一设置 `redirect: 'manual'`，3xx 一律按 HTTP 失败处理。**升级须知**：`peers` 里写的地址必须是对端的最终地址。例如走 Caddy 的节点要写 `https://域名`；写 `http://域名` 会因为被 301 到 https 而连不上。
- **#306 同步答复绑定消费任务的轮次**：带 task id 的同步请求只取真正读到该任务的轮次的答复，不再把目标正在处理的其他工作或下一轮的文字当成答案。同步等待与自动回执采用相同归属窗口；没有 task id 的旧调用仍使用原回落行为。
- **忙碌目标会有更多诚实的超时**：若真实答复超过既有 15 秒传输窗口，调用方可能收到 `-32005` / DELIVERED-UNSETTLED，而不是一段无关文字。投递不因此撤销；沿原 task id 对账，使用 async + inbox 等真实回执，切勿因超时新发任务。窗口和准入默认值不变。
- 回执仍完整保存；同步确实取得本任务的完成答复后，后续同任务回执继续按 #305 标记 `sync-answered`，不丢弃。placeholder、未消费及失败轮次不作为本任务完成证据。
- **链路 key `linkKeys`**（#317）：按对端单独配置 key，公网节点不必持有舰队 apiKey 也能互联。发往 `linkKeys` 里某个 origin 的请求带该链路 key；本机对端接口只在调用方 OriginClaim 验签通过、绑定到本次请求（受众绑定的 v2 信封，不接受只有 v1 的信封或挪用到别的路径的信封）、且签名者正是该 origin 时接受链路 key，POST 还要求 Sig3 绑定请求体；控制路由一律不接受。两端都要升级到 0.6.41，并配置同一把链路 key。不配置 `linkKeys` 的主机行为不变。
- **远端会话日志读取带上 key 和签名**（#318 评审 R2）：工作台读取对端会话日志的代理请求以前既不带 key 也不签名，对开了 key 的对端一直会 401。现在会带 OriginClaim，以及按目标选出的 key。
- 验证器：`scripts/verify-probe.mjs --release-audit` 留存发布物证据（#319），可以在发布后核对候选 SHA、tgz 哈希、文件清单、3081 验收以及两个 registry 回读的字节是否一致。

## 0. 0.6.40 升级提示

- **安全：反代转发的请求不再享受回环信任**（#308）。0.6.39 及更早版本里，同机反向代理（Caddy、nginx、隧道代理）以 `127.0.0.1` 连接节点，所有公网请求都被当成本机：配了 key 的主机会把 apiKey 写进工作台 HTML，没配 key 的主机控制面对公网完全开放。现在请求只要带 `X-Forwarded-For`、`Forwarded` 或 `X-Real-IP`，就不给回环信任；经代理带 key 访问照常可用。**对外开放的节点请尽快升级。** nginx 必须设置 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，Caddy 默认会带。经 pocket 隧道打开工作台不受影响（pocket 不写转发头）。
- **本机 IPv4 的选择改为局域网优先**（#311 / #313）。自动推导的 `lanIp` 按 RFC1918 → 其他非内部地址 → CGNAT（100.64/10，例如 Tailscale）排序，以前是取第一块网卡的地址；显式配置的 `originClaimUrl` 仍最优先。对端互联徽章把 `originClaimAudiences` 也算作本机地址。
  - **双网卡主机升级须知**：装了 Tailscale 的主机（如 .156），升级后名片地址和签名信封里的 `callerUrl` 会从 Tailscale 地址变回局域网地址。经 Tailscale 拨号的调用方（CLI、对端）会被计入 `boundMiss`，#64 关窗后会被拒；把 Tailscale 地址写进 `peers` 的对端，徽章会变回 stranger。解决办法：在该主机配置 `originClaimAudiences: ['http://<Tailscale 地址>:<端口>']`，升级后用 `a2a-net status` 的 `claims` 行（`boundMissInbound` 不再增长）以及 `peers[].link` 确认。
- **同步已答的转发，回执标为重复，内容不丢**（#298 / #305）。目标端只对“读到该任务那一轮”的最终答复带上 wire 字段 `reply_final: true`；home 把这份答复完整写回 CLI 后，同一成员发来、未被拒的回执原文照收，但标记为 `dup: "sync-answered"`，`a2a-net inbox` 折成一行显示，`--json` 给出整行。0.6.39 及更早的目标端不会发 `reply_final`，它们的回执一律不标记。
- **早到回执最多等 60 秒**（#298 / #300），等不到就按正常规则结算。这一项实际已随 npm 上的 0.6.39 包发出，见下节“发布偏差”。
- 测试与文档：CLI 子进程不再继承操作者的 `A2A_*` 环境（#303 / #304）；serve 测试的 Windows 路径断言（#310）；独立节点部署手册 `docs/guides/standalone-node.md`（#307，含公网 HTTPS 前置）。
- 无配置默认值变化；不需要回滚预案。

## 0. 0.6.39 升级提示（#282 做减法 S1–S3）

- **canvas 带属主指纹的 id**（S2）：`a2a-net teams` 以及状态面的 `canvas.teams[].id`、`peerOrg[].org[].id`，现在把 canvas 行显示为 `<zone>/canvas/<name>@<fp8>`（属主名片公钥的指纹）。`teams --json` 的 `team` 字段也是这个 id，读这个字段的脚本请按需取 `@` 之前的部分。不带后缀的旧写法路由行为不变。新建 canvas 不能再以 `@<8 位十六进制>` 结尾；已存在的同名 canvas 照常加载，用完整 id 访问。
- **同队即授权**（S3）：CLI 转发到远端 canvas 时，home 只需链接 canvas 的**属主主机**，不再要求逐个链接接收成员。成员回执只有满足以下全部条件才放行进 CLI 信箱并结算：来自转发出生时冻结的接收成员；由选中对端的名片公钥签名；签名为绑定请求体的 Sig3。因此**属主主机须 ≥ 0.6.37**，否则回执退回旧规则，需要链接成员。未链接成员发来的自由消息照旧需要链接。
- **拒绝给下一步**（S1）：转发、排队已满、准入、防刷屏的拒绝新增 `next` 字段，CLI 打印为 `[route] next: …`。拒绝原文与错误码不变；幂等 409 的响应体是冻结接口，未改。
- **独立网络节点 `a2a-net serve`**（#295）：不依赖 DSH 实例运行网络层，包括名片、对端目录、CLI 户口与信箱、一跳转发、canvas 归属、任务账本、状态面和工作台。它不托管 AI 会话，投递会话仍转发给 DSH 宿主。安装需要一组固定版本的运行时依赖，`installLine` 给出完整的 `npm i` 行（npm 上的 `latest` 标签较旧，不能用）。绑定 `0.0.0.0` 时必须配 `apiKey`。用法见 `references/cli.md`。
- **#291 兼容 harness ≥0.2.2-rc**：宿主的 `AgentRegistry` 没有 `roots()` 时，改用 `list()` 按委托深度过滤，会话发布和恢复不再因 TypeError 回滚（历史会话从列表消失的事故）。旧宿主语义不变。
- 本版无配置默认值变化，无需回滚预案。

**发布偏差（如实记录）**：npm 与 Gitea 上的 0.6.39 tgz（`dist.shasum 4799aa78…`）不是从 tag `v0.6.39`（bc8f423）打包的，而是从合并后的 master a2389ba 打包的，所以包内多了两样东西：
- #300：早到的转发回执等出生最多 60 秒，超时后照常结算。已评审并合入 master，行为是收紧。
- `nexus-stage/scripts/__pycache__/mockhost.cpython-312.pyc`：一个无害的多余文件。

tag 不移动，发布物也不撤回。0.6.40 起改为从候选 SHA 的干净检出打包，见 docs/release-gate.md。

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
