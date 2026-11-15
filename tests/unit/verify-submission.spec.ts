import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { submissionFromProbe, inspectCandidateSource, resolveRunSelection } from '../../scripts/verify-submission.mjs'

describe('candidate source identity, never ancestor HEAD by accident', () => {
  function fixture() {
    const home = mkdtempSync(join(tmpdir(), 'verify-source-'))
    const repo = join(home, 'repo'), exported = join(repo, 'tmp', 'export')
    mkdirSync(repo)
    const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'utf8' }).trim()
    git('init', '-q')
    writeFileSync(join(repo, '.gitignore'), 'tmp/\nlib/\nnode_modules/\n')
    writeFileSync(join(repo, '.gitattributes'), '* -text\n')
    writeFileSync(join(repo, 'package.json'), '{"name":"synthetic-candidate","version":"1.0.0"}\n')
    git('add', '--', '.gitignore', '.gitattributes', 'package.json')
    const tree = git('write-tree')
    const sha = git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit-tree', tree, '-m', 'synthetic source')
    git('update-ref', 'HEAD', sha)
    mkdirSync(exported, { recursive: true })
    for (const name of ['.gitignore', '.gitattributes', 'package.json']) copyFileSync(join(repo, name), join(exported, name))
    const indexSHA = () => createHash('sha256').update(readFileSync(join(repo, '.git', 'index'))).digest('hex')
    return { repo, exported, sha, git, indexSHA }
  }
  it('accepts a real clean checkout and does not touch its index', () => {
    const f = fixture(), before = f.indexSHA()
    expect(inspectCandidateSource(f.repo)).toMatchObject({ sha: f.sha, kind: 'git-worktree', clean: true })
    expect(f.indexSHA()).toBe(before)
  })
  it('pins an exact export but preserves V7 as not established, despite a clean source repository', () => {
    const f = fixture(), before = f.indexSHA()
    const result = inspectCandidateSource(f.exported, f.sha, f.repo)
    expect(result).toMatchObject({ sha: f.sha, kind: 'verified-export', clean: false })
    expect(result.entries.map((entry: { path: string }) => entry.path).sort()).toEqual(['.gitattributes', '.gitignore', 'package.json'])
    expect(result.cleanDetail).toContain('not established')
    expect(f.indexSHA()).toBe(before)
  })
  it('refuses default collection from an export instead of inheriting the ancestor checkout HEAD', () => {
    const f = fixture()
    expect(() => inspectCandidateSource(f.exported)).toThrow('require --candidate-sha')
  })
  it.each(['short', '0'.repeat(40)])('rejects a short or nonexistent SHA %s', candidate => {
    const f = fixture()
    expect(() => inspectCandidateSource(f.exported, candidate, f.repo)).toThrow()
  })
  it('rejects changed bytes before running gates or producing a snapshot', () => {
    const f = fixture()
    writeFileSync(join(f.exported, 'package.json'), '{"version":"forged"}')
    expect(() => inspectCandidateSource(f.exported, f.sha, f.repo)).toThrow('source bytes differ')
  })
  it('rejects an extra executable source but permits separately generated build output', () => {
    const f = fixture()
    mkdirSync(join(f.exported, 'lib')); writeFileSync(join(f.exported, 'lib', 'generated.js'), 'build output')
    expect(inspectCandidateSource(f.exported, f.sha, f.repo).clean).toBe(false)
    writeFileSync(join(f.exported, 'unreviewed.mjs'), 'process.exit(0)')
    expect(() => inspectCandidateSource(f.exported, f.sha, f.repo)).toThrow('unexpected export source entry')
  })
  it('rejects symlink substitutions, including a candidate root alias', () => {
    const f = fixture()
    const alias = join(f.repo, 'tmp', 'linked-export')
    symlinkSync(f.exported, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => inspectCandidateSource(alias, f.sha, f.repo)).toThrow('root must not be a link')
    const file = join(f.exported, 'package.json'); rmSync(file); symlinkSync(join(f.repo, 'package.json'), file)
    expect(() => inspectCandidateSource(f.exported, f.sha, f.repo)).toThrow('linked or not regular')
  })
  it('a real checkout with untracked work is not clean and is never cleaned up by inspection', () => {
    const f = fixture(); writeFileSync(join(f.repo, 'in-progress.txt'), 'owned work')
    expect(inspectCandidateSource(f.repo, f.sha)).toMatchObject({ kind: 'git-worktree', clean: false })
    expect(readFileSync(join(f.repo, 'in-progress.txt'), 'utf8')).toBe('owned work')
  })
})

