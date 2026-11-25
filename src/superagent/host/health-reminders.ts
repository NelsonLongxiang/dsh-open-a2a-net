/**
 * superagent: the team's health reminders (docs/design/superagent-reliability.md, R7).
 *
 * The host looks at its health every 15 minutes. A problem that is new raises one decision card (P2: 去处理 or 先忽略
 * 24 小时); the same problem while it lasts raises nothing more, a problem that goes away takes its undecided card back,
 * and a decision holds the reminder off (24 h for 忽略, an hour otherwise). The boot grace period raises nothing.
 * Each team's host keeps its own reminders. The card carries its problem's key in `reason`, so a restart rebuilds the
 * pairing from the open cards and a problem that went away while the host was down still takes its card back.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/health-reminders
 */

/** One health problem, as health() reports it. */
export interface HealthProblem { readonly code: string; readonly session?: string; readonly name?: string; readonly ticketId?: string; readonly detail?: string; readonly title?: string; readonly reason?: string; readonly repo?: string; readonly count?: number; readonly minutes?: number }

/** How often the host looks (reliability R7: 对照上游的每小时,这里 15 分钟). */
export const HEALTH_TICK_MS = 15 * 60_000
/** How long a decided hold-off lasts: a day for 先忽略, an hour otherwise. */
export const HOLD_IGNORE_MS = 24 * 3_600_000, HOLD_OTHER_MS = 3_600_000

/**
 * How long the observer has to act on a health problem before it reaches the owner (workbench-market 18 §八: the same
 * one-hour quiet period as the health check).
 */
export const OBSERVER_SILENCE_MS = 3_600_000

/**
 * Who sees a health problem first (workbench-market 18 §八, reliability R7a): the team's observer, when it has one whose
 * session is loaded and the problem is not about that observer. `pick` names it, `tell` delivers the notice.
 */
export interface HealthObserver {
  readonly pick: (problem: HealthProblem) => string | undefined
  readonly tell: (observer: string, text: string) => boolean
  /**
   * #754 review: where the observer's hour is kept across restarts. Without it a host that restarts more often than
   * once an hour would tell the observer again each time and the owner would never get the card.
   */
  readonly persist?: { readonly load: () => ReadonlyArray<{ key: string; observer: string; since: number }>; readonly save: (rows: ReadonlyArray<{ key: string; observer: string; since: number }>) => void }
}

/** The token an observer's request or card carries so the host can see it acted on one problem. */
export const healthToken = (key: string): string => `[健康 ${key}]`

/** What the observer is told about a problem it sees first. */
export const observerNotice = (problem: HealthProblem, key: string): string =>
  `[superagent health] 健康自检：${problemText(problem)}。宿主先交给你（观察者），一小时内没有处理就直接交属主。处理指：针对它开一张单（a2a_ticket_request），或提一张决策卡（a2a_decision_propose），正文里写上 ${healthToken(key)}；只读或只在会话里说过都不算。`

/** The problems a reminder card is about, one key each. */
export const problemKey = (problem: HealthProblem): string => problem.code === 'tickets-queued'
  // One card per thing the tickets wait for: the oldest ticket in the group changes as tickets launch, the member does not.
  ? `${problem.code}:${problem.reason ?? ''}:${problem.session ?? problem.repo ?? ''}`
  : `${problem.code}:${problem.session ?? problem.ticketId ?? problem.title ?? ''}`

/** Why queued tickets wait, as a person reads it (field report 2026-11-19). */
export function queuedText(problem: HealthProblem, name: (session: string) => string = s => s): string {
  const who = problem.session !== undefined ? name(problem.session) : ''
  const waits = problem.reason === 'member-busy' ? `在等成员 ${who}，它手上的工单没结束；可让总工用 superagent_assign 改派给空闲成员`
    : problem.reason === 'member-absent' ? `在等成员 ${who}，它已不在团队里；请总工改派`
    : problem.reason === 'no-repo-member' ? `只能派给负责仓库 ${problem.repo ?? ''} 的成员，团队里没有这样的成员；在设置里给成员填仓库，或请总工改派`
    : problem.reason === 'repo-busy' ? `只能派给负责仓库 ${problem.repo ?? ''} 的成员，他们都在忙`
    : problem.reason === 'delivery-refused' ? `派给成员 ${who} 时被拒绝，还在重试；看看这个成员的会话或它所在主机是否接收，或请总工改派`
    : problem.reason === 'launch-stalled' ? '有空闲成员，但这些工单一直没派出去，原因不明；可请总工改派，或查看主机日志'
    : problem.reason === 'all-excluded' ? `可派的成员都被排除了：属主在凭据访问审计卡上把这项工作从 ${who} 手上停掉，宿主不会再派给它；请给团队加成员，或手动处理这张工单`
    : problem.reason === 'at-cap' ? '团队已到同时运行的上限'
    : '所有成员都在忙'
  return `${String(problem.count ?? 1)} 张工单排队超过 ${String(problem.minutes ?? 0)} 分钟（最久的是「${problem.title ?? problem.ticketId ?? ''}」）：${waits}`
}

