# #356 sourced agent.followup 实施交付（高档，待精确头复核）

> 补记（2026-11-13）：已于 2026-11-06 经 PR#363（`d3ac79c`）合入 master（代码在 `src/followup-delivery.ts`）。标题里的「待复核 / 未合并」是写这份记录时的状态，正文保持原样。

Refs #356；派单direct-795e9280a9d0、补充direct-8604a94f8790/direct-702292f00d4c。基线master104196987acace8f3cd28637c4c9dba79f3f2387（已合351/354/359/361），独立feat/356-sourced-followup-delivery；与351实施分支没有并行写同文件。本PR高档，非作者PASS后先冻结、监督报全局获回复后才match-head合并。**不部署、不补积压、不发生产回执，不关358②③，不碰343或deepseek-harness源码。**

## 版本矩阵与能力边界

| 运行面 | 观察版本/事实 | 本轮证据/限制 |
|---|---|---|
| 插件安装依赖 dsh-agent | 0.1.7-rc.2，公开types有followup、inbox与claimed事件 | 插件mesh注册/工具/HTTP测试使用此依赖族；fake Agent明确脚本消费，不冒称真实FIFO |
| 本机宿主checkout | fcc0ad4621，dsh-agent/agent-loop/session 0.2.2-rc.1 | 原始源码/类型只读核查；实际既有lib由plugin自有子进程加载，未构建/改源码或git文件 |
| 真实loop行为 | 0.2.2-rc.1 coherent host lib族 | 插件实际FollowupDelivery+TaskLedger在隔离temp运行；真实maintenance锁存/FIFO/三任务三轮、idle唤醒、JSONL持久cold create→dispose→resume消费、source保留 |
| 旧/自定义Agent缺followup | 不按版本猜能力，实际typeof检测 | 显式拒绝，不调用steer，不产生伪accepted；已有债保持。没有承诺所有更早版本都可用 |
| 缺controller.updateQueue | 可接followup但不能确认pending撤回 | 原撤单账本仍先提交；移除失败只作best-effort诊断，不假称removed；claimed且live仍steer |
| 对端旧卡缺queuedTaskCancellation | 不发送新cancel_task_id控制请求 | 先按原规则清caller行，再发无task_id的旧版[A2A cancel]文本通知；失败只warning，不假称精确移除 |

新增source字段taskId/localSender先正式扩MessageSourceMap，与既有a2a-relay/ContextFormed/senderSessionId/nodeReminder兼容，source对象显式UserMessage[source]声明、**没有as强转**，不伪人类principal/rpcId/timezone。直接Agent路径少controller网关/attachments校验，前置A2A原OriginClaim/成员scope/taint/receipt授权/queuecap都保留；只投纯A2A文本，冷Agent先原wakeColdTeam/materialize。

## 持久对应、投递与撤单

TaskLedger.snapshot附taskDeliveries表，不增加业务任务status。每task记录唯一MessageId、完整SessionId、原text/sender/cleanlocal指纹、verified callerKey（跨机）与投递观察reserved/enqueued/claimed/cancelled。**先354原子提交reserve，再agent.followup**；写失败不送。task由原caller键与原投递身份约束，不能缓存变更后改目标重投。claimed事件与consumed=true同次原子提交，错误catch只警告+ledger安全诊断，不让宿主崩溃。

已接纳最后状态落盘失败保reserved/unknown并warn，不返回虚构未投递去引导重派；restart遇reserved不盲重投。对应表容量512，保现pending或24h以内发生记录，满时拒新无对应投递，不静默evict有效窗口；不是无限历史去重保证。坏shape/重复task/message映射failclosed、corruption标记随后续成功快照保留，不能二次启动洗掉。

所有普通任务路径（wire async/sync、本机async/sync、冷resolve后）调用独立FollowupDelivery。任务与receipt消息都保已声明A2A source，真正停工控制单独steer。#351提醒和本机sender notice依赖名改followup，两者都走同一带source入口；reminder仍仅真idle发/原退避、原reserve与无债义务保持。旧lastResult blocked已从联合类型/parse可写枚举去掉；旧磁盘值parse失败沿已合R-STOP metadata-reset第3次/2h恢复，既有2真HTTP+unit覆盖。

