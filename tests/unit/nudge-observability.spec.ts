import {it,expect,vi}from'vitest'
import {NudgeObservability,safeObservationCode}from'../../src/nudge-observability.ts'
it('observes queued unavailable and failed results with safe single-line warnings',()=>{
 const warn=vi.fn(),o=new NudgeObservability(warn,()=>123)
 expect(o.snapshot()).toEqual({queued:0,unavailable:0,failed:0})
 o.note('unavailable','team\nname','0123456789abcdef');expect(o.snapshot()).toEqual({queued:0,unavailable:1,failed:0,lastAt:123,lastError:'PROMPT_UNAVAILABLE'})
 o.note('failed','team','0123456789abcdef',Object.assign(Error('secret payload'),{code:'EACCES'}));expect(o.snapshot().lastError).toBe('EACCES')
 o.note('failed','team','0123456789abcdef',{code:'PRIVATE_TOKEN'});expect(o.snapshot().lastError).toBe('NUDGE_QUEUE_FAILED')
 expect(warn).toHaveBeenCalledTimes(3);for(const [line]of warn.mock.calls){expect(line).toContain('team=');expect(line).toContain('nudgeRef=0123456789abcdef');expect(line).not.toMatch(/secret|PRIVATE_TOKEN|\n/)}
 o.note('queued','team','0123456789abcdef');expect(o.snapshot()).toEqual({queued:1,unavailable:1,failed:2,lastAt:123});expect(warn).toHaveBeenCalledTimes(3)
 const copy=o.snapshot();copy.queued=100;expect(o.snapshot().queued).toBe(1)
})
it('diagnostic consumers cannot change delivery when warning output throws',()=>{
 const o=new NudgeObservability(()=>{throw Error('logger unavailable')});expect(()=>o.note('failed','team','abc',Error('private'))).not.toThrow();expect(o.snapshot().failed).toBe(1)
 expect(safeObservationCode({get code(){throw Error('private')}},'FALLBACK')).toBe('FALLBACK')
})
