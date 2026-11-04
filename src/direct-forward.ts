/** H-side one-hop forwarding. Never resolves or dispatches local candidates again. */
import { DEFAULT_HOP_BUDGET, guardHeader, mintGuard } from './recursion-guard.ts'
import { briefOf, type OutboundBirth, type TaskLedger } from './task-ledger.ts'
import { parseReceipt } from './receipt.ts'
import type { TaskAuthorization } from './task-auth.ts'
import type { A2aPeerCard, A2aRouteResult } from './types.ts'

export interface ForwardRequest {
  team: string; message: string; caller: string; taskId: string; contextId?: string; noWait: boolean
  localCliProof: boolean; guarded: boolean
  auth?: TaskAuthorization
}
/** Birth barrier exists only for eligible, actively dispatched tasks; receipts never reserve a slot. */
export class ForwardBirths {
  private readonly pending = new Map<string, Promise<void>>()
  wait(taskId: string): Promise<void> | undefined { return this.pending.get(taskId) }
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
  memberLinked(handle: string): boolean
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
    const scope = await d.scope(request.caller, request.team)
    if (!scope.ok) return refuse('target is outside sender scope: ' + scope.error, `ask this host's operator to link ${request.team} here: drag it (or one of its members) into a canvas team on this host`)
    const failures: string[] = []
    const directory = await d.candidates(request.team, failures, request.caller)
    const guard = guardHeader({ ...mintGuard(), hopBudget: DEFAULT_HOP_BUDGET - 1 })
    for (const url of directory.urls) {
      if (!d.deposited(request.caller)) return refuse('local CLI deposit expired before dispatch', publish)
      const peerCard = await directory.card(url)
      const receivers = request.team.includes('/canvas/') ? peerCard?.canvasOrg?.find(row => row.team === request.team)?.members.filter(member => member !== request.caller) : undefined
      if (request.team.includes('/canvas/')) {
        if (receivers === undefined || receivers.length === 0 || receivers.some(member => !d.memberLinked(member))) {
          failures.push(url + ': forwarding a canvas requires a direct operator link to every receiving member for its receipt return path')
          continue
        }
      }
      // Reserve only after all eligibility/receiver-link gates. A receipt owes no receipt.
      const receipt = parseReceipt(request.message) !== null
      const release = receipt ? () => {} : d.births.begin(request.taskId)
      if (release === undefined) return refuse('forward receipt correlation capacity is full', 'wait for in-flight forwards to settle, then send again with a new task id')
      try {
        // The same selected-peer snapshot supplies both return-link gate and settlement birth.
        const answer = await d.dispatch(url, request, guard)
        const result = !answer.ok && answer.ownBudgetExhausted === true ? { ...answer, code: -32005 } : answer
        d.activity(request.team, url, result.ok)
        if (result.ok || result.code === -32005) {
          // A receipt owes no receipt; native bridge rounds have no A2A receipt contract.
          // Match routeTrunk/trackOwedTask rather than manufacturing an unpayable debt.
          if (parseReceipt(request.message) !== null) return { ...result, receipt: 'none' }
          if (result.ok && result.bridge !== undefined) return { ...result, receipt: 'none' }
          const deliveredTo = result.ok ? result.deliveredTo : undefined
          const birth: OutboundBirth = { forwarded: true, ...(request.auth !== undefined ? { auth: request.auth } : {}), ...(peerCard?.publicKey ? { peerKey: peerCard.publicKey } : {}), ...(peerCard?.session ? { peerHost: peerCard.session } : {}), ...(deliveredTo !== undefined ? { deliveredTo } : {}), ...(receivers !== undefined ? { receiverMembers: receivers } : {}) }
          // Exactly one outbound row. A completed sync response is receiptless bookkeeping.
          if (result.ok && (result.task_status === 'TASK_STATE_COMPLETED' || result.receipt === 'none')) d.ledger.trackReceiptless(request.taskId, request.team, url, request.contextId, briefOf(request.message), { kind: 'cli', id: request.caller }, birth)
          else d.ledger.track(request.taskId, request.team, url, request.contextId, briefOf(request.message), { kind: 'cli', id: request.caller }, birth)
          return result
        }
        // The shared dispatcher's sync recovery query may prove a definitive failed
        // outcome; like routeTrunk, that is an eligible miss, not an uncertain -32005.
        failures.push(url + ': ' + result.error)
        if (result.code === -32002 || result.code === -32003) return { ...result, task_id: request.taskId }
      } finally { release() }
    }
    const unlinked = failures.some(f => f.includes('requires a direct operator link to every receiving member'))
    const next = unlinked ? `ask this host's operator to drag every member of ${request.team} into a canvas team on this host (receipts return through those links), or route to one member's own handle` : failures.length === 0 ? `no linked peer lists ${request.team}; check the name with \`a2a-net teams\`` : undefined
    return { ok: false, code: -32004, task_id: request.taskId, error: 'forwarding to "' + request.team + '" failed: ' + (failures.join('; ') || 'no eligible peer candidate'), ...(next !== undefined ? { next } : {}) }
  }
}
