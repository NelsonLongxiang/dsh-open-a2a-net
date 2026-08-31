/** Locale dictionaries for the A2A network sidebar control (namespace `a2aNet`). */

/** Dictionary keys owned by the `a2aNet` namespace. */
export type A2aNetKey =
  | 'a2a.label'
  | 'a2a.title'
  | 'a2a.empty'
  | 'a2a.join'
  | 'a2a.leave'
  | 'a2a.cold'
  | 'a2a.wake'
  | 'a2a.note'
  | 'a2a.remote'
  | 'a2a.remoteUnknownOrigin'
  | 'a2a.peers'
  | 'a2a.peersEmpty'
  | 'a2a.activity'
  | 'a2a.activityEmpty'
  | 'a2a.inFlight'
  | 'a2a.inFlightStale'
  | 'a2a.tasks'
  | 'a2a.tasksNote'
  | 'a2a.jump'
  | 'a2a.search'
  | 'a2a.searchEmpty'
  | 'a2a.group'
  | 'a2a.groupDefault'
  | 'a2a.groupClear'
  | 'a2a.groupNew'
  | 'a2a.groupNewGo'
  | 'a2a.canvasTitle'
  | 'a2a.canvasEmpty'
  | 'a2a.canvasNew'
  | 'a2a.canvasNewGo'
  | 'a2a.canvasAdd'
  | 'a2a.canvasRemove'
  | 'a2a.canvasDelete'
  | 'a2a.stageTitle'
  | 'a2a.stageScene'
  | 'a2a.stagePlan'

/** Simplified Chinese dictionary. */
export const zh: Record<A2aNetKey, string> = {
  'a2a.label': 'A2A 网络',
  'a2a.title': 'A2A 网络面板',
  'a2a.empty': '没有可加入的会话',
  'a2a.join': '加入',
  'a2a.leave': '退出',
  'a2a.cold': '未加载（重启后待唤醒）',
  'a2a.wake': '唤醒',
  'a2a.note': '只有加入的会话才会被网络中的其他节点发现；点击会话行可跳转。',
  'a2a.remote': '远程节点（按 host 分组）',
  'a2a.remoteUnknownOrigin': '未知来源',
  'a2a.peers': '对等节点',
  'a2a.peersEmpty': '尚无已知对等节点（配 peers 种子入网）',
  'a2a.activity': '路由活动',
  'a2a.activityEmpty': '暂无路由记录',
  'a2a.inFlight': '进行中的路由',
  'a2a.inFlightStale': '等待回执超时（对端处理慢或回执丢失）；180 秒后自动解除并按已送达处理',
  'a2a.tasks': '欠回执的异步任务',
  'a2a.tasksNote': '异步欠账分三段：未决（等回执）→ 死信（超期自动标注，目标恢复后仍可补回执结算）→ 归档（结算留痕不蒸发）',
  'a2a.jump': '点击跳转到该会话',
  'a2a.search': '搜索会话（名称 / team / 摘要）',
  'a2a.searchEmpty': '没有匹配的会话',
  'a2a.group': '设置分组',
  'a2a.groupDefault': '未分组',
  'a2a.groupClear': '清除分组',
  'a2a.groupNew': '新建分组…',
  'a2a.groupNewGo': '创建并归入',
  'a2a.canvasTitle': '画布队伍（任意组队）',
  'a2a.canvasEmpty': '尚无画布队伍——上方输入名字创建',
  'a2a.canvasNew': '新队伍名',
  'a2a.canvasNewGo': '建队',
  'a2a.canvasAdd': '+ 添加成员',
  'a2a.canvasRemove': '移出该队伍',
  'a2a.canvasDelete': '解散',
  'a2a.stageTitle': '舞台视图',
  'a2a.stageScene': '观测 · 3D',
  'a2a.stagePlan': '规划 · 2D',
}

/** English dictionary. */
export const en: Record<A2aNetKey, string> = {
  'a2a.label': 'A2A network',
  'a2a.title': 'A2A network panel',
  'a2a.empty': 'No joinable sessions',
  'a2a.join': 'Join',
  'a2a.leave': 'Leave',
  'a2a.cold': 'not loaded (waiting to wake after a restart)',
  'a2a.wake': 'Wake',
  'a2a.note': 'Only joined sessions are discoverable by other nodes; click a row to open the session.',
  'a2a.remote': 'Remote teams (by host)',
  'a2a.remoteUnknownOrigin': 'Unknown origin',
  'a2a.peers': 'Peers',
  'a2a.peersEmpty': 'No known peers yet (set peers seeds to join the mesh)',
  'a2a.activity': 'Routing activity',
  'a2a.activityEmpty': 'No routes yet',
  'a2a.inFlight': 'Routes in flight',
  'a2a.inFlightStale': 'Reply wait past 120s (slow or lost receipt); auto-releases as delivered at 180s',
  'a2a.tasks': 'Owed receipts',
  'a2a.tasksNote': 'Async debts in three tiers: pending (awaiting receipt) → dead-lettered (auto-flagged past the stale TTL; a revived target can still settle late) → archived (settled records kept for audit)',
  'a2a.jump': 'Click to open this session',
  'a2a.search': 'Search sessions (name / team / excerpt)',
  'a2a.searchEmpty': 'No sessions match',
  'a2a.group': 'Set group',
  'a2a.groupDefault': 'Ungrouped',
  'a2a.groupClear': 'Clear group',
  'a2a.groupNew': 'New group…',
  'a2a.groupNewGo': 'Create & assign',
  'a2a.canvasTitle': 'Canvas teams (arbitrary grouping)',
  'a2a.canvasEmpty': 'No canvas teams yet — name one above and create it',
  'a2a.canvasNew': 'New team name',
  'a2a.canvasNewGo': 'Create',
  'a2a.canvasAdd': '+ Add member',
  'a2a.canvasRemove': 'Remove from this team',
  'a2a.canvasDelete': 'Delete',
  'a2a.stageTitle': 'Stage views',
  'a2a.stageScene': 'Observe · 3D',
  'a2a.stagePlan': 'Plan · 2D',
}
