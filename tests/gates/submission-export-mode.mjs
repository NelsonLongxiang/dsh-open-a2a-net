/** Built-in Node regression: also runs on POSIX with no dependency install. */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { exportCandidateSubmission, submissionFromProbe } from '../../scripts/verify-submission.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const tmp = join(root, 'tmp')
mkdirSync(tmp, { recursive: true })
const owned = new Set()
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
afterEach(() => {
  for (const dir of [...owned]) {
    rmSync(dir, { recursive: true, force: true })
    assert.equal(readdirSync(dirname(dir)).includes(dir.slice(dirname(dir).length + 1)), false, 'owned test fixture was not cleaned')
    owned.delete(dir)
  }
})
function fixture() {
  const home = mkdtempSync(join(tmp, 'submission-mode-')); owned.add(home)
  const source = join(home, 'source'), run = join(home, 'run')
  mkdirSync(source); mkdirSync(run)
  const entries = [
    { path: 'cli/a2a.mjs', mode: '100755', content: '#!/usr/bin/env node\nconsole.log("EXECUTABLE_SOURCE_OK")\n' },
    { path: 'src/main.ts', mode: '100644', content: 'export {}\n' },
  ].map(file => {
    const dest = join(source, ...file.path.split('/')), bytes = Buffer.from(file.content)
    mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes)
    if (process.platform !== 'win32') chmodSync(dest, file.mode === '100755' ? 0o755 : 0o644)
    return { path: file.path, mode: file.mode, size: bytes.length, sha256: digest(bytes) }
  })
  const head = 'a'.repeat(40), tree = 'b'.repeat(40)
  writeFileSync(join(run, 'source-manifest.json'), JSON.stringify({ sha: head, tree, files: entries }))
  const snapshot = join(run, 'snapshot.sqlite'), summary = join(run, 'probe-summary.json')
  const db = new DatabaseSync(snapshot)
  try {
    db.exec('CREATE TABLE repo_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO repo_facts VALUES (?,?)')
    for (const [key, value] of Object.entries({ git_head: head, candidate_tree: tree, source_manifest_sha256: digest(Buffer.from(JSON.stringify(entries))) })) insert.run(key, value)
  } finally { db.close() }
  return { home, source, run, entries, head, tree, snapshot, summary }
}
function bind(f, submission) {
  writeFileSync(f.summary, JSON.stringify({ candidate_sha: f.head, git_head: f.head, candidate_tree: f.tree, submission_root: f.run, snapshot: f.snapshot, submission }))
  return submissionFromProbe(f.summary, f.snapshot, f.head)
}
const posix = { skip: process.platform === 'win32' ? 'Windows mode preservation is not verifiable' : false }
test('production probe invokes the exact exporter exercised here, not a second mode-dropping writer', () => {
  const source = readFileSync(join(root, 'scripts', 'verify-probe.mjs'), 'utf8')
  assert.match(source, /const SUBMISSION = exportCandidateSubmission\(REPO, source.entries, RUN_DIR\)/)
  assert.doesNotMatch(source, /writeNew\(dest, bytes\)/)
})
test('producer output binds unchanged source bytes and never mutates source or earlier exports', () => {
  const f = fixture()
  const before = f.entries.map(entry => ({ bytes: readFileSync(join(f.source, entry.path)), mode: lstatSync(join(f.source, entry.path)).mode }))
  const submission = exportCandidateSubmission(f.source, f.entries, f.run)
  const result = bind(f, submission)
  assert.equal(result.ok, true, result.error)
  if (process.platform === 'win32') assert.equal(result.verified.modeScope, 'byte identity only; Windows executable bits are not verifiable here')
  const previous = join(submission, 'cli', 'a2a.mjs')
  const previousBytes = readFileSync(previous), previousMode = lstatSync(previous).mode
  const next = exportCandidateSubmission(f.source, f.entries, f.run)
  assert.notEqual(next, submission)
  assert.deepEqual(readFileSync(previous), previousBytes); assert.equal(lstatSync(previous).mode, previousMode)
  f.entries.forEach((entry, i) => { assert.deepEqual(readFileSync(join(f.source, entry.path)), before[i].bytes); assert.equal(lstatSync(join(f.source, entry.path)).mode, before[i].mode) })
})
test('POSIX producer preserves Git 100755/100644 under restrictive umask and passes real admission', posix, () => {
  const f = fixture(), prior = process.umask(0o077)
  let submission
  try { submission = exportCandidateSubmission(f.source, f.entries, f.run) } finally { process.umask(prior) }
  assert.equal(lstatSync(join(submission, 'cli', 'a2a.mjs')).mode & 0o777, 0o755)
  assert.equal(lstatSync(join(submission, 'src', 'main.ts')).mode & 0o777, 0o644)
  const result = bind(f, submission)
  assert.equal(result.ok, true, result.error)
  assert.equal(result.verified.modeScope, 'byte identity and executable modes verified')
  const exec = spawnSync(join(submission, 'cli', 'a2a.mjs'), [], { encoding: 'utf8', timeout: 5000 })
  assert.equal(exec.error, undefined); assert.equal(exec.status, 0, exec.stderr)
  assert.equal(exec.stdout.trim(), 'EXECUTABLE_SOURCE_OK')
})
test('POSIX negative: removing execute permission refuses otherwise identical exported bytes', posix, () => {
  const f = fixture(), submission = exportCandidateSubmission(f.source, f.entries, f.run)
  const cli = join(submission, 'cli', 'a2a.mjs'), before = readFileSync(cli)
  chmodSync(cli, 0o600)
  assert.deepEqual(readFileSync(cli), before)
  const result = bind(f, submission)
  assert.equal(result.ok, false); assert.match(result.error, /executable mode differs: cli\/a2a[.]mjs/)
})
test('POSIX legacy 0600 export reproduces the exact reviewed producer-consumer refusal', posix, () => {
  const f = fixture(), submission = mkdtempSync(join(f.run, 'dsh-a2a-submission-'))
  for (const entry of f.entries) { const dest = join(submission, entry.path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, readFileSync(join(f.source, entry.path)), { flag: 'wx', mode: 0o600 }) }
  const result = bind(f, submission)
  assert.equal(result.ok, false); assert.match(result.error, /executable mode differs: cli\/a2a[.]mjs/)
})
test('POSIX permission errors and ineffective chmod fail closed and close the owned fd', posix, () => {
  for (const behavior of ['throw', 'ignore']) {
    const f = fixture()
    const before = f.entries.map(entry => ({ bytes: readFileSync(join(f.source, entry.path)), mode: lstatSync(join(f.source, entry.path)).mode }))
    const child = [
      "import assert from 'node:assert/strict'",
      "import fs from 'node:fs'",
      "import { syncBuiltinESMExports } from 'node:module'",
      "const [moduleUrl, source, run, entryJson, behavior] = process.argv.slice(1)",
      "let ownedFd; let closed = false; const originalClose = fs.closeSync",
      "fs.fchmodSync = fd => { ownedFd = fd; if (behavior === 'throw') throw Object.assign(new Error('synthetic chmod denial'), { code: 'EACCES' }) }",
      "fs.closeSync = fd => { if (fd === ownedFd) closed = true; return originalClose(fd) }",
      "syncBuiltinESMExports()",
      "const { exportCandidateSubmission } = await import(moduleUrl)",
      "assert.throws(() => exportCandidateSubmission(source, JSON.parse(entryJson), run), behavior === 'throw' ? /synthetic chmod denial/ : /mode verification failed/)",
      "assert.equal(closed, true)",
      "console.log('MODE_FAILURE_CLOSED')",
    ].join(';')
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', child, new URL('../../scripts/verify-submission.mjs', import.meta.url).href, f.source, f.run, JSON.stringify(f.entries), behavior], { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'MODE_FAILURE_CLOSED')
    f.entries.forEach((entry, i) => { assert.deepEqual(readFileSync(join(f.source, entry.path)), before[i].bytes); assert.equal(lstatSync(join(f.source, entry.path)).mode, before[i].mode) })
  }
})
test('export rejects invalid modes, duplicate paths and traversal before allocating any submission', () => {
  const f = fixture()
  const before = readdirSync(f.run).sort()
  for (const entries of [[{ ...f.entries[0], mode: '100777' }], [f.entries[0], f.entries[0]], [{ ...f.entries[0], path: '../escape' }]]) {
    assert.throws(() => exportCandidateSubmission(f.source, entries, f.run), /invalid source export manifest/)
    assert.deepEqual(readdirSync(f.run).sort(), before)
  }
})
test('source-byte drift refuses export without chmod or changing the source', () => {
  const f = fixture(), cli = join(f.source, 'cli', 'a2a.mjs')
  writeFileSync(cli, 'changed')
  const before = readFileSync(cli), mode = lstatSync(cli).mode
  assert.throws(() => exportCandidateSubmission(f.source, f.entries, f.run), /source changed during submission export/)
  assert.deepEqual(readFileSync(cli), before); assert.equal(lstatSync(cli).mode, mode)
})
