// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, reservePort, runContext } from './harness.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { verifyCard } from '../../src/card.ts'
const key = (n: any) => createPrivateKey(readFileSync(join(n.home,'a2a/node-key.pem'),'utf8'))
const card = async (n: any, headers: Record<string,string> = {}, query='') => await fetch(n.baseUrl+'/.well-known/agent-card.json'+query,{headers}).then(r=>r.json())
describe('#312 private referral topology',()=>{
 it('#324 F1 unrelated self-signed callers get no peers, even when they seed this host or request discovery',async()=>{
  const seed=await bootNode({name:'trustedSeed',session:'trustedSeed',team:'seed',sessionNodes:true})
  const b=await bootNode({name:'privateB',session:'privateB',team:'beta',sessionNodes:true,peers:[seed.baseUrl]})
  const stranger=await bootNode({name:'strangerC',session:'strangerC',team:'gamma',sessionNodes:true,peers:[b.baseUrl]})
  try{
   const target=b.baseUrl+'/.well-known/agent-card.json'
   for(const query of ['', '?discovery=1']){
    const headers=signOriginClaim({url:target+query,method:'GET'},{caller:'gamma',callerUrl:stranger.baseUrl,privateKey:key(stranger),unbound:false,now:Date.now()})
    const response=await card(b,headers,query)
    expect(verifyCard(response,Date.now()).ok).toBe(true)
    expect(response).not.toHaveProperty('peers')
    expect(JSON.stringify(response)).not.toContain(seed.baseUrl)
    expect(response.sessionTeams).toBeUndefined()
   }
   // B explicitly seeds this caller, so it may read topology even without a bilateral full-card link.
   const headers=signOriginClaim({url:target,method:'GET'},{caller:'seed',callerUrl:seed.baseUrl,privateKey:key(seed),unbound:false,now:Date.now()})
   const seeded=await card(b,headers)
   expect(seeded.peers).toContain(seed.baseUrl)
   expect(seeded.sessionTeams).toBeUndefined()
   expect(seeded.canvasOrg).toBeUndefined()
  }finally{await stranger.dispose();await b.dispose();await seed.dispose()}
 })
 it('#324 Q1 a fully cold bilateral signed card exchange uses at most one signed reduced callback and two anonymous verification reads',async()=>{
  const pa=await reservePort(),pb=await reservePort()
  const a=await bootNode({name:'coldA',session:'coldA',team:'alpha',port:pa,sessionNodes:true,peers:['http://127.0.0.1:'+pb],cardCacheTtlMs:30000})
  const b=await bootNode({name:'coldB',session:'coldB',team:'beta',port:pb,sessionNodes:true,peers:[a.baseUrl],cardCacheTtlMs:30000})
  try{
   const observed:Array<{url:string;signed:boolean}>=[]
   const raw=globalThis.fetch
   const spy=vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{
    const url=String(input)
    if(url.startsWith(a.baseUrl+'/.well-known/')||url.startsWith(b.baseUrl+'/.well-known/')) observed.push({url,signed:new Headers(init?.headers).has('X-A2A-Caller-Sig2')})
    if(observed.length>8) return Promise.reject(new Error('unexpected recursive card read'))
    return raw(input,init)
   })
   try{
    const target=b.baseUrl+'/.well-known/agent-card.json'
    const headers=signOriginClaim({url:target,method:'GET'},{caller:'alpha',callerUrl:a.baseUrl,privateKey:key(a),unbound:false,now:Date.now()})
    const response=await card(b,headers)
    expect(response.peers).toContain(a.baseUrl)
    expect(response.canvasOrg).toBeDefined()
    const discovery=observed.filter(r=>r.url.includes('?discovery=1'))
    const anonymous=observed.filter(r=>!r.signed)
    expect(discovery).toHaveLength(1)
    expect(discovery[0].signed).toBe(true)
    expect(anonymous.length).toBeLessThanOrEqual(2)
    expect(observed.length).toBeLessThanOrEqual(4)
    console.log('gh324 cold bootstrap requests',JSON.stringify(observed))
   }finally{spy.mockRestore()}
  }finally{await a.dispose();await b.dispose()}
 })
 it('does not use a changed-key discovery reply as bilateral evidence and never advertises the peers anonymously',async()=>{
  const pa=await reservePort(),pb=await reservePort()
  const a=await bootNode({name:'keyA',session:'keyA',team:'alpha',port:pa,sessionNodes:true,peers:['http://127.0.0.1:'+pb]})
  const b=await bootNode({name:'keyB',session:'keyB',team:'beta',port:pb,sessionNodes:true,peers:[a.baseUrl]})
  const c=await bootNode({name:'keyC',session:'keyC',team:'alpha',sessionNodes:true})
  try{
   await fetch(b.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(b.agents.agent!.id)})})
   const wrong={...await card(c),peers:[b.baseUrl]}
   const raw=globalThis.fetch
   const spy=vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>String(input)===a.baseUrl+'/.well-known/agent-card.json?discovery=1'?Promise.resolve(new Response(JSON.stringify(wrong),{status:200,headers:{'content-type':'application/json'}})):raw(input,init))
   const target=b.baseUrl+'/.well-known/agent-card.json'
   const request=()=>signOriginClaim({url:target,method:'GET'},{caller:'alpha',callerUrl:a.baseUrl,privateKey:key(a),unbound:false,now:Date.now()})
   try{const denied=await card(b,request());expect(denied.sessionTeams).toBeUndefined();expect(denied.peers).toContain(a.baseUrl)}finally{spy.mockRestore()}
   const linked=await card(b,request());expect(linked.sessionTeams?.some((row:any)=>row.team==='beta/01234567')).toBe(true)
   expect(await card(b)).not.toHaveProperty('peers')
  }finally{await a.dispose();await b.dispose();await c.dispose()}
 })
 it('omits peers for anonymous, shape-only, invalid and stale claims; a verified configured seed sees peers but not sessions/org',async()=>{
  const b=await bootNode({name:'B312',session:'B312',team:'beta',sessionNodes:true})
  const a=await bootNode({name:'A312',session:'A312',team:'alpha',sessionNodes:true,peers:[b.baseUrl]})
  try{
   const target=a.baseUrl+'/.well-known/agent-card.json'
   const claim=signOriginClaim({url:target,method:'GET'},{caller:'beta',callerUrl:b.baseUrl,privateKey:key(b),unbound:false,now:Date.now()})
   const anon=await card(a)
   expect(await card(a,{},'?discovery=1')).not.toHaveProperty('peers')
   for(const c of [anon,await card(a,{'X-A2A-Caller':'beta'}),await card(a,{},'?caller_session=beta'),await card(a,{...claim,'X-A2A-Caller-Sig2':'forged'}),await card(a,{...claim,'X-A2A-Caller-Ts':String(Date.now()-360000)})]){
    expect(c).not.toHaveProperty('peers')
    expect(JSON.stringify(c)).not.toContain(b.baseUrl)
    expect(verifyCard(c,Date.now()).ok).toBe(true)
   }
   const signed=await card(a,claim)
   expect(signed.peers).toContain(b.baseUrl)
   expect(signed.sessionTeams).toBeUndefined()
   expect(signed.canvasOrg).toBeUndefined()
   expect(verifyCard(signed,Date.now()).ok).toBe(true)
   expect(signed.signature).toBe(anon.signature)
  }finally{await a.dispose();await b.dispose()}
 })
 it('fresh bilateral seeds discover each other without anonymous peers and keep signed referral learning',async()=>{
  const pa=await reservePort(),pb=await reservePort()
  const c=await bootNode({name:'C312',session:'C312',team:'cargo',sessionNodes:true})
  const b=await bootNode({name:'B312',session:'B312',team:'beta',port:pb,sessionNodes:true,peers:['http://127.0.0.1:'+pa,c.baseUrl],teamScopeInfo:false})
  const a=await bootNode({name:'A312',session:'A312',team:'alpha',port:pa,sessionNodes:true,peers:[b.baseUrl],teamScopeInfo:false})
  try{
   expect(await card(b)).not.toHaveProperty('peers')
   await a.ctx.tools.get('a2a_teams')!.execute({query:'cargo'},runContext())
   const s=await fetch(a.baseUrl+'/__dsh_a2a/state').then(r=>r.json()) as any
   expect(s.peers.some((p:any)=>p.url===c.baseUrl)).toBe(true)
   expect(s.peers.find((p:any)=>p.url===b.baseUrl)?.verified).toBe(true)
   // A real signed full-card exchange still has the peers needed for bilateral-link recognition.
   const target=b.baseUrl+'/.well-known/agent-card.json'
   const signed=await card(b,signOriginClaim({url:target,method:'GET'},{caller:'alpha',callerUrl:a.baseUrl,privateKey:key(a),unbound:false,now:Date.now()}))
   expect(signed.peers).toContain(a.baseUrl)
   expect(signed.peers).toContain(c.baseUrl)
   const reduced=await card(b,signOriginClaim({url:target+'?discovery=1',method:'GET'},{caller:'alpha',callerUrl:a.baseUrl,privateKey:key(a),unbound:false,now:Date.now()}),'?discovery=1')
   expect(reduced.peers).toContain(a.baseUrl)
   expect(reduced.sessionTeams).toBeUndefined()
   expect(reduced.canvasOrg).toBeUndefined()
   expect((await fetch(b.baseUrl+'/.well-known/agent-card.json')).headers.get('cache-control')).toBe('private, no-store')
  }finally{await a.dispose();await b.dispose();await c.dispose()}
 })
})
