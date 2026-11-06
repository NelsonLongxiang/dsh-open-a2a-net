import {it,expect,vi,afterEach}from'vitest'
import {Context}from'@deepseek-ai/cordis'
import {receiptRetryWait,retryReceiptDelivery,ReceiptDeliveryError,receiptFailure,RECEIPT_RETRYABLE,RECEIPT_RETRY_DELAYS_MS}from'../../src/receipt-retry.ts'
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
 expect(receiptFailure({error:'verification',code:-32011}).transient).toBe(true);expect(receiptFailure({error:'receipt attempt already pending',code:-32003}).transient).toBe(true);expect(receiptFailure({error:'network',[RECEIPT_RETRYABLE]:true}).transient).toBe(true);expect(receiptFailure({error:'unknown task',code:-32000}).transient).toBe(false)
})
