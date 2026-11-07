# #311 LAN 地址选择与本机 origin 别名核对

档位：中。基线：fd29f2784b9c7e0c601c65563b506bfb86214255。
本记录是工程自测与现场只读观察，不是 RC spec/run 的发布 PASS；不宣称已生产部署。

## 需求与实现

- 自动 IPv4 选择：RFC1918（10/8、172.16/12、192.168/16）优先，其次其他非内部 IPv4，最后 CGNAT（100.64/10）。同级保持网卡枚举顺序；不按网卡名字猜物理/虚拟身份。
- 显式 originClaimUrl 仍优先于自动地址，不被覆盖；仅剩 overlay 时仍可选 CGNAT。
- peerLinkDisplay 的本机 origin 集合为 ownCardUrl 与 originClaimAudiences 的并集；仍要求本机 seed 精确命中该对端 origin、名片已验签、对端 peers 命中本机任一 origin。
- 别名只影响徽章投影。peerAdmissionLinkState、CLI home 选择和 OriginClaim 验签规则均不改。

## .156 改前生产读回

读取：2026-11-05 11:03:25 +08:00，GET http://127.0.0.1:3080/__dsh_a2a/state（13080 代理读回相同）。

- host.lanIp = 100.64.0.10。
- 多个对端 linked、verified=true、lastContactOk=true。
- 另有对端 linked；一个未配置的对端为 stranger、verified=false、lastContactOk=false。
- 这不是重演 issue 中的“全部 stranger”：对端后来已增加 Tailscale seed，当前已部分恢复。未修改或撤销这些现场配置来制造反例。
- 真实 IPv4 枚举依次含 Tailscale 100.64.0.10、以太网 10.20.30.10、VMware 192.168.201.1/192.168.202.1、环回、Hyper-V/WSL。

## 改后隔离宿主读回（同机真实网卡，非生产替换）

命令：pnpm exec vitest run tests/mesh/gh311-lan-origins.spec.ts。
读取：2026-11-05 11:11:50–53 +08:00。测试用临时 home 与随机监听端口启动真实插件，并 GET /__dsh_a2a/state；结束即 dispose，不重启生产宿主。

- host.lanIp = 10.20.30.10（Tailscale 仍排在枚举首位）。
- 无显式覆盖时，出站 X-A2A-Caller-Url 为 http://10.20.30.10:<隔离宿主端口>。
- 显式 originClaimUrl=http://explicit.example:13080 时，签名 callerUrl 保持该值；host.lanIp 仍报告真实优选 LAN 地址。
- 双测试宿主通过 localhost 与 127.0.0.1 模拟本机别名：对端只种 audience 别名，修复后的 state.peers 对目标宿主报告 linked、verified=true。
- 单元反例钉住无 alias 为 stranger、有 alias 为 linked，错端口/协议/其他对端/非法 URL/未验签名片均不升级。

生产实例未换码，生产改后读回要在正常升级窗口完成；不能把上述隔离测试当成生产已加载。

## callerUrl 为 CGNAT 的实际影响

src/origin-claim.ts:275–294 先按 callerUrl 的精确 URL 查名片缓存；未命中就 GET callerUrl + /.well-known/agent-card.json。验签不因两个 URL 宣称同一台机器就借用另一 URL 的缓存。

因此 LAN 对端到不了 100.64.0.10 时，即使有 10.20.30.10 的名片缓存，冷 CGNAT callerUrl 仍可能返回 no-card，影响真实 OriginClaim 校验；并非仅徽章显示。反之，有该精确 URL 的可用已验签名片缓存或实际 tailnet 可达时可以通过。CLI 本机 deposit 验签是另一条本机表路径，不应与普通宿主信封混同。

已加独立回归测试：同一签名在“仅 LAN URL 缓存且 CGNAT 回拨失败”时 no-card；精确 CGNAT 缓存命中时 bound=true 且不回拨；回拨成功时通过。

## 工程门禁

- 针对性四文件：36 passed（地址范围与边界、显示别名反例、普通宿主 OriginClaim 回拨、真实适配器 state 与签名 URL）。
- pnpm typecheck：exit 0。
- pnpm reanchor:arch --base fd29f27：18 moved，0 misses，0 problems。
- 完整 pnpm verify（未用管道吞退出码）：exit 0，root 1402 passed / 6 skipped；build-layout 4 passed；nexus 326 passed，受跟踪 dist 零 diff。

## 仍有的边界

多个 RFC1918 网卡之间没有默认路由或物理网卡优先级判断；同级保持原顺序。多网段主机如需确定公布地址，应显式配置 originClaimUrl，并为其他拨号地址配置 originClaimAudiences。
