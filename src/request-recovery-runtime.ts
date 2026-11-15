/** Runtime adapter for owner-reconciled single-request recovery; no discovery/team mutation. */
import {createPublicKey,type KeyObject} from 'node:crypto'
import type {Agent} from '@deepseek-ai/dsh-agent'
import type {A2aPeerCard} from './types.ts'
import type {TaskLedger} from './task-ledger.ts'
import {peerPayloadFingerprint,type IdempotencyStore} from './idempotency-store.ts'
import {RequestRecoveryStore,signRecoveryProposal,verifyRecoveryProposal,verifyRecoveryPermit,recoveryFingerprint,type RecoveryBinding,type RecoveryPermit,type RecoveryClaim} from './request-recovery.ts'
export interface RequestRecoveryRuntimeDeps {
 key:KeyObject
 home:()=>string
 ledger:TaskLedger
 idempotency:IdempotencyStore
 store:RequestRecoveryStore
 peer:(home:string)=>Promise<A2aPeerCard|undefined>
 linked:(home:string,key:string)=>boolean
 cli:(home:string,caller:string)=>Promise<A2aPeerCard|undefined>
 localCli:(caller:string)=>A2aPeerCard|undefined
 target:(team:string)=>Agent|undefined
 targetValid:(agent:Agent,team:string)=>boolean
 post:(home:string,path:string,body:Record<string,unknown>)=>Promise<Record<string,unknown>>
 now?:()=>number
}
export class RequestRecoveryRuntime {
 readonly key:string
 constructor(private readonly d:RequestRecoveryRuntimeDeps){this.key=createPublicKey(d.key).export({format:'der',type:'spki'}).toString('base64')}
 identity(caller:string){const cli=this.d.localCli(caller);return cli&&cli.team===caller?{caller,cliKey:cli.publicKey,senderHome:this.d.home(),senderKey:this.key}:undefined}
 private async peer(home:string,key:string,caller?:string,cliKey?:string):Promise<void>{
  const card=await this.d.peer(home)
  if(!card||card.publicKey!==key||!this.d.linked(home,key))throw Error('original recovery peer changed or is not linked')
  if(caller){const cli=await this.d.cli(home,caller);if(!cli||cli.team!==caller||cli.publicKey!==cliKey||!this.d.linked(home,key))throw Error('original recovery CLI changed or is offline')}
 }
 async proposal(binding:RecoveryBinding){
  const identity=this.identity(binding.caller)
  if(!identity||Object.entries(identity).some(([k,v])=>binding[k as keyof RecoveryBinding]!==v))throw Error('original sender identity mismatch')
  await this.peer(binding.receiverHome,binding.receiverKey)
  const fresh=this.identity(binding.caller)
  if(!fresh||Object.entries(fresh).some(([k,v])=>binding[k as keyof RecoveryBinding]!==v)||this.d.home()!==binding.senderHome)throw Error('sender identity unavailable or changed')
  return signRecoveryProposal(binding,this.d.key)
 }
 async grant(raw:unknown,reconciliation:string,checked:boolean):Promise<RecoveryPermit>{
  const proposal=verifyRecoveryProposal(raw);if(!proposal)throw Error('invalid original proposal')
  const b=proposal.binding,target=this.d.target(b.target)
  if(b.receiverKey!==this.key||b.receiverHome!==this.d.home()||!target||String(target.id)!==b.receiverSession||!this.d.targetValid(target,b.target))throw Error('exact original receiver unavailable')
  await this.peer(b.senderHome,b.senderKey,b.caller,b.cliKey)
  if(this.d.target(b.target)!==target||!this.d.targetValid(target,b.target)||b.receiverHome!==this.d.home())throw Error('receiver changed while reconciling')
  // Any retained admission/claim vetoes an absence-based override. Expired/missing records alone never imply not-sent.
  for(const task of [...b.originalTasks,b.taskId])if(this.d.ledger.find(task)||this.d.ledger.archive().some(r=>r.taskId===task)||this.d.ledger.deliveryFor(task)||this.d.idempotency.has(task))throw Error('original attempt already has local admission evidence; reconcile it first')
  // A different transport id cannot hide an admitted original body. Both wait modes are the same business.
  for(const noWait of [true,false])if(this.d.idempotency.hasFingerprint(peerPayloadFingerprint({caller:b.caller,team:b.target,message:b.message,noWait})))throw Error('original payload already has local admission evidence; reconcile it first')
  return this.d.store.grant(proposal,this.d.key,reconciliation,checked)
 }
 async inspect(raw:unknown,input:{caller:string;hostKey:string;home:string;team:string;message:string;taskId:string;contextId:string;noWait:boolean;callback?:string}):Promise<{binding:RecoveryBinding;claim:RecoveryClaim}>{
  const permit=verifyRecoveryPermit(raw);if(!permit)throw Error('invalid request permit')
  const b=permit.proposal.binding,target=this.d.target(input.team)
  if(!target||!this.d.targetValid(target,input.team)||String(target.id)!==b.receiverSession||b.receiverHome!==this.d.home())throw Error('fixed recovery target is not live')
  await this.peer(b.senderHome,b.senderKey,b.caller,b.cliKey)
  if(this.d.target(input.team)!==target||!this.d.targetValid(target,input.team))throw Error('fixed recovery target changed')
  const claim:RecoveryClaim={...input,cliKey:b.cliKey,targetSession:String(target.id),receiverKey:this.key}
  return {binding:this.d.store.inspect(permit,claim),claim}
 }
 consume(raw:unknown,claim:RecoveryClaim,agent:Agent):RecoveryBinding {
  const permit=verifyRecoveryPermit(raw),b=permit?.proposal.binding
  if(!b||this.d.home()!==b.receiverHome||!this.d.linked(b.senderHome,b.senderKey)||this.d.target(claim.team)!==agent||!this.d.targetValid(agent,claim.team)||String(agent.id)!==claim.targetSession)throw Error('recovery authority or target changed before effect')
  return this.d.store.consume(raw,claim)
 }
 confirm(binding:RecoveryBinding):void {this.d.store.confirm(binding.requestId)}
 outcome(task:string,fingerprint:string){return this.d.store.outcome(task,fingerprint)}
 fences(caller:string,team:string,message:string,task:string){return this.d.store.fences(caller,team,message,task)}
 revoke(requestId:string){this.d.store.revoke(requestId)}
 authority(requestId:string,caller:string,target:string,taskId:string|undefined){const agent=this.d.target(target);return !!agent&&!!taskId&&this.d.targetValid(agent,target)&&this.d.store.authority(requestId,caller,target,this.key,taskId,String(agent.id),this.d.home(),(home,key)=>this.d.linked(home,key))}
 receipt(binding:RecoveryBinding,caller:string,message:string):boolean {
  const row=this.d.ledger.archive().find(r=>r.taskId===binding.taskId)
  return !!row&&row.endedBy==='receipt'&&row.direction==='outbound'&&row.team===binding.target&&row.peer===binding.receiverHome&&row.peerKey===binding.receiverKey&&row.deliveredTo===binding.target&&row.contextId===binding.contextId&&row.sender?.kind==='cli'&&row.sender.id===binding.caller&&row.settledBy?.caller===caller&&caller===binding.target&&row.settledBy.chain_role==='target'&&message.includes('[A2A receipt] task '+binding.taskId)
 }
 async transport(raw:RecoveryPermit,mode:'send'|'query',current:()=>boolean):Promise<{accepted:boolean}>{
  const permit=verifyRecoveryPermit(raw);if(!permit)throw Error('invalid receiver permit')
  const b=permit.proposal.binding,identity=this.identity(b.caller)
  if(!identity||Object.entries(identity).some(([k,v])=>b[k as keyof RecoveryBinding]!==v)||!current())throw Error('original sender approval or identity changed')
  await this.peer(b.receiverHome,b.receiverKey)
  const fresh=this.identity(b.caller)
  if(!fresh||Object.entries(fresh).some(([k,v])=>b[k as keyof RecoveryBinding]!==v)||!current())throw Error('sender changed before recovery effect')
  if(mode==='query'){
   const q=await this.d.post(b.receiverHome,'/a2a/query',{task_id:b.taskId,fingerprint:recoveryFingerprint(b)})
   return {accepted:q.task_id===b.taskId&&q.recovery_delivery==='accepted'}
  }
  const now=(this.d.now??Date.now)();if(now<permit.issuedAt||now>=permit.expiresAt)throw Error('receiver permit expired')
  if(this.d.ledger.find(b.taskId)||this.d.ledger.archive().some(r=>r.taskId===b.taskId))throw Error('original continuation already tracked; query only')
  // Save caller debt before transport. Uncertain delivery keeps this exact task/receiver; it never creates a replacement.
  this.d.ledger.track(b.taskId,b.target,b.receiverHome,b.contextId,b.message,{kind:'cli',id:b.caller},{forwarded:true,peerKey:b.receiverKey,deliveredTo:b.target})
  if(!current())throw Error('approval revoked before transport')
  const result=await this.d.post(b.receiverHome,'/a2a/direct',{team:b.target,message:b.message,caller_session:b.caller,task_id:b.taskId,context_id:b.contextId,wait:false,request_recovery:permit})
  return {accepted:result.task_id===b.taskId&&result.recovery_delivery==='accepted'&&result.delivered===true&&result.routed===true&&result.receiverBookkeeping!=='failed'&&result.acceptance!=='unknown'}
 }
}
