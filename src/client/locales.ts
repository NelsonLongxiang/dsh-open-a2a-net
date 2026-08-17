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
  | 'a2a.peers'
  | 'a2a.peersEmpty'
  | 'a2a.activity'
  | 'a2a.activityEmpty'

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
  'a2a.peers': '对等节点',
  'a2a.peersEmpty': '尚无已知对等节点（配 peers 种子入网）',
  'a2a.activity': '路由活动',
  'a2a.activityEmpty': '暂无路由记录',
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
  'a2a.peers': 'Peers',
  'a2a.peersEmpty': 'No known peers yet (set peers seeds to join the mesh)',
  'a2a.activity': 'Routing activity',
  'a2a.activityEmpty': 'No routes yet',
}
