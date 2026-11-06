import { describe,it,expect,vi,afterEach } from 'vitest'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode,reservePort,tmpHome,runContext,type MeshNode } from './harness.ts'
import { REMINDER_MIN_MS,REMINDER_LONG_MS } from '../../src/reconciliation-state.ts'
const denied=vi.hoisted(()=>({prefix:'',count:0}))
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,openSync:(path:any,...args:any[])=>{if(denied.count>0&&String(path).startsWith(denied.prefix)){denied.count--;throw Object.assign(Error('read only reminder ledger'),{code:'EACCES'})}return (fs.openSync as any)(path,...args)}}})
afterEach(()=>{denied.count=0;denied.prefix='';vi.restoreAllMocks()})
const state=(n:MeshNode)=>fetch(n.baseUrl+'/__dsh_a2a/state').then(r=>r.json())
const post=(n:MeshNode,path:string,body:unknown)=>fetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
const reminders=(n:MeshNode)=>n.steered.filter((p:any)=>p.content?.[0]?.text?.startsWith('[A2A reconciliation reminder]')) as any[]
const idle=async(n:MeshNode)=>{(n.agents.agent as any).status='idle';n.ctx.emit('agent/status',{agent:n.agents.agent!,status:'idle'});await vi.waitFor(async()=>expect((await state(n)).reconciliationReminders.lastCheckedAt).toBeGreaterThan(0))}
async function fixture(){const p=await reservePort();const n=await bootNode({name:'reminder',session:'reminder',team:'beta',port:p,silent:true,sessionNodes:true,teamScopeRouting:false,flushTimeoutMs:500,asyncNudgeDelayMs:86400000,taskStaleTtlMs:7*86400000});await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)});return n}
async function deliver(n:MeshNode,id:string,message='original work brief'){const r=await post(n,'/a2a/direct',{team:'beta/01234567',caller_session:'alpha/aaaaaaaa',callback:'alpha/aaaaaaaa',message,task_id:id,wait:false});expect(r.delivered,JSON.stringify(r)).toBe(true)}
describe('#351 real HTTP persistent idle reminders',()=>{
 it('a real cross-host task is reminded only on the receiver; a genuine formal receipt ends it on both hosts',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'meshSender',session:'meshSender',team:'alpha',port:pa,peers:[bu],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  const b=await bootNode({name:'meshReceiver',session:'meshReceiver',team:'beta',port:pb,peers:[au],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  try{
   for(const n of [a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
   ;(a.agents.agent as any).status='idle';(b.agents.agent as any).status='running'
   const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'original cross-host brief',async:true},runContext(a.agents.agent)) as any;expect(sent.ok,JSON.stringify(sent)).toBe(true)
   await idle(a);expect(reminders(a)).toHaveLength(0);await idle(b);await vi.waitFor(()=>expect(reminders(b)).toHaveLength(1));expect(reminders(b)[0].content[0].text).toContain(sent.task_id)
   const before=await state(a);expect(before.tasks[0].taskId).toBe(sent.task_id)
   const paid=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:'[A2A receipt] task '+sent.task_id+' completed by actual session',async:true},runContext(b.agents.agent)) as any;expect(paid.ok,JSON.stringify(paid)).toBe(true)
   expect((await state(a)).archived.some((r:any)=>r.taskId===sent.task_id)).toBe(true);expect((await state(b)).tasks).toHaveLength(0)
   await idle(b);expect(reminders(b)).toHaveLength(1)
  }finally{await a.dispose();await b.dispose()}
 })

 it('same-host sender receives one sourced warning only while idle; the target still owes and long reminders continue',async()=>{
  const n=await fixture(),targetId='session-bbbbbbbb33334444',captured:any[]=[],target={id:targetId,session:{events:[]},status:'running',steer:(p:any)=>captured.push(p)} as any
  const first=n.agents.agent!,service=n.agents as any;service.roots=()=>[first,target];service.get=(id:unknown)=>String(id)===String(first.id)?first:String(id)===targetId?target:undefined
  n.ctx.emit('agent/created',{agent:target});await post(n,'/__dsh_a2a/join',{id:targetId});
  for(const id of [String(first.id),targetId])expect((await post(n,'/__dsh_a2a/canvas',{action:'add-member',name:'shared',id})).ok).toBe(true)
  ;(first as any).status='running'
  let t=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>t)
  try{
   const route=await n.ctx.tools.get('a2a_route')!.execute({team:'beta/bbbbbbbb',message:'same host work',async:true},runContext(first)) as any;expect(route.ok,JSON.stringify(route)).toBe(true)
   target.status='idle';const tick=async()=>{n.ctx.emit('agent/status',{agent:target,status:'idle'});await new Promise(r=>setImmediate(r));await state(n)}
   await tick();t+=REMINDER_MIN_MS;await tick();t+=600000;await tick();expect(captured.filter(p=>p.content[0].text.startsWith('[A2A reconciliation reminder]'))).toHaveLength(3)
   t+=1800000;await tick();expect(n.steered).toHaveLength(0)
   ;(first as any).status='idle';await tick();expect(n.steered).toHaveLength(1);expect((n.steered[0] as any).source.kind).toBe('a2a-relay');expect((n.steered[0] as any).content[0].text).toContain('[A2A reconciliation notice]')
   await tick();expect(n.steered).toHaveLength(1);const s=await state(n);expect(s.tasks).toHaveLength(1);expect(s.tasks[0].answeredAt).toBeUndefined();expect(s.tasks[0].repeatedlyUnreconciled).toBe(true)
   t+=REMINDER_LONG_MS;await tick();expect(captured.filter(p=>p.content[0].text.startsWith('[A2A reconciliation reminder]'))).toHaveLength(4);expect(n.steered).toHaveLength(1)
  }finally{clock.mockRestore();await n.dispose()}
 })

 it('boot alone reads persisted debt and due time without waking a cold session or repeating before its deadline',async()=>{
  const home=tmpHome(),id='session-0123456789abcdef',at=Date.now();mkdirSync(join(home,'a2a'),{recursive:true})
  writeFileSync(join(home,'a2a/tasks.json'),JSON.stringify({tasks:[{taskId:'boot-debt',team:'beta/01234567',peer:'local:alpha/aaaaaaaa',direction:'inbound',receiverSessionId:id,startedAt:at,status:'pending',brief:'persisted sender brief'}]}))
  let n=await bootNode({name:'boot',session:'boot',team:'beta',home,sessionNodes:true,silent:true,initialStatus:'idle',asyncNudgeDelayMs:86400000})
  try{
   await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1));expect((await state(n)).tasks[0].reminderAttempts).toBe(1)
   await n.dispose();n=await bootNode({name:'boot2',session:'boot',team:'beta',home,sessionNodes:true,silent:true,initialStatus:'idle',asyncNudgeDelayMs:86400000})
   await state(n);expect(reminders(n)).toHaveLength(0);expect((await state(n)).tasks[0].reminderAttempts).toBe(1)
  }finally{await n.dispose()}
 })
 it('the low-frequency plugin timer observes idle without any status event and stop disposes it',async()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval']})
  const n=await fixture()
  try{await deliver(n,'timer-debt');(n.agents.agent as any).status='idle';await vi.advanceTimersByTimeAsync(60_000);expect(reminders(n)).toHaveLength(1);await n.dispose();await vi.advanceTimersByTimeAsync(120_000);expect(reminders(n)).toHaveLength(1)}finally{await n.dispose();vi.useRealTimers()}
 })
 for(const end of ['receipt','expired'])it('stops on '+end+' without modifying receipt or expiry rules',async()=>{
  const n=await fixture();let t=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>t)
  try{
   await deliver(n,'end-'+end);await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1))
   if(end==='receipt'){const r=await post(n,'/a2a/direct',{team:'beta/01234567',caller_session:'alpha/aaaaaaaa',task_id:'formal-terminal',message:'[A2A receipt] task end-receipt completed by session',wait:false});expect(r.delivered).toBe(true)}
   else t+=8*86400000
   await idle(n);expect(reminders(n)).toHaveLength(1);expect((await state(n)).tasks).toHaveLength(0)
  }finally{clock.mockRestore();await n.dispose()}
 })

 it('idle injects one sourced merged reminder without acknowledging or releasing capacity; busy never injects or counts',async()=>{
  const n=await fixture();try{
   (n.agents.agent as any).status='running';await deliver(n,'remind-1','sender original "quoted" '+ 'x'.repeat(200));await deliver(n,'remind-2')
   n.ctx.emit('agent/status',{agent:n.agents.agent!,status:'idle'});await new Promise(r=>setImmediate(r))
   expect(reminders(n)).toHaveLength(0);expect((await state(n)).tasks.every((r:any)=>r.reminderAttempts===undefined)).toBe(true)
   const before=(await state(n)).conservation;await idle(n)
   await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1));const p=reminders(n)[0]
   expect(p.source).toMatchObject({kind:'a2a-relay',form:'relay'});expect(p.content[0].text).toContain('task remind-1');expect(p.content[0].text).toContain('task remind-2');expect(p.content[0].text).toContain('alpha/aaaaaaaa');expect(p.content[0].text).not.toContain('x'.repeat(161))
   const s=await state(n);expect(s.tasks).toHaveLength(2);expect(s.tasks.every((r:any)=>r.reminderAttempts===1&&r.reminderDelivered===1&&r.answeredAt===undefined)).toBe(true);expect(s.conservation).toEqual(before);expect(s.archived).toHaveLength(0)
   const raw=JSON.parse(readFileSync(join(n.home,'a2a/tasks.json'),'utf8'));expect(raw.reconciliationReminders['remind-1'].attempts).toBe(1);expect(raw.tasks[0].receiverSessionId).toBe(String(n.agents.agent!.id))
   await idle(n);expect(reminders(n)).toHaveLength(1)
   await deliver(n,'remind-3');const refused=await post(n,'/a2a/direct',{team:'beta/01234567',caller_session:'alpha/aaaaaaaa',task_id:'remind-4',message:'over cap',wait:false});expect(refused.reason).toBe('target-queue-full')
  }finally{await n.dispose()}
 })
 it('three attempts become two-hour reminders rather than exhaustion; busy and restart never reset or spend counters',async()=>{
  let n=await fixture();const home=n.home;let t=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>t)
  try{
   await deliver(n,'long-lived');await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1))
   t+=REMINDER_MIN_MS;await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(2))
   t+=10*60_000;await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(3))
   t+=REMINDER_LONG_MS-1;await idle(n);expect(reminders(n)).toHaveLength(3)
   t++;(n.agents.agent as any).status='running';n.ctx.emit('agent/status',{agent:n.agents.agent!,status:'idle'});await new Promise(r=>setImmediate(r));expect(reminders(n)).toHaveLength(3);expect((await state(n)).tasks[0].reminderAttempts).toBe(3)
   await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(4));expect((await state(n)).tasks[0].repeatedlyUnreconciled).toBe(true)
   await n.dispose();n=await bootNode({name:'restart',session:'reminder',team:'beta',home,silent:true,sessionNodes:true,teamScopeRouting:false,flushTimeoutMs:500,asyncNudgeDelayMs:86400000,taskStaleTtlMs:7*86400000});(n.agents.agent as any).status='idle'
   await idle(n);expect(reminders(n)).toHaveLength(0);expect((await state(n)).tasks[0].reminderAttempts).toBe(4)
   t+=REMINDER_LONG_MS;await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1));expect((await state(n)).tasks[0].reminderAttempts).toBe(5)
  }finally{clock.mockRestore();await n.dispose()}
 })
 for(const terminal of ['cancel','abandon'] as const)it('stops reminders after explicit '+terminal+' without changing terminal semantics',async()=>{
  const n=await fixture();let t=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>t)
  try{await deliver(n,'terminal-'+terminal);await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1));const result=await post(n,'/__dsh_a2a/tasks/'+terminal,{task_id:'terminal-'+terminal});expect(result.outcome).toBe('cleared');t+=REMINDER_LONG_MS;await idle(n);expect(reminders(n)).toHaveLength(1);expect((await state(n)).tasks).toHaveLength(0)}finally{clock.mockRestore();await n.dispose()}
 })
 it('reserve write error inside idle is caught, observable and never sends; repaired disk permits a later attempt',async()=>{
  const n=await fixture();let t=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>t)
  try{await deliver(n,'reserve-error');denied.prefix=join(n.home,'a2a/tasks.json')+'.';denied.count=1;(n.agents.agent as any).status='idle';expect(()=>n.ctx.emit('agent/status',{agent:n.agents.agent!,status:'idle'})).not.toThrow();await vi.waitFor(async()=>expect((await state(n)).ledgerPersistence.lastError.code).toBe('EACCES'));expect(reminders(n)).toHaveLength(0);expect((await state(n)).tasks[0].reminderAttempts).toBeUndefined();t+=REMINDER_MIN_MS;await idle(n);await vi.waitFor(()=>expect(reminders(n)).toHaveLength(1))}finally{denied.count=0;clock.mockRestore();await n.dispose()}
 })
})
