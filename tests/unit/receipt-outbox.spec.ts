import { describe,it,expect,vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync,writeFileSync } from 'node:fs'
import { mkdtempSync } from '../temp-dirs.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { ReceiptOutbox, receiptBirth,receiptTransportId,receiptPayloadHash,parseReceiptOutbox,type ReceiptOutboxRecord } from '../../src/receipt-outbox.ts'
function fixture(){
 let now=1_000_000
 const file=join(mkdtempSync(join(tmpdir(),'receipt-outbox-')),'tasks.json'),ledger=new TaskLedger(file,{now:()=>now}),target='alpha/bbbbbbbb',author='beta/aaaaaaaa',text='[A2A receipt] task job completed with original words'
 ledger.track('job',author,'local','ctx','original work',{kind:'session',id:target},{receiverSessionId:'session-author'})
 const make=():ReceiptOutboxRecord=>{const row={version:1 as const,taskId:'job',authorId:'session-author',authorTeam:author,target,text,transportId:receiptTransportId('job',target,text),caller:author,payer:author,localKey:'key',birth:receiptBirth(ledger.find('job')!),lane:{kind:'local-session' as const,sessionId:'session-caller'},contextId:'ctx',createdAt:now,deadline:now+23*60*60_000,attempts:0,nextAt:now,phase:'ready' as const};return {...row,payloadHash:receiptPayloadHash(row)}}
 const deliver=vi.fn(async()=>({confirmed:true as const})),validate=vi.fn(async()=>({ok:true as const})),notify=vi.fn(),schedule=vi.fn(),warn=vi.fn(),settle=vi.fn((record:ReceiptOutboxRecord)=>{ledger.resolveFromMessage(record.text);return true})
 const deps={ledger,validate,deliver,settle,notify,schedule,warn,now:()=>now}
 return {file,ledger,make,deliver,validate,notify,schedule,warn,settle,deps,worker:new ReceiptOutbox(deps),advance:(ms:number)=>{now+=ms}}
}
describe('authored receipt return outbox',()=>{
 it('cannot recreate authored bytes for a legacy answered debt even when a new caller supplies matching prose',()=>{
  const f=fixture();f.ledger.markAnswered('job','beta/aaaaaaaa');const before=readFileSync(f.file,'utf8');expect(()=>f.ledger.prepareReceipt(f.make())).toThrow('legacy answered');expect(readFileSync(f.file,'utf8')).toBe(before)
 })
 it('a ready-to-send commit failure preserves debt, emits no transport and can recover storage without a duplicate',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());const update=f.ledger.updateReceipt.bind(f.ledger),spy=vi.spyOn(f.ledger,'updateReceipt').mockImplementationOnce(()=>{throw Error('rename failed')})
  expect(await f.worker.send('job')).toMatchObject({confirmed:false,code:'RECEIPT_STORAGE_UNAVAILABLE'});expect(f.deliver).not.toHaveBeenCalled();expect(f.ledger.find('job')?.answeredAt).toBe(1_000_000);spy.mockImplementation(update);await f.worker.scan();expect(f.deliver).toHaveBeenCalledOnce()
 })
 it('failed post-send settlement keeps sending and only reconciles the original transport',async()=>{
  const f=fixture(),originalTransport=f.make().transportId;f.ledger.prepareReceipt(f.make());f.settle.mockImplementationOnce(()=>{throw Error('disk unavailable after remote ack')});await f.worker.send('job');expect(f.ledger.receiptFor('job')?.phase).toBe('sending');f.advance(1000);await f.worker.scan();expect(f.deliver).toHaveBeenCalledTimes(2);expect(f.deliver.mock.calls[0]![1]).toBe(false);expect(f.deliver.mock.calls[1]![1]).toBe(true);expect(f.deliver.mock.calls[1]![0].transportId).toBe(originalTransport)
 })
 it('an unavailable route never turns an unknown sending checkpoint back into dispatch permission',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.deliver.mockResolvedValueOnce({confirmed:false,code:'RECEIPT_ACCEPTANCE_UNKNOWN',retry:true,unknown:true} as never);await f.worker.send('job');f.advance(1000);f.validate.mockResolvedValueOnce({ok:false,code:'RECEIPT_ROUTE_UNAVAILABLE',retry:true} as never);await f.worker.scan();expect(f.ledger.receiptFor('job')?.phase).toBe('sending');f.advance(2*60*60_000);await f.worker.scan();expect(f.deliver.mock.calls[1]![1]).toBe(true)
 })
 it('context drift after validation cannot dispatch and deadline is rechecked after awaits',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.validate.mockImplementationOnce(async()=>{f.advance(23*60*60_000);return {ok:true}});await f.worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.ledger.find('job')?.status).toBe('pending')
 })

 it('atomically preserves the full authored receipt and answer, never public row payload',()=>{
  const f=fixture(),receipt=f.make();f.ledger.prepareReceipt(receipt)
  expect(f.ledger.find('job')).toMatchObject({status:'pending',answeredAt:1_000_000,receiptDelivery:'receipt-undelivered'})
  expect(f.ledger.find('job')).not.toHaveProperty('text')
  const saved=JSON.parse(readFileSync(f.file,'utf8'));expect(saved.receiptOutbox[0]).toEqual(receipt)
  const restored=new TaskLedger(f.file,{now:()=>1_000_000});expect(restored.receiptFor('job')).toEqual(receipt)
  receipt.text='changed';expect(restored.receiptFor('job')!.text).toContain('original words')
 })
 it('refuses changed text, target, author, task birth and nonterminal receipt without changing disk',()=>{
  const f=fixture(),receipt=f.make();f.ledger.prepareReceipt(receipt);const before=readFileSync(f.file,'utf8')
  for(const patch of [{text:'[A2A receipt] task job changed'},{target:'other/cccccccc'},{authorId:'other'},{birth:'0'.repeat(64)}]){
   const next={...receipt,...patch};next.transportId=receiptTransportId(next.taskId,next.target,next.text);expect(()=>f.ledger.prepareReceipt(next)).toThrow()
  }
  expect(readFileSync(f.file,'utf8')).toBe(before)
  expect(parseReceiptOutbox({...receipt,text:'[A2A receipt] task job acknowledged\n{"disposition":"acknowledged"}'})).toBeUndefined()
 })
 it('legacy answered rows without authored bytes cannot be replayed or reconstructed',async()=>{
  const f=fixture();f.ledger.markAnswered('job','beta/aaaaaaaa');await f.worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.ledger.receiptFor('job')).toBeUndefined();expect(f.ledger.list()).toHaveLength(1)
 })
 it('singleflight starts before first async validation and returns exactly one delivery',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());let release!:()=>void
  f.validate.mockImplementationOnce(async()=>{await new Promise<void>(r=>{release=r});return {ok:true}})
  const a=f.worker.send('job'),b=f.worker.send('job');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));release();expect(await a).toEqual({confirmed:true});expect(await b).toEqual({confirmed:true});expect(f.deliver).toHaveBeenCalledTimes(1);expect(f.ledger.archive()).toHaveLength(1)
 })
 it('marks sending before effects and a restart reconciles the same transport without rerunning work',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.deliver.mockImplementationOnce(async record=>{const saved=JSON.parse(readFileSync(f.file,'utf8'));expect(saved.receiptOutbox[0]).toMatchObject({phase:'sending',transportId:record.transportId});return {confirmed:false,code:'RECEIPT_ACCEPTANCE_UNKNOWN',retry:true,unknown:true} as never})
  await f.worker.send('job');f.advance(1000)
  const ledger=new TaskLedger(f.file,{now:()=>1_001_000}),deliver=vi.fn(async()=>({confirmed:true as const})),settle=vi.fn((r:ReceiptOutboxRecord)=>{ledger.resolveFromMessage(r.text);return true})
  const restored=new ReceiptOutbox({...f.deps,ledger,deliver,settle,now:()=>1_001_000});await restored.scan();expect(deliver).toHaveBeenCalledTimes(1);expect(deliver.mock.calls[0]![1]).toBe(true);expect(deliver.mock.calls[0]![0].transportId).toBe(f.make().transportId);expect(ledger.archive()).toHaveLength(1)
 })
 it('route unavailable schedules long delay, sends one nonreceipt notice, and original result stays owed',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.validate.mockResolvedValue({ok:false,code:'RECEIPT_ROUTE_UNAVAILABLE',retry:true} as never)
  await f.worker.scan();await f.worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.notify).toHaveBeenCalledTimes(1);expect(f.schedule).toHaveBeenCalledWith(2*60*60_000);expect(f.ledger.find('job')?.status).toBe('pending');expect(f.ledger.archive()).toEqual([])
 })
 it('revocation, changed identity or terminal refusal blocks without falling back to owner',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.validate.mockResolvedValue({ok:false,code:'RECEIPT_AUTHORITY_CHANGED',retry:false} as never);await f.worker.scan();f.advance(3*60*60_000);await f.worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.ledger.receiptFor('job')?.phase).toBe('blocked');expect(f.ledger.list()).toHaveLength(1)
 })
 it('expired replay window stops without settlement and cancellation removes due work',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.advance(23*60*60_000);await f.worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.ledger.receiptFor('job')?.code).toBe('RECEIPT_REPLAY_WINDOW_ENDED');f.ledger.cancel('job');expect(f.ledger.receipts()).toEqual([])
 })
 it('corrupt receipt persistence never drops debt or authorizes a fallback replay',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());const snapshot=JSON.parse(readFileSync(f.file,'utf8'));snapshot.receiptOutbox[0].text='corrupt';writeFileSync(f.file,JSON.stringify(snapshot));const ledger=new TaskLedger(f.file,{now:()=>1_000_000});expect(()=>ledger.receipts()).toThrow('corrupt');expect(ledger.list()).toHaveLength(1);const worker=new ReceiptOutbox({...f.deps,ledger});await worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.warn).toHaveBeenCalled()
 })
 it('stop during validation refuses further sends and never destroys pending debt',async()=>{
  const f=fixture();f.ledger.prepareReceipt(f.make());f.validate.mockImplementationOnce(async()=>{f.worker.stop();return {ok:true}});await f.worker.scan();expect(f.deliver).not.toHaveBeenCalled();expect(f.ledger.list()).toHaveLength(1)
 })
})
