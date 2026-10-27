/**
 * The 台账 tab (2026-10-23 redesign, user ruling — supersedes the b324460
 * layout while keeping its intent: results first, color only for what needs
 * a hand).
 *
 * Top: four stat tiles (待回执 · 陈旧 · 死信 · 已归档), each carrying its
 * definition; the archive verdict split as one proportional bar. Below: the
 * rows grouped by what to do with them —
 *   死信        red, 'unconsumed' (or unspecified) dead rows, with 清账;
 *   陈旧        amber, our receipt-expected sends ≥1h old — 可催办;
 *   待本机回执  a peer's delivery to this host whose receipt WE owe
 *               (amber from 1h, its own overdue count); never "可催办";
 *   等待回执    quiet, our sends still within their hour;
 *   免回执      muted, receiptExpected:false rows (no receipt will ever come);
 *   已过期（免回执） muted, 'fire-forget' expiries — expected bookkeeping
 *               (task-ledger sweep), not dead letters; 清账 still tidies them.
 * The stale and dead counts come from ledgerFacts(), shared with the header
 * verdict so the two never disagree (PR #30 review L1/L3).
 * Each card leads with the brief, then a muted meta line (direction, team,
 * age, task id) and chips (可结算 / 入站). A card whose team resolves to a
 * session or remote node opens that conversation. Forensic counters
 * (idempotency, reconcile) fold into a 取证 details element.
 * Rows are attacker-shaped data: textContent only.
 * @module nexus-stage/wb-ledger
 */
import type { DeadRow, PendingRow, StateBody } from './workbench'
import type { RailTone } from './wb-rail'
import { nameInto } from './wb-names'

export interface LedgerContext {
  readonly state: StateBody
  readonly now: number
  abandon(taskId: string, reason: string): Promise<boolean>
  /** Open the conversation for a routing team; false when no node resolves. */
  openTeam(team: string): boolean
  /** Whether openTeam would resolve (cards only become clickable when it does). */
  canOpenTeam(team: string): boolean
}

const HOUR = 60 * 60_000

/** Inbound rows carry this host's own team; the sender is in `peer` as
 *  `local:<sender>`. Rows say their direction (dead rows too since gh#31);
 *  on an older host whose dead rows omit it, the peer prefix is the tell
 *  (outbound local sends read 'local', remote ones a URL). */
function isInbound(row: { direction?: string; peer?: string }): boolean {
  return row.direction === 'inbound' || (row.direction === undefined && row.peer?.startsWith('local:') === true)
}

function senderOf(row: { peer?: string }): string | undefined {
  return row.peer?.startsWith('local:') === true ? row.peer.slice('local:'.length) : undefined
}

/** Past its hour, by the host's clock when the row carries the server's
 *  settleable verdict (receiptExpected && age < 1h, computed host-side), else
 *  by ours — a workbench opened from another machine with a skewed clock then
 *  still draws the boundary where the server does (at most one poll late). */
export function overHour(r: PendingRow, now: number): boolean {
  return r.settleable !== undefined ? r.settleable === false : now - r.startedAt >= HOUR
}

/** The ledger's action counts, one definition for the 台账 tab and the header:
 *  stale = OUR receipt-expected sends past their hour (receiptless rows are
 *  never stale — no receipt is coming); owedOverdue = peers' deliveries whose
 *  receipt WE have owed for over an hour (their own count, never mixed into
 *  stale); dead letters = dead rows that are not a 'fire-forget' expiry. */
export function ledgerFacts(state: StateBody, now: number): { stale: PendingRow[]; owedOverdue: PendingRow[]; deadLetters: DeadRow[]; expired: DeadRow[] } {
  const expected = (state.tasks ?? []).filter(r => r.receiptExpected !== false)
  const stale = expected.filter(r => !isInbound(r) && overHour(r, now))
  const owedOverdue = expected.filter(r => isInbound(r) && overHour(r, now))
  const dead = state.tasksDead ?? []
  return { stale, owedOverdue, deadLetters: dead.filter(r => r.reason !== 'fire-forget'), expired: dead.filter(r => r.reason === 'fire-forget') }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  return node
}

