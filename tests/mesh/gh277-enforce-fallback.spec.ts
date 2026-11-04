// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'
import { bootNode } from './harness.ts'
beforeEach(()=>vi.stubGlobal('WebSocket',function(){throw Error('no socket')}))
afterEach(()=>vi.unstubAllGlobals())
async function cli(home:string,args:string[]){
 return await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[join(process.cwd(),'cli/a2a.mjs'),...args],{env:{...process.env,A2A_CLI_HOME:home}})
  let stdout='',stderr='';child.stdout.on('data',x=>{stdout+=String(x)});child.stderr.on('data',x=>{stderr+=String(x)});child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}))
 })
}
describe('#277 enforce fallback availability',()=>{
 it('real plugin and CLI stay online in observe, expose refusal and actually reconcile off-chain legacy debt',async()=>{
  const home=mkdtempSync(join(tmpdir(),'gh277-host-')), cliHome=mkdtempSync(join(tmpdir(),'gh277-cli-'))
  const ledger=new TaskLedger(join(home,'a2a','tasks.json'))
  ledger.track('old-forwarded','dsh/canvas/old','http://unknown-peer',undefined,undefined,undefined,{forwarded:true,deliveredTo:'dsh/canvas/old'})
  const node=await bootNode({name:'fallback',session:'gh277-fallback',team:'dsh',home,sessionNodes:true,settlementAuth:'enforce',peers:[]})
  try{
   const state=await fetch(node.baseUrl+'/__dsh_a2a/state').then(r=>r.json()) as any
   expect(state.settlement).toMatchObject({mode:'observe',enforceRefused:{reason:'legacy forwarded canvas debts lack receiver facts',blockers:['old-forwarded']}})
   const tasks=await cli(cliHome,['tasks','--json','--home',node.baseUrl]);expect(tasks.code,tasks.stderr).toBe(0)
   expect(JSON.parse(tasks.stdout).settlement).toEqual(state.settlement)
   const table=await cli(cliHome,['tasks','--home',node.baseUrl]);expect(table.stdout).toContain('enforce refused:');expect(table.stdout).toContain('old-forwarded')
   expect((await cli(cliHome,['init','fallback'])).code).toBe(0)
   expect((await cli(cliHome,['publish','--home',node.baseUrl])).code).toBe(0)
   const who=await cli(cliHome,['whoami','--json','--home',node.baseUrl]);expect(who.code,who.stderr).toBe(0)
   const handle=JSON.parse(who.stdout).handle
   const receipt=await cli(cliHome,['route',handle,'[A2A receipt] task old-forwarded observed completion','--home',node.baseUrl])
   expect(receipt.code,receipt.stderr).toBe(0)
   const after=JSON.parse((await cli(cliHome,['tasks','--json','--home',node.baseUrl])).stdout)
   expect(after.pending.some((row:any)=>row.taskId==='old-forwarded')).toBe(false)
   expect(after.archived.find((row:any)=>row.taskId==='old-forwarded')).toMatchObject({endedBy:'receipt',settledBy:{chain_role:'off-chain'}})
   expect(after.settlement).toMatchObject({mode:'observe',enforceBlockers:[],enforceRefused:{blockers:['old-forwarded']}}) // refusal is a boot-time audit, never auto-promote on settlement
   const status=await cli(cliHome,['status','--home',node.baseUrl]);expect(status.stdout).toContain('mode=observe; enforce refused:')
  }finally{await node.dispose()}
  const restart=await bootNode({name:'cleared',session:'gh277-cleared',team:'dsh',home,sessionNodes:true,settlementAuth:'enforce',peers:[]})
  try{const state=await fetch(restart.baseUrl+'/__dsh_a2a/state').then(r=>r.json()) as any;expect(state.settlement.mode).toBe('enforce');expect(state.settlement.enforceRefused).toBeUndefined()}finally{await restart.dispose()}
 },15000)
})
