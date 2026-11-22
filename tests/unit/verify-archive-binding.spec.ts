/** Synthetic CLI flow regression only; not a replacement integrity verifier or release PASS. */
import { describe, expect, it, vi } from 'vitest'
// #782-era ledger (2026-11-22, contended Windows host): full-suite load exceeded the 5s default in these specs; raised ceiling only, assertions unchanged.
vi.setConfig({ testTimeout: 25_000 })
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'

const recursive = join(process.cwd(), 'scripts', 'verify-recursive.mjs')
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
function crc(bytes: Buffer) {
  let c = 0xffffffff
  for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0) }
  return (c ^ 0xffffffff) >>> 0
}
// Two bounded known fixture entries, no archive-reader implementation in the tests.
function zip(entries: Array<{ name: string; data: Buffer }>) {
  const chunks: Buffer[] = [], directory: Buffer[] = []; let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name), local = Buffer.alloc(30), central = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc(entry.data), 14)
    local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc(entry.data), 16)
    central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    chunks.push(local, name, entry.data); directory.push(central, name); offset += local.length + name.length + entry.data.length
  }
  const centralBytes = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBytes, end])
}
function fixture(scenario = 'correct') {
  const run = mkdtempSync(join(tmpdir(), 'recursive-run-bind-')), home = join(run, 'ygl-home')
  const submission = join(run, 'dsh-a2a-submission-synthetic'), archives = join(home, 'verify', 'archives')
  mkdirSync(submission); mkdirSync(archives, { recursive: true })
  const head = 'a'.repeat(40), tree = 'b'.repeat(40), source = Buffer.from('synthetic source\n')
  const entries = [{ path: 'source.txt', mode: '100644', size: source.length, sha256: digest(source) }]
  writeFileSync(join(submission, 'source.txt'), source)
  writeFileSync(join(run, 'source-manifest.json'), JSON.stringify({ sha: head, tree, files: entries }))
  const snapshot = join(run, 'snapshot.sqlite'), db = new DatabaseSync(snapshot)
  try {
    db.exec('CREATE TABLE repo_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const stmt = db.prepare('INSERT INTO repo_facts VALUES (?,?)')
    for (const [k, v] of Object.entries({ git_head: head, candidate_tree: tree, source_manifest_sha256: digest(JSON.stringify(entries)) })) stmt.run(k, v)
  } finally { db.close() }
  const snapshotHash = digest(readFileSync(snapshot)), summary = join(run, 'probe-summary.json')
  writeFileSync(summary, JSON.stringify({ candidate_sha: head, git_head: head, candidate_tree: tree, snapshot, submission_root: run, submission }))
  const spec = 'spec_current', overall = scenario === 'business-fail' ? 'FAIL' : 'PASS', totals = { pass: overall === 'PASS' ? 1 : 0, fail: overall === 'FAIL' ? 1 : 0, needs_material: 0, error: 0 }
  function artifact(id: string, file: string, override: Record<string, unknown> = {}) {
    const report: any = { run_id: id, spec_id: spec, overall, summary: totals, verifier: { spec_version: 1 }, payload_sha256: 'sha256:' + 'c'.repeat(64), data_source: { kind: 'sqlite-snapshot', sha256: 'sha256:' + snapshotHash } }
    const reportPath = join(run, id + '.json'), reportBytes = Buffer.from(JSON.stringify(report))
    writeFileSync(reportPath, reportBytes)
    const manifest: any = { run_id: id, spec: { id: spec, version: 1 }, payload_sha256: report.payload_sha256, data_source: report.data_source, archive_id: 'arc_' + id.slice(4), archive_sha256: 'sha256:' + 'd'.repeat(64), filename: file, ...override }
    const bytes = zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'report.json', data: reportBytes }])
    const path = join(archives, file); writeFileSync(path, bytes)
    return { reportPath, report, path, bytes, manifest, archive: { path, filename: file, archive_id: manifest.archive_id, archive_sha256: manifest.archive_sha256, zip_sha256: digest(bytes) } }
  }
  const overrides: Record<string, unknown> = scenario === 'wrong-manifest-spec' ? { spec: { id: spec, version: 2 } } : scenario === 'wrong-manifest-run' ? { run_id: 'run_bbbb' } : scenario === 'wrong-manifest-payload' ? { payload_sha256: 'sha256:' + 'e'.repeat(64) } : scenario === 'wrong-manifest-snapshot' ? { data_source: { kind: 'sqlite-snapshot', sha256: 'sha256:' + 'f'.repeat(64) } } : {}
  const a = artifact('run_aaaa', 'a-current.yglverify.zip', overrides), b = artifact('run_bbbb', 'z-newer-unrelated.yglverify.zip')
  const result: any = { run_id: a.report.run_id, spec_id: spec, spec_version: 1, overall, summary: totals, report_path: a.reportPath, archive: a.archive }
  if (scenario === 'no-current-archive') result.archive = null
  if (scenario === 'archive-error' || scenario === 'archive-error-with-stale-archive') result.archive_error = 'synthetic current-run archive failure'
  if (scenario === 'archive-error') result.archive = null
  if (scenario === 'current-missing') rmSync(a.path)
  if (scenario === 'current-corrupt') writeFileSync(a.path, 'not a ZIP')
  if (scenario === 'substituted-path') result.archive.path = b.path
  if (scenario === 'wrong-run-archive') result.archive = b.archive
  if (scenario === 'wrong-report') result.report_path = b.reportPath
  const calls = join(run, 'calls.jsonl'), config = join(run, 'case.json'), cli = join(run, 'fixture-cli.mjs')
  writeFileSync(config, JSON.stringify({ scenario, calls, result, currentPath: a.path, snapshot, verify: { ok: true, archive_id: a.archive.archive_id, archive_sha256: a.archive.archive_sha256, items: 2, problems: [], warnings: [] } }))
  writeFileSync(cli, [
    "import {readFileSync,appendFileSync,writeFileSync} from 'node:fs'",
    "const f=JSON.parse(readFileSync(process.env.BINDING_CASE,'utf8')),args=process.argv.slice(2)",
    "appendFileSync(f.calls,JSON.stringify(args)+'\\n')",
    "if(args[1]==='self-check'){console.log(JSON.stringify({ok:true,items:[]}))}",
    "else if(args[1]==='run'){if(f.scenario==='mutated-snapshot')appendFileSync(f.snapshot,'changed');console.log(f.scenario==='malformed-cli'?'not-json':f.scenario==='null-cli'?'null':f.scenario==='array-cli'?'[]':JSON.stringify(f.result));if(f.scenario==='run-nonzero'||f.scenario==='archive-error')process.exitCode=9}",
    "else if(args[1]==='archive'&&args[2]==='verify'){if(f.scenario==='mutated-archive-during-verify')writeFileSync(f.currentPath,'replaced');if(f.scenario==='mutated-snapshot-during-verify')appendFileSync(f.snapshot,'changed');if(f.scenario==='mutated-report-during-verify')appendFileSync(f.result.report_path,' ');const v={...f.verify};if(f.scenario==='verify-false')v.ok=false;if(f.scenario==='verify-wrong-id')v.archive_id='arc_other';console.log(JSON.stringify(v));if(f.scenario==='verify-nonzero')process.exitCode=7}",
    "else{console.error('unexpected synthetic CLI operation');process.exitCode=8}",
  ].join('\n'))
  return { run, home, head, spec, snapshot, summary, a, b, calls, config, cli }
}
function execute(f: ReturnType<typeof fixture>) {
  const controlled = new Set(['ygl_bin', 'ygl_home', 'a2a_spec_id', 'ygl_verify_corpus', 'binding_case'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !controlled.has(k.toLowerCase())))
  const result = spawnSync(process.execPath, [recursive, '--summary', f.summary, '--snapshot', f.snapshot, '--candidate-sha', f.head], { env: { ...env, YGL_BIN: f.cli, YGL_HOME: f.home, A2A_SPEC_ID: f.spec, YGL_VERIFY_CORPUS: join(f.run, 'no-corpus'), BINDING_CASE: f.config }, encoding: 'utf8', timeout: 15000 })
  expect(result.error).toBeUndefined()
  const out = JSON.parse(result.stdout)
  const calls = readFileSync(f.calls, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  return { ...result, out, calls }
}
describe('recursive current-run archive identity (synthetic CLI flow)', () => {
  it('verifies only the current returned ZIP even when another archive sorts later', () => {
    const f = fixture(), result = execute(f)
    expect(result.status, result.stderr).toBe(0)
    expect(result.out.ok).toBe(true)
    const layer = result.out.layers.find((v: any) => v.layer === 'archive-chain')
    expect(layer).toMatchObject({ ok: true, run_id: 'run_aaaa', spec_id: f.spec, spec_version: 1, path: f.a.path, payload_sha256: f.a.report.payload_sha256, snapshot_sha256: digest(readFileSync(f.snapshot)) })
    expect(result.calls.filter((args: string[]) => args[1] === 'archive')).toEqual([['verify', 'archive', 'verify', f.a.path, '--json']])
  })
  it('never promotes a business FAIL into overall PASS when its exact archive verifies', () => {
    const f = fixture('business-fail'), result = execute(f)
    expect(result.status).toBe(1)
    expect(result.out.ok).toBe(false)
    expect(result.out.layers.find((v: any) => v.layer === 'spec-run').ok).toBe(false)
    expect(result.out.layers.find((v: any) => v.layer === 'archive-chain')).toMatchObject({ ok: true, run_id: 'run_aaaa', path: f.a.path })
    expect(result.calls.filter((args: string[]) => args[1] === 'archive')).toEqual([['verify', 'archive', 'verify', f.a.path, '--json']])
  })
  it.each(['no-current-archive', 'archive-error', 'archive-error-with-stale-archive', 'current-missing', 'current-corrupt', 'substituted-path', 'wrong-run-archive', 'wrong-report', 'wrong-manifest-spec', 'wrong-manifest-run', 'wrong-manifest-payload', 'wrong-manifest-snapshot', 'mutated-snapshot', 'malformed-cli', 'null-cli', 'array-cli', 'run-nonzero'])('fails closed for %s rather than falling back to a newer valid ZIP', scenario => {
    const f = fixture(scenario), result = execute(f)
    expect(result.status).toBe(1)
    expect(result.out.ok).toBe(false)
    expect(result.out.layers.find((v: any) => v.layer === 'archive-chain').ok).toBe(false)
    if (scenario.startsWith('archive-error')) expect(result.out.layers.find((v: any) => v.layer === 'spec-run').ok).toBe(false)
    expect(result.calls.filter((args: string[]) => args[1] === 'archive')).toEqual([])
  })
  it.each(['verify-nonzero', 'verify-false', 'verify-wrong-id', 'mutated-archive-during-verify', 'mutated-snapshot-during-verify', 'mutated-report-during-verify'])('refuses %s even when the CLI prints an ok-shaped body', scenario => {
    const f = fixture(scenario), result = execute(f)
    expect(result.status).toBe(1)
    expect(result.out.ok).toBe(false)
    expect(result.out.layers.find((v: any) => v.layer === 'archive-chain').ok).toBe(false)
    expect(result.calls.filter((args: string[]) => args[1] === 'archive')).toEqual([['verify', 'archive', 'verify', f.a.path, '--json']])
  })
})
