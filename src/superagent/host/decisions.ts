/**
 * superagent: decision cards (docs/design/superagent-decision-cards.md).
 *
 * A decision the owner has to make is a card: a question, its options, the proposer's recommended option and a level. The
 * router and an observer raise cards of their own; a member's question on a ticket is a card too. A card's level decides how
 * it may be answered: P0 and P1 need the owner to pick an option, P2 and P3 can be approved with one click.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/decisions
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type DecisionLevel = 'P0' | 'P1' | 'P2' | 'P3'
const LEVELS: readonly string[] = ['P0', 'P1', 'P2', 'P3']
const OPTIONS_MIN = 2, OPTIONS_MAX = 6, OPTION_MAX = 300, QUESTION_MAX = 2_000
/** How many cards one proposer may have open at once: it acts on its own judgement, and a loop must not bury the owner. */
export const OPEN_CARDS_MAX = 10

export interface DecisionSpec { readonly level: DecisionLevel; readonly options: readonly string[]; readonly recommended: string }
export interface StoredCard extends DecisionSpec {
  readonly id: string
  readonly question: string
  readonly reason?: string
  readonly source: 'router' | 'observer' | 'ticket'
  readonly by: string
  readonly ticketId?: string
  readonly at: string
  readonly decided?: { readonly at: string; readonly text: string; readonly triggerId?: string }
}

/** Whether a level may be approved with one click. Absent a level the card is treated as P1, which may not. */
export const oneClick = (level: DecisionLevel): boolean => level === 'P2' || level === 'P3'

/**
 * Read a card's options, recommendation and level.
 * @param raw - `{ options, recommended, level? }`.
 * @returns the card's spec, or what is wrong with it.
 */
export function parseDecision(raw: { options?: unknown; recommended?: unknown; level?: unknown }): DecisionSpec | string {
  const options = Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === 'string').map(o => o.trim()).filter(o => o !== '') : []
  if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX || options.some(o => o.length > OPTION_MAX)) return `a decision needs ${String(OPTIONS_MIN)} to ${String(OPTIONS_MAX)} options of at most ${String(OPTION_MAX)} characters`
  if (new Set(options).size !== options.length) return 'the options must differ from each other'
  const recommended = typeof raw.recommended === 'string' ? raw.recommended.trim() : ''
  if (!options.includes(recommended)) return 'recommended must be one of the options, copied exactly'
  if (raw.level !== undefined && raw.level !== null && raw.level !== '' && !LEVELS.includes(String(raw.level))) return 'level must be P0, P1, P2 or P3'
  return { level: (LEVELS.includes(String(raw.level)) ? raw.level : 'P1') as DecisionLevel, options, recommended }
}

/** The stable id of a member's question on a ticket: a new question is a new card. */
export const ticketCardId = (ticketId: string, question: string): string => `t-${createHash('sha256').update(`${ticketId}\n${question}`).digest('hex').slice(0, 12)}`

export class DecisionBook {
  private cards: StoredCard[]
  constructor(private readonly path: string) {
    let loaded: StoredCard[] = []
    try { if (existsSync(path)) loaded = JSON.parse(readFileSync(path, 'utf8')) as StoredCard[] } catch { loaded = [] }
    this.cards = Array.isArray(loaded) ? loaded : []
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.cards), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path) } finally { rmSync(temporary, { force: true }) }
  }

  get(id: string): StoredCard | undefined { return this.cards.find(card => card.id === id) }
  open(): StoredCard[] { return this.cards.filter(card => card.decided === undefined) }

  /** A card of the router's or an observer's own. An identical open question returns the existing card. */
  propose(input: { source: 'router' | 'observer'; by: string; question: string; reason?: string; spec: DecisionSpec; at: string }): { ok: true; id: string; reused?: true } | { ok: false; code: string; error: string } {
    const question = input.question.trim()
    if (question === '' || question.length > QUESTION_MAX) return { ok: false, code: 'question', error: `question is required, at most ${String(QUESTION_MAX)} characters` }
    const mine = this.open().filter(card => card.source === input.source && card.by === input.by)
    const repeated = mine.find(card => card.question === question)
    if (repeated !== undefined) return { ok: true, id: repeated.id, reused: true }
    if (mine.length >= OPEN_CARDS_MAX) return { ok: false, code: 'too-many-open', error: `you already have ${String(mine.length)} decisions waiting for the owner` }
    const id = `d-${randomUUID()}`
    this.cards.push({ id, question, ...(input.reason !== undefined ? { reason: input.reason } : {}), source: input.source, by: input.by, at: input.at, ...input.spec })
    this.save()
    return { ok: true, id }
  }

  /** The card of a member's question on a ticket. */
  forTicket(input: { ticketId: string; by: string; question: string; spec: DecisionSpec; at: string }): void {
    const id = ticketCardId(input.ticketId, input.question)
    if (this.get(id) !== undefined) return
    this.cards.push({ id, question: input.question, source: 'ticket', by: input.by, ticketId: input.ticketId, at: input.at, ...input.spec })
    this.save()
  }

  /** Record what was decided; a question that had no card gets one, so it cannot be answered twice. */
  decide(id: string, decided: NonNullable<StoredCard['decided']>, fallback?: Omit<StoredCard, 'decided'>): void {
    const known = this.cards.some(card => card.id === id)
    this.cards = known ? this.cards.map(card => card.id === id ? { ...card, decided } : card) : [...this.cards, ...(fallback !== undefined ? [{ ...fallback, decided }] : [])]
    this.save()
  }
}
