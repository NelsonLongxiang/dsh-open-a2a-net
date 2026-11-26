/**
 * superagent T8 step 1: the router's and the observer's decision cards go to the market as they are raised, decided and
 * dropped, for its 「等你拍板」 view. Display only: deciding stays on this host, by the owner logged in in the browser
 * (decision cards C5 unchanged). The route is the roster's: a signed direct message from the host's process face to the
 * canvas remote members that declare `teamRoster`, first line exactly `[A2A decision-card] v1`, then one JSON object.
 * Metadata only — file names, sizes and digests, never their content. Each card carries a revision that only grows;
 * the market keeps the highest and never revives a card after `decided` or `dropped`. Envelope v1 is settled with the
 * market (workbench-market #898, t8-decision-cards-proposal「信封 v1 定稿」).
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/decision-push
 */

import type { StoredCard } from './decisions.ts'
import { needsInput } from './decisions.ts'

export const DECISION_CARD_HEADER = '[A2A decision-card] v1'
/** The market's limits (v1 final; workbench-market #898 parseDecisionCardDoc): checked here so nothing it would refuse is sent. */
export const PUSH_BODY_MAX = 32 * 1024, PUSH_ID = /^[A-Za-z0-9._:-]{1,64}$/, PUSH_QUESTION_MAX = 2000, PUSH_FILES_MAX = 16, PUSH_DECIDE_AT_MAX = 300
export const PUSH_REASON_MAX = 2000, PUSH_OPTION_MAX = 300, PUSH_FILE_NAME_MAX = 200, PUSH_LEVELS = ['P0', 'P1', 'P2', 'P3'] as const
const SHA256 = /^[0-9a-f]{64}$/
/** How often the outbox is looked at, and how many events it keeps at most. */
export const PUSH_TICK_MS = 10_000, PUSH_PENDING_MAX = 200
export type PushEvent = 'created' | 'decided' | 'dropped'

/** Which cards go: the router's and the observer's own. A member's question on a ticket does not. */
export const pushedSource = (source: StoredCard['source']): boolean => source === 'router' || source === 'observer'

/** The path the market links to for deciding: the workbench, team tab, decisions view, this card. */
export const decideAt = (cardId: string): string => `/__dsh_a2a_nexus/?tab=team&view=decisions&card=${encodeURIComponent(cardId)}`

/** Text cut to the market's limit, marked as cut (the market counts UTF-16 units, as String.length does). */
const cut = (text: string, max: number): string => {
  if (text.length <= max) return text
  // Never split a surrogate pair (an emoji) at the cut: a lone half is not text (#766 review).
  let end = max - 1
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return `${text.slice(0, end)}…`
}

/**
 * What the market compares, as its receiver cleans a string before checking it (workbench-market #898 `clean`): control
 * characters become a space, direction controls go, the ends are trimmed. Checks run on this so two options that differ
 * only by a direction control are refused here, not by the market (#766 review).
 */
export const marketClean = (text: string): string => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim()

/**
 * One envelope's text, or why the card cannot go (then it is a health problem, never sent half-formed). A reason or a
 * file name over the market's limit is cut and sent; anything else the market would refuse stops the card here.
 */
export function decisionCardText(event: PushEvent, rev: number, team: string, card: StoredCard): { ok: true; text: string } | { ok: false; why: string } {
  if (!PUSH_ID.test(card.id)) return { ok: false, why: 'card id outside the market\'s id rule' }
  // #923: a card's options may be longer than the market's v1 limit; they go cut to it, and the recommendation and the
  // decision are mapped by position, so the cut texts still match.
  const raw = card.options ?? []
  const options = raw.map(option => cut(option, PUSH_OPTION_MAX))
  const seen = options.map(marketClean)
  if (options.length < 2 || options.length > 6 || new Set(seen).size !== seen.length) return { ok: false, why: 'options must be 2..6 and distinct' }
  if (seen.some(option => option === '' || option.length > PUSH_OPTION_MAX)) return { ok: false, why: 'an option is empty or longer than 300 characters' }
  // Compared as the market cleans them, like the options (#766): a direction control never hides the recommendation.
  const recommendedAt = raw.map(marketClean).indexOf(marketClean(card.recommended ?? ''))
  if (recommendedAt < 0) return { ok: false, why: 'the recommended option is not one of the options' }
  const recommended = options[recommendedAt]
  const level = card.level ?? 'P1'
  if (!(PUSH_LEVELS as readonly string[]).includes(level)) return { ok: false, why: 'level outside P0..P3' }
  if (marketClean(card.question) === '' || card.question.length > PUSH_QUESTION_MAX) return { ok: false, why: 'question empty or longer than 2000 characters' }
  if (!Number.isFinite(Date.parse(card.at))) return { ok: false, why: 'created_at is not a time' }
  if (event === 'decided' && (card.decided === undefined || !Number.isFinite(Date.parse(card.decided.at)))) return { ok: false, why: 'a decided event with no decision time' }
  const files = card.files ?? []
  if (files.length > PUSH_FILES_MAX) return { ok: false, why: 'more than 16 files' }
  if (files.some(f => !SHA256.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.name.trim() === '')) return { ok: false, why: 'a file without a name, size or sha256 digest' }
  const link = decideAt(card.id)
  if (link.length > PUSH_DECIDE_AT_MAX) return { ok: false, why: 'decide_at too long' }
  const body = {
    event, rev, decide_at: link,
    card: {
      id: card.id, team, proposer_kind: card.source as 'router' | 'observer', level, question: card.question, options,
      recommended, ...(card.reason !== undefined ? { reason: cut(card.reason, PUSH_REASON_MAX) } : {}),
      files: files.map(f => ({ name: cut(f.name, PUSH_FILE_NAME_MAX), size: f.size, sha256: f.sha256 })), created_at: card.at,
      // A decision in words only (no option chosen) is null: the market takes null or one of the options, never ''.
      ...(event === 'decided' && card.decided !== undefined ? { decided_at: card.decided.at, decided_option: (typeof card.decided.option === 'number' && Number.isInteger(card.decided.option) ? options[card.decided.option] : options[raw.indexOf(decidedOption(card.decided.text, raw))]) ?? null } : {}),
    },
  }
  const text = `${DECISION_CARD_HEADER}\n${JSON.stringify(body)}`
  if (Buffer.byteLength(text, 'utf8') > PUSH_BODY_MAX) return { ok: false, why: 'body over 32KB' }
  return { ok: true, text }
}

