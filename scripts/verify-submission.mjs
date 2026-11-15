import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

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
    return { path, mode: match[1], blob: match[2], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
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
    const rel = relative(realpathSync(allowedRoot), path)
    if (rel.startsWith('..') || isAbsolute(rel) || !basename(path).startsWith('dsh-a2a-submission-')) return { ok: false, error: 'submission path is outside this run’s temporary area' }
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) return { ok: false, error: 'this run’s submission directory is missing' }
    return { ok: true, path }
  } catch (error) { return { ok: false, error: 'probe summary unavailable: ' + String(error) } }
}
