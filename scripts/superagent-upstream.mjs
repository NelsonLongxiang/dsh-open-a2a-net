#!/usr/bin/env node
/**
 * The vendored superagent domain engine (src/superagent/upstream/dsh-superagent) stays byte-for-byte upstream.
 *
 *   node scripts/superagent-upstream.mjs                 check: every vendored file is listed in UPSTREAM.json with its
 *                                                        sha256, nothing else sits in the directory, and the engine still
 *                                                        imports nothing outside itself but node:crypto
 *   node scripts/superagent-upstream.mjs --compare DIR   report which vendored files differ from an upstream checkout DIR,
 *                                                        and which upstream src/core files are not vendored
 *   node scripts/superagent-upstream.mjs --sync DIR --commit SHA
 *                                                        copy the listed files (and any new src/core file) from DIR and
 *                                                        rewrite UPSTREAM.json for SHA; review the diff like any change
 *   --root DIR                                           the vendored directory (tests point it at a copy)
 *
 * Exit 0 when clean, 1 when not; output is one JSON object.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const root = resolve(flag('--root') ?? join(here, '..', 'src', 'superagent', 'upstream', 'dsh-superagent'))
const MANIFEST = 'UPSTREAM.json'
const OWN = new Set([MANIFEST, 'README.md'])
/** Specifiers the engine may import from outside itself. */
const ALLOWED_EXTERNAL = new Set(['node:crypto', 'vitest'])

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const posix = path => path.split(sep).join('/')
const walk = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : [posix(relative(root, full))]
})
const done = (ok, body) => { console.log(JSON.stringify({ ok, root: posix(relative(process.cwd(), root)) || '.', ...body }, null, 2)); process.exit(ok ? 0 : 1) }

const manifestPath = join(root, MANIFEST)
if (!existsSync(manifestPath)) done(false, { problems: [`${MANIFEST} missing`] })
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const compareDir = flag('--compare')
const syncDir = flag('--sync')

if (syncDir !== undefined) {
  const commit = flag('--commit')
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) done(false, { problems: ['--sync needs --commit <40-hex sha>'] })
  const coreNow = readdirSync(join(syncDir, 'src', 'core')).filter(name => name.endsWith('.ts')).map(name => `src/core/${name}`)
  const paths = [...new Set([...Object.keys(manifest.files), ...coreNow])].sort()
  const files = {}
  for (const path of paths) {
    const from = join(syncDir, path)
    if (!existsSync(from)) continue
    mkdirSync(dirname(join(root, path)), { recursive: true })
    copyFileSync(from, join(root, path))
    files[path] = sha256(from)
  }
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, commit, files }, null, 2) + '\n')
  done(true, { synced: Object.keys(files).length, commit })
}

if (compareDir !== undefined) {
  const differs = Object.keys(manifest.files).filter(path => !existsSync(join(compareDir, path)) || sha256(join(compareDir, path)) !== manifest.files[path])
  const coreUpstream = existsSync(join(compareDir, 'src', 'core')) ? readdirSync(join(compareDir, 'src', 'core')).filter(name => name.endsWith('.ts')).map(name => `src/core/${name}`) : []
  const notVendored = coreUpstream.filter(path => manifest.files[path] === undefined)
  done(differs.length === 0 && notVendored.length === 0, { commit: manifest.commit, differs, notVendored })
}

const problems = []
const present = walk(root).filter(path => !OWN.has(path))
for (const path of present) {
  if (manifest.files[path] === undefined) problems.push(`not in ${MANIFEST}: ${path}`)
  else if (sha256(join(root, path)) !== manifest.files[path]) problems.push(`edited (sha256 differs from upstream ${manifest.commit.slice(0, 12)}): ${path}`)
}
for (const path of Object.keys(manifest.files)) if (!present.includes(path)) problems.push(`listed but missing: ${path}`)
// The engine is the pure domain layer: it reaches nothing of upstream's app, nothing of a2a, no package but node:crypto.
for (const path of present.filter(p => p.endsWith('.ts'))) {
  const text = readFileSync(join(root, path), 'utf8')
  for (const match of text.matchAll(/(?:import|export)[^'"]*?from\s+'([^']+)'|import\('([^']+)'\)/g)) {
    const spec = match[1] ?? match[2]
    if (spec.startsWith('.')) {
      const target = posix(relative(root, resolve(dirname(join(root, path)), spec)))
      if (target.startsWith('..') || !present.includes(target)) problems.push(`imports outside the vendored engine: ${path} -> ${spec}`)
    } else if (!ALLOWED_EXTERNAL.has(spec)) problems.push(`imports a package the engine must not need: ${path} -> ${spec}`)
  }
}
done(problems.length === 0, { commit: manifest.commit, files: present.length, problems })
