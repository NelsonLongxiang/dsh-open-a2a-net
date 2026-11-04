// @vitest-environment node
/**
 * #303: a spec that spawns the shipped CLI must not hand it the operator's environment. The CLI ranks
 * `A2A_HOME` above its saved home and reads `A2A_KEY` / `A2A_TOKEN` from the environment, so a spread
 * `process.env` sends test routes to a real host with real credentials. Mesh specs use `cliEnv(home)`.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cliEnv } from '../mesh/harness.ts'

function specs(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'live' ? [] : specs(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

describe('#303 CLI spawn environment', () => {
  it('no spec that runs cli/a2a.mjs spreads process.env', () => {
    const root = join(process.cwd(), 'tests')
    const offenders = specs(root).filter(path => {
      const text = readFileSync(path, 'utf8')
      return text.includes('cli/a2a.mjs') && /\.\.\.\s*process\.env\b/.test(text)
    }).map(path => relative(process.cwd(), path))
    expect(offenders).toEqual([])
  })
  it('cliEnv drops every A2A_* variable and sets the test home', () => {
    const saved = Object.assign({}, process.env)
    try {
      Object.assign(process.env, { A2A_HOME: 'http://real.example', A2A_KEY: 'real-key', A2A_TOKEN: 't', A2A_POCKET_TOKEN: 'p', A2A_CLI_HOME: '/real' })
      const env = cliEnv('/tmp/test-home')
      expect(Object.keys(env).filter(name => name.startsWith('A2A_'))).toEqual(['A2A_CLI_HOME'])
      expect(env.A2A_CLI_HOME).toBe('/tmp/test-home')
      expect(env.PATH).toBe(process.env.PATH)
    } finally {
      for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]
      Object.assign(process.env, saved)
    }
  })
})