/** What a problem's card says, in the words the health banner already uses (no internal codes). */
/** The member a problem is about: its seat name or title when the host has one, else the session id. */
/** The longest member name a health problem shows: the banner's `detail` is cut at the same length. */
export const NAME_MAX = 120
/**
 * A member's name as it is shown (follow-up of the #846 review): the name comes from the session's own metadata and was printed
 * as it is. Only the display changes, never the problem's key (that is the session id). An empty result means "no name".
 */
export const cleanName = (name: string | undefined): string | undefined => {
  if (name === undefined) return undefined
  // Line breaks and tabs become one space; other control characters, bidirectional controls and invisible marks are dropped.
  // The joiners U+200C and U+200D stay: composite emoji (a family) and several scripts (Persian) need them. Tag characters
  // (U+E0000..) stay too: subdivision-flag emoji are made of them, and a name comes from the session's own metadata.
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\n\r\t\u2028\u2029]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').replace(/ {2,}/g, ' ').trim()
  if (clean === '') return undefined
  const chars = Array.from(clean)
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : clean
}
const whoOf = (problem: HealthProblem): string => cleanName(problem.name) ?? problem.session ?? ''

export const problemText = (problem: HealthProblem): string =>
  problem.code === 'router-not-loaded' ? `总工会话 ${whoOf(problem)} 没有加载，需求送不到它，打开这个会话即可`
  : problem.code === 'receipt-unsettled' ? `工单「${problem.title ?? ''}」收到的回执（${problem.detail ?? ''}）没有被网络台账正向结算，没有写进工单；请求仍在等待结果，请人工查看`
  : problem.code === 'outbound-note-pending' ? `工单「${problem.title ?? ''}」对外请求（${problem.detail ?? ''}）的回执已收到并保存，但写进工单的备注还没写成，系统会继续重试`
  : problem.code === 'outbound-note-ticket-ended' ? `工单「${problem.title ?? ''}」已结束后才收到对外请求（${problem.detail ?? ''}）的回执：没有重开工单，也不会重发原请求，回执已保存，请人工查看`
  : problem.code === 'decision-push-refused' ? `决策卡 ${problem.title ?? ''} 没有推到市场：${problem.detail ?? ''}；市场上这张卡会停在原来的状态，请在本机工作台上处理`
  : problem.code === 'router-turn-failed' ? `总工会话 ${whoOf(problem)} 上一回合失败（${problem.detail ?? '未知原因'}），需求在等它判断；常见原因是模型额度用完或服务中断`
  : problem.code === 'mcp-no-seat' ? `团队 MCP 服务器 ${problem.title ?? ''} 还用不了：团队里还没有带席位 id 的成员，市场只给名册里的席位发令牌`
  : problem.code === 'mcp-token-unavailable' ? `团队 MCP 服务器 ${problem.title ?? ''} 换不到席位令牌，成员对它的调用会失败：${problem.detail ?? ''}`
  : problem.code === 'member-not-loaded' ? `成员会话 ${whoOf(problem)} 没有加载，工单派不给它，打开这个会话即可`
  : problem.code === 'tickets-queued' ? queuedText(problem, session => cleanName(problem.name) ?? session)
  : problem.code === 'session-wait-overdue' ? `成员会话 ${whoOf(problem)} 登记的等待已过期限（${problem.detail ?? ''}，已过 ${String(problem.minutes ?? 0)} 分钟），还没有被叫醒；工单「${problem.title ?? problem.ticketId ?? ''}」`
  : problem.code === 'session-orphan-stop' ? `成员会话 ${whoOf(problem)} 上一次停下是孤儿停（没做完，也没登记任何会叫它回来的东西）；工单「${problem.title ?? problem.ticketId ?? ''}」`
  : problem.code === 'session-no-selfcheck' ? `成员会话 ${whoOf(problem)} 持单 ${String(problem.minutes ?? 0)} 分钟，一条收尾自查记录都没有（可能出错、中断或没加载）；工单「${problem.title ?? problem.ticketId ?? ''}」`
  : problem.ticketId !== undefined ? `工单 ${problem.ticketId} 很久没有动静`
  : `问题 ${problem.code}`

/**
 * What a team raises and takes back, as its health changes.
 */
