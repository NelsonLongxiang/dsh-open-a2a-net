/** H-side one-hop forwarding. Never resolves or dispatches local candidates again. */
import { capacityRefusalFields, type CapacityRefusal } from './task-delivery-capacity.ts'
import { DEFAULT_HOP_BUDGET, guardHeader, mintGuard } from './recursion-guard.ts'
import { briefOf, type OutboundBirth, type TaskLedger, type TaskRecord } from './task-ledger.ts'
import { parseReceipt, receiptTaskId } from './receipt.ts'
import {peerPayloadFingerprint} from './idempotency-store.ts'
import { splitCanvasOwner } from './canvas-id.ts'
import { splitQualifiedMember } from './canvas-member.ts'
import { claimCovers, type TaskAuthorization } from './task-auth.ts'
import type { A2aPeerCard, A2aRouteResult } from './types.ts'

export interface ForwardRequest {
  team: string; message: string; caller: string; taskId: string; contextId?: string; noWait: boolean
  localCliProof: boolean; guarded: boolean
  auth?: TaskAuthorization
}
/** An early receipt waits at most this long for its forward row to be born (#298). */
export const BIRTH_WAIT_CAP_MS = 60_000
/** Birth barrier exists only for eligible, actively dispatched tasks; receipts never reserve a slot. */
export class ForwardBirths {
  private readonly pending = new Map<string, Promise<void>>()
  constructor(private readonly waitCapMs = BIRTH_WAIT_CAP_MS) {}
  /**
   * Resolves when the birth is released or after the cap, whichever is first. After the cap the receipt
   * is judged by the normal rules against whatever row exists then — never accepted in advance (#298).
   */
  wait(taskId: string): Promise<void> | undefined {
    const birth = this.pending.get(taskId)
    if (birth === undefined) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const cap = new Promise<void>(resolve => { timer = setTimeout(resolve, this.waitCapMs); (timer as { unref?: () => void }).unref?.() })
    return Promise.race([birth, cap]).finally(() => clearTimeout(timer))
  }
  begin(taskId: string): (() => void) | undefined {
    if (this.pending.size >= 64 || this.pending.has(taskId)) return undefined
    let release!: () => void
    this.pending.set(taskId, new Promise<void>(resolve => { release = resolve }))
    return () => { this.pending.delete(taskId); release() }
  }
}
export interface DirectForwardDeps {
  births: ForwardBirths
  enabled(): boolean
  isolated(): boolean
  deposited(handle: string): boolean
  scope(handle: string, team: string): Promise<{ ok: true } | { ok: false; error: string }>
  candidates(team: string, failures: string[], caller: string): Promise<{ urls: string[]; card(url: string): Promise<A2aPeerCard | undefined> }>
  dispatch(url: string, request: ForwardRequest, guard: string): Promise<A2aRouteResult>
  ledger: TaskLedger
  activity(team: string, peer: string, ok: boolean): void
  /** Records a forward allowed to skip team-scope as the receipt of an admitted task (via=receipt-of-admitted), with its kind. */
  audit?(via: 'receipt-of-admitted', taskId: string, team: string, kind: AdmittedReceipt['kind']): void
  /** A receipt of an admitted task over the bypass's per-kind bounds: judged by team-scope, and warned. */
  bypassRefused?(taskId: string, team: string, kind: AdmittedReceipt['kind'], reason: string): void
  /** The bypass's bounds (config), defaults when absent. */
  receiptBypassLimits?(): ReceiptBypassLimits
  now?(): number
}

/** The bypass's bounds on non-settling receipts (observer ruling 2026-11-23, bound 2); from config, with defaults. */
export interface ReceiptBypassLimits { progressMax: number; progressIntervalMs: number }
export const RECEIPT_BYPASS_DEFAULTS: ReceiptBypassLimits = { progressMax: 20, progressIntervalMs: 60_000 }
/** A receipt the bypass may carry: its task, its kind and, for an attention, its question id. */
export interface AdmittedReceipt { taskId: string; kind: 'result' | 'attention' | 'acknowledged' | 'progress'; questionId?: string }

