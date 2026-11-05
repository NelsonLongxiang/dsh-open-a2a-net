import { describe, expect, it } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { collectReleaseMeasurements, writeReleaseMeasurementSnapshot } from '../../scripts/collect-release-measurements.mjs'
import { fixtureTar } from '../fixtures/fixture-tar.mjs'
const repo=process.cwd()
function input(){
 const directory=mkdtempSync(join(tmpdir(),'raw-release-'));mkdirSync(join(directory,'package'));mkdirSync(join(directory,'mirror-readback'))
 const candidate=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()
 writeFileSync(join(directory,'package/package.json'),JSON.stringify({name:'fixture',version:'0.0.0'}))
 const tar=fixtureTar(['-czf','actual.tgz','package'],{cwd:directory,encoding:'utf8'});expect(tar.status,tar.stderr).toBe(0)
 writeFileSync(join(directory,'provenance.json'),JSON.stringify({candidate,at:'definitely not ISO',filename:'../not-used.tgz',size:-1,sha256:'wrong-recorded-hash'}))
 writeFileSync(join(directory,'acceptance.json'),JSON.stringify({results:[{kind:'dsh3081',status:503,html:false},{kind:'dsh3081',status:'200'}]}))
 writeFileSync(join(directory,'reviewer-manifest.json'),JSON.stringify({sha:'wrong',files:[{path:'../same',size:1.5,sha256:'x'},{path:'../same',size:2,sha256:'y'}]}))
 return{directory,artifact:join(directory,'actual.tgz')}
}
describe('raw release measurements (not a verifier)',()=>{
 it('retains contradictions, original types, repeated rows and missing inputs without judging them',()=>{
  const f=input(),m=collectReleaseMeasurements(f.directory,f.artifact,repo)
  expect(m.fields).toContainEqual(expect.objectContaining({slot:'provenance',pointer:'/at',text_value:'definitely not ISO'}))
  expect(m.fields).toContainEqual(expect.objectContaining({slot:'provenance',pointer:'/size',number_value:-1}))
  expect(m.fields.filter(r=>r.slot==='reviewer'&&r.pointer.endsWith('/path')).map(r=>r.text_value)).toEqual(['../same','../same'])
  expect(m.fields).toContainEqual(expect.objectContaining({slot:'acceptance',pointer:'/results/1/status',json_type:'string',text_value:'200'}))
  expect(m.blobs.find(r=>r.slot==='artifact')?.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(m.blobs.find(r=>r.slot==='npmjs')).toMatchObject({bytes:null,sha1:null,sha256:null})
  expect(m.inputs.find(r=>r.slot==='npmjs')?.read_errno).toBe('ENOENT')
  expect(m.commands.find(r=>r.slot==='archive_list')?.exit_code).toBe(0)
  expect(m.inventory.map(r=>r.raw_path)).toContain('package/package.json')
  const forbidden=['ok','holds','verdict','valid','matched','changed_count','invalid_count']
  for(const rows of Object.values(m))for(const row of rows)for(const key of Object.keys(row))expect(forbidden).not.toContain(key)
 })
 it('stores JSON syntax errors and unusable candidate tokens as observations, not success defaults',()=>{
  const f=input();writeFileSync(join(f.directory,'acceptance.json'),'{broken');writeFileSync(join(f.directory,'provenance.json'),JSON.stringify({candidate:'--unsafe-option'}))
  const m=collectReleaseMeasurements(f.directory,f.artifact,repo)
  expect(m.fields.find(r=>r.slot==='acceptance')).toMatchObject({json_type:'parse-error',number_value:null})
  expect(m.commands.find(r=>r.slot==='candidate_package')).toMatchObject({exit_code:null,argv:null})
 })
 it('writes a fresh snapshot without verdict columns and cannot overwrite earlier evidence',async()=>{
  const f=input(),output=join(f.directory,'snapshot.sqlite');await writeReleaseMeasurementSnapshot(f.directory,f.artifact,output,repo)
  const before=readFileSync(output),db=new DatabaseSync(output,{readOnly:true})
  try{
   expect(db.prepare('SELECT bytes FROM blob_measurements WHERE slot=?').get('npmjs')?.bytes).toBeNull()
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
   for(const {name}of tables){const columns=db.prepare('PRAGMA table_info('+name+')').all().map(r=>r.name);expect(columns).not.toContain('ok');expect(columns).not.toContain('holds')}
  }finally{db.close()}
  await expect(writeReleaseMeasurementSnapshot(f.directory,f.artifact,output,repo)).rejects.toThrow('already exists')
  expect(readFileSync(output)).toEqual(before)
 })
})
