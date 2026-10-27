# A2A 网络受信 LAN 部署方案（形态 A：pocket 隧道 + originClaimUrl）

**交付对象**：运维（.156 / .157 / .85 三台受信 LAN 生产节点）
**编写**：dsh-open-a2a-net 开发席（dsh/66abc2cf）· 2026-10-24
**状态基线**：dsh 0.2.1-rc.2 · @nelsonlongxiang/dsh-open-a2a-net 0.6.26（bc76ad4）
**生效判据**：任意两节点互看 `linked ✓ verified ✓`（详见 §6 验收）

> **时点文档**：本方案按 2026-10-24 的 0.6.26 基线编写，正文的版本指纹（期望版本、bundle 特征）均指 0.6.26，不随后续发版更新。
> 2026-10-27 时 master 已到 0.6.28；按新版本部署时以 `package.json` 版本与当次发布说明为准，配置键与路由仍有效。

---

## 1. 目标与原则

| 原则 | 落实 |
|---|---|
| dsh web 面不出网 | 绑 `127.0.0.1:3080`，LAN 只暴露 pocket 端口 13080 |
| 声明地址=可达地址 | `originClaimUrl` 统一指向 `http://<LAN-IP>:13080` |
| 控制面凭钥 | LAN 来源一律要求 `X-API-Key`（配置 apiKey 后自动生效） |
| 密钥不落页面 | 远程打开 nexus 面板时页面不含钥，人工输入一次（sessionStorage） |
| 运营者链接=授权 | 节点间互种（bilateral seeds）由运维一次性落位，之后跨机操作凭链接放行 |

## 2. 节点清单与既有状态

| 节点 | 系统 | LAN IP | dsh web | pocket | 现状 |
|---|---|---|---|---|---|
| .156 | Windows | 192.168.3.156 | 127.0.0.1:3080 | 13080 | **0.6.24 待升级**（升级包见 §5.2）；originClaimUrl 待设 |
| .157 | Ubuntu | 192.168.3.157 | 127.0.0.1:3080 | 13080 | 0.6.26 ✓ 已互链 .85 |
| .85 | Ubuntu | 192.168.3.85 | 127.0.0.1:3080 | 13080 | 0.6.26 ✓ 已互链 .157 |
| 3081（测试参考） | Windows | 192.168.3.156:3081 | 直接 LAN 绑（形态 B，非本方案） | — | 0.6.26 |

> 测试宿主 3081 走形态 B（直接绑定+密钥门），**不属于本方案范围**，仅供验收时做对照。

## 3. 每台节点的目标配置

### 3.1 pocket（已有则核验，无则部署）

- 职责：监听 `0.0.0.0:13080`，转发到 `127.0.0.1:3080`。
- 健康判据：LAN 侧 `curl http://<LAN-IP>:13080/.well-known/agent-card.json` 返回 200（JSON 以 `{"name":"…"` 开头）。
- 三台生产机的 pocket 均已存在；本方案只要求**核验**，不要求重建。

### 3.2 dsh web（保持现状）

```
dsh web --port 3080 --no-open        # 默认绑 127.0.0.1，不要加 --host 出网
```

### 3.3 a2a 插件配置（核心三键 + 本方案两键）

写入各节点 **profile 级**补丁 `~/.dsh/profiles/web/cordis.patch.yml`（Windows: `C:\Users\<u>\.dsh\profiles\web\cordis.patch.yml`）：

```yaml
- id: a2a
  config:
    originClaimUrl: 'http://192.168.3.<本机LAN IP>:13080'   # ← 每台换成自己的
    announce: true
    apiKey: '<运维生成的强钥>'                                 # ← LAN 打开控制面/面板用
    peers: [                                                  # ← 互种：另外两台的 pocket 口
      'http://192.168.3.<对端A>:13080',
      'http://192.168.3.<对端B>:13080',
    ]
    wakeJoinedOnBoot: true
```

**逐键说明**：

