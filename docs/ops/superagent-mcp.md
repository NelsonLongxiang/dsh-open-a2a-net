# superagent 团队的 MCP 接入（运维指南）

**交付对象**：在宿主机上配置 superagent 团队的属主或管理员
**适用版本**：next/0.8 线（`@nelsonlongxiang/dsh-open-a2a-net` 0.8.x）、workbench-market 含 #474（PR #478）之后的版本、ygl-trees 0.122.x
**范围**：两件事——(1) 团队会话经工作台市场的 MCP 使用工具；(2) 不在团队预设里、自己挂载 ygl-trees MCP 的宿主怎么配。

> 本页所有地址、令牌、目录都是占位符：`<market-url>`、`<admin-token>`、`<team-ygl-home>` 等按本机替换。不要把真实令牌写进任何会提交到仓库的文件。

---

## 1. 团队会话使用工作台市场的 MCP

### 1.1 市场这一侧的事实

- 市场的 MCP 入口是 `<market-url>/mcp`（Streamable HTTP）。网关开启时（生产缺省开），**每个调用都要带 `Authorization: Bearer <会话令牌>`**；不带或令牌无效，返回 **401**。
- 会话令牌由管理员在市场的控制面建；新会话的授权（grants）是空的，也就是默认拒绝，要再单独授权工具。
- 市场可以把上游 MCP 的工具并进自己的 `/mcp`，名字是 `<前缀>__<工具>`。#474 起，上游可以是 ygl-trees：市场自己在服务端启动 `ygl-trees mcp`，工作区由配置指定，并入 `read` / `write` / `verify` / `doctor` 四个工具（`read` 归读类，其余按写类）。
- 市场启动的 ygl-trees 子进程：不继承市场的口令和密钥；`HOME` 指向团队工作区；`YGL_VERIFY_ALLOW_CMD` 显式置空，所以 verify 的 command 型检查一律判 ERROR；同一前缀只有一个子进程，调用串行。

### 1.2 管理员：配置 ygl-trees 上游（只做一次）

1. 在市场所在的机器上选一个**团队专用**的工作区目录（绝对路径，必须已存在，不能是市场服务端自己的 `YGL_HOME`，即属主个人的工作区），先建库：

   ```bash
   YGL_HOME=<team-ygl-home> ygl-trees db init
   ```

2. 先读出现有的上游列表。`PUT /api/mcp/upstreams` 是**整体替换**，只传新的一项会把其它上游删掉：

   ```bash
   curl -s -H "X-Admin-Token: <admin-token>" <market-url>/api/mcp/upstreams
   ```

3. 把 ygl-trees 这一项加进列表，整体写回（`<现有上游…>` 原样保留）。ygl-trees 上游只接受 `prefix`、`kind`、`ygl_home`、`enabled`、`toolCallTimeoutMs`，写了 `url`、`headers`、`command`、`args`、`env` 会被 400 拒绝：

   ```bash
   curl -s -X PUT -H "X-Admin-Token: <admin-token>" -H 'Content-Type: application/json' \
     -d '{"upstreams":[<现有上游…>, {"prefix":"ygllc","kind":"ygl-trees","ygl_home":"<team-ygl-home>"}]}' \
     <market-url>/api/mcp/upstreams
   ```

   `prefix` 规范是 `[a-z][a-z0-9]{0,15}`；下文用 `ygllc` 举例。

### 1.3 管理员：给每个团队建会话令牌

每个团队建自己的市场会话，**不要用属主个人的令牌**。会话名是小写字母开头、小写字母/数字/连字符，≤64 字符：

```bash
curl -s -X POST -H "X-Admin-Token: <admin-token>" -H 'Content-Type: application/json' \
  -d '{"name":"team-<团队名>"}' <market-url>/api/mcp/sessions
```

应答里的 `token` **只出现这一次**（库里只存 sha256，没有取回接口），立刻交给团队所在宿主的管理员保管。丢了就吊销（`DELETE /api/mcp/sessions/<id>`）再建一个。

