/** #351 reminder observations only: never a task lifecycle or acknowledgement. */
export const REMINDER_SCAN_MS = 60_000
export const REMINDER_MIN_MS = 120_000
export const REMINDER_LONG_MS = 2 * 60 * 60_000
export const REMINDER_WARNING_MS = 30 * 60_000
export interface ReminderState {
  version: 1
  targetId: string
  attempts: number
  deliveredCount: number
  lastAttemptAt: number
  nextAt: number
  requestId: string
  lastResult: 'reserved' | 'delivered' | 'failed' | 'unknown' | 'blocked'
  lastDeliveredAt?: number
  noticeAttemptedAt?: number
  notifiedAt?: number
  escalationAt?: number
  diagnostic?: 'metadata-reset'
}
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export function parseReminder(raw: unknown): ReminderState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r=raw as Record<string,unknown>
  if(r.version!==1 || typeof r.targetId!=='string' || r.targetId.length<1 || r.targetId.length>256 || !integer(r.attempts) || !integer(r.deliveredCount) || r.deliveredCount>r.attempts || !integer(r.lastAttemptAt) || !integer(r.nextAt) || typeof r.requestId!=='string' || r.requestId.length>256 || !['reserved','delivered','failed','unknown','blocked'].includes(String(r.lastResult))) return undefined
  if(r.diagnostic!==undefined&&r.diagnostic!=='metadata-reset')return undefined
  for(const key of ['lastDeliveredAt','noticeAttemptedAt','notifiedAt','escalationAt']) if(r[key]!==undefined&&!integer(r[key]))return undefined
  return {version:1,targetId:r.targetId,attempts:r.attempts,deliveredCount:r.deliveredCount,lastAttemptAt:r.lastAttemptAt,nextAt:r.nextAt,requestId:r.requestId,lastResult:r.lastResult as ReminderState['lastResult'],...(r.lastDeliveredAt!==undefined?{lastDeliveredAt:r.lastDeliveredAt as number}:{}),...(r.noticeAttemptedAt!==undefined?{noticeAttemptedAt:r.noticeAttemptedAt as number}:{}),...(r.notifiedAt!==undefined?{notifiedAt:r.notifiedAt as number}:{}),...(r.escalationAt!==undefined?{escalationAt:r.escalationAt as number}:{}),...(r.diagnostic==='metadata-reset'?{diagnostic:'metadata-reset' as const}:{})}
}
export function nextReminderDelay(attempts: number): number {
  return attempts===1 ? REMINDER_MIN_MS : attempts===2 ? 10*60_000 : REMINDER_LONG_MS
}
export interface ReminderView { reminderAttempts:number; reminderDelivered:number; reminderLastAt:number; reminderNextAt:number; repeatedlyUnreconciled:boolean; reminderResult:string; reminderDiagnostic?:'metadata-reset' }
export function reminderView(state: ReminderState | undefined, now=Date.now()): Partial<ReminderView> {
  if(!state)return {}
  return {reminderAttempts:state.attempts,reminderDelivered:state.deliveredCount,reminderLastAt:state.lastAttemptAt,reminderNextAt:state.nextAt,reminderResult:state.lastResult,...(state.diagnostic?{reminderDiagnostic:state.diagnostic}:{}),repeatedlyUnreconciled:state.attempts>=3&&now>=(state.escalationAt??state.lastAttemptAt+REMINDER_WARNING_MS)}
}
