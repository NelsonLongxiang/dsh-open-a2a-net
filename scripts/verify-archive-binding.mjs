/** Identity binding only. The official verifier CLI remains the archive-integrity judge. */
import { lstatSync, readFileSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const tagged = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
function bytesAt(path, limit = 256 * 1024 * 1024) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw Error('current run requires an absolute artifact path')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Error('current run artifact is linked, non-regular or oversized')
  return readFileSync(path)
}
/** Read just the two identity envelopes of the official store-only ZIP format.
 * No extraction, hash-chain judgement or business verdict is implemented here. */
function archiveEnvelopes(bytes) {
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw Error('current archive is not a single-disk ZIP')
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12)
  if (count !== bytes.readUInt16LE(end + 8) || count === 65535 || start + size !== end) throw Error('current archive central directory is invalid')
  let offset = start
  const found = new Map(), names = new Set()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('current archive directory entry is invalid')
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32)
    const next = offset + 46 + length + extra + comment
    if (next > end) throw Error('current archive directory entry is truncated')
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8')
    if (names.has(name)) throw Error('current archive has duplicate entries')
    names.add(name)
    if (name === 'manifest.json' || name === 'report.json') {
      const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10)
      const packed = bytes.readUInt32LE(offset + 20), unpacked = bytes.readUInt32LE(offset + 24), local = bytes.readUInt32LE(offset + 42)
      if ((flags & 9) || method !== 0 || packed !== unpacked || unpacked > 16 * 1024 * 1024 || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('current archive identity entry is not bounded store-only data')
      const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), data = local + 30 + localName + localExtra
      if (data + packed > start || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt32LE(local + 18) !== packed || bytes.readUInt32LE(local + 22) !== unpacked || bytes.subarray(local + 30, local + 30 + localName).toString('utf8') !== name) throw Error('current archive identity header differs')
      const raw = bytes.subarray(data, data + packed)
      found.set(name, { raw, value: JSON.parse(raw.toString('utf8')) })
    }
    offset = next
  }
  if (offset !== end || !found.has('manifest.json') || !found.has('report.json')) throw Error('current archive lacks exact identity envelopes')
  return found
}
function processSucceeded(result) {
  return result && result.status === 0 && !result.error && !result.signal && result.json && typeof result.json === 'object'
}
export function bindCurrentRunArchive(result, specId, snapshotFile, expectedSnapshotSha256) {
  if (!processSucceeded(result)) throw Error('current spec command did not exit successfully')
  const run = result.json, archive = run.archive
  if (Object.hasOwn(run, 'archive_error')) throw Error('current run reported archive_error; no archive may be accepted')
  if (!/^run_[a-z0-9_-]+$/i.test(run.run_id ?? '') || run.spec_id !== specId || !Number.isSafeInteger(run.spec_version) || run.spec_version < 1 || !['PASS', 'FAIL'].includes(run.overall)) throw Error('current CLI run identity is invalid')
  if (!archive || !/^arc_[a-z0-9_-]+$/i.test(archive.archive_id ?? '') || !tagged(archive.archive_sha256) || !hash(archive.zip_sha256)) throw Error('current run has no bound archive; no fallback archive is allowed')
  const snapshotSha256 = sha(bytesAt(snapshotFile)), reportBytes = bytesAt(run.report_path, 16 * 1024 * 1024), report = JSON.parse(reportBytes.toString('utf8'))
  if (!hash(expectedSnapshotSha256) || snapshotSha256 !== expectedSnapshotSha256) throw Error('snapshot changed during current run')
  if (report.run_id !== run.run_id || report.spec_id !== specId || report.verifier?.spec_version !== run.spec_version || report.overall !== run.overall || JSON.stringify(report.summary) !== JSON.stringify(run.summary)) throw Error('current report differs from CLI run identity')
  if (!tagged(report.payload_sha256) || report.data_source?.kind !== 'sqlite-snapshot' || report.data_source.sha256 !== 'sha256:' + snapshotSha256) throw Error('current report payload or snapshot binding differs')
  const zip = bytesAt(archive.path)
  if (sha(zip) !== archive.zip_sha256 || basename(archive.path) !== archive.filename) throw Error('current archive path or bytes differ from CLI run')
  const envelopes = archiveEnvelopes(zip), manifest = envelopes.get('manifest.json').value, archivedReport = envelopes.get('report.json')
  if (!archivedReport.raw.equals(reportBytes) || archivedReport.value.run_id !== run.run_id) throw Error('archive contains another run report')
  if (manifest.run_id !== run.run_id || manifest.spec?.id !== specId || manifest.spec.version !== run.spec_version || manifest.payload_sha256 !== report.payload_sha256 || manifest.data_source?.kind !== 'sqlite-snapshot' || manifest.data_source.sha256 !== report.data_source.sha256 || manifest.archive_id !== archive.archive_id || manifest.archive_sha256 !== archive.archive_sha256 || manifest.filename !== archive.filename) throw Error('archive manifest is not bound to this run/spec/payload/snapshot')
  return { path: archive.path, run_id: run.run_id, spec_id: specId, spec_version: run.spec_version, archive_id: archive.archive_id, archive_sha256: archive.archive_sha256, zip_sha256: archive.zip_sha256, payload_sha256: report.payload_sha256, snapshot: snapshotFile, snapshot_sha256: snapshotSha256, report: run.report_path, report_sha256: sha(reportBytes) }
}
export function acceptCurrentArchiveVerification(result, binding) {
  if (!processSucceeded(result) || result.json.ok !== true || result.json.archive_id !== binding.archive_id || result.json.archive_sha256 !== binding.archive_sha256 || !Number.isSafeInteger(result.json.items) || result.json.items < 1 || !Array.isArray(result.json.problems) || result.json.problems.length) throw Error('current archive verifier failed or returned a different archive identity')
  if (sha(bytesAt(binding.path)) !== binding.zip_sha256 || sha(bytesAt(binding.snapshot)) !== binding.snapshot_sha256 || sha(bytesAt(binding.report, 16 * 1024 * 1024)) !== binding.report_sha256) throw Error('current run evidence changed during archive verification')
  return { ...binding, items: result.json.items }
}
