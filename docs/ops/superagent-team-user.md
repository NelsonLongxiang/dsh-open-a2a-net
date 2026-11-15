# superagent 团队会话用单独的系统用户（部署指南）

> **不推行（属主 2026-11-12）**：「各节点啊，无需新开系统用户，这太麻烦了」。本页不再续写，也不是工作台市场上线的前置条件，保留在这里只作历史记录。
> - 团队会话照旧和宿主跑在同一个系统用户下，所以成员能读到这个用户能读的所有文件。这个风险属主已知。
> - 改用不需要新用户的办法来收：
>   - 市场 MCP 令牌只放在宿主进程的内存里，见 [superagent-team-mcp](../design/superagent-team-mcp.md)；
>   - 凭据访问留痕并提决策卡（#612）；
>   - 成员人设里写明只用交给它的工具和凭据。

**交付对象**：要在节点上跑 superagent 团队的属主或运维
**适用版本**：`@nelsonlongxiang/dsh-open-a2a-net` 0.8.1-preview.13 起（跨实例成员早已具备；凭据访问留痕见 #612）
**状态**：第一版，2026-11-11。还没有在节点上从头走过一遍（建系统用户要属主的管理员权限）；第 3 节的权限检查和第 5 节的环境变量结论是在测试宿主上实测的，其余步骤照现有机制写成，属主或运维第一次照做时请把结果补进来。
**背景**：2026-11-11 本机市场试联中，一名团队成员发现自己没有市场工具，便自己翻遍文件系统，从另一个会话的临时目录里读到令牌文件并用了它。团队会话的沙箱只限制「写在哪儿」，不限制「读什么」：同一系统用户能读的文件，它都能读。属主选定的修法是：**团队会话跑在单独的系统用户下，属主的凭据都不放进那个用户能读的地方**。

> 本页的用户名、端口、目录都是占位符：`<owner>`、`dsh-team`、`dsh-member`、`<team-port>`、`<member-port>` 等，按本机替换。不要把真实地址或口令写进会提交到仓库的文件。

---

## 1. 为什么是「另起一个 DSH 实例」，不是「让宿主换个用户拉起会话」

DSH 把所有会话都跑在**同一个进程**里，会话的工具命令是这个进程的子进程，用的是同一个系统用户。DSH 本体没有「让某个会话以另一个用户运行」的能力。

所以「团队会话用单独的系统用户」的做法是：**以那个用户另起一个 DSH 实例**，团队会话建在那个实例上。a2a-net 已经支持「成员在另一个实例上」（跨实例成员，见 `src/skill/references/superagent.md`「Members on other hosts」）：

- 团队宿主上的画布把成员写成 `<zone>/<id8>@<指纹>`，钉住成员实例的名片公钥；
- 成员实例 `serve` 这个团队，只接受这把公钥派来的活；
- 派活、报告、空闲都是两台宿主之间的签名请求，不走 A2A 路由，不欠回执。

| 由谁做 | 内容 |
|---|---|
| a2a-net（已具备） | 跨实例成员（`serve` / `add-member` 带 `peer`）、按公钥认身份、进展与名册、凭据访问留痕（#612） |
| 属主在节点上做 | 建系统用户、收紧属主目录权限、以那个用户启动 DSH、给那个实例配模型凭据 |
| DSH 本体 | 这套做法不需要 DSH 改动。若将来要「同一实例内按会话换用户」或「沙箱限读」，要找 DSH 上游，不归本仓库 |

## 2. 推荐的拓扑：三个系统用户

| 系统用户 | 跑什么 | 持有什么 | 团队成员能读到吗 |
|---|---|---|---|
| `<owner>` | 属主自己的 DSH（日常工作、开发席等） | 属主控制口令（`~/.a2a`）、CLI 身份私钥、ssh、gh、npm 凭据、属主的会话和仓库 | 不能 |
| `dsh-team` | **团队宿主**：总工会话、a2a 插件、superagent；对外的画布地址 `<zone>/canvas/<name>` 在这里 | 团队宿主的名片私钥；将来的团队 MCP 令牌（只在这个实例进程里） | 不能 |
| `dsh-member` | **成员宿主**：成员和观察者会话，`serve` 团队宿主 | 成员宿主自己的名片私钥、它的模型凭据、成员的工作目录 | 能（这是它们自己的） |

- **为什么成员和总工分两个用户**：成员读得到自己用户下的一切。分开之后，成员读不到团队宿主的名片私钥（不能冒充团队宿主签名），也读不到团队宿主将来持有的 MCP 令牌。
- **最小起步**（只有一个 `dsh-team` 用户，总工和成员都在它下面）：已经能让成员读不到属主的凭据，但成员能读到团队宿主的私钥和它持有的任何令牌。不接市场 MCP 时可以先这样，接 MCP 之前要拆成两个用户。
- 总工也有 shell（命令最多 5 秒、文件只读），所以总工同样不能跑在 `<owner>` 下。

