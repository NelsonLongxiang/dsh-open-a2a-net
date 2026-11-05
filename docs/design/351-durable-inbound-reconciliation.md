# ADR：#351 入站任务持久对账与阶段诊断（A+C，仅设计）

状态：**待高档非作者精确头评审，不含实施授权**。派单 direct-c69cf225442e，设计基线 master f6363318cd905c5f69afe2c3e32e30ac62021b7d。只交 A+C，不执行账本迁移、不替任何会话补回执，不动 #343 的 scripts/verify-*、verify/ 或生产配置。实施须设计确认后另行派发。

## 上下文

### 已有链路与失效窗口

- index.ts 的 armReceiptAutosend 注册一次性 registerFinalWaiter；flushFinals 找到 consumptionIndex 后以 readingTurnReply 读消费任务的那轮，超时/会话销毁/中断/textless 会关闭 placeholder，不形成完成证据。这些行为本身不应被放宽；缺的是等待器关闭后没有持久重查。
- consumptionIndex 只认 user/message 首个文本块开头的完整 `[A2A direct] (task <id>)`，并从本次投递前 steerFloor 开始。readingTurnReply 对有 turn 标记的日志只取该消费后第一个 turn/end 前的最后非空 assistant 文本，reason.kind=completed 才可用。没有标记时现快路径依赖活会话 idle 的旧兼容假设；磁盘恢复不能把这种假设当历史完成证据。
- TaskLedger.trackInbound 已落 taskId/目标/回执地址 auth/部分 deliveredTo/startedAt，但没有消费轮锚或持久发送状态；markAnswered 只记时点，不等于结清。TaskLedger.persist 当前直接 writeFile 且失败吞为 memory-only，不能支撑本设计的“持久重启恢复”承诺，需实施时提供明确的原子提交与错误返回，不可忽略这个差距。
- 自动回执先 markAnswered，再 runReceiptLadder，caller lane 接纳且 settlementRefused!==true 才 settleOwnInbound；owner mailbox只是升级通知，不证明原发送方已收到。当前 dispatchAnywhere 背景回执没指定独立发送 task id，重启时不能单凭内存 waiter 去重。
- queuedFor 的计数是 pending、receiptExpected!==false、answeredAt不存在、direction=inbound或peer=local，且 team/deliveredTo 命中；本次完全保留。status pending/dead 与 receiptExpected、TTL、archive、conservation 都不能被新phase替代。

### 范围裁决与 issue 验收冲突

**不做 B**。已消费但中断、尚在办的行仍按现有条件占名额；answeredAt形成后按现行规则不再占（即使回执正在重试），这不是新增“只计未读”。issue 第3条的“名额已释放”和第4条“读一条就可投第4条”属于 B，本次不能实现。第3条本次只验 consumed-unanswered、不发回执、后轮不能代结；它仍占名额必须有反向测试钉住。第1/2/5条属于 A，C提供可见原因；第6条中“计数改回全部pending”突变不适用，改成保护 queuedFor 不变的等价/负例测试。此范围差异交原评审确认，不把未批B悄悄混进A。

## 决策

### 1. 持久模型：业务阶段、欠账状态、传输状态分开

每个可追踪 inbound 行新增 version=1 的 reconciliation 可选对象；同机 local 行若同一 taskId 已由 outbound 账本占有则沿旧行身份加接收观察，不另增一条造成守恒重复。只有原 ledger 身份、direction、targetSessionId、deliveryId 可对应的一次真实投递可推进，不能从任意日志段新造任务。

| phase（状态面显式闭集） | 所需证据 | 原账本/计数关系 |
|---|---|---|
| delivered | 原投递成功/持久投递记录；尚无确定消费锚 | 原pending继续欠账/占名额 |
| consumed | 锁定的 task header 与 consuming turn，尚未见该轮最终结束 | 不写answeredAt，仍占名额 |
| consumed-unanswered | 同一轮明确aborted/failed/blocked或completed但无非空回复 | 不写answeredAt，不补回执；后轮不可晋级，仍占名额 |
| answered | 同一消费轮正常completed+非空文本，证据与冻结回执已持久提交 | 保留pending直到caller真正接纳；写原answeredAt，现规则不占名额 |
| settled | 原授权链认可的caller lane接纳或既有合法settlement已完成 | 走原归档/结清计数，不能因phase自行删账 |

