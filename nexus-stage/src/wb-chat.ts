/**
 * The workbench's right-side chat drawer: one conversation per picked node.
 *
 * Layout: a head (back · status dot · title/route · refresh · info · close),
 * an optional info panel (forensics: ids, route, origin, where the records
 * live), the full-height thread, and a composer pinned to the bottom.
 *
 * The thread shows the conversation by default (user ruling 2026-10-23,
 * reversing b324460's folded-forensics default for this face): the session
 * log's turns as bubbles, then the messages sent from this page — each one
 * tracked against the ledger by task id (发送中 → 待回执 → 已结算 / 死信).
 * Ledger rows already owed by the same team show even after a reload, so
 * the drawer never hides that a message is still waiting for its receipt.
 *
 * The 3s poll never rebuilds the drawer: `update()` refreshes the head and
 * the outgoing statuses in place, so the composer keeps focus and caret and
 * the thread keeps its scroll without the old capture/restore workaround.
 * Data is attacker-shaped (session titles, log text): textContent only.
 * @module nexus-stage/wb-chat
 */
import type { ArchivedRow, DeadRow, PendingRow, RemoteRow, StateBody } from './workbench'
import { overHour, VERDICTS } from './wb-ledger'
import { displayName } from './stage-name'

/** Chat target: a node picked on the board or in the directory. Session and
 *  log read the local transcript; remote rows and peers read through the
 *  /a2a/log proxy. Reading, not jumping. */
export type ChatTarget =
  | { kind: 'session'; id: string; title: string; sub: string; team?: string; live?: boolean }
  | { kind: 'log'; id: string; title: string; sub: string }
  | { kind: 'peer'; id: string; title: string; sub: string; url?: string; picked?: string }
  | { kind: 'remote'; team: string; title: string; sub: string; row?: RemoteRow }

type Message = { role: string; text: string }
type Transcript = { ok: boolean; messages?: Message[]; error?: string } | undefined
type PeerListing = { ok: boolean; sessions?: Array<{ id: string; mtimeMs?: number; sizeBytes: number }>; error?: string } | undefined

export interface ChatDrawerDeps {
  now(): number
  sessionLog?(id: string): Promise<{ ok: boolean; messages?: Message[]; error?: string }>
  remoteSessionLog?(query: { team?: string; peer?: string; id?: string; limit?: number }): Promise<{ ok: boolean; messages?: Message[]; sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>; error?: string; via?: string }>
  dispatchQuick?(team: string, message: string): Promise<{ ok: boolean; task_id?: string; reply?: string; error?: string }>
  /** A transcript loaded for `target` (the directory learns 本机日志 titles from it). */
  onTranscript?(target: ChatTarget, messages: ReadonlyArray<Message>): void
}

export interface ChatDrawer {
  readonly root: HTMLElement
  open(target: ChatTarget): void
  close(): void
  isOpen(): boolean
  /** Poll facts: refreshes the head (title / live) and the outgoing statuses in place. */
  update(state: StateBody | null): void
}

/** The composer's hard limit (dispatch route contract). */
const MAX_CHARS = 4000
/** Within this many px of the bottom, a repaint keeps the thread pinned there. */
const STICK_PX = 32

/** A message sent from this page, tracked until the ledger settles it. */
interface Outgoing {
  readonly text: string
  readonly at: number
  state: 'sending' | 'sent' | 'failed'
  taskId?: string
  error?: string
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  return node
}