然后授权。`PUT …/grants` 也是**整体替换**，传完整的工具名数组：

```bash
curl -s -X PUT -H "X-Admin-Token: <admin-token>" -H 'Content-Type: application/json' \
  -d '{"grants":["ygllc__read","ygllc__write","ygllc__verify","ygllc__doctor"]}' \
  <market-url>/api/mcp/sessions/<id>/grants
```

- 只读的会话（例如只给总工用的令牌）只授 `ygllc__read`。
- 市场的其它工具（工作台、SOP、技能等）按需加进同一个数组。
- 会话自己可以调免授权的 `access_info` 查看已授权的工具和完整目录，缺工具时用 `access_request` 提申请，管理员在市场「MCP 网关」页批准。

### 1.4 宿主：在 DSH 里把市场加成 MCP 服务器

用 DSH 自带的 `@deepseek-ai/dsh-mcp-client`，传输选 `streamable-http`，令牌放在请求头里。令牌从环境变量读，不要明文写进配置文件：

```yaml
- id: mcp-market
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: market
    transport: streamable-http
    url: <market-url>/mcp
    headers:
      Authorization: !!js `Bearer ${process.env.MARKET_MCP_TOKEN}`
```

- 工具在会话里叫 `mcp__<serverName>__<市场工具名>`，例如 `mcp__market__ygllc__read`。
- `serverName` 取短名（只能是 `[A-Za-z0-9_-]`，≤32 字符），**不要取 `ygl`**：`mcp__ygl__*` 是团队预设直连 ygl-trees 用的名字，宿主不允许把这个前缀的工具额外放行（见 1.5）。
- `MARKET_MCP_TOKEN` 设在启动 DSH 服务的环境里（服务文件或宿主的环境配置），值是 1.3 发给这个团队的令牌。
- 自检：不带令牌请求 `<market-url>/mcp` 应得 401；带上团队令牌调 `access_info` 应列出 1.3 授的工具。

> 一台宿主上的预设是共用的。若这台宿主服务多个团队，它们共用同一个令牌，市场看到的是同一个会话身份；要按团队分开审计，就按团队分宿主，或分别挂载。

### 1.5 团队角色怎么看到这些工具

**现状（当前版本）**：宿主的角色守卫（`src/superagent/host/role-tools.ts`）是**白名单**。总工、成员、观察者各有固定的工具清单，市场的 `mcp__market__*` 不在其中，所以挂上之后团队会话**默认看不到也调不了**：

- 属主在 nexus 面板的团队设置 →「额外放行的工具」里，按一行一个工具名填写：
  - 「总工额外放行的工具」：只读的，如 `mcp__market__ygllc__read`；
  - 「成员和观察者额外放行的工具」：如 `mcp__market__ygllc__read`、`mcp__market__ygllc__write`、`mcp__market__ygllc__verify`、`mcp__market__ygllc__doctor`。
  这一块要在已登录的界面里保存。删掉一行就是收回。
- 成员或观察者调到白名单外、可以放行的工具时，宿主会给属主提一张 P0 决策卡申请；批准后工具名会出现在上面的清单里。
- 无论如何都不能放行的：团队自己的协议工具、跨出团队的 `a2a_route` / `a2a_file_send`、入队退队、子代理和其它会话相关的工具、`mcp__ygl__*`、`schedule_*`。
- 市场侧的授权仍然有效：宿主放行了，市场没授权的工具照样被拒。总工的只读由两层共同保证——宿主只放行 `…__read`，市场令牌也可以只授 `…__read`。

**即将变更**：正在进行的一项改动会让**成员和观察者默认放行**，只拦跨越边界的工具（上面「不能放行」那一类）；总工仍按白名单。这项改动发布后，成员和观察者不需要再逐个填写市场工具名；在那之前，按上面的方式填写。以当次发布说明为准。

---

## 2. 在团队预设之外挂载 ygl-trees MCP

