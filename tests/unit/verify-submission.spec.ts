import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submissionFromProbe, inspectCandidateSource } from '../../scripts/verify-submission.mjs'


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

describe('new probe run binding', () => {
  it('requires a full candidate SHA and the exact run/snapshot/summary/submission relationship', () => {
    const run = mkdtempSync(join(tmpdir(), 'bound-probe-'))
    const summary = join(run, 'probe-summary.json'), snapshot = join(run, 'snapshot.sqlite')
    const submission = join(run, 'dsh-a2a-submission-actual'), head = 'd'.repeat(40)
    mkdirSync(submission)
    const row = { candidate_sha: head, git_head: head, snapshot, submission_root: run, submission }
    writeFileSync(summary, JSON.stringify(row))
    expect(submissionFromProbe(summary, snapshot, head)).toEqual({ ok: true, path: submission })
    writeFileSync(summary, JSON.stringify({ ...row, git_head: head.slice(0, 8) }))
    expect(submissionFromProbe(summary, snapshot, head).ok).toBe(false)
    writeFileSync(summary, JSON.stringify({ ...row, candidate_sha: 'e'.repeat(40) }))
    expect(submissionFromProbe(summary, snapshot, head).ok).toBe(false)
    writeFileSync(summary, JSON.stringify({ ...row, submission_root: join(run, 'other') }))
    expect(submissionFromProbe(summary, snapshot, head).ok).toBe(false)
    writeFileSync(summary, JSON.stringify(row))
    const outside = join(mkdtempSync(join(tmpdir(), 'foreign-summary-')), 'probe-summary.json')
    copyFileSync(summary, outside)
    expect(submissionFromProbe(outside, snapshot, head).ok).toBe(false)
  })
})

describe('RC recursive verifier submission binding', () => {
  it('never falls back to an old fixed TEMP directory; only this snapshot and HEAD selects its unique export', () => {
    const root = mkdtempSync(join(tmpdir(), 'a2a-verify-submission-test-'))
    try {
      const stale = join(root, 'dsh-a2a-submission')
      const fresh = join(root, 'dsh-a2a-submission-actual')
      const snapshot = join(root, 'snapshot.sqlite')
      const summary = join(root, 'probe-summary.json')
      const head = 'a'.repeat(40)
      mkdirSync(stale); mkdirSync(fresh)
      writeFileSync(join(stale, 'old.js'), 'old tree')
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
      writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: stale }))
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
      writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: fresh }))
      expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: true, path: fresh })
      expect(submissionFromProbe(summary, snapshot + '.other', head, root).ok).toBe(false)
      expect(submissionFromProbe(summary, snapshot, 'b'.repeat(40), root).ok).toBe(false)
      writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: join(root, '..', 'dsh-a2a-submission-foreign') }))
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses a summary without a submission, a vanished export, and a link standing in for one — the old fixed directory is never the answer', () => {
    const root = mkdtempSync(join(tmpdir(), 'a2a-verify-submission-test-'))
    try {
      const snapshot = join(root, 'snapshot.sqlite')
      const summary = join(root, 'probe-summary.json')
      const head = 'c'.repeat(40)
      const stale = join(root, 'dsh-a2a-submission')
      mkdirSync(stale)
      const row = (extra: Record<string, unknown>) => writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), ...extra }))
      row({})
      expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: false, error: expect.stringContaining('lacks an absolute submission path') as unknown })
      row({ submission: join(root, 'dsh-a2a-submission-gone') })
      expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: false, error: expect.stringContaining('missing') as unknown })
      const link = join(root, 'dsh-a2a-submission-link')
      symlinkSync(stale, link)
      row({ submission: link })
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('verify-recursive hands the engine only the bound submission path (no fixed-directory fallback at the call site)', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'verify-recursive.mjs'), 'utf8')
    expect(src).not.toMatch(/["']dsh-a2a-submission["']/)
    expect(src).not.toMatch(/\btmpdir\(/)
    expect(src).toMatch(/"--submission", submission\.path/)
  })
})
