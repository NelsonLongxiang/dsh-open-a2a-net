// @vitest-environment node
/**
 * #708 review R2 (slot lifetime), the reviewer's two-order fixture: a response socket may close while a cold wake still
 * owes an insertion. The reserved recovery-journal slot stays with the delivery attempt, so the inserted receipt's
 * settlement intent is still journaled after one settlement-write failure. The closed branch now asserts the slot is held.
 */
import { it, expect, vi, afterEach } from 'vitest'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'
import { join } from 'node:path'
import { bootNode, reservePort, runContext } from './harness.ts'
import { receiptMailboxHash, RECEIPT_MAILBOX_CAP } from '../../src/receipt-mailbox.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
const captured=vi.hoisted(()=>({stores:[] as Array<{file:string,store:any}>,faultFile:'',faultTask:'',fail:false,hits:0}))
vi.mock('../../src/cli-deposit.ts',async original=>{const mod=await original<typeof import('../../src/cli-deposit.ts')>();return{...mod,CliDepositStore:class extends mod.CliDepositStore{constructor(...args:ConstructorParameters<typeof mod.CliDepositStore>){super(...args);captured.stores.push({file:args[0],store:this})}}}})
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return{...actual,writeTaskLedger:(file:string,bytes:string)=>{if(captured.fail&&file===captured.faultFile&&JSON.parse(bytes).archived?.some((r:any)=>r.taskId===captured.faultTask&&r.endedBy==='receipt')){captured.hits++;captured.fail=false;throw Object.assign(Error('single settlement failure'),{code:'EACCES'})}return actual.writeTaskLedger(file,bytes)}}})
afterEach(()=>{captured.fail=false;captured.stores=[];captured.faultFile='';captured.faultTask='';captured.hits=0;vi.restoreAllMocks()})
const pending=(i:number)=>{const r={version:1 as const,transportId:'held-journal-'+i,fingerprint:'fingerprint-'+i,handle:'beta/01234567',targetKey:'session:missing-'+i,from:'beta/01234567',message:'[A2A receipt] task missing-'+i+' done',settler:{caller:'beta/01234567',proof:'origin-claim' as const,ingress:'wire' as const},originalBirth:'0'.repeat(64),at:Date.now(),phase:'pending' as const};return{...r,hash:receiptMailboxHash(r)}}
for(const close of[false,true])it(`a pending cold receipt retains recovery capacity through its insertion (responseClosed=${close})`,async()=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'slot-close-A',session:'slot-close-A',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,settlementAuth:'enforce',wakeJoinedOnBoot:false,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'slot-close-B',session:'slot-close-B',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 let req:ReturnType<typeof request>|undefined,releaseWake:((value:any)=>void)|undefined
 try{
  const originalAgent=a.agents.agent!
  for(const n of[a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'one job',async:true},runContext(originalAgent)) as any
  expect(sent.ok).toBe(true)
  const store=captured.stores.find(r=>r.file===join(a.home,'a2a','cli-deposits.json'))!.store
  for(let i=0;i<RECEIPT_MAILBOX_CAP-1;i++)store.journalSessionReceipt(pending(i))
  a.ctx.emit('agent/disposed',{agent:originalAgent});a.agents.agent=undefined
  const wake=vi.fn(()=>new Promise(resolve=>{releaseWake=resolve}))
  a.ctx.provide('sessionController',{resolveAgent:wake} as never)
  const transport='review-close-transport',text='[A2A receipt] task '+sent.task_id+' final result',body=JSON.stringify({team:'alpha/01234567',caller_session:'beta/01234567',task_id:transport,message:text,wait:false})
  const key=createPrivateKey(readFileSync(join(b.home,'a2a','node-key.pem'),'utf8')),url=au+'/a2a/direct'
  req=request(url,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url,method:'POST',body},{caller:'beta',callerUrl:bu,privateKey:key,unbound:false,now:Date.now()})}})
  req.on('error',()=>{});req.end(body)
  await vi.waitFor(()=>expect(wake).toHaveBeenCalledTimes(1))
  expect(store.reserveSessionReceiptSlot()).toBeUndefined()
  if(close){
   req.destroy()
   // The pending wake still owns the slot after the socket closes: no reservation is free and a competing write is refused.
   await new Promise<void>(r=>setTimeout(r,50))
   expect(store.reserveSessionReceiptSlot()).toBeUndefined()
   expect(()=>store.journalSessionReceipt(pending(900))).toThrow('capacity full')
   expect(store.pendingReceiptCommits()).toHaveLength(RECEIPT_MAILBOX_CAP-1)
  }else{
   expect(()=>store.journalSessionReceipt(pending(900))).toThrow('capacity full')
   expect(store.pendingReceiptCommits()).toHaveLength(RECEIPT_MAILBOX_CAP-1)
   req.on('response',res=>res.resume())
  }
  captured.faultFile=join(a.home,'a2a','tasks.json');captured.faultTask=sent.task_id;captured.fail=true
  a.agents.agent=originalAgent;a.ctx.emit('agent/created',{agent:originalAgent});releaseWake!({agent:originalAgent});releaseWake=undefined
  await vi.waitFor(()=>expect(captured.hits).toBeGreaterThan(0))
  await new Promise<void>(r=>setImmediate(r))
  const ledger=JSON.parse(readFileSync(captured.faultFile,'utf8')),journal=store.pendingReceiptCommits(),insertions=a.steered.filter(m=>JSON.stringify(m).includes(text)).length
  const diagnostic={insertions,pending:ledger.tasks.some((r:any)=>r.taskId===sent.task_id),archived:ledger.archived?.some((r:any)=>r.taskId===sent.task_id)??false,journal:journal.length,intent:journal.some((r:any)=>r.transportId===transport),faultHits:captured.hits}
  console.log('closed-response-journal-observation',JSON.stringify(diagnostic))
  expect(diagnostic.insertions===0||diagnostic.intent||diagnostic.archived,JSON.stringify(diagnostic)).toBe(true)
  expect(diagnostic).toMatchObject({insertions:1,intent:true,faultHits:1})
 }finally{captured.fail=false;req?.destroy();releaseWake?.({error:{message:'fixture disposed'}});await b.dispose();await a.dispose()}
})

