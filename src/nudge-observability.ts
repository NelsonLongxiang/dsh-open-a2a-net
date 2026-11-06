/** Observation only; no scheduling, delivery or ledger authority. */
export interface NudgeEscalations { queued:number; unavailable:number; failed:number; lastAt?:number; lastError?:string }
export function safeObservationCode(error:unknown,fallback:string):string {
 let code:unknown
 try{code=(error as {code?:unknown}|null)?.code}catch{return fallback}
 return typeof code==='string'&&['EACCES','EPERM','EBUSY','ENOSPC','ENOENT','EIO','EROFS','EMFILE','ENFILE','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ABORT_ERR'].includes(code)?code:fallback
}
export class NudgeObservability {
 private value:NudgeEscalations={queued:0,unavailable:0,failed:0}
 constructor(private readonly warn:(message:string)=>void,private readonly now:()=>number=Date.now){}
 snapshot():NudgeEscalations{return {...this.value}}
 note(result:'queued'|'unavailable'|'failed',team:string,ref:string,error?:unknown):void {
  this.value[result]++;this.value.lastAt=this.now()
  if(result==='queued'){delete this.value.lastError;return}
  const code=result==='unavailable'?'PROMPT_UNAVAILABLE':safeObservationCode(error,'NUDGE_QUEUE_FAILED')
  this.value.lastError=code
  try{this.warn('a2a: nudge escalation '+result+' team='+team.replace(/[\x00-\x1f\x7f]/g,'').slice(0,256)+' nudgeRef='+ref+' code='+code)}catch{/* Observation must not affect delivery. */}
 }
}
