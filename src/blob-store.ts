/**
 * #91 file channel, slice F1 (docs/design/file-channel.md §3.1–§3.2, §5): the sender host's
 * content-addressed blob store and its grants. A file never rides a session message: the sender
 * stages it here (by sha256), a grant names who may pull it and until when, and the session
 * message carries only a reference line ({@link formatFileRef}). This module is pure storage —
 * the wire face (admission, OriginClaim) and the tools sit on top of it.
 *
 * - Blobs live at `<root>/blobs/<sha256>`, written tmp + rename; identical bytes are stored once.
 * - Grants live in `<root>/blob-grants.json`, one per (sha256, to, by): each sender's grant is its own (#692
 *   review F1), so another sender staging the same bytes for the same target never takes it over. The same
 *   sender re-sending only extends the expiry and keeps the grant's task and fetch record.
 * - Every change is written before it takes effect here (#692 review F3): a failed write leaves the store
 *   as it was, so a retry finds the same state and a restart never revives a revoked grant. Bytes no grant
 *   names are deleted after the change is written; a delete that did not happen is retried at the next start.
 * - Capacity: one file ≤ {@link BLOB_FILE_MAX}; the store ≤ {@link BLOB_TOTAL_MAX} bytes and
 *   ≤ {@link BLOB_COUNT_MAX} blobs. A full store first drops expired grants and the blobs no
 *   live grant names, then refuses visibly — a live grant is never pushed out.
 * - A grants file that does not parse is set aside and read as EMPTY (fail-closed: references
 *   already sent stop resolving, nothing is served by mistake).
 * - Grant management (market request 2026-11-14): a sender lists its own live grants with the store's
 *   occupancy ({@link BlobStore.grantsBy}, {@link BlobStore.usage}) and revokes one of its own by
 *   (sha256, to) ({@link BlobStore.revoke}); a blob no grant names any more is deleted at once. Another
 *   sender's grant is never touched, and a refusal does not say whether it exists. A grant records
 *   the task its send went out in, and whether (and when first) it was fetched.
 * @module @nelsonlongxiang/dsh-open-a2a-net/blob-store
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One file's ceiling, in bytes (64 MiB; design §8). */
export const BLOB_FILE_MAX = 64 * 1024 * 1024
/** The store's ceiling, in bytes (1 GiB). */
export const BLOB_TOTAL_MAX = 1024 * 1024 * 1024
/** The store's ceiling, in blobs. */
export const BLOB_COUNT_MAX = 256
/** How long a grant lets its target pull (24h). */
export const BLOB_GRANT_TTL_MS = 24 * 60 * 60 * 1000
/** A sanitized file name's length cap. */
export const BLOB_NAME_MAX = 120

const SHA256_RE = /^[0-9a-f]{64}$/
/** A task id a grant may carry. */
export const BLOB_TASK_RE = /^[A-Za-z0-9._:-]{1,80}$/

/** One grant: `to` may pull `sha256` until `expiresAt`. */
export interface BlobGrant {
  readonly sha256: string
  readonly size: number
  readonly name: string
  /** The target team or handle, exactly as the sender routed to it. */
  readonly to: string
  /** The staging session (or CLI handle). */
  readonly by: string
  readonly grantedAt: number
  readonly expiresAt: number
  /** The task the send went out in, when known. */
  readonly taskId?: string
  /** How many times the target pulled it, and when first (absent: never). */
  readonly fetches?: number
  readonly firstFetchedAt?: number
}

/** The store's occupancy and ceilings (live grants only). */
export interface BlobUsage { readonly files: number; readonly bytes: number; readonly maxFiles: number; readonly maxBytes: number; readonly fileMax: number; readonly ttlMs: number }

export type RevokeResult =
  | { readonly ok: true; readonly sha256: string; readonly to: string; readonly reclaimed: boolean; readonly bytes: number }
  | { readonly ok: false; readonly code: 'bad-request' | 'not-found'; readonly error: string }

export type StageResult =
  | { readonly ok: true; readonly sha256: string; readonly size: number; readonly name: string; readonly expiresAt: number }
  | { readonly ok: false; readonly code: 'bad-request' | 'too-large' | 'full'; readonly error: string }