async function boundRun(files: Array<{ path: string; content: string; mode?: '100644' | '100755' }>, factsOverride: Record<string, string> = {}) {
  const { DatabaseSync } = await import('node:sqlite')
  const run = mkdtempSync(join(tmpdir(), 'bound-probe-'))
  const head = 'a'.repeat(40)
  const entries = files.map(file => ({ path: file.path, mode: file.mode ?? '100644', blob: 'b'.repeat(40), size: Buffer.byteLength(file.content), sha256: createHash('sha256').update(file.content).digest('hex') }))
  const manifest = { sha: head, tree: 'c'.repeat(40), kind: 'verified-export', files: entries }
  writeFileSync(join(run, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const submission = join(run, 'dsh-a2a-submission-actual')
  mkdirSync(submission)
  for (const file of files) {
    const dest = join(submission, file.path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, file.content)
  }
  const snapshot = join(run, 'snapshot.sqlite')
  const db = new DatabaseSync(snapshot)
  db.exec('CREATE TABLE repo_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const insert = db.prepare('INSERT INTO repo_facts VALUES (?,?)')
  const facts = { git_head: head, candidate_tree: manifest.tree, source_manifest_sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), ...factsOverride }
  for (const [key, value] of Object.entries(facts)) insert.run(key, value)
  db.close()
  const summary = join(run, 'probe-summary.json')
  writeFileSync(summary, JSON.stringify({ candidate_sha: head, git_head: head, candidate_tree: manifest.tree, snapshot, submission_root: run, submission }))
  return { run, head, summary, snapshot, submission, manifest, manifestFile: join(run, 'source-manifest.json') }
}
const sample = [{ path: 'package.json', content: '{"name":"x"}\n' }, { path: 'src/main.ts', content: 'export {}\n' }]

describe('new-mode admission binds the actual snapshot, manifest and submission bytes', () => {
  it('accepts one genuinely consistent run and reports what was verified', async () => {
    const f = await boundRun(sample)
    const result = submissionFromProbe(f.summary, f.snapshot, f.head)
    expect(result).toMatchObject({ ok: true, path: f.submission, verified: { files: 2 } })
  })
  it('rejects a readable snapshot that records a different candidate', async () => {
    const f = await boundRun(sample, { git_head: 'd'.repeat(40) })
    expect(submissionFromProbe(f.summary, f.snapshot, f.head)).toMatchObject({ ok: false, error: expect.stringContaining('different candidate') })
  })
  it('rejects snapshot bytes that are not a database instead of failing later', async () => {
    const f = await boundRun(sample)
    writeFileSync(f.snapshot, 'not sqlite at all')
    const result = submissionFromProbe(f.summary, f.snapshot, f.head)
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('different candidate')
  })
  it('rejects a missing or tampered source manifest', async () => {
    const missing = await boundRun(sample)
    rmSync(missing.manifestFile)
    expect(submissionFromProbe(missing.summary, missing.snapshot, missing.head).ok).toBe(false)
    const f = await boundRun(sample)
    const manifest = JSON.parse(readFileSync(f.manifestFile, 'utf8'))
    manifest.files[0].sha256 = 'e'.repeat(64)
    writeFileSync(f.manifestFile, JSON.stringify(manifest, null, 2) + '\n')
    expect(submissionFromProbe(f.summary, f.snapshot, f.head)).toMatchObject({ ok: false, error: expect.stringContaining('digest') })
  })
  it('rejects a foreign single-file submission and any missing/extra/changed file', async () => {
    const foreign = await boundRun(sample)
    rmSync(join(foreign.submission, 'src', 'main.ts'))
    writeFileSync(join(foreign.submission, 'not-the-candidate.txt'), 'x')
    expect(submissionFromProbe(foreign.summary, foreign.snapshot, foreign.head)).toMatchObject({ ok: false, error: expect.stringContaining('file set') })
    const missing = await boundRun(sample)
    rmSync(join(missing.submission, 'src', 'main.ts'))
    expect(submissionFromProbe(missing.summary, missing.snapshot, missing.head)).toMatchObject({ ok: false, error: expect.stringContaining('file set') })
    const extra = await boundRun(sample)
    writeFileSync(join(extra.submission, 'unlisted.txt'), 'x')
    expect(submissionFromProbe(extra.summary, extra.snapshot, extra.head)).toMatchObject({ ok: false, error: expect.stringContaining('file set') })
    const changed = await boundRun(sample)
    writeFileSync(join(changed.submission, 'package.json'), '{"name":"forged"}\n')
    expect(submissionFromProbe(changed.summary, changed.snapshot, changed.head)).toMatchObject({ ok: false, error: expect.stringContaining('file set') })
  })
  it('rejects a junction ancestor that redirects the submission outside the run root', async () => {
    const real = await boundRun(sample)
    const wrapper = mkdtempSync(join(tmpdir(), 'junction-run-'))
    const bridge = join(wrapper, 'bridge')
    symlinkSync(real.run, bridge, process.platform === 'win32' ? 'junction' : 'dir')
    for (const name of ['source-manifest.json', 'snapshot.sqlite']) copyFileSync(join(real.run, name), join(wrapper, name))
    const summary = join(wrapper, 'probe-summary.json')
    const snapshot = join(wrapper, 'snapshot.sqlite')
    writeFileSync(summary, JSON.stringify({ candidate_sha: real.head, git_head: real.head, snapshot, submission_root: wrapper, submission: join(bridge, 'dsh-a2a-submission-actual') }))
    const result = submissionFromProbe(summary, snapshot, real.head)
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('file set')
  })
  it('still rejects summary-level forgeries before any content is read', async () => {
    const f = await boundRun(sample)
    const row = JSON.parse(readFileSync(f.summary, 'utf8'))
    writeFileSync(f.summary, JSON.stringify({ ...row, candidate_sha: 'f'.repeat(40) }))
    expect(submissionFromProbe(f.summary, f.snapshot, f.head).ok).toBe(false)
    writeFileSync(f.summary, JSON.stringify({ ...row, submission_root: join(f.run, 'elsewhere') }))
    expect(submissionFromProbe(f.summary, f.snapshot, f.head).ok).toBe(false)
  })
})

describe('RC recursive verifier submission binding', () => {
  it('binds legacy probes to the explicit temp root of that run', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-run-'))
    const summary = join(root, 'probe-summary.json'), snapshot = join(root, 'snapshot.sqlite')
    const submission = join(root, 'dsh-a2a-submission-inside'), head = '5'.repeat(40)
    mkdirSync(submission)
    writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission }))
    expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: true, path: submission })
    writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: join(root, '..', 'dsh-a2a-submission-outside') }))
    expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
  })
  it('verify-recursive hands the engine only the bound submission path (no fixed-directory fallback at the call site)', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'verify-recursive.mjs'), 'utf8')
    expect(src).not.toMatch(/["']dsh-a2a-submission["']/)
    expect(src).not.toMatch(/\btmpdir\(/)
    expect(src).toMatch(/"--submission", submission\.path/)
  })
})

