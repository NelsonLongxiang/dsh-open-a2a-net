# Intent：节点平铺 + 多队成员制迭代窗（2026-08-31）

## 为什么是现在

1. 主人 2026-08-31 指令："平铺所有节点，无论对等节点还是本地网络节点；一个节点可参与
   多个队伍，只能在队伍内协作，未参加队伍视为无网络节点；增加工具可探测团队、自主加入
   和退出团队。"——资料已配齐，开始变革。
2. 自动唤醒"残废"定案（2026-08-31 取证）：51 分钟运行 10/16 joined 冷；prewarm 三宗
   硬伤（单次快照/失败无重试/materializer-unavailable 静默停摆）+ 0.5.41 构建盲区。
   F8 设计卡（PR !64）已合，欠实现。
3. 准入政策已裁：allowlist 起步（代决策席 2026-08-31，制度化主人"未加入不能自主加入 +
   拒绝 a2a tools"指令）。

## 范围

docs/design/team-roster-model.md 的 R1-R4 + F8，一个迭代窗、一个 PR 链。

## 边界

- 主工作区只读；一切开发在 `.claude/worktrees/team-roster-f8`（分支 feat/team-roster-f8）。
- 只提 PR 不合并；评审归独立评审侧；3081 测试节点做组合验证。
- `teamScopeRouting` enforcement 默认关；触达在网节点前向代决策席报备。
- 门禁 `pnpm verify`（typecheck×2 + 全量 + build-layout + nexus + dist 对账）。

## 非目标

见设计卡第五节。
