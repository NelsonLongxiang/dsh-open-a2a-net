/** #356 sourced follow-up admission after the existing A2A authorization/queue gates. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { TaskLedger } from './task-ledger.ts'
import { deliveryFingerprint } from './task-delivery.ts'
import { createHash } from 'node:crypto'
export interface FollowupDeps {
  ledger: TaskLedger
  taint: (target: Agent, localFrom?: string) => void
  warn: (code: string) => void
}
export class FollowupDelivery {
  constructor(private readonly d: FollowupDeps) {}
  deliver(agent: Agent, text: string, sender?: string, localFrom?: string, taskId?: string, callerKey?: string): void {
    // Missing capability is a refusal, never a reason to call steer.
    if(typeof agent.followup!=='function')throw Error('A2A requires Agent.followup; target runtime lacks sourced next-turn delivery')
    const sessionId=String(agent.id),fingerprint=deliveryFingerprint(sessionId,text,sender,localFrom)
    const messageId=MessageId('a2a-followup-'+createHash('sha256').update(taskId===undefined?fingerprint+':'+Date.now()+':'+Math.random():sessionId+':'+taskId).digest('hex'))
    if(taskId) {
      const existing=this.d.ledger.deliveryFor(taskId)
      if(existing) {
        if(existing.sessionId!==sessionId||existing.fingerprint!==fingerprint||existing.callerKey!==callerKey)throw Error('task delivery identity conflict')
        if(existing.state==='cancelled'||existing.state==='failed')throw Error('task delivery correspondence is terminal; no replay')
        if(existing.state==='reserved')throw Error('task delivery acceptance uncertain; reconcile the existing MessageId rather than redeliver')
        return
      }
      this.d.ledger.reserveDelivery({version:1,taskId,messageId,sessionId,fingerprint,...(callerKey?{callerKey}:{}),createdAt:Date.now(),state:'reserved'})
    }
    const source: UserMessage['source']={kind:'a2a-relay',form:'relay',...(sender===undefined?{}:{senderSessionId:sender}),...(localFrom===undefined?{}:{localSender:localFrom}),...(taskId===undefined?{}:{taskId})}
    const message: UserMessage={id:messageId,role:'user',content:[{type:'text',text}],source}
    this.d.taint(agent,localFrom)
    try {agent.followup(message)} catch(error) {
      // The host may throw after durable insertion; preserve reserved/unknown, never blind replay.
      this.d.warn('FOLLOWUP_ADMISSION_FAILED');throw error
    }
    if(taskId)try{if(this.d.ledger.deliveryFor(taskId)?.state==='reserved')this.d.ledger.updateDelivery(taskId,'enqueued')}catch{this.d.warn('FOLLOWUP_ACCEPTED_COMMIT_FAILED')}
  }
  /** Only called after the existing cancel authorization has identified the original task. */
  async withdraw(taskId:string, controller: {updateQueue:(request:{sessionId:Agent['id'];itemId:MessageId;action:{kind:'remove'}})=>Promise<unknown>} | undefined, resolve:(id:string)=>Agent|undefined): Promise<'removed'|'claimed'|'legacy'> {
    const record=this.d.ledger.deliveryFor(taskId)
    if(!record)return 'legacy'
    if(record.state==='cancelled')return 'removed'
    if(record.state==='claimed')return 'claimed'
    if(typeof controller?.updateQueue!=='function')throw Error('SessionController.updateQueue unavailable; queued cancellation refused')
    try {
      await controller.updateQueue({sessionId:SessionId(record.sessionId),itemId:MessageId(record.messageId),action:{kind:'remove'}})
      this.d.ledger.updateDelivery(taskId,'cancelled')
      return 'removed'
    } catch(error) {
      const code=(error as {code?:unknown})?.code
      if(code==='session/queue-item-not-found') {this.d.ledger.updateDelivery(taskId,'claimed');return 'claimed'}
      throw error
    }
  }
  claimed(agent: Agent, messageId: string): void {
    // Called by the owned event boundary; failure must not exit the host.
    try {
      const record=this.d.ledger.deliveryByMessage(String(agent.id),messageId)
      if(record&&record.state!=='cancelled'){this.d.ledger.updateDelivery(record.taskId,'claimed')}
    } catch {this.d.warn('FOLLOWUP_CLAIM_COMMIT_FAILED')}
  }
}
