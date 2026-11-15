import {describe,it,expect,vi,afterEach} from 'vitest'
import {generateKeyPairSync,createPublicKey} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdtempSync} from '../temp-dirs.ts'
import {NarrowOutboundRecovery} from '../../src/superagent/host/narrow-outbound.ts'
import {OutboundRequests,type OutboundRecord} from '../../src/superagent/host/outbound.ts'
import {RequestRecoveryStore,signRecoveryProposal,recoveryDigest,type RecoveryBinding} from '../../src/request-recovery.ts'
const disk=vi.hoisted(()=>({fail:false}))
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,renameSync:(from:any,to:any)=>{if(disk.fail)throw Error('injected rename failure');fs.renameSync(from,to)}}})
afterEach(()=>{disk.fail=false;vi.restoreAllMocks()})
const key=()=>generateKeyPairSync('ed25519').privateKey,pub=(k:ReturnType<typeof key>)=>createPublicKey(k).export({format:'der',type:'spki'}).toString('base64')
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'narrow-original-')),file=join(dir,'outbound.json'),sender=key(),receiver=key(),cli=key(),at='2026-11-15T00:00:00.000Z',now=Date.parse(at)
 const old:OutboundRecord[]=['first','second'].map((suffix,i)=>({card:'card-'+suffix,ticketId:'original-ticket',address:'beta/aaaaaaaa',text:'exact original body',by:'original-proposer',at:new Date(now-2000+i).toISOString(),state:'failed',task:'direct-'+suffix,error:i?'remote scope refused':'not forwarded'}))
 writeFileSync(file,JSON.stringify(Object.fromEntries(old.map(r=>[r.card,r]))))
 let receiptAllowed=true,noteAllowed=true
 const notes=vi.fn(),narrowNotes=vi.fn(()=>noteAllowed),outbound=new OutboundRequests({path:file,ask:vi.fn(async()=>undefined),note:notes,narrowReceipt:()=>receiptAllowed,narrowNote:narrowNotes,logger:{warn:()=>{}},now:()=>at})
 let enabled=true,accepted=false,cliKey=pub(cli)
 const transport=vi.fn(async(_permit:unknown,mode:string,current:()=>boolean)=>{if(!current())throw Error('approval changed');if(mode==='send')accepted=true;return {accepted}})
 const identity=()=>enabled?{caller:'superagent-team/0123456789abcdef',cliKey,senderHome:'https://sender.test',senderKey:pub(sender)}:undefined
 const deps={outbound,approval:(r:Readonly<OutboundRecord>)=>enabled?{at,team:'original-team',message:'[original header]\n'+r.text,digest:recoveryDigest([r.card,r.task,r.text])}:undefined,identity,proposal:async(b:RecoveryBinding)=>signRecoveryProposal(b,sender),transport,now:()=>now}
 const recovery=new NarrowOutboundRecovery(deps),store=new RequestRecoveryStore(join(dir,'consent.json'),()=>now),receiverInfo={home:'https://receiver.test',key:pub(receiver),session:'session-aaaaaaaa11112222'}
 const prepare=()=>recovery.prepare('card-first','direct-first',receiverInfo,'sender owner checked original attempts and unchanged identity')
 const permit=async()=>store.grant(await prepare(),receiver,'owner checked original attempts were not admitted and fenced old chain',true)
 return{dir,file,old,outbound,notes,narrowNotes,recovery,deps,store,transport,prepare,permit,receiverInfo,denyReceipt:()=>{receiptAllowed=false},allowNotes:(v:boolean)=>{noteAllowed=v},disable:()=>{enabled=false},rekey:()=>{cliKey=pub(key())},setAccepted:(v:boolean)=>{accepted=v},reopen:()=>new NarrowOutboundRecovery({...deps,outbound:new OutboundRequests({path:file,ask:vi.fn(async()=>undefined),note:notes,logger:{warn:()=>{}},now:()=>at})})}
}
describe('legacy original-card narrow continuation',()=>{
 it('a trusted settled result reaches the original ticket once without changing either legacy failure',async()=>{
  const f=fixture(),p=await f.permit();await f.recovery.run('card-first','direct-first',p,true)
  const task=p.proposal.binding.taskId,trigger={id:'formal-result',source:'a2a',actor:{source:'a2a',id:p.proposal.binding.target},text:'[A2A receipt] task '+task+' original result\n'+JSON.stringify({outcome:'completed',disposition:'result'}),at:'2026-11-15T00:01:00Z',meta:{receiptFor:task,proof:'origin-claim'}} as any
  f.outbound.received(trigger);f.outbound.received(trigger)
  expect(f.narrowNotes).toHaveBeenCalledTimes(1);expect(f.narrowNotes.mock.calls[0]![0]).toBe('original-ticket')
  for(const r of f.outbound.list()){expect(r).toMatchObject({state:'failed',task:f.old.find(x=>x.card===r.card)!.task,narrowRecovery:{phase:'answered',noted:true}});expect(r.answer).toBeUndefined()}
  expect(await f.recovery.run('card-second','direct-second',p,true)).toMatchObject({ok:true,state:'answered'});expect(f.transport.mock.calls.filter(c=>c[1]==='send')).toHaveLength(1)
 })
 it('ACK/progress, wrong actor and missing settlement witness never complete recovery business',async()=>{
  const f=fixture(),p=await f.permit();await f.recovery.run('card-first','direct-first',p,true);const task=p.proposal.binding.taskId
  const trigger={id:'reply',source:'a2a',actor:{source:'a2a',id:p.proposal.binding.target},at:'2026-11-15T00:01:00Z',meta:{receiptFor:task,proof:'origin-claim'}}
  for(const disposition of ['acknowledged','progress'])f.outbound.received({...trigger,text:'[A2A receipt] task '+task+' still working\n'+JSON.stringify({disposition})} as any)
  f.outbound.received({...trigger,actor:{source:'a2a',id:'other/aaaaaaaa'},text:'[A2A receipt] task '+task+' result'} as any)
  f.denyReceipt();f.outbound.received({...trigger,text:'[A2A receipt] task '+task+' result'} as any)
  expect(f.narrowNotes).not.toHaveBeenCalled();expect(f.outbound.list().every(r=>r.narrowRecovery!.phase==='accepted')).toBe(true)
 })
 it('a failed ticket note remains pending and the existing pass retries only that exact saved note',async()=>{
  const f=fixture(),p=await f.permit();await f.recovery.run('card-first','direct-first',p,true);f.allowNotes(false);const task=p.proposal.binding.taskId
  f.outbound.received({id:'result',source:'a2a',actor:{source:'a2a',id:p.proposal.binding.target},text:'[A2A receipt] task '+task+' original result',at:'2026-11-15T00:01:00Z',meta:{receiptFor:task,proof:'origin-claim'}} as any)
  expect(f.outbound.list().every(r=>r.narrowRecovery?.phase==='answered'&&!r.narrowRecovery.noted)).toBe(true)
  f.allowNotes(true);f.outbound.flushNarrowNotes();expect(f.outbound.list().every(r=>r.narrowRecovery?.noted===true)).toBe(true)
  const calls=f.narrowNotes.mock.calls.length;f.outbound.flushNarrowNotes();expect(f.narrowNotes.mock.calls).toHaveLength(calls)
 })
 it('blocks a duplicate proposal for the same business once a recovery chain exists',async()=>{
  const f=fixture();await f.prepare();expect(f.outbound.check('original-proposer',{ticket_id:'original-ticket',address:'beta/aaaaaaaa',text:'exact original body'},{role:'router',ticket:{open:true,title:'current title'},a2aOn:true,own:[]})).toMatchObject({ok:false,code:'outbound-recovery-fenced'})
 })

 it('prepares one exact chain for both original cards without changing legacy failure facts or sending',async()=>{const f=fixture(),p=await f.prepare();expect(p.binding.originalCards).toEqual(['card-first','card-second']);expect(p.binding.originalTasks).toEqual(['direct-first','direct-second']);expect(f.transport).not.toHaveBeenCalled();for(const r of f.outbound.list()){const {narrowRecovery,...legacy}=r;expect(legacy).toEqual(f.old.find(x=>x.card===r.card));expect(narrowRecovery?.phase).toBe('prepared')}expect(await f.recovery.prepare('card-second','direct-second',f.receiverInfo,'sender owner checked original attempts and unchanged identity')).toEqual(p)})
 it('sends once from the original chain; retry and restart can only query the same continuation',async()=>{const f=fixture(),p=await f.permit();const first=await f.recovery.run('card-first','direct-first',p,true);expect(first).toMatchObject({ok:true,state:'accepted',task:p.proposal.binding.taskId});expect((await f.recovery.run('card-second','direct-second',p,true)).task).toBe(first.task);expect((await f.reopen().run('card-first','direct-first',p,true)).task).toBe(first.task);expect(f.transport.mock.calls.filter(c=>c[1]==='send')).toHaveLength(1);for(const r of f.outbound.list())expect(r.state).toBe('failed')})
 it('a lost reply leaves dispatch evidence and never authorizes another POST',async()=>{const f=fixture(),p=await f.permit();f.transport.mockImplementation(async(_p,m)=>{if(m==='send')throw Error('reply lost');return {accepted:false}});expect(await f.recovery.run('card-first','direct-first',p,true)).toMatchObject({ok:false,state:'unknown'});expect(await f.reopen().run('card-second','direct-second',p,true)).toMatchObject({ok:false,state:'unknown'});expect(f.transport.mock.calls.map(c=>c[1])).toEqual(['send','query'])})
 it('query-only reconciliation never sends and accepts only explicit same-task evidence',async()=>{const f=fixture(),p=await f.permit();expect(await f.recovery.run('card-first','direct-first',p,false)).toMatchObject({ok:false,state:'unknown'});expect(f.transport.mock.calls.map(c=>c[1])).toEqual(['query']);f.setAccepted(true);expect(await f.recovery.run('card-first','direct-first',p,false)).toMatchObject({ok:true,state:'accepted'})})
 it('missing approval, changed identity, altered permit and stale original task all send nothing',async()=>{const f=fixture(),p=await f.permit();await expect(f.recovery.run('card-first','different',p,true)).rejects.toThrow();await expect(f.recovery.run('card-first','direct-first',{...p,expiresAt:p.expiresAt+1},true)).rejects.toThrow();f.rekey();await expect(f.recovery.run('card-first','direct-first',p,true)).rejects.toThrow();f.disable();await expect(f.prepare()).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled()})
 it('checkpoint write failure sends nothing and keeps all original bytes',async()=>{const f=fixture(),p=await f.permit(),before=readFileSync(f.file,'utf8');disk.fail=true;await expect(f.recovery.run('card-first','direct-first',p,true)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();expect(readFileSync(f.file,'utf8')).toBe(before)})
 it('concurrent instances cannot dispatch twice after the durable group CAS',async()=>{const f=fixture(),p=await f.permit(),other=f.reopen();const outcomes=await Promise.allSettled([f.recovery.run('card-first','direct-first',p,true),other.run('card-second','direct-second',p,true)]);expect(outcomes.some(x=>x.status==='fulfilled')).toBe(true);expect(f.transport.mock.calls.filter(c=>c[1]==='send')).toHaveLength(1)})
 it('different business on the same ticket is not included in the original chain',async()=>{const f=fixture();f.outbound.waiting('unrelated-card','original-ticket','beta/bbbbbbbb','other text','original-proposer');expect((await f.prepare()).binding.originalCards).toHaveLength(2)})
})
