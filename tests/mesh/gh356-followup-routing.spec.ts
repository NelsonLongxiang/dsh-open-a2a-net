import {describe,it,expect,vi} from 'vitest'
import {readFileSync}from'node:fs'
import {execFile}from'node:child_process'
import {promisify}from'node:util'
import {join}from'node:path'
import {createPrivateKey}from'node:crypto'
import {signOriginClaim}from'../../src/origin-claim.ts'
import {bootNode,runContext,reservePort,cliEnv,type MeshNode}from'./harness.ts'
const post=(n:MeshNode,path:string,body:unknown)=>fetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
const state=(n:MeshNode)=>fetch(n.baseUrl+'/__dsh_a2a/state').then(r=>r.json())
async function fixture(race=false){
 const n=await bootNode({name:'followup-route',session:'followup-route',team:'alpha',silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000}),agent=n.agents.agent!,queued:any[]=[],removed:any[]=[],steered:any[]=[]
 agent.followup=message=>{queued.push(message)};agent.steer=message=>{steered.push(message)}
 n.ctx.provide('sessionController',{updateQueue:async(request:any)=>{if(race)throw Object.assign(Error('claimed during removal'),{code:'session/queue-item-not-found'});const index=queued.findIndex(m=>m.id===request.itemId);if(index<0)throw Object.assign(Error('not pending'),{code:'session/queue-item-not-found'});removed.push(...queued.splice(index,1));return{accepted:true}}} as never)
 await post(n,'/__dsh_a2a/join',{id:String(agent.id)})
 const deliver=async(id:string)=>{const r=await post(n,'/a2a/direct',{team:'alpha/01234567',caller_session:'beta/aaaaaaaa',task_id:id,message:'one task one next turn',wait:false});expect(r.delivered,JSON.stringify(r)).toBe(true);return r}
 return{n,agent,queued,removed,steered,deliver}
}
describe('#356 actual HTTP queue admission and cancellation',()=>{
 it('idle reminders and local sender notices both use sourced followup and never steer',async()=>{
  const n=await bootNode({name:'notice-followup',session:'notice-followup',team:'alpha',silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000}),first=n.agents.agent!,targetId='session-bbbbbbbb11112222',followed:any[]=[],notices:any[]=[],steer=vi.fn()
  const target={id:targetId,session:{events:[]},status:'running',followup:(m:any)=>followed.push(m),steer} as any
  first.followup=m=>notices.push(m);first.steer=steer;const service=n.agents as any;service.roots=()=>[first,target];service.get=(id:unknown)=>[first,target].find(a=>String(a.id)===String(id))
  n.ctx.emit('agent/created',{agent:target});for(const id of [String(first.id),targetId])await post(n,'/__dsh_a2a/join',{id})
  for(const id of [String(first.id),targetId])expect((await post(n,'/__dsh_a2a/canvas',{action:'add-member',name:'shared-followup',id})).ok).toBe(true)
  let now=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>now)
  try{
   const sent=await n.ctx.tools.get('a2a_route')!.execute({team:'alpha/bbbbbbbb',message:'notice source work',async:true},runContext(first)) as any;expect(sent.ok,JSON.stringify(sent)).toBe(true)
   target.status='idle';(first as any).status='running';const tick=async()=>{n.ctx.emit('agent/status',{agent:target,status:'idle'});await new Promise(r=>setImmediate(r));await state(n)}
   await tick();now+=120000;await tick();now+=600000;await tick();expect(followed.filter(m=>m.content[0].text.startsWith('[A2A reconciliation reminder]'))).toHaveLength(3)
   now+=1800000;await tick();expect(notices).toEqual([]);(first as any).status='idle';await tick();expect(notices).toHaveLength(1);expect(notices[0].source).toMatchObject({kind:'a2a-relay',form:'relay'});expect(notices[0].content[0].text).toContain('[A2A reconciliation notice]');expect(steer).not.toHaveBeenCalled()
  }finally{clock.mockRestore();await n.dispose()}
 })

 for(const claimed of [false,true])it('signed remote cancellation '+(claimed?'steers a claimed task':'withdraws the exact pending MessageId')+' without ordinary-task admission',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'cancelA',session:'cancelA',team:'alpha',port:pa,peers:[bu],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  const b=await bootNode({name:'cancelB',session:'cancelB',team:'beta',port:pb,peers:[au],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  const parked:any[]=[],stops:any[]=[];b.agents.agent!.followup=m=>parked.push(m);b.agents.agent!.steer=m=>stops.push(m)
  b.ctx.provide('sessionController',{updateQueue:async(request:any)=>{const index=parked.findIndex(m=>m.id===request.itemId);if(index<0)throw Object.assign(Error('claimed'),{code:'session/queue-item-not-found'});parked.splice(index,1);return{accepted:true}}} as never)
  try{
   for(const n of [a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
   const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'remote cancel work',async:true},runContext(a.agents.agent)) as any;expect(sent.ok,JSON.stringify(sent)).toBe(true)
   if(claimed){const message=parked.shift();b.ctx.emit('agent/inbox/claimed',{agent:b.agents.agent!,message,turn:1})}
   const target=bu+'/a2a/direct',key=createPrivateKey(readFileSync(join(a.home,'a2a/node-key.pem'),'utf8'))
   const sendCancel=async(caller:string,id:string)=>{const body=JSON.stringify({team:'beta/01234567',caller_session:caller,task_id:id,cancel_task_id:sent.task_id,message:'[A2A cancel] (task '+sent.task_id+') caller requested stop',wait:false});return fetch(target,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url:target,method:'POST',body},{caller:'alpha',callerUrl:au,privateKey:key,unbound:false,now:Date.now()})},body})}
   const wrong=await sendCancel('alpha/ffffffff','cancel-wrong');expect(wrong.status).toBe(403);expect((await state(b)).tasks.some((r:any)=>r.taskId===sent.task_id)).toBe(true)
   const good=await sendCancel('alpha/01234567','cancel-right');expect(good.status).toBe(200);expect(await good.json()).toMatchObject({delivered:true,removed:!claimed,receipt:'none'});expect(stops).toHaveLength(claimed?1:0);expect(parked).toEqual([]);expect((await state(b)).tasks).toEqual([])
  }finally{await a.dispose();await b.dispose()}
 })

 for(const cold of [false,true])it((cold?'cold resolution':'idle Agent')+' wakes and claims queued content, persisting exact consumed evidence',async()=>{
  const f=await fixture();try{
   let wakes=0
   f.agent.followup=message=>{wakes++;f.queued.push(message);f.n.ctx.emit('agent/inbox/claimed',{agent:f.agent,message,turn:1})}
   if(cold){f.n.ctx.emit('agent/disposed',{agent:f.agent});f.n.agents.agent=undefined;f.n.ctx.set('sessionController',{resolveAgent:async()=>{f.n.agents.agent=f.agent;f.n.ctx.emit('agent/created',{agent:f.agent});return{agent:f.agent}},updateQueue:async()=>({accepted:true})} as never)}
   const r=await f.deliver('wake-consumed');expect(r.consumed).toBe(true);expect(wakes).toBe(1)
   expect((await state(f.n)).tasks[0]).toMatchObject({consumed:true,deliveryObservation:'consumed'})
   const raw=JSON.parse(readFileSync(join(f.n.home,'a2a/tasks.json'),'utf8'));expect(raw.tasks[0].consumed).toBe(true);expect(raw.taskDeliveries[0].state).toBe('claimed')
  }finally{await f.n.dispose()}
 })
 it('outbound saves the peer consumed snapshot and receiver saves a later claim rather than assuming running means consumption',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'consumedA',session:'consumedA',team:'alpha',port:pa,peers:[bu],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  const b=await bootNode({name:'consumedB',session:'consumedB',team:'beta',port:pb,peers:[au],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  const parked:any[]=[];b.agents.agent!.followup=m=>parked.push(m)
  try{
   for(const n of [a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
   const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'accepted but wake parked',async:true},runContext(a.agents.agent)) as any;expect(sent.ok,JSON.stringify(sent)).toBe(true)
   for(const n of [a,b]){const raw=JSON.parse(readFileSync(join(n.home,'a2a/tasks.json'),'utf8'));expect(raw.tasks.find((r:any)=>r.taskId===sent.task_id).consumed).toBe(false);expect((await state(n)).tasks.find((r:any)=>r.taskId===sent.task_id).deliveryObservation).toBe('delivered-unconsumed')}
   b.ctx.emit('agent/inbox/claimed',{agent:b.agents.agent!,message:parked[0],turn:1})
   expect((await state(b)).tasks.find((r:any)=>r.taskId===sent.task_id).consumed).toBe(true)
   expect((await state(a)).tasks.find((r:any)=>r.taskId===sent.task_id).consumed).toBe(false)
  }finally{await a.dispose();await b.dispose()}
 })

 it('shipped CLI tasks and JSON show delivered-unconsumed while a queued wake is parked',async()=>{
  const f=await fixture();try{
   await f.deliver('cli-unconsumed')
   const run=(args:string[])=>promisify(execFile)(process.execPath,['cli/a2a.mjs',...args,'--home',f.n.baseUrl],{env:cliEnv(f.n.home),encoding:'utf8',timeout:5000})
   expect((await run(['tasks'])).stdout).toContain('delivered-unconsumed')
   const snapshot=JSON.parse((await run(['tasks','--json'])).stdout);expect(snapshot.pending[0]).toMatchObject({taskId:'cli-unconsumed',consumed:false,deliveryObservation:'delivered-unconsumed'})
  }finally{await f.n.dispose()}
 })
 it('HTTP async admission uses sourced followup rather than steer and saves its MessageId before acceptance',async()=>{
  const f=await fixture();try{await f.deliver('queued-task');expect(f.steered).toEqual([]);expect(f.queued).toHaveLength(1);expect((await state(f.n)).tasks[0]).toMatchObject({consumed:false,deliveryObservation:'delivered-unconsumed'});expect(f.queued[0].source).toEqual({kind:'a2a-relay',form:'relay',senderSessionId:'beta/aaaaaaaa',taskId:'queued-task'});const disk=JSON.parse(readFileSync(join(f.n.home,'a2a/tasks.json'),'utf8'));expect(disk.taskDeliveries[0]).toMatchObject({taskId:'queued-task',messageId:f.queued[0].id,sessionId:String(f.agent.id),state:'enqueued'})}finally{await f.n.dispose()}
 })
 it('removes a not-yet-claimed MessageId through updateQueue and then cancels without a steering notice',async()=>{
  const f=await fixture();try{await f.deliver('remove-queued');const id=f.queued[0].id;const r=await post(f.n,'/__dsh_a2a/tasks/cancel',{task_id:'remove-queued'});expect(r).toMatchObject({outcome:'cleared',removed:true,steered:false});expect(f.queued).toEqual([]);expect(f.removed[0].id).toBe(id);expect(f.steered).toEqual([]);expect((await state(f.n)).tasks).toEqual([])}finally{await f.n.dispose()}
 })
 for(const race of [false,true])it((race?'a remove/claim race':'an already claimed task')+' gets an immediate steer cancellation, never another followup',async()=>{
  const f=await fixture(race);try{await f.deliver('claimed-task');if(!race){const message=f.queued.shift();f.n.ctx.emit('agent/inbox/claimed',{agent:f.agent,message,turn:1})}const count=f.queued.length;const r=await post(f.n,'/__dsh_a2a/tasks/cancel',{task_id:'claimed-task'});expect(r).toMatchObject({outcome:'cleared',removed:false,steered:true});expect(f.steered).toHaveLength(1);expect(f.steered[0].content[0].text).toContain('[A2A cancel]');expect(f.queued).toHaveLength(count)}finally{await f.n.dispose()}
 })
 it('a missing followup capability fails honestly and cannot secretly fall back to steer',async()=>{
  const f=await fixture();try{Object.defineProperty(f.agent,'followup',{value:undefined});const r=await post(f.n,'/a2a/direct',{team:'alpha/01234567',caller_session:'beta/aaaaaaaa',task_id:'missing-followup',message:'no fallback',wait:false});expect(r.delivered).not.toBe(true);expect(r.error).toContain('Agent.followup');expect(f.steered).toEqual([]);expect(f.queued).toEqual([])}finally{await f.n.dispose()}
 })
 it('three queued tasks still fill capacity; a fourth cannot use followup to bypass admission',async()=>{
  const f=await fixture();try{for(let i=0;i<3;i++)await f.deliver('capacity-'+i);const r=await post(f.n,'/a2a/direct',{team:'alpha/01234567',caller_session:'beta/aaaaaaaa',task_id:'capacity-4',message:'overcap',wait:false});expect(r.reason).toBe('target-queue-full');expect(f.queued).toHaveLength(3);expect(f.steered).toEqual([])}finally{await f.n.dispose()}
 })
})
