/**
 * Owner delegates: the "user" scope of the control API. A delegate is a named token the owner issued for an agent that
 * acts as the owner (decision cards, rules, outbound recovery: every operation that otherwise needs the logged-in DSH
 * browser owner). It rides `X-DSH-Owner-Delegate` next to the control key; the browser-owner proof accepts it.
 *
 * - The store keeps only each token's SHA-256, its name, when it was issued and when it ends; a revoked or expired
 *   token stops at once (the file is read on every check).
 * - Issuing writes the store file under `<dsh-home>/a2a/`, so it takes this machine's account (`a2a-net user issue`):
 *   whoever can write that directory already owns the host.
 * - Every accepted use is appended to `owner-delegates-audit.jsonl` with the delegate's name, method and path.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/owner-delegate
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { validOwnerScope, type OwnerAction } from './owner-delegate-scope.ts'

/** The request header that carries a delegate token. */
export const OWNER_DELEGATE_HEADER = 'x-dsh-owner-delegate'

/** One issued delegate, as stored (never the token itself). */
export interface OwnerDelegateRecord {
  readonly id: string
  readonly name: string
  readonly sha256: string
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly revokedAt: string | null
  readonly scope?: readonly OwnerAction[]
}

/** What a check of a presented token found. */
export type OwnerDelegateCheck =
  | { readonly ok: true; readonly id: string; readonly name: string; readonly scope?: readonly OwnerAction[] }
  | { readonly ok: false; readonly reason: 'absent' | 'unknown' | 'revoked' | 'expired' | 'store' }

/**
 * Parse the store file's text; anything malformed reads as no delegates (fail closed).
 * @param text - the file's contents.
 * @returns the records.
 */
export function parseOwnerDelegates(text: string): OwnerDelegateRecord[] {
  let value: unknown
  try { value = JSON.parse(text) } catch { return [] }
  const rows = (value as { delegates?: unknown } | null)?.delegates
  if (!Array.isArray(rows)) return []
  return rows.filter((row): row is OwnerDelegateRecord => {
    const r = row as Record<string, unknown> | null
    return r !== null && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string'
      && typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256) && typeof r.createdAt === 'string'
      && (!Object.hasOwn(r, 'scope') || validOwnerScope(r.scope))
      && (r.expiresAt === null || typeof r.expiresAt === 'string') && (r.revokedAt === null || typeof r.revokedAt === 'string')
  })
}

/** The host's delegate book: reads the store on every check, appends the audit line on every accepted use. */
export class OwnerDelegates {
  /**
   * @param storePath - `<dsh-home>/a2a/owner-delegates.json`.
   * @param auditPath - `<dsh-home>/a2a/owner-delegates-audit.jsonl`.
   * @param now - the clock.
   */
  constructor(
    private readonly storePath: string,
    private readonly auditPath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Check a presented token.
   * @param token - the header's value.
   * @returns which delegate it is, or why not.
   */
  check(token: string): OwnerDelegateCheck {
    if (token === '') return { ok: false, reason: 'absent' }
    let text: string
    try { text = readFileSync(this.storePath, 'utf8') } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: false, reason: 'unknown' } : { ok: false, reason: 'store' }
    }
    const digest = createHash('sha256').update(token, 'utf8').digest()
    const found = parseOwnerDelegates(text).find(row => timingSafeEqual(Buffer.from(row.sha256, 'hex'), digest))
    if (found === undefined) return { ok: false, reason: 'unknown' }
    if (found.revokedAt !== null) return { ok: false, reason: 'revoked' }
    if (found.expiresAt !== null && Date.parse(found.expiresAt) <= this.now().getTime()) return { ok: false, reason: 'expired' }
    return { ok: true, id: found.id, name: found.name, ...(found.scope === undefined ? {} : { scope: found.scope }) }
  }

  /**
   * Record one accepted use. An audit that cannot be written refuses the use (the owner must be able to see it).
   * @param who - the delegate.
   * @param request - the request it authorized.
   * @param extra - what the route did (#951): action, target, sizes; never the text itself.
   * @returns whether the line was written.
   */
  audit(who: { readonly id: string | null; readonly name: string }, request: Pick<IncomingMessage, 'method' | 'url'>, extra?: Readonly<Record<string, unknown>>): boolean {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    // Extra fields (#951: action, target, sizes, digest) follow the fixed ones and can never replace them; no extra = the old line byte for byte.
    const more = Object.fromEntries(Object.entries(extra ?? {}).filter(([key]) => !['at', 'id', 'name', 'method', 'path'].includes(key)))
    try {
      appendFileSync(this.auditPath, `${JSON.stringify({ at: this.now().toISOString(), id: who.id, name: who.name, method: request.method ?? '', path, ...more })}\n`, { encoding: 'utf8', mode: 0o600 })
      return true
    } catch { return false }
  }
}

/**
 * Issue a delegate into the store file (the browser owner's face and `a2a-net user issue` write the same shape).
 * @param storePath - the store file.
 * @param name - who it is for.
 * @param days - lifetime in days; 0 or less = no end.
 * @param io - file access and randomness.
 * @param io.read - read the store, or undefined when absent.
 * @param io.write - replace the store atomically.
 * @param io.random - a fresh random token and id.
 * @param io.now - the clock.
 * @returns the new record and its token (shown once, never stored).
 */
export function issueOwnerDelegate(storePath: string, name: string, days: number, io: {
  readonly read: (path: string) => string | undefined
  readonly write: (path: string, text: string) => void
  readonly random: () => { readonly token: string; readonly id: string }
  readonly now: () => Date
}, scope?: readonly OwnerAction[]): { readonly record: OwnerDelegateRecord; readonly token: string } {
  if (scope !== undefined && !validOwnerScope(scope)) throw new Error('invalid owner delegate scope')
  const text = io.read(storePath)
  const rows = text === undefined ? [] : parseOwnerDelegates(text)
  const { token, id } = io.random()
  const at = io.now()
  const record: OwnerDelegateRecord = {
    id, name, sha256: createHash('sha256').update(token, 'utf8').digest('hex'), createdAt: at.toISOString(),
    expiresAt: days > 0 ? new Date(at.getTime() + days * 86_400_000).toISOString() : null, revokedAt: null,
    ...(scope === undefined ? {} : { scope: [...scope] }),
  }
  io.write(storePath, `${JSON.stringify({ delegates: [...rows, record] }, null, 2)}\n`)
  return { record, token }
}

/**
 * Revoke a delegate by id.
 * @param storePath - the store file.
 * @param id - the delegate.
 * @param io - file access and the clock.
 * @param io.read - read the store.
 * @param io.write - replace the store atomically.
 * @param io.now - the clock.
 * @returns whether a live delegate with that id was revoked.
 */
export function revokeOwnerDelegate(storePath: string, id: string, io: {
  readonly read: (path: string) => string | undefined
  readonly write: (path: string, text: string) => void
  readonly now: () => Date
}): boolean {
  const text = io.read(storePath)
  const rows = text === undefined ? [] : parseOwnerDelegates(text)
  let hit = false
  const next = rows.map(row => { if (row.id !== id || row.revokedAt !== null) return row; hit = true; return { ...row, revokedAt: io.now().toISOString() } })
  if (hit) io.write(storePath, `${JSON.stringify({ delegates: next }, null, 2)}\n`)
  return hit
}