/** A file name that can only land inside the inbox: no path, no `..`, no control characters, bounded. */
export function sanitizeBlobName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()
  const capped = base.slice(0, BLOB_NAME_MAX)
  return capped === '' ? 'file' : capped
}

/** The one-line reference a session message carries (design §3.1). */
export function formatFileRef(ref: { sha256: string; size: number; name: string; from: string }): string {
  return `[A2A file] v1 sha256=${ref.sha256} size=${String(ref.size)} name=${encodeURIComponent(sanitizeBlobName(ref.name))} from=${ref.from}`
}

/** Parse a reference line (anywhere in a message); undefined when it is not a well-formed v1 reference. */
export function parseFileRef(text: string): { sha256: string; size: number; name: string; from: string } | undefined {
  const m = /\[A2A file\] v1 sha256=([0-9a-f]{64}) size=(\d{1,12}) name=(\S{1,512}) from=(https?:\/\/\S{1,2048})/.exec(text)
  if (m === null) return undefined
  const size = Number(m[2])
  if (!Number.isSafeInteger(size) || size > BLOB_FILE_MAX) return undefined
  let name: string
  try { name = decodeURIComponent(m[3] as string) } catch { return undefined }
  let from: URL
  try { from = new URL(m[4] as string) } catch { return undefined }
  // Only the origin is a pull target: a path, query or credentials on the URL are refused.
  if (from.username !== '' || from.password !== '' || (from.pathname !== '/' && from.pathname !== '') || from.search !== '' || from.hash !== '') return undefined
  return { sha256: m[1] as string, size, name: sanitizeBlobName(name), from: from.origin }
}

export class BlobStore {
  private grants: BlobGrant[] = []

  /**
   * @param root - the store's directory (`<home>/a2a`); '' = in-memory grants and no blob files (tests of the grant logic only).
   * @param now - clock (tests).
   */
  constructor(private readonly root: string, private readonly now: () => number = () => Date.now()) {
    this.restore()
    // Bytes a revoke could not delete (or a crash left between the written change and the delete) go now.
    try { this.sweep() } catch { /* the next stage sweeps again */ }
  }

  private get grantsFile(): string { return join(this.root, 'blob-grants.json') }
  private blobPath(sha256: string): string { return join(this.root, 'blobs', sha256) }

  /** Stage bytes for `to`; a repeat of the same (sha256, to) only extends the grant. */
  stage(bytes: Uint8Array, meta: { name: string; to: string; by: string; taskId?: string }): StageResult {
    if (typeof meta.to !== 'string' || meta.to === '' || typeof meta.by !== 'string' || meta.by === '') return { ok: false, code: 'bad-request', error: 'to and by are required' }
    if (meta.taskId !== undefined && !BLOB_TASK_RE.test(meta.taskId)) return { ok: false, code: 'bad-request', error: 'task_id is 1–80 of A-Z a-z 0-9 . _ : -' }
    if (bytes.byteLength > BLOB_FILE_MAX) return { ok: false, code: 'too-large', error: `file is ${String(bytes.byteLength)} bytes; the file channel takes at most ${String(BLOB_FILE_MAX)}` }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const name = sanitizeBlobName(meta.name)
    const at = this.now()
    const expiresAt = at + BLOB_GRANT_TTL_MS
    const stored = this.hasBlob(sha256)
    if (!stored) {
      this.sweep()
      const blobs = this.liveBlobs()
      const total = blobs.reduce((sum, b) => sum + b.size, 0)
      if (blobs.length + 1 > BLOB_COUNT_MAX || total + bytes.byteLength > BLOB_TOTAL_MAX) {
        return { ok: false, code: 'full', error: `the file store is full (${String(blobs.length)} files, ${String(total)} bytes held by live grants); retry after some expire` }
      }
      if (this.root !== '') {
        mkdirSync(join(this.root, 'blobs'), { recursive: true })
        const tmp = `${this.blobPath(sha256)}.tmp-${String(process.pid)}`
        writeFileSync(tmp, bytes, { mode: 0o600 })
        renameSync(tmp, this.blobPath(sha256))
      }
    }
    // The same sender re-sending: extend, keeping its task and fetch record; anyone else's grant is left as it is.
    const mine = (g: BlobGrant): boolean => g.sha256 === sha256 && g.to === meta.to && g.by === meta.by
    const before = this.grants.find(mine)
    const grant: BlobGrant = before !== undefined
      ? { ...before, expiresAt, ...(before.taskId === undefined && meta.taskId !== undefined ? { taskId: meta.taskId } : {}) }
      : { sha256, size: bytes.byteLength, name, to: meta.to, by: meta.by, grantedAt: at, expiresAt, ...(meta.taskId !== undefined ? { taskId: meta.taskId } : {}) }
    this.commit([grant, ...this.grants.filter(g => !mine(g))])
    return { ok: true, sha256, size: bytes.byteLength, name, expiresAt }
  }

