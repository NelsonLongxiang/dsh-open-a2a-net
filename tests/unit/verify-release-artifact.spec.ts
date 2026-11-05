import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { collectReleaseArtifactFacts } from '../../scripts/verify-release-artifact.mjs'
import { tarFiles, compareReviewerManifest } from '../../scripts/release-file-manifest.mjs'
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
 json('reviewer-manifest.json',{sha,platform:'fixture independent build (test only)',files:[...tarFiles(bytes)].map(([path,value])=>({path,...value}))})
 return {dir,json,rows:()=>collectReleaseArtifactFacts(dir,repo),read:(file: string)=>JSON.parse(readFileSync(join(dir,file),'utf8'))}
}
describe('retained-release fact collector (not the verdict engine)',()=>{
 it('rejects nonregular/traversal/duplicate/truncated tar payloads even with valid gzip and checksum',()=>{
  const f=fixture();try{
   const original=gunzipSync(readFileSync(join(f.dir,'release.tgz')))
   const fileHeader=Buffer.from(original.subarray(512,1024))
   const size=parseInt(fileHeader.subarray(124,136).toString().replaceAll(String.fromCharCode(0),'').trim(),8)
   const entry=original.subarray(512,1024+Math.ceil(size/512)*512)
   for(const type of ['1','2','3','6']){
    const header=Buffer.from(fileHeader);header[156]=type.charCodeAt(0);header.fill(32,148,156)
    const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+String.fromCharCode(0)+' ',148,'ascii')
    expect(()=>tarFiles(gzipSync(Buffer.concat([header,entry.subarray(512),Buffer.alloc(1024)])))).toThrow('non-regular')
   }
   expect(()=>tarFiles(gzipSync(Buffer.concat([entry,entry,Buffer.alloc(1024)])))).toThrow('duplicate')
   const bad=Buffer.from(fileHeader);bad.fill(0,0,100);bad.write('package/../outside');bad.fill(32,148,156)
   bad.write(bad.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+String.fromCharCode(0)+' ',148,'ascii')
   expect(()=>tarFiles(gzipSync(Buffer.concat([bad,entry.subarray(512),Buffer.alloc(1024)])))).toThrow('invalid file path')
   expect(()=>tarFiles(gzipSync(entry.subarray(0,513)))).toThrow('truncated')
  }finally{rmSync(f.dir,{recursive:true,force:true})}
 })
 for(const mode of ['missing','wrong-sha','empty','wrong-size','wrong-hash','duplicate','traversal','absolute','drive','backslash','extra','missing-file','non-array'])it('fails closed reviewer manifest '+mode,()=>{
  const f=fixture();try{
   const input=f.read('reviewer-manifest.json')
   if(mode==='missing')rmSync(join(f.dir,'reviewer-manifest.json'))
   else{
    if(mode==='wrong-sha')input.sha='0'.repeat(40)
    if(mode==='empty')input.files=[]
    if(mode==='wrong-size')input.files[0].size++
    if(mode==='wrong-hash')input.files[0].sha256='f'.repeat(64)
    if(mode==='duplicate')input.files.push({...input.files[0],path:'package/'+input.files[0].path})
    if(mode==='traversal')input.files[0].path='../outside'
    if(mode==='absolute')input.files[0].path='/outside'
    if(mode==='drive')input.files[0].path='package/C:/outside'
    if(mode==='backslash')input.files[0].path='directory'+String.fromCharCode(92)+'outside'
    if(mode==='extra')input.files.push({...input.files[0],path:'extra'})
    if(mode==='missing-file')input.files=[]
    if(mode==='non-array')input.files={}
    f.json('reviewer-manifest.json',input)
   }
   expect(f.rows().find(r=>r.name==='reviewer_file_identity')?.ok).toBe(0)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
 })
 it('compares only package file bytes, not gzip metadata, and accepts package/ path prefixes',()=>{
  const f=fixture();try{
   const input=f.read('reviewer-manifest.json');input.files.forEach((r:any)=>{r.path='package/'+r.path})
   const bytes=readFileSync(join(f.dir,'release.tgz'));bytes.writeUInt32LE(123456,4)
   expect(compareReviewerManifest(bytes,input,input.sha).ok).toBe(true)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
 })
 it('refuses repeated archive entries (including tar hardlink optimization) without extracting them',()=>{
  const f=fixture();try{
   for(const args of [['-czf','bad.tgz','package/package.json','package/package.json'],['-czf','bad.tgz','package/package.json']]){
    expect(spawnSync('tar',args,{cwd:f.dir}).status).toBe(0)
    if(args.length===4)expect(()=>tarFiles(readFileSync(join(f.dir,'bad.tgz')))).toThrow()
   }
   const bytes=readFileSync(join(f.dir,'release.tgz'))
   expect(()=>tarFiles(bytes.subarray(0,30))).toThrow()
  }finally{rmSync(f.dir,{recursive:true,force:true})}
 })
 it('the existing probe CLI requires output and never overwrites a snapshot',()=>{
  const f=fixture();try{
   const cli=join(repo,'scripts/verify-probe.mjs')
   expect(spawnSync(process.execPath,[cli,'--release-audit',f.dir],{encoding:'utf8'}).status).not.toBe(0)
   const out=join(f.dir,'audit.sqlite')
   const first=spawnSync(process.execPath,[cli,'--release-audit',f.dir,'--out',out],{encoding:'utf8'})
   expect(first.status,first.stderr).toBe(0)
   expect(JSON.parse(first.stdout).rows).toHaveLength(8)
   const before=readFileSync(out)
   expect(spawnSync(process.execPath,[cli,'--release-audit',f.dir,'--out',out],{encoding:'utf8'}).status).not.toBe(0)
   expect(readFileSync(out).equals(before)).toBe(true)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
 })
 it('collects eight positive facts from consistent bytes and evidence',()=>{const f=fixture();try{expect(f.rows()).toHaveLength(8);expect(f.rows().map(r=>r.ok)).toEqual([1,1,1,1,1,1,1,1])}finally{rmSync(f.dir,{recursive:true,force:true})}})
 it('never silently omits missing evidence',()=>{const dir=mkdtempSync(join(tmpdir(),'release-empty-'));try{const rows=collectReleaseArtifactFacts(dir,repo);expect(rows).toHaveLength(8);expect(rows.every(r=>r.ok===0)).toBe(true)}finally{rmSync(dir,{recursive:true,force:true})}})
 it('detects bad package paths even when hashes match their record',()=>{const f=fixture(true);try{expect(f.rows().find(r=>r.name==='archive_inventory')?.ok).toBe(0);expect(f.rows().find(r=>r.name==='artifact_digest')?.ok).toBe(1)}finally{rmSync(f.dir,{recursive:true,force:true})}})
 for(const field of ['candidate','shasum','at','results'])it('refuses contradictory acceptance '+field,()=>{const f=fixture();try{const a=f.read('acceptance.json');a[field]=field==='results'?[]:field==='at'?'2025-01-01T00:00:00Z':'mismatch';f.json('acceptance.json',a);expect(f.rows().filter(r=>r.name.startsWith('acceptance_')).every(r=>r.ok===0)).toBe(true)}finally{rmSync(f.dir,{recursive:true,force:true})}})
 for(const path of ['release.tgz','npmjs-readback.tgz','mirror-readback/release.tgz'])it('detects tampered bytes '+path,()=>{const f=fixture();try{writeFileSync(join(f.dir,path),'tampered');const name=path==='release.tgz'?'artifact_digest':path==='npmjs-readback.tgz'?'readback_npmjs':'readback_gitea';expect(f.rows().find(r=>r.name===name)?.ok).toBe(0)}finally{rmSync(f.dir,{recursive:true,force:true})}})
})
