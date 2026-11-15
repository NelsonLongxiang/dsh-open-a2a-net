import {describe,it,expect,vi,afterEach} from 'vitest'
import {generateKeyPairSync,createPublicKey} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdtempSync} from '../temp-dirs.ts'
import {RequestRecoveryStore,signRecoveryProposal,recoveryFingerprint,verifyRecoveryPermit,verifyRecoveryProposal,recoveryClaimMatches,type RecoveryBinding,type RecoveryClaim} from '../../src/request-recovery.ts'
const disk=vi.hoisted(()=>({fail:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(path:string,bytes:string)=>{if(disk.fail)throw Error('disk denied');actual.writeTaskLedger(path,bytes)}}})
afterEach(()=>{disk.fail=false;vi.restoreAllMocks()})
const key=()=>generateKeyPairSync('ed25519').privateKey
const pub=(k:ReturnType<typeof key>)=>createPublicKey(k).export({format:'der',type:'spki'}).toString('base64')
function fixture(){const sender=key(),receiver=key(),cli=key();let now=1_700_000_000_000;const file=join(mkdtempSync(join(tmpdir(),'one-request-')),'recovery.json'),store=new RequestRecoveryStore(file,()=>now)
 const binding:RecoveryBinding={version:1,requestId:'rr-original',ticketId:'ticket',originalCards:['card-first','card-second'],originalTasks:['direct-first','direct-second'],approvalDigest:'a'.repeat(64),approvalAt:new Date(now-1000).toISOString(),senderReconciliation:'sender owner checked both original attempts and original principal',caller:'superagent-team/0123456789abcdef',cliKey:pub(cli),senderHome:'https://sender.test',senderKey:pub(sender),receiverHome:'https://receiver.test',receiverKey:pub(receiver),receiverSession:'session-aaaaaaaa11112222',target:'beta/aaaaaaaa',message:'exact original body',taskId:'recover-original',contextId:'recovery-original'}
 const proposal=signRecoveryProposal(binding,sender),claim:RecoveryClaim={caller:binding.caller,hostKey:binding.senderKey,home:binding.senderHome,cliKey:binding.cliKey,targetSession:binding.receiverSession,receiverKey:binding.receiverKey,team:binding.target,message:binding.message,taskId:binding.taskId,contextId:binding.contextId,noWait:true}
 return{sender,receiver,binding,proposal,claim,file,store,tick:(ms:number)=>{now+=ms},reopen:()=>new RequestRecoveryStore(file,()=>now),grant:()=>store.grant(proposal,receiver,'receiver owner checked original attempts and stopped the old chain',true)}
}
describe('owner-reconciled one-request admission',()=>{
 it('one original request fence cannot block another caller or target that reuses an old task id',()=>{
  const f=fixture();f.grant();const b=f.binding
  expect(f.store.fences(b.caller,b.target,'different body',b.originalTasks[0]!)).toBe(true)
  expect(f.store.fences('another-team/0123456789abcdef',b.target,b.message,b.originalTasks[0]!)).toBe(false)
  expect(f.store.fences(b.caller,'beta/bbbbbbbb',b.message,b.originalTasks[0]!)).toBe(false)
 })
 it('withdrawing the original peer link ends authority without erasing factual acceptance',()=>{
  const f=fixture(),p=f.grant(),b=f.binding;f.store.consume(p,f.claim);f.store.confirm(b.requestId)
  expect(f.store.authority(b.requestId,b.caller,b.target,b.receiverKey,b.taskId,b.receiverSession,b.receiverHome,()=>false)).toBe(false)
  expect(f.store.outcome(b.taskId,recoveryFingerprint(b))).toBe('accepted')
 })

 it('revocation preserves already accepted delivery but never reopens authority or an effect',()=>{
  const f=fixture(),p=f.grant(),b=f.binding;f.store.consume(p,f.claim);f.store.confirm(b.requestId)
  expect(f.store.authority(b.requestId,b.caller,b.target,b.receiverKey,b.taskId,b.receiverSession,b.receiverHome)).toBe(true)
  for(const [task,session,home]of [['other',b.receiverSession,b.receiverHome],[b.taskId,'other',b.receiverHome],[b.taskId,b.receiverSession,'https://other.test']])expect(f.store.authority(b.requestId,b.caller,b.target,b.receiverKey,task,session,home)).toBe(false)
  f.store.revoke(b.requestId);expect(f.reopen().authority(b.requestId,b.caller,b.target,b.receiverKey,b.taskId,b.receiverSession,b.receiverHome)).toBe(false)
  expect(f.reopen().outcome(b.taskId,recoveryFingerprint(b))).toBe('accepted');expect(()=>f.store.consume(p,f.claim)).toThrow()
 })

 it('binds both old attempts and exact original principals without granting standing team membership',()=>{const f=fixture(),p=f.grant();expect(verifyRecoveryProposal(f.proposal)).toEqual(f.proposal);expect(verifyRecoveryPermit(p)).toEqual(p);expect(f.store.inspect(p,f.claim)).toEqual(f.binding);expect(f.store.fences(f.binding.caller,f.binding.target,f.binding.message,'unrelated-new-id')).toBe(true);expect(f.store.fences(f.binding.caller,f.binding.target,'unrelated body','other')).toBe(false)})
 it.each(['message','taskId','contextId','team','home','hostKey','cliKey','targetSession','receiverKey','caller'] as const)('rejects a changed %s before any effect',field=>{const f=fixture(),p=f.grant(),claim={...f.claim,[field]:'changed'};expect(recoveryClaimMatches(f.binding,claim)).toBe(false);expect(()=>f.store.consume(p,claim)).toThrow();expect(f.store.inspect(p,f.claim)).toEqual(f.binding)})
 it('rejects changed signatures, noWait, callback, missing owner reconciliation and wrong receiver',()=>{const f=fixture();expect(()=>f.store.grant(f.proposal,f.receiver,'checked',false)).toThrow();expect(()=>f.store.grant(f.proposal,key(),'checked',true)).toThrow();const p=f.grant();expect(()=>f.store.consume(p,{...f.claim,noWait:false})).toThrow();expect(()=>f.store.consume(p,{...f.claim,callback:'another'})).toThrow();expect(verifyRecoveryPermit({...p,expiresAt:p.expiresAt+1})).toBeUndefined();expect(verifyRecoveryProposal({...f.proposal,binding:{...f.binding,message:'changed'}})).toBeUndefined()})
 it('consumes durably once, retains exact fences across restart, and never renews a used permit',()=>{const f=fixture(),p=f.grant();expect(f.store.consume(p,f.claim)).toEqual(f.binding);expect(()=>f.reopen().consume(p,f.claim)).toThrow();expect(()=>f.reopen().grant(f.proposal,f.receiver,'checked again',true)).toThrow();expect(f.reopen().fences(f.binding.caller,f.binding.target,f.binding.message,'new-id')).toBe(true)})
 it('does not consume on write failure and preserves the committed record byte-for-byte',()=>{const f=fixture(),p=f.grant(),before=readFileSync(f.file,'utf8');disk.fail=true;expect(()=>f.store.consume(p,f.claim)).toThrow('disk denied');expect(readFileSync(f.file,'utf8')).toBe(before);disk.fail=false;expect(f.reopen().consume(p,f.claim)).toEqual(f.binding)})
 it('keeps expired or revoked original-request fences but never admits them',()=>{const f=fixture(),p=f.grant();f.tick(3_600_001);expect(()=>f.store.consume(p,f.claim)).toThrow();expect(f.store.fences(f.binding.caller,f.binding.target,f.binding.message,'new-id')).toBe(true);expect(()=>f.store.grant(f.proposal,f.receiver,'renew',true)).toThrow()})
 it('phase-only corruption is fail-closed and is not treated as a fresh grant',()=>{const f=fixture(),p=f.grant();f.store.consume(p,f.claim);const raw=JSON.parse(readFileSync(f.file,'utf8'));raw.entries[0].phase='ready';writeFileSync(f.file,JSON.stringify(raw));expect(()=>f.reopen().inspect(p,f.claim)).toThrow('corrupt')})
 it('a second instance cannot consume the same committed permit after the first',()=>{const f=fixture(),p=f.grant(),other=f.reopen();f.store.consume(p,f.claim);expect(()=>other.consume(p,f.claim)).toThrow()})
})
