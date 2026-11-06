import{it,expect,vi}from'vitest'
import{generateKeyPairSync}from'node:crypto'
import{bootNode,reservePort,runContext,type MeshNode}from'./harness.ts'
import{signCard}from'../../src/card.ts'
import{signOriginClaim}from'../../src/origin-claim.ts'
const cli='sync-cli/0123456789abcdef',id='session-bbbbbbbb11112222',target='beta/bbbbbbbb'
const post=(n:MeshNode,path:string,body:unknown)=>fetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
const state=(n:MeshNode)=>fetch(n.baseUrl+'/__dsh_a2a/state').then(r=>r.json())
async function fixture(ttl=60000){
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'syncA',session:'syncA',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'syncB',session:'syncB',team:'beta',port:pb,peers:[au],agentId:id,sessionNodes:true,teamScopeRouting:false,silent:true,flushTimeoutMs:80,taskStaleTtlMs:ttl,asyncNudgeDelayMs:86400000})
 for(const n of[a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
 const key=generateKeyPairSync('ed25519').privateKey
 await post(a,'/__dsh_a2a/cli-deposit',{action:'publish',card:JSON.stringify(signCard({name:'sync-cli',session:'sync-cli',team:cli,capabilities:{route:true,async:true},expiresAt:Date.now()+3600000},key))})
 await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'sync',id:cli});await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'sync',id:target,peer:bu});await post(b,'/__dsh_a2a/canvas',{action:'add-member',name:'sync',id:cli,home:au})
 const queued:any[]=[];b.agents.agent!.followup=m=>queued.push(m)
 const timeouts:Array<{delay:number;dispose:ReturnType<typeof vi.fn>}>=[],timeout=b.ctx.timer.timeout.bind(b.ctx.timer)
 vi.spyOn(b.ctx.timer,'timeout').mockImplementation(((fn:()=>void,delay:number)=>{const dispose=vi.fn(timeout(fn,delay));timeouts.push({delay,dispose});return dispose})as any)
 const send=(task:string)=>{const url=au+'/a2a/direct',body=JSON.stringify({team:target,caller_session:cli,task_id:task,message:'sync work',wait:true});return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url,method:'POST',body},{caller:'sync-cli',callerUrl:au+'/a2a/cli/'+encodeURIComponent(cli),privateKey:key,unbound:false,now:Date.now()})},body}).then(r=>r.json())}
 const finish=(task:string,text='own final',kind='completed')=>{const m=queued.find(x=>x.source.taskId===task);(b.agents.agent!.session as any).events.push({type:'turn/start'},{type:'user/message',data:{content:m.content}},...(text?[{type:'assistant/message',data:{message:{content:[{type:'text',text}]}}}]:[]),{type:'turn/end',data:{reason:{kind}}});b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})}
 return{a,b,queued,send,finish,timeouts,dispose:async()=>{await a.dispose();await b.dispose()}}
}
it.each(['flush','dead','aborted','textless'] as const)('synchronous forwarded %s placeholder is delivered and both sides retain receipt debt',async mode=>{
 const f=await fixture();try{
  const pending=f.send('sync-'+mode);await vi.waitFor(()=>expect(f.queued).toHaveLength(1))
  if(mode==='dead'){f.b.agents.agent=undefined;f.b.ctx.emit('agent/status',{agent:{id}as any,status:'idle'})}
  if(mode==='aborted')f.finish('sync-'+mode,'not completed','aborted')
  if(mode==='textless')f.finish('sync-'+mode,'')
  const reply=await pending;expect(reply).toMatchObject({routed:true,task_status:'TASK_STATE_DELIVERED',receipt:'routed',forwarded:true});expect(reply.reply_final).toBeUndefined()
  expect((await state(f.a)).tasks.find((r:any)=>r.taskId==='sync-'+mode)).toMatchObject({status:'pending',receiptExpected:true,settleable:true})
  expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='sync-'+mode)).toMatchObject({status:'pending',receiptExpected:true});expect((await state(f.a)).archived).toEqual([])
 }finally{await f.dispose()}
})
it('late reading-turn final after HTTP expiry emits one receipt across duplicate idle and reconciliation scans',async()=>{
 const f=await fixture(3600000);try{
  const reply=await f.send('sync-late');expect(reply).toMatchObject({task_status:'TASK_STATE_DELIVERED',receipt:'routed'})
  expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='sync-late').answeredAt).toBeUndefined()
  // A reminder can prompt reconciliation, never synthesize a receipt for work without a final.
  const now=Date.now(),clock=vi.spyOn(Date,'now').mockImplementation(()=>now+5*60000)
  ;(f.b.agents.agent as any).status='idle';f.b.ctx.emit('agent/status',{agent:f.b.agents.agent!,status:'idle'});await vi.waitFor(async()=>expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='sync-late').reminderAttempts).toBe(1));clock.mockRestore()
  expect(f.queued.some(m=>JSON.stringify(m).includes('[A2A reconciliation reminder]'))).toBe(true)
  const original=globalThis.fetch,bodies:string[]=[];const spy=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url)===f.a.baseUrl+'/a2a/direct'&&init?.method==='POST'&&String(init.body).includes('[A2A receipt] task sync-late'))bodies.push(String(init.body));return original(url,init)})
  try{
   f.finish('sync-late');f.b.ctx.emit('agent/status',{agent:f.b.agents.agent!,status:'idle'});f.b.ctx.emit('agent/status',{agent:f.b.agents.agent!,status:'idle'})
   await vi.waitFor(async()=>{expect((await state(f.a)).archived.filter((r:any)=>r.taskId==='sync-late')).toHaveLength(1);expect((await state(f.b)).archived.filter((r:any)=>r.taskId==='sync-late')).toHaveLength(1)})
   expect(bodies).toHaveLength(1);expect(f.queued.filter(m=>m.source.taskId==='sync-late')).toHaveLength(1);expect((await state(f.a)).archived.find((r:any)=>r.taskId==='sync-late').endedBy).toBe('receipt')
  }finally{spy.mockRestore()}
 }finally{await f.dispose()}
})
it('cancellation and original task TTL prevent a late final from sending any receipt',async()=>{
 for(const stop of['cancel','ttl']){
  const f=await fixture(stop==='ttl'?180:60000);try{
   await f.send('sync-stop');if(stop==='cancel')await post(f.b,'/__dsh_a2a/tasks/cancel',{task_id:'sync-stop'});else await new Promise(r=>setTimeout(r,200))
   const before=(await state(f.a)).archived.length;f.finish('sync-stop');await Promise.resolve();expect((await state(f.a)).archived.length).toBe(before)
  }finally{await f.dispose()}
 }
})
it('late final transient retry has one fixed receipt identity, one business delivery and one settlement',async()=>{
 const f=await fixture(3600000);const original=globalThis.fetch,bodies:string[]=[],accepted:string[]=[];let failed=false
 try{
  await f.send('sync-retry')
  const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
   const receipt=String(url)===f.a.baseUrl+'/a2a/direct'&&init?.method==='POST'&&String(init.body).includes('[A2A receipt] task sync-retry')
   if(receipt){bodies.push(String(init!.body));if(!failed){failed=true;throw new TypeError('fetch failed')}}
   const r=await original(url,init);if(receipt&&r.ok)accepted.push(String(init!.body));return r
  })
  try{f.finish('sync-retry');await vi.waitFor(()=>expect(bodies).toHaveLength(1));const now=Date.now(),clock=vi.spyOn(Date,'now').mockImplementation(()=>now+300000);try{(f.b.agents.agent as any).status='idle';f.b.ctx.emit('agent/status',{agent:f.b.agents.agent!,status:'idle'});await vi.waitFor(async()=>expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='sync-retry').reminderAttempts).toBe(1))}finally{clock.mockRestore()}for(let i=0;i<5;i++)f.b.ctx.emit('agent/status',{agent:f.b.agents.agent!,status:'idle'});await vi.waitFor(async()=>{expect((await state(f.a)).archived.filter((r:any)=>r.taskId==='sync-retry')).toHaveLength(1);expect((await state(f.b)).archived.filter((r:any)=>r.taskId==='sync-retry')).toHaveLength(1)},{timeout:3000});expect(new Set(bodies).size).toBe(1);expect(bodies).toHaveLength(2);expect(accepted).toHaveLength(1);expect(f.queued.filter(m=>m.source.taskId==='sync-retry')).toHaveLength(1)}finally{spy.mockRestore()}
 }finally{await f.dispose()}
})
it('receipt TTL timer is disposed on cancellation and all resources disappear on unload',async()=>{
 const f=await fixture();try{await f.send('sync-cleanup');const timer=f.timeouts.find(x=>x.delay>50000)!;expect(timer).toBeDefined();expect(timer.dispose).not.toHaveBeenCalled();await post(f.b,'/__dsh_a2a/tasks/cancel',{task_id:'sync-cleanup'});expect(timer.dispose).toHaveBeenCalled()}finally{await f.dispose()}
 expect(f.b.ctx.fiber.getEffects()).toHaveLength(0);expect(f.a.ctx.fiber.getEffects()).toHaveLength(0)
})
it('plain a2a_route sync caller receives reconcile instruction with visible receiptless bookkeeping',async()=>{
 const f=await fixture();try{const out=await f.a.ctx.tools.get('a2a_route')!.execute({team:target,message:'sync tool work'},runContext(f.a.agents.agent)) as any;expect(out).toMatchObject({ok:true,task_status:'TASK_STATE_DELIVERED',receipt:'none',reply:expect.stringContaining('已送达、未得到最终答复，请按 task id 对账')});expect(out.replyFinal).toBeUndefined();expect((await state(f.a)).tasks.find((r:any)=>r.taskId===out.task_id)).toMatchObject({status:'pending',receiptExpected:false,settleable:false});expect((await state(f.b)).tasks).toEqual([]);expect(f.queued.filter(m=>m.source.taskId===out.task_id)).toHaveLength(1);expect(f.timeouts.filter(x=>x.delay>50000)).toHaveLength(0);f.finish(out.task_id);expect((await state(f.a)).archived).toEqual([])}finally{await f.dispose()}
})
it('original receipt expiry and unload dispose timers without borrowing later output',async()=>{
 const f=await fixture(250);try{await f.send('sync-expiry');const timer=f.timeouts.find(x=>x.delay>80&&x.delay<=250)!;expect(timer).toBeDefined();await vi.waitFor(()=>expect(timer.dispose).toHaveBeenCalled());f.finish('sync-expiry');expect((await state(f.a)).archived).toEqual([])}finally{await f.dispose()}
 const g=await fixture();await g.send('sync-unload');const timer=g.timeouts.find(x=>x.delay>50000)!;expect(timer.dispose).not.toHaveBeenCalled();await g.dispose();expect(timer.dispose).toHaveBeenCalled();expect(g.b.ctx.fiber.getEffects()).toHaveLength(0)
})
it('same-host plain synchronous placeholder is visible receiptless and never creates an automatic receipt',async()=>{
 const f=await fixture();try{
  const out=await f.b.ctx.tools.get('a2a_route')!.execute({team:target,message:'local synchronous work'},runContext())as any
  expect(out).toMatchObject({ok:true,task_status:'TASK_STATE_DELIVERED',receipt:'none',reply:expect.stringContaining('已送达、未得到最终答复，请按 task id 对账')});expect(out.replyFinal).toBeUndefined()
  expect((await state(f.b)).tasks.find((r:any)=>r.taskId===out.task_id)).toMatchObject({status:'pending',receiptExpected:false,settleable:false});expect(f.timeouts.filter(x=>x.delay>50000)).toHaveLength(0)
  f.finish(out.task_id);expect((await state(f.b)).archived).toEqual([])
 }finally{await f.dispose()}
})
it('forwarded synchronous replay after HTTP timeout does not redeliver or duplicate its retained receipt',async()=>{
 const f=await fixture();try{
  const first=await f.send('sync-replay'),again=await f.send('sync-replay');expect(first.receipt).toBe('routed');expect(again).toMatchObject({replay:true});expect(again.reply_final).toBeUndefined();expect(again.error).toContain('duplicate task id');expect(f.queued.filter(m=>m.source.taskId==='sync-replay')).toHaveLength(1)
  f.finish('sync-replay');await vi.waitFor(async()=>expect((await state(f.a)).archived.filter((r:any)=>r.taskId==='sync-replay')).toHaveLength(1));expect(f.queued.filter(m=>m.source.taskId==='sync-replay')).toHaveLength(1)
 }finally{await f.dispose()}
})
