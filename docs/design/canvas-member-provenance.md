# ADR：画布成员来源锚与历史裸句柄迁移（#335 → #334）

状态：**待评审席确认，仅设计，不含实现授权**。依据 ruling-334-335 / 两单2026-11-05裁定；先#335安全清理，再#334完整投影/路由。档位：中高，持久化/身份边界须非自我评审。

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
  "memberOwners": {"dsh/bbbbbbbb@1234abcd": "<verified SPKI>"}
}
```

| 成员形状 | 解释 | 自动清理 / 本机资格 |
|---|---|---|
| 完整本机会话id（session/import等原合法id） | 本机registry精确存在/持久join记录，缺行时视为已失效本机id而非外机 | 按精确id清理；是否可路由仍查join/archive/唯一性 |
| zone/id8@本机fp8 | 指纹由本机持久节点公钥计算，owner记录若有须与本机全key一致 | 仅唯一匹配本机session、join允许时可读本机；清理按该id的精确qualified形状 |
| zone/id8@对端fp8 | owner key来自选定对端的验签有效卡核心，fp8按S2 sha256(SPKI DER)前8hex | 不随本机leave/remove/archive清理；远端路由仅限该key的既有可路由seed/delegate |
| 历史裸zone/id8 | **来源未确认**，无论warm/cold、有无同名local，都不据此补来源 | 不自动清理、不计本机、不得作为成员授权/路由资格 |
| CLI完整句柄 | 原CLI deposit/home pin体系 | 原规则不变；分类先判CLI，再普通session-qualified格式 |

fp8是选择器，不是签名或授权。写入核完整key与fp8一致；若两个不同完整key同fp8、已钉key与候选key不符、或本机id8不唯一，报冲突并失败关闭，不能“选第一个”。改地址同key保持来源；换key不能把旧owner自动变成本机/新对端，需重新确认。保护来源记录不因缓存淘汰而消失。

### 2. 新写入与显式确认

- 本机picker直接传完整session id，服务端核registry/join；需要跨主机传本机成员时生成zone/id8@本机fp8。
- 远端picker同时选择host URL/已验签key与成员，不只选裸handle；服务端从既有可信候选卡核key/成员及原link权限，存qualified成员+owner全key。冷缓存可正常取卡，minimal/no session rows/离线导致来源不可确认时返回“待确认”，不强取完整卡、不自动fallback裸写。卡的session行仅作既有host声明，不能绕原授权。
- peer canvas-op编辑者与被加成员host必须分开：验签只证编辑者；若加其自身host的成员可用claim.card，第三方host必须独立匹配可验证候选/操作者选定owner，不能直接把编辑者fp贴到所有id。未升级peer送裸handle的新add拒绝并提示升级/本机确认；CLI原例外继续走pin规则。
- 历史unknown“确认归属”仅本机control动作：传expected旧成员值/owner key，服务端重核并**同优先级槽位原子替换**；保留原已确认等价成员的位置、去重，不做remove+add两个写入。记录actor/时间/旧新值/owner key，不记录秘密。确认本机必须明确选local session；确认远端必须有有效卡匹配host/key/member。没证据就保留unknown，不用zone/地址相似推断。

### 3. 迁移与分阶段发布

读取旧快照不自动重写、不以缓存填memberOwners；裸句柄派生unknown投影，完整id与CLI保持。首次v2写入前备份原快照，原子替换持久化，写失败保留旧文件。版本大于支持值拒写并可见告警，不静默降级。

**#335先行PR**：封装清理谓词，仅精确local id或@本机fp8可自动删；历史bare保留。必须同时把unknown从本机资格/consent判定中移除（最小安全联动），否则“保留但还路由”会留下撤consent后门；本步不完成全部#334 UI，但先暴露unknown状态及阻断原因。这不是允许留着旧可变localHandleResolver继续授权。

**#334随后PR**：补全新写入/确认UI、全部投影和qualified远端路由；至少要与来源格式基础同步上线，不能把qualified存成永久不可识别。历史unknown显示徽章“来源未确认”，不显示本机live/绿色成员或计入scope；由操作者选择local/明确host确认，不自动批量迁移。

旧节点不会正确解释session@fp8，不能把后缀剥掉发给任意host。qualified路由先选owner key，再把plain team交给已选目标的原session route；所有转发/回执授权快照保留选定owner+精确member，不能因wire兼容抹掉来源。旧host无能力时可见拒绝并提示升级；不承诺旧版本读取v2后安全，回滚须停写并恢复备份，不能直接降版本覆写。

### 4. 调用点清单（按当前源码，实施前再grep复核）

| 位置 | 计划改动 |
|---|---|
| src/canvas-store.ts CanvasSnapshot/restore/persist/addMember/removeMember/dropMember | v2、owner锚、unknown分类、原子确认替换；通用store精确删除不猜host |
| src/canvas-id.ts + 独立member parser | 复用指纹算法，新增普通成员qualified解析；不扩大原splitCanvasOwner去误吃CLI/canvas名称 |
| src/index.ts pruneArchivedJoins / pruneCanvasMemberships | 两类prune均按精确来源清理，不用remote cache决定持久化删除 |
| src/faces/admin.ts leave / local canvas remove-member | local id只删其id与@本机fp8；unknown原样；显式“删除这个unknown”仍是操作者直接动作，不是按local id连带删 |
| src/faces/admin.ts local add / fleet-canvas-op relay | 本机id/远端host+verified owner选取；relay不丢owner，第三方来源不借签名者冒领 |
| src/faces/wire.ts canvas-op add/remove | 编辑准入不变；qualified来源核对；不把裸入参映射成local后删另一槽 |
| src/index.ts localHandleResolver / ownCanvasHandleOf / canvasTeamsOfSession / canvasLocalMembersOf | 只用明确来源、唯一local id8，移除“peer无行即本机”推断 |
| src/index.ts directoryPeerCandidates / local canvas tier / remoteTargets / direct-forward.ts | owner选择后才去plain session target；unknown显式失败；相同fp不同key拒绝 |
| src/tools/info.ts whoami/list/status/probe scope + src/canvas-discovery.ts | unknown不计local scope/成员授权，qualified匹配包含owner；不得通过去后缀碰撞扩圈 |
| src/task-auth.ts 授权/receiverMembers/settlement、blob grant与CLI home检查 | 审计所有members消费处；新任务快照保owner；旧债保持旧证据不可篡改，不把unknown新增为接收方；CLI不借机扩权 |
| nexus-stage/src/workbench.ts CanvasMemberRow；planning-member-handles.ts / canvas-ops.ts / picker/board | provenance/local/remote/unknown字段；徽章、显式确认/冲突反馈；不在UI凭id8再次猜本机 |

### 5. 验收（真实mesh + 磁盘重启 + 工作台）

1. 同zone同id8 A/B，单边seed、minimal、冷/暖/过期/离线卡及重启：A leave/local remove/archive/prune均不删B@fpB或unknown；磁盘前后对账。
2. local完整id及A@fpA随leave/remove/archive精确清理；本机已撤join/archived成员绝不因unknown残留继续路由。两local id8冲突拒解析。
3. 历史bare在whoami/list/state/live/scope/卡片发布中不冒充local，徽章unknown且无本机绿灯；缓存由空→热或反向不改来源/存储。显式确认一次后稳定，重启仍不回unknown。
4. 新local/remote写入均验证来源；恶意编辑者给第三方贴自身fp、错key/fp、fp冲突、缺卡/受link限制均拒。API换userinfo/URL或同zone不改变来源；不泄露隐藏sessionTeams。
5. 两同zone/id8不同fp的远端精确路由到所选host，key变更不自动迁移；其余link/scope/key/recursion/receipt门回归。不把未升级peer裸add或旧债转成新来源证明。
6. 迁移不丢顺序、不增cap、不自动写；原子确认并发expected冲突不覆盖他人修改；失败留原文件；v1/v2 backup/恢复路径可实测。CLI home/grant/文件、同队settlement、S2 canvas id、已有成员拒绝回路的反例保留。

## 后果

安全收益：不可再用“看不到远端行”证明local，不因缓存变化误删别host；代价：历史裸handle需要操作者确认，旧peer需升级，新增owner/原子迁移与UI工作。不会修复既往已丢成员（只能从备份/操作者意图恢复）。fp8沿裁定兼容S2，但不承诺抗恶意32位碰撞；保存全key并对歧义失败关闭。

待确认：①#335安全PR包含“unknown不授权”的最小联动，再#334补全是否符合顺序；②v2/full-key附表及旧版本回滚策略；③peer第三方成员无法取可见验证事实时采用“拒新写/保unknown”而非静默裸写。**本设计未确认前不修改实现**。
