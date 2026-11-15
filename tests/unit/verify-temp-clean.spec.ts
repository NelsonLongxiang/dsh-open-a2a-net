import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const gate = join(process.cwd(), 'scripts', 'verify-temp-clean.mjs')
function invoke(script: string) {
  const result = spawnSync(process.execPath, [gate, '--', process.execPath, '-e', script], { encoding: 'utf8', timeout: 20000 })
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
  it('still rejects a child leak outside the one intentional team workspace', () => {
    const run = invoke("const fs=require('node:fs'),p=require('node:path');fs.mkdirSync(process.env.A2A_TEST_YGL_HOME);fs.writeFileSync(p.join(process.env.TMP,'unowned-residue'),'must fail');")
    expect(run.status).toBe(1)
    expect(run.temp).toMatchObject({ entries: 1, remaining: ['unowned-residue'], status: 1 })
  })
  it('preserves a child failure even with an otherwise empty temp root', () => {
    const run = invoke('process.exit(7)')
    expect(run.status).toBe(7)
    expect(run.temp).toMatchObject({ entries: 0, status: 7 })
  })
})
