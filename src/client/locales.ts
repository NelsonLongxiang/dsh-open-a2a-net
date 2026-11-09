/** Locale dictionaries for the A2A network sidebar control (namespace `a2aNet`). */

/** Dictionary keys owned by the `a2aNet` namespace. */
export type A2aNetKey =
  | 'a2a.label'
  | 'a2a.title'
  | 'a2a.activity'
  | 'a2a.activityEmpty'
  | 'a2a.inFlight'
  | 'a2a.inFlightStale'
  | 'a2a.tasks'
  | 'a2a.tasksNote'
  | 'a2a.tasksStale'
  | 'a2a.jump'
  | 'a2a.stageTitle'
  | 'a2a.stageWorkbench'
  | 'team.addFiles'
  | 'team.removeFile'
  | 'team.fileTooBig'
  | 'team.tooManyFiles'
  | 'team.dropHint'
  | 'team.noFolders'
  | 'team.sentRemote'
  | 'team.remoteHint'
  | 'team.tab'
  | 'team.guide'
  | 'team.pick'
  | 'team.request'
  | 'team.placeholder'
  | 'team.send'
  | 'team.sending'
  | 'team.sent'
  | 'team.failed'
  | 'team.none'
  | 'team.denied'
  | 'team.unreadable'
  | 'team.loading'
  | 'team.open'

/** Simplified Chinese dictionary. */
export const zh: Record<A2aNetKey, string> = {
  'team.addFiles': '添加文件',
  'team.removeFile': '移除 {name}',
  'team.fileTooBig': '{name} 超过 64 MB，发不了',
  'team.tooManyFiles': '一次最多 {max} 个文件',
  'team.dropHint': '也可以把多个文件一起拖到这里',
  'team.noFolders': '不能拖入文件夹，请选择里面的文件',
  'team.sentRemote': '已发给 {team}，由对方团队按自己的规则决定。发送者是 {sender}，回执会回到这个会话',
  'team.remoteHint': '这支团队在其他实例上：这条消息算当前会话发的，不算你本人。对方要把这个会话列入名单，并开 auto 和对应规则，才会开单。',
  'team.tab': '提需求',
  'team.guide': '把需求交给 superagent 团队，不用离开当前对话',
  'team.pick': '团队',
  'team.request': '需求',
  'team.placeholder': '写清要做什么、为什么。Ctrl/⌘ + Enter 发送',
  'team.send': '提交',
  'team.sending': '提交中…',
  'team.sent': '已提交给 {team}，等总工决定',
  'team.failed': '没有提交成功：{reason}',
  'team.none': '这台 DSH 还没有能接需求的团队。先在 A2A 工作台建队，绑定总工。',
  'team.denied': '这台 DSH 设了控制密钥，这个页面没有权限读取团队。请到 A2A 工作台的「团队」页提交。',
  'team.unreadable': '暂时读不到团队，稍后再打开试试。',
  'team.loading': '正在读取团队…',
  'team.open': '打开团队页',
  'a2a.label': 'A2A 网络',
  'a2a.title': 'A2A 网络动态',
  'a2a.activity': '最近动态',
  'a2a.activityEmpty': '暂无网络动态——加入网络即可开始协作',
  'a2a.inFlight': '进行中的路由',
  'a2a.inFlightStale': '等待回执超时（对端处理慢或回执丢失）；180 秒后自动解除并按已送达处理',
  'a2a.tasks': '欠回执的异步任务',
  'a2a.tasksNote': '异步欠账分三段：未决（等回执）→ 死信（超期自动标注，目标恢复后仍可补回执结算）→ 归档（结算留痕不蒸发）',
  'a2a.tasksStale': '对话式已送达未答（非欠账，24h 自动死信）',
  'a2a.jump': '点击跳转到该会话',
  'a2a.stageTitle': 'A2A 工作台（目录 · 台账 · 活动 · 规划）',
  'a2a.stageWorkbench': '打开工作台',
}

/** English dictionary. */
export const en: Record<A2aNetKey, string> = {
  'team.addFiles': 'Add files',
  'team.removeFile': 'Remove {name}',
  'team.fileTooBig': '{name} is over 64 MB and cannot be sent',
  'team.tooManyFiles': 'At most {max} files at a time',
  'team.dropHint': 'Or drag several files here at once',
  'team.noFolders': 'Folders cannot be added. Choose the files inside',
  'team.sentRemote': 'Sent to {team}, whose own rules decide. The sender is {sender}; the receipt comes back to this session',
  'team.remoteHint': 'This team is on another instance. The message counts as this session\'s, not yours. That team opens a ticket only if it lists this session and runs auto with a matching rule.',
  'team.tab': 'Request',
  'team.guide': 'Send a superagent team a request without leaving this conversation',
  'team.pick': 'Team',
  'team.request': 'Request',
  'team.placeholder': 'What needs doing, and why. Ctrl/⌘ + Enter to send',
  'team.send': 'Send',
  'team.sending': 'Sending…',
  'team.sent': 'Sent to {team}. Waiting for the router to decide',
  'team.failed': 'Not sent: {reason}',
  'team.none': 'This DSH has no team that can take a request yet. Compose one in the A2A workbench and bind its router.',
  'team.denied': 'This DSH has a control key, and this page cannot read its teams. Send the request from the Team page of the A2A workbench.',
  'team.unreadable': 'The team cannot be read right now. Try opening this again later.',
  'team.loading': 'Reading the teams…',
  'team.open': 'Open the team page',
  'a2a.label': 'A2A network',
  'a2a.title': 'A2A network activity',
  'a2a.activity': 'Recent activity',
  'a2a.activityEmpty': 'No network activity yet — join sessions to the network to start collaborating',
  'a2a.inFlight': 'Routes in flight',
  'a2a.inFlightStale': 'Reply wait past 120s (slow or lost receipt); auto-releases as delivered at 180s',
  'a2a.tasks': 'Owed receipts',
  'a2a.tasksNote': 'Async debts in three tiers: pending (awaiting receipt) → dead-lettered (auto-flagged past the stale TTL; a revived target can still settle late) → archived (settled records kept for audit)',
  'a2a.tasksStale': 'Delivered conversationally, no formal receipt (not debt; auto-dead-letters at the TTL)',
  'a2a.jump': 'Click to open this session',
  'a2a.stageTitle': 'A2A workbench (directory · ledger · activity · plan)',
  'a2a.stageWorkbench': 'Open workbench',
}