| 键 | 为什么 | 注意 |
|---|---|---|
| `originClaimUrl` | **本方案的核心**。不设则节点自报 `:3080`（web 口），而 peers 引用的是 `:13080`（pocket 口）——origin 永不匹配 → 全员互看 stranger（本次事故根因） | 必须精确到 `http://<LAN-IP>:13080`，无尾斜杠 |
| `announce: true` | 发布签名卡（节点身份锚） | 缺省为 false，必须显式开 |
| `apiKey` | LAN 来源访问控制面（`/__dsh_a2a/*`）与面板取数必须带 `X-API-Key` | 环回面可免钥；钥仅供运维与属主面板使用 |
| `peers` | 互种=运营者链接（W3 basis-3）。链接即授权：跨机团队调节（/a2a/canvas-op）凭它放行 | 填**对端**的 pocket 口；不要填自己 |
| `wakeJoinedOnBoot` | 重启后冷会话自动唤醒（保持既有行为） | 照旧 |

> .157/.85 的 `originClaimUrl` 已于 2026-10-24 设置并验证（互看 linked ✓）。**本方案剩余动作集中在 .156。**

### 3.4 Windows 节点（.156）补丁位置

`.156` 的 a2a 配置当前在 `C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml` 的 `- id: a2a` 块。运维操作：

1. 追加/修改上述五键（peers 填 .157/.85 两台）。
2. **重启 3080 宿主属于属主专属门**：运维准备好配置后，向属主申请重启窗口（一次重启=九件叠加重启窗，见 §7）。

## 4. 节点间信任动作（一次性）

互种在 3.3 的 `peers` 键中已表达。补充说明：

- 种子是**对称的**：A 种 B 且 B 种 A 才构成 bilateral（完整链接）。
- 单向种子只产生「可见但未链接」状态（stranger，取到最小卡）。
- 不需要手动交换公钥——公钥随签名卡在 `/.well-known/agent-card.json` 分发，验签自动完成。

## 5. 升级与部署步骤（运维执行单）

### 5.1 版本统一（.156 从 0.6.24 → 0.6.26）

升级包：`C:\tmp\gh34-sdk\nelsonlongxiang-dsh-open-a2a-net-0.6.26.tgz`（=master bc76ad4 构建；.157/.85 已在同版本）。

```powershell
# .156 上（管理员）：
Copy-Item C:\tmp\gh34-sdk\nelsonlongxiang-dsh-open-a2a-net-0.6.26.tgz C:\Users\Administrator\.dsh\plugins-data\ -Force
$env:DSH_HOME='C:\Users\Administrator\.dsh'
Set-Location C:\Users\Administrator\.dsh\profiles\web
corepack pnpm remove '@nelsonlongxiang/dsh-open-a2a-net' --config.minimum-release-age=0
corepack pnpm add 'file:..\..\plugins-data\nelsonlongxiang-dsh-open-a2a-net-0.6.26.tgz' --config.minimum-release-age=0
node -e "console.log(require('C:/Users/Administrator/.dsh/profiles/web/node_modules/@nelsonlongxiang/dsh-open-a2a-net/package.json').version)"
# 期望输出: 0.6.26
```

### 5.2 ⚠️ 升级铁律（本次事故教训，写进运维手册）

> **插件升级 = 换 lib + 换进程，两步缺一不可。**
> pnpm 安装成功 ≠ 生效——运行中的进程仍吃着旧代码。
> **判据 = 路由指纹，不是安装输出**：

```bash
# 升级+重启后，验证新面存在（四项全 200/JSON 即新构建在跑）：
curl http://127.0.0.1:3080/__dsh_a2a/state                        # version 应为 0.6.26
curl -X POST http://127.0.0.1:3080/a2a/canvas-op -d '{}' -H 'Content-Type: application/json'
#   期望 JSON（untrusted-origin…），405=旧进程
curl http://127.0.0.1:3080/__dsh_a2a/owner-settings               # 三键面板面
```

### 5.3 重启流程（每台）

**Linux（.157/.85 已完成，此为复现单）：**

```bash
P=$(pgrep -f "dsh web --port 3080" | head -1)   # 精确 PID，勿模式杀全部
kill $P; sleep 5
nohup dsh web --port 3080 --no-open >> /tmp/dsh-web-3080.log 2>&1 &
# 25 秒后按 §5.2 验指纹
```

