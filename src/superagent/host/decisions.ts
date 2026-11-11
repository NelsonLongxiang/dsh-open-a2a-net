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
import { parseFileRef } from '../../blob-store.ts'

export type DecisionLevel = 'P0' | 'P1' | 'P2' | 'P3'
const LEVELS: readonly string[] = ['P0', 'P1', 'P2', 'P3']
const OPTIONS_MIN = 2, OPTIONS_MAX = 6, OPTION_MAX = 300, QUESTION_MAX = 2_000
/** How many cards one proposer may have open at once: it acts on its own judgement, and a loop must not bury the owner. */
export const OPEN_CARDS_MAX = 10
/** How long a decided card is kept, and how many at most: the record of what was decided, not an archive. */
export const DECIDED_KEEP_MS = 30 * 24 * 3_600_000, DECIDED_KEEP_MAX = 500

export interface DecisionSpec { readonly level: DecisionLevel; readonly options: readonly string[]; readonly recommended: string }
/** A file on a card (C8): staged on this host's file channel, granted to the team; `ref` is its "[A2A file] v1 …" line. */
export interface DecisionFile { readonly sha256: string; readonly size: number; readonly name: string; readonly ref: string }
/** How many files a card, or a decision on it, carries at most (the file channel's per-send limit). */
export const DECISION_FILES_MAX = 16
export interface StoredCard extends DecisionSpec {
  readonly id: string
  readonly question: string
  readonly reason?: string
  readonly source: 'router' | 'observer' | 'ticket' | 'health' | 'tool' | 'outbound'
  readonly by: string
  readonly ticketId?: string
  readonly at: string
  /** Files the proposer put on the card (C8). */
  readonly files?: readonly DecisionFile[]
  readonly decided?: { readonly at: string; readonly text: string; readonly triggerId?: string; readonly files?: readonly DecisionFile[] }
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

/** The owner's files on a decision (C8): `[A2A file] v1 …` reference lines, at most DECISION_FILES_MAX. */
export function decisionFiles(files: unknown): { ok: true; files: DecisionFile[] } | { ok: false; code: string; error: string } {
  const lines = files === undefined || files === null ? [] : Array.isArray(files) ? files.map(f => String(f).trim()) : [String(files)]
  if (lines.length > DECISION_FILES_MAX) return { ok: false, code: 'files', error: `a decision carries at most ${String(DECISION_FILES_MAX)} files` }
  const attached: DecisionFile[] = []
  for (const line of lines) {
    const ref = parseFileRef(line)
    if (ref === undefined) return { ok: false, code: 'files', error: 'each file must be an "[A2A file] v1 …" reference line' }
    attached.push({ sha256: ref.sha256, size: ref.size, name: ref.name, ref: line })
  }
  return { ok: true, files: attached }
}

export class DecisionBook {
  private cards: StoredCard[]
  /**
   * @param path - the file the cards live in.
   * @param ticketOpen - whether a ticket is still open: a member's card waits only as long as its ticket.
   * @param now - the clock, in milliseconds.
   */
  constructor(private readonly path: string, private readonly ticketOpen: (ticketId: string) => boolean = () => true, private readonly now: () => number = () => Date.now()) {
    let loaded: StoredCard[] = []
    try { if (existsSync(path)) loaded = JSON.parse(readFileSync(path, 'utf8')) as StoredCard[] } catch { loaded = [] }
    this.cards = Array.isArray(loaded) ? loaded : []
  }

  /**
   * Drop what no longer matters: a decided card past {@link DECIDED_KEEP_MS} or beyond the newest {@link DECIDED_KEEP_MAX},
   * and a member's undecided card whose ticket has ended. A card still waiting for the owner is never dropped.
   * @returns how many cards were dropped.
   */
  prune(): number {
    const cutoff = this.now() - DECIDED_KEEP_MS
    const decided = this.cards.filter(card => card.decided !== undefined).sort((a, b) => b.decided!.at.localeCompare(a.decided!.at))
    const keepDecided = new Set(decided.filter(card => Date.parse(card.decided!.at) >= cutoff).slice(0, DECIDED_KEEP_MAX).map(card => card.id))
    const before = this.cards.length
    this.cards = this.cards.filter(card => card.decided !== undefined ? keepDecided.has(card.id) : card.source !== 'ticket' || card.ticketId === undefined || this.ticketOpen(card.ticketId))
    return before - this.cards.length
  }

