import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CanvasStore } from '../../src/canvas-store.ts'
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'canvas335-'));return {dir,path:join(dir,'canvas.json')}}
describe('#335 durable canvas consent',()=>{
 it('real filesystem write failure is visible and cannot leave successful in-memory edits',()=>{
  const {dir}=fixture(),parent=join(dir,'not-a-directory');writeFileSync(parent,'blocker')
  const s=new CanvasStore(join(parent,'canvas.json'))
  expect(()=>s.create('a')).toThrow();expect(s.list()).toEqual([])
  expect(readFileSync(parent,'utf8')).toBe('blocker')
 })

 it('ordinary remove/drop/team dissolution cannot clear a suspended slot and repeated add cannot restore',()=>{
  const {path}=fixture(),s=new CanvasStore(path);s.create('a');s.addMember('a','dsh/aaaaaaaa')
  s.revokeLocal('session-a','dsh/aaaaaaaa@1234abcd','dsh/aaaaaaaa','leave')
  expect(s.removeMember('a','dsh/aaaaaaaa')).toBe(false);s.dropMember('dsh/aaaaaaaa');expect(s.remove('a')).toBe(false)
  expect(s.addMember('a','dsh/aaaaaaaa')).toBe(true);expect(s.membersOf('a')).toEqual([])
  s.revokeLocal('session-a','dsh/aaaaaaaa@1234abcd','dsh/aaaaaaaa','archive')
  const expected=s.suspensionOf('a','dsh/aaaaaaaa');expect(expected).toHaveLength(2)
  expect(s.regulateSuspended('restore','a','dsh/aaaaaaaa',s.state().revision,[expected[0]]).ok).toBe(false)
  expect(s.regulateSuspended('delete','a','dsh/aaaaaaaa',s.state().revision,expected).ok).toBe(true)
  expect(new CanvasStore(path).rawMembersOf('a')).toEqual([])
 })
 it('a held write lock refuses without overwriting disk or mutating effective members',()=>{
  const {path}=fixture(),s=new CanvasStore(path);s.create('a');const before=readFileSync(path,'utf8')
  mkdirSync(path+'.lock');expect(()=>s.addMember('a','session-a')).toThrow()
  expect(s.membersOf('a')).toEqual([]);expect(readFileSync(path,'utf8')).toBe(before)
 })
 it('keeps raw priority slots but all effective readers exclude suspension, including after restart/readd',()=>{
  const {path}=fixture(),s=new CanvasStore(path)
  s.create('a');s.create('b');for(const n of s.list()){s.addMember(n,'session-local');s.addMember(n,'dsh/aaaaaaaa');s.addMember(n,'dsh/aaaaaaaa@1234abcd');s.addMember(n,'dsh/aaaaaaaa@aaaaaaaa')}
  expect(s.revokeLocal('session-local','dsh/aaaaaaaa@1234abcd','dsh/aaaaaaaa','leave')).toBe(true)
  expect(s.rawMembersOf('a')).toEqual(['dsh/aaaaaaaa','dsh/aaaaaaaa@aaaaaaaa'])
  expect(s.membersOf('a')).toEqual(['dsh/aaaaaaaa@aaaaaaaa']);expect(s.remoteMembersOf('a')).toEqual(['dsh/aaaaaaaa@aaaaaaaa']);expect(s.teamsOf('dsh/aaaaaaaa')).toEqual([])
  const restored=new CanvasStore(path);restored.addMember('a','dsh/aaaaaaaa')
  expect(restored.membersOf('a')).toEqual(['dsh/aaaaaaaa@aaaaaaaa']);expect(restored.state().suspendedMembers).toHaveLength(2)
  const rev=restored.state().revision,expected=restored.suspensionOf('a','dsh/aaaaaaaa')
  expect(restored.regulateSuspended('restore','a','dsh/aaaaaaaa',rev-1,expected).ok).toBe(false)
  expect(restored.regulateSuspended('restore','a','dsh/aaaaaaaa',rev,[]).ok).toBe(false)
  expect(restored.regulateSuspended('restore','a','dsh/aaaaaaaa',rev,expected).ok).toBe(true)
  expect(restored.membersOf('a')[0]).toBe('dsh/aaaaaaaa');expect(restored.membersOf('b')).not.toContain('dsh/aaaaaaaa')
  const closed=new CanvasStore(path,{legacyBareMembers:false});expect(closed.membersOf('a')).not.toContain('dsh/aaaaaaaa')
 })
 it('backs up v1 before first write and preserves raw rows/revision/CAS on disk',()=>{
  const {path}=fixture(),old=JSON.stringify({teams:[{name:'a',members:['dsh/aaaaaaaa']}]});writeFileSync(path,old)
  const s=new CanvasStore(path);expect(readFileSync(path,'utf8')).toBe(old)
  s.revokeLocal('session-a','dsh/aaaaaaaa@1234abcd','dsh/aaaaaaaa','remove','a')
  expect(readFileSync(path+'.pre-v2','utf8')).toBe(old)
  const disk=JSON.parse(readFileSync(path,'utf8'));expect(disk.formatVersion).toBe(2);expect(disk.teams[0].members).toEqual(['dsh/aaaaaaaa']);expect(disk.suspendedMembers).toHaveLength(1)
  const other=new CanvasStore(path);other.create('external')
  expect(s.regulateSuspended('restore','a','dsh/aaaaaaaa',s.state().revision,s.suspensionOf('a','dsh/aaaaaaaa')).ok).toBe(false)
  expect(s.membersOf('a')).toEqual([]);expect(new CanvasStore(path).membersOf('a')).toEqual([])
 })
 it('does not pretend suspension persistence succeeded; fails closed in memory and keeps prior disk',()=>{
  const {path}=fixture(),s=new CanvasStore(path);s.create('a');s.addMember('a','dsh/aaaaaaaa')
  const original=readFileSync(path,'utf8');writeFileSync(path,original+' ')
  expect(()=>s.revokeLocal('session-a','dsh/aaaaaaaa@1234abcd','dsh/aaaaaaaa','leave')).toThrow()
  expect(s.membersOf('a')).toEqual([]);expect(s.state().error).toContain('failed')
  expect(readFileSync(path,'utf8')).toBe(original+' ')
 })
 it('unsupported or malformed v2 cannot be overwritten or reactivate members',()=>{
  const {path}=fixture();for(const doc of [{formatVersion:3,teams:[{name:'a',members:['dsh/a']}]},{formatVersion:2,teams:[{name:'a',members:['dsh/a']}],suspendedMembers:'bad'}]){
   const raw=JSON.stringify(doc);writeFileSync(path,raw);const s=new CanvasStore(path)
   expect(s.membersOf('a')).toEqual([]);expect(()=>s.create('new')).toThrow();expect(readFileSync(path,'utf8')).toBe(raw)
  }
 })
})
