# ADR：画布成员来源锚与历史裸句柄迁移（#335 → #334）

状态：**review-337-r1 修订，待最终确认，仅设计，不含实现授权**。依据 ruling-334-335 与 review-337-r1；② v2/完整key/备份回滚、③ 第三方无验证事实拒新写已确认。①改为默认兼容窗口 + 持久暂停，先#335安全清理，再#334确认/投影/路由迁移。档位：中高，持久化/身份边界须非自我评审。

> 补记（2026-11-13）：已于 2026-11-05 经 PR#350（`f636331`，#334）合入 master；名片能力 `canvasMemberProvenance` 与按 owner key 路由已实现。上面的「仅设计」是合入前的状态。

## 上下文

当前成员是有序字符串。缓存里缺少peer的sessionTeams时，localHandleResolver把同zone/id8裸句柄读成本机；leave、local remove、archive prune再用这一可变读法删存储。单边seed/minimal/冷缓存可使对端成员位被误删，不能依靠2^-32概率或强取对端完整卡规避。

既有S2的@fp8仅适用于canvas team id（splitCanvasOwner只识别 /canvas/），不是session成员解析器。CLI身份 ops-cli/uuid16 另有deposit/home-pin，不得误当普通会话或拼@fp8。本设计不改link准入、不把名片的unsigned sessionTeams变成会话持钥证明。

## 决策

### 1. 存储、身份与证明

保留teams[].members有序字符串、上限与CLI pin字段；新增顶层formatVersion:2与可选memberOwners[qualifiedMember]=完整SPKI公钥（base64，验证格式），用于写入来源记录/指纹碰撞检测。新写入的qualified成员必须同事务带完整key；附表可缺仅为旧格式兼容，缺来源锚不得被当作新增远端授权。例：

```json
{
  "formatVersion": 2,
  "teams": [{"name": "ops", "members": [
    "session-aaaaaaaa11112222", "dsh/bbbbbbbb@1234abcd", "dsh/cccccccc"
  ]}],
  "memberOwners": {"dsh/bbbbbbbb@1234abcd": "<verified SPKI>"},
  "suspendedMembers": [{
    "team": "ops", "member": "dsh/cccccccc", "reason": "leave",
    "localSessionId": "session-cccccccc11112222", "at": "<ISO time>"
  }]
}
```

| 成员形状 | 解释 | 自动清理 / 本机资格 |
|---|---|---|
| 完整本机会话id（session/import等原合法id） | 本机registry精确存在/持久join记录，缺行时视为已失效本机id而非外机 | 按精确id清理；是否可路由仍查join/archive/唯一性 |
| zone/id8@本机fp8 | 指纹由本机持久节点公钥计算，owner记录若有须与本机全key一致 | 仅唯一匹配本机session、join允许时可读本机；清理按该id的精确qualified形状 |
| zone/id8@对端fp8 | owner key来自选定对端的验签有效卡核心，fp8按S2 sha256(SPKI DER)前8hex | 不随本机leave/remove/archive清理；远端路由仅限该key的既有可路由seed/delegate |
| 历史裸zone/id8 | **来源未确认**，不因缓存推断写入owner锚；非暂停时可在兼容窗口沿用旧读法 | 不自动删除；窗口开时按旧规则计入/授权/路由并计数，窗口关后不授权/不路由 |
| suspended 成员槽位 | 独立于来源类型的持久停用状态；保留原字符串和顺序 | 无论窗口开关均不路由、不计入有效成员/授权；仅owner control显式恢复或删除 |
| CLI完整句柄 | 原CLI deposit/home pin体系 | 原规则不变；分类先判CLI，再普通session-qualified格式 |

fp8是选择器，不是签名或授权。写入核完整key与fp8一致；若两个不同完整key同fp8、已钉key与候选key不符、或本机id8不唯一，报冲突并失败关闭，不能“选第一个”。改地址同key保持来源；换key不能把旧owner自动变成本机/新对端，需重新确认。保护来源记录不因缓存淘汰而消失。

### 2. 新写入与显式确认

- 本机picker直接传完整session id，服务端核registry/join；需要跨主机传本机成员时生成zone/id8@本机fp8。
- 远端picker同时选择host URL/已验签key与成员，不只选裸handle；服务端从既有可信候选卡核key/成员及原link权限，存qualified成员+owner全key。冷缓存可正常取卡，minimal/no session rows/离线导致来源不可确认时返回“待确认”，不强取完整卡、不自动fallback裸写。卡的session行仅作既有host声明，不能绕原授权。
- peer canvas-op编辑者与被加成员host必须分开：验签只证编辑者；若加其自身host的成员可用claim.card，第三方host必须独立匹配可验证候选/操作者选定owner，不能直接把编辑者fp贴到所有id。未升级peer送裸handle的新add拒绝并提示升级/本机确认；CLI原例外继续走pin规则。
- 历史unknown“确认归属”仅本机control动作：传expected旧成员值/owner key，服务端重核并**同优先级槽位原子替换**；保留原已确认等价成员的位置、去重，不做remove+add两个写入。记录actor/时间/旧新值/owner key，不记录秘密。确认本机必须明确选local session；确认远端必须有有效卡匹配host/key/member。没证据就保留unknown，不用zone/地址相似推断。