## 3. 第一步：收紧属主的目录（先做，最重要）

单独的用户只有在属主的文件对它不可读时才有用。本机实测（macOS）：

- 属主家目录是 `drwxr-x---`，组是 `staff`，而 macOS 上每个本地用户都在 `staff` 组里：**新建的用户能进属主家目录，读到所有组可读的文件**（比如 `~/workspace` 是 `drwxr-xr-x`）。
- `~/.a2a`、`~/.ssh`、`~/.dsh`、`~/.npmrc` 已是仅本人（700/600），这几项不用动。

```bash
chmod 700 ~
```

Linux 上同样检查 `ls -ld ~`，组或其他人有 `r`/`x` 就收成 `700`。共享给团队的东西（见第 5 节）放在属主家目录之外。

## 4. 建用户、建实例

建用户（属主在节点上做，需要管理员权限）：

```bash
# macOS
sudo sysadminctl -addUser dsh-team -fullName "DSH team host" -password -
sudo sysadminctl -addUser dsh-member -fullName "DSH team members" -password -
```

```bash
# Linux
sudo useradd --create-home --shell /bin/bash dsh-team
sudo useradd --create-home --shell /bin/bash dsh-member
```

每个用户各有一份 DSH 配置（各自的 `~/.dsh`）：先从默认的 web 配置建一个 profile，再装插件。`<dsh>` 是 DSH 命令的完整路径（macOS 上在 `DeepSeek Harness.app` 的 `Contents/Resources/runtime/cli/bin/dsh`），别的用户的 PATH 里通常没有它：

```bash
sudo -u dsh-team -i "<dsh>" team --from-default-profile web --dump-config > /dev/null
sudo -u dsh-team -i "<dsh>" plugin --profile team add @nelsonlongxiang/dsh-open-a2a-net@0.8.1-preview.13
sudo -u dsh-member -i "<dsh>" member --from-default-profile web --dump-config > /dev/null
sudo -u dsh-member -i "<dsh>" plugin --profile member add @nelsonlongxiang/dsh-open-a2a-net@0.8.1-preview.13
```

两个实例各自的 `cordis.patch.yml`（只回环、互为 seed；端口按本机选）：

```yaml
# dsh-team: ~/.dsh/profiles/team/cordis.patch.yml
- id: webserver
  config: { host: 127.0.0.1, port: <team-port> }
- id: a2a
  config:
    peers: [ http://127.0.0.1:<member-port> ]
    announce: true
    superagent: true
```

```yaml
# dsh-member: ~/.dsh/profiles/member/cordis.patch.yml
- id: webserver
  config: { host: 127.0.0.1, port: <member-port> }
- id: a2a
  config:
    peers: [ http://127.0.0.1:<team-port> ]
    announce: true
    wakeJoinedOnBoot: true
```

团队宿主要接市场时，把市场地址也加进 `dsh-team` 的 `peers`（见 [superagent-market-team.md](superagent-market-team.md)）。

## 5. 启动：用干净的环境

用 `sudo -u <user> -i`（登录式，环境是那个用户自己的）或系统服务（macOS LaunchDaemon 带 `UserName`、Linux systemd 带 `User=`）启动，**不要从属主的终端带着属主的环境起**：

```bash
sudo -u dsh-team -i "<dsh>" --profile team --no-open
sudo -u dsh-member -i env SUPERAGENT_YGL_HOME=/Users/Shared/dsh-team-ygl "<dsh>" --profile member --no-open
```

**成员的 shell 会继承什么**（2026-11-11 在测试宿主实测一次，只看变量名不看值）：成员的 shell 继承启动 DSH 那个进程的环境。测试宿主是从属主的终端起的：名字里带 key/token/secret/pass 的变量一个都没有，但有 `SSH_AUTH_SOCK`（能用属主的 ssh-agent）和几项启动终端带进来的变量。所以：

- 以单独用户、登录式或服务方式启动，`SSH_AUTH_SOCK` 等属主环境就不会出现；
- 模型凭据：每个实例要有自己的模型密钥，**这个实例里的会话读得到它**。给团队实例单独发一个额度受限的密钥，不要用属主自己的；
- 起好之后照第 8 节的检查确认。

**共享的东西**：团队的 ygl-trees 工作区要让总工（读）和成员（读写）都能用。放在属主家目录之外的共享目录，用一个两人都在的组：

```bash
# macOS（Linux 用 groupadd / usermod -aG）
sudo dseditgroup -o create dsh-share
sudo dseditgroup -o edit -a dsh-team -t user dsh-share
sudo dseditgroup -o edit -a dsh-member -t user dsh-share
sudo mkdir -p /Users/Shared/dsh-team-ygl && sudo chown dsh-member:dsh-share /Users/Shared/dsh-team-ygl && sudo chmod 2770 /Users/Shared/dsh-team-ygl
```

