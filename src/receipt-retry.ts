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
export function receiptFailure(result:{error:string;code?:number;[RECEIPT_RETRYABLE]?:true}):ReceiptDeliveryError{return new ReceiptDeliveryError(result.error,result.code===-32011||result.code===-32003||result[RECEIPT_RETRYABLE]===true)}
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
