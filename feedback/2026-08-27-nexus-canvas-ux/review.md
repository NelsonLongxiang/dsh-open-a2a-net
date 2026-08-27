# 审阅发现 · nexus-stage / canvas 面（2026-08-27）

> 审阅席交付。取证方式：代码通读 + Playwright 路由拦截 mock 数据截图（零仓库改动，脚本见同目录 `shot_status_quo.py`）。

## P0（功能实质缺失，表象健康）

1. **空舞台陷阱仍在**：`main.ts:123` `catch { /* host unreachable */ }` 吞掉一切——state 404/500/网络断/JSON 解析炸，全部表现为"深色网格、渲染循环正常"。实证 `shots/status-quo-empty.png`：standalone dev 下页面看起来完全健康。历史上 `S` 层未导出事故（tokens.ts:19-23 注释自述）就是被这个 catch 埋掉的，同类事故温床未除。**建议**：fetch 失败渲染显式离线态卡（"宿主不可达 / state 404"），空数据与取数失败必须可区分。
2. **`fetchLayout` 定义了从未调用**（main.ts:69-74）：LayoutStore 宿主侧契约 v2 完备（clamp/上限/POST save/reset），client 侧完全未接线——位置靠 `seatAt()` `Math.random` 每次加载重随机（main.ts:81-84），布局持久化等于白建。
3. **成员边不可见且无增量信息**：`opacity: 0.15` 的 cyan 两两全连接线在近黑底上实证不可见（`shots/status-quo-mocked.png` 里 6 节点 2 队，看不到任何线）；且 O(n²) 全连接的语义就是"同队"，星形（框→成员）一根线一根含义，密度和信息量双赢。

## P1（表达缺失 / 代码卫生）

4. **节点零标签**：`userData.label` 存了名字但无任何渲染出口——mock 截图里 7 个球无法回答"这是谁"。3D 下至少需要 sprite 标签或常驻 HUD；规划模式（2D）节点卡天然解决。
5. **peers 解析了从不网格化**（main.ts:92 取出后无人消费）；`scene.ts` 的 `NexusScene.addPeer`/联邦线/团队环全是**未被 import 的死代码**——双实现并存，后来者极易改错文件。建议二选一：接线 scene.ts 或删除，不要留平行宇宙。
6. **commit 宣传与代码不符**：`91fb080` 信息提到 drag/hover/pulse/HUD，现行 main.ts 均无。**纪律建议：以代码为准评审，commit 信息过验收前核对。**

## P2（体验与杂项）

7. standalone `vite dev` 无代理无 mock → 开发期永远面对空舞台。建议 vite `configureServer` 挂 dev-only mock 或文档化代理到活宿主。
8. bare mount `/__dsh_a2a_nexus` 依赖 301 补斜杠（stage-mount.ts），已知但建议在 README 的 stage 段落写明，省每个新人一次困惑。
9. 仓库根有未跟踪 `nul` 文件（177B，Windows `> nul` 重定向事故残留），建议删除并考虑 `.gitignore` 加 `nul`。

## 正面记录（值得保持）

- `tokens.ts` 三层令牌 + S 层事故自述注释——诚实留痕的范本；
- `canvas-ui-contract.md` 锁定纪律（存在性开关/同意不变量/多对多/上限不预校验/锁版本）完整可执行；
- `LayoutStore` 边界防护（坐标 clamp 1e6、scale 0.25–3、256 节点/96 框上限）先于 UI 就位，方向正确。
