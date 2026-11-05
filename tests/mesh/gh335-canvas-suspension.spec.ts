// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { ghostNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort, runContext } from './harness.ts'
const id='session-aaaaaaaa11112222',bare='dsh/aaaaaaaa'
const post=async(base:string,path:string,body:unknown)=>{const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()}}
const state=async(base:string)=>await fetch(base+'/__dsh_a2a/state').then(r=>r.json())
const route=async(n:Awaited<ReturnType<typeof bootNode>>,message:string)=>await n.ctx.tools.get('a2a_route')!.execute({team:'dsh/canvas/ops',message},{signal:new AbortController().signal} as never) as any
describe('#335 real canvas lifecycle',()=>{
 it('membership-specific foreign blob grants cannot use a suspended canvas slot',async()=>{
  const pair=generateKeyPairSync('ed25519'),remote='foreign/aaaaaaaa'
  const ghost=await ghostNode(signCard({name:'foreign',session:'foreign',team:'foreign',capabilities:{},expiresAt:Date.now()+60000},pair.privateKey))
  const a=await bootNode({name:'grant335',session:'grant335',team:'dsh',sessionNodes:true})
  try{
   await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:remote})
   const staged=await fetch(a.baseUrl+'/__dsh_a2a/blob?to='+encodeURIComponent('dsh/canvas/ops')+'&name=x',{method:'POST',body:'grant'}).then(r=>r.json())
   const file=join(a.home,'a2a/canvas.json'),snapshot=JSON.parse(readFileSync(file,'utf8'))
   const target=a.baseUrl+'/a2a/blob?sha256='+staged.sha256+'&caller_session='+encodeURIComponent(remote)
   const request=()=>fetch(target,{headers:signOriginClaim({url:target,method:'GET'},{caller:'foreign',callerUrl:ghost.baseUrl,privateKey:pair.privateKey,now:Date.now(),unbound:false})})
   expect((await request()).status).toBe(200)
   await a.dispose()
   snapshot.revision++;snapshot.suspendedMembers=[{team:'ops',member:remote,localSessionId:'session-history',reason:'leave',at:new Date().toISOString(),token:'retained'}]
   writeFileSync(file,JSON.stringify(snapshot))
   const restarted=await bootNode({name:'grant335',session:'grant335',team:'dsh',sessionNodes:true,home:a.home})
   try{
    const changed=restarted.baseUrl+'/a2a/blob?sha256='+staged.sha256+'&caller_session='+encodeURIComponent(remote)
    const response=await fetch(changed,{headers:signOriginClaim({url:changed,method:'GET'},{caller:'foreign',callerUrl:ghost.baseUrl,privateKey:pair.privateKey,now:Date.now(),unbound:false})})
    expect(response.status).toBe(403);expect((await response.json()).code).toBe('not-granted')
   }finally{await restarted.dispose()}
  }finally{await a.dispose();await ghost.close()}
 })

 it('suspended members are absent from published canvasOrg, effective counts and whoami',async()=>{
  const a=await bootNode({name:'auth335',session:'auth335',team:'dsh',agentId:id,sessionNodes:true})
  try{
   await post(a.baseUrl,'/__dsh_a2a/join',{id});await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare})
   const staged=await fetch(a.baseUrl+'/__dsh_a2a/blob?to='+encodeURIComponent('dsh/canvas/ops')+'&name=x',{method:'POST',body:'grant payload'}).then(r=>r.json())
   const privateKey=createPrivateKey(readFileSync(join(a.home,'a2a/node-key.pem'),'utf8'))
   const signed=async(path:string)=>await fetch(a.baseUrl+path,{headers:signOriginClaim({url:a.baseUrl+path,method:'GET'},{caller:'dsh',callerUrl:a.baseUrl,privateKey,now:Date.now(),unbound:false})})
   const pull='/a2a/blob?sha256='+staged.sha256+'&caller_session='+encodeURIComponent(bare)
   expect((await signed(pull)).status).toBe(200)
   await post(a.baseUrl,'/__dsh_a2a/leave',{id});await post(a.baseUrl,'/__dsh_a2a/join',{id})
   // The host's own-zone canvas grant is deliberately host-wide in the existing
   // file protocol, not an individual membership proof; suspension does not change it.
   expect((await signed(pull)).status).toBe(200)
   const card=await signed('/.well-known/agent-card.json').then(r=>r.json())
   expect(card.canvasOrg.find((r:any)=>r.name==='ops').members).toEqual([])
   const who=await a.ctx.tools.get('a2a_whoami')!.execute({},runContext(a.agents.agent)) as any
   expect(who.teams.canvas).not.toContain('ops')
   const listed=await a.ctx.tools.get('a2a_teams')!.execute({},{signal:new AbortController().signal} as never) as any
   expect(listed.teams.find((r:any)=>r.team==='dsh/canvas/ops').memberCount).toBe(0)
  }finally{await a.dispose()}
 })

 it('records real collision inference warnings without counting state polling as use',async()=>{
  const pa=await reservePort(),pb=await reservePort()
  const a=await bootNode({name:'warnA',session:'warnA',team:'dsh',agentId:id,sessionNodes:true,port:pa,peers:['http://127.0.0.1:'+pb],cardCacheTtlMs:60000})
  const b=await bootNode({name:'warnB',session:'warnB',team:'dsh',agentId:id,sessionNodes:true,port:pb,peers:[a.baseUrl],cardCacheTtlMs:60000})
  try{
   await post(a.baseUrl,'/__dsh_a2a/join',{id});await post(b.baseUrl,'/__dsh_a2a/join',{id})
   await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare})
   await a.ctx.tools.get('a2a_probe')!.execute({url:b.baseUrl},{signal:new AbortController().signal} as never)
   const before=await state(a.baseUrl)
   await route(a,'collision probe')
   const after=await state(a.baseUrl)
   expect(after.canvas.legacyCollisionWarnings).toBeGreaterThan(before.canvas.legacyCollisionWarnings)
   expect(after.canvas.legacyCollisionRecent).toContainEqual(expect.objectContaining({member:bare}))
   const polled=await state(a.baseUrl);expect(polled.canvas.legacyInferenceResolutions).toBe(after.canvas.legacyInferenceResolutions)
  }finally{await a.dispose();await b.dispose()}
 },20000)

 it('cold unilateral same-id8 peer survives cleanup; qualified foreign slot is never treated as ours',async()=>{
  const pa=await reservePort(),pb=await reservePort()
  const a=await bootNode({name:'A335collision',session:'A335collision',team:'dsh',agentId:id,sessionNodes:true,port:pa,peers:['http://127.0.0.1:'+pb]})
  const b=await bootNode({name:'B335collision',session:'B335collision',team:'dsh',agentId:id,sessionNodes:true,port:pb})
  try{
   await post(a.baseUrl,'/__dsh_a2a/join',{id});await post(b.baseUrl,'/__dsh_a2a/join',{id})
   await post(b.baseUrl,'/__dsh_a2a/canvas',{action:'create',name:'b-marker'})
   const marker=await state(b.baseUrl),bfp=marker.canvas.teams[0].id.split('@')[1]
   await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'create',name:'ops'})
   const afp=(await state(a.baseUrl)).canvas.teams[0].id.split('@')[1]
   for(const member of [bare,bare+'@'+bfp,bare+'@'+afp,id])await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:member})
   const leave=await post(a.baseUrl,'/__dsh_a2a/leave',{id});expect(leave.status).toBe(200)
   const disk=JSON.parse(readFileSync(join(a.home,'a2a/canvas.json'),'utf8'))
   expect(disk.teams[0].members).toEqual([bare,bare+'@'+bfp])
   expect(disk.suspendedMembers).toEqual([expect.objectContaining({member:bare,reason:'leave'})])
   const s=await state(a.baseUrl);expect(s.canvas.suspendedMembersCount).toBe(1)
   expect(s.canvas.teams[0].members.map((m:any)=>m.id)).toEqual([bare+'@'+bfp])
  }finally{await a.dispose();await b.dispose()}
 })
 it('owner suspension action remains control-gated and readd cannot clear records',async()=>{
  const key='335-control',a=await bootNode({name:'key335',session:'key335',team:'dsh',agentId:id,sessionNodes:true,apiKey:key})
  const keyed=async(path:string,body:unknown)=>await fetch(a.baseUrl+path,{method:'POST',headers:{'X-API-Key':key,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json())
  try{
   await keyed('/__dsh_a2a/join',{id});await keyed('/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare});await keyed('/__dsh_a2a/leave',{id})
   const s=await fetch(a.baseUrl+'/__dsh_a2a/state',{headers:{'X-API-Key':key}}).then(r=>r.json()),request={action:'restore-suspended',name:'ops',id:bare,revision:s.canvas.revision,expected:s.canvas.suspendedMembers}
   expect((await post(a.baseUrl,'/__dsh_a2a/canvas',request)).status).toBe(401)
   const again=await keyed('/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare});expect(again.members).toEqual([])
   const disk=JSON.parse(readFileSync(join(a.home,'a2a/canvas.json'),'utf8'));expect(disk.suspendedMembers).toHaveLength(1)
   expect((await keyed('/__dsh_a2a/canvas',{...request,action:'delete-suspended'})).ok).toBe(true)
   expect(JSON.parse(readFileSync(join(a.home,'a2a/canvas.json'),'utf8')).teams[0].members).toEqual([])
  }finally{await a.dispose()}
 })
 for(const action of ['leave','remove','archive'])it(action+' suspends inferred bare slots, persists them and requires exact owner restore',async()=>{
  const a=await bootNode({name:'A335',session:'A335-'+action,team:'dsh',agentId:id,sessionNodes:true})
  let restarted:Awaited<ReturnType<typeof bootNode>>|undefined
  try{
   await post(a.baseUrl,'/__dsh_a2a/join',{id})
   await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare})
   const before=await state(a.baseUrl)
   expect(before.canvas.canvasLegacyBareMembers).toBe(true);expect(before.canvas.legacyBareMembers).toBe(1)
   const routed=await post(a.baseUrl,'/__dsh_a2a/dispatch',{team:'dsh/canvas/ops',message:'before leave'})
   expect(routed.body.ok).toBe(true)
   const used=await state(a.baseUrl);expect(used.canvas.legacyInferenceResolutions).toBeGreaterThan(0)
   const poll=await state(a.baseUrl);expect(poll.canvas.legacyInferenceResolutions).toBe(used.canvas.legacyInferenceResolutions)
   if(action==='leave')expect((await post(a.baseUrl,'/__dsh_a2a/leave',{id})).status).toBe(200)
   else if(action==='remove')expect((await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'remove-member',name:'ops',id})).body.ok).toBe(true)
   else a.ctx.provide('workspaceRegistry',{archivedSessionIds:[id]} as never)
   const after=await state(a.baseUrl)
   expect(after.canvas.suspendedMembersCount).toBe(1)
   expect(after.canvas.teams.find((t:any)=>t.name==='ops').members).toEqual([])
   expect(after.canvas.retainedMembers).toContainEqual(expect.objectContaining({team:'ops',member:bare,suspended:true}))
   const disk=JSON.parse(readFileSync(join(a.home,'a2a/canvas.json'),'utf8'))
   expect(disk.teams[0].members).toEqual([bare]);expect(disk.suspendedMembers[0].reason).toBe(action)
   await a.dispose()
   restarted=await bootNode({name:'A335',session:'A335-'+action,team:'dsh',agentId:id,sessionNodes:true,home:a.home})
   await post(restarted.baseUrl,'/__dsh_a2a/join',{id})
   await post(restarted.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare})
   expect((await post(restarted.baseUrl,'/__dsh_a2a/dispatch',{team:'dsh/canvas/ops',message:'after rejoin'})).body.ok).toBe(false)
   const current=await state(restarted.baseUrl),records=current.canvas.suspendedMembers
   expect((await post(restarted.baseUrl,'/__dsh_a2a/canvas',{action:'restore-suspended',name:'ops',id:bare,revision:current.canvas.revision-1,expected:records})).body.ok).toBe(false)
   expect((await post(restarted.baseUrl,'/__dsh_a2a/canvas',{action:'restore-suspended',name:'ops',id:bare,revision:current.canvas.revision,expected:records})).body.ok).toBe(true)
   const restored=await route(restarted,'owner restored')
   expect(restored.ok,JSON.stringify(restored)).toBe(true)
  }finally{await restarted?.dispose();await a.dispose()}
 },20000)
 it('failed durable suspension refuses leave, keeps join and cannot serve canvas rows',async()=>{
  const a=await bootNode({name:'A335fail',session:'A335fail',team:'dsh',agentId:id,sessionNodes:true})
  try{
   await post(a.baseUrl,'/__dsh_a2a/join',{id});await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare})
   const file=join(a.home,'a2a/canvas.json'),original=readFileSync(file,'utf8');writeFileSync(file,original+' ')
   expect((await post(a.baseUrl,'/__dsh_a2a/leave',{id})).status).toBe(503)
   expect((await a.ctx.tools.get('a2a_whoami')!.execute({},runContext(a.agents.agent)) as any).node.joined).toBe(true)
   expect((await post(a.baseUrl,'/__dsh_a2a/dispatch',{team:'dsh/canvas/ops',message:'must refuse'})).body.ok).toBe(false)
   expect(readFileSync(file,'utf8')).toBe(original+' ')
  }finally{await a.dispose()}
 })
 it('closed legacy window excludes raw bare rows without deleting them',async()=>{
  const a=await bootNode({name:'closed335',session:'closed335',team:'dsh',agentId:id,sessionNodes:true,canvasLegacyBareMembers:false})
  try{
   await post(a.baseUrl,'/__dsh_a2a/join',{id});await post(a.baseUrl,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:bare})
   expect((await post(a.baseUrl,'/__dsh_a2a/dispatch',{team:'dsh/canvas/ops',message:'closed'})).body.ok).toBe(false)
   expect(JSON.parse(readFileSync(join(a.home,'a2a/canvas.json'),'utf8')).teams[0].members).toEqual([bare])
   expect((await state(a.baseUrl)).canvas.legacyInferredMembers).toBe(0)
  }finally{await a.dispose()}
 })
})
