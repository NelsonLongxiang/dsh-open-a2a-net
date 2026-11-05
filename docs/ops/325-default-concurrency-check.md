# #325 Windows 默认并发测试稳定性

低档测试修复，起点 master 5f5b9a4；不含 #320 行为修复、不含 0.6.42 发布提交。生产代码、Vitest 全局配置、worker 数、timeout、retry 和 skip 均不改。

## 根因与对应修复

1. node-tasks 三个 cap/eviction 用例（keeps64、P3-2、D6）不是共用目录竞争：磁盘测试原来已用 mkdtempSync 隔离，其余表是纯内存。实际放大器是 flush() 每次等待5次setTimeout(0)，循环64次；Windows计时器粒度与CPU争用累计越过默认5秒，连纯内存D6也超时。cap循环现在 await t.check(node, ref)，加入track启动的同一在途probe；其他受控Promise链用一次setImmediate check-phase drain。磁盘归档/重启断言、dedup及dispose反例保留。该文件22项从隔离约15秒降至百毫秒量级；不是把timeout调大。
2. apply中的prewarm delay：原来真实sleep40ms后断言120ms未到，CPU忙时事件循环回来已经过120ms。现在只在这3个prewarm用例注入Date/setTimeout/clearTimeout假时钟：119ms不醒、120ms恰好一次；quiet-window/stagger/retry按虚拟时间推进；dispose后推进仍不得醒第二项。真实WebServer/HTTP路由保留，finally恢复真实时钟；相邻用例不受污染。
3. CLI forward failover：用例刻意需要旧B目录行留在A缓存，而mesh默认正卡TTL仅60ms，在多次HTTP操作之间就可能到期，导致不再是同一个stale-positive情境。仅该fixture把A的cardCacheTtlMs/remoteRowsTtlMs设60秒，高于用例原30秒上限；B真实leave，仍保留B先拒且不再次转发、C再接受、guard保留、B/C steer次数以及fwd活动断言。没有把整个文件卡片缓存或全局TTL改掉。

未发现这些用例共享磁盘路径；无须新增全局/文件串行策略。没有把端口隔离改为固定端口，仍使用reservePort/真实HTTP。

## 工程自测（不是RC spec-run结论）

修改前在 .156 默认 pnpm verify：唯一 node-tasks D6 5秒超时，1432 passed/6skipped（该次另含#320新增2项）。

针对性默认并发运行3文件：136/136 passed（node-tasks22、apply99、CLI forward15），无额外参数。prewarm四个名称匹配用例单跑通过（筛选时其余为未选择，不新增skip）。

同一测试修复提交 c55c695 在 .156（Windows/Node24.12/Git Bash）两次直接执行 pnpm verify，均真实 exit0；没有 --maxWorkers、--testTimeout 或重试选项：

- 2026-11-05，job bash-949bc84c6fe4464b：root1431 passed/6skipped，172passed files/1原skip file；layout4；nexus326；tracked dist零差异。
- 2026-11-05，job bash-e217f0cb975d4995：root1431 passed/6skipped；layout4；nexus326；tracked dist零差异。

第二次在独立发布输入已冻结后运行，仍是#325分支，不拿这两轮去冒充0.6.42候选全量验收。两轮有限工程证据不承诺任意未来负载绝不抖动；若新红出现，沿原证据继续定位，不回退全套串行。

等待评审席独立复核；未改生产或部署。
