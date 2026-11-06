import {it,expect,vi,afterEach}from'vitest'
import {readFileSync,copyFileSync,writeFileSync}from'node:fs'
import {request as httpRequest}from'node:http'
import {join}from'node:path'
import {generateKeyPairSync}from'node:crypto'
import {bootNode,reservePort,runContext,tmpHome,type MeshNode}from'./harness.ts'
import {signCard}from'../../src/card.ts'
import {signOriginClaim}from'../../src/origin-claim.ts'
import {TaskLedger}from'../../src/task-ledger.ts'
import {FollowupDelivery}from'../../src/followup-delivery.ts'
const fault=vi.hoisted(()=>({path:'',task:'',enabled:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(fault.enabled&&path===fault.path&&JSON.parse(bytes).tasks.some((r:any)=>r.taskId===fault.task))throw Object.assign(Error('private write detail'),{code:'ENOSPC'});return actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{fault.enabled=false;vi.restoreAllMocks()})
const post=(n:MeshNode,path:string,body:unknown)=>fetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
// Same-port restarts must not reuse a pre-dispose keep-alive socket. No request retry.
const freshJson=(url:string,options:{method?:string;headers?:Record<string,string>;body?:string}={})=>new Promise<any>((resolve,reject)=>{
 const req=httpRequest(url,{method:options.method??'GET',headers:options.headers,agent:false},res=>{let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part});res.on('error',reject);res.on('end',()=>{try{resolve(JSON.parse(body))}catch(error){reject(error)}})})
 req.on('error',reject);req.end(options.body)
})
const state=(n:MeshNode)=>freshJson(n.baseUrl+'/__dsh_a2a/state')
it('a2a_route retains caller debt and displays the receiver bookkeeping warning',async()=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'callerA',session:'callerA',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'callerB',session:'callerB',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 try{
  for(const n of[a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
  b.agents.agent!.followup=(m:any)=>b.steered.push(m)
  fault.path=join(b.home,'a2a/tasks.json');fault.task='';fault.enabled=true
  const original=b.agents.agent!.followup;b.agents.agent!.followup=(m:any)=>{fault.task=m.source.taskId;original(m)}
  const result=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'work',async:true},runContext(a.agents.agent))as any
  expect(result).toMatchObject({ok:true,receiverBookkeeping:'failed',task_status:'TASK_STATE_DELIVERED'});expect(result.reply).toContain('不要重派')
  expect((await state(a)).tasks.find((r:any)=>r.taskId===result.task_id)).toMatchObject({status:'pending',receiptExpected:true});expect((await state(a)).archived).toEqual([]);expect(b.steered).toHaveLength(1)
 }finally{fault.enabled=false;await a.dispose();await b.dispose()}
})
for(const sync of[false,true])for(const missingIdempotency of[false,true])it('accepted input with an uncommitted birth remains explicit and is not redelivered (sync-forward='+sync+', missing-idempotency='+missingIdempotency+')',async()=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'birthA',session:'birthA',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 let b=await bootNode({name:'birthB',session:'birthB',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const cli='birth-cli/a1b2c3d4e5f60718',key=generateKeyPairSync('ed25519').privateKey,task='birth-'+(sync?'sync':'async');let deliveries=0
 const configure=()=>{b.agents.agent!.followup=(m:any)=>{deliveries++;b.steered.push(m);if(sync){(b.agents.agent!.session as any).events.push({type:'turn/start'},{type:'user/message',data:{content:m.content}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'actual final'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}});b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})}}}
 try{
  for(const n of[a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
  await post(a,'/__dsh_a2a/cli-deposit',{action:'publish',card:JSON.stringify(signCard({name:'birth-cli',session:'birth-cli',team:cli,capabilities:{route:true,async:true},expiresAt:Date.now()+3600000},key))})
  const request=async()=>{const url=au+'/a2a/direct',body=JSON.stringify({team:'beta/01234567',caller_session:cli,task_id:task,message:'birth work',wait:sync});return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url,method:'POST',body},{caller:'birth-cli',callerUrl:au+'/a2a/cli/'+encodeURIComponent(cli),privateKey:key,unbound:false,now:Date.now()})},body}).then(r=>r.json())}
  configure();fault.path=join(b.home,'a2a/tasks.json');fault.task=task;fault.enabled=true
  const reply=await request();expect(reply).toMatchObject({routed:true,delivered:true,task_status:'TASK_STATE_DELIVERED',receiverBookkeeping:'failed',forwarded:true});expect(reply.reply_final).toBeUndefined();expect(reply.note).toContain('不要重派');expect(deliveries).toBe(1)
  expect((await state(a)).tasks.find((r:any)=>r.taskId===task)).toMatchObject({status:'pending',receiptExpected:true});expect((await state(a)).archived.some((r:any)=>r.taskId===task)).toBe(false)
  const view=await state(b);expect(view.tasks).toEqual([]);expect(view.archived).toEqual([]);expect(view.deliveryBookkeeping).toMatchObject({orphaned:1,failures:1,lastError:{code:'ENOSPC',at:expect.any(Number)}});expect(JSON.stringify(view.deliveryBookkeeping)).not.toContain('private')
  const inspectionFile=join(tmpHome(),'inspection.json');copyFileSync(fault.path,inspectionFile);const ledger=new TaskLedger(inspectionFile);expect(ledger.deliveryBookkeepingState().orphaned).toBe(1);expect(ledger.list()).toEqual([])
  const removableFile=join(tmpHome(),'removable.json');copyFileSync(fault.path,removableFile);const removable=new TaskLedger(removableFile),remove=vi.fn(async()=>({accepted:true}));await new FollowupDelivery({ledger:removable,taint:()=>{},warn:()=>{}}).withdraw(task,{updateQueue:remove},()=>b.agents.agent);expect(remove).toHaveBeenCalledOnce();expect(removable.list()).toEqual([]);expect(removable.archive()).toEqual([])
  const delivery=ledger.deliveryFor(task)!;new FollowupDelivery({ledger,taint:()=>{},warn:()=>{}}).claimed(b.agents.agent!,delivery.messageId);expect(ledger.list()).toEqual([])
  const controller={updateQueue:vi.fn(async()=>({accepted:true}))};await new FollowupDelivery({ledger,taint:()=>{},warn:()=>{}}).withdraw(task,controller,()=>b.agents.agent);expect(ledger.list()).toEqual([])
  // Diagnostic operations above use a separate copy, never the live host ledger.
  // The live host has its own committed snapshot and must never repeat the Agent input after repair.
  fault.enabled=false;const home=b.home;await b.dispose()
  if(missingIdempotency){const path=join(home,'a2a/idempotency.json'),snapshot=JSON.parse(readFileSync(path,'utf8'));expect(snapshot.entries.some((r:any)=>r.taskId===task)).toBe(true);snapshot.entries=snapshot.entries.filter((r:any)=>r.taskId!==task);writeFileSync(path,JSON.stringify(snapshot))}
  b=await bootNode({home,name:'birthB',session:'birthB',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000});configure()
  const restarted=await state(b);expect(restarted.tasks).toEqual([]);expect(restarted.archived).toEqual([]);expect(restarted.deliveryBookkeeping.orphaned).toBe(1)
  const diagnostic=await b.ctx.tools.get('a2a_status')!.execute({},runContext(b.agents.agent))as any;expect(diagnostic.deliveryBookkeeping.orphaned).toBe(1)
  ;(b.agents.agent as any).status='idle';b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'});expect((await state(b)).tasks).toEqual([]);expect((await state(b)).reconciliationReminders.unresolved).toBe(0);expect(deliveries).toBe(1)
  const firstBody={team:'beta/01234567',caller_session:cli,callback:cli,task_id:task,message:'birth work',wait:sync}
  // Reuse exactly the forwarded body; the signed forwarding host remains the same authority.
  const k=(await import('node:crypto')).createPrivateKey(readFileSync(join(a.home,'a2a/node-key.pem'),'utf8')),url=bu+'/a2a/direct',body=JSON.stringify(firstBody)
  const replay=await freshJson(url,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url,method:'POST',body},{caller:'alpha',callerUrl:au,privateKey:k,unbound:false,now:Date.now()})},body});expect(replay).toMatchObject({routed:true,delivered:true,task_status:'TASK_STATE_DELIVERED',receiverBookkeeping:'failed'});expect(replay.note).toContain('不要重派');expect(deliveries).toBe(1);expect((await state(b)).deliveryBookkeeping).toMatchObject({orphaned:1,failures:0});expect((await state(b)).deliveryBookkeeping.lastError).toBeUndefined();expect((await state(b)).tasks).toEqual([]);expect((await state(b)).archived).toEqual([]);expect((await state(a)).tasks.find((r:any)=>r.taskId===task).status).toBe('pending')
 }finally{fault.enabled=false;await a.dispose();await b.dispose()}
})
it('proven insertion after followup throw still reports a failed birth instead of asserting a receipt',async()=>{const n=await bootNode({name:'provenBirth',session:'provenBirth',team:'proof',sessionNodes:true,teamScopeRouting:false,silent:true});try{const agent=n.agents.agent!;(agent.session as any).id=String(agent.id);agent.followup=(m:any)=>{(agent.session as any).events.push({type:'agent/inbox/spliced',data:{inserted:[m]}});throw Error('wake refused after insert')};await post(n,'/__dsh_a2a/join',{id:String(agent.id)});fault.path=join(n.home,'a2a/tasks.json');fault.task='proved-birth';fault.enabled=true;const out=await post(n,'/a2a/direct',{team:'proof/01234567',caller_session:'caller/aaaaaaaa',task_id:fault.task,message:'work',wait:false});expect(out).toMatchObject({task_status:'TASK_STATE_DELIVERED',receiverBookkeeping:'failed'});expect(out.reply_final).toBeUndefined();expect((await state(n)).tasks).toEqual([]);expect((await state(n)).archived).toEqual([])}finally{fault.enabled=false;await n.dispose()}})