phase与 status=pending/dead/归档终态正交。cancelled/abandoned/evicted保留 endedBy/outcome，不伪标settled；为状态面原归档行投影 phase=settled 时还要 settlementKind=receipt/echo/sync-evidence 等来源。人工撤单/TTL过期不算会话完成。新字段由一个有界解析器白名单读取，未知版本/冲突字段不drop原task，标 reconcileBlocked，不自动修补成delivered。

建议字段（具体类型由实施PR冻结，不改既有auth内容）：

- `targetSessionId` 完整本地id（不是id8猜测）；`deliveryId` 本机产生的一次投递nonce；`deliveredAt`；`deliveryAnchor` 包含本次steerFloor、投递前最后稳定事件id/前缀摘要、日志代际/会话身份（可得时）。数字floor只能在同一日志身份内解释，不能跨压缩/轮换直接当数组下标。
- `consumed`：taskId精确匹配的消费事件指纹、turn/start稳定id或其事件指纹、read索引与日志代际、at/observedAt（事件无时间时不伪造精确发生时间）、所有后续边界校验用的锚。首次合法消费锚一经写入不改。
- `answer`：对应消费锚、该轮end与最后assistant文本指纹、endReason、reply摘要及原始回复哈希，onBehalfOf、原authRef，记录schema版本。摘要沿现SUMMARY_CAP，不复制整份日志或工具秘密。摘要只从同轮已完成文本提取，不把后轮文字当“done”。
- `receiptOutbox`：原taskId为业务幂等键，固定回执字节/hash、固定投递task id（独立于原taskId）、callerTarget、ownerEscalation状态、attempts/lastAttemptAt/nextAttemptAt、deliveryResult、lastError（安全短语，不含凭据或正文）。attempts不是“已完成”证明。重试不生成新回执正文或新传输id。
- `reconcileObservation`：lastCheckedAt、source=memory/disk、blockedReason、logGeneration、bytes/events已处理游标；与phase分开，日志暂不可读不能把已消费锚倒退成未读。

主机正常单实例管理同一home；新增持久转换须使用当前行revision的CAS+原子临时写/rename，文件/目录同步遵循平台能力（Windows目录fsync限制如实说明）。写失败保留旧磁盘与内存已提交状态，phase/answeredAt/发送意图**不对外宣称已持久成功**，标持久化错误并停止自动发送，恢复后再查；不得沿当前吞错memory-only习惯宣称“有保证”。不支持两个plugin进程同时写同一home，发现锁/CAS冲突fail closed，不偷锁。

### 2. 投递锚与阶段推进算法

1. **投递原身份先准备**：在实际steer前获取完整targetSessionId及deliveryAnchor，持久准备一个deliveryIntent（在同snapshot的接收观察区，不加入queuedFor业务行/不增加trackedTotal）。真实steer成功后与原trackInbound/同机行转换同事务标delivered。准备失败不steer；steer明确失败清意图，不造delivered。如果steer成功、最终记账前崩溃，启动只能用intent+精确日志消费事实恢复同一投递；无事实则标 delivery-uncertain，不自动重新steer/不假记失败邀请重跑。这是避免“已经执行却无记录”的恢复要求，不改变queue准入点或重发任务语义。
2. 每轮扫描先读原行身份/status/receiptExpected/auth；已terminal、收据消息本身、自收据、自路由禁止自动回执，沿原规则。pending/dead分开处理，普通自动补发先只处理pending；dead可记录消费观察但不自动复活/补发，late receipt仍走原接受路径。
3. 使用原始完整session事件，以consumptionIndex匹配精确task id，且从已验证deliveryAnchor后的有效范围开始。已存消费锚则直接验证锚不漂移；同id旧历史、相似前缀、nudgeRef、引用正文里的伪header都不匹配。多代日志或两次消费候选无法唯一绑定时reconcileBlocked=ambiguous-consumption，不选择最新或第一条凑答案。
4. 找到消费锚后调用同一个readingTurnReply。必须验证从该消费点到首个结束边界属于同一turn：若先遇到下一turn/start而未有原turn/end，标 consumed-unanswered（incomplete/interrupted），不继续扫下一轮的end。明确completed+非空文本才answered；中断/无输出维持consumed-unanswered且后续他轮不得覆盖。相同原turn因异步落盘补齐此前缺失的原事件可重新核实，但不能把不同turn伪装同一轮。
5. **无turn标记的旧日志**：不调用readingTurnReply无标记时的completed=true来做磁盘追认。原活内存5分钟快路径的旧兼容行为不扩到重启恢复；只有同轮live idle观察当时落盘的完整结束证据能晋级。否则显示consumed或consumed-unanswered/legacy-turn-boundary-missing，不因“session现在idle”填completed。未来要改旧主机兼容口径须另裁。
6. answered转换必须先原子持久化 answer+固定outbox+原answeredAt，再唤起发送。每次快速waiter或reconciler都调用同一`observeAndMaybeSend(taskId,deliveryId)`流程，不留两套各自生成回执/写answeredAt的路径。阶段推进不自己再steer会话，不重复注入原消息。

