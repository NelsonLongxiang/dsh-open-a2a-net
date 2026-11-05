# #358① Windows rename 瞬时竞争有界重试（独立切片）

Refs #358 / #354。基线master cd3a264；授权direct-b4781e353868先做①再#351，不将②status/355告警及③附带状态审计冒称完成，也不关闭358（另有已发布版本条件）。

仅改ledger atomic writer的rename一步：同一个已写全/fsync/close的sibling临时文件，对EPERM/EBUSY最多3次调用，2ms+4ms共6ms显式等待；不是磁盘I/O总耗时硬实时承诺。不重开/重写/删除旧target，不重试EACCES/ENOSPC/ENOENT/EIO等其他错误。用尽抛原末次错误，现TaskLedger回滚/诊断和HTTP503/final安全catch保持。同步API使用Atomics.wait有最多6ms阻塞代价，不引入长期重试队列/异步语义变化。

测试新增7例，原持久7例共14：两次EBUSY/EPERM后成功，唯一temp/3次rename、wait序列2/4；持续EBUSY3次止并回滚旧字节/内存/守恒/错误，ownedtemp不漏；四种非竞争码只调用1次/零wait。去过滤突变四行为例红，finally恢复。真实mesh既有写失败/收据enforce query例全过。

默认完整pnpm verify job bash-34d05ed07d404762真实exit0：root1529passed/7skip（原6+POSIX目录权限平台例1），layout4/nexus332/innerentries0，dist无差异。仅工程测试结果，不冒称CLI业务规范run。scripts/verify-*、verify/、生产配置与deepseek-harness源码均未改。待非作者精确头复核后按授权流程，不部署不补生产积压。
