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


## PR #708 工程收口修订（2026-11-15，继承原记录，不回写历史通过）

原回执修复头 `4f60ee08869c3fcf930f6eee595b70f8d03b594f` 的分组工程测试本体通过，但外层报告 `a2a-test-ygl-*` 残留并返回 rc1。根因是 Vitest 配置自己分配 ygl home，外层 runner 不拥有该分配事实；不能据测试本体通过宣称完整门禁通过。

本修订仍使用 `scripts/verify-temp-clean.mjs`，按入口文件所在项目分配 `tmp/test-runs/run-<唯一后缀>`，不使用外部系统 tmp 或另一检出的根。runner 在自己本次根中命名并向子树传递 `A2A_TEST_YGL_HOME`；Vitest 使用该值，而非再次分配匿名 home。子进程结束后只清理这个精确 owned fixture，再对剩余项逐项判定：任意其他残留仍 rc1，原子进程非零码仍保留，owned fixture 被替换为链接则 rc1且不遍历外部目标。旧目录、继承的 ygl home、他人测试根均不删除。直接绕过 runner 的历史测试行为不被宣称已修复。

定向回归用真实 runner 子进程验证：自己的 ygl fixture 正常清理且外层零残留；继承 home 和旧 sibling 哨兵不变；故意未拥有目录/文件仍失败并点名；子进程 exit7仍为7；链接替换失败且外部哨兵不变。红例在旧入口实际返回74并保留配置分配残留；修订后再跑真实 Vitest 配置、同组 LAN-IP及构建布局检查，不调既有业务断言/timeout/skip，不重跑整批已闭合业务反例。首次定向工程运行typecheck、verify:docs、runner语法检查、3files/11tests（4项新runner回归+4项真实LAN-IP+3项现有构建布局）均rc0，外层remaining=[]/entries0/rc0。原三批大范围测试/旧外层rc1不据此重标全绿；本轮没有完整verify:core、RC或运维验收产物。

GitHub 只读核对当时仓库 Actions workflow 数量为0，本修复分支无run，PR statusCheckRollup为空，next/0.8未配置branch protection。它们代表没有远端检查，不是CI绿。本次不新配CI或保护规则、不人工伪造check/status，也不触发安装、发布、部署。后续合并判断仍须分别看本修订准确SHA的工程原日志、独立delta复核及既有完整工程/RC/运维门；小范围零残留不替代完整 verify:core 或实盘验收。

## PR #708 对齐 next/0.8 的生命周期接缝（2026-11-16，未完成验收）

自有整合从原 `da7552c81` 合入准确目标 `f859168f`，仅 Vitest 配置冲突：采用目标的 `tests/global-ygl-home.ts` 全局生命周期，避免 config load 分配目录。新增真实入口回归核全局 setup 在 runner 的项目内临时根分配和清理、不触及继承 home；既有泄漏、非零子退出和链接替换反例保持。原回执运行时代码没有因整合变化。

首轮单次 unit+wire+mesh 为 2370 过/104 败/5 原跳过，外层两处测试根残留且 rc1；原结果保留，不归并为负载故障或用后续小批覆盖。两个稳定 wire 错误的夹具使用空 dshHome，沿继承 DSH_HOME 回落真实用户宿主，已暂停该面测试并上报风险，不读/清/改真账、不凭无前快照宣称线上状态未变。现有 runner 改为仅对子进程提供本轮根下的 DSH_HOME；与原 ygl fixture 一样只认该精确拥有路径，继承 home 不清，链接替换拒绝，任意其他残留与非零退出照旧失败。安全反例只用测试自有哨兵，旧 runner 在任何 home 写入前 exit81；修复后完整生命周期8项通过，外层无残留，原两条无agent断言不改即可通过。

补登记 named-dispatch host 与 standalone node 的资源关闭，使测试断言失败时也在临时目录删除前停止写入；成功路径的原 stop/close 保留。当前原6份回执反例定向59/0/0、外层0，仅是隔离后的诊断证据，不能替代仍红的完整回归。Windows sent journal 的0600断言、默认并行下时序/清理失败仍需分别处理；不据平台差异增加skip、延时或改判据。完整 verify:core（含依赖安装）、formal RC/spec-run、准确包和独立OPS尚未通过；无受保护主干合并、发布或生产操作。

V1整合/隔离已获原非作者静态可采纳、必修0（原direct-4313f53c）；这不是全量或新提交验收。后继明确诊断：wire339过/1个本机ENOBUFS失败；显式单worker unit1620过/1断言败/3原skip，另shadow tally夹具六个SQLite连接未关导致suite收尾EPERM；单worker mesh515过/2原skip，外层0。均是独立诊断，不替换原默认全量FAIL，也不把单worker参数写入当前候选。

SQLite后继窄修只在原测试的make工厂创建连接后用现有cleanupBeforeTempDirs登记close，不改生产采集器、SQL判据、断言、用例数或限时。原型16项15过/1个原5秒心跳反例超时，原红保留；落源码后针对原checkTally用例验证1过/15过滤未选、outer0。Windows合成临时文件请求0600和0666在Node24.12均报告mode0666，但实际ACL未测；原0600承诺及断言不据该诊断豁免。新精确提交还须非作者delta/绑定、完整工程与原RC/OPS分别验收。
