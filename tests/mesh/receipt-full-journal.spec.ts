/**
 * #708 review R2 (capacity), the reviewer's fixture: a known full recovery journal is an admission condition, not a
 * second disk fault. The session receipt is refused before insertion (the sender keeps it), never inserted with no slot
 * left to record its settlement.
 */
import { it, expect, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from '../temp-dirs.ts'
import { CliDepositStore } from '../../src/cli-deposit.ts'
import { RECEIPT_MAILBOX_CAP, receiptMailboxHash, receiptMailboxBirth } from '../../src/receipt-mailbox.ts'
import { TaskLedger, ARCHIVE_CAP } from '../../src/task-ledger.ts'
import { bootNode, reservePort, runContext } from './harness.ts'
const fault=vi.hoisted(()=>({file:'',task:'',fail:false,hits:0}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{
 const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>()
 return {...actual,writeTaskLedger:(file:string,bytes:string)=>{
  if(fault.fail&&file===fault.file&&JSON.parse(bytes).archived?.some((r:any)=>r.taskId===fault.task&&r.endedBy==='receipt')){fault.hits++;throw Object.assign(Error('one transient original settlement fault'),{code:'EACCES'})}
  return actual.writeTaskLedger(file,bytes)
 }}
})
afterEach(()=>{fault.file='';fault.task='';fault.fail=false;fault.hits=0;vi.restoreAllMocks()})
it('known full journal declines before insertion or retains an inserted receipt for local settlement',async()=>{
 const home=mkdtempSync(join(tmpdir(),'review708-full-journal-'))
 // Build real births/counters in memory, then restore one detached fixture snapshot; the test is not an fsync benchmark.
 const ledger=new TaskLedger('')
 const receiptCommits: import('../../src/receipt-mailbox.ts').ReceiptMailboxCommit[]=[]
 // Restore a full pending journal after ordinary bounded history removed its original task births.
 // The runtime scanner fails closed at the missing-birth check, so these rows cannot be evicted.
 for(let i=0;i<RECEIPT_MAILBOX_CAP;i++){
  const original='retired-original-'+i
  ledger.track(original,'beta/01234567','http://127.0.0.1:1')
  const birth=receiptMailboxBirth(ledger.find(original)!)
  const record={version:1 as const,transportId:'pending-return-'+i,fingerprint:'fingerprint-'+i,handle:'alpha/01234567',targetKey:'session:old-session-'+i,from:'beta/01234567',message:'[A2A receipt] task '+original+' answer',settler:{caller:'beta/01234567',proof:'origin-claim' as const,ingress:'wire' as const},originalBirth:birth,at:Date.now(),phase:'pending' as const}
  receiptCommits.unshift({...record,hash:receiptMailboxHash(record)})
  ledger.cancel(original,'original stopped before recovery scan')
 }
 for(let i=0;i<ARCHIVE_CAP;i++){
  const task='later-archive-'+i
  ledger.track(task,'beta/01234567','http://127.0.0.1:1');ledger.cancel(task,'ordinary later history')
 }
 expect(ledger.archive().some(r=>r.taskId.startsWith('retired-original-'))).toBe(false)
 const state=ledger.conservation()
 expect(state.conserved).toBe(true)
 mkdirSync(join(home,'a2a'),{recursive:true})
 writeFileSync(join(home,'a2a','tasks.json'),JSON.stringify({tasks:ledger.list(),archived:ledger.archive(),conservation:{trackedTotal:state.trackedTotal,archivedByEnd:state.archivedByEnd,archiveTrimmed:state.archiveTrimmed,restoreTrimmed:state.restoreTrimmed}}))
 writeFileSync(join(home,'a2a','cli-deposits.json'),JSON.stringify({deposits:[],mailbox:{},epoch:'full-journal-fixture',nextSeq:{},receiptCommits}))
 const restored=new TaskLedger(join(home,'a2a','tasks.json')),deposits=new CliDepositStore(join(home,'a2a','cli-deposits.json'))
 expect(restored.conservation()).toMatchObject({conserved:true,owed:0,archiveTrimmed:RECEIPT_MAILBOX_CAP})
 expect(restored.archive()).toHaveLength(ARCHIVE_CAP)
 expect(restored.archive().some(r=>r.taskId.startsWith('retired-original-'))).toBe(false)
 expect(deposits.pendingReceiptCommits()).toEqual(receiptCommits)
 expect(deposits.reserveSessionReceiptSlot()).toBeUndefined()
 expect(deposits.pendingReceiptCommits()).toHaveLength(RECEIPT_MAILBOX_CAP)
 const pa=await reservePort(),pb=await reservePort(),au='http://127.0.0.1:'+pa,bu='http://127.0.0.1:'+pb
 const a=await bootNode({home,name:'full-journal-A',session:'full-journal-A',team:'alpha',port:pa,peers:[bu],sessionNodes:true,teamScopeRouting:false,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 const b=await bootNode({name:'full-journal-B',session:'full-journal-B',team:'beta',port:pb,peers:[au],sessionNodes:true,teamScopeRouting:false,silent:true,settlementAuth:'enforce',asyncNudgeDelayMs:86400000})
 let clock:ReturnType<typeof vi.spyOn>|undefined
 try{
  for(const n of[a,b])await fetch(n.baseUrl+'/__dsh_a2a/join',{method:'POST',body:JSON.stringify({id:String(n.agents.agent!.id)})})
  const work=await a.ctx.tools.get('a2a_route')!.execute({team:'beta/01234567',message:'new original job',async:true},runContext(a.agents.agent))as any
  expect(work.ok).toBe(true)
  const task=work.task_id,text='[A2A receipt] task '+task+' full-journal result'
  fault.file=join(a.home,'a2a','tasks.json');fault.task=task;fault.fail=true
  const first=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:text,async:true},runContext(b.agents.agent))as any
  const inserted=a.steered.filter(m=>JSON.stringify(m).includes(text)).length
  const journal=JSON.parse(readFileSync(join(home,'a2a','cli-deposits.json'),'utf8')).receiptCommits
  if(inserted>0)expect(fault.hits).toBeGreaterThan(0) // A safe pre-insertion refusal need not attempt settlement.
  fault.fail=false
  const kept=JSON.parse(readFileSync(join(b.home,'a2a','tasks.json'),'utf8')).receiptOutbox.find((r:any)=>r.taskId===task)
  clock=vi.spyOn(Date,'now').mockReturnValue(kept.nextAt+1)
  const retry=await b.ctx.tools.get('a2a_route')!.execute({team:'alpha/01234567',message:text,async:true},runContext(b.agents.agent))as any
  const caller=await fetch(au+'/__dsh_a2a/state').then(r=>r.json())as any
  const diagnostic={firstOk:first.ok,retryOk:retry.ok,insertions:inserted,journalSize:journal.length,newIntentRetained:journal.some((r:any)=>r.transportId===first.task_id),originalPending:caller.tasks.some((r:any)=>r.taskId===task),originalArchived:caller.archived.some((r:any)=>r.taskId===task),faultHits:fault.hits}
  console.log('full-journal-post-insert',JSON.stringify(diagnostic))
  expect(inserted===0||diagnostic.newIntentRetained||diagnostic.originalArchived,JSON.stringify(diagnostic)).toBe(true)
  expect(a.steered.filter(m=>JSON.stringify(m).includes(text))).toHaveLength(inserted)
  // With a reserved slot required before insertion, the full journal refuses first: nothing in the session, journal as it was.
  expect(inserted,JSON.stringify(diagnostic)).toBe(0)
  expect(first.ok).toBe(false)
  expect(journal).toHaveLength(RECEIPT_MAILBOX_CAP)
  expect(diagnostic.originalPending).toBe(true)
 }finally{fault.fail=false;clock?.mockRestore();await b.dispose();await a.dispose()}
})

