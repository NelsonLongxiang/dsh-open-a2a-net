/** Read-only tar content inventory. Never extract archive paths onto the filesystem. */
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
export function packagePath(raw) {
  if (typeof raw !== 'string' || raw === '' || raw.includes('\\') || /[\x00-\x1f\x7f]/.test(raw) || /^[a-z]:/i.test(raw)) throw Error('invalid file path')
  const path = raw.startsWith('package/') ? raw.slice(8) : raw
  if (path.split('/').some(p => p === '' || p === '.' || p === '..')) throw Error('invalid file path: ' + raw)
  return path
}
export function reviewerFiles(document, candidate) {
  if (document?.sha !== candidate || !/^[0-9a-f]{40}$/.test(document.sha ?? '') || typeof document.platform !== 'string' || document.platform.trim() === '' || !Array.isArray(document.files) || document.files.length === 0) throw Error('missing reviewer manifest envelope, candidate mismatch or empty files')
  const files = new Map()
  for (const row of document.files) {
    if (row === null || typeof row !== 'object') throw Error('invalid reviewer file')
    const path = packagePath(row.path)
    if (files.has(path) || !Number.isSafeInteger(row.size) || row.size < 0 || !/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) throw Error('duplicate or invalid reviewer file: ' + path)
    files.set(path, { size: row.size, sha256: row.sha256 })
  }
  return files
}
const hash = b => createHash('sha256').update(b).digest('hex')
export function tarFiles(bytes) {
  // Release packages are small; bound decompression rather than trusting a compressed bomb.
  const tar = gunzipSync(bytes, { maxOutputLength: 256 << 20 }), files = new Map()
  const text = b => b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString('utf8')
  const octal = b => { const s = text(b).trim(); if (!/^[0-7]+$/.test(s)) throw Error('invalid tar octal field'); const n = parseInt(s, 8); if (!Number.isSafeInteger(n)) throw Error('invalid tar number'); return n }
  let offset = 0, pax = Object.create(null), ended = false
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(b => b === 0)) { ended = true; if (!tar.subarray(offset).every(b => b === 0)) throw Error('trailing nonzero tar data'); break }
    const checksum = octal(header.subarray(148, 156))
    let actual = 0; for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : header[i]
    if (actual !== checksum) throw Error('tar header checksum mismatch')
    const size = octal(header.subarray(124, 136)), type = String.fromCharCode(header[156] || 48)
    const prefix = text(header.subarray(345, 500)), name = text(header.subarray(0, 100))
    const data = tar.subarray(offset + 512, offset + 512 + size)
    if (data.length !== size) throw Error('truncated tar entry')
    offset += 512 + Math.ceil(size / 512) * 512
    if (offset > tar.length) throw Error('truncated tar padding')
    if (type === 'x') {
      if (Object.keys(pax).length) throw Error('consecutive PAX headers unsupported')
      let i = 0
      while (i < data.length) {
        const space = data.indexOf(32, i), lengthText = data.subarray(i, space).toString()
        if (space < i || !/^[0-9]+$/.test(lengthText)) throw Error('invalid PAX length')
        const length = Number(lengthText), end = i + length
        if (!Number.isSafeInteger(length) || end > data.length || end <= space || data[end - 1] !== 10) throw Error('invalid PAX record')
        const record = data.subarray(space + 1, end - 1).toString(), equal = record.indexOf('=')
        if (equal < 1) throw Error('invalid PAX key')
        const key = record.slice(0, equal); if (Object.hasOwn(pax, key)) throw Error('duplicate PAX key')
        pax[key] = record.slice(equal + 1); i = end
      }
      continue
    }
    const raw = pax.path ?? (prefix ? prefix + '/' + name : name)
    if (pax.size !== undefined && pax.size !== String(size)) throw Error('PAX size mismatch')
    pax = Object.create(null)
    if (!raw.startsWith('package/')) throw Error('tar entry outside package/')
    if (type === '5') { if (size !== 0) throw Error('nonempty directory'); if (raw !== 'package/') packagePath(raw.replace(/\/$/, '')); continue }
    if (type !== '0') throw Error('non-regular tar entry: ' + type)
    const path = packagePath(raw)
    if (files.has(path)) throw Error('duplicate tar file: ' + path)
    files.set(path, { size, sha256: hash(data) })
  }
  if (!ended || Object.keys(pax).length || files.size === 0) throw Error('incomplete or empty tar archive')
  return files
}
export function compareReviewerManifest(bytes, document, candidate) {
  const reviewed = reviewerFiles(document, candidate), packed = tarFiles(bytes)
  const missing = [...reviewed.keys()].filter(p => !packed.has(p)), extra = [...packed.keys()].filter(p => !reviewed.has(p))
  const changed = [...packed].filter(([p, row]) => reviewed.has(p) && (row.size !== reviewed.get(p).size || row.sha256 !== reviewed.get(p).sha256)).map(([path, actual]) => ({ path, actual, reviewed: reviewed.get(path) }))
  return { ok: !missing.length && !extra.length && !changed.length, candidate, platform: document.platform, reviewedFiles: reviewed.size, packedFiles: packed.size, missing, extra, changed }
}