/**
 * Observer ruling 2026-11-23 (ticket c981a2f2, as the owner's delegate; revocable): a formal receipt for an inbound task
 * this host admitted answers that admission, so the sender's team-scope does not judge it again (3.65: the request came in,
 * its receipt could not go back). Only when every condition holds:
 * - the message is exactly this task's receipt: a receipt header and at most one envelope line, no artifacts, and its
 *   transport id is the one that receipt kind rides (`receiptTaskId`) — no free text, files or other ids (bound 3);
 * - this host's ledger holds that task inbound and still owed (bound 1: once it is settled, nothing more passes);
 * - the sender is the identity it is owed by, and the target is exactly the receipt target recorded at admission (the
 *   address the forward resolves, owner qualifier included).
 * The per-kind counts (bound 2) are kept by the forwarder. Anything else is judged by team-scope as before (default refuse).
 */
export function admittedReceipt(ledger: TaskLedger, caller: string, target: string, message: string, transportId: string): AdmittedReceipt | undefined {
  const receipt = parseReceipt(message)
  if (receipt === null || receipt.taskId === '') return undefined
  const row = ledger.find(receipt.taskId)
  if (row === undefined || row.direction !== 'inbound' || row.status !== 'pending' || row.team !== caller) return undefined
  if (row.auth === undefined || row.auth.receipt_target !== target) return undefined
  const envelope = receipt.envelope
  const lines = message.split('\n')
  if (lines.length !== (envelope !== undefined ? 2 : 1)) return undefined
  // Files: judged on the raw line, not the parsed envelope — the parser drops artifact entries it cannot read, while the
  // line still carries them to the receiver.
  if (envelope !== undefined) { try { if (Object.prototype.hasOwnProperty.call(JSON.parse(lines[1]!) as object, 'artifacts')) return undefined } catch { return undefined } }
  const kind = envelope?.disposition ?? 'result'
  if (transportId !== receiptTaskId(receipt.taskId, kind, envelope?.question, envelope?.progress)) return undefined
  return { taskId: receipt.taskId, kind, ...(kind === 'attention' && envelope?.question !== undefined ? { questionId: envelope.question.id } : {}) }
}
/** The admitted task id, or undefined (see admittedReceipt). */
export function receiptOfAdmitted(ledger: TaskLedger, caller: string, target: string, message: string, transportId: string): string | undefined {
  return admittedReceipt(ledger, caller, target, message, transportId)?.taskId
}

/** The bounds from config: a non-finite or negative value falls back to the default, never to no limit (NaN compares false). */
export function receiptBypassLimitsFrom(progressMax: number, progressIntervalMs: number): ReceiptBypassLimits {
  return {
    progressMax: Number.isFinite(progressMax) && progressMax >= 0 ? Math.floor(progressMax) : RECEIPT_BYPASS_DEFAULTS.progressMax,
    progressIntervalMs: Number.isFinite(progressIntervalMs) && progressIntervalMs >= 0 ? progressIntervalMs : RECEIPT_BYPASS_DEFAULTS.progressIntervalMs,
  }
}

/**
 * Bound 2. The acknowledgement and each attention question pass once because admittedReceipt binds each to its one fixed
 * transport id (ack-<task>, attention-<task>-<question id>): sending it again is the same receipt, idempotent at the
 * receiver. Progress carries a step number in its id, so it is counted here: up to progressMax per task, no closer than
 * progressIntervalMs; a resend of a step that already passed is idempotent and passes again. A formal result settles the
 * row, which ends the bypass. Kept in memory: a restart starts the counts again.
 */
