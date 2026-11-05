// @vitest-environment node
import { describe,it,expect,vi,afterEach } from 'vitest'
import { readFileSync,chmodSync,statSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey } from 'node:crypto'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode,reservePort,runContext } from './harness.ts'
const denied=vi.hoisted(()=>({prefix:'',remaining:0,skip:0}))
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,openSync:(path:any,...args:any[])=>{if(denied.remaining>0&&String(path).startsWith(denied.prefix)){if(denied.skip>0){denied.skip--;return (fs.openSync as any)(path,...args)}denied.remaining--;throw Object.assign(Error('injected unwritable ledger directory'),{code:'EACCES'})}return (fs.openSync as any)(path,...args)}}})
afterEach(()=>{denied.prefix='';denied.remaining=0;denied.skip=0})
const state=async(base:string)=>{const response=await fetch(base+'/__dsh_a2a/state');expect(response.status).toBe(200);return response.json()}
const finish=(agent:any,ids:string[])=>{for(const id of ids)agent.session.events.push({type:'turn/start'}, {type:'user/message',data:{content:[{type:'text',text:'[A2A direct] (task '+id+') sender sent:'}]}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'completed '+id}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}})}
describe('ledger errors stay inside the real host event boundary',()=>{
 it('reports an own-inbound commit failure after the peer accepted the formal receipt without escaping or clearing local debt',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'ownA',session:'ownA',team:'alpha',sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:false,silent:true})
  const b=await bootNode({name:'ownB',session:'ownB',team:'beta',sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false,silent:true})
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
   const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'own inbound commit test',async:true},runContext(a.agents.agent)) as any
   expect(sent.ok).toBe(true);const task=sent.task_id,file=join(b.home,'a2a/tasks.json')
   denied.prefix=file+'.';denied.remaining=1;denied.skip=1 // answered commit succeeds; post-peer own-inbound commit fails.
   const result=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:'[A2A receipt] task '+task+' completed',async:true},runContext(b.agents.agent)) as any
   expect(result).toMatchObject({ok:false,error:expect.stringContaining('local settlement commit failed')})
   expect((await state(au)).archived.some((r:any)=>r.taskId===task)).toBe(true)
   expect(JSON.parse(readFileSync(file,'utf8')).tasks.some((r:any)=>r.taskId===task)).toBe(true)
   expect((await state(bu)).ledgerPersistence.lastError.code).toBe('EACCES')
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
   const failed=await receipt('disk-sender-receipt-1');expect(failed.status).toBe(503);expect(await failed.json()).toMatchObject({delivered:false,error:expect.stringContaining('settlement was not committed')})
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
   b.agents.agent!.steer=(()=>{finish(b.agents.agent,[task]);denied.prefix=file+'.';denied.remaining=1;denied.skip=1}) as never
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
