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
export interface HealthProblem { readonly code: string; readonly session?: string; readonly ticketId?: string; readonly detail?: string; readonly title?: string }

/** How often the host looks (reliability R7: 对照上游的每小时,这里 15 分钟). */
export const HEALTH_TICK_MS = 15 * 60_000
/** How long a decided hold-off lasts: a day for 先忽略, an hour otherwise. */
export const HOLD_IGNORE_MS = 24 * 3_600_000, HOLD_OTHER_MS = 3_600_000

/** The problems a reminder card is about, one key each. */
export const problemKey = (problem: HealthProblem): string => `${problem.code}:${problem.session ?? problem.ticketId ?? problem.title ?? ''}`

/** What a problem's card says, in the words the health banner already uses (no internal codes). */
export const problemText = (problem: HealthProblem): string =>
  problem.code === 'router-not-loaded' ? `总工会话 ${problem.session ?? ''} 没有加载，需求送不到它，打开这个会话即可`
  : problem.code === 'router-turn-failed' ? `总工会话 ${problem.session ?? ''} 上一回合失败（${problem.detail ?? '未知原因'}），需求在等它判断；常见原因是模型额度用完或服务中断`
  : problem.code === 'mcp-no-seat' ? `团队 MCP 服务器 ${problem.title ?? ''} 还用不了：团队里还没有带席位 id 的成员，市场只给名册里的席位发令牌`
  : problem.code === 'mcp-token-unavailable' ? `团队 MCP 服务器 ${problem.title ?? ''} 换不到席位令牌，成员对它的调用会失败：${problem.detail ?? ''}`
  : problem.code === 'member-not-loaded' ? `成员会话 ${problem.session ?? ''} 没有加载，工单派不给它，打开这个会话即可`
  : problem.ticketId !== undefined ? `工单 ${problem.ticketId} 很久没有动静`
  : `问题 ${problem.code}`

/**
 * What a team raises and takes back, as its health changes.
 */
export class HealthReminders {
  private readonly open = new Map<string, string>()
  private readonly held = new Map<string, { readonly until: number }>()

  constructor(
    private readonly raise: (question: string, key: string, at: string) => string | undefined,
    private readonly takeBack: (cardId: string) => void,
    private readonly openCards: () => ReadonlyArray<{ id: string; reason?: string }>,
    private readonly at: () => string,
  ) {}

  /** One look: rebuild the pairing from the open cards, take back what went away, raise cards for what is new. */
  tick(problems: readonly HealthProblem[], now: number): void {
    // A restart empties the map: the open cards say which problems still have a card (the key rides in reason).
    if (this.open.size === 0) for (const card of this.openCards()) if (card.reason !== undefined) this.open.set(card.reason, card.id)
    const keys = new Set(problems.map(problemKey))
    for (const [key, cardId] of [...this.open]) {
      if (keys.has(key)) continue
      this.takeBack(cardId)
      this.open.delete(key)
      this.held.delete(key)
    }
    for (const problem of problems) {
      const key = problemKey(problem)
      if (this.open.has(key)) continue
      const hold = this.held.get(key)
      if (hold !== undefined && now < hold.until) continue
      this.held.delete(key)
      const cardId = this.raise(`健康自检：${problemText(problem)}。`, key, this.at())
      if (cardId !== undefined) this.open.set(key, cardId)
    }
  }

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
