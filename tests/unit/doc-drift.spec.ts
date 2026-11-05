/**
 * gh#56: the doc drift check is green on this checkout, and each pair goes red when a doc loses a
 * row the code has, or keeps a row the code dropped (the issue's counterexample self-check).
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkRepo, cliDocGaps, cliSurface, configKeys, diff, documentedRoutes, firstColumnNames, registeredRoutes, registeredTools, tableRows,
} from '../../scripts/doc-drift.mjs'

const REPO = process.cwd()
const drifted = (rows: Array<{ pair: string; missing: string[]; stale: string[] }>) => rows.filter(r => r.missing.length > 0 || r.stale.length > 0)

/** A copy of just the files the check reads, so a test can break one of them. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-drift-'))
  for (const p of ['src', 'cli', 'README.md', 'README_zh.md']) cpSync(join(REPO, p), join(dir, p), { recursive: true })
  return dir
}
const rewrite = (dir: string, file: string, from: string | RegExp, to: string): void => {
  const before = readFileSync(join(dir, file), 'utf8')
  const after = before.replace(from, to)
  expect(after, `${file}: pattern not found`).not.toBe(before)
  writeFileSync(join(dir, file), after)
}

describe('gh#56 doc drift — this checkout', () => {
  it('every pair is in step', () => {
    expect(drifted(checkRepo(REPO))).toEqual([])
  })

  it('the extractors see the real surfaces (a check that finds nothing would pass vacuously)', () => {
    const config = readFileSync(join(REPO, 'src/config.ts'), 'utf8')
    expect(configKeys(config).size).toBeGreaterThan(30)
    const cli = cliSurface(readFileSync(join(REPO, 'cli/a2a.mjs'), 'utf8'))
    expect([...cli.commands]).toEqual(expect.arrayContaining(['route', 'inbox', 'file', 'whoami']))
    expect([...cli.flags]).toEqual(expect.arrayContaining(['--json', '--note', '--sync']))
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
    expect(firstColumnNames(tableRows(readme, 'Tool')).size).toBeGreaterThanOrEqual(12)
    expect(documentedRoutes(tableRows(readme, 'Control route')).has('/__dsh_a2a/leave')).toBe(true)
  })
})

describe('gh#56 doc drift — counterexamples go red', () => {
  it('a tool row deleted from README.md', () => {
    const dir = scratchRepo()
    rewrite(dir, 'README.md', /^\| `a2a_probe` \|[^\r\n]*\r?\n/m, '')
    expect(drifted(checkRepo(dir))).toEqual([{ pair: 'tools ↔ README.md', missing: ['a2a_probe'], stale: [] }])
  })

  it('a tool the code no longer registers but README_zh.md still lists', () => {
    const dir = scratchRepo()
    rewrite(dir, 'README_zh.md', /^(\| `a2a_probe` \|.*)$/m, '$1\n| `a2a_gone` | 已删 | 已删 |')
    expect(drifted(checkRepo(dir))).toEqual([{ pair: 'tools ↔ README_zh.md', missing: [], stale: ['a2a_gone'] }])
  })

  it('a new config key with no README row, and a new control route with no row', () => {
    const dir = scratchRepo()
    rewrite(dir, 'src/config.ts', "  team: s.string().default('dsh'),", "  team: s.string().default('dsh'),\n  brandNewKey: s.boolean().default(false),")
    rewrite(dir, 'src/faces/nodes.ts', "path: '/__dsh_a2a/nodes'", "path: '/__dsh_a2a/nodes-v2'")
    const rows = drifted(checkRepo(dir))
    expect(rows.map(r => r.pair)).toEqual(['config ↔ README.md', 'routes ↔ README.md', 'config ↔ README_zh.md', 'routes ↔ README_zh.md'])
    expect(rows[0]).toEqual(expect.objectContaining({ missing: ['brandNewKey'] }))
    expect(rows[1]).toEqual({ pair: 'routes ↔ README.md', missing: ['/__dsh_a2a/nodes-v2'], stale: ['/__dsh_a2a/nodes'] })
  })

  it('a tool missing from the CLI catalog, and a CLI command the reference never names', () => {
    const dir = scratchRepo()
    rewrite(dir, 'cli/a2a.mjs', /^ {2}\['a2a_file_fetch',.*\n/m, '')
    rewrite(dir, 'cli/a2a.mjs', "if (cmd === 'revoke')", "if (cmd === 'secretcmd') { return }\n  if (cmd === 'revoke')")
    expect(drifted(checkRepo(dir))).toEqual([
      { pair: 'tools ↔ cli TOOL_CATALOG', missing: ['a2a_file_fetch'], stale: [] },
      { pair: 'cli ↔ references/cli.md', missing: ['secretcmd'], stale: [] },
    ])
  })
})

describe('gh#56 doc drift — extractor edges', () => {
  it('a bare /x token in a route row abbreviates /__dsh_a2a/x; methods are dropped', () => {
    expect([...documentedRoutes(['| `POST /__dsh_a2a/join` · `/leave` | x |'])]).toEqual(['/__dsh_a2a/join', '/__dsh_a2a/leave'])
  })
  it('only defineTool names count as tools; only path: routes count as routes', () => {
    expect([...registeredTools(["defineTool({\n  name: 'a2a_x',", "const name: 'a2a_y'"])]).toEqual(['a2a_x'])
    expect([...registeredRoutes(["path: '/__dsh_a2a/z',", "fetch('/__dsh_a2a/w')"])]).toEqual(['/__dsh_a2a/z'])
  })
  it('an exempt key is never reported missing, but a doc row for a key the code dropped is stale', () => {
    expect(diff(new Set(['a', 'b']), new Set(['c']), new Set(['b']))).toEqual({ missing: ['a'], stale: ['c'] })
  })
  it('cliDocGaps reads backticked command and flag words, with or without the a2a-net prefix', () => {
    const gaps = cliDocGaps({ commands: new Set(['route', 'inbox']), flags: new Set(['--json', '--wait']) }, '`a2a-net route <team>` and `inbox --wait`')
    expect(gaps).toEqual({ commands: [], flags: ['--json'] })
  })
})
