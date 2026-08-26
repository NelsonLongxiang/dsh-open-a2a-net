# 交接报告：按需激活治理方案与插件层瓶颈治理（2026-08-24）

承接前两份报告（`handover-2026-08-23-startup-stall.md`、`handover-2026-08-24-session-scaling-research.md`）。本报告覆盖三块：①按需激活治理方案；②内存富余下的真瓶颈定位；③"宿主冻结、只做插件"约束下的瓶颈治理路线（含新插件立项）。

---

## 一、按需激活治理方案（四层）

### 层 0：已有机制（用好即得）

| 机制 | 状态 |
|---|---|
| `wakeJoinedOnBoot: false` | 已是 profile 当前配置 |
| Wake-on-route（路由到冷 team 才物化）+ per-id 单飞 | a2a 0.5.21 已发布 |
| 侧栏手动 wake / 打开即 remount / intent 持久化 | 已有 |
| 预热预算（delay 10s / quiet 5s / stagger 3s / 可取消） | a2a 0.5.21 已有 |

### 层 1：分级物化（核心概念）

```text
L0 冷：磁盘 zstd + header（零驻留）
L1 温：header + title + cwd + 尾部 N 事件（KB 级；readTailEvents 只解尾部帧，地基已有）
L2 热：完整物化（~130MB/会话均值，实测 25 会话 → 3440MB）
```

温态即可支撑侧栏列表/标题/活动摘要/team 寻址；翻历史或首个 turn 才升 L2。

### 层 2：降级与逐出（反向通道）

1. 空闲降级：`idleEvictMs` 内无事件/路由/waiter → 丢弃内存事件数组回 L1/L0（重升走现成 wake-on-route）；
2. 内存水位驱逐：RSS 超阈值按 LRU 降级；
3. 用户可见"挂起"操作 + 冷/温/热三态行（冷行 UI 已有，温态枚举为增量）;
4. archive 时若仍热先降级（现有 archive→prune 已做一半）。
⚠️ **待验证**：插件实现逐出需要 apiProxy 暴露会话休眠/关闭面；若无，只能靠用户关闭会话实现。

### 层 3：治理配置契约（全部 Config 化，无硬编码）

```yaml
sessionActivation:
  defaultTier: warm
  fullOnFirstTurn: true
  idleEvictMs: 1_800_000
  memoryHighWatermarkMb: 3072
  evictBatch: 3
  maxHotSessions: 12
```
配套：热会话数×估算内存 vs RSS 斜率告警（perf-analyzer 盯）；唤醒并发 ≤2 全局闸（复用 a2a prewarm 调度器形状）。

### 层 4：消灭唤醒税（原为终局项，现提为第一优先级，见下）

## 二、内存富余下的真瓶颈（四项，均非内存问题）

```text
真瓶颈 = ① 主线程同步区段（CPU 序列） + ② 事件循环争用（延迟）
        + ③ 全量扫描 I/O + ④ GC 停顿
```

1. **①同步区段（第一）**：zstd 单帧解码不可分割（帧间 500ms 让步救不了帧内）；解码后全量 clone/validate/freeze（已加 2000 事件让步，大事件仍一次性）；每事件 ~3 次深拷贝（append 快照 + write-behind + telemetry）。吞吐上限=主线程每秒的"解压+解析+克隆+冻结"量，加内存无效。
2. **②事件循环争用（第二）**：同一线程服务 Web/轮询/SSE/事件分发；实测回放期 state 5–25s 无响应 → ECONNRESET 刷屏 → 冷打开 30s 死线。附加 O(N²)：N 个活跃 agent 的 session/event scope 过滤器在每条事件上全量求值。
3. **③全量扫描**：冷查找 `persistence.list()` 枚举全部 228 存储会话并解压 header；prepared LRU 仅 5 格放大冷热切换；Windows 杀软扫描叠加。
4. **④GC**：3.4GB 工作集的 frozen 对象图 ×3 拷贝 → major GC 随机叠加几十至上百毫秒停顿（内存"够用"≠GC 便宜）。

## 三、"宿主冻结、只做插件"约束下的治理路线

