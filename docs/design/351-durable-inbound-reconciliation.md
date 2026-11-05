# ADR：#351 空闲会话的持久强制对账提醒（属主裁定重写，仅设计）

状态：**待高档非作者精确头设计复核；无提醒器实施授权**。依据属主原话与issue351 comment6670509982、direct-7ac45ccba3c8。取代PR352原730980c的A+C日志补回执方案，以及已被否决的读到即ack方向；旧稿保留在git历史。基线f636331；前置解码PR353已合725c1c6，账本原子写PR354另行高档复核。本PR仅改本文件，不提醒生产会话、不补账/回执、不改配置，不碰#343。

## 上下文

属主认定拥堵是背压正常工作；去中心化协作要求会话本人强制对账。问题不是“欠账要自动消失”，而是空闲会话仍欠正式回执时没有持久、有限次、可见的提醒。现armAsyncNudge是投递后未读唤醒的内存预算，不能覆盖已读且空闲欠回执；final waiter退出后也不能作为忽略账本的理由。

### 两种旧方向的比较与裁定留档

| 旧语义方向 | 所需机制与代价 | 属主裁定后处理 |
|---|---|---|
| 主机判消费轮完成并补receipt（原A+C） | 需原始日志消费锚、turn/end答复归属、发送恢复与大日志界；主机承担解释完成结果 | 不再实施“读日志代会话补回执”；既有5分钟快路径不在本设计删除或放宽，现S5/305/306继续 |
| 主机读入即发新ack，已读释放名额 | 发送方失去完成信号；协议前缀/状态与队列语义改变，仍须防冒认授权 | 属主明确否决“读到就确认”，不新增ack、不把读入当完成、不更改名额/计数，不做接单状态/短租期 |
| **本稿：主机空闲时提醒本人对账** | 账本决定提醒对象与内容，有限重试跨重启；主机不判断完成、不付欠账 | **已选方向**；会话本人发正式回执，结果由原授权/结算规则接收，状态面仅加提醒观察元数据 |

两个前置缺陷与方向无关：TaskLedger直接写/吞错会使提醒次数跨重启失真；decodeSessionLog分配后才检上界是现transcript安全问题。它们各独立PR、不把其合并当对账设计通过。新提醒不需要读取会话磁盘日志、重建answered或引入outbox/worker池。

## 决策

### 1. 哪些欠账提醒谁，计数规则不动

从**落盘后成功提交的TaskLedger**派生due集合：status=pending、receiptExpected!==false、direction=inbound或peer=local，并能证明交给本地完整目标会话。按deliveredTo/原auth.target定位真正接收session，canvas团队名不等于其所有成员都有义务，不能提醒当前队伍任意同id8成员。旧行缺接收定位且无法唯一匹配时仅诊断target-unresolved，不随机投给活会话。远端outbound不在本机催目标范围；CLI mailbox沿原规则，不当DSH会话唤醒。

**answeredAt存在但pending仍欠回执也提醒**（例：自动回执发送失败）；不能把“已回答”当已结账。dead/archived/cancelled/abandoned不自动复活；TTL/dead的原含义不变，旧dead需有权方按现流程查看。识别到收据消息、receiptExpected:false、自收据回环等原排除形状不再催回执。提醒只读业务字段，不markAnswered、resolveEcho、settle或abandon。

队列上限仍3（或原配置），queuedFor谓词逐字等价；已读但未answered与未读仍照旧占，原answeredAt释放逻辑不改。提醒/通知都不调用trackInbound/track/claim ordinary task，不进入欠账名额，也不以“提醒已投递”改变任务状态。本稿不新增phase/ack/accepted等任务生命周期。

### 2. 三类触发与真正空闲检查

