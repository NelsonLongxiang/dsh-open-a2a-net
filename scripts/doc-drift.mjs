#!/usr/bin/env node
/**
 * gh#56 doc drift check: the docs that list a code surface must list exactly what the code
 * registers. Four pairs, each a set comparison so a missing row and a stale row both go red:
 *
 *   1. model tools     — `defineTool({ name })` in src/index.ts + src/tools/*.ts
 *                        == the tool table in README.md and README_zh.md
 *                        == the CLI's `a2a tools` catalog (cli/a2a.mjs TOOL_CATALOG)
 *   2. config keys     — the top-level `Config` schema keys in src/config.ts (src/index.ts before #77 moved it)
 *                        == the config table in both READMEs, minus CONFIG_UNDOCUMENTED (tuning knobs)
 *   3. CLI surface     — every `cmd === '<name>'` command and every flag of cli/a2a.mjs
 *                        appears in src/skill/references/cli.md
 *   4. control routes  — every `path: '/__dsh_a2a/…'` route in src/ == the control-route table
 *                        in both READMEs (a row may abbreviate a sibling as `/leave`)
 *
 * The extractors are pure functions of file text (exported for tests/unit/doc-drift.spec.ts);
 * `node scripts/doc-drift.mjs` reads the repo, prints one line per pair, and exits 1 on drift.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Schema keys a README need not list: internal timing knobs with safe defaults. */
export const CONFIG_UNDOCUMENTED = new Set([
  'wakeReconcileIntervalMs', 'wakeReconcileBackoffBaseMs', 'wakeReconcileMaxBackoffMs',
  'stateColdRowsTtlMs', 'cardCacheTtlMs', 'cardCacheNegativeTtlMs', 'remoteRowsTtlMs',
  'cardTtlMs', 'flushTimeoutMs', 'routeTimeoutMs',
])

const all = (re, text) => [...text.matchAll(re)].map(m => m[1])