/**
 * The option an older decision chose, read from its stored text, for records made before the host recorded the option's
 * position (`decided.option`). Only a text that begins with `决定：` names an option — words only begin with `说明：` and
 * may mention anything. An option may hold line breaks, so whole options are matched, each ending at the end of the text
 * or at a line break; when more than one fits (a note can read like a longer option), the answer is empty rather than a
 * guess (#935 review B1/B2).
 * @returns the option, or empty.
 */
export function decidedOption(text: string, options: readonly string[]): string {
  if (!text.startsWith('决定：')) return ''
  const rest = text.slice('决定：'.length)
  const fits = options.filter(option => rest === option || rest.startsWith(`${option}\n`))
  return fits.length === 1 ? fits[0]! : ''
}

/**
 * A refusal the market will repeat for the same body: drop it rather than retry (v1: 400, 401, 403, 429). Read from the
 * status code when the error carries one, else from the HTTP status or the market's error code in its text — never from
 * a bare number, which could be a length or a count.
 */
export function finalRefusal(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof status === 'number') return [400, 401, 403, 429].includes(status)
  return /\bHTTP (400|401|403|429)\b|decision-card-invalid|decision-card-too-large|untrusted-origin|team-not-bound|too-many-waiting/.test(String(error))
}

interface Pending { readonly cardId: string; readonly event: PushEvent; readonly rev: number; readonly text: string }
interface Refused { readonly event: PushEvent; readonly why: string; readonly at: string }
interface Kept { revs: Record<string, number>; pending: Pending[]; refused: Record<string, Refused> }

export interface DecisionPushDeps {
  /** Whether the owner has turned the push on (team setting `decisionPush`); off, nothing is queued, kept or sent. */
  readonly on: () => boolean
  /** The team's canvas, and the canvas address the roster reports (`<zone>/canvas/<name>`); undefined when unbound. */
  readonly team: () => { canvas: string; address: string } | undefined
  readonly remotes: (canvas: string) => readonly string[]
  readonly declares: (ref: string, capability: string) => boolean
  readonly send: (ref: string, text: string, taskId: string) => Promise<void>
  readonly hostFingerprint: () => string | undefined
  /** Whether the host still holds the card (a refusal about a card the host no longer has is no longer a problem). */
  readonly holds: (cardId: string) => boolean
  readonly load: () => unknown
  readonly save: (kept: Kept) => void
  readonly nowMs: () => number
  readonly logger: { warn: (format: string, ...args: unknown[]) => void; info?: (format: string, ...args: unknown[]) => void }
}

/** The outbox of card events, kept across restarts; sent with the roster's transport. */
export class DecisionPush {
  private kept: Kept | undefined
  private sending = false
  constructor(private readonly d: DecisionPushDeps) {}

