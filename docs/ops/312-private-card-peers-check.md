# #312 匿名名片拓扑隐私与兼容记录

档位：中；最初任务基线 7020b27，后合入已发布 0.6.41 master 4097511。本项进 0.6.42，不在已发 0.6.41 包内。无生产部署。

## 名片的三个信息层级

1. 匿名、形状自报、无效或过期签名：签名核心/能力/委派保留，不带 peers，也不带会话、roster、组织和 lanIp。
2. OriginClaim 验签通过，且是本机显式 seed（根地址按 origin，挂载地址精确匹配）或原 operator link 成立：可读 peers；仅 seed 的关系不能因此读完整协作字段。无任何本机 seed/link 的自签名陌生人同样不带 peers。
3. 验签且原 operator link 满足：完整名片。没有新增单边seed授权，caller shape与签名规则不放宽。

peers 本来就不在 CardCore 签名覆盖范围内，省略字段不会改变核心签名。verifyCard 的现有 referrals() 允许字段缺失；旧解析器读取无 peers 名片依旧有效。

## referralLearning 的真实依赖与兼容

A2aClient 的正常名片 GET 会由宿主附 OriginClaim。现代宿主在可被回拨的公布地址启动后，经对端显式 seed 或既有链接继续收到引荐，原 peerAllowlist、referralLearning=false、referralTeamResolution 与显式seed优先级不变。

原先不组成 Web/Card 面的匿名-only客户端曾依靠匿名peers扩散；新行为明确不再提供。应升级签名取卡，或显式配置所需seed。三条旧wire引荐/allowlist/持久化测试已使用真实Web/Card签名caller，不删原断言。

存在第二项自举依赖：验签首次匿名回拨只得到核心名片，无法再凭匿名peers证明双边互种。对本机显式seed、且本次签名已验证的宿主，在缺少peers时做有限的签名 discovery=1 回拨；响应必须仍是同一公钥和team。该模式只减去完整协作字段，不递归请求完整名片。

回拨的拓扑证据单独缓存（最多64项，受card cache TTL/名片expiresAt/公钥约束），不覆盖session/roster完整名片缓存；否则会导致合法回执路由与目录缺行。使用目标origin的既有peerRequestHeaders，继承linkKeys和peerFetch禁止redirect；失败/超时/变钥保持原链接检查关闭。

兼容限制：旧版本忽略discovery查询参数仍可响应原名片，不强制新增协议能力；匿名抓取者不再获取引荐是有意形状变化，不提供恢复泄露的开关。签名核心和delegate记录仍然公开；这不是“公网完全看不到任何路由信息”的承诺。

## 兼容裁定 ruling-312-nested-zone

originClaimCallerShape 原定义为 ^[a-z0-9-]+$，含斜杠的主机team不能构成受支持的OriginClaim。旧gh159真实插件fixture的zone/canvas依赖匿名peers才勉强自举，本轮按评审席裁定迁到zone-canvas；合法nested会话/画布歧义继续由既有signCard fixture检验，没有删掉冲突拒绝断言。

启动调用同源形状检查helper，非法host team打一条明确warn；不拒启动、不改配置、不放宽验证。0.6.42升级提示写明迁移方式。

## #324 首轮 F1 / Q1 修订

F1已确认：任意自签名持钥者不等于本机有关系。peers现要求claim.ok且configuredSeedCaller(callerUrl)或callerLinkedToThisHost成立。seed口径与有界回拨共用同一helper，根URL按origin、挂载URL精确匹配。仅调用方单边seed本机不授权读取本机拓扑；discovery查询不绕过该门。

新增独立C节点自签名拒绝用例（包含C单边seed B，以及discovery=1），无本机关系时无peers；B自己seed的合法caller仍有peers但不自动full card。临时移除关系条件回退到claim.ok，用例立即FAIL并读到seed列表；已原样恢复，无探针残留。

Q1实测：全冷双seed一次取卡总共4个HTTP请求：原签名B卡请求、匿名A核心卡核验、签名A discovery回拨、匿名B核心卡核验。anonymous核验本身无信封，进入对端不会触发签名discovery；discovery请求本身禁止再次拓扑回拨，所以不递归。测试约束1次discovery、最多2次anonymous，总请求<=4，并保持有效回包。

相关引荐/allowlist/恢复夹具补提供方对caller的显式seed授权；#311 alias显示用独立签名card fixture隔离新隐私权限变化。先前把stranger放行的README/升级提示/本文已修。修复了release说明中上轮字符串替换误把匹配后缀当替换指令造成的重复标题/shape截断，完整保留已发布0.6.41及更早章节。

## 工程证据

首轮送审 5628733 的历史工程记录：pnpm verify 真exit0，root1429 passed/6skipped，layout4，nexus326；该绿记录不覆盖后来F1修订。F1修订后的默认并发全量第一次因引荐夹具权限假设有5红（已改为显式授权，相关106项全过）；后续完整运行在node-tasks磁盘写入超时与转发failover有4红，这两文件隔离复跑37/37过；maxWorkers=2仍有2个node-tasks超时及prewarm墙钟用例红。最终用全部用例、maxWorkers=1/testTimeout=30000复核，不删除或跳过原断言；最终串行完整复核真实exit0：root1431 passed/6skipped、layout4、nexus326，tracked dist零diff；未删用例或新增skip，只在这次执行用maxWorkers=1/testTimeout=30000。typecheck、docs drift、reanchor与diff --check通过，不宣称默认并发pnpm verify在本机稳定全绿。

首轮privacy mesh三例与F1/Q1新增两例共同覆盖匿名/伪造/过期/shape-only无peers、核心签名不变、合法已配置seed但未建立双边链接的签名者只获得peers、双边seed从冷缓存自举、真实引荐学习、discovery只减信息，以及不同公钥回拨不能打开full card；原card-faces/mesh baseline/gh159/回执/转发/重放测试保留。

本记录为工程自测，不冒充RC spec/run发布验收。尚待评审席复核并决定合入；无发布或生产变更。
