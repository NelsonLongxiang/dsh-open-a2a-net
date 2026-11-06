/** #356 correspondence between one admitted task and one durable Session inbox occurrence. */
import { createHash } from 'node:crypto'
export interface TaskDelivery {
  version: 1
  taskId: string
  messageId: string
  sessionId: string
  fingerprint: string
  callerKey?: string
  createdAt: number
  state: 'reserved' | 'enqueued' | 'claimed' | 'cancelled' | 'failed'
}
export const TASK_DELIVERY_CAP = 512
/** Keep completed/cancelled occurrence identities through the server idempotency window. */
export const TASK_DELIVERY_RETENTION_MS = 24 * 60 * 60_000
export function deliveryFingerprint(sessionId: string, text: string, sender?: string, localFrom?: string): string {
  return createHash('sha256').update(JSON.stringify([sessionId,text,sender??'',localFrom??''])).digest('hex')
}
export function parseTaskDelivery(raw: unknown): TaskDelivery | undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
  const r=raw as Record<string,unknown>
  for(const k of ['taskId','messageId','sessionId'])if(typeof r[k]!=='string'||r[k].length<1||r[k].length>256)return undefined
  if(r.version!==1||typeof r.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(r.fingerprint)||!Number.isSafeInteger(r.createdAt)||(r.createdAt as number)<0||!['reserved','enqueued','claimed','cancelled','failed'].includes(String(r.state)))return undefined
  if(r.callerKey!==undefined&&(typeof r.callerKey!=='string'||r.callerKey.length>512))return undefined
  return {...(typeof r.callerKey==='string'?{callerKey:r.callerKey}:{}),version:1,taskId:r.taskId as string,messageId:r.messageId as string,sessionId:r.sessionId as string,fingerprint:r.fingerprint,createdAt:r.createdAt as number,state:r.state as TaskDelivery['state']}
}
