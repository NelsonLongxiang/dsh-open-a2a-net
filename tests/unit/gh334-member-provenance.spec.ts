import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { encodePublicKey } from '../../src/card.ts'
import { CanvasStore } from '../../src/canvas-store.ts'
import { memberProvenance, qualifiedSessionMember, splitQualifiedMember, validMemberOwner } from '../../src/canvas-member.ts'
const key=()=>encodePublicKey(generateKeyPairSync('ed25519').publicKey)
const fixture=()=>join(mkdtempSync(join(tmpdir(),'canvas334-')),'canvas.json')
describe('#334 durable member provenance',()=>{
 it('malformed persisted key anchors fail closed and preserve disk bytes',()=>{
  const path=fixture(),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!,raw=JSON.stringify({formatVersion:2,revision:1,suspendedMembers:[],teams:[{name:'ops',members:[ref]}],memberOwners:{[ref]:key()}});writeFileSync(path,raw)
  const store=new CanvasStore(path,{ownPublicKey:a});expect(store.state().error).toContain('invalid canvas v2');expect(store.membersOf('ops')).toEqual([]);expect(()=>store.create('new')).toThrow();expect(readFileSync(path,'utf8')).toBe(raw)
 })
 it('ordinary re-add cannot confirm an existing qualified slot without its full owner anchor',()=>{
  const path=fixture(),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!,own=key();writeFileSync(path,JSON.stringify({teams:[{name:'ops',members:[ref]}]}))
  const s=new CanvasStore(path,{ownPublicKey:own});expect(s.membersOf('ops')).toEqual([]);expect(s.addMember('ops',ref,undefined,{ownerKey:a})).toBe(false);expect(s.ownerKeyOf(ref)).toBeUndefined()
  expect(s.confirmMember('ops',ref,ref,a,s.state().revision,null).ok).toBe(true);expect(s.membersOf('ops')).toEqual([ref])
 })

 it('separates session-qualified selectors, invalid full keys and CLI identities',()=>{
  const a=key(),b=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!
  expect(splitQualifiedMember(ref)?.handle).toBe('dsh/aaaaaaaa');expect(validMemberOwner(ref,a)).toBe(true)
  expect(validMemberOwner(ref,b)).toBe(false);expect(validMemberOwner(ref,'not-a-key')).toBe(false)
  expect(splitQualifiedMember('ops-cli/0123456789abcdef')).toBeUndefined()
  expect(splitQualifiedMember('dsh/canvas/aaaaaaaa@1234abcd')).toBeUndefined() // Canvas S2 selector is a separate grammar.
  expect(memberProvenance('dsh/aaaaaaaa',undefined,a)).toBe('unknown')
  expect(memberProvenance(ref,a,b)).toBe('confirmed-remote');expect(memberProvenance(ref,a,a)).toBe('confirmed-local')
 })
 it('requires a matching complete key for new qualified writes and keeps it across restart',()=>{
  const path=fixture(),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!,s=new CanvasStore(path);s.create('ops')
  expect(s.addMember('ops',ref)).toBe(false);expect(s.addMember('ops',ref,undefined,{ownerKey:key()})).toBe(false)
  expect(s.addMember('ops',ref,undefined,{ownerKey:a})).toBe(true)
  expect(new CanvasStore(path).ownerKeyOf(ref)).toBe(a)
 })
 it('atomically confirms the same ordered slot and transfers every suspension reason without restoring it',()=>{
  const path=fixture(),s=new CanvasStore(path),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!
  s.create('ops');for(const m of ['session-before','dsh/aaaaaaaa','session-after'])s.addMember('ops',m)
  s.revokeLocal('session-aaaaaaaa',undefined,'dsh/aaaaaaaa','leave');s.revokeLocal('session-aaaaaaaa',undefined,'dsh/aaaaaaaa','archive')
  const rev=s.state().revision
  expect(s.confirmMember('ops','dsh/aaaaaaaa',ref,a,rev-1,null).ok).toBe(false)
  expect(s.confirmMember('ops','dsh/aaaaaaaa',ref,a,rev,null).ok).toBe(true)
  const restored=new CanvasStore(path);expect(restored.rawMembersOf('ops')).toEqual(['session-before',ref,'session-after'])
  expect(restored.suspensionOf('ops',ref)).toHaveLength(2);expect(restored.membersOf('ops')).not.toContain(ref)
  expect(restored.ownerKeyOf(ref)).toBe(a);expect(restored.suspensionOf('ops','dsh/aaaaaaaa')).toEqual([])
 })
 it('keeps an already confirmed equivalent priority and rejects attempts to replace confirmed ownership',()=>{
  const path=fixture(),s=new CanvasStore(path),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!;s.create('ops')
  s.addMember('ops',ref,undefined,{ownerKey:a});s.addMember('ops','session-other');s.addMember('ops','dsh/aaaaaaaa')
  expect(s.confirmMember('ops','dsh/aaaaaaaa',ref,a,s.state().revision,null).ok).toBe(true)
  expect(s.rawMembersOf('ops')).toEqual([ref,'session-other'])
  expect(s.confirmMember('ops',ref,'session-other',undefined,s.state().revision,a).ok).toBe(false)
 })
 it('rolls back full-key anchors and member replacement on a held write lock',()=>{
  const path=fixture(),s=new CanvasStore(path),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!;s.create('ops');s.addMember('ops','dsh/aaaaaaaa')
  const before=readFileSync(path,'utf8');mkdirSync(path+'.lock')
  expect(s.confirmMember('ops','dsh/aaaaaaaa',ref,a,s.state().revision,null).ok).toBe(false)
  expect(s.rawMembersOf('ops')).toEqual(['dsh/aaaaaaaa']);expect(s.ownerKeyOf(ref)).toBeUndefined();expect(readFileSync(path,'utf8')).toBe(before)
 })
 it('refuses stale cross-process confirmation without changing another writer disk',()=>{
  const path=fixture(),s=new CanvasStore(path),a=key(),ref=qualifiedSessionMember('dsh/aaaaaaaa',a)!;s.create('ops');s.addMember('ops','dsh/aaaaaaaa')
  const other=new CanvasStore(path);other.create('elsewhere');const before=readFileSync(path,'utf8')
  expect(s.confirmMember('ops','dsh/aaaaaaaa',ref,a,s.state().revision,null).ok).toBe(false)
  expect(s.ownerKeyOf(ref)).toBeUndefined();expect(readFileSync(path,'utf8')).toBe(before)
 })
})
