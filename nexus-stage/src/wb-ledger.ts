/**
 * The 台账 tab (2026-10-23 redesign, user ruling — supersedes the b324460
 * layout while keeping its intent: results first, color only for what needs
 * a hand).
 *
 * Top: four stat tiles (待回执 · 陈旧 · 死信 · 已归档), each carrying its
 * definition; the archive verdict split as one proportional bar. Below: the
 * rows grouped by what to do with them —
 *   死信    red, with 清账 (abandon) on each card;
 *   陈旧    amber, receipt-expected rows older than an hour;
 *   免回执  muted, receiptExpected:false rows (no receipt will ever come);
 *   等待回执 quiet, young rows still within their window.
 * Each card leads with the brief, then a muted meta line (direction, team,
 * age, task id) and chips (可结算 / 入站). A card whose team resolves to a
 * session or remote node opens that conversation. Forensic counters
 * (idempotency, reconcile) fold into a 取证 details element.
 * Rows are attacker-shaped data: textContent only.
 * @module nexus-stage/wb-ledger
 */
import type { DeadRow, PendingRow, StateBody } from './workbench'
import type { RailTone } from './wb-rail'

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

/** Archive verdicts in a fixed order, each with its token-driven tone class. */
const VERDICTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'completed', label: '完成' },
  { key: 'declined', label: '拒绝' },
  { key: 'abandoned', label: '放弃' },
  { key: 'unclassified', label: '未分类' },
]

function splitBar(parent: HTMLElement, split: Readonly<Record<string, number>>, total: number): void {
  const wrap = el('div', 'wb-led-split')
  const bar = el('div', 'wb-led-split-bar')
  bar.setAttribute('role', 'img')
  const legend = el('div', 'wb-led-split-legend')
  const known = new Set(VERDICTS.map(v => v.key))
  const entries: Array<[string, string, number]> = VERDICTS.map(v => [v.key, v.label, split[v.key] ?? 0])
  for (const [k, n] of Object.entries(split)) if (!known.has(k)) entries.push([k, k, n])
  const parts: string[] = []
  for (const [key, label, n] of entries) {
    if (n <= 0) continue
    const seg = el('span', `wb-led-seg is-${known.has(key) ? key : 'other'}`)
    seg.style.width = `${Math.max(2, (n / total) * 100)}%`
    bar.appendChild(seg)
    const item = el('span', 'wb-led-split-item')
    item.appendChild(el('i', `wb-led-swatch is-${known.has(key) ? key : 'other'}`))
    item.appendChild(document.createTextNode(`${label} ${n}`))
    legend.appendChild(item)
    parts.push(`${label} ${n}`)
  }
  bar.setAttribute('aria-label', `归档结局：${parts.join('，')}`)
  wrap.append(bar, legend)
  parent.appendChild(wrap)
}

type Card = { brief?: string; team: string; taskId: string; atText: string; inbound: boolean; chips: string[]; tone: 'danger' | 'warn' | 'muted' | 'quiet'; dead?: DeadRow }

export function renderLedger(pane: HTMLElement, ctx: LedgerContext): { badge: string; tone?: RailTone } {
  pane.replaceChildren()
  const { state, now } = ctx
  const pending = state.tasks ?? []
  const dead = state.tasksDead ?? []
  const archived = state.archivedCount ?? 0
  const receiptless = pending.filter(r => r.receiptExpected === false)
  const expected = pending.filter(r => r.receiptExpected !== false)
  const stale = expected.filter(r => now - r.startedAt > HOUR)
  const young = expected.filter(r => now - r.startedAt <= HOUR)
  const staleCount = state.tasksStaleCount ?? stale.length + receiptless.length

  const tiles = el('div', 'wb-led-tiles')
  tile(tiles, '待回执', pending.length, '等待回执的任务（pending），含陈旧与免回执行')
  tile(tiles, '陈旧', staleCount, '≥1h 无回执的旧账 + receiptExpected:false 的免回执行；到 24h TTL 自动转死信或过期', staleCount > 0 ? 'warn' : undefined)
  tile(tiles, '死信', dead.length, '超过 24h TTL 仍未结算，或目标早已离开；需清账（abandon）才能移出', dead.length > 0 ? 'danger' : undefined)
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
    meta.appendChild(el('span', 'wb-led-team')).textContent = `${c.inbound ? '来自' : '发往'} ${c.team}`
    meta.appendChild(el('span')).textContent = c.atText
    meta.appendChild(el('span', 'wb-led-task')).textContent = c.taskId
    for (const chip of c.chips) meta.appendChild(el('span', 'wb-led-chip')).textContent = chip
    node.appendChild(meta)
    node.title = `${c.taskId}\n${c.team}`
    if (c.dead !== undefined) {
      const row = c.dead
      const btn = el('button', 'wb-btn wb-led-abandon')
      btn.type = 'button'
      btn.textContent = '清账'
      btn.title = '从台账移出这条死信（abandon）'
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
    const head = el('div', 'wb-led-group-head')
    head.appendChild(el('span')).textContent = `${label} · ${rows}`
    head.appendChild(el('span', 'wb-led-group-hint')).textContent = hint
    g.appendChild(head)
    pane.appendChild(g)
    return g
  }
  const pendingCard = (r: PendingRow, tone: Card['tone']): Card => ({
    brief: r.brief, team: r.team, taskId: r.taskId, atText: `${ageText(r.startedAt, now)} 前派发`, inbound: r.direction === 'inbound', tone,
    chips: [...(r.settleable === true ? ['可结算'] : []), ...(r.receiptExpected === false ? ['无回执债'] : []), ...(r.direction === 'inbound' ? ['入站'] : []), ...(r.status !== 'pending' ? [r.status] : [])],
  })

  const gDead = section('死信', dead.length, 'danger', '需清账')
  if (gDead !== null) {
    for (const r of [...dead].sort((a, b) => b.deadAt - a.deadAt)) {
      card(gDead, { brief: r.brief, team: r.team, taskId: r.taskId, atText: `${ageText(r.deadAt, now)} 前死信`, inbound: false, tone: 'danger', dead: r,
        chips: r.reason !== undefined && r.reason !== '' && r.reason !== 'unspecified' ? [r.reason] : [] })
    }
  }
  const gStale = section('陈旧', stale.length, 'warn', '超过 1 小时仍无回执，可催办')
  if (gStale !== null) for (const r of [...stale].sort((a, b) => a.startedAt - b.startedAt)) card(gStale, pendingCard(r, 'warn'))
  const gWait = section('等待回执', young.length, 'quiet', '1 小时内')
  if (gWait !== null) for (const r of [...young].sort((a, b) => b.startedAt - a.startedAt)) card(gWait, pendingCard(r, 'quiet'))
  const gFree = section('免回执', receiptless.length, 'muted', '不等回执，24h 后自动归档')
  if (gFree !== null) for (const r of receiptless) card(gFree, pendingCard(r, 'muted'))

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

  const owed = pending.length + dead.length
  return { badge: owed > 0 ? String(owed) : '', tone: dead.length > 0 ? 'danger' : stale.length > 0 ? 'warn' : undefined }
}