### 3. 迁移与分阶段发布

读取旧快照不自动重写、不以缓存填memberOwners；裸句柄派生unknown投影，完整id与CLI保持。首次v2写入前备份原快照，原子替换持久化，写失败保留旧文件。版本大于支持值拒写并可见告警，不静默降级。

**#335先行PR（不批量断开现有队）**：只收紧破坏性删除，自动删除仅精确local session id与可证明的@本机fp8；历史bare原样保留。新增 canvasLegacyBareMembers（默认 true），未暂停的历史裸成员在窗口内继续沿用旧推断授权/路由，不把推断升级为来源证明；窗口不是新写裸成员的许可。CLI原身份规则不受此开关控制。

**暂停优先于窗口**：leave、archive prune在删除join/挂载状态之前，对按旧推断属于该local session的裸成员槽位记录 suspendedMembers；本地按session id的remove-member也暂停该队的推断裸槽位，而非连带删。暂停只用推断决定“保守停用”，绝不决定删除/来源确权，记录reason/localSessionId/at。archive检查须含正在归档session，不能先过滤后漏记。标记与join撤销/成员变更在同一受保护写流程提交，暂停写失败则本次撤销不能报告成功，且当前进程仍拒该槽位服务；重启先恢复暂停标记再发布成员，不能出现窗口。不得静默将已失败的archive副作用当作成功；具体跨store一致性机制须实现PR说明。

suspended按(team name, 原始member字符串)精确键保存，跨重启/缓存淘汰、窗口翻转、rejoin、重复add都不自动清除；一个槽位可有多条原因，恢复须明确处理全部原因。所有本机/远端路由候选、scope授权、live/成员计数、名片canvasOrg/返回快照先排除暂停槽位；state检查视图仍列原成员并显示“已暂停（离开/归档/本地移除）”。即使后来卡片表明它可能是远端，也只告警/请操作者复核，不自动恢复。误暂停可恢复，不以避免误暂停为由误删。

显式恢复/删除仅本机owner control：要求当前版本/原槽位/当前暂停记录匹配并审计；普通join、peer canvas-op及重复add不能冒充恢复。恢复裸成员只清暂停，不确权：窗口开仍按旧推断并计数，窗口关仍unknown不可路由；确认来源与恢复是两个显式意图，不能确认归属时顺带撤销暂停；原子替换成员字符串时须在同一写入中将该槽位暂停记录迁到新值，不能因键改变丢暂停。操作者按原始成员明确删除槽位允许，不属于按session id连带清理。

**可观测性与关窗**：state单独列 canvasLegacyBareMembers 有效值；legacyBareMembers（当前仍需确认的裸成员存量）、legacyInferredMembers（当前按旧推断有效参与的槽位数）、legacyInferenceResolutions（本进程累计依赖推断的解析次数）、legacyCollisionWarnings（累计冲突告警，带有界最近例子）、suspendedMembersCount。区分来源unknown与活动推断，未知存量/暂停数跨重启由盘恢复；次数为进程累计，重启/配置变化标记统计起点，不能以重启归零伪装迁移完。只计实际资格/路由解析，不把state轮询本身累计成业务使用；警告不改原碰撞拒绝规则。

**#334随后PR**：补全来源确认UI、新写入与qualified路由；过渡窗口保留不变，unknown徽章和“兼容推断中”与“来源已确认”明确区分，暂停不显示有效live绿灯。逐槽位显式确认来源，保顺序；无法验证第三方不新写/不自动改owner（②③不变）。不把升级当天所有历史bare直接禁用。

**默认值翻转由属主另裁（同#64）**：#334确认工具上线、舰队各主机 legacyBareMembers/legacyInferredMembers 归零（含暂停裸项须确认或明确删除）、完整观察窗口内解析次数增量为0且碰撞告警增量为0，再由属主观察后决定是否关闭/翻转默认。累计次数不要求倒退归零；缺采样/重启不算零使用。不得自动按时间关窗，agent不得自行翻默认。关闭后unknown不路由不授权，不受暂停恢复影响；重开只恢复非暂停bare的旧兼容读法，不恢复suspended。

旧节点不会正确解释session@fp8，不能把后缀剥掉发给任意host。qualified路由先选owner key，再把plain team交给已选目标的原session route；所有转发/回执授权快照保留选定owner+精确member，不能因wire兼容抹掉来源。旧host无能力时可见拒绝并提示升级；不承诺旧版本读取v2后安全，回滚须停写并恢复备份，不能直接降版本覆写。

### 4. 调用点清单（按当前源码，实施前再grep复核）

