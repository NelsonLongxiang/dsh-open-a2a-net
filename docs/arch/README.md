# A2A 架构图与源码锚点

## 交付对象和基线

- [可编辑双页图](a2a-architecture.drawio)：系统模块总览、收发通道全景。
- [完整锚点清单](a2a-architecture.anchors.json)：50 条锚 / 16 个源码文件。
- 源码基线：5736a4a6e207e72721fcaeb18f9015911a83650f。
- 图中 SOURCE 仅说明仓内源码，不证明运行宿主已加载，也不证明事故恢复。

本轮同步 B1 admin 模块、#60 hop 入口第一步、#86 track 溢出归档、
#91 wire 防洪、#85 框单独移动与 #89 卡优先归本队空位。B2 wire WIP、
#57 转发、独立文件通道不画成已交付能力；#86 restore 截断与 archive 有界
仍明确保留。查询面按实际 POST body 契约标注。

## 可重复机械检查（非正式 spec 判定）

从仓库根运行，无新增依赖：

~~~sh
node scripts/verify-architecture.mjs
node scripts/verify-architecture.mjs --snapshot tmp/architecture.sqlite
pnpm exec vitest run tests/unit/architecture-audit.spec.ts
~~~

脚本读取现有 jsdom，核验 XML、边端点、页面范围、所有文字纯黑、
每个全路径数值锚的精确源码串与文件 SHA256；范围的起终点分别核，
裸 :NN 直接拒绝。源码文件任何变化都会要求重核，不自动平移放行。

锚点清单不是语义正确性的自动证明：精确行文本和文件摘要防漂移，
模块描述与源码的含义仍需审阅。10 个工程测试包含正例及有意变异反例，
覆盖错行、短锚、范围越界、源码漂移、错误预期串、坏 XML、非黑字、
坏边、页面越界、旧基线、丢失源码/清单等。

## 渲染

本机 draw.io 32.5.5 实际导出两页 PNG，页码从 1 开始：

~~~sh
drawio --export --format png --page-index 1 --output overview.png docs/arch/a2a-architecture.drawio
drawio --export --format png --page-index 2 --output channels.png docs/arch/a2a-architecture.drawio
~~~

正式源是 drawio；PNG 是查看副本。本轮两页实际渲染及肉眼检查，不把
仅 XML 可解析称作已看过图。首次错误页码0的导出虽退出0但报错，已按
提示重跑页码1/2，并以输出文件存在、可读及实际图片内容核验。

## 正式验证链的数据门禁（透明降级）

本轮 submit 原据：tmp/architecture-material-submit.json，meta R1/R2 通过、
R3 FAIL。R3 列出现有 assets bundle、cli/a2a.mjs、lib 和根目录脚本；
不静默删除文件、不 --no-meta、不假称冻结 spec 或 overall PASS。

[材料](../../verify/material-architecture.md)、
[候选判据](../../verify/candidates-architecture.json)、
[构造自核记录](../../verify/reviews-architecture.json) 随稿提供；自核记录
明确为作者自核，非独立盲审。当前身份是候选，尚无 spec/run 结论。

- 谁能解：本仓治理维护的执行坐席可修正 R3 的产品/验证脚本分类；
  若需改判据范围，由属主确认规则口径，不将本轮图稿伪装成验证器仓库。
- 凭什么解：有效 meta 配置、R3 真正通过，重跑 submit/prepare/run/archive，
  报告须有快照来源和非空覆盖 witness；不能只看命令退出码。
- 解不开：图稿、原生渲染、机械审计与测试照常交付；明确候选判据未冻结，
  不给正式业务验证结论，也不影响已独立核实的图面源码锚点事实。

风险：中档（文档 + 开发期核验脚本；不改运行行为）。本轮无部署、
无生产配置修改、无重启、无依赖新增，不触碰 DSH 实现检出。
