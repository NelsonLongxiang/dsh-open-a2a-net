<!-- 协作规范：src/skill/references/collaboration.md。高档要一个非自我节点在同一 SHA 上的 PASS。 -->

**改了什么、为什么**

**档位**：低 / 中 / 高（高档请写明评审方）

**验证**（实际跑过的命令和结果）
- [ ] `pnpm verify:docs`（文档漂移检查）
- [ ] `node scripts/verify-architecture.mjs`（改了带锚点的源码时，先 `pnpm reanchor:arch`）

**文档同步**：改了模型工具、配置键、控制路由或 CLI 子命令 / 开关时，同步了哪些文档（README 中英、`src/skill/references/*.md`）？没改则写「无」。
