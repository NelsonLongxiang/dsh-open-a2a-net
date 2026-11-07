# 独立网络节点部署手册（`a2a-net serve`）

> 适用版本：0.6.39 起。以下各步已于 2026-11-05 在 macOS（Node 26.12）上用 npm 发布包实测：安装、缺依赖时的提示、带 key 启动、服务式启动命令、CLI 落户、重启后户口仍在、launchd plist 语法（`plutil -lint`）。§6 与 DSH 宿主的真实互联由 mesh 端到端测试覆盖（`tests/mesh/standalone-serve.spec.ts`），未在生产主机上走过。Linux systemd 与 Windows 服务配置**未实测**，按标准写法给出。

## 0. 它是什么，不是什么

`a2a-net serve` 在一个独立 Node 进程里跑网络层，不依赖 DSH 实例：

- 签名名片与 OriginClaim、对端目录、一跳转发；
- CLI 户口与信箱（`a2a-net publish` / `inbox`）；
- canvas 归属、任务台账、状态面 `/__dsh_a2a/state`、工作台 `/__dsh_a2a_nexus/`。

它**不托管 AI 会话**。发往会话的消息照常转发给 DSH 宿主，由那里的会话处理。

典型用途：在一台常开的机器上做 CLI 的常驻 home。DSH 重启或卸插件时，CLI 户口、信箱和 canvas 目录不会跟着掉线；节点自己重启后，户口和信箱也都还在。

## 1. 安全：放在哪里

**不要直接暴露在公网。** 理由（均已对照代码核实）：

