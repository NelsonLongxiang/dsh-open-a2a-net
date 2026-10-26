/**
 * CLI 户口登记处 (gh#45, owner rulings 2026-10-24):
 *   ① handle = <agent-name>/<uuid·8B (16 hex)> — the name is custom, the
 *      suffix is forced 16-hex by shape gate;
 *   ② one key, multiple registrations — v1: the local home host;
 *   ③ deposit TTL: default AND max 4h — expiry auto-deregisters (the CLI
 *      vanishes from the card face and the directory; re-publish returns).
 *
 * The deposit is the CLI's "household registration": the home host serves
 * the CLI's SIGNED card at /a2a/cli/<handle>/.well-known/agent-card.json
 * (an OriginClaim fetch of the CLI envelope lands exactly there), lists
 * the handle in its own card's sessionTeams (so the whole fleet sees the
 * CLI as a member card — draggable into canvas teams = the operator link),
 * and holds a mailbox for inbound deliveries (receipts land here; the CLI
 * polls while alive).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyCard } from './card.ts'

/** Owner ruling ③: the default AND maximum online window. */
export const CLI_DEPOSIT_TTL_MS = 4 * 60 * 60 * 1000

/**
 * gh#47 tombstone bound: expired deposits stay visible as OFFLINE rows
 * (newest TOMBSTONE_CAP keep their handle/name so team refs never dangle
 * silently) — the owner manages CLI nodes like session nodes.
 */
export const CLI_TOMBSTONE_CAP = 16

/** Owner ruling ①: <agent-name>/<uuid·8B>. The name is [a-z0-9-]{1,32}. */
export const CLI_HANDLE_RE = /^([a-z0-9-]{1,32})\/([0-9a-f]{16})$/

/** One deposited CLI identity. */
export interface CliDeposit {
  readonly handle: string
  /** The bare agent-name zone (card.team). */
  readonly name: string
  /** The CLI's signed card, verbatim wire JSON (served back as-is). */
  readonly cardJson: string
  readonly depositedAt: number
  readonly expiresAt: number
  /**
   * gh#47 tombstone: set when the deposit expired — the row stays (offline)
   * so the directory/board keeps the member visible and team refs never
   * dangle silently. A re-publish (same handle, same key) un-tombstones.
   */
  expiredAt?: number
}

/** One mailbox entry for a deposited handle. */
export interface CliMail {
  readonly at: number
  readonly from: string
  readonly text: string
}

interface Snapshot {
  deposits: CliDeposit[]
  mailbox: Record<string, CliMail[]>
}

const MAILBOX_CAP = 64

export class CliDepositStore {
  private deposits = new Map<string, CliDeposit>()
  private mailbox = new Map<string, CliMail[]>()
  private now: () => number

  constructor(private readonly path: string, options?: { now?: () => number }) {
    this.now = options?.now ?? (() => Date.now())
    this.restore()
  }

  /** Deposit (or refresh) one CLI card. TTL is clamped to the 4h ruling. */
  deposit(cardJson: string): { ok: true; handle: string; expiresAt: number } | { ok: false; error: string } {
    let parsed: unknown
    try {
      parsed = JSON.parse(cardJson)
    } catch {
      return { ok: false, error: 'card is not JSON' }
    }
    const verdict = verifyCard(parsed, this.now())
    if (!verdict.ok) return { ok: false, error: `card verification failed (${verdict.reason})` }
    if (typeof verdict.card.team !== 'string' || !CLI_HANDLE_RE.test(verdict.card.team)) {
      return { ok: false, error: `card.team must be the CLI handle <agent-name>/<uuid16hex>, got "${String(verdict.card.team)}"` }
    }
    const handle = verdict.card.team
    const name = CLI_HANDLE_RE.exec(handle)![1]!
    if (verdict.card.team !== `${name}/${CLI_HANDLE_RE.exec(handle)![2]}`) return { ok: false, error: 'handle mismatch' }
    const ttl = Math.min(CLI_DEPOSIT_TTL_MS, CLI_DEPOSIT_TTL_MS)
    const at = this.now()
    const prior = this.deposits.get(handle)
    // gh#47: a re-publish un-tombstones (expiredAt clears) and refreshes
    // the card — same handle, same key, back online.
    const row: CliDeposit = { handle, name, cardJson, depositedAt: at, expiresAt: at + ttl }
    this.deposits.set(handle, row)
    void prior
    this.pruneTombstones()
    this.persist()
    return { ok: true, handle, expiresAt: row.expiresAt }
  }

  revoke(handle: string): boolean {
    const had = this.deposits.delete(handle)
    if (had) this.persist()
    return had
  }

