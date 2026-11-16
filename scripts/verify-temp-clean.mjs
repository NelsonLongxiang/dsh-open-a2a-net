#!/usr/bin/env node
/** Test lifecycle gate: run unchanged commands with an owned empty temp root; leaks fail before cleanup. */
import { mkdtempSync, readdirSync, rmSync, lstatSync, mkdirSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const custom = process.argv.slice(2)
if (custom[0] === '--') custom.shift()
const external = custom.length > 0
// Package managers may be native executables (.exe on Windows, extensionless
// on Unix), or JavaScript entrypoints that must run under the current Node.
const manager = process.env.npm_execpath
const nativeManager = manager && !/[.](?:cjs|mjs|js)$/i.test(manager)
const command = external ? custom.shift() : nativeManager ? manager : process.execPath
const args = external ? custom : manager ? nativeManager ? ['run', 'verify:core'] : [manager, 'run', 'verify:core'] : undefined
if (!args) throw Error('run with pnpm verify, or pass -- <executable> <arguments>')
const repo = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const runs = join(repo, 'tmp', 'test-runs')
for (const parent of [join(repo, 'tmp'), runs]) {
  if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw Error('test temp parent is a link')
  mkdirSync(parent, { recursive: true })
}
// The owned test root always remains inside this project's tmp directory.
// Ignore external temp-base overrides; do not move test data to system temp.
const root = mkdtempSync(join(runs, 'run-'))
const yglHome = join(root, 'superagent-ygl')
const dshHome = join(root, 'dsh-home')
mkdirSync(dshHome, { mode: 0o700 })
// Node on Windows takes the first case-insensitive env key. Remove inherited
// spellings before installing this run's complete child-only home boundary.
const overrides = { TMPDIR: root, TEMP: root, TMP: root, DSH_HOME: dshHome, A2A_TEST_YGL_HOME: yglHome, NODE_DISABLE_COMPILE_CACHE: '1' }
const controlled = new Set(Object.keys(overrides).map(key => key.toLowerCase()))
const childEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !controlled.has(key.toLowerCase()))), ...overrides }
let status = 1, signal = null, remaining = [], cleanupError, operationError
try {
  const child = spawn(command, args, { stdio: 'inherit', env: childEnv })
  const settled = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, sig) => resolve({ code, sig })) })
  status = settled.code ?? 1; signal = settled.sig
  // Only these explicitly runner-owned homes are intentional; never follow a
  // substituted symlink/junction or silently permit unrelated residue.
  for (const home of [dshHome, yglHome]) {
    let stat
    try { stat = lstatSync(home) } catch (error) { if (home === yglHome && error.code === 'ENOENT') continue; throw error }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(home) !== home) throw Error('owned test home was replaced by a link or non-directory')
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  remaining = readdirSync(root)
  if (remaining.length) {
    status = 1
    const inspect = (dir, depth = 0) => readdirSync(dir).flatMap(name => { const path = join(dir,name); return depth < 3 && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() ? [{ path }, ...inspect(path,depth+1)] : [{ path }] })
    console.log('[temp-clean-residue] ' + JSON.stringify(inspect(root)))
  }
} catch (error) {
  status = 1; operationError = String(error)
} finally {
  // This gate owns this exact mkdtemp result, not old directories with matching prefixes.
  try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  catch (error) { cleanupError = String(error); status = 1 }
  console.log('[temp-clean] ' + JSON.stringify({ root, remaining, entries: remaining.length, status, signal, ...(operationError ? { error: operationError } : {}), ...(cleanupError ? { cleanupError } : {}) }))
}
process.exitCode = status
