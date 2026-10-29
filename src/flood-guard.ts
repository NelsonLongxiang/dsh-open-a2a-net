/** gh#91 transitional ingress brakes. One guard per apply(), never process-global.
 * Run AFTER admission, OriginClaim and the fresh idempotency claim, BEFORE
 * settlement/mailbox/steer. Replays keep 409 and spend no delivery quota.
 * All refusals carry a stable reason, task id, failed query outcome and an
 * activity event. This is not the independent file channel or deployment.
 */
import type { ServerResponse } from 'node:http'
import type { IdempotencyStore } from './idempotency-store.ts'

export const WIRE_ERROR_RATE_LIMITED = -32008
export const MAX_PARTS_PER_TRANSFER = 16
// Matches the current L9 threshold; per-sender across ALL targets is stricter.
export const DEFAULT_RATE_PER_MINUTE = 16
const WINDOW_MS = 60_000
const TRANSFER_TTL_MS = 24 * 60 * 60_000
const STATE_CAP = 1024

type Reason = 'sender-rate-limited' | 'file-parts-exceeded' | 'file-part-invalid' | 'file-part-duplicate' | 'flood-state-full'
interface Part { transferId: string; fileId: string; i: number; n: number }
interface Transfer { since: number; parts: Set<string> }
function parsePart(message: string): Part | null | 'invalid' {
  const pos = message.indexOf('[JPFILE-PART')
  if (pos === -1) return null
  const match = /^\[JPFILE-PART v1\]\s*/.exec(message.slice(pos))
  if (match === null) return 'invalid'
  try {
    const p: unknown = JSON.parse(message.slice(pos + match[0].length))
    if (p === null || typeof p !== 'object') return 'invalid'
    const e = p as Record<string, unknown>
    if (typeof e.transfer_id !== 'string' || e.transfer_id.length === 0 || e.transfer_id.length > 256 ||
        typeof e.file_id !== 'string' || e.file_id.length === 0 || e.file_id.length > 256 ||
        !Number.isSafeInteger(e.part_i) || !Number.isSafeInteger(e.part_n)) return 'invalid'
    const i = e.part_i as number; const n = e.part_n as number
    // Accept either zero- or one-based indexes; the UNIQUE accepted-parts
    // count below is authoritative even when declared totals are dishonest.
    if (n < 1 || i < 0 || i > n) return 'invalid'
    return { transferId: e.transfer_id, fileId: e.file_id, i, n }
  } catch { return 'invalid' }
}

export class FloodGuard {
  private readonly senders = new Map<string, number[]>()
  private readonly transfers = new Map<string, Transfer>()
  constructor(private readonly now: () => number = Date.now) {}

  /** Check/admit one fresh task. No timer; maps and per-key sets are bounded.
   * Active transfer entries NEVER evict to make space (which would reset a
   * transfer's allowance); capacity exhaustion refuses visibly instead.
   * Counts are boot-local: restart resets them, disclosed in the guide.
   */
  check(caller: string, message: string): Reason | undefined {
    const now = this.now()
    for (const [k, hits] of this.senders) {
      const fresh = hits.filter(t => t > now - WINDOW_MS)
      if (fresh.length === 0) this.senders.delete(k)
      else this.senders.set(k, fresh)
    }
    for (const [k, value] of this.transfers) if (now - value.since >= TRANSFER_TTL_MS) this.transfers.delete(k)
    const part = parsePart(message)
    if (part === 'invalid') return 'file-part-invalid'
    const key = part === null ? '' : JSON.stringify([caller, part.transferId])
    const transfer = this.transfers.get(key)
    const coordinate = part === null ? '' : JSON.stringify([part.fileId, part.i])
    if (part !== null) {
      if (part.n > MAX_PARTS_PER_TRANSFER || (transfer?.parts.size ?? 0) >= MAX_PARTS_PER_TRANSFER) return 'file-parts-exceeded'
      if (transfer?.parts.has(coordinate)) return 'file-part-duplicate'
      if (transfer === undefined && this.transfers.size >= STATE_CAP) return 'flood-state-full'
    }
    const hits = this.senders.get(caller) ?? []
    if (hits.length >= DEFAULT_RATE_PER_MINUTE) return 'sender-rate-limited'
    if (hits.length === 0 && this.senders.size >= STATE_CAP) return 'flood-state-full'
    hits.push(now)
    this.senders.set(caller, hits)
    if (part !== null) {
      const row = transfer ?? { since: now, parts: new Set<string>() }
      row.parts.add(coordinate)
      this.transfers.set(key, row)
    }
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
    const reason = guard.check(caller, message)
    if (reason === undefined) return false
    const error = 'flood-guard: ' + reason + ' (gh#91): file data must use an independent channel; no delivery occurred'
    outcomes.recordOutcome(taskId, { status: 'failed', error })
    recordActivity('in', team, caller, false)
    const payload = JSON.stringify({ error, reason, code: WIRE_ERROR_RATE_LIMITED, task_id: taskId, team, delivered: false, task_status: 'TASK_STATE_FAILED' })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
    return true
  }
}