- **空闲转换**：复用当前agent/status idle；如能接真实turn/end，仅排一次检查，在日志/状态更新后的下一调度点重看agent.status。不能凭turn/end事件就假定已idle（可能连续下一轮），注入前再次核对完整sessionid、live对象与status=idle。
- **启动恢复**：原子账本加载后对live idle目标检查持久due；还没live或在busy就等待后续idle/低频，不因催账而主动wake/恢复归档会话。不拿磁盘日志“证明做完”。
- **低频兜底**：ctx.timer托管60秒检查，测试注入时钟，不新增DSH schedule/YGL job/cron。触发合并为per-session single-flight；stop插件取消timer/排队扫描/本进程请求，不杀宿主、不抛弃业务欠账。
- 每次触发只处理有欠账且到期的目标；空闲检查与注入之间race变busy时取消该次或交queue-mode排队但不steer打断。首选**queue-mode prompt**，复用armAsyncNudge已有控制器适配/lineage/requestId逻辑；若控制器不可用，只在当前确实idle时用原steerRelay兼容seam，不做二次盲投递。能力全无只记录unavailable，不能当已提醒。

新逻辑与armAsyncNudge共用**会话级最小间隔/在途门**以免两个提醒连发，但不改原未读nudge条件、预算或消费探针。旧nudge只提示读取；新reconciliation reminder列欠账，不重新steer原任务、不冒用原task header。现自动回执快路径仍按原消费轮规则运行；提醒自己结束一轮不能成为任一旧task的完成回复。

### 3. 提醒正文：逐条且无代结算

前缀采用非任务标记“[A2A reconciliation reminder]（仅对账提醒，不是新任务）”，不使用[A2A direct]、[A2A receipt]或[A2A ack]。每条列原task id、原发送方/回执目标、brief（有界原消息摘要）、已挂时长；来自ledger而不是读会话全文。brief是外部不可信数据，以引用/转义文本展示，不拼进可执行指令，不从摘要抽“新收件地址”。

正文要求：核查每条原任务并由**会话本人**通过原a2a_route路径发正式回执，结果沿现词表completed/failed/rejected/abandoned，或**照实说明仍在办**。禁止为了清队把在办或未核任务随意写completed/abandoned；在办说明作为正常跟进信息，不制造新outcome或用终态回执格式冒充结清（现解析器收据头可能结账，故不得用[A2A receipt]发非终态“处理中”）。结果/归属/权限仍由原会话与settlement链负责，主机既不编造也不代签。

目标只看到交给自己且仍pending的条目；每次最多8条、正文总4KiB，taskid/地址沿原256边界、brief上限160字符、超出显示“另有N条，请用a2a_tasks查原账”，公平游标后续列遗漏项。不能以截断taskid发送错误回执：超界原id按损坏诊断、不展示一个可被误用的前缀。普通任务正文/秘密不复制到提醒。相同会话多目标别名归同完整id去重，同task只列一次。

### 4. 持久预算、重启与未确认注入窗口

只增提醒元数据，不改status或守恒：每行可选reconcileReminder{version:1,attempts,deliveredCount,lastAttemptAt,lastDeliveredAt,nextAt,requestId,lastResult}，及最多与有欠账session一一对应的会话节流记录；类型白名单/上界非法则标diagnostic，不丢原行。旧pending没有元数据时视次数0，但**设计/实现上线前不实际回溯操作当前生产积压**，升级部署/存量处理另批。

常量建议：RECONCILE_SCAN_MS=60秒、SESSION_MIN_REMINDER_MS=120秒；每task同一欠账生命周期MAX_REMINDERS=3，三次间隔按2分钟/10分钟/30分钟退避。第一次正常idle时可检查，但受会话总最小间隔；第三次后再等30分钟未结才标exhausted。测试用注入钟，不让测试真等分钟。task id不变的pending不会因brief变化、host重启、batch集合增减或其他任务结清而重置次数；新任务只带自己预算，不能借加入新task使已耗尽旧task重获3次。每个session任何batch也受同一120秒门，防“不断新task”刷屏。

