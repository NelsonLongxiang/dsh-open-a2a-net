import {it,expect,vi,afterEach}from'vitest'
import {Context}from'@deepseek-ai/cordis'
import {receiptRetryWait,retryReceiptDelivery,ReceiptDeliveryError,receiptFailure,readReceiptReplay,RECEIPT_RETRYABLE,RECEIPT_RETRY_DELAYS_MS}from'../../src/receipt-retry.ts'
import {runReceiptLadder}from'../../src/receipt-ladder.ts'
afterEach(()=>vi.useRealTimers())
it('finished retry waits release the actual context effect and timer immediately',async()=>{
 vi.useFakeTimers();const ctx=new Context(),initial=ctx.fiber.getEffects().length
 try{
  for(let i=0;i<8;i++){const waiting=receiptRetryWait(ctx,10);expect(ctx.fiber.getEffects()).toHaveLength(initial+1);expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(10);expect(await waiting).toBe(true);expect(ctx.fiber.getEffects()).toHaveLength(initial);expect(vi.getTimerCount()).toBe(0)}
 }finally{await ctx.fiber.dispose()}
})
it('unloading the context cancels a pending retry wait without a residual timer',async()=>{
 vi.useFakeTimers();const ctx=new Context(),waiting=receiptRetryWait(ctx,1000);expect(vi.getTimerCount()).toBe(1);await ctx.fiber.dispose();expect(await waiting).toBe(false);expect(ctx.fiber.getEffects()).toHaveLength(0);expect(vi.getTimerCount()).toBe(0)
})
it('transient failure bypasses receipt-bearing owner tier, notifies once and retries with capped backoff',async()=>{
 const caller=vi.fn(async()=>{throw new ReceiptDeliveryError('temporary',true)}),owner=vi.fn(),notify=vi.fn(),wait=vi.fn(async()=>true)
 await retryReceiptDelivery({attempt:()=>runReceiptLadder({ownerTeam:'owner',deliver:team=>team==='caller'?caller():owner(),transient:e=>e instanceof ReceiptDeliveryError&&e.transient,log:()=>{}},'caller'),notify,pending:()=>true,wait,log:()=>{}})
 expect(caller).toHaveBeenCalledTimes(7);expect(owner).not.toHaveBeenCalled();expect(notify).toHaveBeenCalledTimes(1);expect(wait.mock.calls.map(c=>c[0])).toEqual([...RECEIPT_RETRY_DELAYS_MS]);expect(Math.max(...RECEIPT_RETRY_DELAYS_MS)).toBe(30000)
})
it('permanent failure preserves legacy owner receipt escalation without retry',async()=>{
 const owner=vi.fn(async()=>{}),wait=vi.fn(),notify=vi.fn()
 await retryReceiptDelivery({attempt:()=>runReceiptLadder({ownerTeam:'owner',deliver:async team=>{if(team==='caller')throw new ReceiptDeliveryError('refused',false);await owner()},transient:e=>e instanceof ReceiptDeliveryError&&e.transient,log:()=>{}},'caller'),notify,pending:()=>true,wait,log:()=>{}})
 expect(owner).toHaveBeenCalledOnce();expect(notify).not.toHaveBeenCalled();expect(wait).not.toHaveBeenCalled()
})
it('a later definitive permanent failure retains the original owner ladder policy',async()=>{
 let count=0;const owner=vi.fn(async()=>{}),notify=vi.fn()
 await retryReceiptDelivery({attempt:()=>runReceiptLadder({ownerTeam:'owner',deliver:async team=>{if(team==='owner'){await owner();return}throw new ReceiptDeliveryError(count++===0?'temporary':'permanent',count===1)},transient:e=>e instanceof ReceiptDeliveryError&&e.transient,log:()=>{}},'caller'),notify,pending:()=>true,wait:async()=>true,log:()=>{}})
 expect(owner).toHaveBeenCalledOnce();expect(notify).toHaveBeenCalledOnce();expect(count).toBe(2)
})
it('completion and host cancellation stop retries without inventing settlement',async()=>{
 let pending=true;const attempt=vi.fn(async()=>{pending=false;throw new ReceiptDeliveryError('temporary',true)})
 await retryReceiptDelivery({attempt,notify:async()=>{},pending:()=>pending,wait:async()=>false,log:()=>{}});expect(attempt).toHaveBeenCalledOnce()
 expect(receiptFailure({error:'verification',code:-32011}).transient).toBe(true);expect(receiptFailure({error:'duplicate task id within the idempotency window',code:-32003}).transient).toBe(false);expect(receiptFailure({error:'receipt attempt already pending',code:-32003,[RECEIPT_RETRYABLE]:true}).transient).toBe(true);expect(receiptFailure({error:'task id reused with a different payload',code:-32002}).transient).toBe(false);expect(receiptFailure({error:'network',[RECEIPT_RETRYABLE]:true}).transient).toBe(true);expect(receiptFailure({error:'unknown task',code:-32000}).transient).toBe(false)
})
it('a receipt replay (-32003) reads as delivered unless the receiver says the prior attempt is in flight, gone or failed',()=>{
 expect(readReceiptReplay(undefined)).toBe('delivered')
 expect(readReceiptReplay({found:true,status:'completed'})).toBe('delivered')
 expect(readReceiptReplay({found:false,reason:'payload-mismatch'})).toBe('delivered')
 expect(readReceiptReplay({found:true,status:'pending'})).toBe('retry')
 expect(readReceiptReplay({found:false,reason:'unknown-task'})).toBe('retry')
 expect(readReceiptReplay({found:true,status:'failed'})).toBe('failed')
})
it('a delivered replay ends the retry loop at once; other retryable codes keep their budget',async()=>{
 const wait=vi.fn(async()=>true),notify=vi.fn(async()=>{})
 let calls=0
 await retryReceiptDelivery({attempt:async()=>{calls++;if(calls===1)throw receiptFailure({error:'network',[RECEIPT_RETRYABLE]:true})},notify,pending:()=>true,wait,log:()=>{}},[1,2,3])
 expect(calls).toBe(2);expect(wait).toHaveBeenCalledTimes(1)
 const verification=vi.fn(async()=>{throw receiptFailure({error:'verification',code:-32011})}),w2=vi.fn(async()=>true)
 await retryReceiptDelivery({attempt:verification,notify,pending:()=>true,wait:w2,log:()=>{}},[1,2,3])
 expect(verification).toHaveBeenCalledTimes(4);expect(w2).toHaveBeenCalledTimes(3)
 const conflict=vi.fn(async()=>{throw receiptFailure({error:'task id reused with a different payload',code:-32002})})
 await expect(retryReceiptDelivery({attempt:conflict,notify,pending:()=>true,wait,log:()=>{}},[1,2,3])).rejects.toThrow('different payload');expect(conflict).toHaveBeenCalledOnce()
})
