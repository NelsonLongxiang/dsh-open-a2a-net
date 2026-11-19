/** Verify the retained legacy decision itself; current error prose is never approval. */
import {recoveryDigest} from '../../request-recovery.ts'
import type {StoredCard} from './decisions.ts'
import {OUTBOUND_APPROVE,type OutboundRecord} from './outbound.ts'
export interface LegacyApproval {at:string;team:string;message:string;digest:string}
export function legacyOutboundApproval(record:Readonly<OutboundRecord>,card:StoredCard|undefined,team:string,now:number):LegacyApproval|undefined {
 if(!card||card.id!==record.card||card.source!=='outbound'||card.by!==record.by||!card.decided||card.decided.text.split('\n')[0]!=='决定：'+OUTBOUND_APPROVE||!team)return undefined
 const at=Date.parse(card.decided.at),created=Date.parse(card.at)
 if(!Number.isFinite(at)||!Number.isFinite(created)||created>at||at>now||now-at>30*86_400_000)return undefined
 let message:string
 if(card.outbound){
  const p=card.outbound
  if(p.ticketId!==record.ticketId||p.address!==record.address||p.text!==record.text||p.team!==team)return undefined
  const title=p.title.length>80?p.title.slice(0,80)+'…':p.title
  message='[来自 superagent 团队 '+team+' 的请求 · 工单「'+title+'」]\n'+p.text
 }else{
  const prefix='以本团队名义向 '+record.address+' 发出请求吗？（工单「',suffix='」）\n发出的原文：\n'+record.text
  const start=card.question.indexOf(prefix)
  if(start<0||card.question.indexOf(prefix,start+prefix.length)>=0||!card.question.endsWith(suffix))return undefined
  const title=card.question.slice(start+prefix.length,card.question.length-suffix.length)
  if(title.length===0||title.length>81||/[\n\r\u0000]/.test(title))return undefined
  message='[来自 superagent 团队 '+team+' 的请求 · 工单「'+title+'」]\n'+record.text
 }
 return {at:card.decided.at,team,message,digest:recoveryDigest([card.id,card.by,card.at,card.question,card.decided,card.outbound??null,record.ticketId,record.address,record.text,team])}
}
