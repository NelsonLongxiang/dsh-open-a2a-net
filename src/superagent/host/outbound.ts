/**
 * superagent: asking another team, on an approved card (docs/design/superagent-outbound-requests.md, O1–O5).
 *
 * A team session asks for a message to another team on one of its tickets; that becomes a P0 card. The owner, or an
 * approver the owner named, decides it. On approval the host sends the approved text from the team's A2A identity and
 * keeps which task belongs to which ticket; the other team's formal receipt on that task reaches the ticket as a note.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/outbound
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TRUSTED_PROOFS } from '../a2a-watch.ts'
import type { Trigger } from '../upstream/dsh-superagent/src/core/index.ts'

/** Another team's address: a session handle `<zone>/<id8>` or a canvas team `<zone>/canvas/<name>`, either with `@<fp8>`. */
export const OUTBOUND_ADDRESS = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}\/(?:[0-9a-f]{8}|canvas\/[^\s/@]{1,64})(?:@[0-9a-f]{8})?$/
/** The text that leaves, at most; and how many requests a ticket may have waiting or in flight (O2). */
export const OUTBOUND_TEXT_MAX = 4000, OUTBOUND_PER_TICKET = 3
export const OUTBOUND_APPROVE = '批准：以团队名义发出', OUTBOUND_DECLINE = '拒绝'

export interface OutboundRecord {
  readonly card: string
  readonly ticketId: string
  readonly address: string
  readonly text: string
  readonly by: string
  readonly at: string
  state: 'waiting' | 'sent' | 'failed' | 'declined' | 'answered'
  task?: string
  error?: string
  answer?: { readonly text: string; readonly at: string }
}

export interface OutboundAsk { readonly ticket_id?: unknown; readonly address?: unknown; readonly text?: unknown; readonly why?: unknown }

export interface OutboundDeps {
  readonly path: string
  /** Send from the team's A2A identity; the task id, or undefined when the address is not reachable or not admitted. */
  readonly ask: (address: string, text: string) => Promise<string | undefined>
  readonly note: (ticketId: string, text: string) => void
  readonly logger: { warn(format: string, ...args: unknown[]): void }
  readonly now: () => string
}

