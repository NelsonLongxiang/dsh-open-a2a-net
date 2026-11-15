/** Private bounded write-ahead record for a receipt durably inserted into a CLI mailbox. */
import {createHash} from 'node:crypto'
import {parseReceipt,taskIdRefusal} from './receipt.ts'
import {canonicalAuthorization,type Settler,type TaskAuthorization} from './task-auth.ts'
export interface ReceiptMailboxCommit {
 version:1
 transportId:string
 fingerprint:string
 handle:string
 targetKey:string
 from:string
 message:string
 settler:Settler
 originalBirth?:string
 at:number
 phase:'pending'|'delivered'|'refused'
 hash:string
}
export const RECEIPT_MAILBOX_CAP=64
export const RECEIPT_MAILBOX_RETENTION_MS=24*60*60_000
export function receiptMailboxBirth(row:{taskId:string;team:string;peer:string;startedAt:number;auth?:TaskAuthorization}):string {
 return createHash('sha256').update(JSON.stringify([row.taskId,row.team,row.peer,row.startedAt,row.auth?canonicalAuthorization(row.auth):''])).digest('hex')
}
export function receiptMailboxHash(r:Omit<ReceiptMailboxCommit,'hash'>):string {
 return createHash('sha256').update(JSON.stringify([r.version,r.transportId,r.fingerprint,r.handle,r.targetKey,r.from,r.message,r.settler.caller,r.settler.proof,r.settler.ingress,r.settler.claimOrigin??'',r.settler.claimKey??'',r.originalBirth??'',r.at,r.phase])).digest('hex')
}
export function parseReceiptMailbox(raw:unknown):ReceiptMailboxCommit|undefined {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
 const r=raw as ReceiptMailboxCommit
 const str=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max
 if(r.version!==1||!str(r.transportId,80)||taskIdRefusal(r.transportId)!==undefined||!str(r.fingerprint,256)||!str(r.handle,256)||!str(r.targetKey,512)||!str(r.from,256)||!str(r.message,16000)||!parseReceipt(r.message)||!Number.isSafeInteger(r.at)||r.at<0||!['pending','delivered','refused'].includes(r.phase))return undefined
 const s=r.settler
 if(!s||s.caller!==r.from||s.ingress!=='wire'||!['origin-claim','cli-identity','legacy-window','unbound','claim-mismatch'].includes(s.proof))return undefined
 if(s.claimOrigin!==undefined&&!str(s.claimOrigin,2048)||s.claimKey!==undefined&&!str(s.claimKey,512)||r.originalBirth!==undefined&&!/^[0-9a-f]{64}$/.test(r.originalBirth))return undefined
 if(receiptMailboxHash(r)!==r.hash)return undefined
 return {version:1,transportId:r.transportId,fingerprint:r.fingerprint,handle:r.handle,targetKey:r.targetKey,from:r.from,message:r.message,settler:{caller:s.caller,proof:s.proof,ingress:'wire',...(s.claimOrigin?{claimOrigin:s.claimOrigin}:{}),...(s.claimKey?{claimKey:s.claimKey}:{})},...(r.originalBirth?{originalBirth:r.originalBirth}:{}),at:r.at,phase:r.phase,hash:r.hash}
}
