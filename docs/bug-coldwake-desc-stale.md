# 冷唤醒卡片描述滞后 BUG · 分析与方案（闲时验证档）

日期：2026-08-23。现象：host 重启后 joined 冷会话被唤醒（state live=true），但 peer 视图/面板 remote 行的卡片描述仍显示占位符（no activity yet / label 代替 title）一段时间。
## 根因候选（按嫌疑排序）

1. **B-真 BUG（永不自愈路径）**：F5 titleCache 在唤醒早期把 title 服务返回的 undefined 瞬态失败**负缓存钉死**——若该会话之后日志不再增长（length/tail 不变），缓存永不失效，title 永不重试。修复：title undefined 不入缓存，或负结果短 TTL。
2. **A-瞬态（60s 自愈）**：F2 卡片缓存把唤醒早期（events 重放未完成、占位符）的卡片缓存 60s——可接受，叠加 B 恶化。
3. **C-观测窗口**：用户看到的是面板 remote 行（来自 peer 卡片缓存，60s 窗口），本节点自视图（state）是实时的——观察时点恰在窗口内。
## 闲时验证清单

- [ ] 复现：重启 3080 → 等监督者（1327d310）唤醒 → 观察其 remote 描述自愈时长（<60s=C 瞬态；>几分钟且日志无增长=B 钉死）
 - [ ] 代码核验：F5 titleCache 对 undefined 的处理（src/index.ts sessionTitleOf——确认 undefined 是否入缓存）
 - [ ] 代码核验：resume 重放期间 events 数组是填充还是替换（决定 F4 失效键行为）
 - [ ] 若 B 确认：修复=title undefined 旁路缓存（直读直返，服务侧成本可接受——title 服务本身轻）+ 单测（title 服务先 undefined 后有值→第二次读取生效）
## 影响面

低（显示层占位符/标题回落，不影响路由/送达/回执）。修复应走标准流（worktree→PR→双路→430）。