  /** Active deposits (sweeping expired ones — ruling ③ auto-deregister). */
  /** LIVE deposits only (tombstones excluded — the control list is the
   *  online roster; offline rows ride directoryRows for the board). */
  list(): readonly CliDeposit[] {
    this.sweep()
    return [...this.deposits.values()].filter(row => row.expiredAt === undefined && row.expiresAt > this.now())
  }

  get(handle: string): CliDeposit | undefined {
    const row = this.deposits.get(handle)
    if (row === undefined) return undefined
    if (row.expiresAt <= this.now()) {
      if (row.expiredAt === undefined) {
        // gh#47: expire into a TOMBSTONE (offline) instead of deleting —
        // the handle stays visible; only the LIVE row is gone.
        this.markExpired(row)
      }
      return undefined
    }
    return row
  }

  /** Card-serve rows: LIVE deposits only (an expired card 404s). */
  cardRows(): Array<{ team: string; name: string; description: string }> {
    return this.list().filter(row => row.expiredAt === undefined && row.expiresAt > this.now())
      .map(row => ({ team: row.handle, name: row.name, description: `cli — deposited identity (no wake; mailbox)${row.expiredAt !== undefined ? ' [offline]' : ''}` }))
  }

  /**
   * gh#47 directory rows: LIVE + TOMBSTONE (offline) — the board renders
   * offline member cards grayed but PRESENT, so a canvas ref to an expired
   * CLI never dangles silently. Re-publish un-tombstones (same handle).
   */
  directoryRows(): Array<{ team: string; name: string; description: string; offline: boolean }> {
    this.sweep()
    const rows = [...this.deposits.values()]
      .map(row => row.expiresAt <= this.now()
        ? (row.expiredAt === undefined ? this.markExpired(row) : row)
        : row)
    return rows.map(row => ({
      team: row.handle,
      name: row.name,
      description: row.expiredAt !== undefined
        ? 'cli — offline (deposit expired; re-publish to return)'
        : 'cli — deposited identity (no wake; mailbox)',
      offline: row.expiredAt !== undefined,
    }))
  }

  mail(handle: string, from: string, text: string): void {
    const list = this.mailbox.get(handle) ?? []
    list.unshift({ at: this.now(), from, text: text.slice(0, 4000) })
    this.mailbox.set(handle, list.slice(0, MAILBOX_CAP))
    this.persist()
  }

  readMail(handle: string): readonly CliMail[] {
    return [...(this.mailbox.get(handle) ?? [])]
  }

  private sweep(): void {
    const now = this.now()
    for (const [handle, row] of this.deposits) {
      if (row.expiresAt <= now && row.expiredAt === undefined) this.markExpired(row)
    }
  }

  /** Mark one row expired (tombstone) and persist. */
  private markExpired(row: CliDeposit): CliDeposit {
    const tomb: CliDeposit = { ...row, expiredAt: this.now() }
    this.deposits.set(tomb.handle, tomb)
    this.pruneTombstones()
    this.persist()
    return tomb
  }

  /** Keep at most TOMBSTONE_CAP offline rows — oldest evictions fall off. */
  private pruneTombstones(): void {
    const tombstones = [...this.deposits.values()].filter(row => row.expiredAt !== undefined)
    if (tombstones.length <= CLI_TOMBSTONE_CAP) return
    tombstones.sort((a, b) => (a.expiredAt ?? 0) - (b.expiredAt ?? 0))
    for (let i = 0; i < tombstones.length - CLI_TOMBSTONE_CAP; i += 1) this.deposits.delete(tombstones[i]!.handle)
  }

  private persist(): void {
    const mailbox: Record<string, CliMail[]> = {}
    for (const [handle, list] of this.mailbox) mailbox[handle] = [...list]
    const snapshot: Snapshot = { deposits: [...this.deposits.values()], mailbox }
    try {
      mkdirSync(join(this.path, '..'), { recursive: true })
      writeFileSync(this.path, JSON.stringify(snapshot), 'utf8')
    } catch {
      // persistence best-effort; the deposit re-publishes self-heal
    }
  }

  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Snapshot>
      for (const row of snapshot.deposits ?? []) {
        if (typeof row?.handle === 'string' && typeof row.cardJson === 'string' && typeof row.expiresAt === 'number') {
          this.deposits.set(row.handle, row as CliDeposit)
        }
      }
      for (const [handle, list] of Object.entries(snapshot.mailbox ?? {})) {
        if (Array.isArray(list)) this.mailbox.set(handle, list.filter(m => m !== null && typeof m === 'object'))
      }
      this.sweep()
    } catch {
      // corrupt file: start empty (re-publish heals)
    }
  }
}
