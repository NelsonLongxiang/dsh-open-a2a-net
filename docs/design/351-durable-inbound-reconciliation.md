# ADR：#351 空闲会话的持久强制对账提醒（属主裁定重写，仅设计）

状态：**d6061b4 REQUEST CHANGES后通道修订，待新精确头非作者复评；过渡通道为空闲时steer，排队切换见#356，无提醒器实施授权**。依据属主原话与issue351 comment6670509982、direct-7ac45ccba3c8。取代PR352原730980c的A+C日志补回执方案，以及已被否决的读到即ack方向；旧稿保留在git历史。基线f636331；前置解码PR353已合725c1c6，账本原子写PR354另行高档复核。本PR仅改本文件，不提醒生产会话、不补账/回执、不改配置，不碰#343。

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
- **低频兜底**：ctx.timer托管60秒检查，测试注入时钟，不新增DSH schedule/YGL job/cron。触发合并为per-session single-flight；stop插件取消timer/待处理扫描/本进程请求，不杀宿主、不抛弃业务欠账。
- **当前明确选定的通道：空闲时steerRelay，不等宿主**。每次真正发送前重新核目标完整id/live对象/status=idle，沿现steerRelay保留a2a-relay来源、发送方与lineage/taint。若busy则跳过，不排队、不注入、不计次，等下次idle；不能为了“提醒”打断正在办的轮次。此处steer是经全局选定的过渡通道，**不是排队失败后的无条件兜底**。
- **过渡：等宿主补上source后改为排队发**，跟踪[宿主缺口#356](https://github.com/NelsonLongxiang/dsh-open-a2a-net/issues/356)。P0已获接受：宿主fcc0ad4621的SessionPromptRequest无source，prompt将非空强制kind:user；故当前禁止任何携带对端内容的裸user队列。任务投递（同步/异步/同机/跨机）暂沿现steer，撤单也保steer；来源入口由龙翔/授权宿主会话处理，本席不改宿主。宿主补受控source并经评估后，另派P1独立切换PR，默认任务queue一任务一轮、撤单仍steer，不混提醒设计/缺陷修复。
- 未来切换必须实跑维护窗口不丢/FIFO一轮一条、未消费撤回与接口未挂载，并做去来源/任务改回steer/撤单改queue/缺接口fallbacksteer四项突变。P0维护结论目前**只有源码与已有测试文本证据，未在此会话实跑**，不能冒作切换验收PASS。现nudge固定主机文字的queue升级不在此处改造，可观测性另见#355。
- 本期steer能力失效只记reminder-unavailable与安全错误，不冒称宿主接纳；绝不尝试kind:user裸排队。
新逻辑与armAsyncNudge共用**会话级最小间隔/在途门**以免两个提醒连发，但不改原未读nudge条件、预算或消费探针。旧nudge只提示读取；新reconciliation reminder列欠账，不重新steer原任务、不冒用原task header。现自动回执快路径仍按原消费轮规则运行；提醒自己结束一轮不能成为任一旧task的完成回复。

### 3. 提醒正文：逐条且无代结算

前缀采用非任务标记“[A2A reconciliation reminder]（仅对账提醒，不是新任务）”，不使用[A2A direct]、[A2A receipt]或[A2A ack]。每条列原task id、原发送方/回执目标、brief（有界原消息摘要）、已挂时长；来自ledger而不是读会话全文。brief是外部不可信数据，以引用/转义文本展示，不拼进可执行指令，不从摘要抽“新收件地址”。

正文要求：核查每条原任务并由**会话本人**通过原a2a_route路径发正式回执，结果沿现词表completed/failed/rejected/abandoned，或**照实说明仍在办**。禁止为了清队把在办或未核任务随意写completed/abandoned；在办说明作为正常跟进信息，不制造新outcome或用终态回执格式冒充结清（现解析器收据头可能结账，故不得用[A2A receipt]发非终态“处理中”）。结果/归属/权限仍由原会话与settlement链负责，主机既不编造也不代签。

目标只看到交给自己且仍pending的条目；每次最多8条、正文总4KiB，taskid/地址沿原256边界、brief上限160字符、超出显示“另有N条，请用a2a_tasks查原账”，公平游标后续列遗漏项。不能以截断taskid发送错误回执：超界原id按损坏诊断、不展示一个可被误用的前缀。普通任务正文/秘密不复制到提醒。相同会话多目标别名归同完整id去重，同task只列一次。

### 4. 持久预算、重启与未确认注入窗口

只增提醒元数据，不改status或守恒：每行可选reconcileReminder{version:1,attempts,deliveredCount,lastAttemptAt,lastDeliveredAt,nextAt,requestId,lastResult}，及最多与有欠账session一一对应的会话节流记录；类型白名单/上界非法则标diagnostic，不丢原行。旧pending没有元数据时视次数0，但**设计/实现上线前不实际回溯操作当前生产积压**，升级部署/存量处理另批。

常量建议：RECONCILE_SCAN_MS=60秒、SESSION_MIN_REMINDER_MS=120秒、REMINDER_LONG_INTERVAL_MS=2小时、REMINDER_ESCALATE_AFTER=3（**告警阈值不是总次数上限**）。初次真正idle且steerRelay可用时可提醒，第2次至少距第1次2分钟、第3次至少距第2次10分钟；第三次后等30分钟仍pending且idle时标“多次提醒未对账”、给本机sender一次警示，此次检查不自动加发第四次。第4次及之后至少距上次实际尝试2小时，到期若busy延后至真正idle，**持续提醒、永不因次数达到3而停止**。第三次已reserve但宿主未接纳时，警示注明尝试3次/成功M次，不伪称会话已读3次。

次数/nextAt从落盘恢复；task不变不会因brief、重启、batch变化、其他任务结清重置早期退避。新任务只有自己早期节奏，不能给旧任务重启短间隔；同session任何batch仍受120秒门/单flight。长期计数以安全整数饱和展示N+，不能溢出归零或因达数字界停止。若最后一条欠账正常结清/dead/有权撤单才退出提醒due，其他欠账计时不重置；busy期间不消耗提醒次数。测试假钟跨42分钟/数小时/重启，必须证明长活结束后空闲仍收到提醒，而不是被exhausted截断。

发送提醒前原子提交本次reserve（attempts+requestId/lastAttemptAt/nextAt），再复核idle并经带来源的steerRelay注入；reserve后若目标已busy则不发送、不计成功，原attempt记录为skipped-busy且恢复该次提醒次数/到期时间必须同事务提交，写错catch可见而不重复注入；只有宿主接纳才deliveredCount+lastDeliveredAt（“已提醒”表示宿主接纳提示，不证明模型已经读入）。写盘失败由**提醒器自身在idle/timer/boot入口内catch**，不让异常逃逸为uncaughtException/UnhandledRejection；不注入、不推进次数、不在状态面报持久成功，显示持久失败时点/安全错误码并退避重查，不能仅依赖TaskLedger向上抛。注入后确认提交失败也catch，保留reserve/unknown防立即重复。steer明确失败只记录尝试失败，显示“尝试N次/成功接纳M次”，以当前阶段nextAt限速，不无穷快重试；unsupported应在reserve前识别，失败能力不消耗所谓3次终止额度。

崩溃在reserve之后、注入之前：可能少一次提醒，持久attempt不回滚为0，退避后到期才再试，第三次以后仍按2小时长间隔继续；崩溃在注入后、确认计数前：lastResult=unknown，不声称已提醒成功，不立刻补注入，同requestId若宿主支持去重就沿用，否则等下次预算。这里**不承诺跨崩溃物理恰一次**，但不会丢业务账或靠无限重发补足次数。只保最小reserve元数据，不新造outbox或查询远端幂等记录；旧A+C的24h/23h回执重试窗不再是本设计必要机制，因为不代发回执。元数据重启保留必须以前置原子提交正确传播错误为硬依赖。

### 5. 多次提醒后的诊断与本机发送方警示（远端推送不在本期）

第三次后的due检查仍pending→仅观察标记“多次提醒未对账”，保留次数/最近接纳时间与原因，**不改任务状态、不撤单、不归档**。发送方自己决定追问或有权撤单。状态面与queue-full next改为“等目标本人对账”，列原占额条目提醒次数/年龄；占额count仍与原queuedFor一致。普通remote只看到自己发的taskid及总数，不泄露其他发送方id/brief；control按原权限可看全部。本切片不做新phase或匿名细分桶。

**本切片不做远端通知端点**（评审裁定）：不新增/a2a/reconcile-notice，不以ordinary direct给发送方再派一条任务，不借receipt前缀误结账。

- 同host发送会话：同样只在其真正idle时经带a2a-relay来源和lineage的steerRelay注入“[A2A reconciliation notice] 原task尚欠正式回执，目标已多次提醒”，不宣称已读/完成，不走direct/track、不占名额、不要求通知的回执。一次性通知有持久noticeAttempted/notifiedAt、失败catch与有界诊断，重启不刷屏；冷/离线sender仅自己tasks/status可见，不主动wake或放宽join。
- 远端发送方：本期仅在其主动查询status/tasks/queue-full等现有只读面时显示自己task可见的提醒次数与等待对账提示。不能跨host凭本地旧缓存伪装已取到远端最新次数；尚未查询到则标未知/未同步。**不声称远端已经被主动通知**，旧客户端忽略新增只读字段不改变其receipt/欠账行为。远端主动推送另出设计/独立切片报审，本PR不实现任何新端点。
- 第三次后本地sender警示只发一次，但对欠账目标的2小时提醒继续；警示与持续提醒是两种不同调度，不因notifiedAt已存在停掉目标提醒。本机发送方忙时不发不计次，等其下一次idle；不因缺queue-source而blocked，也绝不裸排user。

### 6. 不变项、历史与前置修复

- queuedFor/cap、mailbox/receipt豁免、receipt词表与[A2A receipt]格式、OriginClaim/完整owner key授权、同步15秒预算、#114 S5/#305/#306归属全部不变。新提醒是带来源metadata的外部消息，不是kind:user属主输入，且正文不匹配consumptionIndex任务头，不成为旧waiter的消费事件；主机不读磁盘会话日志判任务完成，不重建answered、不发自动ack。
- 既有正常自动receipt快路径与会话正式回执仍由原链路处理；本设计不根据提醒次数屏蔽真正回执，也不使队满拦收账。只有真实终态变更使该task退出due，其他同会话欠账预算不重置。
- TaskLedger原子写P1(PR354)与bounded decoderP2(PR353)独立缺陷先行，高档非作者精确head复跑，恢复吞错/去上界突变必红；它们不是提醒业务逻辑或对外语义放行。P2已合725c1c6，P1待复核，部署仍另报。
- 此设计不改变a2a-network/routing技能的回执责任，只需补充“收到对账提醒需逐条核对本人任务，提醒不是新任务/不需要回提醒回执”。本期不含远端新端点，仅说明远端查询可见范围，不能暗改契约为已读结账。
- 1c56c492/446ce672现有积压照旧原会话补正式回执，不在本轮改账/补发/注入提醒。所有设计候选测试使用临时home，生产升级和存量启用另行授权。

### 7. 验收与反向突变（设计阶段未执行）

| 测试 | 必须观察 | 行为突变必须变红 |
|---|---|---|
| R1 idle与启动/过渡通道 | idle只经steerRelay带a2a-relay来源与血缘注入，busy为0注入且不计次；绝不kind:user排队；boot恢复due、冷会话不唤醒 | 改queue裸user/忙时steer/去来源→行为红；去持久恢复→计数重置 |
| R2 不改结算 | 提醒前后task状态/answeredAt/archive/conservation/queuedFor相同；文本taskid/原发送方/brief/年龄准确，未填outcome；完成由真实会话receipt收账 | 提醒当receipt/markAnswered/不计已读→债或cap改变 |
| R3 退避与持续性 | 前3次按2/10分钟退避与120秒门；第3次后30分钟警示，之后至少每2小时且真正idle时继续。长活跨多小时/重启后仍提醒；忙时不计次/不提醒，多条欠账合成一次；新task不刷新旧task短间隔 | 达3次return/exhausted停止→长活后无人提醒；去长间隔/持久/单flight→连发 |
| R4 reserve失败/崩溃 | idle/timer/boot里persist失败被提醒器内部catch，无uncaughtException/UnhandledRejection、注入spy0、原账/次数不变，状态安全time/code可见；恢复后到期继续 | 去内部catch→真实事件/微任务异常红；吞persist错误/发后reserve→假成功或连发 |
| R5 本机非任务警示/远端范围 | 第3次后本机sender空闲时一次带来源steer警示、busy延后不计次，不新增债/不标已读；远端无新端点与主动推送，只查询原可见字段/未知标记；目标仍持续提醒 | ordinaryroute/假receipt/警示使目标停止/暗加远端端点→语义或范围测试红 |
| R6 停止与竞争 | 正式receipt与扫描/排队竞争时发送前复核，已settled/dead不再催；stop取消本进程timer；无提醒回receipt回环 | 去最终pending重检/stop取消→结清后仍提醒或停机后注入 |
| R7 原规则 | S5/305/306原例全保，旧轮中断/后轮文本不代结；提醒头不匹配direct；queue满真实receipt仍过 | 改头/改归属/把提醒设新业务id→误消费或堵收账 |
| R8 诊断/上限 | tasks/state/CLI与queuefull显示已尝试/已接纳/最近时间、未对账、next；未知target只诊断，任务正文不泄给其他caller；批次8/4KiB轮转不丢预算 | 截断id当新id/省略occupancy/泄第三方brief→错误行为 |

不再沿issue旧验收断言“读了就放第4条”或“主机从日志恢复补completion”。本方向的重启验收是**恢复提醒预算与due**，不是代会话结清。高档非作者在实现精确头复跑真实mesh/磁盘重启及相应突变，工程门禁与业务证据分开，不以设计文档通过当功能完成。

## 后果

收益：保留背压与责任归属，以持久限频、长间隔不断的提醒要求会话本人对账，不因日志推断或ack把责任转主机。代价：不响应提醒仍可能长期占额，发送方须决定处理；当前source-preserving queue缺口阻断的是未来任务queue切换，不阻断本期明确选定的idle-only steer提醒；不裸排user、不把steer写成失败兜底。远端主动警示明确不在本切片，不擅扩端点。

推迟：已读ack/新接单状态/短租期/只计未读/主机日志代回执/新outbox/worker池/远端query等均非本次方向，不偷偷保留旧A+C机器。设计确认后另派实现，不部署.88/.43或更改生产配置。本PR仅docs/design，旧730980c与属主否决留git/issue可追溯；新稿精确SHA重新非作者评审，不能沿旧PASS或旧REQUEST CHANGES状态宣称已通过。
