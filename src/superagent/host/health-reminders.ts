/**
 * superagent: the team's health reminders (docs/design/superagent-reliability.md, R7).
 *
 * The host looks at its health every 15 minutes. A problem that is new raises one decision card (P2: 去处理 or 先忽略
 * 24 小时); the same problem while it lasts raises nothing more, a problem that goes away takes its undecided card back,
 * and a decision holds the reminder off (24 h for 忽略, 1 h for anything else). The boot grace period raises nothing.
 * Each team's host keeps its own reminders.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/health-reminders
 */

/** One health problem, as health() reports it. */
export interface HealthProblem { readonly code: string; readonly session?: string; readonly ticketId?: string }

/** How often the host looks (reliability R7: 对照上游的每小时,这里 15 分钟). */
export const HEALTH_TICK_MS = 15 * 60_000
/** How long a decided hold-off lasts: a day for 先忽略, an hour otherwise. */
export const HOLD_IGNORE_MS = 24 * 3_600_000, HOLD_OTHER_MS = 3_600_000

/** The problems a reminder card is about, one key each. */
export const problemKey = (problem: HealthProblem): string => `${problem.code}:${problem.session ?? problem.ticketId ?? ''}`

/**
 * What a team raises and takes back, as its health changes.
 */
export class HealthReminders {
  private readonly open = new Map<string, string>()
  private readonly held = new Map<string, { readonly until: number }>()

  constructor(
    private readonly raise: (question: string, at: string) => string | undefined,
    private readonly takeBack: (cardId: string) => void,
    private readonly at: () => string,
  ) {}

  /** One look: raise cards for new problems, take back what went away, and hold off what was decided. */
  tick(problems: readonly HealthProblem[], now: number): void {
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
      const what = problem.session !== undefined ? `会话 ${problem.session}` : problem.ticketId !== undefined ? `工单 ${problem.ticketId}` : '团队'
      const cardId = this.raise(`健康自检：${what} 的问题 ${problem.code} 还在。`, this.at())
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