发送提醒前原子提交本次reserve（attempts+requestId/lastAttemptAt/nextAt），再向queue prompt注入；只有宿主接纳才deliveredCount+lastDeliveredAt（“已提醒”表示宿主接纳提示，不证明模型已经读入）。写盘失败不注入、不在状态面报持久成功。prompt失败/unsupported只记录尝试失败，显示“尝试N次/成功接纳M次”，次数上限限制尝试而不是失败后无穷快重试。

崩溃在reserve之后、注入之前：可能少一次提醒，持久attempt不回滚为0，退避后有剩额才再试；崩溃在注入后、确认计数前：lastResult=unknown，不声称已提醒成功，不立刻补注入，同requestId若宿主支持去重就沿用，否则等下次预算。这里**不承诺跨崩溃物理恰一次**，但不会丢业务账或靠无限重发补足次数。只保最小reserve元数据，不新造outbox或查询远端幂等记录；旧A+C的24h/23h回执重试窗不再是本设计必要机制，因为不代发回执。元数据重启保留必须以前置原子提交正确传播错误为硬依赖。

### 5. 超次数后的诊断与“通知发送方”通道

第三次后的due检查仍pending→仅观察标记“多次提醒未对账”，保留次数/最近接纳时间与原因，**不改任务状态、不撤单、不归档**。发送方自己决定追问或有权撤单。状态面与queue-full next改为“等目标本人对账”，列原占额条目提醒次数/年龄；占额count仍与原queuedFor一致。普通remote只看到自己发的taskid及总数，不泄露其他发送方id/brief；control按原权限可看全部。本切片不做新phase或匿名细分桶。

**不能用普通a2a_route给发送方再派一条任务来通知**，否则本机会制造新欠账/挤队；也不能用正式receipt头通知，否则误结账。拟增加有界的“非任务对账警示”投递适配：

- 同host发送会话：通过同一queue-mode提示seam注入“[A2A reconciliation notice] 你发出的task尚欠正式回执，目标已多次提醒”，不走direct/track、不占名额；sender离线则在自己的tasks/status可见，不wake它或放宽join。
- 远端发送方：需新增仅警示的/a2a/reconcile-notice小端点，Sig3绑定body+audience，body只含原taskid、reminder次数/时点/警示，不含brief、指令或回执结局。接收host核本地outbound原行确为发给该peer key（含原peerKey/接收者/授权事实），不是caller自报就信；映射已知sender后入其只读notice ring/CLI警示。**不steer业务任务、不改ledger、不调用receipt解析、不产生task/debt**；固定notice key按原task+达到阈值的生命周期去重，限每task一次成功警示，失败至多一次后续重试且仍守会话节流，不建通用网络通知平台。
- 旧peer未声明/404：不fallback普通direct。状态面明确“发送方主动警示不可达/旧版不支持”，原query/status/tasks在正常查询时携带可见提醒观测；不能声称已经通知到。升级兼容范围必须在实现PR验收，如评审不接受新增小端点，则此项记能力缺口需另裁，不能省略通知又宣称全部完成。
- 本地持久只保noticeAttempted/notifiedAt与有界lastError供重启去重；这不是receipt outbox。警示丢失不能转成settled或新任务；收到警示不要求给警示发回执，避免提醒回环。

此非任务警示端点是“通知发送方”实现需要的明确协议面，提交本设计由评审裁范围；不在设计期开放任何生产接口、不借未入网report ingress跨peer取权。

### 6. 不变项、历史与前置修复

