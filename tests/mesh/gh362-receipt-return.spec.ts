import {it,expect,vi,afterEach}from'vitest'
// #782-era ledger (2026-11-22, contended Windows host): full-suite load exceeded the 5s default in these specs; raised ceiling only, assertions unchanged.
vi.setConfig({ testTimeout: 25_000 })
import {SessionId}from'@deepseek-ai/dsh-session'
import {generateKeyPairSync,createPrivateKey}from'node:crypto'
import {readFileSync,writeFileSync}from'node:fs'
import {execFile}from'node:child_process'
import {promisify}from'node:util'
import {TaskLedger}from'../../src/task-ledger.ts'
import {join}from'node:path'
import {signCard}from'../../src/card.ts'
import {signOriginClaim}from'../../src/origin-claim.ts'
import {bootNode,reservePort,runContext,cliEnv,type MeshNode}from'./harness.ts'
const receiptFault=vi.hoisted(()=>({path:'',fail:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(receiptFault.fail&&path===receiptFault.path)throw Object.assign(Error('receipt fault'),{code:'EACCES'});actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{receiptFault.fail=false;receiptFault.path='';vi.restoreAllMocks()})
const cli='return-cli/a1b2c3d4e5f60718',receiver='beta/bbbbbbbb',id='session-bbbbbbbb11112222'
const post=(n:MeshNode,path:string,body:unknown)=>fetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify(body)}).then(r=>r.json())
const state=(n:MeshNode)=>fetch(n.baseUrl+'/__dsh_a2a/state',{headers:{Connection:'close'}}).then(r=>r.json())
async function fixture(canvas=false){
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 let a=await bootNode({name:'returnA',session:'returnA',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:true,forwardDirect:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 let b=await bootNode({name:'returnB',session:'returnB',team:'beta',agentId:id,port:pb,peers:[au],sessionNodes:true,teamScopeRouting:true,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 await post(b,'/__dsh_a2a/join',{id});let agent=b.agents.agent!;agent.followup=m=>b.steered.push(m)
 const key=generateKeyPairSync('ed25519').privateKey
 await post(a,'/__dsh_a2a/cli-deposit',{action:'publish',card:JSON.stringify(signCard({name:'return-cli',session:'return-cli',team:cli,capabilities:{route:true,async:true},expiresAt:Date.now()+3600000},key))})
 await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'return',id:cli})
 await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'return',id:receiver,peer:bu})
 await post(b,'/__dsh_a2a/canvas',{action:'add-member',name:'cli-home',id:cli,home:au})
 if(canvas){await post(b,'/__dsh_a2a/canvas',{action:'add-member',name:'work',id:cli,home:au});await post(b,'/__dsh_a2a/canvas',{action:'add-member',name:'work',id});await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'return',id:'beta/canvas/work'})}
 const submit=async(task:string)=>{const url=au+'/a2a/direct',body=JSON.stringify({team:canvas?'beta/canvas/work':receiver,caller_session:cli,task_id:task,message:'return work',wait:false});const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close',...signOriginClaim({url,method:'POST',body},{caller:'return-cli',callerUrl:au+'/a2a/cli/'+encodeURIComponent(cli),privateKey:key,unbound:false,now:Date.now()})},body}).then(r=>r.json());expect((await post(a,'/__dsh_a2a/canvas',{action:'remove',name:'return'})).ok).toBe(true);await b.ctx.tools.get('a2a_teams')!.execute({},runContext(agent));return result}
 const send=(message:string,team=cli)=>b.ctx.tools.get('a2a_route')!.execute({team,message,async:true},runContext(agent))as Promise<any>
 ;(b.agents as any).requireInitiator=()=>undefined
 const raw=async(task:string,target=cli,signer=b,unbound=false,message?:string)=>{const url=au+'/a2a/direct',body=JSON.stringify({team:target,caller_session:receiver,task_id:'receipt-'+Math.random().toString(16).slice(2),message:message??'[A2A receipt] task '+task+' complete',wait:false}),k=createPrivateKey(readFileSync(join(signer.home,'a2a/node-key.pem'),'utf8'));const headers=signOriginClaim({url,method:'POST',body},{caller:'beta',callerUrl:signer.baseUrl,privateKey:k,unbound,now:Date.now()});if(unbound){delete headers['X-A2A-Caller-Sig2'];delete headers['X-A2A-Caller-Sig3'];delete headers['X-A2A-Body-Sha256'];delete headers['X-A2A-Caller-Aud']}return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body}).then(r=>r.json())}
 const restartReceiver=async(changePin?:string)=>{
  const home=b.home;await b.dispose()
  if(changePin!==undefined){const file=join(home,'a2a/canvas.json'),snapshot=JSON.parse(readFileSync(file,'utf8'));snapshot.cliHome[cli]=changePin;writeFileSync(file,JSON.stringify(snapshot))}
  b=await bootNode({home,name:'returnB',session:'returnB',team:'beta',agentId:id,port:pb,peers:[au],sessionNodes:true,teamScopeRouting:true,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000});agent=b.agents.agent!;agent.followup=m=>b.steered.push(m);(b.agents as any).requireInitiator=()=>undefined
 }
 const restartCaller=async(replacement?:typeof key,beforeBoot?:()=>void)=>{
  const home=a.home;await a.dispose()
  if(replacement){const file=join(home,'a2a/cli-deposits.json'),snapshot=JSON.parse(readFileSync(file,'utf8'));snapshot.deposits.find((r:any)=>r.handle===cli).cardJson=JSON.stringify(signCard({name:'return-cli',session:'return-cli',team:cli,capabilities:{route:true,async:true},expiresAt:Date.now()+3600000},replacement));writeFileSync(file,JSON.stringify(snapshot))}
  beforeBoot?.()
  a=await bootNode({home,name:'returnA',session:'returnA',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:true,forwardDirect:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 }
 return{get a(){return a},key,get b(){return b},get agent(){return agent},submit,send,raw,restartReceiver,restartCaller,dispose:async()=>{await a.dispose();await b.dispose()}}
}
it('manual correlated receipt uses the frozen return lane after restart without ordinary scope',async()=>{
 const f=await fixture();try{
  expect((await f.submit('return-isolated')).forwarded).toBe(true);await f.restartReceiver()
  const ordinary=await f.send('ordinary return');expect(ordinary.ok).toBe(false);expect(ordinary.error).toContain('teamless')
  const receipt=await f.send('[A2A receipt] task return-isolated complete');expect(receipt.ok,JSON.stringify(receipt)).toBe(true)
  expect((await state(f.a)).archived.find((r:any)=>r.taskId==='return-isolated')).toMatchObject({endedBy:'receipt'})
 }finally{await f.dispose()}
})
it.each(['recipient','message','home','session'] as const)('isolated manual receipt lane rejects a mismatched %s',async boundary=>{
 const f=await fixture();try{
  expect((await f.submit('return-boundary')).forwarded).toBe(true)
  await f.restartReceiver(boundary==='home'?'https://different-home.invalid':undefined)
  let agent=f.agent
  if(boundary==='session'){
   const other={id:SessionId('session-cccccccc11112222'),session:{events:[]},steer:vi.fn(),followup:vi.fn()} as any
   f.b.agents.roots=()=>[f.agent,other];f.b.ctx.emit('agent/created',{agent:other});await post(f.b,'/__dsh_a2a/join',{id:String(other.id)});agent=other
  }
  const target=boundary==='recipient'?'other-return/a1b2c3d4e5f60718':cli
  const message=boundary==='message'?'[A2A receipt] task unrelated-task complete':'[A2A receipt] task return-boundary complete'
  let receiptPosts=0;const original=globalThis.fetch,spy=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url).endsWith('/a2a/direct')&&init?.method==='POST')receiptPosts++;return original(url,init)})
  let result:any
  try{result=await f.b.ctx.tools.get('a2a_route')!.execute({team:target,message,async:true},runContext(agent))}finally{spy.mockRestore()}
  expect(result.ok,JSON.stringify(result)).toBe(false)
  expect(result.error).toContain(boundary==='home'?'RECEIPT_AUTHORITY_CHANGED':'teamless')
  expect(receiptPosts).toBe(0);expect((await state(f.a)).tasks.some((r:any)=>r.taskId==='return-boundary')).toBe(true)
 }finally{await f.dispose()}
})
it.each([false,true])('correlated CLI forward receipt returns without receiver team membership (canvas=%s)',async canvas=>{
 const f=await fixture(canvas);try{
  const sent=await f.submit('return-ok');expect(sent.forwarded,JSON.stringify(sent)).toBe(true)
  if(canvas)await post(f.b,'/__dsh_a2a/canvas',{action:'remove',name:'work'})
  expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='return-ok').answeredAt).toBeUndefined()
  const reply=await f.send('[A2A receipt] task return-ok complete');expect(reply.ok,JSON.stringify(reply)).toBe(true)
  expect((await state(f.a)).archived.find((r:any)=>r.taskId==='return-ok')).toMatchObject({endedBy:'receipt'})
  expect((await state(f.b)).tasks.some((r:any)=>r.taskId==='return-ok')).toBe(false)
 }finally{await f.dispose()}
})
it('uncorrelated traffic and unknown or settled receipt ids retain ordinary admission',async()=>{
 const f=await fixture();try{
  await f.submit('return-once');
  const ordinary=await f.send('ordinary return');expect(ordinary.ok).toBe(false);expect(ordinary.error).toContain('teamless')
  const incoming=await f.raw('none',cli,f.b,false,'ordinary return');expect(incoming.routed).not.toBe(true)
  expect((await f.raw('unknown')).routed).not.toBe(true)
  expect((await f.send('[A2A receipt] task return-once complete')).ok).toBe(true)
  expect((await f.raw('return-once')).routed).not.toBe(true)
 }finally{await f.dispose()}
})
it('receipt target and completed signer identity remain bound to the frozen task',async()=>{
 const f=await fixture();let other:MeshNode|undefined
 try{
  await f.submit('return-bound')
  const otherCli='other-return/a1b2c3d4e5f60718',key=generateKeyPairSync('ed25519').privateKey
  await post(f.a,'/__dsh_a2a/cli-deposit',{action:'publish',card:JSON.stringify(signCard({name:'other-return',session:'other-return',team:otherCli,capabilities:{route:true},expiresAt:Date.now()+3600000},key))})
  expect((await f.raw('return-bound',otherCli)).routed).not.toBe(true)
  expect((await f.send('[A2A receipt] task return-bound complete',otherCli)).ok).toBe(false)
  expect((await f.raw('return-bound',cli,f.b,true)).routed).not.toBe(true)
  const original=globalThis.fetch,failed=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>String(url)===f.b.baseUrl+'/.well-known/agent-card.json'?Promise.reject(Error('validation unavailable')):original(url,init))
  try{expect(await f.raw('return-bound')).toMatchObject({code:-32011,delivered:false})}finally{failed.mockRestore()}
  other=await bootNode({name:'returnC',session:'returnC',team:'beta',sessionNodes:true,teamScopeRouting:true})
  expect((await f.raw('return-bound',cli,other)).routed).not.toBe(true)
  expect((await state(f.a)).tasks.some((r:any)=>r.taskId==='return-bound')).toBe(true)
  const originalRow=(await state(f.b)).tasks.find((r:any)=>r.taskId==='return-bound');expect(originalRow.answeredAt).toBeUndefined();expect(originalRow.receiptDelivery).toBeUndefined()
 }finally{await other?.dispose();await f.dispose()}
})
it('unconfirmed correlated receipt transport preserves debt without blind reposting',async()=>{
 const f=await fixture();try{
  await f.submit('return-fail');const original=globalThis.fetch
  const spy=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>String(url)===f.a.baseUrl+'/a2a/direct'&&init?.method==='POST'?Promise.reject(Error('unavailable')):original(url,init))
  try{expect((await f.send('[A2A receipt] task return-fail complete')).ok).toBe(false)}finally{spy.mockRestore()}
  expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='return-fail')).toMatchObject({status:'pending'});expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='return-fail')).toMatchObject({answeredAt:expect.any(Number),receiptDelivery:'receipt-undelivered'})
  expect((await state(f.a)).tasks.some((r:any)=>r.taskId==='return-fail')).toBe(true)
  expect(new TaskLedger(join(f.b.home,'a2a/tasks.json')).find('return-fail')).toMatchObject({receiptDelivery:'receipt-undelivered'})
  const view=await f.b.ctx.tools.get('a2a_tasks')!.execute({},runContext(f.agent))as any;expect(view.tasks.find((r:any)=>r.taskId==='return-fail').receiptDelivery).toBe('receipt-undelivered')
  const cliResult=await promisify(execFile)(process.execPath,['cli/a2a.mjs','tasks','--json','--home',f.b.baseUrl],{env:cliEnv(f.b.home),encoding:'utf8'});expect(JSON.parse(cliResult.stdout).pending.find((r:any)=>r.taskId==='return-fail').receiptDelivery).toBe('receipt-undelivered')
  let reposts=0;const noRepost=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url)===f.a.baseUrl+'/a2a/direct'&&init?.method==='POST')reposts++;return original(url,init)})
  try{const retry=await f.send('[A2A receipt] task return-fail complete');expect(retry.ok).toBe(false);expect(reposts).toBe(0);expect((await state(f.a)).archived.some((r:any)=>r.taskId==='return-fail')).toBe(false);expect((await state(f.b)).tasks.find((r:any)=>r.taskId==='return-fail')).toMatchObject({receiptRecovery:{state:'retained'}})}finally{noRepost.mockRestore()}
 }finally{await f.dispose()}
})

