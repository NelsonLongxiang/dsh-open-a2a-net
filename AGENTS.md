# 验证器治理锚（AGENTS.md）

> 本文件是 ygl-trees verify 引擎 meta 闸的治理锚：验证器的开发、运维、使用以
> 本规范为准绳。逐字引自属主 2026-10-21 颁布的《验证器协同规范（通用版 ·
> 最强适应 × 最强铁律）》，kb f167b5b5f7 存全文。

## 五层铁律（判据随条）
1. **执行面唯一**：一切以验证器 CLI 为主，禁止临时编码执行。任何「验证结论」若不出自 CLI run 产物，视为未验证。
2. **产品即协同结果**：业务同事→数据包；协作方→通知。
3. **即时生产**：一次交付=一次完整生产循环；对已产出成品就地编辑即为违例。
4. **原料即采集数据**：产线原料必须来自验证器采集体系内的固定数据区（git 跟踪、可追溯）。
5. **判定即证据链**：判定只认 spec run；通过与不通过都是产物。断言逐字摘录自冻结材料；冻结后不许改。

## 本仓验证器家族
- RC 验证器（发布候选闸门）：scripts/verify-probe.mjs + ygl-trees verify run —— docs/validator.md
- 递归验证器（引擎自证）：scripts/verify-recursive.mjs —— docs/validator.md
- 监督域 S 层（台账诚实）：scripts/supervisor-snapshot.mjs（探针）+ mat_06b52a3559b3 材料（v24，verify/material-s-layer-v24.md；spec_4577e93cd8e7）—— verify/candidates-supervision.json

## 一句话总纲
CLI 是唯一执行面，数据包和通知是唯一产品，即时生产是唯一交付方式，验证器采集的数据是唯一原料，证据链是唯一裁判。

## 本仓目录与产物约定

- 正式工具进 `scripts/`，正式规范与交付进 `docs/` 的现有分类；根目录只留工具链入口，不放补丁脚本、解包目录、tgz 或日志。
- 一次性脚本、可控测试临时数据与证据进入本项目 `tmp/<任务标识>/`；复用能力须测试后晋升正式位置，不长期依赖 tmp。
- `feedback/` 与 `a2a-inbox/` 是本机资料，忽略但不擅删；正文契约不得依赖这些仅本机路径，历史依据使用固定提交链接。冻结 `verify/` 材料、在途文件、凭据和运行态不进入普通清理。
- 归档先查归属、活度与引用，保留原件和恢复信息；不通过 ignore 隐藏根散落。规则与检查见 [目录规范](docs/guides/repository-layout.md)，执行 `pnpm verify:layout`；测试临时根统一使用现有 `pnpm verify` 入口。
