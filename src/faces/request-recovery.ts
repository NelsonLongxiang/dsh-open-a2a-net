/** Owner-only consent to one exact legacy request; never writes roster, canvas or link configuration. */
import type {Context} from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {browserOwnerProof} from '../superagent/host/owner-proof.ts'
import type {RequestRecoveryRuntime} from '../request-recovery-runtime.ts'
interface RecoveryFaceDeps {
 ctx:Context
 controlRoute:(fn:(req:IncomingMessage,res:ServerResponse)=>void)=>(req:IncomingMessage,res:ServerResponse)=>void
 readJsonBody:(req:IncomingMessage,res:ServerResponse,use:(body:{id?:unknown;name?:unknown;action?:unknown})=>void,maxBytes?:number)=>void
 recovery:RequestRecoveryRuntime
}
export function registerRequestRecoveryFace(server:WebServer,d:RecoveryFaceDeps):void {
 d.ctx.effect(()=>server.register({kind:'exact',path:'/__dsh_a2a/request-recovery',handler:d.controlRoute((req,res)=>{
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
  if(req.method!=='POST'){send(405,{ok:false,error:'POST owner reconciliation only'});return}
  let connection:unknown;try{connection=d.ctx.get('connection')}catch{}
  const proof=browserOwnerProof(connection,req);if(!proof.ok){send(proof.status,proof);return}
  d.readJsonBody(req,res,body=>{const f=body as Record<string,unknown>
   if(f.action==='revoke'&&Object.keys(f).every(k=>['action','request_id'].includes(k))&&typeof f.request_id==='string'&&f.request_id.length<=80){try{d.recovery.revoke(f.request_id);send(200,{ok:true})}catch{send(409,{ok:false,error:'original grant unavailable'})}return}
   if(f.action!=='grant'||Object.keys(f).some(k=>!['action','proposal','reconciliation','checked_not_admitted'].includes(k))||typeof f.reconciliation!=='string'||f.checked_not_admitted!==true){send(400,{ok:false,error:'original proposal and explicit receiver-owner reconciliation required'});return}
   void d.recovery.grant(f.proposal,f.reconciliation,true).then(permit=>send(200,{ok:true,permit})).catch(()=>send(409,{ok:false,error:'original reconciliation, principal or receiver evidence unavailable; no permission issued'}))
  })
 })}),'a2a: owner-only one-request recovery consent')
}
