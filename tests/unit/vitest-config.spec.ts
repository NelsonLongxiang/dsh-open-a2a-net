/** Check the installed Vitest scheduling contract without running a nested suite. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const inspect = [
  "import { createVitest } from 'vitest/node'",
  "const ctx = await createVitest('test', { root: process.cwd(), config: 'vitest.config.ts', watch: false, run: true })",
  "const view = config => ({ maxWorkers: config.maxWorkers ?? null, pool: config.pool, testTimeout: config.testTimeout, hookTimeout: config.hookTimeout, retry: config.retry ?? 0, globalSetup: config.globalSetup })",
  "try { console.log('[resolved-test-config] ' + JSON.stringify({ root: view(ctx.config), projects: ctx.projects.map(project => view(project.config)) })) } finally { await ctx.close() }",
].join(';')

describe('installed Vitest default scheduling contract', () => {
  it('resolves one worker and preserves original budgets with the owned global lifecycle', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', inspect], {
      cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 15000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).not.toContain('test.poolOptions')
    const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('[resolved-test-config] '))
    expect(lines, result.stdout + result.stderr).toHaveLength(1)
    const config = JSON.parse(lines[0]!.slice('[resolved-test-config] '.length))
    const expected = { maxWorkers: 1, pool: 'forks', testTimeout: 5000, hookTimeout: 10000, retry: 0 }
    expect(config.root).toMatchObject(expected)
    expect(config.projects).toHaveLength(1)
    expect(config.projects[0]).toMatchObject(expected)
    expect(config.projects[0].globalSetup.map((file: string) => resolve(file)))
      .toEqual([resolve('tests/global-ygl-home.ts')])
  })
})
