/** Host-owned observation, never a task lifecycle or a proof of consumption. */
import type { Agent } from '@deepseek-ai/dsh-agent'
export const ACCEPTANCE_UNKNOWN_NOTE = '接纳状态未知，请用原 task id 对账，不要换 id 重派'
export const ACCEPTANCE_INSERTED_NOTE = '已送达、后续处理未确认，请按原 task id 对账，不要重派'
export class FollowupAcceptanceUnknown extends Error {
  constructor() { super(ACCEPTANCE_UNKNOWN_NOTE) }
}
type HostMessage = { id?: unknown }
type HostEvent = { type?: unknown; data?: { inserted?: readonly HostMessage[]; message?: HostMessage; id?: unknown } }
type HostSession = { id?: unknown; snapshotEvents?: () => readonly HostEvent[]; events?: readonly HostEvent[] }
type HostAgent = { id: unknown; inbox?: { nextTurn?: readonly HostMessage[]; nextStep?: readonly HostMessage[] }; session?: HostSession }
/** A read failure leaves the event floor unknown, never implicitly zero. */
export function hostEventCount(agent: Agent): number | undefined {
  try {
    const session = (agent as unknown as HostAgent).session
    return (session?.snapshotEvents?.() ?? session?.events ?? []).length
  } catch { return undefined }
}
/** Only a host occurrence in the exact target session can establish acceptance. */
export function hostInserted(agent: Agent, sessionId: string, messageId: string, eventFloor: number | undefined): boolean {
  const host = agent as unknown as HostAgent
  try { if (String(host.id) !== sessionId || String(host.session?.id) !== sessionId) return false } catch { return false }
  try {
    if ([...(host.inbox?.nextTurn ?? []), ...(host.inbox?.nextStep ?? [])].some(message => message.id === messageId)) return true
  } catch { /* Accepted event history can still prove insertion after an inbox accessor fails. */ }
  if (eventFloor === undefined) return false
  try {
    const events = host.session?.snapshotEvents?.() ?? host.session?.events ?? []
    return events.slice(eventFloor).some(event =>
      event.type === 'agent/inbox/spliced' && event.data?.inserted?.some(message => message.id === messageId)
      || event.type === 'agent/inbox/claimed' && event.data?.message?.id === messageId
      || event.type === 'user/message' && event.data?.id === messageId)
  } catch { return false }
}
/** A conflict seen before invoking followup is a definite pre-admission refusal. */
export function pendingMessage(agent: Agent, messageId: string): boolean {
  const inbox = (agent as unknown as HostAgent).inbox
  return [...(inbox?.nextTurn ?? []), ...(inbox?.nextStep ?? [])].some(message => message.id === messageId)
}
