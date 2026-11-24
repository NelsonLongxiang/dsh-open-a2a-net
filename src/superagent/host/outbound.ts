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
import {recoveryDigest,verifyRecoveryProposal,type RecoveryProposal,type RecoveryBinding} from '../../request-recovery.ts'
import {holdsRow,parseReceipt} from '../../receipt.ts'
import {writeTaskLedger} from '../../task-ledger-persistence.ts'
import {keepUnsettled,receiptStanding,type UnsettledReceipt} from './receipt-settlement.ts'
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
  state: 'waiting' | 'sending' | 'unknown' | 'sent' | 'failed' | 'declined' | 'answered'
  /** Immutable original approval envelope and every transport attempt, never cleared by recovery. */
  approval?: { readonly at: string; readonly team: string; readonly message: string }
  attempts?: OutboundAttempt[]
  /** Separate continuation; original legacy task/state/error remain unchanged. */
  narrowRecovery?: NarrowRecoveryRecord
  task?: string
  error?: string
  /** The final answer; `key` is the receipt trigger id it came from (stable result key). */
  answer?: { readonly text: string; readonly at: string; readonly key?: string }
  /** The ticket note for `answer` has been written (set only after the note is in the ticket). */
  noted?: true
  /** The note could not be written because the ticket had ended: an anomaly, never reopened and never resent. */
  noteBlocked?: 'ticket-ended'
  /** #881 v2 B2: receipts the network ledger did not settle positively (refused, settled by another, pending, none): kept, never answers. */
  unsettled?: UnsettledReceipt[]
}

/** What writing one ticket note came to. */
export type NoteResult = 'written' | 'ended' | 'failed'

/**
 * Write a note to a ticket at most once: the same text already among its notes counts as written. An ended ticket is not
 * written to; a missing ticket or a write that throws is a failure, kept for a retry.
 */
export function writeTicketNoteOnce(ticket: { readonly ended?: unknown; readonly inputs: ReadonlyArray<{ readonly kind: string; readonly text?: string }> } | undefined, text: string, write: (text: string) => void): NoteResult {
  if (ticket === undefined) return 'failed'
  if (ticket.ended !== undefined && ticket.ended !== null && ticket.ended !== false) return 'ended'
  if (ticket.inputs.some(input => input.kind === 'note' && input.text === text)) return 'written'
  try { write(text); return 'written' } catch { return 'failed' }
}

/** The note an answered request leaves on its ticket; the same for a first write and every retry. */
export const outboundAnswerNote = (record: Pick<OutboundRecord, 'address' | 'task' | 'answer'>): string => `对外请求（${record.address}，task ${record.task ?? ''}）的回执：${record.answer?.text ?? ''}`

/** An answered request whose note is still owed, or whose ticket had ended (a health problem). */
export interface OutboundNoteProblem { readonly kind: 'pending' | 'ticket-ended'; readonly ticketId: string; readonly card: string; readonly task: string; readonly at: string }

export interface NarrowRecoveryRecord {
  proposal:RecoveryProposal
  phase:'prepared'|'dispatching'|'accepted'|'unknown'|'answered'
  answer?:{text:string;at:string;triggerId:string}
  noted?:true
  digest:string
}
export function narrowRecoveryDigest(r:Omit<NarrowRecoveryRecord,'digest'>):string {return recoveryDigest([r.proposal,r.phase,r.answer??null,r.noted===true])}

export interface OutboundAttempt {
  readonly task: string
  readonly sender: string
  readonly at: string
  /** No transport is allowed before a dispatching checkpoint is persisted. */
  readonly phase?: 'preparing' | 'dispatching'
  delivery: 'unknown' | 'not-sent' | 'accepted'
  error?: string
}
export type OutboundApproval = { readonly ok: true; readonly at: string; readonly team: string; readonly message: string }
  | { readonly ok: false; readonly code: string; readonly error: string }
export interface OutboundRecovery { readonly ok: boolean; readonly state?: OutboundRecord['state']; readonly task?: string; readonly code?: string; readonly error?: string }

export interface OutboundAsk { readonly ticket_id?: unknown; readonly address?: unknown; readonly text?: unknown; readonly why?: unknown }

