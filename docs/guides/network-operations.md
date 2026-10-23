# 网络操作手册（节点部署 · 路由协作 · 故障形态）

> 来源：`dsh-agent-skills/dsh-a2a-nodes` 技能整编（CLI 章节按属主指令退役，2026-10-23）。
> 本文按「功能 → 应用方法 → 使用场景」组织，全部断言已对 0.6.25+#19 源码校对；
> 配置逐字段契约见仓库 README，协议语义见 `docs/protocol/`。

## 一、拓扑与发现（功能）

去中心化：无中心服务器。节点互相拉取**签名 agent card**（Ed25519，`<home>/a2a/node-key.pem`，TTL/4 重签），直接向对方 `/a2a/direct` 投递。

- **peer 集合**：`peers: [<种子 URL>]` 配置出发，卡片 referral 扩散学习（上限 30、质量评分、持久化 `<home>/a2a/peers.json`；种子永不驱逐）。
- **发布**：`announce: true` 发布本节点卡片（`/.well-known/agent-card.json`）。
- **zone 委派**：`delegates` 发布签名命名记录，名字可穿 zone 解析（≤5 跳，成环失败关闭）。
- **卡片双面**（0.6.21+ G1）：匿名取卡得**最小发现面**（name/team/session/capabilities/records/peers/签名）；全量面（sessionTeams/teamMemberships/lanIp）需 **OriginClaim 信封**（`X-A2A-Caller/-Url/-Ts/-Sig`，卡钥签名）且**验签 ∧ 链接**双过（0.6.23-25：链接=同宿成员/canvas 句柄 ref/双边互种——单边自申报不成链接）。

### 应用方法
配置面：a2a 行 `peers`（种子）+ `announce: true`（发布）+ `apiKey`（出回环必设）。发现面：`a2a_teams`（模型工具）或 state 面（Web）读目录。

### 使用场景
- 新机入网：配 peers 指向既有节点 + announce，卡片经 referral 扩散即可被发现。
- 名字跨 zone 路由：delegates 链；候选全败报 `-32004` 且逐条列原因（含环/深度/密钥不匹配=delegates 配错）。

## 二、会话入网（功能）

会话**只显式加入，绝不自动**——未加入对全网不可见（发现不可见性）。已加入会话获得自己的路由句柄 `<team>/<agentId8>`，随卡片 `sessionTeams` 发布，带标题与活动摘录（每轮末刷新）。

### 应用方法
- **人类正路**：Web 侧边栏「A2A 网络」控件（地球图标）——列出 live 顶层会话，逐行加入/退出开关；keyed 部署控件消失属鉴权设计（浏览器带不了密钥），需带密钥 HTTP 客户端直调控制路由。
- **冷行唤醒**：重启后已加入未打开的会话以「未加载」冷行出现（持久标题+唤醒按钮）；两种零点击形态：`wakeJoinedOnBoot: true`（挂载自动唤醒）与 wake-on-route（远端触达自动唤醒）。

### 使用场景
- 同机双会话回路：侧栏把两个会话都加入，A 会话 `a2a_route` 到 B 的团队句柄，`context_id` 续聊——零中心依赖。
- 跨主机：双方 announce+互种 peers；远端团队经 `a2a_teams` 可见。

### 跨内网部署（跨子网/NAT）——四前置条件
网络层（发现/路由/协作）为跨主机设计，跨内网的前置条件与边界（来源：dsh-a2a-nodes 技能整编，2026-10-23 对 0.6.25 状态校对）：

1. **IP 双向可达**：VPN/隧道/端口转发——无内置 NAT 穿透（relay 是将来时）；
2. **出回环必设 `apiKey`**：web 服务器绑到回环以外且不带密钥=把信任扩大到该绑定地址的每个调用方；
3. **双方 `announce: true` + peers 种子指向隧道地址**（种子永不驱逐）；
4. **NTP 时钟同步**：签名卡片带 `expiresAt`，跨机偏差大会被整体拒绝。

边界更新：投递来源鉴权自 0.6.23 起为**真验签**（OriginClaim 信封，`docs/protocol/delivery-origin-auth.md`）——旧文档"best-effort"表述仅适用于 0.6.23 之前版本；回环配方不跨网（cookie 绑定签发 authority）；跨网正确姿势=自举委派（`a2a_route` 到远端已有 team，让其在本地完成 join/warm）；跨网操作纪律=async 派发+账本跟进、单请求 ≤512KiB、callback team 必须可路由。

## 三、边界与准入（功能 · 0.6.23-25 新语义）

四层边界模型（本仓刚完成的加固线）：

