# #356 sourced agent.followup 实施交付（高档，待精确头复核）

Refs #356；派单direct-795e9280a9d0、补充direct-8604a94f8790/direct-702292f00d4c。基线master104196987acace8f3cd28637c4c9dba79f3f2387（已合351/354/359/361），独立feat/356-sourced-followup-delivery；与351实施分支没有并行写同文件。本PR高档，非作者PASS后先冻结、监督报全局获回复后才match-head合并。**不部署、不补积压、不发生产回执，不关358②③，不碰343或deepseek-harness源码。**

## 版本矩阵与能力边界

| 运行面 | 观察版本/事实 | 本轮证据/限制 |
|---|---|---|
| 插件安装依赖 dsh-agent | 0.1.7-rc.2，公开types有followup、inbox与claimed事件 | 插件mesh注册/工具/HTTP测试使用此依赖族；fake Agent明确脚本消费，不冒称真实FIFO |
| 本机宿主checkout | fcc0ad4621，dsh-agent/agent-loop/session 0.2.2-rc.1 | 原始源码/类型只读核查；实际既有lib由plugin自有子进程加载，未构建/改源码或git文件 |
| 真实loop行为 | 0.2.2-rc.1 coherent host lib族 | 插件实际FollowupDelivery+TaskLedger在隔离temp运行；真实maintenance锁存/FIFO/三任务三轮、idle唤醒、JSONL持久cold create→dispose→resume消费、source保留 |
| 旧/自定义Agent缺followup | 不按版本猜能力，实际typeof检测 | 显式拒绝，不调用steer，不产生伪accepted；已有债保持。没有承诺所有更早版本都可用 |
| 缺controller.updateQueue | 可接followup但不能确认pending撤回 | 明确撤单失败，保原caller债；不无条件steer假装移除了排队消息。claimed且live仍steer |
| 对端旧卡缺queuedTaskCancellation | 不发送新cancel_task_id控制请求 | 可见失败不自清caller账，不把旧peer忽略字段/普通task delivered当成功撤回 |

新增source字段taskId/localSender先正式扩MessageSourceMap，与既有a2a-relay/ContextFormed/senderSessionId/nodeReminder兼容，source对象显式UserMessage[source]声明、**没有as强转**，不伪人类principal/rpcId/timezone。直接Agent路径少controller网关/attachments校验，前置A2A原OriginClaim/成员scope/taint/receipt授权/queuecap都保留；只投纯A2A文本，冷Agent先原wakeColdTeam/materialize。

## 持久对应、投递与撤单

TaskLedger.snapshot附taskDeliveries表，不增加业务任务status。每task记录唯一MessageId、完整SessionId、原text/sender/cleanlocal指纹、verified callerKey（跨机）与投递观察reserved/enqueued/claimed/cancelled。**先354原子提交reserve，再agent.followup**；写失败不送。task由原caller键与原投递身份约束，不能缓存变更后改目标重投。claimed事件与consumed=true同次原子提交，错误catch只警告+ledger安全诊断，不让宿主崩溃。

已接纳最后状态落盘失败保reserved/unknown并warn，不返回虚构未投递去引导重派；restart遇reserved不盲重投。对应表容量512，保现pending或24h以内发生记录，满时拒新无对应投递，不静默evict有效窗口；不是无限历史去重保证。坏shape/重复task/message映射failclosed、corruption标记随后续成功快照保留，不能二次启动洗掉。

所有普通任务路径（wire async/sync、本机async/sync、冷resolve后）调用独立FollowupDelivery。任务与receipt消息都保已声明A2A source，真正停工控制单独steer。#351提醒和本机sender notice依赖名改followup，两者都走同一带source入口；reminder仍仅真idle发/原退避、原reserve与无债义务保持。旧lastResult blocked已从联合类型/parse可写枚举去掉；旧磁盘值parse失败沿已合R-STOP metadata-reset第3次/2h恢复，既有2真HTTP+unit覆盖。

撤单：保原task授权，先根据持久MessageId调用controller.updateQueue remove（cold可由controller解析原完整session）。若仍pending则移除后按原cancel结账，不steer；queue-item-not-found竞态才转claimed，原target即时steer停工，不再followup排队等工作做完。其他错误、持久失败不伪成功。已claim目标用原完整session映射，不根据当前canvas换人。