### 3. 对账触发、调度与资源预算

- **会话turn/end**：适配宿主真实session事件通知（实施时只读核API，不能假设ctx.on存在某个未声明事件）；在turn/end已进入事件流后标dirty并对目标session排一次微任务。现有agent/status idle仍作兼容触发，不以状态本身证明完成。处理不能同步阻塞宿主事件回调。
- **主机启动**：ledger/会话路径/签名key就绪后扫有接收锚的pending，分批恢复，无需等待live Agent；不自动启动会话或要求其重新join以读取已存在磁盘事实。启动仍保持普通route可用，持久/日志错误仅阻止相应自动结算并可见。
- **低频兜底**：插件ctx.timer托管每60秒tick（设计默认，测试注入假钟），有轻微jitter且每home唯一worker，不创建DSH schedule/YGL job/cron。停止插件时取消timer与扫描、丢dirty请求，等待/取消本进程I/O，不杀宿主。
- per-task single-flight + per-session coalesce，启动/turn/timer/快路径同task最多一个transition/send worker；全局最多2个日志reader、1个发送batch；每pass最多16个session或64个task，循环公平游标，剩余下tick，不每个task重读同文件。日志没变用file身份+size/mtime（仅缓存失效提示，非归属证据）避免全重解码。
- 发送沿现caller→重试→owner ladder，caller网络超时保持answered/outbox due，退避30秒→60秒→120秒至15分钟封顶；有TTL但不清欠账，不因owner已通知停止对caller的可恢复重试。owner通知每task/同failure版本最多一次，有持久标记，不自动给owner派新任务挤队。配置阈值先做内部常量/测试注入，不为本设计新增生产配置或翻默认。

### 4. 磁盘日志读取、归属完整性与上限

现GUI的readSessionLogTail→extractTranscript会丢task header位置/turn边界；**不能复用它的显示消息作结算证据**。可复用路径代际选择与decodeSessionLog，但需独立原始事件reader，供同一consumptionIndex/readingTurnReply使用。

- 路径仅从完整targetSessionId与宿主home/sessions/<provider>/<id>/推导，校验路径落在sessions根内；拒绝id路径穿越，lstat/realpath防symlink越根。只能读该任务目标会话，不能为same-id8扫描其他会话。若多个provider目录有同id且没有绑定的provider，标ambiguous-session-path，不取目录遍历第一个。
- 同身份目录选择最高session.vN.jsonl[.zstd]（同代优先zstd）须验证会话header/原消费锚。generation变化不等于找到了另一次消费；支持明确旧锚映射时才继续。inode/size回退/前缀不符视为rotation/truncation，保存原锚不替换，显示log-changed需复核。
- 每artifact压缩/磁盘输入上限沿现64MiB，累计解压上限160MiB；单JSONL行2MiB、事件数100000，完整答复摘要沿SUMMARY_CAP。不能先无界decompress再检查大小：解码器须带最大输出限制或增量frame解码，单frame膨胀亦受160MiB剩余额度限制；不支持这种decoder能力时fail closed，不调用不受限同步解码。原decodeSessionLog实现是解压后才检total，实施必须显式加分配前界或worker隔离，不假称原函数已防zip-bomb。
- 使用有界worker/异步reader避免64/160MiB同步处理卡宿主；每session单次解码10秒deadline，取消后诊断disk-read-timeout，下次退避，不放宽归属或删任务。每pass解码/处理预算160MiB，事件流逐批供ownership reducer，内存不为64条任务复制64份日志。
- 读追加中的文件只接收完整JSONL行，尾部半行留待下次；中间损坏/类型错误、zstd损坏、缺frame/end时标corrupt/incomplete，禁止跳掉坏行后跨turn猜答复。部分读取时仍保留source offsets，全局event索引不因filter未识别事件重编号；缓存游标不跨日志身份复用。
- 大于界限、日志已归档外移/不存在、无权限或身份不明：不自动settled/不写answeredAt，状态带具体bounded诊断与next，由操作者修日志/显式处置；不扩大到读任意外部备份，不更改或截断会话日志。本期不承诺无限大历史日志可自动补齐。

