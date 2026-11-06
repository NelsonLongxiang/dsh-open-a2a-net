# #351 持久空闲对账提醒实施交付（高档，未合并/未部署）

派单direct-b4781e353868，已合设计5bc012e、实际设计头3f1ce7f；基线mastercda2931（包含354原子账本、359rename重试），独立feat/351-persistent-idle-reminders。PR只Refs351，不自动关issue；非作者精确头PASS后先冻结，须全局回复后再match-head合并。未改生产配置/未部署.88/.43，未碰1c56c492/446ce672积压。

## 落地边界

独立reminder state/controller模块，index只做生命周期与sourced steer适配。boot/idle微任务/60秒托管timer触发；最后核完整Agent对象/真实idle，busy不计次不发不排队，不主动wake冷会话；完整receiverSessionId在真实wire/local投递时记账，重启沿该id，不把canvas当前名册当原接收者。legacy仅可唯一具体face推定，无法定位只diagnostic。

提醒按原taskId观察表原子reserve，再steerRelay带a2a-relay/form relay/原血缘；没source裸queue、没新task/receipt/ack、没markAnswered/自动settle。reserve后busy/terminal竞争撤回观察，写错误内部两层catch，状态安全time/code；成功接纳后deliveredCount仅表示host接纳不等模型已读。原元数据解析有界，非法不删业务账、不归零重发，而blocked；不改status/TTL/conservation/queuedFor。

同session120秒门与旧unread nudge共享：其延后不改变未读判定/有限原预算，非新queue机制。提醒前几次2min/10min，第三次后2h长期持续，第三次后30min标多次提醒且本机sender真正idle时一次非任务警示；sender busy等idle、无远端端点/主动push。task/state/CLI和queue-full加安全提醒计数/最近next/未对账，普通caller只列自己原占额task，名额谓词保持原样。brief仅既有发送方原文brief（原账本120上限，提醒再强制<=160），JSON引用转义控制字符，8条/4KiB，原taskid不截断。

#356 agent.followup新派单已认领但不混此PR，当前明确idle-only steer过渡，未来独立P1切换要source无as/持久MessageId映射/完整授权/撤回/维护FIFO真实测试。nodeReminder声明去as也单独后续PR。#358②status/355告警、③回滚附带状态清单仍在待办，不把此提醒status聚合冒称整358完成。

## 工程测试与反向判别

真实HTTPmesh11例：receiveridle sourced合并两任务/不代表确认不腾cap；busy即便收到idle事件仍0发0次；3次后2h第四/第五继续、busy不花次数、磁盘重启不归零/不重复；boot无需idle事件从盘due恢复；timer无status事件能检查并stop停；cancel/abandon/receipt/过期终态停止；reserve EACCES内部catch、0发送/原盘保留/修复可重试；同机sender忙不警示、idle警示一次不欠账且target继续；真双host派活/receiver提醒/原会话合法正式receipt后两边原链结清。unit7例补reentrant单flight/通知/失败steer/validation全批无部分变更/坏元数据restart/忙race回滚/来源id不得换人。

逐条反向修改（均finally还原）：去idle门→busy误注入红；3次后return→第4缺失红；去长退避→过频第4红；过期仍due→终态后多发红；限制每次1条不合并→遗漏另一task红；去restore metadata→重启counter丢失红；去source改user→真实payload.source断言红；去boot scan→启动无提醒红；去reserve→写错仍先发红；去完整两层catch→微任务uncaught EACCES使vitest进程exit1。只删内层catch仍有外层兜底而绿，不能冒称单层删除已区分；初两次突变因注释吃闭括号仅parse失败不算行为证据，重写有效突变后才得到上述红。

先前全gate暴露queue.next旧字符串断言两红，保留原“wait for a receipt from target”加对账说明修复，不删断言；另旧30ms singleflight墙钟红原预算隔离绿，未改worker/timeout/skip。最终完整默认pnpmverify jobbash-933e3b5713ed47b3真实rc0：root1547passed/7skip（原6+已合354的POSIX权限平台1），layout4/nexus332/innerentries0；strict工具schema实际通过，trackedbuild无diff。架构从base重锚无miss，不声称已视觉渲染。上述为工程门禁，不冒称新的业务规范CLI run PASS。

## 交接

技能a2a-network/routing及release已补提醒不是任务/不是确认/不能用终态receipt说在办。队列3cap与answeredAt原语义、#114 S5/#305/#306回归均在全gate保持。生产升级和存量处理另报；未来重启有正常历史欠账仍可提醒，但本会话测试只用临时home，不接现网操作。需非作者精确head行为/突变复跑，本PR通过也先报全局不自合。
