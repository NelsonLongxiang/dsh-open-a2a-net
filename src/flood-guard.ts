/** gh#91 ingress brakes: a per-sender rate and an outright refusal of
 * JPFILE-PART file chunks (files go through the file channel). One guard per
 * apply(), never process-global.
 * Run AFTER admission, OriginClaim and the fresh idempotency claim, BEFORE
 * settlement/mailbox/steer. Replays keep 409 and spend no delivery quota.
 * All refusals carry a stable reason, task id, failed query outcome and an
 * activity event.
 */
import type { ServerResponse } from 'node:http'
import type { IdempotencyStore } from './idempotency-store.ts'
import { withResponseFields } from './response-fields.ts'

export const FILE_CHANNEL_ADVICE = { reason: 'use-file-channel', message: 'Files must use the file channel, not session messages: a2a_file_send { paths, team }; CLI: a2a-net file send <path…> <team>.' } as const
export const fileChannelAdvice = (message: string): typeof FILE_CHANNEL_ADVICE | undefined => message.includes('[JPFILE-PART') ? FILE_CHANNEL_ADVICE : undefined

export const WIRE_ERROR_RATE_LIMITED = -32008
// Matches the current L9 threshold; per-sender across ALL targets is stricter.
export const DEFAULT_RATE_PER_MINUTE = 16
const WINDOW_MS = 60_000
const STATE_CAP = 1024

/** gh#91 final step: every JPFILE-PART message is refused (the 16-part
 * transitional allowance ended once the fleet carried the file channel, F4).
 * A refused part spends no sender quota. */
type Reason = 'sender-rate-limited' | 'file-channel-required' | 'flood-state-full'

export class FloodGuard {
  private readonly senders = new Map<string, number[]>()
  constructor(private readonly now: () => number = Date.now) {}

  /** Check/admit one fresh task. No timer; the sender map is bounded and
   * refuses visibly when full instead of evicting an active budget.
   * Counts are boot-local: restart resets them, disclosed in the guide.
   */
  check(caller: string, message: string): Reason | undefined {
    if (message.includes('[JPFILE-PART')) return 'file-channel-required'
    const now = this.now()
    for (const [k, hits] of this.senders) {
      const fresh = hits.filter(t => t > now - WINDOW_MS)
      if (fresh.length === 0) this.senders.delete(k)
      else this.senders.set(k, fresh)
    }
    const hits = this.senders.get(caller) ?? []
    if (hits.length >= DEFAULT_RATE_PER_MINUTE) return 'sender-rate-limited'
    if (hits.length === 0 && this.senders.size >= STATE_CAP) return 'flood-state-full'
    hits.push(now)
    this.senders.set(caller, hits)
    return undefined
  }
}

/** Host-scoped adapter; rejected fresh keys are FAILED, not stranded pending.
 * HTTP 200 retains the existing client's structured peer-error path.
 */
export function createFloodGuard(
  outcomes: Pick<IdempotencyStore, 'recordOutcome'>,
  recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void,
): (caller: string, message: string, team: string, taskId: string, res: ServerResponse) => boolean {
  const guard = new FloodGuard()
  return (caller, message, team, taskId, res) => {
    const advice = fileChannelAdvice(message)
    if (advice !== undefined) withResponseFields(res, { advice })
    const reason = guard.check(caller, message)
    if (reason === undefined) return false
    const error = 'flood-guard: ' + reason + ' (gh#91): no delivery occurred' + (advice === undefined ? '' : '; use-file-channel: ' + advice.message)
    outcomes.recordOutcome(taskId, { status: 'failed', error })
    recordActivity('in', team, caller, false)
    // #282 S1: one next step — file bytes go through the file channel, never chat messages.
    const next = 'send file data with a2a_file_send / `a2a-net file send <path> <team>` instead of message chunks; resend other text as one message with a new task id'
    const payload = JSON.stringify({ error, reason, code: WIRE_ERROR_RATE_LIMITED, task_id: taskId, team, delivered: false, task_status: 'TASK_STATE_FAILED', next })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
    return true
  }
}
