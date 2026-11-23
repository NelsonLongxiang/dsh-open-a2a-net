#!/usr/bin/env node
/** Read-only repository layout check. This reports paths; it never moves or deletes them. */
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT_FILES = new Set([
  '.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md', 'README_zh.md',
  'THIRD_PARTY_NOTICES.md', 'cordis.patch.yml', 'package.json', 'pnpm-lock.yaml', 'screenshots.json',
  'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'vitest.config.ts',
])
const SOURCE_DIRS = new Set([
  '.github', 'assets', 'cli', 'docs', 'examples', 'images', 'nexus-stage', 'pi', 'scripts', 'src', 'tests', 'verify',
])
const LOCAL_DIRS = new Set([
  '.git', '.claude', '.sessions', '.vscode', '.idea', 'node_modules', 'lib', 'coverage',
  'tmp', 'feedback', 'a2a-inbox',
])
const LOCAL_FILES = new Set(['.npmrc', '.DS_Store', 'desktop.ini'])
const LOCAL_ONLY = new Set(['.claude', '.sessions', 'node_modules', 'lib', 'coverage', 'tmp', 'feedback', 'a2a-inbox'])

/** Pure path policy, shared by the CLI and counterexample fixtures. */
export function layoutFindings(tracked, entries, { linkedWorktree = false } = {}) {
  const findings = []
  for (const path of tracked) {
    const segments = path.split('/')
    if (LOCAL_ONLY.has(segments[0])) {
      findings.push({ code: 'tracked-local-artifact', path, reason: 'Local feedback, received files, generated output and scratch do not belong in Git.' })
    } else if (segments.length === 1 && !ROOT_FILES.has(path)) {
      findings.push({ code: 'unexpected-tracked-root-file', path, reason: 'Place tools in scripts/, documentation in docs/, and one-off outputs in tmp/<task>/.' })
    } else if (segments.length > 1 && !SOURCE_DIRS.has(segments[0])) {
      findings.push({ code: 'unexpected-tracked-root-directory', path, reason: 'A new top-level source directory needs an explicit layout-policy update.' })
    }
  }
  for (const { name, kind } of entries) {
    const known = kind === 'directory'
      ? SOURCE_DIRS.has(name) || LOCAL_DIRS.has(name)
      : kind === 'file'
        ? ROOT_FILES.has(name) || LOCAL_FILES.has(name) || (name === '.git' && linkedWorktree)
        : kind === 'link' && ['node_modules', '.git'].includes(name)
    if (!known) findings.push({ code: 'unexpected-root-entry', path: name, reason: 'Inspect ownership and references, then preserve/archive the object; this check does not delete it.' })
  }
  return findings
}

/** Inspect this checkout, never an index or work tree selected by inherited Git environment overrides. */
function readGit(root, args) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  return spawnSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 << 20 })
}

/** A separate gitdir may forge common/back pointers; registration must belong to this common repository too. */
function isRegisteredAdmin(root, admin, common) {
  if (dirname(admin) !== realpathSync(join(common, 'worktrees'))) return false
  const listed = readGit(root, ['worktree', 'list', '--porcelain', '-z'])
  if (listed.error || listed.status !== 0) return false
  const current = realpathSync(root)
  return listed.stdout.split('\0').some(field => {
    if (!field.startsWith('worktree ')) return false
    // Another registered checkout can already be gone (prunable); it must not hide this valid one.
    try { return realpathSync(field.slice(9)) === current } catch { return false }
  })
}

/** A copied gitfile is not proof: Git's per-worktree admin directory must point back to this exact .git file. */
function isLinkedWorktree(root) {
  try {
    const proof = readGit(root, ['rev-parse', '--absolute-git-dir', '--git-common-dir', '--show-toplevel', '--is-inside-work-tree'])
    if (proof.error || proof.status !== 0) return false
    const paths = proof.stdout.trimEnd().split(/\r?\n/)
    if (paths.length !== 4 || paths[3] !== 'true') return false
    const [admin, common, top] = paths.slice(0, 3).map(path => realpathSync(resolve(root, path)))
    if (admin === common || top !== realpathSync(root)) return false
    if (!isRegisteredAdmin(root, admin, common)) return false
    const back = readFileSync(join(admin, 'gitdir'), 'utf8').replace(/\r?\n$/, '')
    return realpathSync(resolve(admin, back)) === realpathSync(join(root, '.git'))
  } catch {
    return false
  }
}

/** Check the current index plus actual root entries; include ignored files instead of hiding clutter. */
export function checkRepositoryLayout(root) {
  const absolute = resolve(root)
  const listed = readGit(absolute, ['ls-files', '--cached', '-z'])
  if (listed.error) throw listed.error
  if (listed.status !== 0) throw Error('Cannot inspect Git index: ' + String(listed.stderr).trim())
  const tracked = listed.stdout.split('\0').filter(Boolean)
  const entries = readdirSync(absolute, { withFileTypes: true }).map(entry => ({
    name: entry.name,
    kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
  }))
  const linkedWorktree = entries.some(entry => entry.name === '.git' && entry.kind === 'file') && isLinkedWorktree(absolute)
  return { root: absolute, tracked: tracked.length, rootEntries: entries.length, findings: layoutFindings(tracked, entries, { linkedWorktree }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 2 || (args.length && (args[0] !== '--root' || !args[1]))) throw Error('usage: node scripts/verify-repository-layout.mjs [--root <checkout>]')
    const result = checkRepositoryLayout(args[1] ?? process.cwd())
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.findings.length ? 1 : 0
  } catch (error) {
    console.error('repository-layout: ' + String(error.message ?? error))
    process.exitCode = 2
  }
}
