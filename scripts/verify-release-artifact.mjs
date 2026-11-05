/** Collect immutable release-artifact facts; node scripts/verify-probe.mjs --release-audit DIR --out SNAPSHOT. Verdicts belong to verify run. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex')
const isoTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))

/** Read-only audit of retained release evidence; absent, corrupt or contradictory inputs emit explicit failed facts. */
export function collectReleaseArtifactFacts(directory, repo) {
  const facts = []
  const add = (name, fn) => {
    try { const { ok, detail } = fn(); facts.push({ name, ok: ok ? 1 : 0, detail: JSON.stringify(detail) }) }
    catch (error) { facts.push({ name, ok: 0, detail: String(error.message ?? error) }) }
  }
  const json = file => JSON.parse(readFileSync(resolve(directory, file), 'utf8'))
  let provenance, bytes, manifest, sha1, sha256
  add('candidate_identity', () => {
    provenance = json('provenance.json')
    if (!/^[0-9a-f]{40}$/.test(provenance.candidate ?? '') || !isoTime(provenance.at)) throw Error('missing full candidate SHA or packing timestamp')
    const source = spawnSync('git', ['show', provenance.candidate + ':package.json'], { cwd: repo, encoding: 'utf8' })
    if (source.status !== 0) throw Error('candidate commit/package.json unavailable')
    manifest = JSON.parse(source.stdout)
    if (typeof provenance.filename !== 'string' || basename(provenance.filename) !== provenance.filename || !provenance.filename.endsWith('.tgz')) throw Error('artifact filename must be a local tgz basename')
    bytes = readFileSync(resolve(directory, provenance.filename))
    sha1 = digest(bytes, 'sha1'); sha256 = digest(bytes, 'sha256')
    return { ok: typeof manifest.version === 'string' && typeof manifest.name === 'string', detail: { candidate: provenance.candidate, version: manifest.version, packRecordedAt: provenance.at, scope: 'recorded identity plus real git object; not proof of historical clean build' } }
  })
  add('artifact_digest', () => ({ ok: bytes !== undefined && provenance.size === bytes.length && provenance.shasum === sha1 && provenance.sha256 === sha256, detail: { actualSha1: sha1, actualSha256: sha256, actualBytes: bytes?.length } }))
  add('archive_inventory', () => {
    if (bytes === undefined) throw Error('artifact unavailable')
    const file = resolve(directory, provenance.filename)
    const list = spawnSync('tar', ['-tzf', basename(file)], { cwd: directory, encoding: 'utf8', maxBuffer: 16 << 20 })
    if (list.status !== 0) throw Error('cannot enumerate tarball')
    const paths = list.stdout.trim().split(/\r?\n/).filter(Boolean)
    const bad = paths.filter(path => /(?:^|\/)__pycache__(?:\/|$)|\.pyc$|(?:^|\/)tmp(?:\/|-)/i.test(path) || !path.startsWith('package/') || path.split('/').includes('..'))
    const pkg = spawnSync('tar', ['-xOzf', basename(file), 'package/package.json'], { cwd: directory, encoding: 'utf8', maxBuffer: 1 << 20 })
    if (pkg.status !== 0) throw Error('package manifest unavailable inside tgz')
    const packed = JSON.parse(pkg.stdout)
    return { ok: paths.length > 0 && paths.length === provenance.files && bad.length === 0 && packed.name === manifest.name && packed.version === manifest.version, detail: { files: paths.length, bad, packedVersion: packed.version, candidateVersion: manifest.version } }
  })
  for (const kind of ['dsh3081', 'cleanServe']) add('acceptance_' + kind, () => {
    const a = json('acceptance.json')
    const rows = Array.isArray(a.results) ? a.results.filter(row => row.kind === kind) : []
    const ordinary = path => rows.filter(row => row.path === path && row.forwarded !== true)
    const card = ordinary('/.well-known/agent-card.json'), state = ordinary('/__dsh_a2a/state'), page = ordinary('/__dsh_a2a_nexus/')
    const endpoint = row => { try { const url = new URL(row.base); return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && (kind !== 'dsh3081' || url.port === '3081') } catch { return false } }
    const all = [...card, ...state, ...page]
    const ok = provenance !== undefined && a.candidate === provenance.candidate && a.shasum === sha1 && isoTime(a.at) && Date.parse(a.at) >= Date.parse(provenance.at) && card.length === 1 && state.length === 1 && page.length === 1 && all.every(row => row.status === 200 && endpoint(row)) && new Set(all.map(row => new URL(row.base).origin)).size === 1 && card[0].version === manifest.version && state[0].version === manifest.version && state[0].isolated === true && page[0].html === true && Number.isInteger(page[0].bytes) && page[0].bytes > 0
    return { ok, detail: { kind, at: a.at, candidate: a.candidate, shasum: a.shasum, rows: all } }
  })
  for (const [name, file] of [['npmjs', 'npmjs-readback.tgz'], ['gitea', 'mirror-readback/' + (provenance?.filename ?? 'missing.tgz')]]) add('readback_' + name, () => {
    const downloaded = readFileSync(resolve(directory, file))
    const actualSha1 = digest(downloaded, 'sha1'), actualSha256 = digest(downloaded, 'sha256')
    let metaOk = true
    if (name === 'npmjs') {
      const m = json('npmjs-readback.json')
      metaOk = m.version === manifest?.version && m.shasum === actualSha1 && m.sha256 === actualSha256 && m.bytes === downloaded.length && isoTime(m.at)
    }
    return { ok: bytes !== undefined && actualSha1 === sha1 && actualSha256 === sha256 && metaOk, detail: { registry: name, actualSha1, actualSha256, bytes: downloaded.length, metadataMatches: metaOk } }
  })
  return facts
}
