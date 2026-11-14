#!/usr/bin/env node
/** Test lifecycle gate: run unchanged commands with an owned empty temp root; leaks fail before cleanup. */
import { mkdtempSync, readdirSync, rmSync, lstatSync, mkdirSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const custom = process.argv.slice(2)
if (custom[0] === '--') custom.shift()
const external = custom.length > 0
const command = external ? custom.shift() : process.execPath
const args = external ? custom : process.env.npm_execpath ? [process.env.npm_execpath, 'run', 'verify:core'] : undefined
if (!args) throw Error('run with pnpm verify, or pass -- <executable> <arguments>')
// Own only this invocation's project-local directory, never a system-temp prefix or old run.
const repo = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const projectTmp = join(repo, 'tmp')
const runs = join(projectTmp, 'test-runs')
for (const directory of [projectTmp, runs]) {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw Error('test temp parent must not be a link: ' + directory)
  mkdirSync(directory, { recursive: true })
}
const root = mkdtempSync(join(runs, 'run-'))
const yglHome = join(root, 'superagent-ygl')
let status = 1, signal = null, remaining = [], cleanupError
try {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root, A2A_TEST_YGL_HOME: yglHome, NODE_DISABLE_COMPILE_CACHE: '1' } })
  const settled = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, sig) => resolve({ code, sig })) })
  status = settled.code ?? 1; signal = settled.sig
  // This workspace is an intentional fixture owned by this runner, not a leaked test allocator.
  if (existsSync(yglHome)) {
    if (lstatSync(yglHome).isSymbolicLink()) throw Error('owned ygl home replaced by link')
    rmSync(yglHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  remaining = readdirSync(root)
  if (remaining.length) {
    status = 1
    const inspect = (dir, depth = 0) => readdirSync(dir).flatMap(name => { const path = join(dir,name); return depth < 3 && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() ? [{ path }, ...inspect(path,depth+1)] : [{ path }] })
    console.log('[temp-clean-residue] ' + JSON.stringify(inspect(root)))
  }
} finally {
  // This gate owns this exact mkdtemp result, not old directories with matching prefixes.
  try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  catch (error) { cleanupError = String(error); status = 1 }
  console.log('[temp-clean] ' + JSON.stringify({ root, remaining, entries: remaining.length, status, signal, ...(cleanupError ? { cleanupError } : {}) }))
}
process.exitCode = status
