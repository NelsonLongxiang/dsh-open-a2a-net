import {it,expect} from 'vitest'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve,join} from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtempSync} from '../temp-dirs.ts'
it('#356 actual dispatcher preserves sourced FIFO one-task-per-turn and wakes after real maintenance',async()=>{
 const home=mkdtempSync(join(tmpdir(),'followup-real-loop-'))
 const result=await promisify(execFile)(process.execPath,['--experimental-transform-types','tests/fixtures/followup-real-loop.mjs',resolve('../deepseek-harness'),join(home,'tasks.json')],{timeout:15000,encoding:'utf8'})
 const report=JSON.parse(result.stdout.trim());expect(report).toMatchObject({ok:true,maintenanceNoLoss:true,fifo:true,oneTaskPerTurn:true,sourcePreserved:true,unclaimedRemoved:true,idleWakeConsumed:true,coldWakeConsumed:true,requests:5})
},20000)
