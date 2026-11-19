/** Owner-only continuation of exact retained legacy cards; no business reapproval or standing admission. */
import {randomUUID} from 'node:crypto'
import {recoveryDigest,verifyRecoveryProposal,verifyRecoveryPermit,type RecoveryBinding,type RecoveryProposal,type RecoveryPermit} from '../../request-recovery.ts'
import {narrowRecoveryDigest,type OutboundRecord,type OutboundRequests} from './outbound.ts'
import type {LegacyApproval} from './legacy-outbound-approval.ts'
export interface NarrowIdentity {caller:string;cliKey:string;senderHome:string;senderKey:string}
export interface NarrowRecoveryDeps {
 outbound:OutboundRequests
 approval:(record:Readonly<OutboundRecord>)=>LegacyApproval|undefined
 identity:()=>NarrowIdentity|undefined
 proposal:(binding:RecoveryBinding)=>Promise<RecoveryProposal>
 transport:(permit:RecoveryPermit,mode:'send'|'query',stillApproved:()=>boolean)=>Promise<{accepted:boolean;ready?:boolean}>
 now:()=>number
}
export class NarrowOutboundRecovery {
 constructor(private readonly d:NarrowRecoveryDeps){}
 private original(card:string,task:string):{records:OutboundRecord[];approvals:LegacyApproval[];identity:NarrowIdentity} {
  const all=this.d.outbound.recoveryRecords(),r=all.find(x=>x.card===card)
  if(!r||r.task!==task||!task||r.state!=='failed'||r.answer)throw Error('original failed outbound changed or already answered')
  const records=all.filter(x=>x.ticketId===r.ticketId&&x.address===r.address&&x.text===r.text).sort((a,b)=>a.card.localeCompare(b.card))
  if(records.length<1||records.length>20||records.some(x=>x.state!=='failed'||x.answer||!x.task||x.by!==r.by))throw Error('all original same-request attempts must be failed and retained')
  const approvals=records.map(x=>this.d.approval(x))
  if(approvals.some(a=>!a)||new Set(approvals.map(a=>a!.message)).size!==1)throw Error('retained original approval is unavailable or inconsistent')
  const identity=this.d.identity();if(!identity)throw Error('original team identity/source unavailable')
  return {records,approvals:approvals as LegacyApproval[],identity}
 }
 private matches(binding:RecoveryBinding,original:ReturnType<NarrowOutboundRecovery['original']>):boolean {
  const {records,approvals,identity}=original
  return binding.ticketId===records[0]!.ticketId&&binding.target===records[0]!.address&&binding.message===approvals[0]!.message&&binding.approvalAt===approvals[0]!.at&&binding.approvalDigest===recoveryDigest(approvals.map(a=>a.digest))&&JSON.stringify(binding.originalCards)===JSON.stringify(records.map(r=>r.card))&&JSON.stringify(binding.originalTasks)===JSON.stringify(records.map(r=>r.task))&&Object.entries(identity).every(([k,v])=>binding[k as keyof RecoveryBinding]===v)
 }
 async prepare(card:string,task:string,receiver:{home:string;key:string;session:string},reconciliation:string):Promise<RecoveryProposal> {
  if(typeof reconciliation!=='string'||reconciliation.trim().length<1||reconciliation.length>2000||/[\u0000-\u001f\u007f]/.test(reconciliation))throw Error('sender-owner original-chain reconciliation required')
  const original=this.original(card,task),{records,approvals,identity}=original
  const prior=records[0]!.narrowRecovery
  if(prior){const p=verifyRecoveryProposal(prior.proposal);if(!p||p.binding.receiverHome!==receiver.home||p.binding.receiverKey!==receiver.key||p.binding.receiverSession!==receiver.session||p.binding.senderReconciliation!==reconciliation||!this.matches(p.binding,original)||records.some(r=>!r.narrowRecovery||r.narrowRecovery.digest!==narrowRecoveryDigest(r.narrowRecovery)||recoveryDigest(r.narrowRecovery.proposal)!==recoveryDigest(p)))throw Error('original recovery chain corrupt');return p}
  if(records.some(r=>r.narrowRecovery))throw Error('inconsistent original recovery group')
  const requestId='rr-'+randomUUID(),binding:RecoveryBinding={version:1,requestId,ticketId:records[0]!.ticketId,originalCards:records.map(r=>r.card),originalTasks:records.map(r=>r.task!),approvalDigest:recoveryDigest(approvals.map(a=>a.digest)),approvalAt:approvals[0]!.at,senderReconciliation:reconciliation,...identity,receiverHome:receiver.home,receiverKey:receiver.key,receiverSession:receiver.session,target:records[0]!.address,message:approvals[0]!.message,taskId:'recover-'+randomUUID(),contextId:'recovery-'+requestId}
  const proposal=await this.d.proposal(binding)
  if(!this.matches(proposal.binding,this.original(card,task))||recoveryDigest(proposal.binding)!==recoveryDigest(binding))throw Error('original approval or identity changed during preparation')
  this.d.outbound.bindNarrowRecovery(records,proposal)
  return proposal
 }
 async run(card:string,task:string,raw:unknown,retry:boolean):Promise<{ok:boolean;state:string;task:string;query?:'ready'|'unknown'|'unavailable';phase?:string;error?:string}> {
  const permit=verifyRecoveryPermit(raw);if(!permit)throw Error('invalid exact receiver permit')
  const original=this.original(card,task),b=permit.proposal.binding
  if(!this.matches(b,original)||original.records.some(r=>!r.narrowRecovery||recoveryDigest(r.narrowRecovery.proposal)!==recoveryDigest(permit.proposal)||r.narrowRecovery.digest!==narrowRecoveryDigest(r.narrowRecovery)))throw Error('permit differs from retained original chain')
  const phases=new Set(original.records.map(r=>r.narrowRecovery!.phase));if(phases.size!==1)throw Error('inconsistent recovery phase')
  const phase=original.records[0]!.narrowRecovery!.phase
  if(phase==='accepted'||phase==='answered')return {ok:true,state:phase,task:b.taskId}
  const stillApproved=()=>{try{return this.matches(b,this.original(card,task))}catch{return false}}
  if(!retry||phase!=='prepared'){
   let result:{accepted:boolean;ready?:boolean};try{result=await this.d.transport(permit,'query',stillApproved)}catch{return {ok:false,state:'unknown',task:b.taskId,query:'unavailable',phase,error:'original continuation query unavailable; no resend'}}
   if(result.accepted){if(!stillApproved())throw Error('approval changed while reconciling');this.d.outbound.narrowPhase(this.original(card,task).records,'accepted');return {ok:true,state:'accepted',task:b.taskId}}
   const fresh=this.original(card,task),freshPhases=new Set(fresh.records.map(r=>r.narrowRecovery?.phase))
   if(!this.matches(b,fresh))throw Error('original chain changed during query')
   if(result.ready&&freshPhases.size===1&&freshPhases.has('prepared')&&this.d.now()>=permit.issuedAt&&this.d.now()<permit.expiresAt)return {ok:true,state:'prepared',task:b.taskId,query:'ready',phase:'prepared'}
   return {ok:false,state:'unknown',task:b.taskId,query:'unknown',phase:freshPhases.size===1?fresh.records[0]!.narrowRecovery!.phase:'inconsistent',error:'original recovery delivery remains unknown; no second POST permitted'}
  }
  if(this.d.now()<permit.issuedAt||this.d.now()>=permit.expiresAt)throw Error('receiver permit expired')
  this.d.outbound.narrowPhase(original.records,'dispatching')
  try{
   const result=await this.d.transport(permit,'send',stillApproved)
   if(!stillApproved())throw Error('approval changed during dispatch')
   this.d.outbound.narrowPhase(this.original(card,task).records,result.accepted?'accepted':'unknown')
   return {ok:result.accepted,state:result.accepted?'accepted':'unknown',task:b.taskId}
  }catch{
   try{this.d.outbound.narrowPhase(this.original(card,task).records,'unknown')}catch{/* retained dispatch checkpoint refuses another send */}
   return {ok:false,state:'unknown',task:b.taskId,error:'reconcile only this original continuation task; no business resend'}
  }
 }
}