  /**
   * The live grant that lets one of `callerTeams` pull `sha256`, if any. `callerTeams` are the
   * teams the WIRE FACE proved for the caller (OriginClaim + membership) — never self-described.
   */
  grantFor(sha256: string, callerTeams: readonly string[]): BlobGrant | undefined {
    if (!SHA256_RE.test(sha256)) return undefined
    const at = this.now()
    return this.grants.find(g => g.sha256 === sha256 && g.expiresAt > at && callerTeams.includes(g.to))
  }

  /** The bytes of a granted blob (undefined when the file is gone or does not hash back). */
  read(grant: BlobGrant): Uint8Array | undefined {
    if (this.root === '' || !this.hasBlob(grant.sha256)) return undefined
    const bytes = readFileSync(this.blobPath(grant.sha256))
    if (bytes.byteLength !== grant.size || createHash('sha256').update(bytes).digest('hex') !== grant.sha256) return undefined
    return bytes
  }

  /** Live grants (for the state face). */
  list(): readonly BlobGrant[] {
    const at = this.now()
    return this.grants.filter(g => g.expiresAt > at)
  }

  /** The live grants `by` made, newest first. */
  grantsBy(by: string): readonly BlobGrant[] { return by === '' ? [] : this.list().filter(g => g.by === by) }

  /** The store's occupancy (blobs live grants name) and its ceilings. */
  usage(): BlobUsage {
    const blobs = this.liveBlobs()
    return { files: blobs.length, bytes: blobs.reduce((sum, b) => sum + b.size, 0), maxFiles: BLOB_COUNT_MAX, maxBytes: BLOB_TOTAL_MAX, fileMax: BLOB_FILE_MAX, ttlMs: BLOB_GRANT_TTL_MS }
  }

  /** Record the task a send went out in on the grants it staged (only `by`'s, only where none is recorded). */
  tagTask(sha256: string, to: string, by: string, taskId: string): void {
    if (!BLOB_TASK_RE.test(taskId)) return
    let changed = false
    const next = this.grants.map(g => g.sha256 === sha256 && g.to === to && g.by === by && g.taskId === undefined ? (changed = true, { ...g, taskId }) : g)
    if (changed) this.commit(next)
  }

  /** The target pulled this grant's blob: count it, and keep when it first did (that sender's grant only). */
  noteFetch(grant: BlobGrant): void {
    const at = this.now()
    this.commit(this.grants.map(g => g.sha256 === grant.sha256 && g.to === grant.to && g.by === grant.by ? { ...g, fetches: (g.fetches ?? 0) + 1, firstFetchedAt: g.firstFetchedAt ?? at } : g))
  }

