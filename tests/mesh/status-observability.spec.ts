import {it,expect,vi,afterEach}from'vitest'
import {execFile}from'node:child_process'
import {promisify}from'node:util'
import {join}from'node:path'
import {bootNode,cliEnv,runContext,tmpHome}from'./harness.ts'
const fault=vi.hoisted(()=>({path:''}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(path===fault.path)throw Object.assign(Error('private path and payload'),{code:'ENOSPC'});return actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{fault.path='';vi.restoreAllMocks()})
for(const scoped of[false,true])it.each(['queued','unavailable','failed'] as const)('status tool exposes live %s escalation observations (scoped='+scoped+')',async mode=>{
 const n=await bootNode({name:'tool-observe',session:'tool-observe',team:'alpha',sessionNodes:true,silent:true,initialStatus:'running',teamScopeRouting:false,teamScopeInfo:scoped,asyncNudgeDelayMs:35})
 try{
  await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const prompt=vi.fn(()=>mode==='failed'?Promise.reject(Object.assign(Error('private detail'),{code:'EACCES'})):Promise.resolve({accepted:true}))
  n.ctx.provide('sessionController',(mode==='unavailable'?{}:{prompt})as never)
  const tool=()=>n.ctx.tools.get('a2a_status')!.execute({},runContext(n.agents.agent))as Promise<any>
  expect((await tool()).nudgeEscalations).toEqual({queued:0,unavailable:0,failed:0})
  expect((await tool()).ledgerPersistence).toEqual({ok:true})
  const response=await fetch(n.baseUrl+'/a2a/direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'alpha',caller_session:'beta/bbbbbbbb',task_id:'tool-nudge-'+mode,message:'work',wait:false})});expect((await response.json()).delivered).toBe(true)
  await vi.waitFor(async()=>expect((await tool()).nudgeEscalations).toEqual({queued:mode==='queued'?1:0,unavailable:mode==='unavailable'?1:0,failed:mode==='failed'?1:0,lastAt:expect.any(Number),...(mode==='queued'?{}:{lastError:mode==='unavailable'?'PROMPT_UNAVAILABLE':'EACCES'})}))
  const snapshot=await fetch(n.baseUrl+'/__dsh_a2a/state').then(r=>r.json());expect((await tool()).nudgeEscalations).toEqual(snapshot.nudgeEscalations);expect(prompt).toHaveBeenCalledTimes(mode==='unavailable'?0:1)
 }finally{await n.dispose()}
})
it.each([false,true])('real ledger failure and recovery reach status tool as well as CLI (scoped=%s)',async scoped=>{
 const n=await bootNode({name:'status',session:'status',team:'alpha',sessionNodes:true,silent:true,teamScopeRouting:false,teamScopeInfo:scoped,asyncNudgeDelayMs:86400000})
 const home=tmpHome(),run=(args:string[])=>promisify(execFile)(process.execPath,['cli/a2a.mjs',...args],{env:cliEnv(home),encoding:'utf8'})
 try{
  await run(['init','status-test'])
  await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const post=(id:string)=>fetch(n.baseUrl+'/a2a/direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'alpha',caller_session:'beta/bbbbbbbb',task_id:id,message:'test work',wait:false})}).then(r=>r.json())
  fault.path=join(n.home,'a2a/tasks.json');expect((await post('status-failure')).delivered).not.toBe(true)
  const text=await run(['status','--home',n.baseUrl]);expect(text.stdout).toContain('ledger      !!! FAILED !!!');expect(text.stdout).toContain('code=ENOSPC');expect(text.stdout).not.toContain('private')
  const failed=JSON.parse((await run(['status','--json','--home',n.baseUrl])).stdout);expect(failed.ledgerPersistence).toEqual({ok:false,lastError:{at:expect.any(Number),code:'ENOSPC'}});expect(failed.nudgeEscalations).toEqual({queued:0,unavailable:0,failed:0})
  const tool=await n.ctx.tools.get('a2a_status')!.execute({},runContext(n.agents.agent))as any;expect(tool.ledgerPersistence).toEqual(failed.ledgerPersistence);expect(tool.nudgeEscalations).toEqual({queued:0,unavailable:0,failed:0})
  fault.path='';expect((await post('status-recovery')).delivered).toBe(true)
  const recovered=JSON.parse((await run(['status','--json','--home',n.baseUrl])).stdout);expect(recovered.ledgerPersistence).toEqual({ok:true});expect((await run(['status','--home',n.baseUrl])).stdout).toContain('ledger      ok')
  const healthy=await n.ctx.tools.get('a2a_status')!.execute({},runContext(n.agents.agent))as any;expect(healthy.ledgerPersistence).toEqual({ok:true});expect(healthy.nudgeEscalations).toEqual({queued:0,unavailable:0,failed:0})
 }finally{await n.dispose()}
})
