# #332 CLI file fetch 的 home 地址别名

低档，base036be9b；不改变文件下载端OriginClaim、deposit、CLI精确句柄/grant准入。

## 实现边界

同origin保持原无需额外元数据读取路径。不同origin时，CLI只向配置的home的控制state面读取声明（5秒请求预算）：ownerHost源自ownCardUrl，新增host.originClaimAudiences源自本机配置。只接受HTTP(S)、无userinfo/query/fragment的有效声明，并按origin比较；不从ref、peer或外部card学习别名。

命中alias也始终用当前homeBase的/a2a/blob，OriginClaim callerUrl与受众也来自homeBase；key/cookie/signature不会发往ref.from或别名。homeFetch原manual redirect门保留。旧宿主未声明、state非200/无效JSON/畸形字段/未列alias都拒；控制401/403沿用key提示。不扩大“任何同网段/同DNS/IP”自动等价。

这是同主机URL识别，不是CLI身份授权：同名但换私钥仍过不了deposit验签，grant、大小和SHA256照旧。控制state不可达或被拒时alias解析失败，不新增绕过；跨主机文件仍不支持CLI越home身份拉取。

## 真实HTTP/CLI回归

原F3发送/本home拉取/未授权/外host拒绝保留。新增两正例分别覆盖ownerHost、originClaimAudiences：真实keyed home上发布CLI卡、stage授权文件，ref指向另一个捕获HTTPserver；CLI成功下载home实际字节，捕获server零请求。同一测试检查声明大小错误拒绝、未列alias拒绝、同名不同私钥拒绝。

四个反例用真实HTTP测试旧host404、503+伪造可匹配alias JSON、畸形userinfo/非数组声明、302跳第三方；均不发blob请求、第三方零请求，key只发给指定home。原F2身份/grant回归同时通过。

默认完整pnpm verify真exit0：root1440passed/6原skip，layout4，nexus326，tracked dist零diff；typecheck/docs/build/reanchor/diffcheck同链。工程自测不是RC spec/run发布结论。无发布或生产部署。

## #144同派单复核

base036be9b/Node24.12.0真实取消两处skip，CLI重试用例仍实际3221226505(0xC0000409)，非期望1。报告tmp/gh144-recheck-036be9b.json，issue144 comment6654039108。两处guard原样恢复且diff为空；不提去skip PR、不宣称自愈。