/** Tool names registered through `defineTool({ name: '…' })`. */
export function registeredTools(sources) {
  return new Set(sources.flatMap(t => all(/defineTool\(\{\s*name:\s*'([a-z0-9_]+)'/g, t)))
}

/** The rows of the first markdown table whose header row starts with `| <header> |`. */
export function tableRows(markdown, header) {
  const lines = markdown.split('\n')
  const start = lines.findIndex(l => l.startsWith(`| ${header} |`))
  if (start < 0) return []
  const rows = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    rows.push(line)
  }
  return rows
}

/** The backticked names in a table's first column. */
export function firstColumnNames(rows) {
  return new Set(rows.flatMap(r => all(/`([^`]+)`/g, r.split('|')[1] ?? '')))
}

/** Tool names in the CLI's TOOL_CATALOG array. */
export function cliCatalogTools(cliText) {
  const block = /const TOOL_CATALOG = \[([\s\S]*?)\n\]/.exec(cliText)?.[1] ?? ''
  return new Set(all(/\['([a-z0-9_]+)'/g, block))
}

/** Top-level keys of `export const Config … = s.object({ … })` (two-space indented). */
export function configKeys(indexText) {
  const start = indexText.indexOf('export const Config')
  if (start < 0) return new Set()
  const body = indexText.slice(start)
  const end = body.indexOf('\n})')
  return new Set(all(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm, body.slice(0, end < 0 ? undefined : end)))
}

/** CLI commands (`cmd === 'x'`) and flags (VALUE_FLAGS plus `has('--x')` switches). */
export function cliSurface(cliText) {
  const commands = new Set(all(/cmd === '([a-z]+)'/g, cliText))
  const valueFlags = /const VALUE_FLAGS = new Set\(\[([^\]]*)\]\)/.exec(cliText)?.[1] ?? ''
  const flags = new Set([...all(/'(--[a-z-]+)'/g, valueFlags), ...all(/has\('(--[a-z-]+)'\)/g, cliText)])
  flags.delete('--help') // `-h` / `--help` is the universal spelling of the `help` command
  return { commands, flags }
}

/** Which CLI commands and flags the reference never mentions in backticks. */
export function cliDocGaps(surface, docText) {
  const ticked = all(/`([^`]+)`/g, docText)
  const words = new Set(ticked.flatMap(t => t.replace(/^a2a-net\s+/, '').split(/[\s/=[\]|]+/)))
  return {
    commands: [...surface.commands].filter(c => !words.has(c)),
    flags: [...surface.flags].filter(f => !words.has(f)),
  }
}

/** `/__dsh_a2a/*` control routes registered with `path: '…'`. */
export function registeredRoutes(sources) {
  return new Set(sources.flatMap(t => all(/path:\s*'(\/__dsh_a2a\/[a-z0-9/_-]+)'/g, t)))
}

/** Routes named in a control-route table; a bare `/x` token abbreviates `/__dsh_a2a/x`. */
export function documentedRoutes(rows) {
  const out = new Set()
  for (const name of firstColumnNames(rows)) {
    const path = name.replace(/^(GET|POST|PUT|DELETE)\s+/, '')
    if (path.startsWith('/__dsh_a2a/')) out.add(path)
    else if (path.startsWith('/')) out.add(`/__dsh_a2a${path}`)
  }
  return out
}

/** `{ missing, stale }` between what the code has and what a doc lists. */
export function diff(code, doc, exempt = new Set()) {
  return {
    missing: [...code].filter(x => !doc.has(x) && !exempt.has(x)).sort(),
    stale: [...doc].filter(x => !code.has(x)).sort(),
  }
}

/** Run every pair against a repo checkout; one result row per pair. */
export function checkRepo(repo) {
  const read = (p) => readFileSync(join(repo, p), 'utf8')
  const index = read('src/index.ts')
  const sources = [index, ...readdirSync(join(repo, 'src/tools')).filter(n => n.endsWith('.ts')).map(n => read(`src/tools/${n}`))]
  const everySource = readdirSync(join(repo, 'src'), { recursive: true }).map(String).filter(n => n.endsWith('.ts')).map(n => read(`src/${n}`))
  const cli = read('cli/a2a.mjs')
  const readmes = { 'README.md': read('README.md'), 'README_zh.md': read('README_zh.md') }
  const headers = { 'README.md': ['Tool', 'Key', 'Control route'], 'README_zh.md': ['工具', '键', '控制路由'] }
  const tools = registeredTools(sources)
  // #77: the Config schema moved to src/config.ts; older trees still keep it in index.ts.
  const keys = configKeys(existsSync(join(repo, 'src/config.ts')) ? read('src/config.ts') : index)
  const routes = registeredRoutes(everySource)
  const rows = []
  for (const [file, md] of Object.entries(readmes)) {
    const [toolH, keyH, routeH] = headers[file]
    rows.push({ pair: `tools ↔ ${file}`, ...diff(tools, firstColumnNames(tableRows(md, toolH))) })
    rows.push({ pair: `config ↔ ${file}`, ...diff(keys, firstColumnNames(tableRows(md, keyH)), CONFIG_UNDOCUMENTED) })
    rows.push({ pair: `routes ↔ ${file}`, ...diff(routes, documentedRoutes(tableRows(md, routeH))) })
  }
  rows.push({ pair: 'tools ↔ cli TOOL_CATALOG', ...diff(tools, cliCatalogTools(cli)) })
  const gaps = cliDocGaps(cliSurface(cli), read('src/skill/references/cli.md'))
  rows.push({ pair: 'cli ↔ references/cli.md', missing: [...gaps.commands, ...gaps.flags].sort(), stale: [] })
  return rows
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
  const rows = checkRepo(repo)
  for (const r of rows) {
    const ok = r.missing.length === 0 && r.stale.length === 0
    const detail = ok ? '' : `  missing: [${r.missing.join(', ')}]  stale: [${r.stale.join(', ')}]`
    console.log(`${ok ? 'ok  ' : 'DRIFT'} ${r.pair}${detail}`)
  }
  process.exit(rows.every(r => r.missing.length === 0 && r.stale.length === 0) ? 0 : 1)
}
