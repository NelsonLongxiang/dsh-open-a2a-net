import {it,expect} from 'vitest'
import {execFile,spawnSync} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve,join} from 'node:path'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {mkdtempSync} from '../temp-dirs.ts'
// This external runtime matrix is opt-in. Default CI must not require a sibling checkout or an experimental flag.
const checkout=process.env.A2A_HOST_CHECKOUT
const expected=process.env.A2A_HOST_COMMIT
let skipReason:string|undefined
if(!checkout)skipReason='A2A_HOST_CHECKOUT not set; external host runtime exercise is opt-in'
else if(!expected||!/^[0-9a-f]{40}$/.test(expected))skipReason='A2A_HOST_COMMIT must pin the full host checkout SHA'
else if(!process.allowedNodeEnvironmentFlags.has('--experimental-transform-types'))skipReason='Node '+process.version+' does not support --experimental-transform-types; external runtime exercise unavailable'
else if(!['packages/core/agent-loop/lib/index.js','packages/session/session-persistence-jsonl/lib/index.js'].every(p=>existsSync(resolve(checkout,p))))skipReason='requested host runtime is not built; no host checkout build is performed here'
it.skipIf(skipReason!==undefined)('#356 opt-in actual host dispatcher FIFO/maintenance/idle/cold runtime'+(skipReason?' [SKIP: '+skipReason+']':''),async()=>{
 const host=resolve(checkout!),head=spawnSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'})
 expect(head.status,head.stderr).toBe(0);expect(head.stdout.trim()).toBe(expected)
 const home=mkdtempSync(join(tmpdir(),'followup-real-loop-'))
 const result=await promisify(execFile)(process.execPath,['--experimental-transform-types','tests/fixtures/followup-real-loop.mjs',host,join(home,'tasks.json')],{timeout:15000,encoding:'utf8'})
 const report=JSON.parse(result.stdout.trim());expect(report).toMatchObject({ok:true,maintenanceNoLoss:true,fifo:true,oneTaskPerTurn:true,sourcePreserved:true,unclaimedRemoved:true,idleWakeConsumed:true,coldWakeConsumed:true,requests:5})
},20000)
