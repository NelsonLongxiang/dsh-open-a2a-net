# #339 临时目录所有权与零残留门禁

最初base5c93230，原87个创建者文件改为tests/temp-dirs.ts tracked allocator；现已合入含#338的master0aa92e6，并迁移新增gh335单测创建者（共88个）；afterAll逆序删精确owned根，rmSync recursive/force/maxRetries10；失败也清理。mesh在启动前注册fiber关闭，防boot失败漏资源。没有按前缀扫删系统旧目录。

pnpm verify包原verify:core，独立空根设置TMPDIR/TEMP/TMP，禁Node编译缓存，子进程收尾后先检查剩0再删除owned根。有任何残留即exit1，不豁免名称；原断言/默认并发/timeout/skip不变。外层验证器独立TMPDIR兜底保留，硬杀/宕机不保证finally。

初轮有node-compile-cache，修为仅在测试子树禁缓存；中途一轮发现mesh目录late重建，定位PeerStore dispose只flush而late fetch又persist，增加close终态：flush已排队写，封闭新持久化。活跃store行为不改。现有store用例内补close后移除parent、late success/offer/flush不得重建，不增用例数。

Windows最终两轮默认完整verify：bash-d3bf11fc7ef94a8d、bash-3b643773b4404684，均root1457passed/6原skip、layout4、nexus326真exit0，内部空TMP根entries0，外部新空TMP根outerRemaining=[]。数量与base相同。断言失败探针exit1但entries0；故意原生mkdtemp漏目录探针exit1/entries1，报告后仅清其owned根。临时探针移出门禁，未加skip。

## review-340-r1 集成修订（含 #338）

原评审在master0aa92e6试合发现anchors冲突、新增gh335单测16个canvas335-*目录未清理。已合入master，tests/unit/gh335-canvas-suspension.spec.ts只迁移mkdtempSync导入至owned helper，保留全部断言；扫描tests下无helper外node:fs临时分配器。架构清单以master图锚为基线重新生成，保留PeerStore.close与#338来源/暂停修复，无miss；不把旧407f458/macOS PASS作为集成树结论。

集成树Windows工程记录：
- 两轮工作区D盘新外层TMP根：内层entries0，但原默认5秒预算下出现CanvasStore team-cap及其他不同测试超时，整体rc1，未改断言/worker/timeout/skip；相关canvas-store/canvas-routing两文件隔离运行原预算全过且entries0。不能据此宣称这些外层运行全绿。
- 系统默认临时目录完整pnpm verify（job bash-32959ae205b44697）：真实rc0，root1485passed/6原skip（总1491，与合入的master测试集合一致）、layout4、nexus327，门禁新建内层remaining=[]/entries0；输出保留tmp/gh339/integrated-system-temp.log。

新集成SHA仍需原评审macOS完整重跑。下面407f458结果仅为旧树历史证据；合并后监督主机的merged master验证器零新增仍是关单条件。

## macOS 独立复核（监督席，历史 exact 407f458）

监督席在Darwin27、Node由fnm管理、pnpm11.28.5的新检出中做行为复核，两轮默认pnpm verify均rc0，门禁内层entries均0。root1460passed/3skipped（总1463与Windows1457/6同数，平台跳过差异），layout4、nexus326。故意漏目录反例rc1/entries1且点名残留；断言失败反例rc1/entries0。此为监督席提供的macOS行为复核，不扩大为逐行代码审查。

**外层TMPDIR平台边界**：macOS通过pnpm verify启动时，外层会新增固定名node-compile-cache及pnpm-verify-deps-install-locks-501；它们由pnpm11及运行pnpm的Node进程在门禁子进程之外生成，监督席观察两轮固定不增长。501是该主机用户标识，不是跨机固定常量。门禁的NODE_DISABLE_COMPILE_CACHE只作用于其子进程树，不能约束已经启动的父pnpm。使用plain node直接启动门禁时，监督席外层为空。因此Windows上述外层0观察不能推广成macOS经pnpm启动时的外层字面0项。

这两个外层工具链项**不属于门禁管理的内层根，不加入内层残留豁免名单，也不据此豁免任何测试目录**。内层检查仍要求全部步骤结束后entries严格0；外层验证器应独立记录父工具链项及测试残留，不能混作“测试泄漏”或掩盖新增目录。监督席原始复核见PR340评论（407f458），本次修订仅更新说明，不改测试/门禁代码。

#339仍保持打开。关闭条件为a2a-net评审链合并PR后，监督主机在merged master上再观察一轮验证器，确认无新测试临时目录；本次macOS PASS不替代该合并后验收。未清监督席历史存量，未部署生产。
