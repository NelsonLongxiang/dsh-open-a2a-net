/**
 * superagent: a member's question goes to the team's observer first (docs/design/superagent-reliability.md R7b;
 * workbench-market 18 and #880).
 *
 * When a member reports `question` or `blocked` with a question for a person, a loaded observer is told first, with the
 * token `[提问 <ticket>]`, and the person path (the router's relay and the ticket's decision card) waits. The observer
 * handles it with a note on that ticket (`a2a_ticket_note`), a request (`a2a_ticket_request`) or a card
 * (`a2a_decision_propose`) whose text carries the token. The question goes on to the person by the existing route when
 * the team has no observer, the observer's session is not loaded, the observer does not handle it within an hour, or the
 * ticket still waits on its question an hour after the observer handled it (the backstop). After the observer leaves a
 * note on a ticket, a new question on it within the hour goes straight to the person (no loop). The person's clock
 * (workbench-market 15: a day unanswered reaches the domain lead) starts when the question reaches the person; the
 * observer's hour is not counted. All of it is kept in the team's `observer-questions.json`, so a restart neither tells
 * the observer again nor restarts an hour.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/question-gate
 */

/** The observer's hour, the backstop's hour and the no-loop window. */
export const QUESTION_SILENCE_MS = 3_600_000

/** The token an observer's note, request or card carries for one ticket's question. */
export const questionToken = (ticketId: string): string => `[提问 ${ticketId}]`

/** What the observer is told. */
export const questionNotice = (ticketId: string, title: string, question: string): string =>
  `[superagent question] 工单「${title}」(${ticketId}) 的执行方在等人回答：${question}\n宿主先交给你（观察者）。先判断缺的是背景还是没去查：没去查的指路，缺背景且你的上下文够的就答，不够的收窄成一张决策卡。处理方式：用 a2a_ticket_note 在这张单上留言、a2a_ticket_request 开单，或 a2a_decision_propose 提卡，正文写上 ${questionToken(ticketId)}。一小时内没有处理，或处理后一小时单子仍在等，宿主按原路交给人。`

interface Told { readonly observer: string; readonly since: number }
interface Kept { pending: Array<[string, Told]>; handled: Array<[string, Told]>; noted: Array<[string, number]>; reached: Array<[string, number]> }

export interface QuestionGateDeps {
  /** The team's loaded observer, other than `reporter`; undefined when there is none. */
  readonly pick: (reporter: string) => string | undefined
  /** Whether the observer's session is still loaded. */
  readonly loaded: (observer: string) => boolean
  readonly tell: (observer: string, text: string) => boolean
  readonly persist?: { readonly load: () => unknown; readonly save: (kept: Kept) => void }
}

/** Where a question went. */
export type QuestionRoute = 'observer' | 'person'

export class QuestionGate {
  private readonly pending = new Map<string, Told>()
  private readonly handled = new Map<string, Told>()
  private readonly noted = new Map<string, number>()
  private readonly reached = new Map<string, number>()
  private loaded = false

