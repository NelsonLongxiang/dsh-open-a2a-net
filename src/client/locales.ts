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

/** Simplified Chinese dictionary. */
export const zh: Record<A2aNetKey, string> = {
  'a2a.label': 'A2A 网络',
  'a2a.title': '加入 A2A 网络',
  'a2a.empty': '没有可加入的会话',
  'a2a.join': '加入',
  'a2a.leave': '退出',
  'a2a.cold': '未加载（重启后待唤醒）',
  'a2a.wake': '唤醒',
  'a2a.note': '只有加入的会话才会被网络中的其他节点发现。',
}

/** English dictionary. */
export const en: Record<A2aNetKey, string> = {
  'a2a.label': 'A2A network',
  'a2a.title': 'Join the A2A network',
  'a2a.empty': 'No joinable sessions',
  'a2a.join': 'Join',
  'a2a.leave': 'Leave',
  'a2a.cold': 'not loaded (waiting to wake after a restart)',
  'a2a.wake': 'Wake',
  'a2a.note': 'Only joined sessions are discoverable by other nodes.',
}