撤单：保原task授权，**先提交原cancel账本终态，通知尽力而为**。随后根据持久MessageId调用controller.updateQueue remove（cold可由controller解析原完整session），确认移除则removed=true且不steer；queue-item-not-found竞态才转claimed，原target即时steer停工，不再followup排队等工作做完。通知/移除失败、claimed目标消失不阻止已提交撤单，steered/removed据实false；cancel账本自身写失败仍failclosed。已claim目标用原完整session映射，不根据当前canvas换人。

跨机cancel_task_id属于body-bound小控制字段，仍走原验签/admission，要求原inbound caller、claim origin/caller及完整callerKey一致；错误caller403，无新普通任务或receipt debt。peer卡声明queuedTaskCancellation才发新字段；旧peer保持master的旧版文本stopnotice兼容，无task_id/cancel_task_id，caller账不受通知结果影响。新wire收到合法撤单也先提交终态，再尽力移除/通知。HTTP本机控制撤单和native bridge遵循同样结账优先，guard外async callback有catch。遗留无MessageId任务按原legacy stopnotice，不逆造映射。此兼容不是任务followup缺失时的steer fallback；后者仍禁止。#357/#362不在本PR修。

消费：wire答复consumed读精确delivery claimed，而非仅running。inbound保存最初probe，随后claim更新；outbound保存所选peer答复snapshot，后来receiver变true不凭空更新sender（没有新增遥测推送）。tasks/state/CLI输出consumed与deliveryObservation=consumed/delivered-unconsumed，旧peer缺字段为unknown。此为观察不是确认/完成，不释放cap，不markAnswered。同步pre-enqueue floor仍任务独立，#114S5/#305/#306同消费轮约束不放宽；15秒/-32005原预算保留。

## 测试与突变（工程证据，不冒称CLI业务spec run）

新unit12：提交前对应、精确source、无steer、reentrant claim不倒退、坏盘不送、reserved restart不盲重发、MessageId精确remove、claim竞态/其他错误、cold撤回、坏map二次重启仍拒、claim+consumed一起回滚、双端probe restart保留。真HTTPmesh13：sourced任务followup、缺能力拒、3cap、pending与claim/race撤单、真实signed跨host caller错拒/正确remove或steer、idle/coldresolve claimed、双host consumed false快照与receiver后续true、真实CLI tasks/json未消费展示、reminder/notify二者无steer。

real-loop独立子进程1用例加载**实际插件dispatcher**和已有hostlib：maintenance期间requests0且inbox次序与持久MessageId相等；释放后3请求/3turn每轮1任务、来源a2a-relay；移除未claim维护wake后无第4请求；真idle新任务第4、JSONL持久coldresume第5，都claimed。只读加载hostlib，不运行/修改宿主仓测试或产物，临时所有文件在pluginowned temp。Node实验transformtypes用于子进程加载实际TS参数属性，原strip-only曾报错如实修正；coldfixture初期API/fork/sessionId/flush设置错误不是验收PASS，最终真实persist+resume过。

四mandatory反向突变均行为红并finally恢复：source改user→payload断言红；任务followup改steer→steer调用红；已claim取消改followup→本地2例及signedremote例红；缺followup回退steer→不该delivered却delivered红。补充：去wake(send next-turn false)实际宿主requests0!=3红；去unconsumed状态标记真双host断言红；去reserve前写盘已有unit会显示无disk/no-send约束失败。没有拿parse/hash失配冒充行为判别。

旧fixture迁移：初期32文件100例红，多为手工Agent只提供steer、次轮时序令原“最后一条”不再是目标header、原pending fixture太快自动结账。显式在这些fake构造器补脚本followup或将债务观察case目标silent，保原team/auth/cap/settlement/assert不skip不放预算。harness followup在微任务执行旧消费脚本，注明**不是FIFO/maintenance证据**。真实loop测试单独负责队列语义。consumed旧running happy断言改为实际claimed事件，新增旧running无claim仍false。格式整行state仅增加本PR规定的观察字段；claim与commit错误测试调整注入序号，不删除错误断言。

原eb60234作者环境完整pnpmverify job bash-c9ca25a565654647真实exit0：root1575passed/7skip（原6+已合POSIX权限平台1），layout4/nexus332/innerentries0，trackedbuild零diff，stricttool schema与全部S5/305/306回归过。此前core完成时也有1569/1574两完整绿；该原头没有增加skip/改worker/timeout，但依赖外部宿主导致不可移植，R-ENV修订新增单独opt-in skip明确计数，不能沿旧头声称默认环境可用。架构按1041969重锚无miss，未视觉渲染；planning-view1499不变。scripts/verify-*、verify/、AGENTS及#343冻结工作未改。

