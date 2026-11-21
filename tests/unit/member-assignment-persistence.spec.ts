// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readFileSync} from 'node:fs'
import {mkdtempSync,cleanupBeforeTempDirs} from '../temp-dirs.ts'
import {SuperagentHost} from '../../src/superagent/host/index.ts'
import {routeItem} from '../../src/superagent/host/tools.ts'
const fault=vi.hoisted(()=>({file:'',left:0,hits:0}))
vi.mock('node:fs',async original=>{
 const fs=await original<typeof import('node:fs')>()
 return{...fs,renameSync:(source:any,target:any)=>{if(String(target)===fault.file&&fault.left>0){fault.left--;fault.hits++;throw Object.assign(Error('executor commit refused'),{code:'EACCES'})}return fs.renameSync(source,target)}}
})
afterEach(()=>{fault.file='';fault.left=0;fault.hits=0})
const R='session-a0000000aaaa1111',M='session-b1111111bbbb2222'
const drain=async()=>{for(let i=0;i<8;i++)await new Promise<void>(resolve=>setImmediate(resolve))}
for(const boundary of ['reserve','accepted-save','started-save'] as const)it(`executor commit failure at ${boundary} never automatically duplicates an assignment card`,async()=>{
 const home=mkdtempSync(join(tmpdir(),'assignment-persistence-')),file=join(home,'superagent','executor.json'),sent:string[]=[]
 let arm=true,started=0
 const host=new SuperagentHost({home,canvasTeam:()=>({local:[R,M],remote:[]}),logger:{info(){},warn(){}},interval:()=>()=>{},deliverToSession:(id,text)=>{
  if(id===M&&text.startsWith('[superagent assignment]')){sent.push(text);if(arm&&boundary==='accepted-save'){arm=false;fault.file=file;fault.left=1}}
  return true
 }})
 cleanupBeforeTempDirs(()=>host.stop())
 expect(host.saveSettings({canvas:'fixture',router:R,maxConcurrent:1},()=>true)).toMatchObject({ok:true});host.start()
 const original=host.engine.assignmentStarted.bind(host.engine)
 const spy=vi.spyOn(host.engine,'assignmentStarted').mockImplementation((...args)=>{started++;original(...args);if(arm&&boundary==='started-save'){arm=false;fault.file=file;fault.left=1}})
 const request=host.request('original') as {triggerId:string}
 const out=routeItem(host,{trigger_id:request.triggerId,kind:'accept',title:'original',scope:'fixture',reason:'test'}) as {ticket_id:string}
 if(boundary==='reserve'){fault.file=file;fault.left=1}
 await drain();expect(fault.hits).toBe(1)
 if(boundary==='reserve'){
  expect(sent).toHaveLength(0)
  expect(host.executor.list()).toHaveLength(0)
  host.executor.launch();await drain();expect(sent).toHaveLength(1)
 }else{
  expect(sent).toHaveLength(1)
  expect(host.executor.bindingOf(M)?.ticketId).toBe(out.ticket_id)
  expect(host.executor.bindingOf(M)?.card).toBe('sending')
  host.executor.launch();host.executor.tick();host.memberClaimed(M);host.memberIdle(M);await drain()
  expect(sent).toHaveLength(1)
  expect(JSON.parse(readFileSync(file,'utf8')).bindings[0].card).toBe('sending')
  expect(started).toBe(boundary==='started-save'?1:0)
 }
 spy.mockRestore()
})
