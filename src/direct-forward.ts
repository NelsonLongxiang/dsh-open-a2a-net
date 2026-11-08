/** H-side one-hop forwarding. Never resolves or dispatches local candidates again. */
import { DEFAULT_HOP_BUDGET, guardHeader, mintGuard } from './recursion-guard.ts'
import { briefOf, type OutboundBirth, type TaskLedger, type TaskRecord } from './task-ledger.ts'
import { parseReceipt } from './receipt.ts'
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
}
export function createDirectForward(d: DirectForwardDeps) {
  return async (request: ForwardRequest): Promise<A2aRouteResult> => {
    const refuse = (why: string, next?: string): A2aRouteResult => ({ ok: false, code: -32000, task_id: request.taskId, error: 'not forwarded: ' + why, ...(next !== undefined ? { next } : {}) })
    const publish = 'run `a2a-net publish` to renew this CLI deposit on its home host, then send again with a new task id'
    if (!d.enabled()) return refuse('forwardDirect is off', 'ask this host\'s operator to set forwardDirect: true (the default since 0.6.38)')
    if (d.isolated()) return refuse('host is isolated', 'this host forwards nothing while isolated; deposit the CLI on another home host')
    if (request.guarded) return refuse('an inbound X-A2A-Guard is present; already forwarded')
    if (!request.localCliProof || !d.deposited(request.caller)) return refuse('caller is not a proven online local CLI deposit', publish)
    // #282 S2: candidates honour an owner-qualified id; scope, the peer, the receivers and the ledger see the plain team.
    const qualifiedMember = splitQualifiedMember(request.team)
    const plainTeam = qualifiedMember?.handle ?? splitCanvasOwner(request.team).team
    const scope = await d.scope(request.caller, qualifiedMember ? request.team : plainTeam)
    if (!scope.ok) return refuse('target is outside sender scope: ' + scope.error, `ask this host's operator to link ${request.team} here: drag it (or one of its members) into a canvas team on this host`)
    const failures: string[] = []
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
      try {
        // The same selected-peer snapshot supplies both return-link gate and settlement birth.
        const answer = await d.dispatch(url, plainTeam === request.team ? request : { ...request, team: plainTeam }, guard)
        const result = !answer.ok && answer.ownBudgetExhausted === true ? { ...answer, code: -32005 } : answer
        d.activity(plainTeam, url, result.ok)
        if(!result.ok&&result.acceptance==='unknown')return{...result,task_id:request.taskId}
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
        failures.push(url + ': ' + result.error)
        if (result.code === -32002 || result.code === -32003) return { ...result, task_id: request.taskId }
      } finally { release() }
    }
    const noReceiver = failures.some(f => f.includes('lists no receiving member'))
    const next = noReceiver ? `the owner's canvas ${plainTeam} lists no member besides you; ask its owner to add one, or route to a member's own handle` : failures.length === 0 ? `no linked peer lists ${request.team}; check the name with \`a2a-net teams\`` : undefined
    return { ok: false, code: -32004, task_id: request.taskId, error: 'forwarding to "' + request.team + '" failed: ' + (failures.join('; ') || 'no eligible peer candidate'), ...(next !== undefined ? { next } : {}) }
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
