#!/usr/bin/env node
/** Phase-one raw observations only. No verdicts; existing v2 release gate is untouched. */
import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const jsonType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex')
export function collectReleaseMeasurements(directory, artifact, repo = ROOT) {
  const inputs = [], fields = [], blobs = [], commands = [], inventory = []
  function blob(slot, path) {
    try {
      const bytes = readFileSync(path)
      inputs.push({ slot, path, read_errno: null, error: null })
      blobs.push({ slot, bytes: bytes.length, sha1: digest(bytes, 'sha1'), sha256: digest(bytes, 'sha256') })
      return bytes
    } catch (error) {
      inputs.push({ slot, path, read_errno: String(error.code ?? error.name), error: error.message })
      blobs.push({ slot, bytes: null, sha1: null, sha256: null })
      return undefined
    }
  }
  function flatten(slot, value, pointer = '') {
    // JSON pointers preserve array order and duplicates; no path Map or semantic normalization.
    fields.push({ slot, pointer, json_type: jsonType(value), text_value: typeof value === 'string' ? value : null,
      number_value: typeof value === 'number' && Number.isFinite(value) ? value : null, number_text: typeof value === 'number' ? String(value) : null, boolean_value: typeof value === 'boolean' ? Number(value) : null,
      child_count: value !== null && typeof value === 'object' ? Object.keys(value).length : null })
    if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) flatten(slot, child, pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'))
  }
  function parse(slot, bytes) {
    if (bytes === undefined) return undefined
    try { const value = JSON.parse(bytes.toString('utf8')); flatten(slot, value); return value }
    catch (error) { fields.push({ slot, pointer: '', json_type: 'parse-error', text_value: error.message, number_value: null, number_text: null, boolean_value: null, child_count: null }); return undefined }
  }
  const provenance = parse('provenance', blob('provenance', resolve(directory, 'provenance.json')))
  for (const [slot, name] of [['acceptance', 'acceptance.json'], ['npmjs_metadata', 'npmjs-readback.json'], ['reviewer', 'reviewer-manifest.json']]) parse(slot, blob(slot, resolve(directory, name)))
  blob('artifact', artifact)
  blob('npmjs', resolve(directory, 'npmjs-readback.tgz'))
  // The artifact is an explicit CLI selection, never a path obtained from untrusted JSON.
  // Mirror layout uses the selected filename, not provenance.filename (which remains a measured field).
  const selectedName = artifact.replaceAll('\\', '/').split('/').pop()
  blob('gitea', resolve(directory, 'mirror-readback', selectedName))
  function command(slot, executable, args, cwd = repo) {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 16 << 20, timeout: 30_000, windowsHide: true })
    commands.push({ slot, executable, argv: JSON.stringify(args), exit_code: result.status, signal: result.signal, stdout: result.stdout ?? null, stderr: result.stderr ?? null, error: result.error?.message ?? null })
    return result
  }
  // Reject option interpretation at the producer boundary without asserting SHA validity.
  const revision = typeof provenance?.candidate === 'string' ? provenance.candidate : ''
  if (revision && !revision.startsWith('-') && !revision.includes(String.fromCharCode(0))) {
    const result = command('candidate_package', 'git', ['show', '--no-ext-diff', revision + ':package.json'])
    if (result.status === 0) parse('candidate_package', Buffer.from(result.stdout))
  } else commands.push({ slot: 'candidate_package', executable: 'git', argv: null, exit_code: null, signal: null, stdout: null, stderr: null, error: 'no non-option candidate token available' })
  const list = command('archive_list', 'tar', ['-tzf', basename(artifact)], dirname(artifact))
  if (list.status === 0) list.stdout.split(/\r?\n/).forEach((raw_path, ordinal, all) => { if (ordinal !== all.length - 1 || raw_path !== '') inventory.push({ ordinal, raw_path }) })
  const pkg = command('archive_package', 'tar', ['-xOzf', basename(artifact), 'package/package.json'], dirname(artifact))
  if (pkg.status === 0) parse('archive_package', Buffer.from(pkg.stdout))
  // Raw header/type/PAX grammar and per-file payload collection await engine #232.
  // No synthetic rows here claim that capability or encode its outcome.
  return { inputs, fields, blobs, commands, inventory }
}
export async function writeReleaseMeasurementSnapshot(directory, artifact, output, repo = ROOT) {
  const observations = collectReleaseMeasurements(directory, artifact, repo)
  const { DatabaseSync } = await import('node:sqlite')
  mkdirSync(dirname(output), { recursive: true })
  // Reserve the exact output exclusively; a check-then-open race must not replace evidence.
  try { const fd = openSync(output, 'wx', 0o600); closeSync(fd) }
  catch (error) { if (error.code === 'EEXIST') throw Error('raw measurement snapshot already exists; choose a new output'); throw error }
  const db = new DatabaseSync(output)
  try {
    db.exec('BEGIN; CREATE TABLE audit_inputs (slot TEXT PRIMARY KEY,path TEXT,read_errno TEXT,error TEXT); CREATE TABLE json_fields(slot TEXT,pointer TEXT,json_type TEXT,text_value TEXT,number_value REAL,number_text TEXT,boolean_value INTEGER,child_count INTEGER); CREATE TABLE blob_measurements(slot TEXT PRIMARY KEY,bytes INTEGER,sha1 TEXT,sha256 TEXT); CREATE TABLE command_observations(slot TEXT PRIMARY KEY,executable TEXT,argv TEXT,exit_code INTEGER,signal TEXT,stdout TEXT,stderr TEXT,error TEXT); CREATE TABLE archive_list(ordinal INTEGER,raw_path TEXT);')
    for (const [table, rows] of Object.entries({ audit_inputs: observations.inputs, json_fields: observations.fields, blob_measurements: observations.blobs, command_observations: observations.commands, archive_list: observations.inventory })) {
      if (!rows.length) continue
      const keys = Object.keys(rows[0]), insert = db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')')
      for (const row of rows) insert.run(...keys.map(key => row[key] ?? null))
    }
    db.exec('COMMIT')
  } finally { db.close() }
  return { snapshot: output, rows: Object.fromEntries(Object.entries(observations).map(([name, rows]) => [name, rows.length])) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
  const directory = value('--release-audit'), artifact = value('--artifact'), output = value('--out')
  if (!directory || !artifact || !output) throw Error('require --release-audit DIR --artifact TGZ --out NEW.sqlite; collection is not a verdict')
  console.log(JSON.stringify(await writeReleaseMeasurementSnapshot(resolve(directory), resolve(artifact), resolve(output))))
}
