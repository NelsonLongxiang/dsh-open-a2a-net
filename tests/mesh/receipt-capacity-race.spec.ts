import {it,expect,vi,afterEach} from 'vitest'
// #782-era ledger (2026-11-22, contended Windows host): full-suite load exceeded the 5s default in these specs; raised ceiling only, assertions unchanged.
vi.setConfig({ testTimeout: 25_000 })
import {readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {TaskLedger} from '../../src/task-ledger.ts'
import {receiptBirth,receiptPayloadHash,receiptTransportId,type ReceiptOutboxRecord} from '../../src/receipt-outbox.ts'
import {bootNode,reservePort,runContext} from './harness.ts'
import {A2aClient} from '../../src/a2a-client.ts'
const nativeFetch=globalThis.fetch.bind(globalThis)
const writeFault=vi.hoisted(()=>({path:'',fail:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(writeFault.fail&&path===writeFault.path)throw Object.assign(Error('sender ledger fault'),{code:'EACCES'});actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{writeFault.path='';writeFault.fail=false;vi.restoreAllMocks()})
function protect(ledger:TaskLedger,count:number,receiverId:string,authorTeam='beta/01234567'){
 for(let i=0;i<count;i++){
  const taskId='protected-'+i,target='alpha/aaaaaaaa',text='[A2A receipt] task '+taskId+' retained original result'
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

it.each(['card','response','final-birth'] as const)('F2 caller durable slot survives competing protected results at remote %s boundary',async boundary=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'sender-capacity',session:'sender-capacity',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'receiver-capacity',session:'receiver-capacity',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 let callerLedger:TaskLedger|undefined,taskId='',filled=false,posts=0
 const reserve=TaskLedger.prototype.reserveDispatch,fetchCard=A2aClient.prototype.fetchCardDetail,route=A2aClient.prototype.routeDirect,track=TaskLedger.prototype.track
 const fill=()=>{
  if(filled)return;filled=true;expect(callerLedger).toBeDefined()
  const persisted=JSON.parse(readFileSync(join(a.home,'a2a/tasks.json'),'utf8'));expect(persisted.dispatchReservations.some((r:any)=>r.taskId===taskId)).toBe(true)
  protect(callerLedger!,63,String(a.agents.agent!.id),'alpha/01234567')
  expect(()=>callerLedger!.trackInbound('steal-outgoing-slot','alpha/01234567','other/aaaaaaaa')).toThrow('receipt-protected')
 }
 vi.spyOn(TaskLedger.prototype,'reserveDispatch').mockImplementation(function(this:TaskLedger,id:string,fingerprint:string){reserve.call(this,id,fingerprint);callerLedger=this;taskId=id})
 vi.spyOn(A2aClient.prototype,'fetchCardDetail').mockImplementation(async function(this:A2aClient,url:string){if(boundary==='card'&&callerLedger&&url===bu)fill();return fetchCard.call(this,url)})
 vi.spyOn(A2aClient.prototype,'routeDirect').mockImplementation(async function(this:A2aClient,...args:Parameters<A2aClient['routeDirect']>){
  if(args[0]!==bu||args[2]!=='sender capacity work')return route.apply(this,args)
  posts++;const result=await route.apply(this,args);expect(result.ok).toBe(true);if(boundary==='response')fill();return result
 })
 vi.spyOn(TaskLedger.prototype,'track').mockImplementation(function(this:TaskLedger,...args:Parameters<TaskLedger['track']>){if(this===callerLedger&&args[0]===taskId&&boundary==='final-birth')fill();return track.apply(this,args)})
 try{
  for(const n of[a,b])await nativeFetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{Connection:'close'},body:JSON.stringify({id:String(n.agents.agent!.id)})})
  if(boundary==='card'){const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+1000)} // expire only this fixture's warm card cache
  const result=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'sender capacity work',async:true},runContext(a.agents.agent)) as any
  expect(result.ok,JSON.stringify(result)).toBe(true);expect(filled).toBe(true);expect(posts).toBe(1)
  expect(callerLedger!.find(result.task_id)).toMatchObject({direction:'outbound',status:'pending',team:'beta/01234567'})
  expect(callerLedger!.list()).toHaveLength(64);expect(callerLedger!.receipts()).toHaveLength(63);expect(callerLedger!.conservation().conserved).toBe(true)
  expect(JSON.parse(readFileSync(join(a.home,'a2a/tasks.json'),'utf8')).dispatchReservations??[]).toHaveLength(0)
  await vi.waitFor(()=>expect(b.steered).toHaveLength(1))
 }finally{vi.restoreAllMocks();await a.dispose();await b.dispose()}
})

it.each(['full','reserve-write','accepted-write','unknown','refused'] as const)('F2 caller original reservation handles %s without an untracked second dispatch',async mode=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'sender-fault',session:'sender-fault',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'receiver-fault',session:'receiver-fault',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 let senderLedger:TaskLedger|undefined,id='',posts=0
 const file=join(a.home,'a2a/tasks.json'),reserve=TaskLedger.prototype.reserveDispatch,route=A2aClient.prototype.routeDirect
 vi.spyOn(TaskLedger.prototype,'reserveDispatch').mockImplementation(function(this:TaskLedger,taskId:string,fingerprint:string){
  senderLedger=this;id=taskId
  if(mode==='full')protect(this,64,String(a.agents.agent!.id),'alpha/01234567')
  if(mode==='reserve-write'){writeFault.path=file;writeFault.fail=true}
  return reserve.call(this,taskId,fingerprint)
 })
 vi.spyOn(A2aClient.prototype,'routeDirect').mockImplementation(async function(this:A2aClient,...args:Parameters<A2aClient['routeDirect']>){
  if(args[0]!==bu||args[2]!=='sender fault work')return route.apply(this,args)
  if(mode==='refused')return {ok:false,code:-32000,task_id:args[7],error:'definitive pre-insertion refusal'}
  posts++;const accepted=await route.apply(this,args);expect(accepted.ok).toBe(true)
  if(mode==='accepted-write'){writeFault.path=file;writeFault.fail=true}
  return mode==='unknown'?{ok:false,acceptance:'unknown',task_id:args[7],code:-32000,error:'response was lost after admission'}:accepted
 })
 try{
  for(const n of[a,b])await nativeFetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{Connection:'close'},body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const result=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'sender fault work',async:true},runContext(a.agents.agent)) as any
  expect(result.ok).toBe(false);writeFault.fail=false
  if(mode==='accepted-write'||mode==='unknown'){
   expect(result).toMatchObject({acceptance:'unknown',task_id:id});expect(posts).toBe(1)
   const disk=JSON.parse(readFileSync(file,'utf8'));expect(disk.dispatchReservations.some((r:any)=>r.taskId===id)).toBe(true)
   const restored=new TaskLedger(file);expect(restored.find(id)).toBeUndefined();expect(()=>restored.reserveDispatch(id,disk.dispatchReservations.find((r:any)=>r.taskId===id).fingerprint)).toThrow('reconcile original task')
   await vi.waitFor(()=>expect(b.steered).toHaveLength(1));expect(posts).toBe(1)
  }else{
   expect(posts).toBe(0);expect(b.steered).toHaveLength(0)
   if(mode==='reserve-write')expect(existsSync(file)).toBe(false)
   else expect(JSON.parse(readFileSync(file,'utf8')).dispatchReservations??[]).toEqual([])
   if(mode==='full')expect(senderLedger!.receipts()).toHaveLength(64)
  }
 }finally{writeFault.fail=false;vi.restoreAllMocks();await a.dispose();await b.dispose()}
})