## PR363 REQUEST CHANGES修订（旧eb60234结论保留）

- R-CANCEL：纠正本PR误改的通知确认优先，现control/native/wire撤单都先提交账本，stopnotice是best-effort。旧无cap与新有cap各一例，旧peer明确无cancel_task_id；消失claimed目标仍清行/steeredfalse；removal抛错用例断言在controller调用时原盘已归档。临时改为拒绝旧peer，新旧版case因缺notification红，已恢复；写账自身失败不以通知catch吞成成功。
- R-ENV：真实hostloop不是默认门禁依赖，必须显式设置A2A_HOST_CHECKOUT绝对路径与A2A_HOST_COMMIT完整pin，检查Node支持experimental-transform-types、既有AgentLoop/JSONL库已构建；否则skip，名称含明确原因。默认CI未设置路径直接skip，不假设../deepseek-harness存在；Node26缺flag时也skip，不启动bad option子进程。不计进已有7skip，这是新增opt-in1条。显式环境给错SHA仍FAIL而不是假skip。
- 作者主机真实运行证据：Windows，Node v24.12.0，宿主HEAD **fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159**，Agent/AgentLoop/Session/JSONL包0.2.2-rc.1，已有lib只读加载。显式选择该SHA的宿主运行时后执行专项，本轮真实1/1通过；不在公开记录中给出本机路径或环境变量值。此为作者环境专项，不推广为评审Node26/未构建host也通过。
- R-COVER：新增默认可跑的同步HTTP routeIntoAgent mesh，明确queue中原source/MessageId、steer0，注入真实消费轮事件后同步只回该轮final。把routeIntoAgentFor那一行改回steer，新例缺queued消息行为FAIL；finally恢复。测试取消/收集自身pending请求，不遗留无关unhandled。新增默认不依赖host检出，独立守同步/冷wake辅助函数投递入口。

修订最终默认完整门禁job bash-b97380799ef64616真实exit0（此前同计数完整绿一轮；末次强化ordering测试后中途未改动的安全回归出现一次波动，原样隔离通过并私报，未改其断言/预算）：root1578passed/8skip（已有7+新增外部host opt-in1），layout4/nexus332/innerentries0。外部专项单独1/1通过，不把skip混入既有7例。仍需非作者新精确头复评。

## R-WITHDRAW 定点修订（958b3f4之后，仅撤回失败停工通知）

按全局阻断要求，cancelQueuedTask内部捕获withdraw任意异常，之后仍定位原完整接收会话并走既定steer撤单通道；和claimed通知复用cancelNoticeText，明确taskId、任务已撤单、若稍后从队列轮到不得执行。成功remove不发通知；无Agent不伪称steered。任务投递followup/权限/容量/同步及结账优先均不变，不混其他跟进。

新增归档行withdrawalResult观察值removed / claimed-steered / withdraw-failed-steered / no-agent，随原子账本持久/重启恢复，在state、a2a_tasks文本与结构化结果、CLI tasks及JSON显示。结果只记录实际动作，不改变已取消终态/守恒。结果提交失败沿原failclosed诊断回滚该次结果，不把已取消债复活。

真实mesh覆盖缺updateQueue、非not-found错误均发带来源通知且队中原消息仍可见、caller已归档；四结果各自断言，并验证工具/CLI文本与JSON。新增5个单测核四值重启保留及结果写失败不虚报。去catch反向突变使上述两错误mesh行为断言变红，finally恢复。最后完整默认pnpm verify job bash-41429932ea5143aa真实exit0：root1584passed/8skip（已有7+显式host专项opt-in1），layout4/nexus332/innerentries0。架构按原基线刷新源码锚，无图形渲染/视觉结论；公开文档无环境值或网络定位信息。

新精确头交非作者确认、全局核tree差异后由授权评审链处理合并；本席不部署、不补积压。

## 待评审与发布边界

本PR改变投递外部语义，候选发布需minor；此处只写release说明，不tag/publish/部署/改生产presence。非作者精确head复跑行为/四突变与新增wake观察门，PASS后仍先冻结由监督报全局，回复后match-head合并。#358②ledgerPersistence进status/#355告警与③回滚附带状态清单另待，不因本PR新增consumed或mapping就关整358。生产现有积压不操作、不自动补回执。
