/**
 * The 目录 tab (2026-10-23 rewrite): unified search + category chips over
 * four groups — 本机会话 (live first, then cold), 画布队, 远端节点, 本机日志.
 * Peer hosts moved to the 主机 tab (the directory listed them twice).
 *
 * 本机日志 rows used to read `…arket-review · 48 KB`: the id's last 12
 * characters and a size. They now group by day (今天 / 昨天 / 更早), carry a
 * relative time, and show a learned title — the first user line of the
 * transcript, captured when the log is opened in the chat drawer (the list
 * face itself returns only id / mtime / size). When the host caps the list,
 * the group says how many it is showing out of how many.
 * Rows are attacker-shaped data: textContent only.
 * @module nexus-stage/wb-directory
 */
import type { CanvasTeamRow, StateBody } from './workbench'
import type { ChatTarget } from './wb-chat'
import { displayName } from './stage-name'

export type DirFilter = 'all' | 'local' | 'canvas' | 'remote' | 'logs'

export const DIRECTORY_FILTERS: ReadonlyArray<{ key: DirFilter; label: string; hint: string }> = [
  { key: 'all', label: '全部', hint: '不过滤：目录全部条目' },
  { key: 'local', label: '本机', hint: '本机会话节点（现场 + 冷启动）' },
  { key: 'canvas', label: '队', hint: '画布队（人类手工分配的组队）' },
  { key: 'remote', label: '远端', hint: '远端会话队（来自对端卡片）' },
  { key: 'logs', label: '日志', hint: '本机日志：不在网络目录里的会话档案' },
]

export interface LogRow { readonly id: string; readonly mtimeMs: number; readonly sizeBytes: number }

export interface DirectoryContext {
  readonly state: StateBody
  readonly logs: ReadonlyArray<LogRow>
  /** How many logs the host holds (the list face is capped); undefined when unknown. */
  readonly logTotal?: number
  /** Learned log titles by session id. */
  readonly titles: ReadonlyMap<string, string>
  /** Lowercased search text ('' = none). */
  readonly search: string
  readonly filter: DirFilter
  readonly now: number
  openChat(target: ChatTarget): void
  selectCanvas(row: CanvasTeamRow): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  return node
}

