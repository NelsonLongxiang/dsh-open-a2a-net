# #334 成员来源确认、投影与路由交付核对

派单direct-1df47d089b0c，依据已合设计PR337及issue334第4/5裁定；基线最新master4ee0e5d，独立分支feat/334-canvas-member-provenance。中高档，须非作者精确head PASS，未合并部署。#349ddac3de冻结不改；scripts/verify-*、verify/、AGENTS及#343实现文件不改。

## 实现边界

- 普通session成员解析在独立canvas-member模块，CLI与canvas-team S2解析保持独立。fp8仅选择器；新qualified写同事务保存有效Ed25519 SPKI完整公钥，错key/fp拒写，已钉key不自动换。配置仍默认canvasLegacyBareMemberstrue。
- 本机picker存完整session id，跨主机编辑生成session@本机fp；远端picker明确host，服务端只认已可路由seed/delegate且当前有效验签card及原link关系。编辑者与被加host分开核，不以第三方sessionTeams转授本机来源；minimal/无卡/第三方不可证则拒新写，未升级peer裸add可见失败。
- 历史bare不自动重写/填key，窗口开保旧推断并标unknown/compatibilityInference，统计epoch及实际解析次数原有语义保留；关窗后unknown不路由/授权；暂停先排于所有有效读法。
- owner-control confirm-member带revision/原slot/expectedOwner，核同handle后同优先级原子替换；目标等价成员已存在则保其原优先级。暂停原因同事务迁移，不恢复；相同独立原因可能碰撞时拒合并请操作者处理，不吞掉原因。确认后再次leave仍保已暂停slot，防孤悬暂停记录。普通重add不确权/不恢复。审计logger记录actor/time/旧新/完整公钥，无秘密。
- 读whoami/discovery/list/status/probe与路由资格使用相同有效成员。qualified本机需唯一joined/archive检查，foreign来源不会因同id8成为本机。caller-only来源视图与target本机registry分离，绑定已验OriginClaim完整signer key；不以外部同zone签名借本机slot。文件grant与回执保selected peer key，旧债不改。
- 远端dispatch先按已钉完整key选既有可信候选，再发plain handle；无锚/错key/碰撞失败关闭，无匹配不回退任意host。旧host未声明canvasMemberProvenance能力可见拒绝升级。地址同key沿目录候选可解析；换key须操作者检查、显式删除旧slot再加新slot，不静默迁key。
- 工作台逐槽显示来源未确认/兼容推断/已暂停，显式来源选择与恢复动作分离，CAS失败原slot保留；轮询同版本保选择草稿。board远端两同handle按memberRef qualified身份区分，本机mirror别名由后端ownRef提供，不凭缺peer行推成本机。planning-view仍1499行，小于1507，确认表单在独立模块。

## 工程证据与真实mesh

新增unit8：格式/完整key/CLI分离、坏盘锚只读不覆字节、原unknown qualified重复add不能确权、重启锚保留、原顺序CAS暂停迁移、等价priority、锁失败回滚key与成员、外进程盘CAS拒覆盖。

新增真实HTTP mesh9：同id8外部签名不能借local qualified但单独pin后允许；单边seed minimal/冷缓存unknown不确权且关窗重启无scope/无投递；换key同地址不继承slot/不收到payload；两remote同handle明确选一且重启不改来源；确认已暂停→完整id仍暂停且再次leave不出孤悬；恶意editor给第三方贴自己fp拒；历史bare标unknown后本机CAS确认重启；不可证新bare写拒；同id8选择远端而非本机。继承#335全部12mesh/16unit绿。

Nexus新增picker2、board2及workbench inspector1：必须显式选来源、失败不乐观改slot、文本无HTML注入、同id8owner两个卡、local qualified别名不受foreign同handle遮蔽/本机重复id8仍拒、轮询保选择且提交精确CAS不调用恢复。

默认完整pnpm verify最后完整轮job bash-bebdc1d0c6754943真实rc0：root1503passed/6原skip（179filepass/1skip），layout4，nexus332，innerentries0，build/dist零diff。没有新增skip、降低并发或改timeout。此后member parser收紧避免误吃canvasS2 grammar，定向typecheck+mesh9/unit8/strict输出schema1共18绿；最终默认全量job bash-1f47465dca344c9e再次真实exit0，同为root1503/6原skip、layout4、nexus332、innerentries0。之前中途失败均非验收PASS（schemasource固定4000字符范围、standalone先写未join成员、Vitest2 matcher/cleanup接口、重启连接池ECONNRESET），已按实际接口/顺序修，不忽略失败。

