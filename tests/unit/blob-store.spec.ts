/**
 * #91 file channel F1 (docs/design/file-channel.md): the sender host's blob store — staging and
 * dedup, grants (who, until when), capacity that never pushes out a live grant, fail-closed
 * restore, tamper check on read, name sanitizing and the reference line.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { BLOB_COUNT_MAX, BLOB_FILE_MAX, BLOB_GRANT_TTL_MS, BLOB_NAME_MAX, BlobStore, formatFileRef, parseFileRef, sanitizeBlobName } from '../../src/blob-store.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const clock = (start = 1_000_000) => { let t = start; return { now: () => t, tick: (ms: number) => { t += ms } } }
const home = (): string => mkdtempSync(join(tmpdir(), 'blob-'))

describe('BlobStore staging and grants', () => {
  it('stores bytes once by sha256; a grant lets exactly its target pull, until it expires', () => {
    const root = home()
    const c = clock()
    const s = new BlobStore(root, c.now)
    const out = s.stage(bytes('月报'), { name: '月报.xlsx', to: 'finance/canvas/delivery', by: 'session-a' })
    expect(out).toEqual({ ok: true, sha256: sha('月报'), size: bytes('月报').byteLength, name: '月报.xlsx', expiresAt: 1_000_000 + BLOB_GRANT_TTL_MS })
    expect(readdirSync(join(root, 'blobs'))).toEqual([sha('月报')])
    const grant = s.grantFor(sha('月报'), ['finance/canvas/delivery'])
    expect(grant?.to).toBe('finance/canvas/delivery')
    expect(new TextDecoder().decode(s.read(grant!))).toBe('月报')
    // Not the target, or a bad id: nothing.
    expect(s.grantFor(sha('月报'), ['market/aaaa1111'])).toBeUndefined()
    expect(s.grantFor('../../etc/passwd', ['finance/canvas/delivery'])).toBeUndefined()
    c.tick(BLOB_GRANT_TTL_MS)
    expect(s.grantFor(sha('月报'), ['finance/canvas/delivery'])).toBeUndefined()
  })

  it('the same blob to the same target only extends the grant; to another target it adds one; the file stays single', () => {
    const root = home()
    const c = clock()
    const s = new BlobStore(root, c.now)
    s.stage(bytes('x'), { name: 'a', to: 't1', by: 's' })
    c.tick(1000)
    expect(s.stage(bytes('x'), { name: 'a', to: 't1', by: 's' })).toEqual(expect.objectContaining({ ok: true, expiresAt: 1_001_000 + BLOB_GRANT_TTL_MS }))
    s.stage(bytes('x'), { name: 'a', to: 't2', by: 's' })
    expect(s.list().map(g => g.to).sort()).toEqual(['t1', 't2'])
    expect(readdirSync(join(root, 'blobs'))).toHaveLength(1)

  })

  it('grants for different targets coexist and expire on their own; the blob stays while any one is live (design §3.1, review note b)', () => {
    const root = home()
    const c = clock()
    const s = new BlobStore(root, c.now)
    s.stage(bytes('同一份'), { name: 'a', to: 't1', by: 's' })
    c.tick(60 * 60 * 1000)
    s.stage(bytes('同一份'), { name: 'a', to: 't2', by: 's' })
    c.tick(BLOB_GRANT_TTL_MS - 60 * 60 * 1000) // t1 just expired, t2 has an hour left
    expect(s.grantFor(sha('同一份'), ['t1'])).toBeUndefined()
    const live = s.grantFor(sha('同一份'), ['t2'])
    expect(live).toBeDefined()
    // A sweep (any new stage) must keep the blob t2 still names.
    expect(s.stage(bytes('别的'), { name: 'b', to: 't3', by: 's' }).ok).toBe(true)
    expect(new TextDecoder().decode(s.read(live!))).toBe('同一份')
    expect(s.list().map(g => g.to).sort()).toEqual(['t2', 't3'])
  })

  it('refuses a file over the cap, and a stage without a target or sender', () => {
    const s = new BlobStore(home())
    expect(s.stage(new Uint8Array(BLOB_FILE_MAX + 1), { name: 'big', to: 't', by: 's' })).toEqual(expect.objectContaining({ ok: false, code: 'too-large' }))
    expect(s.stage(bytes('x'), { name: 'a', to: '', by: 's' })).toEqual(expect.objectContaining({ ok: false, code: 'bad-request' }))
    expect(s.stage(bytes('x'), { name: 'a', to: 't', by: '' })).toEqual(expect.objectContaining({ ok: false, code: 'bad-request' }))
  })

  it('a full store drops only expired grants and their blobs, then refuses — a live grant is never pushed out', () => {
    const root = home()
    const c = clock()
    const s = new BlobStore(root, c.now)
    for (let i = 0; i < BLOB_COUNT_MAX; i++) expect(s.stage(bytes(`f${String(i)}`), { name: 'n', to: 't', by: 's' }).ok).toBe(true)
    expect(s.stage(bytes('one more'), { name: 'n', to: 't', by: 's' })).toEqual(expect.objectContaining({ ok: false, code: 'full' }))
    expect(s.grantFor(sha('f0'), ['t'])).toBeDefined() // still served
    // A re-send of a stored blob needs no room.
    expect(s.stage(bytes('f0'), { name: 'n', to: 't', by: 's' }).ok).toBe(true)
    c.tick(BLOB_GRANT_TTL_MS + 1) // everything expires
    expect(s.stage(bytes('one more'), { name: 'n', to: 't', by: 's' }).ok).toBe(true)
    expect(readdirSync(join(root, 'blobs'))).toEqual([sha('one more')])
  })

  it('a blob whose bytes changed on disk is not served', () => {
    const root = home()
    const s = new BlobStore(root)
    s.stage(bytes('原件'), { name: 'a', to: 't', by: 's' })
    writeFileSync(join(root, 'blobs', sha('原件')), '篡改')
    expect(s.read(s.grantFor(sha('原件'), ['t'])!)).toBeUndefined()
  })
})

describe('BlobStore persistence', () => {
  it('grants survive a restart', () => {
    const root = home()
    new BlobStore(root).stage(bytes('x'), { name: 'a', to: 't', by: 's' })
    const again = new BlobStore(root)
    expect(again.grantFor(sha('x'), ['t'])?.name).toBe('a')
  })

  it('a grants file that does not parse, or holds one bad row, is set aside and serves nothing (fail-closed)', () => {
    for (const body of ['{not json', JSON.stringify({ grants: [{ sha256: sha('x'), size: 1, name: 'a', to: 't', by: 's', grantedAt: 1, expiresAt: Date.now() + 1e9 }, { sha256: 'nope' }] })]) {
      const root = home()
      new BlobStore(root).stage(bytes('x'), { name: 'a', to: 't', by: 's' })
      writeFileSync(join(root, 'blob-grants.json'), body)
      const again = new BlobStore(root)
      expect(again.grantFor(sha('x'), ['t'])).toBeUndefined()
      expect(readdirSync(root).some(f => f.startsWith('blob-grants.json.corrupt-'))).toBe(true)
      expect(readFileSync(join(root, 'blob-grants.json'), 'utf8')).toBe(body) // the original is left in place until the next write
    }
  })
})

describe('names and reference lines', () => {
  it('a name keeps only its last path segment, no .., no control characters, bounded, never empty', () => {
    expect(sanitizeBlobName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeBlobName('C:\\Users\\x\\报表.xlsx')).toBe('报表.xlsx')
    expect(sanitizeBlobName('..')).toBe('file')
    expect(sanitizeBlobName('a..b')).toBe('a.b')
    expect(sanitizeBlobName('.hidden')).toBe('hidden')
    expect(sanitizeBlobName('a\u0000b\nc')).toBe('abc')
    expect(sanitizeBlobName('x'.repeat(500))).toHaveLength(BLOB_NAME_MAX)
    expect(sanitizeBlobName('')).toBe('file')
  })

  it('a reference round-trips, from anywhere in a message; malformed, oversized or non-origin sources are refused', () => {
    const ref = { sha256: sha('x'), size: 12, name: '月报 v2.xlsx', from: 'http://100.64.0.10:13080' }
    const line = formatFileRef(ref)
    expect(parseFileRef(`请查收：\n${line}\n谢谢`)).toEqual(ref)
    expect(parseFileRef(line.replace(sha('x'), 'z'.repeat(64)))).toBeUndefined()
    expect(parseFileRef(line.replace('size=12', `size=${String(BLOB_FILE_MAX + 1)}`))).toBeUndefined()
    expect(parseFileRef(line.replace('from=http://100.64.0.10:13080', 'from=http://h:1/a2a/cli/x'))).toBeUndefined()
    expect(parseFileRef(line.replace('from=http://100.64.0.10:13080', 'from=http://u:p@h:1'))).toBeUndefined()
    expect(parseFileRef(line.replace('from=http://100.64.0.10:13080', 'from=http://h:1/?q=1'))).toBeUndefined()
    expect(parseFileRef(line.replace(' v1 ', ' v2 '))).toBeUndefined()
    // A name that tries to climb out is sanitized on parse.
    expect(parseFileRef(formatFileRef({ ...ref, name: 'x' }).replace('name=x', `name=${encodeURIComponent('../../a')}`))?.name).toBe('a')
  })
})
