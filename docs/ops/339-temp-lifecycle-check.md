# #339 临时目录所有权与零残留门禁

base5c93230，独立于待评审#338。87个原创建者文件改为tests/temp-dirs.ts tracked allocator；afterAll逆序删精确owned根，rmSync recursive/force/maxRetries10；失败也清理。mesh在启动前注册fiber关闭，防boot失败漏资源。没有按前缀扫删系统旧目录。

pnpm verify包原verify:core，独立空根设置TMPDIR/TEMP/TMP，禁Node编译缓存，子进程收尾后先检查剩0再删除owned根。有任何残留即exit1，不豁免名称；原断言/默认并发/timeout/skip不变。外层验证器独立TMPDIR兜底保留，硬杀/宕机不保证finally。

初轮有node-compile-cache，修为仅在测试子树禁缓存；中途一轮发现mesh目录late重建，定位PeerStore dispose只flush而late fetch又persist，增加close终态：flush已排队写，封闭新持久化。活跃store行为不改。现有store用例内补close后移除parent、late success/offer/flush不得重建，不增用例数。

Windows最终两轮默认完整verify：bash-d3bf11fc7ef94a8d、bash-3b643773b4404684，均root1457passed/6原skip、layout4、nexus326真exit0，内部空TMP根entries0，外部新空TMP根outerRemaining=[]。数量与base相同。断言失败探针exit1但entries0；故意原生mkdtemp漏目录探针exit1/entries1，报告后仅清其owned根。临时探针移出门禁，未加skip。

macOS待独立复核；#339不得因本机通过关闭。关闭条件仍为PR合并且监督主机merged master验证器一轮无新残留。未清监督席历史存量，未部署生产。
