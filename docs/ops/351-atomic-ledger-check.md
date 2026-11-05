# #351 独立前置P1：账本原子提交与写错误可见（待高档复核）

授权direct-e44d43ed49a2/direct-b7af83bf3c57/direct-7ac45ccba3c8，独立masterf636331分支，与PR353解码修复和PR352语义方向无关。只修TaskLedger持久化缺陷，不改queuedFor/回执词表/授权/同步归属，不补现有积压，不部署。

- 独立小helper：同目录uuid临时文件wx/0600，写全、fsync、close后rename替换原文件，失败只清本次owned临时件；不truncate旧tasks.json，不扫删别人文件。文件fsync+rename不是Windows目录断电持久保证，本PR不声称实现跨机/多进程CAS或POSIX目录fsync。共享home仍原单writer约束。
- TaskLedger捕获最近成功提交snapshot；失败还原tasks/archive/refusal ring/refusal总数及conservation计数，再向原调用方抛原error，不再吞为memory-only成功。原成功API返回值/schema/账本计数语义不变，path为空的无盘测试模式仍可用。磁盘不可写时API现在显式失败正是本修复目的，不能把已steer后的异常伪称未投递邀请重跑；原wire已有steered保护不改。
- 新7例：部分写ENOSPC/renameEACCES/fsyncEIO时原盘逐字节不变/内存行计数回滚/临时根无漏/恢复后可重试；markAnswered失败先抛，caller发送spy0且无answeredAt；结算失败欠行/空archive/守恒恢复；不可写父路径不返回成功；unique sibling替换文件。原task-ledger25例通过。
- T9反向突变：恢复catch吞错误（仍回滚但不throw），failed-answer no-send用例立即FAIL，因caller被放行；已try/finally恢复，不靠架构摘要判断。没有把工程测试写成新业务规范run。
- 首轮默认verify仅旧single-flight30ms墙钟期望失败，inner0；该例原预算隔离绿，未改断言/worker/timeout/skip。第二轮完整verify jobbash-5f07e794a1ab4088真实exit0：root1512passed/6原skip、layout4、nexus332、innerentries0，trackeddist零diff。架构按base重锚2处无miss，未视觉渲染。

## PR354 R1修订：后台异常边界

旧头8c07e6d REQUEST CHANGES保留：原子写/回滚本身非作者已复核，但markAnswered异常会从final waiter/idle/微任务逃逸。现final callback统一经answerFinalSafely边界，逐个移除/调用，失败重放回原floor/消费锚、其他同批waiter不丢；成功才取消timer。timeout/会话消失placeholder同样受边界。模型显式receipt标answered失败返回工具error不发；已有async ladder内settle在await promise链内由原catch接住；HTTP写点仍走原handler守卫。

TaskLedger.persistenceState只暴露ok/lastError{at,code}，不暴露路径/正文；persist失败记录后回滚并仍向写API抛错，后续成功提交清诊断。list的lazy sweep可能写盘，读边界捕获失败后返回上次已提交行并保留错误，防state/计时nudge读变成宿主异常；不把未落盘sweep当成功。

新增真HTTP mesh：idle后EACCES（portable fs.openSync定向故障）无逃逸/无uncaughtExceptionMonitor事件、不发该任务回执、盘仍欠账；同批其他waiter成功，失败者下次idle重试且只一份回执。guarded sync after-steer queueMicrotask同样写错不逃逸、同步答复仍正常，恢复idle可重试。另有POSIX非root实际chmod0500目录例，Windows/root不可用明确跳过，portable两例不skip。不是声称Windows chmod提供POSIX拒写。

去answerFinalSafely catch，idle真实mesh因EACCES逃逸not.toThrow行为断言立即红，已finally恢复。修订最终默认门禁job bash-1b98863ca1e84fd8真实exit0：root1514passed/7skipped（原6+新增POSIX权限例在Windows跳过1）、layout4、nexus332、innerentries0；不靠架构hash取证。

## PR354 R1′：发送方回执结算边界

