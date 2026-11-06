import {it,expect,vi,afterEach}from'vitest'
import {join}from'node:path'
import {bootNode,reservePort,runContext}from'./harness.ts'
const fault=vi.hoisted(()=>({path:'',active:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(fault.active&&path===fault.path)throw Object.assign(Error('disk unavailable'),{code:'EACCES'});return actual.writeTaskLedger(path,bytes)}}})
vi.mock('../../src/receipt-retry.ts',async original=>{const actual=await original<typeof import('../../src/receipt-retry.ts')>();return {...actual,retryReceiptDelivery:(d:any)=>actual.retryReceiptDelivery(d,[120,240,480])}})
afterEach(()=>{fault.active=false;fault.path='';vi.restoreAllMocks()})
const state=(base:string)=>fetch(base+'/__dsh_a2a/state').then(r=>r.json())
const finish=(agent:any,task:string)=>{agent.session.events.push({type:'turn/start'},{type:'user/message',data:{content:[{type:'text',text:'[A2A direct] (task '+task+') sender sent:'}]}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'work completed'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}})}
it.each(['ledger','lost-response','ledger-lost-response','permanent','exhausted'] as const)('automatic receipt recovers '+ '%s'+' failure with one fixed identity and no duplicate delivery',async mode=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'retryA',session:'retryA',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'retryB',session:'retryB',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const bodies:string[]=[],statuses:number[]=[];let lost=false
 try{
  for(const n of[a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'work',async:true},runContext(a.agents.agent))as any;expect(sent.ok).toBe(true);const task=sent.task_id
  fault.path=join(a.home,'a2a/tasks.json');fault.active=mode==='ledger'||mode==='ledger-lost-response'||mode==='exhausted'
  const original=globalThis.fetch;vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
   const receipt=String(url)===au+'/a2a/direct'&&init?.method==='POST'&&String(init.body).includes('[A2A receipt] task '+task)
   if(receipt)bodies.push(String(init!.body))
   if(receipt&&mode==='permanent')return new Response(JSON.stringify({error:'authorization mismatch',code:-32000}),{status:403})
   const response=await original(url,init);if(receipt){statuses.push(response.status);if((mode==='lost-response'||mode==='ledger-lost-response')&&response.ok&&!lost){lost=true;throw new TypeError('fetch failed')}}return response
  })
  finish(b.agents.agent,task);b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})
  await vi.waitFor(()=>expect(bodies.length).toBeGreaterThan(0))
  if(mode==='permanent'){
   await vi.waitFor(async()=>expect((await state(bu)).archived.some((r:any)=>r.taskId===task)).toBe(true));expect(bodies).toHaveLength(1);expect((await state(au)).tasks.some((r:any)=>r.taskId===task)).toBe(true);expect(b.steered.filter((p:any)=>p.content?.[0]?.text?.includes('(task '+JSON.parse(bodies[0]).task_id+')'))).toHaveLength(1);return
  }
  if(mode==='exhausted'){
   await vi.waitFor(()=>expect(bodies).toHaveLength(4),{timeout:3000});await new Promise(resolve=>setTimeout(resolve,200));expect(bodies).toHaveLength(4)
   expect((await state(bu)).tasks.find((r:any)=>r.taskId===task)).toMatchObject({status:'pending',receiptDelivery:'receipt-undelivered'});expect((await state(bu)).archived.some((r:any)=>r.taskId===task)).toBe(false);expect(new Set(bodies).size).toBe(1);return
  }
  if(mode==='ledger'||mode==='ledger-lost-response'){
   expect(statuses[0]).toBe(503);expect((await state(au)).tasks.some((r:any)=>r.taskId===task)).toBe(true)
   expect((await state(bu)).tasks.find((r:any)=>r.taskId===task)).toMatchObject({status:'pending',receiptDelivery:'receipt-undelivered'})
   expect((await state(bu)).tasks.find((r:any)=>r.taskId===task).reminderAttempts).toBeUndefined()
   expect((await state(bu)).archived.some((r:any)=>r.taskId===task)).toBe(false);fault.active=false
  }
  await vi.waitFor(async()=>{expect((await state(au)).archived.filter((r:any)=>r.taskId===task)).toHaveLength(1);expect((await state(bu)).archived.filter((r:any)=>r.taskId===task)).toHaveLength(1)},{timeout:4000})
  expect(bodies.length).toBeGreaterThan(1);expect(new Set(bodies.map(x=>JSON.parse(x).task_id)).size).toBe(1);expect(new Set(bodies).size).toBe(1)
  expect((await state(au)).archived.find((r:any)=>r.taskId===task).endedBy).toBe('receipt');expect(a.steered.filter(p=>JSON.stringify(p).includes('[A2A receipt] task '+task))).toHaveLength(1)
  expect(b.steered.filter(p=>JSON.stringify(p).includes('[A2A receipt delivery notice]'))).toHaveLength(1)
 }finally{fault.active=false;await a.dispose();await b.dispose()}
})
