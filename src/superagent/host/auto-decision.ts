/**
 * #888 D5 phase two: the host's automatic decision on a ticket's question card, as the ticket sees it.
 *
 * The vendored engine stays byte for byte upstream, so there is no new input kind: like the observer's answer
 * (observer-decisions.ts) this is the engine's existing non-authorizing `note` with host-owned metadata. A note is
 * context that asks for nothing and grants nothing: it is not a person's message (`human` is never set), it cannot end the
 * ticket, and it is not an answer the member may cite. The metadata says who decided and that it was not the owner.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/auto-decision
 */

import type { TicketInput } from '../upstream/dsh-superagent/src/core/index.ts'

/** A note the host wrote on a ticket when it took a question card's recommendation on the owner's setting. */
export interface HostAutoDecisionNote extends Extract<TicketInput, { kind: 'note' }> {
  readonly hostAutoDecision: { readonly cardId: string; readonly option: string; readonly minutes: number; readonly human: false }
}

export function hostAutoDecisionNote(deliveryId: string, cardId: string, option: string, minutes: number, at: string): HostAutoDecisionNote {
  return {
    id: deliveryId, kind: 'note', at,
    text: `[宿主自动采纳] 宿主按属主设置自动采纳了你提的问题的推荐项：${option}（非属主本人，等了 ${String(minutes)} 分钟无人处理）。这不是属主的答复：不要据此确认、答复或结单；属主之后可以改判，改判会作为属主的话送到这张工单。`,
    hostAutoDecision: { cardId, option, minutes, human: false },
  }
}

/** Whether a ticket input is a host automatic decision (so it is never read as a person's word). */
export const isHostAutoDecision = (input: TicketInput): input is HostAutoDecisionNote =>
  input.kind === 'note' && 'hostAutoDecision' in input && (input as { hostAutoDecision?: { human?: unknown } }).hostAutoDecision?.human === false
