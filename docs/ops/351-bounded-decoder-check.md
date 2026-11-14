# #351 独立前置P2：日志解码分配前输出界（待高档复核）

> 补记（2026-11-13）：已于 2026-11-05 经 PR#353（`725c1c6`）合入 master，高档复核为评审席非作者 PASS @ `677dd89`。标题里的「待复核 / 未合并」是写这份记录时的状态，正文保持原样。

授权direct-e44d43ed49a2/direct-b7af83bf3c57，两独立缺陷先行与D1方向无关。base masterf636331，仅修session-transcript解码与对应测试，不改回执/queue/sync语义，不补生产积压，不动#343文件。PR352语义重写已暂停，本地未推草稿仅tmp留存，未按ack方向出稿。

实现：每frame调用zstdDecompressSync时明确maxOutputLength=160MiB剩余额度，预算耗尽不再调用下一frame；保留累计后防御检查。输入64MiB在函数自身检查，plain同样受界。预算测试seam只准缩小，不准抬高生产cap。

不支持输出limit的运行时：仅使用源码固定16byte无害frame、maxOutputLength1检查真实ERR_BUFFER_TOO_LARGE，一次缓存；无此能力即拒绝compressed input，永不拿用户frame探测、永不无界重试。plain仍可读。旧多frame/尾部torn兼容不改。未把压缩日志原数据写回/改动，未新造worker或扩整个读取语义。

测试：原9例+新5例共14通过，真实zstd单frame超过tightcap时codec在返回Buffer前ERR_BUFFER_TOO_LARGE；每frame预算调用为1(probe)/1024/424；exact-budget后下一frame不再调用；忽略limit或只报unsupported错误的codec不接触任何untrustedframe；plain无probe可用。临时去maxOutputLength参数，两个运行行为用例红（收到事后cap错误而非codec上界拒绝），恢复后全通过，不靠架构hash失败。

默认完整pnpm verify jobbash-27b24551fcc643f5真实exit0：root1510passed/6原skip、layout4、nexus332、innerentries0、trackedbuild无差异。未新增skip/放宽并发或timeout。只工程验证，不冒称#351结算方案已验证。

高档非作者需在精确head复跑与去上界突变；当前待审，不合并部署，.88/.43升级另报，语义新方向另待属主/评估确认。
