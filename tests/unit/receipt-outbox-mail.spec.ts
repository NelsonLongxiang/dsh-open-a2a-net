import {it,expect,vi,afterEach} from 'vitest'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {generateKeyPairSync} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {mkdtempSync} from '../temp-dirs.ts'
import {CliDepositStore} from '../../src/cli-deposit.ts'
import {signCard} from '../../src/card.ts'
const fault=vi.hoisted(()=>({file:'',fail:false}))
vi.mock('../../src/task-ledger-persistence.ts',async original=>{const actual=await original<typeof import('../../src/task-ledger-persistence.ts')>();return {...actual,writeTaskLedger:(file:string,bytes:string)=>{if(fault.fail&&file===fault.file)throw Error('test receipt mail write failed');actual.writeTaskLedger(file,bytes)}}})
afterEach(()=>{fault.fail=false;fault.file='';vi.restoreAllMocks()})
function fixture(){let now=Date.now();const file=join(mkdtempSync(join(tmpdir(),'receipt-mail-')),'mail.json'),store=new CliDepositStore(file,{now:()=>now}),handle='receipt-test/0123456789abcdef',key=generateKeyPairSync('ed25519').privateKey;expect(store.deposit(JSON.stringify(signCard({name:'test',session:'test',team:handle,capabilities:{route:true,async:true},expiresAt:now+86400000},key))).ok).toBe(true);return {file,store,handle,tick:(ms:number)=>{now+=ms},thread:{taskId:'receipt-fixed',receiptFor:'original-work',contextId:'ctx',proof:'in-process' as const}}}
it('receipt mail commits before success and a write failure changes neither disk nor mailbox',()=>{const f=fixture(),before=readFileSync(f.file,'utf8');fault.file=f.file;fault.fail=true;expect(()=>f.store.mailReceipt(f.handle,'beta/aaaaaaaa','original result',f.thread)).toThrow('test receipt mail write failed');expect(f.store.readMail(f.handle)).toEqual([]);expect(readFileSync(f.file,'utf8')).toBe(before);fault.fail=false;f.store.mailReceipt(f.handle,'beta/aaaaaaaa','original result',f.thread);expect(new CliDepositStore(f.file).readMail(f.handle)).toMatchObject([{text:'original result',task_id:'receipt-fixed',receipt_for:'original-work'}])})
it('same transport reuses one durable mailbox row and conflicting text cannot replace it',()=>{const f=fixture();f.store.mailReceipt(f.handle,'beta/aaaaaaaa','original result',f.thread);const seq=f.store.readMailbox(f.handle).next_seq;f.store.mailReceipt(f.handle,'beta/aaaaaaaa','original result',f.thread);expect(f.store.readMail(f.handle)).toHaveLength(1);expect(f.store.readMailbox(f.handle).next_seq).toBe(seq);expect(()=>f.store.mailReceipt(f.handle,'beta/aaaaaaaa','different result',f.thread)).toThrow('identity conflict');expect(f.store.readMail(f.handle)[0]!.text).toBe('original result')})
it('offline household identity remains visible but does not accept a receipt without a live deposit',()=>{const f=fixture(),key=f.store.heldKey(f.handle);f.tick(4*60*60_000+1);expect(f.store.heldKey(f.handle)).toBe(key);expect(()=>f.store.mailReceipt(f.handle,'beta/aaaaaaaa','original result',f.thread)).toThrow('unavailable');expect(f.store.readMail(f.handle)).toEqual([])})
