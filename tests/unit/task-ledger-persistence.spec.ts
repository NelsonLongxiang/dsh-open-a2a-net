import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
const fault=vi.hoisted(()=>({mode:'' as ''|'partial'|'rename'|'fsync',writes:[] as string[],renameCodes:[] as string[]}))
vi.mock('node:fs',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs')>()
 return {...actual,
  writeFileSync:(path:any,data:any,options:any)=>{
   if(typeof path==='number'&&fault.mode==='partial'){actual.writeFileSync(path,String(data).slice(0,11),options);throw Object.assign(Error('partial disk write'),{code:'ENOSPC'})}
   return actual.writeFileSync(path,data,options)
  },
  fsyncSync:(fd:number)=>{if(fault.mode==='fsync')throw Object.assign(Error('fsync failed'),{code:'EIO'});return actual.fsyncSync(fd)},
  renameSync:(from:any,to:any)=>{fault.writes.push(String(from));const code=fault.renameCodes.shift();if(code)throw Object.assign(Error('rename '+code),{code});if(fault.mode==='rename')throw Object.assign(Error('rename denied'),{code:'EACCES'});return actual.renameSync(from,to)},
 }
})
import { TaskLedger } from '../../src/task-ledger.ts'
const path=()=>join(mkdtempSync(join(tmpdir(),'ledger-atomic-')),'tasks.json')
beforeEach(()=>{fault.mode='';fault.writes=[];fault.renameCodes=[]})
afterEach(()=>{fault.mode='';vi.restoreAllMocks()})
describe('task ledger atomic commit errors',()=>{
 for(const code of ['EBUSY','EPERM'])it('retries two transient '+code+' renames with one temp file and commits',()=>{
  const file=path(),ledger=new TaskLedger(file),wait=vi.spyOn(Atomics,'wait').mockReturnValue('timed-out')
  fault.renameCodes=[code,code];ledger.track('retry-ok','dsh','local')
  expect(fault.writes).toHaveLength(3);expect(new Set(fault.writes).size).toBe(1)
  expect(wait.mock.calls.map(args=>args[3])).toEqual([2,4])
  expect(new TaskLedger(file).find('retry-ok')).toBeDefined();expect(ledger.persistenceState()).toEqual({ok:true})
  expect(readdirSync(join(file,'..'))).toEqual(['tasks.json'])
 })
 it('exhausted EBUSY retries throw, preserve committed bytes and rollback memory without leaking temp files',()=>{
  const file=path(),ledger=new TaskLedger(file);ledger.track('old','dsh','local');const bytes=readFileSync(file),counter=ledger.conservation()
  const wait=vi.spyOn(Atomics,'wait').mockReturnValue('timed-out');fault.writes=[];fault.renameCodes=['EBUSY','EBUSY','EBUSY','EBUSY']
  expect(()=>ledger.track('failed','dsh','local')).toThrow('rename EBUSY')
  expect(fault.writes).toHaveLength(3);expect(wait.mock.calls.map(args=>args[3])).toEqual([2,4]);expect(fault.renameCodes).toEqual(['EBUSY'])
  expect(readFileSync(file)).toEqual(bytes);expect(ledger.find('failed')).toBeUndefined();expect(ledger.conservation()).toEqual(counter)
  expect(ledger.persistenceState()).toMatchObject({ok:false,lastError:{code:'EBUSY'}});expect(readdirSync(join(file,'..'))).toEqual(['tasks.json'])
 })
 for(const code of ['EACCES','ENOSPC','ENOENT','EIO'])it('does not retry non-contention rename error '+code,()=>{
  const file=path(),ledger=new TaskLedger(file),wait=vi.spyOn(Atomics,'wait').mockReturnValue('timed-out');fault.renameCodes=[code,'EBUSY']
  expect(()=>ledger.track('no-retry','dsh','local')).toThrow('rename '+code)
  expect(fault.writes).toHaveLength(1);expect(wait).not.toHaveBeenCalled();expect(fault.renameCodes).toEqual(['EBUSY'])
  expect(ledger.find('no-retry')).toBeUndefined();expect(ledger.persistenceState()).toMatchObject({ok:false,lastError:{code}})
 })

 for(const mode of ['partial','rename','fsync'] as const)it('preserves committed disk, rows and counters on '+mode+' failure and allows retry',()=>{
  const file=path(),ledger=new TaskLedger(file),before=()=>readFileSync(file)
  ledger.track('first','dsh/aaaaaaaa','local');const bytes=before(),counter=ledger.conservation()
  fault.mode=mode
  expect(()=>ledger.track('second','dsh/bbbbbbbb','local')).toThrow()
  expect(before()).toEqual(bytes);expect(ledger.find('second')).toBeUndefined();expect(ledger.list().map(r=>r.taskId)).toEqual(['first']);expect(ledger.conservation()).toEqual(counter)
  expect(readdirSync(join(file,'..'))).toEqual(['tasks.json'])
  fault.mode='';ledger.track('second','dsh/bbbbbbbb','local')
  expect(new TaskLedger(file).find('second')).toBeDefined();expect(ledger.conservation().conserved).toBe(true)
 })
 it('a failed answer commit throws before caller send and never leaves answeredAt in memory or disk',()=>{
  const file=path(),ledger=new TaskLedger(file);ledger.trackInbound('read-task','dsh/canvas/ops','beta/bbbbbbbb',undefined,true,undefined,undefined,'dsh/aaaaaaaa')
  const bytes=readFileSync(file),send=vi.fn(),counters=ledger.conservation();fault.mode='rename'
  expect(()=>{ledger.markAnswered('read-task','dsh/aaaaaaaa');send()}).toThrow('rename denied')
  expect(send).not.toHaveBeenCalled();expect(ledger.persistenceState()).toMatchObject({ok:false,lastError:{code:'EACCES',at:expect.any(Number)}});expect(ledger.find('read-task')?.answeredAt).toBeUndefined();expect(readFileSync(file)).toEqual(bytes);expect(ledger.conservation()).toEqual(counters)
  fault.mode='';expect(ledger.markAnswered('read-task','dsh/aaaaaaaa')).toBe(true);expect(new TaskLedger(file).find('read-task')?.answeredAt).toBeTypeOf('number');expect(ledger.persistenceState()).toEqual({ok:true})
 })
 it('failed receipt settlement restores owed row, empty archive and conservation totals',()=>{
  const file=path(),ledger=new TaskLedger(file);ledger.track('owed','beta/bbbbbbbb','http://peer');const bytes=readFileSync(file),counters=ledger.conservation();fault.mode='partial'
  expect(()=>ledger.resolveFromMessage('[A2A receipt] task owed completed')).toThrow('partial disk write')
  expect(ledger.find('owed')?.status).toBe('pending');expect(ledger.archive()).toEqual([]);expect(ledger.conservation()).toEqual(counters);expect(readFileSync(file)).toEqual(bytes)
  fault.mode='';expect(ledger.resolveFromMessage('[A2A receipt] task owed completed')?.taskId).toBe('owed');expect(new TaskLedger(file).archive()[0]?.taskId).toBe('owed')
 })
 it('a missing writable parent never returns an in-memory successful registration',()=>{
  const file=path(),parent=join(file,'not-a-directory');writeFileSync(file,'blocker');const ledger=new TaskLedger(join(parent,'tasks.json'))
  expect(()=>ledger.track('never','dsh','local')).toThrow();expect(ledger.find('never')).toBeUndefined();expect(readFileSync(file,'utf8')).toBe('blocker');expect(ledger.conservation().trackedTotal).toBe(0)
 })
 it('writes mode0600 unique sibling temp files and never truncates the target in place',()=>{
  const file=path(),ledger=new TaskLedger(file);ledger.track('one','dsh','local');ledger.track('two','dsh','local')
  expect(fault.writes).toHaveLength(2);expect(new Set(fault.writes).size).toBe(2)
  for(const temp of fault.writes){expect(temp.startsWith(file+'.')).toBe(true);expect(temp.endsWith('.tmp')).toBe(true)}
  expect(readdirSync(join(file,'..'))).toEqual(['tasks.json']);expect(new TaskLedger(file).list()).toHaveLength(2)
 })
})
