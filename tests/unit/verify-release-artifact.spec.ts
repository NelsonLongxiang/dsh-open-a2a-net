import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { collectReleaseArtifactFacts } from '../../scripts/verify-release-artifact.mjs'
const repo = process.cwd()
const hash = (b: Buffer, a: string) => createHash(a).update(b).digest('hex')
function fixture(badPath = false) {
 const dir=mkdtempSync(join(tmpdir(),'release-audit-'))
 mkdirSync(join(dir,'package'));mkdirSync(join(dir,'mirror-readback'))
 const sha=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim()
 const pkg=JSON.parse(spawnSync('git',['show',sha+':package.json'],{cwd:repo,encoding:'utf8'}).stdout)
 writeFileSync(join(dir,'package/package.json'),JSON.stringify(pkg))
 if(badPath){mkdirSync(join(dir,'package/__pycache__'));writeFileSync(join(dir,'package/__pycache__/x.pyc'),'bad')}
 const tar=spawnSync('tar',['-czf','release.tgz','package'],{cwd:dir,encoding:'utf8'})
 if(tar.status!==0)throw Error(tar.stderr)
 const bytes=readFileSync(join(dir,'release.tgz')),shasum=hash(bytes,'sha1'),sha256=hash(bytes,'sha256')
 const files=spawnSync('tar',['-tzf','release.tgz'],{cwd:dir,encoding:'utf8'}).stdout.trim().split(/\r?\n/).length
 const json=(file: string,value: unknown)=>writeFileSync(join(dir,file),JSON.stringify(value))
 json('provenance.json',{candidate:sha,at:'2026-11-05T00:00:00Z',filename:'release.tgz',size:bytes.length,files,shasum,sha256})
 const results=['dsh3081','cleanServe'].flatMap(kind=>[{kind,base:'http://127.0.0.1:3081',path:'/.well-known/agent-card.json',status:200,version:pkg.version},{kind,base:'http://127.0.0.1:3081',path:'/__dsh_a2a/state',status:200,version:pkg.version,isolated:true},{kind,base:'http://127.0.0.1:3081',path:'/__dsh_a2a_nexus/',status:200,html:true,bytes:100}])
 json('acceptance.json',{candidate:sha,at:'2026-11-05T01:00:00Z',shasum,results})
 copyFileSync(join(dir,'release.tgz'),join(dir,'npmjs-readback.tgz'));copyFileSync(join(dir,'release.tgz'),join(dir,'mirror-readback/release.tgz'))
 json('npmjs-readback.json',{at:'2026-11-05T02:00:00Z',version:pkg.version,shasum,sha256,bytes:bytes.length})
 return {dir,json,rows:()=>collectReleaseArtifactFacts(dir,repo),read:(file: string)=>JSON.parse(readFileSync(join(dir,file),'utf8'))}
}
describe('retained-release fact collector (not the verdict engine)',()=>{
 it('the existing probe CLI requires output and never overwrites a snapshot',()=>{
  const f=fixture();try{
   const cli=join(repo,'scripts/verify-probe.mjs')
   expect(spawnSync(process.execPath,[cli,'--release-audit',f.dir],{encoding:'utf8'}).status).not.toBe(0)
   const out=join(f.dir,'audit.sqlite')
   const first=spawnSync(process.execPath,[cli,'--release-audit',f.dir,'--out',out],{encoding:'utf8'})
   expect(first.status,first.stderr).toBe(0)
   expect(JSON.parse(first.stdout).rows).toHaveLength(7)
   const before=readFileSync(out)
   expect(spawnSync(process.execPath,[cli,'--release-audit',f.dir,'--out',out],{encoding:'utf8'}).status).not.toBe(0)
   expect(readFileSync(out).equals(before)).toBe(true)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
 })
 it('collects seven positive facts from consistent bytes and evidence',()=>{const f=fixture();try{expect(f.rows()).toHaveLength(7);expect(f.rows().map(r=>r.ok)).toEqual([1,1,1,1,1,1,1])}finally{rmSync(f.dir,{recursive:true,force:true})}})
 it('never silently omits missing evidence',()=>{const dir=mkdtempSync(join(tmpdir(),'release-empty-'));try{const rows=collectReleaseArtifactFacts(dir,repo);expect(rows).toHaveLength(7);expect(rows.every(r=>r.ok===0)).toBe(true)}finally{rmSync(dir,{recursive:true,force:true})}})
 it('detects bad package paths even when hashes match their record',()=>{const f=fixture(true);try{expect(f.rows().find(r=>r.name==='archive_inventory')?.ok).toBe(0);expect(f.rows().find(r=>r.name==='artifact_digest')?.ok).toBe(1)}finally{rmSync(f.dir,{recursive:true,force:true})}})
 for(const field of ['candidate','shasum','at','results'])it('refuses contradictory acceptance '+field,()=>{const f=fixture();try{const a=f.read('acceptance.json');a[field]=field==='results'?[]:field==='at'?'2025-01-01T00:00:00Z':'mismatch';f.json('acceptance.json',a);expect(f.rows().filter(r=>r.name.startsWith('acceptance_')).every(r=>r.ok===0)).toBe(true)}finally{rmSync(f.dir,{recursive:true,force:true})}})
 for(const path of ['release.tgz','npmjs-readback.tgz','mirror-readback/release.tgz'])it('detects tampered bytes '+path,()=>{const f=fixture();try{writeFileSync(join(f.dir,path),'tampered');const name=path==='release.tgz'?'artifact_digest':path==='npmjs-readback.tgz'?'readback_npmjs':'readback_gitea';expect(f.rows().find(r=>r.name===name)?.ok).toBe(0)}finally{rmSync(f.dir,{recursive:true,force:true})}})
})