class ReceiptBypassCounts {
  private readonly tasks = new Map<string, { passed: Set<string>; progress: number; lastProgressAt: number }>()
  check(receipt: AdmittedReceipt, transportId: string, limits: ReceiptBypassLimits, now: number, owed: (taskId: string) => boolean): string | undefined {
    for (const id of this.tasks.keys()) if (!owed(id)) this.tasks.delete(id)
    const t = this.tasks.get(receipt.taskId) ?? { passed: new Set<string>(), progress: 0, lastProgressAt: 0 }
    if (receipt.kind !== 'progress' || t.passed.has(transportId)) return undefined
    {
      if (t.progress >= limits.progressMax) return `more than ${String(limits.progressMax)} progress receipts for this task`
      if (t.progress > 0 && now - t.lastProgressAt < limits.progressIntervalMs) return `progress receipts less than ${String(limits.progressIntervalMs)} ms apart`
      t.progress += 1; t.lastProgressAt = now
    }
    t.passed.add(transportId)
    if (!this.tasks.has(receipt.taskId) && this.tasks.size >= 1000) this.tasks.delete(this.tasks.keys().next().value!)
    this.tasks.set(receipt.taskId, t)
    return undefined
  }
}
const peerDispatchFingerprint=(r:ForwardRequest)=>peerPayloadFingerprint({caller:r.caller,team:r.team,message:JSON.stringify([r.message,r.contextId??'']),noWait:r.noWait})
export function createDirectForward(d: DirectForwardDeps) {
  const bypassCounts = new ReceiptBypassCounts()
  return async (request: ForwardRequest): Promise<A2aRouteResult> => {
    let dispatchAttempted = false
    const refuse = (why: string, next?: string): A2aRouteResult => ({ ok: false, code: -32000, task_id: request.taskId, ...(!dispatchAttempted ? { delivery: 'not-sent' as const } : {}), error: 'not forwarded: ' + why, ...(next !== undefined ? { next } : {}) })
    const publish = 'run `a2a-net publish` to renew this CLI deposit on its home host, then send again with a new task id'
    if (!d.enabled()) return refuse('forwardDirect is off', 'ask this host\'s operator to set forwardDirect: true (the default since 0.6.38)')
    if (d.isolated()) return refuse('host is isolated', 'this host forwards nothing while isolated; deposit the CLI on another home host')
    if (request.guarded) return refuse('an inbound X-A2A-Guard is present; already forwarded')
    // Two different causes, two different repairs: a renewal cannot bind a signature, and a binding cannot renew a deposit.
    if (!request.localCliProof) return refuse('caller has no bound CLI signature on this host (unsigned, signed by another identity, or an OriginClaim bound to an origin this host does not list); renewing the deposit does not change this', 'dial an address this host lists as its own (its card URL), or ask its operator to add the dialled origin to originClaimAudiences; `a2a-net status` names the miss')
    if (!d.deposited(request.caller)) return refuse('caller is not an online local CLI deposit', publish)
    // #282 S2: candidates honour an owner-qualified id; scope, the peer, the receivers and the ledger see the plain team.
    const qualifiedMember = splitQualifiedMember(request.team)
    const plainTeam = qualifiedMember?.handle ?? splitCanvasOwner(request.team).team
    // #853 review (blocking): compare the address the forward resolves, owner qualifier included — an @<fp8> picks another
    // owner's same-named member, so the stripped form would let a receipt reach someone other than the recorded target.
    const receipt = admittedReceipt(d.ledger, request.caller, request.team, request.message, request.taskId)
    const over = receipt === undefined ? undefined : bypassCounts.check(receipt, request.taskId, d.receiptBypassLimits?.() ?? RECEIPT_BYPASS_DEFAULTS, d.now?.() ?? Date.now(), id => d.ledger.find(id)?.status === 'pending')
    if (receipt !== undefined && over !== undefined) d.bypassRefused?.(receipt.taskId, request.team, receipt.kind, over)
    const admitted = receipt !== undefined && over === undefined ? receipt : undefined
    if (admitted !== undefined) d.audit?.('receipt-of-admitted', admitted.taskId, request.team, admitted.kind)
    const scope = admitted !== undefined ? { ok: true as const } : await d.scope(request.caller, qualifiedMember ? request.team : plainTeam)
    if (!scope.ok) return refuse('target is outside sender scope: ' + scope.error, `ask this host's operator to link ${request.team} here: drag it (or one of its members) into a canvas team on this host`)
    const failures: string[] = []
    const capacityRefusals: CapacityRefusal[] = []
    let capacityCounted = 0
    const directory = await d.candidates(request.team, failures, request.caller)
    const guard = guardHeader({ ...mintGuard(), hopBudget: DEFAULT_HOP_BUDGET - 1 })
    for (const url of directory.urls) {
      if (!d.deposited(request.caller)) return refuse('local CLI deposit expired before dispatch', publish)
      const peerCard = await directory.card(url)
      const receivers = plainTeam.includes('/canvas/') ? peerCard?.canvasOrg?.find(row => row.team === plainTeam)?.members.filter(member => member !== request.caller) : undefined
      if (plainTeam.includes('/canvas/')) {
        // #282 S3 (same team authorizes): the owner's signed canvas is the return path; receipts settle only from these frozen receivers on this peer key (#274).
        if (receivers === undefined || receivers.length === 0) {
          failures.push(url + ': the owner card lists no receiving member of this canvas')
          continue
        }
      }
      // Reserve only after all eligibility/receiver-link gates. A receipt owes no receipt.
      const receipt = parseReceipt(request.message) !== null
      const release = receipt ? () => {} : d.births.begin(request.taskId)
      if (release === undefined) return refuse('forward receipt correlation capacity is full', 'wait for in-flight forwards to settle, then send again with a new task id')
      let retained=false,reserved=false
      try {
        if(!receipt)try{d.ledger.reserveDispatch(request.taskId,peerDispatchFingerprint(request));reserved=true}catch{return refuse('durable dispatch capacity unavailable; nothing forwarded')}
        // The same selected-peer snapshot supplies both return-link gate and settlement birth.
        dispatchAttempted = true
        const answer = await d.dispatch(url, plainTeam === request.team ? request : { ...request, team: plainTeam }, guard)
        // A remote peer's failure is never this home's pre-dispatch proof.
        const normalized = answer.ok ? answer : (({ delivery: _remoteDelivery, ...failure }) => failure)(answer)
        const result = !normalized.ok && normalized.ownBudgetExhausted === true ? { ...normalized, code: -32005 } : normalized
        d.activity(plainTeam, url, result.ok)
        if(!result.ok&&result.acceptance==='unknown'){retained=true;return{...result,task_id:request.taskId}}
        if (result.ok || result.code === -32005) {
          // A receipt owes no receipt; native bridge rounds have no A2A receipt contract.
          // Match routeTrunk/trackOwedTask rather than manufacturing an unpayable debt.
          if (parseReceipt(request.message) !== null) return { ...result, receipt: 'none' }
          if (result.ok && result.bridge !== undefined) return { ...result, receipt: 'none' }
          const deliveredTo = result.ok ? result.deliveredTo : undefined
          const birth: OutboundBirth = { ...(result.ok&&typeof result.consumed==='boolean'?{consumed:result.consumed}:{}), forwarded: true, ...(request.auth !== undefined ? { auth: request.auth } : {}), ...(peerCard?.publicKey ? { peerKey: peerCard.publicKey } : {}), ...(peerCard?.session ? { peerHost: peerCard.session } : {}), ...(deliveredTo !== undefined ? { deliveredTo } : {}), ...(receivers !== undefined ? { receiverMembers: receivers } : {}) }
          // Exactly one outbound row. A completed sync response is receiptless bookkeeping.
          if (result.ok && result.receiverBookkeeping!=='failed' && (result.task_status === 'TASK_STATE_COMPLETED'&&(result.replyFinal===true||result.bridge==='native-teams'||result.receipt==='mailbox') || result.receipt === 'none')) d.ledger.trackReceiptless(request.taskId, plainTeam, url, request.contextId, briefOf(request.message), { kind: 'cli', id: request.caller }, birth)
          else d.ledger.track(request.taskId, plainTeam, url, request.contextId, briefOf(request.message), { kind: 'cli', id: request.caller }, birth)
          return result
        }
        // The shared dispatcher's sync recovery query may prove a definitive failed
        // outcome; like routeTrunk, that is an eligible miss, not an uncertain -32005.
        if (!result.ok && result.refusal) capacityRefusals.push(result.refusal)
        else if (!result.ok && result.capacityRefusals !== undefined) capacityCounted += result.capacityRefusals
        failures.push(url + ': ' + result.error)
        if (result.code === -32002 || result.code === -32003) return { ...result, task_id: request.taskId }
      }catch{retained=true;return {ok:false,acceptance:'unknown',task_id:request.taskId,error:'original forwarded dispatch or final ledger commit is unresolved; reconcile the original task, do not resend',code:-32000}}finally{release();if(reserved&&!retained)try{d.ledger.releaseDispatch(request.taskId)}catch{/* original persisted reservation remains, never authorizes replay */}}
    }
    const noReceiver = failures.some(f => f.includes('lists no receiving member'))
    const next = noReceiver ? `the owner's canvas ${plainTeam} lists no member besides you; ask its owner to add one, or route to a member's own handle` : failures.length === 0 ? `no linked peer lists ${request.team}; check the name with \`a2a-net teams\`` : undefined
    return { ok: false, code: -32004, task_id: request.taskId, ...(!dispatchAttempted ? { delivery: 'not-sent' as const } : {}), error: 'forwarding to "' + request.team + '" failed: ' + (failures.join('; ') || 'no eligible peer candidate'), ...(next !== undefined ? { next } : {}), ...capacityRefusalFields(capacityRefusals, failures.length, capacityCounted) }
  }
}

