import {it,expect,vi,afterEach}from'vitest'
import {execFile}from'node:child_process'
import {promisify}from'node:util'
import {join}from'node:path'
import {bootNode,cliEnv,runContext,tmpHome}from'./harness.ts'
const fault=vi.hoisted(()=>({path:''}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(path===fault.path)throw Object.assign(Error('private path and payload'),{code:'ENOSPC'});return actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{fault.path=''})
it('real ledger failure is visible in status text and JSON then clears after a successful commit',async()=>{
 const n=await bootNode({name:'status',session:'status',team:'alpha',sessionNodes:true,silent:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
 const home=tmpHome(),run=(args:string[])=>promisify(execFile)(process.execPath,['cli/a2a.mjs',...args],{env:cliEnv(home),encoding:'utf8'})
 try{
  await run(['init','status-test'])
  await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const post=(id:string)=>fetch(n.baseUrl+'/a2a/direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'alpha',caller_session:'beta/bbbbbbbb',task_id:id,message:'test work',wait:false})}).then(r=>r.json())
  fault.path=join(n.home,'a2a/tasks.json');expect((await post('status-failure')).delivered).not.toBe(true)
  const text=await run(['status','--home',n.baseUrl]);expect(text.stdout).toContain('ledger      !!! FAILED !!!');expect(text.stdout).toContain('code=ENOSPC');expect(text.stdout).not.toContain('private')
  const failed=JSON.parse((await run(['status','--json','--home',n.baseUrl])).stdout);expect(failed.ledgerPersistence).toEqual({ok:false,lastError:{at:expect.any(Number),code:'ENOSPC'}});expect(failed.nudgeEscalations).toEqual({queued:0,unavailable:0,failed:0})
  const tool=await n.ctx.tools.get('a2a_status')!.execute({},runContext(n.agents.agent))as any;expect(tool.ledgerPersistence.ok).toBe(false)
  fault.path='';expect((await post('status-recovery')).delivered).toBe(true)
  const recovered=JSON.parse((await run(['status','--json','--home',n.baseUrl])).stdout);expect(recovered.ledgerPersistence).toEqual({ok:true});expect((await run(['status','--home',n.baseUrl])).stdout).toContain('ledger      ok')
 }finally{await n.dispose()}
})
