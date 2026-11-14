import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { layoutFindings, checkRepositoryLayout } from '../scripts/verify-repository-layout.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = join(repo, 'tmp', 'repository-layout-tests')
mkdirSync(fixtures, { recursive: true })
function fixture(t) {
  const root = mkdtempSync(join(fixtures, 'run-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  return root
}
function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
function lifecycle(t, source) {
  const home = fixture(t)
  const script = join(home, 'child.mjs')
  writeFileSync(script, source)
  const result = spawnSync(process.execPath, [join(repo, 'scripts/verify-temp-clean.mjs'), '--', process.execPath, script], { cwd: repo, encoding: 'utf8', timeout: 30000 })
  const line = result.stdout.split(/\r?\n/).find(line => line.startsWith('[temp-clean] '))
  assert.ok(line, result.stderr + result.stdout)
  return { ...result, report: JSON.parse(line.slice('[temp-clean] '.length)) }
}

test('documented source directories, required root entrypoints and local runtime data are allowed', () => {
  assert.deepEqual(layoutFindings([
    'package.json', 'README.md', 'AGENTS.md', 'LICENSE', 'cordis.patch.yml',
    'scripts/check.mjs', 'docs/guides/a.md', 'verify/material.md', 'nexus-stage/package-lock.json',
  ], [
    { name: 'package.json', kind: 'file' }, { name: 'src', kind: 'directory' },
    { name: 'tmp', kind: 'directory' }, { name: 'feedback', kind: 'directory' },
    { name: 'a2a-inbox', kind: 'directory' }, { name: 'node_modules', kind: 'link' },
    { name: '.npmrc', kind: 'file' },
  ]), [])
})

test('feedback, received files, scratch and generated output cannot be tracked', () => {
  for (const path of ['feedback/review.md', 'a2a-inbox/file.log', 'tmp/task/log.txt', 'lib/index.js', 'node_modules/x.js']) {
    assert.equal(layoutFindings([path], [])[0]?.code, 'tracked-local-artifact', path)
  }
})

test('ignored archives, extracted packages and root reports are reported without being hidden or deleted', () => {
  const paths = ['old.tgz', 'package', '.claude-fix.py', 'results.json', 'package-lock.json']
  const entries = paths.map(name => ({ name, kind: name === 'package' ? 'directory' : 'file' }))
  assert.deepEqual(layoutFindings([], entries).map(f => f.path), paths)
})

test('new root files, source directories and unexpected links need explicit placement', () => {
  assert.equal(layoutFindings(['fix.py'], [])[0]?.code, 'unexpected-tracked-root-file')
  assert.equal(layoutFindings(['dump/log.json'], [])[0]?.code, 'unexpected-tracked-root-directory')
  assert.equal(layoutFindings([], [{ name: 'feedback', kind: 'link' }])[0]?.code, 'unexpected-root-entry')
})

test('index-only feedback removal preserves local bytes and the subproject npm lock remains trackable', t => {
  const root = fixture(t)
  git(root, 'init', '--quiet')
  mkdirSync(join(root, 'feedback')); mkdirSync(join(root, 'nexus-stage'))
  writeFileSync(join(root, 'feedback', 'review.md'), 'keep original feedback\n')
  git(root, 'add', '--', 'feedback/review.md')
  writeFileSync(join(root, 'nexus-stage', 'package-lock.json'), '{}\n')
  writeFileSync(join(root, '.gitignore'), '/feedback/\n/a2a-inbox/\n/package/\n/package-lock.json\n')
  git(root, 'add', '--', '.gitignore', 'nexus-stage/package-lock.json')
  assert.equal(checkRepositoryLayout(root).findings[0]?.code, 'tracked-local-artifact')
  git(root, 'rm', '--cached', '--', 'feedback/review.md')
  assert.equal(readFileSync(join(root, 'feedback', 'review.md'), 'utf8'), 'keep original feedback\n')
  assert.deepEqual(checkRepositoryLayout(root).findings, [])
  assert.equal(git(root, 'ls-files', '--', 'nexus-stage/package-lock.json').trim(), 'nexus-stage/package-lock.json')
  writeFileSync(join(root, 'old.tgz'), 'not a real archive; read-only root fixture')
  assert.equal(checkRepositoryLayout(root).findings[0]?.path, 'old.tgz')
  assert.ok(existsSync(join(root, 'old.tgz')))
})

test('current checkout passes the same index and real-root check', () => {
  assert.deepEqual(checkRepositoryLayout(repo).findings, [])
})

test('existing lifecycle runner owns project-local temp and isolates the ygl workspace', t => {
  const child = "import {tmpdir} from 'node:os';import {mkdirSync} from 'node:fs';if(tmpdir()!==process.env.TEMP||tmpdir()!==process.env.TMP||tmpdir()!==process.env.TMPDIR)process.exit(9);mkdirSync(process.env.A2A_TEST_YGL_HOME,{recursive:true});console.log('FIXTURE_TMP='+tmpdir())"
  const result = lifecycle(t, child)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  const rel = relative(realpathSync(repo), result.report.root)
  assert.ok(!isAbsolute(rel) && !rel.startsWith('..' + sep) && rel.startsWith('tmp' + sep + 'test-runs' + sep))
  assert.equal(result.report.entries, 0)
  assert.equal(existsSync(result.report.root), false)
})

test('lifecycle gate reports leaks before cleaning only its owned root', t => {
  const sentinel = join(fixture(t), 'keep.txt')
  writeFileSync(sentinel, 'do not sweep other task directories')
  const child = "import {tmpdir} from 'node:os';import {writeFileSync} from 'node:fs';import {join} from 'node:path';writeFileSync(join(tmpdir(),'unexpected.log'),'fixture residue')"
  const result = lifecycle(t, child)
  assert.equal(result.status, 1, result.stderr + result.stdout)
  assert.deepEqual(result.report.remaining, ['unexpected.log'])
  assert.equal(existsSync(result.report.root), false)
  assert.equal(readFileSync(sentinel, 'utf8'), 'do not sweep other task directories')
})

test('lifecycle wrapper propagates a nonzero child status', t => {
  const result = lifecycle(t, 'process.exit(7)\n')
  assert.equal(result.status, 7, result.stderr + result.stdout)
  assert.equal(result.report.entries, 0)
  assert.equal(existsSync(result.report.root), false)
})