| 位置 | 计划改动 |
|---|---|
| src/canvas-store.ts CanvasSnapshot/restore/persist/addMember/removeMember/dropMember | v2、owner锚、逐槽位suspended持久化/显式恢复、原子确认替换；重复add不复活 |
| src/canvas-id.ts + 独立member parser | 复用指纹算法，新增普通成员qualified解析；不扩大原splitCanvasOwner去误吃CLI/canvas名称 |
| src/index.ts pruneArchivedJoins / pruneCanvasMemberships | 证明local才删除；归档撤销前标记旧推断裸槽位暂停，常规prune不删除unknown/暂停记录 |
| src/faces/admin.ts leave / local canvas remove-member | 只删证明local；旧推断bare暂停留槽；owner显式恢复/删除校验槽位版本，join不恢复 |
| src/faces/admin.ts local add / fleet-canvas-op relay | 本机id/远端host+verified owner选取；relay不丢owner，第三方来源不借签名者冒领 |
| src/faces/wire.ts canvas-op add/remove | 编辑准入不变；qualified来源核对；不把裸入参映射成local后删另一槽 |
| src/index.ts localHandleResolver / ownCanvasHandleOf / canvasTeamsOfSession / canvasLocalMembersOf | 删除证明与旧兼容推断分离；先排暂停，窗口开保旧语义并计数，关后只认明确来源 |
| src/index.ts directoryPeerCandidates / local canvas tier / remoteTargets / direct-forward.ts | 所有路径先排暂停；窗口内bare旧路由计数，关闭后unknown拒绝，qualified先选owner再去plain target |
| src/tools/info.ts whoami/list/status/probe scope + src/canvas-discovery.ts | 窗口开时bare按旧语义，附推断标志/统计；暂停永不计有效成员，关窗后unknown不授权 |
| src/task-auth.ts 授权/receiverMembers/settlement、blob grant与CLI home检查 | 审计所有members消费者先排暂停；窗口内沿旧推断授权、记兼容来源；旧债不重写，不放宽CLI门 |
| nexus-stage/src/workbench.ts CanvasMemberRow；planning-member-handles.ts / canvas-ops.ts / picker/board | unknown/兼容推断/暂停徽章，显式恢复/删除/确认分离；UI服从后端有效成员，不再自行绕暂停 |
| src/config.ts + state/config文档面 | canvasLegacyBareMembers默认true，状态存量/解析次数/冲突统计及统计epoch，属主另裁关窗 |

### 5. 验收（真实mesh + 磁盘重启 + 工作台）

1. 同zone同id8 A/B，单边seed、minimal、冷/暖/过期/离线卡及重启：A leave/local remove/archive/prune均不删B@fpB或unknown；磁盘前后对账。
2. local完整id及A@fpA随leave/remove/archive精确清理；旧推断bare不删但持久暂停，窗口开也不路由/授权/计入有效成员（暂停存量仍统计）。rejoin、重复add、缓存变化、窗口重开和重启都不恢复；仅owner显式恢复/删除，确认归属不隐式恢复。暂停写失败/归档竞争须安全失败不报告假成功。
3. 升级默认窗口开启：非暂停历史bare的whoami/list/state/live/scope/路由保持旧推断行为，附unknown/兼容标志与解析统计；已知碰撞拒绝仍在，告警累计，冷暖卡不变持久来源。窗口关闭后unknown不路由不授权；暂停两种窗口均无有效绿灯/计数。归零判定用存量及观察期增量，不以进程重启假归零；属主未裁不自动翻默认。
4. 新local/remote写入均验证来源；恶意编辑者给第三方贴自身fp、错key/fp、fp冲突、缺卡/受link限制均拒。API换userinfo/URL或同zone不改变来源；不泄露隐藏sessionTeams。
5. 两同zone/id8不同fp的远端精确路由到所选host，key变更不自动迁移；其余link/scope/key/recursion/receipt门回归。不把未升级peer裸add或旧债转成新来源证明。
6. 迁移不丢顺序、不增cap、不自动写；原子确认并发expected冲突不覆盖他人修改；失败留原文件；v1/v2 backup/恢复路径可实测。CLI home/grant/文件、同队settlement、S2 canvas id、已有成员拒绝回路的反例保留。

## 后果

安全收益：不再用缓存推断作为破坏性删除证据，未知槽位可恢复暂停而非误删；默认窗口保旧推断以避免升级断队，因此窗口内未消除#334的旧读法风险，须计数/告警推动显式确认与后续关窗。代价：历史裸handle需要操作者确认，误暂停须人工恢复，旧peer需升级，新增owner/原子迁移与UI工作。不会修复既往已丢成员（只能从备份/操作者意图恢复）。fp8沿裁定兼容S2，但不承诺抗恶意32位碰撞；保存全key并对歧义失败关闭。

已按review-337-r1修订①：#335只紧删除，默认兼容窗口保裸成员旧授权/路由；撤销用持久暂停兜底，计数归零后由属主另裁关窗。②v2/full-key/备份回滚与③无第三方事实拒新写已确认不变。配套[迁移状态设计图](../arch/canvas-member-provenance.drawio)仅表达拟议状态，不是当前运行架构或部署证明。**本修订待最终确认，不开始实现**。
