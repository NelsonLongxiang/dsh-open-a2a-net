import {it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {TaskLedger} from '../../src/task-ledger.ts'
import {receiptBirth,receiptPayloadHash,receiptTransportId,type ReceiptOutboxRecord} from '../../src/receipt-outbox.ts'
import {bootNode} from './harness.ts'
const nativeFetch=globalThis.fetch.bind(globalThis)
afterEach(()=>vi.restoreAllMocks())
function protect(ledger:TaskLedger,count:number,receiverId:string){
 for(let i=0;i<count;i++){
  const taskId='protected-'+i,authorTeam='beta/01234567',target='alpha/aaaaaaaa',text='[A2A receipt] task '+taskId+' retained original result'
  ledger.trackInbound(taskId,authorTeam,target,'ctx',true,'work',undefined,undefined,receiverId)
  const row=ledger.find(taskId)!,record:Omit<ReceiptOutboxRecord,'payloadHash'>={version:1,taskId,authorId:receiverId,authorTeam,target,text,transportId:receiptTransportId(taskId,target,text),caller:authorTeam,payer:'beta',localKey:'test-original-key',birth:receiptBirth(row),lane:{kind:'local-session',sessionId:'session-original-return'},contextId:'ctx',createdAt:Date.now(),deadline:Date.now()+23*60*60_000,attempts:0,nextAt:Date.now()+3600000,phase:'blocked',code:'RECEIPT_ROUTE_UNAVAILABLE'}
  ledger.prepareReceipt({...record,payloadHash:receiptPayloadHash(record)})
 }
}
it.each([63,64])('F2 cold-wake admission uses capacity at the actual enqueue boundary: protected=%s',async count=>{
 const n=await bootNode({name:'capacity-race',session:'capacity-race',team:'beta',sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 let release:(()=>void)|undefined;let wakeStarted:(()=>void)|undefined
 const started=new Promise<void>(r=>{wakeStarted=r}),gate=new Promise<void>(r=>{release=r})
 let ledger:TaskLedger|undefined
 const original=TaskLedger.prototype.receiptCapacityAvailable
 const capacity=vi.spyOn(TaskLedger.prototype,'receiptCapacityAvailable').mockImplementation(function(this:TaskLedger,taskId?:string){ledger=this;return original.call(this,taskId)})
 try{
  const receiver=n.agents.agent!,receiverId=String(receiver.id)
  await nativeFetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{Connection:'close'},body:JSON.stringify({id:receiverId})})
  n.ctx.emit('agent/disposed',{agent:receiver});n.agents.agent=undefined
  n.ctx.provide('sessionController',{resolveAgent:async()=>{wakeStarted!();await gate;n.agents.agent=receiver;n.ctx.emit('agent/created',{agent:receiver});return {agent:receiver}}} as never)
  const pending=nativeFetch(n.baseUrl+'/a2a/direct',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({team:'beta/01234567',caller_session:'alpha/aaaaaaaa',task_id:'cold-race',context_id:'original-context',message:'one original business request',wait:false})})
  await started;expect(ledger).toBeDefined();expect(ledger!.list()).toHaveLength(0)
  // The first queue guard already ran. Capacity fills while materialization awaits.
  protect(ledger!,count,receiverId);release!()
  const response=await pending,body=await response.json() as any
  if(count===64){
   expect(body.delivered).not.toBe(true);expect(body.routed).not.toBe(true);expect(n.steered).toHaveLength(0)
   expect(ledger!.deliveryFor('cold-race')).toBeUndefined();expect(ledger!.find('cold-race')).toBeUndefined()
  }else{
   expect(body).toMatchObject({routed:true,delivered:true,task_id:'cold-race'})
   await vi.waitFor(()=>expect(n.steered).toHaveLength(1))
   expect(ledger!.find('cold-race')).toMatchObject({status:'pending'});expect(ledger!.find('cold-race')!.receiptExpected).not.toBe(false)
   expect(ledger!.deliveryFor('cold-race')?.taskExpected).toBe(true)
  }
  const persisted=JSON.parse(readFileSync(join(n.home,'a2a/tasks.json'),'utf8'))
  expect(persisted.receiptOutbox).toHaveLength(count);expect(persisted.receiptOutbox.every((r:any)=>r.text.includes('retained original result'))).toBe(true)
  expect(ledger!.list()).toHaveLength(64);expect(ledger!.conservation().conserved).toBe(true)
  if(count===63) {
   receiver.session.events.push({type:'turn/start'},{type:'user/message',data:{content:(n.steered[0] as any).content}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'one original final'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}})
   n.ctx.emit('agent/status',{agent:receiver,status:'idle'})
   await vi.waitFor(()=>expect(ledger!.find('cold-race')).toMatchObject({answeredAt:expect.any(Number),receiptDelivery:'receipt-undelivered'}))
   expect(ledger!.receiptFor('cold-race')!.text).toContain('one original final');expect(n.steered).toHaveLength(1)
  }
 }finally{release?.();capacity.mockRestore();await n.dispose()}
})