| 层 | 机制 | 语义 |
|---|---|---|
| 连接 | peerAllowlist / referralLearning | 谁能被学到 |
| 身份 | OriginClaim 信封验签 | 谁在说话（卡钥=身份锚） |
| 链接 | canvas refs（句柄精确）/ roster / 双边互种 | 谁与我有运营者建立的链接 |
| 内容 | 暴露档（#19：linked 下限/fleet 自愿上调） | 链接者看多少 |

准入要点：投递面（/a2a/direct）要求共享队（roster ∪ canvas 同队，W1 环路同规）；未验签信封在窗口关闭后按 `untrusted-origin` 拒（与验签败同码）；匿名投递直接拒。

### 应用方法
组链接=在 A2A 工作台建 canvas team 加远端句柄（操作者手势），或双边 peers 互种；成员暴露档经 `a2a_exposure` 工具调（缺席=linked 下限）。

### 使用场景
- 跨机团队：canvas 编排即链接图——板上画的每个跨宿团队就是一条边。
- 新席位接入：先经值守通道/属主引导入队，再获派单资格（F1 发起面豁免的现状见 fleet-governance 手册）。

## 四、路由与协作（功能）

模型工具十枚：`a2a_whoami`（自内省）、`a2a_team_join`/`a2a_team_leave`（roster 声明，allowlist 门）、`a2a_report`（匿名单向上报通道）、`a2a_teams`（目录，teamScopeInfo 作用域内）、`a2a_route`（阻塞至远端回复，`context_id` 续聊）、`a2a_status`（舰队/在途/活动环，作用域内）、`a2a_tasks`（三层账本）、`a2a_probe`（可达性探测，作用域内）、`a2a_exposure`（暴露档调档，#19）。

收件方看到 `[A2A direct] (task <id>) from "<caller>"` 前缀的用户消息；回执契约 `[A2A receipt] task <id> <一行结局>` 经账本对账。

### 应用方法
列表→挑→路由→续聊：先 `a2a_teams` 按 description（最新活动）挑目标，路由一次后复用 `context_id`。请求写自包含（回复纯文本，无 artifacts/流式）。预算：同步等待分钟级非秒级；`final` 语义冲刷窗 `flushTimeoutMs`（默认 5 分钟）。

### 使用场景
- 快速问答：短消息+耐心等回执；超时≠未送达——先 `a2a_status` 活动环查真相，**不要立刻重发**（双份注入风险）。
- 长任务：`async: true` 派发，回执到 `a2a_tasks` 对账。

## 五、控制面鉴权（功能）

控制操作（join/leave/canvas/dispatch/state 写面）在 `controlRoute` 闸后：设 `apiKey` 则全量密钥鉴权（常数时间比对，凌驾回环）；未设则 **loopback-socket 信任**（sec-fetch-site 仅否决不授予——0.6.23 重写后语义）。

### 应用方法
出回环绑定必须设 apiKey；keyed 部署的 GUI 面板注入 `window.__DSH_A2A_KEY__`（loopback 限）。

## 六、故障形态库（实证快照，阴性证据纪律适用）

> 带日期结论是当时快照；单次空探针不得推翻整条——先复现核对环境/版本。

| 形态 | 判读 | 处置 |
|---|---|---|
| 卡片 404 / 网上看不到本节点 | `announce` opt-in 未开 | home patch 追加 a2a 行 `announce: true`（热载） |
| join 后立即 -32004 | 卡片缓存 TTL（60s）时序 | 等过一个 TTL 再路由 |
| 同机短 id 误投 | `dsh/<id8>` 撞同宿另一会话 | 以 state 复核目标行；关键协调走共享文件兜底 |
| final 超时 ≠ 未送达 | steering 已注入 | 查活动环/回执，勿重发 |
| 冷会话唤不醒 | 多为 session 日志损坏（seq gap 带行号） | 查 `sessions/<桶>/<uuid>/session.jsonl.zstd`；间歇性可重启重试 |
| peer 消失 | 评分驱逐（≤0），种子除外 | 设计行为，无需手工清 |
| 回执收不到 | caller 标签不可路由 | `context_id` 主动跟进，勿干等 |
| 全新会话首轮静默 | 激活窗内 steer 被 latch | 先经 /api/session/prompt 预热（活动事实非空后委派即正常） |
| **禁重启宿主铁律** | worker 会话随宿主死=任务自杀回环 | 确需重启用分离拉起（先派新再杀旧） |
| untrusted-origin 拒 | 信封缺席（窗口关）或验签败 | 带四头信封或升级节点 |
| 卡片只有最小面 | 未验签或未链接 | 链接经 canvas/双边互种，非自申报 |

## 指针

- 配置契约：README / README_zh；协议：`docs/protocol/`（delivery-origin-auth 等）；治理流程：`docs/guides/fleet-governance.md`。
