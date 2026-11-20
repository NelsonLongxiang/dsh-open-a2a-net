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

export const DECISION_CARD_HEADER = '[A2A decision-card] v1'
/** The market's limits (v1 final). */
export const PUSH_BODY_MAX = 32 * 1024, PUSH_ID = /^[A-Za-z0-9._:-]{1,64}$/, PUSH_QUESTION_MAX = 2000, PUSH_FILES_MAX = 16, PUSH_DECIDE_AT_MAX = 300
/** How often the outbox is looked at, and how many events it keeps at most. */
export const PUSH_TICK_MS = 10_000, PUSH_PENDING_MAX = 200
export type PushEvent = 'created' | 'decided' | 'dropped'

/** Which cards go: the router's and the observer's own. A member's question on a ticket does not. */
export const pushedSource = (source: StoredCard['source']): boolean => source === 'router' || source === 'observer'

/** The path the market links to for deciding: the workbench, team tab, decisions view, this card. */
export const decideAt = (cardId: string): string => `/__dsh_a2a_nexus/?tab=team&view=decisions&card=${encodeURIComponent(cardId)}`

/** One envelope's text, or why the card cannot go (then it is logged and skipped, never sent half-formed). */
export function decisionCardText(event: PushEvent, rev: number, team: string, card: StoredCard): { ok: true; text: string } | { ok: false; why: string } {
  if (!PUSH_ID.test(card.id)) return { ok: false, why: 'card id outside the market\'s id rule' }
  const options = card.options ?? []
  if (options.length < 2 || options.length > 6 || new Set(options).size !== options.length) return { ok: false, why: 'options must be 2..6 and distinct' }
  if (card.question.length > PUSH_QUESTION_MAX) return { ok: false, why: 'question longer than 2000 characters' }
  const files = (card.files ?? []).slice(0, PUSH_FILES_MAX + 1)
  if (files.length > PUSH_FILES_MAX) return { ok: false, why: 'more than 16 files' }
  const link = decideAt(card.id)
  if (link.length > PUSH_DECIDE_AT_MAX) return { ok: false, why: 'decide_at too long' }
  const body = {
    event, rev, decide_at: link,
    card: {
      id: card.id, team, proposer_kind: card.source as 'router' | 'observer', level: card.level ?? 'P1', question: card.question, options,
      recommended: card.recommended ?? '', ...(card.reason !== undefined ? { reason: card.reason } : {}),
      files: files.map(f => ({ name: f.name, size: f.size, sha256: f.sha256 })), created_at: card.at,
      ...(event === 'decided' && card.decided !== undefined ? { decided_at: card.decided.at, decided_option: decidedOption(card.decided.text, options) } : {}),
    },
  }
  const text = `${DECISION_CARD_HEADER}\n${JSON.stringify(body)}`
  if (Buffer.byteLength(text, 'utf8') > PUSH_BODY_MAX) return { ok: false, why: 'body over 32KB' }
  return { ok: true, text }
}

/** The option a decision chose, read from its stored text (`决定：<option>`); empty when it was words only. */
export function decidedOption(text: string, options: readonly string[]): string {
  const line = text.split('\n').find(l => l.startsWith('决定：'))
  const chosen = line === undefined ? '' : line.slice('决定：'.length).trim()
  return options.includes(chosen) ? chosen : ''
}

/** A refusal the market will repeat for the same body: drop it rather than retry (v1: 400, 401, 403, 429). */
export const finalRefusal = (error: unknown): boolean => /\b(400|401|403|429)\b|decision-card-invalid|too-many-waiting/.test(String(error))

interface Pending { readonly cardId: string; readonly event: PushEvent; readonly rev: number; readonly text: string }
interface Kept { revs: Record<string, number>; pending: Pending[] }

export interface DecisionPushDeps {
  /** The team's canvas, and the canvas address the roster reports (`<zone>/canvas/<name>`); undefined when unbound. */
  readonly team: () => { canvas: string; address: string } | undefined
  readonly remotes: (canvas: string) => readonly string[]
  readonly declares: (ref: string, capability: string) => boolean
  readonly send: (ref: string, text: string, taskId: string) => Promise<void>
  readonly hostFingerprint: () => string | undefined
  readonly load: () => unknown
  readonly save: (kept: Kept) => void
  readonly nowMs: () => number
  readonly logger: { warn: (format: string, ...args: unknown[]) => void }
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
    this.kept = {
      revs: raw?.revs !== null && typeof raw?.revs === 'object' ? Object.fromEntries(Object.entries(raw.revs).filter(([, v]) => typeof v === 'number')) : {},
      pending: Array.isArray(raw?.pending) ? raw.pending.filter((p): p is Pending => typeof p?.cardId === 'string' && typeof p.text === 'string' && typeof p.rev === 'number') : [],
    }
    return this.kept
  }
  private persist(): void { try { this.d.save(this.state()) } catch (error) { this.d.logger.warn('superagent: decision push state not saved: %s', String(error)) } }

  /** A card was raised, decided or dropped: queue its event with the next revision (router and observer cards only). */
  noted(event: PushEvent, card: StoredCard): void {
    if (!pushedSource(card.source)) return
    const team = this.d.team()
    if (team === undefined) return
    const kept = this.state()
    const rev = (kept.revs[card.id] ?? 0) + 1
    const built = decisionCardText(event, rev, team.address, card)
    if (!built.ok) { this.d.logger.warn('superagent: decision card %s not pushed: %s', card.id, built.why); return }
    kept.revs[card.id] = rev
    kept.pending.push({ cardId: card.id, event, rev, text: built.text })
    if (kept.pending.length > PUSH_PENDING_MAX) kept.pending.splice(0, kept.pending.length - PUSH_PENDING_MAX)
    this.persist()
  }

  /** Send what waits, oldest first. A market refusal that would repeat drops the event; a transport failure keeps it. */
  async tick(): Promise<void> {
    if (this.sending) return
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
        let delivered = 0, refused = 0
        for (const ref of targets) {
          try { await this.d.send(ref, next.text, taskId); delivered++ } catch (error) {
            if (finalRefusal(error)) { refused++; this.d.logger.warn('superagent: market refused decision card %s (%s): %s', next.cardId, next.event, String(error)) }
            else this.d.logger.warn('superagent: decision card %s to %s failed: %s', next.cardId, ref, String(error))
          }
        }
        // Nobody took it and nobody refused it for good: keep it, try again next tick.
        if (delivered === 0 && refused === 0) return
        kept.pending.shift()
        this.persist()
      }
    } finally { this.sending = false }
  }

  /** For the state and tests. */
  pending(): ReadonlyArray<{ cardId: string; event: PushEvent; rev: number }> { return this.state().pending.map(({ cardId, event, rev }) => ({ cardId, event, rev })) }
}
