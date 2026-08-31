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
  | 'a2a.jump'
  | 'a2a.stageTitle'
  | 'a2a.stageScene'
  | 'a2a.stagePlan'

/** Simplified Chinese dictionary. */
export const zh: Record<A2aNetKey, string> = {
  'a2a.label': 'A2A 网络',
  'a2a.title': 'A2A 网络动态',
  'a2a.activity': '最近动态',
  'a2a.activityEmpty': '暂无网络动态——到规划视图组队入网即可开始协作',
  'a2a.inFlight': '进行中的路由',
  'a2a.inFlightStale': '等待回执超时（对端处理慢或回执丢失）；180 秒后自动解除并按已送达处理',
  'a2a.tasks': '欠回执的异步任务',
  'a2a.tasksNote': '异步欠账分三段：未决（等回执）→ 死信（超期自动标注，目标恢复后仍可补回执结算）→ 归档（结算留痕不蒸发）',
  'a2a.jump': '点击跳转到该会话',
  'a2a.stageTitle': '舞台视图（会话与团队管理已迁入规划视图）',
  'a2a.stageScene': '观测 · 3D',
  'a2a.stagePlan': '规划 · 2D',
}

/** English dictionary. */
export const en: Record<A2aNetKey, string> = {
  'a2a.label': 'A2A network',
  'a2a.title': 'A2A network activity',
  'a2a.activity': 'Recent activity',
  'a2a.activityEmpty': 'No network activity yet — join sessions to the network in the planning view to start collaborating',
  'a2a.inFlight': 'Routes in flight',
  'a2a.inFlightStale': 'Reply wait past 120s (slow or lost receipt); auto-releases as delivered at 180s',
  'a2a.tasks': 'Owed receipts',
  'a2a.tasksNote': 'Async debts in three tiers: pending (awaiting receipt) → dead-lettered (auto-flagged past the stale TTL; a revived target can still settle late) → archived (settled records kept for audit)',
  'a2a.jump': 'Click to open this session',
  'a2a.stageTitle': 'Stage views (session & team management moved to the planning view)',
  'a2a.stageScene': 'Observe · 3D',
  'a2a.stagePlan': 'Plan · 2D',
}