/**
 * #282 S3 (same team authorizes): the admission basis for a receipt delivered to a local CLI mailbox
 * from a member the home never linked — only for that CLI's own pending forward, only from a receiver
 * frozen at birth, only when the body-bound (Sig3) claim's card key is the frozen peer key. Anything else:
 * undefined. Trust assumption (design D2): the selected owner host is honest about its own canvas — it may
 * list any label as a receiver, including one of this host's session labels in the same zone.
 */
export function forwardReceiptBasis(row: TaskRecord | undefined, caller: string, cliHandle: string, claim: { readonly caller: string; readonly bound: boolean; readonly bodyBound?: true; readonly card: { readonly publicKey: string } }): string | undefined {
  // The signer's zone must cover the caller label: B never signs for another zone's member (review of #287 M4).
  if (!claimCovers(caller, claim.caller)) return undefined
  if (row === undefined || row.status !== 'pending' || row.forwarded !== true || row.sender?.kind !== 'cli' || row.sender.id !== cliHandle || (row.auth!==undefined&&row.auth.receipt_target!==cliHandle) || row.receiptExpected===false) return undefined
  // Body-bound (Sig3) only: a stripped Sig3 would let a captured envelope carry another body (review of #287 P3-1).
  if (!claim.bound || claim.bodyBound !== true || row.peerKey === undefined || claim.card.publicKey !== row.peerKey) return undefined
  // A legacy canvas deliveredTo is never a receiver; a direct session target equal to row.team is valid.
  if (row.deliveredTo !== undefined && row.deliveredTo.includes('/canvas/')) return undefined
  return (row.deliveredTo !== undefined ? [row.deliveredTo] : row.receiverMembers ?? []).includes(caller) ? `peer-org:${row.team}` : undefined
}

