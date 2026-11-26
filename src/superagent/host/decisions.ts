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
import { validObserverCardState, type ObserverCardBinding, type ObserverDecision } from './observer-decisions.ts'

export type DecisionLevel = 'P0' | 'P1' | 'P2' | 'P3'
const LEVELS: readonly string[] = ['P0', 'P1', 'P2', 'P3']
// #923: options up to 1,000 characters (13080 hit 300); the market push cuts them to its own v1 limit.
const OPTIONS_MIN = 2, OPTIONS_MAX = 6, OPTION_MAX = 1_000, QUESTION_MAX = 2_000
/** How many cards one proposer may have open at once: it acts on its own judgement, and a loop must not bury the owner. */
export const OPEN_CARDS_MAX = 10
/** How long a decided card is kept, and how many at most: the record of what was decided, not an archive. */
export const DECIDED_KEEP_MS = 30 * 24 * 3_600_000, DECIDED_KEEP_MAX = 500

/** #888 D1: what the owner must fill in when choosing one option: words, files, or both, and what to write. */
export interface DecisionInput { readonly kind: 'text' | 'file' | 'text+file'; readonly prompt: string }
export const INPUT_KINDS: readonly string[] = ['text', 'file', 'text+file']
export const INPUT_PROMPT_MAX = 300
export interface DecisionSpec {
  readonly level: DecisionLevel
  readonly options: readonly string[]
  readonly recommended: string
  /** #888 D1: per option, what the owner must fill in to choose it. Absent when no option needs input. */
  readonly inputs?: Readonly<Record<string, DecisionInput>>
}

/** #888 D1: whether any option needs the owner to fill something in (derived, never stored). */
export const needsInput = (card: Pick<DecisionSpec, 'inputs'>): boolean => card.inputs !== undefined && Object.keys(card.inputs).length > 0
/** #888 D1: whether the recommended option needs input (derived, never stored); such a card has no one-click approval. */
export const recommendedNeedsInput = (card: Pick<DecisionSpec, 'inputs' | 'recommended'>): boolean => card.recommended !== '' && card.inputs !== undefined && Object.prototype.hasOwnProperty.call(card.inputs, card.recommended)
/** #888 D1: what choosing `option` requires, if anything. */
export const inputFor = (card: Pick<DecisionSpec, 'inputs'>, option: string): DecisionInput | undefined => card.inputs !== undefined && Object.prototype.hasOwnProperty.call(card.inputs, option) ? card.inputs[option] : undefined

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
/** Control characters other than a tab. */
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/

/**
 * #888 D1: read the `inputs` of a card against its options. A missing or empty object means none; anything malformed is a
 * reason to refuse the whole card.
 */
