/** Exercise the real owned-temp entrypoint, not a name-based cleanup substitute. */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mergedConfig from '../../vitest.config.ts'
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
  it('uses the target global lifecycle instead of allocating a home at config load', () => {
    expect(mergedConfig.test?.globalSetup).toEqual(['tests/global-ygl-home.ts'])
    expect(mergedConfig.test?.env?.SUPERAGENT_YGL_HOME).toBeUndefined()
  })

  it('runs the real global setup inside its owned root without touching an inherited home', () => {
    const outside = mkdtempSync(join(tmpdir(), 'verify-global-sentinel-'))
    const sentinel = join(outside, 'keep.txt'); writeFileSync(sentinel, 'inherited home')
    const setupUrl = pathToFileURL(join(repo, 'tests/global-ygl-home.ts')).href
    const result = run(childPrelude +
      "import{existsSync,readFileSync}from'node:fs';import{dirname,basename}from'node:path';" +
      "const{default:setup}=await import(" + JSON.stringify(setupUrl) + ");" +
      "const inherited=process.env.SUPERAGENT_YGL_HOME;const close=setup();const home=process.env.SUPERAGENT_YGL_HOME;" +
      "if(!home||home===inherited||dirname(resolve(home))!==resolve(tmpdir())||!basename(home).startsWith('a2a-test-ygl-'))process.exit(75);" +
      "writeFileSync(join(home,'fixture'),'owned');await close();if(existsSync(home))process.exit(76);" +
      "if(readFileSync(join(inherited,'keep.txt'),'utf8')!=='inherited home')process.exit(77);",
      { SUPERAGENT_YGL_HOME: outside, A2A_TEST_YGL_HOME: outside })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.summary).toMatchObject({ remaining: [], entries: 0, status: 0 })
    expect(readFileSync(sentinel, 'utf8')).toBe('inherited home')
    expect(readdirSync(outside)).toEqual(['keep.txt'])
  })
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

  it('isolates the real default DSH resolver from an inherited home and preserves its sentinel', () => {
    const inherited = mkdtempSync(join(tmpdir(), 'verify-dsh-inherited-'))
    writeFileSync(join(inherited, 'keep.txt'), 'not the test host')
    const result = run(childPrelude +
      "import{resolveDshHome}from'@deepseek-ai/dsh-home-paths';" +
      "const home=resolveDshHome();if(resolve(home)!==resolve(tmpdir(),'dsh-home'))process.exit(81);" +
      "mkdirSync(home,{recursive:true});writeFileSync(join(home,'fixture'),'owned host state');",
      { DSH_HOME: inherited })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.summary).toMatchObject({ remaining: [], entries: 0, status: 0 })
    expect(readFileSync(join(inherited, 'keep.txt'), 'utf8')).toBe('not the test host')
    expect(readdirSync(inherited)).toEqual(['keep.txt'])
  })

  it('refuses a default DSH home replaced by a link without touching its target', () => {
    const target = mkdtempSync(join(tmpdir(), 'verify-dsh-link-sentinel-'))
    writeFileSync(join(target, 'keep.txt'), 'not owned by the child runner')
    const result = run("import{symlinkSync}from'node:fs';if(!process.env.DSH_HOME)process.exit(82);symlinkSync(" +
      JSON.stringify(target) + ",process.env.DSH_HOME,process.platform==='win32'?'junction':'dir');")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('owned DSH home replaced by link')
    expect(readdirSync(target)).toEqual(['keep.txt'])
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('not owned by the child runner')
  })

  it('does not waive an arbitrary leaked directory or file', () => {
    const result = run(childPrelude + "mkdirSync(join(tmpdir(),'unowned-leak'));writeFileSync(join(tmpdir(),'unowned-file'),'leak');")
    expect(result.status).toBe(1)
    expect(result.summary.remaining.sort()).toEqual(['unowned-file','unowned-leak'])
    expect(result.stdout).toContain('[temp-clean-residue]')
  })

  it('preserves a child failure after the owned fixture is removed', () => {
    const result = run(childPrelude + "const home=process.env.A2A_TEST_YGL_HOME,dsh=process.env.DSH_HOME;if(!home||!dsh)process.exit(73);for(const p of [home,dsh]){mkdirSync(p,{recursive:true});writeFileSync(join(p,'fixture'),'owned');}process.exit(7);")
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