/** Lowercased haystack for the unified search. */
function haystack(...parts: ReadonlyArray<string | readonly string[] | undefined>): string {
  const flat: string[] = []
  for (const p of parts) {
    if (p === undefined) continue
    if (typeof p === 'string') flat.push(p)
    else flat.push(...p)
  }
  return flat.join(' ').toLowerCase()
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

function fmtSize(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1_000 ? `${Math.round(n / 1_000)} KB` : `${n} B`
}

/** Local-calendar day bucket relative to `now`. */
function dayBucket(ms: number, now: number): '今天' | '昨天' | '更早' {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const t0 = startOfToday.getTime()
  if (ms >= t0) return '今天'
  if (ms >= t0 - 86_400_000) return '昨天'
  return '更早'
}

/** Render the directory into `box`; returns the tab badge text. */
export function renderDirectory(box: HTMLElement, ctx: DirectoryContext): string {
  box.replaceChildren()
  const { state, search, filter } = ctx
  const filtering = search !== '' || filter !== 'all'
  const admit = (cat: DirFilter, hay: string): boolean => (filter === 'all' || filter === cat) && (search === '' || hay.includes(search))

  const group = (label: string, count: number, extra?: string): HTMLElement => {
    const g = el('div', 'wb-dir-group')
    const head = el('div', 'wb-dir-head')
    head.appendChild(el('span', 'wb-dir-head-label')).textContent = `${label} · ${count}`
    if (extra !== undefined) head.appendChild(el('span', 'wb-dir-head-note')).textContent = extra
    g.appendChild(head)
    box.appendChild(g)
    return g
  }
  const row = (parent: HTMLElement, dotClass: string, glyph: string, label: string, sub: string, onClick: () => void, tip?: string): HTMLButtonElement => {
    const item = el('button', 'wb-item')
    item.type = 'button'
    item.appendChild(el('span', `wb-dot ${dotClass}`)).textContent = glyph
    const text = el('span', 'wb-item-text')
    text.appendChild(el('span', 'wb-item-label')).textContent = label
    if (sub !== '') text.appendChild(el('span', 'wb-item-sub')).textContent = sub
    item.appendChild(text)
    if (tip !== undefined) item.title = tip
    item.addEventListener('click', onClick)
    parent.appendChild(item)
    return item
  }
  const badges = (item: HTMLElement, teams: readonly string[] | undefined): void => {
    if (teams === undefined || teams.length === 0) return
    const chip = el('span', 'wb-item-badge')
    const names = teams.map(t => t.slice(t.lastIndexOf('/') + 1))
    chip.textContent = `▤ ${names.slice(0, 2).join(' ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`
    chip.title = `画布队：${teams.join(' · ')}`
    item.appendChild(chip)
  }

  // ── 本机会话: live first, then cold ──
  const sessions = (state.sessions ?? []).filter(s => admit('local', haystack(displayName(s), s.team, s.label, s.id, s.canvasTeams)))
  const live = sessions.filter(s => s.live === true)
  const cold = sessions.filter(s => s.live !== true)
  if (sessions.length > 0) {
    const g = group('本机会话', sessions.length, cold.length > 0 ? `${live.length} 在线 · ${cold.length} 冷` : undefined)
    for (const s of [...live, ...cold]) {
      const isLive = s.live === true
      const item = row(g, isLive ? 'wb-dot-live' : 'wb-dot-cold', isLive ? '●' : '○', displayName(s), isLive ? s.team : `冷 · ${s.team}`,
        () => ctx.openChat({ kind: 'session', id: s.id, title: displayName(s), sub: s.team, team: s.team, live: s.live }), s.id)
      badges(item, s.canvasTeams)
    }
  }

  // ── 画布队 ──
  const canvases = (state.canvas?.teams ?? []).filter(t => admit('canvas', haystack(t.name, t.team, t.members.map(m => m.team ?? m.id))))
  if (canvases.length > 0) {
    const g = group('画布队', canvases.length)
    for (const t of canvases) {
      const remote = t.members.filter(m => m.remote === true).length
      row(g, 'wb-dot-canvas', '▤', t.name, `${t.members.length} 成员${remote > 0 ? ` · ${remote} 远端` : ''}`, () => ctx.selectCanvas(t), t.team)
    }
  }

  // ── 远端节点 ──
  const remote = (state.remote ?? []).filter(r => admit('remote', haystack(displayName(r), r.team, r.origin, r.workspace, r.canvasTeams)))
  if (remote.length > 0) {
    const g = group('远端节点', remote.length)
    for (const r of remote) {
      const item = row(g, 'wb-dot-remote', '◇', displayName(r), r.origin !== undefined && r.origin !== '' ? r.origin : r.team,
        () => ctx.openChat({ kind: 'remote', team: r.team, title: displayName(r), sub: r.team, row: r }), r.team)
      badges(item, r.canvasTeams)
    }
  }

  // ── 本机日志: every local log artifact not already shown as a network row ──
  // (0.6.12 reachability: reading is host-scoped, the network directory is
  // not the reading gate), newest first, grouped by day.
  const networkIds = new Set((state.sessions ?? []).map(s => s.id))
  const logs = ctx.logs.filter(l => !networkIds.has(l.id) && admit('logs', haystack(l.id, ctx.titles.get(l.id))))
  if (logs.length > 0) {
    const capped = ctx.logTotal !== undefined && ctx.logTotal > ctx.logs.length
    const g = group('本机日志', logs.length, capped ? `显示 ${ctx.logs.length} / 共 ${ctx.logTotal}` : undefined)
    let bucket = ''
    for (const l of [...logs].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      const b = dayBucket(l.mtimeMs, ctx.now)
      if (b !== bucket) {
        bucket = b
        g.appendChild(el('div', 'wb-dir-day')).textContent = b
      }
      const title = ctx.titles.get(l.id)
      const item = row(g, 'wb-dot-log', '❐', title ?? `会话 …${l.id.slice(-12)}`, `${ago(l.mtimeMs, ctx.now)} · ${fmtSize(l.sizeBytes)}`,
        () => ctx.openChat({ kind: 'log', id: l.id, title: title ?? `…${l.id.slice(-12)}`, sub: '本机日志' }),
        `${l.id}\n${new Date(l.mtimeMs).toLocaleString()} · ${fmtSize(l.sizeBytes)}`)
      if (title === undefined) item.classList.add('is-untitled')
    }
  }

  if (sessions.length + canvases.length + remote.length + logs.length === 0) {
    box.appendChild(el('div', 'wb-dir-empty')).textContent = filtering ? '无匹配条目' : '目录为空'
  }
  const allSessions = state.sessions ?? []
  const liveAll = allSessions.filter(s => s.live === true).length
  return `${liveAll}/${allSessions.length}`
}

// ── learned log titles (per-viewer convenience, browser-local) ──
const TITLE_KEY = 'dsh-a2a.logtitles'
const TITLE_CAP = 300
const TITLE_MAX = 60

/** Load the learned titles; storage can be absent or throw — an empty map then. */
export function loadLogTitles(): Map<string, string> {
  try {
    const raw = window.localStorage.getItem(TITLE_KEY)
    const parsed = raw === null ? null : JSON.parse(raw) as unknown
    if (parsed !== null && typeof parsed === 'object') {
      return new Map(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
    }
  } catch { /* fall through */ }
  return new Map()
}

/** Learn a title from a transcript (first user line, else first line); true when it changed. */
export function learnLogTitle(titles: Map<string, string>, id: string, messages: ReadonlyArray<{ role: string; text: string }>): boolean {
  const source = messages.find(m => m.role === 'user' && m.text.trim() !== '') ?? messages.find(m => m.text.trim() !== '')
  if (source === undefined) return false
  const line = source.text.trim().split('\n')[0]!.trim()
  const title = line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
  if (titles.get(id) === title) return false
  titles.delete(id)
  titles.set(id, title)
  while (titles.size > TITLE_CAP) titles.delete(titles.keys().next().value as string)
  try {
    window.localStorage.setItem(TITLE_KEY, JSON.stringify(Object.fromEntries(titles)))
  } catch { /* per-viewer convenience only */ }
  return true
}
