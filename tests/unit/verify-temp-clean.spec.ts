import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'

const gate = join(process.cwd(), 'scripts', 'verify-temp-clean.mjs')
function invoke(script: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [gate, '--', process.execPath, '-e', script], { encoding: 'utf8', timeout: 20000, env: { ...process.env, ...extraEnv } })
  expect(result.error).toBeUndefined()
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('[temp-clean] '))
  expect(lines).toHaveLength(1)
  return { ...result, temp: JSON.parse(lines[0]!.slice('[temp-clean] '.length)) }
}
describe('project-owned test temp lifecycle', () => {
  it('owns the intentional team workspace and keeps the child inside its new project temp root', () => {
    const run = invoke("const fs=require('node:fs'),p=require('node:path'); const root=process.env.TMP; if(!root||process.env.TEMP!==root||process.env.TMPDIR!==root||process.env.A2A_TEST_YGL_HOME!==p.join(root,'superagent-ygl'))throw Error('wrong boundary'); fs.mkdirSync(process.env.A2A_TEST_YGL_HOME); fs.writeFileSync(p.join(process.env.A2A_TEST_YGL_HOME,'owned.db'),'synthetic');")
    expect(run.status).toBe(0)
    expect(run.temp).toMatchObject({ entries: 0, remaining: [], status: 0, signal: null })
    expect(run.temp.root.replaceAll('\\', '/')).toContain('/tmp/test-runs/run-')
  })
  it('ignores an external temp-base override instead of escaping project test-runs', () => {
    const requested = mkdtempSync(join(tmpdir(), 'must-not-select-temp-base-'))
    const run = invoke('process.exit(0)', { A2A_RUN_TMP_BASE: requested })
    expect(run.status).toBe(0)
    expect(run.temp).toMatchObject({ entries: 0, status: 0 })
    const selected = relative(join(process.cwd(), 'tmp', 'test-runs'), run.temp.root)
    expect(selected.startsWith('run-')).toBe(true)
    expect(isAbsolute(selected)).toBe(false)
    expect(relative(requested, run.temp.root).startsWith('..')).toBe(true)
  })
  it('still rejects a child leak outside the one intentional team workspace', () => {
    const run = invoke("const fs=require('node:fs'),p=require('node:path');fs.mkdirSync(process.env.A2A_TEST_YGL_HOME);fs.writeFileSync(p.join(process.env.TMP,'unowned-residue'),'must fail');")
    expect(run.status).toBe(1)
    expect(run.temp).toMatchObject({ entries: 1, remaining: ['unowned-residue'], status: 1 })
  })
  it.each(['javascript', 'native'])('the default entry invokes a %s manager as a program, not as binary JavaScript', kind => {
    const fixture = mkdtempSync(join(tmpdir(), 'verify-manager-entry-'))
    mkdirSync(join(fixture, 'scripts'))
    // The native Node fixture loads an extensionless 'run' file. Pin its own
    // package scope instead of inheriting the repository's type=module.
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }))
    const fixtureGate = join(fixture, 'scripts', 'verify-temp-clean.mjs')
    copyFileSync(gate, fixtureGate)
    const script = "const fs=require('node:fs'),p=require('node:path');if(process.argv.slice(2).join(' ')!==EXPECTED)throw Error('wrong manager arguments');const root=process.env.TMP;if(!root||process.env.A2A_TEST_YGL_HOME!==p.join(root,'superagent-ygl'))throw Error('wrong lifecycle environment');fs.mkdirSync(process.env.A2A_TEST_YGL_HOME);fs.writeFileSync(p.join(process.env.A2A_TEST_YGL_HOME,'owned'),'owned');"
    const manager = kind === 'native' ? process.execPath : join(fixture, 'manager.cjs')
    // A real Node executable serves as the native-manager fixture. Its first
    // positional argument is an existing 'run' program in the fixture cwd.
    writeFileSync(kind === 'native' ? join(fixture, 'run') : manager,
      script.replace('EXPECTED', JSON.stringify(kind === 'native' ? 'verify:core' : 'run verify:core')))
    // Windows env keys are case-insensitive; remove inherited NPM_EXECPATH
    // before setting our fake manager, or the real ancestor project is run.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'))
    const run = spawnSync(process.execPath, [fixtureGate], {
      cwd: fixture, env: { ...env, npm_execpath: manager }, encoding: 'utf8', timeout: 20000,
    })
    expect(run.error, JSON.stringify({ stdout: run.stdout, stderr: run.stderr, args: run.spawnargs, manager, keys: Object.keys(process.env).filter(k => /npm_execpath/i.test(k)) })).toBeUndefined()
    expect(run.status, run.stderr).toBe(0)
    const lines = run.stdout.split(/\r?\n/).filter(line => line.startsWith('[temp-clean] '))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!.slice('[temp-clean] '.length))).toMatchObject({ entries: 0, remaining: [], status: 0 })
    expect(readdirSync(join(fixture, 'tmp', 'test-runs'))).toEqual([])
  })
  it('preserves a child failure even with an otherwise empty temp root', () => {
    const run = invoke('process.exit(7)')
    expect(run.status).toBe(7)
    expect(run.temp).toMatchObject({ entries: 0, status: 7 })
  })
})