export interface OutboundDeps {
  readonly path: string
  /** Send from the team's A2A identity; the task id, or undefined when the address is not reachable or not admitted. */
  readonly ask: (address: string, text: string, task?: string, sender?: string) => Promise<string | undefined>
  /** Current source identity, obtained before persisting a transport attempt. */
  readonly sender?: (create?: boolean) => Promise<string>
  /** Current retained original approval and open/source-enabled ticket, checked on every recovery. */
  readonly approval?: (record: Readonly<OutboundRecord>) => OutboundApproval
  /** A local host query tied to this attempt sender, task and exact approved wire payload. Missing means unknown. */
  readonly query?: (record: Readonly<OutboundRecord>, attempt: Readonly<OutboundAttempt>) => Promise<{ readonly delivery: OutboundAttempt['delivery'] }>
  readonly narrowReceipt?: (binding:RecoveryBinding,caller:string,message:string)=>boolean
  readonly narrowNote?: (ticketId:string,text:string)=>boolean
  /** Idempotent ticket note for answers (see writeTicketNoteOnce); without it, `note` is used and a throw counts as failed. */
  readonly noteOnce?: (ticketId: string, text: string) => NoteResult
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

/** The address an approved card names, as a scope check sees it: canvas targets lose their owner suffix there. */
const bare = (address: string): string => address.replace(/@[0-9a-f]{8}$/, '')

export class OutboundRequests {
  private records: Record<string, OutboundRecord>
  /** Approved cards being sent right now, by address: the owner's (or an approver's) decision is the scope for that send. */
  private readonly sending = new Map<string, number>()
  private readonly busy = new Set<string>()

  constructor(private readonly d: OutboundDeps) {
    let stored: Record<string, OutboundRecord> = {}
    try { if (existsSync(d.path)) stored = JSON.parse(readFileSync(d.path, 'utf8')) as Record<string, OutboundRecord> } catch { /* start empty */ }
    this.records = stored
  }

