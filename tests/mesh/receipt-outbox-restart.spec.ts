import {it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {bootNode,reservePort,runContext,type MeshNode} from './harness.ts'
const disk=vi.hoisted(()=>({path:'',fail:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(disk.fail&&path===disk.path)throw Object.assign(Error('test disk denied'),{code:'EACCES'});actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{disk.fail=false;disk.path='';vi.restoreAllMocks()})
const nativeFetch=globalThis.fetch.bind(globalThis)
const state=(n:MeshNode)=>nativeFetch(n.baseUrl+'/__dsh_a2a/state',{headers:{Connection:'close'}}).then(r=>r.json()) as Promise<any>
const joinNode=(n:MeshNode)=>nativeFetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',headers:{Connection:'close'},body:JSON.stringify({id:String(n.agents.agent!.id)})}).then(r=>r.json())
const finish=(n:MeshNode,task:string)=>{n.agents.agent!.session.events.push({type:'turn/start'},{type:'user/message',data:{content:[{type:'text',text:'[A2A direct] (task '+task+') from caller sent:'}]}},{type:'assistant/message',data:{message:{content:[{type:'text',text:'single original answer'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}});n.ctx.emit('agent/status',{agent:n.agents.agent!,status:'idle'})}
it('durable original receipt survives restart and route recovery without executing the work or creating another transport',async()=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'outboxA',session:'outboxA',team:'alpha',port:pa,peers:[bu],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
 let b=await bootNode({name:'outboxB',session:'outboxB',team:'beta',port:pb,peers:[au],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
 let time=Date.now(),clock:ReturnType<typeof vi.spyOn>|undefined,unreachable=true;const posts:string[]=[]
 try{
  await joinNode(a);await joinNode(b)
  const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'execute this work once',async:true},runContext(a.agents.agent)) as any
  expect(sent.ok).toBe(true);expect(b.steered).toHaveLength(1)
  vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url)===au+'/.well-known/agent-card.json'&&unreachable)return Promise.reject(Error('home offline'));if(String(url)===au+'/a2a/direct'&&init?.method==='POST'&&String(init.body).includes('[A2A receipt] task '+sent.task_id))posts.push(String(init.body));return nativeFetch(url,init)})
  finish(b,sent.task_id)
  await vi.waitFor(async()=>expect((await state(b)).tasks.find((row:any)=>row.taskId===sent.task_id)).toMatchObject({answeredAt:expect.any(Number),receiptDelivery:'receipt-undelivered',receiptRecovery:{state:'retained',code:'RECEIPT_ROUTE_UNAVAILABLE'}}))
  const file=join(b.home,'a2a/tasks.json'),saved=JSON.parse(readFileSync(file,'utf8')),receipt=saved.receiptOutbox[0],home=b.home
  expect(receipt.text).toContain('single original answer');expect(receipt.attempts).toBe(0);expect(posts).toHaveLength(0)
  await b.dispose();unreachable=false;time=receipt.nextAt+1;clock=vi.spyOn(Date,'now').mockImplementation(()=>time)
  b=await bootNode({home,name:'outboxB',session:'outboxB',team:'beta',port:pb,peers:[au],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
  await vi.waitFor(async()=>expect((await state(b)).archived.some((row:any)=>row.taskId===sent.task_id)).toBe(true),{timeout:4000})
  expect(posts).toHaveLength(1);const body=JSON.parse(posts[0]!);expect(body.task_id).toBe(receipt.transportId);expect(body.message).toBe(receipt.text);expect(body.caller_session).toBe(receipt.caller)
  expect(b.steered.some(p=>JSON.stringify(p).includes('execute this work once'))).toBe(false)
  expect(a.steered.filter(p=>JSON.stringify(p).includes('[A2A receipt] task '+sent.task_id))).toHaveLength(1)
  expect((await state(a)).archived.filter((row:any)=>row.taskId===sent.task_id)).toHaveLength(1)
 }finally{clock?.mockRestore();await b.dispose();await a.dispose()}
})
it('terminal receipt reservation write failure causes zero return traffic and keeps original debt unconsumed',async()=>{
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({name:'diskA',session:'diskA',team:'alpha',port:pa,peers:[bu],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'diskB',session:'diskB',team:'beta',port:pb,peers:[au],silent:true,sessionNodes:true,teamScopeRouting:false,asyncNudgeDelayMs:86400000})
 try{
  await joinNode(a);await joinNode(b)
  const sent=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'one work',async:true},runContext(a.agents.agent)) as any;expect(sent.ok).toBe(true)
  const file=join(b.home,'a2a/tasks.json'),before=readFileSync(file,'utf8');disk.path=file;disk.fail=true;let returns=0
  const spy=vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{if(String(url)===au+'/a2a/direct'&&init?.method==='POST')returns++;return nativeFetch(url,init)})
  const answer='[A2A receipt] task '+sent.task_id+' completed original'
  const failed=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:answer,async:true},runContext(b.agents.agent)) as any
  expect(failed.ok).toBe(false);expect(failed.error).toContain('durably reserved');expect(returns).toBe(0);expect(readFileSync(file,'utf8')).toBe(before)
  disk.fail=false;spy.mockRestore()
  const original=(await state(b)).tasks.find((row:any)=>row.taskId===sent.task_id);expect(original.answeredAt).toBeUndefined();expect(original.receiptDelivery).toBeUndefined()
  const paid=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:answer,async:true},runContext(b.agents.agent)) as any
  expect(paid.ok,JSON.stringify(paid)).toBe(true);expect((await state(a)).archived.some((row:any)=>row.taskId===sent.task_id)).toBe(true)
 }finally{disk.fail=false;await b.dispose();await a.dispose()}
})
