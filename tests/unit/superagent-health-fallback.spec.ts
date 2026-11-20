// @vitest-environment node
/** R7a exceptional observer paths: retain each problem and use the ordinary owner card, never business replay. */
import {it,expect} from 'vitest'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtempSync,cleanupBeforeTempDirs} from '../temp-dirs.ts'
import {SuperagentHost} from '../../src/superagent/host/index.ts'
import {HealthReminders,HEALTH_TICK_MS,OBSERVER_SILENCE_MS,HOLD_OTHER_MS,healthToken,problemKey,type HealthProblem} from '../../src/superagent/host/health-reminders.ts'
const T0=1_800_000_000_000,one:HealthProblem={code:'ticket-quiet',ticketId:'one',minutes:70},two:HealthProblem={code:'ticket-quiet',ticketId:'two',minutes:75}
for(const failure of ['selection-throw','delivery-throw','delivery-false'] as const)it(`a ${failure} falls back per problem without aborting the rest of the tick`,()=>{
 const cards:Array<{key:string;text:string}>=[],notices:string[]=[]
 const r=new HealthReminders((text,key)=>{cards.push({key,text});return 'card-'+key},()=>{},()=>[],()=>new Date(T0).toISOString(),{
  pick:p=>{if(p.ticketId==='one'&&failure==='selection-throw')throw Error('role registry unavailable');return 'observer'},
  tell:(_id,text)=>{notices.push(text);if(text.includes(healthToken(problemKey(one)))){if(failure==='delivery-throw')throw Error('host followup unknown');if(failure==='delivery-false')return false}return true},
 })
 expect(()=>r.tick([one,two],T0)).not.toThrow()
 expect(cards).toHaveLength(1);expect(cards[0]!.key).toBe(problemKey(one));expect(cards[0]!.text).toContain('转交属主')
 expect(r.observerHolds()).toEqual([{key:problemKey(two),observer:'observer',since:T0}])
 r.tick([one,two],T0+OBSERVER_SILENCE_MS)
 expect(cards.filter(c=>c.key===problemKey(one))).toHaveLength(1)
 expect(cards.filter(c=>c.key===problemKey(two))).toHaveLength(1)
})
it('an observer acting during a successful delivery callback is not overwritten by a late reservation',()=>{
 const cards:string[]=[],notices:string[]=[]
 let r:HealthReminders
 r=new HealthReminders(text=>{cards.push(text);return 'card'},()=>{},()=>[],()=>new Date(T0).toISOString(),{pick:()=> 'observer',tell:(id,text)=>{notices.push(text);r.observerActed(id,'request '+healthToken(problemKey(one)),T0+1);return true}})
 r.tick([one],T0)
 expect(r.observerHolds()).toEqual([])
 r.tick([one],T0+HOLD_OTHER_MS)
 expect(notices).toHaveLength(1);expect(cards).toEqual([])
 r.tick([one],T0+HOLD_OTHER_MS+1)
 expect(notices).toHaveLength(2);expect(cards).toEqual([])
})
it('an unavailable owner-card writer does not leave a false delivered-to-observer hold',()=>{
 let ownerAvailable=false,attempts=0
 const cards:string[]=[]
 const r=new HealthReminders(text=>{attempts++;if(!ownerAvailable)return undefined;cards.push(text);return'card'},()=>{},()=>[],()=>new Date(T0).toISOString(),{pick:()=> 'observer',tell:()=>{throw Error('inbox unavailable')}})
 r.tick([one],T0);expect(r.observerHolds()).toEqual([]);expect(cards).toEqual([])
 ownerAvailable=true;r.tick([one],T0+HEALTH_TICK_MS)
 expect(attempts).toBe(2);expect(cards).toHaveLength(1);expect(r.observerHolds()).toEqual([])
})
it('the host health timer turns an observer followup exception into one owner card',()=>{
 let now=T0,tells=0
 const ticks:Array<()=>void>=[]
 const presets:Record<string,string>={router:'superagent-router',member:'superagent-member',observer:'superagent-observer'}
 const host=new SuperagentHost({home:mkdtempSync(join(tmpdir(),'health-fallback-host-')),canvasTeam:()=>({local:['router','member','observer'],remote:[]}),presetOf:id=>presets[id],sessionLoaded:id=>id!=='router',bootSettled:()=>true,now:()=>new Date(now).toISOString(),logger:{info(){},warn(){}},interval:(fn,ms)=>{if(ms===HEALTH_TICK_MS)ticks.push(fn);return()=>{}},deliverToSession:(id,text)=>{if(id==='observer'&&text.startsWith('[superagent health]')){tells++;throw Error('host inbox unavailable')}return true}})
 cleanupBeforeTempDirs(()=>host.stop())
 expect(host.saveSettings({canvas:'fixture',router:'router'},()=>true,id=>presets[id])).toMatchObject({ok:true});host.start()
 for(let i=0;i<2;i++){now+=HEALTH_TICK_MS;for(const tick of ticks)expect(tick).not.toThrow()}
 expect(tells).toBe(1)
 expect(host.decisionCards().filter(c=>c.source==='health'&&c.reason==='router-not-loaded:router')).toHaveLength(1)
})