it('F1 mailbox write refusal keeps original debt and same-id retry inserts exactly once',async()=>{
 const f=await fixture();let clock:ReturnType<typeof vi.spyOn>|undefined
 try{
  await f.submit('mail-before-settle');receiptFault.path=join(f.a.home,'a2a/cli-deposits.json');receiptFault.fail=true
  const text='[A2A receipt] task mail-before-settle original full result',first=await f.send(text)
  expect(first.ok).toBe(false);expect((await state(f.a)).tasks.some((r:any)=>r.taskId==='mail-before-settle')).toBe(true);expect((await state(f.a)).archived.some((r:any)=>r.taskId==='mail-before-settle')).toBe(false)
  expect((await post(f.a,'/__dsh_a2a/cli-deposit',{action:'inbox',handle:cli})).mail.some((r:any)=>r.receipt_for==='mail-before-settle')).toBe(false)
  receiptFault.fail=false;const out=JSON.parse(readFileSync(join(f.b.home,'a2a/tasks.json'),'utf8')).receiptOutbox.find((r:any)=>r.taskId==='mail-before-settle');clock=vi.spyOn(Date,'now').mockReturnValue(out.nextAt+1)
  const second=await f.send(text);expect(second.ok,JSON.stringify(second)).toBe(true);expect(second.task_id).toBe(first.task_id)
  const mailbox=(await post(f.a,'/__dsh_a2a/cli-deposit',{action:'inbox',handle:cli})).mail.filter((r:any)=>r.receipt_for==='mail-before-settle');expect(mailbox).toHaveLength(1)
  expect((await state(f.a)).archived.filter((r:any)=>r.taskId==='mail-before-settle')).toHaveLength(1)
 }finally{clock?.mockRestore();receiptFault.fail=false;await f.dispose()}
})
it('F1 durable mailbox plus failed settlement recovers after receiver restart without another POST',async()=>{
 const f=await fixture();try{
  await f.submit('mail-commit-restart');receiptFault.path=join(f.a.home,'a2a/tasks.json');receiptFault.fail=true
  const first=await f.send('[A2A receipt] task mail-commit-restart original full result');expect(first.ok).toBe(false)
  expect((await state(f.a)).tasks.some((r:any)=>r.taskId==='mail-commit-restart')).toBe(true);expect((await state(f.a)).archived.some((r:any)=>r.taskId==='mail-commit-restart')).toBe(false)
  const mailbox=(await post(f.a,'/__dsh_a2a/cli-deposit',{action:'inbox',handle:cli})).mail.filter((r:any)=>r.receipt_for==='mail-commit-restart');expect(mailbox).toHaveLength(1)
  const snapshot=JSON.parse(readFileSync(join(f.a.home,'a2a/cli-deposits.json'),'utf8')),pending=snapshot.receiptCommits.find((r:any)=>r.transportId===first.task_id);expect(pending.phase).toBe('pending')
  let posts=0;const original=globalThis.fetch,spy=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url)===f.a.baseUrl+'/a2a/direct'&&init?.method==='POST')posts++;return original(url,init)})
  try{
   await f.restartCaller(undefined,()=>{receiptFault.fail=false})
   await vi.waitFor(async()=>expect((await state(f.a)).archived.filter((r:any)=>r.taskId==='mail-commit-restart')).toHaveLength(1),{timeout:3000})
   const readback=await post(f.a,'/a2a/query',{task_id:first.task_id,fingerprint:pending.fingerprint});expect(readback).toMatchObject({found:true,status:'completed',receipt_delivery:'delivered'})
   expect(posts).toBe(0);expect((await post(f.a,'/__dsh_a2a/cli-deposit',{action:'inbox',handle:cli})).mail.filter((r:any)=>r.receipt_for==='mail-commit-restart')).toHaveLength(1)
  }finally{spy.mockRestore()}
 }finally{receiptFault.fail=false;await f.dispose()}
})
it('P2 phase-only mailbox journal corruption cannot forge delivered or settle original debt after restart',async()=>{
 const f=await fixture();try{
  await f.submit('mail-phase-corrupt');receiptFault.path=join(f.a.home,'a2a/tasks.json');receiptFault.fail=true
  const first=await f.send('[A2A receipt] task mail-phase-corrupt original full result');expect(first.ok).toBe(false)
  const file=join(f.a.home,'a2a/cli-deposits.json'),snapshot=JSON.parse(readFileSync(file,'utf8')),commit=snapshot.receiptCommits.find((r:any)=>r.transportId===first.task_id)
  expect(commit.phase).toBe('pending')
  await f.restartCaller(undefined,()=>{const saved=JSON.parse(readFileSync(file,'utf8'));saved.receiptCommits.find((r:any)=>r.transportId===first.task_id).phase='delivered';writeFileSync(file,JSON.stringify(saved));receiptFault.fail=false})
  expect((await state(f.a)).tasks.some((r:any)=>r.taskId==='mail-phase-corrupt')).toBe(true)
  expect((await state(f.a)).archived.some((r:any)=>r.taskId==='mail-phase-corrupt')).toBe(false)
  const query=await post(f.a,'/a2a/query',{task_id:first.task_id,fingerprint:commit.fingerprint});expect(query.receipt_delivery).not.toBe('delivered');expect(query.status).toBe('pending')
 }finally{receiptFault.fail=false;await f.dispose()}
})
it.each([false,true])('F3b same-home CLI identity after restart preserves original key: replacement=%s',async replacement=>{
 const f=await fixture();try{
  const task='cli-key-'+replacement;await f.submit(task)
  const saved=JSON.parse(readFileSync(join(f.b.home,'a2a/tasks.json'),'utf8')).tasks.find((r:any)=>r.taskId===task);expect(saved.auth.caller_key).toBe(signCard({name:'original',session:'original',team:cli,capabilities:{route:true},expiresAt:Date.now()+3600000},f.key).publicKey)
  await f.restartCaller(replacement?generateKeyPairSync('ed25519').privateKey:undefined)
  let posts=0;const original=globalThis.fetch,spy=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url)===f.a.baseUrl+'/a2a/direct'&&init?.method==='POST')posts++;return original(url,init)})
  try{const result=await f.send('[A2A receipt] task '+task+' original full result');if(replacement){expect(result.ok,JSON.stringify(result)).toBe(false);expect(result.error,JSON.stringify(result)).toContain('RECEIPT_IDENTITY_CHANGED');expect(posts).toBe(0);expect((await state(f.b)).tasks.find((r:any)=>r.taskId===task)).toMatchObject({receiptDelivery:'receipt-undelivered',receiptRecovery:{state:'blocked'}});expect((await state(f.a)).tasks.some((r:any)=>r.taskId===task)).toBe(true)}else{expect(result.ok,JSON.stringify(result)).toBe(true);expect(posts).toBe(1)}}finally{spy.mockRestore()}
 }finally{await f.dispose()}
})
