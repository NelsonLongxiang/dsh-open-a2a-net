import { describe, it, expect } from 'vitest'
import { bootNode, reservePort, tmpHome, runContext } from './harness.ts'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:http'
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { encodePublicKey, signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { qualifiedSessionMember } from '../../src/canvas-member.ts'
const id='session-aaaaaaaa11112222',bare='dsh/aaaaaaaa'
const post=async(base:string,body:unknown)=>fetch(base+'/__dsh_a2a/canvas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
const state=async(base:string)=>fetch(base+'/__dsh_a2a/state').then(r=>r.json())
describe('#334 actual source confirmation',()=>{
 it('same-id8 foreign signer cannot borrow local provenance, but its separately pinned member is admitted',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'authA334',session:'authA334',team:'dsh',agentId:id,sessionNodes:true,port:pa,peers:[bu],teamScopeRouting:true})
  const b=await bootNode({name:'authB334',session:'authB334',team:'dsh',agentId:id,sessionNodes:true,port:pb,peers:[au],teamScopeRouting:true})
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   const key=createPrivateKey(readFileSync(join(b.home,'a2a/node-key.pem'),'utf8'))
   const ownCard=await fetch(au+'/.well-known/agent-card.json').then(r=>r.json()),local=qualifiedSessionMember(bare,ownCard.publicKey)!
   expect((await post(au,{action:'add-member',name:'ops',id:local})).ok).toBe(true)
   const deliver=async(task:string)=>{const target=au+'/a2a/direct',body=JSON.stringify({team:'dsh/canvas/ops',caller_session:bare,task_id:task,message:'provenance-bound334',wait:false});return fetch(target,{method:'POST',headers:{'Content-Type':'application/json',...signOriginClaim({url:target,method:'POST',body},{caller:'dsh',callerUrl:bu,privateKey:key,unbound:false,now:Date.now()})},body}).then(r=>r.json())}
   expect((await deliver('direct-334-local-only')).routed).not.toBe(true);expect(a.steered).toHaveLength(0)
   expect((await post(au,{action:'add-member',name:'ops',id:bare,peer:bu})).ok).toBe(true)
   const permitted=await deliver('direct-334-foreign-pin');expect(permitted.routed,JSON.stringify(permitted)).toBe(true);expect(a.steered).toHaveLength(1)
  }finally{await a.dispose();await b.dispose()}
 })

 it('retains unilateral minimal-card unknown slots without source promotion and closes their route/scope after restart',async()=>{
  const home=tmpHome();mkdirSync(join(home,'a2a'),{recursive:true});const file=join(home,'a2a/canvas.json'),original=JSON.stringify({teams:[{name:'ops',members:[bare]}]});writeFileSync(file,original)
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const b=await bootNode({name:'minimalB334',session:'minimalB334',team:'dsh',agentId:id,sessionNodes:true,port:pb})
  let a=await bootNode({name:'minimalA334',session:'minimalA334',team:'dsh',agentId:id,home,sessionNodes:true,port:pa,peers:[bu]})
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   const card=await fetch(bu+'/.well-known/agent-card.json').then(r=>r.json());expect(card.sessionTeams).toBeUndefined()
   const before=await state(au);expect(before.canvas.memberSlots[0].provenance).toBe('unknown')
   const failed=await post(au,{action:'confirm-member',name:'ops',id:bare,replacement:bare,peer:bu,revision:before.canvas.revision,expectedOwner:null});expect(failed.ok).toBe(false)
   expect(readFileSync(file,'utf8')).toBe(original)
   await a.dispose();a=await bootNode({name:'minimalA334',session:'minimalA334',team:'dsh',agentId:id,home,sessionNodes:true,port:pa,peers:[bu],canvasLegacyBareMembers:false})
   const who=await a.ctx.tools.get('a2a_whoami')!.execute({},runContext(a.agents.agent)) as any;expect(who.teams.canvas).toEqual([])
   const route=await fetch(au+'/__dsh_a2a/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'dsh/canvas/ops',message:'closed unknown334'})}).then(r=>r.json());expect(route.ok).toBe(false)
   expect(a.steered).toHaveLength(0);expect(b.steered).toHaveLength(0);expect(readFileSync(file,'utf8')).toBe(original)
  }finally{await a.dispose();await b.dispose()}
 })
 it('a selected remote owner changing keys cannot inherit a stored slot or receive a payload',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'rotationA334',session:'rotationA334',team:'dsh',sessionNodes:true,port:pa,peers:[bu],cardCacheTtlMs:0,teamScopeRouting:false})
  let b=await bootNode({name:'rotationB334',session:'rotationB334',team:'dsh',agentId:id,sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false})
  try{
   const joinNode=()=>new Promise<void>((resolve,reject)=>{const req=request(bu+'/__dsh_a2a/join',{method:'POST',agent:false,headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',resolve)});req.on('error',reject);req.end(JSON.stringify({id}))});await joinNode()
   expect((await post(au,{action:'add-member',name:'ops',id:bare,peer:bu})).ok).toBe(true)
   const file=join(a.home,'a2a/canvas.json'),before=readFileSync(file,'utf8'),ref=JSON.parse(before).teams[0].members[0]
   await b.dispose();b=await bootNode({name:'rotationBnew334',session:'rotationBnew334',team:'dsh',agentId:id,sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false});await joinNode()
   const result=await fetch(au+'/__dsh_a2a/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'dsh/canvas/ops',message:'must not rekey334'})}).then(r=>r.json());expect(result.ok).toBe(false);expect(b.steered).toHaveLength(0)
   const current=await state(au);expect((await post(au,{action:'confirm-member',name:'ops',id:ref,replacement:bare,peer:bu,revision:current.canvas.revision,expectedOwner:JSON.parse(before).memberOwners[ref]})).ok).toBe(false)
   expect(readFileSync(file,'utf8')).toBe(before)
  }finally{await a.dispose();await b.dispose()}
 })

 it('selects only the requested one of two remote owners sharing a handle, and survives owner-key restart',async()=>{
  const pa=await reservePort(),pb=await reservePort(),pc=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb,cu='http://127.0.0.1:'+pc
  const a=await bootNode({name:'threeA334',session:'threeA334',team:'dsh',agentId:id,sessionNodes:true,port:pa,peers:[bu,cu],teamScopeRouting:false})
  const b=await bootNode({name:'threeB334',session:'threeB334',team:'dsh',agentId:id,sessionNodes:true,port:pb,peers:[au],teamScopeRouting:false})
  const c=await bootNode({name:'threeC334',session:'threeC334',team:'dsh',agentId:id,sessionNodes:true,port:pc,peers:[au],teamScopeRouting:false})
  let restart:Awaited<ReturnType<typeof bootNode>>|undefined
  try{
   for(const n of [a,b,c])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   expect((await post(au,{action:'add-member',name:'ops',id:bare})).ok).toBe(false)
   expect((await post(au,{action:'add-member',name:'ops',id:bare,peer:cu})).ok).toBe(true)
   const dispatch=async(base:string)=>fetch(base+'/__dsh_a2a/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'dsh/canvas/ops',message:'only-C334'})}).then(r=>r.json())
   expect((await dispatch(au)).ok).toBe(true);expect(c.steered).toHaveLength(1);expect(b.steered).toHaveLength(0);expect(a.steered).toHaveLength(0)
   const original=readFileSync(join(a.home,'a2a/canvas.json'),'utf8')
   await a.dispose();restart=await bootNode({name:'threeA334',session:'threeA334',team:'dsh',agentId:id,sessionNodes:true,port:pa,home:a.home,peers:[bu,cu],teamScopeRouting:false})
   expect((await dispatch(au)).ok).toBe(true);expect(c.steered).toHaveLength(2);expect(b.steered).toHaveLength(0)
   expect(readFileSync(join(a.home,'a2a/canvas.json'),'utf8')).toBe(original)
  }finally{await restart?.dispose();await a.dispose();await b.dispose();await c.dispose()}
 })
 it('confirmation cannot restore a suspended legacy slot, including after closed-window restart',async()=>{
  const home=tmpHome();mkdirSync(join(home,'a2a'),{recursive:true});writeFileSync(join(home,'a2a/canvas.json'),JSON.stringify({teams:[{name:'ops',members:[bare]}]}))
  const a=await bootNode({name:'pause334',session:'pause334',team:'dsh',agentId:id,home,sessionNodes:true});let b:Awaited<ReturnType<typeof bootNode>>|undefined
  try{
   const joinNode=(base:string)=>fetch(base+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   await joinNode(a.baseUrl);await fetch(a.baseUrl+'/__dsh_a2a/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});await joinNode(a.baseUrl)
   const before=await state(a.baseUrl);expect(before.canvas.suspendedMembersCount).toBe(1)
   expect((await post(a.baseUrl,{action:'confirm-member',name:'ops',id:bare,replacement:id,revision:before.canvas.revision,expectedOwner:null})).ok).toBe(true)
   const current=await state(a.baseUrl);expect(current.canvas.suspendedMembers[0].member).toBe(id);expect(current.canvas.teams[0].members).toEqual([])
   await a.dispose();b=await bootNode({name:'pause334',session:'pause334',team:'dsh',agentId:id,home,sessionNodes:true,canvasLegacyBareMembers:false});await joinNode(b.baseUrl)
   const after=await state(b.baseUrl);expect(after.canvas.teams[0].members).toEqual([]);expect(after.canvas.suspendedMembersCount).toBe(1)
   await fetch(b.baseUrl+'/__dsh_a2a/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});await joinNode(b.baseUrl)
   const final=await state(b.baseUrl);expect(final.canvas.suspendedMembersCount).toBe(1);expect(final.canvas.retainedMembers).toContainEqual(expect.objectContaining({team:'ops',member:id,suspended:true}));expect(final.canvas.teams[0].members).toEqual([])
  }finally{await b?.dispose();await a.dispose()}
 })
 it('a linked editor cannot attach its own fingerprint to an unproved third-party session',async()=>{
  const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
  const a=await bootNode({name:'editA334',session:'editA334',team:'alpha',sessionNodes:true,port:pa,peers:[bu]})
  const b=await bootNode({name:'editB334',session:'editB334',team:'beta',agentId:id,sessionNodes:true,port:pb,peers:[au]})
  try{
   await fetch(bu+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   const key=createPrivateKey(readFileSync(join(b.home,'a2a/node-key.pem'),'utf8')),ref=qualifiedSessionMember('gamma/aaaaaaaa',encodePublicKey(createPublicKey(key)))!
   const target=au+'/a2a/canvas-op',body=JSON.stringify({op:'add-member',name:'ops',id:ref})
   const headers=signOriginClaim({url:target,method:'POST',body},{caller:'beta',callerUrl:bu,privateKey:key,unbound:false,now:Date.now()})
   const out=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json',...headers},body}).then(r=>r.json())
   expect(out.ok,JSON.stringify(out)).toBe(false);expect((await state(au)).canvas.teams).toEqual([])
  }finally{await a.dispose();await b.dispose()}
 })
 it('keeps historical bare inference unknown, confirms the exact local slot and survives restart',async()=>{
  const home=tmpHome();mkdirSync(join(home,'a2a'),{recursive:true});writeFileSync(join(home,'a2a/canvas.json'),JSON.stringify({teams:[{name:'ops',members:[bare]}]}))
  const a=await bootNode({name:'confirm334',session:'confirm334',team:'dsh',agentId:id,home,sessionNodes:true});
  try{
   await fetch(a.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   const before=await state(a.baseUrl);expect(before.canvas.memberSlots[0]).toMatchObject({member:bare,provenance:'unknown',compatibilityInference:true})
   const who=await a.ctx.tools.get('a2a_whoami')!.execute({},runContext(a.agents.agent)) as any;expect(who.teams.canvasDetails[0]).toMatchObject({provenance:'unknown',compatibilityInference:true})
   expect((await post(a.baseUrl,{action:'confirm-member',name:'ops',id:bare,replacement:id,revision:before.canvas.revision,expectedOwner:null})).ok).toBe(true)
   expect(JSON.parse(readFileSync(join(home,'a2a/canvas.json'),'utf8')).teams[0].members).toEqual([id])
   await a.dispose();const restarted=await bootNode({name:'confirm334',session:'confirm334',team:'dsh',agentId:id,home,sessionNodes:true,canvasLegacyBareMembers:false});try{expect((await state(restarted.baseUrl)).canvas.memberSlots[0].provenance).toBe('local-id')}finally{await restarted.dispose()}
  }finally{await a.dispose()}
 })
 it('rejects unverifiable new bare writes instead of trusting same-zone or absent cache rows',async()=>{
  const a=await bootNode({name:'refuse334',session:'refuse334',team:'dsh',agentId:id,sessionNodes:true});try{
   await fetch(a.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   expect((await post(a.baseUrl,{action:'add-member',name:'ops',id:bare})).ok).toBe(false)
   expect((await post(a.baseUrl,{action:'add-member',name:'ops',id})).ok).toBe(true)
  }finally{await a.dispose()}
 })
 it('stores a selected verified remote key and routes to that key not a same-id8 local session',async()=>{
  const pa=await reservePort(),pb=await reservePort(),aUrl='http://127.0.0.1:'+pa,bUrl='http://127.0.0.1:'+pb
  const a=await bootNode({name:'originA334',session:'originA334',team:'dsh',agentId:id,sessionNodes:true,port:pa,peers:[bUrl],teamScopeRouting:false})
  const b=await bootNode({name:'originB334',session:'originB334',team:'dsh',agentId:id,sessionNodes:true,port:pb,peers:[aUrl],teamScopeRouting:false})
  try{
   for(const n of [a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})})
   const add=await post(aUrl,{action:'add-member',name:'ops',id:bare,peer:bUrl});expect(add.ok,JSON.stringify(add)).toBe(true)
   const disk=JSON.parse(readFileSync(join(a.home,'a2a/canvas.json'),'utf8')),ref=disk.teams[0].members[0];expect(ref).toMatch(/^dsh\/aaaaaaaa@[0-9a-f]{8}$/);expect(disk.memberOwners[ref]).toBeTruthy()
   const routed=await fetch(aUrl+'/__dsh_a2a/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:'dsh/canvas/ops',message:'selected-key334'})}).then(r=>r.json())
   expect(routed.ok,JSON.stringify(routed)).toBe(true);expect(b.steered).toHaveLength(1);expect(a.steered).toHaveLength(0)
  }finally{await a.dispose();await b.dispose()}
 })
})
