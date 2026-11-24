/**
 * #881 v2 (owner decision 2026-11-24, kb 66ad3a78d1), first slice: the verified final results of the team's outbound
 * requests, kept apart from outbound.json in two host-private files (an index and the bodies, mode 0o600), and the
 * status-only answer of the `outbound_result` query. Bodies are recorded here but not served yet: serving them waits for
 * the audit, the session marking and the disclosure policy of the later slices (design B4: "only status until then").
 *
 * A result is recorded only for a receipt the network ledger settled positively (#884) on the current attempt of an
 * approved request, bound to its ticket, card, attempt task, sender, replier, transport id and proof. The body is the
 * receipt's human text: its summary line and the lines after the v2 envelope line, CRLF made LF, hashed before any cut.
 */
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { RECEIPT_OUTCOMES, parseReceipt } from '../../receipt.ts'
import { clipUtf8 } from '../../task-bodies.ts'

export const RESULT_BODY_MAX_BYTES = 8 * 1024
export const RESULT_BODY_TTL_MS = 7 * 24 * 3_600_000
export const RESULT_INDEX_TTL_MS = 30 * 24 * 3_600_000
export const RESULT_BODY_CAP = { count: 256, bytes: 2 * 1024 * 1024 } as const
export const RESULT_INDEX_CAP = { count: 1024, bytes: 1024 * 1024 } as const
export const RESULT_INDEX_ROW_MAX = 1024

export type OutboundResultStatus = 'ready' | 'truncated' | 'pending' | 'terminal_no_body' | 'expired' | 'unavailable'
export type SourceCompleteness = 'complete' | 'source-truncated' | 'unproven'
export type UnavailableReason = 'source-truncated' | 'source-unproven' | 'storage' | 'conflict'

/** The one refusal every unauthorised, unknown or out-of-scope query gets: no hint that anything exists. */
export const RESULT_UNAVAILABLE = { ok: false, code: 'outbound-result-unavailable', error: '出站结果不可用' } as const

/** The receipt itself in a mailbox text: the whole text on the local face, or after the exact wire direct header. */
export function receiptSource(text: string): { readonly kind: 'local' | 'wire'; readonly receipt: string } | undefined {
  const t = text.replace(/\r\n/g, '\n')
  if (t.startsWith('[A2A receipt] task ')) return { kind: 'local', receipt: t }
  const gap = t.indexOf('\n\n')
  if (gap < 0) return undefined
  const head = t.slice(0, gap)
  // Only the one outer header the wire face writes (a single line: no m flag, so ^ and $ bound the whole head), never a
  // receipt line found further inside the text.
  if (!/^\[A2A direct\] \(task [^)]+\) .* sent:$/.test(head)) return undefined
  const rest = t.slice(gap + 2)
  return rest.startsWith('[A2A receipt] task ') ? { kind: 'wire', receipt: rest } : undefined
}

export interface ResultBody {
  readonly version: 1
  readonly normalized: string
  readonly outcome?: string
  /** No publishable body: a legacy receipt without a v2 line, or a final one without an outcome (attention without a question). */
  readonly terminalNoBody: boolean
}

