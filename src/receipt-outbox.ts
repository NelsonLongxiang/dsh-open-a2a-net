/** Durable return delivery of an already-authored terminal receipt; never executes the original work. */
import { createHash } from 'node:crypto'
import { holdsRow, parseReceipt, taskIdRefusal } from './receipt.ts'
import { canonicalAuthorization } from './task-auth.ts'
import type { TaskLedger, TaskRecord } from './task-ledger.ts'
import { REMINDER_LONG_MS } from './reconciliation-state.ts'

export type ReceiptLane = { kind: 'unresolved' } | { kind: 'local-session'; sessionId: string }
  | { kind: 'local-cli'; key: string }
  | { kind: 'peer'; url: string; key: string }
export interface ReceiptOutboxRecord {
  version: 1
  taskId: string
  authorId: string
  authorTeam: string
  target: string
  text: string
  transportId: string
  payloadHash: string
  caller: string
  payer: string
  localKey: string
  birth: string
  lane: ReceiptLane
  contextId?: string
  createdAt: number
  deadline: number
  attempts: number
  nextAt: number
  phase: 'ready' | 'sending' | 'blocked'
  code?: string
  notifiedAt?: number
}
export function receiptTransportId(taskId: string, target: string, text: string): string {
  return 'r-' + createHash('sha256').update(taskId+'\0'+target+'\0'+text).digest('base64url').slice(0,12)
}
/** Full private payload digest; transport-id compatibility does not replace complete byte binding. */
export function receiptPayloadHash(record:Pick<ReceiptOutboxRecord,'taskId'|'authorId'|'authorTeam'|'target'|'text'|'caller'|'payer'|'localKey'|'birth'|'contextId'>):string {
  return createHash('sha256').update(JSON.stringify([record.taskId,record.authorId,record.authorTeam,record.target,record.text,record.caller,record.payer,record.localKey,record.birth,record.contextId??''])).digest('hex')
}
/** Explicit stable birth fields; restoring a changed/missing authorization never grants replay authority. */
export function receiptBirth(row: TaskRecord): string {
  return createHash('sha256').update(JSON.stringify([row.taskId,row.team,row.peer,row.startedAt,row.contextId ?? '',row.direction ?? '',row.receiverSessionId ?? '',row.deliveredTo ?? '',row.sender?.kind ?? '',row.sender?.id ?? '',row.auth ? canonicalAuthorization(row.auth) : ''])).digest('hex')
}
const bounded = (v: unknown, max=512): v is string => typeof v === 'string' && v.length>0 && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number)>=0
export function parseReceiptOutbox(raw: unknown): ReceiptOutboxRecord | undefined {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return undefined
  const r=raw as ReceiptOutboxRecord
  if(r.version!==1 || !bounded(r.taskId,80) || taskIdRefusal(r.taskId)!==undefined || !bounded(r.authorId,256) || !bounded(r.authorTeam,256) || !bounded(r.target,256) || !bounded(r.caller,256) || !bounded(r.payer,256) || !bounded(r.localKey) || !/^[0-9a-f]{64}$/.test(r.birth))return undefined
  if(typeof r.text!=='string'||Buffer.byteLength(r.text)>16000||r.text.length===0||r.transportId!==receiptTransportId(r.taskId,r.target,r.text))return undefined
  if(r.payloadHash!==receiptPayloadHash(r))return undefined
  const parsed=parseReceipt(r.text)
  if(parsed?.taskId!==r.taskId || holdsRow(parsed.envelope))return undefined
  if(!integer(r.createdAt)||!integer(r.deadline)||r.deadline<=r.createdAt||r.deadline-r.createdAt>24*60*60_000||!integer(r.attempts)||!integer(r.nextAt)||!['ready','sending','blocked'].includes(r.phase))return undefined
  if(r.code!==undefined&&!/^[A-Z0-9_]{1,64}$/.test(r.code))return undefined
  if(r.contextId!==undefined&&!bounded(r.contextId,256))return undefined
  if(r.notifiedAt!==undefined&&!integer(r.notifiedAt))return undefined
  const l=r.lane
  if(!l||typeof l!=='object')return undefined
  let lane:ReceiptLane
  if(l.kind==='unresolved')lane={kind:l.kind}
  else if(l.kind==='local-session'&&bounded(l.sessionId,256))lane={kind:l.kind,sessionId:l.sessionId}
  else if(l.kind==='local-cli'&&bounded(l.key))lane={kind:l.kind,key:l.key}
  else if(l.kind==='peer'&&bounded(l.key)&&bounded(l.url,2048)) {
    try {const url=new URL(l.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return undefined;lane={kind:l.kind,key:l.key,url:url.origin}}catch{return undefined}
  } else return undefined
  return {version:1,taskId:r.taskId,authorId:r.authorId,authorTeam:r.authorTeam,target:r.target,text:r.text,transportId:r.transportId,payloadHash:r.payloadHash,caller:r.caller,payer:r.payer,localKey:r.localKey,birth:r.birth,lane,...(r.contextId!==undefined?{contextId:r.contextId}:{}),createdAt:r.createdAt,deadline:r.deadline,attempts:r.attempts,nextAt:r.nextAt,phase:r.phase,...(r.code!==undefined?{code:r.code}:{}),...(r.notifiedAt!==undefined?{notifiedAt:r.notifiedAt}:{})}
}
export type ReceiptAttemptResult = { confirmed: true } | { confirmed: false; code: string; retry: boolean; unknown?: true }
export interface ReceiptOutboxDeps {
  ledger: TaskLedger
  validate: (record: ReceiptOutboxRecord, row: TaskRecord) => Promise<{ ok: true } | { ok: false; code: string; retry: boolean }>
  deliver: (record: ReceiptOutboxRecord, reconcile: boolean) => Promise<ReceiptAttemptResult>
  settle: (record: ReceiptOutboxRecord) => boolean
  notify: (record: ReceiptOutboxRecord) => void
  schedule: (ms: number) => void
  warn: (code: string) => void
  now?: () => number
}
export const RECEIPT_OUTBOX_FAST_DELAYS = [1000,2000,4000,8000,16000,30000] as const
/** One host owns a ledger. Flights precede the first await; the shared atomic ledger owns crash safety. */
export class ReceiptOutbox {
  private stopped=false
  private flights=new Map<string,Promise<ReceiptAttemptResult>>()
  constructor(private readonly d:ReceiptOutboxDeps,private readonly delays:readonly number[]=RECEIPT_OUTBOX_FAST_DELAYS){}
  stop():void {this.stopped=true}
  private now():number {return this.d.now?.()??Date.now()}
  async scan():Promise<void> {
    if(this.stopped)return
    try {
      const next=this.d.ledger.receipts().filter(r=>r.phase!=='blocked'&&r.nextAt<=this.now()&&this.d.ledger.find(r.taskId)?.status==='pending').sort((a,b)=>a.nextAt-b.nextAt)[0]
      if(next)await this.send(next.taskId)
    }catch{this.d.warn('RECEIPT_OUTBOX_SCAN_FAILED')}
  }
  send(taskId:string):Promise<ReceiptAttemptResult> {
    const old=this.flights.get(taskId);if(old)return old
    // Defer run one microtask so reentrant requests see the flight before validate starts.
    const flight=Promise.resolve().then(()=>this.run(taskId)).finally(()=>this.flights.delete(taskId))
    this.flights.set(taskId,flight);return flight
  }
  private async run(taskId:string):Promise<ReceiptAttemptResult> {
    const unavailable:ReceiptAttemptResult={confirmed:false,code:'RECEIPT_STORAGE_UNAVAILABLE',retry:false}
    if(this.stopped)return {confirmed:false,code:'RECEIPT_HOST_STOPPED',retry:true}
    let record:ReceiptOutboxRecord|undefined
    try {
      record=this.d.ledger.receiptFor(taskId)
      const row=this.d.ledger.find(taskId)
      if(!record||!row||row.status!=='pending')return {confirmed:false,code:'RECEIPT_NOT_REPLAYABLE',retry:false}
      if(record.phase==='blocked')return {confirmed:false,code:record.code??'RECEIPT_BLOCKED',retry:false}
      if(record.nextAt>this.now())return {confirmed:false,code:record.code??'RECEIPT_BACKOFF',retry:true}
      if(record.deadline<=this.now())return this.failure(record,{confirmed:false,code:'RECEIPT_REPLAY_WINDOW_ENDED',retry:false,unknown:true})
      const allowed=await this.d.validate(record,row)
      if(this.stopped)return {confirmed:false,code:'RECEIPT_HOST_STOPPED',retry:true}
      const refreshed=this.d.ledger.receiptFor(taskId)
      if(!refreshed||refreshed.transportId!==record.transportId)return {confirmed:false,code:'RECEIPT_TASK_CHANGED',retry:false}
      record=refreshed
      const current=this.d.ledger.find(taskId)
      if(!current||current.status!=='pending'||receiptBirth(current)!==record.birth)return {confirmed:false,code:'RECEIPT_TASK_CHANGED',retry:false}
      if(record.deadline<=this.now())return this.failure(record,{confirmed:false,code:'RECEIPT_REPLAY_WINDOW_ENDED',retry:false,unknown:true})
      if(!allowed.ok)return this.failure(record,{confirmed:false,code:allowed.code,retry:allowed.retry,...(record.phase==='sending'?{unknown:true as const}:{})})
      const reconcile=record.phase==='sending'
      record=this.d.ledger.updateReceipt(taskId,record.transportId,{phase:'sending',attempts:Math.min(Number.MAX_SAFE_INTEGER,record.attempts+1),nextAt:this.now()+this.delay(record.attempts+1)})
      const result=await this.d.deliver(record,reconcile)
      if(this.stopped)return {confirmed:false,code:'RECEIPT_HOST_STOPPED',retry:true}
      if(result.confirmed) {
        if(this.d.settle(record))return result
        return this.failure(record,{confirmed:false,code:'RECEIPT_SETTLEMENT_COMMIT_FAILED',retry:true,unknown:true})
      }
      return this.failure(record,result)
    }catch{this.d.warn('RECEIPT_OUTBOX_COMMIT_OR_DISPATCH_FAILED');return unavailable}
  }
  private delay(attempts:number):number {return this.delays[Math.min(attempts-1,this.delays.length)]??REMINDER_LONG_MS}
  private failure(record:ReceiptOutboxRecord,result:Extract<ReceiptAttemptResult,{confirmed:false}>):ReceiptAttemptResult {
    const next=this.d.ledger.updateReceipt(record.taskId,record.transportId,{phase:result.retry?(result.unknown||record.phase==='sending'&&result.code==='RECEIPT_ROUTE_UNAVAILABLE'?'sending':'ready'):'blocked',code:result.code,nextAt:this.now()+(result.code==='RECEIPT_ROUTE_UNAVAILABLE'?REMINDER_LONG_MS:this.delay(Math.max(1,record.attempts)))})
    if(next.notifiedAt===undefined) {
      this.d.ledger.updateReceipt(record.taskId,record.transportId,{notifiedAt:this.now()})
      try {this.d.notify(next)}catch{this.d.warn('RECEIPT_DELIVERY_NOTICE_FAILED')}
    }
    if(result.retry)this.d.schedule(Math.max(1000,next.nextAt-this.now()))
    return result
  }
}