**Windows（.156，需属主点头）：**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'bin\.js web --port 3080' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }   # 精确 PID
Start-Sleep -Seconds 5
Start-Process -FilePath 'D:\node-v24.12.0-win-x64\dsh.cmd' -ArgumentList 'web','--port','3080','--no-open' -WindowStyle Hidden
# 30 秒后按 §5.2 验指纹
```

> 端口被占（`EADDRINUSE …:9811`）= 有残留实例没杀干净：按上面的精确 PID 流程重来，**不要并发起两个**。

## 6. 验收清单（属主/运维共验）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 卡面可达（LAN） | `curl http://192.168.3.157:13080/.well-known/agent-card.json` | 200 JSON |
| 2 | 版本指纹 | `curl http://127.0.0.1:3080/__dsh_a2a/state`（各台本机） | `"version":"0.6.26"` |
| 3 | **互看 linked**（核心） | 各台 `state` 的 `peers[].link` | 对端两台均 `linked`，`verified:true` |
| 4 | 控制面凭钥 | LAN 侧不带钥 GET `/__dsh_a2a/state` | 401/403 |
| 5 | 面板可用 | 浏览器 `http://<LAN-IP>:13080/__dsh_a2a_nexus/` | 出现密钥门，输入 apiKey 后全功能 |
| 6 | 远端会话队入目录 | 任一台面板画布 | 对端会话以**带名字成员卡**出现；远端队框（名册）可见 |
| 7 | 跨机调节 | 拖任一卡进远端队框 | 对端落位、徽章绿（有属主在场时验） |

> 检查 3 是本方案的成败判据：**linked = originClaimUrl + 互种两者都对**。stranger = 查 §3.3 两键。

## 7. 与属主重启窗的关系

.156 重启即触发「九件叠加重启窗」（0.6.26 升级 / 建联三角 / 派发回执落抽屉 / 远端下拉填满 / 画布成员卡 / 目录收窄 / 舰队团队规划 / 密钥门 / 远端框保位）。**运维准备就绪后，请属主一句话开窗，运维执行 §5.3。**

## 8. 常见故障速查

| 症状 | 根因 | 处置 |
|---|---|---|
| 互看 stranger | originClaimUrl 缺/错（`:3080` vs `:13080`） | 核 §3.3 |
| stranger 且卡 200 | 单向种子（对方没种我） | 补对端 peers |
| 面板空白/401 | LAN 面无钥 | 面板密钥门输入 apiKey；或用回环面 |
| 卡 404 / state 404 | 旧进程/未升级 | §5.2 指纹验证 + §5.3 精确重启 |
| `EADDRINUSE :9811` | 残留实例 | 精确 PID kill（§5.3），勿双起 |
| 链接绿但目录无对端会话 | 暖卡缓存未刷 | 等 60s（cardCacheTtl）或轮询两次 state |

## 9. 附录：远程节点经宿主 portproxy 接入（VM 实测 2026-10-24）

**场景**：远程机（如 NAT 后的 VM、点对点隧道对端）仅宿主一台可达。**实测结论**：发现层 gossip 自动让全网知道它；建联层只需把它的落点经宿主面向 LAN 转发——一条 portproxy，无 VPN、无中继代码。

```
①宿主(.156)开转发（管理员，规则持久跨重启）：
  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=<LAN口> connectaddress=<远程内网址> connectport=<远程a2a口>
  实测：13909 → 192.168.29.136:3091

②远程节点侧（三条配置）：
  originClaimUrl: 'http://<宿主LAN-IP>:<LAN口>'   ← 声明地址=代理地址
  peers: [ '<任一舰队节点可达地址>' ]              ← 它出站可达内网，种一台即可
  announce: true + apiKey

③舰队各机：peers 加 'http://<宿主LAN-IP>:<LAN口>' → 互种

④暖目录（各机轮询两次 state 或等 60s）→ linked ✓ verified ✓
```

**实测验收**：.157 → VM(13909) linked✓ verified✓ · .85 → VM linked✓ verified✓ · VM 经 gossip 自学全网 8 peer。VM 常驻=用户级 systemd + `loginctl enable-linger`（免 sudo）。

**语义要点**：种子地址即「运营者链接」——各机种的是代理地址，信任落在宿主转发这个运营行为上；远程机的卡签名仍是它自己的钥（验签不受代理影响）。

---
*方案随 0.6.26 rc 演进；后续版本如改端口/配置语义，以仓内 README 为准。*
