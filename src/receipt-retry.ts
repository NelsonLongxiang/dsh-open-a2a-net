/** Host-owned bounded retry policy; never changes the receipt text. */
import type { Context } from '@deepseek-ai/cordis'
export function receiptRetryWait(ctx:Pick<Context,'effect'>,ms:number):Promise<boolean>{
 return new Promise<boolean>((resolve,reject)=>{
  let finished=false
  const timer=setTimeout(()=>{finished=true;resolve(true);void unregister()},ms)
  timer.unref?.()
  let unregister:()=>unknown
  try{unregister=ctx.effect(()=>()=>{clearTimeout(timer);if(!finished){finished=true;resolve(false)}},'a2a: receipt retry wait')}catch(error){clearTimeout(timer);reject(error)}
 })
}
export const RECEIPT_RETRYABLE:unique symbol=Symbol('a2a.receipt-retryable')
export const RECEIPT_RETRY_DELAYS_MS=[1000,2000,4000,8000,16000,30000] as const
export class ReceiptDeliveryError extends Error {constructor(message:string,readonly transient:boolean){super(message)}}
export function transientReceiptFailure(error:unknown):boolean{return error instanceof ReceiptDeliveryError&&error.transient}
/**
 * A bare -32003 is not retryable: resending the same transport identity only earns the same replay verdict.
 * A receipt's replay is read through {@link readReceiptReplay} first; an in-flight prior attempt comes back
 * marked {@link RECEIPT_RETRYABLE}, a confirmed one comes back delivered.
 */
export function receiptFailure(result:{error:string;code?:number;[RECEIPT_RETRYABLE]?:true}):ReceiptDeliveryError{return new ReceiptDeliveryError(result.error,result.code===-32011||result[RECEIPT_RETRYABLE]===true)}
/** What a receipt resend's idempotency replay (-32003: same task id, same fingerprint) means. */
export type ReceiptReplayReading='delivered'|'retry'|'failed'
/**
 * Read a receipt's -32003 replay through the receiver's `/a2a/query` answer for the same transport id.
 * The replay verdict says the receiver already claimed this exact receipt after admission, and that the prior
 * attempt owns the outcome. This host's own receivers answer a completed receipt replay 200 and keep 409 for a
 * prior attempt still in flight or recorded failed; the query tells those apart. A receiver without the query
 * surface (no answer) has only the verdict to give: delivered. Unknown-task means the claim has gone (released or
 * expired), so the next attempt claims afresh. Payload-mismatch only says our recomputed fingerprint differs from
 * the receiver's; the verdict itself named the same fingerprint, so it reads as the verdict does.
 */
export function readReceiptReplay(answer:{readonly found:boolean;readonly status?:string;readonly reason?:string}|undefined):ReceiptReplayReading{
 if(answer===undefined)return 'delivered'
 if(!answer.found)return answer.reason==='unknown-task'?'retry':'delivered'
 return answer.status==='pending'?'retry':answer.status==='failed'?'failed':'delivered'
}
export async function retryReceiptDelivery(d:{attempt:()=>Promise<void>;notify:()=>Promise<void>;pending:()=>boolean;wait:(ms:number)=>Promise<boolean>;log:(error:unknown)=>void},delays:readonly number[]=RECEIPT_RETRY_DELAYS_MS):Promise<void>{
 let notified=false
 for(let attempt=0;;attempt++){
  if(!d.pending())return
  try{await d.attempt();return}catch(error){
   if(!transientReceiptFailure(error))throw error
   d.log(error)
   if(!notified){notified=true;try{await d.notify()}catch(noticeError){d.log(noticeError)}}
   if(attempt>=delays.length)return
   if(!await d.wait(delays[attempt]!))return
  }
 }
}