  private state(): Kept {
    if (this.kept !== undefined) return this.kept
    let raw: Partial<Kept> | undefined
    try { raw = this.d.load() as Partial<Kept> | undefined } catch { raw = undefined }
    const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
    this.kept = {
      revs: record(raw?.revs) ? Object.fromEntries(Object.entries(raw.revs).filter(([, v]) => typeof v === 'number')) as Record<string, number> : {},
      pending: Array.isArray(raw?.pending) ? raw.pending.filter((p): p is Pending => typeof p?.cardId === 'string' && typeof p.text === 'string' && typeof p.rev === 'number') : [],
      refused: record(raw?.refused) ? Object.fromEntries(Object.entries(raw.refused).filter(([, v]) => record(v) && typeof v.why === 'string')) as Record<string, Refused> : {},
    }
    return this.kept
  }
  private persist(): void { try { this.d.save(this.state()) } catch (error) { this.d.logger.warn('superagent: decision push state not saved: %s', String(error)) } }
  private refuse(cardId: string, event: PushEvent, why: string): void {
    this.state().refused[cardId] = { event, why, at: new Date(this.d.nowMs()).toISOString() }
  }

  /**
   * A card was raised, decided or dropped: queue its event (router and observer cards only, and only while the push is
   * on). The revision is never below the clock in milliseconds, so a lost or broken state file never sends it backwards.
   */
  noted(event: PushEvent, card: StoredCard): void {
    if (!pushedSource(card.source) || !this.d.on()) return
    // #888 D4: a card with inputs is answered on this host only in phase one; skipped, not refused (no false health problem).
    if (needsInput(card)) { this.d.logger.info?.('superagent: decision card %s not pushed: it has options that need input', card.id); return }
    const team = this.d.team()
    if (team === undefined) return
    const kept = this.state()
    const rev = Math.max((kept.revs[card.id] ?? 0) + 1, Math.floor(this.d.nowMs()))
    kept.revs[card.id] = rev
    const built = decisionCardText(event, rev, team.address, card)
    if (!built.ok) {
      this.d.logger.warn('superagent: decision card %s not pushed: %s', card.id, built.why)
      this.refuse(card.id, event, built.why)
    } else {
      kept.pending.push({ cardId: card.id, event, rev, text: built.text })
      if (kept.pending.length > PUSH_PENDING_MAX) kept.pending.splice(0, kept.pending.length - PUSH_PENDING_MAX)
    }
    this.persist()
  }

  /** Send what waits, oldest first. A market refusal that would repeat drops the event as a problem; a transport failure keeps it. */
  async tick(): Promise<void> {
    if (this.sending) return
    if (!this.d.on()) { this.dropAll(); return }
    const kept = this.state()
    if (kept.pending.length === 0) return
    const team = this.d.team(), host = this.d.hostFingerprint()
    if (team === undefined || host === undefined) return
    const targets = this.d.remotes(team.canvas).filter(ref => this.d.declares(ref, 'teamRoster'))
    if (targets.length === 0) return
    this.sending = true
    try {
      while (kept.pending.length > 0) {
        const next = kept.pending[0]!
        const taskId = `card-${host.slice(0, 8)}-${String(this.d.nowMs())}-${String(next.rev)}`
        let delivered = 0, refusal: string | undefined
        for (const ref of targets) {
          try { await this.d.send(ref, next.text, taskId); delivered++ } catch (error) {
            if (finalRefusal(error)) { refusal = String(error); this.d.logger.warn('superagent: market refused decision card %s (%s): %s', next.cardId, next.event, String(error)) }
            else this.d.logger.warn('superagent: decision card %s to %s failed: %s', next.cardId, ref, String(error))
          }
        }
        // Nobody took it and nobody refused it for good: keep it, try again next tick.
        if (delivered === 0 && refusal === undefined) return
        kept.pending.shift()
        if (delivered > 0) delete kept.refused[next.cardId]
        else this.refuse(next.cardId, next.event, `市场拒收（${next.event}）：${refusal!.slice(0, 200)}`)
        this.persist()
      }
    } finally { this.sending = false }
  }

  /**
   * The cards whose push was refused (by this host's checks or by the market) and that the host still holds: one health
   * problem each (R7a: the observer first). A later push of the same card that goes through clears it.
   */
  problems(): Array<{ cardId: string; event: PushEvent; why: string }> {
    if (!this.d.on()) { this.dropAll(); return [] }
    const kept = this.state()
    let pruned = false
    for (const id of Object.keys(kept.refused)) if (!this.d.holds(id)) { delete kept.refused[id]; pruned = true }
    if (pruned) this.persist()
    return Object.entries(kept.refused).map(([cardId, r]) => ({ cardId, event: r.event, why: r.why }))
  }

  /**
   * The owner turned the push off: what waits and what was refused are dropped, so turning it on again never floods the
   * market with old events and the health check never nags about a push that is off. Revisions stay, so the next event
   * of a card is still newer than anything the market holds.
   */
  private dropAll(): void {
    const kept = this.state()
    if (kept.pending.length === 0 && Object.keys(kept.refused).length === 0) return
    kept.pending = []
    kept.refused = {}
    this.persist()
  }

  /** For the state and tests. */
  pending(): ReadonlyArray<{ cardId: string; event: PushEvent; rev: number }> { return this.state().pending.map(({ cardId, event, rev }) => ({ cardId, event, rev })) }
}
