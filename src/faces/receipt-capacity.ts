/** #eb6d20df: the owner voids orphan task deliveries that hold the receipt-protected gate; browser owner only, audited. */
import type {Context} from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {browserOwnerProof} from '../superagent/host/owner-proof.ts'
import type {TaskLedger} from '../task-ledger.ts'
interface ReceiptCapacityFaceDeps {
 ctx:Context
 controlRoute:(fn:(req:IncomingMessage,res:ServerResponse)=>void)=>(req:IncomingMessage,res:ServerResponse)=>void
 readJsonBody:(req:IncomingMessage,res:ServerResponse,use:(body:Record<string,unknown>)=>void,maxBytes?:number)=>void
 ledger:Pick<TaskLedger,'voidOrphanDeliveries'|'receiptCapacityState'>
 logger:{info:(format:string,...args:unknown[])=>void}
}
const ID=/^[A-Za-z0-9._:-]{1,80}$/
export function registerReceiptCapacityFace(server:WebServer,d:ReceiptCapacityFaceDeps):void {
 d.ctx.effect(()=>server.register({kind:'exact',path:'/__dsh_a2a/receipt-capacity/void',handler:d.controlRoute((req,res)=>{
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
  if(req.method!=='POST'){send(405,{ok:false,error:'POST {task_ids, reason} from the owner browser only'});return}
  let connection:unknown;try{connection=d.ctx.get('connection')}catch{}
  const proof=browserOwnerProof(connection,req);if(!proof.ok){send(proof.status,proof);return}
  d.readJsonBody(req,res,body=>{
   const ids=body.task_ids,reason=body.reason
   if(Object.keys(body).some(k=>k!=='task_ids'&&k!=='reason')||!Array.isArray(ids)||ids.length===0||ids.length>64||!ids.every(x=>typeof x==='string'&&ID.test(x))||typeof reason!=='string'||reason.trim()===''||reason.length>200){send(400,{ok:false,error:'task_ids: 1 to 64 task ids from receiptCapacity.holders; reason: why, at most 200 characters'});return}
   const out=d.ledger.voidOrphanDeliveries(ids as string[],reason.trim())
   d.logger.info('a2a: owner voided %d orphan task deliveries (%s): %s',out.voided.length,reason.trim().slice(0,80),out.voided.join(','))
   const s=d.ledger.receiptCapacityState(0)
   send(200,{ok:true,...out,receiptCapacity:{cap:s.cap,owed:s.owed,retained:s.retained,available:s.available}})
  },8192)
 })}),'a2a: owner-only void of orphan task deliveries (receipt-protected gate)')
}
