/** H-side one-hop forwarding. Never resolves or dispatches local candidates again. */
import { DEFAULT_HOP_BUDGET, guardHeader, mintGuard } from './recursion-guard.ts'
import { briefOf, type OutboundBirth, type TaskLedger } from './task-ledger.ts'
import { parseReceipt } from './receipt.ts'
import type { A2aPeerCard, A2aRouteResult } from './types.ts'

export interface ForwardRequest {
  team: string; message: string; caller: string; taskId: string; contextId?: string; noWait: boolean
  localCliProof: boolean; guarded: boolean
}
export interface DirectForwardDeps {
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
    const refuse = (why: string): A2aRouteResult => ({ ok: false, code: -32000, task_id: request.taskId, error: 'not forwarded: ' + why })
    if (!d.enabled()) return refuse('forwardDirect is off')
    if (d.isolated()) return refuse('host is isolated')
    if (request.guarded) return refuse('an inbound X-A2A-Guard is present; already forwarded')
    if (!request.localCliProof || !d.deposited(request.caller)) return refuse('caller is not a proven online local CLI deposit')
    const scope = await d.scope(request.caller, request.team)
    if (!scope.ok) return refuse('target is outside sender scope: ' + scope.error)
    const failures: string[] = []
    const directory = await d.candidates(request.team, failures, request.caller)
    const guard = guardHeader({ ...mintGuard(), hopBudget: DEFAULT_HOP_BUDGET - 1 })
    for (const url of directory.urls) {
      if (!d.deposited(request.caller)) return refuse('local CLI deposit expired before dispatch')
      if (request.team.includes('/canvas/')) {
        const card = await directory.card(url)
        const org = card?.canvasOrg?.find(row => row.team === request.team)
        const receivers = org?.members.filter(member => member !== request.caller) ?? []
        if (receivers.length === 0 || receivers.some(member => !d.memberLinked(member))) {
          failures.push(url + ': forwarding a canvas requires a direct operator link to every receiving member for its receipt return path')
          continue
        }
      }
      const answer = await d.dispatch(url, request, guard)
      const result = !answer.ok && answer.ownBudgetExhausted === true ? { ...answer, code: -32005 } : answer
      d.activity(request.team, url, result.ok)
      if (result.ok || result.code === -32005) {
        // A receipt owes no receipt; native bridge rounds have no A2A receipt contract.
        // Match routeTrunk/trackOwedTask rather than manufacturing an unpayable debt.
        if (parseReceipt(request.message) !== null) return { ...result, receipt: 'none' }
        if (result.ok && result.bridge !== undefined) return { ...result, receipt: 'none' }
        const card = await directory.card(url)
        const birth: OutboundBirth = { forwarded: true, ...(card?.publicKey ? { peerKey: card.publicKey } : {}), ...(card?.session ? { peerHost: card.session } : {}), deliveredTo: result.ok ? result.deliveredTo ?? request.team : request.team }
        // Exactly one outbound row. A completed sync response is receiptless bookkeeping.
        if (result.ok && (result.task_status === 'TASK_STATE_COMPLETED' || result.receipt === 'none')) d.ledger.trackReceiptless(request.taskId, request.team, url, request.contextId, briefOf(request.message), { kind: 'cli', id: request.caller }, birth)
        else d.ledger.track(request.taskId, request.team, url, request.contextId, briefOf(request.message), { kind: 'cli', id: request.caller }, birth)
        return result
      }
      // The shared dispatcher's sync recovery query may prove a definitive failed
      // outcome; like routeTrunk, that is an eligible miss, not an uncertain -32005.
      failures.push(url + ': ' + result.error)
      if (result.code === -32002 || result.code === -32003) return { ...result, task_id: request.taskId }
    }
    return { ok: false, code: -32004, task_id: request.taskId, error: 'forwarding to "' + request.team + '" failed: ' + (failures.join('; ') || 'no eligible peer candidate') }
  }
}
