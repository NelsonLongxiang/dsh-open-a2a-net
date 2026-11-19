// @vitest-environment node
/**
 * #747 review M1, the reviewer's fixture: a receipt answer that carries acceptance evidence (unknown or inserted) next to a
 * definite not-inserted shape must not grant the outbox a blind repost; the receipt is reconciled by query instead.
 */
import { it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, reservePort, runContext } from './harness.ts'
import { A2aClient } from '../../src/a2a-client.ts'
import { RECEIPT_NOT_INSERTED } from '../../src/receipt-retry.ts'
const nativeFetch=globalThis.fetch.bind(globalThis)
afterEach(()=>vi.restoreAllMocks())
for(const acceptance of ['unknown','inserted'] as const)it(`accepted receipt evidence cannot grant blind repost via the not-inserted marker (acceptance=${acceptance})`,async()=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'proof-priority-A',session:'proof-priority-A',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'proof-priority-B',session:'proof-priority-B',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 let clock:ReturnType<typeof vi.spyOn>|undefined
 try{
  for(const n of[a,b])await nativeFetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'one already delivered job',async:true},runContext(a.agents.agent)) as any
  expect(sent.ok).toBe(true)
  const text='[A2A receipt] task '+sent.task_id+' original authored result'
  let posts=0,queries=0,firstReply=true
  const clientResults:any[]=[],originalRoute=A2aClient.prototype.routeDirect
  vi.spyOn(A2aClient.prototype,'routeDirect').mockImplementation(async function(this:A2aClient,...args:Parameters<A2aClient['routeDirect']>){const result=await originalRoute.apply(this,args);if(args[0]===au&&args[2]===text)clientResults.push({unknown:result.acceptance==='unknown',notInserted:!result.ok&&result[RECEIPT_NOT_INSERTED]===true});return result})
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
   if(String(url)===au+'/a2a/query')queries++
   if(String(url)===au+'/a2a/direct'&&init?.method==='POST'&&String(init.body).includes(text)){
    posts++
    const response=await nativeFetch(url,init)
    if(firstReply){
     firstReply=false
     const transport=JSON.parse(String(init.body)).task_id
     await response.arrayBuffer()
     // A faulty/old peer response contradicts its accepted evidence with a definite no-insertion shape.
     return new Response(JSON.stringify({error:'contradictory accepted receipt response',code:-32000,task_id:transport,task_status:'TASK_STATE_FAILED',delivered:false,receipt_delivery:'not-inserted',acceptance,refusal:{code:'correspondence-capacity',notSent:true,capacity:'unknown'}}),{status:503,headers:{'Content-Type':'application/json'}})
    }
    return response
   }
   return nativeFetch(url,init)
  })
  const first=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:text,async:true},runContext(b.agents.agent)) as any
  expect(first.ok).toBe(false)
  const snapshot=JSON.parse(readFileSync(join(b.home,'a2a/tasks.json'),'utf8')),kept=snapshot.receiptOutbox.find((r:any)=>r.taskId===sent.task_id)
  expect(kept).toBeDefined()
  const firstPhase=kept.phase
  clock=vi.spyOn(Date,'now').mockReturnValue(kept.nextAt+1)
  const second=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:text,async:true},runContext(b.agents.agent)) as any
  const diagnostic={acceptance,firstPhase,clientResults,posts,queries,secondOk:second.ok,insertions:a.steered.filter(m=>JSON.stringify(m).includes(text)).length}
  console.log('accepted-receipt-proof-observation',JSON.stringify(diagnostic))
  expect(diagnostic.insertions).toBe(1)
  expect(clientResults[0]).toEqual({unknown:true,notInserted:false})
  expect(firstPhase).toBe('sending')
  expect(posts,JSON.stringify(diagnostic)).toBe(1)
  expect(queries).toBeGreaterThan(0)
 }finally{clock?.mockRestore();vi.restoreAllMocks();await b.dispose();await a.dispose()}
})