  private save(): void {
    this.prune()
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.cards), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path) } finally { rmSync(temporary, { force: true }) }
  }

  get(id: string): StoredCard | undefined { return this.cards.find(card => card.id === id) }

  /** A file on a card, put there by its proposer or with the owner's decision: what the owner may download (C8). */
  fileOf(id: string, sha256: string): DecisionFile | undefined {
    const card = this.get(id)
    return [...(card?.files ?? []), ...(card?.decided?.files ?? [])].find(file => file.sha256 === sha256)
  }
  open(): StoredCard[] { return this.cards.filter(card => card.decided === undefined) }

  /** The newest decided card of one proposer, if any (a declined tool request is not raised again for a while). */
  lastDecided(source: StoredCard['source'], by: string): StoredCard | undefined {
    return this.cards.filter(card => card.source === source && card.by === by && card.decided !== undefined).sort((a, b) => b.decided!.at.localeCompare(a.decided!.at))[0]
  }

  /** A card of the router's or an observer's own. An identical open question returns the existing card. */
  propose(input: { source: 'router' | 'observer' | 'health' | 'tool' | 'outbound'; by: string; question: string; reason?: string; spec: DecisionSpec; at: string; files?: readonly DecisionFile[] }): { ok: true; id: string; reused?: true } | { ok: false; code: string; error: string } {
    const question = input.question.trim()
    if (question === '' || question.length > QUESTION_MAX) return { ok: false, code: 'question', error: `question is required, at most ${String(QUESTION_MAX)} characters` }
    const mine = this.open().filter(card => card.source === input.source && card.by === input.by)
    const repeated = mine.find(card => card.question === question)
    if (repeated !== undefined) return { ok: true, id: repeated.id, reused: true }
    if (mine.length >= OPEN_CARDS_MAX) return { ok: false, code: 'too-many-open', error: `you already have ${String(mine.length)} decisions waiting for the owner` }
    const id = `d-${randomUUID()}`
    this.cards.push({ id, question, ...(input.reason !== undefined ? { reason: input.reason } : {}), source: input.source, by: input.by, at: input.at, ...input.spec, ...(input.files !== undefined && input.files.length > 0 ? { files: input.files } : {}) })
    this.save()
    return { ok: true, id }
  }

  /** The card of a member's question on a ticket. */
  forTicket(input: { ticketId: string; by: string; question: string; spec: DecisionSpec; at: string; files?: readonly DecisionFile[] }): void {
    const id = ticketCardId(input.ticketId, input.question)
    if (this.get(id) !== undefined) return
    this.cards.push({ id, question: input.question, source: 'ticket', by: input.by, ticketId: input.ticketId, at: input.at, ...input.spec, ...(input.files !== undefined && input.files.length > 0 ? { files: input.files } : {}) })
    this.save()
  }

  /** Take an undecided card back (reliability R7: a problem that went away recalls its reminder). */
  withdraw(id: string): void {
    if (this.cards.some(card => card.id === id && card.decided === undefined)) {
      this.cards = this.cards.filter(card => card.id !== id)
      this.save()
    }
  }

  /** Record what was decided; a question that had no card gets one, so it cannot be answered twice. */
  decide(id: string, decided: NonNullable<StoredCard['decided']>, fallback?: Omit<StoredCard, 'decided'>): void {
    const known = this.cards.some(card => card.id === id)
    this.cards = known ? this.cards.map(card => card.id === id ? { ...card, decided } : card) : [...this.cards, ...(fallback !== undefined ? [{ ...fallback, decided }] : [])]
    this.save()
  }
}
