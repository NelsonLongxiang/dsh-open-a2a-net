import {describe,it,expect,vi,afterEach} from 'vitest'
import {generateKeyPairSync} from 'node:crypto'
import {signCard} from '../../src/card.ts'
import {completeInboundVerification,verifiedInboundAdmission,hasOriginClaimFields} from '../../src/inbound-verification.ts'
const card=signCard({name:'validation',session:'validation',team:'beta',capabilities:{route:true},expiresAt:Date.now()+3600000},generateKeyPairSync('ed25519').privateKey)
const valid={ok:true as const,caller:'beta',callerUrl:'https://validation.invalid',card,bound:true}
const admitted={ok:true as const,via:'open' as const,rule:'scope-off' as const,basis:[]}
afterEach(()=>vi.useRealTimers())
describe('inbound verification completion',()=>{
 it('settles the local deadline before delayed work has completed',async()=>{
  vi.useFakeTimers();let observed:unknown
  const pending=completeInboundVerification(()=>new Promise(resolve=>setTimeout(()=>resolve(valid),80)),5).then(result=>{observed=result})
  await vi.advanceTimersByTimeAsync(6);expect(observed).toEqual({ok:false,reason:'verification-timeout'})
  await vi.advanceTimersByTimeAsync(80);await pending;expect(observed).toEqual({ok:false,reason:'verification-timeout'})
 })
 it('rejects delayed work without calling admission or accepting a later completion',async()=>{
  const admit=vi.fn(()=>admitted)
  const result=await completeInboundVerification(()=>new Promise(resolve=>setTimeout(()=>resolve(valid),60)),5)
  expect(verifiedInboundAdmission(result,true,true,admit)).toEqual({ok:false,reason:'verification-timeout'});expect(admit).not.toHaveBeenCalled()
 })
 it('rejects failed work without treating it as absent',async()=>{
  const admit=vi.fn(()=>admitted),result=await completeInboundVerification(async()=>{throw Error('validation unavailable')},20)
  expect(verifiedInboundAdmission(result,true,true,admit)).toEqual({ok:false,reason:'no-card'});expect(admit).not.toHaveBeenCalled()
 })
 it('passes only the completed key into admission',async()=>{
  const admit=vi.fn(key=>{expect(key).toBe(card.publicKey);return admitted})
  expect(verifiedInboundAdmission(await completeInboundVerification(async()=>valid),true,true,admit)).toEqual({ok:true,admission:admitted});expect(admit).toHaveBeenCalledTimes(1)
 })
 it('a present incomplete result never calls admission with an undefined key',()=>{
  const admit=vi.fn(()=>admitted)
  expect(verifiedInboundAdmission({ok:false,reason:'absent'},true,true,admit)).toEqual({ok:false,reason:'incomplete-verification'});expect(admit).not.toHaveBeenCalled()
 })
 it('requires completed bound validation when requested, preserving explicitly unbound compatibility elsewhere',()=>{
  const admit=vi.fn(()=>admitted)
  expect(verifiedInboundAdmission({...valid,bound:false},true,true,admit)).toEqual({ok:false,reason:'bound-verification-required'});expect(admit).not.toHaveBeenCalled()
  expect(verifiedInboundAdmission({...valid,bound:false},true,false,admit).ok).toBe(true)
 })
 it('keeps the fully absent-envelope policy separate from present fields',()=>{
  expect(hasOriginClaimFields({headers:{}})).toBe(false)
  for(const headers of [{'x-a2a-caller':''},{'x-a2a-caller-sig2':''},{'x-a2a-body-sha256':''}])expect(hasOriginClaimFields({headers})).toBe(true)
  const admit=vi.fn(()=>admitted);expect(verifiedInboundAdmission({ok:false,reason:'absent'},false,true,admit).ok).toBe(true);expect(admit).toHaveBeenCalledWith(undefined)
 })
})
