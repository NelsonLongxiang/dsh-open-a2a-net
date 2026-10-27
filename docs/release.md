# 发布纪律（release discipline）

> 2026-10-21 立，源自 K3 测试章前瞻（cordis 事故线收尾）：两项与「锁重生成 × 环境策略」
> 交互的坑，已实测咬人，故入档为纪律。

## 1. cordis 归一 override 的单一归属纪律

overrides **只在 `pnpm-workspace.yaml#overrides`**（pnpm ≥11.24 读取）：

```yaml
'@deepseek-ai/cordis': 4.0.5
'@deepseek-ai/cordis-plugin-loader': 1.0.5
```

动机：图内 102 个 dsh-\* 包 peer 钉死 cordis 精确 4.0.1、61 个插件线 peer 要求 ~4.0.4，
范围互斥——无 override 的任何锁重生成都会双实例回潮（类型增广裂解 → 干净检出必红，
事故 0e32ae1）。锁重生成后以
`grep -cE "^@deepseek-ai\+cordis@4" node_modules/.pnpm`（期望 1）复核。

沿革：2026-10-21 立规时为「`package.json#pnpm.overrides`（pnpm <11.24 读取）+ workspace.yaml 双文件同值」。
**2026-10-25 起 `package.json#pnpm` 镜像退役**（gh#46 修复轮 a3a57b8）：pnpm 11.28 的 verify-deps
在该字段存在时拒跑一切 pnpm 脚本，且舰队三机已归一 pnpm 11.28.5、无 pre-11.24 读者。
现行约束（监督 S7 机器核对）：`package.json` **不得**再出现 `pnpm` 字段；`packageManager`
钉 `pnpm@11.28.5`，`engines.pnpm` 为 `>=11.24 <12`。

## 2. minimumReleaseAge × 锁重生成发布窗口

锁重生成会把「窗口期内的新版包」写进锁（如 fast-uri@3.1.9）；此后**所有**干净检出
`pnpm install --frozen-lockfile` 都被 minimum-release-age 策略拦死——不是缓存问题，
是策略按锁内版本的发布时间判定。

纪律：
- 候选期/发布窗口内做干净检出安装，统一带 `--config.minimum-release-age=0`；
- 无法带 flag 的环境（CI 模板等）：把窗口期新包加进 `pnpm-workspace.yaml`
  的 `minimumReleaseAgeExclude` 列表（现列 dsh-\* 0.1.2-alpha.3 六件）；
- 锁重生成提交前，本机跑一次干净检出 frozen install 复核（gold standard）。