/** The human body of a final receipt for `taskId` (v1 projection), or undefined when it is not that task's receipt. */
export function projectResultBody(raw: string, taskId: string): ResultBody | undefined {
  const receipt = raw.replace(/\r\n/g, '\n')
  const parsed = parseReceipt(receipt)
  if (parsed === null || parsed.taskId !== taskId) return undefined
  if (parsed.envelope === undefined) return { version: 1, normalized: '', terminalNoBody: true }
  const outcome = typeof parsed.envelope.outcome === 'string' && (RECEIPT_OUTCOMES as readonly string[]).includes(parsed.envelope.outcome) ? parsed.envelope.outcome : undefined
  if (outcome === undefined) return { version: 1, normalized: '', terminalNoBody: true }
  const continuation = receipt.split('\n').slice(2).join('\n')
  const normalized = parsed.summary + (continuation.trim() !== '' ? `\n${continuation}` : '')
  return { version: 1, normalized, outcome, terminalNoBody: false }
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

export interface ResultCredential {
  readonly ticketId: string
  readonly card: string
  readonly task: string
  readonly sender: string
  readonly replier: string
  readonly transportId: string
  readonly proof: string
  readonly approvedAt: string
  readonly text: string
  readonly completeness: SourceCompleteness
}

interface IndexRow {
  readonly key: string
  readonly ticketId: string
  readonly task: string
  readonly card: string
  readonly sender: string
  readonly replier: string
  readonly transportId: string
  readonly proof: string
  readonly approvedAt: string
  readonly source: 'local' | 'wire' | 'none'
  readonly completeness: SourceCompleteness
  readonly payloadHash: string
  readonly bodyHash?: string
  readonly outcome?: string
  readonly terminalNoBody: boolean
  readonly gen?: string
  readonly clipped?: true
  readonly conflict?: true
  readonly at: number
}
interface BodyRow { readonly key: string; readonly gen: string; readonly hash: string; readonly text: string; readonly at: number }

export type RegisterResult = 'stored' | 'indexed' | 'duplicate' | 'conflict' | 'full' | 'failed' | 'not-a-result'

export interface ResultView {
  readonly status: OutboundResultStatus
  readonly sourceCompleteness?: SourceCompleteness
  readonly truncated?: boolean
  readonly hasBody?: boolean
  readonly outcome?: string
  readonly reason?: UnavailableReason
}

/** The team's verified outbound results: an index and the bodies, each its own 0o600 file, replaced atomically. */
export class OutboundResults {
  private index: readonly IndexRow[] = []
  private bodies: readonly BodyRow[] = []
  private broken = false

  constructor(private readonly d: { readonly indexPath: string; readonly bodyPath: string; readonly now: () => number; readonly logger: { warn(format: string, ...args: unknown[]): void } }) {
    try {
      const idx = existsSync(d.indexPath) ? JSON.parse(readFileSync(d.indexPath, 'utf8')) as { version?: unknown; rows?: unknown } : { version: 1, rows: [] }
      const bod = existsSync(d.bodyPath) ? JSON.parse(readFileSync(d.bodyPath, 'utf8')) as { version?: unknown; rows?: unknown } : { version: 1, rows: [] }
      if (idx.version !== 1 || bod.version !== 1 || !Array.isArray(idx.rows) || !Array.isArray(bod.rows)) throw new Error('unknown format')
      // Every row must be an object with its string key (and a body its generation); anything else is a damaged store.
      const keyed = (row: unknown): boolean => typeof row === 'object' && row !== null && typeof (row as { key?: unknown }).key === 'string'
      if (!idx.rows.every(keyed) || !bod.rows.every(row => keyed(row) && typeof (row as { gen?: unknown }).gen === 'string')) throw new Error('malformed row')
      this.index = idx.rows as IndexRow[]
      // A body is read only through the generation its index row names, so an uncommitted body (a stop between the two
      // writes) is never read; the next write drops it.
      this.bodies = bod.rows as BodyRow[]
    } catch (error) {
      // A damaged store fails closed: nothing is read from it and nothing new is kept until it is repaired.
      this.broken = true
      d.logger.warn('superagent: outbound results store unreadable, results unavailable: %s', String(error))
    }
  }

  /** Record one verified final result. Never throws: a failure here never touches settlement, notes or retries. */
  register(c: ResultCredential): RegisterResult {
    try {
      if (this.broken) return 'failed'
      const now = this.d.now()
      const index = this.index.filter(r => now - r.at < RESULT_INDEX_TTL_MS)
      const live = new Set(index.flatMap(r => (r.gen !== undefined && now - r.at < RESULT_BODY_TTL_MS ? [r.gen] : [])))
      const bodies = this.bodies.filter(b => live.has(b.gen))
      const pruned = index.length !== this.index.length || bodies.length !== this.bodies.length
      const key = `${c.ticketId}\u0000${c.task}`
      const source = receiptSource(c.text)
      const body = source === undefined ? undefined : projectResultBody(source.receipt, c.task)
      if (source === undefined || body === undefined) return pruned && !this.commit(index, bodies) ? 'failed' : 'not-a-result'
      const payloadHash = sha(`v1\n${source.receipt}`)
      const bodyHash = body.terminalNoBody ? undefined : sha(`v1\n${body.normalized}`)
      const existing = index.find(r => r.key === key)
      if (existing !== undefined) {
        if (existing.payloadHash === payloadHash && existing.replier === c.replier) return pruned && !this.commit(index, bodies) ? 'failed' : 'duplicate'
        // A different result for the same request: the first one is kept and the result is frozen.
        if (existing.conflict === true && !pruned) return 'conflict'
        return this.commit(index.map(r => (r.key === key ? { ...r, conflict: true as const } : r)), bodies) ? 'conflict' : 'failed'
      }
      const base: IndexRow = { key, ticketId: c.ticketId, task: c.task, card: c.card, sender: c.sender, replier: c.replier, transportId: c.transportId, proof: c.proof, approvedAt: c.approvedAt,
        source: source.kind, completeness: c.completeness, payloadHash, ...(bodyHash !== undefined ? { bodyHash } : {}), ...(body.outcome !== undefined ? { outcome: body.outcome } : {}), terminalNoBody: body.terminalNoBody, at: now }
      // Only a complete source with a body is kept as a body; the body is cut at a character boundary and marked when it is.
      const keepBody = !body.terminalNoBody && c.completeness === 'complete'
      const clipped = keepBody ? clipUtf8(body.normalized, RESULT_BODY_MAX_BYTES) : undefined
      const gen = keepBody ? randomUUID() : undefined
      const row: IndexRow = gen === undefined ? base : { ...base, gen, ...(clipped!.truncated ? { clipped: true as const } : {}) }
      // Sizes are checked on what is written: the final row, and each file with its wrapper.
      if (Buffer.byteLength(JSON.stringify(row), 'utf8') > RESULT_INDEX_ROW_MAX) return 'failed'
      if (index.length + 1 > RESULT_INDEX_CAP.count || fileBytes([...index, row]) > RESULT_INDEX_CAP.bytes) return 'full'
      if (gen === undefined) return this.commit([...index, row], bodies) ? 'indexed' : 'failed'
      const next: BodyRow = { key, gen, hash: bodyHash!, text: clipped!.text, at: now }
      if (bodies.length + 1 > RESULT_BODY_CAP.count || fileBytes([...bodies, next]) > RESULT_BODY_CAP.bytes) return this.commit([...index, base], bodies) ? 'full' : 'failed'
      return this.commit([...index, row], [...bodies, next]) ? 'stored' : 'failed'
    } catch (error) {
      this.d.logger.warn('superagent: outbound result not recorded: %s', String(error))
      return 'failed'
    }
  }

  /** What one exact request result is, or undefined when nothing was recorded for it. */
  view(ticketId: string, task: string): ResultView | undefined {
    if (this.broken) return { status: 'unavailable', reason: 'storage' }
    const now = this.d.now()
    const row = this.index.find(r => r.key === `${ticketId}\u0000${task}` && now - r.at < RESULT_INDEX_TTL_MS)
    if (row === undefined) return undefined
    if (row.conflict === true) return { status: 'unavailable', reason: 'conflict' }
    if (row.terminalNoBody) return { status: 'terminal_no_body', hasBody: false, ...(row.outcome !== undefined ? { outcome: row.outcome } : {}) }
    const base = { sourceCompleteness: row.completeness, ...(row.outcome !== undefined ? { outcome: row.outcome } : {}) }
    if (now - row.at >= RESULT_BODY_TTL_MS) return { status: 'expired', hasBody: false, ...base }
    if (row.completeness === 'source-truncated') return { status: 'unavailable', reason: 'source-truncated', hasBody: false, ...base }
    if (row.completeness !== 'complete') return { status: 'unavailable', reason: 'source-unproven', hasBody: false, ...base }
    const body = row.gen === undefined ? undefined : this.bodies.find(b => b.gen === row.gen && b.key === row.key)
    if (body === undefined || body.hash !== row.bodyHash) return { status: 'unavailable', reason: 'storage', hasBody: false, ...base }
    return { status: row.clipped === true ? 'truncated' : 'ready', truncated: row.clipped === true, hasBody: true, ...base }
  }

  /**
   * Write bodies first, then the index that names their generation (a stop in between leaves an orphan, never a dangling
   * row), and only then take them as the store's state. A failed write leaves memory as it was and closes the store until a
   * restart reloads it from disk: nothing that was not committed is ever read.
   */
  private commit(index: readonly IndexRow[], bodies: readonly BodyRow[]): boolean {
    try {
      writePrivate(this.d.bodyPath, JSON.stringify({ version: 1, rows: bodies }))
      writePrivate(this.d.indexPath, JSON.stringify({ version: 1, rows: index }))
    } catch (error) {
      this.broken = true
      this.d.logger.warn('superagent: outbound results not saved, store closed until restart: %s', String(error))
      return false
    }
    this.index = index
    this.bodies = bodies
    return true
  }
}

const fileBytes = (rows: readonly unknown[]): number => Buffer.byteLength(JSON.stringify({ version: 1, rows }), 'utf8')

function writePrivate(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp-${randomUUID()}`
  try {
    writeFileSync(tmp, data, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}