export function parseInputs(raw: unknown, options: readonly string[]): { ok: true; inputs?: Record<string, DecisionInput> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'inputs must be an object keyed by option' }
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return { ok: false, error: 'inputs must be a plain object keyed by option' }
  const keys = Object.keys(raw)
  if (keys.length === 0) return { ok: true }
  const inputs: Record<string, DecisionInput> = {}
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) return { ok: false, error: `inputs cannot use the key ${key}` }
    if (!options.includes(key)) return { ok: false, error: `each inputs key must be one of the options, copied exactly (${key.slice(0, 60)})` }
    const entry = (raw as Record<string, unknown>)[key]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, error: `inputs for ${key.slice(0, 60)} must be { kind, prompt }` }
    const { kind, prompt } = entry as { kind?: unknown; prompt?: unknown }
    if (typeof kind !== 'string' || !INPUT_KINDS.includes(kind)) return { ok: false, error: 'an input kind must be text, file or text+file' }
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (text === '' || text.length > INPUT_PROMPT_MAX) return { ok: false, error: `an input prompt is required, at most ${String(INPUT_PROMPT_MAX)} characters` }
    if (CONTROL.test(text)) return { ok: false, error: 'an input prompt cannot hold control characters' }
    inputs[key] = { kind: kind as DecisionInput['kind'], prompt: text }
  }
  return { ok: true, inputs }
}
/** A file on a card (C8): staged on this host's file channel, granted to the team; `ref` is its "[A2A file] v1 …" line. */
export interface DecisionFile { readonly sha256: string; readonly size: number; readonly name: string; readonly ref: string }
/** How many files a card, or a decision on it, carries at most (the file channel's per-send limit). */
export const DECISION_FILES_MAX = 16
/** #888 D3: an owner's words on a decision, at most (the same limit as answering a ticket's question). */
export const DECISION_NOTE_MAX = 20_000
export interface StoredCard extends DecisionSpec {
  readonly id: string
  readonly question: string
  readonly reason?: string
  readonly source: 'router' | 'observer' | 'ticket' | 'health' | 'tool' | 'outbound' | 'staffing' | 'sender'
  readonly by: string
  readonly ticketId?: string
  /** Server-owned immutable payload of an outbound approval, never supplied by the recovery caller. */
  readonly outbound?: { readonly ticketId: string; readonly address: string; readonly text: string; readonly team: string; readonly title: string }
  readonly at: string
  /** Files the proposer put on the card (C8). */
  readonly files?: readonly DecisionFile[]
  readonly observerBinding?: ObserverCardBinding
  readonly observerDecision?: ObserverDecision
  readonly ownerDecisionAttempt?: { readonly at: string; readonly generation: string; readonly option?: number }
  /** `by: 'host'` only on the host's automatic decision (#888 D5); the owner's own decision never carries it. */
  readonly decided?: { readonly at: string; readonly text: string; readonly triggerId?: string; readonly files?: readonly DecisionFile[]; readonly by?: 'host' | 'observer'; /** #935 review: the chosen option's position in `options`, recorded when an option was chosen (absent for words only, and on older records). */ readonly option?: number }
  /** The host closed this card as 「知道了」 on a timeout (owner 2026-11-23): the audit record; it stays when the owner decides again. */
  readonly autoAck?: { readonly at: string; readonly by: 'host'; readonly rule: 'credential-ack-timeout'; readonly minutes: number }
  /**
   * #888 D5: the host took the recommendation on the owner's setting (written before `decided`, which carries the same at).
   * It is not the owner's decision: the owner may decide again, and the same question may be asked again.
   */
  readonly autoApproved?: { readonly at: string; readonly by: 'host'; readonly rule: 'auto-approve'; readonly minutes: number; readonly deliveryId: string; readonly deliveredAt?: string }
}

/** The decision text of a credential-access card the host closed on its timeout. */
export const AUTO_ACK_TEXT = '决定：知道了（超时自动）'

/** #888 D5: the decided text of a card the host took on the owner's setting (its first line stays 决定：<option>). */
export const autoApprovedText = (option: string): string => `决定：${option}\n说明：宿主按属主设置自动采纳推荐项（非属主本人）`
/** #888 D5: whether a card's decision is still the host's automatic one (not the owner's own). */
// #894 review B2: told apart by who decided, not by time (the owner may decide in the same millisecond).
export const autoDecided = (card: StoredCard): boolean => card.autoApproved !== undefined && card.decided?.by === 'host'

/** Whether a level may be approved with one click. Absent a level the card is treated as P1, which may not. */
export const oneClick = (level: DecisionLevel): boolean => level === 'P2' || level === 'P3'

/**
 * Read a card's options, recommendation and level.
 * @param raw - `{ options, recommended, level? }`.
 * @returns the card's spec, or what is wrong with it.
 */
export function parseDecision(raw: { options?: unknown; recommended?: unknown; level?: unknown; inputs?: unknown }): DecisionSpec | string {
  const options = Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === 'string').map(o => o.trim()).filter(o => o !== '') : []
  if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX || options.some(o => o.length > OPTION_MAX)) return `a decision needs ${String(OPTIONS_MIN)} to ${String(OPTIONS_MAX)} options of at most ${String(OPTION_MAX)} characters`
  if (new Set(options).size !== options.length) return 'the options must differ from each other'
  const recommended = typeof raw.recommended === 'string' ? raw.recommended.trim() : ''
  if (!options.includes(recommended)) return 'recommended must be one of the options, copied exactly'
  if (raw.level !== undefined && raw.level !== null && raw.level !== '' && !LEVELS.includes(String(raw.level))) return 'level must be P0, P1, P2 or P3'
  const inputs = parseInputs(raw.inputs, options)
  if (!inputs.ok) return inputs.error
  return { level: (LEVELS.includes(String(raw.level)) ? raw.level : 'P1') as DecisionLevel, options, recommended, ...(inputs.inputs !== undefined ? { inputs: inputs.inputs } : {}) }
}

