import { describe,it,expect,vi } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync,writeFileSync } from 'node:fs'
import { TaskLedger } from '../../src/task-ledger.ts'
import { ReconciliationReminders } from '../../src/reconciliation-reminders.ts'
import { REMINDER_MIN_MS,REMINDER_LONG_MS } from '../../src/reconciliation-state.ts'
function fixture(){let now=1_000_000;const file=join(mkdtempSync(join(tmpdir(),'reminder-state-')),'tasks.json'),ledger=new TaskLedger(file,{now:()=>now,staleTtlMs:10*86400000}),target={id:'target',status:'idle'},sender={id:'sender',status:'idle'},steer=vi.fn(),warn=vi.fn();const controller=new ReconciliationReminders({ledger,agents:()=>[target,sender],resolve:()=>target,sender:row=>row.peer==='local'?sender:undefined,steer,now:()=>now,warn});ledger.track('job','beta/aaaaaaaa','local',undefined,'original', {kind:'session',id:'alpha/bbbbbbbb'});return{ledger,file,target,sender,steer,warn,controller,advance:(ms:number)=>{now+=ms}}}
describe('#351 observation-only persistence',()=>{
 it('sends one local sender warning after three reminders and continues long reminders, never when sender is busy',()=>{
  const f=fixture();f.controller.scan();f.advance(REMINDER_MIN_MS);f.controller.scan();f.advance(600000);f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(3)
  f.sender.status='running';f.advance(1800000);f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(3);expect(f.ledger.reminderState('job')!.noticeAttemptedAt).toBeUndefined()
  f.sender.status='idle';f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(4);expect(f.steer.mock.calls[3]![1]).toContain('[A2A reconciliation notice]');expect(f.ledger.reminderState('job')!.notifiedAt).toBeDefined()
  f.advance(REMINDER_LONG_MS);f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(5);expect(f.steer.mock.calls[4]![1]).toContain('[A2A reconciliation reminder]');expect(f.ledger.list()).toHaveLength(1);expect(f.ledger.archive()).toEqual([])
 })
 it('a reentrant idle scan cannot duplicate a reserved task and stop prevents further work',()=>{
  const f=fixture();f.steer.mockImplementation(()=>f.controller.scan());f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(1);expect(f.ledger.reminderState('job')?.attempts).toBe(1);f.advance(REMINDER_LONG_MS);f.controller.stop();f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(1)
 })
 it('busy-after-reserve restores the previous attempt and throttle without steering',()=>{
  const f=fixture(),original=f.ledger.saveReminders.bind(f.ledger);let first=true
  vi.spyOn(f.ledger,'saveReminders').mockImplementation((u,s)=>{original(u,s);if(first){first=false;f.target.status='running'}})
  f.controller.scan();expect(f.steer).not.toHaveBeenCalled();expect(f.ledger.reminderState('job')).toBeUndefined();expect(f.ledger.reminderSessionAt('target')).toBeUndefined()
  f.target.status='idle';f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(1);expect(f.ledger.reminderState('job')?.attempts).toBe(1)
 })
 it('malformed restored metadata blocks only reminder, preserves original debt and never resets attempts to spam',()=>{
  const f=fixture();f.controller.scan();const snapshot=JSON.parse(readFileSync(f.file,'utf8'));snapshot.reconciliationReminders.job.attempts='bad';writeFileSync(f.file,JSON.stringify(snapshot));const restored=new TaskLedger(f.file);const send=vi.fn();const c=new ReconciliationReminders({ledger:restored,agents:()=>[f.target],resolve:()=>f.target,sender:()=>undefined,steer:send,warn:vi.fn()});c.scan();expect(send).not.toHaveBeenCalled();expect(restored.list()).toHaveLength(1);expect(restored.reminderState('job')?.lastResult).toBe('blocked')
 })
 it('validation errors cannot mutate session throttles or preceding reminder entries',()=>{
  const f=fixture();f.controller.scan();const before=readFileSync(f.file,'utf8'),old=f.ledger.reminderState('job');expect(()=>f.ledger.saveReminders([{taskId:'job',state:{...old!,attempts:-1}}],{id:'target',at:99999})).toThrow('invalid reminder');expect(f.ledger.reminderState('job')).toEqual(old);expect(readFileSync(f.file,'utf8')).toBe(before)
 })
 it('a failed steer remains visible and reserves a future retry, not a successful reminder',()=>{
  const f=fixture();f.steer.mockImplementationOnce(()=>{throw Error('unavailable')});expect(()=>f.controller.scan()).not.toThrow();expect(f.ledger.reminderState('job')).toMatchObject({attempts:1,deliveredCount:0,lastResult:'failed'});expect(f.warn).toHaveBeenCalled();f.advance(REMINDER_MIN_MS);f.controller.scan();expect(f.ledger.reminderState('job')).toMatchObject({attempts:2,deliveredCount:1,lastResult:'delivered'})
 })
 it('the old target identity cannot be reassigned through a new resolver',()=>{
  const f=fixture();f.controller.scan();f.target.id='replacement';f.advance(REMINDER_LONG_MS);f.controller.scan();expect(f.steer).toHaveBeenCalledTimes(1)
 })
})
