# open-a2a-net 监督席 S 层判据（v24）

> v24（2026-11-10，#570 属主裁定「豁免并更新材料」）：相对 v23 只改 S24 一条——vendored 上游 `src/superagent/upstream/` 不计入模块上限（UPSTREAM.json 逐文件哈希冻结、原样运行，本仓不改）。其余 S1–S27 逐字沿用 v23（取自 verify/candidates-supervision.json 的逐字引文）。自 v24 起材料随仓库 git 跟踪（AGENTS.md 铁律四）。

## 判据

S1 docs/validator.md 声称的每个 PASS run 报告必须存在（tmp/ygl-verify/verify/reports/）且 overall 必须为 PASS。

S2 战役提交（f124eee、c65416d、8b8efeb）必须是 master 血统的祖先；package.json 版本必须为 0.6.x；工作树必须为净（无 tracked 改动）。

S3 ygl-trees doctor 必须 0 fail；监督域树（v2-roadmap、time-capsule）node validate 必须无 issues。

S4 docs/validator.md 逐周期声明的 head 必须在 git 历史可追；spec_c8b6350c5034 必须在案。

S5 上一轮监督运行记录的静态事实（战役提交血统）本轮必须仍成立（递归持久性，血统断言）。

S6 GitHub 公开仓与 gitee 镜像的公共面陈旧检测（v12→v18 双演进：路线图 issue 豁免；非路线图 issue 仅当 >72h 且零活动才计红——在途=正当工作态不闪红，陈旧=真垃圾才红；判据随属主行为演进第二课）。

S7 pnpm overrides 单一归属（2026-10-25 gh#46 修复轮 a3a57b8 演进）：pnpm-workspace.yaml overrides 为唯一归属且非空，package.json#pnpm 必须缺席（镜像字段与 11.28 开发机互斥——A/B 实证字段在场=verify-deps 拒跑一切 pnpm 脚本）；packageManager 必须钉 pnpm@11.28.5；engines.pnpm 必须含 >=11.24 范围。

S8 src/index.ts 必须保留三修复锚（visibleTeams.add(config.team) 无条件 / visibleTeams.add('log') / joinedTeamScope 含 canvasTeamOf）；M2 反形状（if (joined.size > 0) visibleTeams.add(config.team)）必须不存在。

S9 docs/testing-layers.md 的五层目录名、package.json 的五个分层脚本、磁盘 tests/{unit,wire,mesh,gates,live} 三方必须一致。

S10 OriginClaim 三面验签必须复用 verifyOriginClaim 入口；信封 shape 必须收窄 bare zone（originClaimCallerShape）；M1 窗口配置 originClaimWindow 必须在位；验签失败必须 fail-closed 归最小卡（untrusted-origin 同码）。

S11 控制面钥规范必须落地：钥注入分支必须带 controlTrustedWithoutKey loopback 门；controlFaceLeniencyWarning boot 告警必须在场（loopback 信任=减速带非门）。

S12 属主信号 UI 锚必须在场：异常驱动 alerts 芯片（死信 danger/陈旧 warn/欠回执 warn，PR#30 台账重设计取代 wb-row-alert 行类）、订单卡 brief 主文案、对话默认展开（属主裁定 PR#28）三锚齐备。

S13 活宿主构建指纹必须鲜活：当前最新控制面（/a2a/canvas-op，gh#41 锚）必须在活宿主路由集内（404 全局=进程未换构建即红，dc64eb1 三层根因教训——判据=路由指纹非安装输出）；nexus bundle 哈希对比为尽力信息面（401 无钥面不可达时以路由指纹为准）。

S14 同 zone 准入的 remote-ref 信任基（PR#44/gh#43）：sameZoneSharedTeamRefusal 须经 remoteMembersOf 解析 operator 手工 canvas 组（与 foreign-zone 分支对称）；declared 扩容唯一来源=宿主 canvasStore（caller 自述永不入——V5 信任基不破）。

S15 一键重排几何不变量（PR#45）：sole 成员 bbox ⊆ 其框、框两两构造性不相交（行流式平铺）、框宽随成员数变化（perRow=min(4,ceil√n)）——三不变量钉在 planning-relayout 面。

S16 CLI 墓碑（gh#47）：过期户口标记不删（expiredAt）+目录留痕+同句柄同钥 re-publish 复活——身份面死/目录可追溯两面分离。

S17 canvas 自环豁免（PR#42/gh#41）：dispatch 路径传 originAgentId 经 skipId 跳过真发起者（借脸不豁免由 wire 钉承载）；纯自环组 would loop 拒绝。

S18 准入双向识别（PR#46/gh#71）：暖缓存对端 canvasOrg 供共享队判定（信封拉取全量面回灌+准入增读对端 org——匿名最小卡永无 canvasOrg 的设计下唯一全量通道）；工具门组名匹配不扩边界（负例钉）。

S19 画板加固双锚（PR#48）：planning-view.ts 行数 ≤1507（M1 棘轮收紧·属主令 2026-10-27 d9946e8 与 a2a-frontend-verifier 一致——上限失守一次即失效，mountBoardSearch 一次包圆接线纪律）；flyer 必须以 WorldBounds(min/max) 形调 fitView（{x,y,w,h} 直传=静默 IDENTITY 根防）。

S20 npm latest 必须等于 package.json version（#55 发布定案——npmjs 主仓 Gitea 镜像；latest 落后 master 即红）。

S21 文档漂移核心对照（#56）：docs 工具面计数与 ctx.tools.register 源计数一致（十枚基线）。

S22 legacyInbound 基线计量（#64）：探针面逐轮记录本机计数（关窗条件=舰队连续 7 天零增量+外部示例带信封——关窗动作为属主裁，计量先行）。

S23 src/index.ts 两段式 M1 第一段（#77 裁定 2026-10-27）：行数 ≤4717（G-in 批末 4753→4717·三 PR 波债 +132 经 native-teams 入站桥四函数迁 src/legacy/teams-bridge-inbound.ts 偿还·EOF 清理；互锁：#57/#60 先落、#77 B3-B5 随后、B1/B2 可先行）。

S24 src/ 模块上限（#77 属主终裁 R-mod；#570 属主 2026-11-10 裁定豁免 vendored 上游）：除 index.ts 外任一 .ts ≤1200 行（只降不升·S23 族；B1 合并后 S23 上限随降至 index.ts 实际行数）；vendored 上游 src/superagent/upstream/ 不计（UPSTREAM.json 逐文件哈希冻结、原样运行，本仓不改）。

S25 跳数预算第一步（#60·576de3e）：src/recursion-guard.ts 必须在（DEFAULT_HOP_BUDGET=4+refuseIfBudgetExhausted 助手）且 index.ts ingress 单缝接线（visited/deadlineAt/转发递减随 #57——横幅如实分步）。

S26 命名注入防线（PR#78 落地面）：nexus-stage/src/stage-name.ts 含 innerHTML 的次数必须为 0（textContent-only——名字=对端可控数据，注入防线机器锚）。

S27 直连防洪闸（gh#91·PR#92）：src/flood-guard.ts 必须在（-32008 线码+16/min 滑动窗+跨 file 累计语义）且 index.ts 接线（每 apply() 一实例）；未部署声明随文档保持（事故 open）。