| 风险 | 说明 |
|---|---|
| 无 TLS | 节点只讲 HTTP。`apiKey` 放在 `X-API-Key` 头里明文传输，在公网可被截获。所有互联主机共用同一把 key，泄露一次就是全网。 |
| 无失败限流 | key 比对是常数时间，但连续猜错不会被限速，也不会被锁定。 |
| 信封可重放 | [#137](https://github.com/NelsonLongxiang/dsh-open-a2a-net/issues/137)：OriginClaim 无状态信封在 ±5 分钟内可重放。 |
| 过渡窗口默认开 | `originClaimWindow`、`originClaimUnboundWindow` 默认 `true`，无签名的旧式投递仍会进入调用方门。 |
| 名片公开 | `/.well-known/agent-card.json` 不需要 key，内容含会话名、zone、公钥、版本和 `peers`。`peers` 列出你其他主机的地址，等于公开内网拓扑。 |
| 未审计 | 0.6.x，未经独立安全审计；`settlementAuth` 默认 `observe`。 |
| 反代泄露 key（≤ 0.6.39） | 本机回环访问时，工作台页面会把 apiKey 写进 HTML。同机反代（Caddy、nginx）以 `127.0.0.1` 连接节点，每个公网请求都会被当成本机，**任何人打开工作台都能拿到 key**。0.6.40 起，带 `X-Forwarded-For`、`Forwarded` 或 `X-Real-IP` 的请求不再享受本机信任；0.6.39 及更早版本要按下面的做法绕开。 |

**推荐**：放在 Tailscale / WireGuard 等私有网络里，`host` 绑 `0.0.0.0` 时，只在私网接口放行端口，或直接用防火墙限制来源。

**如果必须上公网**，以下全部要做：

1. 前面放 TLS 反向代理，由代理对外，节点端口不直接暴露。具体做法见下面的“公网 HTTPS 前置”。
2. 用强随机、专用的 `apiKey`（例如 `openssl rand -hex 32`），不要复用别处的密钥。
3. 在代理层加来源 IP 白名单和请求限流。
4. `node.json` 里设 `"originClaimWindow": false`，拒绝无签名投递。
5. 跟踪 #137，修复前认清重放风险。
6. 对外节点用**专用 key**，不要与内网舰队共用。互联要求同一把 key，所以对外节点暂不与内网 DSH 宿主互联，或单独起一个对外节点。

### 公网 HTTPS 前置（Caddy）

需要一个指向 VPS 的域名。没有自己的域名时，可以临时用 `38-209-68-244.sslip.io` 这类通配 DNS，但 Let's Encrypt 对这类公共域名常有签发限额。

**0.6.39 及更早版本**：反代不能连 `127.0.0.1`。让节点绑 `0.0.0.0`，Caddy 连 VPS 自己的网卡地址，这样节点看到的来源不是回环；再用防火墙关掉公网直连的节点端口（本机到本机走 `lo`，不受影响）：

```
# /etc/caddy/Caddyfile
a2a.example.com {
    reverse_proxy <VPS 网卡 IP>:3080
}
```

```bash
sudo ufw deny 3080/tcp      # 公网不能直连节点；Caddy 走本机 lo 不受影响
sudo systemctl reload caddy
```

**0.6.40 起**：节点可以只绑 `127.0.0.1`，Caddy 连 `127.0.0.1:3080`。Caddy 默认带 `X-Forwarded-For`。用 nginx 时必须写 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，否则仍会被当成本机。

两种做法都要在 `node.json` 设 `"originClaimUrl": "https://a2a.example.com"`，然后重启节点。

**验收**（从 VPS 之外执行）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<VPS IP>:3080/.well-known/agent-card.json      # 连接失败（端口已关）
curl -s https://a2a.example.com/__dsh_a2a_nexus/ | grep -c __DSH_A2A_KEY__                     # 0：页面里没有 key
curl -s -o /dev/null -w '%{http_code}\n' https://a2a.example.com/__dsh_a2a/state               # 401
```

## 2. 安装

找一个专用目录（下文以 `/opt/a2a-node` 为例，Windows 用 `C:\a2a-node`），在里面装本包和一组**钉死版本**的运行时依赖。npm 上这些依赖的 `latest` 标签较旧，用不了，必须用下面的精确版本：

```bash
mkdir -p /opt/a2a-node && cd /opt/a2a-node
echo '{"name":"a2a-node","private":true}' > package.json
npm i @nelsonlongxiang/dsh-open-a2a-net@0.6.39 @deepseek-ai/cordis@4.0.5 @deepseek-ai/cordis-plugin-timer@1.1.7 @deepseek-ai/dsh-host-webserver@0.1.7-rc.2 @deepseek-ai/dsh-tools@0.1.7-rc.2 @deepseek-ai/dsh-system-prompt@0.1.7-rc.2 @deepseek-ai/dsh-home-paths@0.1.7-rc.2 @deepseek-ai/dsh-llm@0.1.7-rc.2 @deepseek-ai/dsh-session@0.1.7-rc.2 @deepseek-ai/schemastery@3.18.5
```

以后的版本：依赖组合可能变化。缺依赖时，`a2a-net serve` 会打印该版本对应的完整安装行，照抄即可。

## 3. 配置 `node.json`

放在安装目录里。键就是插件配置键，命令行旗标（`--host --port --home`）优先于文件。

```json
{
  "host": "0.0.0.0",
  "port": 13090,
  "dshHome": "/opt/a2a-node/home",
  "team": "dsh",
  "session": "a2a-node-mac",
  "agentName": "a2a-net node (mac)",
  "apiKey": "<与所有互联主机相同的强随机 key>",
  "peers": ["http://100.64.0.10:13080"],
  "originClaimUrl": "",
  "originClaimAudiences": []
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `host` | `127.0.0.1` | 只接受 `127.0.0.1` 或 `0.0.0.0`，其他值启动即报错。 |
| `port` | `13090` | |
| `dshHome` | `~/.a2a-net/node` | 节点状态目录，与 CLI 自己的 `~/.a2a` 分开。**节点身份密钥在 `<dshHome>/a2a/node-key.pem`**，要备份（见 §8）。 |
| `team` | `dsh` | 节点所在 zone，通常与舰队一致。 |
| `session` | `a2a-node-<主机名>` | 节点的调用方标签。 |
| `apiKey` | `''` | 绑 `0.0.0.0` 时必须设置。设置后所有控制路由（含 state、CLI 户口、canvas）和投递面都要求 `X-API-Key`。互联主机必须用**同一把** key，否则对端请求 401。 |
| `peers` | `[]` | 要互联的 DSH 宿主 URL。对方也要把本节点 URL 加进它的 `peers`（双向种子才算互联）。 |
| `originClaimUrl` / `originClaimAudiences` | | 端口映射、反代、pocket 隧道时使用，规则与 DSH 宿主相同（见 `docs/ops/lan-deploy-plan-a.md`）。 |
| `forwardDirect` | `true` | 一跳 CLI 转发，0.6.38 起默认开启。 |

固定由 serve 设定、文件里改不了的键：`sessionNodes: true`（挂载控制面）、`wakeJoinedOnBoot: false`；`announce` 默认 `true`。

## 4. 前台试跑

```bash
cd /opt/a2a-node
./node_modules/.bin/a2a-net serve --config node.json
# [serve] a2a-net node on http://127.0.0.1:13090 · zone dsh · session a2a-node-mac · home /opt/a2a-node/home (no DSH sessions; Ctrl+C to stop)
```

另开一个终端验证（`$KEY` 为 node.json 里的 apiKey）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13090/.well-known/agent-card.json   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13090/__dsh_a2a/state               # 401（设了 key）
curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $KEY" http://127.0.0.1:13090/__dsh_a2a/state   # 200
```

Ctrl+C 正常退出。

## 5. 常驻运行

所有平台都用 node 直接执行包内入口 `node_modules/@nelsonlongxiang/dsh-open-a2a-net/cli/a2a.mjs`，不依赖 PATH 里有 `a2a-net`。

### macOS（launchd）

`~/Library/LaunchAgents/net.a2a.node.plist`（`node` 路径以 `which node` 为准）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>net.a2a.node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/opt/a2a-node/node_modules/@nelsonlongxiang/dsh-open-a2a-net/cli/a2a.mjs</string>
    <string>serve</string>
    <string>--config</string>
    <string>/opt/a2a-node/node.json</string>
  </array>
  <key>WorkingDirectory</key><string>/opt/a2a-node</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/opt/a2a-node/serve.log</string>
  <key>StandardErrorPath</key><string>/opt/a2a-node/serve.log</string>
</dict>
</plist>
```

```bash
plutil -lint ~/Library/LaunchAgents/net.a2a.node.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/net.a2a.node.plist
launchctl kickstart -k gui/$(id -u)/net.a2a.node      # 重启
launchctl bootout gui/$(id -u)/net.a2a.node           # 停止并卸载
```

### Linux（systemd，未实测）

`/etc/systemd/system/a2a-node.service`：

```ini
[Unit]
Description=a2a-net standalone node
After=network-online.target
Wants=network-online.target

[Service]
User=a2a
WorkingDirectory=/opt/a2a-node
ExecStart=/usr/bin/node /opt/a2a-node/node_modules/@nelsonlongxiang/dsh-open-a2a-net/cli/a2a.mjs serve --config /opt/a2a-node/node.json
Restart=on-failure
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now a2a-node
journalctl -u a2a-node -f
```

### Windows（NSSM，未实测）

```bat
nssm install a2a-node "C:\Program Files\nodejs\node.exe" "C:\a2a-node\node_modules\@nelsonlongxiang\dsh-open-a2a-net\cli\a2a.mjs serve --config C:\a2a-node\node.json"
nssm set a2a-node AppDirectory C:\a2a-node
nssm set a2a-node AppStdout C:\a2a-node\serve.log
nssm set a2a-node AppStderr C:\a2a-node\serve.log
nssm start a2a-node
```

`node.json` 里的 `dshHome` 请写绝对路径（如 `C:\\a2a-node\\home`），避免服务账户的家目录与登录用户不同。

## 6. 与 DSH 宿主互联（属主操作）

1. **网络可达**：节点与每台 DSH 宿主双向可达（同一 tailnet 即可）。
2. **key**：内网节点可以直接用舰队的 `apiKey`。**公网节点**保留专用 `apiKey`，改用**链路 key**（0.6.41 起，#317）：两端各配 `linkKeys`，填同一把新的随机 key（`openssl rand -hex 32`）。
   - 节点：`"linkKeys": { "http://<DSH 宿主地址>:13080": "<链路 key>" }`
   - DSH 宿主：`linkKeys: { "https://<节点域名>": "<链路 key>" }`

   链路 key 只能在对端接口上使用，而且只认它所对应的那台对端（签名必须验证通过）；控制面不认链路 key。这样公网节点被攻破，也拿不到舰队主机的控制权。
3. **双向种子**：节点 `node.json` 的 `peers` 列出 DSH 宿主；每台 DSH 宿主的插件配置 `peers` 加上本节点 URL，`announce: true`，然后重启 `dsh web`（属主安排）。
4. **画布队伍**（谁能和谁说话由画布决定）：
   - 在**节点**的工作台 `http://<节点>:13090/__dsh_a2a_nexus/` 建队。在节点本机打开时会自动带上 key；从别的机器打开时，需要手动输入一次 X-API-Key，只存在该浏览器的 sessionStorage。把 CLI 户口和要协作的远端会话放进同一个队。
   - 在**会话所在的 DSH 宿主**上，把 CLI 户口加进同名队，并把它的 home 钉到本节点，这样回执会回到节点信箱。

   也可以由属主在节点本机用控制路由完成（等价于工作台操作；agent 不应替属主执行）：

   ```bash
   # 节点上：CLI 与远端会话入队
   curl -s -X POST -H "X-API-Key: $KEY" -H 'Content-Type: application/json' http://127.0.0.1:13090/__dsh_a2a/canvas -d '{"action":"add-member","name":"ops","id":"<cli-handle>"}'
   curl -s -X POST -H "X-API-Key: $KEY" -H 'Content-Type: application/json' http://127.0.0.1:13090/__dsh_a2a/canvas -d '{"action":"add-member","name":"ops","id":"dsh/<会话 id8>"}'
   # DSH 宿主上：CLI 入队并钉住节点为 home
   curl -s -X POST -H "X-API-Key: $KEY" -H 'Content-Type: application/json' http://127.0.0.1:<dsh 端口>/__dsh_a2a/canvas -d '{"action":"add-member","name":"ops","id":"<cli-handle>","home":"http://<节点>:13090"}'
   ```

## 7. CLI 落户到节点

```bash
export A2A_CLI_HOME=$HOME/.a2a          # 每次手动跑 CLI 都设置，避免覆盖别的身份
export A2A_KEY=<节点 apiKey>
a2a-net init <名字> --home http://<节点>:13090   # 首次：生成 Ed25519 身份，记住 home
a2a-net publish                                 # 落户，4 小时有效
a2a-net whoami                                  # deposit ONLINE, 4.00h left
a2a-net status                                  # host … version=0.6.39 peers=N
a2a-net route dsh/<会话 id8> "消息"            # 默认异步
a2a-net inbox --wait --renew                    # 等回执，顺便续期
```

已有身份只需换 home：`--home` 或 `$A2A_HOME` 指向节点，再 `publish`。

## 8. 验证清单（部署后逐项打勾）

| 项 | 方法 | 期望 |
|---|---|---|
| 进程在跑 | 日志首行 `[serve] a2a-net node on …` | 端口、zone、home 正确 |
| 名片 | `curl …/.well-known/agent-card.json` | 200，`version` 为部署版本 |
| key 生效 | 不带 / 带 `X-API-Key` 读 `/__dsh_a2a/state` | 401 / 200 |
| 对端互联 | `a2a-net status` | `peers=` 等于互联主机数 |
| 远端会话可见 | 状态面 `remote` 行 | 出现 DSH 宿主会话，`via` 为其 URL |
| CLI 户口 | `a2a-net whoami` | `deposit ONLINE` |
| 往返 | `route` 一个异步任务，`inbox --wait` | 收到 `[A2A receipt] task <id>`；状态面 `archived` 行 `endedBy: receipt` |
| 重启不丢 | 重启服务后 `whoami`、`inbox` | 户口仍 ONLINE，信箱内容仍在 |

## 9. 升级、备份与日志

- **升级**：在安装目录按新版本的安装行重跑 `npm i`（缺依赖时 serve 会打印），然后重启服务。户口、信箱和台账在 `dshHome` 里，升级不受影响。
- **备份**：备份整个 `dshHome`，至少要备份 `a2a/node-key.pem`。丢了密钥，节点会以新身份出现，对端看到的是另一把公钥。
- **日志**：serve 只打一行启动日志，其余是插件日志。launchd 和 NSSM 写到 `serve.log`，systemd 用 `journalctl`。
- **停止**：SIGINT 或 SIGTERM 会干净退出（Ctrl+C、`launchctl bootout`、`systemctl stop`）。