团队预设（`cordis.patch.yml` 里的 `superagent-router` / `superagent-member` / `superagent-observer`）已经自带 `ygl` 这个 MCP 服务器。下面针对**不用这些预设**、自己挂 `ygl-trees mcp` 的宿主，例如跑 `web` 配置并带自有 overlay 的宿主。

### 2.1 每个进程要有自己的 `YGL_SESSION`

ygl-trees 的「当前项目」按 `YGL_SESSION` 分桶记录。DSH 启动 MCP 子进程时会清掉 `DSH_*` 变量，若不另设 `YGL_SESSION`，**所有进程共用默认桶**：一个代理 `project use` 切了项目，并行的其它代理也跟着被切走，写进错误的项目。

所以不要直接把命令写成 `ygl-trees mcp`，用团队预设同样的包装，让每个进程有自己的会话名：

```yaml
# macOS / Linux
- id: mcp-ygl
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: !!js process.platform === 'win32'
  config:
    serverName: ygl
    transport: stdio
    command: sh
    args: ['-c', 'YGL_SESSION="superagent-$$" exec ygl-trees mcp']
    env:
      YGL_HOME: <team-ygl-home>
# Windows
- id: mcp-ygl-win
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: !!js process.platform !== 'win32'
  config:
    serverName: ygl
    transport: stdio
    command: cmd
    args: ['/d', '/s', '/c', 'set "YGL_SESSION=superagent-%RANDOM%%RANDOM%" && ygl-trees mcp']
    env:
      YGL_HOME: <team-ygl-home>
```

`$$` 是 shell 的进程号，`exec` 之后就是 ygl-trees 自己的进程号；Windows 没有现成的进程号，用两个 `%RANDOM%` 拼一个足够少碰撞的名字。前缀 `superagent-` 只是惯例，可换成本宿主自己的名字，关键是每个进程不同。

### 2.2 `YGL_HOME`：团队用自己的工作区

- 团队的工作区和属主个人的工作区分开。团队预设的取值是：环境变量 `SUPERAGENT_YGL_HOME`，没设则 `<用户主目录>/.ygl-trees-superagent`。自己挂载时，在 `env` 里显式写 `YGL_HOME`，和团队预设指向同一处即可共享团队记忆。
- 工作区第一次使用前要建库：`YGL_HOME=<team-ygl-home> ygl-trees db init`。用团队预设时宿主会在启动时自动做这一步；自己挂载、不用预设的宿主要手动做一次。
- `ygl-trees` 要在 DSH 服务的 `PATH` 上；找不到命令时 MCP 服务器起不来，会话里就没有 `mcp__ygl__*` 工具。

### 2.3 先 `project use`，再 `agent brief`

工作区里有不止一个项目时，目前 MCP 的 `read` 在 `agent brief` 上**不认显式传入的 `project`**（ygl-trees#260，0.122.0 可复现）：没有选中项目时报 `ambiguous project`，已经选中别的项目时**静默返回那个项目的结果**。在修复它的 ygl-trees 版本发布前，按这个顺序调用：

1. `write {"domain":"project","action":"use","name":"<项目名>"}`——应答里 `scope` 为 `session`、`session` 是本进程的会话名，说明只改了自己的选择；
2. 再 `read {"domain":"agent","action":"brief"}`。

这一步只有在 2.1 的包装生效时才安全：共用默认桶时，`project use` 会把其它进程的选择一起改掉。

---

## 3. 检查清单

| 项 | 判据 |
|---|---|
| 市场拒绝匿名 | 不带令牌请求 `<market-url>/mcp` → 401 |
| 团队令牌授权 | 带团队令牌调 `access_info`，`granted` 含 1.3 授的工具 |
| 上游在位 | `access_info` 目录里有 `ygllc__read` 等四个工具 |
| 宿主放行 | 团队设置的「额外放行的工具」列有对应的 `mcp__market__*`（或已升级到默认放行的版本） |
| 进程隔离 | 两个会话分别 `project use` 不同项目，各自 `agent brief` 返回自己的项目 |
| 工作区分开 | 团队工作区 ≠ 属主个人工作区；团队工作区里有 `ygl-trees.db` |
