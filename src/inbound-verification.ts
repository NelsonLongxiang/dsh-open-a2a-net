/** Bounded completion gate for inbound request verification. */
import type { IncomingMessage } from 'node:http'
import type { Admission } from './task-auth.ts'
import { ORIGIN_CLAIM_VERIFY_MS, type OriginClaimVerdict } from './origin-claim.ts'
export const WIRE_ERROR_INBOUND_VERIFICATION = -32011
export function hasOriginClaimFields(req: Pick<IncomingMessage,'headers'>): boolean {
  return Object.keys(req.headers).some(name=>name.toLowerCase().startsWith('x-a2a-caller')||name.toLowerCase()==='x-a2a-body-sha256')
}
export async function completeInboundVerification(work:()=>Promise<OriginClaimVerdict>,timeoutMs=ORIGIN_CLAIM_VERIFY_MS):Promise<OriginClaimVerdict>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const deadline=Date.now()+timeoutMs
  try{
    const expired=new Promise<OriginClaimVerdict>(resolve=>{timer=setTimeout(()=>resolve({ok:false,reason:'verification-timeout'}),timeoutMs)})
    const result=await Promise.race([Promise.resolve().then(work).catch(()=>({ok:false,reason:'no-card'} as const)),expired])
    return Date.now()>=deadline?{ok:false,reason:'verification-timeout'}:result
  }finally{if(timer!==undefined)clearTimeout(timer)}
}
export function verifiedInboundAdmission(claim:OriginClaimVerdict,present:boolean,requireBound:boolean,admit:(signerKey:string|undefined)=>Admission):{ok:true;admission:Admission}|{ok:false;reason:string}{
  if(present&&(!claim.ok||(requireBound&&!claim.bound)))return {ok:false,reason:claim.ok?'bound-verification-required':claim.reason==='absent'?'incomplete-verification':claim.reason}
  return {ok:true,admission:admit(claim.ok?claim.card.publicKey:undefined)}
}