- queuedFor/cap、mailbox/receipt豁免、receipt词表与[A2A receipt]格式、OriginClaim/完整owner key授权、同步15秒预算、#114 S5/#305/#306归属全部不变。新提醒用户消息不匹配consumptionIndex任务头，不成为旧waiter的消费事件；主机不读磁盘会话日志判任务完成，不重建answered、不发自动ack。
- 既有正常自动receipt快路径与会话正式回执仍由原链路处理；本设计不根据提醒次数屏蔽真正回执，也不使队满拦收账。只有真实终态变更使该task退出due，其他同会话欠账预算不重置。
- TaskLedger原子写P1(PR354)与bounded decoderP2(PR353)独立缺陷先行，高档非作者精确head复跑，恢复吞错/去上界突变必红；它们不是提醒业务逻辑或对外语义放行。P2已合725c1c6，P1待复核，部署仍另报。
- 此设计不改变a2a-network/routing技能的回执责任，只需补充“收到对账提醒需逐条核对本人任务，提醒不是新任务/不需要回提醒回执”。若警示能力端点落地须文档说明旧peer不可达，不暗改现契约为已读结账。
- 1c56c492/446ce672现有积压照旧原会话补正式回执，不在本轮改账/补发/注入提醒。所有设计候选测试使用临时home，生产升级和存量启用另行授权。

### 7. 验收与反向突变（设计阶段未执行）

| 测试 | 必须观察 | 行为突变必须变红 |
|---|---|---|
| R1 idle与启动 | busy不打断；idle且pending有回执义务注入一条逐项提醒；启动从磁盘预算恢复；冷会话不唤醒 | 去idle检查→busy注入；去boot/持久恢复→重启无提醒或重置次数 |
| R2 不改结算 | 提醒前后task状态/answeredAt/archive/conservation/queuedFor相同；文本taskid/原发送方/brief/年龄准确，未填outcome；完成由真实会话receipt收账 | 提醒当receipt/markAnswered/不计已读→债或cap改变 |
| R3 退避与上限 | 三次预算+120秒会话门，batch变化/新task/其他结清/重启不重置旧task；过次只状态警示 | 去最小间隔/计数持久/单flight→连发或超次 |
| R4 reserve失败/崩溃 | persist失败注入spy0且原账/次数未变；注入前后crash不立即重复，unknown不冒称已接纳 | 吞persist错/发后才reserve→漏持久预算或无限重复 |
| R5 非任务通知 | 超次对sender一次有界通知，不能生成新task/debt/receipt；陌生key/错target/body篡改拒；旧peer404不fallbackdirect、显示未送达 | 用普通route/假receipt、忽略peer绑定或无限通知→新增债/误结/泄漏 |
| R6 停止与竞争 | 正式receipt与扫描/排队竞争时发送前复核，已settled/dead不再催；stop取消本进程timer；无提醒回receipt回环 | 去最终pending重检/stop取消→结清后仍提醒或停机后注入 |
| R7 原规则 | S5/305/306原例全保，旧轮中断/后轮文本不代结；提醒头不匹配direct；queue满真实receipt仍过 | 改头/改归属/把提醒设新业务id→误消费或堵收账 |
| R8 诊断/上限 | tasks/state/CLI与queuefull显示已尝试/已接纳/最近时间、未对账、next；未知target只诊断，任务正文不泄给其他caller；批次8/4KiB轮转不丢预算 | 截断id当新id/省略occupancy/泄第三方brief→错误行为 |

不再沿issue旧验收断言“读了就放第4条”或“主机从日志恢复补completion”。本方向的重启验收是**恢复提醒预算与due**，不是代会话结清。高档非作者在实现精确头复跑真实mesh/磁盘重启及相应突变，工程门禁与业务证据分开，不以设计文档通过当功能完成。

## 后果

收益：保留背压与责任归属，以持久有限提醒要求会话自己对账，不因日志推断或ack把完成责任转给主机。代价：不响应提醒的会话仍可能长期占额，发送方须决定处理；宿主没有queue能力/peer旧版时警示可见降级，不伪造结果。新端点的最小协议面须评审确认，不擅自扩为通用消息系统。

推迟：已读ack/新接单状态/短租期/只计未读/主机日志代回执/新outbox/worker池/远端query等均非本次方向，不偷偷保留旧A+C机器。设计确认后另派实现，不部署.88/.43或更改生产配置。本PR仅docs/design，旧730980c与属主否决留git/issue可追溯；新稿精确SHA重新非作者评审，不能沿旧PASS或旧REQUEST CHANGES状态宣称已通过。