function ageText(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function tile(parent: HTMLElement, label: string, value: number, hint: string, tone?: 'warn' | 'danger'): void {
  const t = el('div', `wb-led-tile${tone !== undefined ? ` is-${tone}` : ''}`)
  t.title = hint
  t.appendChild(el('span', 'wb-led-tile-v')).textContent = String(value)
  t.appendChild(el('span', 'wb-led-tile-k')).textContent = label
  parent.appendChild(t)
}

/** The archive's verdict vocabulary, in a fixed order: the receipt
 *  envelope's controlled outcomes (src/receipt.ts RECEIPT_OUTCOMES) plus the
 *  projection's 'unclassified' (a receipt that rode no envelope outcome).
 *  'abandoned' also covers a caller's cancel — the ledger archives both the
 *  same way. Each verdict has a token-driven tone class, shared by the split
 *  bar here and the chat drawer's settled status. */
export const VERDICTS: ReadonlyArray<{ key: string; label: string; tone: 'completed' | 'rejected' | 'failed' | 'abandoned' | 'unclassified' }> = [
  { key: 'completed', label: '完成', tone: 'completed' },
  { key: 'sync_completed', label: '同步完成', tone: 'completed' },
  { key: 'rejected', label: '拒绝', tone: 'rejected' },
  { key: 'failed', label: '失败', tone: 'failed' },
  { key: 'expired', label: '过期', tone: 'abandoned' },
  { key: 'abandoned', label: '放弃', tone: 'abandoned' },
  { key: 'unknown', label: '结论不明', tone: 'unclassified' },
  { key: 'unclassified', label: '未分类', tone: 'unclassified' },
]

function splitBar(parent: HTMLElement, split: Readonly<Record<string, number>>, total: number): void {
  const wrap = el('div', 'wb-led-split')
  const bar = el('div', 'wb-led-split-bar')
  bar.setAttribute('role', 'img')
  const legend = el('div', 'wb-led-split-legend')
  const known = new Set(VERDICTS.map(v => v.key))
  const entries: Array<[string, string, number]> = VERDICTS.map(v => [v.tone, v.label, split[v.key] ?? 0])
  for (const [k, n] of Object.entries(split)) if (!known.has(k)) entries.push(['other', k, n])
  const parts: string[] = []
  for (const [tone, label, n] of entries) {
    if (n <= 0) continue
    const seg = el('span', `wb-led-seg is-${tone}`)
    seg.style.width = `${Math.max(2, (n / total) * 100)}%`
    bar.appendChild(seg)
    const item = el('span', 'wb-led-split-item')
    item.appendChild(el('i', `wb-led-swatch is-${tone}`))
    item.appendChild(document.createTextNode(`${label} ${n}`))
    legend.appendChild(item)
    parts.push(`${label} ${n}`)
  }
  bar.setAttribute('aria-label', `归档结局：${parts.join('，')}`)
  wrap.append(bar, legend)
  parent.appendChild(wrap)
}

type Card = { brief?: string; team: string; sender?: string; taskId: string; atText: string; inbound: boolean; chips: string[]; tone: 'danger' | 'warn' | 'muted' | 'quiet'; dead?: DeadRow }

export function renderLedger(pane: HTMLElement, ctx: LedgerContext): { badge: string; tone?: RailTone } {
  pane.replaceChildren()
  const { state, now } = ctx
  const pending = state.tasks ?? []
  const dead = state.tasksDead ?? []
  const archived = state.archivedCount ?? 0
  const facts = ledgerFacts(state, now)
  const receiptless = pending.filter(r => r.receiptExpected === false)
  const expected = pending.filter(r => r.receiptExpected !== false)
  const inbound = expected.filter(r => isInbound(r))
  const outbound = expected.filter(r => !isInbound(r))
  const stale = facts.stale
  const young = outbound.filter(r => !overHour(r, now))
  const staleCount = facts.stale.length

  const tiles = el('div', 'wb-led-tiles')
  // 待回执 counts only rows a receipt is owed on — the same rows as the
  // 陈旧 / 待本机回执 / 等待回执 groups below; receiptless rows are their own
  // 免回执 group and owe nothing.
  tile(tiles, '待回执', expected.length, `要回执、仍未结算的任务（含陈旧与本机欠对方的入站行）${receiptless.length > 0 ? `；另有免回执 ${receiptless.length} 条不计` : ''}`)
  tile(tiles, '陈旧', staleCount, '我方派发、要回执、已等待 ≥1h 仍未回执（可催办）；本机欠对方的入站行在「待本机回执」组另计，免回执行不算陈旧', staleCount > 0 ? 'warn' : undefined)
  tile(tiles, '死信', facts.deadLetters.length, '超过 24h TTL 仍未结算（unconsumed）；需清账（abandon）才能移出。免回执到期另列，不算死信', facts.deadLetters.length > 0 ? 'danger' : undefined)
  tile(tiles, '已归档', archived, '已离开台账并留档的任务（结算、拒绝或放弃），用于审计')
  pane.appendChild(tiles)
  if (archived > 0 && state.archivedSplit !== undefined) splitBar(pane, state.archivedSplit, archived)

  const card = (parent: HTMLElement, c: Card): void => {
    const node = el('div', `wb-led-card is-${c.tone}`)
    const head = el('div', 'wb-led-card-head')
    head.appendChild(el('span', `wb-led-dir${c.inbound ? ' is-in' : ''}`)).textContent = c.inbound ? '↙' : '↗'
    const brief = el('span', 'wb-led-brief')
    brief.textContent = c.brief !== undefined && c.brief !== '' ? c.brief : '（无摘要——派发未带 brief）'
    if (c.brief === undefined || c.brief === '') brief.classList.add('is-missing')
    head.appendChild(brief)
    node.appendChild(head)
    const meta = el('div', 'wb-led-meta')
    // Names, not bare ids (wb-names; the id rides each span's tooltip). An
    // inbound row's sender is the peer handle; an unknown one reads 对端.
    const who = meta.appendChild(el('span', 'wb-led-team'))
    if (!c.inbound) nameInto(who, state, c.team, '发往 ')
    else if (c.sender !== undefined) nameInto(who, state, c.sender, '来自 ')
    else who.textContent = '来自 对端'
    if (c.inbound) nameInto(meta.appendChild(el('span', 'wb-led-to')), state, c.team, '至 ')
    meta.appendChild(el('span')).textContent = c.atText
    meta.appendChild(el('span', 'wb-led-task')).textContent = c.taskId
    for (const chip of c.chips) meta.appendChild(el('span', 'wb-led-chip')).textContent = chip
    node.appendChild(meta)
    node.title = `${c.taskId}\n${c.team}`
    if (c.dead !== undefined) {
      const row = c.dead
      // A fire-forget expiry is normal bookkeeping, not a failure: moving it
      // out is an optional tidy, so it gets a quiet control, not 清账.
      const expiry = row.reason === 'fire-forget'
      const btn = el('button', `wb-btn wb-led-abandon${expiry ? ' is-quiet' : ''}`)
      btn.type = 'button'
      btn.textContent = expiry ? '移出' : '清账'
      btn.title = expiry ? '可选：把这条已过期的免回执记录移出台账（不是失败，不处理也无妨）' : '从台账移出这条死信（abandon）'
      btn.addEventListener('click', ev => {
        ev.stopPropagation()
        btn.disabled = true
        void ctx.abandon(row.taskId, 'workbench dead-letter cleanup').then(ok => {
          btn.disabled = false
          btn.textContent = ok ? '已清' : '失败'
        })
      })
      node.appendChild(btn)
    }
    if (ctx.canOpenTeam(c.team)) {
      node.classList.add('is-link')
      node.setAttribute('role', 'button')
      node.tabIndex = 0
      node.setAttribute('aria-label', `${brief.textContent}，打开 ${c.team} 的对话`)
      const go = (): void => { ctx.openTeam(c.team) }
      node.addEventListener('click', go)
      node.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go() } })
    }
    parent.appendChild(node)
  }
  const section = (label: string, rows: number, tone: string, hint: string): HTMLElement | null => {
    if (rows === 0) return null
    const g = el('div', `wb-led-group is-${tone}`)
    g.dataset.group = label
    const head = el('div', 'wb-led-group-head')
    head.appendChild(el('span')).textContent = `${label} · ${rows}`
    head.appendChild(el('span', 'wb-led-group-hint')).textContent = hint
    g.appendChild(head)
    pane.appendChild(g)
    return g
  }
  const pendingCard = (r: PendingRow, tone: Card['tone']): Card => {
    const inb = isInbound(r)
    return {
      brief: r.brief, team: r.team, sender: senderOf(r), taskId: r.taskId, atText: `${ageText(r.startedAt, now)} 前${inb ? '收到' : '派发'}`, inbound: inb, tone,
      chips: [...(r.settleable === true ? ['可结算'] : []), ...(r.receiptExpected === false ? ['无回执债'] : []), ...(inb ? ['入站'] : []), ...(r.status !== 'pending' ? [r.status] : [])],
    }
  }
  const deadCard = (r: DeadRow, tone: Card['tone'], label: string): Card => ({
    brief: r.brief, team: r.team, sender: senderOf(r), taskId: r.taskId, atText: `${ageText(r.deadAt, now)} 前${label}`, inbound: isInbound(r), tone, dead: r,
    chips: r.reason !== undefined && r.reason !== '' && r.reason !== 'unspecified' && r.reason !== 'fire-forget' ? [r.reason] : [],
  })

  const gDead = section('死信', facts.deadLetters.length, 'danger', '需清账')
  if (gDead !== null) for (const r of [...facts.deadLetters].sort((a, b) => b.deadAt - a.deadAt)) card(gDead, deadCard(r, 'danger', '死信'))
  const gStale = section('陈旧', stale.length, 'warn', '我方派发 ≥1 小时仍无回执，可催办')
  if (gStale !== null) for (const r of [...stale].sort((a, b) => a.startedAt - b.startedAt)) card(gStale, pendingCard(r, 'warn'))
  const overdue = facts.owedOverdue.length
  const gOwe = section('待本机回执', inbound.length, overdue > 0 ? 'warn' : 'quiet', overdue > 0 ? `对方在等本机回执 · ${overdue} 条超过 1 小时` : '对方在等本机回执')
  if (gOwe !== null) for (const r of [...inbound].sort((a, b) => a.startedAt - b.startedAt)) card(gOwe, pendingCard(r, overHour(r, now) ? 'warn' : 'quiet'))
  const gWait = section('等待回执', young.length, 'quiet', '1 小时内')
  if (gWait !== null) for (const r of [...young].sort((a, b) => b.startedAt - a.startedAt)) card(gWait, pendingCard(r, 'quiet'))
  const gFree = section('免回执', receiptless.length, 'muted', '不等回执，24h 后自动归档')
  if (gFree !== null) for (const r of receiptless) card(gFree, pendingCard(r, 'muted'))
  const gExpired = section('已过期（免回执）', facts.expired.length, 'muted', '正常记账，不是失败')
  if (gExpired !== null) for (const r of [...facts.expired].sort((a, b) => b.deadAt - a.deadAt)) card(gExpired, deadCard(r, 'muted', '过期'))

  if (pending.length + dead.length === 0) {
    pane.appendChild(el('div', 'wb-led-empty')).textContent = '台账为空——没有待回执的任务'
  }

  // Forensics: the plumbing counters a seat reads when something looks off.
  const idem = state.idempotency
  const reconcileState = state.reconcile?.state
  if (idem !== undefined || reconcileState !== undefined) {
    const details = el('details', 'wb-led-forensics wb-forensics')
    details.appendChild(el('summary')).textContent = '取证'
    const body = el('div', 'wb-led-forensics-body')
    if (idem !== undefined) body.appendChild(el('div')).textContent = `幂等 claims ${idem.claimsFresh ?? 0} · replays ${idem.replays ?? 0} · conflicts ${idem.conflicts ?? 0}`
    if (reconcileState !== undefined) body.appendChild(el('div')).textContent = `reconcile ${reconcileState}`
    details.appendChild(body)
    pane.appendChild(details)
  }

  // Owed = receipts still expected + dead letters to clean; receiptless rows
  // and fire-forget expiries owe nothing.
  const owed = expected.length + facts.deadLetters.length
  return { badge: owed > 0 ? String(owed) : '', tone: facts.deadLetters.length > 0 ? 'danger' : staleCount > 0 || overdue > 0 ? 'warn' : undefined }
}
