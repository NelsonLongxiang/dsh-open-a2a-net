// @vitest-environment node
import {it,expect,vi,afterEach,onTestFailed} from 'vitest'
import {createPrivateKey,generateKeyPairSync} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {signCard} from '../../src/card.ts'
import {signOriginClaim} from '../../src/origin-claim.ts'
import {signRecoveryProposal,recoveryFingerprint,type RecoveryBinding} from '../../src/request-recovery.ts'
import {RequestRecoveryRuntime} from '../../src/request-recovery-runtime.ts'
import {A2aClient} from '../../src/a2a-client.ts'
import {bootNode,reservePort,MockGuiConnection,mockGuiLogin,type MeshNode} from './harness.ts'
const nativeFetch=globalThis.fetch.bind(globalThis),caller='superagent-team/0123456789abcdef',target='beta/bbbbbbbb',receiverId='session-bbbbbbbb11112222'
afterEach(()=>vi.restoreAllMocks())
/** #782 diagnostics: what the receiver's recovery journal holds, without permit bodies or keys. */
function journalView(home:string):unknown{
 const path=join(home,'a2a','request-recovery.json')
 try{const raw=JSON.parse(readFileSync(path,'utf8'));return {entries:(raw.entries??[]).map((e:any)=>({taskId:e?.permit?.proposal?.binding?.taskId,phase:e?.phase,revoked:e?.revokedAt!==undefined}))}}
 catch(error){return {unreadable:String(error)}}
}
async function fixture(){
 const grantErrors:string[]=[],realGrant=RequestRecoveryRuntime.prototype.grant
 vi.spyOn(RequestRecoveryRuntime.prototype,'grant').mockImplementation(async function(this:RequestRecoveryRuntime,...args:Parameters<RequestRecoveryRuntime['grant']>){try{return await realGrant.apply(this,args)}catch(e){grantErrors.push(String(e));throw e}})
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'narrow-A',session:'narrow-A',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:true,silent:true,asyncNudgeDelayMs:86400000})
 let b=await bootNode({name:'narrow-B',session:'narrow-B',team:'beta',agentId:receiverId,port:pb,peers:[au],sessionNodes:true,teamScopeRouting:true,silent:true,asyncNudgeDelayMs:86400000})
 await b.ctx.plugin(MockGuiConnection)
 const post=async(n:MeshNode,path:string,body:unknown,owner=false)=>{const r=await nativeFetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close',...(owner?mockGuiLogin():{})},body:JSON.stringify(body)});return{status:r.status,data:await r.json() as any}}
 await post(b,'/__dsh_a2a/join',{id:receiverId})
 const cliKey=generateKeyPairSync('ed25519').privateKey,cliCard=signCard({name:'superagent-team',session:'cli-superagent-team',team:caller,capabilities:{route:true,async:true},expiresAt:Date.now()+3600000},cliKey)
 expect((await post(a,'/__dsh_a2a/cli-deposit',{action:'publish',card:JSON.stringify(cliCard)})).data.ok).toBe(true)
 const ac=await nativeFetch(au+'/.well-known/agent-card.json').then(r=>r.json()) as any,bc=await nativeFetch(bu+'/.well-known/agent-card.json').then(r=>r.json()) as any
 const senderKey=createPrivateKey(readFileSync(join(a.home,'a2a/node-key.pem'),'utf8'))
 const binding:RecoveryBinding={version:1,requestId:'rr-fixture-original',ticketId:'original-ticket',originalCards:['first-card','second-card'],originalTasks:['direct-first','direct-second'],approvalDigest:'a'.repeat(64),approvalAt:new Date(Date.now()-1000).toISOString(),senderReconciliation:'sender owner checked both original attempts and original principal',caller,cliKey:cliCard.publicKey,senderHome:au,senderKey:ac.publicKey,receiverHome:bu,receiverKey:bc.publicKey,receiverSession:receiverId,target,message:'one exact previously approved business request',taskId:'recover-original',contextId:'recovery-original-context'}
 const proposal=signRecoveryProposal(binding,senderKey)
 const raw=async(patch:Record<string,unknown>={},permit?:unknown)=>{const url=bu+'/a2a/direct',body=JSON.stringify({team:target,message:binding.message,caller_session:caller,task_id:binding.taskId,context_id:binding.contextId,wait:false,...(permit?{request_recovery:permit}:{}),...patch});const r=await nativeFetch(url,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close',...signOriginClaim({url,method:'POST',body},{caller:'alpha',callerUrl:au,privateKey:senderKey,unbound:false,now:Date.now()})},body});return{status:r.status,data:await r.json() as any}}
 const grant=async()=>({...await post(b,'/__dsh_a2a/request-recovery',{action:'grant',proposal,reconciliation:'Receiver owner checked both original attempts and stopped old retry paths; neither was admitted.',checked_not_admitted:true},true),errors:grantErrors})
 const state=()=>nativeFetch(bu+'/__dsh_a2a/state',{headers:{Connection:'close'}}).then(r=>r.json()) as Promise<any>
 const restart=async()=>{const home=b.home;await b.dispose();b=await bootNode({home,name:'narrow-B',session:'narrow-B',team:'beta',agentId:receiverId,port:pb,peers:[au],sessionNodes:true,teamScopeRouting:true,silent:true,asyncNudgeDelayMs:86400000});await b.ctx.plugin(MockGuiConnection)}
 return{a,get b(){return b},binding,proposal,raw,grant,post,state,restart,dispose:async()=>{await a.dispose();await b.dispose()}}
}
it('real scoped receiver accepts exactly one permitted request and never creates standing membership',async()=>{
 // #782: the observed red runs were whole-test 5 s timeouts, which cut off before any assertion could print its data.
 // On any failure (a timeout included) print which stage it was in, how long each finished stage took, and the
 // receiver's journal view. Budget and assertions are unchanged.
 const t0=Date.now(),stages:Array<[string,number]>=[];let stage='fixture';let home:string|undefined
 const at=(next:string)=>{stages.push([stage,Date.now()-t0]);stage=next}
 onTestFailed(()=>{console.error('[#782 diagnostics] '+JSON.stringify({stage,elapsedMs:Date.now()-t0,finished:stages,journal:home===undefined?'no receiver yet':journalView(home)}))})
 const f=await fixture();home=f.b.home;try{
  at('initial-refused')
  const initial=await f.raw();expect(initial.data.error).toContain('no operator-established canvas link');expect(f.b.steered).toHaveLength(0)
  at('grant')
  const granted=await f.grant();expect(granted.status,JSON.stringify(granted)).toBe(200);expect(granted.data.ok).toBe(true)
  const permit=granted.data.permit
  at('query-ready')
  const unused=await f.post(f.b,'/a2a/query',{task_id:f.binding.taskId,fingerprint:recoveryFingerprint(f.binding)})
  // #782: one full-suite run saw found:false here and its log is lost. Grant writes the journal synchronously before it
  // answers, so a miss means outcome() found no row, or read() threw. On failure, print the whole answer and the
  // receiver's journal (task ids and phases only) so the next red run shows which.
  expect(unused.data,JSON.stringify({unused:unused.data,journal:journalView(f.b.home)})).toMatchObject({found:true,status:'pending',task_id:f.binding.taskId,recovery_delivery:'ready'});expect(f.b.steered).toHaveLength(0)
  at('replacements-refused')
  for(const patch of [{message:'replacement body'},{team:'beta/aaaaaaaa'},{task_id:'new-task'},{context_id:'other-context'}]){const refused=await f.raw(patch,permit);expect(refused.data.delivered).not.toBe(true)}
  expect(f.b.steered).toHaveLength(0)
  at('accept')
  const accepted=await f.raw({},permit);expect(accepted.data,JSON.stringify(accepted)).toMatchObject({routed:true,delivered:true,recovery_delivery:'accepted',task_id:f.binding.taskId})
  at('steer')
  await vi.waitFor(()=>expect(f.b.steered).toHaveLength(1))
  at('replay-refused')
  const again=await f.raw({},permit);expect(again.data.delivered).not.toBe(true)
  const changedId=await f.raw({task_id:'changed-id'});expect(changedId.status).toBe(409);expect(f.b.steered).toHaveLength(1)
  at('query-accepted')
  const query=await f.post(f.b,'/a2a/query',{task_id:f.binding.taskId,fingerprint:recoveryFingerprint(f.binding)});expect(query.data).toMatchObject({found:true,status:'pending',recovery_delivery:'accepted',task_id:f.binding.taskId});expect(query.data.reply).toBeUndefined()
  const state=await f.state();expect(state.tasks.find((r:any)=>r.taskId===f.binding.taskId)).toMatchObject({direction:'inbound',auth:{admission_rule:'request-recovery'}})
  expect(state.canvas.memberSlots.some((r:any)=>r.member===caller)).toBe(false)
  at('restart')
  await f.restart();home=f.b.home
  at('restored')
  const restored=await f.post(f.b,'/a2a/query',{task_id:f.binding.taskId,fingerprint:recoveryFingerprint(f.binding)});expect(restored.data).toMatchObject({status:'pending',recovery_delivery:'accepted'});expect(restored.data.reply).toBeUndefined()
  expect((await f.raw({},permit)).data.delivered).not.toBe(true);expect(f.b.steered).toHaveLength(0)
 }finally{await f.dispose()}
})
it('only original browser owner can consent; API-like credentials cannot grant or revoke',async()=>{
 const f=await fixture();try{
  const body={action:'grant',proposal:f.proposal,reconciliation:'checked original attempts',checked_not_admitted:true}
  expect((await f.post(f.b,'/__dsh_a2a/request-recovery',body)).status).toBe(401)
  const grant=await f.grant();expect(grant.data.ok,JSON.stringify(grant)).toBe(true)
  expect((await f.post(f.b,'/__dsh_a2a/request-recovery',{action:'revoke',request_id:f.binding.requestId})).status).toBe(401)
  expect((await f.post(f.b,'/__dsh_a2a/request-recovery',{action:'revoke',request_id:f.binding.requestId},true)).data.ok).toBe(true)
  expect((await f.raw({},grant.data.permit)).data.delivered).not.toBe(true);expect(f.b.steered).toHaveLength(0)
  const revoked=await f.post(f.b,'/a2a/query',{task_id:f.binding.taskId,fingerprint:recoveryFingerprint(f.binding)});expect(revoked.data.recovery_delivery).not.toBe('ready')
 }finally{await f.dispose()}
})

it.each([false,true])('receiver consent refuses same-body admission under a different id, restored=%s',async restored=>{
 const f=await fixture()
 try{
  expect((await f.post(f.b,'/__dsh_a2a/canvas',{action:'add-member',name:'prior-link',id:caller,home:f.a.baseUrl})).data.ok).toBe(true)
  expect((await f.post(f.b,'/__dsh_a2a/canvas',{action:'add-member',name:'prior-link',id:receiverId})).data.ok).toBe(true)
  const original=await f.raw({task_id:'ordinary-previous-id'})
  expect(original.data,JSON.stringify(original)).toMatchObject({routed:true,delivered:true})
  expect(f.b.steered).toHaveLength(1)
  if(restored)await f.restart()
  const grant=await f.grant()
  expect(grant.status,JSON.stringify(grant)).toBe(409)
  expect(grant.data.ok).toBe(false)
  expect(f.b.steered).toHaveLength(restored?0:1)
 }finally{await f.dispose()}
})

it.each([false,true])('a receiver grant fences an in-flight ordinary request: same payload with new id=%s',async changedId=>{
 const f=await fixture();let release:(()=>void)|undefined
 try{
  // This synthetic standing link admits the ordinary old path. The recovery must still fence it.
  expect((await f.post(f.b,'/__dsh_a2a/canvas',{action:'add-member',name:'existing-link',id:caller,home:f.a.baseUrl})).data.ok).toBe(true)
  expect((await f.post(f.b,'/__dsh_a2a/canvas',{action:'add-member',name:'existing-link',id:receiverId})).data.ok).toBe(true)
  let reached:(()=>void)|undefined,held=false
  const waiting=new Promise<void>(r=>{reached=r}),gate=new Promise<void>(r=>{release=r}),fetchCard=A2aClient.prototype.fetchCardDetail
  vi.spyOn(A2aClient.prototype,'fetchCardDetail').mockImplementation(async function(this:A2aClient,url:string){
   if(url===f.a.baseUrl&&!held){held=true;reached!();await gate}
   return fetchCard.call(this,url)
  })
  const old=f.raw({task_id:changedId?'ordinary-new-id':f.binding.originalTasks[0]})
  await waiting
  const grant=await f.grant();expect(grant.data.ok,JSON.stringify(grant)).toBe(true)
  release!()
  const refused=await old
  expect(refused.data.delivered,JSON.stringify(refused)).not.toBe(true)
  expect(refused.data.routed).not.toBe(true)
  expect(f.b.steered).toHaveLength(0)
  const recovery=await f.raw({},grant.data.permit)
  expect(recovery.data).toMatchObject({routed:true,delivered:true,recovery_delivery:'accepted'})
  expect(f.b.steered).toHaveLength(1)
 }finally{release?.();await f.dispose()}
})
