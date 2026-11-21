// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readFileSync} from 'node:fs'
import {mkdtempSync,cleanupBeforeTempDirs} from '../temp-dirs.ts'
import {SuperagentHost} from '../../src/superagent/host/index.ts'
import {routeItem} from '../../src/superagent/host/tools.ts'
const R='session-a0000000aaaa1111',M='session-b1111111bbbb2222'
const drain=async()=>{for(let i=0;i<5;i++)await new Promise<void>(r=>setImmediate(r))}
async function fixture(mode:'held'|'instant'='held'){
 const home=mkdtempSync(join(tmpdir(),'assignment-idle-race-')),sent:string[]=[],warned:string[]=[]
 let release:((ok:boolean)=>void)|undefined,hold=true,quiet=true,instant=true,host:SuperagentHost
 const make=()=>new SuperagentHost({home,canvasTeam:()=>({local:[R,M],remote:[]}),logger:{info(){},warn(f,...v){warned.push(f+' '+v.map(String).join(' '))}},interval:()=>()=>{},memberTurn:()=>({quiet,text:'assignment turn ended'}),deliverToSession:(id,text)=>{
  if(id!==M)return true;sent.push(text)
  if(!text.startsWith('[superagent assignment]'))return true
  if(mode==='instant'&&instant){instant=false;host.memberClaimed(M);host.memberIdle(M);return true}
  if(mode==='held'&&hold){hold=false;return new Promise<boolean>(r=>{release=r})}
  return true
 }})
 host=make();cleanupBeforeTempDirs(()=>host.stop())
 expect(host.saveSettings({canvas:'fixture',router:R,maxConcurrent:1},()=>true)).toMatchObject({ok:true});host.start()
 const accept=(text:string)=>{const req=host.request(text) as {triggerId:string};const out=routeItem(host,{trigger_id:req.triggerId,kind:'accept',title:text,scope:'synthetic test',reason:'fixture'}) as {ok:boolean;ticket_id:string};expect(out.ok).toBe(true);return out.ticket_id}
 const first=accept('first'),second=accept('second')
 await vi.waitFor(()=>expect(sent.filter(s=>s.startsWith('[superagent assignment]'))).not.toHaveLength(0))
 return{home,sent,warned,first,second,get host(){return host},release:(ok:boolean)=>{expect(release).toBeDefined();release!(ok)},idle:(claim=true)=>{if(claim)host.memberClaimed(M);host.memberIdle(M)},setQuiet:(v:boolean)=>{quiet=v},restart:async()=>{await host.stop();host=make();cleanupBeforeTempDirs(()=>host.stop());host.start();await drain()},disk:()=>JSON.parse(readFileSync(join(home,'superagent','executor.json'),'utf8'))}
}
describe('#751 assignment-card versus turn end',()=>{
 it('a claimed quiet turn ending inside synchronous card delivery is settled after acceptance',async()=>{
  const f=await fixture('instant');await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.report).toMatchObject({state:'waiting',summary:'assignment turn ended'})
  expect(f.host.ticket(f.first)?.ended).toBeUndefined();expect(f.sent.filter(s=>s.startsWith('[superagent assignment]'))).toHaveLength(2)
 })
 it('a quiet claimed idle during a held card is kept but never settles before the card answer',async()=>{
  const f=await fixture();f.idle();await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.report).toBeUndefined()
  f.release(true);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.idleAt).toBeDefined()
  expect(f.sent.filter(s=>s.startsWith('[superagent assignment]'))).toHaveLength(2)
 })
 it('an unrelated idle without a claim after the send boundary is not replayed onto the new assignment',async()=>{
  const f=await fixture();f.idle(false);f.release(true);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.report).toBeUndefined()
  f.idle();await drain();expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
 })
 it('a newer claim supersedes an earlier quiet idle while the card answer is pending',async()=>{
  const f=await fixture();f.idle();f.host.memberClaimed(M);f.release(true);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.report).toBeUndefined()
  f.idle();await drain();expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
 })
 it('a refused card releases the tentative binding without starting or reporting that assignment',async()=>{
  const f=await fixture();f.idle();f.release(false);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).not.toBe(f.first)
  const a=f.host.ticket(f.first)?.assignments.at(-1)
  expect(a?.state).toBe('pending');expect(a?.startedAt).toBeUndefined();expect(a?.report).toBeUndefined()
  expect(f.disk().bindings.some((b:any)=>b.ticketId===f.first)).toBe(false)
 })
 it('a stop while the member runs background work does not credit the stop turn to the next assignment',async()=>{
  // Review of #755: stop() must not free a member whose background jobs still run. Otherwise the next ticket is handed out
  // at once and the quiet end of the stop-notice turn is recorded on it, settling it before the member has read its card.
  const f=await fixture();f.release(true);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  f.setQuiet(false);f.idle();await drain()
  f.host.engine.stopTicket(f.first,'owner stopped');await drain()
  expect(f.host.ticket(f.first)?.ended).toBeDefined()
  expect(f.host.executor.bindingOf(M)?.ticketId).not.toBe(f.second)
  f.setQuiet(true);f.idle();await drain()
  const next=f.host.ticket(f.second)?.assignments.at(-1)
  expect(next?.report).toBeUndefined();expect(next?.idleAt).toBeUndefined()
 })
 it('a stop during the card send is not undone by its late accepted answer',async()=>{
  const f=await fixture();f.host.engine.stopTicket(f.first,'owner stopped');f.release(true);await drain()
  expect(f.host.ticket(f.first)?.ended).toBeDefined()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
  expect(f.disk().bindings.some((b:any)=>b.ticketId===f.first)).toBe(false)
 })
 it('a member can report ready before the card answer and that terminal result is not resurrected',async()=>{
  const f=await fixture();f.host.memberClaimed(M)
  expect(f.host.report(M,{state:'ready',summary:'completed while card reply pending'},f.first)).toMatchObject({ok:true})
  f.release(true);await drain()
  expect(f.host.ticket(f.first)?.ended?.outcome).toBe('completed')
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
  expect(f.disk().bindings.some((b:any)=>b.ticketId===f.first)).toBe(false)
 })
 it('a member waiting report and idle during the card send park the same assignment after acceptance',async()=>{
  const f=await fixture();const original=f.host.ticket(f.first)!.assignments.at(-1)!.id
  f.host.memberClaimed(M)
  expect(f.host.report(M,{state:'waiting',summary:'needs input',question:'which format?'},f.first)).toMatchObject({ok:true})
  f.idle(false);f.release(true);await drain()
  expect(f.host.ticket(f.first)?.assignments.at(-1)).toMatchObject({id:original,report:{state:'waiting',summary:'needs input'}})
  expect(f.host.ticket(f.first)?.ended).toBeUndefined()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
 })
 it('reassignment is refused while the original card result is unresolved',async()=>{
  const f=await fixture()
  expect(f.host.assignTicket(f.first,M)).toMatchObject({ok:false,code:'assignment-in-flight'})
  expect(f.sent.filter(s=>s.startsWith('[superagent assignment]'))).toHaveLength(1)
  f.release(true);await drain()
 })
 it('a claimed nonquiet turn during the card send stays bound until a later quiet idle',async()=>{
  const f=await fixture();f.setQuiet(false);f.idle();f.release(true);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.idleAt).toBeDefined()
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.report).toBeUndefined()
  f.setQuiet(true);f.idle();await drain();expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.second)
 })
 it('a restart during an unconfirmed card send holds the original and never automatically resends it',async()=>{
  const f=await fixture();const assignment=f.host.ticket(f.first)!.assignments.at(-1)!.id
  await f.restart()
  expect(f.sent.filter(s=>s.startsWith('[superagent assignment]')&&s.includes('ticket '+f.first+' '))).toHaveLength(1)
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  expect(f.host.ticket(f.first)?.assignments.at(-1)).toMatchObject({id:assignment,report:{state:'failed',summary:expect.stringContaining('unknown')}})
  f.release(true);await drain()
  expect(f.host.executor.bindingOf(M)?.ticketId).toBe(f.first)
  expect(f.sent.filter(s=>s.startsWith('[superagent assignment]'))).toHaveLength(1)
  await f.restart();expect(f.sent.filter(s=>s.startsWith('[superagent assignment]'))).toHaveLength(1)
 })
 it('a real waiting question before a restart is preserved instead of overwritten by transport uncertainty',async()=>{
  const f=await fixture();f.host.memberClaimed(M)
  expect(f.host.report(M,{state:'waiting',summary:'real member question',question:'which original format?'},f.first)).toMatchObject({ok:true})
  await f.restart()
  expect(f.host.ticket(f.first)?.assignments.at(-1)?.report).toMatchObject({state:'waiting',summary:'real member question'})
  expect(f.host.ticket(f.first)?.attention?.question).toBe('which original format?')
  expect(f.host.executor.bindingOf(M)?.card).toBe('unknown')
  expect(f.sent.filter(s=>s.startsWith('[superagent assignment]'))).toHaveLength(1)
  f.release(true);await drain()
 })
 it('an explicitly reconciled retry clears a restored unknown hold and starts a new assignment once',async()=>{
  const f=await fixture();const original=f.host.ticket(f.first)!.assignments.at(-1)!.id
  await f.restart()
  expect(f.host.assignTicket(f.first,M)).toMatchObject({ok:true})
  await drain()
  // The pre-existing second ticket has queue precedence; the explicit retry must not steal its slot.
  if(f.host.executor.bindingOf(M)?.ticketId===f.second){f.idle();await drain()}
  const current=f.host.ticket(f.first)!.assignments.at(-1)!
  expect(current.id).not.toBe(original)
  expect(f.sent.filter(s=>s.startsWith('[superagent assignment]')&&s.includes('ticket '+f.first+' '))).toHaveLength(2)
  expect(f.host.executor.list().filter(b=>b.ticketId===f.first)).toHaveLength(1)
  f.release(true);await drain()
  expect(f.host.ticket(f.first)!.assignments.at(-1)!.id).toBe(current.id)
 })
})