### 5. 回执幂等、崩溃窗口与归属不放宽

- 原taskId+deliveryId是发送意图唯一key，固定回执文本与v2 envelope（原outcome、onBehalfOf=真正session face、sessionKey/idempotencyKey、原authRef）。不用当前session title、当前canvas成员或新授权替旧auth；已持久auth无效/缺ref时不伪造，标legacy-auth-unprovable。读取日志文本不授予权限，发送仍通过原路由、OriginClaim、CLI pinned-home与settlement验证。
- receiptOutbox固定独立传输task id，格式符合taskIdRefusal；重复worker/崩溃恢复都发同一id与同一body，接收端idempotencyStore重放不再次steer/入mail。不要重用原业务task id为传输id与目标普通任务撞账，不重新计算新context/新body造成payload-mismatch。设计目标是**有界有效期内接收副作用至多一次**，不是网络请求绝不重发。
- 已answered但未成功caller交付，任务仍为原欠账；caller成功且未settlementRefused才通过settleOwnInbound归档并记settled，同机走原本地授权验证。若只owner mailbox收到，则只记owner-notified，phase仍answered，不把升级通知算原caller结算。
- caller已收而本地落盘前崩溃：恢复先query固定投递id结果，获明确已投递及原payload相符才提交本地settled；未知时使用同id重试。远端幂等记录有界/可能到期，不能承诺无限期exactly-once；超过远端保证窗口而本地不明时标delivery-uncertain并停自动重试请求人工核对，不能换新id再试或假记settled。持久确定成功标记后不再send。
- 快路径与对账器同时命中只创建一个持久outbox并单flight执行。正常并发测试应看到一次caller投递；crash-after-send测试允许多次同id网络尝试，但接收侧只一次副作用且本地一次归档。
- **#114 S5**：每任务有独立steer/消费锚，不用全会话最新assistant或全waiter最小floor；authRef绑定原inbound。消费之外的工作不归该任务。
- **#306**：只取第一消费轮已完成回复；中断后第二轮不自动代结；sync waiter的同轮读取继续用同一ownership reducer而不改15秒同步传输预算。
- **#305**：成功的同步答复不消灭后续真实回执证据；有sync-answered标记的CLI邮件仍保留原文/分类。新phase不能以同步返回=settled来取消自动回执，不能重复创建新outbound receipt debt。沿现#141“receipt不欠receipt”排除消息，重试也不请求回执给回执。
- 已由会话合法手动回执结清、撤单或内容echo收账，在原ledger原终态上结束worker，不能reconciler复活再发。若会话在中断轮自行发了有效正式回执，仍按既有授权链受理；本设计不自动从中断文本制造一个新回执，也不撤销既有人工合法结算。

### 6. 旧 pending 迁移与旧终态兼容

读取旧tasks.json不以“现在idle”或answeredAt存在伪造原turn；首次产生新字段才写新snapshot，原auth/sender/回执地址/startedAt/conservation总数不变，原文件备份/原子更换可审计。非法扩展字段标diagnostic保原行，不能静默把任务丢掉腾名额。