/**
 * Design v5 (v5-B2): a superagent team's receipt to one of this host's own requests, sent from the team host's process face
 * on its canvas's behalf. It is admitted as the answer to that request alone: the row is this host's pending outbound
 * request to a canvas, sent by the very session or CLI the receipt is delivered to; the envelope answers on behalf of that
 * canvas, spelled as the row names it; and the delivery is body-bound-signed by the key the row was born on, from the
 * process label the row recorded (when it did). Nothing else the team host sends rides this.
 */
export function teamReceiptBasis(row: TaskRecord | undefined, caller: string, target: string, onBehalfOf: string | undefined, claim: { readonly bound: boolean; readonly bodyBound?: true; readonly card: { readonly publicKey: string } }): string | undefined {
  if (row === undefined || row.direction !== 'outbound' || row.status !== 'pending' || row.receiptExpected === false) return undefined
  if (!row.team.includes('/canvas/') || onBehalfOf !== row.team) return undefined
  if (row.sender === undefined || row.sender.id !== target) return undefined
  if (!claim.bound || claim.bodyBound !== true || row.peerKey === undefined || claim.card.publicKey !== row.peerKey) return undefined
  if (caller.includes('/') || (row.peerHost !== undefined && caller !== row.peerHost)) return undefined
  return `peer-org:${row.team}`
}