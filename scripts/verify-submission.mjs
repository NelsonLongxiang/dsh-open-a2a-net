import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const nodeRequire = createRequire(import.meta.url)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** Pin collection to actual committed bytes. An export is not a Git worktree-clean PASS. */
export function inspectCandidateSource(root, candidateSha, sourceRepo = root) {
  if (lstatSync(root).isSymbolicLink()) throw Error('candidate source root must not be a link')
  root = realpathSync(root)
  const git = args => {
    const result = spawnSync('git', ['--no-optional-locks', '-C', sourceRepo, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 << 20 })
    if (result.error || result.status !== 0) throw Error('candidate Git read failed: ' + String(result.stderr || result.error))
    return result.stdout
  }
  const top = realpathSync(git(['rev-parse', '--show-toplevel']).trim())
  const checkout = top === root
  if (candidateSha === undefined && !checkout) throw Error('source is an export, not this checkout; require --candidate-sha and --source-repo')
  const sha = candidateSha ?? git(['rev-parse', 'HEAD']).trim()
  if (!/^[a-f0-9]{40}$/.test(sha) || git(['rev-parse', '--verify', sha + '^{commit}']).trim() !== sha) throw Error('candidate must name a full existing commit SHA')
  const entries = git(['ls-tree', '-rz', '--full-tree', sha]).split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line)
    if (!match || match[3].includes('\\') || match[3].split('/').some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) throw Error('unsupported candidate tree entry')
    const path = match[3]
    const segments = path.split('/')
    for (let i = 1; i <= segments.length; i++) {
      const stat = lstatSync(resolve(root, ...segments.slice(0, i)))
      if (stat.isSymbolicLink() || (i < segments.length ? !stat.isDirectory() : !stat.isFile())) throw Error('candidate source is linked or not regular: ' + path)
      if (i === segments.length && process.platform !== 'win32' && Boolean(stat.mode & 0o111) !== (match[1] === '100755')) throw Error('candidate executable mode differs: ' + path)
    }
    const bytes = readFileSync(resolve(root, path))
    const blob = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
    if (blob !== match[2]) throw Error('candidate source bytes differ: ' + path)
    return { path, mode: match[1], blob: match[2], size: bytes.length, sha256: digest(bytes) }
  })
  if (!entries.length) throw Error('candidate tree is empty')
  if (!checkout) {
    const tracked = new Set(entries.map(entry => entry.path))
    const walk = (directory, prefix = '') => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = prefix + item.name
        // Generated dependency/build/runtime trees are not candidate source. Tracked entries in them were already checked.
        if (item.name === 'node_modules' || (!prefix && ['lib', 'tmp', 'coverage', '.vite'].includes(item.name))) continue
        if (item.isSymbolicLink()) throw Error('unexpected linked export entry: ' + path)
        if (item.isDirectory()) walk(resolve(directory, item.name), path + '/')
        else if (!item.isFile() || !tracked.has(path)) throw Error('unexpected export source entry: ' + path)
      }
    }
    walk(root)
  }
  const current = git(['rev-parse', 'HEAD']).trim()
  const status = checkout ? git(['status', '--porcelain', '--untracked-files=normal']) : null
  const clean = checkout && current === sha && status === ''
  return { sha, executableModesVerified: process.platform !== 'win32' || entries.every(entry => entry.mode !== '100755'), executableModeScope: process.platform === 'win32' ? 'Git object modes recorded; filesystem executable preservation is unavailable on Windows' : 'Git and filesystem executable bits matched', tree: git(['rev-parse', sha + '^{tree}']).trim(), kind: checkout ? 'git-worktree' : 'verified-export', clean, cleanDetail: clean ? 'clean worktree at exact candidate' : checkout ? 'worktree changed or HEAD differs from candidate' : 'verified source export; Git worktree cleanliness is not established', entries }
}

/** Read the candidate identity recorded in a frozen probe snapshot. Read-only; evidence is never mutated. */
function snapshotFacts(snapshotFile) {
  const { DatabaseSync } = nodeRequire('node:sqlite')
  const db = new DatabaseSync(snapshotFile, { readOnly: true })
  try {
    const facts = Object.create(null)
    for (const row of db.prepare('SELECT key, value FROM repo_facts').all()) facts[String(row.key)] = String(row.value)
    return facts
  } finally { db.close() }
}

const manifestEntryShape = entry => entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path !== '' && !entry.path.includes('\\')
  && !entry.path.split('/').some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))
  && Number.isSafeInteger(entry.size) && entry.size >= 0 && /^[0-9a-f]{64}$/.test(entry.sha256 ?? '')
  && (entry.mode === undefined || entry.mode === '100644' || entry.mode === '100755')

/** Walk an exported submission tree: regular files only, no links, no other node types. */
function walkSubmission(root) {
  const files = new Map()
  const walk = (directory, prefix = '') => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + item.name
      if (item.isSymbolicLink()) throw Error('linked submission entry: ' + path)
      if (item.isDirectory()) walk(join(directory, item.name), path + '/')
      else if (!item.isFile()) throw Error('non-regular submission entry: ' + path)
      else {
        const bytes = readFileSync(join(directory, item.name))
        files.set(path, { size: bytes.length, sha256: digest(bytes) })
      }
    }
  }
  walk(root)
  return files
}

/**
 * New-mode admission binds the actual bytes of one probe run: the summary, the snapshot's recorded
 * candidate identity and the source manifest must all name the requested candidate, and the
 * submission file set must match that manifest exactly. A summary repeating a SHA proves nothing
 * on its own.
 */
