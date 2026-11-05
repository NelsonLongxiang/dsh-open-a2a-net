/** Constructed audit self-test inputs only, never historical release or HTTP observations. */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { tarFiles } from '../../scripts/release-file-manifest.mjs'
const directory = resolve(process.argv[2]), repo = fileURLToPath(new URL('../../', import.meta.url))
mkdirSync(join(directory, 'package'), { recursive: true }); mkdirSync(join(directory, 'mirror-readback'))
const git = args => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); if(r.status !== 0) throw Error(r.stderr); return r.stdout.trim() }
const candidate = git(['rev-parse', 'HEAD']), pkg = JSON.parse(git(['show', candidate + ':package.json']))
writeFileSync(join(directory,'package/package.json'), JSON.stringify(pkg)); writeFileSync(join(directory,'package/example.txt'), 'constructed self-test payload')
const tar = spawnSync('tar', ['-czf','release.tgz','package'], { cwd: directory, encoding: 'utf8' }); if(tar.status !== 0) throw Error(tar.stderr)
const bytes = readFileSync(join(directory,'release.tgz')), shasum = createHash('sha1').update(bytes).digest('hex'), sha256 = createHash('sha256').update(bytes).digest('hex')
const json = (p,v) => writeFileSync(join(directory,p), JSON.stringify(v,null,2))
json('provenance.json', {candidate,at:'2026-11-05T00:00:00Z',filename:'release.tgz',size:bytes.length,files:spawnSync('tar',['-tzf','release.tgz'],{cwd:directory,encoding:'utf8'}).stdout.trim().split(/\r?\n/).length,shasum,sha256,constructedSelfTest:true})
const results = ['dsh3081','cleanServe'].flatMap(kind => [{kind,base:'http://127.0.0.1:3081',path:'/.well-known/agent-card.json',status:200,version:pkg.version},{kind,base:'http://127.0.0.1:3081',path:'/__dsh_a2a/state',status:200,version:pkg.version,isolated:true},{kind,base:'http://127.0.0.1:3081',path:'/__dsh_a2a_nexus/',status:200,html:true,bytes:100}])
json('acceptance.json',{candidate,at:'2026-11-05T01:00:00Z',shasum,results,constructedSelfTest:true})
copyFileSync(join(directory,'release.tgz'),join(directory,'npmjs-readback.tgz'));copyFileSync(join(directory,'release.tgz'),join(directory,'mirror-readback/release.tgz'))
json('npmjs-readback.json',{at:'2026-11-05T02:00:00Z',version:pkg.version,shasum,sha256,bytes:bytes.length,constructedSelfTest:true})
json('reviewer-manifest.json',{sha:candidate,platform:'constructed fixture, not independent reviewer evidence',files:[...tarFiles(bytes)].map(([path,value])=>({path,...value})),constructedSelfTest:true})
console.log(JSON.stringify({directory,candidate,constructedSelfTest:true}))
