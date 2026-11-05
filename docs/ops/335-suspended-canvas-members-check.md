# #335 先行实现：证明删除 + 持久暂停

基线master5c93230，按已确认设计#337。中高档，须原评审非自我复核；未合并发布部署。#334来源确认界面、qualified新写/远端路由仍未实现。

## review-338-r1 修订记录

原FAIL@5ed6b3a保留。B1：pruneCanvasMemberships每个remove包try/log/continue，启动和state复用同处理；锁冲突/盘CAS不再拖垮插件，state保留lastWriteError及锁owner信息，不偷锁。真实启动“残锁+stale local id”与运行期外改+stale观察反例均返回state200、磁盘字节不变。临时去掉catch，启动例立即FAIL；已恢复。

B2：v2不走旧格式的过滤/截断宽容路径。teams必须数组且受cap；任一队名/成员类型、重复、超限、坏CLI附表或孤悬暂停记录都readonly失败关闭，不把数据裁掉后成功重写。对象teams、含斜杠队名、坏members、重复队/成员、队数/成员数超限7例逐个检查state错误、写入抛错和磁盘不变。去掉strict块，teams-object例立即FAIL；已恢复。

N1：快照及.pre-v2备份均同目录临时件写→可写fd fsync→rename，POSIX再fsync目录；Windows目录fsync明确跳过（state.directoryFsync报告file fsync+rename only），不声称Windows断电目录落盘保障。目录fsync在rename后失败时保持readonly，避免内存回滚数据继续作为活动状态。已有备份若不等于迁移前原文，拒迁移/提示检查，不忽略可能截断的旧备份；不覆盖现场证据。

N2：锁目录写owner.json的pid/host/at；state.lock报路径/owner或metadata不可读原因，错误包含锁持有信息。残锁不自动接管。N3：release说明补#334之前对端裸handle删除按完整id存的成员会ok:false，需要属主本机明确删除。

修订针对性unit16+mesh12全过；默认完整pnpm verify真实exit0：root1485passed/6原skip，layout4，nexus327。图锚按原评审SHA重锚10项，无miss；source/types/docs/dist同链。#339 PR340独立冻结407f458，未合入本PR。

## 数据与失败边界

CanvasStore将有效membersOf/remoteMembersOf/teamsOf统一过滤suspended（窗口关时再过滤legacy bare）；rawMembersOf仅供检查/生命周期，不提供授权。state.canvas.teams仍是有效成员，暂停/窗口关闭留存位在retainedMembers单列，避免工作台旧计数/board把暂停位计有效。CLI pin体系不改。

canvas.json写formatVersion2/revision/suspendedMembers；旧格式仅首次变更时备份.pre-v2，不在load自动写。写流程：独占.lock目录（不偷锁）→盘字节CAS→同目录wx临时件→fsync可写fd→rename。失败回滚内存至已提交状态并向调用方报错；写失败不再静默退内存成功。已失效lock需操作者确认没有writer后处理，不能agent自动抢锁。更高格式/损坏v2失败关闭，不覆写。

暂停记录按team/member/reason/localSessionId保存at/token，重复撤销同原因幂等，多原因恢复必须提供完整记录。owner restore-suspended/delete-suspended使用精确revision/member/expected CAS，控制面key门不变。普通remove/drop/整队删除不能绕暂停CAS，peer remove+readd不能复活；重复add不清暂停。暂停写失败时canvas有效读取在本进程整体失败关闭；leave返回503且join不删，archive不继续删mount/roster或报成功。修盘后重启再检查，不承诺跨所有store单一ACID事务：关键顺序是canvas先持久撤权，后join/agent/roster变化，崩在后半只可能保守暂停，不能重新授权。

## 生命周期与证明

leave/archive/local-id remove只精确删本机id，以及同本机指纹且本机id8唯一的qualified形状；若存在owner全key记录须与本机key一致。裸handle仅以旧resolver判断是否应保守暂停，绝不作为删除证明；archive推断包含正归档id。来自其他key的qualified成员/来源未知bare保留原槽位和优先级。

原peer canvas-op曾将裸handle推断成local id并连带删除，现只按精确bare槽位；只有已有明确本机owner后缀才考虑local-id映射（本PR不新增qualified routing，通常保持原qualified串）。原#131 peer-by-bare删除local-id断言按新安全语义调整：不能凭缓存缺行删另一个槽位；bare精确删除原功能保留。

## 兼容与可观测性

canvasLegacyBareMembers默认true；未暂停bare旧推断保留，window false时有效视图排bare。无自动关窗，不自行翻默认。五项state数据：legacyBareMembers、legacyInferredMembers、legacyInferenceResolutions、legacyCollisionWarnings、suspendedMembersCount，加epoch和有界碰撞recent。state/publish/list读取不累计业务次数，实际local canvas route/cold资格解析计数；qualified来源选择不在本PR做。重启次数重置但epoch更新，裸/暂停存量从盘恢复，不能据重启0宣称迁移完成。

工作台检查器保留有效成员数，另列“已暂停·不参与路由”及owner显式恢复/删除按钮；不提供#334来源确认UI。有效legacy成员附unknown/兼容推断标志，暂停永不显示有效live绿灯。编译产物已同步，不替换生产3080。

## 工程证据（不是RC spec-run发布结论）

- 新unit7例：有效过滤/重启/重复add/CAS/多个暂停记录/锁冲突/盘外改/真实write失败/更高及坏v2/旧备份。真实mesh10例：leave/local remove/archive、restart/rejoin、owner恢复/删除、控制key拒绝、冷单边seed同id8/外机fp保留、窗口关、解析碰撞统计、cardOrg/whoami/count、foreign成员文件grant拒绝。
- DOM新增1例：暂停不计有效成员，显式操作携带当前revision与完整records，CAS错误留可重试反馈；原327项Nexus全部通过。
- 回退membersOf暂停过滤一次：新增unit立即FAIL，恢复后绿，无探针残留。
- 默认完整pnpm verify最终真实exit0：root1474passed/6原skip，layout4，nexus327，tracked dist重建零差异。19个源码图锚重锚无miss；types/docs/diffcheck同链。
- 调查中的初次root红仅未同步config/docs/图锚及旧peer推断删除断言；已逐项修。一次完整门禁末尾因新dist未入index作基线报差异（测试本身全绿），精确暂存新dist后全链exit0。Windows fsync需r+ fd，读fd EPERM已实测修正，未吞错误。

文件权限边界：原协议允许签名host拉自己canvas的host-wide grant，与本机某槽位是否暂停无关，未擅改。依赖本机canvas具体foreign成员的grant现在通过有效membersOf过滤，已真实HTTP确认暂停后not-granted。旧债/已冻结receiver快照不重写，不把暂停追溯改成历史消息不存在。

剩余：#334确认/qualified写入与路由、全舰队迁移关窗、发布与生产部署另排；仅本PR工程测试通过不代表独立评审已通过。
