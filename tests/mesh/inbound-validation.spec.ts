import {describe,it,expect,vi,afterEach}from'vitest'
import {readFileSync}from'node:fs'
import {join}from'node:path'
import {createPrivateKey}from'node:crypto'
import {bootNode,reservePort,type MeshNode}from'./harness.ts'
import {signOriginClaim}from'../../src/origin-claim.ts'
const control=vi.hoisted(()=>({mode:'normal',deadline:20}))
vi.mock('../../src/origin-claim.ts',async original=>{const actual=await original<typeof import('../../src/origin-claim.ts')>();return{...actual,verifyOriginClaim:async(req:any,deps:any)=>{
 const selected=req.url==='/a2a/direct'&&Buffer.from(deps.rawBody??[]).toString().includes('validation-')
 if(selected&&control.mode==='delayed')await new Promise(r=>setTimeout(r,80))
 if(selected&&control.mode==='failed')throw Error('validation unavailable')
 return actual.verifyOriginClaim(req,{...deps,timeoutMs:control.mode==='card-timeout'?control.deadline:5000})
}}})
vi.mock('../../src/inbound-verification.ts',async original=>{const actual=await original<typeof import('../../src/inbound-verification.ts')>();return {...actual,completeInboundVerification:(work:()=>Promise<any>)=>actual.completeInboundVerification(work,control.mode==='delayed'?20:5000)}})
afterEach(()=>{control.mode='normal';vi.restoreAllMocks()})
const post=(n:MeshNode,path:string,body:unknown)=>fetch(n.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
const state=(n:MeshNode)=>fetch(n.baseUrl+'/__dsh_a2a/state').then(r=>r.json())
async function pair(sameZone=false){
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'validationA',session:'validationA',team:'alpha',agentId:'session-aaaaaaaa11112222',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:true,silent:true,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'validationB',session:'validationB',team:sameZone?'alpha':'beta',agentId:'session-bbbbbbbb11112222',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:true,silent:true,asyncNudgeDelayMs:86400000})
 for(const n of[a,b])await post(n,'/__dsh_a2a/join',{id:String(n.agents.agent!.id)})
 expect((await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'validation',id:String(a.agents.agent!.id)})).ok).toBe(true)
 expect((await post(a,'/__dsh_a2a/canvas',{action:'add-member',name:'validation',id:(sameZone?'alpha':'beta')+'/bbbbbbbb',peer:bu})).ok).toBe(true)
 const key=createPrivateKey(readFileSync(join(b.home,'a2a/node-key.pem'),'utf8'))
 const send=(task:string)=>{const url=au+'/a2a/direct',body=JSON.stringify({team:'alpha/aaaaaaaa',caller_session:'beta/bbbbbbbb',task_id:task,message:'validation request',wait:false});return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url,method:'POST',body},{caller:'beta',callerUrl:bu,privateKey:key,unbound:false,now:Date.now()})},body}).then(r=>r.json())}
 return{a,b,send}
}
describe('inbound validation completion',()=>{
 it('retains absent-envelope admission behavior while validation work is delayed',async()=>{
  const {a,b}=await pair(true);try{
   control.mode='delayed'
   const result=await post(a,'/a2a/direct',{team:'alpha/aaaaaaaa',caller_session:'alpha/bbbbbbbb',task_id:'validation-absent',message:'validation request',wait:false})
   expect(result.routed).not.toBe(true);expect(result.code).toBe(-32000);expect(a.steered).toEqual([]);expect((await state(a)).tasks).toEqual([])
  }finally{control.mode='normal';await a.dispose();await b.dispose()}
 })

 for(const mode of['delayed','failed','card-timeout'] as const)it('rejects '+mode+' validation with no delivery or task record',async()=>{
  const {a,b,send}=await pair();try{
   if(mode==='card-timeout'){
    control.mode='card-timeout'
    const original=globalThis.fetch,cardUrl=b.baseUrl+'/.well-known/agent-card.json'
    vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>String(url)===cardUrl?new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(Object.assign(Error('validation deadline'),{name:'AbortError'})),{once:true})}):original(url,init))
   }else control.mode=mode
   const result=await send('validation-'+mode);expect(result).toMatchObject({code:-32011,delivered:false,task_status:'TASK_STATE_FAILED'});expect(result.reason).toBe(mode==='failed'?'no-card':'verification-timeout')
   expect(a.steered).toEqual([]);const view=await state(a);expect(view.tasks).toEqual([]);expect(view.archived).toEqual([])
  }finally{control.mode='normal';vi.restoreAllMocks();await a.dispose();await b.dispose()}
 })
 it('accepts completed validation without relying on a prior cached decision',async()=>{
  const {a,b,send}=await pair();try{const result=await send('validation-completed');expect(result.delivered,JSON.stringify(result)).toBe(true);expect(a.steered).toHaveLength(1)}finally{await a.dispose();await b.dispose()}
 })
})