7e15105的接收方修复非作者复跑成立，发送方req end事件不在Web守卫内的新缺口继续REQUEST CHANGES。现wire receipt结算处catch持久错误返回503/FAILED/delivered:false，既不继续steer也不假装已归档；整body-end用显式IIFE.catch持有异步异常，sync route/分类IIFE也纳入await。settleAndAnnounce原query outcome写在ledger提交后，避免失败预报completed。settleOwnInbound局部catch返回false，模型路径明确“peer已接纳但本机结账失败”，自动路径转原ladder错误日志，本地欠账保留。

新sender真实签名HTTP mesh：A先实际派给B形成outbound，A账本写错后B正式receipt返回503，A不steer、旧盘逐字不变、仍欠且state EACCES，修复后后续合法receipt归档一次。另一mesh核peer已收而己方inbound commit失败只显式error、local仍欠。去sender局部catch，行为mesh因503缺失和UnhandledRejection红；已恢复。当前全门禁job bash-bb375fd07a3c4655真exit0 root1516/7skip（原6+POSIX权限平台1）、layout4/nexus332/inner0。

### 守卫外写账调用点审计（对照本修订源码，行号见PR评论）

| 调用组 | 触发点 | 错误边界与失败语义 |
|---|---|---|
| markAnswered自动final | flushFinals由idle事件/route微任务触发，timeout/gone callback | answerFinalSafely逐项catch；失败保原waiter，其它继续，不发送 |
| resolveFromMessage/resolveEcho（settleAndAnnounce） | wire body-end收到receipt/正文echo | 局部catch→503不投递；整body-end IIFE.catch兜底500，不逃逸 |
| 同上local dispatch | async dispatchLocalCandidate在await route链里，同机CLI mailbox/receipt | Promise传播到tool/控制HTTP调用者或自动receipt ladder.catch，无裸事件异步；失败不执行后续投递 |
| resolveFromMessage（settleOwnInbound） | await跨peer回执后本机inbound收账 | 函数内catch→false；tool返回error，自动ladder收到reject，不虚报本地结清 |
| markAnswered模型显式receipt | async routeTrunk工具入口 | 局部catch→结构化error、不发回执 |
| track/trackReceiptless | routeTrunk await投递后的outbound记录、direct-forward await forwarding | 由工具Promise/转发.catch和控制路由await异常处理；不是timer/裸事件，持久error诊断保留 |
| trackInbound async delivery | wire直接/冷wake.flight deliver callback | deliver内部try/catch保steered事实，已投递时不报失败诱导重投（原规则） |
| trackInbound syncSteered | routeIntoAgent onSteered | routeIntoAgent catch生成失败结果；wire await+body-end.catch兜底，无UnhandledRejection |
| abandon/cancel控制面 | readJsonBody end callback | readJsonBody明确use try/catch→500；不同于wire原先裸end |
| cancel nativeTeams bridgeFace | async cancel返回Promise | 返回Promise失败交bridge调用者处理，不是detached timer；状态保writeFailure，不假cleared |
| list lazy sweep | state/tools/queueguard/nudge timer/授权观察读取可能触发写 | list内部catch保最近commit及诊断，读面可用，不静默把失败sweep当dead |

## PR354 R2：enforce query答复不丢

原2078570发送方边界已非作者复核通过，R2发现hook3在resolve归档后再find导致enforce query答复丢失。现用resolve之前owedRow/headerVerdict计算outcomeAllowed，仍在成功持久提交之后recordOutcome；不把write失败或off-chain回执记completed。新增真实CLI deposit→A转发→B持有效key正式receipt的enforce mesh：query起初pending，写错503后仍pending且欠账保留，修复提交后query返回completed/原摘要。把allowed反向改回resolve后find，该例明确query仍pending而红，已恢复。

首轮全gate仅既有30ms singleflight墙钟红，未改预算/worker/skip，隔离原例绿；最终默认全量job bash-b3ff1c7ad2f14fa4真实exit0：root1517passed/7skip（原6+POSIX权限平台1），layout4/nexus332/innerentries0。#357 owner阶梯旧语义单列，不在本PR改。

未来提醒器不在本PR实现，它自己的idle/timer/boot reserve仍必须内部catch并测无uncaught；不能因本PR有错误诊断而省略边界。需高档非作者新精确head复跑发送/接收故障、去catch及恢复吞错突变，之后按授权链处理合并。PR352重写方向另遵属主最新“空闲提醒本人对账”，此PR不引入新phase/ack/outbox/对账器；生产及1c56c492/446ce672积压未动。