跨机cancel_task_id属于body-bound小控制字段，仍走原验签/admission，要求原inbound caller、claim origin/caller及完整callerKey一致；错误caller403，无新普通任务或receipt debt。peer卡声明queuedTaskCancellation才发；不支持则可见拒绝。HTTP本机控制撤单和native bridge都先确认queued撤回/claimed通知再结账，guard外async callback都有catch。遗留无MessageId任务按原legacy stopnotice，本PR不逆造映射。旧#357 owner阶梯语义不在本PR修。

消费：wire答复consumed读精确delivery claimed，而非仅running。inbound保存最初probe，随后claim更新；outbound保存所选peer答复snapshot，后来receiver变true不凭空更新sender（没有新增遥测推送）。tasks/state/CLI输出consumed与deliveryObservation=consumed/delivered-unconsumed，旧peer缺字段为unknown。此为观察不是确认/完成，不释放cap，不markAnswered。同步pre-enqueue floor仍任务独立，#114S5/#305/#306同消费轮约束不放宽；15秒/-32005原预算保留。

## 测试与突变（工程证据，不冒称CLI业务spec run）

新unit12：提交前对应、精确source、无steer、reentrant claim不倒退、坏盘不送、reserved restart不盲重发、MessageId精确remove、claim竞态/其他错误、cold撤回、坏map二次重启仍拒、claim+consumed一起回滚、双端probe restart保留。真HTTPmesh13：sourced任务followup、缺能力拒、3cap、pending与claim/race撤单、真实signed跨host caller错拒/正确remove或steer、idle/coldresolve claimed、双host consumed false快照与receiver后续true、真实CLI tasks/json未消费展示、reminder/notify二者无steer。

real-loop独立子进程1用例加载**实际插件dispatcher**和已有hostlib：maintenance期间requests0且inbox次序与持久MessageId相等；释放后3请求/3turn每轮1任务、来源a2a-relay；移除未claim维护wake后无第4请求；真idle新任务第4、JSONL持久coldresume第5，都claimed。只读加载hostlib，不运行/修改宿主仓测试或产物，临时所有文件在pluginowned temp。Node实验transformtypes用于子进程加载实际TS参数属性，原strip-only曾报错如实修正；coldfixture初期API/fork/sessionId/flush设置错误不是验收PASS，最终真实persist+resume过。

四mandatory反向突变均行为红并finally恢复：source改user→payload断言红；任务followup改steer→steer调用红；已claim取消改followup→本地2例及signedremote例红；缺followup回退steer→不该delivered却delivered红。补充：去wake(send next-turn false)实际宿主requests0!=3红；去unconsumed状态标记真双host断言红；去reserve前写盘已有unit会显示无disk/no-send约束失败。没有拿parse/hash失配冒充行为判别。

旧fixture迁移：初期32文件100例红，多为手工Agent只提供steer、次轮时序令原“最后一条”不再是目标header、原pending fixture太快自动结账。显式在这些fake构造器补脚本followup或将债务观察case目标silent，保原team/auth/cap/settlement/assert不skip不放预算。harness followup在微任务执行旧消费脚本，注明**不是FIFO/maintenance证据**。真实loop测试单独负责队列语义。consumed旧running happy断言改为实际claimed事件，新增旧running无claim仍false。格式整行state仅增加本PR规定的观察字段；claim与commit错误测试调整注入序号，不删除错误断言。

最后完整默认pnpmverify job bash-c9ca25a565654647真实exit0：root1575passed/7skip（原6+已合POSIX权限平台1），layout4/nexus332/innerentries0，trackedbuild零diff，stricttool schema与全部S5/305/306回归过。此前core完成时也有1569/1574两完整绿；未增加skip/改worker/timeout。架构按1041969重锚无miss，未视觉渲染；planning-view1499不变。scripts/verify-*、verify/、AGENTS及#343冻结工作未改。

## 待评审与发布边界

本PR改变投递外部语义，候选发布需minor；此处只写release说明，不tag/publish/部署/改生产presence。非作者精确head复跑行为/四突变与新增wake观察门，PASS后仍先冻结由监督报全局，回复后match-head合并。#358②ledgerPersistence进status/#355告警与③回滚附带状态清单另待，不因本PR新增consumed或mapping就关整358。生产现有积压不操作、不自动补回执。