| 旧行证据 | 新投影/处理 |
|---|---|
| 有完整target/auth/投递锚，可在目标唯一原始日志重建精确消费及turn | 依真实事件推进delivered/consumed/answered；正常发送恢复按固定outbox规则 |
| 无新delivery nonce但有稳定log event/header id、同task唯一匹配、target/caller/投递后前缀可证明，结束时间不早于原startedAt | 记录legacy-reconstructed来源后绑定消费锚，不新增delivery或改payload；不以时间单一证据替代所有身份检查 |
| 有task header但无timestamp/序号可与投递前历史区分，或同id多候选 | phase暂delivered（仅旧投递记录意义）+blocked=legacy-delivery-anchor-missing/ambiguous，不能伪记未读；phaseConfidence=unknown，next查历史。不能搜到任意旧completed就补 |
| 只有answeredAt，没有可证reply/原auth/回执目标 | phase=answered（legacy-answered标记）但autoSendBlocked，保原不占名额语义；不填done或补正文 |
| dead/abandoned/cancelled/evicted及有结算归档 | 保留终态与旧原因，无自动复活；不得用旧原因unconsumed推断从没被消费 |
| 无turn边界的legacy日志或不完整日志 | 可记录消费线索但不磁盘追认completed；显示无法证明，owner显式处置，不编造回执 |

不能保证眼下所有历史积压都能自动补齐，缺归属证据的旧行仍可见，不以宽松迁移满足演示。现生产1c56c492/446ce672积压不在本设计里读取/改账/补回执，需原会话按原流程实际处理。

### 7. C：phase与queue-full诊断，计数函数不变

- /state、a2a_tasks以及只读工具schema、a2a-net tasks/status与工作台账本行带phase/phaseConfidence、phaseObservedAt/phaseAgeMs、consumedUnansweredReason、receiptDeliveryState/nextRetryAt、reconcileBlocked、lastCheckedAt；对outbound不伪报消费阶段，只投影本host所知状态或phase=unknown。归档记录保留最后阶段与结束原因。
- queue-full沿原相同过滤条件得到occupyingRows，count===queuedFor；新payload bounded字段`occupancy:{cap,count,byPhase,blockingTasks,omitted}`。每blockingTask只给可见taskId、phase/diagnostic、startedAt、ageMs、phaseAgeMs；最多16条，总6KiB，phase桶含未知；不能只列“未读”把仍计数的consumed藏掉。新任务仍拒原-32009/FAILED/未steer；mailbox豁免与已有task的真实receipt通道不改。
- 权限/隐私：本机已授权control可以见该目标计数清单；普通model工具沿现scope/owner门。远端caller只列自己发送的task id；其他占额任务保留同阶段匿名桶/数量/年龄区间，`omitted`明确不完整，不能泄露第三方task id、正文、日志路径、reply或秘密。自己的task id亦按现taskId上界过滤防响应注入。
- next按事实区分：有delivered确定未读→“等待目标读取/勿换id循环重投”；有consumed未结束→“已读在办，沿原task查询勿重复派活”；consumed-unanswered→“读过但该轮未完成/无回复，原task追问或由有权方显式撤单，不代造完成”；answered未settled→“答复已记录、caller发送待重试，查询原task/传输诊断”；unknown/blocked→“消费状态未知，查日志/权限，不声称未读”。混合阶段给分桶next，不一刀切“对方忙”。
- 过阈告警默认consumed-unanswered观察15分钟，状态与CLI status只读提示，timer不再给会话注入提醒/派新任务；阈值可测试注入，不在本设计创建schedule。不自动取消、abandon或降phase来释放名额，不把TTL/dead改成settled。

### 8. 实施候选改动清单（本PR只文档）

拟新增独立ownership reducer、bounded session event reader与inbound reconciliation/outbox模块，避免继续堆大index。修改TaskLedger行解析/原子提交/阶段观察接口、wire与local成功投递锚、armReceiptAutosend/同步waiter共同入口、宿主生命周期注册、现phase展示/queue诊断schema与CLI渲染。queue-guard只抽共享过滤以产生诊断，不改变queuedFor谓词；若schema迁移/原子提交范围超出现有ledger，实施前明确一并审。nexus有改时先核planning-view1507行上限，诊断展示放小模块。

明确禁止修改本期B队列语义、其他对端配置、生产任务日志、#343文件/验证器构造物、已有receipt格式归属/CLI home权限。需要新宿主API或磁盘格式假设时报告能力缺口，不改deepseek-harness源码。

### 9. 验收与反向突变（待实现，未执行）

