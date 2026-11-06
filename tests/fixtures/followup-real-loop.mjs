/** Real host loop exercise from an isolated plugin-owned process. Host modules are read-only. */
import {createRequire} from 'node:module'
import {resolve,dirname,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {TaskLedger} from '../../src/task-ledger.ts'
import {FollowupDelivery} from '../../src/followup-delivery.ts'
const host=resolve(process.argv[2])
const require=createRequire(resolve(host,'packages/core/agent-loop/package.json'))
const load=specifier=>import(pathToFileURL(require.resolve(specifier)).href)
const [{Context},llm,session,{default:SystemPrompt},{default:Tools},{default:Registry},{default:Loop},{default:Projections},Native]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-tool-executor-native'].map(load))
class Adapter extends llm.LlmAdapter {
 requests=[]
 resolveModel(provider,model){return Promise.resolve({provider,id:model,name:model})}
 async *stream(options){this.requests.push(options);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'done'};yield {type:'block-end',index:0,block:{type:'text',text:'done'}};yield {type:'finish',reason:{kind:'stop'}}}
}
const persistence=await import(pathToFileURL(resolve(host,'packages/session/session-persistence-jsonl/lib/index.js')).href)
const ctx=new Context(),adapter=new Adapter()
try{
 for(const plugin of [llm.default,session.default,Projections,SystemPrompt,Tools,Native,Registry])await ctx.plugin(plugin)
 await ctx.plugin(persistence,{root:join(dirname(process.argv[3]),'sessions')})
 await ctx.plugin(Loop,{agents:[]});ctx.llm.registerAdapter(['mock'],adapter)
 const agent=await ctx.agentLoop.create(session.SessionId('real-followup'),{provider:'mock',model:'mock'})
 const ledger=new TaskLedger(process.argv[3]),dispatcher=new FollowupDelivery({ledger,taint:()=>{},warn:code=>{throw Error(code)}})
 ctx.on('agent/inbox/claimed',({agent:subject,message})=>dispatcher.claimed(subject,String(message.id)))
 const started=Promise.withResolvers(),release=Promise.withResolvers()
 const maintenance=agent.runMaintenance(async()=>{started.resolve();await release.promise});await started.promise
 for(const n of [1,2,3])dispatcher.deliver(agent,'task-'+n,'beta/bbbbbbbb',undefined,'task-'+n)
 const messages=[1,2,3].map(n=>ledger.deliveryFor('task-'+n))
 assert.equal(adapter.requests.length,0);assert.deepEqual(agent.inbox.nextTurn.map(m=>String(m.id)),messages.map(m=>m.messageId))
 release.resolve();await maintenance;await agent.whenIdle()
 const events=agent.session.snapshotEvents(),users=events.filter(e=>e.type==='user/message'),turns=events.filter(e=>e.type==='turn/start')
 assert.equal(users.length,3);assert.equal(turns.length,3);assert.deepEqual(users.map(e=>e.data.content[0].text),['task-1','task-2','task-3']);assert.ok(users.every(e=>e.data.source.kind==='a2a-relay'&&e.data.source.form==='relay'))
 let turn=0;const perTurn=new Map();for(const e of events){if(e.type==='turn/start')turn=e.data.turn;if(e.type==='user/message')perTurn.set(turn,(perTurn.get(turn)??0)+1)}assert.deepEqual([...perTurn.values()],[1,1,1])
 const m2=Promise.withResolvers(),done2=Promise.withResolvers();const busy=agent.runMaintenance(async()=>{m2.resolve();await done2.promise});await m2.promise
 dispatcher.deliver(agent,'remove-before-claim','beta/bbbbbbbb',undefined,'remove-before-claim');const removed=ledger.deliveryFor('remove-before-claim');assert.equal(agent.inbox.remove(llm.MessageId(removed.messageId)),true);done2.resolve();await busy;await agent.whenIdle();assert.equal(adapter.requests.length,3)
 assert.ok([1,2,3].every(n=>ledger.deliveryFor('task-'+n).state==='claimed'))
 dispatcher.deliver(agent,'idle-wake-task','beta/bbbbbbbb',undefined,'idle-wake-task');await agent.whenIdle();assert.equal(adapter.requests.length,4);assert.equal(ledger.deliveryFor('idle-wake-task').state,'claimed')
 const coldId=session.SessionId('cold-resolved-session')
 const created=await ctx.agents.create({sessionId:coldId,agentOptions:{provider:'mock',model:'mock'}})
 assert.equal(String(created.agent.id),String(coldId));await ctx.sessions.flush(created.agent.session);
 const storedBefore=await ctx.sessionPersistence.open(coldId,'read');await storedBefore.close();
 await created.dispose();assert.equal(ctx.agents.get(coldId),undefined)
 const restored=await ctx.agents.resume({resumeSessionId:coldId,agentOptions:{provider:'mock',model:'mock'}})
 dispatcher.deliver(restored.agent,'cold-wake-task','beta/bbbbbbbb',undefined,'cold-wake-task');await restored.agent.whenIdle();assert.equal(adapter.requests.length,5);assert.equal(ledger.deliveryFor('cold-wake-task').state,'claimed');await restored.dispose()
 console.log(JSON.stringify({ok:true,maintenanceNoLoss:true,fifo:true,oneTaskPerTurn:true,sourcePreserved:true,unclaimedRemoved:true,idleWakeConsumed:true,coldWakeConsumed:true,requests:adapter.requests.length}))
}finally{await ctx.fiber.dispose()}