function iconButton(label: string, glyph: string, className = ''): HTMLButtonElement {
  const b = el('button', `wb-icon-btn wb-chat-act ${className}`.trim())
  b.type = 'button'
  b.setAttribute('aria-label', label)
  b.title = label
  b.textContent = glyph
  return b
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

/** The routing team a target can be dispatched to (none for logs and peer hosts). */
function dispatchTeamOf(t: ChatTarget): string | undefined {
  const team = t.kind === 'session' || t.kind === 'remote' ? t.team : undefined
  return team !== undefined && team !== '' ? team : undefined
}

function targetKey(t: ChatTarget): string {
  return t.kind === 'remote' ? `remote:${t.team}` : `${t.kind}:${t.id}`
}

export function createChatDrawer(deps: ChatDrawerDeps): ChatDrawer {
  let target: ChatTarget | null = null
  let last: StateBody | null = null
  let focusPending = false
  let infoOpen = false
  /** Transcript per key, kept across open/close; refresh forces one re-read. */
  const transcripts = new Map<string, Transcript>()
  /** Reading position per transcript key (restored on reopen). */
  const scrolls = new Map<string, number>()
  const peerLists = new Map<string, PeerListing>()
  /** Messages sent from this page, per routing team. */
  const outbox = new Map<string, Outgoing[]>()
  /** Task ids the ledger has shown as pending (a vanished one has left the ledger). */
  const seenPending = new Set<string>()
  /** Direction per task id, learned from pending rows — the fallback for an
   *  older host whose dead rows carry none (gh#31 added it). An inbound row (a
   *  peer's delivery to this session) shares this session's team; without a
   *  direction it would read as our own message. */
  const directions = new Map<string, 'inbound' | 'outbound'>()
  /** One composer per routing team: a half-typed draft survives switching nodes. */
  const composers = new Map<string, Composer>()

  // ── static shell ──
  const root = el('aside', 'wb-chat')
  root.setAttribute('aria-label', '对话')
  const head = el('div', 'wb-chat-head')
  const back = iconButton('返回会话列表', '‹', 'wb-chat-back')
  const dot = el('span', 'wb-chat-dot')
  const titles = el('div', 'wb-chat-titles')
  const title = el('span', 'wb-chat-title')
  const sub = el('span', 'wb-chat-sub')
  titles.append(title, sub)
  const refresh = iconButton('刷新对话', '↻', 'wb-chat-refresh')
  const infoBtn = iconButton('会话详情', 'ⓘ', 'wb-chat-info-btn')
  infoBtn.setAttribute('aria-expanded', 'false')
  const closeBtn = iconButton('关闭对话', '✕', 'wb-chat-close')
  head.append(back, dot, titles, refresh, infoBtn, closeBtn)
  const info = el('div', 'wb-chat-info')
  info.hidden = true
  const thread = el('div', 'wb-chat-thread')
  thread.setAttribute('role', 'log')
  thread.setAttribute('aria-live', 'polite')
  thread.tabIndex = 0
  const notice = el('div', 'wb-chat-notice')
  const log = el('div', 'wb-chat-log')
  const sent = el('div', 'wb-chat-sent')
  thread.append(notice, log, sent)
  const foot = el('div', 'wb-chat-foot')
  root.append(head, info, thread, foot)

  back.addEventListener('click', () => {
    if (target?.kind !== 'peer') return
    target.picked = undefined
    paintFace()
  })
  refresh.addEventListener('click', () => {
    if (target === null) return
    const key = transcriptKey(target)
    if (key !== undefined) transcripts.delete(key)
    if (target.kind === 'peer' && target.picked === undefined && target.url !== undefined) peerLists.delete(`peer:${target.url}`)
    paintThread(true)
  })
  infoBtn.addEventListener('click', () => {
    infoOpen = !infoOpen
    info.hidden = !infoOpen
    infoBtn.setAttribute('aria-expanded', String(infoOpen))
  })
  closeBtn.addEventListener('click', () => close())
  thread.addEventListener('scroll', () => {
    const key = target !== null ? transcriptKey(target) : undefined
    if (key !== undefined) scrolls.set(key, thread.scrollTop)
  })
  // 0.6.17 chat-UI convention: Escape closes the drawer. Document-scoped (a
  // reading drawer often holds no focusable element), but it never steals
  // Escape from another surface's text field or the planning board's own
  // deselect gesture.
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !root.classList.contains('is-open')) return
    const t = ev.target
    if (!(t instanceof HTMLElement)) return
    if (!root.contains(t)) {
      const typingElsewhere = t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.isContentEditable
      const onBoard = t.closest('.wb-stage-board') !== null
      if (typingElsewhere || onBoard) return
    }
    close()
  })

  /** Which transcript a target reads (undefined: listing or no reader wired). */
  function transcriptKey(t: ChatTarget): string | undefined {
    if (t.kind === 'session' || t.kind === 'log') return deps.sessionLog !== undefined ? `local:${t.id}` : undefined
    if (t.kind === 'remote') return deps.remoteSessionLog !== undefined ? `remote:${t.team}` : undefined
    if (t.picked !== undefined && t.url !== undefined && deps.remoteSessionLog !== undefined) return `peer:${t.url}:${t.picked}`
    return undefined
  }

  function loadTranscript(t: ChatTarget): Promise<Transcript> {
    if (t.kind === 'session' || t.kind === 'log') return deps.sessionLog?.(t.id) ?? Promise.resolve({ ok: false, error: 'sessionLog unavailable' })
    if (t.kind === 'remote') return deps.remoteSessionLog?.({ team: t.team }) ?? Promise.resolve({ ok: false, error: 'remoteSessionLog unavailable' })
    return deps.remoteSessionLog?.({ peer: t.url, id: t.picked }) ?? Promise.resolve({ ok: false, error: 'remoteSessionLog unavailable' })
  }

  // ── head + info ──
  function paintHead(): void {
    const t = target
    if (t === null) return
    const cold = t.kind === 'log' || t.kind === 'remote' || (t.kind === 'session' && t.live === false)
    dot.className = `wb-chat-dot ${t.kind === 'peer' ? 'is-peer' : cold ? 'is-cold' : 'is-live'}`
    dot.title = t.kind === 'peer' ? '对端主机' : t.kind === 'log' ? '只读日志' : t.kind === 'remote' ? '远端会话' : t.live === false ? '冷会话' : '在线'
    title.textContent = t.kind === 'peer' && t.picked !== undefined ? `…${t.picked.slice(-12)}` : t.title
    sub.textContent = t.kind === 'peer' && t.picked !== undefined ? t.title : t.sub
    back.hidden = !(t.kind === 'peer' && t.picked !== undefined)
  }

  function kv(label: string, value: string): void {
    const row = el('div', 'wb-kv')
    row.appendChild(el('span', 'wb-kv-k')).textContent = label
    row.appendChild(el('span', 'wb-kv-v')).textContent = value
    info.appendChild(row)
  }

  function paintInfo(): void {
    info.replaceChildren()
    const t = target
    if (t === null) return
    if (t.kind === 'session') {
      kv('会话', t.id)
      if (t.team !== undefined) kv('路由', t.team)
      kv('来源', '本机会话日志')
    } else if (t.kind === 'log') {
      kv('会话', t.id)
      kv('来源', '本机会话日志（不在网络目录）')
    } else if (t.kind === 'remote') {
      kv('路由', t.team)
      if (t.row?.origin !== undefined) kv('来源', t.row.origin)
      if (t.row?.via !== undefined) kv('经', t.row.via)
      if (t.row?.workspace !== undefined) kv('工作区', t.row.workspace)
    } else {
      kv('对端', t.url ?? t.sub)
      if (t.picked !== undefined) kv('会话', t.picked)
      kv('来源', '经本机代理读取对端 /a2a/log')
    }
  }

  /** The one-line context at the top of the thread: where these records come from. */
  function noticeText(t: ChatTarget): string {
    if (t.kind === 'log') return '只读日志 —— 此会话当前不在网络目录（可能已归档或未入网）。'
    if (t.kind === 'remote') {
      return deps.remoteSessionLog !== undefined
        ? '远端会话 —— 经本机代理从对端 /a2a/log 读取最近对话。'
        : '远端节点的对话记录在对端机器上；本页的代理读取面未启用。'
    }
    if (t.kind === 'peer') {
      if (t.url === undefined || deps.remoteSessionLog === undefined) return `对端主机节点（${t.sub}）—— 会话记录存放在对端机器上，本页只读本机会话日志。`
      return t.picked === undefined ? '对端主机 —— 选择一个会话阅读（经本机代理读取对端 /a2a/log）。' : ''
    }
    return deps.sessionLog === undefined ? '本页未接入会话日志读取，只显示从这里发出的消息。' : ''
  }

  // ── thread ──
  function atBottom(): boolean {
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= STICK_PX
  }

  /** Keep the reader where they were, or on the newest turn when they were there. */
  function settle(stick: boolean): void {
    const apply = (): void => {
      if (stick) thread.scrollTop = thread.scrollHeight
    }
    apply()
    // Scroll writes only stick on attached, laid-out elements.
    requestAnimationFrame(apply)
  }

  function emptyState(text: string, tone?: 'error'): HTMLElement {
    const n = el('div', `wb-chat-empty${tone === 'error' ? ' is-error' : ''}`)
    n.textContent = text
    return n
  }

  function bubble(role: string, text: string): HTMLElement {
    const mine = role === 'user'
    const b = el('div', `wb-msg ${mine ? 'wb-msg-user' : 'wb-msg-assistant'}`)
    const who = el('span', 'wb-msg-who')
    who.textContent = mine ? '问' : '答'
    const body = el('div', 'wb-msg-text')
    body.textContent = text
    b.append(who, body)
    return b
  }

  function paintLog(state: Transcript): void {
    log.replaceChildren()
    if (state === undefined) { log.appendChild(emptyState('读取中…')); return }
    if (state.ok !== true || state.messages === undefined) { log.appendChild(emptyState(`无法读取（${state.error ?? '未知错误'}）`, 'error')); return }
    if (state.messages.length === 0) { log.appendChild(emptyState('暂无对话记录')); return }
    for (const m of state.messages) log.appendChild(bubble(m.role, m.text))
  }

  function paintPeerList(url: string, state: PeerListing): void {
    log.replaceChildren()
    if (state === undefined) { log.appendChild(emptyState('读取中…')); return }
    if (state.ok !== true || state.sessions === undefined) { log.appendChild(emptyState(`无法读取（${state.error ?? '未知错误'}）`, 'error')); return }
    if (state.sessions.length === 0) { log.appendChild(emptyState('对端没有可读会话')); return }
    const list = el('div', 'wb-chat-sessions')
    const now = deps.now()
    for (const row of state.sessions) {
      const item = el('button', 'wb-chat-session')
      item.type = 'button'
      item.appendChild(el('span', 'wb-chat-session-id')).textContent = `…${row.id.slice(-12)}`
      const meta = [row.mtimeMs !== undefined ? ago(row.mtimeMs, now) : '', fmtSize(row.sizeBytes)].filter(Boolean).join(' · ')
      item.appendChild(el('span', 'wb-chat-session-meta')).textContent = meta
      item.title = row.id
      item.addEventListener('click', () => {
        if (target?.kind !== 'peer' || target.url !== url) return
        target.picked = row.id
        paintFace()
      })
      list.appendChild(item)
    }
    log.appendChild(list)
  }

  /** (Re)load what the thread shows; `force` bypasses the caches and re-lands on the newest turn. */
  function paintThread(force = false): void {
    const t = target
    if (t === null) return
    notice.textContent = noticeText(t)
    notice.hidden = notice.textContent === ''
    if (t.kind === 'peer' && t.picked === undefined) {
      if (t.url === undefined || deps.remoteSessionLog === undefined) { log.replaceChildren(); return }
      const url = t.url
      const key = `peer:${url}`
      if (!force && peerLists.has(key)) { paintPeerList(url, peerLists.get(key)); return }
      peerLists.set(key, undefined)
      paintPeerList(url, undefined)
      void deps.remoteSessionLog({ peer: url }).then(result => {
        peerLists.set(key, result)
        if (target?.kind === 'peer' && target.url === url && target.picked === undefined) paintPeerList(url, result)
      }, (error: unknown) => {
        const result = { ok: false, error: error instanceof Error ? error.message : String(error) }
        peerLists.set(key, result)
        if (target?.kind === 'peer' && target.url === url && target.picked === undefined) paintPeerList(url, result)
      })
      return
    }
    const key = transcriptKey(t)
    if (key === undefined) { log.replaceChildren(); paintSent(true); return }
    const restore = (): void => {
      const saved = scrolls.get(key)
      if (saved === undefined || force) settle(true)
      else {
        thread.scrollTop = saved
        requestAnimationFrame(() => { if (target !== null && transcriptKey(target) === key) thread.scrollTop = saved })
      }
    }
    if (!force && transcripts.has(key) && transcripts.get(key) !== undefined) {
      paintLog(transcripts.get(key))
      paintSent(true)
      restore()
      return
    }
    if (force) scrolls.delete(key)
    transcripts.set(key, undefined)
    paintLog(undefined)
    paintSent(true)
    void loadTranscript(t).then(result => {
      transcripts.set(key, result)
      if (result?.ok === true && result.messages !== undefined) deps.onTranscript?.(t, result.messages)
      if (target === null || transcriptKey(target) !== key) return
      paintLog(result)
      paintSent()
      restore()
    }, (error: unknown) => {
      const result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      transcripts.set(key, result)
      if (target !== null && transcriptKey(target) === key) paintLog(result)
    })
  }

  // ── outgoing: this page's sends + the ledger's open rows for the same team ──
  function pendingFor(team: string): PendingRow[] {
    return (last?.tasks ?? []).filter(r => r.team === team)
  }
  function deadFor(team: string): DeadRow[] {
    return (last?.tasksDead ?? []).filter(r => r.team === team)
  }

  /** What the outgoing area shows, as data first: a poll that changes
   *  nothing must not touch the DOM (or the reader's scroll position). */
  type Tone = 'wait' | 'ok' | 'warn' | 'danger' | 'muted'
  /** One ledger-area row. `side`: whose words it is — ours (sent to this
   *  team), theirs (a peer's delivery to this session, receipt owed by us), or
   *  a neutral ledger line when the direction cannot be known. */
  type SentRow = { at: number; side: 'mine' | 'theirs' | 'system'; text: string; status: { text: string; tone: Tone; hint?: string }; taskId?: string }
  let sentSig = ''

  function deadStatus(row: DeadRow): SentRow['status'] {
    // 'fire-forget' is a receiptless row expiring — expected bookkeeping,
    // not a failure (task-ledger sweep); only 'unconsumed' is a dead letter.
    if (row.reason === 'fire-forget') return { text: '已过期（免回执）', tone: 'muted', hint: '免回执消息到 24h TTL 归档，属正常记账' }
    return { text: '死信', tone: 'danger', hint: row.reason !== undefined && row.reason !== 'unspecified' ? `${row.reason}：超过 24h TTL 仍未结算，需在台账清账` : '超过 24h TTL 仍未结算，需在台账清账' }
  }

  function pendingStatus(row: PendingRow, now: number): SentRow['status'] {
    const inbound = row.direction === 'inbound'
    if (row.receiptExpected === false) return { text: inbound ? '来信 · 无需回执' : '已送达 · 无回执', tone: 'muted', hint: '免回执消息：不等回执，24h 后自动归档' }
    // One hour boundary with the 台账 tab (the host's settleable verdict,
    // browser clock only on older hosts). Past it, OUR send is 陈旧 (can be
    // nudged); a peer's delivery is a receipt WE owe — never 陈旧 (#30 P3).
    const late = overHour(row, now)
    const text = inbound ? (late ? '待本机回执 · 超 1 小时' : '待本机回执') : late ? '陈旧' : '待回执'
    // The row's own status only when it says more than 'pending'.
    const extra = row.status !== 'pending' ? ` · ${row.status}` : ''
    return { text: `${text}${extra}`, tone: late ? 'warn' : 'wait', hint: `${inbound ? '对方等待本机回执；' : ''}${inbound ? '收到' : '派发'}于 ${ago(row.startedAt, now)}` }
  }

  /** A send that left the ledger, by how it ended (gh#31). `endedBy` says
   *  who ended it; an older host omits it, and then only the outcome is
   *  known. The summary is the peer's free text only on a receipt-settled
   *  row (a tooltip, never markup) — caller-ended and echo rows carry the
   *  ledger's own markers, which are not shown. */
  function settledStatus(row: ArchivedRow, now: number): SentRow['status'] {
    const when = `结算于 ${ago(row.resolvedAt, now)}`
    // gh#68: a fire-forget send this host moved out of the ledger (移出 on
    // the 已过期（免回执） card) is bookkeeping, not a failure — it never
    // waited on a receipt, so 已放弃 would contradict the button that did it.
    if (row.receiptExpected === false && (row.endedBy === 'abandoned' || row.endedBy === 'cancelled')) {
      return { text: '已移出（免回执）', tone: 'muted', hint: `${when}；免回执消息，本机移出台账，不是失败` }
    }
    if (row.endedBy === 'abandoned' || row.endedBy === 'cancelled') {
      const act = row.endedBy === 'cancelled' ? '撤回' : '放弃'
      // The peer answered after we ended it: the verdict stays ours (late
      // receipts never rewrite it), but the reader should know it came.
      if (row.late === true) return { text: `已${act} · 回执迟到`, tone: 'warn', hint: `${when}；本机${act}之后对方回执才到，结局不改写` }
      return { text: `已${act}`, tone: 'muted', hint: `${when}；本机${act}，未等到回执` }
    }
    if (row.endedBy === 'echo') return { text: '已结算 · 内容回显', tone: 'ok', hint: `${when}；对方回了内容但未带正式回执，按内容回显结算` }
    // An older host without endedBy: 'abandoned' may be ours (abandon or
    // cancel) or the peer's receipt verdict — claim neither side.
    if (row.endedBy === undefined && row.outcome === 'abandoned') return { text: '已放弃（本机或对方）', tone: 'muted', hint: `${when}；本机放弃或撤回，或对方回执报告放弃` }
    // Settled by the peer's receipt: its own verdict.
    const summary = row.summary !== undefined && row.summary !== '' ? ` · ${row.summary}` : ''
    if (row.outcome === 'abandoned') return { text: '已回执 · 对方放弃', tone: 'warn', hint: `${when}；对方回执报告放弃${summary}` }
    const v = VERDICTS.find(x => x.key === row.outcome)
    const tone: Tone = v?.tone === 'completed' ? 'ok' : v?.tone === 'failed' ? 'danger' : v?.tone === 'rejected' ? 'warn' : 'muted'
    if (row.outcome === 'unclassified') return { text: '已回执', tone: 'ok', hint: `${when}；回执未带结论${summary}` }
    return { text: `已回执 · ${v?.label ?? row.outcome}`, tone, hint: `${when}${summary}` }
  }

  /** Status of a send this page made, by task id. */
  function receiptOf(taskId: string, team: string, now: number): SentRow['status'] {
    const dead = deadFor(team).find(r => r.taskId === taskId)
    if (dead !== undefined) return deadStatus(dead)
    const pending = pendingFor(team).find(r => r.taskId === taskId)
    if (pending !== undefined) return pendingStatus(pending, now)
    // Gone from the ledger: the archive says how it ended — also for a send
    // that settled between two polls and was never seen pending.
    const settled = (last?.archived ?? []).find(r => r.taskId === taskId && r.team === team)
    if (settled !== undefined) return settledStatus(settled, now)
    // No archived row: an older host without the archive face, or a row past
    // its newest-64 window — say only that it left.
    if (seenPending.has(taskId)) return { text: '已离开台账', tone: 'muted', hint: '已结算、放弃或撤回之一；主机未给出这条的结局（旧主机，或已超出最近 64 条归档）' }
    return { text: '已派发', tone: 'muted', hint: '异步送达；回执到达后进台账' }
  }

  function sentRows(team: string): SentRow[] {
    const now = deps.now()
    const mine = outbox.get(team) ?? []
    const mineIds = new Set(mine.map(o => o.taskId).filter((id): id is string => id !== undefined))
    const brief = (b?: string): string => (b !== undefined && b !== '' ? b : '（无摘要）')
    // Ledger rows for this team that this page did not send (earlier session,
    // another tab, a reload): shown by their brief so nothing owed is hidden —
    // on the side of whoever said it.
    const owed: SentRow[] = pendingFor(team).filter(r => !mineIds.has(r.taskId)).map(r => ({
      at: r.startedAt, side: r.direction === 'inbound' ? 'theirs' : 'mine', text: brief(r.brief), status: pendingStatus(r, now), taskId: r.taskId,
    }))
    const dead: SentRow[] = deadFor(team).filter(r => !mineIds.has(r.taskId)).map(r => {
      const dir = r.direction ?? directions.get(r.taskId) ?? (r.peer?.startsWith('local:') === true ? 'inbound' : undefined)
      return { at: r.startedAt, side: dir === 'inbound' ? 'theirs' : dir === 'outbound' ? 'mine' : 'system', text: brief(r.brief), status: deadStatus(r), taskId: r.taskId }
    })
    const local: SentRow[] = mine.map(o => ({
      at: o.at,
      side: 'mine',
      text: o.text,
      status: o.state === 'sending' ? { text: '发送中…', tone: 'muted' }
        : o.state === 'failed' ? { text: `失败：${o.error ?? '未知原因'}`, tone: 'danger' }
          : o.taskId !== undefined ? receiptOf(o.taskId, team, now) : { text: '已派发', tone: 'muted' },
      taskId: o.taskId,
    }))
    return [...owed, ...dead, ...local].sort((a, b) => a.at - b.at)
  }

  function paintSent(force = false): void {
    const t = target
    const team = t !== null ? dispatchTeamOf(t) : undefined
    const rows = team !== undefined ? sentRows(team) : []
    const sig = JSON.stringify([team ?? '', ...rows.map(r => [r.taskId ?? '', r.side, r.text, r.status.text])])
    if (!force && sig === sentSig) return
    sentSig = sig
    const stick = atBottom()
    sent.replaceChildren()
    if (rows.length === 0) return
    const divider = el('div', 'wb-chat-divider')
    divider.textContent = '台账往来 · 异步送达，回执进台账'
    sent.appendChild(divider)
    for (const r of rows) {
      const cls = r.side === 'mine' ? 'wb-msg wb-msg-user wb-msg-out' : r.side === 'theirs' ? 'wb-msg wb-msg-assistant wb-msg-in' : 'wb-msg wb-msg-ledger'
      const b = el('div', cls)
      b.appendChild(el('span', 'wb-msg-who')).textContent = r.side === 'mine' ? '我' : r.side === 'theirs' ? '对方' : '台账记录'
      b.appendChild(el('div', 'wb-msg-text')).textContent = r.text
      const meta = el('div', 'wb-msg-meta')
      if (r.taskId !== undefined) meta.appendChild(el('span', 'wb-msg-task')).textContent = r.taskId
      const chip = el('span', `wb-msg-status is-${r.status.tone}`)
      chip.textContent = r.status.text
      if (r.status.hint !== undefined) chip.title = r.status.hint
      meta.appendChild(chip)
      b.appendChild(meta)
      sent.appendChild(b)
    }
    if (stick) settle(true)
  }

  // ── composer ──
  interface Composer { team: string; form: HTMLFormElement; text: HTMLTextAreaElement; note: HTMLElement; submit: HTMLButtonElement }

  function hint(c: Composer): void {
    const n = c.text.value.length
    c.note.classList.remove('is-error')
    c.note.textContent = n > MAX_CHARS * 0.9 ? `${n}/${MAX_CHARS}` : 'Enter 发送 · Shift+Enter 换行'
    if (n > MAX_CHARS) c.note.classList.add('is-error')
    c.submit.disabled = c.text.value.trim() === '' || n > MAX_CHARS
  }

  function grow(text: HTMLTextAreaElement): void {
    text.style.height = 'auto'
    text.style.height = `${Math.min(text.scrollHeight, 160)}px`
  }

  function buildComposer(team: string): Composer {
    const form = el('form', 'wb-dispatch-form wb-chat-composer')
    const text = document.createElement('textarea')
    text.className = 'wb-dispatch-text'
    text.rows = 1
    text.placeholder = '发一句话任务给这个节点…'
    text.setAttribute('aria-label', '发送消息')
    const submit = el('button', 'wb-dispatch-submit')
    submit.type = 'submit'
    submit.textContent = '发送'
    submit.setAttribute('aria-label', '发送')
    const note = el('div', 'wb-dispatch-note')
    note.setAttribute('aria-live', 'polite')
    const row = el('div', 'wb-chat-composer-row')
    row.append(text, submit)
    form.append(row, note)
    const c: Composer = { team, form, text, note, submit }
    text.addEventListener('input', () => { grow(text); hint(c) })
    // 0.6.17 chat-UI conventions: Enter sends, Shift+Enter is a soft newline,
    // IME composition is never hijacked.
    text.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return
      if (ev.isComposing) return
      ev.preventDefault()
      form.requestSubmit()
    })
    form.addEventListener('submit', ev => {
      ev.preventDefault()
      const message = text.value.trim()
      if (message === '' || message.length > MAX_CHARS || deps.dispatchQuick === undefined) return
      const item: Outgoing = { text: message, at: deps.now(), state: 'sending' }
      const list = outbox.get(team) ?? []
      list.push(item)
      outbox.set(team, list)
      // Sent: clear the composer like every chat surface and keep the caret
      // in it; a refused send puts the text back so nothing is lost.
      text.value = ''
      grow(text)
      hint(c)
      text.focus({ preventScroll: true })
      paintSent()
      settle(true)
      void deps.dispatchQuick(team, message).then(outcome => outcome, (error: unknown) => ({
        ok: false, error: error instanceof Error ? error.message : String(error),
      } as { ok: boolean; task_id?: string; error?: string })).then(outcome => {
        if (outcome.ok === true) {
          item.state = 'sent'
          item.taskId = outcome.task_id
          note.classList.remove('is-error')
          note.textContent = `已派发${outcome.task_id !== undefined ? ` · ${outcome.task_id}` : ''} · 回执将入台账`
        } else {
          item.state = 'failed'
          item.error = outcome.error ?? '未知原因'
          if (text.value === '') { text.value = message; grow(text) }
          note.classList.add('is-error')
          note.textContent = `失败：${item.error}`
          submit.disabled = text.value.trim() === ''
        }
        if (target !== null && dispatchTeamOf(target) === team) paintSent()
      })
    })
    hint(c)
    return c
  }

  function paintFoot(): void {
    const t = target
    foot.replaceChildren()
    if (t === null) return
    const team = dispatchTeamOf(t)
    if (team !== undefined && deps.dispatchQuick !== undefined) {
      let c = composers.get(team)
      if (c === undefined) { c = buildComposer(team); composers.set(team, c) }
      foot.appendChild(c.form)
      if (focusPending) {
        focusPending = false
        // preventScroll: focusing must not fight the thread's landing scroll.
        c.text.focus({ preventScroll: true })
      }
      return
    }
    focusPending = false
    const ro = el('div', 'wb-chat-readonly')
    ro.textContent = t.kind === 'log' ? '只读日志：此会话不在网络目录，不能从这里派发。'
      : t.kind === 'peer' ? '对端主机：选择会话阅读；要派发请打开它的远端会话节点。'
        : '此节点没有可派发的路由。'
    foot.appendChild(ro)
  }

  function paintFace(): void {
    paintHead()
    paintInfo()
    paintThread()
    paintFoot()
  }

  // ── surface ──
  function open(t: ChatTarget): void {
    const same = target !== null && targetKey(target) === targetKey(t)
    target = t
    if (!same) focusPending = true
    paintFace()
    root.classList.add('is-open')
  }

  function close(): void {
    target = null
    root.classList.remove('is-open')
  }

  function update(state: StateBody | null): void {
    last = state
    for (const r of state?.tasks ?? []) {
      seenPending.add(r.taskId)
      directions.set(r.taskId, r.direction === 'inbound' ? 'inbound' : 'outbound')
    }
    const t = target
    if (t === null) return
    // Title / liveness freshness for sessions; everything else is static per open.
    if (t.kind === 'session' && state !== null) {
      const row = (state.sessions ?? []).find(s => s.id === t.id)
      if (row !== undefined) {
        t.title = displayName(row)
        t.live = row.live
      }
    }
    paintHead()
    paintSent()
  }

  return { root, open, close, isOpen: () => target !== null, update }
}