| ID | 真实mesh/磁盘场景与必须观察 | 反向突变必须使行为断言失败（非靠摘要） |
|---|---|---|
| T1 / issue1 | 缩短flushTimeout模拟超过5分钟，原waiter关闭后同消费轮正常completed+非空；turn事件触发补发，caller一次收账，target记录answered→settled、原queue名额按answeredAt规则释放 | 去掉持久reconcile，仅快waiter：caller仍欠账，阶段不推进 |
| T2 / issue2 | 消费后target主机停掉，保留真实磁盘完整事件；补写**同一原turn**的completed/text后重启，内存无agent；启动reader归属验证并发回执，不需假启动会话。另测boot时尚无end，随后磁盘补齐由timer完成 | 去boot或disk fallback：启动路径无补发；去timer：第二子例不恢复 |
| T3 / issue3(A边界) | 消费轮aborted/failed/blocked/textless→consumed-unanswered，后续turn正常输出不得补；同id不同旧turn不代结；此阶段仍占queuedFor | 取latest文本/第二轮end/放宽reason→错误回执；只计delivered的新B谓词→本期队列保护失败 |
| T4 / 不实施B | 3条未读第4拒；读1仍在办或中断时第4依旧拒；该1真实answered才现计法不占。cap0、同host/local、mailbox/receipt豁免、canvas target别名原例保留 | 把consumed排出queuedFor或phase代answeredAt→数量/投递断言失败 |
| T5 / issue5 | 快waiter+turn/end+boot恢复/timer同task同时命中，只有1个持久outbox与1次正常caller发送/归档；模拟send前/后persist崩溃：同传输id重试、caller副作用1次，owner通知不是settled | 删除single-flight/固定传输id/persist-before-send→重复mail/重复task或遗失回复 |
| T6 | 原有#114 S5/#306 busy错误轮/多任务同轮/不同轮/旧header/floor/body前缀用例全部保留；仅消费轮完成才回答 | 去task精确匹配/floor/首turn边界→无关工作代结 |
| T7 | #305同步得到真答复后仍保存后来自动回执证据，CLI标sync-answered，不再添outbound欠账；receipt本身不触发回执 | sync成功直接终止证据/receipt再回receipt→丢mail或回环 |
| T8 | 普通JSONL与zstd多frame原始事件、最高generation、稳定锚、空内存回退；缺日志/半尾/中间损坏/多provider/rotation/越根/symlink/超64或解压160MiB/2MiB行/10万event均bounded fail closed，不误写answered | 删除上界/跨代复用index/跳坏行/使用extractTranscript→资源界或错误回复断言失败 |
| T9 | atomic persist报错/锁冲突/磁盘full时不send不报持久成功；恢复后仍可同task重试；ledger守恒与旧归档身份不变 | 吞persist错误后发送→crash恢复丢outbox/重复执行 |
| T10 | 旧pending唯一可证迁移、无锚歧义、legacy answeredAt无正文、terminal/dead不复活；operator取消与receipt竞争不重发 | 开机idle直接markAnswered/补done/复活terminal→误结算 |
| T11 / C | tasks/state/CLI行phase、queue-full占额task/匿名桶/年龄/next与原count一致；陌生caller不能看其他task id或文本；consumed-unanswered过阈只观测不自动撤单 | 只列delivered/无scope过滤/自动清债→诊断错误、泄露或守恒改变 |

测试使用临时home、真实HTTP hosts和磁盘JSONL/zstd fixtures，不操作现生产账本/会话、不人工冒签完成。长轮次用可注入时钟/等待预算，不给线上等待器延长；快/慢共同入口要能分别关闭以证明reconciler独立存在。反向改动后恢复原代码再完整门禁；高档非作者须精确head独立复跑行为与突变。工程gate通过不等于已验证所有持久结算规范，新正式验证器材料如需要另按构造纪律，不在本设计现场编码产PASS。

## 后果

收益：正常延迟/重启不再让一次性waiter决定回执命运；阶段/错误可见，归属仍限定原消费轮。代价：必须保存可验证投递锚、提高ledger原子提交与bounded decoder要求；部分旧日志/超界记录仍需人工核实，不能承诺所有历史积压自动恢复。

本次不提供“中断立刻腾名额”，这是B待裁；不更改sync预算、不使有输出的任意后轮结算前轮。网络失败/幂等过期超出保证窗时明确delivery-uncertain，宁可欠账可见也不编造settled。推迟项：B与并行在办限额、无限大日志索引/原生draft-run、生产存量补发/部署等分别报批。设计确认不是实施或任何实际会话补回执授权。
