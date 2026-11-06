import { describe,it,expect,vi,afterEach } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync,writeFileSync } from 'node:fs'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TaskLedger } from '../../src/task-ledger.ts'
import { FollowupDelivery } from '../../src/followup-delivery.ts'
const fault=vi.hoisted(()=>({fail:false}))
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,renameSync:(...args:Parameters<typeof fs.renameSync>)=>{if(fault.fail)throw Object.assign(Error('disk full'),{code:'ENOSPC'});return fs.renameSync(...args)}}})
afterEach(()=>{fault.fail=false;vi.restoreAllMocks()})
function setup(){const file=join(mkdtempSync(join(tmpdir(),'followup-delivery-')),'tasks.json'),ledger=new TaskLedger(file),followup=vi.fn(),steer=vi.fn(),agent={id:SessionId('session-aaaaaaaa11112222'),followup,steer} as unknown as Agent,taint=vi.fn(),warn=vi.fn(),dispatcher=new FollowupDelivery({ledger,taint,warn});return{file,ledger,followup,steer,agent,taint,warn,dispatcher}}
describe('#356 persistent sourced followup admission',()=>{
 it('task-purpose orphan correspondence survives restore and refuses replay without inventing task state',()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'work',undefined,undefined,'orphan',undefined,true)
  const restored=new TaskLedger(f.file),d=new FollowupDelivery({ledger:restored,taint:vi.fn(),warn:vi.fn()})
  expect(restored.deliveryBookkeepingState().orphaned).toBe(1);expect(restored.list()).toEqual([]);expect(restored.archive()).toEqual([])
  expect(()=>d.deliver(f.agent,'work',undefined,undefined,'orphan',undefined,true)).toThrow('receiver bookkeeping failed');expect(f.followup).toHaveBeenCalledOnce()
  restored.trackInbound('orphan','alpha/aaaaaaaa','beta/bbbbbbbb');expect(restored.deliveryBookkeepingState().orphaned).toBe(0)
 })
 it('receipt-only and old purpose-unknown correspondence is never inferred to be a missing task birth',()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'receipt',undefined,undefined,'receipt',undefined,false)
  expect(new TaskLedger(f.file).deliveryBookkeepingState().orphaned).toBe(0);expect(f.ledger.list()).toEqual([])
 })

 for(const result of ['removed','claimed-steered','withdraw-failed-steered','no-agent'] as const)it('cancellation audit result '+result+' survives disk restart without changing terminal bookkeeping',()=>{
  const f=setup();f.ledger.track('cancel-audit','alpha/aaaaaaaa','local');f.ledger.cancel('cancel-audit');const counters=f.ledger.conservation()
  f.ledger.recordWithdrawalResult('cancel-audit',result);const restored=new TaskLedger(f.file)
  expect(restored.archive()[0]).toMatchObject({taskId:'cancel-audit',endedBy:'cancelled',withdrawalResult:result});expect(restored.list()).toEqual([]);expect(restored.conservation()).toEqual(counters)
 })
 it('failed withdrawal audit commit never restores cancelled debt or advertises a result that was not persisted',()=>{
  const f=setup();f.ledger.track('cancel-audit-fail','alpha/aaaaaaaa','local');f.ledger.cancel('cancel-audit-fail');const bytes=readFileSync(f.file)
  fault.fail=true;expect(()=>f.ledger.recordWithdrawalResult('cancel-audit-fail','withdraw-failed-steered')).toThrow('disk full')
  expect(f.ledger.archive()[0].withdrawalResult).toBeUndefined();expect(f.ledger.list()).toEqual([]);expect(readFileSync(f.file)).toEqual(bytes)
 })

 it('outbound peer observation and inbound claim both survive disk restart without releasing receipt debt',()=>{
  const f=setup();f.ledger.track('peer-snapshot','beta/bbbbbbbb','http://beta',undefined,'text',{kind:'session',id:'alpha/aaaaaaaa'},{consumed:false});f.ledger.trackInbound('local-snapshot','alpha/aaaaaaaa','beta/bbbbbbbb',undefined,true,'text',undefined,undefined,String(f.agent.id),false)
  let restored=new TaskLedger(f.file);expect(restored.find('peer-snapshot')?.consumed).toBe(false);expect(restored.find('local-snapshot')?.consumed).toBe(false)
  restored.markConsumed('local-snapshot',true);restored=new TaskLedger(f.file);expect(restored.find('local-snapshot')?.consumed).toBe(true);expect(restored.list()).toHaveLength(2);expect(restored.archive()).toEqual([]);expect(restored.conservation().conserved).toBe(true)
 })

 it('pending withdrawal lets the controller resolve a cold session by its persisted full id',async()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'text',undefined,undefined,'cold-remove');const updateQueue=vi.fn(async()=>({accepted:true}));expect(await f.dispatcher.withdraw('cold-remove',{updateQueue},()=>undefined)).toBe('removed');expect(updateQueue.mock.calls[0]![0].sessionId).toBe(f.agent.id)
 })

 it('claim and consumed commit atomically, roll back together on write failure, and stay safe to retry',()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'text',undefined,undefined,'claimed-write');f.ledger.trackInbound('claimed-write','alpha/aaaaaaaa','beta/bbbbbbbb',undefined,true,undefined,undefined,undefined,String(f.agent.id),false)
  const bytes=readFileSync(f.file);fault.fail=true;expect(()=>f.dispatcher.claimed(f.agent,f.ledger.deliveryFor('claimed-write')!.messageId)).not.toThrow()
  expect(readFileSync(f.file)).toEqual(bytes);expect(f.ledger.deliveryFor('claimed-write')!.state).toBe('enqueued');expect(f.ledger.find('claimed-write')!.consumed).toBe(false)
  fault.fail=false;f.dispatcher.claimed(f.agent,f.ledger.deliveryFor('claimed-write')!.messageId);const restored=new TaskLedger(f.file);expect(restored.deliveryFor('claimed-write')!.state).toBe('claimed');expect(restored.find('claimed-write')!.consumed).toBe(true)
 })
 it('a corrupted map refusal persists through other successful ledger writes and a second restart',()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'text',undefined,undefined,'badmap');const snapshot=JSON.parse(readFileSync(f.file,'utf8'));snapshot.taskDeliveries=[{bad:true}];writeFileSync(f.file,JSON.stringify(snapshot));const restored=new TaskLedger(f.file);restored.track('independent','other','local');expect(()=>new TaskLedger(f.file).deliveryFor('badmap')).toThrow('corrupt')
 })

 it('commits task/message correspondence before followup with exactly declared source shape and no steer',()=>{
  const f=setup();f.followup.mockImplementation(message=>{const rows=JSON.parse(readFileSync(f.file,'utf8')).taskDeliveries;expect(rows[0]).toMatchObject({taskId:'task-1',messageId:message.id,state:'reserved',sessionId:String(f.agent.id)})})
  f.dispatcher.deliver(f.agent,'task text','beta/bbbbbbbb','local-session','task-1')
  expect(f.followup).toHaveBeenCalledTimes(1);expect(f.steer).not.toHaveBeenCalled();expect(f.taint).toHaveBeenCalledWith(f.agent,'local-session')
  expect(f.followup.mock.calls[0]![0].source).toEqual({kind:'a2a-relay',form:'relay',senderSessionId:'beta/bbbbbbbb',localSender:'local-session',taskId:'task-1'})
  expect(f.ledger.deliveryFor('task-1')?.state).toBe('enqueued');expect(new TaskLedger(f.file).deliveryFor('task-1')).toEqual(f.ledger.deliveryFor('task-1'))
  f.dispatcher.deliver(f.agent,'task text','beta/bbbbbbbb','local-session','task-1');expect(f.followup).toHaveBeenCalledTimes(1)
  expect(()=>f.dispatcher.deliver(f.agent,'changed text','beta/bbbbbbbb','local-session','task-1')).toThrow('identity conflict')
 })
 it('cannot deliver without followup and never falls back to steer',()=>{
  const f=setup();Object.defineProperty(f.agent,'followup',{value:undefined});expect(()=>f.dispatcher.deliver(f.agent,'text',undefined,undefined,'missing')).toThrow('requires Agent.followup');expect(f.steer).not.toHaveBeenCalled();expect(f.ledger.deliveryFor('missing')).toBeUndefined()
 })
 it('failed atomic reservation leaves no correspondence and never submits to the Agent',()=>{
  const f=setup();fault.fail=true;expect(()=>f.dispatcher.deliver(f.agent,'text',undefined,undefined,'disk')).toThrow('disk full');expect(f.followup).not.toHaveBeenCalled();expect(f.steer).not.toHaveBeenCalled();expect(f.ledger.deliveryFor('disk')).toBeUndefined();expect(f.ledger.persistenceState()).toMatchObject({ok:false,lastError:{code:'ENOSPC'}})
 })
 it('a claim emitted reentrantly during admission cannot regress back to enqueued',()=>{
  const f=setup();f.followup.mockImplementation(message=>f.dispatcher.claimed(f.agent,message.id));f.dispatcher.deliver(f.agent,'text',undefined,undefined,'fast-claim');expect(f.ledger.deliveryFor('fast-claim')?.state).toBe('claimed')
 })
 it('uncertain admission is never blindly replayed after restart',()=>{
  const f=setup();f.followup.mockImplementation(()=>{throw Error('after-insert observer failure')});expect(()=>f.dispatcher.deliver(f.agent,'text',undefined,undefined,'uncertain')).toThrow();const restored=new TaskLedger(f.file),d=new FollowupDelivery({ledger:restored,taint:vi.fn(),warn:vi.fn()});expect(()=>d.deliver(f.agent,'text',undefined,undefined,'uncertain')).toThrow('接纳状态未知');expect(f.followup).toHaveBeenCalledTimes(1)
 })
 it('pending cancellation uses the exact persisted MessageId through updateQueue remove and does not steer',async()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'text',undefined,undefined,'pending');const row=f.ledger.deliveryFor('pending')!,updateQueue=vi.fn(async()=>({accepted:true}))
  expect(await f.dispatcher.withdraw('pending',{updateQueue},()=>f.agent)).toBe('removed');expect(updateQueue).toHaveBeenCalledWith({sessionId:f.agent.id,itemId:MessageId(row.messageId),action:{kind:'remove'}});expect(f.steer).not.toHaveBeenCalled();expect(new TaskLedger(f.file).deliveryFor('pending')?.state).toBe('cancelled')
 })
 it('a queue-item-not-found race is classified as claimed; other removal failures are not',async()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'text',undefined,undefined,'race');const updateQueue=vi.fn(async()=>{throw Object.assign(Error('claimed'),{code:'session/queue-item-not-found'})})
  expect(await f.dispatcher.withdraw('race',{updateQueue},()=>f.agent)).toBe('claimed');expect(f.ledger.deliveryFor('race')?.state).toBe('claimed')
  f.dispatcher.deliver(f.agent,'next',undefined,undefined,'failure');expect(await f.dispatcher.withdraw('race',undefined,()=>f.agent)).toBe('claimed');await expect(f.dispatcher.withdraw('failure',{updateQueue:async()=>{throw Object.assign(Error('denied'),{code:'gateway/permission-denied'})}},()=>f.agent)).rejects.toThrow('denied');expect(f.ledger.deliveryFor('failure')?.state).toBe('enqueued')
 })
 it('corrupt correspondence does not permit a fresh untracked delivery',()=>{
  const f=setup();f.dispatcher.deliver(f.agent,'text',undefined,undefined,'corrupt');const snapshot=JSON.parse(readFileSync(f.file,'utf8'));snapshot.taskDeliveries[0].messageId='';writeFileSync(f.file,JSON.stringify(snapshot));const d=new FollowupDelivery({ledger:new TaskLedger(f.file),taint:vi.fn(),warn:vi.fn()});expect(()=>d.deliver(f.agent,'text',undefined,undefined,'corrupt')).toThrow('corrupt');expect(f.followup).toHaveBeenCalledTimes(1)
 })
})