describe('recursive run selection contract', () => {
  it('refuses implicit legacy defaults, so stale verify/*.sqlite can never be selected silently', () => {
    expect(() => resolveRunSelection([])).toThrow(/--summary/)
    expect(() => resolveRunSelection(['--snapshot', 'x.sqlite'])).toThrow(/--summary/)
    expect(() => resolveRunSelection(['--summary', 'a.json'])).toThrow(/--snapshot/)
  })
  it('accepts an explicit one-run selection and forwards an optional full candidate SHA', () => {
    expect(resolveRunSelection(['--summary', 'a.json', '--snapshot', 'b.sqlite'])).toEqual({ mode: 'explicit', summary: 'a.json', snapshot: 'b.sqlite', candidateSha: undefined })
    expect(resolveRunSelection(['--summary', 'a.json', '--snapshot', 'b.sqlite', '--candidate-sha', 'f'.repeat(40)])).toEqual({ mode: 'explicit', summary: 'a.json', snapshot: 'b.sqlite', candidateSha: 'f'.repeat(40) })
  })
  it('fresh mode selects its own probe and rejects conflicting explicit paths', () => {
    expect(resolveRunSelection(['--fresh'])).toEqual({ mode: 'fresh', candidateSha: undefined })
    expect(() => resolveRunSelection(['--fresh', '--summary', 'a.json'])).toThrow(/--fresh/)
  })
  it('the runner validates selection before any engine work and exits with guidance', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'verify-recursive.mjs'), 'utf8')
    expect(src).not.toMatch(/"verify\/snapshot\.sqlite"/)
    expect(src).not.toMatch(/value\("snapshot", "verify\//)
    expect(src.indexOf('resolveRunSelection')).toBeGreaterThanOrEqual(0)
    expect(src.indexOf('resolveRunSelection')).toBeLessThan(src.indexOf('engine-self-check'))
    const result = spawnSync(process.execPath, [join(process.cwd(), 'scripts', 'verify-recursive.mjs')], { encoding: 'utf8', timeout: 20000 })
    expect(result.status).toBe(2)
    expect(String(result.stderr)).toContain('--summary')
    expect(String(result.stdout)).not.toContain('engine-self-check')
  })
})