  constructor(private readonly d: QuestionGateDeps) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const kept = this.d.persist?.load() as Partial<Kept> | undefined
      const pairs = <T>(rows: unknown, ok: (v: unknown) => v is T): Array<[string, T]> => Array.isArray(rows) ? rows.filter((r): r is [string, T] => Array.isArray(r) && typeof r[0] === 'string' && ok(r[1])) : []
      const told = (v: unknown): v is Told => typeof v === 'object' && v !== null && typeof (v as Told).observer === 'string' && Number.isFinite((v as Told).since)
      const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
      for (const [k, v] of pairs(kept?.pending, told)) this.pending.set(k, v)
      for (const [k, v] of pairs(kept?.handled, told)) this.handled.set(k, v)
      for (const [k, v] of pairs(kept?.noted, time)) this.noted.set(k, v)
      for (const [k, v] of pairs(kept?.reached, time)) this.reached.set(k, v)
    } catch { /* start empty */ }
  }

  private save(): void {
    try { this.d.persist?.save({ pending: [...this.pending], handled: [...this.handled], noted: [...this.noted], reached: [...this.reached] }) } catch { /* memory still holds it */ }
  }

  /**
   * A member asked a person a question on `ticketId`. Returns where it goes now: to the observer (the person path waits)
   * or to the person (the clock starts).
   */
  ask(ticketId: string, reporter: string, title: string, question: string, now: number): QuestionRoute {
    this.load()
    this.handled.delete(ticketId)
    const notedAt = this.noted.get(ticketId)
    const observer = notedAt !== undefined && now - notedAt < QUESTION_SILENCE_MS ? undefined : this.d.pick(reporter)
    if (observer !== undefined && this.d.tell(observer, questionNotice(ticketId, title, question))) {
      this.pending.set(ticketId, { observer, since: now })
      this.reached.delete(ticketId)
      this.save()
      return 'observer'
    }
    this.pending.delete(ticketId)
    this.reached.set(ticketId, now)
    this.save()
    return 'person'
  }

  /** The observer filed a request, raised a card or left a note: each pending question whose token the text carries is handled. */
  acted(observer: string, text: string, now: number): void {
    this.load()
    let changed = false
    for (const [ticketId, told] of [...this.pending]) {
      if (told.observer !== observer || !text.includes(questionToken(ticketId))) continue
      this.pending.delete(ticketId)
      this.handled.set(ticketId, { observer, since: now })
      changed = true
    }
    if (changed) this.save()
  }

  /** The observer left a note on `ticketId` (the no-loop window starts). */
  notedOn(ticketId: string, now: number): void {
    this.load()
    this.noted.set(ticketId, now)
    this.save()
  }

  /** Whether the person path for `ticketId`'s question waits on the observer. */
  held(ticketId: string): boolean {
    this.load()
    return this.pending.has(ticketId) || this.handled.has(ticketId)
  }

  /** When `ticketId`'s question reached a person (the person's clock), if it has. */
  reachedAt(ticketId: string): number | undefined {
    this.load()
    return this.reached.get(ticketId)
  }

  /**
   * One look. `waiting` says whether a ticket still waits on its question. Returns the tickets whose question goes on to
   * the person now, with why.
   */
  tick(waiting: (ticketId: string) => boolean, now: number): Array<{ ticketId: string; why: 'unloaded' | 'silent' | 'still-waiting' }> {
    this.load()
    const out: Array<{ ticketId: string; why: 'unloaded' | 'silent' | 'still-waiting' }> = []
    let changed = false
    for (const [ticketId, told] of [...this.pending]) {
      if (!waiting(ticketId)) { this.pending.delete(ticketId); changed = true; continue }
      const why = !this.d.loaded(told.observer) ? 'unloaded' as const : now - told.since >= QUESTION_SILENCE_MS ? 'silent' as const : undefined
      if (why === undefined) continue
      this.pending.delete(ticketId); this.reached.set(ticketId, now); out.push({ ticketId, why }); changed = true
    }
    for (const [ticketId, told] of [...this.handled]) {
      if (!waiting(ticketId)) { this.handled.delete(ticketId); changed = true; continue }
      if (now - told.since < QUESTION_SILENCE_MS) continue
      this.handled.delete(ticketId); this.reached.set(ticketId, now); out.push({ ticketId, why: 'still-waiting' }); changed = true
    }
    // Forget clocks and notes of tickets no longer waiting.
    for (const ticketId of [...this.reached.keys()]) if (!waiting(ticketId)) { this.reached.delete(ticketId); changed = true }
    for (const [ticketId, at] of [...this.noted]) if (now - at >= QUESTION_SILENCE_MS) { this.noted.delete(ticketId); changed = true }
    if (changed) this.save()
    return out
  }

  /** What the observer holds now, for the state and tests. */
  holds(): { pending: string[]; handled: string[] } {
    this.load()
    return { pending: [...this.pending.keys()], handled: [...this.handled.keys()] }
  }
}
