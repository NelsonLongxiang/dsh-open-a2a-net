import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildAuthorization, type TaskAuthorization } from '../../src/task-auth.ts'
import { TaskLedger, type Sender } from '../../src/task-ledger.ts'
const team='dsh/canvas/ops',caller='receipt-cli/aabbccddeeff0011'
const auth=buildAuthorization({ok:true,via:'cli-deposit',rule:'cli-deposit',basis:[]},{caller,proof:'cli-identity',claim:{caller,origin:'http://home'},ingress:'wire',allowlistVersion:'al1:0123456789abcdef',target:team,receiptTarget:caller,receivedAt:1})
const path=()=>join(mkdtempSync(join(tmpdir(),'gh275-')),'tasks.json')
describe('#275 forwarded ledger migration',()=>{
 it('birth and restore use identical row-bound auth filtering for both owed and receiptless rows',()=>{
  const cases:Array<{a:TaskAuthorization;sender?:Sender;valid:boolean}>=[{a:auth,sender:{kind:'cli',id:caller},valid:true},{a:auth,valid:false},{a:auth,sender:{kind:'cli',id:'other/1111222233334444'},valid:false},{a:{...auth,target:'dsh/canvas/other'},sender:{kind:'cli',id:caller},valid:false},{a:{...auth,receipt_target:'other/1111222233334444'},sender:{kind:'cli',id:caller},valid:false},{a:{...auth,claim:undefined},sender:{kind:'cli',id:caller},valid:false},{a:{...auth,allowlist_version:'bad'},sender:{kind:'cli',id:caller},valid:false}]
  for(const receiptless of [false,true])for(const c of cases){
   const file=path(),ledger=new TaskLedger(file)
   ledger[receiptless?'trackReceiptless':'track']('row',team,'http://peer',undefined,undefined,c.sender,{forwarded:true,auth:c.a,peerKey:'key',receiverMembers:['dsh/11112222']})
   expect(ledger.find('row')!.auth!==undefined).toBe(c.valid)
   expect(new TaskLedger(file).find('row')!.auth).toEqual(ledger.find('row')!.auth)
  }
 })
 it('drops only bad member entries with warnings on birth and restore, keeping healthy frozen entries',()=>{
  const file=path(),warnings:string[]=[];const ledger=new TaskLedger(file,{warn:m=>warnings.push(m)})
  const members=['dsh/11112222','bad-secret-value','dsh/canvas/ops','dsh/33334444','dsh/11112222']
  ledger.track('mixed',team,'http://peer',undefined,undefined,{kind:'cli',id:caller},{forwarded:true,auth,peerKey:'key',receiverMembers:members})
  expect(ledger.find('mixed')!.receiverMembers).toEqual(['dsh/11112222','dsh/33334444']);expect(warnings).toHaveLength(2)
  expect(warnings.join(' ')).not.toContain('bad-secret-value')
  const snapshot=JSON.parse(readFileSync(file,'utf8'));snapshot.tasks[0].receiverMembers=members;writeFileSync(file,JSON.stringify(snapshot))
  const restoreWarnings:string[]=[];const restored=new TaskLedger(file,{warn:m=>restoreWarnings.push(m)})
  expect(restored.find('mixed')!.receiverMembers).toEqual(['dsh/11112222','dsh/33334444']);expect(restoreWarnings).toHaveLength(2)
  expect(Object.isFrozen(restored.find('mixed')!.receiverMembers)).toBe(true)
 })
 it('blocks unsafe old canvas debts including dead rows, but not known members, receiptless or archived rows',()=>{
  let now=1;const file=path(),ledger=new TaskLedger(file,{now:()=>now,staleTtlMs:10})
  ledger.track('old',team,'http://peer',undefined,undefined,undefined,{forwarded:true,deliveredTo:team})
  ledger.track('bad-target-with-snapshot',team,'http://peer',undefined,undefined,undefined,{forwarded:true,peerKey:'key',deliveredTo:team,receiverMembers:['dsh/11112222']})
  ledger.track('actual',team,'http://peer',undefined,undefined,undefined,{forwarded:true,deliveredTo:'dsh/11112222'})
  ledger.track('snapshot',team,'http://peer',undefined,undefined,undefined,{forwarded:true,peerKey:'key',receiverMembers:['dsh/11112222']})
  ledger.trackReceiptless('no-debt',team,'http://peer',undefined,undefined,undefined,{forwarded:true,deliveredTo:team})
  ledger.track('session','dsh/11112222','http://peer',undefined,undefined,undefined,{forwarded:true})
  expect(ledger.settlementEnforceBlockers()).toEqual(['bad-target-with-snapshot','old']);now=100
  const restored=new TaskLedger(file,{now:()=>now,staleTtlMs:10})
  expect(restored.settlementEnforceBlockers()).toEqual(['bad-target-with-snapshot','old']);expect(restored.find('old')!.status).toBe('dead')
  restored.resolveFromMessage('[A2A receipt] task old reconciled in observe')
  restored.resolveFromMessage('[A2A receipt] task bad-target-with-snapshot reconciled in observe')
  expect(restored.settlementEnforceBlockers()).toEqual([])
 })
})
