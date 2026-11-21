# #787 按 peer 选择本机 OriginClaim 声明地址

档位：实现说明与验收边界。不是 RC spec/run 的发布 PASS，也不等于现场部署或真实消息已通过。

示例地址（与 issue 一致，不是真实域名/IP）：LAN=`http://192.168.50.10:13080`，TS=`http://100.64.0.10:13080`，CLOUD=`https://hub.example.invalid`。

## 配置

```yaml
originClaimUrl: 'http://192.168.50.10:13080'   # 全局默认，不改
originClaimByPeer:
  'https://hub.example.invalid': 'http://100.64.0.10:13080'
```

- 键：规范化后的目标 peer，精确 origin，或精确挂载卡片路径。
- 值：本机对该 peer 签发 OriginClaim 时使用的卡片 URL。
- 缺省 `{}`：所有出站声明、链接判定和回执路径保持原行为。
- 不重新生成节点密钥，不改 `linkKeys`，不把映射地址写入全局 `originClaimAudiences`，不自动扩大团队、来源或文件权限。
- 非法协议、用户信息、查询/片段、无法解析的条目，以及规范化后指向同一 peer 但声明地址不同的冲突条目，一律忽略（对该 peer fail-closed，宿主照常启动并记警告）。

匹配只做精确比较：先最长挂载路径，再精确 origin。`hub.example.invalid` 不会命中 `hub.example.invalid.evil` 或 `not-hub.example.invalid`；`/node` 不会命中 `/node-other` 或 `/other`。

## 覆盖范围

`originClaimHeaders` 是出站签名的唯一入口，因此名片读取、`/a2a/direct`、查询、正式回执/恢复以及其他已有签名 peer 调用都使用同一套选择，而不是只改 route 首次发送。

本机双边链接（`callerLinkedToThisHost`、`peerAdmissionLinkState`、intake 互联）只把「默认 `ownCardUrl` + 运营者为该 peer 明确配置的声明地址」认作本机。对方自报的其他别名、或为别的 peer 配置的地址，不会变成全局 trust。`peerLinkDisplay` 对这一映射使用同一集合；`originClaimAudiences` 仍只作 #311 的接收 audience 与徽章别名，不单独构成准入。

ledger / receipt recovery / CLI home pin 继续钉在默认 `ownCardUrl` 的 origin 上。重选某个 peer 的声明地址不会改 transport/task id，也不会因为映射变化重做业务或重放不确定发送。

出站仍禁止跟随 redirect：`X-API-Key` 与 OriginClaim 不会被带到 `Location` 上的另一个 origin。

## 文件通道（NOT_RUN）

文件引用的 `from` 仍写默认 `ownCardUrl` 的 origin。若云中心到不了该 LAN 地址，则即使文本往返成功，对方也可能拉不到文件。本轮不把映射推广到文件通道；不得把文本回执成功说成文件传输成功。

## 验收（隔离合成，非现场）

1. 未配置映射时，原 LAN peer 的 callerUrl / 签名 / 链接 / 回执不变。
2. 只给 CLOUD 指定 TS 时，其余原 peer 继续声明 LAN；不改全局 `originClaimUrl`，不重新生成身份。
3. 与 0.6.42 验证器的隔离合成：可达 TS 名片时 bound/Sig3 通过；LAN 不可回读时 no-card 拒绝。错误 home / 来源 / 成员 / audience / body / key fail-closed。
4. 目标 origin 不匹配、相似域名、同源不同挂载路径、malformed/duplicate 映射及 redirect 反例；密钥不跟随错误 endpoint。
5. 对配置了映射的 peer，准入与显示一致。
6. 未覆盖范围（文件通道、旧 8-peer 实机互通、中心端真实投递、VPS/已装插件改动）列为 NOT_RUN。

针对性测试：`pnpm exec vitest run tests/unit/origin-claim-by-peer.spec.ts tests/mesh/gh787-origin-claim-by-peer.spec.ts tests/unit/peer-link-display.spec.ts tests/mesh/gh311-lan-origins.spec.ts`。
