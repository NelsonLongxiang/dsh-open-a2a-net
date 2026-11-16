/** Guard the installed Vitest 4 scheduling contract, not an obsolete config spelling. */
import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

// Read configuration only: the child must not execute a nested copy of the suite.
const inspect = [
  "import { createVitest } from './node_modules/vitest/dist/node.js'",
  "const ctx = await createVitest('test', { root: process.cwd(), config: 'vitest.config.ts', watch: false, run: true })",
  "try { console.log(JSON.stringify({ maxWorkers: ctx.config.maxWorkers, pool: ctx.config.pool, testTimeout: ctx.config.testTimeout, hookTimeout: ctx.config.hookTimeout, retry: ctx.config.retry ?? 0, projects: ctx.projects.map(project => ({ maxWorkers: project.config.maxWorkers, testTimeout: project.config.testTimeout, yglHome: project.config.env.SUPERAGENT_YGL_HOME })) })) } finally { await ctx.close() }",
].join(';')

describe('installed Vitest scheduling and lifecycle contract', () => {
  it.each([true, false])('resolves the configured worker and ygl workspace (outer variable present=%s)', outerVariable => {
    if (!outerVariable) vi.stubEnv('A2A_TEST_YGL_HOME', undefined)
    try {
      // Bare Vitest inherits its configured SUPERAGENT_YGL_HOME; an outer lifecycle
      // runner additionally provides A2A_TEST_YGL_HOME. Accept either without
      // allocating a second workspace or making the runner mandatory.
      const yglHome = process.env.A2A_TEST_YGL_HOME ?? process.env.SUPERAGENT_YGL_HOME
      expect(yglHome).toBeTruthy()
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', inspect], {
        cwd: process.cwd(), env: { ...process.env, A2A_TEST_YGL_HOME: yglHome }, encoding: 'utf8', timeout: 15000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).not.toContain('test.poolOptions')
      const config = JSON.parse(result.stdout)
      expect(config).toMatchObject({ pool: 'forks', maxWorkers: 1, testTimeout: 5000, hookTimeout: 10000, retry: 0 })
      expect(config.projects).toHaveLength(1)
      expect(config.projects[0]).toMatchObject({ maxWorkers: 1, testTimeout: 5000, yglHome })
    } finally { vi.unstubAllEnvs() }
  })
})
