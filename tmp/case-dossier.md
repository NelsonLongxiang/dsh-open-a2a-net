# multi-agent-orch 协同案例卷宗（2026-10-17）

## 任务
federated-kb 设计先行研究（项目 federated-kb-design）：3 个检索式（同步/冲突选型、信任模型、先行实践）。

## 编排事实
- 编排者：本会话（dsh-open-a2a-net 工作区，ygl-trees CLI 直接驱动者）
- 分片A → dsh/canvas/ygl-trees（3 活成员 canvas 团队）：task direct-632cf4b3，1 分钟内回执，全文落盘 D:\workspace\ygl-trees\tmp\federated-kb-sliceA.md（含一手核验：packages/core/database/src/db.ts 列清单 + workspace=YGL_HOME 实测）
- 分片B → dsh/ec4ce7f8（ygl-trees 主开发线独立会话）：task direct-f5d8de58（先行实践与教训调研）
- 跨机尝试（全失败，故障样本留档）：192.168.3.157:13080 冷会话唤醒失败（resume 报缺 linux-x64/bin/glibc/system.node 原生模块）；192.168.3.85:13080 直连超时 AbortError；192.168.3.156:13080 与 .157:13082 卡片 fetch failed

## 集成轨迹
- source 05f5f0caa8 ← 分片A 全文（file:// URL + a2a 任务署名）
- evidence df2568562a / 388e87002e / 076c55fcb1 ← 三条选型断言摘录
- claim 50da57cd85 / 74633904a8 / de4e783402 → 均 supported
- rel source:05f5f0caa8 —evidenced-by→ node:v2-roadmap/federated-kb
- 分片B 集成：见后续追加

## 诚实边界
- 跨机节点当日全灭，案例为同机多会话协同（独立会话×2+编排者），非跨机案例
- eval 门判定独立于参与者（P=0.24 fail @ 无证据基线）

## 终局（2026-10-17 ~15:00 补记）
- 分片B 于 14:24 落盘 D:\workspace\ygl-trees\tmp\federated-kb-sliceB.md（dsh/ec4ce7f8 署名，回执任务 direct-f5d8de58；原任务先被 content-echo 结算、催办 direct-f0a8d689 在途时文件已到）
- 案例最终形态：编排者 + 两个独立会话团队（canvas/ygl-trees 3活成员 + ec4ce7f8）= ≥5 独立 Agent，同机多会话协同（跨机当日 4 端点 3 种故障全灭，留档）
- eval 门判进：无证据 P=0.24 fail → 全链证据 state 袋 P=0.91 pass → node unlock multi-agent-orch（2026-10-17 ~14:50）
- 预测结算：claim 28181131e7 [预测·orch-case] → supported（提前命中）；pred-orch-case 树节点留待 2026-10-19 到期复核
- 集成终账：sources 3（05f5f0caa8/1dd3a2d630/4d502e95cf）· evidence 7 · claims 5（全 supported）· artifacts 8 · rel 9