反向区分探针：临时去directory ownerOk key筛选，运行“selects only requested remote owner”真实mesh立即FAIL（C未收到/错误候选收到），已恢复原guard；恢复后mesh全9绿。只作为工程判别性，不冒充CLI规范run结论。

架构图从基线重新重锚39项无miss，无手工修改验证器脚本；图未渲染，不能声称已视觉检查。浏览器bundle重建纳入PR，但没有改生产3080或保证无刷新热更新。

## 继承测试迁移为什么必要

旧测试有大量用新addAPI无证裸写来构造历史slot。新义务明确禁止新裸写，不为保旧测试放开后门：涉及历史行为的setup改为启动前磁盘seed历史snapshot（含先join本机事实避免合法prune改变优先级），保留原安全/暂停/link断言；63c0230的gh108容量mesh曾退化为来源拒绝，不能声称保留容量覆盖，本轮review修订恢复真正的已证明第33成员cap断言；新跨机setup先真实join目标再选peer，断言qualified字符串。bad-signer now在来源admission更早拒，保“不投递/旧债未清”断言，不要求产生晚阶段settlement拒绝行。legacy第三方gamma回执反例只在对应case seed，不污染其他receiver列表。schema-source测试从固定4000字符截取改为registration presentCall边界，不删legacy/teams检查。

## review-350-r1：仅补测试，不改逻辑

原REQUEST CHANGES@63c0230保留。非作者发现旧same-zone signer测试不区分members()两处绑定，旧gh108第33成员在来源门拒绝而非cap，属真实覆盖缺口；以前“保留容量断言”措辞已更正。

- R1 cross-zone真HTTP：A=alpha，B/X均为独立beta主机/真实key/有效card，B的beta/aaaaaaaa已完整pin到A；请求body与task id相同，仅签名者及其合法caller URL不同。X合法Sig3签名被operator-link准入拒、零steer；B真正key持有者同请求被接纳、仅一次steer，账本proof=origin-claim/rule=remote-ref-foreign。去掉canvasRemoteMembersOf signer比较后，该测试因X收到TASK_STATE_DELIVERED而FAIL。
- R1 target-side补全评审突变2：真实caller X与B同dsh，A本机target handle与B同id8；X自身slot已合法pin，但A目标仅有B的远端slot时拒投递。显式加入A完整本机id提供target basis后，同body/key请求才通过。按评审原突变2去members() confirmed-remote signer比较及callerCanvas foreign-signer排除，测试因错误routed=true而FAIL。此用例与跨zone例分开，未把只杀remote-ref比较的结果冒充杀members()比较。
- R2 gh108：32历史slot已满，新增候选是实际agent已join的完整本机id，来源门通过；满员返回ok:false且无来源错误、仍32成员。同候选在释放一slot后成功写入，形成正对照。去addMember cap检查后真实HTTP拒绝断言失败（ok变true），不再仅单测守cap。
- 三次反向修改均try/finally恢复；git diff src/index.ts/src/canvas-store.ts为空，生产逻辑与63c0230逐字相同。恢复后11个#334 mesh及1容量mesh全绿，不靠架构摘要失败取证。

修订默认完整pnpm verify（job bash-04a21c5b80be49b6）真实exit0：root1505passed/6原skip（新增2个R1行为例），layout4，nexus332，innerentries0；全源码/UI/架构锚与63c0230无差异，修订仅两个mesh测试与两份文档。

N1缺锚历史qualified远端立即停用边界已补release说明，需操作者确认。评审所见.156存量0只作为其观察，不推广为全舰队0。N2串行拉seed/delegate卡可能拖慢add/confirm、N3旧gh122末项断言较弱均记录未改逻辑；新R1直接覆盖身份/准入边界，不宣称优化延迟或强化旧断言已实现。此修订不修改#343文件/生产配置，仍待非作者新精确头复评。

## 默认/回滚/交接

兼容窗口不自动关闭；未知存量/实际增量/碰撞由owner观察后另裁。统计不凭重启归零声称完成迁移。SPKI来源校验拒恶意32位fp碰撞但不承诺32位强身份；完整key与原授权仍必须。v1首次写备份与v2磁盘CAS沿#335，回滚停写恢复备份，不直接降版覆写。

当前为待非作者中高档复核交付，不关#334、不合并、不发布或部署，不修改peer生产配置/跨机presence，不触碰deepseek-harness源码。