  private save(next = this.records): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  /** Serialize short disk transactions across instances; an orphaned lock fails closed for maintenance. */
  private put(record: OutboundRecord, expected = this.records[record.card]): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const lock = this.d.path + '.lock', token = randomUUID()
    writeFileSync(lock, token, { mode: 0o600, flag: 'wx' })
    try {
      const stored: unknown = existsSync(this.d.path) ? JSON.parse(readFileSync(this.d.path, 'utf8')) : {}
      if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) throw Error('outbound storage is not a record map')
      const fresh = stored as Record<string, OutboundRecord>
      if (JSON.stringify(fresh[record.card]) !== JSON.stringify(expected)) {
        this.records = fresh
        throw Error('outbound record changed; refresh and reconcile the original task')
      }
      const next = { ...fresh, [record.card]: record }
      this.save(next) // persistence precedes memory and any transport call
      this.records = next
    } finally {
      // Never remove a lock replaced by another writer, even on an exceptional path.
      if (readFileSync(lock, 'utf8') === token) rmSync(lock)
    }
  }

  list(): readonly OutboundRecord[] { return Object.values(this.records).map(record => structuredClone(record)) }
  recoveryRecords():readonly OutboundRecord[] {
    const text=readFileSync(this.d.path,'utf8');if(Buffer.byteLength(text)>4*1024*1024)throw Error('outbound journal exceeds recovery bound');const raw:unknown=JSON.parse(text);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('outbound journal corrupt');this.records=raw as Record<string,OutboundRecord>;return this.list()
  }

  /**
   * Owner ruling 2026-11-12: an approved card authorizes the sender scope for its exact address, while that approved
   * text is being sent — and for nothing else, at no other time. The target as a scope check names it (a canvas team
   * without its `@<fp8>`, a member handle with or without it).
   */
  authorizes(target: string): boolean {
    for (const address of this.sending.keys()) if (target === address || target === bare(address)) return true
    return false
  }

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
    if(this.list().some(r=>r.narrowRecovery&&r.ticketId===ticketId&&r.address===address&&r.text===text))return {ok:false,code:'outbound-recovery-fenced',error:'该原业务已有窄恢复链，不能另建外发卡或重派；请按原恢复 task 对账。'}
    if (text === '' || text.length > OUTBOUND_TEXT_MAX) return { ok: false, code: 'text', error: `text is required, at most ${String(OUTBOUND_TEXT_MAX)} characters` }
    if (this.list().filter(r => r.ticketId === ticketId && (r.state === 'waiting' || r.state === 'sending' || r.state === 'unknown' || r.state === 'sent')).length >= OUTBOUND_PER_TICKET) return { ok: false, code: 'too-many', error: `a ticket has at most ${String(OUTBOUND_PER_TICKET)} outbound requests waiting or unanswered` }
    const question = `以本团队名义向 ${address} 发出请求吗？（工单「${clip(ctx.ticket.title, 80)}」）\n发出的原文：\n${text}`
    return { ok: true, ticketId, address, text, question, ...(why !== '' ? { reason: clip(why, 1000) } : {}) }
  }

  /** A card was raised for a checked request. */
  waiting(card: string, ticketId: string, address: string, text: string, by: string): void {
    if (this.records[card] !== undefined) return
    this.put({ card, ticketId, address, text, by, at: this.d.now(), state: 'waiting' })
  }

  /**
   * The card was decided (O4): on approval, send the approved text under a header naming the team and the ticket.
   * @returns the task id when it went out.
   */
  async decided(card: string, approved: boolean, team: string, titleOf: (ticketId: string) => string | undefined): Promise<string | undefined> {
    const record = this.records[card]
    if (record === undefined || record.state !== 'waiting' || this.busy.has(card)) return undefined
    if(this.list().some(r=>r.narrowRecovery&&r.ticketId===record.ticketId&&r.address===record.address&&r.text===record.text))return undefined
    this.busy.add(card)
    try {
      if (!approved) {
        this.put({ ...record, state: 'declined' })
        this.d.note(record.ticketId, `对外请求（发往 ${record.address}）未获批准，没有发出。`)
        return undefined
      }
      const header = `[来自 superagent 团队 ${team} 的请求 · 工单「${clip(titleOf(record.ticketId) ?? '', 80)}」]`
      const current = this.d.approval?.(record)
      if (current?.ok === false) return undefined
      const approval = current?.ok === true ? { at: current.at, team: current.team, message: current.message } : { at: this.d.now(), team, message: `${header}\n${record.text}` }
      return await this.sendAttempt({ ...record, approval })
    } finally { this.busy.delete(card) }
  }

  /** Owner-only face calls this with the task it displayed. Reconcile alone never sends. */
  async recover(card: string, expectedTask: string, retry: boolean): Promise<OutboundRecovery> {
    const refuse = (code: string, error: string): OutboundRecovery => ({ ok: false, code, error })
    let record = this.records[card]
    if (record === undefined || record.task !== expectedTask || expectedTask === '') return refuse('outbound-changed', '外发记录已变化，请刷新后按原 task 对账。')
    if(record.narrowRecovery)return refuse('outbound-narrow-recovery','该原请求已有固定窄恢复链，只能按该恢复 task 对账，不可普通重试。')
    if (this.busy.has(card)) return refuse('outbound-busy', '该外发正在处理，请勿重复提交。')
    if (record.state !== 'failed' && record.state !== 'unknown' && record.state !== 'sending') return refuse('outbound-state', '该记录不需要恢复；已发送的请求只等原回执。')
    const approval = this.d.approval?.(record)
    if (approval === undefined) return refuse('outbound-approval', '无法核实原批准，未发送。')
    if (!approval.ok) return approval
    if (record.approval !== undefined && (record.approval.at !== approval.at || record.approval.team !== approval.team || record.approval.message !== approval.message)) return refuse('outbound-approval', '原批准或原文已变化，未发送。')
    this.busy.add(card)
    try {
      const attempt = record.attempts?.at(-1)
      if (attempt === undefined || record.approval === undefined || attempt.task !== record.task) return refuse('outbound-unknown', '旧失败缺少原发送载荷和可靠投递证据，只能人工核账，不可换 ID 重派。')
      const preparing = attempt.phase === 'preparing' && attempt.delivery === 'not-sent'
      const sender = await this.d.sender?.(preparing && retry)
      if ((sender === undefined || sender === '') && !(preparing && !retry && attempt.sender === '')) return refuse('outbound-identity', '团队发送身份不可用，未发送。')
      if (attempt.sender !== sender && !(preparing && attempt.sender === '')) return refuse('outbound-identity', '团队发送身份已变化，请先核账；未发送。')
      let seen: OutboundAttempt['delivery'] = preparing ? 'not-sent' : 'unknown'
      if (!preparing) {
        try { seen = (await this.d.query?.(record, attempt))?.delivery ?? 'unknown' } catch { /* missing/expired/failed query cannot authorize another dispatch */ }
      }
      const current = this.records[card]
      if (current?.task !== expectedTask) return refuse('outbound-changed', '对账期间 task 已变化，未再次发送。')
      if (current.state === 'answered' || current.state === 'sent') return { ok: true, state: current.state, task: current.task }
      record = current
      if (seen === 'accepted') {
        const reconciled = { ...record, state: 'sent' as const, attempts: record.attempts!.map(a => a.task === attempt.task ? { ...a, delivery: 'accepted' as const } : a) }
        this.put(reconciled)
        return { ok: true, state: 'sent', task: record.task }
      }
      if (seen !== 'not-sent') return refuse('outbound-unknown', '接纳状态未知，请按原 task 对账；没有再次发送。')
      record = { ...record, state: 'failed', attempts: record.attempts!.map(a => a.task === attempt.task ? { ...a, delivery: 'not-sent' as const } : a) }
      this.put(record)
      if (!retry) return { ok: true, state: 'failed', task: record.task }
      // A source/ticket/approval can be revoked while a query or identity lookup is in flight.
      const latest = this.d.approval?.(record)
      if (latest === undefined || !latest.ok) return latest ?? refuse('outbound-approval', '原批准不可用，未发送。')
      if (latest.at !== record.approval!.at || latest.team !== record.approval!.team || latest.message !== record.approval!.message) return refuse('outbound-approval', '对账期间原批准发生变化，未发送。')
      if ((await this.d.sender?.()) !== sender) return refuse('outbound-identity', '对账期间团队身份发生变化，未发送。')
      const afterIdentity = this.records[card]
      if (afterIdentity?.task !== expectedTask || afterIdentity.state !== 'failed') return { ok: false, code: 'outbound-changed', error: '对账期间外发状态变化，请刷新；没有重派。' }
      const finalApproval = this.d.approval?.(afterIdentity)
      if (finalApproval === undefined || !finalApproval.ok) return finalApproval ?? refuse('outbound-approval', '原批准不可用，未发送。')
      if (finalApproval.at !== record.approval!.at || finalApproval.team !== record.approval!.team || finalApproval.message !== record.approval!.message) return refuse('outbound-approval', '原批准已变化，未发送。')
      if ((record.attempts?.length ?? 0) >= 20) return refuse('outbound-attempt-limit', '该原卡已达到恢复尝试上限，请维护核账。')
      const task = await this.sendAttempt(record, sender)
      const result = this.records[card]!
      return task !== undefined ? { ok: true, state: result.state, task } : refuse(result.state === 'failed' ? 'outbound-not-sent' : 'outbound-unknown', result.error ?? '未确认投递，请对账。')
    } finally { this.busy.delete(card) }
  }

  private async sendAttempt(record: OutboundRecord, sender?: string): Promise<string | undefined> {
    const approval = record.approval!
    const task = 'out-' + randomUUID()
    const attempt: OutboundAttempt = { task, sender: sender ?? '', at: this.d.now(), phase: 'preparing', delivery: 'not-sent' }
    this.put({ ...record, state: 'failed', task, attempts: [...(record.attempts ?? []), attempt], error: '原批准已保存，正在准备发送身份；尚未执行发送。' })
    const prepared = this.records[record.card]!
    let identity: string
    try {
      identity = sender ?? await this.d.sender?.(true) ?? ''
      const checked = this.d.approval?.(prepared)
      if (checked !== undefined && (!checked.ok || checked.at !== approval.at || checked.team !== approval.team || checked.message !== approval.message)) {
        this.put({ ...prepared, error: checked.ok ? '发送前原批准发生变化，没有发送。' : checked.error })
        return undefined
      }
    } catch (error) {
      const why = clip(error instanceof Error ? error.message : String(error), 600)
      this.put({ ...prepared, error: '发送身份准备失败，没有执行发送：' + why })
      this.d.note(record.ticketId, '已批准外发的身份准备失败，原批准保留且尚未发送；请在主人界面对账后恢复。')
      return undefined
    }
    // A stale instance cannot reserve the same record again: disk CAS precedes the dispatch call.
    const dispatching: OutboundRecord = { ...prepared, state: 'sending', attempts: prepared.attempts!.map(a => a.task === task ? { ...a, sender: identity, phase: 'dispatching' as const, delivery: 'unknown' as const } : a) }
    delete dispatching.error
    this.put(dispatching, prepared)
    let sent: string | undefined, errorText: string | undefined, notSent = false
    this.sending.set(record.address, (this.sending.get(record.address) ?? 0) + 1)
    try {
      sent = await this.d.ask(record.address, approval.message, task, identity)
      if (sent !== undefined && identity !== '' && sent !== task) {
        errorText = '发送方返回了另一个 task，原尝试接纳未知；请对账，不重派。'
        sent = undefined
      }
    } catch (error) {
      errorText = clip(error instanceof Error ? error.message : String(error), 600)
      if (error !== null && typeof error === 'object') {
        const failure = error as { delivery?: unknown; task?: unknown }
        notSent = failure.delivery === 'not-sent' && failure.task === task
      }
    } finally {
      const left = (this.sending.get(record.address) ?? 1) - 1
      if (left > 0) this.sending.set(record.address, left)
      else this.sending.delete(record.address)
    }
    const latest = this.records[record.card]!
    if (latest.state === 'answered') return latest.task
    const delivery: OutboundAttempt['delivery'] = sent !== undefined ? 'accepted' : notSent ? 'not-sent' : 'unknown'
    const next: OutboundRecord = { ...latest, state: sent !== undefined ? 'sent' : notSent || identity === '' ? 'failed' : 'unknown', task: sent ?? task,
      attempts: latest.attempts!.map(a => a.task === task ? { ...a, delivery, ...(errorText !== undefined ? { error: errorText } : {}) } : a),
      ...(sent === undefined ? { error: errorText ?? '没有取得确定投递结果，请按原 task 对账。' } : {}) }
    if (sent !== undefined) delete next.error
    this.put(next)
    this.d.note(record.ticketId, sent !== undefined
      ? '对外请求已发往 ' + record.address + '（task ' + sent + '）；对方的回执到了会再告诉你。'
      : '对外请求（发往 ' + record.address + '，task ' + task + '）已获批准，但' + (notSent ? '未发送' : '接纳状态未知') + '：' + next.error)
    return sent
  }

  /** CAS all original same-request records before continuation; legacy results stay unchanged. */
  bindNarrowRecovery(records:readonly OutboundRecord[],proposal:RecoveryProposal):void {
    if(!verifyRecoveryProposal(proposal)||records.length===0)throw Error('invalid narrow recovery proposal')
    const state={proposal,phase:'prepared' as const}
    this.putRecovery(records.map(r=>({...r,narrowRecovery:{...state,digest:narrowRecoveryDigest(state)}})),records)
  }
  narrowPhase(records:readonly OutboundRecord[],phase:'dispatching'|'accepted'|'unknown'):void {
    this.putRecovery(records.map(r=>{const old=r.narrowRecovery;if(!old||old.digest!==narrowRecoveryDigest(old))throw Error('missing or damaged recovery proposal');if(old.phase==='answered')return r;if(phase==='dispatching'&&old.phase!=='prepared'||phase==='unknown'&&old.phase==='accepted')throw Error('recovery transition would reopen a completed attempt');const next={...old,phase};return {...r,narrowRecovery:{...next,digest:narrowRecoveryDigest(next)}}}),records)
  }
  private putRecovery(nextRecords:readonly OutboundRecord[],expected:readonly OutboundRecord[]):void {
    mkdirSync(dirname(this.d.path),{recursive:true});const lock=this.d.path+'.lock',token=randomUUID()
    writeFileSync(lock,token,{flag:'wx',mode:0o600})
    try{
      const raw:unknown=JSON.parse(readFileSync(this.d.path,'utf8'))
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('outbound storage corrupt')
      const fresh=raw as Record<string,OutboundRecord>
      const first=expected[0];if(!first)throw Error('empty original chain')
      const same=Object.values(fresh).filter(r=>r.ticketId===first.ticketId&&r.address===first.address&&r.text===first.text).map(r=>r.card).sort()
      if(JSON.stringify(same)!==JSON.stringify(expected.map(r=>r.card).sort())){this.records=fresh;throw Error('original same-request group changed; refresh')}
      for(const r of expected)if(JSON.stringify(fresh[r.card])!==JSON.stringify(r)){this.records=fresh;throw Error('original outbound chain changed; refresh')}
      const next={...fresh};for(const r of nextRecords)next[r.card]=r
      writeTaskLedger(this.d.path,JSON.stringify(next));this.records=next
    }finally{if(readFileSync(lock,'utf8')===token)rmSync(lock)}
  }

  /** Keep an authenticated result once for the original ticket; ACK/progress do not complete business. */
  private receivedNarrow(trigger:Trigger,task:string):boolean {
    const records=Object.values(this.records).filter(r=>r.narrowRecovery?.proposal.binding.taskId===task)
    if(records.length===0)return false
    const first=records[0]!.narrowRecovery!,b=first.proposal.binding
    if(records.length!==b.originalCards.length||records.some(r=>!r.narrowRecovery||r.narrowRecovery.digest!==narrowRecoveryDigest(r.narrowRecovery)||recoveryDigest(r.narrowRecovery.proposal)!==recoveryDigest(first.proposal)||!b.originalCards.includes(r.card)))return true
    if(first.phase==='prepared'||typeof trigger.meta.proof!=='string'||!TRUSTED_PROOFS.has(trigger.meta.proof)||trigger.actor.id!==b.target)return true
    const at=trigger.text.indexOf('[A2A receipt] task '),parsed=at<0?null:parseReceipt(trigger.text.slice(at))
    if(parsed?.taskId!==task||holdsRow(parsed.envelope)||this.d.narrowReceipt?.(b,trigger.actor.id,trigger.text)!==true)return true
    if(records.some(r=>r.narrowRecovery!.answer)) {this.flushNarrowNotes();return true}
    const answer={text:clip(trigger.text,2000),at:trigger.at,triggerId:trigger.id}
    this.putRecovery(records.map(r=>{const state={...r.narrowRecovery!,phase:'answered' as const,answer};return {...r,narrowRecovery:{...state,digest:narrowRecoveryDigest(state)}}}),records)
    this.flushNarrowNotes();return true
  }
  /** Called by the existing team pass. A note checkpoint failure retries the same idempotent original-ticket note. */
  flushNarrowNotes():void {
    if(!this.d.narrowNote)return
    const seen=new Set<string>()
    for(const row of Object.values(this.records)){
      const n=row.narrowRecovery;if(!n||!n.answer||n.phase!=='answered'||n.noted||seen.has(n.proposal.binding.requestId))continue
      seen.add(n.proposal.binding.requestId)
      if(n.digest!==narrowRecoveryDigest(n))throw Error('recovery answer integrity mismatch')
      const text='原外发窄恢复（'+n.proposal.binding.target+'，task '+n.proposal.binding.taskId+'）的回执：'+n.answer.text
      if(!this.d.narrowNote(row.ticketId,text))continue
      const records=Object.values(this.records).filter(r=>r.narrowRecovery?.proposal.binding.requestId===n.proposal.binding.requestId)
      this.putRecovery(records.map(r=>{const state={...r.narrowRecovery!,noted:true as const};return {...r,narrowRecovery:{...state,digest:narrowRecoveryDigest(state)}}}),records)
    }
  }

  private writeNote(ticketId: string, text: string): NoteResult {
    if (this.d.noteOnce !== undefined) { try { return this.d.noteOnce(ticketId, text) } catch { return 'failed' } }
    try { this.d.note(ticketId, text); return 'written' } catch { return 'failed' }
  }

  /**
   * A mailbox row: the other team's formal receipt on a sent request's task (O5). An acknowledgement, a progress step or an
   * attention carrying a question keeps the request open (the same rule as the task ledger's holdsRow), so the final
   * result still matches. Only a final receipt answers it: the answer is stored first, then its note is written (see
   * flushOutboundNotes), so a restart or a failed note leaves the note owed, never lost.
   */
  received(trigger: Trigger): void {
    const receiptFor = trigger.meta.receiptFor
    if (typeof receiptFor !== 'string') return
    if(this.receivedNarrow(trigger,receiptFor))return
    const record = Object.values(this.records).find(r => r.task === receiptFor && (r.state === 'sent' || r.state === 'sending' || r.state === 'unknown' || (r.state === 'failed' && r.attempts?.at(-1)?.phase === 'dispatching' && r.attempts.at(-1)?.delivery === 'not-sent')))
    if (record === undefined) return
    if (typeof trigger.meta.proof !== 'string' || !TRUSTED_PROOFS.has(trigger.meta.proof)) return
    const accepted = record.attempts !== undefined ? { attempts: record.attempts.map(a => a.task === receiptFor ? { ...a, delivery: 'accepted' as const } : a) } : {}
    const at = trigger.text.indexOf('[A2A receipt] task '), parsed = at < 0 ? null : parseReceipt(trigger.text.slice(at))
    // A receipt line naming another task than the one this row answers is not this request's receipt.
    if (parsed !== null && parsed.taskId !== receiptFor) return
    const interim = parsed !== null && holdsRow(parsed.envelope)
    // #881 v2 B2: only the ledger's positive verdict on this receipt makes it an answer (or a progress step); a refused or
    // unsettled one is kept for the health view and the request stays as it was.
    const standing = receiptStanding(trigger, interim)
    if (!standing.ok) {
      const kept = keepUnsettled(record.unsettled, standing.unsettled)
      if (JSON.stringify(kept) !== JSON.stringify(record.unsettled ?? [])) this.put({ ...record, unsettled: kept })
      this.d.logger.warn('superagent: receipt for outbound task %s not settled by the ledger (%s); not written to ticket %s', receiptFor, standing.unsettled.settlement, record.ticketId)
      return
    }
    if (interim) {
      const open: OutboundRecord = { ...record, state: 'sent', ...accepted }
      delete open.error
      if (JSON.stringify(open) !== JSON.stringify(record)) this.put(open)
      this.writeNote(record.ticketId, `对外请求（${record.address}，task ${receiptFor}）的进展（尚未结束）：${clip(trigger.text, 2000)}`)
      return
    }
    this.put({ ...record, state: 'answered', answer: { text: clip(trigger.text, 2000), at: trigger.at, key: trigger.id }, ...accepted })
    this.flushOutboundNotes()
  }

  /**
   * Write every owed answer note, once each. Called on each answer and by the team pass, so a note that failed, or was
   * lost to a restart between storing the answer and writing it, is written later. `noted` is stored only after the note
   * is in the ticket; the note writer skips a note already there, so a note written before a crash is not written twice.
   * An ended ticket is marked, not reopened, and the original request is never sent again.
   */
  flushOutboundNotes(): void {
    for (const row of Object.values(this.records)) {
      if (row.state !== 'answered' || row.answer === undefined || row.noted === true || row.noteBlocked !== undefined || row.narrowRecovery !== undefined) continue
      const result = this.writeNote(row.ticketId, outboundAnswerNote(row))
      if (result === 'failed') { this.d.logger.warn('superagent: outbound answer note on %s (task %s) is still owed', row.ticketId, row.task ?? ''); continue }
      const latest = this.records[row.card]
      if (latest === undefined || latest.noted === true || latest.noteBlocked !== undefined) continue
      if (result === 'ended') this.d.logger.warn('superagent: outbound answer for ended ticket %s (task %s) not noted; the ticket is not reopened', row.ticketId, row.task ?? '')
      // One record that cannot be saved (a held lock, a disk error) stays owed and does not stop the others this pass.
      try { this.put(result === 'written' ? { ...latest, noted: true } : { ...latest, noteBlocked: 'ticket-ended' }) } catch (error) { this.d.logger.warn('superagent: outbound note checkpoint for %s not saved, retried next pass: %s', row.card, String(error)) }
    }
  }

  /** #881 v2 B2: requests still waiting for an answer whose receipts so far the ledger did not settle positively. */
  unsettledProblems(): Array<{ readonly ticketId: string; readonly card: string; readonly task: string; readonly last: UnsettledReceipt }> {
    return Object.values(this.records).filter(r => r.state !== 'answered' && (r.unsettled?.length ?? 0) > 0).map(r => ({ ticketId: r.ticketId, card: r.card, task: r.task ?? '', last: r.unsettled!.at(-1)! }))
  }

  /** Answers still owed a note, and answers that arrived for an ended ticket (both health problems). */
  noteProblems(): OutboundNoteProblem[] {
    const out: OutboundNoteProblem[] = []
    for (const r of Object.values(this.records)) {
      if (r.state !== 'answered' || r.answer === undefined || r.noted === true || r.narrowRecovery !== undefined) continue
      // An answer stored before this check (no key) whose ticket had ended is history, not news: only pending ones of it count.
      if (r.noteBlocked !== undefined && r.answer.key === undefined) continue
      out.push({ kind: r.noteBlocked !== undefined ? 'ticket-ended' : 'pending', ticketId: r.ticketId, card: r.card, task: r.task ?? '', at: r.answer.at })
    }
    return out
  }
}