两个实例都把 `SUPERAGENT_YGL_HOME` 设成这个目录（上面成员实例的启动命令已带上；团队宿主同样加上）。

## 6. 把团队搭起来

1. 在 `dsh-team` 实例上建总工会话（预设「superagent 总工」）。
2. 在 `dsh-member` 实例上建成员会话（预设「superagent 团队成员」），在侧栏加入 A2A 网络。
3. 在 `dsh-team` 上建画布、把总工放进去，并把成员以**远端成员**加进去（显式选 `dsh-member` 这台宿主）：

   ```bash
   curl -s -X POST -H 'Content-Type: application/json' http://127.0.0.1:<team-port>/__dsh_a2a/canvas \
     -d '{"action":"add-member","name":"<canvas>","id":"<zone>/<成员 id8>","peer":"http://127.0.0.1:<member-port>"}'
   ```

4. 在 `dsh-member` 上让成员服务这个团队（`<fp8>` 是 `dsh-team` 名片公钥指纹）：

   ```bash
   curl -s -X POST -H 'Content-Type: application/json' http://127.0.0.1:<member-port>/__dsh_a2a/superagent \
     -d '{"action":"serve","team":"<zone>/canvas/<canvas>@<fp8>","members":["<成员会话 id>"]}'
   ```

5. 在 `dsh-team` 上绑定团队：`POST /__dsh_a2a/superagent/teams {"canvas":"<canvas>","router":"<总工会话 id>"}`，再按 [superagent-market-team.md](superagent-market-team.md) 配 bot 名单、接单规则和准入。

控制路由要属主口令或回环信任；改团队规则要在已登录的 DSH 界面里操作。

## 7. 现有团队怎么迁

团队的对外地址（画布地址）跟着团队宿主走。迁移时：

1. 按第 4–6 节起好两个新实例，在新团队宿主上建同名画布和团队，配好规则和准入。
2. 等旧团队手上的工单结束（团队页没有在办工单），或由属主停掉。
3. 告诉调用方（如市场）新的画布地址和名片指纹，按清单重新钉公钥；旧画布从调用方那里移除。
4. 旧实例上的团队解绑（团队设置里清掉画布），旧团队会话退出 A2A；属主确认后停掉旧实例。

工单、决策卡和 ygl-trees 记录不会自动搬家：旧实例的状态目录留档，新团队从空状态开始；需要沿用的知识用 ygl-trees 的导出/导入搬。

## 8. 核对：团队用户确实读不到

以团队用户身份逐条跑，期望**全部读不到**（`Permission denied` 或 `No such file`）：

```bash
for u in dsh-team dsh-member; do
  for p in ~<owner>/.a2a/host.env ~<owner>/.ssh ~<owner>/.config/gh ~<owner>/.npmrc ~<owner>/.dsh ~<owner>/workspace \
           "/private/tmp/claude-$(id -u <owner>)" "/Users/<owner>/Library/Application Support/Claude"; do
    sudo -u "$u" -i sh -c "test -r \"$p\" && echo \"READABLE: $u $p\" || true"
  done
done
```

成员读不到团队宿主的私钥（两用户拓扑时）：

```bash
sudo -u dsh-member -i sh -c 'ls ~dsh-team/.dsh 2>&1 | head -1'   # 期望 Permission denied
```

成员会话里看到的环境（只看名字）：在一个成员会话里让它执行下面这条，期望没有 `SSH_AUTH_SOCK`，也没有属主的变量：

```bash
env | cut -d= -f1 | grep -i -E 'key|token|secret|pass|auth|ssh' | sort
```

再看团队页的凭据访问留痕（#612）：正常工作时 `credentialAudit` 应为空。

## 9. 仍然存在的限制

- **进程列表**：macOS 和多数 Linux 上，任何用户都能用 `ps` 看到别的用户进程的命令行（试联中成员就是从这里找到了路径）。命令行里不要带口令或令牌；有口令的服务从文件或环境读，不从参数读。
- **回环上的服务**：团队用户能连本机所有回环端口。属主本地跑的服务（如市场试联实例、属主自己的 DSH 控制路由）要靠口令把门，不能只靠「只监听回环」。
- **团队实例自己的密钥**：成员读得到成员宿主自己的模型密钥和名片私钥；所以给团队实例单独、受限、可吊销的密钥。
- **团队 MCP 令牌**：按两用户拓扑，令牌只放在 `dsh-team` 实例进程里，由宿主代成员调用，不落 `dsh-member` 读得到的地方。具体做法另见团队 MCP 设计稿（待出），在那之前不给团队发 MCP 令牌。
