// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtempSync,cleanupBeforeTempDirs} from '../temp-dirs.ts'
import {FollowupAcceptanceUnknown} from '../../src/followup-admission.ts'
import {SuperagentHost} from '../../src/superagent/host/index.ts'
import {routeItem} from '../../src/superagent/host/tools.ts'
const R='session-a0000000aaaa1111',M='session-b1111111bbbb2222'
const drain=async()=>{for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r))}
for(const failure of['unknown-after-insert','transport-error'] as const)it(`an uncertain card result holds the original rather than retrying: ${failure}`,async()=>{
 const home=mkdtempSync(join(tmpdir(),'assignment-unknown-')),cards:string[]=[]
 let host:SuperagentHost
 const make=()=>new SuperagentHost({home,canvasTeam:()=>({local:[R,M],remote:[]}),logger:{info(){},warn(){}},interval:()=>()=>{},deliverToSession:(id,text)=>{
  if(id!==M||!text.startsWith('[superagent assignment]'))return true
  cards.push(text)
  if(failure==='unknown-after-insert')throw new FollowupAcceptanceUnknown()
  throw Object.assign(Error('response lost'),{code:'ECONNRESET'})
 }})
 host=make();cleanupBeforeTempDirs(()=>host.stop())
 expect(host.saveSettings({canvas:'fixture',router:R,maxConcurrent:1},()=>true)).toMatchObject({ok:true});host.start()
 const req=host.request('original') as {triggerId:string},out=routeItem(host,{trigger_id:req.triggerId,kind:'accept',title:'original',scope:'fixture',reason:'test'}) as {ticket_id:string}
 await drain();expect(cards).toHaveLength(1)
 expect(host.executor.bindingOf(M)).toMatchObject({ticketId:out.ticket_id,card:'unknown'})
 expect(host.ticket(out.ticket_id)?.assignments.at(-1)?.report).toMatchObject({state:'failed',summary:expect.stringContaining('unknown')})
 host.executor.launch();host.executor.tick();await drain();expect(cards).toHaveLength(1)
 vi.useFakeTimers({toFake:['setTimeout']})
 try{host.memberFailed(M,Error('429 rate limit'));await vi.advanceTimersByTimeAsync(60000);expect(cards).toHaveLength(1)}finally{vi.useRealTimers()}
 await host.stop();host=make();cleanupBeforeTempDirs(()=>host.stop());host.start();await drain()
 expect(cards).toHaveLength(1);expect(host.executor.bindingOf(M)?.card).toBe('unknown')
})