/** #923: an option's stable id on its card: its position, o1..o6 (a card's options never change once it is raised). */
export const optionId = (index: number): string => `o${String(index + 1)}`

/**
 * #923: the option a decider means: the option's exact text first, then its id (`o2`), then its 1-based number (`2`).
 * @param options - the card's options.
 * @param value - what the decider sent.
 * @returns the option's text, or undefined when it names none.
 */
export function resolveOption(options: readonly string[], value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 ? options[value - 1] : undefined
  if (typeof value !== 'string') return undefined
  if (options.includes(value)) return value
  const text = value.trim()
  if (options.includes(text)) return text
  const m = /^o?(\d{1,2})$/i.exec(text)
  if (m === null) return undefined
  const n = Number(m[1])
  return n >= 1 ? options[n - 1] : undefined
}

/** #923: what a listing adds to a card so a decider can name an option by id: the ids, and the recommendation's. */
export function optionIds(card: { readonly options?: readonly string[]; readonly recommended?: string }): { optionIds: string[]; recommendedId?: string } {
  const options = card.options ?? []
  const at = card.recommended !== undefined && card.recommended !== '' ? options.indexOf(card.recommended) : -1
  return { optionIds: options.map((_, index) => optionId(index)), ...(at >= 0 ? { recommendedId: optionId(at) } : {}) }
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
  readonly observerStorageReady: boolean
  /**
   * @param path - the file the cards live in.
   * @param ticketOpen - whether a ticket is still open: a member's card waits only as long as its ticket.
   * @param now - the clock, in milliseconds.
   */
  constructor(private readonly path: string, private readonly ticketOpen: (ticketId: string) => boolean = () => true, private readonly now: () => number = () => Date.now()) {
    let loaded: StoredCard[] = []
    let readable = true
    try { if (existsSync(path)) loaded = JSON.parse(readFileSync(path, 'utf8')) as StoredCard[] } catch { readable = false }
    this.cards = Array.isArray(loaded) ? loaded.filter(card => card !== null && typeof card === 'object' && typeof card.id === 'string') : []
    this.observerStorageReady = readable && Array.isArray(loaded) && this.cards.length === loaded.length
      && new Set(this.cards.map(card => card.id)).size === this.cards.length && this.cards.every(validObserverCardState)
  }

  /**
   * Drop what no longer matters: a decided card past {@link DECIDED_KEEP_MS} or beyond the newest {@link DECIDED_KEEP_MAX},
   * and a member's undecided card whose ticket has ended. A card still waiting for the owner is never dropped.
   * @returns how many cards were dropped.
   */
  /** T8: told after a card is raised, decided or withdrawn (the host pushes the router's and observer's to the market). */
  onChange?: (event: 'created' | 'decided' | 'dropped', card: StoredCard) => void
  private changed(event: 'created' | 'decided' | 'dropped', card: StoredCard | undefined): void {
    if (card === undefined || this.onChange === undefined) return
    try { this.onChange(event, card) } catch { /* the book never fails on a listener */ }
  }

  prune(): number {
    const cutoff = this.now() - DECIDED_KEEP_MS
    const decided = this.cards.filter(card => card.decided !== undefined).sort((a, b) => b.decided!.at.localeCompare(a.decided!.at))
    const keepDecided = new Set(decided.filter(card => Date.parse(card.decided!.at) >= cutoff).slice(0, DECIDED_KEEP_MAX).map(card => card.id))
    const before = this.cards.length
    const keepObserverSince = this.now() - 24 * 3_600_000
    this.cards = this.cards.filter(card => card.observerDecision !== undefined && (card.observerDecision.state === 'pending' || card.observerDecision.state === 'attempting' || Date.parse(card.observerDecision.at) > keepObserverSince) || (card.decided !== undefined ? keepDecided.has(card.id) : card.source !== 'ticket' || card.ticketId === undefined || this.ticketOpen(card.ticketId)))
    return before - this.cards.length
  }

  private save(): void {
    if (!this.observerStorageReady) throw new Error('decision book unreadable')
    this.prune()
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.cards), { mode: 0o600, flag: 'wx', flush: true }); renameSync(temporary, this.path) } catch (error) {
      try { rmSync(temporary, { force: true }) } catch { /* The original write failure determines the result. */ }
      throw error
    }
  }

  get(id: string): StoredCard | undefined { return this.cards.find(card => card.id === id) }
  /** Recovery reads the actual retained decision, never a stale process copy or a host note. */
  retainedForRecovery(id:string):StoredCard|undefined {
    try{const raw=readFileSync(this.path,'utf8');if(Buffer.byteLength(raw)>4*1024*1024)return undefined;const cards:unknown=JSON.parse(raw);if(!Array.isArray(cards))return undefined;const matches=cards.filter(c=>c&&typeof c==='object'&&c.id===id);return matches.length===1?structuredClone(matches[0] as StoredCard):undefined}catch{return undefined}
  }

  /** A file on a card, put there by its proposer or with the owner's decision: what the owner may download (C8). */
  fileOf(id: string, sha256: string): DecisionFile | undefined {
    const card = this.get(id)
    return [...(card?.files ?? []), ...(card?.decided?.files ?? [])].find(file => file.sha256 === sha256)
  }
  open(): StoredCard[] { return this.cards.filter(card => card.decided === undefined && card.ownerDecisionAttempt === undefined) }

  /** Cards the host closed on a timeout since \`sinceMs\` that the owner has not decided since (they may still decide). */
  autoAcked(sinceMs: number): StoredCard[] {
    return this.cards.filter(card => card.autoAck !== undefined && card.decided?.text === AUTO_ACK_TEXT && Date.parse(card.autoAck.at) >= sinceMs)
  }

  /** #888 D5: cards the host took automatically since `sinceMs` that the owner has not decided since (they may still decide). */
  autoApprovedSince(sinceMs: number): StoredCard[] {
    return this.cards.filter(card => autoDecided(card) && Date.parse(card.autoApproved!.at) >= sinceMs)
  }
  /** #888 D5: how many cards the host took automatically since `sinceMs` (the hourly cap). */
  autoApprovedCount(sinceMs: number): number {
    return this.cards.filter(card => card.autoApproved !== undefined && Date.parse(card.autoApproved.at) >= sinceMs).length
  }
  /** #888 D5: cards whose automatic decision is recorded but not yet decided or not yet told to the proposer (restart). */
  autoUnfinished(): StoredCard[] {
    return this.cards.filter(card => card.autoApproved !== undefined && card.autoApproved.deliveredAt === undefined && (card.decided === undefined || autoDecided(card)))
  }
  /** #888 D5 step 1: record the automatic decision (durable) before the card is decided. */
  autoApproveRecord(id: string, at: string, minutes: number, deliveryId: string): boolean {
    const card = this.cards.find(c => c.id === id && c.decided === undefined && c.autoApproved === undefined)
    if (card === undefined) return false
    this.cards = this.cards.map(c => c.id === id ? { ...c, autoApproved: { at, by: 'host', rule: 'auto-approve', minutes, deliveryId } } : c)
    this.save()
    return true
  }
  /** #888 D5 step 2: decide it with the recommendation, at the recorded time. */
  autoApproveDecide(id: string): boolean {
    const card = this.cards.find(c => c.id === id && c.decided === undefined && c.autoApproved !== undefined)
    if (card === undefined) return false
    this.cards = this.cards.map(c => c.id === id ? { ...c, decided: { at: card.autoApproved!.at, text: autoApprovedText(card.recommended), by: 'host', ...(card.options.indexOf(card.recommended) >= 0 ? { option: card.options.indexOf(card.recommended) } : {}) } } : c)
    this.save()
    this.changed('decided', this.get(id))
    return true
  }
  /** #888 D5 step 3: the proposer was told. */
  autoApproveDelivered(id: string, at: string): void {
    this.cards = this.cards.map(c => c.id === id && c.autoApproved !== undefined ? { ...c, autoApproved: { ...c.autoApproved, deliveredAt: at } } : c)
    this.save()
  }

  /** Close an undecided card as 「知道了」 on a timeout, with the audit record (who, which rule, when, after how long). */
  autoAcknowledge(id: string, at: string, minutes: number): boolean {
    const card = this.cards.find(c => c.id === id && c.decided === undefined)
    if (card === undefined) return false
    this.cards = this.cards.map(c => c.id === id ? { ...c, decided: { at, text: AUTO_ACK_TEXT }, autoAck: { at, by: 'host', rule: 'credential-ack-timeout', minutes } } : c)
    this.save()
    this.changed('decided', this.get(id))
    return true
  }

  /** The newest decided card of one proposer, if any (a declined tool request is not raised again for a while). */
  lastDecided(source: StoredCard['source'], by: string): StoredCard | undefined {
    return this.cards.filter(card => card.source === source && card.by === by && card.decided !== undefined).sort((a, b) => b.decided!.at.localeCompare(a.decided!.at))[0]
  }

  /** A card of the router's or an observer's own. An identical open question returns the existing card. */
  propose(input: { source: 'router' | 'observer' | 'health' | 'tool' | 'outbound' | 'staffing' | 'sender'; by: string; question: string; reason?: string; spec: DecisionSpec; at: string; files?: readonly DecisionFile[]; outbound?: StoredCard['outbound']; observerTarget?: ObserverCardBinding['target'] }): { ok: true; id: string; reused?: true } | { ok: false; code: string; error: string } {
    const question = input.question.trim()
    if (question === '' || question.length > QUESTION_MAX) return { ok: false, code: 'question', error: `question is required, at most ${String(QUESTION_MAX)} characters` }
    // #888 D2: only the router's and an observer's own cards may ask the owner to fill something in; host-fixed cards never.
    if (input.spec.inputs !== undefined && input.source !== 'router' && input.source !== 'observer') return { ok: false, code: 'inputs', error: 'this kind of card takes no inputs' }
    // Design owner-reporting R5: a choice the owner decided is final; the same question gets that decision back.
    // Only recommendations (router, observer): a health reminder may come back with its problem, a tool or outbound card has its own rule.
    const final = (source: StoredCard['source']): boolean => source === 'router' || source === 'observer'
    // #888 D5: a decision the host took automatically is not the owner's; only the owner's own is final.
    const decided = !final(input.source) ? undefined : this.cards.filter(card => card.decided !== undefined && !autoDecided(card) && final(card.source) && card.question === question).sort((a, b) => b.decided!.at.localeCompare(a.decided!.at))[0]
    if (decided !== undefined) return { ok: false, code: 'decided', error: `the owner already decided this (${decided.decided!.at.slice(0, 10)}): ${decided.decided!.text}. A decision is final: act on it, do not ask again.` }
    const mine = this.open().filter(card => card.source === input.source && card.by === input.by)
    const repeated = mine.find(card => card.question === question)
    if (repeated !== undefined) return { ok: true, id: repeated.id, reused: true }
    if (mine.length >= OPEN_CARDS_MAX) return { ok: false, code: 'too-many-open', error: `you already have ${String(mine.length)} decisions waiting for the owner` }
    const id = `d-${randomUUID()}`
    this.cards.push({ id, question, ...(input.reason !== undefined ? { reason: input.reason } : {}), source: input.source, by: input.by, at: input.at, ...input.spec, ...(input.observerTarget === undefined ? {} : { observerBinding: { generation: randomUUID(), createdAt: input.at, proposer: input.by, target: input.observerTarget } }), ...(input.outbound !== undefined ? { outbound: { ...input.outbound } } : {}), ...(input.files !== undefined && input.files.length > 0 ? { files: input.files } : {}) })
    this.save()
    this.changed('created', this.get(id))
    return { ok: true, id }
  }

  /** The card of a member's question on a ticket. */
  forTicket(input: { ticketId: string; by: string; question: string; spec: DecisionSpec; at: string; files?: readonly DecisionFile[]; questionVersion?: string; newQuestion?: boolean }): void {
    const id = ticketCardId(input.ticketId, input.question)
    const previous = this.get(id)
    if (previous !== undefined && (input.questionVersion === undefined || !input.newQuestion && previous.observerBinding?.target.kind === 'ticket-answer' && previous.observerBinding.target.questionVersion === input.questionVersion
      && JSON.stringify([previous.level, previous.options, previous.recommended, previous.inputs, previous.by]) === JSON.stringify([input.spec.level, input.spec.options, input.spec.recommended, input.spec.inputs, input.by]))) return
    // Keep a previous observer decision for history and quota, while the legacy card ID points to the newly opened question.
    const next = this.cards.flatMap(card => card.id !== id ? [card] : card.observerDecision === undefined ? [] : [{ ...card, id: card.observerDecision.id }])
    const binding: ObserverCardBinding | undefined = input.questionVersion === undefined ? undefined : {
      generation: randomUUID(), createdAt: input.at, proposer: input.by,
      target: { kind: 'ticket-answer', ticketId: input.ticketId, questionVersion: input.questionVersion, member: input.by },
    }
    this.replaceCards([...next, { id, question: input.question, source: 'ticket', by: input.by, ticketId: input.ticketId, at: input.at, ...input.spec,
      ...(binding === undefined ? {} : { observerBinding: binding }), ...(input.files !== undefined && input.files.length > 0 ? { files: input.files } : {}) }])
  }

  private replaceCards(next: StoredCard[]): void {
    const previous = this.cards
    this.cards = next
    try { this.save() } catch (error) { this.cards = previous; throw error }
  }

  observerHistory(): StoredCard[] { return this.cards.filter(card => card.observerDecision !== undefined) }

  reserveOwnerDecision(card: StoredCard, at: string, option?: number): boolean {
    const current = this.get(card.id)
    if (current?.observerBinding === undefined || current.observerBinding.generation !== card.observerBinding?.generation
      || current.decided !== undefined || current.ownerDecisionAttempt !== undefined) return false
    this.replaceCards(this.cards.map(row => row === current ? { ...row, ownerDecisionAttempt: { at, generation: current.observerBinding!.generation, option } } : row))
    return true
  }

  commitObserverDecision(card: StoredCard, decision: ObserverDecision): boolean {
    if (!this.observerStorageReady || card.decided !== undefined || card.ownerDecisionAttempt !== undefined || card.autoApproved !== undefined || this.get(card.id) !== card || card.observerBinding?.generation !== decision.generation) return false
    const decided = { at: decision.at, by: 'observer' as const, option: decision.option, text: '决定：' + card.options[decision.option] }
    const recorded = { ...card, decided, observerDecision: decision }
    this.replaceCards(this.cards.map(row => row === card ? recorded : row))
    this.changed('decided', recorded)
    return true
  }

  updateObserverDecision(card: StoredCard, decision: ObserverDecision): boolean {
    if (!this.observerStorageReady || this.get(card.id) !== card || card.observerDecision?.id !== decision.id) return false
    // Updating delivery or the local correction does not produce another market event.
    this.replaceCards(this.cards.map(row => row === card ? { ...row, observerDecision: decision } : row))
    return true
  }

  /** Take an undecided card back (reliability R7: a problem that went away recalls its reminder). */
  withdraw(id: string): void {
    const card = this.cards.find(c => c.id === id && c.decided === undefined)
    if (card !== undefined) {
      this.cards = this.cards.filter(c => c.id !== id)
      this.save()
      this.changed('dropped', card)
    }
  }

  /** Record what was decided; a question that had no card gets one, so it cannot be answered twice. */
  decide(id: string, decided: NonNullable<StoredCard['decided']>, fallback?: Omit<StoredCard, 'decided'>): void {
    const known = this.cards.some(card => card.id === id)
    this.replaceCards(known ? this.cards.map(card => {
      if (card.id !== id) return card
      const { ownerDecisionAttempt: _claim, ...previous } = card
      return { ...previous, decided }
    }) : [...this.cards, ...(fallback !== undefined ? [{ ...fallback, decided }] : [])])
    this.changed('decided', this.get(id))
  }
}
