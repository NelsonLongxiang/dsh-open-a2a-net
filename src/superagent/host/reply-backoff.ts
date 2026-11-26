/** #918: durable per-message cooldown. Waiting never changes the message, task or transport identity. */
export interface ReplyRetry {
  readonly failures: number
  readonly firstFailedAt: string
  readonly lastFailedAt: string
  readonly nextAt: string
}
export const REPLY_RETRY_BASE_MS = 30_000
export const REPLY_RETRY_CAP_MS = 5 * 60_000
export const REPLY_RETRY_MAX_AGE_MS = 24 * 3_600_000
/** Invalid persisted cooldowns hold the reply for reconciliation instead of authorizing another send. */
export function validReplyRetry(value: unknown): value is ReplyRetry {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<ReplyRetry>
  if (typeof row.failures !== 'number' || typeof row.firstFailedAt !== 'string' || typeof row.lastFailedAt !== 'string' || typeof row.nextAt !== 'string') return false
  const retry = row as ReplyRetry
  return Number.isSafeInteger(retry.failures) && retry.failures > 0 && retry.failures <= 32 &&
    [retry.firstFailedAt, retry.lastFailedAt, retry.nextAt].every(at => typeof at === 'string' && Number.isFinite(Date.parse(at))) &&
    Date.parse(retry.lastFailedAt) >= Date.parse(retry.firstFailedAt) &&
    Date.parse(retry.nextAt) >= Date.parse(retry.lastFailedAt) &&
    Date.parse(retry.nextAt) - Date.parse(retry.lastFailedAt) === Math.min(REPLY_RETRY_BASE_MS * 2 ** Math.min(retry.failures - 1, 4), REPLY_RETRY_CAP_MS)
}
/** Reserve eligibility before an attempt; cap both the count and the interval without retaining error text. */
export function failedReplyRetry(previous: ReplyRetry | undefined, now: number): ReplyRetry {
  const failures = Math.min((previous?.failures ?? 0) + 1, 32)
  const delay = Math.min(REPLY_RETRY_BASE_MS * 2 ** Math.min(failures - 1, 4), REPLY_RETRY_CAP_MS)
  return { failures, firstFailedAt: previous?.firstFailedAt ?? new Date(now).toISOString(),
    lastFailedAt: new Date(now).toISOString(), nextAt: new Date(now + delay).toISOString() }
}
