# 交接报告：活跃会话数与资源占用关系研究（2026-08-24）

研究问题：激活（已物化）的会话越多，占用性能是否也越多？
方法：双路只读调查——宿主（deepseek-harness）每会话成本审计（含 file:line 证据）+ 插件侧（dsh-open-a2a-net）边际成本与本机实测。
结论先行：**是。内存严格线性（主导项），空闲 CPU 近零，活动 CPU 随"正在产出事件的会话数"线性，另有两个隐藏乘法项（O(N²) 事件分发过滤、冷查找全量扫描）。**

---

## 一、成本刻度表（核心交付）

| 成本项 | 刻度 | 空闲时 | 证据 |
|---|---|---|---|
| 堆内完整事件日志（明文、deep-frozen、无逐出，含 token 级 chunk） | **每活跃会话线性**（随日志长度增长） | 常驻 | core/session/src/index.ts:427,634-651 |
| 每会话 Cordis scope/fiber + 投影 cell + write-behind 控制器 | 每活跃会话（小常数） | 常驻 | agent-loop/src/agent.ts:80-97；session-projection/src/index.ts:156-161 |
| Preset 插件组合/工具注册 | **常数**（按 preset 共享，不随会话重复） | 常驻 | preset/agent-presets/src/index.ts:250-252 |
| Write-behind / 投影缓存定时器 | 每会话，仅有 pending/dirty 时武装 | **零** | write-behind.ts:45-90；projection-cache/index.ts:200-238 |
| Agent 驱动循环 | 纯 promise 驱动，idle 无任何调度 | **零** | agent-loop/src/agent.ts:38-46,172-193 |
| 投影 apply / telemetry structuredClone / write-behind structuredClone / append 快照 | 每事件（约 **3 次深拷贝/事件**） | 仅活动时 | core/session/index.ts:609-663；write-behind.ts:47；telemetry coordinator.ts:199 |
| Agent 级 `session/event` 监听器 scope 过滤 | **O(N²) 聚合**（每事件 × N 个监听器过滤；常数极小） | 仅活动时 | agent-loop/src/runtime-context.ts:46；core/scope/src/index.ts:170-185 |
| 冷查找 `persistence.list()` 全量 header 枚举 | **O(全部存储会话)/次**（重复冷打开 = 磁盘 I/O 平方级） | 仅冷路径 | agent-loop/src/index.ts:424；session-persistence-jsonl/src/index.ts:794-829；session-query/src/corpus.ts:96-100 |
| Resume/物化（全日志校验+迁移+冻结，加载峰值 ≈ 2× 日志） | O(日志长度) | 仅唤醒时 | coordinator.ts:642-677,1110-1149 |
| JSONL findLog/lease 检查 | O(项目目录数)/次 | 按需 | session-persistence-jsonl/src/index.ts:1109-1131 |
| 会话数硬上限 | **不存在**（仅子代理深度/工具并行度有限制） | — | grep 全仓负结果 |

## 二、本机实证（生产 3080，被动观测）

- **25 个活跃会话 → 工作集 3440 MB**（30 个 node 进程中第二名 181 MB）——最直接证据，均值约 130MB/活跃会话；
- 存量：`C:\Users\Administrator\.dsh\sessions` 232 个 zstd 共 447 MB；`session.list` 报 228 会话（72 root + 156 subagent），3 个在运行；a2a 视角 29 行（25 live / 4 cold）、24 join intent、卡片发布 20 个 sessionTeams、state 响应体约 24–29KB；
- a2a 面板 `X-A2A-Timing` 实测：空闲 poll `facts=0–1ms`；有会话产出事件时跳至 **50–63ms**（11 样本中 3 个尖峰）——"活跃会话数 × 事件产出率"的现成观测面；
- 插件侧每会话每 poll 成本已被缓存（title/excerpt 指纹 WeakMap + 500 事件扫描上限）压到微秒级；监听器全局注册一次，无每会话监听器泄漏面。

## 三、当前观测缺口

宿主无任何内存/CPU/事件循环 HTTP 端点（`host.describe` 仅含 `attachedSessions`）。可用代理：`X-A2A-Timing` 百分位、外部 `Get-Process` 采样、`typeperf`。**这正是 dsh-perf-analyzer P1 的动机**（该插件仓库 `D:\workspace\dsh-perf-analyzer` 已有骨架）。

## 四、实验协议（未执行，供后续验证）

在隔离测试宿主 **3081**（`DSH_HOME=D:\dsh-test-homes\3081`，见 dsh-plugin-dev-test 技能规则）执行，勿用生产 3080：

1. 基线 N=0：干净启动，1s 采样 WS/CPU 入 CSV，30 次 state 请求取 X-A2A-Timing p50/p95；
2. N ∈ {5,10,20}：`POST /api/session.create` 逐个建空会话（间隔 2s），每档静置 120s 后重复采样窗口，记录 ΔWS/ΔCPU 与 `attachedSessions`；
3. 活跃臂：窗口内保持 ≥3 会话持续产出（`/a2a/direct` wait:false 本地 steer），对比 facts p95；
4. 唤醒臂：逐个触发冷唤醒，按存储日志大小回归 materialize 耗时（prewarm 日志/state cold= 相位可见）；
5. 事件循环：state p95/p99 做 jank 代理，或先装 dsh-perf-analyzer P1 探针。

## 五、结论与实践指导

1. **权衡有数据了**：闲置活跃会话的代价几乎全是内存（~130MB/会话均值），CPU 只在活动和唤醒瞬间发生。因此 `wakeJoinedOnBoot: false`（按需物化）是正确默认——省 25 份全量日志驻留与唤醒回放，几乎不损闲置可用性。
2. **长期优化优先级**（上游 PR 候选）：
   - 内存逐出：事件日志不驻留、按需从 zstd 重放（最大收益）；
   - 事件分发过滤索引化（O(N²) 常数虽小，大规模会显现）；
   - 冷查找会话索引缓存（消 O(all-sessions) 扫描）；
   - 每事件 3 次深拷贝合并（需谨慎评估冻结语义）。
3. **告警挂钩**：dsh-perf-analyzer 应盯"活跃会话数 × 工作集"曲线（线性斜率突变=泄漏或日志失控）与 facts 相位 p95（活动会话数代理）。

## 六、关联文档

- 上一份交接：`D:\workspace\dsh-open-a2a-net\docs\handover-2026-08-23-startup-stall.md`
- 性能分析仪研究：`D:\workspace\dsh-perf-analyzer-research.md`
- 性能修复方案存档：`D:\workspace\dsh-open-a2a-net\docs\perf-fix-plan.md`
- 宿主回放让步决策：`D:\workspace\deepseek-harness\.agents\notes\implemented\architecture\2026-08-23-cold-open-replay-event-loop-yields.md`
