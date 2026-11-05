# #312 匿名名片拓扑隐私与兼容记录

档位：中；最初任务基线 7020b27，后合入已发布 0.6.41 master 4097511。本项进 0.6.42，不在已发 0.6.41 包内。无生产部署。

## 名片的三个信息层级

1. 匿名、形状自报、无效或过期签名：签名核心/能力/委派保留，不带 peers，也不带会话、roster、组织和 lanIp。
2. OriginClaim 验签通过但未建立 operator link：可读 peers，不能因此读完整协作字段。
3. 验签且原 operator link 满足：完整名片。没有新增单边seed授权，caller shape与签名规则不放宽。

peers 本来就不在 CardCore 签名覆盖范围内，省略字段不会改变核心签名。verifyCard 的现有 referrals() 允许字段缺失；旧解析器读取无 peers 名片依旧有效。

## referralLearning 的真实依赖与兼容

A2aClient 的正常名片 GET 会由宿主附 OriginClaim。现代宿主在可被回拨的公布地址启动后继续收到引荐，原 peerAllowlist、referralLearning=false、referralTeamResolution 与显式seed优先级不变。

原先不组成 Web/Card 面的匿名-only客户端曾依靠匿名peers扩散；新行为明确不再提供。应升级签名取卡，或显式配置所需seed。三条旧wire引荐/allowlist/持久化测试已使用真实Web/Card签名caller，不删原断言。

存在第二项自举依赖：验签首次匿名回拨只得到核心名片，无法再凭匿名peers证明双边互种。对本机显式seed、且本次签名已验证的宿主，在缺少peers时做有限的签名 discovery=1 回拨；响应必须仍是同一公钥和team。该模式只减去完整协作字段，不递归请求完整名片。

回拨的拓扑证据单独缓存（最多64项，受card cache TTL/名片expiresAt/公钥约束），不覆盖session/roster完整名片缓存；否则会导致合法回执路由与目录缺行。使用目标origin的既有peerRequestHeaders，继承linkKeys和peerFetch禁止redirect；失败/超时/变钥保持原链接检查关闭。

兼容限制：旧版本忽略discovery查询参数仍可响应原名片，不强制新增协议能力；匿名抓取者不再获取引荐是有意形状变化，不提供恢复泄露的开关。签名核心和delegate记录仍然公开；这不是“公网完全看不到任何路由信息”的承诺。

## 兼容裁定 ruling-312-nested-zone

originClaimCallerShape 原定义为 ^[a-z0-9-]+$，含斜杠的主机team不能构成受支持的OriginClaim。旧gh159真实插件fixture的zone/canvas依赖匿名peers才勉强自举，本轮按评审席裁定迁到zone-canvas；合法nested会话/画布歧义继续由既有signCard fixture检验，没有删掉冲突拒绝断言。

启动调用同源形状检查helper，非法host team打一条明确warn；不拒启动、不改配置、不放宽验证。0.6.42升级提示写明迁移方式。

## 工程证据

完整 pnpm verify（最终合入已发布master的稳定树）真exit0：root1429 passed/6skipped，layout4，nexus326，tracked dist零差异。typecheck、docs drift、reanchor --check、diff --check通过。

新privacy mesh三例覆盖匿名/伪造/过期/shape-only无peers、核心签名不变、合法未链接签名者只获得peers、双边seed从冷缓存自举、真实引荐学习、discovery只减信息，以及不同公钥回拨不能打开full card；原card-faces/mesh baseline/gh159/回执/转发/重放测试保留。

本记录为工程自测，不冒充RC spec/run发布验收。尚待评审席复核并决定合入；无发布或生产变更。
