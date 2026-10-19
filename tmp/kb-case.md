# 多Agent研究编排案例方法（DSH A2A × ygl-trees，2026-10-17 实证）

## 何时用
需要"多个独立 Agent 协同完成研究任务"的真实案例（如解锁 orchestration_proof 类 eval 闸），或要把远端 Agent 的研究产出以可审计方式落进 ygl-trees 研究库时。

## 步骤（全部真实留痕，零编造）
1. project new + query add 登记检索式（先注册问题再派发，顺序即证据）。
2. a2a_route 异步派发研究分片：提示词自包含（对方看不到本地文件）、限定格式与字数、要求署名+置信度；同机目标请对方把全文落盘共享路径（tmp/），跨机则靠回执全文。
3. 回执即来源：research source add（url 用 file:// 指向落盘文件或 http(s)；注意 a2a:// scheme 会被 0.79.1 拒绝，署名写在 title 里）。
4. 证据三角：对方断言（evidence quote）× 编排者独立复核（把仓库/命令输出本身作为第二个 source）× claim link 双向回链。
5. rel 织物：source/artifact —evidenced-by→ node、claim —decided-by→ node、卷宗 —evidenced-by→ 预测 claim。
6. eval 闸校准两步：先无状态测基线（本例 P=0.24 fail），再带 state 袋测案例（P=0.91 pass）；模型对"无证据"与"有全链证据"区分度良好。
7. 预测先行：行动前 pred 节点（time-capsule 树 eval cond）+ [预测·] claim 双轨预注册，结果出来再 resolve。

## 坑
- 同步 follow-up 180s 超时不代表失败，目标按自身节拍回执；催办用 async。
- "settled by content echo" 结算无实质内容，需人工追（挂 task 跟进）。
- 路由到裸团队名（如 dsh）的入站任务没有会话消化，回执永不结算。
- 跨机冷会话唤醒可能因远端缺原生模块失败（.157 linux-x64 glibc system.node）——派发前先 probe。
