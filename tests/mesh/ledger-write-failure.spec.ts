// @vitest-environment node
import { describe,it,expect,vi,afterEach } from 'vitest'
import { readFileSync,chmodSync,statSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey,generateKeyPairSync } from 'node:crypto'
import { signCard } from '../../src/card.ts'
import { peerPayloadFingerprint } from '../../src/idempotency-store.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode,reservePort,runContext } from './harness.ts'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
const denied=vi.hoisted(()=>({prefix:'',remaining:0,skip:0}))
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,openSync:(path:any,...args:any[])=>{if(denied.remaining>0&&String(path).startsWith(denied.prefix)){if(denied.skip>0){denied.skip--;return (fs.openSync as any)(path,...args)}denied.remaining--;throw Object.assign(Error('injected unwritable ledger directory'),{code:'EACCES'})}return (fs.openSync as any)(path,...args)}}})
afterEach(()=>{denied.prefix='';denied.remaining=0;denied.skip=0;vi.restoreAllMocks()})
const state=async(base:string)=>{const response=await fetch(base+'/__dsh_a2a/state');expect(response.status).toBe(200);return response.json()}
const finish=(agent:any,ids:string[])=>{for(const id of ids)agent.session.events.push({type:'turn/start'}, {type:'user/message',data:{content:[{type:'text',text:'[A2A direct] (task '+id+') sender sent:'}]}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'completed '+id}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}})}
describe('ledger errors stay inside the real host event boundary',()=>{
 it('enforce forwarded receipt publishes query completion from precommit authority only after the ledger commits',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  // Capture (and still register) real recovery callbacks; don't race their 1s period against vi.waitFor's 1s window.
  const scans:Array<()=>void>=[],interval=TimerService.prototype.interval
  const timerSpy=vi.spyOn(TimerService.prototype,'interval').mockImplementation(function(this:TimerService,...args:any[]){
   if(typeof args[0]==='function'&&args[1]===1000)scans.push(args[0])
   return (interval as any).apply(this,args)
  }as any)
  const a=await bootNode({name:'queryA',session:'queryA',team:'alpha',sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:false,settlementAuth:'enforce',silent:true,forwardDirect:true})
  const b=await bootNode({name:'queryB',session:'queryB',team:'beta',sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false,settlementAuth:'enforce',silent:true})
  const cli=generateKeyPairSync('ed25519').privateKey,handle='query-cli/a1b2c3d4e5f60718',task='enforce-query-commit',message='forward and preserve query result'
  const post=async(base:string,path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
  try{
   await post(bu,'/__dsh_a2a/join',{id:String(b.agents.agent!.id)})
   expect((await post(au,'/__dsh_a2a/cli-deposit',{action:'publish',card:JSON.stringify(signCard({name:'query-cli',session:'query-cli',team:handle,capabilities:{route:true,async:true},expiresAt:Date.now()+86400000},cli))})).ok).toBe(true)
   expect((await post(au,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:handle})).ok).toBe(true)
   expect((await post(au,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:'beta/01234567',peer:bu})).ok).toBe(true)
   expect((await post(bu,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:handle,home:au})).ok).toBe(true)
   const target=au+'/a2a/direct',body=JSON.stringify({team:'beta/01234567',caller_session:handle,task_id:task,message,wait:false})
   const sent=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url:target,method:'POST',body},{caller:'query-cli',callerUrl:au+'/a2a/cli/'+encodeURIComponent(handle),privateKey:cli,unbound:false,now:Date.now()})},body}).then(r=>r.json())
   expect(sent.routed,JSON.stringify(sent)).toBe(true)
   const fingerprint=peerPayloadFingerprint({caller:handle,message,noWait:true,team:'beta/01234567'}),query=()=>post(au,'/a2a/query',{task_id:task,fingerprint})
   expect(await query()).toMatchObject({found:true,status:'pending'})
   const key=createPrivateKey(readFileSync(join(b.home,'a2a/node-key.pem'),'utf8'))
   const receipt=async(id:string)=>{const body=JSON.stringify({team:handle,caller_session:'beta/01234567',task_id:id,message:'[A2A receipt] task '+task+' exact completed result',wait:false});return fetch(target,{method:'POST',signal:AbortSignal.timeout(3000),headers:{'Content-Type':'application/json',...signOriginClaim({url:target,method:'POST',body},{caller:'beta',callerUrl:bu,privateKey:key,unbound:false,now:Date.now()})},body})}
   denied.prefix=join(a.home,'a2a/tasks.json')+'.';denied.remaining=100 // Keep the commit unavailable until after pending is checked.
   expect((await receipt('enforce-query-failure')).status).toBe(503)
   expect(await query()).toMatchObject({found:true,status:'pending'})
   expect((await state(au)).tasks.some((r:any)=>r.taskId===task)).toBe(true)
   denied.remaining=0
   expect(scans.length).toBeGreaterThan(0);for(const scan of scans)scan() // Execute the same registered recovery scan once; no second transport.
   expect((await state(au)).archived.some((r:any)=>r.taskId===task)).toBe(true)
    const accepted=await receipt('enforce-query-failure');expect(accepted.status).toBe(200);expect((await accepted.json()).settlement).toBeUndefined()
   expect((await state(au)).archived.some((r:any)=>r.taskId===task)).toBe(true)
   expect(await query()).toMatchObject({found:true,status:'completed',reply:'exact completed result'})
  }finally{denied.remaining=0;timerSpy.mockRestore();await a.dispose();await b.dispose()}
 })

 it('reports an own-inbound commit failure after the peer accepted the formal receipt without escaping or clearing local debt',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'ownA',session:'ownA',team:'alpha',sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:false,silent:true})
  const b=await bootNode({name:'ownB',session:'ownB',team:'beta',sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false,silent:true})
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
   const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'own inbound commit test',async:true},runContext(a.agents.agent)) as any
   expect(sent.ok).toBe(true);const task=sent.task_id,file=join(b.home,'a2a/tasks.json')
   denied.prefix=file+'.';denied.remaining=1;denied.skip=2 // reservation and sending checkpoint succeed; post-peer own-inbound commit fails.
   const result=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:'[A2A receipt] task '+task+' completed',async:true},runContext(b.agents.agent)) as any
   expect(result).toMatchObject({ok:false,error:expect.stringContaining('RECEIPT_SETTLEMENT_COMMIT_FAILED')})
   expect((await state(au)).archived.some((r:any)=>r.taskId===task)).toBe(true)
   expect(JSON.parse(readFileSync(file,'utf8')).tasks.some((r:any)=>r.taskId===task)).toBe(true)
   expect((await state(bu)).tasks.find((r:any)=>r.taskId===task)).toMatchObject({receiptDelivery:'receipt-undelivered',receiptRecovery:{state:'retained',code:'RECEIPT_SETTLEMENT_COMMIT_FAILED'}})
  }finally{denied.remaining=0;denied.skip=0;await a.dispose();await b.dispose()}
 })

 it('sender refuses a receipt with 503 when its own ledger cannot commit, stays owed and accepts a later receipt after repair',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'senderDiskA',session:'senderDiskA',team:'alpha',sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:false,silent:true})
  const b=await bootNode({name:'senderDiskB',session:'senderDiskB',team:'beta',sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false,silent:true})
  const escaped:unknown[]=[],onError=(error:unknown)=>escaped.push(error);process.on('uncaughtExceptionMonitor',onError)
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
   const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'sender disk test',async:true},runContext(a.agents.agent)) as any
   expect(sent.ok,JSON.stringify(sent)).toBe(true);const task=sent.task_id,file=join(a.home,'a2a/tasks.json'),before=readFileSync(file)
   expect((await state(au)).tasks.some((r:any)=>r.taskId===task)).toBe(true)
   const key=createPrivateKey(readFileSync(join(b.home,'a2a/node-key.pem'),'utf8')),target=au+'/a2a/direct'
   const receipt=async(transportId:string)=>{const body=JSON.stringify({team:'alpha/01234567',caller_session:'beta/01234567',task_id:transportId,message:'[A2A receipt] task '+task+' completed',wait:false});return fetch(target,{method:'POST',signal:AbortSignal.timeout(3000),headers:{'Content-Type':'application/json',...signOriginClaim({url:target,method:'POST',body},{caller:'beta',callerUrl:bu,privateKey:key,unbound:false,now:Date.now()})},body})}
   denied.prefix=file+'.';denied.remaining=1
   const failed=await receipt('disk-sender-receipt-1');expect(failed.status).toBe(503);// #708 R2: the receipt is inserted before it settles, so the failed ledger write now refuses the insertion itself: not-inserted, retryable on the same id.
   expect(await failed.json()).toMatchObject({delivered:false,receipt_delivery:'not-inserted',task_status:'TASK_STATE_FAILED'})
   expect(readFileSync(file)).toEqual(before);expect((await state(au)).tasks.some((r:any)=>r.taskId===task)).toBe(true);expect(a.steered).toHaveLength(0)
   expect((await state(au)).ledgerPersistence).toMatchObject({ok:false,lastError:{code:'EACCES'}});expect(escaped).toEqual([])
   denied.remaining=0;const good=await receipt('disk-sender-receipt-2');expect(good.status).toBe(200);expect((await good.json()).delivered).toBe(true)
   expect((await state(au)).archived.some((r:any)=>r.taskId===task)).toBe(true);expect((await state(au)).ledgerPersistence).toEqual({ok:true});expect(a.steered).toHaveLength(1);expect(escaped).toEqual([])
  }finally{process.off('uncaughtExceptionMonitor',onError);denied.remaining=0;await a.dispose();await b.dispose()}
 })

 it('a forwarded synchronous final handles the after-steer microtask write error and can retry without a second delivery',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'microA',session:'microA',team:'alpha',sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:false})
  const b=await bootNode({name:'microB',session:'microB',team:'beta',sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false,silent:true,flushTimeoutMs:60000})
  const escaped:unknown[]=[],onError=(error:unknown)=>escaped.push(error);process.on('uncaughtExceptionMonitor',onError)
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
   const task='disk-microtask',file=join(b.home,'a2a/tasks.json')
   b.agents.agent!.followup=(()=>{finish(b.agents.agent,[task]);denied.prefix=file+'.';denied.remaining=1;denied.skip=2}) as never
   const guard=Buffer.from(JSON.stringify({visitToken:'microtask-write-test',hopBudget:3})).toString('base64')
   const reply=await fetch(bu+'/a2a/direct',{method:'POST',headers:{'Content-Type':'application/json','X-A2A-Guard':guard},body:JSON.stringify({team:'beta/01234567',caller_session:'alpha/01234567',callback:'alpha/01234567',task_id:task,message:'microtask final',wait:true})}).then(r=>r.json())
   expect(reply.routed,JSON.stringify(reply)).toBe(true)
   await vi.waitFor(async()=>expect((await state(bu)).ledgerPersistence).toMatchObject({ok:false,lastError:{code:'EACCES'}}))
   expect(JSON.parse(readFileSync(file,'utf8')).tasks.find((r:any)=>r.taskId===task)?.answeredAt).toBeUndefined()
   expect(a.steered.filter(p=>JSON.stringify(p).includes('[A2A receipt] task '+task))).toHaveLength(0);expect(escaped).toEqual([])
   denied.remaining=0;b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})
   await vi.waitFor(async()=>expect((await state(bu)).archived.some((r:any)=>r.taskId===task)).toBe(true));expect(escaped).toEqual([])
  }finally{process.off('uncaughtExceptionMonitor',onError);denied.remaining=0;denied.skip=0;await a.dispose();await b.dispose()}
 })

 it('a failed final commit does not escape idle, send a receipt or discard the next waiter; a later idle retries',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'diskA',session:'diskA',team:'alpha',sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:false})
  const b=await bootNode({name:'diskB',session:'diskB',team:'beta',sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false,silent:true,flushTimeoutMs:60000})
  const escaped:unknown[]=[],onError=(error:unknown)=>escaped.push(error);process.on('uncaughtExceptionMonitor',onError)
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
   const send=async(task:string)=>fetch(bu+'/a2a/direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'beta/01234567',caller_session:'alpha/01234567',callback:'alpha/01234567',task_id:task,message:'work '+task,wait:false})}).then(r=>r.json())
   expect((await send('disk-failed')).delivered).toBe(true);expect((await send('disk-other')).delivered).toBe(true)
   const file=join(b.home,'a2a/tasks.json');denied.prefix=file+'.';denied.remaining=1
   finish(b.agents.agent,['disk-failed','disk-other'])
   expect(()=>b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})).not.toThrow()
   await vi.waitFor(async()=>expect((await state(bu)).archived.some((r:any)=>r.taskId==='disk-other')).toBe(true))
   const disk=JSON.parse(readFileSync(file,'utf8'));expect(disk.tasks.find((r:any)=>r.taskId==='disk-failed')?.answeredAt).toBeUndefined()
   expect(a.steered.filter(p=>JSON.stringify(p).includes('[A2A receipt] task disk-failed'))).toHaveLength(0)
   // Successful other-task commit can clear the last failure; fail again in isolation to check visible diagnostics.
   denied.remaining=1;b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})
   const failure=await state(bu);expect(failure.ledgerPersistence).toMatchObject({ok:false,lastError:{code:'EACCES',at:expect.any(Number)}})
   expect(failure.tasks.find((r:any)=>r.taskId==='disk-failed')?.answeredAt).toBeUndefined();expect(escaped).toEqual([])
   denied.remaining=0;b.ctx.emit('agent/status',{agent:b.agents.agent!,status:'idle'})
   await vi.waitFor(async()=>expect((await state(bu)).archived.some((r:any)=>r.taskId==='disk-failed')).toBe(true))
   expect(a.steered.filter(p=>JSON.stringify(p).includes('[A2A receipt] task disk-failed'))).toHaveLength(1)
   expect((await state(bu)).ledgerPersistence.ok).toBe(true);expect(escaped).toEqual([])
  }finally{process.off('uncaughtExceptionMonitor',onError);denied.remaining=0;await a.dispose();await b.dispose()}
 })
 it.runIf(process.platform!=='win32'&&process.getuid?.()!==0)('actual directory permissions deny an after-delivery answer commit without uncaughtException',async()=>{
  const n=await bootNode({name:'permission',session:'permission',team:'dsh',sessionNodes:true,silent:true,teamScopeRouting:false,flushTimeoutMs:60000})
  const dir=join(n.home,'a2a'),mode=statSync(dir).mode&0o777
  try{
   await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
   const delivery=await fetch(n.baseUrl+'/a2a/direct',{method:'POST',body:JSON.stringify({team:'dsh/01234567',caller_session:'other/aaaaaaaa',task_id:'disk-permission',message:'work',wait:false})}).then(r=>r.json());expect(delivery.delivered).toBe(true)
   chmodSync(dir,0o500);finish(n.agents.agent,['disk-permission']);expect(()=>n.ctx.emit('agent/status',{agent:n.agents.agent!,status:'idle'})).not.toThrow()
   const s=await state(n.baseUrl);expect(s.ledgerPersistence.lastError.code).toBe('EACCES');expect(s.tasks.find((r:any)=>r.taskId==='disk-permission')?.answeredAt).toBeUndefined()
  }finally{chmodSync(dir,mode);await n.dispose()}
 })
})
