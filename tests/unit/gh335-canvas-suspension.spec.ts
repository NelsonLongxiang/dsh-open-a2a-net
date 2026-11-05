import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CanvasStore, CANVAS_MEMBER_CAP, CANVAS_TEAM_CAP } from '../../src/canvas-store.ts'
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'canvas335-'));return {dir,path:join(dir,'canvas.json')}}
describe('#335 durable canvas consent',()=>{
 for(const [name,teams] of [
  ['teams-object',{ops:['session-a']}],
  ['slash-name',[{name:'bad/name',members:['session-a']}]],
  ['non-array-members',[{name:'ops',members:{id:'session-a'}}]],
  ['duplicate-team',[{name:'ops',members:[]},{name:'ops',members:[]}]],
  ['duplicate-member',[{name:'ops',members:['session-a','session-a']}]],
  ['too-many-teams',Array.from({length:CANVAS_TEAM_CAP+1},(_,i)=>({name:'team-'+i,members:[]}))],
  ['too-many-members',[{name:'ops',members:Array.from({length:CANVAS_MEMBER_CAP+1},(_,i)=>'session-'+i)}]],
 ] as const)it('#338 B2 refuses malformed v2 '+name+' without rewriting or losing original bytes',()=>{
  const {path}=fixture(),raw=JSON.stringify({formatVersion:2,revision:7,suspendedMembers:[],teams});writeFileSync(path,raw)
  const store=new CanvasStore(path)
  expect(store.state().error).toContain('invalid canvas v2')
  expect(store.membersOf('ops')).toEqual([]);expect(()=>store.create('new')).toThrow()
  expect(readFileSync(path,'utf8')).toBe(raw)
 })
 it('#338 N1 never trusts a partial pre-v2 backup and leaves the original untouched',()=>{
  const {path}=fixture(),raw=JSON.stringify({teams:[{name:'ops',members:['session-a']}]});writeFileSync(path,raw);writeFileSync(path+'.pre-v2','partial')
  const store=new CanvasStore(path);expect(()=>store.create('new')).toThrow('backup differs')
  expect(readFileSync(path,'utf8')).toBe(raw);expect(readFileSync(path+'.pre-v2','utf8')).toBe('partial')
 })
 it('#338 N2 reports held lock path and owner without stealing it',()=>{
  const {path}=fixture(),store=new CanvasStore(path);store.create('ops')
  mkdirSync(path+'.lock');const owner={pid:123,host:'supervisor',at:'2026-11-05T00:00:00Z'};writeFileSync(path+'.lock/owner.json',JSON.stringify(owner))
  expect(()=>store.create('blocked')).toThrow('supervisor')
  expect(store.state()).toMatchObject({lock:{path:path+'.lock',owner},error:expect.stringContaining('canvas lock held')})
  expect(readFileSync(path+'.lock/owner.json','utf8')).toBe(JSON.stringify(owner))
 })

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