function verifyBoundRun(row, summaryFile, snapshotFile, head) {
  const runRoot = realpathSync(row.submission_root)
  for (const [name, file] of [['summary', summaryFile], ['snapshot', snapshotFile]]) {
    if (dirname(realpathSync(file)) !== runRoot) throw Error(name + ' is not canonically inside its probe run directory')
  }
  const facts = snapshotFacts(snapshotFile)
  if (facts.git_head !== head) throw Error('snapshot records a different candidate: ' + (facts.git_head ?? '<none>'))
  if (row.candidate_tree !== undefined && String(row.candidate_tree) !== facts.candidate_tree) throw Error('snapshot candidate tree differs from the probe summary')
  const manifestFile = join(runRoot, 'source-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.sha !== head) throw Error('source manifest names a different candidate')
  if (facts.candidate_tree !== undefined && manifest.tree !== facts.candidate_tree) throw Error('source manifest tree differs from the snapshot')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || !manifest.files.every(manifestEntryShape) || new Set(manifest.files.map(entry => entry.path)).size !== manifest.files.length) throw Error('source manifest is malformed')
  if (facts.source_manifest_sha256 !== undefined && digest(Buffer.from(JSON.stringify(manifest.files))) !== facts.source_manifest_sha256) throw Error('source manifest does not match the digest frozen in the snapshot')
  return manifest
}

/** One probe run's evidence selection. Legacy implicit defaults are removed: stale verify/*.sqlite can never be picked silently. */
export function resolveRunSelection(argv) {
  const args = Array.isArray(argv) ? argv : []
  const value = name => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] }
  const candidateSha = value('candidate-sha')
  if (args.includes('--fresh')) {
    if (value('summary') !== undefined || value('snapshot') !== undefined) throw Error('--fresh collects its own probe run; do not also pass --summary/--snapshot')
    return { mode: 'fresh', candidateSha }
  }
  const summary = value('summary'), snapshot = value('snapshot')
  if (summary === undefined || snapshot === undefined) throw Error('verify-recursive requires either --fresh or the explicit --summary <probe-summary.json> and --snapshot <snapshot.sqlite> of ONE verify-probe run (pass --candidate-sha with the full SHA); the legacy verify/snapshot.sqlite default was removed so stale evidence cannot be selected implicitly')
  return { mode: 'explicit', summary, snapshot, candidateSha }
}

/** Never run file checks against an old fixed TEMP directory or an unrelated probe snapshot. */
export function submissionFromProbe(summaryFile, snapshotFile, head, tempRoot) {
  try {
    const row = JSON.parse(readFileSync(summaryFile, 'utf8'))
    if (typeof head !== 'string' || !/^[a-f0-9]{40}$/.test(head) || row.snapshot !== snapshotFile || (row.candidate_sha !== undefined ? row.candidate_sha !== head || row.git_head !== head : row.git_head !== head && row.git_head !== head.slice(0, 8))) return { ok: false, error: 'probe summary does not match this snapshot or HEAD — run probe again' }
    if (row.candidate_sha !== undefined && (row.submission_root !== resolve(dirname(snapshotFile)) || dirname(resolve(summaryFile)) !== row.submission_root)) return { ok: false, error: 'new probe summary is not bound to its run directory' }
    const allowedRoot = tempRoot ?? (row.candidate_sha !== undefined ? row.submission_root : tmpdir())
    const candidate = row.submission
    if (typeof candidate !== 'string' || !isAbsolute(candidate)) return { ok: false, error: 'probe summary lacks an absolute submission path' }
    const path = resolve(candidate)
    const realRoot = realpathSync(allowedRoot)
    const realPath = realpathSync(path)
    const rel = relative(realRoot, realPath)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || !basename(realPath).startsWith('dsh-a2a-submission-')) return { ok: false, error: 'submission path is outside this run’s temporary area' }
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) return { ok: false, error: 'this run’s submission directory is missing' }
    if (row.candidate_sha !== undefined) {
      // The new-mode submission is the probe run's own direct export: one canonical child of the run root.
      if (dirname(path) !== row.submission_root || dirname(realPath) !== realRoot) throw Error('new-mode submission must be the probe run’s own direct export')
      const manifest = verifyBoundRun(row, summaryFile, snapshotFile, head)
      const present = walkSubmission(realPath)
      const expected = new Map(manifest.files.map(entry => [entry.path, entry]))
      const missing = [...expected.keys()].filter(file => !present.has(file))
      const extra = [...present.keys()].filter(file => !expected.has(file))
      const changed = [...expected].filter(([file, entry]) => present.has(file) && (present.get(file).size !== entry.size || present.get(file).sha256 !== entry.sha256)).map(([file]) => file)
      if (missing.length || extra.length || changed.length) throw Error('submission file set differs from the bound source manifest (missing ' + missing.length + ', extra ' + extra.length + ', changed ' + changed.length + ')')
      if (process.platform !== 'win32') for (const [file, entry] of expected) {
        if (entry.mode === '100755' && !(lstatSync(join(realPath, ...file.split('/'))).mode & 0o111)) throw Error('submission executable mode differs: ' + file)
      }
      return { ok: true, path: realPath, verified: { files: expected.size, modeScope: process.platform === 'win32' ? 'byte identity only; Windows executable bits are not verifiable here' : 'byte identity and executable modes verified' } }
    }
    return { ok: true, path }
  } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) } }
}