/** What the host knows about the asker and the team, for O1's checks. */
export interface OutboundContext {
  readonly role: 'router' | 'member' | 'observer' | undefined
  readonly ticket: { readonly open: boolean; readonly holder?: string | undefined; readonly title: string } | undefined
  readonly a2aOn: boolean
  /** The team's own address and its sessions' handles: never a target. */
  readonly own: readonly string[]
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`)

/** The team's own addresses (O1): its canvas address and its sessions' handles. */
export function ownAddresses(handleOf: ((id: string) => string) | undefined, canvas: string | undefined, sessions: ReadonlyArray<string | undefined>): string[] {
  if (handleOf === undefined) return []
  const handles = sessions.flatMap(id => (id === undefined ? [] : [handleOf(id)]))
  const zone = handles[0]?.split('/')[0]
  return [...(zone !== undefined && canvas !== undefined ? [`${zone}/canvas/${canvas}`] : []), ...handles]
}

/**
 * Whether an approver may decide this card (O3): named by the owner, a member or observer now, the card an outbound one
 * it did not raise, and a reason given.
 * @returns the reason to record, or the refusal.
 */
export function approverCheck(input: { readonly approvers: readonly string[]; readonly role: string | undefined; readonly card: { readonly source: string; readonly by: string } | undefined; readonly session: string; readonly reason: unknown }): { ok: true; reason: string } | { ok: false; code: string; error: string } {
  if (!input.approvers.includes(input.session) || (input.role !== 'member' && input.role !== 'observer')) return { ok: false, code: 'not-approver', error: 'only a member or observer the owner named as an approver decides outbound cards' }
  if (input.card === undefined || input.card.source !== 'outbound') return { ok: false, code: 'card', error: 'an approver decides only waiting outbound cards' }
  if (input.card.by === input.session) return { ok: false, code: 'own', error: 'an approver does not decide a card it raised' }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  return reason === '' ? { ok: false, code: 'reason', error: 'give the reason for the decision' } : { ok: true, reason: reason.slice(0, 500) }
}

export class OutboundRequests {
  private records: Record<string, OutboundRecord>

  constructor(private readonly d: OutboundDeps) {
    let stored: Record<string, OutboundRecord> = {}
    try { if (existsSync(d.path)) stored = JSON.parse(readFileSync(d.path, 'utf8')) as Record<string, OutboundRecord> } catch { /* start empty */ }
    this.records = stored
  }

  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.records), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  list(): readonly OutboundRecord[] { return Object.values(this.records) }

  /**
   * Check a request (O1, O2) and shape its card, or say why not.
   * @returns the card's question and reason, or a refusal.
   */
  check(session: string, ask: OutboundAsk, ctx: OutboundContext): { ok: true; ticketId: string; address: string; text: string; question: string; reason?: string } | { ok: false; code: string; error: string } {
    const ticketId = typeof ask.ticket_id === 'string' ? ask.ticket_id.trim() : ''
    const address = typeof ask.address === 'string' ? ask.address.trim() : ''
    const text = typeof ask.text === 'string' ? ask.text.trim() : ''
    const why = typeof ask.why === 'string' ? ask.why.trim() : ''
    if (ctx.role === undefined) return { ok: false, code: 'not-team', error: 'only a session of this team asks another team' }
    if (!ctx.a2aOn) return { ok: false, code: 'a2a-off', error: 'the team\'s A2A Source is off, so the team has no identity to send from; the owner turns it on in the team settings' }
    if (ctx.ticket === undefined || !ctx.ticket.open) return { ok: false, code: 'ticket', error: 'name an open ticket of this team' }
    if (ctx.role !== 'router' && ctx.ticket.holder !== session) return { ok: false, code: 'not-yours', error: 'a member asks only on a ticket it holds' }
    if (!OUTBOUND_ADDRESS.test(address)) return { ok: false, code: 'address', error: 'address is another team\'s: <zone>/<id8> or <zone>/canvas/<name>, optionally @<fp8>' }
    if (ctx.own.some(own => address === own || address.split('@')[0] === own.split('@')[0])) return { ok: false, code: 'own', error: 'that is this team or one of its sessions; ask your team through its ticket instead' }
    if (text === '' || text.length > OUTBOUND_TEXT_MAX) return { ok: false, code: 'text', error: `text is required, at most ${String(OUTBOUND_TEXT_MAX)} characters` }
    if (this.list().filter(r => r.ticketId === ticketId && (r.state === 'waiting' || r.state === 'sent')).length >= OUTBOUND_PER_TICKET) return { ok: false, code: 'too-many', error: `a ticket has at most ${String(OUTBOUND_PER_TICKET)} outbound requests waiting or unanswered` }
    const question = `以本团队名义向 ${address} 发出请求吗？（工单「${clip(ctx.ticket.title, 80)}」）\n发出的原文：\n${text}`
    return { ok: true, ticketId, address, text, question, ...(why !== '' ? { reason: clip(why, 1000) } : {}) }
  }

  /** A card was raised for a checked request. */
  waiting(card: string, ticketId: string, address: string, text: string, by: string): void {
    this.records[card] = { card, ticketId, address, text, by, at: this.d.now(), state: 'waiting' }
    this.save()
  }

  /**
   * The card was decided (O4): on approval, send the approved text under a header naming the team and the ticket.
   * @returns the task id when it went out.
   */
  async decided(card: string, approved: boolean, team: string, titleOf: (ticketId: string) => string | undefined): Promise<string | undefined> {
    const record = this.records[card]
    if (record === undefined || record.state !== 'waiting') return undefined
    const header = `[来自 superagent 团队 ${team} 的请求 · 工单「${clip(titleOf(record.ticketId) ?? '', 80)}」]`
    if (!approved) { record.state = 'declined'; this.save(); this.d.note(record.ticketId, `对外请求（发往 ${record.address}）未获批准，没有发出。`); return undefined }
    let task: string | undefined
    try { task = await this.d.ask(record.address, `${header}\n${record.text}`) } catch (error) { record.error = clip(String(error), 300) }
    if (task === undefined) {
      record.state = 'failed'
      record.error ??= 'the address is not reachable from this host, or this host is not admitted there'
      this.save()
      this.d.note(record.ticketId, `对外请求（发往 ${record.address}）已获批准，但没能发出：${record.error}`)
      return undefined
    }
    record.state = 'sent'
    record.task = task
    this.save()
    this.d.note(record.ticketId, `对外请求已发往 ${record.address}（task ${task}）；对方的回执到了会再告诉你。`)
    return task
  }

  /** A mailbox row: the other team's formal receipt on a sent request's task is its answer (O5). */
  received(trigger: Trigger): void {
    const receiptFor = trigger.meta.receiptFor
    if (typeof receiptFor !== 'string') return
    const record = Object.values(this.records).find(r => r.task === receiptFor && r.state === 'sent')
    if (record === undefined) return
    if (typeof trigger.meta.proof !== 'string' || !TRUSTED_PROOFS.has(trigger.meta.proof)) return
    record.state = 'answered'
    record.answer = { text: clip(trigger.text, 2000), at: trigger.at }
    this.save()
    this.d.note(record.ticketId, `对外请求（${record.address}，task ${receiptFor}）的回执：${clip(trigger.text, 2000)}`)
  }
}
