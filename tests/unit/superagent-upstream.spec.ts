/**
 * superagent design v4, PR-A: the vendored superagent domain engine stays byte-for-byte upstream and self-contained.
 * The guard is scripts/superagent-upstream.mjs; each mutation below must make it fail and name the cause.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const VENDORED = join(import.meta.dirname, '..', '..', 'src', 'superagent', 'upstream', 'dsh-superagent')
const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'superagent-upstream.mjs')
const run = (...args: string[]): { status: number | null; out: Record<string, any> } => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { status: r.status, out: JSON.parse(r.stdout) as Record<string, any> }
}
const copy = (): string => { const dir = join(mkdtempSync(join(tmpdir(), 'sa-upstream-')), 'dsh-superagent'); cpSync(VENDORED, dir, { recursive: true }); return dir }

describe('vendored superagent engine', () => {
  it('matches the pinned upstream commit byte for byte and imports nothing outside itself', () => {
    const r = run()
    expect(r.out.problems).toEqual([])
    expect(r.status).toBe(0)
    const manifest = JSON.parse(readFileSync(join(VENDORED, 'UPSTREAM.json'), 'utf8')) as { commit: string; files: Record<string, string> }
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.keys(manifest.files)).toContain('src/core/engine.ts')
    expect(Object.keys(manifest.files)).toContain('tests/core-engine.spec.ts')
  })
  it('the engine exposes the ports a2a will implement', async () => {
    const core = await import('../../src/superagent/upstream/dsh-superagent/src/core/index.ts')
    expect(typeof core.Engine).toBe('function')
    expect(typeof core.MemoryRepositories).toBe('function')
  })
  const mutations: Array<[string, (dir: string) => void, RegExp]> = [
    ['a hand edit', dir => appendFileSync(join(dir, 'src/core/engine.ts'), '\n// local tweak\n'), /edited .*src\/core\/engine\.ts/],
    ['an unlisted file', dir => writeFileSync(join(dir, 'src/core/extra.ts'), 'export const x = 1\n'), /not in UPSTREAM\.json: src\/core\/extra\.ts/],
    ['a removed file', dir => writeFileSync(join(dir, 'UPSTREAM.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'UPSTREAM.json'), 'utf8')), files: { ...JSON.parse(readFileSync(join(dir, 'UPSTREAM.json'), 'utf8')).files, 'src/core/gone.ts': '0'.repeat(64) } })), /listed but missing: src\/core\/gone\.ts/],
  ]
  for (const [label, mutate, problem] of mutations) {
    it(`fails on ${label}`, () => {
      const dir = copy()
      mutate(dir)
      const r = run('--root', dir)
      expect(r.status).toBe(1)
      expect((r.out.problems as string[]).some(p => problem.test(p)), JSON.stringify(r.out.problems)).toBe(true)
    })
  }
  it('fails when a (listed) engine file reaches outside the engine', () => {
    const dir = copy()
    writeFileSync(join(dir, 'src/core/leak.ts'), "import { x } from '../../../../index.ts'\nimport z from 'zod'\nexport { x, z }\n")
    const manifest = JSON.parse(readFileSync(join(dir, 'UPSTREAM.json'), 'utf8')) as { files: Record<string, string> }
    manifest.files['src/core/leak.ts'] = createHash('sha256').update(readFileSync(join(dir, 'src/core/leak.ts'))).digest('hex')
    writeFileSync(join(dir, 'UPSTREAM.json'), JSON.stringify(manifest))
    const r = run('--root', dir)
    expect(r.status).toBe(1)
    expect(r.out.problems).toEqual(expect.arrayContaining([expect.stringMatching(/imports outside the vendored engine: src\/core\/leak\.ts/), expect.stringMatching(/package the engine must not need: src\/core\/leak\.ts -> zod/)]))
  })
  it('--compare reports drift against an upstream checkout', () => {
    const upstream = copy()
    appendFileSync(join(upstream, 'src/core/model.ts'), '\n// upstream moved on\n')
    writeFileSync(join(upstream, 'src/core/new-part.ts'), 'export {}\n')
    const r = run('--compare', upstream)
    expect(r.status).toBe(1)
    expect(r.out).toMatchObject({ differs: ['src/core/model.ts'], notVendored: ['src/core/new-part.ts'] })
  })
})
