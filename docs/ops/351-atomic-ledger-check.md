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

需高档非作者新精确head复跑故障行为、去catch及恢复吞错突变，之后按授权链处理合并。PR352重写方向另遵属主最新“空闲提醒本人对账”，此PR不引入新phase/ack/outbox/对账器；生产及1c56c492/446ce672积压未动。
