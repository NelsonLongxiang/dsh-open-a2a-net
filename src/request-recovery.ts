/** Owner-reconciled, one-request recovery. Never creates standing team membership or infers non-delivery from absence. */
import {createHash,createPublicKey,randomUUID,sign,verify,type KeyObject} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,rmSync,mkdirSync,statSync} from 'node:fs'
import {dirname} from 'node:path'
import {writeTaskLedger} from './task-ledger-persistence.ts'
import {peerPayloadFingerprint} from './idempotency-store.ts'
import {parseReceipt,taskIdRefusal} from './receipt.ts'

export const RECOVERY_PERMIT_MAX_MS=60*60_000
export const REQUEST_RECOVERY_CAP=128
export interface RecoveryBinding {
 version:1
 requestId:string
 ticketId:string
 originalCards:readonly string[]
 originalTasks:readonly string[]
 approvalDigest:string
 approvalAt:string
 senderReconciliation:string
 caller:string
 cliKey:string
 senderHome:string
 senderKey:string
 receiverHome:string
 receiverKey:string
 receiverSession:string
 target:string
 message:string
 taskId:string
 contextId:string
}
export interface RecoveryProposal {binding:RecoveryBinding;signature:string}
export interface RecoveryPermit {proposal:RecoveryProposal;issuedAt:number;expiresAt:number;reconciliation:string;signature:string}
export interface RecoveryClaim {caller:string;hostKey:string;home:string;cliKey:string;targetSession:string;receiverKey:string;team:string;message:string;taskId:string;contextId:string;noWait:boolean;callback?:string}
interface RecoveryEntry {permit:RecoveryPermit;phase:'ready'|'consumed'|'accepted'|'revoked';at:number;revokedAt?:number;digest:string}
const entryDigest=(e:Omit<RecoveryEntry,'digest'>):string=>recoveryDigest([e.permit,e.phase,e.at,e.revokedAt??null])
export const recoveryDigest=(v:unknown):string=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const text=(v:unknown,n=512):v is string=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v)
const origin=(v:unknown):v is string=>{try{if(!text(v,2048))return false;const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&u.origin===v&&!u.username&&!u.password}catch{return false}}
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)
function key(v:unknown):v is string {if(!text(v))return false;try{return createPublicKey({key:Buffer.from(v,'base64'),format:'der',type:'spki'}).asymmetricKeyType==='ed25519'}catch{return false}}
function publicKey(k:KeyObject):string{return createPublicKey(k).export({format:'der',type:'spki'}).toString('base64')}
export function parseRecoveryBinding(raw:unknown):RecoveryBinding|undefined {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
 const r=raw as RecoveryBinding
 if(r.version!==1||!text(r.requestId,80)||!text(r.ticketId,128)||!sha(r.approvalDigest)||!text(r.approvalAt,64)||!Number.isFinite(Date.parse(r.approvalAt))||!text(r.senderReconciliation,2000))return undefined
 if(!Array.isArray(r.originalCards)||!Array.isArray(r.originalTasks)||r.originalCards.length<1||r.originalCards.length>20||r.originalCards.length!==r.originalTasks.length||new Set(r.originalCards).size!==r.originalCards.length||new Set(r.originalTasks).size!==r.originalTasks.length)return undefined
 if(r.originalCards.some(v=>!text(v,100))||r.originalTasks.some(v=>!text(v,80)||taskIdRefusal(v)!==undefined))return undefined
 if(!text(r.caller,256)||!/^superagent-team\/[0-9a-f]{16}$/.test(r.caller)||!key(r.cliKey)||!key(r.senderKey)||!key(r.receiverKey)||!origin(r.senderHome)||!origin(r.receiverHome)||r.senderKey===r.receiverKey)return undefined
 if(!text(r.receiverSession,256)||!text(r.target,256)||!/^[a-z0-9-]+\/[0-9a-f]{8}$/i.test(r.target)||!text(r.taskId,80)||taskIdRefusal(r.taskId)!==undefined||r.originalTasks.includes(r.taskId)||!text(r.contextId,128))return undefined
 if(typeof r.message!=='string'||Buffer.byteLength(r.message)>16000||r.message.length===0||parseReceipt(r.message)!==null)return undefined
 return {version:1,requestId:r.requestId,ticketId:r.ticketId,originalCards:[...r.originalCards],originalTasks:[...r.originalTasks],approvalDigest:r.approvalDigest,approvalAt:r.approvalAt,senderReconciliation:r.senderReconciliation,caller:r.caller,cliKey:r.cliKey,senderHome:r.senderHome,senderKey:r.senderKey,receiverHome:r.receiverHome,receiverKey:r.receiverKey,receiverSession:r.receiverSession,target:r.target,message:r.message,taskId:r.taskId,contextId:r.contextId}
}
export function recoveryPayload(binding:RecoveryBinding):string{return JSON.stringify(binding)}
function verifyBytes(value:string,signature:unknown,k:string):boolean {try{return text(signature,256)&&verify(null,Buffer.from(value),createPublicKey({key:Buffer.from(k,'base64'),format:'der',type:'spki'}),Buffer.from(signature,'base64'))}catch{return false}}
export function verifyRecoveryProposal(raw:unknown):RecoveryProposal|undefined {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
 const r=raw as RecoveryProposal,binding=parseRecoveryBinding(r.binding)
 if(!binding||!verifyBytes('a2a-request-recovery-proposal-v1\0'+recoveryPayload(binding),r.signature,binding.senderKey))return undefined
 return {binding,signature:r.signature}
}
export function signRecoveryProposal(binding:RecoveryBinding,k:KeyObject):RecoveryProposal {
 const parsed=parseRecoveryBinding(binding);if(!parsed||publicKey(k)!==parsed.senderKey)throw Error('recovery proposal identity mismatch')
 return {binding:parsed,signature:sign(null,Buffer.from('a2a-request-recovery-proposal-v1\0'+recoveryPayload(parsed)),k).toString('base64')}
}
const permitPayload=(p:Omit<RecoveryPermit,'signature'>):string=>JSON.stringify([p.proposal,p.issuedAt,p.expiresAt,p.reconciliation])
export function verifyRecoveryPermit(raw:unknown):RecoveryPermit|undefined {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
 const r=raw as RecoveryPermit,proposal=verifyRecoveryProposal(r.proposal)
 if(!proposal||!Number.isSafeInteger(r.issuedAt)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=r.issuedAt||r.expiresAt-r.issuedAt>RECOVERY_PERMIT_MAX_MS||!text(r.reconciliation,2000))return undefined
 const p={proposal,issuedAt:r.issuedAt,expiresAt:r.expiresAt,reconciliation:r.reconciliation}
 if(!verifyBytes('a2a-request-recovery-permit-v1\0'+permitPayload(p),r.signature,proposal.binding.receiverKey))return undefined
 return {...p,signature:r.signature}
}
export function recoveryClaimMatches(b:RecoveryBinding,c:RecoveryClaim):boolean {
 return b.caller===c.caller&&b.senderKey===c.hostKey&&b.senderHome===c.home&&b.cliKey===c.cliKey&&b.receiverKey===c.receiverKey&&b.receiverSession===c.targetSession&&b.target===c.team&&b.message===c.message&&b.taskId===c.taskId&&b.contextId===c.contextId&&c.noWait&&(!c.callback||c.callback===b.caller)
}
export function recoveryFingerprint(b:RecoveryBinding):string{return peerPayloadFingerprint({caller:b.caller,team:b.target,message:b.message,noWait:true})}
/** One host writes this file. A disk-CAS lock protects independent in-process instances and a crash never grants replay. */
export class RequestRecoveryStore {
 constructor(private readonly path:string,private readonly now:()=>number=()=>Date.now()){}
 private read():RecoveryEntry[]{
  if(!existsSync(this.path))return []
  if(statSync(this.path).size>4*1024*1024)throw Error('request recovery journal exceeds bound')
  const raw:unknown=JSON.parse(readFileSync(this.path,'utf8'))
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||(raw as {version?:unknown}).version!==1)throw Error('request recovery journal corrupt')
  const entries=(raw as {entries?:unknown}).entries
  if(!Array.isArray(entries)||entries.length>REQUEST_RECOVERY_CAP)throw Error('request recovery journal corrupt')
  const seen=new Set<string>(),out:RecoveryEntry[]=[]
  for(const e of entries){const permit=verifyRecoveryPermit(e?.permit);if(!permit||!['ready','consumed','accepted','revoked'].includes(e.phase)||!Number.isSafeInteger(e.at)||seen.has(permit.proposal.binding.requestId)||(e.revokedAt!==undefined&&(!Number.isSafeInteger(e.revokedAt)||e.revokedAt<0))||e.digest!==entryDigest({permit,phase:e.phase,at:e.at,...(e.revokedAt!==undefined?{revokedAt:e.revokedAt}:{})}))throw Error('request recovery journal corrupt');seen.add(permit.proposal.binding.requestId);out.push({permit,phase:e.phase,at:e.at,...(e.revokedAt!==undefined?{revokedAt:e.revokedAt}:{}),digest:e.digest})}
  return out
 }
 private update<T>(fn:(entries:RecoveryEntry[])=>T):T {
  mkdirSync(dirname(this.path),{recursive:true});const lock=this.path+'.lock',token=randomUUID()
  writeFileSync(lock,token,{flag:'wx',mode:0o600})
  try{const entries=this.read(),result=fn(entries),bytes=JSON.stringify({version:1,entries});if(Buffer.byteLength(bytes)>4*1024*1024)throw Error('request recovery journal exceeds bound');writeTaskLedger(this.path,bytes);return result}finally{if(readFileSync(lock,'utf8')===token)rmSync(lock)}
 }
 grant(raw:unknown,receiver:KeyObject,reconciliation:string,checkedNotAdmitted:boolean,ttl=RECOVERY_PERMIT_MAX_MS):RecoveryPermit {
  const proposal=verifyRecoveryProposal(raw)
  if(!proposal||publicKey(receiver)!==proposal.binding.receiverKey||!checkedNotAdmitted||!text(reconciliation,2000)||!Number.isSafeInteger(ttl)||ttl<1000||ttl>RECOVERY_PERMIT_MAX_MS)throw Error('owner reconciliation and exact receiver binding required')
  return this.update(entries=>{
   const b=proposal.binding,old=entries.find(e=>e.permit.proposal.binding.requestId===b.requestId)
   if(old){if(recoveryDigest(old.permit.proposal)!==recoveryDigest(proposal)||old.phase!=='ready'||old.revokedAt!==undefined||old.permit.expiresAt<=this.now())throw Error('original recovery grant cannot be replaced or renewed');return old.permit}
   if(entries.some(e=>{const x=e.permit.proposal.binding;return x.taskId===b.taskId||x.originalTasks.some(t=>b.originalTasks.includes(t))||x.caller===b.caller&&recoveryFingerprint(x)===recoveryFingerprint(b)}))throw Error('original request already has a recovery fence')
   if(entries.length>=REQUEST_RECOVERY_CAP)throw Error('request recovery capacity reached; maintenance required')
   const issuedAt=this.now()
   const p={proposal,issuedAt,expiresAt:issuedAt+ttl,reconciliation},permit={...p,signature:sign(null,Buffer.from('a2a-request-recovery-permit-v1\0'+permitPayload(p)),receiver).toString('base64')}
   const entry={permit,phase:'ready' as const,at:this.now()};entries.push({...entry,digest:entryDigest(entry)});return permit
  })
 }
 inspect(raw:unknown,claim:RecoveryClaim):RecoveryBinding {
  const permit=verifyRecoveryPermit(raw),entry=permit&&this.read().find(e=>e.permit.proposal.binding.requestId===permit.proposal.binding.requestId)
  if(!permit||!entry||recoveryDigest(entry.permit)!==recoveryDigest(permit)||entry.phase!=='ready'||entry.revokedAt!==undefined||permit.expiresAt<=this.now()||this.now()<permit.issuedAt||!recoveryClaimMatches(permit.proposal.binding,claim))throw Error('one-request recovery permit is unavailable, consumed or mismatched')
  return permit.proposal.binding
 }
 consume(raw:unknown,claim:RecoveryClaim):RecoveryBinding {
  const permit=verifyRecoveryPermit(raw);if(!permit)throw Error('invalid request recovery permit')
  return this.update(entries=>{const e=entries.find(x=>x.permit.proposal.binding.requestId===permit.proposal.binding.requestId);if(!e||e.phase!=='ready'||e.revokedAt!==undefined||recoveryDigest(e.permit)!==recoveryDigest(permit)||permit.expiresAt<=this.now()||this.now()<permit.issuedAt||!recoveryClaimMatches(permit.proposal.binding,claim))throw Error('request recovery permit cannot authorize another effect');e.phase='consumed';e.at=this.now();e.digest=entryDigest(e);return permit.proposal.binding})
 }
 confirm(requestId:string):void {this.update(entries=>{const e=entries.find(x=>x.permit.proposal.binding.requestId===requestId);if(!e||e.phase!=='consumed')throw Error('acceptance requires its consumed checkpoint');e.phase='accepted';e.at=this.now();e.digest=entryDigest(e)})}
 outcome(taskId:string,fingerprint:string):'ready'|'unknown'|'accepted'|undefined {
  const e=this.read().find(x=>x.permit.proposal.binding.taskId===taskId&&recoveryFingerprint(x.permit.proposal.binding)===fingerprint)
  return !e?undefined:e.phase==='accepted'?'accepted':e.phase==='ready'&&e.revokedAt===undefined&&e.permit.issuedAt<=this.now()&&this.now()<e.permit.expiresAt?'ready':'unknown'
 }
 authority(requestId:string,caller:string,target:string,receiverKey:string,taskId:string,receiverSession:string,home:string,peerLinked:(home:string,key:string)=>boolean=()=>true):boolean {
  const e=this.read().find(x=>x.permit.proposal.binding.requestId===requestId),b=e?.permit.proposal.binding
  return !!e&&!!b&&e.revokedAt===undefined&&(e.phase==='consumed'||e.phase==='accepted')&&b.caller===caller&&b.target===target&&b.receiverKey===receiverKey&&b.taskId===taskId&&b.receiverSession===receiverSession&&b.receiverHome===home&&peerLinked(b.senderHome,b.senderKey)
 }
 revoke(requestId:string):void {this.update(entries=>{const e=entries.find(x=>x.permit.proposal.binding.requestId===requestId);if(!e)throw Error('unknown recovery request');e.revokedAt=this.now();if(e.phase==='ready')e.phase='revoked';e.at=this.now();e.digest=entryDigest(e)})}
 /** These tombstones remain bounded and never silently GC old unknown effects. */
 fences(caller:string,team:string,message:string,taskId:string):boolean {
  const fingerprint=peerPayloadFingerprint({caller,team,message,noWait:true})
  return this.read().some(e=>{const b=e.permit.proposal.binding;return b.caller===caller&&b.target===team&&(b.originalTasks.includes(taskId)||b.taskId===taskId||recoveryFingerprint(b)===fingerprint)})
 }
}