export class HealthReminders {
  private readonly open = new Map<string, string>()
  private readonly held = new Map<string, { readonly until: number }>()
  /** Problems the observer was told about and has not acted on yet; kept through `observer.persist` across restarts. */
  private readonly pending = new Map<string, { readonly observer: string; readonly since: number }>()
  private loaded = false

  constructor(
    private readonly raise: (question: string, key: string, at: string) => string | undefined,
    private readonly takeBack: (cardId: string) => void,
    private readonly openCards: () => ReadonlyArray<{ id: string; reason?: string }>,
    private readonly at: () => string,
    private readonly observer?: HealthObserver,
  ) {}

  /** One look: rebuild the pairing from the open cards, take back what went away, raise cards for what is new. */
  /** Read the kept observer hours once; a broken store starts empty rather than failing the look. */
  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      for (const row of this.observer?.persist?.load() ?? []) {
        if (typeof row.key === 'string' && typeof row.observer === 'string' && Number.isFinite(row.since)) this.pending.set(row.key, { observer: row.observer, since: row.since })
      }
    } catch { /* start empty */ }
  }

  /** Keep the observer hours; a failed write leaves them in memory for this run. */
  private save(): void {
    try { this.observer?.persist?.save(this.observerHolds()) } catch { /* memory still holds them */ }
  }

  tick(problems: readonly HealthProblem[], now: number): void {
    this.load()
    const before = JSON.stringify(this.observerHolds())
    // A restart empties the map: the open cards say which problems still have a card (the key rides in reason).
    if (this.open.size === 0) for (const card of this.openCards()) if (card.reason !== undefined) this.open.set(card.reason, card.id)
    const keys = new Set(problems.map(problemKey))
    for (const [key, cardId] of [...this.open]) {
      if (keys.has(key)) continue
      this.takeBack(cardId)
      this.open.delete(key)
      this.held.delete(key)
    }
    for (const key of [...this.pending.keys()]) if (!keys.has(key)) this.pending.delete(key)
    for (const problem of problems) {
      const key = problemKey(problem)
      if (this.open.has(key)) continue
      const hold = this.held.get(key)
      if (hold !== undefined && now < hold.until) continue
      this.held.delete(key)
      // R7a: the observer sees it first; the owner gets it when there is none, it is not loaded, or it did not act in time.
      const told = this.pending.get(key)
      let observer: string | undefined
      let why = ''
      try { observer = this.observer?.pick(problem) }
      catch { why = '（观察者状态无法读取，转交属主）' }
      if (told !== undefined) {
        if (observer === told.observer && now - told.since < OBSERVER_SILENCE_MS) continue
        this.pending.delete(key)
        why ||= observer === told.observer ? '（观察者一小时内没有处理）' : '（观察者会话没有加载）'
      } else if (observer !== undefined) {
        // Reserve before the callback: an observer that acts synchronously must not lose that accepted action.
        const reservation = { observer, since: now }
        this.pending.set(key, reservation)
        let delivered = false
        try { delivered = this.observer!.tell(observer, observerNotice(problem, key)) === true }
        catch { why = '（观察者通知交付未确认，转交属主）' }
        if (delivered) continue
        if (this.pending.get(key) === reservation) this.pending.delete(key)
        why ||= '（观察者通知未送达，转交属主）'
      }
      const cardId = this.raise(`健康自检：${problemText(problem)}。${why}`, key, this.at())
      if (cardId !== undefined) this.open.set(key, cardId)
    }
    if (JSON.stringify(this.observerHolds()) !== before) this.save()
  }

  /**
   * The observer filed a request or raised a card (R7a): each problem it was told about whose token the text carries is
   * handled, and held off for an hour like a decided card; if it lasts, the observer is told again.
   */
  observerActed(observer: string, text: string, at: number): void {
    this.load()
    let changed = false
    for (const [key, told] of [...this.pending]) {
      if (told.observer !== observer || !text.includes(healthToken(key))) continue
      this.pending.delete(key)
      this.held.set(key, { until: at + HOLD_OTHER_MS })
      changed = true
    }
    if (changed) this.save()
  }

  /** The problems the observer holds now, for the state and tests. */
  observerHolds(): ReadonlyArray<{ key: string; observer: string; since: number }> { return [...this.pending].map(([key, told]) => ({ key, ...told })) }

  /** The owner decided a reminder: hold its problem off, a day for 忽略, an hour otherwise. */
  decided(cardId: string, chosen: string, at: number): void {
    for (const [key, id] of [...this.open]) {
      if (id !== cardId) continue
      this.open.delete(key)
      this.held.set(key, { until: at + (chosen.includes('忽略') ? HOLD_IGNORE_MS : HOLD_OTHER_MS) })
      return
    }
  }
}
