/** Exercise the real owned-temp entrypoint, not a name-based cleanup substitute. */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from '../temp-dirs.ts'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const runner = join(repo, 'scripts/verify-temp-clean.mjs')
function run(source: string, extra: NodeJS.ProcessEnv = {}) {
  const child = spawnSync(process.execPath, [runner, '--', process.execPath, '--input-type=module', '-e', source], {
    cwd: repo, encoding: 'utf8', timeout: 15_000, env: { ...process.env, ...extra },
  })
  expect(child.error).toBeUndefined()
  const summaryLine = child.stdout.split(/\r?\n/).find(line => line.startsWith('[temp-clean] '))
  expect(summaryLine, child.stdout + child.stderr).toBeDefined()
  const summary = JSON.parse(summaryLine!.slice('[temp-clean] '.length)) as {root:string;remaining:string[];entries:number;status:number}
  expect(existsSync(summary.root)).toBe(false)
  return { ...child, summary }
}
const childPrelude = "import{mkdirSync,writeFileSync}from'node:fs';import{join,resolve}from'node:path';import{tmpdir}from'node:os';"

describe('owned verify temporary lifecycle', () => {
  it('removes its exact owned ygl fixture while preserving an inherited home and old sibling', () => {
    const outside = mkdtempSync(join(tmpdir(), 'verify-owned-sentinel-'))
    const sentinel = join(outside, 'keep.txt'); writeFileSync(sentinel, 'do not touch')
    const runs = join(repo, 'tmp', 'test-runs'); mkdirSync(runs, { recursive:true })
    const prior = mkdtempSync(join(runs, 'prior-owned-')); writeFileSync(join(prior,'keep.txt'),'old run')
    const result = run(childPrelude + "const home=process.env.A2A_TEST_YGL_HOME;if(!home)process.exit(73);if(resolve(home)!==resolve(tmpdir(),'superagent-ygl'))process.exit(74);mkdirSync(home,{recursive:true});writeFileSync(join(home,'owned.txt'),'fixture');", { A2A_TEST_YGL_HOME:outside })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(dirname(resolve(result.summary.root))).toBe(resolve(repo,'tmp','test-runs'))
    expect(result.summary).toMatchObject({remaining:[],entries:0,status:0})
    expect(readFileSync(sentinel,'utf8')).toBe('do not touch')
    expect(readFileSync(join(prior,'keep.txt'),'utf8')).toBe('old run')
    // Both sentinels are this test's exact tracked allocations; the shared afterAll owns their teardown.
  })

  it('does not waive an arbitrary leaked directory or file', () => {
    const result = run(childPrelude + "mkdirSync(join(tmpdir(),'unowned-leak'));writeFileSync(join(tmpdir(),'unowned-file'),'leak');")
    expect(result.status).toBe(1)
    expect(result.summary.remaining.sort()).toEqual(['unowned-file','unowned-leak'])
    expect(result.stdout).toContain('[temp-clean-residue]')
  })

  it('preserves a child failure after the owned fixture is removed', () => {
    const result = run(childPrelude + "const home=process.env.A2A_TEST_YGL_HOME;if(!home)process.exit(73);mkdirSync(home,{recursive:true});writeFileSync(join(home,'fixture'),'owned');process.exit(7);")
    expect(result.status).toBe(7)
    expect(result.summary).toMatchObject({remaining:[],entries:0,status:7})
  })

  it('refuses an owned fixture replaced by a link and leaves its target untouched', () => {
    const target = mkdtempSync(join(tmpdir(),'verify-link-sentinel-'))
    writeFileSync(join(target,'keep.txt'),'unchanged')
    const result = run("import{symlinkSync}from'node:fs';if(!process.env.A2A_TEST_YGL_HOME)process.exit(73);symlinkSync(" + JSON.stringify(target) + ",process.env.A2A_TEST_YGL_HOME,process.platform==='win32'?'junction':'dir');")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('owned ygl home replaced by link')
    expect(readFileSync(join(target,'keep.txt'),'utf8')).toBe('unchanged')
    expect(readdirSync(target)).toEqual(['keep.txt'])
  })
})
