/**
 * #881 v2 second slice: what stands between a stored outbound result body and a session — the host's disclosure policy
 * (deny-all until the third slice installs one), the audit row written before any delivery, and the dedicated rendering.
 * Order in the host (design B4): authorization snapshot, terminal state and policy, audit row on disk, restricted session
 * mark on disk, authorization rechecked, response. A row without a delivery is acceptable; a delivery without a row is not.
 */
import { existsSync, readFileSync } from 'node:fs'
import { writePrivate } from './outbound-results.ts'

export interface DisclosureInput {
  readonly ticketId: string
  readonly task: string
  readonly outcome?: string
  readonly bodyHash: string
  readonly source: 'local' | 'wire' | 'none'
}
export type DisclosurePolicy = (input: DisclosureInput) => { readonly allow: true; readonly rule: string } | { readonly allow: false }

/** The default and, in this slice, the only policy the host installs: nothing is disclosed. */
export const DENY_ALL: DisclosurePolicy = () => ({ allow: false })

export const AUDIT_PER_HOUR = 60
export const AUDIT_KEEP_MS = 30 * 24 * 3_600_000
export const AUDIT_CAP = 10_000

export interface AuditRow {
  readonly at: number
  readonly session: string
  readonly role: string
  readonly ticketId: string
  readonly task: string
  readonly bodyHash: string
  readonly rule: string
}

/** The team's delivery audit: one 0o600 file, replaced atomically; a row is on disk before its delivery. */
export class ResultAudit {
  private rows: readonly AuditRow[] = []
  private broken = false

  constructor(private readonly d: { readonly path: string; readonly now: () => number; readonly logger: { warn(format: string, ...args: unknown[]): void } }) {
    try {
      const raw = existsSync(d.path) ? JSON.parse(readFileSync(d.path, 'utf8')) as { version?: unknown; rows?: unknown } : { version: 1, rows: [] }
      if (raw.version !== 1 || !Array.isArray(raw.rows) || !raw.rows.every(r => typeof r === 'object' && r !== null && typeof (r as { at?: unknown }).at === 'number' && typeof (r as { session?: unknown }).session === 'string')) throw new Error('unknown format')
      this.rows = raw.rows as AuditRow[]
    } catch (error) {
      // An unreadable audit fails closed: no delivery can be recorded, so none happens.
      this.broken = true
      d.logger.warn('superagent: outbound result audit unreadable, deliveries closed: %s', String(error))
    }
  }

  /** Record one delivery before it happens: 'recorded' only when the row is on disk. */
  record(row: Omit<AuditRow, 'at'>): 'recorded' | 'quota' | 'failed' {
    if (this.broken) return 'failed'
    const now = this.d.now()
    const kept = this.rows.filter(r => now - r.at < AUDIT_KEEP_MS)
    if (kept.filter(r => now - r.at < 3_600_000).length >= AUDIT_PER_HOUR || kept.length >= AUDIT_CAP) return 'quota'
    const next = [...kept, { ...row, at: now }]
    try { writePrivate(this.d.path, JSON.stringify({ version: 1, rows: next })) } catch (error) {
      this.broken = true
      this.d.logger.warn('superagent: outbound result audit not saved, deliveries closed until restart: %s', String(error))
      return 'failed'
    }
    this.rows = next
    return 'recorded'
  }
}

/** The text a session gets in place of the last words of a turn that held an outbound result body. */
export const RESTRICTED_TURN_TEXT = '（本轮会话收到过其他团队的受限出站结果正文，宿主不转述其内容；请看该成员的正式回报。）'

/**
 * The one way a body is shown: a fixed header that names it as another team's content, kept to this ticket, then the body
 * unchanged. Nothing in the body can replace the header.
 */
export function renderResultBody(r: { readonly ticketId: string; readonly task: string; readonly outcome?: string; readonly clipped: boolean; readonly text: string }): string {
  const head = `[A2A outbound result] ticket ${r.ticketId} task ${r.task}${r.outcome !== undefined ? ` outcome ${r.outcome}` : ''}${r.clipped ? ' (cut at 8 KiB)' : ''}`
  return `${head}\n受限内容：其他团队的回执正文，只用于本工单；不要转述、转发，或写进其他工单、日志与报表。\n\n${r.text}`
}