  /**
   * Revoke `by`'s grant of `sha256` to `to`. Only the sender that made the grant revokes it; for anyone
   * else the answer is the one a missing grant gets (no existence oracle). A blob no grant names any
   * more is deleted, and its bytes are free at once.
   */
  revoke(sha256: string, to: string, by: string): RevokeResult {
    if (!SHA256_RE.test(sha256) || typeof to !== 'string' || to === '' || by === '') return { ok: false, code: 'bad-request', error: 'sha256 (64 hex) and to are required' }
    const grant = this.grants.find(g => g.sha256 === sha256 && g.to === to && g.by === by)
    if (grant === undefined) return { ok: false, code: 'not-found', error: 'you have no grant of that file to that target' }
    const next = this.grants.filter(g => g !== grant)
    // Written first: a failed write throws and nothing changed (the retry revokes it then).
    this.commit(next)
    const reclaimed = !next.some(g => g.sha256 === sha256)
    if (reclaimed && this.root !== '') { try { rmSync(this.blobPath(sha256), { force: true }) } catch { /* no grant names it: the next start's sweep deletes it */ } }
    return { ok: true, sha256, to, reclaimed, bytes: reclaimed ? grant.size : 0 }
  }

  private hasBlob(sha256: string): boolean {
    if (this.root === '') return this.grants.some(g => g.sha256 === sha256)
    return existsSync(this.blobPath(sha256))
  }

  /** Blobs some live grant still names, with their sizes. */
  private liveBlobs(): Array<{ sha256: string; size: number }> {
    const at = this.now()
    const seen = new Map<string, number>()
    for (const g of this.grants) if (g.expiresAt > at) seen.set(g.sha256, g.size)
    return [...seen].map(([sha256, size]) => ({ sha256, size }))
  }

  /** Drop expired grants and every blob file no live grant names. */
  private sweep(): void {
    const at = this.now()
    const before = this.grants.length
    this.grants = this.grants.filter(g => g.expiresAt > at)
    if (this.root !== '' && existsSync(join(this.root, 'blobs'))) {
      const keep = new Set(this.grants.map(g => g.sha256))
      for (const file of readdirSync(join(this.root, 'blobs'))) {
        if (keep.has(file) && statSync(join(this.root, 'blobs', file)).isFile()) continue
        rmSync(join(this.root, 'blobs', file), { force: true, recursive: true })
      }
    }
    if (this.grants.length !== before) this.persist()
  }

  /** Write `next` and only then make it the store's state: a failed write throws with the state unchanged. */
  private commit(next: BlobGrant[]): void {
    this.write(next)
    this.grants = next
  }

  private persist(): void { this.write(this.grants) }

  private write(grants: readonly BlobGrant[]): void {
    if (this.root === '') return
    mkdirSync(this.root, { recursive: true })
    const tmp = `${this.grantsFile}.tmp-${String(process.pid)}`
    try {
      writeFileSync(tmp, JSON.stringify({ grants }), { mode: 0o600 })
      renameSync(tmp, this.grantsFile)
    } catch (error) {
      try { rmSync(tmp, { force: true }) } catch { /* the tmp path itself may be what failed */ }
      throw error
    }
  }

  private restore(): void {
    if (this.root === '' || !existsSync(this.grantsFile)) return
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.grantsFile, 'utf8')) } catch { raw = undefined }
    const list = (raw as { grants?: unknown } | null | undefined)?.grants
    const valid = (g: unknown): g is BlobGrant => {
      const r = g as Partial<BlobGrant> | null
      return r !== null && typeof r === 'object' && typeof r.sha256 === 'string' && SHA256_RE.test(r.sha256)
        && Number.isSafeInteger(r.size) && (r.size as number) >= 0 && (r.size as number) <= BLOB_FILE_MAX
        && typeof r.name === 'string' && typeof r.to === 'string' && r.to !== '' && typeof r.by === 'string'
        && Number.isSafeInteger(r.grantedAt) && Number.isSafeInteger(r.expiresAt)
        && (r.taskId === undefined || (typeof r.taskId === 'string' && BLOB_TASK_RE.test(r.taskId)))
        && (r.fetches === undefined || (Number.isSafeInteger(r.fetches) && (r.fetches as number) >= 0))
        && (r.firstFetchedAt === undefined || Number.isSafeInteger(r.firstFetchedAt))
    }
    if (!Array.isArray(list) || !list.every(valid)) {
      // Fail-closed: set the file aside and serve nothing from it.
      try { copyFileSync(this.grantsFile, `${this.grantsFile}.corrupt-${String(this.now())}`) } catch { /* the original stays in place */ }
      this.grants = []
      return
    }
    this.grants = list
  }
}