**约束**：上游不接受 PR（此前合并的 #114 是自家 fork；今后 harness 视为冻结）。

### 核心组合拳：一个插件解决 ①worker 解码 + ③索引缓存

持久化后端是架构认可的插件位（coordinator 文件头：第三方后端可直接实现 persistence seam）。替换 stock jsonl 后端后，`list()` 实现权归我们——**③ 是 ① 的免费副产品**。

```text
新插件：dsh-session-persistence-worker
├─ P1 骨架：thin re-export stock 行为；cordis.patch.yml disable stock 行 + insert 本插件
│          —— 只证明挂载/热路径/卸载正确
├─ P2 索引缓存（=③）：list() 改 id→header 惰性索引；自有 create/delete/lease 失效
│          + 目录 mtime 兜底。冷查找 O(228 header 解压) → O(1)
├─ P3 worker 解码（=①）：readPrefix/readRaw 的 scan+decode+parse 移入 2–4 线程池
│          （按文件粒度传整帧列表+Buffer，零拷贝转移）；池满/失败退回主线程路径
└─ P4 readTailEvents 入池
```

**分叉维护税对冲（方案成立的关键）**：
- 上游契约套件（`runPersistenceContract`/`runCoordinatorContract`）可直接 import——**用上游自己的验收标准做一致性门禁**，harness 升级时重跑即可发现格式漂移；
- 存储格式零改动（只改"谁来算"）；torn-tail/writer-lease 语义原样复制；
- 启动版本探针：上游 jsonl 版本超出已验证范围 → 大声警告。

### #2 拷贝削减：插件层无解，转"监控+接受"

三次深拷贝在 core session/coordinator/telemetry 内部，插件不可触碰。处置：写入 perf-analyzer 监控项（事件吞吐×分配速率）；间接缓解已就位（按需激活减少了产生事件的会话数）。

### 瓶颈-方案映射总表

| 瓶颈 | 承载 | 状态 |
|---|---|---|
| ① worker 解码 | dsh-session-persistence-worker P3 | 🆕 立项 |
| ③ 索引缓存 | dsh-session-persistence-worker P2 | 🆕 立项（性价比最高，先行） |
| ② 观测 | dsh-perf-analyzer（`D:\workspace\dsh-perf-analyzer` 已有骨架） | 🆕 立项 |
| ② 减少入队工作量 | 按需激活/预热预算/单飞 | ✅ a2a 0.5.21 |
| ② 降级逐出 | 需验证 apiProxy 休眠面 | ⚠️ 排查 |
| ④ 拷贝削减 | 不可达 | 接受+监控 |

### 风险表

| 风险 | 缓解 |
|---|---|
| 上游格式演进致分叉失配 | 上游契约套件门禁 + 版本探针 |
| 替换挂载破坏 loader 树 | P1 纯 passthrough 先验证 |
| worker 传输大 buffer 序列化税 | 消息端口零拷贝转移 Buffer，不 JSON 往返 |
| 多实例 writer-lease | lease 文件格式与语义原样复制 |

## 四、建议起步顺序

1. **P1+P2** 一个里程碑（索引缓存收益立竿见影、风险最低）；
2. **P3** worker 解码第二个里程碑；
3. 并行：dsh-perf-analyzer P1（事件循环历史+告警）上线，为上述一切提供观测；
4. 排查 apiProxy 休眠面，决定逐出层的实现深度。

## 五、关联文档

- 会话数×资源研究：`D:\workspace\dsh-open-a2a-net\docs\handover-2026-08-24-session-scaling-research.md`
- 启动阻塞交接：`D:\workspace\dsh-open-a2a-net\docs\handover-2026-08-23-startup-stall.md`
- perf-analyzer 研究与插件骨架：`D:\workspace\dsh-perf-analyzer-research.md`、`D:\workspace\dsh-perf-analyzer\`
- 性能修复方案存档：`D:\workspace\dsh-open-a2a-net\docs\perf-fix-plan.md`
- 宿主回放让步（自家 fork 已合）：`D:\workspace\deepseek-harness\.agents\notes\implemented\architecture\2026-08-23-cold-open-replay-event-loop-yields.md`
